/* 나에게 맞는 우리나라의 절 — 서버
   POST /api/temple/suggest  참여자 절 추천 접수 (익명번호 해시로 하루 5곳)
   GET  /api/temple/list     전통사찰 공식 목록(기본 카드) [이름, 시도, 시군구, 위도, 경도]
   POST /api/temple/admin    관리자: list | set | del | import | status
   공식 목록은 행정안전부 '문화_전통사찰 조회서비스'를 env.TEMPLE_KEY(Cloudflare 비밀값)로 받아 KV에 둔다. 키는 응답·로그에 내보내지 않는다. */
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const enc = new TextEncoder();
const hex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
const pidOf = async (sid) => hex(await crypto.subtle.digest('SHA-256', enc.encode('mm-tpid:' + sid))).slice(0, 16);
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const BAD = /(https?:|www\.|open\.kakao|카톡\s?아이디|텔레그램|@[a-z0-9_]{3,}|\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}|시발|씨발|병신|섹스|조건만남)/i;
const SD = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const TYPES = ['med', 'nat', 'exp', 'rit', 'com', 'svc'], TER = ['mount', 'sea', 'city', 'valley', 'lake'];
const SEA = ['봄', '여름', '가을', '겨울', '언제나'], WAY = ['당일 방문', '템플스테이', '행사'];
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/* 주소 → [시도, 시군구] */
const SDFULL = { 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원도: '강원', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주' };
export function region(addr) {
  const w = String(addr || '').trim().split(/\s+/); if (!w.length) return null;
  let sd = SDFULL[w[0]] || (SD.indexOf(w[0]) >= 0 ? w[0] : null) || (SD.filter((s) => w[0].indexOf(s) === 0)[0] || null);
  if (!sd) return null;
  if (sd === '세종') return ['세종', '세종시'];
  let sgg = w[1] || '';
  if (sd === '대구' && sgg === '군위군') return ['대구', '군위군'];
  if (/시$/.test(sgg) && /구$/.test(w[2] || '') && ['서울', '부산', '대구', '인천', '광주', '대전', '울산'].indexOf(sd) < 0) return [sd, sgg];
  return sgg ? [sd, sgg] : null;
}
/* EPSG:5174(보정 중부원점, 베셀) → WGS84 */
export function tm5174(x, y) {
  x = +x; y = +y; if (!isFinite(x) || !isFinite(y) || !x || !y) return null;
  const a = 6377397.155, f = 1 / 299.1528128, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2), k0 = 1, lat0 = 38 * Math.PI / 180, lon0 = (127 + 10.405 / 3600) * Math.PI / 180, x0 = 200000, y0 = 500000;
  const M = (p) => a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p) + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
  const m = M(lat0) + (y - y0) / k0, mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256)), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = (x - x0) / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  // 베셀 → WGS84 (7변수 헬머트, 위치벡터)
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const X = N * Math.cos(lat) * Math.cos(lon), Y = N * Math.cos(lat) * Math.sin(lon), Z = N * (1 - e2) * Math.sin(lat);
  const s = 1 + 6.43e-6, r = Math.PI / 180 / 3600, rx = 1.16 * r, ry = -2.31 * r, rz = -1.63 * r;
  const X2 = -115.80 + s * (X - rz * Y + ry * Z), Y2 = 474.99 + s * (rz * X + Y - rx * Z), Z2 = 674.11 + s * (-ry * X + rx * Y + Z);
  const A = 6378137, F = 1 / 298.257223563, E2 = 2 * F - F * F, pp = Math.sqrt(X2 * X2 + Y2 * Y2);
  let la = Math.atan2(Z2, pp * (1 - E2));
  for (let i = 0; i < 5; i++) { const Nn = A / Math.sqrt(1 - E2 * Math.sin(la) ** 2); la = Math.atan2(Z2 + E2 * Nn * Math.sin(la), pp); }
  const out = [la * 180 / Math.PI, Math.atan2(Y2, X2) * 180 / Math.PI];
  return out[0] > 32.8 && out[0] < 38.9 && out[1] > 124 && out[1] < 132 ? [Math.round(out[0] * 1e4) / 1e4, Math.round(out[1] * 1e4) / 1e4] : null;
}
const pick = (o, keys) => { for (const k of keys) { const hit = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase()); if (hit && o[hit] != null && String(o[hit]).trim() !== '') return String(o[hit]).trim(); } return ''; };
/* 응답 JSON 안에서 '사찰 한 건' 배열을 찾는다(구조가 바뀌어도 견디게) */
function rowsOf(j) {
  let best = [];
  const walk = (v, d) => { if (d > 6 || !v) return; if (Array.isArray(v)) { if (v.length && typeof v[0] === 'object' && v.length > best.length) best = v; v.forEach((x) => walk(x, d + 1)); return; } if (typeof v === 'object') Object.values(v).forEach((x) => walk(x, d + 1)); };
  walk(j, 0); return best;
}
function totalOf(j) { let t = 0; const walk = (v, d) => { if (d > 5 || !v || typeof v !== 'object') return; for (const [k, x] of Object.entries(v)) { if (/^totalcount$/i.test(k) && +x) t = +x; else walk(x, d + 1); } }; walk(j, 0); return t; }
export function toCard(o) {
  const name = pick(o, ['BPLC_NM', 'bplcNm', 'TMPL_NM', 'tmplNm', '사업장명', '사찰명', 'name']);
  const addr = pick(o, ['RDN_WHL_ADDR', 'rdnWhlAddr', 'SITE_WHL_ADDR', 'siteWhlAddr', '도로명전체주소', '소재지전체주소', 'addr', 'address']) || pick(o, ['SITE_WHL_ADDR', 'siteWhlAddr', '소재지전체주소']);
  const st = pick(o, ['DTL_SALS_STTS_NM', 'dtlSalsSttsNm', 'SALS_STTS_NM', 'salsSttsNm', 'TRDSTATENM', '영업상태명', '상세영업상태명']);
  const x = pick(o, ['CRD_INFO_X', 'crdInfoX', 'X', 'x', '좌표정보x(epsg5174)', '좌표정보(x)']), y = pick(o, ['CRD_INFO_Y', 'crdInfoY', 'Y', 'y', '좌표정보y(epsg5174)', '좌표정보(y)']);
  if (!name || /폐업|취소|말소|폐쇄/.test(st)) return null;
  const rg = region(addr) || region(pick(o, ['SITE_WHL_ADDR', 'siteWhlAddr', '소재지전체주소'])); if (!rg) return null;
  const ll = tm5174(x, y);
  return [clean(name, 40), rg[0], rg[1], ll ? ll[0] : null, ll ? ll[1] : null];
}
async function importList(env) {
  if (!env.TEMPLE_KEY) return { ok: false, reason: 'no-key' };
  const base = 'https://apis.data.go.kr/1741000/traditional_temples/info';
  const out = [], seen = {}; let page = 1, total = 0, raw = 0, keys = [], last = '';
  for (; page <= 20; page++) {
    const u = base + '?serviceKey=' + encodeURIComponent(env.TEMPLE_KEY) + '&pageNo=' + page + '&numOfRows=100&returnType=json&type=json&_type=json&resultType=json';
    let j, txt = '';
    try { const r = await fetch(u, { headers: { accept: 'application/json' } }); txt = await r.text(); last = 'HTTP ' + r.status; j = JSON.parse(txt); }
    catch (e) { return { ok: false, reason: 'fetch', detail: (last + ' ' + txt.replace(/[A-Za-z0-9%]{40,}/g, '…').slice(0, 300)).trim(), page }; }
    const rows = rowsOf(j); if (page === 1) { total = totalOf(j); keys = rows[0] ? Object.keys(rows[0]).slice(0, 40) : []; if (!rows.length) return { ok: false, reason: 'empty', detail: JSON.stringify(j).replace(/[A-Za-z0-9%]{40,}/g, '…').slice(0, 400) }; }
    if (!rows.length) break; raw += rows.length;
    rows.forEach((o) => { const c = toCard(o); if (c && !seen[c[0] + c[2]]) { seen[c[0] + c[2]] = 1; out.push(c); } });
    if (total && raw >= total) break; if (rows.length < 100) break;
  }
  const meta = { n: out.length, raw, total, at: Date.now(), keys, geo: out.filter((x) => x[3]).length, sgg: Object.keys(out.reduce((m, x) => (m[x[1] + ' ' + x[2]] = 1, m), {})).length };
  await env.PUSH.put('tpl:list', JSON.stringify(out)); await env.PUSH.put('tpl:meta', JSON.stringify(meta));
  return Object.assign({ ok: true }, meta);
}
export async function templeApi(req, env, path, isAdmin) {
  if (path === '/api/temple/list') {
    const v = await env.PUSH.get('tpl:list');
    return new Response(JSON.stringify({ ok: true, list: v ? JSON.parse(v) : [] }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }
  if (req.method !== 'POST') return J({ ok: false, reason: 'method' }, 405);
  let b; try { b = await req.json(); } catch (e) { return J({ ok: false, reason: 'bad' }, 400); }
  if (path === '/api/temple/suggest') {
    const sid = clean(b.sid, 40); if (!sid) return J({ ok: false, reason: 'bad' }, 400);
    const name = clean(b.name, 30), why = clean(b.why, 200), link = clean(b.link, 300), nick = clean(b.nick, 10);
    if (!name) return J({ ok: false, reason: 'name' });
    if (why.length < 20) return J({ ok: false, reason: 'why' });
    if (BAD.test(name) || BAD.test(why) || BAD.test(nick)) return J({ ok: false, reason: 'text' });
    if (link && !/^https:\/\/[^\s<>"]+$/.test(link)) return J({ ok: false, reason: 'link' });
    const sd = SD.indexOf(b.sd) >= 0 ? b.sd : ''; if (!sd) return J({ ok: false, reason: 'region' });
    const pid = await pidOf(sid), qk = 'tq:' + pid + ':' + today(), n = +(await env.PUSH.get(qk) || 0);
    if (n >= 5) return J({ ok: false, reason: 'limit' });
    await env.PUSH.put(qk, String(n + 1), { expirationTtl: 172800 });
    const rec = { name, sd, sgg: clean(b.sgg, 20), types: (Array.isArray(b.types) ? b.types : []).filter((t) => TYPES.indexOf(t) >= 0).slice(0, 2), ter: TER.indexOf(b.ter) >= 0 ? b.ter : '', why, season: SEA.indexOf(b.season) >= 0 ? b.season : '', way: WAY.indexOf(b.way) >= 0 ? b.way : '', link, nick, pid, at: Date.now() };
    const id = 'ts:' + (9e12 - Date.now()).toString(36) + Math.random().toString(36).slice(2, 6);   // 최신 순
    await env.PUSH.put(id, JSON.stringify(rec), { metadata: { st: 'new', n: name.slice(0, 20), sd } });
    return J({ ok: true });
  }
  if (path === '/api/temple/admin') {
    if (!(await isAdmin(b.key))) return J({ ok: false, reason: 'auth' }, 403);
    if (b.op === 'list') {
      const l = await env.PUSH.list({ prefix: 'ts:', limit: 200, cursor: b.cursor || undefined });
      const items = await Promise.all(l.keys.map(async (k) => { const v = await env.PUSH.get(k.name); return v ? Object.assign({ id: k.name, st: (k.metadata && k.metadata.st) || 'new' }, JSON.parse(v), { pid: undefined }) : null; }));
      return J({ ok: true, items: items.filter(Boolean), cursor: l.list_complete ? null : l.cursor });
    }
    if (b.op === 'set') {
      if (!/^ts:[a-z0-9]+$/.test(b.id || '') || ['new', 'ok', 'hold', 'no'].indexOf(b.st) < 0) return J({ ok: false, reason: 'bad' }, 400);
      const v = await env.PUSH.get(b.id); if (!v) return J({ ok: false, reason: 'none' });
      const rec = JSON.parse(v); await env.PUSH.put(b.id, v, { metadata: { st: b.st, n: rec.name.slice(0, 20), sd: rec.sd } });
      return J({ ok: true });
    }
    if (b.op === 'del') { if (!/^ts:[a-z0-9]+$/.test(b.id || '')) return J({ ok: false, reason: 'bad' }, 400); await env.PUSH.delete(b.id); return J({ ok: true }); }
    if (b.op === 'status') { const m = await env.PUSH.get('tpl:meta'); return J({ ok: true, key: !!env.TEMPLE_KEY, meta: m ? JSON.parse(m) : null }); }
    if (b.op === 'import') return J(await importList(env));
    return J({ ok: false, reason: 'op' }, 400);
  }
  return J({ ok: false, reason: 'notfound' }, 404);
}
