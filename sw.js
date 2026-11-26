/* MyMyMe 웹앱 서비스 워커.
 * 화면(같은 사이트의 GET 요청)은 '네트워크 먼저': 온라인이면 항상 최신 버전을 받고, 받은 것을 저장해 두었다가 오프라인일 때만 꺼내 쓴다.
 * 매주 요즘 말 업데이트처럼 자주 바뀌는 내용이 오래된 캐시에 묶이지 않게 하려는 것. 서버(Apps Script)·폰트 등 다른 사이트 요청은 건드리지 않는다 */
var CACHE = 'mymyme-v2';
var SHELL = ['./', './index.html', './daily-reflections.js', './icon-192.png', './icon-512.png', './manifest.webmanifest'];
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

/* 웹 푸시: 관리자가 보낸 공지·새 기능 알림을 띄우고, 누르면 해당 화면을 연다 */
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'MyMyMe', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'MyMyMe', { body: d.body || '', icon: './icon-192.png', badge: './icon-192.png', tag: d.tag || 'notice', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) { list[i].navigate(url); return list[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});
