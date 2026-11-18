// The league mascot: the Tiptoe Imp does laps outside one owner's house, with the Hall of Fame
// page's own track playing from the same spot.
//
// Both of these came across from the old page by request. The imp is art/imp.js; the track is
// the very file that page plays, loaded straight from beside it rather than copied, and only
// once a visitor is close enough to hear it (see audio.loop).
//
//   const mascot = createMascot(world)
//   mascot.apply(model)     put him outside whoever MASCOT names; call again when the data moves
//   mascot.update(dt, t)    walk him round his circle
//
// Keyed on ownerKey, not team id, because ESPN hands a departing owner's team id to whoever
// replaces them. The imp follows the person, so he moves house as their record moves them.

import * as THREE from '../../lib/three.module.min.js';
import { MASCOT, PATHS } from '../config.js';
import * as ART from '../art/index.js';

const FAR = 70; // metres past which he is not drawn; he is small and there is no point
const LAP = 2.4; // radius of his lap, in metres: small enough to stay on open lawn
const SPEED = 0.55; // radians a second, so a lap takes about eleven seconds

function assetUrl(path) {
  const pv = typeof window !== 'undefined' ? window.__LW_PREVIEW : null;
  return (pv && pv.assets && pv.assets[path]) || path;
}

export function createMascot(w) {
  if (!MASCOT || (!MASCOT.ownerKey && !MASCOT.owner)) return null;
  const { scene, town, terrain, audio } = w;

  const group = new THREE.Group();
  group.name = 'mascot';
  group.visible = false;
  scene.add(group);

  let imp = null;
  let faceTexture = null;
  let loadingFace = false;
  let track = null; // the audio.loop handle, so a rebuild cannot leave two playing
  let here = null; // { x, z, y } where he is doing his laps
  let angle = 0;

  // The portrait is a real photograph, so it is loaded like the official portrait is: lazily,
  // and the imp is built either way if it never arrives.
  function wantFace(then) {
    if (faceTexture || loadingFace) return then(faceTexture);
    loadingFace = true;
    try {
      new THREE.TextureLoader().load(
        assetUrl(PATHS.impFace),
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          faceTexture = t;
          loadingFace = false;
          then(t);
        },
        undefined,
        () => {
          loadingFace = false;
          then(null);
        },
      );
    } catch (err) {
      loadingFace = false;
      then(null);
    }
  }

  function teamFor(model) {
    if (!model || !model.order) return null;
    for (const id of model.order) {
      const t = model.teams[id];
      if (!t) continue;
      if (MASCOT.ownerKey && t.ownerKey === MASCOT.ownerKey) return t;
      if (!MASCOT.ownerKey && MASCOT.owner && t.owner === MASCOT.owner) return t;
    }
    return null;
  }

  function build() {
    if (imp) return;
    wantFace((tex) => {
      if (imp) return;
      if (typeof ART.createImp !== 'function') return;
      imp = ART.createImp({ faceTexture: tex });
      group.add(imp.group);
    });
  }

  function silence() {
    if (track) {
      track.stop();
      track = null;
    }
  }

  /** Put him outside whoever the config names, or take him away if they are not here. */
  function apply(model) {
    const team = teamFor(model);
    const e = team && town && town.entry ? town.entry(team.id) : null;
    if (!team || !e || !e.home || !e.toWorld) {
      group.visible = false;
      here = null;
      silence();
      return;
    }
    // Out on the lawn in front of the door, far enough back to have room for a lap.
    const A = e.home.anchors;
    const at = e.toWorld(new THREE.Vector3(A.door.x, 0, A.door.z + LAP + 1.9)); // near edge clears the porch
    const y = terrain.heightAt(at.x, at.z);
    here = { x: at.x, y, z: at.z };
    group.position.set(at.x, y, at.z);
    group.visible = true;
    build();

    // The track plays from his circle. Registered once per address: audio.loop downloads
    // nothing until somebody is close enough to hear it, so a visitor who never comes by
    // never pays for the 1.1 MB.
    silence();
    if (audio && typeof audio.loop === 'function') {
      track = audio.loop(assetUrl(PATHS.beatTrack), {
        name: 'mascot',
        position: { x: at.x, z: at.z },
        falloff: 15,
        range: 46, // audible across his neighbour's lawn, gone by the next street
        volume: 0.6,
      });
    }
  }

  function update(dt, t) {
    if (!here || !imp) return;
    const far = w.player && w.player.getState
      ? Math.hypot(w.player.getState().x - here.x, w.player.getState().z - here.z) > FAR
      : false;
    group.visible = !far;
    if (far) return;
    // Laps, the way he does them on the old page: round a circle, always facing the way he walks.
    angle += dt * SPEED;
    const x = Math.sin(angle) * LAP;
    const z = Math.cos(angle) * LAP;
    imp.group.position.set(x, terrain.heightAt(here.x + x, here.z + z) - here.y, z);
    imp.group.rotation.y = angle + Math.PI / 2;
    imp.update(dt, t, w.camera3D);
  }

  return {
    group,
    apply,
    update,
    /** tests and the console */
    get at() { return here; },
    get playing() { return !!track; },
    dispose() {
      silence();
      if (imp && imp.dispose) imp.dispose();
    },
  };
}
