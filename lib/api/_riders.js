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
async function getRider(redis, id){ return parse(await redis.hget('rootahead:riders', String(id || '').slice(0, 40))); }
async function allRiders(redis){
  var h = (await redis.hgetall('rootahead:riders')) || {};
  return Object.keys(h).map(function(k){ return parse(h[k]); }).filter(Boolean);
}
async function saveRider(redis, r){ var e = {}; e[r.id] = JSON.stringify(r); await redis.hset('rootahead:riders', e); }
module.exports = { riderWithTeam: riderWithTeam, parse: parse, normCode: normCode, newCode: newCode, photoUrl: photoUrl, publicRider: publicRider, getRider: getRider, allRiders: allRiders, saveRider: saveRider };
