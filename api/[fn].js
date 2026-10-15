// ONE serverless function for every /api/<name> address.
// Vercel's Hobby plan allows at most 12 functions per deployment; the app has 19 endpoints,
// so they live in lib/api/ and this dispatcher runs the right one. The addresses do not change:
// /api/races, /api/plan, … all still work exactly as before (also the daily cron).
var HANDLERS = {
  'admin-message':    function(){ return require('../lib/api/admin-message.js'); },
  'admin-reset':      function(){ return require('../lib/api/admin-reset.js'); },
  'admin-users':      function(){ return require('../lib/api/admin-users.js'); },
  'coach-library':    function(){ return require('../lib/api/coach-library.js'); },
  'cron-summary':     function(){ return require('../lib/api/cron-summary.js'); },
  'favorite-cells':   function(){ return require('../lib/api/favorite-cells.js'); },
  'favorite-route':   function(){ return require('../lib/api/favorite-route.js'); },
  'health':           function(){ return require('../lib/api/health.js'); },
  'plan':             function(){ return require('../lib/api/plan.js'); },
  'races':            function(){ return require('../lib/api/races.js'); },
  'rider-login':      function(){ return require('../lib/api/rider-login.js'); },
  'rider-photo':      function(){ return require('../lib/api/rider-photo.js'); },
  'riders':           function(){ return require('../lib/api/riders.js'); },
  'stats':            function(){ return require('../lib/api/stats.js'); },
  'subscribe':        function(){ return require('../lib/api/subscribe.js'); },
  'team-roster':      function(){ return require('../lib/api/team-roster.js'); },
  'teams':            function(){ return require('../lib/api/teams.js'); },
  'track':            function(){ return require('../lib/api/track.js'); },
  'vapid-public-key': function(){ return require('../lib/api/vapid-public-key.js'); }
};
module.exports = async function handler(req, res){
  var q = req.query || {};
  var name = String(q.fn || '').toLowerCase();
  var load = Object.prototype.hasOwnProperty.call(HANDLERS, name) ? HANDLERS[name] : null;
  if (!load){ res.status(404).json({ error: 'Unknown API: /api/' + name }); return; }
  delete q.fn;   // the endpoints never see the routing parameter
  return load()(req, res);
};
