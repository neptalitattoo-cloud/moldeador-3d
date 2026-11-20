// Moldeador 3D — service worker. Funciona sin conexión; actualización a petición del usuario.
// Para publicar una versión nueva: python3 herramientas/version_sw.py N  (cambia ?v=N y la caché a la vez).
const V = 'moldeador-v8';
const FILES = [
  './',
  'index.html',
  'css/app.css?v=8',
  'js/app.js?v=8',
  'js/core.js?v=8',
  'js/fit-worker.js?v=8',
  'js/view2d.js?v=8',
  'js/editor.js?v=8',
  'js/foto.js?v=8',
  'js/parts.js?v=8',
  'vendor/three.module.min.js?v=8',
  'vendor/OrbitControls.js?v=8',
  'vendor/fflate.js?v=8',
  'data/brazo_derecho.json?v=8',
  'data/brazo_derecho.bin?v=8',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];
const NAV_TIMEOUT_MS = 3000;
const SHELL = new URL('./', self.registration.scope).href;

self.addEventListener('install', e =>
  e.waitUntil(
    (async () => {
      const c = await caches.open(V);
      await c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))); // nunca desde la caché HTTP; falla si algo no es 2xx
      // Las versiones ≤ v4 no sabían mostrar el aviso: si vienen de ahí, se activa directamente.
      const keys = await caches.keys();
      if (keys.some(k => /^moldeador-v[1-4]$/.test(k))) self.skipWaiting();
    })(),
  ),
);
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('moldeador-') && k !== V) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', e => {
  const req = e.request,
    url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    (async () => {
      const c = await caches.open(V);
      if (req.mode === 'navigate') {
        // red primero (los recursos llevan ?v=N, así que no se mezclan versiones); sin red, la copia guardada
        // con un tiempo límite: una wifi que conecta pero no responde no debe impedir abrir la app
        const ctl = new AbortController(),
          timer = setTimeout(() => ctl.abort(), NAV_TIMEOUT_MS);
        try {
          const res = await fetch(req, { cache: 'no-cache', signal: ctl.signal });
          if (res.ok) return res;
        } catch {
          /* sin conexión o demasiado lenta */
        } finally {
          clearTimeout(timer);
        }
        return (await c.match(SHELL)) || (await c.match(req, { ignoreSearch: true })) || Response.error();
      }
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') c.put(req, res.clone()); // nunca guarda 404/500 ni respuestas opacas
      return res;
    })(),
  );
});
