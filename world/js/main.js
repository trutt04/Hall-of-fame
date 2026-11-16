// League World boot. Creates the engine, the empty town and all the machinery, then runs an
// ordered list of systems every frame. Stage 2 adds the data, the homes and the residents on top
// of the `world` object built here.
//
// URL parameters (for testing):
//   ?time=17.5        freeze the time of day (hours, 0..24)
//   ?team=3           choose a team id
//   ?quality=low|high skip the adaptive quality controller
//   ?debug=1          stats readout, zone weights, lot labels
//   ?nointro=1        skip the establishing shot
//   ?lots=3,4,3       heights,bubble,park lot counts (until real data drives them)
//   ?labels=0         hide the stage 1 lot labels

import * as THREE from '../lib/three.module.min.js';
import { TIERS, TIER_ORDER, PATHS } from './config.js';
import { safeStorageGet, safeStorageSet } from './core/util.js';
import { createEngine } from './core/engine.js';
import { createStore } from './core/store.js';
import { createInput } from './core/input.js';
import { createCameraRig } from './core/camera.js';
import { createColliders } from './core/colliders.js';
import { createAudio } from './core/audio.js';
import { createNet } from './core/net.js';
import { makeLayout } from './world/layout.js';
import { createTerrain } from './world/terrain.js';
import { createSky } from './world/sky.js';
import { createPlayer, RUN_SPEED } from './world/player.js';
import { createInteract } from './world/interact.js';
import { createMarkers } from './world/markers.js';
import { createHud } from './ui/hud.js';

const HINT_KEY = 'lw.hinted';
const HINT_TEXT = 'Drag left side to walk. Drag right side to look. Tap anything.';
const HINT_TEXT_DESKTOP = 'WASD to walk, drag to look, click anything. E to use.';

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
  if (!box) return;
  const msg = document.getElementById('fallback-msg');
  if (msg && message) msg.textContent = message;
  box.hidden = false;
}

function hideFallback() {
  const box = document.getElementById('fallback');
  if (box) box.hidden = true;
}

function parseLots(raw) {
  if (!raw) return null;
  const n = raw.split(',').map((s) => parseInt(s, 10));
  if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) return null;
  return { heights: n[0], bubble: n[1], park: n[2] };
}

async function boot() {
  const canvas = document.getElementById('scene');
  const hud = createHud(document.getElementById('hud'), { veil: document.getElementById('veil') });
  const store = createStore();
  const params = store.params;
  const debug = store.get('debug');
  hud.setLoading(0.1, 'Painting the yard lines');

  // ------------------------------------------------------------------ engine
  let engine;
  try {
    engine = createEngine({ canvas, quality: params.get('quality') || 'auto' });
  } catch (err) {
    console.warn('[lw] WebGL is not available', err);
    showFallback('This device could not start the 3D world, so here is the plain version.');
    window.__lw = { store, hud, failed: 'webgl' };
    return;
  }
  const { scene, camera } = engine;
  engine.on('contextlost', () => showFallback('The 3D view was interrupted. It will come back by itself, or reload the page.'));
  engine.on('contextrestored', hideFallback);

  await fontsReady();
  hud.setLoading(0.3, 'Grading the hillside');
  await nextFrame();

  // ------------------------------------------------------------------ the town
  const contentQuality = engine.quality === 'low' ? 'low' : 'high';
  const layout = makeLayout(parseLots(params.get('lots')) || { heights: 3, bubble: 4, park: 3 });
  const terrain = createTerrain(layout, { quality: contentQuality });
  scene.add(terrain.group);
  hud.setLoading(0.6, 'Hanging the sky');
  await nextFrame();

  const sky = createSky({ scene, camera, terrain, quality: contentQuality });
  const timeParam = params.get('time');
  if (timeParam !== null && timeParam !== '' && Number.isFinite(Number(timeParam))) sky.setTime(Number(timeParam));

  const colliders = createColliders();
  for (const f of terrain.fenceColliders) colliders.addBox(f.cx, f.cz, f.w, f.d, f.rotation, 'fence');

  const input = createInput({ canvas, stick: hud.stick });
  const rig = createCameraRig({ camera, engine, terrain, input });
  const audio = createAudio();
  const net = createNet();
  const player = createPlayer({ scene, terrain, colliders, input, rig, audio, hud, store });
  const interact = createInteract({ player, camera, hud, canvas });

  const spawn = layout.places.spawnPlaza;
  player.place(spawn.x, spawn.z, spawn.facing);

  // Stage 1 stand-ins: labels on every lot and place.
  const markers = createMarkers(layout, terrain);
  scene.add(markers.group);
  if (params.get('labels') === '0') markers.setVisible(false);

  hud.setLoading(0.85, 'Opening the gates');

  // ------------------------------------------------------------------ systems, in order
  let freezeCount = 0;
  const zone = {};
  const listener = { x: 0, z: 0, yaw: 0 };
  engine.addSystem({ update: () => input.update() }, 0);
  engine.addSystem({ update: (dt, t) => { player.frozen = rig.isCinematic || freezeCount > 0; player.update(dt, t); } }, 10);
  engine.addSystem(interact, 20);
  engine.addSystem(rig, 30);
  engine.addSystem({ update: (dt, t) => sky.update(dt, t, player.position) }, 40);
  engine.addSystem({
    update(dt) {
      terrain.zoneAt(player.position.x, player.position.z, zone);
      listener.x = player.position.x;
      listener.z = player.position.z;
      listener.yaw = rig.yaw;
      audio.update(dt, zone, listener);
    },
  }, 50);

  const world = {
    THREE, engine, scene, camera, store, hud, input, rig, audio, net, layout, terrain, sky, colliders, player, interact, markers,
    addSystem: engine.addSystem, removeSystem: engine.removeSystem,
    // Movement off while something scripted is happening. Returns a function that releases it.
    freezePlayer() {
      freezeCount++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        freezeCount = Math.max(0, freezeCount - 1);
      };
    },
    // Fast travel to a named place or a point.
    travelTo(target) {
      const p = typeof target === 'string' ? travelSpots()[target] : target;
      if (!p) return Promise.resolve(false);
      return player.teleport(p.x, p.z, p.facing ?? player.heading).then(() => true);
    },
    zoneName(key) {
      return key === 'plaza' ? 'The Plaza' : TIERS[key] ? TIERS[key].name : key;
    },
  };

  function travelSpots() {
    const st = layout.stations;
    const L = layout.lots;
    const firstPark = L.park[L.park.length - 1];
    return {
      hill: { x: 4, z: st.hill.z + 24.5, facing: 0 },
      heights: { x: st.fountain.x + 6, z: st.fountain.z + 15, facing: Math.PI },
      plaza: layout.places.spawnPlaza,
      bubble: { x: st.bulb.x - st.bulb.r - 4, z: st.bulb.z + 1.5, facing: Math.PI / 2 },
      park: { x: firstPark ? firstPark.x + 6 : 0, z: st.laneZ - 1, facing: 0 },
      dump: { x: layout.places.landfillGate.x, z: st.fenceZ + 2.5, facing: 0 },
    };
  }

  // ------------------------------------------------------------------ input wiring
  hud.on('modal', (open) => input.setSuspended(open));
  hud.onAction(() => interact.use());
  input.on('use', () => interact.use());
  input.on('map', () => openTravel());
  input.on('firstmove', () => {
    hud.hideHint();
    safeStorageSet(HINT_KEY, '1');
  });

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

  // ------------------------------------------------------------------ sound
  const syncSound = () => hud.setButton('sound', { pressed: audio.enabled, label: audio.enabled ? 'Sound on' : 'Sound off' });
  audio.on('change', syncSound);
  hud.onButton('sound', () => {
    const on = audio.toggle();
    if (on) audio.sfx('pop');
    hud.toast(on ? 'Sound on' : 'Sound off', { ms: 1200 });
  });
  if (audio.wanted) {
    // The visitor chose sound before; browsers only allow it to start from a gesture.
    const arm = () => {
      window.removeEventListener('pointerdown', arm, true);
      window.removeEventListener('keydown', arm, true);
      if (audio.wanted && !audio.enabled) audio.enable();
    };
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('keydown', arm, true);
  }
  syncSound();

  // ------------------------------------------------------------------ stage 1 HUD content
  hud.setStatus({ rankText: '', teamName: 'League World', recordText: 'Empty town', tierName: 'Stage 1' });
  hud.onButton('status', () => {
    hud.openCard({
      kicker: 'League World',
      title: 'The town is built. The neighbors move in next.',
      lines: ['Walk the Boulevard from the gold gates down to the landfill. Every lot is waiting for a team.'],
      actions: [{ label: 'Got it' }],
    });
  });

  function button(title, sub, tag, color, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lw-row';
    if (color) b.style.setProperty('--accent', color);
    const main = document.createElement('span');
    main.className = 'lw-row-main';
    const t = document.createElement('span');
    t.className = 'lw-row-title';
    t.textContent = title;
    const s = document.createElement('span');
    s.className = 'lw-row-sub';
    s.textContent = sub;
    main.append(t, s);
    b.appendChild(main);
    if (tag) {
      const g = document.createElement('span');
      g.className = 'lw-row-tag';
      g.textContent = tag;
      b.appendChild(g);
    }
    b.addEventListener('click', onClick);
    return b;
  }

  const ZONE_CSS = { hill: '#f5c542', heights: '#5fb8e8', plaza: '#f3eedd', bubble: '#c9b58a', park: '#ff9a3d', dump: '#9bbf5a' };
  function openTravel() {
    if (hud.panelOpen) {
      hud.closePanel();
      return;
    }
    const box = document.createElement('div');
    const note = document.createElement('p');
    note.className = 'lw-note';
    note.textContent = 'Top of the hill is first place. Bottom is the dump. Tap a neighborhood to go there.';
    const list = document.createElement('div');
    list.className = 'lw-list';
    const blurbs = Object.assign({ plaza: { name: 'The Plaza', blurb: 'Standings board, matchups, the statue and the paper.' } }, TIERS);
    for (const key of ['hill', 'heights', 'plaza', 'bubble', 'park', 'dump']) {
      const y = Math.round(layout.zones[key].y);
      list.appendChild(button(blurbs[key].name, blurbs[key].blurb, y + ' m', ZONE_CSS[key], () => {
        hud.closePanel();
        world.travelTo(key);
      }));
    }
    box.append(note, list);
    hud.openPanel({ title: 'Map', contentEl: box });
  }
  hud.onButton('map', openTravel);

  hud.onButton('standings', () => {
    const box = document.createElement('div');
    const note = document.createElement('p');
    note.className = 'lw-note';
    note.textContent = 'The standings arrive with the league data. For now, here is who would live where.';
    const list = document.createElement('div');
    list.className = 'lw-list';
    let rank = 1;
    for (const tier of TIER_ORDER) {
      for (const lot of layout.lots[tier]) {
        const r = rank++;
        list.appendChild(button('Rank ' + r, TIERS[tier].name, '#' + r, ZONE_CSS[tier], () => {
          hud.closePanel();
          const fx = Math.sin(lot.facing);
          const fz = Math.cos(lot.facing);
          player.teleport(lot.curb[0] + fx * 2, lot.curb[1] + fz * 2, lot.facing + Math.PI);
        }));
      }
    }
    box.append(note, list);
    hud.openPanel({ title: 'Standings', contentEl: box });
  });

  hud.onButton('menu', () => {
    const box = document.createElement('div');
    const list = document.createElement('div');
    list.className = 'lw-list';
    const soundRow = button('Sound', audio.enabled ? 'On. Tap to turn it off.' : 'Off. Tap to turn it on.', audio.enabled ? 'ON' : 'OFF', null, () => {
      audio.toggle();
      hud.closePanel();
    });
    const q = engine.quality;
    const qualityRow = button('Graphics', q === 'low' ? 'Battery saver. Tap for automatic.' : 'Automatic. Tap for battery saver.', q === 'low' ? 'LOW' : 'AUTO', null, () => {
      engine.setQuality(q === 'low' ? 'auto' : 'low');
      hud.closePanel();
      hud.toast(q === 'low' ? 'Graphics: automatic' : 'Graphics: battery saver');
    });
    const hof = document.createElement('a');
    hof.className = 'lw-row';
    hof.href = PATHS.hallOfFame;
    const hm = document.createElement('span');
    hm.className = 'lw-row-main';
    const ht = document.createElement('span');
    ht.className = 'lw-row-title';
    ht.textContent = 'Hall of Fame';
    const hs = document.createElement('span');
    hs.className = 'lw-row-sub';
    hs.textContent = 'Leave the world and visit the old stadium.';
    hm.append(ht, hs);
    hof.appendChild(hm);
    hof.style.textDecoration = 'none';
    list.append(soundRow, qualityRow, hof);
    const h = document.createElement('h3');
    h.className = 'lw-h3';
    h.textContent = 'How to get around';
    const help = document.createElement('p');
    help.className = 'lw-note';
    help.textContent = 'Phone: drag the left side to walk, drag the right side to look, pinch to zoom, tap the ground to walk there. Keyboard: WASD or arrows, Shift to walk, drag to look, wheel to zoom, E to use, M for the map.';
    box.append(list, h, help);
    hud.openPanel({ title: 'Menu', contentEl: box });
  });

  // Stage 1 stand-in interactables: every lot and landmark can be walked to and inspected, which
  // exercises the same path the real mailboxes, boards and doors will use.
  {
    let rank = 1;
    for (const tier of TIER_ORDER) {
      for (const lot of layout.lots[tier]) {
        const r = rank++;
        const fx = Math.sin(lot.facing);
        const fz = Math.cos(lot.facing);
        const reach = tier === 'dump' ? lot.r - 2 : lot.d / 2 - 2.5;
        const at = new THREE.Vector3(lot.x + fx * reach, 0, lot.z + fz * reach);
        at.y = terrain.heightAt(at.x, at.z);
        interact.register({
          id: 'lot:' + tier + ':' + lot.index,
          position: at,
          radius: 3.2,
          label: 'Inspect lot',
          onUse: () => {
            audio.sfx('tick');
            hud.openCard({
              kicker: 'Rank ' + r + ' lives here',
              title: TIERS[tier].name,
              stats: [['Altitude', lot.y.toFixed(1) + ' m'], ['Lot', lot.w + ' x ' + lot.d + ' m'], ['Spot', (lot.index + 1) + ' of ' + layout.lots[tier].length]],
              lines: [TIERS[tier].blurb],
              jab: 'Vacant until the standings move somebody in.',
              accentColor: ZONE_CSS[tier],
              actions: [{ label: 'Close' }],
            });
          },
        });
      }
    }
    const places = [
      ['statue', 'Statue', 'The defending champion will stand here, in whatever condition they have earned.'],
      ['standingsBoard', 'Standings board', 'The whole league, top to bottom, on one board.'],
      ['matchupBoard', 'Matchup board', 'This week\'s games and who is winning them.'],
      ['newspaperBox', 'Newspaper box', 'The weekly paper. Mostly bad news for somebody.'],
      ['fountain', 'Fountain', 'Playoff Heights gathers around it and says "we" a lot.'],
      ['burningBarrel', 'Burning barrel', 'Warmth, and somewhere to throw last week\'s lineup.'],
      ['landfillGate', 'Landfill gate', 'Past here it is just the dump and whoever is in last place.'],
    ];
    for (const [key, label, line] of places) {
      const p = layout.places[key];
      if (!p) continue;
      const off = key === 'statue' || key === 'fountain' ? 5 : 0;
      const at = new THREE.Vector3(p.x, 0, p.z + off);
      at.y = terrain.heightAt(at.x, at.z);
      interact.register({
        id: 'place:' + key,
        position: at,
        radius: key === 'statue' || key === 'fountain' ? 4 : 2.8,
        label: 'Look',
        priority: 1,
        onUse: () => {
          audio.sfx('tick');
          hud.openCard({ kicker: 'Coming soon', title: label, lines: [line], actions: [{ label: 'Close' }] });
        },
      });
    }
  }

  // ------------------------------------------------------------------ presence seam
  store.on('player', (state) => net.sendState(state));
  net.connect({ teamId: store.get('teamId') });

  // ------------------------------------------------------------------ debug readout
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

  // ------------------------------------------------------------------ debug handle (testers rely on this)
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
  hud.hideLoading();

  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const hinted = safeStorageGet(HINT_KEY) === '1';
  const showHint = () => {
    if (!hinted && !input.hasMoved) hud.showHint(coarse ? HINT_TEXT : HINT_TEXT_DESKTOP);
  };

  if (params.get('nointro') === '1') {
    showHint();
  } else {
    // A short establishing shot: the whole valley, then down behind the visitor.
    const st = layout.stations;
    rig.play([
      { cut: true, dur: 0.01, pos: [26, st.plaza.y + 62, 118], look: [0, 12, -40] },
      { dur: 2.6, ease: 'inOut', pos: [8, st.plaza.y + 24, 52], look: [0, 13, -60] },
    ], { skippable: true, handoff: 1.1 }).then(showHint);
  }
}

boot().catch((err) => {
  console.error('[lw] boot failed', err);
  showFallback('Something went wrong while building the world. Reloading usually fixes it.');
});
