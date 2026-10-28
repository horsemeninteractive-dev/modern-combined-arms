/*
 * Irontide shell worker.
 *
 * The game is a static bundle, so the shell is cached at install and the hashed
 * assets are cached as they are first requested. Navigations go to the network
 * first so a new deployment is picked up, and fall back to the cached document
 * when the player is offline or the host is unreachable.
 */
const VERSION = 'mca-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

/* Filled with the hashed bundle files by tools/build-sw.mjs at build time. */
const BUNDLE_ASSETS = self.__PRECACHE_ASSETS__ || [];

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/insignia.svg',
  '/irontide-mark.svg',
  '/studio-logo.mp4',
  '/audio/menu-theme.mp3',
  '/flags/lithuania.png',
  '/flags/poland.png',
  '/flags/uk.png',
  '/flags/russia.png',
  '/flags/belarus.png',
  '/flags/hungary.png',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  ...BUNDLE_ASSETS,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One by one, and never fatal: a single unreachable asset (a video the
      // host refuses, an icon added later) must not block the whole shell.
      for (const url of SHELL_ASSETS) {
        try {
          await cache.add(url);
        } catch (error) {
          console.warn('MCA shell: could not cache', url, error);
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(async () => {
          // ignoreVary: the host marks assets `Vary: Origin`, and a navigation
          // or module request carries an Origin the precache request did not.
          const cached = await caches.match('/index.html', { ignoreVary: true });
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
        }),
    );
    return;
  }

  // Stale-while-revalidate: the cached copy answers instantly, and the network
  // copy replaces it for the next load. Unhashed shell assets (icons, the engine
  // mark) therefore update without a worker version bump.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          // Never store a 206 partial response: a later range request cannot be
          // answered from one cached chunk, which would break long music tracks.
          if (response.ok && response.status !== 206) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
