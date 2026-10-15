// Coach library: own workouts and fixed plan templates. Admin only.
//   GET    /api/coach-library                       → { workouts:[…], templates:[…] }
//   POST   { kind:'workout'|'template', item }      → create or update (item.id keeps it)
//   DELETE { kind, id }                             → remove (plans already using it keep their copy)
// Keys: rootahead:coach:workouts, rootahead:coach:templates (hash id → JSON)
var getRedis = require('./_redis').getRedis;
var requireAdmin = require('./_admin').requireAdmin;

var ZONES = ['Z1','Z2','Z3','SS','Z4','Z5','Z6'];
var BUILTIN = ['rest','rec','end','long','tempo','ss','thr','vo2','hills','sprint','event'];
function parse(v){ if (v && typeof v === 'object') return v; try{ return JSON.parse(v); } catch(e){ return null; } }
function str(v, n){ return String(v == null ? '' : v).trim().slice(0, n); }
function newId(p){ return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function cleanSteps(steps){
  return (Array.isArray(steps) ? steps : []).slice(0, 40).map(function(s){
    return { label: str(s.label, 60) || 'Step', min: Math.max(0.25, Math.min(300, Number(s.min) || 0)), zone: ZONES.indexOf(s.zone) !== -1 ? s.zone : 'Z2' };
  }).filter(function(s){ return s.min > 0; });
}
function cleanWorkout(w){
  var steps = cleanSteps(w.steps);
  if (!str(w.title, 60) || !steps.length) return null;
  return { id: /^c_[a-z0-9]+$/.test(w.id || '') ? w.id : newId('c_'), title: str(w.title, 60), about: str(w.about, 300), steps: steps };
}
// a template day is a built-in type, or a custom workout copied in full
function cleanTemplateDay(d){
  d = d || {};
  if (d.type === 'custom' && d.custom){
    var c = cleanWorkout(Object.assign({}, d.custom, { id: d.wid }));
    if (!c) return { type:'rest', min:0 };
    return { type:'custom', wid: c.id, custom: { title: c.title, about: c.about, steps: c.steps },
             min: Math.round(c.steps.reduce(function(t, s){ return t + s.min; }, 0)), note: str(d.note, 200) || undefined };
  }
  var t = BUILTIN.indexOf(d.type) !== -1 ? d.type : 'rest';
  return { type: t, min: t === 'rest' ? 0 : Math.max(0, Math.min(480, Math.round(Number(d.min) || 0))), note: str(d.note, 200) || undefined };
}
function cleanTemplate(t){
  if (!str(t.name, 60) || !Array.isArray(t.weeks) || !t.weeks.length) return null;
  return {
    id: /^t_[a-z0-9]+$/.test(t.id || '') ? t.id : newId('t_'),
    name: str(t.name, 60), about: str(t.about, 300),
    weeks: t.weeks.slice(0, 16).map(function(w){
      var days = (w && Array.isArray(w.days) ? w.days : []).slice(0, 7);
      while (days.length < 7) days.push({ type:'rest' });
      return { phase: str(w && w.phase, 12) || 'base', days: days.map(cleanTemplateDay) };
    })
  };
}

module.exports = async function handler(req, res){
  if (!requireAdmin(req, res)) return;
  try{
    var redis = getRedis();
    if (req.method === 'GET'){
      var w = (await redis.hgetall('rootahead:coach:workouts')) || {}, t = (await redis.hgetall('rootahead:coach:templates')) || {};
      var byName = function(a, b){ return (a.title || a.name).localeCompare(b.title || b.name); };
      res.status(200).json({ workouts: Object.keys(w).map(function(k){ return parse(w[k]); }).filter(Boolean).sort(byName),
                             templates: Object.keys(t).map(function(k){ return parse(t[k]); }).filter(Boolean).sort(byName) });
      return;
    }
    var b = req.body || {};
    var key = b.kind === 'template' ? 'rootahead:coach:templates' : b.kind === 'workout' ? 'rootahead:coach:workouts' : null;
    if (!key){ res.status(400).json({ error: 'kind must be workout or template' }); return; }
    if (req.method === 'POST'){
      var item = b.kind === 'template' ? cleanTemplate(b.item || {}) : cleanWorkout(b.item || {});
      if (!item){ res.status(400).json({ error: b.kind === 'template' ? 'A template needs a name and at least one week.' : 'A workout needs a name and at least one step.' }); return; }
      var now = new Date().toISOString(), prev = parse(await redis.hget(key, item.id));
      item.createdAt = (prev && prev.createdAt) || now; item.updatedAt = now;
      var e = {}; e[item.id] = JSON.stringify(item);
      await redis.hset(key, e);
      res.status(200).json({ ok: true, item: item });
      return;
    }
    if (req.method === 'DELETE'){
      if (b.id) await redis.hdel(key, String(b.id).slice(0, 40));
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'Use GET, POST or DELETE' });
  } catch(err){
    res.status(err && err.notConfigured ? 503 : 500).json({ error: err && err.message ? err.message : 'Library request failed' });
  }
};
