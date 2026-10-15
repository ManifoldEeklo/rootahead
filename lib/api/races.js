// Race calendar. Only the admin makes, changes or cancels races and picks the riders.
// Admin (header x-admin-key):
//   GET                                          → { races:[…all…] }
//   POST { race, riderIds }                      → create / update; riderIds = who rides now
//   POST { id, action:'cancel'|'restore' }       → a cancelled race stays visible, marked "cancelled"
//   DELETE { id }                                → remove for good (only a cancelled race)
// Rider (signed in):
//   GET ?rider=<id>                              → { races:[…races this rider is or was selected for, with the line-up…] }
// A rider taken off a race keeps the entry with status "removed", so their app still shows it.
// Key: rootahead:races (hash id → JSON)
var getRedis = require('./_redis').getRedis;
var admin = require('./_admin');
var R = require('./_riders');

var TYPES = ['Road race','Criterium','Time trial','Gravel','Cyclocross','Mountain bike','Stage race','Kermesse','Other'];
function str(v, n){ return String(v == null ? '' : v).trim().slice(0, n); }
async function allRaces(redis){ var h = (await redis.hgetall('rootahead:races')) || {}; return Object.keys(h).map(function(k){ return R.parse(h[k]); }).filter(Boolean); }
async function saveRace(redis, r){ var e = {}; e[r.id] = JSON.stringify(r); await redis.hset('rootahead:races', e); }

module.exports = async function handler(req, res){
  try{
    var redis = getRedis(), q = req.query || {};
    // ---------- rider: their own race calendar ----------
    if (req.method === 'GET' && q.rider){
      var me = await R.getRider(redis, q.rider);
      if (!me){ res.status(401).json({ error: 'Sign in first.' }); return; }
      if (!R.sessionOk(me, req)){ R.signedOut(res); return; }
      var riders = await R.allRiders(redis), byId = {}; riders.forEach(function(r){ byId[r.id] = r; });
      var th = (await redis.hgetall('rootahead:teams')) || {}, teams = {}; Object.keys(th).forEach(function(k){ var t = R.parse(th[k]); if (t) teams[k] = t; });
      var mine = (await allRaces(redis)).filter(function(rc){ return rc.entries && rc.entries[me.id]; }).map(function(rc){
        var lineup = Object.keys(rc.entries).filter(function(id){ return rc.entries[id].status === 'selected' && byId[id]; }).map(function(id){
          var r = byId[id], t = teams[r.teamId];
          return { id: id, firstName: r.firstName, lastName: r.lastName, nickname: r.nickname || '', team: t ? t.name : '', teamColor: t ? t.color : '', photoUrl: R.photoUrl(r), me: id === me.id };
        }).sort(function(a, b){ return (a.team + a.firstName).localeCompare(b.team + b.firstName); });
        var e = rc.entries[me.id];
        return { id: rc.id, date: rc.date, name: rc.name, type: rc.type, location: rc.location, distanceKm: rc.distanceKm, notes: rc.notes || '',
                 cancelled: !!rc.cancelled, cancelledAt: rc.cancelledAt || '', myStatus: e.status, myChangedAt: e.status === 'removed' ? e.removedAt : e.at, lineup: lineup };
      }).sort(function(a, b){ return a.date.localeCompare(b.date); });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ races: mine });
      return;
    }
    // ---------- admin ----------
    if (!admin.requireAdmin(req, res)) return;
    if (req.method === 'GET'){
      res.status(200).json({ races: (await allRaces(redis)).sort(function(a, b){ return a.date.localeCompare(b.date); }), types: TYPES });
      return;
    }
    var b = req.body || {};
    if (req.method === 'POST' && b.action){
      var rc0 = R.parse(await redis.hget('rootahead:races', String(b.id || '')));
      if (!rc0){ res.status(404).json({ error: 'Race not found.' }); return; }
      if (b.action === 'cancel'){ rc0.cancelled = true; rc0.cancelledAt = new Date().toISOString(); }
      else if (b.action === 'restore'){ rc0.cancelled = false; rc0.cancelledAt = ''; }
      rc0.updatedAt = new Date().toISOString();
      await saveRace(redis, rc0);
      res.status(200).json({ ok: true, race: rc0 });
      return;
    }
    if (req.method === 'POST'){
      var x = b.race || {};
      var date = /^\d{4}-\d{2}-\d{2}$/.test(String(x.date || '')) ? x.date : '';
      var name = str(x.name, 80);
      if (!date || !name){ res.status(400).json({ error: 'A race needs a date and a name.' }); return; }
      var prev = x.id ? R.parse(await redis.hget('rootahead:races', String(x.id))) : null;
      var rc = prev || { id: 'race_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), entries: {}, createdAt: new Date().toISOString() };
      rc.date = date; rc.name = name;
      rc.type = TYPES.indexOf(x.type) !== -1 ? x.type : 'Other';
      rc.location = str(x.location, 80);
      var d = Number(x.distanceKm); rc.distanceKm = isFinite(d) && d > 0 && d <= 400 ? Math.round(d * 10) / 10 : null;
      rc.notes = str(x.notes, 300);
      // selection: who rides now; riders taken off keep a "removed" entry
      if (Array.isArray(b.riderIds)){
        var now = new Date().toISOString(), want = b.riderIds.map(String);
        want.forEach(function(id){
          var e = rc.entries[id];
          if (!e) rc.entries[id] = { status: 'selected', at: now };
          else if (e.status !== 'selected'){ e.status = 'selected'; e.at = now; delete e.removedAt; }
        });
        Object.keys(rc.entries).forEach(function(id){
          if (want.indexOf(id) === -1 && rc.entries[id].status === 'selected'){ rc.entries[id].status = 'removed'; rc.entries[id].removedAt = now; }
        });
      }
      rc.updatedAt = new Date().toISOString();
      await saveRace(redis, rc);
      res.status(200).json({ ok: true, race: rc });
      return;
    }
    if (req.method === 'DELETE'){
      var rd = R.parse(await redis.hget('rootahead:races', String(b.id || '')));
      if (!rd){ res.status(404).json({ error: 'Race not found.' }); return; }
      if (!rd.cancelled){ res.status(400).json({ error: 'Cancel the race first; a cancelled race stays visible as "cancelled". Delete only removes it completely.' }); return; }
      await redis.hdel('rootahead:races', rd.id);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'Use GET, POST or DELETE' });
  } catch(err){
    res.status(err && err.notConfigured ? 503 : 500).json({ error: err && err.message ? err.message : 'Race request failed' });
  }
};
