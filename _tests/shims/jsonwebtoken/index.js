const c = require('crypto'), b = x => Buffer.from(x).toString('base64url');
const mac = (d, s) => c.createHmac('sha256', s).update(d).digest('base64url');
exports.sign = (p, s, o = {}) => { const h = b('{"alg":"HS256"}'), body = b(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 7 * 86400 })); return h + '.' + body + '.' + mac(h + '.' + body, s); };
exports.verify = (t, s) => { const [h, p, g] = String(t || '').split('.'); if (!g || mac(h + '.' + p, s) !== g) throw new Error('bad'); const o = JSON.parse(Buffer.from(p, 'base64url')); if (o.exp < Date.now() / 1000) throw new Error('exp'); return o; };
