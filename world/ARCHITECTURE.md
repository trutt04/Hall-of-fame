# League World: how it fits together

This is the technical blueprint. The plain-English owner's guide is `world/README.md`.

League World is a 3D world for a 12-team ESPN fantasy football league. League members open
one link on a phone, pick their team, and walk around a hillside town where where you live
is your place in the standings. Everything in the world is driven by ESPN data that a
scheduled GitHub Actions job saves into this repo. Nothing in the world is edited by hand.

## Ground rules (apply to every file)

- **No build step.** Plain ES modules served as static files by GitHub Pages. Relative imports
  only, always with the `.js` extension. No import maps, no bare specifiers, no npm runtime
  dependencies. three.js r160 is vendored: `import * as THREE from '<relative>/lib/three.module.min.js'`.
- **Phones first.** Portrait mid-range phones are the target. Budgets: under ~220 draw calls and
  ~160k triangles in view, no shadow maps, no post-processing, at most one hemisphere light, one
  directional light and one ambient light in the whole scene. "Lamps" are emissive meshes and
  additive sprites, never real lights. Merge static geometry. Reuse materials and geometries.
- **Art direction: low-poly, flat-shaded, stylized.** Vertex colors on merged geometry with
  `MeshLambertMaterial({ vertexColors: true, flatShading: true })` wherever possible. No external
  models, no image files. Text and signs are `CanvasTexture`s.
- **No NFL, team or ESPN logos or artwork, ever.** ESPN logo URLs are never read or stored.
  Avatars are generic and team-colored. Player and team names as plain text are fine.
- **Tone:** friends roasting each other about fantasy football. Funny and a little mean, never
  cruel. Jokes target records, lineups and luck. Never looks, family, money, health or anything
  personal. No profanity in our own copy.
- **Team names are untrusted text.** They change often and can contain emoji or symbols. Key
  everything on team `id`. In the DOM use `textContent` (never `innerHTML` with data). Canvas
  text is fine.
- **Existing site is off limits.** Never edit `/index.html` or `/beat.mp3`.
- **No secrets.** No cookies, tokens or passwords anywhere in the repo, the workflow or logs.
- Respect `prefers-reduced-motion`. Pause rendering when the tab is hidden. Wrap `localStorage`
  in try/catch.

## Folder map and ownership

```
index.html, beat.mp3            existing site (do not touch)
world/index.html, world/css/    page shell and HUD styles
world/lib/                      vendored three.js r160
world/fonts/                    vendored Bungee + Barlow Semi Condensed (OFL)
world/js/config.js              shared constants: tiers, team colors, palette, perf, paths
world/js/model/                 PURE logic, runs in Node and browser: derive.js, roasts.js
world/js/art/                   PURE three.js builders: materials, props, homes, avatar, critters, vehicles
world/js/core/                  engine, input, camera, audio, store, net (phase 2 seam)
world/js/world/                 terrain, layout, sky, plaza, town (homes + reactive details), traffic, residents
world/js/ui/                    HUD, team picker, arrival sequence, cards, map
world/data/league.json          current season, written by the sync job
world/data/history.json         past seasons, written by the sync job
world/data/status.json          sync health, written by the sync job
world/dev/                      developer pages (prop gallery). Not linked from the world.
scripts/                        sync-espn.mjs, lib/, fixtures/, test/
.github/workflows/espn-sync.yml the scheduled job
```

## Data flow

```
ESPN (unofficial API) --> scripts/sync-espn.mjs --> normalize --> validate --> world/data/*.json
                                  ^ same path for the placeholder fixture (raw ESPN shape)
world/data/*.json --> model/derive.js --> model --> world (town, plaza, HUD)
```

The browser never calls ESPN. It fetches `data/league.json`, `data/history.json` and
`data/status.json` (cache-busted), re-checks every few minutes, and re-derives when they change.

## Contract 1: `world/data/league.json` (normalized, schema 1)

Written only by the sync. Every field below is always present unless marked optional.
Numbers are plain numbers (points rounded to 2 decimals). Unknown optional things are `null`.

```jsonc
{
  "schema": 1,
  "source": "placeholder",              // "placeholder" (built from the fixture) or "espn" (real)
  "generatedAt": "2026-11-16T03:10:00Z",
  "league": {
    "id": 70578866,
    "name": "Dan's Real Cool League",
    "season": 2026,
    "isPublic": false,
    "teamCount": 12,
    "regularSeasonWeeks": 14,           // settings.scheduleSettings.matchupPeriodCount
    "playoffTeamCount": 6,              // settings.scheduleSettings.playoffTeamCount
    "currentWeek": 10,                  // status.currentMatchupPeriod
    "scoringPeriod": 10,                // top-level scoringPeriodId
    "finalScoringPeriod": 17,
    "seasonComplete": false,
    "scoringType": "PPR",               // "PPR" | "HALF_PPR" | "STANDARD" | null
    "starterSlots": { "QB": 1, "RB": 2, "WR": 2, "TE": 1, "FLEX": 1, "D/ST": 1, "K": 1 }  // may be {}
  },
  "teams": [
    {
      "id": 3,
      "name": "The REAL Commish***",
      "abbrev": "DAN",
      "owner": "Dan",                   // first name only, "" if unknown. Never a last name.
      "ownerKey": "o_3f9a1c2b",         // stable across seasons: short hash of the ESPN member id. Falls back to "t_<teamId>".
      "seed": 7,                        // ESPN playoffSeed, 1 is best. 0 if missing.
      "finalRank": 0,                   // rankCalculatedFinal. 0 until the season is over.
      "wins": 4, "losses": 5, "ties": 0,
      "pointsFor": 1040.52, "pointsAgainst": 1088.1,
      "streakType": "LOSS",             // "WIN" | "LOSS" | "TIE" | "NONE"
      "streakLength": 2,
      "moves": { "acquisitions": 14, "drops": 14, "trades": 1 },
      "roster": {                        // null when the roster view was unavailable
        "ir": [ { "name": "Some Player", "pos": "WR" } ],          // players sitting in the IR slot
        "emptyStarters": ["FLEX"],                                  // starting slots with nobody in them
        "badStarters": [ { "name": "Some Player", "pos": "RB", "slot": "RB", "why": "OUT" } ],
                                         // starters who cannot score: why is "OUT" | "IR" | "BYE" | "SUSPENDED"
        "starters": [ { "name": "Some Player", "pos": "QB", "slot": "QB", "points": 18.2, "projected": 17.5 } ],
        "bench":    [ { "name": "Some Player", "pos": "WR", "slot": "BE", "points": 22.1, "projected": 9.0 } ]
      }
    }
  ],
  "matchups": [                          // every matchup of the season so far plus scheduled future ones
    {
      "week": 10,
      "playoff": false,
      "bracket": "NONE",                 // "NONE" | "WINNERS" | "CONSOLATION"
      "home": { "teamId": 3, "points": 88.4, "projected": 104.2 },   // projected is optional/null
      "away": { "teamId": 9, "points": 101.7, "projected": 110.0 },  // away is null for a bye
      "winner": "undecided"              // "home" | "away" | "tie" | "undecided"
    }
  ],
  "lastWeekLineups": {                   // optional, null if unavailable. Keyed by team id, for the last COMPLETED week.
    "week": 9,
    "teams": { "3": { "benchTop": { "name": "X", "pos": "WR", "points": 31.4 },
                      "starterLow": { "name": "Y", "pos": "RB", "points": 1.2 },
                      "benchTotal": 64.3 } }
  },
  "draft": [ { "round": 1, "pick": 4, "teamId": 3, "name": "Some Player", "pos": "RB" } ],  // optional, [] if unavailable
  "nfl": {
    "kickoffs": ["2026-11-13T01:15:00Z"] // sorted, unique real kickoff times for the whole season. [] if unavailable.
  }
}
```

## Contract 2: `world/data/history.json` (schema 1)

```jsonc
{
  "schema": 1,
  "source": "placeholder",
  "generatedAt": "2026-11-16T03:10:00Z",
  "seasons": [                           // oldest first, completed seasons only
    {
      "season": 2025,
      "regularSeasonWeeks": 14,
      "playoffTeamCount": 6,
      "teams": [ { "id": 3, "name": "…", "owner": "Dan", "ownerKey": "o_3f9a1c2b", "seed": 4, "finalRank": 1,
                   "wins": 9, "losses": 5, "ties": 0, "pointsFor": 1650.2, "pointsAgainst": 1500.1 } ],
      "games": [ [1, 3, 101.2, 9, 88.0, 0] ]
      // [week, homeTeamId, homePoints, awayTeamId, awayPoints, kind]  kind: 0 regular, 1 winners bracket, 2 consolation
      // away fields are null for a bye
    }
  ]
}
```

Champion of a season is the team with `finalRank === 1`. Last place is the highest `finalRank`.
People are matched across seasons by `ownerKey` (a manager can rename their team every year).

## Contract 3: `world/data/status.json`

```jsonc
{
  "schema": 1,
  "ok": false,
  "reason": "league_private",   // "ok" | "league_private" | "not_found" | "endpoint_moved" | "rate_limited" | "server_error" | "network" | "bad_shape"
  "detail": "HTTP 401 from lm-api-reads.fantasy.espn.com",
  "lastAttempt": "2026-11-16T03:10:00Z",
  "lastSuccess": null,
  "consecutiveFailures": 3
}
```

## Contract 4: the model (`world/js/model/derive.js`)

```js
import { derive } from './model/derive.js';
const model = derive(league, history, { now: new Date() });   // pure, deterministic for the same inputs + now
```

`history` may be `null`. `derive` never throws on missing optional data: it leaves the related
fields `null`/empty and the world simply shows less.

```js
model = {
  meta: {
    leagueName, season, week, regularSeasonWeeks, playoffTeamCount, teamCount,
    phase,            // 'preseason' | 'regular' | 'playoffs' | 'complete'
    isSample,         // true when league.source !== 'espn'
    generatedAt,      // ISO string from league.json
    weekStatus,       // 'pre' | 'live' | 'final' for the current week's matchups
    nflLive,          // true if a real NFL game is in progress at `now` (kickoff <= now <= kickoff + 3.5h)
    nextKickoff,      // ISO string or null
  },
  cutLine,            // = playoffTeamCount. The playoff line sits between rank cutLine and cutLine + 1.
  order,              // [teamId] best to worst
  tiers,              // { hill: [ids], heights: [ids], bubble: [ids], park: [ids], dump: [ids] } each best to worst
  teams,              // { [id]: TeamModel }
  matchups,           // current week: [{ week, homeId, awayId, homePts, awayPts, homeProj, awayProj, status, winnerId, margin }]
  lastWeek,           // null or { week, results: [same shape as matchups, all final], lowScoreId, highScoreId }
  headlines,          // newspaper stories, lead story first: [{ id, kind, headline, body, teamIds }]
  blimp,              // one short ALL CAPS line (60 chars max) for the blimp banner
  history,            // see below, or null when there is no history
};

TeamModel = {
  id, name, abbrev, owner, ownerKey,
  color,              // int from TEAM_COLORS, by index of id in ascending sorted ids
  rank,               // 1..N
  prevRank,           // rank after the previous completed week, or null
  rankDelta,          // prevRank - rank (positive = moved up), 0 if unknown
  tier, prevTier,     // 'hill' | 'heights' | 'bubble' | 'park' | 'dump'
  tierMove,           // 'up' | 'down' | null  (tier changed since the previous completed week)
  slot,               // 0-based position inside its tier, best first
  record: { wins, losses, ties, text },      // text like "6-4" or "6-3-1"
  pointsFor, pointsAgainst,
  streak: { type, length },                  // type 'W' | 'L' | 'T' | null
  inPlayoffSpot,      // rank <= cutLine
  onCutLine,          // rank === cutLine || rank === cutLine + 1  (gets the flickering "For Sale?" sign)
  clinched, eliminated,                      // conservative math, only true when certain
  trashBags,          // 0..12. Walk the season's finished games in order: loss +1, win -1, never below 0.
  flamingos,          // current win streak if >= 2, else 0 (max 6)
  ir: { count, names },                      // players in the IR slot -> ambulance outside
  goalposts,          // 'up' | 'crooked' (a starter is OUT/IR/BYE/SUSPENDED) | 'down' (an empty starting slot)
  lineupNotes,        // ['FLEX is empty', 'Starting Some Player (OUT)']
  thisWeek,           // null or { oppId, pts, oppPts, proj, oppProj, status, winning }  winning: true | false | null
  lastWeek,           // null or { oppId, pts, oppPts, won, margin }
  beatLastWeek,       // oppId or null. Phase 3 hook: whose home this team may vandalize.
  luck: { allPlayWins, allPlayLosses, expectedWins, delta },   // delta = actual wins - expected wins
  luckTag,            // 'luckiest' | 'unluckiest' | null  (exactly one of each league-wide once 3+ weeks are played)
  trophy: { toilet, spotlight },             // toilet: lowest score last week. spotlight: highest score last week.
  history: {          // null when there is no history for this owner
    titles, lastPlaces,                      // arrays of season years
    seasonsPlayed, seasonsSinceTitle,        // seasonsSinceTitle: number of completed seasons since their last title, or null if never won
    allTime: { wins, losses, ties, text },
    nemesis,          // null or { ownerKey, owner, teamName, teamId, wins, losses } the rival who beats them most (min 3 meetings). wins/losses are from THIS team's side.
    victim,           // same shape: the rival they beat most
  },
  roast: {
    arrival,          // one line shown under the rank stamp on arrival, about 90 chars max
    mailbox,          // 2 to 4 short lines for the home card
    sign,             // 28 chars max, for a yard sign
  },
};

model.history = {
  champions,          // newest first: [{ season, teamName, owner, ownerKey, teamId, record }]  teamId = that owner's current team id or null
  lastPlaces,         // same shape
  records,            // [{ id, label, value, text, ownerKey, teamId }]  ids: highWeek, lowWeek, blowout, bestRecord, worstRecord, mostPoints
  defendingChamp,     // null or { season, owner, ownerKey, teamName, teamId, rank, condition }  condition: 'shiny' (rank in top quarter) | 'pigeons' | 'cone' (bottom third)
};
```

Tier sizes come from the data, never hard-coded. With N teams and P playoff teams:
rank 1 is `hill`, rank N is `dump`, `bubble` is ranks `max(2, P-1)` to `min(N-1, P+2)`,
`heights` is whatever sits between the hill and the bubble, `park` is whatever sits between the
bubble and the dump. For N=12, P=6: heights 2-4, bubble 5-8, park 9-11.

Rank is ESPN's `seed` when all seeds are present and unique. Otherwise sort by win percentage,
then points for. After the season, `finalRank` wins when present for every team.

Roast copy is template-based with a seeded random pick (seed = team id + week + season) so a
line stays the same all week and changes next week.

## Contract 5: art (`world/js/art/`)

Pure builders. No scene, DOM or data access. Each returns plain three.js objects the world places.

Conventions: 1 unit = 1 meter. Y up. Objects are built with their base on y = 0 and their
"front" facing +Z. An adult avatar is about 1.7 tall.

```js
// art/index.js re-exports everything.
Prop   = { group, update?(dt, t), dispose() }

createHome(tier, { color, seed })  ->  Home
Home   = {
  group,                       // origin at the lot center, front door facing +Z (the street side)
  footprint: { w, d },         // solid box for collision, centered on the origin
  colliders: [{ x, z, r }],    // extra solid circles in local space (fence posts, heap...)
  anchors: {                   // THREE.Vector3 in local space
    door, mailbox, lawn, curb, roof, sign, goalposts, resident, trophy, plaque, truck,
    decor: [Vector3 x6],       // phase 3: eggs, toilet paper and tags attach here
  },
  setPorchLight(state),        // 'off' | 'win' | 'lose' | 'neutral'
  update(dt, t), dispose(),
}
// Tiers: 'hill' mansion (gold gates, throne terrace), 'heights' nice house, 'bubble' beige house,
//        'park' trailer, 'dump' tent on a garbage heap.

// Reactive details (attached at home anchors by the world)
createTrashPile(count), createGoalposts(state), createAmbulance(count), createMovingTruck(direction),
createForSaleSign(), createGoldenToilet(), createSpotlight(), createBlackCat(), createHorseshoe(),
createFlamingos(count), createYardSign(canvasOrTexture), createPlaque(canvasOrTexture)

// Set pieces
createCrown(), createThrone(), createGoldGates(), createFountain(), createStreetlight({ flicker }),
createBurningBarrel(), createRainCloud({ radius }), createStatue(condition), createNewspaperBox(),
createTelescope(), createPeriscope(), createOuthouse(), createBuilding(kind /* 'hof'|'graveyard'|'office' */),
createBoardFrame({ w, h }), createBlimp(), createFloodlight(), createTree(kind), createBush(), createTrashCan(),
createVelvetRope(length), createLawnChair(), createGrill()

// Characters and vehicles
createAvatar({ color, number, accessory })  ->  { group, setAnim(name), setAccessory(a), setNumber(n), update(dt, t), dispose() }
   // anims: 'idle' | 'walk' | 'run' | 'sit' | 'wave' | 'grill' | 'pace' | 'shiver' | 'cheer' | 'lounge'
   // accessory: 'crown' | 'visor' | 'cap' | 'bag' | null
createGarbageTruck()  ->  { group, setBedTilt(0..1), setSpeed(v), update(dt, t), dispose() }
createCritters(kind, { count, radius, seed })  ->  Prop      // 'raccoon' | 'seagull' | 'dog' | 'pigeon' | 'fly'
   // self-contained wandering inside the given radius around the group origin
```

## Contract 6: world seams for later phases

Nothing below is built in phase 1, but phase 1 code must not block it:

- **Identity:** the chosen team id lives in one place (`core/store.js`). `?team=<id>` in the URL
  already selects a team, so personal links (phase 2) only add a token on top.
- **Presence:** `core/net.js` exposes a no-op adapter (`connect`, `sendState`, `on('peer', ...)`).
  The player's state is one small serializable object `{ teamId, x, z, heading, anim }`. Residents
  and remote players are the same `createAvatar` objects held in one actor registry keyed by team
  id, so a live friend replaces the resident NPC with no world changes.
- **Thrown objects (phase 2):** props spawn through one `world.spawn(kind, position, velocity)`.
- **Vandalism (phase 3):** every home has `anchors.decor` slots and the model already exposes
  `beatLastWeek`. Decor is data (`[{ slot, kind }]`) applied by `town.setDecor(teamId, list)`.
- **Mini games (phase 3):** interactable places register through `interact.register({ id, position,
  radius, label, onUse })`. A mini game is just another `onUse`.
- **First place perks (phase 3):** perks hang off `model.order[0]`, never off a team name.
