// The basket toss's cinematic camera. It takes the camera rig over with one long function-driven
// shot (no cut: it starts from wherever the camera is), follows the flyer through the dip, the
// rise, the hang at the apex, the drop and the landing, then hands back to the rig behind the
// player. Reduced motion keeps it behind her and steady: no swing round at the top, no hero shot.
//
//   const cam = createTossCamera({ rig, camera, groundAt, calm })
//   cam.start()
//   cam.update(dt, view)    view: { phase, pad, pos, sol, tau, aimX, aimZ, steerX, steerZ }
//   cam.end(heading)        back to the rig, behind a player facing `heading`
//   cam.active

import * as THREE from '../../lib/three.module.min.js';
import { damp } from '../core/util.js';
import { TOSS, inApex } from './toss-rules.js';

export function createTossCamera({ rig, camera, groundAt, calm = false }) {
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const want = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let shot = null;
  let playing = false;
  let fov = 60;
  const baseFov = () => (rig && typeof rig.baseFov === 'function' ? rig.baseFov() : 60);

  function start() {
    if (!rig || typeof rig.play !== 'function' || !camera) return;
    pos.copy(camera.position);
    camera.getWorldDirection(tmp);
    look.copy(camera.position).addScaledVector(tmp, 10);
    fov = camera.fov || baseFov();
    const mine = { cut: true, dur: 1e7, ease: 'linear', fov, pos: () => pos, look: () => look };
    shot = mine;
    playing = true;
    rig.play([mine], { skippable: false, handoff: calm ? 0.01 : 0.85 }).then(() => {
      if (shot === mine) playing = false; // someone else took the camera
    });
  }

  function end(heading) {
    if (!shot) return;
    shot = null;
    if (rig) {
      try {
        if (typeof rig.snapBehind === 'function') rig.snapBehind(heading);
        if (playing && typeof rig.skip === 'function') rig.skip();
      } catch (err) { /* the rig takes it from here */ }
    }
    playing = false;
  }

  // Behind and to the right for the dip and the rise, beside and a little below her against the
  // sky in the hang, above and behind for the drop onto the cloud, and a front three-quarter hero
  // shot for the landing, framed high so the score card fits underneath.
  function update(dt, v) {
    if (!shot || !camera || !v.pad) return;
    const pad = v.pad;
    const portrait = camera.aspect < 1;
    const sc = portrait ? 1.28 : 1;
    const fx = pad.fx;
    const fz = pad.fz;
    const rx = -pad.lx;
    const rz = -pad.lz;
    const F = v.pos;
    let f = baseFov();
    if (v.phase === 'load' || v.phase === 'count') {
      // close on the stunt group, framed low so the big count sits above them
      want.set(pad.x - fx * 4.7 * sc + rx * 2.9 * sc, pad.y + 1.75 * sc, pad.z - fz * 4.7 * sc + rz * 2.9 * sc);
      wantLook.set(pad.x + fx * 0.8, pad.y + (portrait ? 1.95 : 1.55), pad.z + fz * 0.8);
    } else if (v.phase === 'air') {
      const s = v.sol;
      const hang = !calm && inApex(s, v.tau);
      const falling = v.tau > s.tUp + TOSS.hangHalf * 0.6;
      if (hang) {
        want.set(F.x + rx * 7.4 * sc - fx * 1.8, F.y - 0.4, F.z + rz * 7.4 * sc - fz * 1.8);
        wantLook.set(F.x, F.y + 0.9, F.z);
        f -= 4;
      } else if (falling || (calm && v.tau > s.tUp)) {
        const lx = v.aimX + v.steerX;
        const lz = v.aimZ + v.steerZ;
        want.set(F.x - fx * 6 * sc + rx * 3.6 * sc, F.y + 3.2 * sc, F.z - fz * 6 * sc + rz * 3.6 * sc);
        wantLook.set(F.x + (lx - F.x) * 0.5, F.y + 0.3, F.z + (lz - F.z) * 0.5);
      } else {
        want.set(F.x - fx * 6.8 * sc + rx * 3.6 * sc, F.y - 0.5, F.z - fz * 6.8 * sc + rz * 3.6 * sc);
        wantLook.set(F.x + (v.aimX - F.x) * 0.12, F.y + 0.9, F.z + (v.aimZ - F.z) * 0.12);
        if (!calm) f += 6;
      }
    } else if (calm) {
      want.set(F.x - fx * 4.2 * sc + rx * 2.2 * sc, F.y + 2.1 * sc, F.z - fz * 4.2 * sc + rz * 2.2 * sc);
      wantLook.set(F.x, F.y + (portrait ? 0.15 : 0.55), F.z);
    } else {
      want.set(F.x + fx * 4.4 * sc + rx * 2.4 * sc, F.y + 1.9 * sc, F.z + fz * 4.4 * sc + rz * 2.4 * sc);
      wantLook.set(F.x, F.y + (portrait ? 0.15 : 0.55), F.z);
    }
    // never below whatever is under the camera
    const g = groundAt(want.x, want.z);
    const floor = Math.max(Number.isFinite(g) ? g + 1.1 : -Infinity, pad.y + 0.9);
    if (want.y < floor) want.y = floor;
    const lp = calm ? 2.2 : v.phase === 'air' ? 3.6 : 3;
    const ll = calm ? 4 : 8;
    pos.set(damp(pos.x, want.x, lp, dt), damp(pos.y, want.y, lp, dt), damp(pos.z, want.z, lp, dt));
    if (pos.y < floor) pos.y = damp(pos.y, floor, 12, dt);
    look.set(damp(look.x, wantLook.x, ll, dt), damp(look.y, wantLook.y, ll, dt), damp(look.z, wantLook.z, ll, dt));
    fov = damp(fov, f, 3, dt);
    shot.fov = fov;
  }

  return {
    start,
    update,
    end,
    get active() { return !!shot; },
  };
}
