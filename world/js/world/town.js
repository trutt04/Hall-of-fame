// The town: one home per team on its lot, with everything outside it that the standings earned.
//
//   const town = createTown(world)
//   town.apply(model)             builds or rebuilds whatever changed (re-entrant, safe to call often)
//   town.getHome(teamId)          -> HomeInfo | null        (Contract 7)
//   town.homes()                  -> [HomeInfo] in rank order, best first
//   town.entry(teamId)            -> internal record { team, lot, home, toWorld(localV3, out) }
//   town.special(name)            -> 'throne' | 'telescope' | 'periscope' | 'crown' | 'cloud' prop record or null
//   town.update(dt, t)            call once a frame
//
// A home is rebuilt only when its tier, slot or color changes; its reactive details (trash, signs,
// vehicles...) only when their own signature changes; its name tag only when rank or name changes.

import * as THREE from '../../lib/three.module.min.js';
import {
  createHome, createTrashPile, createGoalposts, createForSaleSign, createGoldenToilet, createSpotlight, createBlackCat,
  createHorseshoe, createFlamingos, createYardSign, createPlaque, createAmbulance, createMovingTruck,
  createCrown, createThrone, createTelescope, createPeriscope, createRainCloud,
} from '../art/index.js';
import { makeCanvas, drawNameTag, drawYardSign, drawPlaque } from './signs.js';

const TAG_NEAR = 46; // name tags fade in inside this distance
const DETAIL_FAR = 85; // small reactive props are hidden beyond this
const ANIM_FAR = 110; // homes stop animating (flags, TV flicker) beyond this

const VIEW = {
  hill: { back: 26, up: 15, side: 8, look: 7 },
  heights: { back: 15, up: 7, side: 5, look: 3 },
  bubble: { back: 14, up: 6.5, side: 4.5, look: 2.6 },
  park: { back: 12, up: 5, side: 4, look: 1.8 },
  dump: { back: 13, up: 8, side: 6, look: 3.4 },
};

function shortName(name, max = 24) {
  const chars = Array.from(String(name || ''));
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '…' : chars.join('');
}

export function createTown(w) {
  const { scene, layout, terrain, colliders, interact, store } = w;
  const group = new THREE.Group();
  group.name = 'town';
  scene.add(group);
  const entries = new Map();
  const specials = {};
  let model = null;
  let night = -1;
  let wasNight = null;
  const v = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  function lotOf(team) {
    const list = layout.lots[team.tier] || [];
    return list[team.slot] || list[list.length - 1] || null;
  }

  function makeToWorld(lot) {
    const c = Math.cos(lot.facing);
    const s = Math.sin(lot.facing);
    return (p, out = new THREE.Vector3()) => out.set(lot.x + p.x * c + p.z * s, lot.y + p.y, lot.z - p.x * s + p.z * c);
  }

  // ------------------------------------------------------------------ home info (Contract 7)
  function infoFor(e) {
    const { lot, home, team } = e;
    const door = e.toWorld(home.anchors.door);
    let ax = lot.street[0] - lot.x;
    let az = lot.street[1] - lot.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    const sx = lot.street[0] + ax * 1.6;
    const sz = lot.street[1] + az * 1.6;
    const V = VIEW[team.tier] || VIEW.bubble;
    const fx = Math.sin(lot.facing);
    const fz = Math.cos(lot.facing);
    const rx = Math.cos(lot.facing);
    const rz = -Math.sin(lot.facing);
    const half = (lot.r || lot.d / 2);
    const px = lot.x + fx * (half + V.back) + rx * V.side;
    const pz = lot.z + fz * (half + V.back) + rz * V.side;
    const py = Math.max(lot.y + V.up, terrain.heightAt(px, pz) + 2.2);
    const lookY = lot.y + V.look + (team.tier === 'dump' ? 2 : 0);
    return {
      teamId: team.id, rank: team.rank, tier: team.tier, x: lot.x, y: lot.y, z: lot.z, facing: lot.facing,
      door: { x: door.x, y: door.y, z: door.z },
      street: { x: sx, y: terrain.heightAt(sx, sz), z: sz, facing: Math.atan2(lot.x - sx, lot.z - sz) },
      view: { pos: [px, py, pz], look: [lot.x, lookY, lot.z] },
    };
  }

  // ------------------------------------------------------------------ name tags
  function makeTag(e) {
    const cv = makeCanvas(512, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
    sprite.name = 'nameTag';
    sprite.visible = false;
    sprite.renderOrder = 5;
    const roof = e.home.anchors.roof;
    const door = e.home.anchors.door;
    const lift = e.team.tier === 'dump' ? 2.2 : e.team.tier === 'hill' ? 1.6 : 1.5;
    e.toWorld(v.set(e.team.tier === 'hill' ? 0 : door.x * 0.4, roof.y + lift, e.team.tier === 'hill' ? 6 : roof.z), sprite.position);
    group.add(sprite);
    e.tag = { cv, tex, sprite, sig: '' };
  }

  function refreshTag(e) {
    const sig = e.team.rank + '|' + e.team.name + '|' + e.team.color;
    if (e.tag.sig === sig) return;
    e.tag.sig = sig;
    drawNameTag(e.tag.cv, e.team.rank, e.team.name, e.team.color);
    e.tag.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ reactive details
  function detailSig(t) {
    const n = t.history && t.history.nemesis;
    return JSON.stringify([
      t.trashBags, t.goalposts, t.ir ? t.ir.count : 0, t.tierMove, t.onCutLine, t.trophy && t.trophy.toilet, t.trophy && t.trophy.spotlight,
      t.luckTag, t.flamingos, t.roast && t.roast.sign, n ? [n.teamName, n.wins, n.losses] : null, model.meta.historyIsSample,
    ]);
  }

  function clearDetails(e) {
    for (const p of e.details) {
      if (p.group.parent) p.group.parent.remove(p.group);
      if (p.texture && p.texture.dispose) p.texture.dispose();
      p.dispose();
    }
    e.details = [];
    e.animated = [];
    if (e.detailGroup.parent) e.detailGroup.parent.remove(e.detailGroup);
    if (e.streetGroup.parent) e.streetGroup.parent.remove(e.streetGroup);
    e.detailGroup = new THREE.Group();
    e.detailGroup.name = 'details';
    e.home.group.add(e.detailGroup);
    e.streetGroup = new THREE.Group();
    e.streetGroup.name = 'street-' + e.team.id;
    group.add(e.streetGroup);
    colliders.removeGroup(e.tag2);
    interact.unregister('plaque:' + e.team.id);
  }

  function buildDetails(e) {
    clearDetails(e);
    const t = e.team;
    const A = e.home.anchors;
    const lot = e.lot;
    const local = (prop, pos, ry = 0) => {
      prop.group.position.copy(pos);
      prop.group.rotation.y += ry;
      e.detailGroup.add(prop.group);
      e.details.push(prop);
      if (prop.update) e.animated.push(prop);
      return prop;
    };
    // Vehicles stand on the street outside the lot, so they are placed in world space on the real ground.
    const street = (prop, localPos, w2, d2) => {
      e.toWorld(localPos, v);
      const y = terrain.heightAt(v.x, v.z);
      prop.group.position.set(v.x, y, v.z);
      prop.group.rotation.y = lot.facing + Math.PI / 2;
      e.streetGroup.add(prop.group);
      e.details.push(prop);
      if (prop.update) e.animated.push(prop);
      colliders.addBox(v.x, v.z, w2, d2, lot.facing + Math.PI / 2, e.tag2);
      return prop;
    };
    const P = (x, y, z) => new THREE.Vector3(x, y, z);

    if (t.trashBags > 0) local(createTrashPile(t.trashBags), A.lawn);
    if (t.flamingos > 0) local(createFlamingos(t.flamingos), t.trashBags > 0 ? P(A.lawn.x + (A.lawn.x < 0 ? 2.2 : -2.2), A.lawn.y, A.lawn.z - 1.8) : A.lawn);
    if (t.goalposts) local(createGoalposts(t.goalposts), A.goalposts);
    if (t.trophy && t.trophy.toilet) local(createGoldenToilet(), A.trophy);
    if (t.trophy && t.trophy.spotlight) local(createSpotlight(), t.trophy.toilet ? P(A.trophy.x, A.trophy.y, A.trophy.z - 1.8) : A.trophy);
    if (t.luckTag === 'unluckiest') local(createBlackCat(), A.roof);
    if (t.luckTag === 'luckiest') local(createHorseshoe(), P(A.door.x, A.door.y + 2.35, A.plaque.z + 0.02));
    if (t.roast && t.roast.sign) {
      const cv = drawYardSign(makeCanvas(384, 256), t.roast.sign);
      local(createYardSign(cv, { width: 1.5 }), A.sign, A.sign.x < A.door.x ? 0.22 : -0.22);
    }
    if (t.onCutLine) {
      const side = A.sign.x < A.door.x ? -1 : 1;
      local(createForSaleSign({ seed: t.id }), P(A.sign.x + side * 1.9, A.sign.y, A.sign.z + 0.5), side * -0.3);
    }
    const nem = t.history && t.history.nemesis;
    if (nem && nem.teamName) {
      const cv = drawPlaque(makeCanvas(512, 300), 'OWNED BY', nem.teamName, nem.wins + '-' + nem.losses + ' ALL TIME', !!model.meta.historyIsSample);
      local(createPlaque(cv, { width: 1.05 }), A.plaque);
      const at = e.toWorld(P(A.plaque.x, A.plaque.y - 1.5, A.plaque.z + 0.9));
      interact.register({
        id: 'plaque:' + t.id, position: at, radius: 1.9, label: 'Read the plaque', priority: 2,
        onUse: () => store.emit('use', { kind: 'plaque', teamId: t.id }),
      });
    }
    // street side: dump vehicles pull up inside the landfill, clear of the gate
    const dumpLot = t.tier === 'dump';
    const truckAt = dumpLot ? P(-7.2, 0, 8.4) : A.truck;
    if (t.tierMove) street(createMovingTruck(t.tierMove), truckAt, 2.4, 7.4);
    if (t.ir && t.ir.count > 0) {
      const side = truckAt.x <= A.curb.x ? 1 : -1;
      const at = dumpLot ? P(7.2, 0, 8.4) : P(A.curb.x + side * 5.2, 0, truckAt.z);
      street(createAmbulance(t.ir.count), at, 2.3, 5.4);
    }
    e.detailSig = detailSig(t);
  }

  // ------------------------------------------------------------------ specials on the Hill and at the Dump
  function addSpecial(e, name, prop, localPos, opts = {}) {
    prop.group.position.copy(localPos);
    if (opts.ry) prop.group.rotation.y = opts.ry;
    (opts.world ? group : e.home.group).add(prop.group);
    if (opts.world) {
      e.toWorld(localPos, prop.group.position);
      prop.group.rotation.y = e.lot.facing + (opts.ry || 0);
    }
    e.extras.push(prop);
    if (prop.update) e.extraAnimated.push(prop);
    for (const c of prop.colliders || []) {
      e.toWorld(v.set(localPos.x + c.x, 0, localPos.z + c.z), v);
      colliders.addCircle(v.x, v.z, c.r, e.tag1);
    }
    const anchor = (a) => (a ? e.toWorld(new THREE.Vector3(localPos.x + a.x, localPos.y + a.y, localPos.z + a.z)) : null);
    specials[name] = { prop, teamId: e.team.id, position: e.toWorld(localPos.clone()), anchor, entry: e };
    return specials[name];
  }

  function buildSpecials(e) {
    const A = e.home.anchors;
    if (e.team.tier === 'hill') {
      addSpecial(e, 'crown', createCrown(), A.crown, { world: true });
      addSpecial(e, 'throne', createThrone(), A.throne);
      addSpecial(e, 'telescope', createTelescope(), A.telescope);
    } else if (e.team.tier === 'dump') {
      const top = A.cloud;
      const height = 6.5;
      const cloud = createRainCloud({ radius: 4.6, height, seed: e.team.id });
      addSpecial(e, 'cloud', cloud, new THREE.Vector3(top.x, top.y - height, top.z));
      addSpecial(e, 'periscope', createPeriscope(), A.periscope);
    }
  }

  // ------------------------------------------------------------------ build / destroy one home
  function build(team, lot) {
    const home = createHome(team.tier, { color: team.color, seed: team.id });
    home.group.position.set(lot.x, lot.y, lot.z);
    home.group.rotation.y = lot.facing;
    home.group.name = 'home-' + team.id;
    group.add(home.group);
    const e = {
      team, lot, home, toWorld: makeToWorld(lot),
      sig: team.tier + '|' + team.slot + '|' + team.color,
      tag1: 'home:' + team.id, tag2: 'home:' + team.id + ':details',
      details: [], animated: [], extras: [], extraAnimated: [],
      detailGroup: new THREE.Group(), streetGroup: new THREE.Group(),
      detailSig: '', tag: null, bump: null, info: null, dist: 0,
    };
    if (home.footprint) colliders.addBox(lot.x, lot.z, home.footprint.w, home.footprint.d, lot.facing, e.tag1);
    for (const c of home.colliders || []) {
      e.toWorld(v.set(c.x, 0, c.z), v);
      colliders.addCircle(v.x, v.z, c.r, e.tag1);
    }
    if (team.tier === 'hill' || team.tier === 'dump') {
      const cs = Math.cos(lot.facing);
      const sn = Math.sin(lot.facing);
      e.bump = terrain.addGroundBump((x, z) => {
        const dx = x - lot.x;
        const dz = z - lot.z;
        return home.groundHeight(dx * cs - dz * sn, dx * sn + dz * cs);
      }, { x: lot.x, z: lot.z, r: (lot.r || Math.hypot(lot.w, lot.d) / 2) + 1, tag: e.tag1 });
    }
    makeTag(e);
    buildSpecials(e);
    // the mailbox and the door: "Visit <team>"
    const visit = () => store.emit('use', { kind: 'home', teamId: e.team.id });
    const mail = e.toWorld(home.anchors.mailbox.clone());
    const stand = e.toWorld(new THREE.Vector3(home.anchors.mailbox.x - 0.9, home.anchors.mailbox.y, home.anchors.mailbox.z + 0.2));
    interact.register({ id: 'home:' + team.id, position: stand, radius: 2.6, label: 'Visit', onUse: visit, object3D: home.group, mail });
    interact.register({ id: 'door:' + team.id, position: e.toWorld(home.anchors.door.clone()), radius: 2.2, label: 'Visit', onUse: visit, tappable: false });
    entries.set(team.id, e);
    return e;
  }

  function destroy(e) {
    clearDetails(e);
    if (e.detailGroup.parent) e.detailGroup.parent.remove(e.detailGroup);
    if (e.streetGroup.parent) e.streetGroup.parent.remove(e.streetGroup);
    for (const p of e.extras) {
      if (p.group.parent) p.group.parent.remove(p.group);
      p.dispose();
    }
    for (const name of Object.keys(specials)) if (specials[name].entry === e) delete specials[name];
    colliders.removeGroup(e.tag1);
    colliders.removeGroup(e.tag2);
    if (e.bump) terrain.removeGroundBump(e.bump);
    interact.unregister('home:' + e.team.id);
    interact.unregister('door:' + e.team.id);
    interact.unregister('plaque:' + e.team.id);
    if (e.tag) {
      group.remove(e.tag.sprite);
      e.tag.tex.dispose();
      e.tag.sprite.material.dispose();
    }
    group.remove(e.home.group);
    e.home.dispose();
    entries.delete(e.team.id);
  }

  function porch(e) {
    const tw = e.team.thisWeek;
    const state = tw && tw.winning === true ? 'win' : tw && tw.winning === false ? 'lose' : night > 0.4 ? 'neutral' : 'off';
    if (state !== e.porch) {
      e.porch = state;
      e.home.setPorchLight(state);
    }
  }

  // ------------------------------------------------------------------ apply the model
  function apply(next) {
    model = next;
    const seen = new Set();
    for (const id of model.order) {
      const team = model.teams[id];
      const lot = lotOf(team);
      if (!lot) continue;
      seen.add(team.id);
      let e = entries.get(team.id);
      const sig = team.tier + '|' + team.slot + '|' + team.color;
      if (e && e.sig !== sig) {
        destroy(e);
        e = null;
      }
      if (!e) e = build(team, lot);
      e.team = team;
      e.info = infoFor(e);
      const label = 'Visit ' + shortName(team.name);
      const a = interact.get('home:' + team.id);
      const b = interact.get('door:' + team.id);
      if (a) a.label = label;
      if (b) b.label = label;
      refreshTag(e);
      if (detailSig(team) !== e.detailSig) buildDetails(e);
      e.home.setNight(Math.max(0, night));
      porch(e);
    }
    for (const e of [...entries.values()]) if (!seen.has(e.team.id)) destroy(e);
  }

  // ------------------------------------------------------------------ per frame
  function update(dt, t) {
    const n = w.sky ? w.sky.nightAmount : 0;
    const nightChanged = Math.abs(n - night) > 0.02;
    if (nightChanged) night = n;
    const isNight = night > 0.4;
    camPos.copy(w.engine.camera.position);
    for (const e of entries.values()) {
      const dx = e.lot.x - camPos.x;
      const dz = e.lot.z - camPos.z;
      const d = Math.hypot(dx, dz) - (e.lot.r || e.lot.d / 2);
      e.dist = d;
      if (nightChanged) {
        e.home.setNight(night);
        for (const p of e.extras) if (p.setNight) p.setNight(night);
        for (const p of e.details) if (p.setNight) p.setNight(night);
      }
      if (isNight !== wasNight) porch(e);
      if (d < ANIM_FAR) e.home.update(dt, t);
      // extras (crown, cloud) are landmarks: they always animate
      for (let i = 0; i < e.extraAnimated.length; i++) e.extraAnimated[i].update(dt, t);
      const showDetails = d < DETAIL_FAR;
      if (e.detailGroup.visible !== showDetails) {
        e.detailGroup.visible = showDetails;
        e.streetGroup.visible = showDetails;
      }
      if (showDetails) for (let i = 0; i < e.animated.length; i++) e.animated[i].update(dt, t);
      // name tag: fades in when close, grows a little with distance so it stays readable
      const tag = e.tag;
      const td = tag.sprite.position.distanceTo(camPos);
      const want = td < TAG_NEAR && !w.hideTags ? 1 : 0;
      const m = tag.sprite.material;
      if (m.opacity !== want) m.opacity = Math.max(0, Math.min(1, m.opacity + (want ? 1 : -1) * dt * 3.5));
      tag.sprite.visible = m.opacity > 0.01;
      if (tag.sprite.visible) {
        const k = Math.max(1, Math.min(2.1, td / 20));
        tag.sprite.scale.set(6.6 * k, 1.65 * k, 1);
      }
    }
    wasNight = isNight;
  }

  return {
    group,
    apply,
    update,
    getHome(teamId) {
      const e = entries.get(Number(teamId));
      return e ? e.info : null;
    },
    homes() {
      return model ? model.order.map((id) => entries.get(id)).filter(Boolean).map((e) => e.info) : [];
    },
    entry(teamId) {
      return entries.get(Number(teamId)) || null;
    },
    entries() {
      return [...entries.values()];
    },
    special(name) {
      return specials[name] || null;
    },
    get model() { return model; },
    dispose() {
      for (const e of [...entries.values()]) destroy(e);
      scene.remove(group);
    },
  };
}
