/* MyMyMe 웹 푸시 Worker (Cloudflare).
 * /api/push/* 만 이 코드가 처리하고, 나머지 주소는 정적 파일(사이트)을 그대로 돌려준다.
 * - 구독 정보(엔드포인트·키)는 KV(PUSH)에만 저장한다. 서버 비밀키(VAPID)는 처음 요청 때 Worker가 직접 만들어 KV에 둔다(저장소·채팅 어디에도 안 나감).
 * - 발송은 관리자 비밀번호를 Apps Script에 물어 확인한 뒤에만 한다. 무료 요금제는 요청 1번에 외부 호출 50개 제한이라 40명씩 끊어 보낸다(관리자 화면이 이어서 호출).
 * - 암호화: RFC 8291(aes128gcm) + VAPID(RFC 8292, ES256). WebCrypto만 쓴다. */
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbx2G0QG_yhq32sInKS2ScJDQsfuMxgpo4yIwiy5BEvhhK5LCy239wUOnT-Dz-FZsfGE/exec';
const SUBJECT = 'https://mymyme.app';
const BATCH = 40;
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)android\.googleapis\.com$/];

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const cat = (...a) => { const n = a.reduce((t, x) => t + x.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function vapid(env) {
  let v = await env.PUSH.get('vapid', 'json');
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    await env.PUSH.put('vapid', JSON.stringify(v));
  }
  return v;
}
async function vapidHeader(v, endpoint) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), p = b64u(enc.encode(JSON.stringify({ aud, exp: now + 12 * 3600, sub: SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', v.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(h + '.' + p));  // WebCrypto는 r||s(64바이트) 형식 = JWT 형식
  return 'vapid t=' + h + '.' + p + '.' + b64u(sig) + ', k=' + v.pub;
}
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
/* RFC 8291: 받는 사람 공개키(p256dh)·auth로 암호화한 본문 */
async function encrypt(p256dh, auth, plaintext) {
  const ua = unb64u(p256dh), authSecret = unb64u(auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(plaintext, new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
  return cat(head, asPub, ct);
}
async function sendOne(v, sub, payload) {
  const body = await encrypt(sub.p, sub.a, enc.encode(JSON.stringify(payload)));
  const r = await fetch(sub.e, { method: 'POST', body, headers: { Authorization: await vapidHeader(v, sub.e), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' } });
  return r.status;
}
async function subKey(endpoint) { return 'sub:' + b64u(await crypto.subtle.digest('SHA-256', enc.encode(endpoint))).slice(0, 32); }
function okEndpoint(e) { try { const u = new URL(e); return u.protocol === 'https:' && PUSH_HOSTS.some(rx => rx.test(u.hostname)); } catch (err) { return false; } }
async function isAdmin(key) {
  if (!key || typeof key !== 'string' || key.length > 200) return false;
  try { const r = await fetch(ENDPOINT + '?action=pushauth&key=' + encodeURIComponent(key)); const j = await r.json(); return !!(j && j.ok); } catch (err) { return false; }
}

async function api(req, env, path) {
  if (path === '/api/push/key' && req.method === 'GET') return json({ ok: true, key: (await vapid(env)).pub });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  let b; try { b = await req.json(); } catch (err) { return json({ ok: false, reason: 'bad' }, 400); }
  if (path === '/api/push/sub') {
    const s = b.sub || {}, k = s.keys || {};
    if (!okEndpoint(s.endpoint) || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 120 || k.auth.length > 40) return json({ ok: false, reason: 'bad' }, 400);
    const meta = { e: s.endpoint, p: k.p256dh, a: k.auth, u: String(b.sid || '').slice(0, 20), t: Date.now() };
    await env.PUSH.put(await subKey(s.endpoint), '1', { metadata: meta });
    return json({ ok: true });
  }
  if (path === '/api/push/unsub') {
    if (!okEndpoint(b.endpoint)) return json({ ok: false, reason: 'bad' }, 400);
    await env.PUSH.delete(await subKey(b.endpoint)); return json({ ok: true });
  }
  if (path === '/api/push/count' || path === '/api/push/send') {
    if (!(await isAdmin(b.key))) return json({ ok: false, reason: 'auth' }, 403);
    if (path === '/api/push/count') { let n = 0, cursor; do { const l = await env.PUSH.list({ prefix: 'sub:', cursor }); n += l.keys.length; cursor = l.list_complete ? null : l.cursor; } while (cursor); return json({ ok: true, count: n }); }
    const title = String(b.title || '').slice(0, 60), text = String(b.body || '').slice(0, 180);
    if (!title) return json({ ok: false, reason: 'title' }, 400);
    const url = /^\/[^\s]*$/.test(String(b.url || '')) ? String(b.url) : '/';
    const only = b.sid ? String(b.sid) : '';
    const v = await vapid(env), payload = { title, body: text, url, tag: String(b.tag || 'notice').slice(0, 30) };
    const l = await env.PUSH.list({ prefix: 'sub:', cursor: b.cursor || undefined, limit: only ? 1000 : BATCH });
    const subs = l.keys.filter(x => x.metadata && (!only || x.metadata.u === only));
    let sent = 0, failed = 0, removed = 0;
    await Promise.all(subs.slice(0, BATCH).map(async x => {
      try { const st = await sendOne(v, x.metadata, payload); if (st >= 200 && st < 300) sent++; else { failed++; if (st === 404 || st === 410) { await env.PUSH.delete(x.name); removed++; } } }
      catch (err) { failed++; }
    }));
    return json({ ok: true, sent, failed, removed, done: l.list_complete || !!only, cursor: l.list_complete ? null : l.cursor });
  }
  return json({ ok: false, reason: 'notfound' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/push/')) {
      if (!env.PUSH) return json({ ok: false, reason: 'no-kv' }, 503);
      try { return await api(req, env, url.pathname); } catch (err) { return json({ ok: false, reason: 'error' }, 500); }
    }
    return env.ASSETS.fetch(req);
  }
};
