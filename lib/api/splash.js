// Splash screen settings (RA Admin → Splash).
//   GET                         → { splash:{…settings, bgUrl, logoUrl} }   public: every app start reads it
//   GET ?img=bg|logo&v=…        → the uploaded background / logo image
//   POST {action:'check'}       → is the splash code right?
//   POST {splash, bg, logo}     → save. bg/logo: 'data:image/…;base64,…' to set, null = back to the default, absent = keep
// Saving needs the admin password (x-admin-key) AND the splash code (x-splash-key):
// SPLASH_PASSWORD in Vercel, or Admin321 when that variable is not set.
// Keys: rootahead:splash (JSON), rootahead:splashimg:bg, rootahead:splashimg:logo
var getRedis = require('./_redis').getRedis;
var requireAdmin = require('./_admin').requireAdmin;
var parse = require('./_riders').parse;

var KINDS = ['bg', 'logo'];
var MOTIONS = ['fall', 'snow', 'rise', 'flutter', 'confetti', 'fireworks'];
function str(v, n){ return String(v == null ? '' : v).trim().slice(0, n); }
function clamp(v, lo, hi, def){ var x = Number(v); return isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def; }
function splashCode(){ return String(process.env.SPLASH_PASSWORD || 'Admin321').trim(); }

function cleanOccasion(o, i){
  o = o || {};
  var when = ['yearly', 'once', 'easter'].indexOf(o.when) !== -1 ? o.when : 'once';
  var from = '', to = '';
  if (when === 'yearly'){ from = /^\d{2}-\d{2}$/.test(o.from) ? o.from : ''; to = /^\d{2}-\d{2}$/.test(o.to) ? o.to : ''; }
  else if (when === 'once'){ from = /^\d{4}-\d{2}-\d{2}$/.test(o.from) ? o.from : ''; to = /^\d{4}-\d{2}-\d{2}$/.test(o.to) ? o.to : ''; }
  else { from = Math.round(clamp(o.from, -90, 90, 0)); to = Math.round(clamp(o.to, -90, 90, 0)); }
  return {
    id: str(o.id, 30) || ('o' + Date.now().toString(36) + i),
    preset: str(o.preset, 30) || 'custom',
    name: str(o.name, 40) || 'Occasion',
    on: !!o.on,
    message: str(o.message, 60),
    motion: MOTIONS.indexOf(o.motion) !== -1 ? o.motion : 'fall',
    emojis: str(o.emojis, 60),
    colors: (Array.isArray(o.colors) ? o.colors : []).filter(function(c){ return /^#[0-9a-f]{6}$/i.test(c); }).slice(0, 6),
    amount: Math.round(clamp(o.amount, 1, 3, 2)),
    when: when, from: from, to: to
  };
}
function clean(x, prev){
  x = x || {}; prev = prev || {};
  var bg = x.bg || {}, logo = x.logo || {};
  return {
    durationS: Math.round(clamp(x.durationS, 1, 15, 5) * 2) / 2,
    bg: { custom: !!(prev.bg && prev.bg.custom), v: (prev.bg && prev.bg.v) || 0, opacity: Math.round(clamp(bg.opacity, 0, 1, 0.6) * 100) / 100 },
    logo: { custom: !!(prev.logo && prev.logo.custom), v: (prev.logo && prev.logo.v) || 0, opacity: Math.round(clamp(logo.opacity, 0, 1, 1) * 100) / 100,
            size: Math.round(clamp(logo.size, 50, 150, 100)) },
    showStats: x.showStats !== false, showTagline: x.showTagline !== false, showBar: x.showBar !== false, showCredit: x.showCredit !== false,
    tagline: str(x.tagline, 40),
    occasions: (Array.isArray(x.occasions) ? x.occasions : []).slice(0, 30).map(cleanOccasion)
  };
}
function withUrls(s){
  var o = Object.assign({}, s);
  o.bgUrl = s.bg && s.bg.custom ? '/api/splash?img=bg&v=' + s.bg.v : '';
  o.logoUrl = s.logo && s.logo.custom ? '/api/splash?img=logo&v=' + s.logo.v : '';
  return o;
}

module.exports = async function handler(req, res){
  try{
    var redis = getRedis(), q = req.query || {};
    if (req.method === 'GET' && q.img){
      if (KINDS.indexOf(q.img) === -1){ res.status(404).end(); return; }
      var p = parse(await redis.get('rootahead:splashimg:' + q.img));
      if (!p || !p.data){ res.status(404).end(); return; }
      res.setHeader('Content-Type', p.type || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');   // the URL changes (v=) with every new image
      res.status(200).send(Buffer.from(p.data, 'base64'));
      return;
    }
    if (req.method === 'GET'){
      var cur = parse(await redis.get('rootahead:splash'));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ splash: cur ? withUrls(cur) : null });
      return;
    }
    if (req.method !== 'POST'){ res.status(405).json({ error: 'Use GET or POST' }); return; }
    if (!requireAdmin(req, res)) return;
    if (String(req.headers['x-splash-key'] || '').trim() !== splashCode()){
      res.status(403).json({ error: 'Wrong splash code.', splashLocked: true }); return;
    }
    var b = req.body || {};
    if (b.action === 'check'){ res.status(200).json({ ok: true }); return; }

    var prev = parse(await redis.get('rootahead:splash')) || {};
    var s = clean(b.splash, prev);
    for (var i = 0; i < KINDS.length; i++){
      var k = KINDS[i], img = b[k];
      if (img === null){ await redis.del('rootahead:splashimg:' + k); s[k].custom = false; }
      else if (typeof img === 'string'){
        var m = img.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!m || m[2].length > 900000){ res.status(400).json({ error: 'The ' + (k === 'bg' ? 'background' : 'logo') + ' must be a JPEG/PNG/WebP under about 650 KB.' }); return; }
        await redis.set('rootahead:splashimg:' + k, JSON.stringify({ type: 'image/' + m[1], data: m[2] }));
        s[k].custom = true; s[k].v = (s[k].v || 0) + 1;
      }
    }
    s.updatedAt = new Date().toISOString();
    await redis.set('rootahead:splash', JSON.stringify(s));
    res.status(200).json({ ok: true, splash: withUrls(s) });
  } catch(err){
    res.status(err && err.notConfigured ? 503 : 500).json({ error: err && err.message ? err.message : 'Splash request failed' });
  }
};
