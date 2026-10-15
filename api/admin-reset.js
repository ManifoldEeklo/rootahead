// Admin: start from a clean sheet. Deletes ALL ROOT-Ahead data in the database.
//   POST { confirm:'DELETE', keepRiders:false, keepLibrary:false }
// keepRiders keeps the rider setup (names, codes, photos); keepLibrary keeps own workouts + templates.
var getRedis = require('./_redis').getRedis;
var requireAdmin = require('./_admin').requireAdmin;
module.exports = async function handler(req, res){
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST'){ res.status(405).json({ error: 'Use POST' }); return; }
  var b = req.body || {};
  if (b.confirm !== 'DELETE'){ res.status(400).json({ error: 'Type DELETE to confirm.' }); return; }
  try{
    var redis = getRedis(), cursor = '0', deleted = 0, guard = 0;
    function keep(k){
      if (b.keepRiders && (k === 'rootahead:riders' || k === 'rootahead:ridercodes' || k.indexOf('rootahead:riderphoto:') === 0 ||
                           k === 'rootahead:teams' || k.indexOf('rootahead:teamphoto:') === 0)) return true;
      if (b.keepLibrary && (k === 'rootahead:coach:workouts' || k === 'rootahead:coach:templates')) return true;
      return false;
    }
    do {
      var r = await redis.scan(cursor, { match: 'rootahead:*', count: 500 });
      cursor = String(r[0]);
      var keys = (r[1] || []).filter(function(k){ return !keep(k); });
      for (var i = 0; i < keys.length; i += 100){ await redis.del.apply(redis, keys.slice(i, i + 100)); deleted += Math.min(100, keys.length - i); }
    } while (cursor !== '0' && ++guard < 2000);
    res.status(200).json({ ok: true, deleted: deleted });
  } catch(err){
    res.status(500).json({ error: err && err.message ? err.message : 'Reset failed' });
  }
};
