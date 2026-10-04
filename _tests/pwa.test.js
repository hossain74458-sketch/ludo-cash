// PWA পরীক্ষা: আসল Chromium-এ http://localhost থেকে পেজ খুলে manifest/service worker/Install বোতাম যাচাই
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public'), MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', png: 'image/png', webmanifest: 'application/manifest+json' };
const srv = http.createServer((q, r) => { const p = q.url.split('?')[0], f = path.join(PUB, p === '/' ? 'index.html' : p);
  if (p.startsWith('/api/config')) { r.setHeader('content-type', 'application/json'); return r.end('{"stakes":[10,20],"feePct":5,"minDep":10,"minWd":20}'); }
  if (p.startsWith('/socket.io')) { r.setHeader('content-type', 'text/javascript'); return r.end(''); }
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { r.setHeader('content-type', MIME[f.split('.').pop()] || 'text/plain'); return r.end(fs.readFileSync(f)); } r.statusCode = 404; r.end(); });
let fail = 0; const ok = (c, m) => { console.log(c ? '  ✔' : '  ❌', m); if (!c) fail++; };
srv.listen(0, async () => {
  const base = 'http://localhost:' + srv.address().port, br = await chromium.launch({ headless: true });
  const ctx = await br.newContext({ viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true }), pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(base + '/'); await pg.waitForTimeout(800);
  ok(await pg.locator('#installBtn').isVisible(), '"Install App" বোতাম দেখা যাচ্ছে'); ok((await pg.locator('#installBtn').innerText()).includes('Install App'), 'বোতামের লেখা: Install App');
  const mf = await pg.evaluate(async () => { const h = document.querySelector('link[rel=manifest]').href; const j = await (await fetch(h)).json(); return j; });
  ok(mf.display === 'standalone' && mf.icons.some(i => i.sizes === '192x192') && mf.icons.some(i => i.sizes === '512x512') && mf.icons.some(i => i.purpose === 'maskable'), 'manifest: standalone + ১৯২/৫১২/maskable আইকন');
  for (const i of mf.icons) { const r = await pg.evaluate(async u => { const x = await fetch(u); return [x.status, (await x.blob()).type]; }, i.src); ok(r[0] === 200 && r[1] === 'image/png', 'আইকন লোড হয়: ' + i.src); }
  const sw = await pg.evaluate(async () => { const r = await navigator.serviceWorker.ready; return [!!r.active, r.scope]; }); ok(sw[0], 'service worker চালু (scope ' + sw[1] + ')');
  await pg.locator('#installBtn').click(); ok(await pg.locator('#iosHelp').isVisible(), 'ইনস্টল ইভেন্ট না থাকলে ধাপে ধাপে নির্দেশনা দেখায়'); await pg.screenshot({ path: '/tmp/pwa-help.png' }); await pg.locator('#iosHelp button').click();
  // beforeinstallprompt নকল করে আসল ফ্লো
  const called = await pg.evaluate(async () => { let c = 0; const e = new Event('beforeinstallprompt'); e.prompt = () => { c++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e); document.getElementById('installBtn').click(); await new Promise(r => setTimeout(r, 100)); return c; });
  ok(called === 1, 'ব্রাউজারের ইনস্টল প্রম্পট বোতাম চাপলে চালু হয়');
  await pg.evaluate(() => dispatchEvent(new Event('appinstalled'))); ok(!(await pg.locator('#installBtn').isVisible()), 'ইনস্টলের পর বোতাম লুকায়');
  const off = await pg.evaluate(async () => { const c = await caches.open('ludo-v1'); return (await c.keys()).map(k => new URL(k.url).pathname); }); ok(off.includes('/offline.html'), 'অফলাইন পেজ ক্যাশে আছে');
  const stand = await ctx.newPage(); await stand.emulateMedia({}); await stand.addInitScript(() => { const mm = matchMedia.bind(window); window.matchMedia = q => /standalone/.test(q) ? { matches: true, addEventListener() {}, removeEventListener() {} } : mm(q); }); await stand.goto(base + '/'); await stand.waitForTimeout(300);
  ok(!(await stand.locator('#installBtn').isVisible()), 'অ্যাপ হিসেবে খুললে (standalone) Install বোতাম থাকে না');
  const pg2 = await ctx.newPage(); await pg2.goto(base + '/'); await pg2.screenshot({ path: '/tmp/pwa-home.png' });
  ok(!errs.length, 'কোনো জাভাস্ক্রিপ্ট এরর নেই ' + JSON.stringify(errs));
  await br.close(); srv.close(); console.log(fail ? `PWA টেস্ট: ${fail} ফেল` : 'PWA টেস্ট: সব পাস'); process.exit(fail ? 1 : 0);
});
