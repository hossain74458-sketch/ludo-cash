// অনলাইন লেয়ার: গেমের নিয়ম/গ্রাফিক্স অপরিবর্তিত; এটি শুধু দুই খেলোয়াড়কে সিঙ্ক করে, টাইমার/বট চালায়, ইমোজি পাঠায় ও ফলাফল জানায়।
const NET = (() => {
  const $ = id => document.getElementById(id);
  const roomId = new URLSearchParams(location.search).get('room'), token = localStorage.getItem('tk');
  let socket, S = null, queue = [], lastSeq = 0, rk = 0, ended = false, hintKey = '', TM = null, BR = Math.random;
  const pend = new Map();
  const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const ser = a => { if (a.t !== 'card') return a; const x = {}; for (const f in (a.a || {})) { const v = a.a[f]; x[f] = v && typeof v === 'object' && 'p' in v ? v.p : v; } return { t: 'card', k: a.k, a: x }; };
  const de = x => { const o = {}; for (const f in x) o[f] = (f === 'pl' || f === 'opp') ? G.pl.find(p => p.p === x[f]) : x[f]; return o; };
  const BTN = 'style="margin-top:8px;padding:8px 14px;border:0;border-radius:8px;background:#e53935;color:#fff;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer"';
  function banner(html, btn) {            // btn: 'lobby' | 'back' | ফাঁকা
    let b = $('netBanner');
    if (!b) { b = document.createElement('div'); b.id = 'netBanner';
      b.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:50;background:#111e;color:#fff;padding:10px 16px;border-radius:14px;font:600 14px/1.5 "Noto Sans Bengali","Hind Siliguri","Nirmala UI",system-ui,sans-serif;text-align:center;max-width:92vw;box-shadow:0 4px 20px #000a';
      document.body.append(b); }
    b.innerHTML = html + (btn === 'lobby' ? `<br><button ${BTN} onclick="location.href='/'">লবিতে ফিরুন</button>` : btn === 'back' ? `<br><button ${BTN} onclick="NET.back()">✋ আমি ফিরেছি</button>` : '');
    b.style.display = 'block';
  }
  const hideBanner = () => { const b = $('netBanner'); if (b && !ended) b.style.display = 'none'; };
  function finishUi() { ended = true; const lv = $('lv'); if (lv) lv.style.display = 'none'; const l = $('leave'); if (l) l.style.display = 'none'; }
  const idle = () => typeof G !== 'undefined' && G && !G.moving && (G.phase === 'roll' || G.phase === 'move' || G.phase === 'pick');
  // যে খেলোয়াড় অপেক্ষা করছে সে সার্ভারকে জানায় এখন কার চাল; সার্ভার সময় গোনে (৩০ সেকেন্ড → ১৫ সেকেন্ড → বট)
  function hint() {
    if (!idle() || queue.length) return;
    const c = cur().p; if (c === NET.color) return;
    const k = c + ':' + lastSeq; if (k === hintKey) return;
    hintKey = k; socket.emit('turn', { roomId, color: c, seq: lastSeq });
  }
  function tick() {                      // স্ক্রিনে কাউন্টডাউন
    const t = $('tmr'); if (!t) return;
    if (!S || ended || !idle() || queue.length || !TM || TM.seq !== lastSeq || TM.c !== cur().p || TM.ms <= 2500) { t.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((TM.ms - (Date.now() - TM.t0)) / 1000));
    t.textContent = '⏳ ' + left + ' সেকেন্ড'; t.style.color = left <= 10 ? '#e53935' : '';
  }
  function setBot(c, on) {
    if (typeof G === 'undefined' || !G) return;
    const pl = G.pl.find(p => p.p === c); if (pl) { pl.bot = on; ui(); }
    if (ended) return;
    if (on) banner(c === NET.color
      ? '⚠️ আপনি সময়মতো চাল না দেওয়ায় আপনার হয়ে সহজ বট খেলছে। নিজে খেলতে নিচের বোতাম চাপুন।'
      : '🤖 প্রতিপক্ষ ফিরছে না, তাই তার হয়ে সহজ বট খেলছে। সে ফিরে এলে বট থেমে যাবে।', c === NET.color ? 'back' : '');
    else hideBanner();
  }
  function pump() {                      // লগের অ্যাকশনগুলো একে একে চালায়, শুধু গেম থেমে থাকলে
    if (!S || ended || typeof G === 'undefined' || !G) return;
    FAST = queue.length > 2;             // ফিরে এসে পুরনো চাল দ্রুত চালিয়ে বর্তমান অবস্থায় পৌঁছায়
    hint(); const e = queue[0]; if (!e || G.moving || G.phase === 'anim') return;
    const me = cur(), a = e.a; let ph = G.phase;
    const live = ph === 'roll' || ph === 'move' || ph === 'pick';
    if (a.t === 'skip') {                // সময় শেষ: চাল পরের জনের কাছে
      queue.shift();
      if (live && me.p === a.c) { G.cu = null; say('⏰ ' + me.name + ' সময়মতো চাল দেয়নি — চাল পরের জনের কাছে গেল'); next(); }
      return;
    }
    if (a.t === 'bot') {                 // সহজ বট: সার্ভারের হুকুমে দুই ব্রাউজারে একই সিদ্ধান্ত (সিডেড র‍্যান্ডম)
      queue.shift();
      if (live && me.p === a.c) {
        if (ph === 'pick') { G.cu = null; G.phase = 'roll'; ph = 'roll'; }
        if (ph === 'roll') roll();
        else if (G.mv.length) move(G.mv[Math.floor(BR() * G.mv.length)]);
      }
      return;
    }
    if (ph === 'over' || S.col[e.u] !== me.p) return void queue.shift();
    if (a.t === 'roll') { queue.shift(); if (ph === 'roll') roll(); }
    else if (a.t === 'move') { queue.shift(); if (ph === 'move' && G.mv.includes(a.i)) move(a.i); }
    else if (a.t === 'card') { queue.shift(); if ((ph === 'roll' || ph === 'pick') && me.c.includes(a.k) && canUse(me, a.k)) playCard(me, a.k, de(a.a || {})); }
  }
  function loadAvatar(j, src) {
    const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 128; c.getContext('2d').drawImage(im, 0, 0, 128, 128); AVS[j] = c; if (G && G.pl[j]) G.pl[j].av = c; };
    im.src = src;
  }
  return {
    color: -1,
    rnd(n) { return new Promise(res => { const k = rk++; pend.set(k, { res, n }); socket.emit('rnd', { roomId, k, n }); }); },
    act(a) {
      if (ended || typeof G === 'undefined' || !G || cur().p !== NET.color || (a.t === 'roll' && G.phase !== 'roll')) return;
      socket.emit('act', { roomId, a: ser(a) });
    },
    emoji(e) { if (!ended) socket.emit('emoji', { roomId, e }); },
    back() { socket.emit('back', { roomId }); },
    resign() { if (!ended) socket.emit('resign', { roomId }); },
    over(winnerColor) { socket.emit('result', { roomId, winnerColor }); banner('ফলাফল নিশ্চিত করা হচ্ছে…'); },
    boot() {
      if (!token || !roomId) return void (location.href = '/');
      $('menu').style.display = 'none'; $('wb').textContent = 'লবিতে ফিরুন';
      socket = io({ auth: { token } });
      socket.on('connect', () => { hintKey = ''; socket.emit('enterRoom', { roomId, resync: !!S }); pend.forEach((p, k) => socket.emit('rnd', { roomId, k, n: p.n })); });
      socket.on('connect_error', () => { location.href = '/'; });
      socket.on('roomClosed', d => {
        finishUi(); let t = 'এই ম্যাচ শেষ হয়ে গেছে।';
        if (d && d.me) {
          if (d.winnerId === d.me) t = `🏆 আপনি জিতেছেন! ৳${d.payout} আপনার ওয়ালেটে যোগ হয়েছে`;
          else if (d.winnerId) t = `😞 আপনি হেরেছেন। ৳${d.bet} হারিয়েছেন`;
          else if (d.disputed) t = '⚠️ ফলাফল নিয়ে সমস্যা হয়েছে। অ্যাডমিন দেখা পর্যন্ত টাকা আটকে থাকবে।';
          else t = 'ম্যাচ বাতিল হয়েছে, আপনার টাকা ফেরত দেওয়া হয়েছে।';
        }
        banner(t, 'lobby');
      });
      socket.on('roomState', s => {
        if (!S) {
          S = { me: s.me, bet: s.bet, col: Object.fromEntries(s.players.map(p => [p.id, p.color])) }; NET.color = S.col[s.me];
          BR = mulberry(s.seed || 1);
          const P = s.players.slice().sort((a, b) => a.color - b.color); NAMES[0] = P[0].username; NAMES[1] = P[1].username;
          newGame(2, 2, 4, true, s.bet, true);                     // ২ জন খেলোয়াড়, ২ জনই মানুষ, ৪টি ঘুঁটি, আগে ঘরে তুললে জয়
          P.forEach((p, j) => { if (p.avatar) loadAvatar(j, p.avatar); });
          const pot = s.bet * 2; G.pot = pot - Math.floor(pot * s.fee / 100);
          $('prize').textContent = `🏆 পুরস্কার: ৳${G.pot}  (মোট পুল ৳${pot}, ${s.fee}% ফি কাটার পর)`;
          const lv = $('lv'); if (lv) lv.style.display = '';
          setInterval(tick, 250);
        }
        (s.bots || []).forEach(c => setBot(c, true));
        for (const e of s.log) if (e.seq > lastSeq) { lastSeq = e.seq; queue.push(e); }
      });
      socket.on('act', e => { if (e.seq === lastSeq + 1) { lastSeq = e.seq; queue.push(e); } else if (e.seq > lastSeq) socket.emit('enterRoom', { roomId, resync: true }); });
      socket.on('rndVal', ({ k, v }) => { const p = pend.get(k); if (p) { pend.delete(k); p.res(v); } });
      socket.on('turnTimer', t => { TM = { c: t.c, seq: t.seq, ms: t.ms, t0: Date.now() }; });
      socket.on('botMode', d => setBot(d.c, d.on));
      socket.on('emoji', d => { if (typeof blast === 'function') blast(d.e, d.name); });
      socket.on('opponentDisconnected', () => banner('প্রতিপক্ষের নেট চলে গেছে বা তিনি বেরিয়ে গেছেন। খেলা বন্ধ হবে না। চাল না দিলে প্রথমে চাল আপনার কাছে আসবে, এরপর সহজ বট তার হয়ে খেলবে; তিনি ফিরলে বট থেমে যাবে।'));
      socket.on('opponentReconnected', () => hideBanner());
      socket.on('disputed', () => { finishUi(); banner('⚠️ দুই পক্ষের ফলাফল মেলেনি। অ্যাডমিন দেখা পর্যন্ত টাকা আটকে থাকবে।', 'lobby'); });
      socket.on('gameOver', d => {
        finishUi(); if (typeof G !== 'undefined' && G) G.phase = 'over';
        const win = d.winnerId === S.me;
        banner(d.forfeit
          ? (win ? `🏆 প্রতিপক্ষ গেম থেকে বেরিয়ে গেছে, তাই আপনি জিতেছেন! ৳${d.payout} আপনার ওয়ালেটে যোগ হয়েছে` : `😞 আপনি গেম থেকে বেরিয়ে গেছেন, তাই হেরেছেন। ৳${S.bet} হারিয়েছেন`)
          : (win ? `🏆 আপনি জিতেছেন! ৳${d.payout} আপনার ওয়ালেটে যোগ হয়েছে` : `😞 আপনি হেরেছেন। ৳${S.bet} হারিয়েছেন`), 'lobby');
      });
      setInterval(pump, 25);
    }
  };
})();
