// Records "this stretch was a favourite/beautiful part of a real ride" —
// submitted from a GPX a person uploaded. Never stores the raw uploaded
// route: only a set of grid-cell keys (same coarse grid the app already
// uses for scenery/dead-end detection), each incremented by how many
// DISTINCT devices favourited that cell. A cell favourited by many
// different people is a much stronger signal than one person uploading
// the same ride five times — hence a Set of device IDs per cell, not a
// plain counter.
var Redis = require('@upstash/redis').Redis;

var CELL_SIZE_M = 60; // matches the scenic-area "close enough" scale used elsewhere in the app
var MAX_CELLS_PER_SUBMIT = 400; // a generous cap — a very long ride shouldn't be able to flood the register in one submission
var MAX_SUBMITS_PER_DEVICE_PER_DAY = 5;

function cellKeyFor(lat, lon){
  var mPerDegLat = 110574, mPerDegLon = 111320 * Math.cos(lat * Math.PI/180);
  var x = lon * mPerDegLon, y = lat * mPerDegLat;
  return Math.round(x / CELL_SIZE_M) + ':' + Math.round(y / CELL_SIZE_M);
}

module.exports = async function handler(req, res){
  if (req.method !== 'POST'){
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  try{
    var redis = Redis.fromEnv();
    var body = req.body || {};
    var deviceId = String(body.deviceId || '').slice(0, 100);
    var points = Array.isArray(body.points) ? body.points : [];

    if (!deviceId){
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }
    if (!points.length){
      res.status(400).json({ error: 'points (array of [lat,lon]) is required' });
      return;
    }

    // Basic anti-abuse: cap submissions per device per day. The key expires
    // on its own after 24h, so no separate cleanup job is needed.
    var dayKey = 'rootahead:favupload:' + deviceId + ':' + new Date().toISOString().slice(0,10);
    var submitsToday = await redis.incr(dayKey);
    if (submitsToday === 1) await redis.expire(dayKey, 60*60*24);
    if (submitsToday > MAX_SUBMITS_PER_DEVICE_PER_DAY){
      res.status(429).json({ error: 'Daily upload limit reached for this device — try again tomorrow.' });
      return;
    }

    // Reduce the uploaded track to a de-duplicated set of grid cells (a
    // dense GPX can have thousands of points; we only care which distinct
    // ~60m patches of ground were part of a favourited ride).
    var cellSet = {};
    for (var i=0; i<points.length && Object.keys(cellSet).length < MAX_CELLS_PER_SUBMIT; i++){
      var p = points[i];
      if (!Array.isArray(p) || p.length < 2) continue;
      var lat = Number(p[0]), lon = Number(p[1]);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      cellSet[cellKeyFor(lat, lon)] = true;
    }
    var cells = Object.keys(cellSet);

    // One SADD per cell (device ID into that cell's voter set) — dedupes
    // automatically if the same device favourites overlapping ground again.
    await Promise.all(cells.map(function(cell){
      return redis.sadd('rootahead:favcell:' + cell, deviceId);
    }));

    res.status(200).json({ ok: true, cellsRecorded: cells.length });
  } catch(err){
    res.status(500).json({ error: err && err.message ? err.message : 'Could not record favourite route' });
  }
};
