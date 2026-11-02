/* Lift Log shell. The install key stays in this device's cache and in the manifest fragment.
   It is never added to a query string. Bump CACHE when shipping asset changes. */
const CACHE = 'liftlog-shell-v5';
const INSTALL_CACHE = 'liftlog-install';
const ASSETS = [
  './index.html',
  './styles.css',
  './model.js',
  './crypto.js',
  './app.js',
  './manifest.webmanifest',
  './program.enc.json',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

let installKey = '';

function installRequest() {
  return new Request(new URL('__liftlog_install_key', self.registration.scope));
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== INSTALL_CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'install-key') return;
  const key = typeof data.key === 'string' ? data.key : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return;
  event.waitUntil((async () => {
    installKey = key;
    const cache = await caches.open(INSTALL_CACHE);
    await cache.put(installRequest(), new Response(key));
    if (event.ports[0]) event.ports[0].postMessage({ ok: true });
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/__liftlog_install_key')) {
    event.respondWith(new Response('', { status: 404 }));
    return;
  }
  if (url.pathname.endsWith('/manifest.webmanifest') && !url.searchParams.has('base')) {
    event.respondWith(dynamicManifest());
    return;
  }
  event.respondWith(fromNetworkThenCache(request));
});

async function loadInstallKey() {
  if (installKey) return installKey;
  try {
    const cache = await caches.open(INSTALL_CACHE);
    const stored = await cache.match(installRequest());
    const text = stored ? (await stored.text()).trim() : '';
    if (/^[A-Za-z0-9_-]{43}$/.test(text)) installKey = text;
  } catch {
    /* a cache miss just leaves the static start_url in place */
  }
  return installKey;
}

async function dynamicManifest() {
  let base = {
    id: './',
    name: 'Lift Log',
    short_name: 'Lift Log',
    start_url: './',
    scope: './',
    display: 'standalone',
  };
  try {
    const response = await fetch(new URL('manifest.webmanifest?base=1', self.registration.scope));
    if (response.ok) base = await response.json();
  } catch {
    /* keep the small fallback */
  }
  const key = await loadInstallKey();
  base.id = './';
  base.scope = './';
  if (key) base.start_url = `index.html#k=${key}`;
  return new Response(JSON.stringify(base), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'no-store',
    },
  });
}

async function fromNetworkThenCache(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      try {
        await cache.put(request, fresh.clone());
      } catch {
        /* quota or a non-cacheable response should not break the page */
      }
    }
    return fresh;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html') || await cache.match('index.html');
      if (fallback) return fallback;
    }
    throw error;
  }
}
