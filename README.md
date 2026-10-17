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

## Project structure: one serverless function

Vercel's Hobby plan allows at most **12 serverless functions** per deployment.
All API endpoints therefore live in `lib/api/*.js` and are served by ONE
function, `api/[fn].js`, which picks the endpoint from the address
(`/api/races` → `lib/api/races.js`). Addresses, the daily cron and the apps
are unchanged. Adding an endpoint: put the file in `lib/api/` and add one line
to the list in `api/[fn].js`. Files starting with `_` are shared helpers.

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

### 4e. Who makes the plan, Build plan, hours & km

- **Default: only the coach makes plans.** Per rider in RA Admin → Training →
  Riders → "Rider may make their own plan" (off by default). When off, the
  rider sees the coach's plan, cannot change it (the server refuses), and only
  marks days Done (score + reflection) or Skipped. Key: `rootahead:planperm`.
- **Build plan** (RA Admin → Training): 1) start from empty / app suggestion /
  template / a rider's plan, 2) fill the weeks (copy week → next, clear week,
  ± week, live hours + km per week), 3) pick riders (search, Everyone, Team …)
  and a start Monday → "Give this plan to N riders". Existing plans go to the
  riders' history. From a rider: "Make a plan for this rider" / "Copy this
  plan to other riders".
- **Hours & km stay in sync**: week totals update while typing; the rider's
  summary shows hours from the plan itself; km = minutes × pace per workout
  type. A route made with "Plan a route for this ride" is linked to that day
  (`rootahead:planroutes:<device>`) with its real km, climbing and riding time
  (km at the day's pace + 5 min per 100 m climbing) and flagged when it is
  >15% off or the plan changed since. Saving an own workout can update all
  plans (today and later) and templates that use it.

### 4f. RA Admin on phone, tablet and PC

From 760 px wide (iPad / Android tablet, laptop, desktop) RA Admin uses the
whole screen: riders as a table; a rider's plan, Build plan and templates as a
table (weeks × Mon–Sun, totals per week, ⧉ copy week → next, ⌫ clear week,
🗑 remove week, ✎ note per day, reflections and routes in the cells); Messages
in two columns; the workout editor with steps left and profile right.
Phones keep the one-column, week-by-week layout. It switches on rotate/resize.

### 4g. Riders, login codes and the clean sheet

- **Only the admin sets up riders** (RA Admin → Riders): name, team, sex, date
  of birth, height, weight, FTP, notes, photo (shrunk to max 640 px in the
  browser) and a **login code** (6 characters, auto-made; can be changed; must
  be unique; always visible to the admin).
- **The rider app asks for the code** (no self-registration any more). After
  signing in, the phone is that rider: plans, feedback, routes and notifications
  are stored under the rider's id, so the same code on another phone shows the
  same plan. "My profile" shows the details; sex, date of birth, height, weight
  and FTP can be changed with the code (the code must be the signed-in rider's);
  name, team, photo and code are admin-only. FTP from the profile is used for
  power targets. 10 wrong codes from one network → 15 min wait.
- **Clean sheet**: RA Admin → Riders → "Start with a clean sheet" deletes all
  `rootahead:*` data (optionally keep riders and/or own workouts + templates).
  Every phone wipes its old local data once on its next start.
- Keys: `rootahead:riders`, `rootahead:ridercodes`, `rootahead:riderphoto:<id>`.
- Deleting a rider also deletes their plan, feedback, routes and push sign-up.

- **Teams** (RA Admin → Teams): name (unique), colour, description, logo or
  team photo. Link riders in the team editor (tick riders; a rider in another
  team moves) or in the rider form (team dropdown). Renaming a team renames it
  for all its riders; deleting a team leaves its riders without a team. The
  rider app shows the team name in the team colour and the logo in My profile.
  Keys: `rootahead:teams`, `rootahead:teamphoto:<id>`. The clean sheet option
  "keep riders" also keeps the teams.

- **Nickname** (just for fun): set by the admin, riders may change it in My
  profile (with their code). Shown on the dashboard, in My profile and in Team.
- **Team tile** on the dashboard: all riders per team as cards (photo or
  initials on the team colour, name, nickname, age; "YOU" on your own card),
  own team first, filter chips per team, tap a card to see it large.
  `/api/team-roster?id=<rider id>` only answers signed-in riders and sends ages,
  never birth dates, codes or notes.
- **Layout (rider app)**: the dashboard's fixed top bar shows the logo and
  who is signed in (name, nickname, team). A fixed bottom bar on every screen
  (dashboard, Train, Calendar, Team and Track) has **Home**, **Refresh** and
  **Profile** (your photo or initials). Profile opens a menu upwards with
  **My profile**, **Notifications** and **Log out**. There are no Home
  buttons at the top any more; on Track the map and its panel end above the
  bottom bar. Hidden before signing in.
- **Team page (rider app)** opens on your own team (staff: their first team);
  the chips at the top switch to the other teams (your own is marked YOURS,
  there is no "All teams" any more). Every time Team is opened it starts on
  your own team again. Compact tiles: 3 per row on a phone (4 on a wide
  phone/tablet), so a team of ~20 riders is about 7 rows; tap a tile for the
  big card.
- In the rider form the team dropdown has "＋ New team…" to make a team on the spot.

- **Race calendar** (RA Admin → Races): only the admin adds races (date, name,
  type, where, distance, notes) and picks the riders (per team or one by one).
  Taking a rider off keeps their entry as "removed": the rider still sees the
  race, marked "Not selected anymore". "Cancel this race" keeps it in every
  calendar, marked CANCELLED in red; "Race is on again" undoes it; "Delete for
  good" exists only for cancelled races (mistakes).
  The rider app: Race tile (next race + count), a "Your races" strip on the
  dashboard (next 3, including changes), and the calendar (coming up / past)
  with each race's selected riders. `/api/races?rider=<id>` only answers
  signed-in riders and only shows races they are or were selected for.
  Key: `rootahead:races`. Notifications about races: not yet (to be discussed).

- **Build plan** (RA Admin → Training) works in four steps, like a rider's own
  plan: 1) who (one rider, several, or a team), 2) availability and goal (riding
  days, hours per week, level, goal, optional race/event, start week, length;
  filled in from the rider's current plan when one rider is picked; FTP comes
  from each rider's profile), then how to fill the weeks: Suggestion (the app's
  periodised plan), Template, Copy a plan, or Basic (endurance on riding days),
  3) adjust the weeks (riding days marked ●), 4) give the plan. The answers are
  stored with the plan, so next time they are filled in again.

- **Login codes are versioned** (`codeV`). The app sends its version with every
  request (`x-rider-v`); after a code reset the server answers `401 signedOut`
  for plans, feedback, races, team and profile, and the phone signs out with
  "Your login code was changed by your coach". The app checks on start, when it
  comes back to the screen, and every 5 minutes. Reset one rider (rider form →
  "Reset code…", or by typing a new code) or everyone (Riders → "Reset all
  login codes", type RESET → list of new codes to copy or print).
- **Delete training plans**: Training → Rider plans → "Delete all training
  plans" (type DELETE), or "Delete this plan" on a rider's page. Deletes plans,
  feedback, linked routes and plan history; keeps riders, teams, races, own
  workouts and templates.

- **Log out** button on the dashboard (and in My profile): signs out on this
  phone and on the server, back to the login screen.
- **Who is signed in** (RA Admin → Riders): green bullet = signed in on at
  least one phone (with "seen … ago"), red = signed out; summary "N of M riders
  signed in", refreshed every minute. Each phone has its own id
  (`rootahead_install`, header `x-install-id`); key
  `rootahead:sessions:<rider id>` (phone id → last seen). Signing in adds the
  phone, logging out removes it, a code reset removes all of them. Phones that
  were signed in before this update turn green when their app next checks in.

- **Home town** (rider form in RA Admin): the start of the rider's routes. The
  app pre-fills Start in Track with it (", Belgium" is added when no country
  is given; Eeklo when empty) and uses it for "Plan a route for this ride",
  unless the rider already chose another start. Looked-up once and remembered
  on the phone (`rootahead_home_geo`); a new home town from the coach is used
  on the next check-in.
- **Training routes ask for 15% more distance** (`TRAIN_ROUTE_EXTRA` in
  index.html) because generated routes tend to come out a bit short; the fit
  check against the planned time is unchanged.

- **Calendar** (was: Race calendar). Three kinds in one calendar
  (`rootahead:races`, field `kind`): races, club trainings and (sponsor) events,
  each with date, start time, type, place, distance (not for events), notes and
  invited riders. RA Admin → Calendar: + Race / + Training / + Event, filters by
  kind and time, reply counts per item (✓ coming · ✗ not · ? no reply), and per
  rider in the editor. Rider app: the Calendar tile (red badge = to confirm),
  inside four small tiles (All / Races / Training / Events), "To confirm" first
  with one-tap ✓ I'll be there / ✗ Can't come, "change" to answer again, and
  the dashboard strip "Your calendar" with ✓/✗ right on each line. Replies:
  `POST /api/races { reply, id, rider }` (only while selected and not cancelled).

- **Invitations send a push** to riders who are newly invited (or invited
  again after being taken off) for a race, training or event, if the item is
  today or later; "Send a notification to newly invited riders" in the form
  (on by default). Tapping it opens the calendar; an open app refreshes it.
  Re-inviting clears the old answer, so the rider confirms again.
- **Rider start screen** shows only items that still need an answer plus what
  happens in the next 7 days; everything else is under Calendar.
- **RA Admin → Calendar refreshes the answers every 15 s** (list and an open
  item, without touching what you are editing).

- **Staff** (RA Admin → Staff): sport director, team coach, soigneur,
  mechanic, physio, team manager, doctor, press officer, other. Name, role,
  team(s) they work for, phone, e-mail, notes, photo and their own login code
  (same code table as riders, so every code is unique; reset / change signs
  them out everywhere; green/red signed-in bullet). In the app staff see only
  **Calendar** (everything their teams' riders are invited to, with the team's
  answers; they don't confirm) and **Team** (riders + staff of their teams);
  Train, Food and Track are hidden. Riders see the staff of their team in Team.
  Keys: `rootahead:staff` (ids start with `s_`). Endpoint `/api/staff`.

- **Rider form** (RA Admin → Riders) is a compact entry form: name, nickname,
  login code / sex, birth date, height, weight, FTP / home town, notes. No team
  choice there: riders are linked to teams under **Teams**; a linked team shows
  as a coloured label next to the name. The rider list uses denser rows.

- **GSM + e-mail** on riders and staff (compact entry forms for both; team
  labels shown read-only). Staff see their riders' GSM in the app (call button);
  everybody sees the GSM of their team's staff; riders never see each other's.
- **Teams = matrix** (RA Admin → Teams): team chips on top (✎ edit, + Add team),
  then rows = riders (then staff), columns = teams. One tap links; for riders a
  tap on another team moves them (one team only), a tap on the linked cell
  unlinks; staff toggle per team (several allowed). Saved at once
  (`POST /api/teams {action:'assign'|'staffTeam'}`). Sticky header and name
  column, search, filters Everyone / Riders / Staff / No team yet; built for
  ~60+ people. The test files contain 54 riders and 10 staff in 4 teams.

- **Team chips** (Teams page): tap the team → one compact table of the team,
  staff first (in role order: Sport Director, coach, soigneur…), then the
  riders, with the same aligned columns: Name · Role · GSM · E-mail · Login
  code · Status; tap a row to open that person's form. ✎ on the chip (or
  "✎ Edit team") edits name, colour, logo/photo and description.

- **No-internet banner** (rider app and RA Admin, every screen): a red bar
  "No internet connection" appears at start-up, when the app comes back to the
  screen, and as soon as the connection drops. It doesn't trust the phone's
  own "online" flag alone (Wi-Fi without internet): it pings
  `/api/vapid-public-key`, re-checks every 15 s while offline and after any
  failed request. "Try again" re-checks; ✕ shrinks it to a small "Offline"
  pill. When the connection returns it shows "Back online" for 2.5 s.
  RA Admin now registers the service worker too, so it opens offline (last
  loaded page, network-first) instead of showing the browser's error page.

- **Splash screen setup** (RA Admin → **Splash**). Locked with a separate
  splash code on top of the admin password: `SPLASH_PASSWORD` in Vercel, or
  **Admin321** when that variable is not set (set it to change the code; the
  code is asked once per browser session, **Lock** forgets it).
  - Timing (1–15 s), background photo + transparency (default: the team
    photo), logo + transparency + size (default: the ROOT Ahead logo; a PNG
    with transparent background works best), and on/off for usage numbers,
    tagline (text editable), loading bar and credit line.
  - **Special occasions**: animation + message on the splash. Ready-made:
    Halloween, Sinterklaas, Christmas, New Year (fireworks), Valentine,
    Carnival and Easter (both move with Easter every year), Spring classics,
    Tour de France, Olympic Games, World Cup, Celebration, own occasion. Each
    has name, message, animation (falling, snow, floating up, flying across,
    confetti, fireworks), symbols (emoji), colours, amount, and dates (every
    year / only these dates / around Easter). The highest active one in the
    list is shown. Live phone preview in the admin.
  - Logo position: Left ↔ right and Up ↕ down sliders (shift in % of the
    screen), next to size and transparency.
  - **Extra text line**: text, colour, size, and where (above / under the
    logo, or at the top of the screen).
  - **New splash reaches everybody**: phones keep the last settings
    (`rootahead_splash`) so the splash looks right from the first frame and
    offline, and check for changes at every start and whenever the app comes
    back to the screen. When the admin changed something, the app plays the
    new splash right away (full time, from the start). **Notify every phone**
    (next to Save) also sends a notification; apps that are open show the new
    splash at once (push tag `rootahead-splash`).
- **Refresh** button on the dashboard (next to Log out): fetches everything
  fresh (newest splash, plan, team, calendar, app update) and starts the app
  again from the splash screen. The rider stays signed in.
  - Files: `splash-fx.js` (shared by both apps: presets, Easter dates,
    animations), `lib/api/splash.js`, `splash-default.jpg` (the team photo, for
    the admin preview). Keys: `rootahead:splash`, `rootahead:splashimg:bg|logo`.
    A clean sheet never removes the splash setup.

**Test files**: `root-ahead-test.html` and `ra-admin-test.html` share one test
database when opened in the same browser: make a rider in RA Admin, then sign
in with the code in the app. Demo codes: ELS2026, JAN2026, LOTTE26.

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
