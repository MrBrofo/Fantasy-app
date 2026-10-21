// Shows the alerts fantasy.mjs sends, and opens the app when one is tapped.
self.addEventListener('push', ev => {
  const m = ev.data ? ev.data.json() : { title: 'Fantasy', body: '' };
  ev.waitUntil(self.registration.showNotification(m.title, { body: m.body, tag: m.tag, icon: 'icon-192.png', data: { url: m.url || './' } }));
});
self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  ev.waitUntil(clients.matchAll({ type: 'window' }).then(ws => ws.length ? ws[0].focus() : clients.openWindow(ev.notification.data.url)));
});
