const c = require('crypto');
exports.hashSync = (pw) => { const s = c.randomBytes(8).toString('hex'); return s + '$' + c.scryptSync(pw, s, 32).toString('hex'); };
exports.compareSync = (pw, h) => { const [s, x] = h.split('$'); return c.timingSafeEqual(Buffer.from(x, 'hex'), c.scryptSync(pw, s, 32)); };
