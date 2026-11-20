/* MyMyMe 웹앱 서비스 워커.
 * 화면(같은 사이트의 GET 요청)은 '네트워크 먼저': 온라인이면 항상 최신 버전을 받고, 받은 것을 저장해 두었다가 오프라인일 때만 꺼내 쓴다.
 * 매주 요즘 말 업데이트처럼 자주 바뀌는 내용이 오래된 캐시에 묶이지 않게 하려는 것. 서버(Apps Script)·폰트 등 다른 사이트 요청은 건드리지 않는다 */
var CACHE = 'mymyme-v1';
var SHELL = ['./', './index.html', './icon-192.png', './icon-512.png', './manifest.webmanifest'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf('admin') >= 0) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req.mode === 'navigate' ? './' : req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req.mode === 'navigate' ? './' : req).then(function (hit) { return hit || caches.match('./'); });
  }));
});
