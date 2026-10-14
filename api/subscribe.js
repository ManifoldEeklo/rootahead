// Stores the push subscription for whoever enabled "notify me on new
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
