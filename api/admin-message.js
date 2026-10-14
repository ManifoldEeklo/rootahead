// Admin: send a team message as a push notification to one or more users.
//   POST { deviceIds:[...], title, body }  → sends, returns { sent, failed, skipped }
//   GET                                     → the last 50 sent messages (log)
// Protected like admin-users: header x-admin-key must equal ADMIN_PASSWORD.
// Needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Vercel (same public key as in index.html).
var getRedis = require('./_redis').getRedis;
var webpush = require('web-push');

var vapidReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (vapidReady){
  webpush.setVapidDetails(
    process.env.VAPID_CONTACT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function parse(v){
  if (v && typeof v === 'object') return v;
  try{ return JSON.parse(v); } catch(e){ return null; }
}

module.exports = async function handler(req, res){
  var expected = process.env.ADMIN_PASSWORD;
  if (!expected){ res.status(503).json({ error: 'ADMIN_PASSWORD is not set in Vercel.' }); return; }
  if (req.headers['x-admin-key'] !== expected){ res.status(401).json({ error: 'Wrong admin password for the backend.' }); return; }

  try{
    var redis = getRedis();

    if (req.method === 'GET'){
      var log = (await redis.lrange('rootahead:messages', 0, 49)) || [];
      res.status(200).json({ messages: log.map(parse).filter(Boolean) });
      return;
    }
    if (req.method !== 'POST'){ res.status(405).json({ error: 'Use GET or POST' }); return; }

    if (!vapidReady){
      res.status(503).json({ error: 'VAPID keys are not set in Vercel (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY) — see README, then Redeploy.' });
      return;
    }
    var b = req.body || {};
    var title = String(b.title || 'ROOT Ahead').trim().slice(0, 60) || 'ROOT Ahead';
    var text = String(b.body || '').trim().slice(0, 300);
    var ids = Array.isArray(b.deviceIds) ? b.deviceIds.map(function(x){ return String(x).slice(0, 100); }).filter(Boolean) : [];
    ids = ids.filter(function(x, i){ return ids.indexOf(x) === i; }).slice(0, 500);
    if (!text){ res.status(400).json({ error: 'Write a message first.' }); return; }
    if (!ids.length){ res.status(400).json({ error: 'Pick at least one recipient.' }); return; }

    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var payload = JSON.stringify({ title: title, body: text, tag: 'rootahead-msg-' + id, url: '/' });
    var sent = 0, failed = 0, skipped = 0, gone = [];

    await Promise.all(ids.map(async function(deviceId){
      var sub = parse(await redis.hget('rootahead:push:users', deviceId));
      if (!sub || !sub.endpoint){ skipped++; return; }
      try{
        await webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 24 }); // deliverable for 24h if the phone is offline
        sent++;
      } catch(err){
        failed++;
        if (err && (err.statusCode === 404 || err.statusCode === 410)) gone.push(deviceId); // app removed / permission withdrawn
      }
    }));
    if (gone.length) await redis.hdel.apply(redis, ['rootahead:push:users'].concat(gone));

    var entry = { id: id, at: new Date().toISOString(), title: title, body: text, to: ids, sent: sent, failed: failed, skipped: skipped };
    await redis.lpush('rootahead:messages', JSON.stringify(entry));
    await redis.ltrim('rootahead:messages', 0, 199);

    res.status(200).json({ ok: true, sent: sent, failed: failed, skipped: skipped, removed: gone.length });
  } catch(err){
    res.status(500).json({ error: err && err.message ? err.message : 'Could not send' });
  }
};
