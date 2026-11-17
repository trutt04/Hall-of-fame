// League World boot. Loads the league data, derives the model, builds the hillside for exactly
// that many teams per neighborhood, populates it, then hands over to the UI flow (Contract 7).
//
// URL parameters (for testing):
//   ?time=17.5        freeze the time of day (hours, 0..24)
//   ?team=3           choose a team id
//   ?quality=low|high skip the adaptive quality controller
//   ?debug=1          stats readout, zone weights, lot labels
//   ?noflow=1         skip ui/flow.js and free roam with the built-in stand-in HUD

import * as THREE from '../lib/three.module.min.js';
import { TIERS } from './config.js';
import { createEngine } from './core/engine.js';
import { createStore } from './core/store.js';
import { createInput } from './core/input.js';
import { createCameraRig } from './core/camera.js';
import { createColliders } from './core/colliders.js';
import { createAudio } from './core/audio.js';
import { createNet } from './core/net.js';
import { createData } from './core/data.js';
import { makeLayout } from './world/layout.js';
import { createTerrain } from './world/terrain.js';
import { createSky } from './world/sky.js';
import { createPlayer, RUN_SPEED } from './world/player.js';
import { createInteract } from './world/interact.js';
import { createTown } from './world/town.js';
import { createResidents, accessoryFor } from './world/residents.js';
import { createDressing } from './world/dressing.js';
import { createTraffic } from './world/traffic.js';
import { createLandmarks } from './world/landmarks.js';
import { createKickGame } from './world/kick.js';
import { createRegime } from './world/regime.js';
import { createVandal } from './world/vandal.js';
import { startFreeRoam } from './world/freeroam.js';
import { createAvatar, setReducedMotion } from './art/index.js';
import { createHud } from './ui/hud.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function fontsReady(maxMs = 2500) {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const loads = Promise.all([
    document.fonts.load('400 32px Bungee'),
    document.fonts.load('400 16px "Barlow Semi Condensed"'),
    document.fonts.load('600 16px "Barlow Semi Condensed"'),
    document.fonts.load('700 16px "Barlow Semi Condensed"'),
  ]).catch(() => {});
  return Promise.race([loads, new Promise((resolve) => setTimeout(resolve, maxMs))]);
}

function showFallback(message) {
  const box = document.getElementById('fallback');
  const veil = document.getElementById('veil');
  if (veil) veil.hidden = true;
  if (!box) return null;
  const msg = document.getElementById('fallback-msg');
  if (msg && message) msg.textContent = message;
  box.hidden = false;
  return document.getElementById('fallback-list');
}

function hideFallback() {
  const box = document.getElementById('fallback');
  if (box) box.hidden = true;
}

// The plain version: used when WebGL is unavailable. The flow side owns the nice one.
async function plainFallback(store, message) {
  const list = showFallback(message);
  const data = createData({ store });
  try {
    await data.load();
  } catch (err) {
    return;
  }
  if (!list) return;
  try {
    const flow = await import('./ui/flow.js');
    if (typeof flow.renderFallback === 'function') {
      flow.renderFallback(list, { league: data.league, history: data.history, model: data.model });
      return;
    }
  } catch (err) { /* fall through to the built-in list */ }
  const m = data.model;
  const ol = document.createElement('ol');
  for (const id of m.order) {
    const t = m.teams[id];
    const li = document.createElement('li');
    li.textContent = t.name + '  ' + t.record.text + '  (' + TIERS[t.tier].name + ')';
    ol.appendChild(li);
  }
  list.replaceChildren(ol);
}

async function boot() {
  const canvas = document.getElementById('scene');
  const hud = createHud(document.getElementById('hud'), { veil: document.getElementById('veil') });
  const store = createStore();
  const params = store.params;
  const debug = store.get('debug');
  const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  setReducedMotion(calm);
  hud.setLoading(0.08, 'Checking the standings');

  // ------------------------------------------------------------------ engine
  let engine;
  try {
    engine = createEngine({ canvas, quality: params.get('quality') || 'auto' });
  } catch (err) {
    console.warn('[lw] WebGL is not available', err);
    window.__lw = { store, hud, failed: 'webgl' };
    await plainFallback(store, 'This device could not start the 3D world, so here is the plain version.');
    return;
  }
  const { scene, camera } = engine;
  engine.on('contextlost', () => showFallback('The 3D view was interrupted. It will come back by itself, or reload the page.'));
  engine.on('contextrestored', hideFallback);

  // ------------------------------------------------------------------ data first: the town plan depends on it
  const data = createData({ store });
  try {
    await Promise.all([data.load(), fontsReady()]);
  } catch (err) {
    console.warn('[lw] no league data', err);
    window.__lw = { store, hud, failed: 'data' };
    showFallback('The league data did not load. Check your connection and reload. Nothing is broken on your end.');
    return;
  }
  let model = data.model;
  store.set('model', model);
  hud.setLoading(0.3, 'Grading the hillside');
  await nextFrame();

  // ------------------------------------------------------------------ the hillside
  const contentQuality = engine.quality === 'low' ? 'low' : 'high';
  const counts = (m) => ({ heights: m.tiers.heights.length, bubble: m.tiers.bubble.length, park: m.tiers.park.length });
  const layout = makeLayout(counts(model));
  const terrain = createTerrain(layout, { quality: contentQuality });
  scene.add(terrain.group);
  hud.setLoading(0.5, 'Hanging the sky');
  await nextFrame();

  const sky = createSky({ scene, camera, terrain, quality: contentQuality });
  const timeParam = params.get('time');
  if (timeParam !== null && timeParam !== '' && Number.isFinite(Number(timeParam))) sky.setTime(Number(timeParam));

  const colliders = createColliders();
  for (const f of terrain.fenceColliders) colliders.addBox(f.cx, f.cz, f.w, f.d, f.rotation, 'fence');

  const input = createInput({ canvas, stick: hud.stick });
  const rig = createCameraRig({ camera, engine, terrain, input });
  rig.setBlocker((x, z) => colliders.insideBox(x, z, 1.6));
  const audio = createAudio();
  const net = createNet();
  const player = createPlayer({ scene, terrain, colliders, input, rig, audio, hud, store });
  const interact = createInteract({ player, camera, hud, canvas });
  const spawn = layout.places.spawnPlaza;
  player.place(spawn.x, spawn.z, spawn.facing);

  // ------------------------------------------------------------------ the world object (Contract 7)
  let freezeCount = 0;
  let frozenSwitch = false;
  let playerTeam = null;
  let idle = false;
  const ZONE_CSS = { hill: '#f5c542', heights: '#5fb8e8', plaza: '#f3eedd', bubble: '#c9b58a', park: '#ff9a3d', dump: '#9bbf5a' };

  function neighborhoodSpots() {
    const st = layout.stations;
    const lastPark = layout.lots.park[layout.lots.park.length - 1];
    return {
      hill: { x: 2.5, z: st.hill.z + 24.5, facing: Math.PI },
      heights: { x: st.fountain.x + 6, z: st.fountain.z + 15, facing: Math.PI },
      plaza: layout.places.spawnPlaza,
      bubble: { x: st.bulb.x - st.bulb.r - 4, z: st.bulb.z + 1.5, facing: Math.PI / 2 },
      park: { x: lastPark ? lastPark.x + 6 : 0, z: st.laneZ - 1, facing: 0 },
      dump: { x: layout.places.landfillGate.x, z: st.fenceZ + 2.5, facing: 0 },
    };
  }
  function inFrontOf(p, dist) {
    return { x: p.x + Math.sin(p.facing) * dist, z: p.z + Math.cos(p.facing) * dist, facing: p.facing + Math.PI };
  }

  const world = {
    THREE, engine, scene, camera: rig, rig, camera3D: camera, store, hud, input, audio, net, layout, terrain, sky, colliders, player, interact, data,
    town: null, residents: null, dressing: null, traffic: null, landmarks: null, kick: null, regime: null, vandal: null, hideTags: false,
    addSystem: engine.addSystem, removeSystem: engine.removeSystem,
    get model() { return model; },
    get playerTeam() { return playerTeam; },

    // Fast-travel targets: the plaza, each neighborhood, the boards.
    places() {
      const spots = neighborhoodSpots();
      const out = ['plaza', 'hill', 'heights', 'bubble', 'park', 'dump'].map((id) => ({
        id, kind: id === 'plaza' ? 'plaza' : 'neighborhood', name: world.zoneName(id),
        blurb: id === 'plaza' ? 'Standings, matchups, the statue and the paper.' : TIERS[id].blurb, color: ZONE_CSS[id],
        x: spots[id].x, z: spots[id].z, facing: spots[id].facing ?? 0,
      }));
      const s = inFrontOf(layout.places.standingsBoard, 9);
      const m = inFrontOf(layout.places.matchupBoard, 8);
      out.push({ id: 'standings', kind: 'board', name: 'Standings board', x: s.x, z: s.z, facing: s.facing });
      out.push({ id: 'matchups', kind: 'board', name: 'Matchup board', x: m.x, z: m.z, facing: m.facing });
      if (world.traffic && world.traffic.stop) {
        const ts = world.traffic.stop;
        out.push({ id: 'truckstop', kind: 'ride', name: 'Truck stop', blurb: 'Ride the garbage truck down to the dump.', x: ts.x, z: ts.z, facing: ts.facing });
      }
      if (world.kick && world.kick.place) {
        const kp = world.kick.place;
        out.push({ id: 'kick', kind: 'game', name: 'Field goal kicks', blurb: 'Swipe up to kick. Three misses and you are done.', x: kp.x, z: kp.z, facing: kp.facing });
      }
      if (world.dressing && world.dressing.plot) {
        const gp = world.dressing.plot;
        out.push({ id: 'graves', kind: 'sight', name: 'Draft Day Memorial Gardens', blurb: 'Headstones for the draft picks that did not make it.', x: gp.x, z: gp.z, facing: gp.facing });
      }
      if (world.vandal && world.vandal.place) {
        const vp = world.vandal.place;
        out.push({ id: 'revenge', kind: 'revenge', name: vp.name, blurb: vp.blurb, x: vp.x, z: vp.z, facing: vp.facing });
      }
      if (world.regime && world.regime.place) {
        const mp = world.regime.place;
        out.push({ id: 'monument', kind: 'sight', name: 'The Monument', blurb: 'Pay your respects to the Supreme Commissioner.', x: mp.x, z: mp.z, facing: mp.facing });
      }
      return out;
    },
    // The ride from the crown down to the dump, in order.
    boulevard() {
      return layout.road.map((p) => [p[0], terrain.heightAt(p[0], p[1]), p[1]]);
    },
    // The visitor becomes that team's resident (color, rank number, tier accessory). null = neutral visitor.
    setPlayerTeam(teamId) {
      const team = teamId !== null && teamId !== undefined ? model.teams[teamId] : null;
      playerTeam = team ? team.id : null;
      player.setAvatar(createAvatar({ color: team ? team.color : 0x8d939e, number: team ? team.rank : null, accessory: team ? accessoryFor(team) : null }));
      if (world.residents) world.residents.setPlayerTeam(playerTeam);
      if (world.dressing) world.dressing.setPlayerTeam(playerTeam);
      store.set('playerTeam', playerTeam);
      return playerTeam;
    },
    // Slow aerial drift over the hillside, for behind the team picker.
    idleCamera(on) {
      on = !!on;
      if (on === idle) return;
      idle = on;
      if (!on) {
        sky.setFogScale(1);
        world.hideTags = false;
        rig.skip();
        return;
      }
      sky.setFogScale(0.45);
      world.hideTags = true;
      const zEnd = layout.bounds.maxZ;
      const portrait = camera.aspect < 1;
      const drift = (u, sec) => {
        const a = sec * 0.045;
        return [34 * Math.sin(a), 62 + 6 * Math.sin(a * 0.6) + (portrait ? 14 : 0), zEnd + 58 + (portrait ? 26 : 0) + 12 * Math.cos(a * 0.8)];
      };
      rig.play([{ cut: true, dur: 1e7, ease: 'linear', fov: portrait ? 56 : 44, pos: drift, look: (u, sec) => [6 * Math.sin(sec * 0.03), 8, -14] }], { skippable: false, handoff: 1.2 })
        .then(() => {
          if (idle) {
            idle = false;
            sky.setFogScale(1);
            world.hideTags = false;
          }
        });
    },
    get idle() { return idle; },
    // Movement off while something scripted or modal is happening. Stops any walk in progress.
    //   const release = world.freezePlayer()   counted: call release() when done
    //   world.freezePlayer(true | false)        a simple switch (panels and cards)
    freezePlayer(on) {
      if (on === false) {
        frozenSwitch = false;
        return () => {};
      }
      player.halt();
      if (on === true) {
        frozenSwitch = true;
        return () => { frozenSwitch = false; };
      }
      freezeCount++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        freezeCount = Math.max(0, freezeCount - 1);
      };
    },
    travelTo(target) {
      const p = typeof target === 'string' ? world.places().find((q) => q.id === target) : target;
      if (!p) return Promise.resolve(false);
      // leave the throne, the telescope or any other held view first
      if (rig.isCinematic && !idle) rig.skip();
      return player.teleport(p.x, p.z, p.facing ?? player.heading).then(() => true);
    },
    zoneName(key) {
      return key === 'plaza' ? 'The Plaza' : TIERS[key] ? TIERS[key].name : key;
    },
  };

  // ------------------------------------------------------------------ populate
  hud.setLoading(0.65, 'Moving everybody in');
  await nextFrame();
  const town = (world.town = createTown(world));
  town.apply(model);
  const residents = (world.residents = createResidents(world));
  residents.apply(model);
  hud.setLoading(0.8, 'Mowing the nice lawns');
  await nextFrame();
  const dressing = (world.dressing = createDressing(world));
  dressing.apply(model);
  const traffic = (world.traffic = createTraffic(world));
  traffic.apply(model);
  const landmarks = (world.landmarks = createLandmarks(world));
  const kick = (world.kick = createKickGame(world));
  const regime = (world.regime = createRegime(world));
  regime.apply(model);
  const vandal = (world.vandal = createVandal(world));
  vandal.apply(model);
  world.setPlayerTeam(null);

  let markers = null;
  if (debug) {
    const { createMarkers } = await import('./world/markers.js');
    markers = createMarkers(layout, terrain);
    scene.add(markers.group);
    world.markers = markers;
  }

  // ------------------------------------------------------------------ systems, in order
  const zone = {};
  const listener = { x: 0, z: 0, yaw: 0 };
  engine.addSystem({ update: () => input.update() }, 0);
  engine.addSystem({ update: (dt, t) => { player.frozen = rig.isCinematic || freezeCount > 0 || frozenSwitch; player.update(dt, t); } }, 10);
  engine.addSystem(interact, 20);
  engine.addSystem(rig, 30);
  engine.addSystem({ update: (dt, t) => sky.update(dt, t, player.position) }, 40);
  engine.addSystem(town, 45);
  engine.addSystem(residents, 46);
  engine.addSystem(dressing, 47);
  engine.addSystem(traffic, 48);
  engine.addSystem(landmarks, 49);
  engine.addSystem(kick, 49.5);
  engine.addSystem(regime, 49.6);
  engine.addSystem(vandal, 49.7);
  engine.addSystem({
    update(dt) {
      terrain.zoneAt(player.position.x, player.position.z, zone);
      listener.x = player.position.x;
      listener.z = player.position.z;
      listener.yaw = rig.yaw;
      audio.update(dt, zone, listener);
    },
  }, 50);

  // ------------------------------------------------------------------ input wiring (world side)
  hud.on('modal', (open) => {
    input.setSuspended(open);
    if (open) player.halt(); // nobody keeps walking behind a card or a panel
  });
  hud.onAction(() => interact.use());
  input.on('use', () => interact.use());
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  input.on('tap', ({ x, y }) => {
    if (rig.isCinematic || player.frozen) return;
    const item = interact.pick(x, y);
    if (item) {
      audio.sfx('pop', { volume: 0.5 });
      interact.walkToAndUse(item);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const p = terrain.raycastGround(raycaster.ray.origin, raycaster.ray.direction, 400, hit);
    if (!p) return;
    const b = terrain.bounds;
    if (p.x < b.minX - 6 || p.x > b.maxX + 6 || p.z < b.minZ - 6 || p.z > b.maxZ + 6) return;
    player.walkTo(p.x, p.z);
  });
  if (audio.wanted) {
    // The visitor chose sound before; browsers only let it start from a gesture.
    const arm = () => {
      window.removeEventListener('pointerdown', arm, true);
      window.removeEventListener('keydown', arm, true);
      if (audio.wanted && !audio.enabled) audio.enable();
    };
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('keydown', arm, true);
  }

  // ------------------------------------------------------------------ presence seam, live data
  store.on('player', (state) => net.sendState(state));
  net.connect({ teamId: store.get('teamId') });

  data.start((next, prev) => {
    const a = counts(next);
    const b = counts(prev);
    if (a.heights !== b.heights || a.bubble !== b.bubble || a.park !== b.park || next.order.length !== prev.order.length) {
      window.location.reload(); // the town plan itself changed: rebuild from scratch
      return;
    }
    model = next;
    town.apply(model);
    residents.apply(model);
    dressing.apply(model);
    traffic.apply(model);
    regime.apply(model);
    vandal.apply(model);
    if (playerTeam !== null) {
      const t = model.teams[playerTeam];
      const av = player.avatar;
      if (t && av && av.setNumber) {
        av.setNumber(t.rank);
        av.setAccessory(accessoryFor(t));
      }
    }
    store.set('model', model);
  });

  // ------------------------------------------------------------------ debug readout and handle
  if (debug) {
    let clock = 0;
    engine.addSystem({
      update(dt) {
        clock += dt;
        if (clock < 0.25) return;
        clock = 0;
        const s = engine.stats();
        const p = player.position;
        const zw = Object.keys(zone).filter((k) => zone[k] > 0.005).map((k) => k + ' ' + zone[k].toFixed(2)).join('  ');
        hud.setDebug(
          s.fps + ' fps  ' + s.frameMs + ' ms  pr ' + s.pixelRatio + '\n'
          + s.drawCalls + ' calls  ' + s.triangles + ' tris\n'
          + 'x ' + p.x.toFixed(1) + '  y ' + p.y.toFixed(1) + '  z ' + p.z.toFixed(1) + '  ' + player.anim + '\n'
          + zw + '\n'
          + 'time ' + sky.hours.toFixed(2) + '  night ' + sky.nightAmount.toFixed(2) + '  audio ' + audio.state,
        );
      },
    }, 90);
  }
  window.__lw = Object.assign(world, {
    teleport: (x, z, facing) => player.place(x, z, facing ?? player.heading),
    stats: () => engine.stats(),
    RUN_SPEED,
  });

  // ------------------------------------------------------------------ go
  engine.start();
  await nextFrame();
  await nextFrame();
  hud.setLoading(1, 'Welcome');

  const ctx = {
    store, hud, camera: rig, player, audio, interact, sky, engine, terrain, layout, town, world,
    get model() { return model; },
    get history() { return data.history; },
    get status() { return data.status; },
    get league() { return data.league; },
  };
  // Free roam starts at most once. If the flow fails, even halfway through, whatever it left on
  // screen is removed first, so the stand-in HUD never sits on top of a half-built flow.
  let roaming = false;
  const freeRoam = (why) => {
    if (roaming) return;
    roaming = true;
    if (why) console.warn('[lw] the UI flow is unavailable, free roaming instead', why);
    try {
      // The flow keeps everything it builds under .lwf-root. It also puts state classes on
      // elements the world owns (the HUD itself, panels), so those are stripped, never removed.
      for (const node of document.querySelectorAll('.lwf-root')) node.remove();
      for (const node of document.querySelectorAll('[class^="lwf"], [class*=" lwf"]')) {
        const owned = node === hud.el || node === document.body || node === document.documentElement
          || node.id || node.contains(hud.el) || node.contains(canvas) || node.closest('[class^="lw-"], [class*=" lw-"]');
        if (!owned) { node.remove(); continue; }
        for (const cls of [...node.classList]) if (cls.startsWith('lwf')) node.classList.remove(cls);
      }
      hud.closeAll();
      hud.setCue(null);
      frozenSwitch = false;
      if (idle) world.idleCamera(false);
      else if (rig.isCinematic) rig.skip();
      startFreeRoam(ctx);
    } catch (err) {
      console.error('[lw] free roam failed to start', err);
    }
    hud.hideLoading();
  };
  if (params.get('noflow') === '1') freeRoam(null);
  else {
    try {
      const flow = await import('./ui/flow.js');
      // startFlow may wait on the visitor (team picker): never block the veil on it
      Promise.resolve().then(() => flow.startFlow(ctx)).catch((err) => freeRoam(err));
    } catch (err) {
      freeRoam(err);
    }
  }
  setTimeout(() => hud.hideLoading(), 600);
}

boot().catch((err) => {
  console.error('[lw] boot failed', err);
  showFallback('Something went wrong while building the world. Reloading usually fixes it.');
});
