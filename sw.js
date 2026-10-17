// ROOT-Ahead service worker.
// 1. Makes the app installable and lets it open without a connection: the
//    app shell (page, manifest, icons) is cached. Pages are fetched
//    network-first, so a new deploy is picked up on the next online start;
//    the cached copy is only used when the network fails.
//    Never cached: /api/* (live data), map tiles and routing services
//    (other origins) — those simply need a connection.
//    RA Admin (/admin) is network-first too, with its last page as offline
//    fallback so the offline banner can show.
// 2. Push notifications (unchanged from before): shows them and focuses or
//    opens the app when one is tapped.

var CACHE = 'rootahead-shell-v8'; // bump when the list below changes
var SHELL = ['/', '/manifest.json', '/logo-rootahead.png', '/icon-192-v2.png', '/icon-512-v2.png', '/apple-touch-icon-v2.png'];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return c.addAll(SHELL); })
      .catch(function(){}) // a failed pre-cache must never block installing the worker
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k.indexOf('rootahead-shell-') === 0 && k !== CACHE; })
        .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // tiles, routing, fonts: straight to network
  if (url.pathname.indexOf('/api/') === 0) return;      // live data: never cached
  if (url.pathname.indexOf('/_vercel/') === 0) return;  // analytics
  if (url.pathname.indexOf('/admin') === 0){
    // RA Admin: always live when online. Only the page itself is kept as an
    // offline fallback, so the app opens and shows "No internet connection"
    // instead of the browser's error page. Its icons/manifest are not cached.
    if (req.mode !== 'navigate') return;
    event.respondWith(
      fetch(req).then(function(res){
        if (res && res.ok){ var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put('/admin/', copy); }); }
        return res;
      }).catch(function(){
        return caches.match('/admin/').then(function(hit){ return hit || Response.error(); });
      })
    );
    return;
  }

  if (req.mode === 'navigate'){
    // network-first for the page itself, cached shell as offline fallback
    event.respondWith(
      fetch(req).then(function(res){
        if (res && res.ok && url.pathname === '/'){ var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put('/', copy); }); }
        return res;
      }).catch(function(){
        return caches.match('/').then(function(hit){ return hit || Response.error(); });
      })
    );
    return;
  }
  if (SHELL.indexOf(url.pathname) !== -1){
    // icons/manifest: cache-first, refreshed in the background
    event.respondWith(
      caches.match(req).then(function(hit){
        var net = fetch(req).then(function(res){
          if (res && res.ok){ var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
          return res;
        }).catch(function(){ return hit; });
        return hit || net;
      })
    );
  }
});

self.addEventListener('push', function(event){
  var data = {};
  try{ data = event.data ? event.data.json() : {}; } catch(e){ data = { title: 'ROOT-Ahead', body: event.data ? event.data.text() : '' }; }

  var title = data.title || 'ROOT-Ahead';
  var options = {
    body: data.body || 'Someone opened the app.',
    icon: '/icon-192-v2.png',
    badge: '/icon-192-v2.png',
    tag: data.tag || 'rootahead-visit', // visit pings collapse into one; team messages carry their own tag
    renotify: !!data.tag,
    data: { url: data.url || '/' }
  };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    // an open app refreshes itself (e.g. the training plan after a coach update)
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      list.forEach(function(c){ c.postMessage({ type: 'rootahead-push', title: title, body: data.body || '', tag: data.tag || '', url: data.url || '/' }); });
    })
  ]));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  var same = target.indexOf(self.location.origin) === 0;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      var c = null;
      if (same) for (var i = 0; i < list.length; i++){
        if (list[i].url.indexOf(self.location.origin) === 0 && list[i].url.indexOf('/admin') === -1){ c = list[i]; break; }
      }
      if (c) return c.focus().then(function(w){ return (w && w.url !== target && 'navigate' in w) ? w.navigate(target) : w; });
      return clients.openWindow(target);
    })
  );
});
