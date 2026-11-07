/* Service worker de Achero Plant 3D. El build (vite.config.ts) completa la versión y la lista de archivos. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `achero-${VERSION}`;
const SHARE_CACHE = 'achero-shared';

self.addEventListener('install', (event) => {
  // Se baja todo lo necesario para trabajar sin señal; si falta un archivo no se frena el resto
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)))
    )
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('achero') && n !== CACHE && n !== SHARE_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/** Archivos compartidos desde otra app (WhatsApp, Drive, Archivos) */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f) => typeof f !== 'string');
    const cache = await caches.open(SHARE_CACHE);
    let i = 0;
    for (const file of files) {
      const headers = { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) };
      await cache.put(`/__shared/${Date.now()}-${i++}`, new Response(file, { headers }));
    }
  } catch {
    // Se abre la app igual
  }
  return Response.redirect('/?shared=1', 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;

  // Navegación: la app guardada (abre al instante y sin señal); la versión nueva llega con el próximo service worker
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html', { cacheName: CACHE }).then((hit) => hit || fetch(request).catch(() => caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
    )
  );
});
