/* 귀인 찾기 API (/api/match/*) — 켠 사람끼리만, 같은 나이대끼리만, 궁합 점수 순.
 * 저장: KV(PUSH 이름공간 공유)
 *   mp:<pid>          값 {sid, kh(기기키 해시), link}  메타데이터 {n 별명, i 소개, r 관계비트, b 나이대(a|t), s 일간, e 일간오행, br 일지, c 오행5, p 성향4, tn 유형이름, cd 코드, t 시각, h 숨김}
 *   ml:<to>:<from>    받은 연결 요청(값 '1')    mo:<from>:<to> 보낸 요청    mb:<from>:<to> 차단    mr:<to>:<from> 신고
 *   mq:<pid>:<날짜>   하루 요청 수(2일 뒤 만료)
 * pid = sid의 해시 앞 16자: 익명번호(sid)는 다른 이용자에게 절대 보내지 않는다. 생년월일도 받지 않는다(나이대만). */
const enc = new TextEncoder();
const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const pidOf = async sid => (await sha('mm-pid:' + sid)).slice(0, 16);
const RELS = ['friend', 'work', 'mentor', 'biz'];
const EL = ['wood', 'fire', 'earth', 'metal', 'water'];
const GEN = { wood: 'fire', fire: 'earth', earth: 'metal', metal: 'water', water: 'wood' };
const HAP = ['子丑', '寅亥', '卯戌', '辰酉', '巳申', '午未'], CHUNG = ['子午', '丑未', '寅申', '卯酉', '辰戌', '巳亥'];
const STEM_EL = { 甲: 'wood', 乙: 'wood', 丙: 'fire', 丁: 'fire', 戊: 'earth', 己: 'earth', 庚: 'metal', 辛: 'metal', 壬: 'water', 癸: 'water' };
const LIKE_DAY = 10;
const pair = (l, a, b) => l.some(x => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a));
/* 앱 심층 궁합(engine.deepCompat)과 같은 공식 */
function score(A, B) {
  const kind = A.e === B.e ? 'same' : (GEN[A.e] === B.e || GEN[B.e] === A.e) ? 'generate' : 'control';
  const br = pair(HAP, A.br, B.br) ? 'harmony' : pair(CHUNG, A.br, B.br) ? 'clash' : 'neutral';
  const fills = EL.filter((e, i) => (A.c[i] === 0 && B.c[i] >= 2) || (B.c[i] === 0 && A.c[i] >= 2));
  const same = [0, 1, 2, 3].filter(i => (A.p[i] >= 50) === (B.p[i] >= 50)).length;
  const close = [0, 1, 2, 3].reduce((s, i) => s + (100 - Math.abs(A.p[i] - B.p[i])), 0) / 4;
  const sc = 58 + (kind === 'generate' ? 12 : kind === 'same' ? 7 : 2) + (br === 'harmony' ? 10 : br === 'clash' ? -4 : 3) + Math.min(8, fills.length * 4) + Math.round((close - 50) / 5);
  const why = [];
  if (kind === 'generate') why.push('일간 오행이 서로를 살려 주는 사이');
  if (kind === 'same') why.push('같은 오행이라 결이 통하는 사이');
  if (br === 'harmony') why.push('일지가 합을 이뤄 함께 있으면 편안한 사이');
  if (fills.length) why.push('서로에게 부족한 기운을 채워 줘요');
  if (same >= 3) why.push('성향 4가지 중 ' + same + '가지가 같아요');
  else if (same <= 1) why.push('성향이 달라 서로의 빈 곳을 보완해요');
  return { s: Math.max(55, Math.min(98, sc)), why: why.slice(0, 2) };
}
const BAD = /(https?:|www\.|open\.kakao|kakao|\.com|\.kr|@|\d[\d\s-]{6,}\d|카톡|텔레그램|라인\s?아이디|오픈채팅|시발|씨발|병신|섹스|조건)/i;
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
async function auth(env, b) {
  const sid = clean(b.sid, 20), key = String(b.mkey || '');
  if (!/^[a-z0-9]{6,20}$/.test(sid) || key.length < 16 || key.length > 80) return null;
  const pid = await pidOf(sid), raw = await env.PUSH.get('mp:' + pid, 'json');
  if (raw && raw.kh !== await sha(key)) return { bad: true };
  return { sid, pid, key, row: raw };
}
async function meta(env, pid) { const l = await env.PUSH.getWithMetadata('mp:' + pid, 'json'); return l && l.value ? { v: l.value, m: l.metadata } : null; }
async function listAll(env, prefix) { const out = []; let cursor; do { const l = await env.PUSH.list({ prefix, cursor }); out.push(...l.keys); cursor = l.list_complete ? null : l.cursor; } while (cursor); return out; }
async function has(env, k) { return (await env.PUSH.get(k)) !== null; }
async function notify(env, sid, title, body) { try { if (env.NOTIFY) await env.NOTIFY(sid, { title, body, url: '/?go=match', tag: 'match' }); } catch (e) {} }

export async function matchApi(req, env, path, isAdmin) {
  if (req.method !== 'POST') return j({ ok: false, reason: 'method' }, 405);
  let b; try { b = await req.json(); } catch (e) { return j({ ok: false, reason: 'bad' }, 400); }
  if (path === '/api/match/admin') {
    if (!(await isAdmin(b.key))) return j({ ok: false, reason: 'auth' }, 403);
    if (b.op && /^[0-9a-f]{16}$/.test(String(b.pid || ''))) {
      const cur = await meta(env, b.pid); if (!cur) return j({ ok: false, reason: 'none' });
      if (b.op === 'delete') { await env.PUSH.delete('mp:' + b.pid); return j({ ok: true }); }
      cur.m.h = b.op === 'hide' ? 1 : 0; await env.PUSH.put('mp:' + b.pid, JSON.stringify(cur.v), { metadata: cur.m }); return j({ ok: true });
    }
    const ps = await listAll(env, 'mp:'), likes = await listAll(env, 'mo:'), reps = await listAll(env, 'mr:');
    const likeSet = new Set(likes.map(k => k.name.slice(3)));
    let conns = 0; likeSet.forEach(x => { const [a, c] = x.split(':'); if (a < c && likeSet.has(c + ':' + a)) conns++; });
    const rel = {}, band = { a: 0, t: 0 }, stem = {}; let hidden = 0;
    ps.forEach(k => { const m = k.metadata || {}; band[m.b] = (band[m.b] || 0) + 1; if (m.h) hidden++; stem[m.s] = (stem[m.s] || 0) + 1; RELS.forEach((r, i) => { if (m.r & (1 << i)) rel[r] = (rel[r] || 0) + 1; }); });
    const repCount = {}; reps.forEach(k => { const to = k.name.split(':')[1]; repCount[to] = (repCount[to] || 0) + 1; });
    const reported = ps.filter(k => repCount[k.name.slice(3)]).map(k => ({ pid: k.name.slice(3), n: k.metadata.n, i: k.metadata.i, reports: repCount[k.name.slice(3)], h: k.metadata.h ? 1 : 0 })).sort((x, y) => y.reports - x.reports).slice(0, 50);
    return j({ ok: true, profiles: ps.length, band, rel, stem, hidden, likes: likeSet.size, connections: conns, reported });
  }
  const me = await auth(env, b);
  if (!me) return j({ ok: false, reason: 'bad' }, 400);
  if (me.bad) return j({ ok: false, reason: 'device' }, 403);
  const K = 'mp:' + me.pid;
  if (path === '/api/match/on') {
    const p = b.prof || {}, nick = clean(b.nick, 12), intro = clean(b.intro, 40);
    const rels = (Array.isArray(b.rels) ? b.rels : []).filter(r => RELS.indexOf(r) >= 0);
    const age = +b.age;
    if (!(age >= 14 && age < 120)) return j({ ok: false, reason: 'age' }, 400);
    if (nick.length < 2) return j({ ok: false, reason: 'nick' }, 400);
    if (BAD.test(nick) || BAD.test(intro)) return j({ ok: false, reason: 'text' }, 400);
    if (!rels.length || !STEM_EL[p.s] || !/^[子丑寅卯辰巳午未申酉戌亥]$/.test(p.br || '') || !Array.isArray(p.c) || p.c.length !== 5 || !Array.isArray(p.p) || p.p.length !== 4) return j({ ok: false, reason: 'prof' }, 400);
    const m = { n: nick, i: intro, r: rels.reduce((s, r) => s | (1 << RELS.indexOf(r)), 0), b: age >= 19 ? 'a' : 't', s: p.s, e: STEM_EL[p.s], br: p.br,
      c: p.c.map(x => Math.max(0, Math.min(8, +x | 0))), p: p.p.map(x => Math.max(0, Math.min(100, +x | 0))), tn: clean(p.tn, 20), cd: clean(p.cd, 4), t: Date.now(), h: me.row && b.keepHidden ? 1 : 0 };
    const prev = me.row ? await meta(env, me.pid) : null; if (prev && prev.m && prev.m.h) m.h = 1;  // 숨김 상태는 다시 켜도 유지
    await env.PUSH.put(K, JSON.stringify({ sid: me.sid, kh: await sha(me.key), link: me.row && me.row.link || '' }), { metadata: m });
    return j({ ok: true, pid: me.pid, band: m.b });
  }
  if (!me.row) return j({ ok: false, reason: 'off' });
  const mine = (await meta(env, me.pid)).m;
  if (path === '/api/match/off') {
    await env.PUSH.delete(K);
    const mk = (await listAll(env, 'mo:' + me.pid + ':')).concat(await listAll(env, 'ml:' + me.pid + ':'));
    for (const k of mk.slice(0, 900)) await env.PUSH.delete(k.name);  // 내 요청·받은 요청 정리(차단·신고 기록은 남김)
    return j({ ok: true });
  }
  if (path === '/api/match/list') {
    const [ps, outs, ins, blocks, blockedBy] = await Promise.all([listAll(env, 'mp:'), listAll(env, 'mo:' + me.pid + ':'), listAll(env, 'ml:' + me.pid + ':'), listAll(env, 'mb:' + me.pid + ':'), listAll(env, 'mb:')]);
    const sent = new Set(outs.map(k => k.name.split(':')[2])), got = new Set(ins.map(k => k.name.split(':')[2]));
    const blk = new Set(blocks.map(k => k.name.split(':')[2])); blockedBy.forEach(k => { const [, a, c] = k.name.split(':'); if (c === me.pid) blk.add(a); });
    const items = [], conns = [];
    for (const k of ps) {
      const pid = k.name.slice(3), m = k.metadata; if (!m || pid === me.pid || m.b !== mine.b || blk.has(pid)) continue;
      const connected = sent.has(pid) && got.has(pid);
      if (!connected && (m.h || !(m.r & mine.r))) continue;
      const sc = score(mine, m), card = { id: pid, n: m.n, i: m.i, tn: m.tn, cd: m.cd, s: m.s, r: RELS.filter((r, i) => m.r & (1 << i)), score: sc.s, why: sc.why, sent: sent.has(pid), connected };
      if (connected) conns.push(card); else items.push(card);
    }
    items.sort((x, y) => y.score - x.score || 0);
    if (mine.b === 'a') for (const c of conns) { const o = await env.PUSH.get('mp:' + c.id, 'json'); c.link = o && o.link || ''; }
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), used = +(await env.PUSH.get('mq:' + me.pid + ':' + today) || 0);
    return j({ ok: true, me: { n: mine.n, i: mine.i, r: RELS.filter((r, i) => mine.r & (1 << i)), b: mine.b, h: mine.h ? 1 : 0, link: me.row.link || '' }, items: items.slice(0, 20), total: items.length, conns, likesLeft: Math.max(0, LIKE_DAY - used), gotCount: [...got].filter(x => !sent.has(x)).length });
  }
  const to = String(b.to || '');
  if (path === '/api/match/link') {
    if (mine.b !== 'a') return j({ ok: false, reason: 'teen' });
    const link = String(b.link || '').trim();
    if (link && !/^https:\/\/open\.kakao\.com\/o\/[A-Za-z0-9]{4,20}$/.test(link)) return j({ ok: false, reason: 'link' }, 400);
    me.row.link = link; await env.PUSH.put(K, JSON.stringify(me.row), { metadata: mine });
    return j({ ok: true });
  }
  if (!/^[0-9a-f]{16}$/.test(to) || to === me.pid) return j({ ok: false, reason: 'bad' }, 400);
  const other = await meta(env, to);
  if (!other || other.m.b !== mine.b) return j({ ok: false, reason: 'none' });
  if (path === '/api/match/like') {
    if (await has(env, 'mb:' + to + ':' + me.pid) || await has(env, 'mb:' + me.pid + ':' + to)) return j({ ok: false, reason: 'none' });
    if (await has(env, 'mo:' + me.pid + ':' + to)) return j({ ok: true, connected: await has(env, 'mo:' + to + ':' + me.pid) });
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), qk = 'mq:' + me.pid + ':' + today, used = +(await env.PUSH.get(qk) || 0);
    if (used >= LIKE_DAY) return j({ ok: false, reason: 'limit' });
    await Promise.all([env.PUSH.put(qk, String(used + 1), { expirationTtl: 2 * 86400 }), env.PUSH.put('mo:' + me.pid + ':' + to, '1'), env.PUSH.put('ml:' + to + ':' + me.pid, '1')]);
    const connected = await has(env, 'mo:' + to + ':' + me.pid);
    if (connected) await notify(env, other.v.sid, '새 귀인과 연결됐어요', '서로 연결하고 싶어 했어요. MyMyMe에서 확인해 보세요.');
    else await notify(env, other.v.sid, '누군가 당신과 연결되고 싶어 해요', '귀인 찾기에서 궁합이 좋은 사람이 연결을 요청했어요.');
    return j({ ok: true, connected });
  }
  if (path === '/api/match/unlike') { await Promise.all([env.PUSH.delete('mo:' + me.pid + ':' + to), env.PUSH.delete('ml:' + to + ':' + me.pid)]); return j({ ok: true }); }
  if (path === '/api/match/block') { await Promise.all([env.PUSH.put('mb:' + me.pid + ':' + to, '1'), env.PUSH.delete('mo:' + me.pid + ':' + to), env.PUSH.delete('ml:' + to + ':' + me.pid)]); return j({ ok: true }); }
  if (path === '/api/match/report') {
    const reason = clean(b.reason, 30); await env.PUSH.put('mr:' + to + ':' + me.pid, reason || '-'); await env.PUSH.put('mb:' + me.pid + ':' + to, '1');
    const n = (await listAll(env, 'mr:' + to + ':')).length;
    if (n >= 3 && !other.m.h) { other.m.h = 1; await env.PUSH.put('mp:' + to, JSON.stringify(other.v), { metadata: other.m }); }
    return j({ ok: true });
  }
  return j({ ok: false, reason: 'notfound' }, 404);
}
