// Funciona sin conexión una vez cargado: guarda todos los archivos en caché.
const V = 'moldeador-v3';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/core.js', 'js/parts.js', 'vendor/three.module.min.js', 'vendor/OrbitControls.js',
  'vendor/fflate.js', 'data/brazo_derecho.json', 'data/brazo_derecho.bin', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => { if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); return res; }))); });
