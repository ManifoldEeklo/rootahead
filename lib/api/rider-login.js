// The rider app signs in with the login code the admin gave.
//   POST { code }                         → { rider }  (this device is now that rider)
//   POST { code, id, update:{…} }         → change own profile (needs the code again; code must be this rider's)
//   GET  ?id=…                            → { rider }  (refresh the profile; no code shown)
// Wrong codes are counted per network address: after 10 tries, wait 15 minutes.
var getRedis = require('./_redis').getRedis;
var R = require('./_riders');
var RIDER_FIELDS = ['nickname', 'sex', 'birthDate', 'heightCm', 'weightKg', 'ftp'];   // what a rider may change; name, team, photo, code: admin only

function num(v, lo, hi){ var x = Number(v); return isFinite(x) && x >= lo && x <= hi ? Math.round(x * 10) / 10 : null; }

module.exports = async function handler(req, res){
  try{
    var redis = getRedis();
    if (req.method === 'GET'){
      var g = await R.getAccount(redis, (req.query || {}).id);
      if (!g){ res.status(404).json({ error: 'This account no longer exists. Ask your coach for a new code.', gone: true }); return; }
      if (!R.sessionOk(g, req)){ R.signedOut(res); return; }
      await R.touchSession(redis, g.id, req);   // this phone is signed in and was just seen
      res.status(200).json({ rider: g.id.indexOf('s_') === 0 ? await R.staffPublic(redis, g) : await R.riderWithTeam(redis, g) });
      return;
    }
    if (req.method !== 'POST'){ res.status(405).json({ error: 'Use POST' }); return; }
    // log out on this phone: { logout:true, id }
    if ((req.body || {}).logout){
      var lo = await R.getAccount(redis, req.body.id), inst = R.installOf(req);
      if (lo && inst) await redis.hdel('rootahead:sessions:' + lo.id, inst);
      res.status(200).json({ ok: true });
      return;
    }
    var ip = String(req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || 'x').split(',')[0].trim().slice(0, 60);
    var failKey = 'rootahead:loginfail:' + ip;
    var fails = Number(await redis.get(failKey)) || 0;
    if (fails >= 10){ res.status(429).json({ error: 'Too many wrong codes. Wait 15 minutes and try again.' }); return; }
    var b = req.body || {}, code = R.normCode(b.code);
    var id = code ? await redis.hget('rootahead:ridercodes', code) : null;
    var r = id ? await R.getAccount(redis, id) : null;
    if (!r || r.code !== code){
      await redis.incr(failKey); await redis.expire(failKey, 900);
      res.status(401).json({ error: 'That code is not known. Check it with your coach.' });
      return;
    }
    if (b.update && typeof b.update === 'object' && r.id.indexOf('s_') === 0){ res.status(403).json({ error: 'Staff details are managed by the admin.' }); return; }
    if (b.update && typeof b.update === 'object'){
      // the code must belong to the rider who is signed in on this phone — never change someone else
      if (!b.id || b.id !== r.id){ res.status(403).json({ error: 'That is not your code.' }); return; }
      var u = b.update;
      if ('sex' in u) r.sex = ['M','F','X'].indexOf(u.sex) !== -1 ? u.sex : '';
      if ('birthDate' in u) r.birthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(u.birthDate || '')) ? u.birthDate : '';
      if ('heightCm' in u) r.heightCm = num(u.heightCm, 100, 230);
      if ('weightKg' in u) r.weightKg = num(u.weightKg, 25, 200);
      if ('ftp' in u) r.ftp = num(u.ftp, 50, 700);
      if ('nickname' in u) r.nickname = String(u.nickname || '').trim().slice(0, 30);
      r.updatedAt = new Date().toISOString(); r.updatedByRider = r.updatedAt;
      await R.saveRider(redis, r);
    } else {
      r.lastLoginAt = new Date().toISOString();
      if (r.id.indexOf('s_') === 0) await R.saveStaff(redis, r); else await R.saveRider(redis, r);
      await R.touchSession(redis, r.id, req);
    }
    if (r.id.indexOf('s_') === 0){ res.status(200).json({ rider: await R.staffPublic(redis, r) }); return; }
    res.status(200).json({ rider: await R.riderWithTeam(redis, r), riderFields: RIDER_FIELDS });
  } catch(err){
    res.status(err && err.notConfigured ? 503 : 500).json({ error: err && err.message ? err.message : 'Login failed' });
  }
};
