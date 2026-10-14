// Shared admin check. Accepts ADMIN_PASSWORD or ADMIN_TOKEN (Blendroom's name).
function adminSecrets(){
  return [process.env.ADMIN_PASSWORD, process.env.ADMIN_TOKEN].filter(Boolean).map(function(v){ return String(v).trim(); });
}
// Returns true when allowed; otherwise writes the error response and returns false.
function requireAdmin(req, res){
  var secrets = adminSecrets();
  if (!secrets.length){ res.status(503).json({ error: 'ADMIN_PASSWORD is not set in Vercel.' }); return false; }
  var given = String(req.headers['x-admin-key'] || '').trim();
  if (!given || secrets.indexOf(given) === -1){ res.status(401).json({ error: 'Wrong admin password.' }); return false; }
  return true;
}
function vapidSubject(){ return process.env.VAPID_SUBJECT || process.env.VAPID_CONTACT || 'mailto:admin@example.com'; }
module.exports = { requireAdmin: requireAdmin, vapidSubject: vapidSubject };
