// দুটি আসল ব্রাউজার পেজ (দুই খেলোয়াড়) আসল game.html + net.js চালায়; মাঝে সার্ভারের মতো রিলে। পুরো ম্যাচ নিজে নিজে খেলে শেষে দুই বোর্ড মেলায়।
// chaos=true হলে: খেলার মাঝে একজনের পেজ রিলোড (নেট চলে যাওয়া) + সার্ভার-বট/স্কিপ ঢোকানো — রিস্টার্ট/রিকভারি পরীক্ষা।
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const PUB = path.join(__dirname, '..', 'public'), MIME = { html: 'text/html', js: 'text/javascript', png: 'image/png', webmanifest: 'application/manifest+json' };
const INIT = () => {
  const _st = window.setTimeout, _si = window.setInterval; const sc = d => d >= 100 ? d / 30 : d >= 20 ? d / 8 : d; window.setTimeout = (f, d, ...a) => _st(f, sc(d), ...a); window.setInterval = (f, d, ...a) => _si(f, sc(d), ...a);
  window.requestAnimationFrame = f => _st(() => f(performance.now()), 400);   // বোর্ড আঁকা কম (পরীক্ষা দ্রুত করতে), তবু মাঝেমধ্যে আঁকে যাতে আঁকার কোডের এরর ধরা পড়ে
  try { localStorage.setItem('tk', 'x'); } catch (e) { return; } window.__sent = 0; window.__echo = 0; window.__errs = [];
  addEventListener('error', e => window.__errs.push(String(e.message))); addEventListener('unhandledrejection', e => window.__errs.push('rej:' + e.reason));
  const H = {}; window.__recv = (ev, d) => (H[ev] || []).forEach(f => f(d)); const S = { on(ev, f) { (H[ev] = H[ev] || []).push(f); return S; }, emit(ev, d) { if (ev === 'act') window.__sent++; window.__tx(ev, JSON.stringify(d === undefined ? null : d)); }, disconnect() {} };
  window.io = () => { _st(() => window.__recv('connect'), 0); return S; };
  S.on('act', e => { if (e.u === window.__me) window.__echo++; });
  const rnd = n => Math.floor(Math.random() * n);
  window.__drive = () => {
    if (typeof G === 'undefined' || !G || G.phase === 'over' || G.moving) return;
    if (window.__blk && Date.now() < window.__blk.until && G.phase === window.__blk.ph && G.turn === window.__blk.turn) return;
    const me = cur(); if (me.p !== NET.color) return; const bad = G.pl.some(p => p.t.some(x => !Number.isInteger(x) || x < -1 || x > 56)); if (bad) window.__errs.push('টোকেন রেঞ্জের বাইরে ' + JSON.stringify(G.pl.map(p => p.t)));
    const send = a => { window.__blk = { until: Date.now() + 1500, ph: G.phase, turn: G.turn }; NET.act(a); };
    if (G.phase === 'roll') {
      if (me.c.length && Math.random() < .6) { const ks = me.c.filter(k => canUse(me, k)); if (ks.length) { const k = ks[rnd(ks.length)]; let a;
        if (k === 'back3') { const t = targets(me); a = t[rnd(t.length)]; } else if (k === 'fwd1') { const t = fwdCands(me); a = t[rnd(t.length)]; } else if (k === 'shield') { const t = shieldCands(me); a = t[rnd(t.length)]; }
        else if (k === 'setme') a = { val: 1 + rnd(6) }; else { const o = G.pl.filter(x => x !== me && !x.done); a = { opp: o[0], val: 1 + rnd(6) }; }
        return send({ t: 'card', k, a }); } }
      return send({ t: 'roll' }); }
    if (G.phase === 'move') return send({ t: 'move', i: G.mv[rnd(G.mv.length)] });
  };
  window.__tr = []; let lp = ''; setInterval(() => { if (typeof G !== 'undefined' && G) { if (window.__blk && (G.phase !== window.__blk.ph || G.turn !== window.__blk.turn || G.moving)) window.__blk = null; const k = G.phase + G.turn + (G.moving ? 'm' : ''); if (k !== lp) { lp = k; window.__tr.push([Math.round(performance.now()), G.phase, G.turn, G.dice]); } } }, 2);
  setInterval(() => { try { window.__drive(); } catch (e) { window.__errs.push('drive:' + e.message); } }, 4);
};
async function runGame(browser, chaos, label) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } }), room = 'R' + crypto.randomBytes(3).toString('hex');
  const R = { log: [], rnd: [], first: {}, last: undefined, results: {}, off: {}, pages: [], bots: new Set() };
  const users = [{ id: 1, color: 0, username: 'রাফি' }, { id: 2, color: 2, username: 'মিম' }];
  const send = (i, ev, d) => R.pages[i] && R.pages[i].evaluate(([e, x]) => window.__recv(e, x), [ev, d]).catch(() => {});
  const bcast = (ev, d) => [0, 1].forEach(i => send(i, ev, d));
  const push = (u, a) => { const e = { seq: R.log.length + 1, u, a }; R.log.push(e); bcast('act', e); };
  async function onTx(i, ev, d) {
    if (ev === 'enterRoom') { if (!d.resync && R.bots.has(users[i].color)) { R.bots.delete(users[i].color); bcast('botMode', { c: users[i].color, on: false }); } R.off[i] = false;
      return send(i, 'roomState', { roomId: room, bet: 50, fee: 5, me: users[i].id, log: R.log, seed: 12345, bots: [...R.bots], players: users.map(u => ({ ...u, avatar: null })) }); }
    if (ev === 'rnd') { if (d.k === R.rnd.length) { let v = crypto.randomInt(d.n); if (d.n === 6 && R.last !== undefined) { const f = R.first[R.last] || (R.first[R.last] = { n: 0, six: false, at: 1 + crypto.randomInt(4) }); if (!f.six) { f.n++; if (v === 5) f.six = true; else if (f.n >= f.at) { v = 5; f.six = true; } } } R.rnd.push({ n: d.n, v }); }
      if (R.rnd[d.k]) bcast('rndVal', { k: d.k, v: R.rnd[d.k].v }); return; }
    if (ev === 'act') { if (d.a.t === 'roll') R.last = users[i].color; return push(users[i].id, d.a); }
    if (ev === 'turn') { if (chaos && R.off[1 - i] && d.seq === R.log.length) { const c = users[1 - i].color; if (!R.strike) R.strike = {}; if (!R.strike[c]) { R.strike[c] = 1; push(0, { t: 'skip', c }); } else { R.bots.add(c); bcast('botMode', { c, on: true }); R.last = c; push(0, { t: 'bot', c }); } } return; }
    if (ev === 'result') { R.results[i] = d.winnerColor; return; }
  }
  const pages = [];
  for (const i of [0, 1]) {
    const pg = await ctx.newPage(); pages.push(pg); R.pages[i] = pg; pg.on('pageerror', e => (R.perr = R.perr || []).push(String(e)));
    await pg.exposeFunction('__tx', (ev, s) => onTx(i, ev, JSON.parse(s)));
    await pg.addInitScript(INIT); await pg.addInitScript(`window.__me=${users[i].id}`);
    await pg.route('http://ludo.test/**', r => { const u = new URL(r.request().url()); let p = u.pathname; if (p.startsWith('/socket.io')) return r.fulfill({ body: '', contentType: 'text/javascript' });
      const f = path.join(PUB, p === '/' ? 'index.html' : p); if (fs.existsSync(f)) return r.fulfill({ body: fs.readFileSync(f), contentType: MIME[f.split('.').pop()] || 'text/plain' }); r.fulfill({ status: 404, body: '' }); });
    await pg.goto(`http://ludo.test/game.html?room=${room}`);
  }
  const t0 = Date.now(); let reloaded = 0;
  while (Date.now() - t0 < (+process.env.TMO || 150000)) {
    const st = await Promise.all(pages.map(p => p.evaluate(() => (typeof G !== 'undefined' && G) ? G.phase : 'x').catch(() => 'x')));
    if (st.every(s => s === 'over')) break;
    if (chaos && reloaded < 3 && Math.random() < .05 && R.log.length > 20 && R.log.length < 400) { const i = reloaded % 2; R.off[i] = true; reloaded++; await pages[i].goto('about:blank'); await new Promise(r => setTimeout(r, 1500)); await pages[i].goto(`http://ludo.test/game.html?room=${room}`); }
    if ((Date.now() - t0) % 5000 < 160) { console.log('     … লগ', R.log.length, st.join('/')); if (process.env.DBG) console.log('       t=', JSON.stringify(await pages[0].evaluate(() => G.pl.map(p => p.t)).catch(() => null))); }
    await new Promise(r => setTimeout(r, 150));
  }
  const snap = pages.map(p => p.evaluate(() => ({ phase: G.phase, rank: G.rank, t: G.pl.map(x => x.t), c: G.pl.map(x => x.c), sh: G.pl.map(x => x.sh), force: G.pl.map(x => x.force), caps: G.pl.map(x => x.caps), errs: window.__errs })));
  const [s0, s1] = await Promise.all(snap); if (process.env.DBG === '2') console.log('TRANS', JSON.stringify(await pages[0].evaluate(() => window.__tr.slice(5, 45)))); await ctx.close();
  const out = []; const ok = (c, m) => out.push([c, m]);
  ok(s0.phase === 'over' && s1.phase === 'over', `${label}: দুই বোর্ডেই খেলা শেষ হয়েছে (লগ ${R.log.length} অ্যাকশন)`);
  ok(JSON.stringify(s0) === JSON.stringify({ ...s1, errs: s0.errs }) || JSON.stringify([s0.rank, s0.t, s0.c, s0.sh, s0.caps]) === JSON.stringify([s1.rank, s1.t, s1.c, s1.sh, s1.caps]), `${label}: দুই খেলোয়াড়ের বোর্ড/কার্ড/র‍্যাঙ্ক হুবহু এক (সিঙ্ক ঠিক)`);
  if (process.env.DBG) console.log('     STATE', JSON.stringify({ t: s0.t, c: s0.c, force: s0.force, sh: s0.sh, rank: s0.rank, phase: s0.phase, caps: s0.caps }));
  if (process.env.DBG) console.log('     ERRS', JSON.stringify(s0.errs), 'TAIL', JSON.stringify(R.log.slice(-6)));
  const w = s0.rank[0]; ok(s0.t[w === 0 ? 0 : 1].every(x => x === 56), `${label}: বিজয়ীর ৪টি ঘুঁটিই ঘরে`); ok(R.results[0] === w && R.results[1] === w, `${label}: দুজনেই একই বিজয়ী (${w}) সার্ভারকে জানিয়েছে`);
  ok(!(s0.errs.length || s1.errs.length || (R.perr || []).length), `${label}: কোনো জাভাস্ক্রিপ্ট এরর নেই ${JSON.stringify([...s0.errs, ...s1.errs, ...(R.perr || [])]).slice(0, 300)}`);
  return { out, log: R.log.length, kinds: R.log.reduce((m, e) => (m[e.a.t] = (m[e.a.t] || 0) + 1, m), {}) };
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] }); let fail = 0;
  const N = +process.argv[2] || 1, MODE = process.argv[3] || 'both';
  for (const [chaos, label, n] of [[false, 'সাধারণ', N], [true, 'বিপর্যয়-মোড (রিলোড+বট)', N]].filter(x => MODE === 'both' || (MODE === 'chaos') === x[0])) for (let k = 1; k <= n; k++) {
    const r = await runGame(browser, chaos, `${label} #${k}`); r.out.forEach(([c, m]) => { console.log(c ? '  ✔' : '  ❌', m); if (!c) fail++; }); console.log('     অ্যাকশন:', JSON.stringify(r.kinds)); }
  await browser.close(); console.log(fail ? `ব্রাউজার টেস্ট: ${fail} ফেল` : 'ব্রাউজার টেস্ট: সব পাস'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ব্রাউজার টেস্ট ক্র্যাশ:', e); process.exit(2); });
