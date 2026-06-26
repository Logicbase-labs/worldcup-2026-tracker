// Simple network-first service worker so the installed app opens offline after
// a first visit. Network-first avoids serving stale files after a new deploy.
const CACHE = 'wc2026-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./'))),
  )
})

// ── Push notifications ──────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { title: 'World Cup 2026', body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(data.title || 'World Cup 2026', {
    body: data.body || '',
    tag: data.tag,
    renotify: true,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: data.url || './' },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || './'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes('worldcup-2026-tracker') && 'focus' in c) return c.focus() }
    return self.clients.openWindow(url)
  }))
})
