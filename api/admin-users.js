// Admin: number of generated tracks per user (device profile).
// Protected server-side: the request must carry header x-admin-key equal to
// the ADMIN_PASSWORD environment variable set in Vercel. Without that env
// var the endpoint refuses to answer, so names are never exposed by default.
var Redis = require('@upstash/redis').Redis;

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
    res.status(503).json({ error: 'ADMIN_PASSWORD is not set in Vercel — see README.' });
    return;
  }
  if (req.headers['x-admin-key'] !== expected){
    res.status(401).json({ error: 'Wrong admin password for the backend.' });
    return;
  }
  try{
    var redis = Redis.fromEnv();
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
