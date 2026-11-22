// Cloud Nine game modes (Contract 5): Hide and seek, Freeze tag, Dodgeball and Capture the Bow.
// Pure rules and bots, host-authoritative. No three.js and no DOM: runs under `node --test`.
//
//   import { MODES, createGame } from './games/index.js'
//   const game = createGame('dodgeball', {
//     arena: world.places.court,      // the Contract 1 entry (MODES[kind].place names it); the whole
//                                     // `places` object also works. Missing or odd arenas fall back.
//     players: net.players,           // a Map, or [{ id, nick, bot }], or plain ids
//     rng,                            // () => [0, 1). Injected: games are deterministic given rng + now
//     now: () => net.now(),           // the shared clock, as a function: client devices never tick, so
//                                     // ui() timers read this clock (a number = creation time, host only)
//     settings: { playSeconds: 120, botLevel: 'normal' },   // see MODES[kind].settings
//   })
//
// Contract 5:
//   game.state                         small JSON for net.setGame(). Always { kind, phase, phaseEnds, round,
//                                      scores, seq, ... }. It is updated in place and `seq` goes up on
//                                      every change: send it when seq changes (throttled, ~10 Hz is plenty).
//   game.host.tick(now, view) -> fx[]  host only, every frame. view = { pos(id) -> { x, z } | null, ids() }
//   game.host.claim(fromId, claim, view) -> boolean    validates (phase, role, distance with lag slack, timing)
//   game.host.addPlayer(id, { nick, bot }?) / game.host.removePlayer(id)    safe at any moment
//   game.bot(id, view, dt) -> { move: { x, z }, action, anim, face }   host only, every frame, per bot.
//       move is a velocity in m/s (world x/z): x += move.x * dt. action is a claim (or null): pass it
//       to game.host.claim(id, action, view). anim is a Contract 3 anim to show, or null for walk/run.
//       face (radians) is a heading to turn to while standing (aiming a throw), or null.
//   game.applyState(state) -> boolean  clients adopt the host's state (validated; bad input is refused;
//                                      an older copy of the same game, by gid and seq, is ignored, so the
//                                      host can safely apply the echo of its own net.setGame)
//   game.ui(meId, now?) -> { title, line, timer, timerText, big, roleBadge, scoreboard, action, phase, round, blind }
//       timer: whole seconds left in this phase or null; timerText: "1:05". big: { text, sub } | null,
//       a centre splash (the countdown "5, 6, 7, 8!", "Found you!", "Team Pink wins!").
//       roleBadge: { text, color, icon } | null. scoreboard: { title, rows: [{ id, label, value, color, me }] }.
//       action: { id: 'throw' | 'catch', label } | null: what the one action button does right now.
//       blind: true while a seeker counts (cover the screen).
//
// Extras (the same pure logic the bots use, so humans and bots play by the same rules):
//   game.host.start(now)        lobby -> countdown now (false if there aren't enough players)
//   game.host.end(now)          finish the round now (results)
//   game.host.botsNeeded(target?) -> n     bots to add for a good game (even teams, at least 4 players)
//   game.who(id, pos?) -> { role, team, color, glow, anim, pose, canMove, speed, carrying, hidden, winner }
//       how to draw and drive a player: anim overrides everything (frozen pose, counting, bench cheer,
//       results celebration); pose replaces idle (the hiding crouch); canMove false = player.frozen;
//       speed multiplies the run speed; carrying: 'ball' | 'bow0' | 'bow1'; hidden: hide the name tag.
//   game.spawnFor(id) -> { x, z, facing }   where this player starts (the host also sends teleport fx)
//   game.confine(id, x, z) -> { x, z }      keep a player in the arena, their half, or the bench
//   game.autoClaim(meId, view, now) -> claim | null   for the local human, every frame: touch-based
//       claims (found, tag, unfreeze, pickup, hit or catch, grab, score), already rate-limited
//   game.press(meId, view, now, aim?) -> claim | null  the action button (dodgeball: throw, auto-aimed
//       unless aim = { x, z } direction or { target }; or arm a catch)
//   game.fxText(fx, meId) -> string   a friendly toast for an fx, written for this player ('' = none)
//   game.ballPos(ball, now) (dodgeball)  where to draw a ball: { x, y, z } or null while held
//   driveBot(game, id, body, view, dt) in ./sim.js   one bot, one frame, exactly as the host app should:
//       brain -> eased velocity -> game.confine -> heading and anim; returns the claim to send
//
// fx (returned by host.tick; broadcast them with net.send('fx', fx) and play them everywhere):
//   { type, sfx?, x?, z?, burst?, ids?, id?, hype? }
//   sfx is a Contract 6 sound; burst: true = a rhinestone burst at (x, z); hype is a Contract 8
//   situation; ids are the players involved. Special ones:
//   { type: 'teleport', id, x, z, facing }   move that player (start spots, bench, tagged home)
//   { type: 'hint', spots: [{ x, z }], sfx }  hide and seek: a sparkle puff over each spot
//   { type: 'count', n: 5..8, sfx: 'count' } the countdown, one per beat
//   { type: 'phase', phase, sfx }, { type: 'win', winner, ids, sfx, burst }
//
// Wiring it up. On the host, every frame:
//   for each bot: const c = driveBot(game, id, body, view, dt); if (c) game.host.claim(id, c, view)
//                 net.sendStateFor(id, { x: body.x, y: groundAt(body.x, body.z), z: body.z, h: body.h, anim: body.anim })
//   const fx = game.host.tick(net.now(), view); broadcast each with net.send('fx', f) and play it here too
//   if (game.state.seq !== lastSeq) net.setGame(game.state)          (throttled to ~10 Hz)
//   net 'event' { from, type: 'claim', data } -> game.host.claim(from, data, view)
//   net 'join' / 'leave' -> game.host.addPlayer(id, { nick, bot }) / game.host.removePlayer(id)
// On every device (the host included):
//   net 'game' -> game.applyState(state); every frame hud.setGameUI(game.ui(me))
//   const w = game.who(me, player.position): player.frozen = !w.canMove, anim / pose / glow / speed from w
//   const c = game.autoClaim(me, view, net.now()); if (c) net.send('claim', c)   (the action button: game.press)
//   keep the player in bounds with game.confine(me, x, z); fx { type: 'teleport', id: me } -> player.teleport(...)
//   toasts: game.fxText(fx, me)

import { makeGame } from './machine.js';
import { hideSeek } from './hide-seek.js';
import { freezeTag } from './freeze-tag.js';
import { dodgeball, ballPos, BALL } from './dodgeball.js';
import { captureBow } from './capture-bow.js';
import { cleanSettings } from './common.js';

export { ballPos, BALL };

export const MODES = { hideSeek, freezeTag, dodgeball, captureBow };
export const MODE_IDS = Object.keys(MODES);

export function createGame(kind, opts = {}) {
  const mode = Object.prototype.hasOwnProperty.call(MODES, kind) ? MODES[kind] : null;
  if (!mode) throw new Error(`Unknown game "${String(kind)}". Try one of: ${MODE_IDS.join(', ')}`);
  return makeGame(mode, opts);
}

/** The cleaned settings for a mode (defaults for anything missing or invalid). */
export function settingsFor(kind, raw) {
  const mode = Object.prototype.hasOwnProperty.call(MODES, kind) ? MODES[kind] : null;
  return mode ? cleanSettings(mode.settings, raw) : {};
}
