// A rider's photo or a team logo (uploaded by the admin). GET /api/rider-photo?id=…&v=…  or  ?team=…&v=…
var getRedis = require('./_redis').getRedis;
var parse = require('./_riders').parse;
module.exports = async function handler(req, res){
  try{
    var q = req.query || {};
    var key = q.team ? 'rootahead:teamphoto:' + String(q.team).slice(0, 40) : 'rootahead:riderphoto:' + String(q.id || '').slice(0, 40);
    var p = parse(await getRedis().get(key));
    if (!p || !p.data){ res.status(404).end(); return; }
    res.setHeader('Content-Type', p.type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');   // the URL changes (v=) when the photo changes
    res.status(200).send(Buffer.from(p.data, 'base64'));
  } catch(err){ res.status(500).end(); }
};
