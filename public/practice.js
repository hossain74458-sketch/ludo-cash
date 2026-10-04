// বটের সাথে ফ্রি প্র্যাকটিস: টাকা/সার্ভার/ম্যাচ কিছুই লাগে না। গেমের নিয়ম আগের মতোই; শুধু পাশা ও চাল এখানেই চলে।
// game.html ?practice=1 হলে net.js-এর বদলে এটি লোড হয় (NET নামে একই ইন্টারফেস)।
const NET = (() => {
  const BOTS = ['Rafi', 'Sumon', 'Mim', 'Tania', 'Rakib', 'Nusrat', 'Sajib', 'Jerin', 'Tamim', 'Priya'];
  let ended = false;
  const FIRST = {};   // 🍀 প্রত্যেক খেলোয়াড় (মানুষ ও বট) প্রথম ১–৪ পাশার মধ্যে একটি ৬ পাবেই — টাকার ম্যাচে সার্ভার যেভাবে দেয়, এখানেও একই নিয়ম
  const NB = Math.min(3, Math.max(1, parseInt(new URLSearchParams(location.search).get('bots'), 10) || 1));   // কয়জন বটের সাথে খেলবেন (১–৩)
  const $ = id => document.getElementById(id);
  function loadAv(j, src) {
    const im = new Image();
    im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 128; c.getContext('2d').drawImage(im, 0, 0, 128, 128); AVS[j] = c; if (G && G.pl[j]) G.pl[j].av = c; };
    im.src = src;
  }
  return {
    color: 0,
    rnd(n) {
      let v = Math.floor(Math.random() * n);
      if (n === 6 && typeof G !== 'undefined' && G) {        // n===6 মানেই পাশা ছোঁড়া; যে ছুঁড়ছে তার হিসাব আলাদা
        const f = FIRST[cur().p] || (FIRST[cur().p] = { n: 0, six: false, at: 1 + Math.floor(Math.random() * 4) });
        if (!f.six) { f.n++; if (v === 5) f.six = true; else if (f.n >= f.at) { v = 5; f.six = true; } }
      }
      return Promise.resolve(v);
    },
    act(a) {
      if (ended || !G || G.phase === 'over' || cur().p !== 0) return;
      const me = cur();
      if (a.t === 'roll') { if (G.phase === 'roll' && !G.moving) roll(); }
      else if (a.t === 'move') { if (G.phase === 'move' && G.mv.includes(a.i)) move(a.i); }
      else if (a.t === 'card') { if ((G.phase === 'roll' || G.phase === 'pick') && !G.moving && me.c.includes(a.k) && canUse(me, a.k)) playCard(me, a.k, a.a || {}); }
    },
    emoji(e) { if (typeof blast === 'function') blast(e, NAMES[0] || 'আপনি'); },
    back() {},
    resign() { location.href = '/'; },
    over() { ended = true; },
    boot() {
      $('menu').style.display = 'none';
      NAMES[0] = 'আপনি';
      const pool = BOTS.slice().sort(() => Math.random() - .5);
      for (let j = 1; j <= NB; j++) NAMES[j] = pool[j - 1] + ' (বট)';
      newGame(NB + 1, 1, 4, true, 0, true);                 // ১ জন মানুষ + NB জন বট (মোট ২–৪ জন), ৪টি ঘুঁটি, আগে সব ঘরে তুললে জয়
      G.hl = true;                                          // বট মানুষের মতো খেলবে (ভুল করে, সময় নেয়, কার্ড ব্যবহার করে)
      const pz = $('prize'); pz.style.display = 'block'; pz.textContent = '🤖 ফ্রি প্র্যাকটিস (' + NB + 'টি বট) — কোনো টাকার লেনদেন নেই';
      const lv = $('lv'); lv.textContent = '🏠 লবিতে যান'; lv.style.background = ''; lv.style.color = ''; lv.style.borderColor = ''; lv.onclick = () => { location.href = '/'; };
      const again = document.createElement('button'); again.className = 'go'; again.textContent = '🔁 আবার খেলুন'; again.onclick = () => location.reload(); $('wb').before(again);
      const tk = localStorage.getItem('tk');                // লগইন থাকলে নিজের নাম ও ছবি দেখাবে
      if (tk) fetch('/api/me', { headers: { Authorization: 'Bearer ' + tk } }).then(r => r.ok ? r.json() : null).then(m => {
        if (!m) return; NAMES[0] = m.username; if (G && G.pl[0]) G.pl[0].name = m.username.slice(0, 18); if (m.avatar) loadAv(0, m.avatar); ui();
      }).catch(() => {});
    }
  };
})();
