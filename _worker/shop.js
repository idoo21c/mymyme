/* 코인 채우기 코너 설정 (관리자가 넣는 상품 목록)
   GET  /api/shop        { ok, visit: [{id,name,desc,url}], cp: [{id,name,desc,url}] }
   POST /api/shop/admin  { key, op: 'get' | 'set', visit, cp }
   visit = 칼렛스토어 상품(방문하면 코인), cp = 쿠팡 파트너스 추천템(보상 없음) */
const J = (o, s, c) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': c || 'no-store' } });
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>"]/g, '').trim().slice(0, max);
function list(arr, okUrl) {
  return (Array.isArray(arr) ? arr : []).slice(0, 12).map((x, i) => ({ id: clean(x.id, 20) || 'i' + i, name: clean(x.name, 40), desc: clean(x.desc, 80), url: clean(x.url, 500) }))
    .filter((x) => x.name && okUrl(x.url));
}
const okStore = (u) => /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(u);   // 관리자만 넣는 칸이라 https 주소면 허용
const okCp = (u) => /^https:\/\/(link\.coupang\.com|coupa\.ng)\/[^\s]+$/i.test(u);
export async function shopApi(req, env, path, isAdmin) {
  if (path === '/api/shop' && req.method === 'GET') {
    const v = await env.PUSH.get('shop:cfg');
    const c = v ? JSON.parse(v) : { visit: [], cp: [] };
    return J({ ok: true, visit: c.visit || [], cp: c.cp || [] }, 200, 'public, max-age=60');
  }
  if (path === '/api/shop/admin' && req.method === 'POST') {
    let b; try { b = await req.json(); } catch (e) { return J({ ok: false, reason: 'bad' }, 400); }
    if (!(await isAdmin(b.key))) return J({ ok: false, reason: 'auth' }, 403);
    if (b.op === 'get') { const v = await env.PUSH.get('shop:cfg'); return J(Object.assign({ ok: true }, v ? JSON.parse(v) : { visit: [], cp: [] })); }
    if (b.op === 'set') {
      const visit = list(b.visit, okStore), cp = list(b.cp, okCp);
      const bad = (Array.isArray(b.visit) ? b.visit.length : 0) - visit.length + (Array.isArray(b.cp) ? b.cp.length : 0) - cp.length;
      await env.PUSH.put('shop:cfg', JSON.stringify({ visit, cp, at: Date.now() }));
      return J({ ok: true, visit, cp, dropped: bad });
    }
    return J({ ok: false, reason: 'op' }, 400);
  }
  return J({ ok: false, reason: 'notfound' }, 404);
}
