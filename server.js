'use strict';
const express = require('express'), http = require('http'), { Server } = require('socket.io');
const Database = require('./_tests/shims/better-sqlite3'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const crypto = require('crypto'), fs = require('fs'), path = require('path');

// ───────────── Config ─────────────
const PORT = process.env.PORT || 3000;
const STAKES = [10, 20, 30, 50, 100, 500], FEE_PCT = (+process.env.FEE_PCT > 0 && +process.env.FEE_PCT < 50) ? +process.env.FEE_PCT : 5;                 // প্ল্যাটফর্ম ফি ৫%
const TURN1_MS = 30000, TURN2_MS = 15000, BOT_MS = 1200;     // প্রথমবার ৩০ সেকেন্ড, এরপর ১৫ সেকেন্ড, তারপর বট
const SINGLE_REPORT_MS = 5 * 60000, MIN_LOG = 80;            // প্রতিপক্ষ ফিরে না এলে একজনের রিপোর্টে ম্যাচ নিষ্পত্তির অপেক্ষা (0 = সবসময় অ্যাডমিন দেখবে)
const MIN_DEP = 10, MIN_WD = 20;                              // সর্বনিম্ন জমা ৳10, সর্বনিম্ন উত্তোলন ৳20
const IDLE_MS = +process.env.IDLE_MS || 15 * 60000;          // দুজনই ১৫ মিনিট অফলাইন থাকলে ম্যাচ বাতিল, দুজনের টাকাই ফেরত
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
let ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_PASS) { ADMIN_PASS = crypto.randomBytes(9).toString('hex'); console.log(`[admin] ADMIN_PASS not set. Temporary password: ${ADMIN_PASS}`); }
else if (ADMIN_PASS.length < 10) console.warn('[admin] ⚠️ ADMIN_PASS খুব ছোট — কমপক্ষে ১০ অক্ষরের শক্ত পাসওয়ার্ড দিন');
const PAY = { bKash: process.env.BKASH_NUMBER || '01818714458', Nagad: process.env.NAGAD_NUMBER || '01818714458' };   // ইউজাররা এই নাম্বারে টাকা পাঠাবে (env দিয়ে বদলানো যায়)
// ডাটা (ডাটাবেস, জেডব্লিউটি সিক্রেট, ব্যাকআপ) যে ফোল্ডারে থাকবে। রিস্টার্ট/ডিপ্লয়ে যেন না মুছে সেজন্য হোস্টিংয়ে স্থায়ী ডিস্ক (persistent volume) বানিয়ে DATA_DIR সেখানে দিন।
// DATA_DIR না দিলে: আগে থেকে ludo.db এই ফোল্ডারে থাকলে সেটাই চলবে (পুরনো সেটআপ), নইলে ./data ফোল্ডারে। ডিপ্লয়ে কোড ফোল্ডার বদলালেও ডাটা যেন না হারায়, তাই হোস্টিংয়ে DATA_DIR সবসময় স্থায়ী ডিস্কে দিন।
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : (fs.existsSync(path.join(__dirname, 'ludo.db')) ? __dirname : path.join(__dirname, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const BACKUP_DIR = path.join(DATA_DIR, 'backups'); fs.mkdirSync(BACKUP_DIR, { recursive: true });
const secretFile = path.join(DATA_DIR, '.jwt_secret');
const JWT_SECRET = process.env.JWT_SECRET || (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8') :
  (() => { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(secretFile, s, { mode: 0o600 }); return s; })());
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// ───────────── Database ─────────────
const db = new Database(path.join(DATA_DIR, 'ludo.db'));
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.pragma('synchronous = FULL');                                   // টাকার হিসাব: কমিট করা লেনদেন বিদ্যুৎ গেলেও হারাবে না
// স্বয়ংক্রিয় ব্যাকআপ: চালু হওয়ার সময় ও প্রতি ৩০ মিনিটে, সর্বশেষ ৪৮টি রাখা হয়
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
async function backupNow(prefix = 'auto') {
  const dest = path.join(BACKUP_DIR, `${prefix}-${stamp()}.db`);
  await db.backup(dest);
  const old = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('auto-')).sort().reverse().slice(48);
  old.forEach(f => { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) { /* ignore */ } });
  return dest;
}
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS matches(id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT UNIQUE NOT NULL, player1_id INTEGER NOT NULL, player2_id INTEGER NOT NULL,
  bet_amount INTEGER NOT NULL, winner_id INTEGER, commission_amount INTEGER NOT NULL DEFAULT 0, payout_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ongoing' CHECK(status IN('ongoing','completed','forfeited')), disputed INTEGER NOT NULL DEFAULT 0, note TEXT, timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
  type TEXT NOT NULL CHECK(type IN('deposit','withdraw','bet_deduct','bet_win','commission')), amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN('pending','approved','rejected')), method TEXT, trx_id TEXT, account_number TEXT, note TEXT,
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dep_trx ON transactions(trx_id) WHERE type='deposit' AND status!='rejected';
CREATE TABLE IF NOT EXISTS admin_wallet(id INTEGER PRIMARY KEY CHECK(id=1), total_commission INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO admin_wallet(id) VALUES(1);`);
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch (e) { /* already there */ }
for (const col of ['disputed INTEGER NOT NULL DEFAULT 0', 'note TEXT']) { try { db.exec('ALTER TABLE matches ADD COLUMN ' + col); } catch (e) { /* already there */ } }

const app = express(), server = http.createServer(app);
app.set('x-powered-by', false); app.set('trust proxy', 1);                                         // Render/Cloudflare/Nginx-এর পেছনে থাকলে আসল ইউজারের IP ধরার জন্য (নইলে সবার IP এক হয়ে লগইন ব্লক হয়)
app.use((req, res, next) => {   // হোস্টিং http-তে পাঠালে https-এ ঘুরিয়ে দেয় (অ্যাডমিন পাসওয়ার্ড যেন খোলা পথে না যায়)
  if (req.headers['x-forwarded-proto'] === 'http' && req.path !== '/healthz') return res.redirect(308, 'https://' + req.headers.host + req.originalUrl);
  res.set('X-Frame-Options', 'DENY'); res.set('Referrer-Policy', 'same-origin'); next();
});
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); if (/^\/(api|admin)/.test(req.path || req.url)) res.set('Cache-Control', 'no-store'); next(); });
app.get('/healthz', (req, res) => res.json({ ok: true }));
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || false } });

const addTx = (uid, type, amount, status, x = {}) => db.prepare(
  'INSERT INTO transactions(user_id,type,amount,status,method,trx_id,account_number,note) VALUES(?,?,?,?,?,?,?,?)')
  .run(uid, type, amount, status, x.method || null, x.trx_id || null, x.account || null, x.note || null).lastInsertRowid;
const balanceOf = id => db.prepare('SELECT balance FROM users WHERE id=?').pluck().get(id);
const pushWallet = id => io.to('user:' + id).emit('walletUpdated', { balance: balanceOf(id) });

// Escrow: atomically lock both stakes (all-or-nothing)
const createMatch = db.transaction((roomId, p1, p2, bet) => {
  const d = db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?');
  if (!d.run(bet, p1, bet).changes) throw new Error('p1');
  if (!d.run(bet, p2, bet).changes) throw new Error('p2');
  db.prepare('INSERT INTO matches(room_id,player1_id,player2_id,bet_amount) VALUES(?,?,?,?)').run(roomId, p1, p2, bet);
  addTx(p1, 'bet_deduct', bet, 'approved', { note: roomId }); addTx(p2, 'bet_deduct', bet, 'approved', { note: roomId });
});
// Settlement: winner gets pot minus FEE_PCT%, fee goes to admin ledger; idempotent (only acts on 'ongoing')
const settle = db.transaction((roomId, winnerId, status) => {
  const m = db.prepare("SELECT * FROM matches WHERE room_id=? AND status='ongoing'").get(roomId);
  if (!m) return null;
  const pot = m.bet_amount * 2, comm = Math.floor(pot * FEE_PCT / 100), pay = pot - comm;
  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(pay, winnerId);
  db.prepare('UPDATE admin_wallet SET total_commission=total_commission+? WHERE id=1').run(comm);
  db.prepare('UPDATE matches SET winner_id=?,commission_amount=?,payout_amount=?,status=? WHERE id=?').run(winnerId, comm, pay, status, m.id);
  addTx(winnerId, 'bet_win', pay, 'approved', { note: roomId }); addTx(null, 'commission', comm, 'approved', { note: roomId });
  return { pay, comm, m };
});
// Refund: ongoing ম্যাচের দুজনের এন্ট্রি ফি ফেরত (idempotent — শুধু 'ongoing' ম্যাচে কাজ করে)
const refundMatch = db.transaction((roomId, note = 'refund') => {
  const m = db.prepare("SELECT * FROM matches WHERE room_id=? AND status='ongoing'").get(roomId);
  if (!m) return null;
  for (const u of [m.player1_id, m.player2_id]) {
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(m.bet_amount, u);
    addTx(u, 'bet_win', m.bet_amount, 'approved', { note: note + ' ' + roomId });
  }
  db.prepare("UPDATE matches SET status='forfeited' WHERE id=?").run(m.id);
  return m;
});
// Crash recovery: সার্ভার বন্ধ/রিস্টার্টের সময় যেসব ম্যাচ চলছিল (ও বিরোধে যায়নি) সেগুলোর টাকা ফেরত
for (const m of db.prepare("SELECT room_id FROM matches WHERE status='ongoing' AND disputed=0").all()) refundMatch(m.room_id, 'refund');

// ───────────── REST: auth + wallet ─────────────
app.use(express.json({ limit: '100kb' }));
const sign = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => {
  try { req.uid = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'লগইন করা নেই' }); }
};
const PHONE = /^01[3-9]\d{8}$/, METHOD = /^(bKash|Nagad) (Personal|Agent)$/;
const attempts = new Map(); // tiny login throttle
const badPw = new Map();    // নাম ধরে ভুল পাসওয়ার্ডের হিসাব: একই অ্যাকাউন্টে ১৫ মিনিটে ১০ বার ভুল হলে আটকে দেয় (আইপি বদলালেও)
const badCount = n => { const a = (badPw.get(n) || []).filter(t => Date.now() - t < 900000); badPw.set(n, a); return a.length; };
setInterval(() => { for (const k of [...badPw.keys()]) if (!badCount(k)) badPw.delete(k); }, 10 * 60000).unref();
const throttled = (ip, max = 10) => { const a = (attempts.get(ip) || []).filter(t => Date.now() - t < 60000); a.push(Date.now()); attempts.set(ip, a); return a.length > max; };
setInterval(() => { for (const [k, v] of attempts) if (!v.some(t => Date.now() - t < 60000)) attempts.delete(k); }, 5 * 60000).unref();

// Registration নেই: নাম + পাসওয়ার্ড (+ ঐচ্ছিক ছবি) দিলেই ঢোকা যায়। নতুন হলে (fresh) অ্যাকাউন্ট নিজে থেকে তৈরি হয়, ইউজারনেম = নাম_৫ সংখ্যা (যেমন nayem_56748)
const NAME_RE = /^[\p{L}\p{M}\p{N}]{2,12}_\d{5}$/u, AV_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{100,60000}$/;
const WEAK = /^(?:(.)\1+|123456\d*|0123456789|654321|987654321?|qwerty\w*|password\d*|abcdef\w*|iloveyou|asdfgh\w*)$/i;   // নতুন অ্যাকাউন্টে অতি সহজ পাসওয়ার্ড আটকায়
const okAvatar = a => typeof a === 'string' && AV_RE.test(a);
app.get('/api/config', (req, res) => res.json({ stakes: STAKES, feePct: FEE_PCT, minDep: MIN_DEP, minWd: MIN_WD, pay: PAY }));
app.post('/api/enter', (req, res) => {
  if (throttled(req.ip)) return res.status(429).json({ error: 'অনেকবার চেষ্টা করেছেন, ১ মিনিট পরে আবার চেষ্টা করুন' });
  const { username, password, fresh, avatar } = req.body || {}, name = String(username || '').trim();
  if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });
  if (avatar != null && avatar !== '' && !okAvatar(avatar)) return res.status(400).json({ error: 'ছবিটি ঠিক নয়, অন্য ছবি দিন' });
  const av = avatar ? avatar : null;
  const u = db.prepare('SELECT * FROM users WHERE username=? OR phone=?').get(name, name);
  if (u) {
    if (!fresh && badCount(name) >= 10) return res.status(429).json({ error: 'এই অ্যাকাউন্টে অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে, ১৫ মিনিট পরে চেষ্টা করুন' });
    if (fresh) return res.status(409).json({ error: 'এই ইউজারনেমটি আগেই কেউ নিয়ে ফেলেছে। নতুন সংখ্যা দেওয়া হয়েছে, আবার চাপুন' });
    if (!bcrypt.compareSync(password, u.password_hash)) { badPw.get(name).push(Date.now()); return res.status(401).json({ error: 'ইউজারনেম বা পাসওয়ার্ড ভুল' }); }
    if (av) db.prepare('UPDATE users SET avatar=? WHERE id=?').run(av, u.id);
    return res.json({ token: sign(u), user: { id: u.id, username: u.username, balance: u.balance } });
  }
  if (!fresh) return res.status(404).json({ error: 'এই ইউজারনেমে কোনো অ্যাকাউন্ট নেই। শুধু নাম লিখলে নতুন অ্যাকাউন্ট খোলা হবে' });
  if (!NAME_RE.test(name)) return res.status(400).json({ error: 'নাম ২ থেকে ১২ অক্ষরের হতে হবে (শুধু অক্ষর বা সংখ্যা)' });
  if (WEAK.test(password)) return res.status(400).json({ error: 'এই পাসওয়ার্ডটি খুব সহজ (যেমন 123456), অন্য একটি দিন' });
  try {   // phone কলামটি পুরনো ডাটাবেসের জন্য আছে; এখন ইউজারনেমই বসানো হয়
    const id = db.prepare('INSERT INTO users(username,phone,password_hash,avatar) VALUES(?,?,?,?)').run(name, name, bcrypt.hashSync(password, 10), av).lastInsertRowid;
    res.json({ token: sign({ id }), user: { id, username: name, balance: 0 } });
  } catch (e) { res.status(409).json({ error: 'এই ইউজারনেমটি আগেই কেউ নিয়ে ফেলেছে। নতুন সংখ্যা দেওয়া হয়েছে, আবার চাপুন' }); }
});
app.post('/api/avatar', auth, (req, res) => {
  const { avatar } = req.body || {};
  if (!okAvatar(avatar)) return res.status(400).json({ error: 'ছবিটি ঠিক নয়, অন্য ছবি দিন' });
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(avatar, req.uid); res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json(db.prepare('SELECT id,username,balance,avatar,created_at FROM users WHERE id=?').get(req.uid)));
app.get('/api/transactions', auth, (req, res) => res.json(db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.uid)));

app.post('/api/deposit', auth, (req, res) => {
  const { payment_method, sender_number, amount, transaction_id } = req.body || {};
  const trx = String(transaction_id || '').trim().toUpperCase();
  if (!METHOD.test(payment_method || '')) return res.status(400).json({ error: 'পেমেন্ট মাধ্যম ঠিক নয়' });
  if (!PHONE.test(sender_number || '')) return res.status(400).json({ error: 'আপনার (সেন্ডার) নাম্বারটি ঠিক নয়' });
  if (!Number.isInteger(amount) || amount < MIN_DEP || amount > 100000) return res.status(400).json({ error: `টাকার পরিমাণ কমপক্ষে ৳${MIN_DEP} হতে হবে (পূর্ণ সংখ্যা)` });
  if (!/^[A-Z0-9]{6,20}$/.test(trx)) return res.status(400).json({ error: 'ট্রানজেকশন আইডি (TrxID) ঠিক নয়' });
  if (db.prepare("SELECT COUNT(*) FROM transactions WHERE user_id=? AND type='deposit' AND status='pending'").pluck().get(req.uid) >= 5) return res.status(429).json({ error: 'আপনার ৫টি জমার আবেদন অপেক্ষায় আছে, অ্যাডমিন দেখার পর আবার দিন' });
  try { const id = addTx(req.uid, 'deposit', amount, 'pending', { method: payment_method, trx_id: trx, account: sender_number }); res.json({ id, status: 'pending' }); }
  catch (e) { res.status(409).json({ error: 'এই ট্রানজেকশন আইডি আগেই জমা দেওয়া হয়েছে' }); }
});
app.post('/api/withdraw', auth, (req, res) => {
  const { amount, recipient_number, payment_method } = req.body || {};
  if (!PHONE.test(recipient_number || '')) return res.status(400).json({ error: 'প্রাপকের নাম্বারটি ঠিক নয়' });
  if (!Number.isInteger(amount) || amount < MIN_WD) return res.status(400).json({ error: `সর্বনিম্ন উত্তোলন ৳${MIN_WD}` });
  const method = /^(bKash|Nagad)/.test(payment_method || '') ? payment_method : 'bKash';
  const out = db.transaction(() => {
    if (!db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?').run(amount, req.uid, amount).changes) return null;
    return addTx(req.uid, 'withdraw', amount, 'pending', { method, account: recipient_number });
  })();
  if (!out) return res.status(400).json({ error: 'ব্যালেন্স যথেষ্ট নয়' });
  pushWallet(req.uid); res.json({ id: out, status: 'pending' });
});

// ───────────── Admin ─────────────
const adminFail = new Map();
const adminAuth = (req, res, next) => {
  // CSRF সুরক্ষা: অন্য সাইট থেকে অ্যাডমিনের ব্রাউজার দিয়ে গোপনে 'Approve' পাঠানো ঠেকাতে POST-এ নিজস্ব হেডার লাগে (অ্যাডমিন পেজ নিজে এটা পাঠায়)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'ludo-admin') return res.status(403).json({ error: 'Forbidden' });
  const bad = (adminFail.get(req.ip) || []).filter(t => Date.now() - t < 60000);
  if (bad.length >= 10) return res.status(429).send('Too many attempts, wait 1 minute');
  const [u, p] = Buffer.from((req.headers.authorization || '').split(' ')[1] || '', 'base64').toString().split(/:(.*)/s);
  if (u !== undefined && safeEq(u, ADMIN_USER) && safeEq(p || '', ADMIN_PASS)) return next();
  if ((req.headers.authorization || '')) { bad.push(Date.now()); adminFail.set(req.ip, bad); }
  res.set('WWW-Authenticate', 'Basic realm="Ludo Admin"').status(401).send('Auth required');
};
app.get('/admin', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin/api/backup', adminAuth, async (req, res) => {
  try { const f = await backupNow('manual'); res.download(f); } catch (e) { res.status(500).json({ error: 'ব্যাকআপ হয়নি' }); }
});
app.get('/admin/api/overview', adminAuth, (req, res) => {
  const one = (sql) => db.prepare(sql).pluck().get() || 0;
  res.json({
    totalVolume: one("SELECT SUM(bet_amount*2) FROM matches WHERE status!='ongoing'"),
    totalCommission: one('SELECT total_commission FROM admin_wallet WHERE id=1'), feePct: FEE_PCT,
    activeGames: rooms.size, users: one('SELECT COUNT(*) FROM users'),
    userBalances: one('SELECT SUM(balance) FROM users'),
    disputes: one("SELECT COUNT(*) FROM matches WHERE disputed=1 AND status='ongoing'"),
    pendingDeposits: one("SELECT COUNT(*) FROM transactions WHERE type='deposit' AND status='pending'"),
    pendingWithdrawals: one("SELECT COUNT(*) FROM transactions WHERE type='withdraw' AND status='pending'"),
    completedMatches: one("SELECT COUNT(*) FROM matches WHERE status!='ongoing'"),
  });
});
app.get('/admin/api/pending/:type', adminAuth, (req, res) => {
  if (!['deposit', 'withdraw'].includes(req.params.type)) return res.status(400).end();
  res.json(db.prepare(`SELECT t.*,u.username,u.phone FROM transactions t JOIN users u ON u.id=t.user_id
    WHERE t.type=? AND t.status='pending' ORDER BY t.id`).all(req.params.type));
});
const review = db.transaction((id, ok) => {
  const t = db.prepare("SELECT * FROM transactions WHERE id=? AND status='pending' AND type IN('deposit','withdraw')").get(id);
  if (!t) return null;
  db.prepare('UPDATE transactions SET status=? WHERE id=?').run(ok ? 'approved' : 'rejected', id);
  if (t.type === 'deposit' && ok) db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(t.amount, t.user_id);
  if (t.type === 'withdraw' && !ok) db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(t.amount, t.user_id);
  return t;
});
app.post('/admin/api/tx/:id/:action', adminAuth, (req, res) => {
  if (!['approve', 'reject'].includes(req.params.action)) return res.status(400).end();
  const t = review(+req.params.id, req.params.action === 'approve');
  if (!t) return res.status(404).json({ error: 'Not found or already processed' });
  pushWallet(t.user_id); res.json({ ok: true });
});
app.get('/admin/api/disputes', adminAuth, (req, res) => res.json(db.prepare(`SELECT m.id,m.room_id,m.bet_amount,m.note,m.timestamp,m.player1_id,m.player2_id,u1.username AS p1,u2.username AS p2
  FROM matches m JOIN users u1 ON u1.id=m.player1_id JOIN users u2 ON u2.id=m.player2_id WHERE m.disputed=1 AND m.status='ongoing' ORDER BY m.id`).all()));
const resolveDispute = db.transaction((roomId, action) => {
  const m = db.prepare("SELECT * FROM matches WHERE room_id=? AND disputed=1 AND status='ongoing'").get(roomId);
  if (!m) return null;
  if (action === 'refund') {
    for (const u of [m.player1_id, m.player2_id]) { db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(m.bet_amount, u); addTx(u, 'bet_win', m.bet_amount, 'approved', { note: 'dispute refund ' + roomId }); }
    db.prepare("UPDATE matches SET status='forfeited' WHERE id=?").run(m.id);
  } else settle(roomId, action === 'p1' ? m.player1_id : m.player2_id, 'completed');
  return m;
});
app.post('/admin/api/dispute/:room/:action', adminAuth, (req, res) => {
  if (!['p1', 'p2', 'refund'].includes(req.params.action)) return res.status(400).end();
  const m = resolveDispute(req.params.room, req.params.action);
  if (!m) return res.status(404).json({ error: 'Not found or already resolved' });
  pushWallet(m.player1_id); pushWallet(m.player2_id); res.json({ ok: true });
});
app.use(express.static(path.join(__dirname, 'public')));

// ───────────── Match rooms: lockstep relay ─────────────
// Your ORIGINAL game logic runs unchanged in both browsers. The server is the referee for the MONEY:
//  • it supplies every random value (dice, mystery-box cards) so neither player can predict or fake them
//  • it relays every player action in one ordered log (also used to resume after a refresh / net drop)
//  • it only pays out when BOTH browsers report the same winner; a mismatch freezes the stakes for admin review
const COLORS = [0, 2], CARD_KEYS = ['back3', 'fwd1', 'setme', 'setopp', 'shield'], EMOJIS = ['😂', '😎', '😡', '😭', '👏', '🔥', '🤯', '😈', '🙏', '💀'];
const rooms = new Map(), userRoom = new Map(), queues = new Map(STAKES.map(s => [s, []]));
const other = (R, uid) => R.order.find(u => u !== uid);
const okInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function validAct(a) {
  if (!a || typeof a !== 'object') return false;
  if (a.t === 'roll') return true;
  if (a.t === 'move') return okInt(a.i, 0, 3);
  if (a.t !== 'card' || !CARD_KEYS.includes(a.k)) return false;
  const x = a.a || {};
  return (x.val === undefined || okInt(x.val, 1, 6)) && (x.i === undefined || okInt(x.i, 0, 3)) &&
    [x.pl, x.opp].every(c => c === undefined || COLORS.includes(c));
}
function release(R) { R.over = true; clearTimeout(R.resT); clearTimeout(R.turnT); clearTimeout(R.idleT); R.order.forEach(u => userRoom.delete(u)); rooms.delete(R.id); }
const colorUser = (R, c) => R.order.find(u => R.players[u].color === c);
const tmView = R => ({ c: R.tm.c, seq: R.tm.seq, ms: Math.max(0, R.tm.ms - (Date.now() - R.tm.t0)) });
// রুলস: প্রথমবার ৩০ সেকেন্ডে চাল না দিলে চাল পরের জনের কাছে যায়। এরপর চাল পেলে ১৫ সেকেন্ড; আবার না দিলে (নেট সমস্যা/বেরিয়ে গেলে ইত্যাদি) সহজ বট তার হয়ে খেলে।
// ফিরে এলে (পেজ খুললে / "আমি ফিরেছি" চাপলে / নিজে চাল দিলে) বট থামে। কেউ এতে জেতে বা হারে না — খেলা শেষ পর্যন্ত চলে।
function armTurn(R, color, seq) {
  clearTimeout(R.turnT);
  const p = R.players[colorUser(R, color)], mode = p.bot ? 'bot' : 'wait';
  R.tm = { c: color, seq, ms: p.bot ? BOT_MS : (p.strikes ? TURN2_MS : TURN1_MS), t0: Date.now() };
  io.to(R.id).emit('turnTimer', tmView(R));
  R.turnT = setTimeout(() => {
    if (R.over || R.log.length !== seq) return;
    if (mode === 'bot') { if (!p.bot) return; R.lastRoller = color; return void pushLog(R, 0, { t: 'bot', c: color }); }
    if (p.bot) return;
    if (!p.strikes) { p.strikes = 1; pushLog(R, 0, { t: 'skip', c: color }); }
    else { p.bot = true; io.to(R.id).emit('botMode', { c: color, on: true }); R.lastRoller = color; pushLog(R, 0, { t: 'bot', c: color }); }
  }, R.tm.ms);
}
function comeBack(R, uid) {                  // খেলোয়াড় ফিরে এসেছে: বট বন্ধ, পরের চালে ১৫ সেকেন্ড
  const p = R.players[uid]; if (!p.bot) return;
  p.bot = false; p.strikes = 1; io.to(R.id).emit('botMode', { c: p.color, on: false });
  if (R.tm && R.tm.c === p.color && R.log.length === R.tm.seq) armTurn(R, R.tm.c, R.tm.seq);
}
const pushLog = (R, u, a) => { const e = { seq: R.log.length + 1, u, a }; R.log.push(e); io.to(R.id).emit('act', e); return e; };
function finish(R, winnerId, status) {
  if (R.over) return; release(R);
  let res = null; try { res = settle(R.id, winnerId, status); } catch (e) { console.error('settle failed', e); }
  io.to(R.id).emit('gameOver', { roomId: R.id, winnerId, forfeit: status === 'forfeited', payout: res ? res.pay : 0, commission: res ? res.comm : 0 });
  R.order.forEach(pushWallet);
}
function dispute(R, reason) {
  if (R.over) return; release(R);
  const note = JSON.stringify({ reason, reports: Object.fromEntries(R.order.map(u => [u, R.players[u].report ?? null])) });
  db.prepare('UPDATE matches SET disputed=1, note=? WHERE room_id=?').run(note, R.id);
  io.to(R.id).emit('disputed', { roomId: R.id });
}
const queueStats = () => Object.fromEntries([...queues].map(([s, q]) => [s, q.length]));
let qT = null; const pushQueues = () => { clearTimeout(qT); qT = setTimeout(() => io.emit('queueStats', queueStats()), 120); };   // লবিতে রিয়েল-টাইম "কোন এন্ট্রিতে কতজন অপেক্ষায়"
function tryMatch(bet) {
  const q = queues.get(bet);
  while (q.length >= 2) {
    const [a, b] = Math.random() < .5 ? [q.shift(), q.shift()] : [q.splice(1, 1)[0], q.shift()], roomId = crypto.randomUUID();
    try { createMatch(roomId, a, b, bet); }
    catch (e) {
      const bad = e.message === 'p1' ? a : b, good = bad === a ? b : a;
      io.to('user:' + bad).emit('errorMsg', { message: 'এই এন্ট্রি ফি-র জন্য ব্যালেন্স যথেষ্ট নয়' }); q.unshift(good); continue;
    }
    const info = id => db.prepare('SELECT username,avatar FROM users WHERE id=?').get(id);
    const R = { id: roomId, bet, order: [a, b], over: false, log: [], rnd: [], first: {}, tm: null, seed: crypto.randomInt(2 ** 31),
      players: { [a]: { color: 0, ...info(a), connected: true, strikes: 0, bot: false }, [b]: { color: 2, ...info(b), connected: true, strikes: 0, bot: false } } };
    rooms.set(roomId, R); R.order.forEach(u => userRoom.set(u, roomId));
    for (const [me, op] of [[a, b], [b, a]]) {
      pushWallet(me);
      io.to('user:' + me).emit('matchStart', { roomId, bet, myColor: R.players[me].color, turn: a,
        opponent: { id: op, username: R.players[op].username, color: R.players[op].color } });
    }
  }
  pushQueues();
}

// ───────────── Socket.io ─────────────
io.use((s, next) => { try { s.uid = jwt.verify(s.handshake.auth.token, JWT_SECRET).id; next(); } catch { next(new Error('Unauthorized')); } });
const userSockets = new Map();
io.on('connection', socket => {
  const uid = socket.uid, mine = id => { const R = rooms.get(id); return R && !R.over && R.players[uid] ? R : null; };
  socket.join('user:' + uid);
  if (!userSockets.has(uid)) userSockets.set(uid, new Set()); userSockets.get(uid).add(socket.id);
  socket.emit('walletUpdated', { balance: balanceOf(uid) }); socket.emit('queueStats', queueStats());
  const rid = userRoom.get(uid);                                   // back inside the 30s window
  if (rid && rooms.has(rid)) {
    const R = rooms.get(rid), p = R.players[uid]; clearTimeout(p.timer); clearTimeout(R.idleT); p.connected = true;
    socket.emit('matchActive', { roomId: rid }); io.to(rid).emit('opponentReconnected', { userId: uid });
  }

  socket.on('joinQueue', ({ userId, betAmount } = {}) => {
    if (userId !== undefined && +userId !== uid) return socket.emit('errorMsg', { message: 'ইউজার মিলছে না' });
    if (!STAKES.includes(betAmount)) return socket.emit('errorMsg', { message: 'এন্ট্রি ফি ঠিক নয়' });
    if (userRoom.has(uid)) return socket.emit('errorMsg', { message: 'আপনি আগে থেকেই একটি ম্যাচে আছেন' });
    if ([...queues.values()].some(q => q.includes(uid))) return socket.emit('errorMsg', { message: 'আপনি আগে থেকেই অপেক্ষায় আছেন' });
    if (balanceOf(uid) < betAmount) return socket.emit('errorMsg', { message: 'ব্যালেন্স যথেষ্ট নয়' });
    queues.get(betAmount).push(uid); socket.emit('queueJoined', { betAmount }); tryMatch(betAmount); pushQueues();
  });
  socket.on('leaveQueue', () => { queues.forEach(q => { const i = q.indexOf(uid); if (i >= 0) q.splice(i, 1); }); pushQueues(); });

  socket.on('enterRoom', ({ roomId, resync } = {}) => {                    // game page joins / resyncs (full action log)
    const R = mine(roomId);
    if (!R) {                                                       // match already finished: tell this player how it ended
      const m = db.prepare('SELECT * FROM matches WHERE room_id=?').get(String(roomId));
      return socket.emit('roomClosed', m && (m.player1_id === uid || m.player2_id === uid)
        ? { me: uid, winnerId: m.winner_id, payout: m.payout_amount, bet: m.bet_amount, disputed: !!m.disputed } : {});
    }
    if (!resync) comeBack(R, uid);                                  // পেজ খুললে/নেট ফিরলে বট থামে
    socket.join(roomId);
    socket.emit('roomState', { roomId, bet: R.bet, fee: FEE_PCT, me: uid, log: R.log, seed: R.seed,
      bots: R.order.filter(u => R.players[u].bot).map(u => R.players[u].color),
      players: R.order.map(u => ({ id: u, username: R.players[u].username, avatar: R.players[u].avatar || null, color: R.players[u].color })) });
    if (R.tm && R.tm.seq === R.log.length) socket.emit('turnTimer', tmView(R));
  });
  socket.on('back', ({ roomId } = {}) => { const R = mine(roomId); if (R) comeBack(R, uid); });   // "আমি ফিরেছি" বোতাম
  socket.on('resign', ({ roomId } = {}) => { const R = mine(roomId); if (R) finish(R, other(R, uid), 'forfeited'); });   // নিজে থেকে বেরিয়ে গেলে হার
  socket.on('act', ({ roomId, a } = {}) => {                       // a player action → ordered log → both browsers
    const R = mine(roomId); if (!R || !validAct(a) || R.log.length >= 20000) return;
    const c = { t: a.t };
    if (a.t === 'move') c.i = a.i;
    if (a.t === 'roll') R.lastRoller = R.players[uid].color;
    if (a.t === 'card') { c.k = a.k; c.a = {}; for (const f of ['val', 'i', 'pl', 'opp']) if ((a.a || {})[f] !== undefined) c.a[f] = a.a[f]; }
    const p = R.players[uid]; p.strikes = 0;
    if (p.bot) { p.bot = false; io.to(R.id).emit('botMode', { c: p.color, on: false }); }
    pushLog(R, uid, c);
  });
  socket.on('rnd', ({ roomId, k, n } = {}) => {                    // server-side randomness, sequential only
    const R = mine(roomId); if (!R || !okInt(k, 0, R.rnd.length) || !okInt(n, 2, 6)) return;
    if (k === R.rnd.length) {
      let v = crypto.randomInt(n);
      // n===6 is always a dice roll (mystery-box cards use n=5). Each player's first 1-4 rolls must contain one six; after that it is plain random.
      if (n === 6 && R.lastRoller !== undefined) {
        const f = R.first[R.lastRoller] || (R.first[R.lastRoller] = { n: 0, six: false, at: 1 + crypto.randomInt(4) });
        if (!f.six) { f.n++; if (v === 5) f.six = true; else if (f.n >= f.at) { v = 5; f.six = true; } }
      }
      R.rnd.push({ n, v });
    }
    if (R.rnd[k].n === n) io.to(roomId).emit('rndVal', { k, v: R.rnd[k].v });
  });
  // অপেক্ষারত খেলোয়াড় জানায় এখন কার চাল। সময়সীমা: প্রথমবার ৩০ সেকেন্ড, তারপর ১৫ সেকেন্ড, তারপর বট (armTurn দেখুন)
  socket.on('turn', ({ roomId, color, seq } = {}) => {
    const R = mine(roomId); if (!R || !COLORS.includes(color) || seq !== R.log.length || color === R.players[uid].color) return;
    if (R.tm && R.tm.c === color && R.tm.seq === seq) return void socket.emit('turnTimer', tmView(R));
    armTurn(R, color, seq);
  });
  // Emoji: only the sender's own screen can send it; it is relayed to the whole room and spreads over both screens.
  socket.on('emoji', ({ roomId, e } = {}) => {
    const R = mine(roomId); if (!R || !EMOJIS.includes(e)) return;
    const p = R.players[uid]; if (Date.now() - (p.lastEmo || 0) < 1500) return; p.lastEmo = Date.now();
    io.to(roomId).emit('emoji', { c: p.color, name: p.username, e });
  });
  socket.on('result', ({ roomId, winnerColor } = {}) => {          // দুই ব্রাউজারকেই একই বিজয়ী জানাতে হবে
    const R = mine(roomId); if (!R || !COLORS.includes(winnerColor)) return;
    const p = R.players[uid], o = R.players[other(R, uid)]; p.report = winnerColor;
    if (o.report !== undefined) {
      if (o.report === winnerColor) finish(R, colorUser(R, winnerColor), 'completed');
      else dispute(R, 'result mismatch');
      return;
    }
    clearTimeout(R.resT);
    R.resT = setTimeout(() => {
      if (R.over || o.report !== undefined) return;
      if (o.connected) return dispute(R, 'opponent never confirmed');
      // প্রতিপক্ষ অফলাইন: কিছু সময় ফেরার অপেক্ষা; না ফিরলে (এবং খেলা বাস্তবসম্মত হলে) একজনের রিপোর্টেই নিষ্পত্তি, নইলে অ্যাডমিন
      R.resT = setTimeout(() => {
        if (R.over || o.report !== undefined) return;
        if (SINGLE_REPORT_MS > 0 && R.log.length >= MIN_LOG) {
          const rid = R.id; finish(R, colorUser(R, winnerColor), 'completed');
          db.prepare('UPDATE matches SET note=? WHERE room_id=?').run(JSON.stringify({ reason: 'opponent absent, single report accepted' }), rid);
        } else dispute(R, 'opponent offline after game end');
      }, SINGLE_REPORT_MS);
    }, 60000);
  });

  socket.on('disconnect', () => {
    const set = userSockets.get(uid); set.delete(socket.id); if (set.size) return; userSockets.delete(uid);
    queues.forEach(q => { const i = q.indexOf(uid); if (i >= 0) q.splice(i, 1); }); pushQueues();
    const R = rooms.get(userRoom.get(uid)); if (!R || R.over) return;
    R.players[uid].connected = false;                               // the match is NOT forfeited; they can come back and continue
    io.to(R.id).emit('opponentDisconnected', { userId: uid });
    if (R.order.every(u => !R.players[u].connected)) {              // দুজনই অফলাইন: IDLE_MS পরে ম্যাচ বাতিল, টাকা ফেরত
      clearTimeout(R.idleT);
      R.idleT = setTimeout(() => {
        if (R.over || R.order.some(u => R.players[u].connected)) return;
        release(R); try { refundMatch(R.id, 'idle refund'); } catch (e) { console.error('refund failed', e); }
        R.order.forEach(pushWallet);
      }, IDLE_MS);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Ludo server → http://localhost:${PORT}   Admin → http://localhost:${PORT}/admin (user: ${ADMIN_USER})`);
  console.log(`[data] ডাটা ফোল্ডার: ${DATA_DIR}`);
  backupNow('auto').catch(e => console.error('[backup]', e.message));
  setInterval(() => backupNow('auto').catch(e => console.error('[backup]', e.message)), 30 * 60000).unref();
});
// বন্ধ করার সময় (Ctrl+C / রিস্টার্ট / ডিপ্লয়) ডাটাবেস নিরাপদে সেভ করে বের হয়
let closing = false;
function shutdown() {
  if (closing) return; closing = true;
  console.log('[shutdown] ডাটাবেস সেভ হচ্ছে…');
  try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch (e) { console.error(e.message); }
  process.exit(0);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
