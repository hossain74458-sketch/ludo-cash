// পরীক্ষার জন্য: better-sqlite3-এর মতো API, ভেতরে Node-এর বিল্ট-ইন node:sqlite
const { DatabaseSync } = require('node:sqlite'), fs = require('fs');
class Stmt { constructor(st, pl) { this.st = st; this.pl = pl; }
  pluck() { return new Stmt(this.st, true); }
  run(...a) { const r = this.st.run(...a); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; }
  get(...a) { const r = this.st.get(...a); return r && this.pl ? Object.values(r)[0] : r; }
  all(...a) { const r = this.st.all(...a); return this.pl ? r.map(x => Object.values(x)[0]) : r; } }
module.exports = class Database {
  constructor(p) { this.p = p; this.d = new DatabaseSync(p); this.depth = 0; }
  pragma(s) { try { this.d.exec('PRAGMA ' + s); } catch (e) { /* ignore */ } }
  exec(s) { this.d.exec(s); }
  prepare(s) { return new Stmt(this.d.prepare(s), false); }
  transaction(fn) { return (...a) => {
    const top = this.depth === 0, sp = 'sp' + this.depth; this.d.exec(top ? 'BEGIN IMMEDIATE' : 'SAVEPOINT ' + sp); this.depth++;
    try { const r = fn(...a); this.depth--; this.d.exec(top ? 'COMMIT' : 'RELEASE ' + sp); return r; }
    catch (e) { this.depth--; this.d.exec(top ? 'ROLLBACK' : 'ROLLBACK TO ' + sp); if (!top) this.d.exec('RELEASE ' + sp); throw e; } }; }
  async backup(dest) { try { this.d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ } fs.copyFileSync(this.p, dest); }
  close() { this.d.close(); } };
