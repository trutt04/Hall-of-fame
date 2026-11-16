// The Arrival: "the long ride down".
//
// The camera opens tight on the gold crown above the mansion with a title card, then rides down
// the Boulevard past every home in rank order while a huge place counter ticks up. It stops at
// the visitor's own home, so first place gets a short ride and last place rides past all eleven
// better teams. The length of the ride is the joke.
//
//   const arrival = runArrival(ctx, { teamId, kind, prevRank, title })
//   kind: 'full'   the whole ride (first place sweeps UP the valley instead)
//         'short'  returning visitor this week: a quick swoop home and a "welcome back" line
//         'calm'   reduced motion: a cut to the home and a smaller stamp
//         'none'   ?nointro=1: straight to the end state
//   teamId null is a visitor: a short aerial sweep that lands on the plaza.
//   await arrival.done      always resolves, always with the avatar standing in the end state
//   arrival.cancel()        stop without landing (the team is being switched)
//
// Skipping never happens by accident: the Skip button (or Escape) skips at once, and a touch or key
// anywhere else only offers "tap again to skip". A skipped ride still lands with a short stamp.
// Everything is wrapped in try/finally with a watchdog, so the camera and the controls can never be
// left stuck.

import { el, button, hex, readable, wait, rankBig, tierName, teamName, ordinal, weekLabel, flowRoot, coarsePointer, TIER_CSS } from './dom.js';
import { modelOf, getHome, allHomes, boulevard, places, setPlayerTeam, groundY } from './seam.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const bump = (t) => (Math.abs(t) >= 1 ? 0 : (1 - t * t) * (1 - t * t));

const CROWN_SECONDS = 1.6;
const PER_PLACE = 0.75;
const RIDE_CAP = 11;
const SKIP_ARM_MS = 700;

/** How long the ride lasts for a rank: about 1.6 s plus 0.75 s per place passed, capped near 11 s. */
export function rideSeconds(rank) {
  if (rank <= 1) return { open: 1.3, ride: 4, total: 5.3 };
  const ride = clamp(PER_PLACE * (rank - 1), 1.5, RIDE_CAP - CROWN_SECONDS);
  return { open: CROWN_SECONDS, ride, total: CROWN_SECONDS + ride };
}

// Gentle acceleration through the top, a long cruise, then slowing into the stop.
function rideEase(u) {
  const a = 0.3;
  const b = 0.36;
  const v = 1 / (1 - a / 2 - b / 2);
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (u < a) return (v * u * u) / (2 * a);
  if (u > 1 - b) return 1 - (v * (1 - u) * (1 - u)) / (2 * b);
  return v * (a / 2 + (u - a));
}

// A polyline in the ground plane with distance lookups.
function makePath(points) {
  const pts = points.map((p) => [p[0], p.length >= 3 ? p[2] : p[1]]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  let seg = 0;
  return {
    total,
    at(d) {
      d = clamp(d, 0, total);
      if (cum[seg] > d) seg = 0;
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      const k = clamp((d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1), 0, 1);
      return [lerp(pts[seg][0], pts[seg + 1][0], k), lerp(pts[seg][1], pts[seg + 1][1], k)];
    },
    // distance along the path of the point nearest to (x, z)
    project(x, z) {
      let best = Infinity;
      let out = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0];
        const az = pts[i][1];
        const bx = pts[i + 1][0] - ax;
        const bz = pts[i + 1][1] - az;
        const l2 = bx * bx + bz * bz;
        const t = l2 > 0 ? clamp(((x - ax) * bx + (z - az) * bz) / l2, 0, 1) : 0;
        const d2 = (x - ax - bx * t) ** 2 + (z - az - bz * t) ** 2;
        if (d2 < best) {
          best = d2;
          out = cum[i] + Math.sqrt(l2) * t;
        }
      }
      return out;
    },
  };
}

/** The small line a returning visitor gets instead of the full ride. */
export function welcomeLine(team, prevRank, teamCount, seed = 0) {
  const nth = ordinal(team.rank);
  const was = prevRank ? ordinal(prevRank) : '';
  let pool;
  if (prevRank && team.rank < prevRank) {
    pool = [
      `Welcome back. You are up to ${nth}. Do not get comfortable.`,
      `Good news while you were out: ${nth} now, up from ${was}.`,
      `Welcome back. ${was} is somebody else's problem now. You are ${nth}.`,
    ];
  } else if (prevRank && team.rank > prevRank) {
    pool = [
      `Welcome back. You slid to ${nth} while you were away.`,
      `Bad news while you were out: ${nth} now, down from ${was}.`,
      `Welcome back. It was ${was} when you left. It is ${nth} now.`,
    ];
  } else if (team.rank === 1) {
    pool = ['Welcome back. Still 1st. The crown is where you left it.', 'Welcome back. Still 1st. The gate remembers you.'];
  } else if (team.rank === teamCount) {
    pool = [`Welcome back. Still ${nth}. The tent held up.`, 'Welcome back. Still last. The rain cloud waited for you.'];
  } else {
    pool = [
      `Welcome back. Still ${nth}.`,
      `Back again. Still ${nth}. The house missed you.`,
      `Welcome back. ${nth}, same as you left it.`,
    ];
  }
  return pool[Math.abs(Math.floor(seed)) % pool.length];
}

export function runArrival(ctx, o = {}) {
  const { hud, camera, player, audio } = ctx;
  const model = modelOf(ctx);
  const team = o.teamId !== null && o.teamId !== undefined && model ? model.teams[o.teamId] : null;
  const home = team ? getHome(ctx, team.id) : null;
  const count = model && model.order ? model.order.length : 0;
  const kind = o.kind || 'full';

  let phase = 'ride'; // 'ride' | 'stamp' | 'handoff' | 'done'
  let landed = false;
  let aborted = false;
  let cancelled = false;
  let stampAt = 0;
  let stampDismissed = false;
  let stampShown = false;
  let abortNow = null;
  const aborting = new Promise((resolve) => {
    abortNow = resolve;
  });
  const race = (p) => Promise.race([p, aborting]);
  const armedAt = performance.now() + SKIP_ARM_MS;
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const sfx = (name, opts) => {
    try {
      audio.sfx(name, opts);
    } catch (err) { /* sound is optional */ }
  };

  // ---------------------------------------------------------------- overlay
  const meta = (model && model.meta) || {};
  const root = el('div', 'lwf-ride');
  const title = el('div', 'lwf-title');
  title.append(el('p', 'lwf-title-kicker', 'League World'), el('h1', 'lwf-title-name', meta.leagueName || ''), el('p', 'lwf-title-week', weekLabel(meta)));
  const counter = el('div', 'lwf-counter');
  const counterNum = el('div', 'lwf-counter-num');
  counter.append(counterNum, el('div', 'lwf-counter-label', 'place'));
  const lower = el('div', 'lwf-lower');
  const lowerName = el('div', 'lwf-lower-name');
  const lowerSub = el('div', 'lwf-lower-sub');
  lower.append(lowerName, lowerSub);
  counter.setAttribute('aria-hidden', 'true');
  lower.setAttribute('aria-hidden', 'true');
  const skipBtn = button('lwf-skip', 'Skip');
  const welcome = el('div', 'lwf-welcome');
  const welcomeRank = el('div', 'lwf-welcome-rank');
  const welcomeText = el('div', 'lwf-welcome-text');
  welcome.append(welcomeRank, welcomeText);
  root.append(title, counter, lower, skipBtn);

  function showCount(t) {
    counterNum.textContent = rankBig(t.rank);
    counter.classList.toggle('lwf-wide', t.rank >= 10);
    counter.style.setProperty('--tier', TIER_CSS[t.tier] || TIER_CSS.hill);
    counter.classList.remove('lwf-tick');
    void counter.offsetWidth;
    counter.classList.add('lwf-tick', 'lwf-on');
  }

  function showTick(t, own) {
    showCount(t);
    lowerName.textContent = teamName(t);
    lowerName.style.color = readable(t.color);
    lower.style.setProperty('--team', hex(t.color));
    lowerSub.textContent = (own ? 'Your house · ' : '') + tierName(t.tier) + ' · ' + t.record.text;
    lower.classList.toggle('lwf-own', !!own);
    lower.classList.add('lwf-on');
    sfx('tick', { volume: own ? 1 : 0.7 });
  }

  function showWelcome(text) {
    welcomeRank.textContent = team ? rankBig(team.rank) : '';
    welcomeRank.hidden = !team;
    welcome.style.setProperty('--tier', team ? TIER_CSS[team.tier] : TIER_CSS.plaza);
    welcomeText.textContent = text;
    flowRoot(hud).appendChild(welcome);
    void welcome.offsetWidth;
    welcome.classList.add('lwf-on');
    setTimeout(() => welcome.classList.remove('lwf-on'), 4200);
    setTimeout(() => welcome.remove(), 4700);
  }

  // ---------------------------------------------------------------- end state
  const awayFrom = home ? home.street.facing + Math.PI : 0; // heading that walks out of the front door
  function lookAtHome() {
    try {
      camera.setView({ yaw: awayFrom, pitch: 0.27, distance: 11.5, instant: true });
    } catch (err) { /* older rig */ }
  }
  function land() {
    if (landed) return;
    landed = true;
    setPlayerTeam(ctx, team ? team.id : null);
    if (home) {
      player.place(home.street.x, home.street.z, awayFrom);
      lookAtHome();
    } else {
      const p = places(ctx).plaza || { x: 4, z: 14, facing: Math.PI };
      player.place(p.x, p.z, p.facing);
    }
  }
  function standAtDoor() {
    if (!home) return;
    const dx = home.street.x - home.door.x;
    const dz = home.street.z - home.door.z;
    const len = Math.hypot(dx, dz) || 1;
    const step = Math.min(1.3, len * 0.4);
    player.place(home.door.x + (dx / len) * step, home.door.z + (dz / len) * step, awayFrom);
    lookAtHome();
  }
  // The stop is over: the cinematic lets go, the camera settles in and the avatar walks out to the street.
  async function handoff() {
    phase = 'handoff';
    hideTags(false);
    if (home) standAtDoor();
    landed = true;
    camera.skip();
    hud.el.classList.remove('lwf-cine');
    root.classList.add('lwf-out');
    await race(wait(140));
    if (aborted) return;
    if (home) player.walkTo(home.street.x, home.street.z, { marker: false, stop: 0.6 });
  }

  // A long, nearly still shot of the home that runs under the stamp until we let go of it.
  function holdShot(view, onStart) {
    return {
      dur: 60,
      ease: 'linear',
      pos: (u, t) => mix(view.pos, view.look, Math.min(0.06, t * 0.008)),
      look: () => view.look,
      onStart,
    };
  }

  // The floating name tags are useful on the way down, but at the stop the home should be clear.
  const hideTags = (on) => {
    try {
      if (ctx.world && 'hideTags' in ctx.world) ctx.world.hideTags = !!on;
    } catch (err) { /* older world build */ }
  };

  async function stamp(small) {
    phase = 'stamp';
    stampAt = performance.now();
    stampShown = true;
    hideTags(true);
    root.classList.add('lwf-stamped');
    if (small) hud.el.classList.add('lwf-small-stamp');
    hud.el.classList.toggle('lwf-wide-stamp', team.rank >= 10); // "12TH" is a character wider than "9TH"
    sfx('stamp');
    const sting = team.rank === 1 ? 'fanfare' : team.rank === count ? 'sadTrombone' : 'pop';
    later(() => {
      if (phase === 'stamp') sfx(sting);
    }, 480);
    await race(hud.stamp({ big: rankBig(team.rank), sub: tierName(team.tier), line: team.roast ? team.roast.arrival : '', color: TIER_CSS[team.tier], ms: 3800 }));
    hud.el.classList.remove('lwf-small-stamp', 'lwf-wide-stamp');
  }

  // ---------------------------------------------------------------- the scripts
  async function fullRide() {
    const road = boulevard(ctx);
    const homes = allHomes(ctx).filter((h) => h.rank <= team.rank).sort((a, b) => a.rank - b.rank);
    if (road.length < 2 || !homes.length) return calm();
    const P = makePath(road);
    const T = rideSeconds(team.rank);
    const view = home.view;
    const hill = homes[0];
    const portrait = window.innerHeight >= window.innerWidth;

    // the crown floats above the mansion roof
    const crown = [hill.x, hill.y + 19.4, hill.z];
    const far = portrait ? 13 : 9.5;
    const camAt = (dist, up) => [crown[0] - 0.6 * dist, crown[1] + up, crown[2] - 0.8 * dist];
    const A0 = camAt(far + 5, 3.6);
    const A1 = camAt(far, 2.4);

    // where each home sits along the ride, kept in rank order
    const s = homes.map((h) => P.project(h.street.x, h.street.z));
    for (let i = 1; i < s.length; i++) s[i] = Math.max(s[i], s[i - 1] + 3);
    const dStop = clamp(s[s.length - 1] - 4, 6, P.total);

    const roadPos = (d) => {
      const [x, z] = P.at(d);
      return [x, groundY(ctx, x, z) + lerp(10.5, 7, clamp(d / 50, 0, 1)), z];
    };
    const roadLook = (d) => {
      const [x, z] = P.at(d + 24);
      const L = [x, groundY(ctx, x, z) + 1.6, z];
      // glance at each home as it goes by
      let w = 0;
      let gx = 0;
      let gy = 0;
      let gz = 0;
      for (let i = 1; i < homes.length - 1; i++) {
        const k = bump((d + 10 - s[i]) / 24);
        w += k;
        gx += k * homes[i].x;
        gy += k * (homes[i].y + 3);
        gz += k * homes[i].z;
      }
      return w > 0.001 ? mix(L, [gx / w, gy / w, gz / w], Math.min(1, w) * 0.5) : L;
    };

    const tAB = Math.min(1.5, T.ride * 0.5);
    const tBC = Math.min(1.7, T.ride * 0.55);

    // when the counter ticks, as a fraction of the ride
    const n = homes.length;
    const ticks = homes.map((h, i) => {
      if (i === 0) return 0;
      if (i === n - 1) return 1 - (0.7 * tBC) / T.ride;
      const want = s[i] - 14;
      for (let k = 0; k <= 200; k++) if (dStop * rideEase(k / 200) >= want) return k / 200;
      return 1;
    });
    const gap = Math.min(0.3 / T.ride, 0.9 / n);
    for (let i = n - 2; i >= 1; i--) ticks[i] = Math.min(ticks[i], ticks[i + 1] - gap);
    for (let i = 1; i < n; i++) ticks[i] = Math.max(ticks[i], ticks[i - 1] + gap * 0.6);
    let next = 0;
    const smoothLook = [crown[0], crown[1], crown[2]];
    let lastT = 0;

    const stopped = new Promise((resolve) => {
      camera.play([
        { cut: true, dur: 0.01, pos: A0, look: crown },
        { dur: T.open, ease: 'out', pos: (u) => mix(A0, A1, u), look: () => crown },
        {
          dur: T.ride,
          ease: 'linear',
          onStart: () => root.classList.add('lwf-riding'),
          pos: (u, t) => {
            while (next < n && u >= ticks[next]) {
              showTick(model.teams[homes[next].teamId], next === n - 1);
              next++;
            }
            if (u > 0.82) hideTags(true);
            const d = dStop * rideEase(u);
            const wAB = smooth(t / tAB);
            const wBC = smooth((t - (T.ride - tBC)) / tBC);
            const want = mix(mix(crown, roadLook(d), smooth(t / (tAB * 0.75))), view.look, wBC);
            const k = 1 - Math.exp(-7 * Math.max(0.001, t - lastT));
            lastT = t;
            smoothLook[0] = lerp(smoothLook[0], want[0], k);
            smoothLook[1] = lerp(smoothLook[1], want[1], k);
            smoothLook[2] = lerp(smoothLook[2], want[2], k);
            return mix(mix(A1, roadPos(d), wAB), view.pos, wBC);
          },
          look: (u) => (u >= 1 ? view.look : smoothLook),
        },
        holdShot(view, resolve),
      ], { skippable: false, handoff: 1.25 });
    });
    root.classList.add('lwf-titled');
    later(() => root.classList.remove('lwf-titled'), (T.open + 0.5) * 1000);
    await race(stopped);
    if (aborted) return;
    while (next < n) showTick(model.teams[homes[next].teamId], next++ === n - 1);
    await stamp(false);
    if (aborted) return;
    // last place: one more beat on the tent under its rain cloud
    if (team.rank === count && count > 1 && !stampDismissed) await race(wait(1300));
    if (aborted) return;
    await handoff();
  }

  // First place does not ride down. It starts at the dump and sweeps up the valley to the mansion.
  async function firstPlace() {
    const road = boulevard(ctx).slice().reverse();
    const homes = allHomes(ctx).sort((a, b) => b.rank - a.rank); // worst first: the counter counts down
    if (road.length < 2 || !homes.length) return calm();
    const P = makePath(road);
    const T = rideSeconds(1);
    const view = home.view;
    const dStop = Math.max(10, P.total - 12);
    const s = homes.map((h) => P.project(h.street.x, h.street.z));
    const pos = (d) => {
      const [x, z] = P.at(d);
      return [x, groundY(ctx, x, z) + lerp(5, 11, clamp(d / dStop, 0, 1)), z];
    };
    const look = (d) => {
      const [x, z] = P.at(d + 40);
      return [x, groundY(ctx, x, z) + 9, z];
    };
    const tBC = 1.5;
    const n = homes.length;
    const ticks = homes.map((h, i) => (i === n - 1 ? 1 - (0.6 * tBC) / T.ride : clamp(0.04 + (s[i] / dStop) * 0.74, 0, 0.8)));
    for (let i = 1; i < n; i++) ticks[i] = Math.max(ticks[i], ticks[i - 1] + 0.035);
    let next = 0;
    const start = pos(0);
    const startLook = look(0);

    const stopped = new Promise((resolve) => {
      camera.play([
        { cut: true, dur: 0.01, pos: start, look: startLook },
        { dur: T.open, ease: 'linear', pos: () => start, look: () => startLook },
        {
          dur: T.ride,
          ease: 'linear',
          onStart: () => {
            root.classList.add('lwf-riding');
            lowerName.textContent = 'Everything below this is your league.';
            lowerSub.textContent = teamName(team);
            lower.style.setProperty('--team', TIER_CSS.hill);
            lower.classList.add('lwf-on', 'lwf-own');
          },
          pos: (u, t) => {
            while (next < n && u >= ticks[next]) {
              showCount(model.teams[homes[next].teamId]);
              sfx('tick', { volume: 0.6 });
              next++;
            }
            const d = dStop * rideEase(u);
            return mix(pos(d), view.pos, smooth((t - (T.ride - tBC)) / tBC));
          },
          look: (u, t) => mix(look(dStop * rideEase(u)), view.look, smooth((t - (T.ride - tBC)) / tBC)),
        },
        holdShot(view, resolve),
      ], { skippable: false, handoff: 1.25 });
    });
    root.classList.add('lwf-titled');
    later(() => root.classList.remove('lwf-titled'), (T.open + 0.7) * 1000);
    await race(stopped);
    if (aborted) return;
    await stamp(false);
    if (aborted) return;
    await handoff();
  }

  // Returning this week: a quick swoop into the home and one small line.
  async function shortSwoop() {
    const view = home.view;
    const dir = [view.pos[0] - view.look[0], 0, view.pos[2] - view.look[2]];
    const len = Math.hypot(dir[0], dir[2]) || 1;
    const start = [view.pos[0] + (dir[0] / len) * 36, view.pos[1] + 24, view.pos[2] + (dir[2] / len) * 36];
    showWelcome(welcomeLine(team, o.prevRank, count, (meta.week || 0) + team.id));
    const stopped = new Promise((resolve) => {
      camera.play([
        { cut: true, dur: 0.01, pos: start, look: view.look },
        { dur: 1.5, ease: 'out', pos: (u) => mix(start, view.pos, u), look: () => view.look },
        holdShot(view, resolve),
      ], { skippable: false, handoff: 1.0 });
    });
    await race(stopped);
    if (aborted) return;
    await handoff();
  }

  // Visitors get a short aerial sweep that ends on the plaza.
  async function visitorSweep() {
    const road = boulevard(ctx);
    const p = places(ctx).plaza || { x: 4, z: 14, facing: Math.PI };
    const top = road[0] || [0, 25, -100];
    const y = groundY(ctx, p.x, p.z);
    const start = [top[0] + 14, top[1] + 44, top[2] - 8];
    const end = [p.x - Math.sin(p.facing) * 11, y + 6.5, p.z - Math.cos(p.facing) * 11];
    const target = [p.x, y + 2, p.z];
    setPlayerTeam(ctx, null);
    player.place(p.x, p.z, p.facing);
    landed = true;
    if (o.title !== false) {
      root.classList.add('lwf-titled');
      later(() => root.classList.remove('lwf-titled'), 2400);
    }
    const result = await race(camera.play([
      { cut: true, dur: 0.01, pos: start, look: target },
      { dur: 3.2, ease: 'inOut', pos: (u) => mix(start, end, u), look: () => target },
    ], { skippable: false, handoff: 0.9 }));
    if (aborted || result === 'skipped') return;
    phase = 'handoff';
    hud.el.classList.remove('lwf-cine');
    root.classList.add('lwf-out');
  }

  // Reduced motion: no ride. Cut to the home, then a smaller stamp (or the welcome line).
  async function calm() {
    land();
    hud.el.classList.remove('lwf-cine');
    hud.fade(false, 300);
    if (!team) return;
    if (o.prevRank !== undefined && kind !== 'full') showWelcome(welcomeLine(team, o.prevRank, count, (meta.week || 0) + team.id));
    else await stamp(true);
  }

  async function script() {
    if (kind === 'none') {
      land();
      return;
    }
    if (kind === 'calm') return calm();
    if (!team || !home) return visitorSweep();
    setPlayerTeam(ctx, team.id);
    standAtDoor();
    if (kind === 'short') return shortSwoop();
    return team.rank === 1 ? firstPlace() : fullRide();
  }

  // ---------------------------------------------------------------- skipping and safety
  function abort() {
    if (aborted || phase === 'done') return;
    aborted = true;
    abortNow('aborted');
  }
  // The first touch or key never costs the visitor their arrival (it may just be the tap that
  // starts the sound). It only offers the way out: a second one within three seconds skips.
  let offerUntil = 0;
  let offerTimer = 0;
  function offerSkip() {
    offerUntil = performance.now() + 3000;
    skipBtn.textContent = coarsePointer() ? 'Tap again to skip' : 'Press again to skip';
    skipBtn.classList.add('lwf-armed');
    clearTimeout(offerTimer);
    offerTimer = setTimeout(() => {
      skipBtn.textContent = 'Skip';
      skipBtn.classList.remove('lwf-armed');
    }, 3000);
  }
  function onSkip(e) {
    if (phase === 'done' || phase === 'handoff') return;
    const now = performance.now();
    if (now < armedAt) return;
    const key = e.type === 'keydown';
    if (key && (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Tab' || e.key === 'Shift')) return;
    const onButton = !key ? skipBtn.contains(e.target) : document.activeElement === skipBtn && (e.key === 'Enter' || e.key === ' ');
    const direct = onButton || (key && e.key === 'Escape');
    if (!direct && now > offerUntil) {
      offerSkip();
      if (phase === 'stamp') e.stopPropagation(); // keep the stamp up: its own tap-to-close must not see this one
      return;
    }
    if (phase === 'stamp') {
      if (now - stampAt > 600) {
        stampDismissed = true;
        hud.closeAll();
      }
      return;
    }
    if (onButton) e.preventDefault();
    abort();
  }
  window.addEventListener('pointerdown', onSkip, true);
  window.addEventListener('keydown', onSkip, true);
  const expected = team && kind === 'full' ? rideSeconds(team.rank).total + 6 : 8;
  const watchdog = setTimeout(abort, Math.max(25000, expected * 4000 + 10000));

  async function finalize() {
    clearTimeout(watchdog);
    clearTimeout(offerTimer);
    for (const t of timers) clearTimeout(t);
    window.removeEventListener('pointerdown', onSkip, true);
    window.removeEventListener('keydown', onSkip, true);
    const wasStamp = phase === 'stamp';
    phase = 'done';
    hideTags(false);
    try {
      if (aborted && !cancelled && !landed) await hud.fade(true, 110);
      if (wasStamp || aborted) hud.closeAll();
      if (camera.isCinematic) camera.skip();
      if (!cancelled) {
        if (!landed) land();
        else if (aborted && home) {
          // skipped after the stop: finish the walk-out instantly
          player.place(home.street.x, home.street.z, awayFrom);
          lookAtHome();
        }
      }
    } catch (err) {
      console.error('[lw] arrival could not land cleanly', err);
    }
    hud.el.classList.remove('lwf-cine', 'lwf-small-stamp', 'lwf-wide-stamp');
    root.classList.add('lwf-out');
    setTimeout(() => root.remove(), 420);
    hud.fade(false, 240);
    // A skipped ride still says where you stand: the short stamp, about two seconds.
    if (aborted && !cancelled && team && !stampShown && kind === 'full') {
      try {
        await wait(260);
        stampShown = true;
        hud.el.classList.add('lwf-small-stamp');
        hud.el.classList.toggle('lwf-wide-stamp', team.rank >= 10);
        sfx('stamp');
        await hud.stamp({ big: rankBig(team.rank), sub: tierName(team.tier), line: team.roast ? team.roast.arrival : '', color: TIER_CSS[team.tier], ms: 2200 });
      } catch (err) {
        console.error('[lw] short stamp failed', err);
      }
      hud.el.classList.remove('lwf-small-stamp', 'lwf-wide-stamp');
    }
  }

  hud.el.classList.add('lwf-cine');
  flowRoot(hud).appendChild(root);
  if (kind !== 'none' && kind !== 'calm') later(() => hud.fade(false, 520), 90);

  const done = (async () => {
    try {
      await script();
    } catch (err) {
      console.error('[lw] arrival failed, landing anyway', err);
      aborted = true;
    } finally {
      await finalize();
    }
    return { skipped: aborted, cancelled };
  })();

  return {
    done,
    cancel() {
      cancelled = true;
      abort();
    },
  };
}
