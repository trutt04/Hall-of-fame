# Cloud Nine: the blueprint

Working title. A 3D multiplayer sky-island world in the browser, made as a birthday gift for
Bailey, who is turning 11. She is a competitive (all-star) cheerleader and her team's **flyer**.
She plays with her sister, cousins and friends, each on their own phone, tablet or computer,
by opening one link (GitHub Pages). Nothing to install.

It is the sister project of League World (`world/` in this repo), a finished three.js phone game,
and reuses its engine. This file is the contract between everyone building it. Read all of it.

Status: phase 1 (foundation), built by parallel agents and merged by the director. The owner
sends the birthday date, devices, favorite things and family notes later. Anything that depends
on them is a placeholder in `js/config.js`.

## Ground rules (every file)

- **No build step.** Plain ES modules served as static files. Relative imports only, always with
  the `.js` extension. No bare specifiers, no import maps, no npm runtime dependencies. three.js
  r160 is vendored: `import * as THREE from '<relative>/lib/three.module.min.js'`. The one
  exception: `js/net/` may `import()` the Firebase JS SDK from `https://www.gstatic.com/firebasejs/<pinned>/...`,
  lazily, only when online play starts. **Solo play must work with no network at all.**
- **Phones and tablets first** (an iPad is likely), laptops too. Portrait and landscape. Touch
  first; mouse and keyboard also work. Budgets, same as League World: under ~220 draw calls and
  ~160k triangles in view, no shadow maps, no post-processing, at most one hemisphere, one
  directional and one ambient light. Glow is emissive meshes and additive sprites, never real
  lights. Merge static geometry. Reuse materials and geometries. Up to 10 characters on screen.
- **Art: low-poly, flat-shaded, pastel and sparkly.** Vertex colors on merged geometry with the
  shared `flatMat` from `js/art/materials.js`. No external models, no image files, no font files:
  text is DOM or `CanvasTexture`; sparkles are canvas-drawn additive sprites. Use the art kit in
  `js/art/geo.js`, `js/art/materials.js` and `js/art/util.js` (copied from League World).
- **Palette:** `PALETTE` in `js/config.js`. Her team's colors come from her cheer outfit: hot
  pink, black, and rhinestone sparkle (pink, purple, silver). Signature motif: a big hot-pink
  cheer bow with small black stars. Second motif: rhinestone starbursts (sparkle bursts when you
  land a stunt, score or win). Teams are Team Pink and Team Purple (`TEAMS`).
- **Fonts:** `FONT_STACK` in `js/config.js` (system rounded faces). Bold, big, friendly. Text at
  least 16px; buttons at least 48px tall.
- **Kid safety. Hard rules, never relaxed:**
  - No free-text chat anywhere. Players talk with preset emotes and quick-cheers only (`js/content/emotes.js`).
  - Nicknames come from the nickname generator or are typed; a typed name is letters and spaces,
    at most 12 characters, and must pass `cleanNick()`. No other typed text ever leaves a device.
  - Rooms are private and joined by code only. No public lobby, no room list, no matchmaking.
  - No accounts beyond Firebase anonymous sign-in, no emails, no analytics, no ads, no purchases,
    no external links, no third-party requests except the Firebase SDK and database.
  - Nothing identifying in code, art or text: no photos, no last names, no gym, team, school or
    town names. Bailey's first name is fine (birthday banner). (The photo wall's real photos are
    added by the family on a device and stay on it: never in the repo, the site, a link or the
    network, not even their captions or how many there are. In a room each device shows its own.)
  - Everything from the network is untrusted: validate shapes, clamp numbers, cap lengths, drop
    unknown ids (League World's `cleanVandalItem` in `world/js/core/net.js` is the model).
- **Tone: hype, sweet, funny, never mean.** League World roasts; Cloud Nine cheers you on.
  Compliments are about skill, effort, style, teamwork and spirit, never about looks, bodies,
  weight or food. Nobody is shamed for losing: "So close!", not "You lost". There is no falling
  damage, no crying, no death: you get caught, cradled, or floated home by a cloud.
- **Accessibility:** respect `prefers-reduced-motion` (no camera shake, fewer flashes), pause
  rendering when the tab is hidden, wrap `localStorage` in try/catch, sound off until the first
  tap and always toggleable.
- **Code style:** match League World. Small modules with a header comment documenting the public
  interface. Pure logic separated from three.js and the DOM so it runs under `node --test`.

## Folder map and ownership

Each path has exactly one owner in phase 1. Do not edit files you don't own. If you need
something from another owner, code against the contract below and say so in your report.

```
cloud-nine/
  BLUEPRINT.md, js/config.js              DIRECTOR (read only)
  lib/                                    vendored three.js r160 (read only)
  js/core/util.js, js/core/colliders.js   shared, copied from League World (read only)
  js/art/geo.js, materials.js, util.js    shared art kit, copied from League World (read only)
  index.html, css/ (except below)         APP
  js/main.js                              APP
  js/core/ (engine, input, camera, store) APP   copied from League World: extend, never break signatures
  js/world/player.js, interact.js,
    fallback-island.js, placeholder-avatar.js   APP
  js/ui/ (except creator.js)              APP   HUD, menus, room screens
  js/world/island.js, js/world/sky.js,
    js/art/island-*.js                    ISLAND
  js/art/character.js, character-*.js,
    js/ui/creator.js, css/creator.css     CHARACTER
  js/world/toss.js, toss-*.js             TOSS
  js/net/, firebase/, tools/              NET
  js/games/                               GAMES   (pure rules and bots: no THREE, no DOM)
  js/audio/                               AUDIO
  js/rhythm/, css/rhythm.css              RHYTHM  (Hit Zero)
  js/content/                             CONTENT (words, emotes, names, birthday, notes, collectibles)
  js/world/photowall.js, js/art/photowall-art.js, js/core/photos.js,
    js/ui/photo-manager.js, js/ui/photo-viewer.js, css/photowall.css   PHOTOS (added later: the photo wall)
  dev/<owner>-*                           each owner's own dev and test pages
  test/<owner>-*.test.mjs                 each owner's own node tests
```

Owner prefixes for dev and test files: `app`, `island`, `character`, `toss`, `net`, `games`,
`audio`, `rhythm`, `content` (and `photo` / `photowall` for the photo wall, added later). Run
tests with `node --test "cloud-nine/test/*.test.mjs"`.

## Coordinates and units

Meters. +Y is up. A character faces +Z at heading 0; heading is radians around +Y, the same as
League World's `player.heading`. The plaza centre (spawn) is near the origin.

## Contract 1: the world object (APP builds it; everyone uses it)

`js/main.js` builds one object and exposes it as `window.__c9` for tests:

```js
world = {
  THREE, scene, camera, renderer, engine, rig /* camera rig */, input, audio, net, content,
  player,                  // Contract 2
  groundAt(x, z),          // -> y of the walkable surface (island, cloud platforms, slides, bridges), or -Infinity over open sky
  platforms,               // [{ id, x, z, y, r }] cloud platforms you can land on (toss targets); part of groundAt
  colliders,               // js/core/colliders.js API
  interact,                // interact.register({ id, position, radius, label, onUse }) as in League World
  places,                  // named spots, below
  hud,                     // hud.toast(text, { icon, ms }), hud.prompt(label, onUse) / hud.clearPrompt(),
                           // hud.big(text, sub, { ms }) (centre splash), hud.setGameUI(game.ui(meId) | null)
  onUpdate(fn),            // fn(dt, t) every frame; returns an unsubscribe function
  spawnBurst(x, y, z, { count, colors }),   // rhinestone sparkle burst
  quality,                 // 'low' | 'high'
}
```

The island (ISLAND) is built by `buildIsland()` in `js/world/island.js`:

```js
export function buildIsland({ scene, quality, colliders }) -> {
  groundAt(x, z), platforms, places,
  update(dt, t, { camera, playerPos }),   // drifting clouds, sparkles, flags, waterfalls
  setBirthday({ isBirthday, age, name }), // cake candles = age; banners and fireworks when isBirthday
  dispose(),
}
// js/world/sky.js
export function createSky({ scene, quality }) -> { update(dt, t, camera), lights: { hemi, dir, amb } }
```

`places` (ISLAND picks the coordinates; the ids and shapes are fixed):

- `plaza` `{ x, z, facing }`: spawn point; the birthday cake stands here.
- `gym` `{ x, z, w, d, facing }`: the cheer gym.
- `stage` `{ x, z, facing }`: the Hit Zero performance mat, with bleachers and a judges' table.
- `tossPads` `[{ id, x, z, facing, targetPlatformId }]`: at least 3 basket-toss pads, each aimed
  at a cloud platform; the targets get higher pad by pad (about 8 m, 14 m, 22 m).
- `slides` `[{ id, fromPlatformId, x0, z0, x1, z1 }]`: ways back down from the platforms.
- `hideGarden` `{ bounds: { x0, z0, x1, z1 }, seekerStart: { x, z, facing }, hideSpots: [{ id, x, z, kind, r }] }`:
  at least 16 hide spots; kinds `'hedge' | 'bush' | 'slide' | 'tent' | 'rack' | 'cloud' | 'barrel' | 'curtain'`.
- `court` `{ x, z, w, d, facing }`: dodgeball. `w` is across, `d` is long; the midline is the
  centre; team 0 holds local z in [-d/2, 0], team 1 holds [0, d/2].
- `bowField` `{ x, z, w, d, facing, bases: [{ team: 0, x, z, r }, { team: 1, x, z, r }] }`: Capture the Bow.
- `tagZone` `{ bounds: { x0, z0, x1, z1 } }`: freeze tag.
- `photoBooth` `{ x, z, facing }`: phase 2.
- `photoWall` `{ x, z, facing }`: the photo wall (added later): the foot of its heart board, facing
  out toward the plaza. Its furniture (the board, the patio, the bench, the stones, where the
  prompt and "Go to" are) is `plan.photoWall` from `makePhotoWall()` in `js/art/island-layout.js`,
  and `photoWallColliders()` is what is solid there (js/world/photowall.js registers them).

## Contract 2: the player (APP)

Ported from League World's `world/js/world/player.js`, plus:

```js
player.position (Vector3, y included), player.heading, player.velocity (Vector3), player.grounded
player.setAvatar(avatar)        // a Contract 3 character (or the placeholder)
player.avatar
player.frozen = true            // input does not move the player
player.takeControl(owner)       // a mini game drives position and anims; physics and input movement pause. Returns release()
player.jump()                   // a small hop (jump button on touch, Space on keyboard)
player.teleport(x, z, facing, { fade }) -> Promise
player.getState()               // -> { x, y, z, h, anim }: what goes over the network (Contract 4)
```

Walking off the island edge is never a death: a cloud catches you and floats you back to the plaza.

## Contract 3: characters (CHARACTER)

`js/art/character.js`:

```js
export const LOOK_OPTIONS        // preset lists per slot: [{ id, label, ...colors }]
export const DEFAULT_LOOK        // Bailey's starting look, from her real outfit (below)
export function cleanLook(raw)   // -> a valid look; validates untrusted input slot by slot, falling back to DEFAULT_LOOK
export function randomLook(rng)  // for bots and "Surprise me!"
export function createCharacter(look = DEFAULT_LOOK, { quality = 'high' } = {}) -> {
  group,                         // feet at y = 0, faces +Z, about 1.45 m tall, stylized
  setAnim(name, { speed, loop } = {}),
  setSpeed(metersPerSecond),     // blends idle / walk / run
  update(dt, t),
  setLook(look), getLook(),
  setHighlight(on, color),       // glow for "it", "found", team colour
  anchors: { handL, handR, head, back },   // Object3Ds to hold balls, poms, bow flags
  dispose(),
}
```

A look is a small object of preset ids, never free text:
`{ skin, hair, hairStyle, hat, bow, bowPattern, bowSize, top, bottom, shoes, socks, sparkle, pet }`.
(Added later: `hat` is 'bow' | 'none' | 'cap' | 'capBack' | 'beanie', and the bow is drawn only when
`hat` is 'bow'; `pet` is 'none' | 'cloudPuppy' | 'husky'. Old saved looks get 'bow' and 'none'.)

`DEFAULT_LOOK`: high ponytail, dark brown hair, a big hot-pink bow with small black stars, a black
crop top covered in rhinestone starbursts (pink, purple, silver), hot-pink shorts, black cheer
shoes, black sparkly socks. She can change everything in the creator.

Animation names (all must exist; unknown names fall back to `idle`):
- moving and reacting: `idle, walk, run, jump, fall, land, wave, cheer, clap, sit, dance, aww` (a sweet shrug, never crying)
- games: `throw, catch, dodge, frozen, tagged, seek` (hands over eyes, counting), `hide` (crouch), `base` (arms ready to toss or catch), `cradle` (being caught)
- arm motions: `highV, lowV, tMotion, touchdown, daggers, punch, clasp`
- flyer tricks and body positions: `toeTouch, pike, kickDouble, twist, liberty, heelStretch, scorpion, bowArrow, arabesque`

`js/ui/creator.js`: `openCreator({ look, nick, onDone(look, nick), onCancel })`, a full-screen,
kid-friendly character creator with a live 3D preview. It saves nothing itself; the caller does.

## Contract 4: the network (NET)

`js/net/index.js`:

```js
export function createNet({ mode = 'auto' } = {})  // 'local' (BroadcastChannel: tabs in one browser, for tests and dev),
                                                   // 'firebase', 'offline' (solo). 'auto': firebase when configured,
                                                   // else local on localhost, else offline
net.status                // 'offline' | 'connecting' | 'online'
net.me                    // { id, nick, look }
net.createRoom({ nick, look }) -> Promise<code>
net.joinRoom(code, { nick, look }) -> Promise<{ ok, reason }>   // reasons: 'not-found' | 'full' | 'offline' | 'bad-code' | 'locked'
net.leaveRoom()
net.room                  // null | { code, hostId, createdAt }
net.players               // Map<id, { id, nick, look, bot, joinedAt }>, including me and bots
net.isHost                // the host runs the games and the bots: the earliest human to join; re-elected when the host leaves
net.sendState(state)      // my { x, y, z, h, anim }: throttled to ~10 Hz, skips unchanged
net.sendStateFor(botId, state)   // host only, for bots
net.stateOf(id, now = net.now()) -> { x, y, z, h, anim } | null   // interpolated ~120 ms in the past
net.addBot({ nick, look }) -> id // host only; bots are players with bot: true
net.removeBot(id)
net.send(type, data)      // events to everyone. types: 'emote', 'claim' (a game claim for the host), 'fx' (sounds, bursts), 'game-start', 'game-end'
net.setGame(state)        // host only: replace the shared game state (small JSON)
net.game                  // the last shared game state, or null
net.now()                 // shared clock in ms (server time when online)
net.on(evt, fn) / net.off(evt, fn)   // 'status', 'join' {id}, 'leave' {id}, 'host' {id}, 'event' {from, type, data}, 'game' (state)
```

Room codes are 4 characters from `GAME.roomCodeAlphabet`. At most `GAME.maxPlayers` per room.
Firebase Realtime Database layout under `rooms/{code}/`: `meta`, `players/{id}`, `state/{id}`,
`events/{pushId}`, `game`. `onDisconnect` removes a player's entries. Anonymous sign-in gives each
device an id so the security rules (`firebase/database.rules.json`) let a device write only its
own entries. Rules forbid listing rooms. Config is `js/net/firebase-config.js`, with placeholders
until the owner creates the project; `firebase/SETUP.md` walks the owner through it.

Added in review (safety):
- **Room lock.** `net.lockRoom(on)` (host only) writes `meta.locked` and an allow list
  `rooms/{code}/allow/{uid}` of the humans present, in one update. While locked, only listed
  devices can join or read the room's players, state, events and game (meta stays readable, so a
  join answers the new reason `'locked'`). A listed device whose connection drops gets back in.
  Unlocking clears the list.
- **Send home.** `net.sendHome(id)` (host only) takes a friend off the list and removes their
  entries; their device leaves by itself with `'leave'` reason `'removed'`. Bots are unaffected.
- `net.room` carries `locked`; a `'room'` event fires when it changes.
- **Names in game state go out blank.** Each device fills in the name it already checked for that
  player id (`V.mapNicks`), so a host can never put free text on anyone's screen.
- **The photo wall sends nothing.** Its modules never import `js/net/` or touch `world.net`, and
  never call fetch, XMLHttpRequest, sendBeacon or WebSocket (`test/photowall-privacy.test.mjs`;
  `dev/photo-check.cjs` checks a real room of two tabs).

## Contract 5: game modes (GAMES)

Pure rules, host-authoritative, no THREE and no DOM. `js/games/index.js`:

```js
export const MODES        // { hideSeek, freezeTag, dodgeball, captureBow }: modules with the same shape
export function createGame(kind, { arena, players, rng, now, settings }) -> game
game.state                // small JSON shared with net.setGame(). Always has { kind, phase, phaseEnds, round, scores, ... }
game.host.tick(now, view) -> fx[]               // host only. view = { pos(id) -> { x, z } | null, ids() }; runs timers, phases, balls
game.host.claim(fromId, claim, view) -> boolean // host validates a claim (phase, distance, timing) and applies it
game.host.addPlayer(id) / game.host.removePlayer(id)   // join and leave mid-game
game.bot(id, view, dt) -> { move: { x, z }, action }   // bot brain; the host runs it. action is a claim or null
game.applyState(state)    // clients adopt the host's state
game.ui(meId) -> { title, line, timer, big, roleBadge, scoreboard }   // what this player's HUD shows
```

Phases: `lobby -> countdown -> play -> results` (hide and seek has `hide` between countdown and
play). Claims are what a device asks the host to accept:
- hide and seek: `{ type: 'found', target }`
- freeze tag: `{ type: 'tag', target }`, `{ type: 'unfreeze', target }`
- dodgeball: `{ type: 'throw', ballId, from: { x, z }, dir: { x, z }, power }`, `{ type: 'pickup', ballId }`,
  `{ type: 'hit', ballId, target }` (the target's own device reports the hit; the host checks the
  ball was live and close), `{ type: 'catch', ballId }`
- Capture the Bow: `{ type: 'grab', team }`, `{ type: 'tag', target }`, `{ type: 'score' }`

Arenas are the Contract 1 `places` entries. Rounds are short (each game under 4 minutes) and
everybody gets a celebration at the end; the winners get the biggest one.

## Contract 6: audio (AUDIO)

`js/audio/index.js`. Everything is synthesized with WebAudio: no samples and no copyrighted
melodies ("Happy Birthday to You" is public domain and allowed).

```js
export function createAudio() -> {
  unlock()                     // call from the first user gesture
  enabled, setEnabled(on)      // remembered in localStorage
  music(id | null, { fade = 1 } = {})   // ids: 'island', 'game', 'tense', 'routine', 'birthday', 'victory'
  sfx(name, { volume, pitch, x, z } = {})   // unknown names are ignored
  setListener(x, z, heading)
  beat: { bpm, playing, time(), nextBeatTime(), structure,   // time() is seconds on the music clock
          on('beat', fn({ n, count /* 1..8 */, eight, time })), off(...) }
  dispose()
}
```

sfx names: `tap, open, close, toss, whoosh, sparkle, land, cradle, cheer, crowd, clap, whistle,
count, go, bounce, throw, hit, catch, pop, found, freeze, unfreeze, bowGrab, score, tada, aww,
firework, chime, step, jump, poms`.

## Contract 7: Hit Zero (RHYTHM)

`js/rhythm/index.js`: `createHitZero({ audio, container, level, onDone(result) })`, a rhythm game
in a DOM/canvas overlay. Notes arrive on 3 lanes mapped to cheer motions; tap in time; a panel of
3 cartoon judges scores you at the end; "HIT ZERO!" when nothing was missed. Charts live in
`js/rhythm/charts.js`, built on eight-counts of the `routine` track. It uses the Contract 6
`beat` clock when present and an internal metronome otherwise, so it also works alone.
Multiplayer (phase 2): everyone plays the same chart together; squad score with a sync bonus.

## Contract 8: content (CONTENT)

`js/content/`, all pure:
- `hype.js`: `hype(situation, ctx, rng) -> string` (tossLand, trick, bigToss, found, hidden,
  freeze, unfreeze, dodge, hit, catch, grab, score, win, lose, tie, birthday, welcome, idle,
  routineGood, routineZero, ...).
- `emotes.js`: `EMOTES` preset quick-cheers `[{ id, text, icon }]`, `cleanEmote(id)`.
- `names.js`: `randomNick(rng)` ("Sparkle Comet"), `cleanNick(raw) -> string | null`.
- `birthday.js`: `birthdayInfo(date, BIRTHDAY) -> { isBirthday, age, daysUntil, isBirthdayWeek }`.
- `notes.js`: `FAMILY_NOTES` (filled in later by the owner) and `cleanNote`.
- `glossary.js`: cheer words with kid-friendly one-liners.
- `howto.js`: a short how-to-play card per game.
- `collectibles.js`: spirit sticks hidden around the island and what they unlock.

## Contract 9: the basket toss (TOSS)

`js/world/toss.js`: `createToss(world)` reads `world.places.tossPads` and `world.platforms`,
builds each pad (a glittery mat with 3 base spots and a back spot) and its computer-controlled
bases (Contract 3 characters), and runs the toss:

1. Stand on the pad: prompt "Basket toss!", then tap or Space.
2. The bases dip and throw on "5, 6, 7, 8!"; the flyer launches on an arc toward the pad's target platform.
3. In the air, swipe (touch) or press arrows to do tricks. Each takes air time; combos score more.
4. Landing on the target cloud is a stuck landing: sparkle burst, hype line, score. Still
   mid-trick at touchdown means a soft cradle catch instead. Never a crash, never shame.
5. Real friends standing on a pad's base spots make you fly higher (each friend adds height),
   and their characters play `base`. Bots can't base: that's the squad's thing.

`toss.update(dt, t)`, `toss.active`, `toss.on('landed', fn({ height, tricks, score }))`, `toss.dispose()`.

## Glossary

Flyer: the athlete who goes up in stunts and tosses. Bases and back spot: they lift, toss and
catch the flyer. Basket toss: the bases throw the flyer high into the air. Cradle: the catch at the
end. Toe touch, pike, kick double, twist: tricks in the air. Liberty, heel stretch, scorpion, bow
and arrow, arabesque: flyer body positions. High V, low V, T motion, touchdown, daggers, punch,
clasp: arm motions. Eight-count: cheer music is counted 1 to 8. Hit Zero: a routine with zero
deductions, a perfect one. Full out: performing at full energy. Mat talk: cheering teammates on
from the side.
