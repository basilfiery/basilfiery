// Service worker: recebe as notificações push da equipe (pedido novo, pedido pronto, chamado).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data && e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.titulo || 'BasilFiery', {
      body: d.corpo || '',
      tag: d.tag,
      renotify: true,
      requireInteraction: true,
      icon: '/icone-192.png',
      badge: '/icone-192.png',
      vibrate: [200, 100, 200, 100, 300],
      data: { url: d.url || '/garcom' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // O app do garçom fica em /g (volta sozinho para o restaurante usado por último)
  const pedida = (e.notification.data && e.notification.data.url) || '/g';
  const url = pedida === '/garcom' ? '/g' : pedida;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) {
        if (new URL(j.url).pathname.startsWith(url) && 'focus' in j) return j.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
