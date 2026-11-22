// The squad side of the basket toss: who stands on each pad's base spots (real friends only, from
// net.stateOf; bots can't base, that's the squad's thing), the local player basing on a spot,
// friends' tosses seen from here (our bases dip and throw for them, and so do you if you are
// basing), and the small 'fx' events that tell everyone about a toss. Everything that comes from
// the network is validated before it is used.
//
//   const squad = createSquad({ net, player, pads, toast, burst, flying })
//       pads: the toss's pads; flying(pad) -> true while the local player is the flyer on that pad
//   squad.scan(pad)            who is on pad's spots: sets pad.taken, pad.friendIds, pad.friendCount, pad.meSpot
//   squad.clear(pad)           nobody (a pad far away)
//   squad.names(pad)           the nicks of the friends on pad's spots, safe to show
//   squad.stepRemote(pad, dt)  a friend's toss from this pad, played by our bases (pad.remote)
//   squad.update(dt)           the local player basing
//   squad.send(data)           an 'fx' event for everyone in the room
//   squad.basing               true while the local player stands on a spot, basing
//   squad.dispose()

import { smoothstep } from '../core/util.js';
import { matchSpots, cleanTossFx, cleanNick } from './toss-rules.js';

const ME = '__me';

export function createSquad({ net, player, pads, toast, burst, flying }) {
  const padIds = pads.map((p) => p.id);
  const B = { on: false, told: false, remote: null };
  let disposed = false;
  const meId = () => (net && net.me && net.me.id !== undefined ? net.me.id : null);
  const anyFlying = () => pads.some((p) => flying(p));

  function ownAnim(name) {
    const av = player && player.avatar;
    if (av && typeof av.setAnim === 'function') {
      try {
        av.setAnim(name);
      } catch (err) { /* unknown names fall back to idle in the character */ }
    }
  }

  function setSpots(pad, taken) {
    pad.taken = taken;
    pad.friendIds = [];
    pad.meSpot = -1;
    for (let i = 0; i < pad.spots.length; i++) {
      const id = taken[i];
      pad.art.setSpot(i, !!id);
      pad.crew.setTaken(i, !!id);
      if (id === ME) pad.meSpot = i;
      else if (id !== null) pad.friendIds.push(id);
    }
    pad.friendCount = pad.friendIds.length;
  }

  function scan(pad) {
    const people = [];
    const me = meId();
    if (net && net.players && typeof net.stateOf === 'function') {
      try {
        for (const [id, info] of net.players) {
          if (!info || info.bot || id === me) continue;
          let st = null;
          try {
            st = net.stateOf(id);
          } catch (err) {
            st = null;
          }
          if (st) people.push({ id, x: +st.x, y: +st.y, z: +st.z });
        }
      } catch (err) { /* a broken player list counts nobody */ }
    }
    if (!flying(pad) && player && player.position) people.push({ id: ME, x: player.position.x, y: player.position.y, z: player.position.z });
    setSpots(pad, matchSpots(pad.spots, people).taken);
  }

  function clear(pad) {
    if (pad.meSpot < 0 && !pad.friendCount && pad.taken.every((v) => v === null)) return;
    setSpots(pad, pad.spots.map(() => null));
  }

  function names(pad) {
    const out = [];
    if (!net || !net.players || typeof net.players.get !== 'function') return out;
    for (const id of pad.friendIds) {
      const info = net.players.get(id);
      const nick = info ? cleanNick(info.nick) : null;
      if (nick) out.push(nick);
    }
    return out;
  }

  // A friend's toss seen from here: our bases dip on 5 and 7, throw on 8, cheer, then clap.
  function stepRemote(pad, dt) {
    const r = pad.remote;
    r.t += dt;
    const k = Math.floor(r.t / r.beat);
    const p = r.t / r.beat - k;
    if (k < 3) {
      pad.crew.cue('count');
      pad.crew.dip(k === 0 ? -0.11 * Math.sin(p * Math.PI) : k === 2 ? -0.16 * smoothstep(0, 0.7, p) : 0);
    } else if (r.t < 3 * r.beat + 3) {
      pad.crew.cue(r.t < 3.4 * r.beat + 0.5 ? 'throw' : 'air');
      pad.crew.dip(0);
    } else if (r.t < 3 * r.beat + 4.4) pad.crew.cue('land');
    else {
      pad.remote = null;
      pad.crew.cue('idle');
    }
  }

  // Standing still on a spot is basing: the avatar holds 'base' (set once, so the player's own
  // walk and idle anims win the moment she moves), and helps throw when a friend goes up.
  function update(dt) {
    const spotPad = pads.find((p) => p.meSpot >= 0) || null;
    const v = player && player.velocity;
    const still = !v || Math.hypot(v.x || 0, v.z || 0) < 0.6;
    const basing = !!spotPad && !anyFlying() && !(player && player.frozen);
    if (basing && still && !B.on) {
      B.on = true;
      ownAnim('base');
      if (!B.told) {
        B.told = true;
        toast('You\'re basing! Friends who toss here fly higher.', { icon: '✨', ms: 3200 });
      }
    } else if (B.on && (!basing || !still)) {
      B.on = false;
      if (!basing && still && !anyFlying()) ownAnim('idle');
    }
    if (B.remote) {
      const r = B.remote;
      r.t += dt;
      const go = 3.38 * r.beat;
      if (!B.on) B.remote = null;
      else if (r.t > go && !r.threw) {
        r.threw = true;
        ownAnim('throw');
      } else if (r.threw && r.t > go + 0.55 && !r.cheered) {
        r.cheered = true;
        ownAnim('cheer');
      } else if (r.cheered && r.t > go + 3.2) {
        B.remote = null;
        ownAnim('base');
      }
    }
  }

  function send(data) {
    if (!net || typeof net.send !== 'function' || net.status === 'offline') return;
    try {
      net.send('fx', data);
    } catch (err) { /* friends just miss the sparkle */ }
  }

  function onEvent(ev) {
    if (disposed || !ev || ev.type !== 'fx') return;
    const d = cleanTossFx(ev.data, padIds);
    if (!d || ev.from === meId()) return;
    const pad = pads.find((p) => p.id === d.pad);
    if (!pad) return;
    const info = net && net.players && typeof net.players.get === 'function' ? net.players.get(ev.from) : null;
    if (!info || info.bot) return;
    const nick = cleanNick(info.nick) || 'Your friend';
    if (d.kind === 'toss') {
      if (!flying(pad)) pad.remote = { t: 0, beat: d.beat };
      if (pad.meSpot >= 0 && !anyFlying()) {
        B.remote = { t: 0, beat: d.beat, threw: false, cheered: false };
        toast('You\'re basing for ' + nick + '! 5, 6, 7, 8!', { icon: '✨', ms: 2600 });
        ownAnim('base');
      }
      return;
    }
    // tossLand: cheer them on, with a little burst where they landed if that is really this pad's cloud
    const close = pad.meSpot >= 0 || pad.dist < 16;
    if (!close || anyFlying()) return;
    toast(d.stuck ? nick + ' stuck it! Squad goals!' : nick + ' got a cloud cradle!', { icon: d.stuck ? '⭐' : '☁️', ms: 2600 });
    let st = null;
    try {
      st = net && typeof net.stateOf === 'function' ? net.stateOf(ev.from) : null;
    } catch (err) {
      st = null;
    }
    const L = pad.land;
    if (st && L && [st.x, st.y, st.z].every((n) => Number.isFinite(+n)) && Math.hypot(st.x - L.x, st.z - L.z) < L.r + 1 && Math.abs(st.y - L.y) < 3) {
      burst(+st.x, +st.y + 0.6, +st.z, d.stuck ? 24 : 10);
    }
  }
  if (net && typeof net.on === 'function') {
    try {
      net.on('event', onEvent);
    } catch (err) { /* no events, no squad sparkle */ }
  }

  return {
    scan,
    clear,
    names,
    stepRemote,
    update,
    send,
    get basing() { return B.on; },
    dispose() {
      disposed = true;
      if (net && typeof net.off === 'function') {
        try {
          net.off('event', onEvent);
        } catch (err) { /* gone already */ }
      }
    },
  };
}
