// Rider registry shared by the API functions.
//   rootahead:riders      hash id → rider JSON (includes the login code)
//   rootahead:ridercodes  hash CODE → id   (codes are unique)
//   rootahead:riderphoto:<id>  base64 JPEG (only admins upload)
var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I: easy to read aloud
function parse(v){ if (v && typeof v === 'object') return v; try{ return JSON.parse(v); } catch(e){ return null; } }
function normCode(c){ return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
function newCode(){ var s = ''; for (var i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
function photoUrl(r){ return r.hasPhoto ? '/api/rider-photo?id=' + encodeURIComponent(r.id) + '&v=' + (r.photoV || 1) : ''; }
// what a rider (and the rider app) may see: everything except the code
function publicRider(r){
  if (!r) return null;
  var o = {}; Object.keys(r).forEach(function(k){ if (k !== 'code') o[k] = r[k]; });
  o.photoUrl = photoUrl(r);
  o.codeV = r.codeV || 1;
  return o;
}
// the rider + their team's colour and logo (for the rider app)
async function riderWithTeam(redis, r){
  var o = publicRider(r);
  if (o && r.teamId){
    var t = parse(await redis.hget('rootahead:teams', r.teamId));
    if (t){ o.team = t.name; o.teamColor = t.color || ''; o.teamLogoUrl = t.hasLogo ? '/api/rider-photo?team=' + encodeURIComponent(t.id) + '&v=' + (t.logoV || 1) : ''; }
  }
  return o;
}
// Every login code has a version (codeV). The app sends the version it signed in with (header x-rider-v);
// after the admin resets a code, older phones no longer match and are signed out.
function sessionOk(r, req){
  if (!r) return false;
  var have = Number((req.headers || {})['x-rider-v'] || 0);
  return have === (r.codeV || 1);
}
// Which phones are signed in: rootahead:sessions:<riderId> (hash phone id → last seen time)
function installOf(req){ return String((req.headers || {})['x-install-id'] || (req.body || {}).installId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); }
async function touchSession(redis, riderId, req){
  var inst = installOf(req); if (!inst) return;
  var e = {}; e[inst] = new Date().toISOString(); await redis.hset('rootahead:sessions:' + riderId, e);
}
async function sessionsOf(redis, riderId){
  var h = (await redis.hgetall('rootahead:sessions:' + riderId)) || {}, ids = Object.keys(h), last = '';
  ids.forEach(function(k){ var v = String(h[k]); if (v > last) last = v; });
  return { phones: ids.length, lastSeenAt: last || null };
}
function signedOut(res){ res.status(401).json({ error: 'Your login code was changed by your coach. Sign in with your new code.', signedOut: true }); }
async function getRider(redis, id){ return parse(await redis.hget('rootahead:riders', String(id || '').slice(0, 40))); }
async function allRiders(redis){
  var h = (await redis.hgetall('rootahead:riders')) || {};
  return Object.keys(h).map(function(k){ return parse(h[k]); }).filter(Boolean);
}
async function saveRider(redis, r){ var e = {}; e[r.id] = JSON.stringify(r); await redis.hset('rootahead:riders', e); }
module.exports = { installOf: installOf, touchSession: touchSession, sessionsOf: sessionsOf, sessionOk: sessionOk, signedOut: signedOut, riderWithTeam: riderWithTeam, parse: parse, normCode: normCode, newCode: newCode, photoUrl: photoUrl, publicRider: publicRider, getRider: getRider, allRiders: allRiders, saveRider: saveRider };
