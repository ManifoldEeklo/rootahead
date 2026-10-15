// Training plans (Train section).
// Rider (by deviceId, like the rest of the app):
//   GET  /api/plan?deviceId=…                        → { plan, log }
//   POST { deviceId, plan }                          → save a plan the app generated
//   POST { deviceId, log: { d, status, feel? } }     → mark a day done / skipped / undo
// Coach (header x-admin-key):
//   GET  /api/plan?all=1                             → riders with a plan + progress
//   PUT  { deviceId, plan, notify }                  → save the coach's version, push the rider
// Who makes the plan: by default only the coach. rootahead:planperm (hash id → '1') = rider may make
// their own plan. Routes made for a plan day: rootahead:planroutes:<id> (hash day → {km, gainM, estMin, planMin}).
//   POST { deviceId, routeLink:{ d, km, gainM, estMin, planMin } }  → rider links a generated route to a day
//   PUT  { deviceId, canEdit:true|false }  (coach)                 → allow / forbid the rider's own plan
// Keys: rootahead:plan:<id> (plan), rootahead:planlog:<id> (hash day → status), rootahead:plans (set of ids),
//       rootahead:planarchive:<id> (list of earlier plans: summary + full plan, last 20)
var getRedis = require('./_redis').getRedis;
var admin = require('./_admin');
var webpush = require('web-push');
var R = require('./_riders');
// rider requests (by deviceId = rider id) must come from a phone signed in with the current code
async function riderGate(redis, req, res, id){
  var r = await R.getRider(redis, id);
  if (r && !R.sessionOk(r, req)){ R.signedOut(res); return false; }
  return true;
}
var PLAN_PREFIXES = ['rootahead:plan:', 'rootahead:planlog:', 'rootahead:planroutes:', 'rootahead:planarchive:'];

var vapidReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (vapidReady) webpush.setVapidDetails(admin.vapidSubject(), process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

function parse(v){ if (v && typeof v === 'object') return v; try{ return JSON.parse(v); } catch(e){ return null; } }
function idOf(v){ return String(v || '').slice(0, 100); }

// Short record of a plan with how it went — kept when a rider starts a new plan
function summarize(plan, log){
  var due = 0, done = 0, minPlanned = 0, minDone = 0;
  (plan.days || []).forEach(function(x){
    if (x.type === 'rest') return;
    due++; minPlanned += x.min || 0;
    var l = parse((log || {})[x.d]);
    if (l && l.status === 'done'){ done++; minDone += x.min || 0; }
  });
  var days = plan.days || [];
  return { start: plan.start, end: days.length ? days[days.length - 1].d : plan.start, goal: (plan.settings || {}).goal,
    eventName: (plan.settings || {}).eventName || '', eventDate: (plan.settings || {}).eventDate || '', source: plan.source,
    workouts: due, done: done, minPlanned: minPlanned, minDone: minDone, archivedAt: new Date().toISOString() };
}
var TYPES = ['rest','rec','end','long','tempo','ss','thr','vo2','hills','sprint','event','custom'];
var ZONES = ['Z1','Z2','Z3','SS','Z4','Z5','Z6'];

// Keep only what a plan may contain (it comes from a browser)
function cleanPlan(p){
  if (!p || typeof p !== 'object' || !Array.isArray(p.days)) return null;
  var days = p.days.slice(0, 7 * 16).map(function(x){
    var d = { d: String(x.d || '').slice(0, 10), type: TYPES.indexOf(x.type) !== -1 ? x.type : 'rest',
              min: Math.max(0, Math.min(480, Math.round(Number(x.min) || 0))) };
    if (x.note) d.note = String(x.note).slice(0, 200);
    // a coach workout travels with its full description, so the rider app can show it
    if (d.type === 'custom'){
      var c = x.custom || {}, steps = (Array.isArray(c.steps) ? c.steps : []).slice(0, 40).map(function(s){
        return { label: String(s.label || 'Step').slice(0, 60), min: Math.max(0.25, Math.min(300, Number(s.min) || 0)), zone: ZONES.indexOf(s.zone) !== -1 ? s.zone : 'Z2' };
      });
      if (!steps.length || !c.title){ d.type = 'rest'; d.min = 0; }
      else { d.wid = String(x.wid || '').slice(0, 40); d.custom = { title: String(c.title).slice(0, 60), about: String(c.about || '').slice(0, 300), steps: steps };
             d.min = Math.round(steps.reduce(function(t, s){ return t + s.min; }, 0)); }
    }
    return d;
  }).filter(function(x){ return /^\d{4}-\d{2}-\d{2}$/.test(x.d); });
  var s = p.settings || {};
  return {
    v: 1, start: String(p.start || '').slice(0, 10), days: days,
    phases: Array.isArray(p.phases) ? p.phases.slice(0, 16).map(function(x){ return String(x).slice(0, 12); }) : [],
    settings: { goal: String(s.goal || '').slice(0, 20), hours: Number(s.hours) || 0, level: String(s.level || '').slice(0, 20),
                days: Array.isArray(s.days) ? s.days.slice(0, 7).map(Number) : [], eventDate: String(s.eventDate || '').slice(0, 10),
                eventName: String(s.eventName || '').slice(0, 60), ftp: Number(s.ftp) || 0, recoveryFirst: !!s.recoveryFirst },
    templateName: String(p.templateName || '').slice(0, 60),
    coachNote: String(p.coachNote || '').slice(0, 600),
    source: p.source === 'coach' ? 'coach' : 'app',
    generatedAt: String(p.generatedAt || '').slice(0, 30), adjustedAt: String(p.adjustedAt || '').slice(0, 30)
  };
}

module.exports = async function handler(req, res){
  try{
    var redis = getRedis();
    var q = req.query || {}, b = req.body || {};

    if (req.method === 'GET' && q.all){
      if (!admin.requireAdmin(req, res)) return;
      var ids = (await redis.smembers('rootahead:plans')) || [];
      var profiles = (await redis.hgetall('rootahead:users')) || {};
      var today = new Date().toISOString().slice(0, 10);
      var out = [];
      for (var i = 0; i < ids.length; i++){
        var plan = parse(await redis.get('rootahead:plan:' + ids[i]));
        if (!plan) continue;
        var log = (await redis.hgetall('rootahead:planlog:' + ids[i])) || {};
        var perm = (await redis.hget('rootahead:planperm', ids[i])) == '1';
        var p = parse(profiles[ids[i]]) || {};
        var past = plan.days.filter(function(x){ return x.d <= today && x.type !== 'rest'; });
        var since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10), scores = [], lastRef = null;
        Object.keys(log).sort().forEach(function(k){ var l = parse(log[k]); if (l && l.status === 'done' && l.score){ if (k >= since) scores.push(l.score); lastRef = { d: k, score: l.score, text: l.text }; } });
        var done = past.filter(function(x){ var l = parse(log[x.d]); return l && l.status === 'done'; }).length;
        out.push({ deviceId: ids[i], firstName: p.firstName || null, lastName: p.lastName || null, team: p.team || null,
          goal: plan.settings.goal, eventDate: plan.settings.eventDate, weeks: Math.ceil(plan.days.length / 7),
          source: plan.source, adjustedAt: plan.adjustedAt, generatedAt: plan.generatedAt, done: done, due: past.length,
          ended: plan.days.length ? plan.days[plan.days.length - 1].d < today : false,
          avgScore: scores.length ? Math.round(scores.reduce(function(a, b){ return a + b; }, 0) / scores.length * 10) / 10 : null,
          lastReflection: lastRef, templateName: plan.templateName || '', canEdit: perm,
          endDate: plan.days.length ? plan.days[plan.days.length - 1].d : '' });
      }
      res.status(200).json({ riders: out });
      return;
    }

    if (req.method === 'GET'){
      var id = idOf(q.deviceId);
      if (!id){ res.status(400).json({ error: 'deviceId is required' }); return; }
      if (!req.headers['x-admin-key'] && !(await riderGate(redis, req, res, id))) return;
      var pl = parse(await redis.get('rootahead:plan:' + id));
      var lg = (await redis.hgetall('rootahead:planlog:' + id)) || {};
      var logOut = {}; Object.keys(lg).forEach(function(k){ var v = parse(lg[k]); if (v) logOut[k] = v; });
      var hist = ((await redis.lrange('rootahead:planarchive:' + id, 0, 19)) || []).map(parse).filter(Boolean)
        .map(function(h){ return h.summary || h; });
      var canEdit = (await redis.hget('rootahead:planperm', id)) == '1';
      var rts = (await redis.hgetall('rootahead:planroutes:' + id)) || {}, routesOut = {};
      Object.keys(rts).forEach(function(k){ var v = parse(rts[k]); if (v) routesOut[k] = v; });
      res.status(200).json({ plan: pl, log: logOut, history: hist, canEdit: canEdit, routes: routesOut });
      return;
    }

    if (req.method === 'POST'){
      var rid = idOf(b.deviceId);
      if (!rid){ res.status(400).json({ error: 'deviceId is required' }); return; }
      if (!(await riderGate(redis, req, res, rid))) return;
      if (b.routeLink){
        var rl = b.routeLink, rd = String(rl.d || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rd)){ res.status(400).json({ error: 'bad day' }); return; }
        var link = { km: Math.round((Number(rl.km) || 0) * 10) / 10, gainM: Math.round(Number(rl.gainM) || 0),
                     estMin: Math.round(Number(rl.estMin) || 0), planMin: Math.round(Number(rl.planMin) || 0), at: new Date().toISOString() };
        var le = {}; le[rd] = JSON.stringify(link);
        await redis.hset('rootahead:planroutes:' + rid, le);
        res.status(200).json({ ok: true, link: link });
        return;
      }
      if (b.log){
        var day = String(b.log.d || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)){ res.status(400).json({ error: 'bad day' }); return; }
        if (b.log.status === 'clear'){ await redis.hdel('rootahead:planlog:' + rid, day); }
        else {
          var rec = { status: b.log.status === 'skipped' ? 'skipped' : 'done', at: new Date().toISOString() };
          if (rec.status === 'done'){
            var score = Math.round(Number(b.log.score));
            var text = String(b.log.text || '').trim().slice(0, 50);
            if (!(score >= 1 && score <= 10) || !text){ res.status(400).json({ error: 'A finished ride needs a score from 1 to 10 and a short reflection.' }); return; }
            rec.score = score; rec.text = text;
          }
          var entry = {}; entry[day] = JSON.stringify(rec);
          await redis.hset('rootahead:planlog:' + rid, entry);
        }
        res.status(200).json({ ok: true });
        return;
      }
      var plan2 = cleanPlan(b.plan);
      if (!plan2){ res.status(400).json({ error: 'plan is required' }); return; }
      if ((await redis.hget('rootahead:planperm', rid)) != '1'){
        res.status(403).json({ error: 'Your coach makes your training plan.' }); return;
      }
      // the previous plan is archived (summary + full plan), never thrown away
      var old = parse(await redis.get('rootahead:plan:' + rid));
      if (old && old.days && old.days.length){
        var oldLog = (await redis.hgetall('rootahead:planlog:' + rid)) || {};
        await redis.lpush('rootahead:planarchive:' + rid, JSON.stringify({ summary: summarize(old, oldLog), plan: old }));
        await redis.ltrim('rootahead:planarchive:' + rid, 0, 19);
      }
      plan2.source = 'app'; plan2.coachNote = ''; plan2.adjustedAt = '';
      await redis.set('rootahead:plan:' + rid, JSON.stringify(plan2));
      await redis.sadd('rootahead:plans', rid);
      res.status(200).json({ ok: true, plan: plan2 });
      return;
    }

    if (req.method === 'PUT'){
      if (!admin.requireAdmin(req, res)) return;
      var cid = idOf(b.deviceId);
      if (typeof b.canEdit === 'boolean' && !b.plan){
        if (!cid){ res.status(400).json({ error: 'deviceId is required' }); return; }
        if (b.canEdit) { var pe = {}; pe[cid] = '1'; await redis.hset('rootahead:planperm', pe); }
        else await redis.hdel('rootahead:planperm', cid);
        res.status(200).json({ ok: true, canEdit: b.canEdit });
        return;
      }
      var plan3 = cleanPlan(b.plan);
      if (!cid || !plan3){ res.status(400).json({ error: 'deviceId and plan are required' }); return; }
      plan3.source = 'coach'; plan3.adjustedAt = new Date().toISOString();
      if (b.replace){   // a new plan (e.g. from a template) instead of an edit: keep the old one in the archive
        var prevPlan = parse(await redis.get('rootahead:plan:' + cid));
        if (prevPlan && prevPlan.days && prevPlan.days.length){
          var prevLog = (await redis.hgetall('rootahead:planlog:' + cid)) || {};
          await redis.lpush('rootahead:planarchive:' + cid, JSON.stringify({ summary: summarize(prevPlan, prevLog), plan: prevPlan }));
          await redis.ltrim('rootahead:planarchive:' + cid, 0, 19);
        }
      }
      await redis.set('rootahead:plan:' + cid, JSON.stringify(plan3));
      await redis.sadd('rootahead:plans', cid);
      var notified = false;
      if (b.notify && vapidReady){
        var sub = parse(await redis.hget('rootahead:push:users', cid));
        if (sub && sub.endpoint){
          try{
            await webpush.sendNotification(sub, JSON.stringify({ title: 'Training plan updated',
              body: 'Your coach adjusted your training plan. Tap to see it.', tag: 'rootahead-plan', url: '/#train' }), { TTL: 86400 });
            notified = true;
          } catch(err){ if (err && (err.statusCode === 404 || err.statusCode === 410)) await redis.hdel('rootahead:push:users', cid); }
        }
      }
      res.status(200).json({ ok: true, notified: notified, plan: plan3 });
      return;
    }

    // admin: delete one rider's plan, or every plan (with feedback, linked routes and plan history)
    if (req.method === 'DELETE'){
      if (!admin.requireAdmin(req, res)) return;
      var deleted = 0;
      if (b.all){
        if (b.confirm !== 'DELETE'){ res.status(400).json({ error: 'Type DELETE to confirm.' }); return; }
        for (var pi = 0; pi < PLAN_PREFIXES.length; pi++){
          var cur = '0', guard = 0;
          do {
            var sc = await redis.scan(cur, { match: PLAN_PREFIXES[pi] + '*', count: 500 });
            cur = String(sc[0]);
            var ks = sc[1] || [];
            for (var k = 0; k < ks.length; k += 100){ await redis.del.apply(redis, ks.slice(k, k + 100)); deleted += Math.min(100, ks.length - k); }
          } while (cur !== '0' && ++guard < 2000);
        }
        await redis.del('rootahead:plans');
        res.status(200).json({ ok: true, deleted: deleted });
        return;
      }
      var did = idOf(b.deviceId);
      if (!did){ res.status(400).json({ error: 'deviceId is required' }); return; }
      await redis.del.apply(redis, PLAN_PREFIXES.map(function(pf){ return pf + did; }));
      await redis.srem('rootahead:plans', did);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'Use GET, POST, PUT or DELETE' });
  } catch(err){
    res.status(err && err.notConfigured ? 503 : 500).json({ error: err && err.message ? err.message : 'Plan request failed' });
  }
};
