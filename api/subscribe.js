// Team messages: kind:'user' stores one subscription per user device
// (rootahead:push:users). Without kind, it stores the push subscription for
// whoever enabled "notify me on new
// visits" in the Admin panel — this is meant for the app's owner, not
// every visitor, so there's deliberately no UI for it outside Admin.
// Subscriptions are kept in a Set (deduped automatically) so re-enabling
// on the same device doesn't create duplicate entries.
var getRedis = require('./_redis').getRedis;

module.exports = async function handler(req, res){
  var redis;
  try{ redis = getRedis(); }
  catch(err){ res.status(503).json({ error: err.message }); return; }

  if (req.method === 'POST'){
    try{
      var body = req.body || {};
      var subscription = body.subscription;
      if (!subscription || !subscription.endpoint){
        res.status(400).json({ error: 'subscription is required' });
        return;
      }
      // Team messages: one subscription per user device, plus the profile so
      // the admin can pick recipients by name/team.
      if (body.kind === 'user'){
        var deviceId = String(body.deviceId || '').slice(0, 100);
        if (!deviceId){ res.status(400).json({ error: 'deviceId is required' }); return; }
        var subEntry = {}; subEntry[deviceId] = JSON.stringify(subscription);
        await redis.hset('rootahead:push:users', subEntry);
        var prof = body.profile;
        if (prof && typeof prof === 'object'){
          var clean = function(v){ return String(v == null ? '' : v).trim().slice(0, 40); };
          var prev = await redis.hget('rootahead:users', deviceId);
          if (prev && typeof prev === 'string'){ try{ prev = JSON.parse(prev); } catch(e){ prev = null; } }
          var user = Object.assign({}, prev || {}, { firstName: clean(prof.firstName), lastName: clean(prof.lastName), team: clean(prof.team) });
          var userEntry = {}; userEntry[deviceId] = JSON.stringify(user);
          await redis.hset('rootahead:users', userEntry);
        }
        res.status(200).json({ ok: true });
        return;
      }
      await redis.sadd('rootahead:push:subscriptions', JSON.stringify(subscription));
      res.status(200).json({ ok: true });
    } catch(err){
      res.status(500).json({ error: err && err.message ? err.message : 'Could not save subscription' });
    }
    return;
  }

  if (req.method === 'DELETE'){
    try{
      var delBody = req.body || {};
      if (delBody.kind === 'user'){
        var delId = String(delBody.deviceId || '').slice(0, 100);
        if (delId) await redis.hdel('rootahead:push:users', delId);
        res.status(200).json({ ok: true });
        return;
      }
      var endpoint = delBody.endpoint;
      if (!endpoint){ res.status(400).json({ error: 'endpoint is required' }); return; }
      var all = await redis.smembers('rootahead:push:subscriptions');
      var toRemove = (all || []).filter(function(s){
        try{ return JSON.parse(s).endpoint === endpoint; } catch(e){ return false; }
      });
      if (toRemove.length){
        await redis.srem.apply(redis, ['rootahead:push:subscriptions'].concat(toRemove));
      }
      res.status(200).json({ ok: true });
    } catch(err){
      res.status(500).json({ error: err && err.message ? err.message : 'Could not remove subscription' });
    }
    return;
  }

  res.status(405).json({ error: 'Use POST to subscribe or DELETE to unsubscribe' });
};
