// Admin: teams. Riders are linked to a team by teamId (their team name is kept in step).
//   GET                                         → { teams:[{…, riders:n}] }
//   POST { team, photo, members:[riderIds] }    → create / update. photo as in /api/riders; members (optional) = the full list of riders in this team
//   DELETE { id }                               → remove the team; its riders get no team
// Keys: rootahead:teams (hash id → JSON), rootahead:teamphoto:<id>
var getRedis = require('./_redis').getRedis;
var requireAdmin = require('./_admin').requireAdmin;
var R = require('./_riders');

function str(v, n){ return String(v == null ? '' : v).trim().slice(0, n); }
async function allTeams(redis){ var h = (await redis.hgetall('rootahead:teams')) || {}; return Object.keys(h).map(function(k){ return R.parse(h[k]); }).filter(Boolean); }
function teamOut(t, riders){
  var o = Object.assign({}, t); o.logoUrl = t.hasLogo ? '/api/rider-photo?team=' + encodeURIComponent(t.id) + '&v=' + (t.logoV || 1) : '';
  o.riders = riders.filter(function(r){ return r.teamId === t.id; }).length; return o;
}
// give a rider a team (or none), and keep the name copy used elsewhere in step
async function setRiderTeam(redis, r, team){
  r.teamId = team ? team.id : ''; r.team = team ? team.name : '';
  r.updatedAt = new Date().toISOString();
  await R.saveRider(redis, r);
  var pe = {}; pe[r.id] = JSON.stringify({ firstName: r.firstName, lastName: r.lastName, team: r.team }); await redis.hset('rootahead:users', pe);
}

module.exports = async function handler(req, res){
  if (!requireAdmin(req, res)) return;
  try{
    var redis = getRedis(), riders = await R.allRiders(redis);
    if (req.method === 'GET'){
      var teams = await allTeams(redis);
      res.status(200).json({ teams: teams.map(function(t){ return teamOut(t, riders); }).sort(function(a, b){ return a.name.localeCompare(b.name); }) });
      return;
    }
    var b = req.body || {};
    if (req.method === 'POST'){
      var x = b.team || {}, name = str(x.name, 40);
      if (!name){ res.status(400).json({ error: 'A team needs a name.' }); return; }
      var teams2 = await allTeams(redis);
      if (teams2.some(function(t){ return t.id !== x.id && t.name.toLowerCase() === name.toLowerCase(); })){ res.status(409).json({ error: 'There is already a team called ' + name + '.' }); return; }
      var prev = x.id ? teams2.filter(function(t){ return t.id === x.id; })[0] : null;
      var t = prev || { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), createdAt: new Date().toISOString() };
      t.name = name; t.color = /^#[0-9a-f]{6}$/i.test(x.color || '') ? x.color : (t.color || '#fbc120'); t.about = str(x.about, 300);
      if (b.photo === null){ await redis.del('rootahead:teamphoto:' + t.id); t.hasLogo = false; }
      else if (typeof b.photo === 'string'){
        var m = b.photo.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!m || m[2].length > 700000){ res.status(400).json({ error: 'The logo must be a JPEG/PNG/WebP under about 500 KB.' }); return; }
        await redis.set('rootahead:teamphoto:' + t.id, JSON.stringify({ type: 'image/' + m[1], data: m[2] }));
        t.hasLogo = true; t.logoV = (t.logoV || 0) + 1;
      }
      t.updatedAt = new Date().toISOString();
      var te = {}; te[t.id] = JSON.stringify(t); await redis.hset('rootahead:teams', te);
      // renamed: every rider in the team gets the new name
      for (var i = 0; i < riders.length; i++) if (riders[i].teamId === t.id && riders[i].team !== t.name) await setRiderTeam(redis, riders[i], t);
      // members: exactly these riders are in the team now
      if (Array.isArray(b.members)){
        var want = b.members.map(String);
        for (var j = 0; j < riders.length; j++){
          var r = riders[j], inTeam = r.teamId === t.id, should = want.indexOf(r.id) !== -1;
          if (should && !inTeam) await setRiderTeam(redis, r, t);
          else if (!should && inTeam) await setRiderTeam(redis, r, null);
        }
      }
      res.status(200).json({ ok: true, team: teamOut(t, await R.allRiders(redis)) });
      return;
    }
    if (req.method === 'DELETE'){
      var id = String(b.id || '');
      await redis.hdel('rootahead:teams', id); await redis.del('rootahead:teamphoto:' + id);
      var freed = 0;
      for (var k = 0; k < riders.length; k++) if (riders[k].teamId === id){ await setRiderTeam(redis, riders[k], null); freed++; }
      res.status(200).json({ ok: true, ridersWithoutTeam: freed });
      return;
    }
    res.status(405).json({ error: 'Use GET, POST or DELETE' });
  } catch(err){
    res.status(err && err.notConfigured ? 503 : 500).json({ error: err && err.message ? err.message : 'Team request failed' });
  }
};
