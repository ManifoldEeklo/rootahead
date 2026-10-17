// Admin: staff members (sport director, coach, soigneur, mechanic…). Header x-admin-key.
//   GET                               → { staff:[… incl. login code, signed-in phones …], roles:[…] }
//   POST { staff, photo }             → create / update (photo as in /api/riders)
//   POST { action:'resetCode', id }   → new code, signed out everywhere
//   DELETE { id }                     → remove
// Key: rootahead:staff (hash id → JSON). Codes share rootahead:ridercodes with the riders, so every code is unique.
var getRedis = require('./_redis').getRedis;
var requireAdmin = require('./_admin').requireAdmin;
var R = require('./_riders');
function str(v, n){ return String(v == null ? '' : v).trim().slice(0, n); }

module.exports = async function handler(req, res){
  if (!requireAdmin(req, res)) return;
  try{
    var redis = getRedis(), b = req.body || {};
    if (req.method === 'GET'){
      var list = await R.allStaff(redis);
      for (var i = 0; i < list.length; i++){ var ss = await R.sessionsOf(redis, list[i].id); list[i].phones = ss.phones; list[i].lastSeenAt = ss.lastSeenAt; list[i].photoUrl = R.staffPhotoUrl(list[i]); }
      list.sort(function(a, c){ return (a.lastName + a.firstName).localeCompare(c.lastName + c.firstName); });
      res.status(200).json({ staff: list, roles: R.STAFF_ROLES });
      return;
    }
    if (req.method === 'POST' && b.action === 'resetCode'){
      var st = await R.getStaff(redis, b.id);
      if (!st){ res.status(404).json({ error: 'Staff member not found.' }); return; }
      var nc; do { nc = R.newCode(); } while (await redis.hget('rootahead:ridercodes', nc));
      if (st.code) await redis.hdel('rootahead:ridercodes', st.code);
      st.code = nc; st.codeV = (st.codeV || 1) + 1; st.lastLoginAt = null; st.updatedAt = new Date().toISOString();
      var ce = {}; ce[nc] = st.id; await redis.hset('rootahead:ridercodes', ce);
      await redis.del('rootahead:sessions:' + st.id);
      await R.saveStaff(redis, st);
      res.status(200).json({ ok: true, staff: st });
      return;
    }
    if (req.method === 'POST'){
      var x = b.staff || {};
      var prev = x.id ? await R.getStaff(redis, x.id) : null;
      var s = prev || { id: 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString() };
      s.firstName = str(x.firstName, 40); s.lastName = str(x.lastName, 40);
      if (!s.firstName || !s.lastName){ res.status(400).json({ error: 'First and last name are required.' }); return; }
      s.role = str(x.role, 60) || 'Andere';
      var th = (await redis.hgetall('rootahead:teams')) || {};
      if (Array.isArray(x.teamIds)) s.teamIds = x.teamIds.map(String).filter(function(t){ return th[t]; });
      else if (!s.teamIds) s.teamIds = [];
      s.phone = str(x.phone, 30); s.email = str(x.email, 80); s.notes = str(x.notes, 300);
      var code = R.normCode(x.code) || (prev && prev.code) || R.newCode();
      if (code.length < 4){ res.status(400).json({ error: 'The login code needs at least 4 letters or digits.' }); return; }
      var owner = await redis.hget('rootahead:ridercodes', code);
      if (owner && owner !== s.id){ res.status(409).json({ error: 'That login code is already used by someone else.' }); return; }
      if (prev && prev.code && prev.code !== code){
        await redis.hdel('rootahead:ridercodes', prev.code);
        s.codeV = (s.codeV || 1) + 1; s.lastLoginAt = null; await redis.del('rootahead:sessions:' + s.id);
      }
      s.code = code; var ce2 = {}; ce2[code] = s.id; await redis.hset('rootahead:ridercodes', ce2);
      if (b.photo === null){ await redis.del('rootahead:riderphoto:' + s.id); s.hasPhoto = false; }
      else if (typeof b.photo === 'string'){
        var m = b.photo.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!m || m[2].length > 700000){ res.status(400).json({ error: 'The photo must be a JPEG/PNG/WebP under about 500 KB.' }); return; }
        await redis.set('rootahead:riderphoto:' + s.id, JSON.stringify({ type: 'image/' + m[1], data: m[2] }));
        s.hasPhoto = true; s.photoV = (s.photoV || 0) + 1;
      }
      s.updatedAt = new Date().toISOString();
      await R.saveStaff(redis, s);
      var out = Object.assign({}, s, { photoUrl: R.staffPhotoUrl(s) });
      res.status(200).json({ ok: true, staff: out });
      return;
    }
    if (req.method === 'DELETE'){
      var d = await R.getStaff(redis, b.id);
      if (!d){ res.status(404).json({ error: 'Staff member not found.' }); return; }
      await redis.hdel('rootahead:staff', d.id);
      if (d.code) await redis.hdel('rootahead:ridercodes', d.code);
      await redis.del('rootahead:sessions:' + d.id, 'rootahead:riderphoto:' + d.id);
      await redis.hdel('rootahead:push:users', d.id);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'Use GET, POST or DELETE' });
  } catch(err){
    res.status(err && err.notConfigured ? 503 : 500).json({ error: err && err.message ? err.message : 'Staff request failed' });
  }
};
