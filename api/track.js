// Tracks app opens (visits) and successful route generations. Uses Upstash
// Redis via the Vercel Marketplace integration — getRedis() picks up
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, which Vercel injects
// automatically once the integration is connected to this project. No
// secret ever needs to be typed into code.
var getRedis = require('./_redis').getRedis;
var webpush = require('web-push');

var vapidReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (vapidReady){
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || process.env.VAPID_CONTACT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Notifies whoever enabled "notify me on new visits" in Admin. Fire-and-
// forget from the caller's point of view — a slow or failing push service
// never blocks or fails the actual visit-tracking request. Prunes any
// subscription the push service reports as gone (expired/uninstalled).
async function notifySubscribers(redis){
  if (!vapidReady) return; // no VAPID keys configured — nothing to send, see README
  var subs = await redis.smembers('rootahead:push:subscriptions');
  if (!subs || !subs.length) return;

  var payload = JSON.stringify({ title: 'ROOT-Ahead', body: 'Someone just opened the app.' });
  await Promise.all(subs.map(function(raw){
    var sub;
    try{ sub = JSON.parse(raw); } catch(e){ return null; }
    return webpush.sendNotification(sub, payload).catch(function(err){
      if (err && (err.statusCode === 410 || err.statusCode === 404)){
        return redis.srem('rootahead:push:subscriptions', raw); // stale subscription — clean it up
      }
    });
  }));
}

// Per-user route storage. Keys (all in the same Upstash Redis):
//   rootahead:users:routecount   hash  deviceId -> number of routes generated
//   rootahead:users              hash  deviceId -> JSON {firstName,lastName,team,lastRouteAt}
//   rootahead:user:<deviceId>:routes   list of route ids, newest first
//   rootahead:route:<id>         JSON {id,deviceId,createdAt,distanceKm,gainM,loop,shape,activity,gpx}
// "User" = one device: the profile is typed once on the phone, there is no login.
var MAX_GPX_CHARS = 900000; // stay under Upstash's 1 MB request limit; bigger GPX is counted but not stored

function clean(v, max){ return String(v == null ? '' : v).trim().slice(0, max || 40); }

async function storeRouteForUser(redis, deviceId, body){
  var now = new Date().toISOString();
  await redis.hincrby('rootahead:users:routecount', deviceId, 1);

  var prof = body.profile;
  if (prof && typeof prof === 'object'){
    var user = { firstName: clean(prof.firstName), lastName: clean(prof.lastName), team: clean(prof.team), lastRouteAt: now };
    if (user.firstName || user.lastName || user.team){
      var entry = {}; entry[deviceId] = JSON.stringify(user);
      await redis.hset('rootahead:users', entry);
    }
  }

  var r = body.route;
  if (r && typeof r === 'object'){
    var gpx = typeof r.gpx === 'string' ? r.gpx : '';
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var rec = {
      id: id, deviceId: deviceId, createdAt: now,
      distanceKm: Number(r.distanceKm) || null,
      gainM: (r.gainM == null ? null : Number(r.gainM)),
      loop: !!r.loop,
      shape: clean(r.shape, 40),
      activity: clean(r.activity, 20),
      planDay: /^\d{4}-\d{2}-\d{2}$/.test(String(r.planDay || '')) ? String(r.planDay) : undefined,
      planWorkout: r.planWorkout ? clean(r.planWorkout, 60) : undefined,
      gpx: gpx.length <= MAX_GPX_CHARS ? gpx : null,
      gpxTooLarge: gpx.length > MAX_GPX_CHARS
    };
    await redis.set('rootahead:route:' + id, JSON.stringify(rec));
    await redis.lpush('rootahead:user:' + deviceId + ':routes', id);
  }
}

module.exports = async function handler(req, res){
  if (req.method !== 'POST'){
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  try{
    var redis = getRedis();
    var body = req.body || {};
    var type = body.type;
    var deviceId = String(body.deviceId || '').slice(0, 100); // basic sanity cap, not an auth token

    if (!deviceId){
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }

    if (type === 'visit'){
      await redis.incr('rootahead:visits:total');
      await redis.sadd('rootahead:visits:devices', deviceId);
      notifySubscribers(redis).catch(function(){}); // never let a push failure affect the response below
    } else if (type === 'route'){
      await redis.incr('rootahead:routes:total');
      await storeRouteForUser(redis, deviceId, body);
    } else {
      res.status(400).json({ error: 'Unknown type — expected "visit" or "route"' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch(err){
    // Deliberately fails soft from the client's point of view (app.js only
    // fire-and-forgets this call and never blocks route generation on it) —
    // but still return a real error here for debugging.
    res.status(500).json({ error: err && err.message ? err.message : 'Tracking failed' });
  }
};
