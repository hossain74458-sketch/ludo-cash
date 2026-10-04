// চালান: npm test   (বাইরের কোনো প্যাকেজ লাগে না — Node 22+ হলেই হয়)
const { spawnSync } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ludo-'));
const env = { ...process.env, NODE_PATH: path.join(__dirname, 'shims'), DATA_DIR: tmp, ADMIN_PASS: 'pw', PORT: '0', IDLE_MS: '400' };
const go = (arg) => spawnSync(process.execPath, ['--no-warnings', path.join(__dirname, 'server.test.js'), arg], { env, stdio: 'inherit' });
let r = go('main'); if (r.status) process.exit(r.status);
r = go('crash1'); // হঠাৎ বন্ধ (SIGKILL) — কোনো ক্লিন শাটডাউন ছাড়া
r = go('crash2'); process.exit(r.status || 0);
