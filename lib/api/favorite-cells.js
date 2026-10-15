// Reads back favourited grid cells within a bounding box, so the route
// generator can give a small scoring bonus to candidate trail points that
// fall in ground real riders have actually marked as a highlight — the
// same mechanism as the built-in forest/water scenic bonus, just informed
// by the community instead of OSM landuse tags.
var getRedis = require('./_redis').getRedis;

var CELL_SIZE_M = 60;

function cellKeyFor(lat, lon){
  var mPerDegLat = 110574, mPerDegLon = 111320 * Math.cos(lat * Math.PI/180);
  var x = lon * mPerDegLon, y = lat * mPerDegLat;
  return { x: Math.round(x / CELL_SIZE_M), y: Math.round(y / CELL_SIZE_M) };
}

module.exports = async function handler(req, res){
  if (req.method !== 'GET'){
    res.status(405).json({ error: 'Use GET' });
    return;
  }
  try{
    var lat = Number(req.query.lat), lon = Number(req.query.lon), radiusM = Number(req.query.radiusM) || 3000;
    if (!isFinite(lat) || !isFinite(lon)){
      res.status(400).json({ error: 'lat and lon query params are required' });
      return;
    }

    var redis = getRedis();
    var center = cellKeyFor(lat, lon);
    var cellSpan = Math.ceil(radiusM / CELL_SIZE_M);
    // Bounded scan over the candidate cell grid around the point — capped
    // so a very large radiusM can't turn this into an enormous fan-out of
    // Redis calls (400 cells is already a generous local area at 60m/cell).
    var maxCells = 400;
    var keys = [];
    outer:
    for (var dx=-cellSpan; dx<=cellSpan; dx++){
      for (var dy=-cellSpan; dy<=cellSpan; dy++){
        keys.push((center.x+dx) + ':' + (center.y+dy));
        if (keys.length >= maxCells) break outer;
      }
    }

    var counts = await Promise.all(keys.map(function(k){
      return redis.scard('rootahead:favcell:' + k).catch(function(){ return 0; });
    }));

    var favoriteCells = [];
    for (var i=0;i<keys.length;i++){
      if (counts[i] > 0){
        var parts = keys[i].split(':');
        favoriteCells.push({ cellX: Number(parts[0]), cellY: Number(parts[1]), votes: counts[i] });
      }
    }

    res.status(200).json({ cellSizeM: CELL_SIZE_M, cells: favoriteCells });
  } catch(err){
    res.status(500).json({ error: err && err.message ? err.message : 'Could not read favourite cells' });
  }
};
