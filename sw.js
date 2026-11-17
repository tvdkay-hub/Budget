// Keeps a copy of the app so it opens with no signal. Newest page first; the copy is used when offline, or when the network is too slow (4 s).
const CACHE = 'budget-pwa-v4';
const FILES = ['app.html', 'money.js', 'app.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const SLOW_MS = 4000;
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim())); });
const cached = req => caches.match(req, {ignoreSearch: true}).then(m => m || (req.mode === 'navigate' ? caches.match('app.html') : null));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Google sign-in / Drive go straight through
  if (!FILES.some(f => u.pathname.endsWith('/' + f))) return; // phone page (index.html) and everything else untouched
  let usedCopy = false;
  const net = fetch(e.request, {cache: 'no-cache'}).then(r => {
    if (r.ok) {
      const c = r.clone();
      caches.open(CACHE).then(x => x.put(e.request, c));
      // The saved copy was shown because the network was slow: tell the page a newer one has now arrived
      if (usedCopy && e.request.mode === 'navigate') self.clients.matchAll({type: 'window'}).then(cs => cs.forEach(cl => cl.postMessage({type: 'updated'})));
    }
    return r;
  });
  const slow = new Promise(res => setTimeout(res, SLOW_MS)).then(() => cached(e.request)).then(m => { if (!m) return net; usedCopy = true; return m; });
  e.respondWith(Promise.race([net.catch(() => cached(e.request).then(m => m || Response.error())), slow]));
  e.waitUntil(net.catch(() => {}));
});
