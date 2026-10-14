// Handles two things: showing a notification when a push message arrives
// (even if the app itself isn't open), and focusing/opening the app when
// that notification is tapped. Doesn't do anything with routing/caching —
// this app doesn't need offline support, just the push-notification plumbing.

self.addEventListener('push', function(event){
  var data = {};
  try{ data = event.data ? event.data.json() : {}; } catch(e){ data = { title: 'ROOT-Ahead', body: event.data ? event.data.text() : '' }; }

  var title = data.title || 'ROOT-Ahead';
  var options = {
    body: data.body || 'Someone opened the app.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'rootahead-visit', // collapses rapid repeat notifications into one instead of stacking
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      for (var i = 0; i < clientList.length; i++){
        if ('focus' in clientList[i]) return clientList[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
