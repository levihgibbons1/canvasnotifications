/* Dispatch service worker: shows browser push notifications and focuses the app on click. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Dispatch', body: '', url: '/', tag: undefined };
  try { data = { ...data, ...event.data.json() }; } catch { data.body = event.data ? event.data.text() : ''; }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    data: { url: data.url },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    renotify: Boolean(data.tag),
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const target = url.startsWith('http') ? url : new URL(url, self.location.origin).href;
    for (const c of list) { if ('focus' in c) { c.focus(); if (!url.startsWith('http')) c.navigate(target); return; } }
    return self.clients.openWindow(target);
  }));
});
