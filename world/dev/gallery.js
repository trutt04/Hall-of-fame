// Prop gallery: every art export on a ground plane under the world's lighting.
//   ?show=homes | reactive | setpieces | characters | regime | facility | champion | all | <singleName>   (default homes)
//   ?night=1        dim the lights, glow the windows, turn porch lights on
//   ?az=&el=&dist=&cx=&cy=&cz=   camera (degrees / meters), ?t= fixed time, ?labels=0, ?table=0, ?ref=0 (no scale avatars),
//   ?rm=1 reduced motion, ?light=2 light multiplier, ?porch=win|lose|neutral, ?on=1 lamps on by day, ?anchors=1 show home anchors and colliders,
//   ?row=<meters> row width before wrapping
// Drag to orbit, wheel or pinch to zoom, right-drag (or two fingers) to pan.
import * as THREE from '../lib/three.module.min.js';
import * as ART from '../js/art/index.js';
import { TEAM_COLORS, PALETTE } from '../js/config.js';

const q = new URLSearchParams(location.search);
const show = q.get('show') || 'homes';
const night = q.get('night') === '1';
const fixedT = q.has('t') ? parseFloat(q.get('t')) : null;
const wantLabels = q.get('labels') !== '0';
const wantRef = q.get('ref') !== '0';
if (q.get('rm') === '1' && ART.setReducedMotion) ART.setReducedMotion(true);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x0a1022 : 0xbfd8ff);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);

// The same lighting the world uses.
// ?light=2 multiplies both intensities (to preview a brighter day without touching the art).
const LIGHT = parseFloat(q.get('light') || 1);
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a5a3a, (night ? 0.3 : 1.0) * LIGHT);
const sun = new THREE.DirectionalLight(night ? 0x8fa6ff : 0xfff1d6, (night ? 0.22 : 1.6) * LIGHT);
sun.position.set(30, 60, 40);
scene.add(hemi, sun);

const groundMat = new THREE.MeshLambertMaterial({ color: q.get('ground') ? parseInt(q.get('ground'), 16) : PALETTE.heights.grass });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
scene.add(ground);

// ---- what to show ------------------------------------------------------------------------------
const col = (i) => TEAM_COLORS[i % TEAM_COLORS.length];
const has = (n) => typeof ART[n] === 'function';
const textCanvas = (lines, w = 512, h = 256, bg = '#f3eedd', fg = '#18213f') => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  const fs = Math.floor((h / (lines.length + 0.6)) * 0.8);
  x.font = `${fs}px "Bungee", Impact, "Arial Narrow", sans-serif`;
  lines.forEach((l, i) => x.fillText(l, w / 2, (h * (i + 0.8)) / (lines.length + 0.6), w * 0.92));
  return c;
};

// Each item returns a list of entries: { o: prop, label, w (optional width hint), ref (stand an avatar here) }
const ITEMS = {
  // homes
  hill: ['homes', () => [{ o: ART.createHome('hill', { color: col(6), seed: 1 }), label: 'hill', w: 46, d: 42, home: true }]],
  heights: ['homes', () => [0, 1, 2].map((i) => ({ o: ART.createHome('heights', { color: col([0, 3, 9][i]), seed: [2, 5, 8][i] }), label: 'heights ' + [2, 5, 8][i], w: 21, d: 21, home: true }))],
  bubble: ['homes', () => [{ o: ART.createHome('bubble', { color: col(1), seed: 3 }), label: 'bubble', w: 19, d: 19, home: true }]],
  park: ['homes', () => [{ o: ART.createHome('park', { color: col(8), seed: 4 }), label: 'park', w: 16, d: 14, home: true }]],
  dump: ['homes', () => [{ o: ART.createHome('dump', { color: col(5), seed: 6 }), label: 'dump', w: 25, d: 25, home: true }]],
  // reactive
  trashPile: ['reactive', () => [1, 4, 8, 12].map((n) => ({ o: ART.createTrashPile(n), label: 'trash ' + n }))],
  goalposts: ['reactive', () => ['up', 'crooked', 'down'].map((s) => ({ o: ART.createGoalposts(s), label: 'goalposts ' + s, w: 4 }))],
  ambulance: ['reactive', () => [{ o: ART.createAmbulance(3), label: 'ambulance', w: 7, ref: true }]],
  movingTruck: ['reactive', () => ['up', 'down'].map((s) => ({ o: ART.createMovingTruck(s), label: 'moving ' + s, w: 11, ref: true }))],
  forSaleSign: ['reactive', () => [{ o: ART.createForSaleSign(), label: 'for sale?' }]],
  goldenToilet: ['reactive', () => [{ o: ART.createGoldenToilet(), label: 'golden toilet' }]],
  spotlight: ['reactive', () => [{ o: ART.createSpotlight(), label: 'spotlight', w: 4 }]],
  blackCat: ['reactive', () => [{ o: ART.createBlackCat(), label: 'black cat' }]],
  horseshoe: ['reactive', () => [{ o: ART.createHorseshoe(), label: 'horseshoe' }]],
  flamingos: ['reactive', () => [2, 6].map((n) => ({ o: ART.createFlamingos(n), label: 'flamingos ' + n }))],
  yardSign: ['reactive', () => [{ o: ART.createYardSign(textCanvas(['0-9', 'AND PROUD'])), label: 'yard sign' }]],
  plaque: ['reactive', () => [{ o: ART.createPlaque(textCanvas(['CHAMPION 2025', 'DAN'], 512, 256, '#2a2116', '#f5c542')), label: 'plaque', lift: 1.2 }]],
  // set pieces
  crown: ['setpieces', () => [{ o: ART.createCrown(), label: 'crown', w: 8, lift: 2 }]],
  throne: ['setpieces', () => [{ o: ART.createThrone(), label: 'throne', w: 4, ref: true }]],
  goldGates: ['setpieces', () => [{ o: ART.createGoldGates(), label: 'gold gates', w: 10 }]],
  fountain: ['setpieces', () => [{ o: ART.createFountain(), label: 'fountain', w: 7 }]],
  streetlight: ['setpieces', () => [false, true].map((f) => ({ o: ART.createStreetlight({ flicker: f }), label: f ? 'streetlight flicker' : 'streetlight', w: 3 }))],
  burningBarrel: ['setpieces', () => [{ o: ART.createBurningBarrel(), label: 'burning barrel' }]],
  rainCloud: ['setpieces', () => [{ o: ART.createRainCloud({ radius: 5 }), label: 'rain cloud', w: 12 }]],
  statue: ['setpieces', () => ['shiny', 'pigeons', 'cone'].map((s) => ({ o: ART.createStatue(s), label: 'statue ' + s, w: 5, ref: true }))],
  newspaperBox: ['setpieces', () => [{ o: ART.createNewspaperBox(), label: 'newspaper box' }]],
  telescope: ['setpieces', () => [{ o: ART.createTelescope(), label: 'telescope' }]],
  periscope: ['setpieces', () => [{ o: ART.createPeriscope(), label: 'periscope' }]],
  outhouse: ['setpieces', () => [{ o: ART.createOuthouse(), label: 'outhouse', w: 3 }]],
  building: ['setpieces', () => ['hof', 'graveyard', 'office'].map((s) => ({ o: ART.createBuilding(s), label: 'building ' + s, w: 17, d: 14, ref: true }))],
  boardFrame: ['setpieces', () => {
    const b = ART.createBoardFrame({ w: 12, h: 6 });
    const t = new THREE.CanvasTexture(textCanvas(['WEEK 10', 'DAN 101.7  BOB 88.4'], 1024, 512, '#0a1022', '#f5c542'));
    t.colorSpace = THREE.SRGBColorSpace; b.screen.material.map = t;
    return [{ o: b, label: 'board frame', w: 16 }];
  }],
  blimp: ['setpieces', () => {
    const b = ART.createBlimp();
    const t = new THREE.CanvasTexture(textCanvas(['DAN LEFT 64 POINTS ON THE BENCH'], 1024, 128, '#f3eedd', '#d7263d'));
    t.colorSpace = THREE.SRGBColorSpace; b.banner.material.map = t; b.banner.material.needsUpdate = true;
    return [{ o: b, label: 'blimp', w: 40, lift: 6 }];
  }],
  floodlight: ['setpieces', () => [{ o: ART.createFloodlight(), label: 'floodlight', w: 6 }]],
  tree: ['setpieces', () => ['round', 'pine', 'topiary', 'dead'].map((s) => ({ o: ART.createTree(s), label: 'tree ' + s, w: 4.5 }))],
  bush: ['setpieces', () => [{ o: ART.createBush(), label: 'bush' }]],
  trashCan: ['setpieces', () => [{ o: ART.createTrashCan(), label: 'trash can' }]],
  velvetRope: ['setpieces', () => [{ o: ART.createVelvetRope(4), label: 'velvet rope', w: 5 }]],
  lawnChair: ['setpieces', () => [{ o: ART.createLawnChair(), label: 'lawn chair' }]],
  grill: ['setpieces', () => [{ o: ART.createGrill(), label: 'grill' }]],
  // the practice facility: substation, fence and drill kit
  substationBay: ['facility', () => [{ o: ART.createSubstationBay(), label: 'substation bay', w: 8, d: 7, ref: true }]],
  substationWires: ['facility', () => {
    // three phases over two spans, hung off nothing, so the sag is easy to judge on its own
    const runs = [0, 1, 2].map((k) => [-1, 0, 1].map((i) => [i * 7, 7.5, (k - 1) * 1.8]));
    return [{ o: ART.createSubstationWires(runs, { sag: 0.07 }), label: 'wires', w: 16, d: 6 }];
  }],
  substationRow: ['facility', () => {
    const group = new THREE.Group(), parts = [], tops = [];
    for (let i = 0; i < 3; i++) {
      const bay = ART.createSubstationBay({ w: 6, d: 4, seed: i + 1 });
      bay.group.position.x = (i - 1) * 6.3;
      group.add(bay.group); parts.push(bay);
      tops.push(bay.anchors.wireTops.map((p) => [p.x + bay.group.position.x, p.y, p.z]));
    }
    // one cable run per phase, strung across all three bays, all on one mesh
    const wires = ART.createSubstationWires([0, 1, 2].map((k) => tops.map((t) => t[k])), { sag: 0.07 });
    group.add(wires.group); parts.push(wires);
    const fence = ART.createSubstationFence({ length: 20 });
    fence.group.position.z = 3.6;
    group.add(fence.group); parts.push(fence);
    const o = {
      group,
      update: (dt, t) => { for (const p of parts) if (p.update) p.update(dt, t); },
      dispose: () => { for (const p of parts) p.dispose(); },
    };
    return [{ o, label: 'row + wires + fence', w: 24, d: 12, ref: true }];
  }],
  pylon: ['facility', () => [10, 16].map((h) => ({ o: ART.createPylon({ height: h }), label: 'pylon ' + h, w: 8, d: 6 }))],
  substationFence: ['facility', () => [{ o: ART.createSubstationFence({ length: 16 }), label: 'fence', w: 18, d: 3, ref: true }]],
  ballMachine: ['facility', () => [{ o: ART.createBallMachine(), label: 'ball machine', w: 2.6, d: 2.6, ref: true }]],
  // the champion's lawn
  championTrophy: ['champion', () => [0xf2c93f, col(3)].map((c, i) => ({
    o: ART.createChampionTrophy({ color: c }), label: i ? 'trophy (team colour)' : 'trophy', w: 2.6, d: 2.6, ref: i === 0,
  }))],
  trophyPlaque: ['champion', () => {
    // how the world dresses it: a canvas plaque at anchors.plaque, sized plaqueSize
    const tr = ART.createChampionTrophy();
    const pl = ART.createPlaque(textCanvas(['CHAMPION 2025'], 512, 176, '#2a2116', '#f5c542'), { width: tr.plaqueSize.w });
    pl.group.position.copy(tr.anchors.plaque);
    tr.group.add(pl.group);
    const o = { group: tr.group, dispose: () => { tr.dispose(); pl.dispose(); } };
    return [{ o, label: 'trophy + plaque', w: 2.6, d: 2.6 }];
  }],
  bannerMast: ['champion', () => [{ o: ART.createBannerMast(), label: 'banner mast', w: 3, d: 3, ref: true }]],
  bannerMastHung: ['champion', () => {
    // the world's half of the deal: a plane hung at anchors.bannerTop, sized anchors.bannerSize
    const mast = ART.createBannerMast();
    const { bannerTop, bannerSize } = mast.anchors;
    const tex = new THREE.CanvasTexture(textCanvas(['LEAGUE', 'CHAMPION', '2025'], 320, 640, '#18213f', '#f5c542'));
    tex.colorSpace = THREE.SRGBColorSpace;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(bannerSize.w, bannerSize.h), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    cloth.position.set(bannerTop.x, bannerTop.y - bannerSize.h / 2, bannerTop.z);
    mast.group.add(cloth);
    const o = { group: mast.group, dispose: () => { mast.dispose(); cloth.geometry.dispose(); cloth.material.dispose(); tex.dispose(); } };
    return [{ o, label: 'mast + hung banner', w: 3.4, d: 3, ref: true }];
  }],
  confetti: ['champion', () => [null, col(9)].map((c, i) => {
    const fx = ART.createConfetti({ color: c });
    let wait = i * 0.8;
    fx.burst(0, 1.0, 0);
    const o = {
      group: fx.group,
      update: (dt, t) => {
        fx.update(dt, t);
        if (fx.busy) return;
        wait -= dt;
        if (wait <= 0) { fx.burst(0, 1.0, 0); wait = 1.4; }
      },
      burst: (x, y, z) => fx.burst(x, y, z),       // so a screenshot script can time a burst
      get busy() { return fx.busy; },
      dispose: () => fx.dispose(),
    };
    return { o, label: i ? 'confetti (team colour)' : 'confetti', w: 5.4, d: 5.4 };
  })],
  // the Supreme Commissioner
  leaderStatue: ['regime', () => [{ o: ART.createLeaderStatue(), label: 'leader statue', w: 12, d: 7, ref: true }]],
  leaderBust: ['regime', () => [false, true].map((w) => ({ o: ART.createLeaderBust({ weathered: w }), label: w ? 'bust (weathered)' : 'leader bust', w: 2.8, d: 2.8 }))],
  loudspeaker: ['regime', () => [{ o: ART.createLoudspeaker(), label: 'loudspeaker', w: 3, d: 3 }]],
  // characters and vehicles
  avatar: ['characters', () => ['idle', 'walk', 'run', 'sit', 'wave', 'grill', 'pace', 'shiver', 'cheer', 'lounge'].map((a, i) => {
    const o = ART.createAvatar({ color: col(i), number: [1, 7, 12, 23, 34, 45, 56, 69, 88, 99][i], accessory: [null, 'cap', null, 'crown', 'visor', 'cap', null, 'bag', 'crown', 'visor'][i] });
    o.setAnim(a); if (o.setSpeed) o.setSpeed(a === 'run' ? 5 : 1.6);
    return { o, label: a, w: 1.8 };
  })],
  avatarBack: ['characters', () => [0, 1, 2].map((i) => {
    const o = ART.createAvatar({ color: col(i * 4 + 2), number: [8, 21, 77][i], accessory: [null, 'cap', 'bag'][i] });
    o.group.rotation.y = Math.PI;
    return { o, label: 'back', w: 1.8 };
  })],
  garbageTruck: ['characters', () => [0, 1].map((tilt) => {
    const o = ART.createGarbageTruck(); o.setBedTilt(tilt); o.setSpeed(tilt ? 0 : 3);
    const t = new THREE.CanvasTexture(textCanvas(['WAIVER WIRE', 'SANITATION'], 512, 256, '#f3eedd', '#14553c'));
    t.colorSpace = THREE.SRGBColorSpace; o.sidePanel.material.map = t; o.sidePanel.material.needsUpdate = true;
    o.group.rotation.y = Math.PI / 2;
    return { o, label: 'garbage truck' + (tilt ? ' tilted' : ''), w: 10, ref: true };
  })],
  critters: ['characters', () => ['raccoon', 'seagull', 'dog', 'pigeon', 'fly'].map((k) => ({ o: ART.createCritters(k, { count: k === 'fly' ? 10 : 5, radius: 3, seed: 3 }), label: k, w: 8, d: 8 }))],
  // how to seat an avatar: put it at anchors.seat and drop it by avatar.sitOffset
  seated: ['characters', () => {
    const mk = (prop, anim, acc, colorIdx) => {
      const a = ART.createAvatar({ color: col(colorIdx), number: 1, accessory: acc });
      a.setAnim(anim);
      const seat = prop.anchors.seat;
      a.group.position.set(seat.x, seat.y - a.sitOffset, seat.z);
      prop.group.add(a.group);
      const update = prop.update;
      prop.update = (dt, t) => { if (update) update(dt, t); a.update(dt, t); };
      return prop;
    };
    return [
      { o: mk(ART.createThrone(), 'sit', 'crown', 6), label: 'throne + sit', w: 4 },
      { o: mk(ART.createLawnChair(), 'sit', 'cap', 1), label: 'chair + sit', w: 2.4 },
      { o: mk(ART.createLawnChair(), 'lounge', 'visor', 9), label: 'chair + lounge', w: 2.4 },
    ];
  }],
  raccoon: ['critter', () => [{ o: ART.createCritters('raccoon', { count: 4, radius: 1.6, seed: 2 }), label: 'raccoon', w: 5, d: 5 }]],
  dog: ['critter', () => [{ o: ART.createCritters('dog', { count: 3, radius: 1.6, seed: 2 }), label: 'dog', w: 5, d: 5 }]],
  pigeon: ['critter', () => [{ o: ART.createCritters('pigeon', { count: 5, radius: 1.2, seed: 2 }), label: 'pigeon', w: 4, d: 4 }]],
  seagull: ['critter', () => [{ o: ART.createCritters('seagull', { count: 4, radius: 3, seed: 2 }), label: 'seagull', w: 8, d: 8 }]],
  fly: ['critter', () => [{ o: ART.createCritters('fly', { count: 8, radius: 0.6, seed: 2 }), label: 'fly', w: 3, d: 3 }]],
};

const NEEDS = {
  hill: 'createHome', heights: 'createHome', bubble: 'createHome', park: 'createHome', dump: 'createHome',
  avatarBack: 'createAvatar', seated: 'createAvatar', raccoon: 'createCritters', dog: 'createCritters', pigeon: 'createCritters', seagull: 'createCritters', fly: 'createCritters',
  substationRow: 'createSubstationBay',
  trophyPlaque: 'createChampionTrophy', bannerMastHung: 'createBannerMast',
};
const fnOf = (name) => NEEDS[name] || 'create' + name[0].toUpperCase() + name.slice(1);

let names;
if (show === 'all') names = Object.keys(ITEMS);
else if (['homes', 'reactive', 'setpieces', 'characters', 'regime', 'facility', 'champion'].includes(show)) names = Object.keys(ITEMS).filter((n) => ITEMS[n][0] === show);
else names = show.split(',').filter((n) => ITEMS[n]);
if (q.get('only')) names = names.filter((n) => q.get('only').split(',').includes(n));

const entries = [];
const missing = [];
for (const name of names) {
  if (!has(fnOf(name))) { missing.push(name); continue; }
  try {
    for (const e of ITEMS[name][1]()) { e.item = name; entries.push(e); }
  } catch (err) {
    console.error('gallery: failed to build ' + name, err);
    missing.push(name + ' (error)');
  }
}

// ---- layout: rows along X, wrapping toward -Z ----------------------------------------------------
const box = new THREE.Box3(), size = new THREE.Vector3();
const maxRow = parseFloat(q.get('row') || ({ homes: 95, reactive: 30, setpieces: 60, characters: 24, facility: 60, champion: 24, all: 110 }[show] || 46));
let cx = 0, cz = 0, rowDepth = 0;
const rows = [[]];
for (const e of entries) {
  scene.add(e.o.group);
  e.o.group.updateMatrixWorld(true);
  box.setFromObject(e.o.group); box.getSize(size);
  const hinted = !!e.w;
  e.w = e.w || Math.max(1.6, Math.min(size.x + 1.2, 14));
  e.d = e.d || Math.max(1.6, Math.min(size.z + 1.2, hinted ? e.w * 1.4 : 14));
  e.h = Math.min(size.y, 16);
  if (cx > 0 && cx + e.w > maxRow) { rows.push([]); cz -= rowDepth + 2; cx = 0; rowDepth = 0; }
  e.x = cx + e.w / 2; e.z = cz - e.d / 2;
  cx += e.w + 1; rowDepth = Math.max(rowDepth, e.d);
  rows[rows.length - 1].push(e);
}
for (const row of rows) {
  if (!row.length) continue;
  const width = row[row.length - 1].x + row[row.length - 1].w / 2;
  for (const e of row) { e.x -= width / 2; }
}
const refs = [];
const porchStates = ['win', 'lose', 'neutral'];
entries.forEach((e, i) => {
  e.o.group.position.x += e.x; e.o.group.position.z += e.z; e.o.group.position.y += e.lift || 0;
  if (e.o.setNight) e.o.setNight(night ? 1 : 0);
  if (e.o.setPorchLight) e.o.setPorchLight(night ? porchStates[i % 3] : (q.get('porch') || 'off'));
  if (e.o.setOn) e.o.setOn(night || q.get('on') === '1');
  // a 1.7 m resident for scale
  if (wantRef && has('createAvatar') && (e.home || e.ref)) {
    const a = ART.createAvatar({ color: col(i + 3), number: 10 + i, accessory: e.label === 'hill' ? 'crown' : null });
    const p = e.home ? e.o.anchors.door : new THREE.Vector3(e.w / 2 - 0.6, 0, e.d / 2 - 0.6);
    a.group.position.set(e.o.group.position.x + p.x, p.y + (e.lift || 0), e.o.group.position.z + p.z);
    scene.add(a.group);
    refs.push(a);
    if (e.home && q.get('anchors') === '1') {
      for (const [k, v] of Object.entries(e.o.anchors)) {
        const list = Array.isArray(v) ? v : [v];
        list.forEach((p2) => {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: Array.isArray(v) ? 0xff00ff : 0xff3030 }));
          m.position.set(e.o.group.position.x + p2.x, p2.y, e.o.group.position.z + p2.z);
          scene.add(m);
        });
      }
      for (const c of e.o.colliders) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, 0.1, 10), new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 }));
        m.position.set(e.o.group.position.x + c.x, (e.o.groundHeight ? e.o.groundHeight(c.x, c.z) : 0) + 0.1, e.o.group.position.z + c.z);
        scene.add(m);
      }
    }
  }
});

// ---- per item numbers ----------------------------------------------------------------------------
function measure(group) {
  let calls = 0, tris = 0;
  group.traverse((n) => {
    if (!n.visible) return;
    if (n.isMesh || n.isPoints || n.isLine || n.isSprite) {
      calls++;
      const g = n.geometry;
      if (g && g.attributes && g.attributes.position) {
        const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
        tris += n.isInstancedMesh ? t * n.count : t;
      } else if (n.isSprite) tris += 2;
    }
  });
  return { calls, tris: Math.round(tris) };
}
const table = entries.map((e) => Object.assign({ name: e.label }, measure(e.o.group)));
// `props` is for driving a prop from a screenshot script (confetti.burst, setBedTilt and so on).
window.__gallery = { table, missing, entries: entries.length, props: entries.map((e) => e.o) };

// ---- camera ---------------------------------------------------------------------------------------
// frame the layout footprints, not the raw bounds (beams and halos reach for the sky)
const all = new THREE.Box3();
for (const e of entries) {
  all.expandByPoint(new THREE.Vector3(e.x - e.w / 2, 0, e.z - e.d / 2));
  all.expandByPoint(new THREE.Vector3(e.x + e.w / 2, e.h + (e.lift || 0), e.z + e.d / 2));
}
if (all.isEmpty()) all.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2, 2));
const center = all.getCenter(new THREE.Vector3()), ext = all.getSize(new THREE.Vector3());
const orbit = {
  az: (parseFloat(q.get('az') || 22) * Math.PI) / 180,
  el: (parseFloat(q.get('el') || 24) * Math.PI) / 180,
  dist: parseFloat(q.get('dist') || 0) || Math.max(5, Math.max(ext.x * 0.56, ext.y * 1.3, ext.z * 0.8) / Math.tan((camera.fov * Math.PI) / 360) * 0.6),
  target: new THREE.Vector3(q.has('cx') ? parseFloat(q.get('cx')) : center.x, q.has('cy') ? parseFloat(q.get('cy')) : Math.min(center.y, ext.y * 0.45), q.has('cz') ? parseFloat(q.get('cz')) : center.z),
};
function placeCamera() {
  const c = Math.cos(orbit.el);
  camera.position.set(orbit.target.x + Math.sin(orbit.az) * c * orbit.dist, orbit.target.y + Math.sin(orbit.el) * orbit.dist, orbit.target.z + Math.cos(orbit.az) * c * orbit.dist);
  camera.lookAt(orbit.target);
}
const pointers = new Map();
let pinch = 0;
canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, b: ev.button }); });
canvas.addEventListener('pointerup', (ev) => { pointers.delete(ev.pointerId); pinch = 0; });
canvas.addEventListener('pointercancel', (ev) => { pointers.delete(ev.pointerId); pinch = 0; });
canvas.addEventListener('pointermove', (ev) => {
  const p = pointers.get(ev.pointerId);
  if (!p) return;
  const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
  p.x = ev.clientX; p.y = ev.clientY;
  if (pointers.size === 1 && p.b !== 2) {
    orbit.az -= dx * 0.006;
    orbit.el = Math.max(-0.1, Math.min(1.5, orbit.el + dy * 0.005));
  } else {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const k = orbit.dist * 0.0012 / Math.max(1, pointers.size);
    orbit.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) orbit.dist *= pinch / d;
      pinch = d;
    }
  }
});
canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); orbit.dist *= Math.exp(ev.deltaY * 0.001); }, { passive: false });
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

// ---- hud -------------------------------------------------------------------------------------------
document.getElementById('what').textContent = show + (night ? ' (night)' : '') + (missing.length ? '  missing: ' + missing.join(', ') : '');
const nav = document.getElementById('nav');
const link = (label, params, alt) => {
  const a = document.createElement('a');
  const p = new URLSearchParams(location.search);
  for (const k of ['az', 'el', 'dist', 'cx', 'cy', 'cz', 'only']) p.delete(k);
  for (const [k, v] of Object.entries(params)) { if (v === null) p.delete(k); else p.set(k, v); }
  a.href = '?' + p.toString(); a.textContent = label; if (alt) a.className = 'alt';
  nav.appendChild(a);
};
for (const s of ['homes', 'reactive', 'setpieces', 'characters', 'regime', 'facility', 'champion', 'all']) link(s, { show: s });
link(night ? 'day' : 'night', { night: night ? null : '1' }, true);
const tableEl = document.getElementById('table');
tableEl.textContent = (table.length > 34 || q.get('table') === '0') ? '' : table.map((r) => `${r.name.padEnd(22)} ${String(r.calls).padStart(2)} calls ${String(r.tris).padStart(6)} tris`).join('\n');
const labelsEl = document.getElementById('labels');
const labelEls = wantLabels ? entries.map((e) => { const d = document.createElement('div'); d.className = 'label'; d.textContent = e.label; labelsEl.appendChild(d); return d; }) : [];
const statsEl = document.getElementById('stats');

// ---- loop -------------------------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
const v = new THREE.Vector3();
let last = performance.now(), time = fixedT === null ? 0 : fixedT, frame = 0;
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (fixedT === null) time += dt;
  for (const e of entries) if (e.o.update) e.o.update(fixedT === null ? dt : 1 / 60, time);
  for (const a of refs) a.update(fixedT === null ? dt : 1 / 60, time);
  placeCamera();
  renderer.render(scene, camera);
  if (frame++ % 20 === 0) {
    const calls = renderer.info.render.calls - 1, tris = renderer.info.render.triangles - 2;
    statsEl.textContent = `draw calls ${calls}   triangles ${tris.toLocaleString()}   (in view, ground excluded)`;
    window.__gallery.info = { calls, tris };
  }
  if (wantLabels) entries.forEach((e, i) => {
    v.set(e.o.group.position.x, 0, e.o.group.position.z + e.d / 2).project(camera);
    const el = labelEls[i];
    el.style.display = v.z < 1 ? 'block' : 'none';
    el.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    el.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight + 4) + 'px';
  });
  window.__gallery.ready = true;
  requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', () => { last = performance.now(); });
requestAnimationFrame(tick);
