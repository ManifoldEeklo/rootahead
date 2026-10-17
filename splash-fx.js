/* ROOT-Ahead splash screen: settings, special occasions and their animations.
   Shared by the rider app (index.html) and RA Admin (admin/index.html), so the
   admin's preview looks exactly like the phones. Exposes window.RASplashFX.

   Settings (stored in Redis as rootahead:splash, edited in RA Admin → Splash):
     durationS            seconds the splash stays (1–15)
     bg   {custom, v, opacity}     background photo (default: the team photo)
     logo {custom, v, opacity, size}  logo overlay (default: the ROOT Ahead logo)
     showStats, showTagline, showBar, showCredit, tagline
     occasions [ {id, preset, name, on, message, motion, emojis, colors[], amount 1–3,
                  when:'yearly'|'once'|'easter', from, to} ]
       yearly: from/to 'MM-DD' (may wrap over New Year)   once: 'YYYY-MM-DD'
       easter: from/to = days relative to Easter Sunday (moves every year)
   The first occasion in the list that is switched on and active today is shown. */
(function(){
  'use strict';

  var DEFAULTS = {
    durationS: 5,
    bg: { custom: false, v: 0, opacity: 0.6 },
    logo: { custom: false, v: 0, opacity: 1, size: 100 },
    showStats: true, showTagline: true, showBar: true, showCredit: true,
    tagline: 'Manage-Plot-Train',
    occasions: []
  };

  // Ready-made occasions. Dates are suggestions; the admin can change everything.
  var PRESETS = [
    { preset: 'halloween', name: 'Halloween', message: 'Happy Halloween!', motion: 'flutter', emojis: '🦇🎃👻🦇', colors: ['#ff7a1a', '#7b3fa0', '#1a1a1a'], when: 'yearly', from: '10-24', to: '10-31' },
    { preset: 'sinterklaas', name: 'Sinterklaas', message: 'Dag Sinterklaasje!', motion: 'fall', emojis: '🎁🍪🥕🍬', colors: ['#d4202c', '#f2c14e', '#ffffff'], when: 'yearly', from: '11-28', to: '12-06' },
    { preset: 'christmas', name: 'Christmas', message: 'Merry Christmas', motion: 'snow', emojis: '❄️🎄⭐', colors: ['#ffffff', '#d9ecff'], when: 'yearly', from: '12-18', to: '12-26' },
    { preset: 'newyear', name: 'New Year', message: 'Happy New Year!', motion: 'fireworks', emojis: '🎆', colors: ['#fbc120', '#ff5d5d', '#5dd0ff', '#ffffff', '#9dff7a'], when: 'yearly', from: '12-31', to: '01-02' },
    { preset: 'valentine', name: "Valentine's Day", message: 'Ride with love', motion: 'rise', emojis: '❤️💛💕', colors: ['#ff4d6d', '#ffb3c1'], when: 'yearly', from: '02-12', to: '02-14' },
    { preset: 'carnival', name: 'Carnival', message: 'Carnival time!', motion: 'confetti', emojis: '🎭', colors: ['#ff3d7f', '#fbc120', '#3fd0ff', '#7dff6a', '#b26bff'], when: 'easter', from: -52, to: -46 },
    { preset: 'easter', name: 'Easter', message: 'Happy Easter', motion: 'fall', emojis: '🥚🐣🐰🌷', colors: ['#ffd6e8', '#c9f2d0', '#fff2a8'], when: 'easter', from: -7, to: 1 },
    { preset: 'classics', name: 'Spring classics', message: 'Classics season', motion: 'flutter', emojis: '🚴🚴‍♀️🦁', colors: ['#fbc120', '#111111'], when: 'yearly', from: '03-28', to: '04-06' },
    { preset: 'tour', name: 'Tour de France', message: 'Allez allez!', motion: 'confetti', emojis: '🚴', colors: ['#ffd400', '#ffffff', '#3cb043', '#e2231a'], when: 'yearly', from: '07-04', to: '07-26' },
    { preset: 'olympics', name: 'Olympic Games', message: 'Go for gold!', motion: 'confetti', emojis: '🏅', colors: ['#0081c8', '#fcb131', '#000000', '#00a651', '#ee334e'], when: 'once', from: '2028-07-14', to: '2028-07-30' },
    { preset: 'worldcup', name: 'World Cup', message: 'Come on Belgium!', motion: 'fall', emojis: '⚽🏆', colors: ['#e30613', '#fdda24', '#000000'], when: 'once', from: '', to: '' },
    { preset: 'celebration', name: 'Celebration', message: 'Congratulations!', motion: 'confetti', emojis: '🎉🎈🥳', colors: ['#fbc120', '#ff6b6b', '#4ecdc4', '#ffffff'], when: 'once', from: '', to: '' },
    { preset: 'custom', name: 'Own occasion', message: '', motion: 'fall', emojis: '⭐', colors: ['#fbc120', '#ffffff'], when: 'once', from: '', to: '' }
  ];

  var MOTIONS = [
    { id: 'fall', name: 'Falling' }, { id: 'snow', name: 'Snow' }, { id: 'rise', name: 'Floating up' },
    { id: 'flutter', name: 'Flying across' }, { id: 'confetti', name: 'Confetti' }, { id: 'fireworks', name: 'Fireworks' }
  ];

  /* ---------- dates (local calendar days, no time zones involved) ---------- */
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s){ var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function addDays(d, n){ var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  // Easter Sunday (Gregorian, anonymous algorithm)
  function easter(y){
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
        g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
        l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
        month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  // the occurrence (from/to as Date) that contains `today`, or else the next one; null if never
  function occurrence(o, today){
    today = today || new Date();
    var t = new Date(today.getFullYear(), today.getMonth(), today.getDate()), y = t.getFullYear();
    function span(f, to){ return f && to && to >= f ? { from: f, to: to } : null; }
    if (o.when === 'once'){ return span(parseYmd(o.from), parseYmd(o.to)); }
    if (o.when === 'easter'){
      var f0 = Number(o.from) || 0, t0 = Number(o.to) || 0;
      for (var yy = y - 1; yy <= y + 1; yy++){
        var e = easter(yy), s = span(addDays(e, f0), addDays(e, t0));
        if (s && s.to >= t) return s;
      }
      return null;
    }
    // yearly MM-DD
    if (!/^\d{2}-\d{2}$/.test(o.from || '') || !/^\d{2}-\d{2}$/.test(o.to || '')) return null;
    for (var yr = y - 1; yr <= y + 1; yr++){
      var a = parseYmd(yr + '-' + o.from), b = parseYmd((o.to < o.from ? yr + 1 : yr) + '-' + o.to);
      if (a && b && b >= t) return { from: a, to: b };
    }
    return null;
  }
  function isActive(o, today){
    if (!o || !o.on) return false;
    var r = occurrence(o, today), t = today || new Date(); t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return !!(r && r.from <= t && t <= r.to);
  }
  function activeOccasion(cfg, today){
    var list = (cfg && cfg.occasions) || [];
    for (var i = 0; i < list.length; i++) if (isActive(list[i], today)) return list[i];
    return null;
  }
  function normalize(cfg){
    var c = JSON.parse(JSON.stringify(DEFAULTS));
    if (!cfg || typeof cfg !== 'object') return c;
    Object.keys(DEFAULTS).forEach(function(k){
      if (!(k in cfg)) return;
      if (k === 'bg' || k === 'logo') c[k] = Object.assign(c[k], cfg[k] || {});
      else c[k] = cfg[k];
    });
    ['bgUrl', 'logoUrl', 'updatedAt'].forEach(function(k){ if (cfg[k]) c[k] = cfg[k]; });
    return c;
  }

  /* ---------- animation ---------- */
  function glyphs(s){
    s = String(s || '');
    var out = [];
    if (window.Intl && Intl.Segmenter){ var it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s); for (var x of it) out.push(x.segment); }
    else out = Array.from(s);
    return out.filter(function(g){ return g.trim(); }).slice(0, 12);
  }
  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
  var spriteCache = {};
  function sprite(g, size){
    var key = g + '|' + size;
    if (spriteCache[key]) return spriteCache[key];
    var c = document.createElement('canvas'), pad2 = Math.ceil(size * 0.3);
    c.width = c.height = size + pad2 * 2;
    var x = c.getContext('2d');
    x.font = size + 'px ' + EMOJI_FONT; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(g, c.width / 2, c.height / 2 + size * 0.06);
    return (spriteCache[key] = c);
  }
  function rnd(a, b){ return a + Math.random() * (b - a); }
  function pick(a){ return a[Math.floor(Math.random() * a.length)]; }

  // Starts the animation on `canvas` (sized to its box). Returns a stop() function.
  function run(canvas, o){
    if (!canvas || !o) return function(){};
    var ctx = canvas.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2), W = 0, H = 0;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var G = glyphs(o.emojis), C = (o.colors && o.colors.length ? o.colors : ['#fbc120', '#ffffff']);
    var amount = [0.5, 1, 1.8][Math.max(0, Math.min(2, (Number(o.amount) || 2) - 1))];
    var motion = o.motion || 'fall', parts = [], sparks = [], raf = 0, last = 0, stopped = false, nextRocket = 0;
    function resize(){
      var r = canvas.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    var scale = Math.max(0.6, Math.min(1.4, Math.min(W, H) / 420));
    function base(){ return { x: rnd(0, W), y: rnd(0, H), ph: rnd(0, 6.28), rot: rnd(-0.4, 0.4), vr: rnd(-0.8, 0.8) }; }
    function make(initial){
      var p = base();
      if (motion === 'snow'){
        p.flake = !G.length || Math.random() < 0.8; p.size = p.flake ? rnd(2, 5.5) * scale : rnd(16, 26) * scale;
        p.vy = rnd(25, 60) * scale; p.sway = rnd(10, 30); if (!initial) p.y = -20;
        p.g = G.length ? pick(G) : null; p.c = pick(C);
      } else if (motion === 'confetti'){
        p.w = rnd(6, 11) * scale; p.h = rnd(10, 18) * scale; p.c = pick(C); p.vy = rnd(70, 140) * scale; p.sway = rnd(15, 40);
        p.vr = rnd(-4, 4); p.flip = rnd(2, 6); if (!initial) p.y = -20;
        if (G.length && Math.random() < 0.12){ p.g = pick(G); p.size = rnd(18, 28) * scale; }
      } else if (motion === 'rise'){
        p.g = pick(G.length ? G : ['●']); p.size = rnd(20, 38) * scale; p.vy = -rnd(35, 75) * scale; p.sway = rnd(12, 30); if (!initial) p.y = H + 30;
      } else if (motion === 'flutter'){
        p.g = pick(G.length ? G : ['●']); p.size = rnd(22, 40) * scale; p.dir = Math.random() < 0.5 ? 1 : -1;
        p.vx = p.dir * rnd(50, 110) * scale; p.y = rnd(H * 0.05, H * 0.7); p.bob = rnd(10, 26);
        if (!initial) p.x = p.dir > 0 ? -40 : W + 40;
      } else { // fall
        p.g = pick(G.length ? G : ['●']); p.size = rnd(20, 36) * scale; p.vy = rnd(45, 95) * scale; p.sway = rnd(10, 30); if (!initial) p.y = -40;
      }
      return p;
    }
    var counts = { snow: 90, confetti: 70, rise: 16, flutter: 9, fall: 20, fireworks: 0 };
    var n = Math.round((counts[motion] || 20) * amount * (reduce ? 0.4 : 1));
    for (var i = 0; i < n; i++) parts.push(make(true));

    function rocket(){
      var x = rnd(W * 0.15, W * 0.85), y = rnd(H * 0.12, H * 0.45), c = pick(C), k = Math.round(rnd(28, 46) * amount);
      for (var j = 0; j < k; j++){
        var a = (j / k) * 6.283 + rnd(-0.1, 0.1), sp = rnd(60, 170) * scale;
        sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.9, 1.6), age: 0, c: Math.random() < 0.8 ? c : pick(C) });
      }
      if (G.length && Math.random() < 0.5) sparks.push({ x: x, y: y, vx: 0, vy: 10, life: 1.2, age: 0, g: pick(G), size: 30 * scale });
    }
    function drawGlyph(g, x, y, size, rot, alpha){
      var s = sprite(g, Math.round(size)); ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.drawImage(s, -s.width / 2, -s.height / 2); ctx.restore();
    }
    function frame(ts){
      if (stopped) return;
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
      if (reduce) dt *= 0.35;
      var t = ts / 1000;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < parts.length; i++){
        var p = parts[i];
        if (motion === 'flutter'){
          p.x += p.vx * dt; var by = p.y + Math.sin(t * 3 + p.ph) * p.bob, flap = 0.75 + 0.25 * Math.abs(Math.sin(t * 9 + p.ph));
          ctx.save(); ctx.translate(p.x, by); ctx.scale(-p.dir * flap, 1);   // emoji riders face left: mirror them when they fly right drawGlyph(p.g, 0, 0, p.size, 0); ctx.restore();
          if ((p.dir > 0 && p.x > W + 50) || (p.dir < 0 && p.x < -50)) parts[i] = make(false);
          continue;
        }
        p.y += p.vy * dt; p.x += Math.sin(t * 1.3 + p.ph) * p.sway * dt; p.rot += p.vr * dt;
        if (motion === 'snow'){
          if (p.flake){ ctx.globalAlpha = 0.85; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1; }
          else drawGlyph(p.g, p.x, p.y, p.size, p.rot * 0.3, 0.9);
        } else if (motion === 'confetti' && !p.g){
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(t * p.flip + p.ph));
          ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        } else drawGlyph(p.g, p.x, p.y, p.size, motion === 'rise' ? Math.sin(t + p.ph) * 0.15 : p.rot * 0.4);
        if ((p.vy > 0 && p.y > H + 40) || (p.vy < 0 && p.y < -50)) parts[i] = make(false);
      }
      if (motion === 'fireworks'){
        if (t > nextRocket){ rocket(); nextRocket = t + rnd(0.35, 0.9) / amount; }
        for (var s = sparks.length - 1; s >= 0; s--){
          var k = sparks[s]; k.age += dt; if (k.age > k.life){ sparks.splice(s, 1); continue; }
          k.vy += 90 * scale * dt; k.vx *= 0.985; k.vy *= 0.985; k.x += k.vx * dt; k.y += k.vy * dt;
          var al = 1 - k.age / k.life;
          if (k.g) drawGlyph(k.g, k.x, k.y, k.size, 0, al);
          else { ctx.globalAlpha = al; ctx.fillStyle = k.c; ctx.beginPath(); ctx.arc(k.x, k.y, 2.2 * scale, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1; }
        }
      }
      raf = requestAnimationFrame(frame);
    }
    var onResize = function(){ resize(); };
    window.addEventListener('resize', onResize);
    raf = requestAnimationFrame(frame);
    return function stop(){ stopped = true; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); ctx.clearRect(0, 0, W, H); };
  }

  window.RASplashFX = {
    DEFAULTS: DEFAULTS, PRESETS: PRESETS, MOTIONS: MOTIONS,
    normalize: normalize, easter: easter, occurrence: occurrence, isActive: isActive, activeOccasion: activeOccasion,
    ymd: ymd, parseYmd: parseYmd, glyphs: glyphs, run: run
  };
})();
