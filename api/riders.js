// Admin: set up riders. Header x-admin-key required.
//   GET                                   → { riders:[… incl. login code …] }
//   POST { rider, photo }                 → create / update. photo: 'data:image/jpeg;base64,…' to set, null to remove, absent = keep
//   DELETE { id }                         → remove the rider, their code, photo, plan, feedback, routes and push subscription
var getRedis = require('./_redis').getRedis;
var requireAdmin = require('./_admin').requireAdmin;
var R = require('./_riders');

function str(v, n){ return String(v == null ? '' : v).trim().slice(0, n); }
function num(v, lo, hi){ var x = Number(v); return isFinite(x) && x >= lo && x <= hi ? Math.round(x * 10) / 10 : null; }

module.exports = async function handler(req, res){
  if (!requireAdmin(req, res)) return;
  try{
    var redis = getRedis();
    if (req.method === 'GET'){
      var list = await R.allRiders(redis);
      res.status(200).json({ riders: list.map(function(r){ var o = R.publicRider(r); o.code = r.code; return o; })
        .sort(function(a, b){ return (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName); }) });
      return;
    }
    var b = req.body || {};
    if (req.method === 'POST'){
      var x = b.rider || {};
      var prev = x.id ? await R.getRider(redis, x.id) : null;
      var r = prev || { id: 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString() };
      r.firstName = str(x.firstName, 40); r.lastName = str(x.lastName, 40);
      if (!r.firstName || !r.lastName){ res.status(400).json({ error: 'First and last name are required.' }); return; }
      if ('teamId' in x){
        var tm = x.teamId ? R.parse(await redis.hget('rootahead:teams', String(x.teamId))) : null;
        r.teamId = tm ? tm.id : ''; r.team = tm ? tm.name : '';
      } else if ('team' in x) r.team = str(x.team, 40);
      r.sex = ['M','F','X'].indexOf(x.sex) !== -1 ? x.sex : '';
      r.birthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(x.birthDate || '')) ? x.birthDate : '';
      r.heightCm = num(x.heightCm, 100, 230); r.weightKg = num(x.weightKg, 25, 200); r.ftp = num(x.ftp, 50, 700);
      r.notes = str(x.notes, 300);
      r.nickname = str(x.nickname, 30);
      // login code: unique, 4–12 letters/digits
      var code = R.normCode(x.code) || (prev && prev.code) || R.newCode();
      if (code.length < 4){ res.status(400).json({ error: 'The login code needs at least 4 letters or digits.' }); return; }
      var owner = await redis.hget('rootahead:ridercodes', code);
      if (owner && owner !== r.id){ res.status(409).json({ error: 'That login code is already used by another rider.' }); return; }
      if (prev && prev.code && prev.code !== code) await redis.hdel('rootahead:ridercodes', prev.code);
      r.code = code;
      var ce = {}; ce[code] = r.id; await redis.hset('rootahead:ridercodes', ce);
      // photo
      if (b.photo === null){ await redis.del('rootahead:riderphoto:' + r.id); r.hasPhoto = false; }
      else if (typeof b.photo === 'string'){
        var m = b.photo.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!m || m[2].length > 700000){ res.status(400).json({ error: 'The photo must be a JPEG/PNG/WebP under about 500 KB.' }); return; }
        await redis.set('rootahead:riderphoto:' + r.id, JSON.stringify({ type: 'image/' + m[1], data: m[2] }));
        r.hasPhoto = true; r.photoV = (r.photoV || 0) + 1;
      }
      r.updatedAt = new Date().toISOString();
      await R.saveRider(redis, r);
      // keep the profile copy used by messages / route stats in step
      var pe = {}; pe[r.id] = JSON.stringify({ firstName: r.firstName, lastName: r.lastName, team: r.team }); await redis.hset('rootahead:users', pe);
      var out = R.publicRider(r); out.code = r.code;
      res.status(200).json({ ok: true, rider: out });
      return;
    }
    if (req.method === 'DELETE'){
      var d = await R.getRider(redis, b.id);
      if (!d){ res.status(404).json({ error: 'Rider not found.' }); return; }
      var id = d.id;
      await redis.hdel('rootahead:riders', id);
      if (d.code) await redis.hdel('rootahead:ridercodes', d.code);
      var routeIds = (await redis.lrange('rootahead:user:' + id + ':routes', 0, -1)) || [];
      var keys = ['rootahead:riderphoto:' + id, 'rootahead:plan:' + id, 'rootahead:planlog:' + id, 'rootahead:planroutes:' + id,
                  'rootahead:planarchive:' + id, 'rootahead:user:' + id + ':routes'].concat(routeIds.map(function(x){ return 'rootahead:route:' + x; }));
      for (var i = 0; i < keys.length; i += 50) await redis.del.apply(redis, keys.slice(i, i + 50));
      await redis.srem('rootahead:plans', id);
      await redis.hdel('rootahead:push:users', id); await redis.hdel('rootahead:users', id);
      await redis.hdel('rootahead:users:routecount', id); await redis.hdel('rootahead:planperm', id);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'Use GET, POST or DELETE' });
  } catch(err){
    res.status(err && err.notConfigured ? 503 : 500).json({ error: err && err.message ? err.message : 'Rider request failed' });
  }
};
