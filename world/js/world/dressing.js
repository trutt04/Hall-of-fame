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
  flatMat, createFountain, createStreetlight, createBurningBarrel, createStatue, createNewspaperBox, createOuthouse, createTree,
  createBush, createTrashCan, createVelvetRope, createLawnChair, createBuilding, createBoardFrame, createFloodlight, createPlaque,
  createCritters,
} from '../art/index.js';
import { makeCanvas, drawSign } from './signs.js';
import { boardTexture, drawStandings, drawMatchups, drawChampions } from './boards.js';

const ANIM_FAR = 80;
const SMALL_FAR = 95;

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
      put(frame, place.x, place.z, place.facing);
      const cv = makeCanvas(cw, ch);
      const tex = boardTexture(cv);
      frame.screen.material.map = tex;
      frame.screen.material.needsUpdate = true;
      boards[name] = { frame, cv, tex, sig: '' };
      const at = new THREE.Vector3(place.x + Math.sin(place.facing) * 5.5, 0, place.z + Math.cos(place.facing) * 5.5);
      at.y = terrain.heightAt(at.x, at.z);
      interact.register({ id: 'board:' + name, position: at, radius: 5, label, onUse: use({ kind }), object3D: frame.screen });
    };
    mk('standings', P.standingsBoard, 8.4, 8.6, 1000, 1024, 'Read the standings', 'standings');
    mk('matchups', P.matchupBoard, 8.4, 5.6, 1024, 683, 'Check the matchups', 'matchups');

    const box = createNewspaperBox();
    put(box, P.newspaperBox.x, P.newspaperBox.z, P.newspaperBox.facing);
    interact.register({ id: 'newspaper', position: box.group.position.clone(), radius: 2.4, label: 'Read the paper', priority: 1, onUse: use({ kind: 'newspaper' }), object3D: box.group });

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
      interact.register({ id: 'building:' + kind, position: door, radius: 3.4, label: 'Visit the ' + signs[kind].toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()), onUse: use({ kind: 'building', which: kind }), object3D: b.group });
    }

    for (const [x, z] of [[20.9, 14.6], [-24, 8.7], [-13.5, -21.5], [20.9, -14.6]]) {
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
    terrain.scatterPoints.forEach((p, i) => {
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
      interact.register({ id: 'statue', position: at, radius: 3.6, label: 'Look at the statue', onUse: use({ kind: 'statue' }), object3D: statue.prop.group });
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
      const item = put(prop, row.x + (i % 2) * 0.25, z, row.facing + ((i * 37) % 9 - 4) * 0.012, { tag: 'outhouses' });
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
    for (let d = -R + 0.6; d < R + 3.2; d += 1.9) dash(cut.a[0] + dx * d, cut.a[1] + dz * d, cut.a[0] + dx * Math.min(R + 3.4, d + 1.25), cut.a[1] + dz * Math.min(R + 3.4, d + 1.25), 0.24);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const line = new THREE.Mesh(geo, lineMat);
    line.renderOrder = 2;
    cutGroup.add(line);
    // ground lettering on the playoff side, readable walking in from the Boulevard
    const cv = makeCanvas(640, 128);
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 640, 128);
    g.font = '86px Bungee, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ff6a3d';
    g.fillText('PLAYOFF LINE', 320, 68, 620);
    const tex = boardTexture(cv);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 1.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    label.rotation.set(-Math.PI / 2, 0, -cut.angle + (dx < -0.2 ? Math.PI : 0));
    label.position.set(cut.a[0] + dx * 1.2 + cut.inSide[0] * 1.5, y + 0.01, cut.a[1] + dz * 1.2 + cut.inSide[1] * 1.5);
    label.renderOrder = 2;
    cutGroup.add(label);
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
  };
}
