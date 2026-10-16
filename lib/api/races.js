// Calendar: races, club trainings and (sponsor) events. Only the admin makes, changes or cancels them
// and picks the riders; every invited rider confirms whether they come (reply yes / no).
// Admin (header x-admin-key):
//   GET                                          → { races:[…all…] }
//   POST { race, riderIds }                      → create / update; riderIds = who rides now
//   POST { id, action:'cancel'|'restore' }       → a cancelled race stays visible, marked "cancelled"
//   DELETE { id }                                → remove for good (only a cancelled race)
// Rider (signed in):
//   GET ?rider=<id>                              → { races:[…items this rider is or was invited for, with the line-up + replies…] }
//   POST { reply:'yes'|'no', id, rider }         → the rider confirms (only while selected and not cancelled)
// A rider taken off a race keeps the entry with status "removed", so their app still shows it.
// Key: rootahead:races (hash id → JSON)
var getRedis = require('./_redis').getRedis;
var admin = require('./_admin');
var R = require('./_riders');
var webpush = require('web-push');
var vapidReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (vapidReady) webpush.setVapidDetails(admin.vapidSubject(), process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
var KIND_WORD = { race:'race', training:'training', event:'event' };
var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function niceDate(iso){ var d = new Date(iso + 'T12:00:00Z'); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
// push "you're invited" to riders who were just added (only those with notifications on)
async function notifyInvited(redis, rc, ids){
  if (!vapidReady || !ids.length) return 0;
  var sent = 0;
  var payload = JSON.stringify({
    title: 'Invited: ' + rc.name,
    body: niceDate(rc.date) + (rc.time ? ' ' + rc.time : '') + (rc.location ? ' · ' + rc.location : '') + '. Tap to confirm whether you come.',
    tag: 'rootahead-cal-' + rc.id, url: '/#calendar'
  });
  await Promise.all(ids.map(async function(id){
    var sub = R.parse(await redis.hget('rootahead:push:users', id));
    if (!sub || !sub.endpoint) return;
    try{ await webpush.sendNotification(sub, payload, { TTL: 86400 }); sent++; }
    catch(err){ if (err && (err.statusCode === 404 || err.statusCode === 410)) await redis.hdel('rootahead:push:users', id); }
  }));
  return sent;
}

// Calendar items of three kinds. Every invited rider confirms: reply 'yes' / 'no'.
var KINDS = {
  race:     ['Road race','Criterium','Time trial','Gravel','Cyclocross','Mountain bike','Stage race','Kermesse','Other'],
  training: ['Group ride','Track session','Gym / strength','Recon ride','Skills','Other'],
  event:    ['Sponsor event','Photo shoot','Team presentation','Fair / expo','Social','Other']
};
var TYPES = KINDS.race;
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
          return { id: id, firstName: r.firstName, lastName: r.lastName, nickname: r.nickname || '', team: t ? t.name : '', teamColor: t ? t.color : '', photoUrl: R.photoUrl(r), me: id === me.id,
                   reply: rc.entries[id].reply || '' };
        }).sort(function(a, b){ return (a.team + a.firstName).localeCompare(b.team + b.firstName); });
        var e = rc.entries[me.id];
        return { id: rc.id, kind: rc.kind || 'race', date: rc.date, time: rc.time || '', name: rc.name, type: rc.type, location: rc.location, distanceKm: rc.distanceKm, notes: rc.notes || '',
                 myReply: e.reply || '', myReplyAt: e.replyAt || '',
                 cancelled: !!rc.cancelled, cancelledAt: rc.cancelledAt || '', myStatus: e.status, myChangedAt: e.status === 'removed' ? e.removedAt : e.at, lineup: lineup };
      }).sort(function(a, b){ return a.date.localeCompare(b.date); });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ races: mine });
      return;
    }
    // ---------- rider: confirm whether they come ----------
    var rb = req.body || {};
    if (req.method === 'POST' && rb.reply && rb.rider){
      var who = await R.getRider(redis, rb.rider);
      if (!who){ res.status(401).json({ error: 'Sign in first.' }); return; }
      if (!R.sessionOk(who, req)){ R.signedOut(res); return; }
      var item = R.parse(await redis.hget('rootahead:races', String(rb.id || '')));
      var en = item && item.entries && item.entries[who.id];
      if (!en){ res.status(404).json({ error: 'You are not invited for this.' }); return; }
      if (item.cancelled){ res.status(400).json({ error: 'This has been cancelled.' }); return; }
      if (en.status !== 'selected'){ res.status(400).json({ error: 'You are no longer selected for this.' }); return; }
      en.reply = rb.reply === 'no' ? 'no' : 'yes'; en.replyAt = new Date().toISOString();
      await saveRace(redis, item);
      res.status(200).json({ ok: true, reply: en.reply });
      return;
    }
    // ---------- admin ----------
    if (!admin.requireAdmin(req, res)) return;
    if (req.method === 'GET'){
      res.status(200).json({ races: (await allRaces(redis)).map(function(rc){ if (!rc.kind) rc.kind = 'race'; return rc; })
        .sort(function(a, b){ return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); }), types: TYPES, kinds: KINDS });
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
      if (!date || !name){ res.status(400).json({ error: 'Give it a date and a name.' }); return; }
      var prev = x.id ? R.parse(await redis.hget('rootahead:races', String(x.id))) : null;
      var rc = prev || { id: 'race_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), entries: {}, createdAt: new Date().toISOString() };
      rc.date = date; rc.name = name;
      rc.kind = KINDS[x.kind] ? x.kind : (rc.kind || 'race');
      rc.type = KINDS[rc.kind].indexOf(x.type) !== -1 ? x.type : 'Other';
      rc.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x.time || '')) ? x.time : '';
      rc.location = str(x.location, 80);
      var d = Number(x.distanceKm); rc.distanceKm = isFinite(d) && d > 0 && d <= 400 ? Math.round(d * 10) / 10 : null;
      rc.notes = str(x.notes, 300);
      // selection: who rides now; riders taken off keep a "removed" entry
      var newlyInvited = [];
      if (Array.isArray(b.riderIds)){
        var now = new Date().toISOString(), want = b.riderIds.map(String);
        want.forEach(function(id){
          var e = rc.entries[id];
          if (!e){ rc.entries[id] = { status: 'selected', at: now }; newlyInvited.push(id); }
          else if (e.status !== 'selected'){ e.status = 'selected'; e.at = now; delete e.removedAt; delete e.reply; newlyInvited.push(id); }
        });
        Object.keys(rc.entries).forEach(function(id){
          if (want.indexOf(id) === -1 && rc.entries[id].status === 'selected'){ rc.entries[id].status = 'removed'; rc.entries[id].removedAt = now; }
        });
      }
      rc.updatedAt = new Date().toISOString();
      await saveRace(redis, rc);
      var notified = 0;
      var today = new Date().toISOString().slice(0, 10);
      if (b.notify !== false && !rc.cancelled && rc.date >= today) notified = await notifyInvited(redis, rc, newlyInvited);
      res.status(200).json({ ok: true, race: rc, newlyInvited: newlyInvited.length, notified: notified, pushReady: vapidReady });
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
