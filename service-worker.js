// Guarda la interfaz para que abra rápido y sin red (los datos siempre llegan por MQTT)
const CACHE = 'clima-ctrl-v2'
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'icon.svg',
  'icon-180.png', 'icon-192.png', 'icon-512.png',
  'https://unpkg.com/mqtt@5.3.5/dist/mqtt.min.js']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))))
  self.clients.claim()
})

// Red primero; si no hay red, usa la copia guardada
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r })
      .catch(() => caches.match(e.request))
  )
})
