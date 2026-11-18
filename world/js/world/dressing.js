// Everything in the town that is not a home: the plaza (boards, statue, buildings, floodlights),
// the Heights fountain, the Bubble's playoff line, the trailer park's lights and barrel, the
// landfill's gulls and Outhouse Row, and the trees. Static pieces are built once; apply(model)
// only redraws or rebuilds what the data changed.
//
//   const dressing = createDressing(world)
//   dressing.apply(model)
//   dressing.setPlayerTeam(id | null)     highlights that team on the boards
//   dressing.update(dt, t)

import * as THREE from '../../lib/three.module.min.js';
import {
  Geo, flatMat, createFountain, createStreetlight, createBurningBarrel, createStatue, createNewspaperBox, createOuthouse, createTree,
  createBush, createTrashCan, createVelvetRope, createLawnChair, createBuilding, createBoardFrame, createFloodlight, createPlaque,
  createCritters,
} from '../art/index.js';
import { makeCanvas, drawSign, fit, wrap, hex, FONT_BODY, FONT_DISPLAY } from './signs.js';
import { boardTexture, drawStandings, drawMatchups, drawChampions } from './boards.js';

const ANIM_FAR = 80;
const SMALL_FAR = 70;

export function createDressing(w) {
  const { scene, layout, terrain, colliders, interact, store } = w;
  const P = layout.places;
  const st = layout.stations;
  const group = new THREE.Group();
  group.name = 'dressing';
  scene.add(group);

  const items = []; // { prop, x, z, small }
  const nightAware = [];
  const lights = { street: [], flood: [] };
  let model = null;
  let playerTeam = null;
  let night = -1;
  let boardClock = 0;
  const cam = new THREE.Vector3();
  const v = new THREE.Vector3();

  // The draft-bust cemetery: a 4 x 2 plot beside the Graveyard gate, on its Hall of Fame side.
  const GY = P.graveyard;
  const gyC = Math.cos(GY.facing);
  const gyS = Math.sin(GY.facing);
  const gyWorld = (lx, lz) => [GY.x + lx * gyC + lz * gyS, GY.z - lx * gyS + lz * gyC];
  const PLOT = (() => {
    const [x, z] = gyWorld(10.5, -1.9);
    return { x, z };
  })();

  // Place a prop on the ground, register its colliders, remember it for animation and culling.
  function put(prop, x, z, facing = 0, o = {}) {
    const y = o.y !== undefined ? o.y : terrain.heightAt(x, z);
    prop.group.position.set(x, y, z);
    prop.group.rotation.y = facing;
    (o.parent || group).add(prop.group);
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    const tag = o.tag || 'dressing';
    if (o.solid !== false) {
      if (prop.footprint) colliders.addBox(x, z, prop.footprint.w, prop.footprint.d, facing, tag);
      for (const col of prop.colliders || []) colliders.addCircle(x + col.x * c + col.z * s, z - col.x * s + col.z * c, col.r, tag);
    }
    const item = { prop, x, z, small: !!o.small };
    items.push(item);
    if (prop.setNight) nightAware.push(prop);
    return item;
  }
  // World position of a prop-local anchor.
  function anchorOf(prop, a, out = new THREE.Vector3()) {
    return out.copy(a).applyAxisAngle(THREE.Object3D.DEFAULT_UP, prop.group.rotation.y).add(prop.group.position);
  }
  function drop(item) {
    const i = items.indexOf(item);
    if (i >= 0) items.splice(i, 1);
    const n = nightAware.indexOf(item.prop);
    if (n >= 0) nightAware.splice(n, 1);
    if (item.prop.group.parent) item.prop.group.parent.remove(item.prop.group);
    item.prop.dispose();
  }
  function signPlane(cv, wd, ht) {
    const tex = boardTexture(cv);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wd, ht), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
    mesh.name = 'sign';
    return mesh;
  }
  const use = (payload) => () => store.emit('use', payload);

  // ------------------------------------------------------------------ plaza (static part)
  const boards = {};
  {
    const mk = (name, place, wd, ht, cw, ch, label, kind) => {
      const frame = createBoardFrame({ w: wd, h: ht });
      // the frame's legs grow with the screen: sink them so the bottom edge stays near eye level
      const sink = Math.max(0, Math.max(3.2, ht * 0.55) - 3.5);
      put(frame, place.x, place.z, place.facing, { y: terrain.heightAt(place.x, place.z) - sink });
      const cv = makeCanvas(cw, ch);
      const tex = boardTexture(cv);
      frame.screen.material.map = tex;
      frame.screen.material.needsUpdate = true;
      boards[name] = { frame, cv, tex, sig: '' };
      const at = new THREE.Vector3(place.x + Math.sin(place.facing) * 5.5, 0, place.z + Math.cos(place.facing) * 5.5);
      at.y = terrain.heightAt(at.x, at.z);
      interact.register({ id: 'board:' + name, position: at, radius: 5, label, onUse: use({ kind }), object3D: frame.screen });
    };
    mk('standings', P.standingsBoard, 24, 24.8, 1536, 1587, 'Standings', 'standings'); // about twice the size, with a sharper canvas to match
    mk('matchups', P.matchupBoard, 9, 6, 1024, 683, 'Matchups', 'matchups');

    const box = createNewspaperBox();
    put(box, P.newspaperBox.x, P.newspaperBox.z, P.newspaperBox.facing);
    interact.register({ id: 'newspaper', position: box.group.position.clone(), radius: 2.4, label: 'The paper', priority: 1, onUse: use({ kind: 'newspaper' }), object3D: box.group });

    const signs = { hof: 'HALL OF FAME', graveyard: 'MEMORIAL GARDENS', office: 'LEAGUE OFFICE' };
    for (const [kind, key] of [['hof', 'hallOfFame'], ['graveyard', 'graveyard'], ['office', 'leagueOffice']]) {
      const b = createBuilding(kind);
      const pl = P[key];
      put(b, pl.x, pl.z, pl.facing);
      if (b.anchors && b.anchors.sign && b.signSize) {
        const sg = signPlane(drawSign(signs[kind], b.signSize.w / b.signSize.h, { height: 96, border: false, bg: '#18213f' }), b.signSize.w, b.signSize.h);
        sg.position.copy(b.anchors.sign);
        sg.position.z += 0.02;
        b.group.add(sg);
      }
      const door = anchorOf(b, b.anchors.door);
      door.y = terrain.heightAt(door.x, door.z);
      interact.register({ id: 'building:' + kind, position: door, radius: 3.4, label: signs[kind].toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()), onUse: use({ kind: 'building', which: kind }), object3D: b.group });
    }

    for (const [x, z] of [[20.9, 14.6], [-24, 8.7], [-13.5, -21.5], [28.6, -15.2]]) {
      const f = createFloodlight();
      put(f, x, z, Math.atan2(-x, -z));
      f.setOn(false);
      lights.flood.push(f);
    }
    put(createCritters('pigeon', { count: 7, radius: 8, seed: 3 }), 6, 5, 0, { small: true, solid: false });
  }

  // ------------------------------------------------------------------ heights, park, dump (static part)
  put(createFountain(), P.fountain.x, P.fountain.z, 0);
  {
    const lane = st.laneZ;
    const xs = layout.lots.park.map((l) => l.x).sort((a, b) => a - b);
    const posts = xs.length ? xs.map((x) => x + 8.2) : [-10];
    posts.push((xs[0] ?? -20) - 8.2);
    posts.slice(0, 5).forEach((x, i) => {
      const lamp = createStreetlight({ flicker: i % 3 !== 1, seed: 5 + i });
      put(lamp, x, lane - 3.1, 0);
      lamp.setOn(false);
      lights.street.push(lamp);
    });
    const b = P.burningBarrel;
    put(createBurningBarrel(), b.x, b.z, 0);
    put(createLawnChair({}), b.x - 1.7, b.z + 0.6, Math.PI / 2 + 0.3, { small: true });
    put(createLawnChair({}), b.x + 1.5, b.z - 0.9, -Math.PI / 2 - 0.5, { small: true });
    put(createCritters('raccoon', { count: 3, radius: 6, seed: 2 }), b.x - 8, lane + 3, 0, { small: true, solid: false });
    put(createCritters('dog', { count: 2, radius: 6, seed: 4 }), b.x + 5, lane - 6, 0, { small: true, solid: false });
    for (const lot of layout.lots.park) {
      const fx = Math.sin(lot.facing);
      const fz = Math.cos(lot.facing);
      put(createTrashCan({ seed: lot.index + 1 }), lot.x - fz * 6.4 + fx * 5.4, lot.z + fx * 6.4 + fz * 5.4, lot.index, { small: true });
    }
    const d = st.dump;
    put(createCritters('seagull', { count: 7, radius: 15, seed: 6 }), d.x, d.z, 0, { y: d.y + 4, solid: false });
    put(createCritters('fly', { count: 10, radius: 3, seed: 8 }), d.x + 4, d.z - 7, 0, { small: true, solid: false });
    put(createCritters('raccoon', { count: 2, radius: 5, seed: 9 }), d.x - 14, d.z + 2, 0, { small: true, solid: false });
  }

  // ------------------------------------------------------------------ trees, bushes and cans: instanced per neighborhood
  {
    const kindFor = { hill: ['topiary', 'round'], heights: ['round', 'round'], plaza: ['round', 'pine'], bubble: ['round', 'round'], park: ['dead', 'dead'], dump: ['dead', 'dead'] };
    const buckets = new Map();
    const add = (key, make, p, scale) => {
      if (!buckets.has(key)) buckets.set(key, { make, list: [] });
      buckets.get(key).list.push({ p, scale });
    };
    // A dead tree behind every trailer, past the clothesline: the trailer park's own yard trees,
    // and where a roll of toilet paper lobbed over the roof comes down.
    const yardTrees = [];
    for (const lot of layout.lots.park || []) {
      const c = Math.cos(lot.facing);
      const sn = Math.sin(lot.facing);
      const lx = lot.index % 2 ? 3.6 : -3.9;
      const lz = -lot.d / 2 + 0.7;
      const x = lot.x + lx * c + lz * sn;
      const z = lot.z - lx * sn + lz * c;
      if (colliders.hits(x, z, 0.6)) continue;
      yardTrees.push({ x, z, y: terrain.heightAt(x, z), kind: 'tree', zone: 'park', scale: 1.05 + (lot.index % 3) * 0.08, rot: lot.index * 2.1 + 0.4, seed: 900 + lot.index });
    }
    terrain.scatterPoints.concat(yardTrees).forEach((p, i) => {
      if (Math.hypot(p.x - PLOT.x, p.z - PLOT.z) < 8.5) return; // the cemetery plot stays clear
      if (p.kind === 'tree') {
        const kind = kindFor[p.zone][i % 2];
        add(p.zone + ':' + kind, () => createTree(kind, { seed: 3 + (i % 2) }), p, p.scale * (kind === 'dead' ? 1 : 1.15));
        colliders.addCircle(p.x, p.z, 0.4 * p.scale, 'dressing');
      } else if (p.kind === 'bush') {
        add(p.zone + ':bush', () => createBush({ seed: 2 }), p, p.scale * (p.zone === 'hill' ? 1.2 : 1));
      } else {
        add(p.zone + ':can', () => createTrashCan({ seed: 4 }), p, 1);
        colliders.addCircle(p.x, p.z, 0.4, 'dressing');
      }
    });
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    for (const [key, b] of buckets) {
      const proto = b.make();
      const geo = proto.mesh.geometry;
      const mesh = new THREE.InstancedMesh(geo, flatMat, b.list.length);
      mesh.name = 'scatter-' + key;
      b.list.forEach((it, i) => {
        e.set(0, it.p.rot, 0);
        q.setFromEuler(e);
        sc.setScalar(it.scale);
        m4.compose(v.set(it.p.x, terrain.heightAt(it.p.x, it.p.z) - 0.03, it.p.z), q, sc);
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }

  // ------------------------------------------------------------------ data-driven pieces
  let statue = null;
  let statuePlaque = null;
  let outhouses = [];
  let outSig = null;
  let cutGroup = null;
  let cutSig = null;
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xff6a3d, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });

  function buildStatue() {
    const cond = (model.history && model.history.defendingChamp && model.history.defendingChamp.condition) || 'shiny';
    if (!statue || statue.prop.condition !== cond) {
      if (statue) {
        colliders.removeGroup('statue');
        drop(statue);
      }
      statue = put(createStatue(cond), P.statue.x, P.statue.z, P.statue.facing, { tag: 'statue' });
      statuePlaque = null;
      const at = new THREE.Vector3(P.statue.x + Math.sin(P.statue.facing) * 3.4, 0, P.statue.z + Math.cos(P.statue.facing) * 3.4);
      at.y = terrain.heightAt(at.x, at.z);
      interact.register({ id: 'statue', position: at, radius: 3.6, label: 'The statue', onUse: use({ kind: 'statue' }), object3D: statue.prop.group });
    }
    const S = statue.prop;
    const cv = drawChampions(makeCanvas(528, 288), model);
    if (statuePlaque) {
      S.group.remove(statuePlaque.group);
      if (statuePlaque.texture) statuePlaque.texture.dispose();
      statuePlaque.dispose();
    }
    statuePlaque = createPlaque(cv, { width: (S.plaqueSize ? S.plaqueSize.w : 2.2) - 0.25 });
    statuePlaque.group.position.copy(S.anchors.plaque);
    S.group.add(statuePlaque.group);
  }

  function buildOuthouses() {
    const list = ((model.history && model.history.lastPlaces) || []).slice(0, 7);
    const sig = JSON.stringify(list.map((l) => [l.season, l.teamName]));
    if (sig === outSig) return;
    outSig = sig;
    for (const o of outhouses) {
      interact.unregister('outhouse:' + o.season);
      drop(o.item);
    }
    colliders.removeGroup('outhouses');
    outhouses = [];
    const row = P.outhouseRow;
    list.forEach((lp, i) => {
      const z = row.z + (i - (list.length - 1) / 2) * 2.15;
      const prop = createOuthouse();
      const item = put(prop, row.x + (i % 2) * 0.25, z, row.facing + ((i * 37) % 9 - 4) * 0.012, { tag: 'outhouses', small: true });
      if (prop.anchors && prop.anchors.sign && prop.signSize) {
        const sg = signPlane(drawSign(lp.season + '  ' + lp.teamName, prop.signSize.w / prop.signSize.h, { height: 96, bg: '#efe6d0', color: '#2a2622', border: false, display: false }), prop.signSize.w, prop.signSize.h);
        sg.position.copy(prop.anchors.sign);
        sg.position.z += 0.012;
        prop.group.add(sg);
      }
      const door = anchorOf(prop, prop.anchors.door);
      door.y = terrain.heightAt(door.x, door.z);
      interact.register({ id: 'outhouse:' + lp.season, position: door, radius: 1.5, label: 'Last place, ' + lp.season, priority: 1, onUse: use({ kind: 'outhouse', season: lp.season }) });
      outhouses.push({ season: lp.season, item });
    });
  }

  // The painted playoff line through the cul-de-sac, between the last team in and the first team out.
  function buildCutLine() {
    const bubble = model.tiers.bubble || [];
    const inId = model.order[model.cutLine - 1];
    let idx = bubble.indexOf(inId);
    if (idx < 0) {
      const t = model.teams[inId];
      idx = t && (t.tier === 'hill' || t.tier === 'heights') ? -1 : bubble.length - 1;
    }
    const sig = bubble.length + '|' + idx;
    if (sig === cutSig) return;
    cutSig = sig;
    if (cutGroup) {
      group.remove(cutGroup);
      cutGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material !== lineMat && o.material !== flatMat) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      colliders.removeGroup('cutline');
    }
    cutGroup = new THREE.Group();
    cutGroup.name = 'playoffLine';
    group.add(cutGroup);
    if (!bubble.length) return;
    const cut = P.cutLine(idx);
    const dx = Math.cos(cut.angle);
    const dz = Math.sin(cut.angle);
    const y = cut.y + 0.17;
    // bold dashes from the far side of the bulb, through the middle, out between the two yards
    const pos = [];
    const dash = (x0, z0, x1, z1, half) => {
      const nx = -(z1 - z0);
      const nz = x1 - x0;
      const l = Math.hypot(nx, nz) || 1;
      const ox = (nx / l) * half;
      const oz = (nz / l) * half;
      pos.push(x0 - ox, y, z0 - oz, x0 + ox, y, z0 + oz, x1 + ox, y, z1 + oz, x0 - ox, y, z0 - oz, x1 + ox, y, z1 + oz, x1 - ox, y, z1 - oz);
      pos.push(x0 - ox, y, z0 - oz, x1 + ox, y, z1 + oz, x0 + ox, y, z0 + oz, x0 - ox, y, z0 - oz, x1 - ox, y, z1 - oz, x1 + ox, y, z1 + oz);
    };
    const R = P.culdesac.r;
    const aligned = dx > 0.97; // the line runs straight down the middle of the spur
    const from = aligned ? -(R + 19.4) : -R + 0.6;
    for (let d = from; d < R + 3.2; d += 2.1) dash(cut.a[0] + dx * d, cut.a[1] + dz * d, cut.a[0] + dx * Math.min(R + 3.4, d + 1.4), cut.a[1] + dz * Math.min(R + 3.4, d + 1.4), 0.3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const line = new THREE.Mesh(geo, lineMat);
    line.renderOrder = 2;
    cutGroup.add(line);
    // ground lettering on the playoff side, readable walking in from the Boulevard
    const cv = makeCanvas(1024, 224);
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 1024, 224);
    g.font = '150px Bungee, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 22;
    g.strokeStyle = '#ff6a3d';
    g.strokeText('PLAYOFF LINE', 512, 120, 980);
    g.fillStyle = '#ffffff';
    g.fillText('PLAYOFF LINE', 512, 120, 980);
    const tex = boardTexture(cv);
    const paint = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    const letter = (wd, ht, cx, cz, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wd, ht), paint);
      m.rotation.order = 'YXZ';
      m.rotation.set(-Math.PI / 2, ry, 0);
      m.position.set(cx, y + 0.01, cz);
      m.renderOrder = 2;
      cutGroup.add(m);
    };
    // across the playoff half of the bulb: upright for anyone walking in along the line
    const half = Math.min(R - 0.8, 10.4);
    letter(half, half * 0.22, cut.a[0] - dx * 3.4 + cut.inSide[0] * (half / 2 + 0.5), cut.a[1] - dz * 3.4 + cut.inSide[1] * (half / 2 + 0.5), -cut.angle - Math.PI / 2);
    // along the playoff side of the line: upright from uphill, where the Boulevard comes down
    if (aligned) {
      letter(12.8, 2.8, cut.a[0] - dx * (R + 9.5) + cut.inSide[0] * 1.9, cut.a[1] - dz * (R + 9.5) + cut.inSide[1] * 1.9, Math.PI - cut.angle);
      // and right across the mouth of the street: the first thing anyone walking in sees
      letter(6.6, 1.45, cut.a[0] - dx * (R + 21.2), cut.a[1] - dz * (R + 21.2), -cut.angle - Math.PI / 2);
    }
    else letter(9, 2, cut.a[0] + dx * 1.5 + cut.inSide[0] * 1.6, cut.a[1] + dz * 1.5 + cut.inSide[1] * 1.6, Math.PI - cut.angle);
    // velvet rope: this side is the guest list
    const rope = createVelvetRope(4.4);
    const rx = cut.curb[0] + dx * 2.6 + cut.inSide[0] * 1.3;
    const rz = cut.curb[1] + dz * 2.6 + cut.inSide[1] * 1.3;
    rope.group.position.set(rx, terrain.heightAt(rx, rz), rz);
    rope.group.rotation.y = -cut.angle;
    cutGroup.add(rope.group);
    const c = Math.cos(-cut.angle);
    const s = Math.sin(-cut.angle);
    for (const col of rope.colliders || []) colliders.addCircle(rx + col.x * c + col.z * s, rz - col.x * s + col.z * c, col.r, 'cutline');
  }

  // ------------------------------------------------------------------ draft-bust headstones
  // One merged mesh for the stones, one quad mesh for the engravings (a single canvas atlas), and
  // invisible pick boxes so a tap on a stone means that stone. Rebuilt only when the list changes.
  let graves = null;
  function clearGraves() {
    if (!graves) return;
    for (const id of graves.ids) interact.unregister(id);
    colliders.removeGroup('headstones');
    group.remove(graves.group);
    for (const d of graves.own) d.dispose();
    graves = null;
  }

  function drawEngraving(g, x0, y0, S, entry, color) {
    g.fillStyle = '#b9bec6';
    g.fillRect(x0, y0, S, S);
    g.strokeStyle = 'rgba(40,44,54,0.35)';
    g.lineWidth = 4;
    g.strokeRect(x0 + 8, y0 + 8, S - 16, S - 16);
    g.fillStyle = hex(color);
    g.fillRect(x0 + 18, y0 + 18, S - 36, 22);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#3d424c';
    g.font = `24px ${FONT_DISPLAY}`;
    g.fillText('R.I.P.', x0 + S / 2, y0 + 64);
    g.fillStyle = '#20242c';
    let size = 44;
    let lines = [];
    for (; size >= 26; size -= 4) {
      g.font = `700 ${size}px ${FONT_BODY}`;
      lines = wrap(g, entry.name || 'Unknown', S - 40, 2);
      if (Math.max(...lines.map((l) => g.measureText(l).width)) <= S - 36) break;
    }
    lines = lines.map((l) => fit(g, l, S - 36, size, 20, FONT_BODY, '700'));
    g.font = `700 ${size}px ${FONT_BODY}`;
    lines.forEach((l, i) => g.fillText(l, x0 + S / 2, y0 + 126 + (i - (lines.length - 1) / 2) * size * 1.02));
    g.fillStyle = '#3d424c';
    g.fillText(fit(g, entry.drafted || '', S - 40, 26, 16, FONT_BODY, '600'), x0 + S / 2, y0 + 196);
    g.fillText(fit(g, entry.cause === 'ir' ? 'Resting on IR' : 'Gone too soon', S - 40, 21, 14, FONT_BODY, '600'), x0 + S / 2, y0 + 228);
  }

  function buildHeadstones() {
    const list = (Array.isArray(model.graveyard) ? model.graveyard : []).slice(0, 8);
    const sig = JSON.stringify(list.map((e) => [e.teamId, e.name, e.drafted, e.cause, model.teams[e.teamId] ? model.teams[e.teamId].color : 0]));
    if (graves && graves.sig === sig) return;
    clearGraves();
    const g3 = new THREE.Group();
    g3.name = 'headstones';
    const own = [];
    const ids = [];
    graves = { sig, group: g3, own, ids };
    group.add(g3);
    if (!list.length) {
      // an empty plot is its own joke
      const [sx, sz] = gyWorld(8.2, 0.4);
      const y = terrain.heightAt(sx, sz);
      const tex = boardTexture(drawSign(['No burials this week.', 'Suspicious.'], 2.4, { height: 160, bg: '#23262e', color: '#e6ffd0', borderColor: '#8a93a0', display: false }));
      const side = new THREE.MeshLambertMaterial({ color: 0x23262e });
      const face = new THREE.MeshLambertMaterial({ map: tex });
      const boardGeo = new THREE.BoxGeometry(2.4, 1.0, 0.07);
      const postGeo = new THREE.BoxGeometry(0.12, 1.9, 0.12);
      const board = new THREE.Mesh(boardGeo, [side, side, side, side, face, face]);
      const post = new THREE.Mesh(postGeo, side);
      post.position.set(sx, y + 0.95, sz);
      board.position.set(sx, y + 1.75, sz);
      board.rotation.y = GY.facing;
      g3.add(post, board);
      colliders.addCircle(sx, sz, 0.25, 'headstones');
      own.push(tex, side, face, boardGeo, postGeo);
      return;
    }
    const stones = new Geo();
    const cv = makeCanvas(1024, 512);
    const g = cv.getContext('2d');
    const pos = [];
    const uv = [];
    const pickGeo = new THREE.BoxGeometry(1.3, 1.5, 0.5);
    const pickMat = new THREE.MeshBasicMaterial();
    own.push(pickGeo, pickMat);
    list.forEach((entry, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const [x, z] = gyWorld(7.2 + col * 2.25, -0.5 - row * 2.8 + ((i * 7) % 3) * 0.12);
      const y = terrain.heightAt(x, z);
      const yaw = GY.facing + (((i * 37) % 7) - 3) * 0.035;
      const shade = i % 2 ? 0xa7adb5 : 0x9aa0a9;
      stones.at(x, y - 0.03, z, yaw);
      stones.box(0, 0, 0, 1.45, 0.16, 0.55, 0x7f858e);
      stones.cloft(0, 0.16, 0, [[0, 1.16, 0.26, 0], [0.95, 1.16, 0.26, 0], [1.22, 0.96, 0.26, 0], [1.36, 0.5, 0.26, 0]], shade, { capTop: 0x8a9099 });
      stones.restore();
      // engraving quad on the face that looks at the plaza
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const at = (lx, ly) => [x + rx * lx + fx * 0.136, y + 0.13 + ly, z + rz * lx + fz * 0.136];
      const a = at(-0.5, 0.1);
      const b = at(0.5, 0.1);
      const c = at(0.5, 1.06);
      const d = at(-0.5, 1.06);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      const u0 = col / 4;
      const v1 = 1 - row / 2;
      uv.push(u0, v1 - 0.5, u0 + 0.25, v1 - 0.5, u0 + 0.25, v1, u0, v1 - 0.5, u0 + 0.25, v1, u0, v1);
      const team = model.teams[entry.teamId];
      drawEngraving(g, col * 256, row * 256, 256, entry, team ? team.color : 0x8a93a0);
      colliders.addCircle(x, z, 0.5, 'headstones');
      const pickBox = new THREE.Mesh(pickGeo, pickMat);
      pickBox.position.set(x, y + 0.85, z);
      pickBox.rotation.y = yaw;
      pickBox.visible = false; // never drawn, only there for taps
      g3.add(pickBox);
      const id = 'headstone:' + i;
      ids.push(id);
      interact.register({
        id, position: new THREE.Vector3(x + fx * 1.05, y, z + fz * 1.05), radius: 1.3, label: 'Read the headstone', priority: 1, object3D: pickBox,
        onUse: use({ kind: 'headstone', index: i }),
      });
    });
    const stoneMesh = stones.mesh(flatMat);
    stoneMesh.name = 'stones';
    g3.add(stoneMesh);
    own.push(stoneMesh.geometry);
    const tex = boardTexture(cv);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    eg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    eg.computeVertexNormals();
    const em = new THREE.MeshLambertMaterial({ map: tex });
    const engraving = new THREE.Mesh(eg, em);
    engraving.name = 'engravings';
    g3.add(engraving);
    own.push(tex, eg, em);
  }

  function redrawBoards(force) {
    const now = Date.now();
    const sSig = JSON.stringify([model.meta.week, model.meta.generatedAt, model.meta.isSample, playerTeam, model.order.map((id) => { const t = model.teams[id]; return [id, t.name, t.record.text, t.pointsFor, t.streak]; })]);
    if (force || boards.standings.sig !== sSig) {
      boards.standings.sig = sSig;
      drawStandings(boards.standings.cv, model, playerTeam);
      boards.standings.tex.needsUpdate = true;
    }
    const mSig = JSON.stringify([model.matchups, model.meta.weekStatus, model.meta.nflLive, playerTeam, Math.floor(now / 60000)]);
    if (force || boards.matchups.sig !== mSig) {
      boards.matchups.sig = mSig;
      drawMatchups(boards.matchups.cv, model, playerTeam, now);
      boards.matchups.tex.needsUpdate = true;
    }
  }

  function setLights() {
    const streetOn = night > 0.25;
    for (const l of lights.street) l.setOn(streetOn);
    const floodOn = night > 0.5 || !!(model && model.meta.nflLive);
    for (const f of lights.flood) f.setOn(floodOn);
  }

  function apply(next) {
    model = next;
    buildStatue();
    buildOuthouses();
    buildCutLine();
    buildHeadstones();
    redrawBoards(false);
    if (w.sky) w.sky.setGameDay({ live: !!model.meta.nflLive });
    setLights();
  }

  function update(dt, t) {
    const n = w.sky ? w.sky.nightAmount : 0;
    if (Math.abs(n - night) > 0.02) {
      night = n;
      for (const p of nightAware) p.setNight(night);
      setLights();
    }
    boardClock += dt;
    if (boardClock > 20 && model) {
      boardClock = 0;
      redrawBoards(false);
    }
    cam.copy(w.engine.camera.position);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const dx = it.x - cam.x;
      const dz = it.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (it.small) {
        const show = d2 < SMALL_FAR * SMALL_FAR;
        if (it.prop.group.visible !== show) it.prop.group.visible = show;
        if (!show) continue;
      }
      if (it.prop.update && d2 < ANIM_FAR * ANIM_FAR) it.prop.update(dt, t);
    }
  }

  return {
    group,
    apply,
    update,
    setPlayerTeam(id) {
      playerTeam = id;
      if (model) redrawBoards(false);
    },
    boards,
    get statue() { return statue ? statue.prop : null; },
    // where to stand to read the headstones: in front of the plot, facing it
    get plot() {
      const [x, z] = gyWorld(10.5, 5.2);
      return { x, z, facing: GY.facing + Math.PI };
    },
  };
}
