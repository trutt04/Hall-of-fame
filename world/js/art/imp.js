// The Tiptoe Imp: the league mascot, lifted across from the old Hall of Fame page.
//
// The original is a pale faced, wild haired little gentleman in a dinner suit who does laps
// doing a dance, built there from about thirty separate meshes. That is fine on a page with one
// figure on it and far too expensive here, so everything that moves together is merged into one
// mesh. What is left is seven: the body, the portrait, two arms, two legs and the sparkle.
//
//   const imp = createImp({ faceTexture })
//   imp.update(dt, t)      drives the dance; call it every frame
//   imp.group              add this to a scene
//   imp.height             how tall he stands, in metres
//
// The face is a real photograph, passed in as a texture by the world side the same way the
// official portrait is, so this module stays pure geometry and loads nothing itself.

import * as THREE from '../../lib/three.module.min.js';
import { Geo } from './geo.js';
import { flatMat } from './materials.js';

// Straight from the old page, so he is recognisably the same fellow.
const SKIN = 0xf0c7b0;
const HAIR = 0xd8d0c2;
const HAIR_HI = 0xe9e1d4;
const SUIT = 0x11151d;
const SUIT_HI = 0x242a35;
const SHIRT = 0xf7f1e5;
const SHOE = 0x080a0e;
const GOLD = 0xf2c93f;

// The old page drew him about 2.43 units tall and then scaled by 1.45. Here he stands beside
// 1.7 metre people, and an imp who is taller than the neighbours is not an imp.
const NATURAL = 2.43;
const TARGET = 1.5;
const K = TARGET / NATURAL;

/**
 * @param o.scale        1 is about 1.5 m tall
 * @param o.faceTexture  a THREE.Texture of the portrait, or null for a plain face
 */
export function createImp(o = {}) {
  const scale = o.scale === undefined ? 1 : o.scale;
  const group = new THREE.Group();
  group.name = 'imp';
  // The root is where the world puts him. `rig` is what bounces, so a caller setting
  // group.position never has its value overwritten by the dance.
  const rig = new THREE.Group();
  group.add(rig);
  const body = new THREE.Group();
  rig.add(body);

  // ---- the torso, head and hair, all one mesh ----
  const g = new Geo();
  // oversized childlike head, with a tousled cap of hair rather than a helmet
  g.sphere(0, 1.66, 0, 0.47, SKIN, { seg: 10, rings: 7, sx: 1.06, sy: 1.04, sz: 0.94 });
  g.sphere(0, 1.93, -0.035, 0.5, HAIR, { seg: 10, rings: 5, sx: 1.02, sy: 0.62, sz: 0.98 });
  for (let h = 0; h < 11; h++) {
    const ang = (h / 11) * Math.PI * 2;
    const rr = 0.37 + 0.045 * Math.sin(h * 2.3);
    g.sphere(
      Math.cos(ang) * rr, 1.94 + Math.sin(h * 1.7) * 0.065, Math.sin(ang) * rr * 0.78,
      0.13 + (h % 3) * 0.014, h % 3 === 0 ? HAIR_HI : HAIR,
      { seg: 7, rings: 4, sx: 1.12, sy: 1.25, sz: 0.96 },
    );
  }
  // dinner suit: a tapered coat, a bright shirt front, lapels and a bow tie
  g.cyl(0, 0.57, 0, 0.31, 0.68, SUIT, { rt: 0.19, seg: 10, top: false });
  g.box(0, 0.655, 0.178, 0.16, 0.53, 0.035, SHIRT); // Geo boxes sit on y, so this is centre 0.92
  for (const side of [-1, 1]) {
    g.at(side * 0.105, 1.12, 0.195, 0, -0.12, side * 0.22);
    g.cone(0, -0.17, 0, 0.095, 0.34, SUIT_HI, { seg: 4 });
    g.restore();
    g.sphere(side * 0.07, 1.29, 0.215, 0.075, SHOE, { seg: 8, rings: 5, sx: 1, sy: 0.55, sz: 0.35 });
  }
  g.sphere(0, 1.29, 0.24, 0.035, GOLD, { seg: 7, rings: 4 });
  const torso = g.mesh(flatMat);
  torso.name = 'impBody';
  body.add(torso);

  // ---- the portrait, which is why anyone recognises him ----
  // An opaque cut out rather than a transparent plane: it sorts correctly against the houses,
  // where the original could afford to draw itself over everything on a page with no scenery.
  let face = null;
  if (o.faceTexture) {
    const mat = new THREE.MeshBasicMaterial({
      map: o.faceTexture, alphaTest: 0.25, side: THREE.DoubleSide, transparent: false,
    });
    face = new THREE.Mesh(new THREE.PlaneGeometry(1.88, 1.88), mat);
    face.position.set(0, 1.72, 0.545);
    face.renderOrder = 20;
    face.name = 'impFace';
    body.add(face);
  }

  // ---- arms, out wide, flapping ----
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.19, 1.15, 0);
    pivot.userData.s = side;
    body.add(pivot);
    const a = new Geo();
    a.at(side * 0.19, -0.11, 0, 0, 0, side * -0.72);
    a.cyl(0, -0.21, 0, 0.095, 0.42, SUIT, { rt: 0.075, seg: 7 });
    a.restore();
    a.at(side * 0.39, -0.24, 0.01, 0, 0, side * -0.58);
    a.cyl(0, -0.17, 0, 0.075, 0.34, SUIT_HI, { rt: 0.06, seg: 7 });
    a.restore();
    a.sphere(side * 0.52, -0.34, 0.025, 0.09, SKIN, { seg: 8, rings: 5 });
    const m = a.mesh(flatMat);
    m.name = 'impArm';
    pivot.add(m);
    arms.push(pivot);
  }

  // ---- legs, kicking independently, hung off the root so the torso can lean without them ----
  const legs = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.13, 0.62, 0);
    pivot.userData.s = side;
    rig.add(pivot);
    const l = new Geo();
    l.cyl(0, -0.37, 0, 0.095, 0.38, SUIT, { rt: 0.085, seg: 7 });
    l.cyl(0, -0.61, 0.015, 0.075, 0.28, SUIT_HI, { rt: 0.065, seg: 7 });
    l.at(0, -0.63, 0.12, 0, 0.08, 0);
    l.box(0, -0.06, 0, 0.23, 0.12, 0.38, SHOE); // bottom anchored, so drop it half a height
    l.restore();
    const m = l.mesh(flatMat);
    m.name = 'impLeg';
    pivot.add(m);
    legs.push(pivot);
  }

  // ---- the little stage sparkle that follows him around ----
  const sg = new Geo();
  sg.ico(0, 0, 0, 0.11, GOLD, { detail: 0 });
  const glint = sg.mesh(flatMat);
  glint.name = 'impGlint';
  glint.position.set(0, 2.12, 0);
  body.add(glint);

  group.scale.setScalar(K * scale);

  let beat = 0;
  const parts = [torso, glint].concat(arms.map((p) => p.children[0]), legs.map((p) => p.children[0]));
  const triCount = (m) => {
    const geo = m.geometry;
    return (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  };
  const triangles = parts.reduce((n, m) => n + triCount(m), 0) + (face ? 2 : 0);

  return {
    group,
    body,
    height: NATURAL * K * scale,
    radius: 0.55 * K * scale,
    colliders: [{ x: 0, z: 0, r: 0.4 * K * scale }],
    triangles,
    /** Drive the dance. `t` is world time in seconds. */
    update(dt, t) {
      beat = t * 5.2;
      for (const p of legs) {
        p.rotation.x = Math.sin(beat + (p.userData.s > 0 ? 0 : Math.PI)) * 0.92;
        p.rotation.z = p.userData.s * 0.12;
      }
      for (const p of arms) {
        p.rotation.z = p.userData.s * (0.18 + 0.22 * Math.sin(beat * 0.5 + p.userData.s));
        p.rotation.x = 0.18 * Math.cos(beat + p.userData.s);
      }
      body.rotation.z = Math.sin(beat * 0.5) * 0.12;
      body.rotation.x = -0.06;
      glint.rotation.y += dt * 2.2;
      glint.position.y = 2.12 + 0.08 * Math.sin(beat);
      // he bounces on the spot; whoever places him decides where "the spot" is
      rig.position.y = Math.abs(Math.sin(beat)) * 0.1;
    },
    dispose() {
      for (const m of parts) m.geometry.dispose();
      if (face) {
        face.geometry.dispose();
        face.material.dispose();
      }
    },
  };
}
