// Shared Upstash Redis connection for all API functions.
// (Files starting with "_" in /api are helpers, not endpoints, on Vercel.)
//
// Why not plain Redis.fromEnv(): it only looks for two exact variable names.
// When those are missing it builds a client with an empty URL, and every call
// then fails with the cryptic "Failed to parse URL from /pipeline".
// Vercel's Upstash integration can name the variables with a custom prefix
// (e.g. STORAGE_KV_REST_API_URL), so this finds them under any prefix and,
// if nothing usable is there, throws an error that says what to fix.
var Redis = require('@upstash/redis').Redis;

function clean(v){ return String(v).trim().replace(/^["']|["']$/g, '').trim(); } // tolerate values pasted with quotes

function findEnv(suffixes){
  var env = {}, keys = Object.keys(process.env);
  keys.forEach(function(k){ env[k] = process.env[k] ? clean(process.env[k]) : process.env[k]; });
  for (var i = 0; i < suffixes.length; i++){
    if (env[suffixes[i]]) return { name: suffixes[i], value: env[suffixes[i]] };      // exact name first
  }
  for (var j = 0; j < suffixes.length; j++){
    for (var k = 0; k < keys.length; k++){
      if (keys[k].slice(-suffixes[j].length - 1) === '_' + suffixes[j] && env[keys[k]]) return { name: keys[k], value: env[keys[k]] };
    }
  }
  return null;
}

function redisConfig(){
  // KV_REST_API_URL is Vercel's default; with a custom prefix (e.g. STORAGE)
  // the names become STORAGE_REST_API_URL / STORAGE_REST_API_TOKEN.
  var url = findEnv(['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'REST_API_URL']);
  var token = findEnv(['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'REST_API_TOKEN']);
  return { url: url, token: token };
}

function getRedis(){
  var c = redisConfig();
  if (c.url && c.token && /^https:\/\//.test(c.url.value)){
    return new Redis({ url: c.url.value, token: c.token.value });
  }
  var msg;
  if (c.url && !/^https:\/\//.test(c.url.value)){
    msg = 'Database URL in ' + c.url.name + ' is not an https:// REST URL.';
  } else if (process.env.REDIS_URL || findEnv(['REDIS_URL'])){
    msg = 'Found REDIS_URL, but this app needs Upstash Redis (REST): in Vercel → Storage connect "Upstash for Redis" to this project, then Redeploy.';
  } else {
    msg = 'Database not connected: in Vercel → Storage connect "Upstash for Redis" to this project, then Redeploy.';
  }
  // Add the NAMES (never the values) of related variables this deployment can
  // see, so it's clear whether the connection reached this deployment at all.
  var seen = Object.keys(process.env).filter(function(k){ return /REDIS|UPSTASH|KV_|REST_API|STORAGE/i.test(k); }).sort();
  msg += ' [Seen by this deployment: ' + (seen.length ? seen.join(', ') : 'no database variables at all') +
         '; environment: ' + (process.env.VERCEL_ENV || 'unknown') + ']';
  var e = new Error(msg); e.notConfigured = true;
  throw e;
}

module.exports = { getRedis: getRedis, redisConfig: redisConfig };
