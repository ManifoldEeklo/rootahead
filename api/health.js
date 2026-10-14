// Setup check: open /api/health in a browser.
// Shows only yes/no and public names — never a secret value.
var redisHelper = require('./_redis');

module.exports = async function handler(req, res){
  var env = process.env;
  var c = redisHelper.redisConfig();
  var out = {
    deployment: {
      environment: env.VERCEL_ENV || 'unknown',
      projectProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL || 'unknown',
      thisDeploymentUrl: env.VERCEL_URL || 'unknown',
      deploymentId: env.VERCEL_DEPLOYMENT_ID || 'unknown'
    },
    database: {
      urlVariable: c.url ? c.url.name : 'missing',
      tokenVariable: c.token ? c.token.name : 'missing',
      reachable: false
    },
    adminPasswordSet: !!env.ADMIN_PASSWORD,
    vapidKeysSet: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
  };
  try{
    var redis = redisHelper.getRedis();
    out.database.reachable = (await redis.ping()) === 'PONG';
  } catch(err){
    out.database.error = err && err.message ? err.message : String(err);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
};
