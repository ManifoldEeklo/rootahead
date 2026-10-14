// Tracks app opens (visits) and successful route generations. Uses Upstash
// Redis via the Vercel Marketplace integration — Redis.fromEnv() picks up
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, which Vercel injects
// automatically once the integration is connected to this project. No
// secret ever needs to be typed into code.
var Redis = require('@upstash/redis').Redis;
var webpush = require('web-push');

var vapidReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (vapidReady){
  webpush.setVapidDetails(
    process.env.VAPID_CONTACT || 'mailto:admin@example.com',
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

module.exports = async function handler(req, res){
  if (req.method !== 'POST'){
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  try{
    var redis = Redis.fromEnv();
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
