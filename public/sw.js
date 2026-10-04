// Ludo Cash service worker — শুধু PWA ইনস্টলের জন্য + অফলাইনে সুন্দর বার্তা।
// গেম/ওয়ালেট/সকেট কখনোই ক্যাশ হয় না (টাকার হিসাবে পুরনো ডাটা দেখানো বিপজ্জনক), তাই সবসময় সরাসরি সার্ভার থেকে আসে।
const V = 'ludo-v1', OFFLINE = '/offline.html', ASSETS = [OFFLINE, '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || /^\/(api|socket\.io|admin)/.test(u.pathname)) return;   // এগুলো ব্রাউজার নিজে হ্যান্ডেল করবে
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match(OFFLINE))); return; }
  if (ASSETS.includes(u.pathname)) e.respondWith(caches.match(r).then(m => m || fetch(r)));
});
