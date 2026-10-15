var getRedis = require('./_redis').getRedis;

module.exports = async function handler(req, res){
  if (req.method !== 'GET'){
    res.status(405).json({ error: 'Use GET' });
    return;
  }
  try{
    var redis = getRedis();
    var visitsTotal = (await redis.get('rootahead:visits:total')) || 0;
    var routesTotal = (await redis.get('rootahead:routes:total')) || 0;
    var uniqueDevices = (await redis.scard('rootahead:visits:devices')) || 0;

    res.status(200).json({
      visitsTotal: Number(visitsTotal),
      routesTotal: Number(routesTotal),
      uniqueDevices: Number(uniqueDevices)
    });
  } catch(err){
    res.status(500).json({ error: err && err.message ? err.message : 'Could not load stats' });
  }
};
