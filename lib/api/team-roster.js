// The rider app's "Team" overview: every rider per team with photo, name, nickname and age.
//   GET /api/team-roster?id=<signed-in rider id>
// Only for signed-in riders (the id must be a known rider). No birth dates, codes or notes leave the server: age only.
var getRedis = require('./_redis').getRedis;
var R = require('./_riders');
function age(d){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return null;
  var b = new Date(d + 'T12:00:00Z'), n = new Date(), a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--;
  return a;
}
module.exports = async function handler(req, res){
  try{
    var redis = getRedis(), me = await R.getRider(redis, (req.query || {}).id);
    if (!me){ res.status(401).json({ error: 'Sign in first.' }); return; }
    if (!R.sessionOk(me, req)){ R.signedOut(res); return; }
    var riders = await R.allRiders(redis);
    var th = (await redis.hgetall('rootahead:teams')) || {};
    var teams = Object.keys(th).map(function(k){ return R.parse(th[k]); }).filter(Boolean);
    function card(r){ return { id: r.id, firstName: r.firstName, lastName: r.lastName, nickname: r.nickname || '', age: age(r.birthDate), photoUrl: R.photoUrl(r), me: r.id === me.id }; }
    function byName(a, b){ return (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName); }
    var out = teams.map(function(t){
      return { id: t.id, name: t.name, color: t.color || '#fbc120', about: t.about || '',
               logoUrl: t.hasLogo ? '/api/rider-photo?team=' + encodeURIComponent(t.id) + '&v=' + (t.logoV || 1) : '',
               riders: riders.filter(function(r){ return r.teamId === t.id; }).map(card).sort(byName) };
    }).filter(function(t){ return t.riders.length; });
    // own team first, then by name
    out.sort(function(a, b){ return (b.id === me.teamId) - (a.id === me.teamId) || a.name.localeCompare(b.name); });
    var loose = riders.filter(function(r){ return !r.teamId || !th[r.teamId]; }).map(card).sort(byName);
    if (loose.length) out.push({ id: '', name: 'Riders without a team', color: '#9a9a9a', about: '', logoUrl: '', riders: loose });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ teams: out, total: riders.length });
  } catch(err){
    res.status(err && err.notConfigured ? 503 : 500).json({ error: err && err.message ? err.message : 'Could not load the team' });
  }
};
