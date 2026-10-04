// খুব ছোট express: শুধু server.js যা ব্যবহার করে তা। app.inject() দিয়ে ইন-প্রসেস রিকোয়েস্ট পাঠানো যায়।
const fs = require('fs'), path = require('path');
function express() {
  const stack = [], settings = {};
  const app = (req, res) => app.handle(req, res);
  const add = (method, p, fns) => fns.forEach(fn => stack.push({ method, p, fn }));
  app.use = (a, b) => typeof a === 'function' ? add(null, null, [a]) : add(null, a, [b]);
  app.get = (p, ...f) => p.length && f.length ? add('GET', p, f) : settings[p];
  app.post = (p, ...f) => add('POST', p, f);
  app.set = (k, v) => { settings[k] = v; };
  const match = (pat, url) => { if (!pat) return {}; const a = pat.split('/'), b = url.split('/'); if (a.length !== b.length) return null; const pr = {};
    for (let i = 0; i < a.length; i++) { if (a[i][0] === ':') pr[a[i].slice(1)] = decodeURIComponent(b[i]); else if (a[i] !== b[i]) return null; } return pr; };
  app.handle = (req, res) => { let i = 0; const next = () => { const l = stack[i++]; if (!l) return res.status(404).send('Not found');
      if (l.method && l.method !== req.method) return next(); const pr = match(l.p, req.path); if (pr === null) return next(); req.params = pr; try { l.fn(req, res, next); } catch (e) { res.status(500).send(String(e.stack)); } }; next(); };
  app.inject = (method, url, { headers = {}, body, ip = '1.1.1.1' } = {}) => new Promise(resolve => {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req = { method, url, path: url.split('?')[0], headers: h, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)), ip: settings['trust proxy'] && h['x-forwarded-for'] ? h['x-forwarded-for'].split(',')[0].trim() : ip };
    const out = { status: 200, headers: {}, body: null }, done = b => { out.body = b; resolve(out); };
    const res = { status(c) { out.status = c; return this; }, set(k, v) { out.headers[String(k).toLowerCase()] = v; return this; },
      json(o) { out.headers['content-type'] = 'application/json'; done(JSON.parse(JSON.stringify(o))); }, send(s) { done(s); }, end() { done(null); },
      sendFile(f) { done({ file: f, text: fs.readFileSync(f, 'utf8') }); }, download(f) { done({ download: f }); } };
    app.handle(req, res); });
  globalThis.__app = app;
  return app;
}
express.json = () => (req, res, next) => next();
express.static = dir => (req, res, next) => { const f = path.join(dir, req.path === '/' ? 'index.html' : req.path); if (req.method === 'GET' && f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) return res.sendFile(f); next(); };
module.exports = express;
