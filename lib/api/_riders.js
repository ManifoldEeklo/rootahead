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
// Staff (sport director, coach, soigneur, mechanic…): own login codes in the same code table,
// ids start with "s_", stored in rootahead:staff. They only look: calendar + team of their teams.
// Staff functions (from the team's staff list, DPODR_Medewerkers.xlsx). The order is also the order in team overviews.
var STAFF_ROLES = ["Manager / Sportdirecteur", "Sportdirecteur", "DS CLUB", "Financieel verantwoordelijke", "Administratie / aanvragen / logistiek", "Social Media - Marketing - Evenementen", "Verzorger / massage", "Verzorger", "Verzorger / logistiek / chauffeur", "Verzorger / massage (stagiair)", "Mechanieker", "Kok", "Service Course & opvolging", "Performance", "Diëtiste", "Andere"];
async function getStaff(redis, id){ return String(id || '').indexOf('s_') === 0 ? parse(await redis.hget('rootahead:staff', String(id).slice(0, 40))) : null; }
async function allStaff(redis){ var h = (await redis.hgetall('rootahead:staff')) || {}; return Object.keys(h).map(function(k){ return parse(h[k]); }).filter(Boolean); }
async function saveStaff(redis, x){ var e = {}; e[x.id] = JSON.stringify(x); await redis.hset('rootahead:staff', e); }
function staffPhotoUrl(x){ return x.hasPhoto ? '/api/rider-photo?id=' + encodeURIComponent(x.id) + '&v=' + (x.photoV || 1) : ''; }
// a rider or a staff member (whoever signed in)
async function getAccount(redis, id){ return String(id || '').indexOf('s_') === 0 ? getStaff(redis, id) : getRider(redis, id); }
async function staffPublic(redis, x){
  var o = {}; Object.keys(x).forEach(function(k){ if (k !== 'code' && k !== 'notes') o[k] = x[k]; });
  o.kind = 'staff'; o.photoUrl = staffPhotoUrl(x); o.codeV = x.codeV || 1;
  var th = (await redis.hgetall('rootahead:teams')) || {};
  o.teams = (x.teamIds || []).map(function(t){ var tt = parse(th[t]); return tt ? { id: tt.id, name: tt.name, color: tt.color || '#fbc120' } : null; }).filter(Boolean);
  o.team = o.teams.map(function(t){ return t.name; }).join(' · ');
  o.teamColor = o.teams.length ? o.teams[0].color : '';
  return o;
}
async function getRider(redis, id){ return parse(await redis.hget('rootahead:riders', String(id || '').slice(0, 40))); }
async function allRiders(redis){
  var h = (await redis.hgetall('rootahead:riders')) || {};
  return Object.keys(h).map(function(k){ return parse(h[k]); }).filter(Boolean);
}
async function saveRider(redis, r){ var e = {}; e[r.id] = JSON.stringify(r); await redis.hset('rootahead:riders', e); }
module.exports = { STAFF_ROLES: STAFF_ROLES, getStaff: getStaff, allStaff: allStaff, saveStaff: saveStaff, staffPhotoUrl: staffPhotoUrl, getAccount: getAccount, staffPublic: staffPublic, installOf: installOf, touchSession: touchSession, sessionsOf: sessionsOf, sessionOk: sessionOk, signedOut: signedOut, riderWithTeam: riderWithTeam, parse: parse, normCode: normCode, newCode: newCode, photoUrl: photoUrl, publicRider: publicRider, getRider: getRider, allRiders: allRiders, saveRider: saveRider };
