const phase = process.argv[2], path = require('path'), fs = require('fs');
require(path.join(__dirname, '..', 'server.js'));
const app = globalThis.__app, io = globalThis.__io, sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌ FAIL:', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (পেলাম ${JSON.stringify(a)}, চাই ${JSON.stringify(b)})`);
const adm = { authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64'), 'x-requested-with': 'ludo-admin' };
const post = (u, body, tk, ip) => app.inject('POST', u, { body, headers: tk ? { authorization: 'Bearer ' + tk } : {}, ip });
const get = (u, tk) => app.inject('GET', u, { headers: tk ? { authorization: 'Bearer ' + tk } : {} });
const A = (method, u) => app.inject(method, u, { headers: adm });
let trx = phase === 'crash1' ? 900000 : 100000, num = phase === 'crash1' ? 500 : 0;
async function user(name) {
  const r = await post('/api/enter', { username: name + '_' + (10000 + (++num)), password: 'secret1', fresh: true }, null, '9.9.' + num + '.1');
  ok(r.status === 200 && r.body.token, 'রেজিস্টার ' + name); return { id: r.body.user.id, tk: r.body.token, name: r.body.user.username };
}
async function fund(u, amt) {
  const d = await post('/api/deposit', { payment_method: 'bKash Personal', sender_number: '01711111111', amount: amt, transaction_id: 'TRX' + (++trx) }, u.tk);
  ok(d.status === 200, 'জমার আবেদন'); const ap = await A('POST', `/admin/api/tx/${d.body.id}/approve`); ok(ap.status === 200, 'অ্যাডমিন অ্যাপ্রুভ');
}
const bal = async u => (await get('/api/me', u.tk)).body.balance;
const dbq = sql => { const D = require('better-sqlite3'); const db = new D(path.join(process.env.DATA_DIR, 'ludo.db')); return db; };
const CL = []; const bye = () => { CL.splice(0).forEach(c => c.disconnect()); };
async function play(a, b, stake) {      // দুজনকে ম্যাচে ঢোকায়, রুম ফেরত দেয়
  const ca = io.connect(a.tk), cb = io.connect(b.tk); CL.push(ca, cb);
  ca.emit('joinQueue', { userId: a.id, betAmount: stake }); cb.emit('joinQueue', { userId: b.id, betAmount: stake });
  const m = ca.last('matchStart'); ok(!!m && !!cb.last('matchStart'), 'ম্যাচ শুরু হয়েছে');
  ca.emit('enterRoom', { roomId: m.roomId }); cb.emit('enterRoom', { roomId: m.roomId });
  return { ca, cb, roomId: m.roomId, colA: m.myColor, colB: cb.last('matchStart').myColor };
}

(async () => {
  if (phase === 'crash1') {
    const a = await user('cr1'), b = await user('cr2'); await fund(a, 100); await fund(b, 100);
    await play(a, b, 50); eq(await bal(a), 50, 'ম্যাচ চলাকালীন ৳50 লক'); fs.writeFileSync(path.join(process.env.DATA_DIR, 'crash.json'), JSON.stringify({ a: a.id, b: b.id }));
    process.kill(process.pid, 'SIGKILL'); return;
  }
  if (phase === 'crash2') {
    const { a, b } = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'crash.json'))); const db = dbq();
    eq([db.prepare('SELECT balance FROM users WHERE id=?').pluck().get(a), db.prepare('SELECT balance FROM users WHERE id=?').pluck().get(b)], [100, 100], 'ক্র্যাশের পর রিস্টার্টে দুজনের ৳100 ফেরত এসেছে (ব্যালেন্স হারায়নি)');
    eq(db.prepare("SELECT COUNT(*) FROM matches WHERE status='ongoing'").pluck().get(), 0, 'ongoing ম্যাচ আর নেই');
    console.log(`  crash-recovery: ✔ ${pass} পাস, ${fail} ফেল`); process.exit(fail ? 1 : 0);
  }
  // ───────── main ─────────
  console.log('▶ কনফিগ ও ন্যূনতম উত্তোলন');
  const cfg = (await get('/api/config')).body; eq(cfg.minWd, 20, 'config.minWd=20'); eq(cfg.stakes, [10, 20, 30, 50, 100, 500], 'stakes');
  const u1 = await user('rafi'), u2 = await user('mim'), u3 = await user('sumon');
  console.log('▶ লগইন/পাসওয়ার্ড'); 
  eq((await post('/api/enter', { username: u1.name, password: 'wrongpw' })).status, 401, 'ভুল পাসওয়ার্ড → 401');
  eq((await post('/api/enter', { username: u1.name, password: 'secret1' })).status, 200, 'সঠিক পাসওয়ার্ডে লগইন');
  eq((await post('/api/enter', { username: 'ghost_12345', password: 'secret1' })).status, 404, 'অচেনা ইউজার → 404');
  eq((await post('/api/enter', { username: u1.name, password: 'abc', fresh: true })).status, 400, 'ছোট পাসওয়ার্ড → 400');
  eq((await post('/api/enter', { username: u1.name, password: 'secret1', fresh: true })).status, 409, 'একই ইউজারনেম → 409');
  eq((await get('/api/me')).status, 401, 'টোকেন ছাড়া /api/me → 401');
  console.log('▶ প্রক্সির পেছনে ১২ জন আলাদা ইউজার (IP আলাদা) আটকাবে না');
  let blocked = 0; for (let i = 0; i < 12; i++) { const r = await app.inject('POST', '/api/enter', { body: { username: 'z' + i + '_' + (20000 + i), password: 'secret1', fresh: true }, headers: { 'x-forwarded-for': `5.5.5.${i}` }, ip: '10.0.0.1' }); if (r.status === 429) blocked++; }
  eq(blocked, 0, 'আলাদা IP-র ইউজার ব্লক হয়নি');
  let t429 = 0; for (let i = 0; i < 14; i++) { const r = await post('/api/enter', { username: u1.name, password: 'nope123' }, null, '7.7.7.7'); if (r.status === 429) t429++; }
  ok(t429 >= 3, 'একই IP থেকে বারবার ভুল চেষ্টা থামে (429)');
  console.log('▶ অ্যাডমিন সুরক্ষা');
  eq((await app.inject('GET', '/admin/api/overview')).status, 401, 'পাসওয়ার্ড ছাড়া অ্যাডমিন → 401');
  eq((await app.inject('GET', '/admin/api/overview', { headers: { authorization: 'Basic ' + Buffer.from('admin:bad').toString('base64') }, ip: '3.3.3.3' })).status, 401, 'ভুল অ্যাডমিন পাসওয়ার্ড → 401');
  eq((await A('GET', '/admin/api/overview')).status, 200, 'সঠিক অ্যাডমিন → 200');
  eq((await app.inject('POST', '/admin/api/tx/1/approve', { headers: { authorization: adm.authorization } })).status, 403, 'অ্যাডমিন POST-এ নিজস্ব হেডার ছাড়া → 403 (CSRF)');
  { const v = await user('lock'); let last; for (let i = 0; i < 11; i++) last = await post('/api/enter', { username: v.name, password: 'wrong99' }, null, '8.8.' + i + '.8'); eq(last.status, 429, 'একই অ্যাকাউন্টে ১০+ ভুল পাসওয়ার্ড (আলাদা আইপি) → 429');
    const w = await post('/api/enter', { username: 'weak_' + (60000 + (++num)), password: '123456', fresh: true }, null, '8.9.9.9'); eq(w.status, 400, 'সহজ পাসওয়ার্ডে নতুন অ্যাকাউন্ট হয় না'); }
  { const v = await user('cap'); let st = []; for (let i = 0; i < 6; i++) st.push((await post('/api/deposit', { payment_method: 'bKash Personal', sender_number: '01711111111', amount: 10, transaction_id: 'CAPTRX0' + i }, v.tk)).status); eq(st, [200, 200, 200, 200, 200, 429], 'একজনের সর্বোচ্চ ৫টি অপেক্ষমাণ জমা'); }
  eq((await app.inject('GET', '/server.js')).status, 404, 'server.js ওয়েবে পাওয়া যায় না'); eq((await app.inject('GET', '/ludo.db')).status, 404, 'ludo.db ওয়েবে পাওয়া যায় না');
  eq((await app.inject('GET', '/.jwt_secret')).status, 404, '.jwt_secret ওয়েবে পাওয়া যায় না'); eq((await app.inject('GET', '/admin.html')).status, 404, 'admin.html সরাসরি খোলা যায় না');
  ok((await app.inject('GET', '/manifest.webmanifest')).status === 200 && (await app.inject('GET', '/sw.js')).status === 200 && (await app.inject('GET', '/icons/icon-512.png')).status === 200, 'PWA ফাইল (manifest, sw.js, icon) সার্ভ হচ্ছে');
  eq((await get('/healthz')).body, { ok: true }, '/healthz');
  console.log('▶ জমা');
  eq((await post('/api/deposit', { payment_method: 'bKash Personal', sender_number: '01711111111', amount: 9, transaction_id: 'TRXABC123' }, u1.tk)).status, 400, '৳9 জমা → ব্যর্থ');
  await fund(u1, 100); eq(await bal(u1), 100, 'অ্যাপ্রুভের পর ব্যালেন্স ৳100');
  const dd = await post('/api/deposit', { payment_method: 'bKash Personal', sender_number: '01711111111', amount: 50, transaction_id: 'TRX100001' }, u2.tk); eq(dd.status, 409, 'একই TrxID দুইবার → 409');
  const rj = await post('/api/deposit', { payment_method: 'Nagad Agent', sender_number: '01811111111', amount: 40, transaction_id: 'REJ1234567' }, u2.tk); await A('POST', `/admin/api/tx/${rj.body.id}/reject`); eq(await bal(u2), 0, 'রিজেক্ট করা জমায় ব্যালেন্স বাড়েনি');
  eq((await A('POST', `/admin/api/tx/${rj.body.id}/approve`)).status, 404, 'রিজেক্টের পর আবার অ্যাপ্রুভ করা যায় না');
  await fund(u2, 100); await fund(u3, 20);
  console.log('▶ উত্তোলন (ন্যূনতম ৳20)');
  eq((await post('/api/withdraw', { amount: 19, recipient_number: '01911111111', payment_method: 'bKash' }, u3.tk)).status, 400, '৳19 তোলা যায় না');
  eq((await post('/api/withdraw', { amount: 21, recipient_number: '01911111111', payment_method: 'bKash' }, u3.tk)).status, 400, 'ব্যালেন্সের (৳20) বেশি তোলা যায় না');
  const w = await post('/api/withdraw', { amount: 20, recipient_number: '01911111111', payment_method: 'bKash' }, u3.tk); eq(w.status, 200, '৳20 তোলা যায়'); eq(await bal(u3), 0, 'আবেদনেই ব্যালেন্স কাটা');
  await A('POST', `/admin/api/tx/${w.body.id}/reject`); eq(await bal(u3), 20, 'বাতিল হলে ৳20 ফেরত');
  const w2 = await post('/api/withdraw', { amount: 20, recipient_number: '01911111111', payment_method: 'Nagad' }, u3.tk); await A('POST', `/admin/api/tx/${w2.body.id}/approve`); eq(await bal(u3), 0, 'পেইড হলে ব্যালেন্স ০ থাকে (দুবার কাটে না)');
  eq((await A('POST', `/admin/api/tx/${w2.body.id}/reject`)).status, 404, 'পেইডের পর রিজেক্ট করে টাকা ফেরানো যায় না');
  eq((await post('/api/withdraw', { amount: 20, recipient_number: '123', payment_method: 'bKash' }, u1.tk)).status, 400, 'ভুল নাম্বারে তোলা যায় না');
  console.log('▶ ম্যাচ: জয় → পেআউট ও ৫% ফি');
  let g = await play(u1, u2, 50); eq([await bal(u1), await bal(u2)], [50, 50], 'এন্ট্রি ৳50 করে লক');
    g.ca.emit('rnd', { roomId: g.roomId, k: 0, n: 6 }); ok(g.ca.last('rndVal') && g.ca.last('rndVal').k === 0, 'সার্ভার থেকে পাশার মান'); const v0 = g.ca.last('rndVal').v;
  g.cb.emit('rnd', { roomId: g.roomId, k: 0, n: 6 }); eq(g.cb.last('rndVal').v, v0, 'দুজন একই পাশার মান পায়');
  const nR = g.ca.all('rndVal').length; g.ca.emit('rnd', { roomId: g.roomId, k: 5, n: 6 }); eq(g.ca.all('rndVal').length, nR, 'ক্রম ভেঙে (k=5) র‍্যান্ডম চাওয়া যায় না'); g.ca.emit('rnd', { roomId: g.roomId, k: 1, n: 6 }); ok(g.ca.all('rndVal').length === nR + 1, 'পরের ক্রমিক (k=1) চাওয়া যায়');
  g.ca.emit('act', { roomId: g.roomId, a: { t: 'roll' } }); g.ca.emit('act', { roomId: g.roomId, a: { t: 'move', i: 9 } }); g.ca.emit('act', { roomId: g.roomId, a: { t: 'hack' } });
  eq(g.cb.all('act').length, 1, 'ভুল অ্যাকশন (move i=9, hack) রিলে হয় না');
  const win = g.colA; g.ca.emit('result', { roomId: g.roomId, winnerColor: win }); eq(g.ca.last('gameOver'), undefined, 'এক পক্ষের রিপোর্টে এখনই পেআউট হয় না'); g.cb.emit('result', { roomId: g.roomId, winnerColor: win });
  const go = g.ca.last('gameOver'); ok(go && go.winnerId === u1.id && go.payout === 95 && go.commission === 5, 'পেআউট ৳95, ফি ৳5');
  eq([await bal(u1), await bal(u2)], [145, 50], 'বিজয়ী ৳145, পরাজিত ৳50');
  g.ca.emit('result', { roomId: g.roomId, winnerColor: win }); eq(await bal(u1), 145, 'দ্বিতীয়বার রিপোর্টে আবার টাকা যায় না'); bye();
  console.log('▶ ম্যাচ: দুই পক্ষের ফলাফল না মিললে টাকা আটকে অ্যাডমিন');
  g = await play(u1, u2, 10); g.ca.emit('result', { roomId: g.roomId, winnerColor: g.colA }); g.cb.emit('result', { roomId: g.roomId, winnerColor: g.colA === 0 ? 2 : 0 });
  ok(g.ca.last('disputed') && !g.ca.last('gameOver'), 'ডিসপিউট হয়েছে'); eq([await bal(u1), await bal(u2)], [135, 40], 'ডিসপিউটে ৳10 করে আটকে আছে');
  let dsp = (await A('GET', '/admin/api/disputes')).body; eq(dsp.length, 1, 'অ্যাডমিন তালিকায় ১টি ডিসপিউট');
  eq((await A('POST', `/admin/api/dispute/${dsp[0].room_id}/refund`)).status, 200, 'রিফান্ড'); eq([await bal(u1), await bal(u2)], [145, 50], 'রিফান্ডে দুজনের ৳10 ফেরত'); bye();
  eq((await A('POST', `/admin/api/dispute/${dsp[0].room_id}/p1`)).status, 404, 'নিষ্পত্তির পর আবার করা যায় না');
  g = await play(u1, u2, 10); g.ca.emit('result', { roomId: g.roomId, winnerColor: 0 }); g.cb.emit('result', { roomId: g.roomId, winnerColor: 2 });
  const s1 = [await bal(u1), await bal(u2)]; dsp = (await A('GET', '/admin/api/disputes')).body; await A('POST', `/admin/api/dispute/${dsp[0].room_id}/p2`); const p2 = dsp[0].player2_id === u1.id ? 0 : 1, e1 = s1.slice(); e1[p2] += 19; eq([await bal(u1), await bal(u2)], e1, 'অ্যাডমিন P2-কে জেতালে সে ৳19 পায়'); bye();
  console.log('▶ ম্যাচ: গেম ছেড়ে দিলে (resign)');
  const s2 = [await bal(u1), await bal(u2)]; g = await play(u1, u2, 10); g.ca.emit('resign', { roomId: g.roomId }); eq([await bal(u1), await bal(u2)], [s2[0] - 10, s2[1] + 9], 'u1 রিজাইন করলে u2 নিট ৳9 লাভ (৳19 পেল, ৳10 দিয়েছিল)'); bye();
  console.log('▶ ব্যালেন্স কম / ডাবল কিউ / ম্যাচ চলাকালীন');
  const poor = await user('poor'); const cp = io.connect(poor.tk); cp.emit('joinQueue', { userId: poor.id, betAmount: 10 }); ok(cp.last('errorMsg'), 'ব্যালেন্স ছাড়া কিউতে ঢোকা যায় না');
  const cu = io.connect(u1.tk); cu.emit('joinQueue', { userId: u1.id, betAmount: 10 }); cu.emit('joinQueue', { userId: u1.id, betAmount: 20 }); ok(cu.last('errorMsg') && /অপেক্ষায়/.test(cu.last('errorMsg').message), 'একই জন দুবার কিউতে ঢুকতে পারে না');
  cu.emit('joinQueue', { userId: u2.id, betAmount: 20 }); ok(cu.all('errorMsg').length >= 2, 'অন্যের userId দিয়ে কিউ করা যায় না');
  cu.emit('leaveQueue'); cu.disconnect();
  // কিউতে থাকা অবস্থায় টাকা তুলে নিলে ম্যাচ হয় না
  const q1 = io.connect(u1.tk); q1.emit('joinQueue', { userId: u1.id, betAmount: 100 }); const wq = await post('/api/withdraw', { amount: 100, recipient_number: '01911111111', payment_method: 'bKash' }, u1.tk); ok(wq.status === 200 || wq.status === 400, 'কিউতে থাকাকালীন তোলা');
  const q2 = io.connect(u2.tk); q2.emit('joinQueue', { userId: u2.id, betAmount: 100 }); ok(!q2.last('matchStart') || (await bal(u1)) >= 0, 'ব্যালেন্স ঋণাত্মক হয়নি'); q1.disconnect(); q2.emit('leaveQueue'); q2.disconnect();
  console.log('▶ দুজনই অফলাইন → ম্যাচ বাতিল ও টাকা ফেরত');
  bye(); const b1 = await bal(u1), b2 = await bal(u2); const comm0 = (await A('GET', '/admin/api/overview')).body.totalCommission;
  g = await play(u1, u2, 10); bye(); await sleep(900);
  eq([await bal(u1), await bal(u2)], [b1 - 1, b2 - 1], 'দুজনই অফলাইন ম্যাচ বাতিল: ৫% (৳10 → ৳1) কেটে বাকি ফেরত');
  eq((await A('GET', '/admin/api/overview')).body.totalCommission, comm0 + 2, 'কাটা ৫% অ্যাডমিন কমিশনে গেছে');
  console.log('▶ দুজনই অনলাইন কিন্তু কেউ খেলছে না → ৫% কেটে ফেরত ও লবিতে পাঠানো');
  { const c1 = await bal(u1), c2 = await bal(u2); const ig = await play(u1, u2, 10); await sleep(2300);
    eq([await bal(u1), await bal(u2)], [c1 - 1, c2 - 1], 'নিষ্ক্রিয় ম্যাচ বাতিল: ৫% (৳10 → ৳1) কেটে ফেরত');
    ok(ig.ca.last('matchAbandoned') && ig.cb.last('matchAbandoned'), 'দুজনকেই matchAbandoned (লবিতে ফেরত) বার্তা গেছে');
    ig.ca.emit('enterRoom', { roomId: ig.roomId }); const rc = ig.ca.last('roomClosed'); ok(rc && rc.idleFee === 1 && rc.refund === 9, 'পরে ঢুকলে ৫% কাটার তথ্যসহ roomClosed পায়'); bye();
    const keep = await play(u1, u2, 10); for (let i = 0; i < 6; i++) { await sleep(400); keep.ca.emit('back', { roomId: keep.roomId }); }
    ok(!keep.ca.last('matchAbandoned'), 'একজন সক্রিয় থাকলে ম্যাচ বাতিল হয় না'); keep.ca.emit('resign', { roomId: keep.roomId }); await sleep(100); bye(); }
  console.log('▶ একজন ফিরে এলে ম্যাচ চলে'); const b1b = await bal(u1); g = await play(u1, u2, 10); bye(); await sleep(150);
  const back = io.connect(u1.tk); CL.push(back); ok(back.last('matchActive'), 'ফিরলে চলমান ম্যাচে পাঠায়'); await sleep(600); eq(await bal(u1), b1b - 10, 'ফেরার পর ম্যাচ বাতিল হয়নি');
  back.emit('enterRoom', { roomId: g.roomId, resync: false }); ok(back.last('roomState') && Array.isArray(back.last('roomState').log), 'রিস্টার্ট/রিফ্রেশে পুরো লগ ফেরত পায়'); back.emit('resign', { roomId: g.roomId });
  console.log('▶ অ্যাডমিন: ইউজার সার্চ, পাসওয়ার্ড রিকভারি, সাপোর্ট সেটিংস');
  { const pu = await user('vault'), N = encodeURIComponent;
    eq((await app.inject('GET', '/admin/api/users?q=vault')).status, 401, 'অ্যাডমিন ছাড়া ইউজার সার্চ → 401');
    eq((await app.inject('GET', `/admin/api/user/${pu.id}/password`)).status, 401, 'অ্যাডমিন ছাড়া পাসওয়ার্ড দেখা যায় না');
    const sr = (await A('GET', '/admin/api/users?q=' + N('vaul'))).body; ok(sr.length === 1 && sr[0].username === pu.name, 'আংশিক নামে সার্চে ইউজার পাওয়া যায়');
    eq((await A('GET', '/admin/api/users?q=' + N(pu.name))).body[0].id, pu.id, 'পুরো ইউজারনেমে সার্চ');
    eq((await A('GET', '/admin/api/users?q=' + N('%'))).body.length, 0, '% দিয়ে সব ইউজার টেনে আনা যায় না (ওয়াইল্ডকার্ড এস্কেপ)');
    eq((await A('GET', `/admin/api/user/${pu.id}/password`)).body, { password: 'secret1' }, 'অ্যাডমিন ইউজারের পাসওয়ার্ড দেখতে পায়');
    const raw = dbq().prepare('SELECT pw_enc FROM users WHERE id=?').pluck().get(pu.id); ok(raw && !raw.includes('secret1') && raw.startsWith('v1:'), 'ডাটাবেসে পাসওয়ার্ড এনক্রিপ্টেড, সাধারণ লেখা নয়');
    await fund(pu, 50); const dt = (await A('GET', `/admin/api/user/${pu.id}`)).body;
    ok(dt.user.username === pu.name && dt.user.balance === 50 && dt.user.pw_known === true && !('pw_enc' in dt.user) && !('password_hash' in dt.user), 'বিস্তারিতে ব্যালেন্স আছে, পাসওয়ার্ড/হ্যাশ লিক হয় না');
    ok(dt.transactions.some(t => t.type === 'deposit' && t.amount === 50) && dt.totals.deposits === 50 && Array.isArray(dt.matches), 'বিস্তারিতে ট্রানজেকশন ইতিহাস ও মোট হিসাব');
    eq((await A('GET', '/admin/api/user/999999')).status, 404, 'অচেনা ইউজার → 404');
    // পুরনো ইউজার (পাসওয়ার্ড এনক্রিপ্ট সেভ নেই): প্রথমে "সেভ হয়নি", লগইন করলে সেভ হয়
    dbq().prepare('UPDATE users SET pw_enc=NULL WHERE id=?').run(pu.id);
    eq((await A('GET', `/admin/api/user/${pu.id}/password`)).status, 404, 'আগে সেভ না থাকলে পাসওয়ার্ড দেখানো যায় না (সৎ বার্তা)');
    await post('/api/enter', { username: pu.name, password: 'secret1' }); eq((await A('GET', `/admin/api/user/${pu.id}/password`)).body.password, 'secret1', 'পরের লগইনে পাসওয়ার্ড সেভ হয়ে যায়');
    // রিসেট
    eq((await A('POST', `/admin/api/user/${pu.id}/password`)).status, 400, 'পাসওয়ার্ড ছাড়া রিসেট → 400');
    eq((await app.inject('POST', `/admin/api/user/${pu.id}/password`, { headers: adm, body: { password: 'abc' } })).status, 400, 'ছোট পাসওয়ার্ড রিসেট → 400');
    eq((await app.inject('POST', `/admin/api/user/${pu.id}/password`, { headers: adm, body: { password: 'newpass77' } })).status, 200, 'অ্যাডমিন নতুন পাসওয়ার্ড বসায়');
    eq((await post('/api/enter', { username: pu.name, password: 'secret1' }, null, '4.4.4.4')).status, 401, 'পুরনো পাসওয়ার্ড আর চলে না');
    eq((await post('/api/enter', { username: pu.name, password: 'newpass77' }, null, '4.4.4.5')).status, 200, 'নতুন পাসওয়ার্ডে লগইন হয়');
    eq((await A('GET', `/admin/api/user/${pu.id}/password`)).body.password, 'newpass77', 'নতুন পাসওয়ার্ডই দেখায়');
    ok(dbq().prepare("SELECT COUNT(*) FROM admin_audit WHERE action='view_password'").pluck().get() >= 3 && dbq().prepare("SELECT COUNT(*) FROM admin_audit WHERE action='reset_password'").pluck().get() >= 1, 'পাসওয়ার্ড দেখা/রিসেট অডিট লগে লেখা থাকে');
    // সাপোর্ট
    const c0 = (await get('/api/config')).body.support; eq(c0, { name: 'Support', telegram: 'na5yem' }, 'ডিফল্ট সাপোর্ট: টেলিগ্রাম na5yem');
    eq((await app.inject('POST', '/admin/api/settings', { headers: adm, body: { name: 'Help Desk', telegram: 'bad name' } })).status, 400, 'ভুল টেলিগ্রাম ইউজারনেম → 400');
    eq((await app.inject('POST', '/admin/api/settings', { headers: adm, body: { name: '', telegram: 'na5yem' } })).status, 400, 'খালি সাপোর্ট নাম → 400');
    eq((await app.inject('POST', '/admin/api/settings', { headers: adm, body: { name: 'Help Desk', telegram: '@Nayem_Support' } })).body, { name: 'Help Desk', telegram: 'Nayem_Support' }, 'সাপোর্টের নাম ও টেলিগ্রাম বদলানো যায় (@ বাদ যায়)');
    eq((await get('/api/config')).body.support, { name: 'Help Desk', telegram: 'Nayem_Support' }, 'লবি কনফিগে নতুন সাপোর্ট আসে');
    await app.inject('POST', '/admin/api/settings', { headers: adm, body: { name: 'Support', telegram: 'na5yem' } }); }
  console.log('▶ মোট হিসাব মেলে কি? (জমা = ব্যালেন্স + কমিশন + উত্তোলন + লক)');
  const db = dbq(); const one = s => db.prepare(s).pluck().get() || 0;
  const dep = one("SELECT SUM(amount) FROM transactions WHERE type='deposit' AND status='approved'"), bals = one('SELECT SUM(balance) FROM users'), comm = one('SELECT total_commission FROM admin_wallet'),
    wd = one("SELECT SUM(amount) FROM transactions WHERE type='withdraw' AND status IN('approved','pending')"), locked = one("SELECT SUM(bet_amount*2) FROM matches WHERE status='ongoing'");
  eq(dep, bals + comm + wd + locked, `ট্যালি: জমা ${dep} = ব্যালেন্স ${bals} + কমিশন ${comm} + উত্তোলন ${wd} + লক ${locked}`);
  eq(one('SELECT COUNT(*) FROM users WHERE balance<0'), 0, 'কারও ব্যালেন্স ঋণাত্মক নয়');
  console.log(`  main: ✔ ${pass} পাস, ${fail} ফেল`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('টেস্ট ক্র্যাশ:', e); process.exit(2); });
