// Admin: number of generated tracks per user (device profile),
// plus ?user=<deviceId> for one user's route history and ?route=<id> for one GPX.
// Protected server-side: the request must carry header x-admin-key equal to
// the ADMIN_PASSWORD environment variable set in Vercel. Without that env
// var the endpoint refuses to answer, so names are never exposed by default.
var getRedis = require('./_redis').getRedis;

var HISTORY_LIMIT = 100; // newest routes shown per user

function parse(v){
  if (v && typeof v === 'object') return v;       // Upstash client already parsed it
  try{ return JSON.parse(v); } catch(e){ return null; }
}

module.exports = async function handler(req, res){
  if (req.method !== 'GET'){
    res.status(405).json({ error: 'Use GET' });
    return;
  }
  var expected = process.env.ADMIN_PASSWORD;
  if (!expected){
    res.status(503).json({ error: 'ADMIN_PASSWORD is not set yet. Vercel → your project → Settings → Environment Variables → add ADMIN_PASSWORD (same value as the Admin password) → Save → Deployments → Redeploy.' });
    return;
  }
  if (req.headers['x-admin-key'] !== expected){
    res.status(401).json({ error: 'Wrong admin password for the backend.' });
    return;
  }
  try{
    var redis = getRedis();
    var q = req.query || {};

    // ?route=<id> → one stored route including its GPX
    if (q.route){
      var rec = parse(await redis.get('rootahead:route:' + String(q.route).slice(0, 40)));
      if (!rec){ res.status(404).json({ error: 'Route not found.' }); return; }
      res.status(200).json(rec);
      return;
    }

    // ?user=<deviceId> → that user's route history, newest first (no GPX bodies)
    if (q.user){
      var ids = (await redis.lrange('rootahead:user:' + String(q.user).slice(0, 100) + ':routes', 0, HISTORY_LIMIT)) || [];
      var more = ids.length > HISTORY_LIMIT;
      ids = ids.slice(0, HISTORY_LIMIT);
      var recs = ids.length ? (await redis.mget.apply(redis, ids.map(function(id){ return 'rootahead:route:' + id; }))) : [];
      var routes = recs.map(parse).filter(Boolean).map(function(r){
        return { id: r.id, createdAt: r.createdAt, distanceKm: r.distanceKm, gainM: r.gainM, loop: r.loop,
                 shape: r.shape, activity: r.activity, hasGpx: !!r.gpx };
      });
      res.status(200).json({ routes: routes, more: more });
      return;
    }

    var counts = (await redis.hgetall('rootahead:users:routecount')) || {};
    var profiles = (await redis.hgetall('rootahead:users')) || {};
    var total = 0;
    var users = Object.keys(counts).map(function(id){
      var p = parse(profiles[id]) || {};
      var n = Number(counts[id]) || 0;
      total += n;
      return {
        deviceId: id,
        firstName: p.firstName || null,
        lastName: p.lastName || null,
        team: p.team || null,
        lastRouteAt: p.lastRouteAt || null,
        routes: n
      };
    }).sort(function(a, b){ return b.routes - a.routes; });
    res.status(200).json({ users: users, totalRoutes: total });
  } catch(err){
    res.status(500).json({ error: err && err.message ? err.message : 'Could not load users' });
  }
};
