// The browser fetches the push public key from here (as in Blendroom), so it
// always matches VAPID_PRIVATE_KEY in Vercel — no key hardcoded in the app.
module.exports = function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  var key = process.env.VAPID_PUBLIC_KEY;
  if (!key){ res.status(503).json({ error: 'VAPID_PUBLIC_KEY is not set in Vercel.' }); return; }
  res.status(200).json({ key: String(key).trim().replace(/^["']|["']$/g, '') });
};
