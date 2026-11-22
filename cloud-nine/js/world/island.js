// Cloud Nine: the floating sky island. Builds the whole world below the sky: the lawns and the
// rock mountain under them, the plaza with the birthday cake, the cheer gym, the Hit Zero stage,
// the hide-and-seek garden, the dodgeball court, the Capture the Bow field, the freeze tag lawn,
// the basket-toss headland with its cloud platforms and rainbow slides, the rainbow bridge to the
// bow boutique isle, glitter waterfalls, butterflies, birds and balloons.
//
//   const island = buildIsland({ scene, quality, colliders })
//   island.groundAt(x, z)        y of the walkable surface, or -Infinity over open sky (fast)
//   island.platforms             [{ id, x, z, y, r }] cloud platforms (toss targets)
//   island.places                Contract 1 places (plus extras: cake, fountain, isle, boutique,
//                                bridge, waterfalls, secrets, treasures)
//   island.update(dt, t, { camera, playerPos })
//   island.setBirthday({ isBirthday, age, name })
//   island.dispose()
//
//   spotFor(where) -> { x, y, z, place, treasure? } | null      (a module export; island.spotFor too)
//     Turns a content `where` ({ place, index?, spot? }, see js/content/collectibles.js) into a spot
//     on walkable ground, clear of colliders: 'plaza' (round the back of the cake), 'gym' (behind
//     it), 'stage' (by the judges' table), 'tossPads' + index + spot 'target' (on that pad's cloud),
//     'slides' + index + spot 'bottom' (just past its end), 'hideGarden', 'court' (on the midline),
//     'bowField' (beside a base), 'tagZone', 'photoBooth', 'fountain', 'isle', 'bridge', and 'edge'
//     (index picks one of four scenic rim spots). The same answer on every device.
//     treasure: 'spiritStick' when the spot is the highest cloud's own spirit stick (hide it with
//     setTreasureVisible('spiritStick', false) if a collectible stands there instead).
//
// Extras, not in the contract (safe to ignore):
//   island.onFirework(fn({ x, y, z }))  every birthday firework burst
//   island.setTreasureVisible(id, on)   hide a platform treasure once it is collected
//                                       ids: 'poms' (cloud1), 'trophy' (cloud2), 'spiritStick' (cloud3)
//   island.bounds                       { minX, maxX, minZ, maxZ } round everything walkable
//   island.stats                        { triangles, meshes, colliders }
//   island.group                        the root Object3D
//
// Plan and heights live in js/art/island-layout.js (pure, runs under node --test); furniture and
// colliders in js/art/island-decor.js (pure); the drawing in js/art/island-*.js.

import * as THREE from '../../lib/three.module.min.js';
import { makeIslandPlan } from '../art/island-layout.js';
import { planDecor, spotFor as spotIn } from '../art/island-decor.js';
import { buildGround } from '../art/island-ground.js';
import { createBatch } from '../art/island-kit.js';
import { drawPlaces } from '../art/island-places.js';
import { drawSkyway } from '../art/island-skyway.js';
import { createLife } from '../art/island-life.js';
import { createCakeCorner } from '../art/island-cake.js';
import { flatMat, glowMat, makeAddMaterial } from '../art/materials.js';
import { motion } from '../art/util.js';

const TAG = 'island';

// The plan is deterministic, so a spot asked for before (or without) a built island is the same.
let shared = null;
export function spotFor(where) {
  if (!shared) {
    const plan = makeIslandPlan();
    shared = { plan, decor: planDecor(plan) };
  }
  return spotIn(shared.plan, shared.decor, where);
}

export function buildIsland({ scene, quality = 'high', colliders = null } = {}) {
  const q = quality === 'low' ? 'low' : 'high';
  const plan = makeIslandPlan();
  const decor = planDecor(plan, { quality: q });
  const group = new THREE.Group();
  group.name = 'island';
  if (scene) scene.add(group);
  const own = [];
  const groundAt = plan.ground.groundAt;

  // ---------------------------------------------------------------- ground, places, skyway
  const ground = buildGround(plan, { quality: q });
  group.add(ground.group);
  const batch = createBatch();
  const art = drawPlaces(plan, decor, batch, { yAt: groundAt, blob: ground.blob, quality: q });
  const sky = drawSkyway(plan, batch, { yAt: groundAt, blob: ground.blob, quality: q });
  // the moving things; their static parts (waterfall ponds, mist) draw into the batch too
  const life = createLife(plan, decor, { yAt: groundAt, quality: q, batch });
  ground.finishShadows();
  const addMat = makeAddMaterial(0xffffff, 0.85);
  own.push(addMat);
  const built = batch.build(group, own, { add: addMat });

  // ---------------------------------------------------------------- moving pieces
  // the Capture the Bow flags sway on their poles
  const flags = art.flags.map((f) => {
    const geo = f.geo.build();
    own.push(geo);
    const mesh = new THREE.Mesh(geo, flatMat);
    mesh.name = 'bowFlag' + f.team;
    const holder = new THREE.Group();
    holder.position.set(f.x, f.y, f.z);
    holder.rotation.y = f.facing;
    holder.add(mesh);
    group.add(holder);
    return { holder, mesh, base: f.facing, ph: f.team * 1.7 };
  });
  // treasures on the clouds: they turn slowly and bob
  const treasures = sky.treasures.map((tr) => {
    const holder = new THREE.Group();
    holder.name = 'treasure-' + tr.id;
    holder.position.set(tr.x, tr.y, tr.z);
    holder.rotation.y = tr.facing;
    const spin = new THREE.Group();
    holder.add(spin);
    for (const [g, mat, order] of [[tr.geo, flatMat, 0], [tr.glow, glowMat, 0], [tr.add, addMat, 3]]) {
      if (!g.tris) continue;
      const geo = g.build();
      own.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      spin.add(m);
    }
    group.add(holder);
    return { id: tr.id, platformId: tr.platformId, kind: tr.kind, holder, spin, x: tr.x, y: tr.y, z: tr.z, ph: tr.x * 0.1 };
  });
  plan.places.treasures = treasures.map((t) => ({ id: t.id, platformId: t.platformId, x: t.x, y: t.y, z: t.z }));

  // ---------------------------------------------------------------- the birthday corner
  const lampsRound = decor.props.filter((p) => p.type === 'lamp' && Math.hypot(p.x - plan.plazaC.x, p.z - plan.plazaC.z) < plan.plazaC.r + 2.5)
    .map((p) => ({ p, a: Math.atan2(p.x - plan.plazaC.x, -(p.z - plan.plazaC.z)) }))
    .sort((a, b) => a.a - b.a);
  const bunting = [];
  for (let i = 0; i < lampsRound.length; i++) {
    const a = lampsRound[i].p;
    const b = lampsRound[(i + 1) % lampsRound.length].p;
    if (Math.hypot(a.x - b.x, a.z - b.z) > 14) continue;
    bunting.push([a.x, groundAt(a.x, a.z) + 2.95, a.z, b.x, groundAt(b.x, b.z) + 2.95, b.z]);
  }
  const corner = createCakeCorner({
    x: plan.cake.x, z: plan.cake.z, quality: q,
    banner: { x0: -5.4, z0: -15.6, x1: 5.4, z1: -15.6, y: 6.2 },
    bunting,
  });
  group.add(corner.group);
  corner.set({ isBirthday: false, age: null, name: 'Bailey' });

  group.add(life.group);

  // ---------------------------------------------------------------- colliders
  if (colliders) {
    for (const c of decor.colliders) {
      if (c.kind === 'circle') colliders.addCircle(c.x, c.z, c.r, TAG);
      else colliders.addBox(c.x, c.z, c.w, c.d, c.rot || 0, TAG);
    }
  }

  // ---------------------------------------------------------------- per frame
  const camPos = new THREE.Vector3();
  function update(dt, t, ctx = {}) {
    const camera = ctx.camera || null;
    if (camera) camPos.copy(camera.position);
    const m = motion();
    ground.update(dt, t);
    life.update(dt, t, camera);
    corner.update(dt, t, camera);
    for (const f of flags) {
      f.holder.rotation.y = f.base + Math.sin(t * 0.9 + f.ph) * 0.35 * m;
      f.mesh.rotation.z = Math.sin(t * 1.7 + f.ph) * 0.06 * m;
      f.mesh.position.y = Math.sin(t * 1.3 + f.ph) * 0.12 * m;
    }
    for (const tr of treasures) {
      if (!tr.holder.visible) continue;
      tr.spin.rotation.y = t * 0.6 * (0.3 + 0.7 * m);
      tr.spin.position.y = 0.15 + Math.sin(t * 1.6 + tr.ph) * 0.12 * m;
    }
    addMat.opacity = 0.72 + 0.22 * Math.sin(t * 1.6) * m;
  }
  update(0, 0, {});

  const triangles = ground.triangles + built.triangles;
  // the box everything walkable fits in (the island, the isle and the clouds)
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = (x, z, r) => {
    bounds.minX = Math.min(bounds.minX, x - r);
    bounds.maxX = Math.max(bounds.maxX, x + r);
    bounds.minZ = Math.min(bounds.minZ, z - r);
    bounds.maxZ = Math.max(bounds.maxZ, z + r);
  };
  grow(plan.main.cx, plan.main.cz, plan.main.maxR);
  grow(plan.isle.x, plan.isle.z, plan.isleOutline.maxR);
  for (const p of plan.platforms) grow(p.x, p.z, p.r);
  return {
    group,
    groundAt,
    bounds,
    platforms: plan.platforms.map((p) => ({ id: p.id, x: p.x, z: p.z, y: p.y, r: p.r })),
    places: plan.places,
    update,
    setBirthday(info = {}) {
      corner.set(info || {});
    },
    // fn({ x, y, z }) for every birthday firework that bursts (for a pop of sound)
    onFirework(fn) {
      if (typeof fn === 'function' && typeof corner.onFirework === 'function') corner.onFirework(fn);
    },
    spotFor(where) {
      return spotIn(plan, decor, where);
    },
    setTreasureVisible(id, on) {
      const tr = treasures.find((x) => x.id === id);
      if (tr) tr.holder.visible = !!on;
    },
    get stats() {
      return { triangles, meshes: built.meshes.length, colliders: decor.colliders.length };
    },
    plan,
    decor,
    dispose() {
      if (colliders) colliders.removeGroup(TAG);
      life.dispose();
      corner.dispose();
      ground.dispose();
      for (const o of own) o.dispose();
      own.length = 0;
      if (group.parent) group.parent.remove(group);
    },
  };
}
