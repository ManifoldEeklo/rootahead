# ROOT-Ahead — route planner (team edition)

A separate edition of Trail-ahead for team use: same planner, own name and
splash photo. Everything stored in Redis uses the `rootahead:` key prefix
(visit/route counters, push subscriptions, favourite-ground cells), so it
can safely share a Redis database with Trail-ahead (`trailahead:` prefix)
without the two mixing their numbers or data. Deploy it as its **own**
Vercel project and connect the Redis database (and, for push notifications,
the two `VAPID_*` env vars) to that project too.

The splash photo is embedded in `index.html` (CSS `#splashScreen::before`) —
to swap it, replace the base64 `data:image/jpeg` URL there.

Mostly a static HTML app — routing (BRouter, Valhalla, OSRM, Overpass, NGI
Top10Vector, TOP10NL, the Flemish Tragewegenregister) runs as direct
`fetch()` calls from the browser to those public APIs, no backend involved.

Two small serverless functions were added on top for **anonymous usage
tracking** (app opens, unique devices, routes generated), stored in Upstash
Redis and viewable from the app's own Admin panel.

## What's in this repo

```
├── index.html            the entire app (map, UI, routing logic)
├── manifest.json          PWA manifest — enables "Add to Home Screen"
├── sw.js                   service worker — shows incoming push notifications
├── icon-192.png / icon-512.png   app icons for the home-screen install
├── api/
│   ├── track.js           records a "visit" or "route" event, triggers push on visit
│   ├── stats.js            reads back the current counters
│   ├── subscribe.js         stores/removes a push subscription (Admin panel only)
│   ├── favorite-route.js   records favourited ~60m ground cells from an uploaded GPX
│   ├── favorite-cells.js   reads back favourited cells near a point, for route generation
│   └── cron-summary.js     optional: once a day, writes a snapshot to GitHub
├── package.json
├── vercel.json             static config + the daily cron schedule
└── .gitignore
```

## Deploy

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "ROOT-Ahead"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### 2. Import into Vercel

- vercel.com → **Add New… → Project** → import the repo you just pushed.
- Framework preset: **Other**.
- Deploy once first — the tracking endpoints will simply error harmlessly
  (caught and ignored by the app) until you connect a database in step 3.

### 3. Connect Upstash Redis (for the usage stats)

Vercel's own **Vercel KV is deprecated** — the currently recommended path
is Upstash Redis via the Vercel Marketplace, which is what `api/track.js`
and `api/stats.js` are built for.

- Your Vercel project → **Storage** tab → **Create Database** → **Upstash →
  Redis** (there's a free tier).
- Connect it to this project. Vercel automatically injects `KV_REST_API_URL`
  and `KV_REST_API_TOKEN` as environment variables — nothing to type in by
  hand, no token to manage yourself. (Yes, still named `KV_*` — that's a
  naming leftover from before Vercel KV was deprecated in favour of this
  Upstash integration; `Redis.fromEnv()` in the code checks for both the old
  `KV_*` names and the newer `UPSTASH_REDIS_REST_*` names automatically, so
  no code changes are needed either way.)
- Redeploy (or it picks it up automatically) — the Admin panel's **Usage
  stats** block will now show real numbers.

### 3a. If the Admin panel says "Database not connected"

The API finds the Upstash variables under any prefix (`KV_REST_API_URL`,
`UPSTASH_REDIS_REST_URL`, or e.g. `STORAGE_KV_REST_API_URL`). If none exist the
database isn't connected to this project: Vercel → Storage → Upstash for Redis
→ Connect Project → then **Redeploy** (env changes only apply to new deploys).
A plain `REDIS_URL` (Redis Cloud / TCP) does not work for this app.

### 3b. Admin password for "Tracks per user"

Every generated route is stored per user in the same Upstash Redis (no extra
database needed). The user is the device profile (first name, last name, team)
typed once on the phone — there is no login.

- `rootahead:users:routecount` — hash, deviceId → number of routes
- `rootahead:users` — hash, deviceId → `{firstName,lastName,team,lastRouteAt}`
- `rootahead:user:<deviceId>:routes` — list of route ids, newest first
- `rootahead:route:<id>` — the route record including the full GPX

The Admin panel shows the count per user via `/api/admin-users`. That endpoint
only answers when the header matches the `ADMIN_PASSWORD` environment variable:
in Vercel → Settings → Environment Variables add `ADMIN_PASSWORD` with the same
value you type in the Admin panel (currently `Admin123`, set in `index.html` as
`ADMIN_PASSWORD`), then redeploy. Without it the table says the variable is missing.

Size: one GPX is roughly 50–500 KB depending on distance. Upstash's free tier
holds 256 MB, so a few thousand routes. A GPX over ~900 KB is counted but not stored.

### 4. (Optional) Push notifications when someone opens the app

Lets you get a notification on your own phone whenever anyone opens the
app — mainly meant for you as the owner, not for regular visitors (there's
no public UI for it; it's a button inside the Admin panel).

- Add **two** environment variables in Vercel → Settings → Environment Variables:
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`

  A matching key pair was generated for this project and given to you
  directly in chat (not written into this file, on purpose — a private key
  should never sit in something that gets committed to git). Paste those
  exact values in. The public half is also hardcoded as `VAPID_PUBLIC_KEY`
  near the top of the push-notification code in `index.html` — if you ever
  regenerate a new pair (`npx web-push generate-vapid-keys`), update it in
  **both** places so they still match.
- Optional: also add `VAPID_CONTACT` (e.g. `mailto:you@example.com`) — some
  push services want a contact address; it defaults to a placeholder if
  you skip this.
- Redeploy so the new env vars take effect.
- On your phone: open the deployed site → **Add to Home Screen** → open it
  from there → Admin panel (password) → **🔔 Notify me on new visits** →
  allow notifications when your browser asks.

### 4b. Notifications to riders (works like Blendroom)

Vercel → Settings → Environment Variables: `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:you@…`; `VAPID_CONTACT` also
works) and `ADMIN_PASSWORD` (`ADMIN_TOKEN` also works). Redeploy.
The app fetches the public key from `/api/vapid-public-key`, so nothing is
hardcoded and a new key pair only needs changing in Vercel.

**Every phone that should receive messages**
1. Open the app in Safari/Chrome → Share → Add to Home Screen (iPhone: required).
2. Start it from the icon, fill in name and team, tap **🔔 Notifications** →
   Allow. The bell shows **🔔 On**. ROOT-Ahead then appears in the phone's
   Settings → Notifications (turn it off there).
   The device re-registers itself on every start.

**Your message app: RA Messages**
1. Open `https://<project>.vercel.app/admin/` → Share → Add to Home Screen.
   It installs as "RA Messages" with its own icon.
2. Unlock with the admin password (remembered on that phone; **Lock** forgets it).
3. Choose Everyone / a team / people, write title + text, choose what opens
   when tapped, check the preview, tap **Send to N devices**.
   Devices that removed the app are taken off the list automatically.

Storage: `rootahead:push:users` (device → subscription), `rootahead:messages`
(last 200 sent). Needs iOS 16.4 or newer on iPhone.

### 4c. Train: personal training plans

- Rider: dashboard → **Train** → goal, hours per week, riding days, level,
  optional event date/name and FTP → **Make my plan**. The app builds a
  periodised plan (Base → Build → Peak → Taper before an event, an easier week
  every 4th week, 16 weeks max). Each workout shows its steps with power
  targets (from FTP) or effort (RPE). Riders mark days **Done**/**Skipped**;
  endurance rides have **Plan a route for this ride** (sets the distance in Track).
- Coach: Admin → **Training** → pick a rider → change any day's workout,
  minutes or note, add a note above the plan → **Save plan** (optionally
  notifies the rider; tapping opens Train).
- Live updates: when the coach saves (with notify), the push also tells an
  open app to reload the plan; the plan is also re-fetched every time Train
  opens or the app comes back to the screen.
- After a plan ends: a banner shows how it went and offers the next plan
  (starts with an easy week if the event was in the last 3 weeks). The old
  plan is archived, not deleted; riders see "Earlier plans", the coach list
  shows "plan ended".
- Storage: `rootahead:plan:<device>`, `rootahead:planlog:<device>` (done/skipped
  per day, kept across plans), `rootahead:planarchive:<device>` (last 20 plans),
  `rootahead:plans`.

### 4d. Coach tools in RA Admin (`/admin/` → Training)

- **Riders**: every rider with plan status, done/due, average score (last 14
  days) and their latest reflection. Open a rider to change any day, add notes,
  save (the rider's app updates), save the plan as a template, or give them a
  template from a chosen Monday (their current plan goes to their history).
- **Workouts**: your own workouts (name, note, steps with minutes and zone;
  "+ Intervals…" adds effort/recovery repeats). They appear under "Your
  workouts" in every workout dropdown. A plan keeps its own copy, so editing
  or deleting a workout never breaks a rider's plan.
- **Plan templates**: fixed multi-week plans (1–16 weeks, phase per week),
  built from standard and own workouts, given to one rider at a time.
- **Reflections**: when a rider taps Done they must give a score 1–10 and a
  reflection of max 50 characters; shown to the coach per day.
- Storage: `rootahead:coach:workouts`, `rootahead:coach:templates` (admin only).
- The installed admin app is now called "RA Admin" (reinstall to see the new name).

### 5. (Optional) Turn on Vercel Web Analytics

The page already ships the plain-HTML tracking snippet (no `@vercel/analytics`
npm package needed for a static site like this one). It only starts sending
data once you flip the switch:

- Your Vercel project → **Analytics** tab → **Enable**.
- That's it — page views start showing up in the dashboard on the next visit.

### 5. (Optional) Daily snapshot to a GitHub file

`api/cron-summary.js` runs once a day (see the `crons` entry in
`vercel.json`) and appends `{date, visitsTotal, uniqueDevices, routesTotal}`
to `stats/daily.json` in this repo — a simple historical log, without the
commit-per-visit problem a naive "log straight to GitHub" approach would have.

This step needs a **GitHub Personal Access Token** with permission to write
to this repo:

- GitHub → Settings → Developer settings → Personal access tokens → generate
  one scoped to just this repo, **Contents: read and write**.
- In your Vercel project → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | the token you just generated |
| `GITHUB_REPO` | `your-username/your-repo` |
| `GITHUB_STATS_PATH` | *(optional, defaults to `stats/daily.json`)* |
| `GITHUB_BRANCH` | *(optional, defaults to `main`)* |

If you skip this step entirely, the app still works fine — you just won't
get the daily GitHub snapshot; the live numbers in the Admin panel keep
working off Redis regardless.

## Mobile

Detects touch/narrow screens and switches the sidebar into a slide-in
drawer (☰ button in the header). On phones the menu opens by default after
the splash screen; generating a route collapses it automatically so the map
fills the screen. **Generate**, **Clear**, and **.gpx** live in the map's
own bottom bar, not inside the drawer, so they're always reachable.

## Install as an app (PWA)

Works only on the HTTPS Vercel URL (not from a local file).

- **Android (Chrome/Edge/Samsung Internet):** the dashboard shows an *Install*
  card that opens the system install prompt. Also via browser menu → *Install app*.
- **iPhone/iPad:** Safari has no install prompt. The *Install* card shows the
  steps: Share → *Add to Home Screen* → *Add*.
- Files: `manifest.json` (name, colours, icons incl. maskable, Track shortcut),
  `sw.js` (offline app shell + push), `apple-touch-icon.png`,
  `icon-maskable-192/512.png`. `vercel.json` serves `sw.js` and the manifest
  uncached so updates arrive.
- After a deploy the installed app picks up the new version on its next
  online start (page is fetched network-first). If `sw.js`'s pre-cache list
  changes, bump `CACHE` in `sw.js`.
- Offline: the app opens, but maps, routing and route storage need a connection.
- iPhone keeps the installed app's storage separate from Safari: the first
  start of the installed app asks for name/team again and gets its own device id.

## Known limitations, stated plainly

- **The admin password (`Admin123`) is a plain string inside `index.html`.**
  UI convenience only, not real security — readable by anyone in the page
  source. Same is true of `/api/stats` itself: it's not access-controlled,
  so anyone who knows the URL can read the counters. Fine for a personal
  project's usage numbers; not something to put real secrets behind.
- **Device counting uses `localStorage`.** Clearing browser data makes a
  returning visitor look "new" again — a known, accepted trade-off of not
  requiring accounts or real device fingerprinting.
- **External routing APIs** (BRouter, Valhalla, Overpass, the various
  government geodata services) are outside this app's control and can go
  down or change shape; the app is built to degrade gracefully rather than
  break when that happens, but can't guarantee their uptime.
