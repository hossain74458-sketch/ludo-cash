// ইন-প্রসেস socket.io: সার্ভারের সব ইভেন্ট হ্যান্ডলার আসল কোডেই চলে; ক্লায়েন্ট হিসেবে io.connect(token) ব্যবহার করুন।
class Srv { constructor() { this.mw = []; this.conn = []; this.socks = new Set(); globalThis.__io = this; }
  use(f) { this.mw.push(f); } on(ev, f) { if (ev === 'connection') this.conn.push(f); }
  to(room) { return { emit: (ev, d) => this.socks.forEach(s => s.rooms.has(room) && s._recv(ev, d)) }; }
  emit(ev, d) { this.socks.forEach(s => s._recv(ev, d)); }
  connect(token) { return new Client(this, token); } }
class Client { constructor(io, token) { this.io = io; this.got = []; this.h = {}; this.connected = false; this.token = token;
    const sock = this.s = { id: Math.random().toString(36).slice(2), handshake: { auth: { token } }, rooms: new Set(), h: {},
      join(r) { this.rooms.add(r); }, emit: (ev, d) => this._recv(ev, d), on(ev, f) { this.h[ev] = f; }, _recv: (ev, d) => this._recv(ev, d) };
    let err = null; const run = i => { if (i >= io.mw.length) return; io.mw[i](sock, e => { if (e) err = e; else run(i + 1); }); }; run(0);
    if (err) { this.error = err; return; }
    io.socks.add(sock); this.connected = true; io.conn.forEach(f => f(sock)); }
  _recv(ev, d) { this.got.push([ev, d]); (this.h[ev] || []).forEach(f => f(d)); }
  on(ev, f) { (this.h[ev] = this.h[ev] || []).push(f); }
  emit(ev, d) { if (this.connected && this.s.h[ev]) this.s.h[ev](d === undefined ? undefined : JSON.parse(JSON.stringify(d))); }
  last(ev) { for (let i = this.got.length - 1; i >= 0; i--) if (this.got[i][0] === ev) return this.got[i][1]; }
  all(ev) { return this.got.filter(g => g[0] === ev).map(g => g[1]); }
  disconnect() { if (!this.connected) return; this.connected = false; this.io.socks.delete(this.s); this.s.h.disconnect && this.s.h.disconnect(); } }
exports.Server = Srv;
