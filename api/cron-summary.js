// Runs once a day (see vercel.json "crons"), reads the current counters
// from Upstash Redis, and appends today's snapshot to a JSON file in this
// repo on GitHub. The GitHub token lives only in Vercel's environment
// variables — it never reaches the browser, and this function only ever
// runs server-side/on schedule.
var Redis = require('@upstash/redis').Redis;

module.exports = async function handler(req, res){
  try{
    var redis = Redis.fromEnv();
    var visitsTotal = Number((await redis.get('rootahead:visits:total')) || 0);
    var routesTotal = Number((await redis.get('rootahead:routes:total')) || 0);
    var uniqueDevices = Number((await redis.scard('rootahead:visits:devices')) || 0);

    var token = process.env.GITHUB_TOKEN;
    var repo = process.env.GITHUB_REPO; // e.g. "yourname/root-ahead"
    var filePath = process.env.GITHUB_STATS_PATH || 'stats/daily.json';
    var branch = process.env.GITHUB_BRANCH || 'main';

    if (!token || !repo){
      res.status(500).json({ error: 'GITHUB_TOKEN and GITHUB_REPO must be set in the Vercel project environment variables.' });
      return;
    }

    var apiUrl = 'https://api.github.com/repos/' + repo + '/contents/' + filePath;
    var headers = {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'root-ahead-cron'
    };

    // Read the existing file (if any) to get its current contents + sha —
    // GitHub's Contents API requires the sha of the file you're replacing.
    var existingSha = null;
    var history = [];
    var getResp = await fetch(apiUrl + '?ref=' + branch, { headers: headers });
    if (getResp.ok){
      var existing = await getResp.json();
      existingSha = existing.sha;
      try{
        var decoded = Buffer.from(existing.content, 'base64').toString('utf8');
        var parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) history = parsed;
      } catch(e){ history = []; }
    } else if (getResp.status !== 404){
      throw new Error('GitHub read failed: ' + getResp.status + ' ' + (await getResp.text()));
    }

    var today = new Date().toISOString().slice(0, 10);
    history = history.filter(function(row){ return row.date !== today; }); // replace if run twice same day
    history.push({ date: today, visitsTotal: visitsTotal, uniqueDevices: uniqueDevices, routesTotal: routesTotal });

    var putBody = {
      message: 'Daily stats ' + today + ' — ' + visitsTotal + ' opens, ' + uniqueDevices + ' devices, ' + routesTotal + ' routes',
      content: Buffer.from(JSON.stringify(history, null, 2)).toString('base64'),
      branch: branch
    };
    if (existingSha) putBody.sha = existingSha;

    var putResp = await fetch(apiUrl, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(putBody)
    });
    if (!putResp.ok){
      throw new Error('GitHub write failed: ' + putResp.status + ' ' + (await putResp.text()));
    }

    res.status(200).json({ ok: true, date: today, visitsTotal: visitsTotal, uniqueDevices: uniqueDevices, routesTotal: routesTotal });
  } catch(err){
    res.status(500).json({ error: err && err.message ? err.message : 'Cron summary failed' });
  }
};
