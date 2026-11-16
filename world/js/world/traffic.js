// Things that move through the town on their own: the garbage truck that works the Boulevard from
// the Hill gates down to the dump, and the blimp that circles the valley with the week's headline.
//
//   const traffic = createTraffic(world)
//   traffic.apply(model)      truck side panel (first place's name) and blimp banner text
//   traffic.update(dt, t)

import * as THREE from '../../lib/three.module.min.js';
import { createGarbageTruck, createBlimp } from '../art/index.js';
import { makeCanvas } from './signs.js';
import { boardTexture, drawBanner, drawTruckPanel } from './boards.js';

const CRUISE = 6.6;
const LOOP_SECONDS = 90;

export function createTraffic(w) {
  const { scene, layout, terrain, colliders, audio, player } = w;
  const group = new THREE.Group();
  group.name = 'traffic';
  scene.add(group);

  // ------------------------------------------------------------------ garbage truck
  const truck = createGarbageTruck();
  truck.group.rotation.order = 'YXZ';
  group.add(truck.group);
  const route = layout.places.truckRoute;
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  const total = cum[cum.length - 1];
  const stopAt = total - 6.5; // the truck's nose stops short of the heap
  const hitA = colliders.addCircle(0, -9999, 1.5, 'truck');
  const hitB = colliders.addCircle(0, -9999, 1.5, 'truck');
  const pt = { x: 0, z: 0 };
  let seg = 0;
  function at(d, out) {
    d = Math.max(0, Math.min(total, d));
    if (cum[seg] > d) seg = 0;
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const k = (d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    out.x = route[seg][0] + (route[seg + 1][0] - route[seg][0]) * k;
    out.z = route[seg][1] + (route[seg + 1][1] - route[seg][1]) * k;
    return out;
  }
  const T = { state: 'wait', s: 0, v: 0, clock: 4, tilt: 0, honk: 0, beeped: false, dumped: false, started: 0 };
  const panel = { cv: makeCanvas(512, 256), tex: null, sig: '' };
  truck.group.visible = false;

  function placeTruck() {
    at(T.s, pt);
    const x = pt.x;
    const z = pt.z;
    at(T.s + 3.2, pt);
    const hx = pt.x - x;
    const hz = pt.z - z;
    const y = terrain.heightAt(x, z);
    const yAhead = terrain.heightAt(pt.x, pt.z);
    const run = Math.hypot(hx, hz) || 1;
    truck.group.position.set(x, y + 0.02, z);
    if (run > 0.5) {
      truck.group.rotation.y = Math.atan2(hx, hz);
      truck.group.rotation.x = -Math.atan2(yAhead - y, run);
    }
    const fx = Math.sin(truck.group.rotation.y);
    const fz = Math.cos(truck.group.rotation.y);
    hitA.x = x + fx * 1.9;
    hitA.z = z + fz * 1.9;
    hitB.x = x - fx * 1.9;
    hitB.z = z - fz * 1.9;
    return { fx, fz };
  }

  function updateTruck(dt, t) {
    if (T.state === 'wait') {
      T.clock -= dt;
      if (T.clock > 0) return;
      // do not appear on top of someone standing at the gates
      if (Math.hypot(player.position.x - route[0][0], player.position.z - route[0][1]) < 7) return;
      T.state = 'drive';
      T.s = 0;
      T.v = 0;
      T.tilt = 0;
      T.beeped = false;
      T.dumped = false;
      T.started = t;
      truck.setBedTilt(0);
      truck.group.visible = true;
    }
    const { fx, fz } = placeTruck();
    const px = player.position.x - truck.group.position.x;
    const pz = player.position.z - truck.group.position.z;
    const ahead = px * fx + pz * fz;
    const side = Math.abs(px * fz - pz * fx);
    const near = Math.hypot(px, pz);
    if (T.state === 'drive') {
      const blocked = ahead > 1.5 && ahead < 10 && side < 2.6;
      const want = blocked ? 0 : Math.min(CRUISE, 1.2 + (stopAt - T.s) * 0.9);
      T.v += (want - T.v) * Math.min(1, dt * (blocked ? 5 : 1.6));
      if (blocked) {
        T.honk -= dt;
        if (T.honk <= 0 && T.v < 1.5) {
          T.honk = 3.5;
          audio.sfx('honk', { position: truck.group.position, volume: 0.9 });
        }
      } else T.honk = Math.min(T.honk, 0.6);
      T.s += T.v * dt;
      truck.setSpeed(T.v);
      if (T.s >= stopAt - 0.05) {
        T.state = 'dump';
        T.clock = 0;
        T.v = 0;
        truck.setSpeed(0);
      }
    } else if (T.state === 'dump') {
      T.clock += dt;
      if (!T.beeped && near < 70) {
        T.beeped = true;
        audio.sfx('truckBeep', { position: truck.group.position, volume: 0.8 });
      }
      const up = Math.min(1, Math.max(0, (T.clock - 1.2) / 2.2));
      const down = Math.min(1, Math.max(0, (T.clock - 5.2) / 1.8));
      T.tilt = up * (1 - down);
      truck.setBedTilt(T.tilt);
      if (!T.dumped && T.clock > 2.6) {
        T.dumped = true;
        if (near < 70) audio.sfx('truckDump', { position: truck.group.position });
      }
      if (T.clock > 8) {
        // job done: vanish and start the round again from the top, out of sight of the dump
        T.state = 'wait';
        T.clock = Math.max(6, LOOP_SECONDS - (t - T.started));
        truck.group.visible = false;
        hitA.z = -9999;
        hitB.z = -9999;
      }
    }
    truck.update(dt, t);
  }

  // ------------------------------------------------------------------ blimp
  const blimp = createBlimp();
  group.add(blimp.group);
  const path = layout.places.blimpPath;
  const banner = { cv: null, tex: null, sig: '' };
  let angle = 1.1;
  function updateBlimp(dt, t) {
    angle += (3.6 / path.radius) * dt;
    const x = path.center[0] + Math.cos(angle) * path.radius;
    const z = path.center[1] + Math.sin(angle) * path.radius * 1.25;
    blimp.group.position.set(x, path.height, z);
    blimp.group.rotation.y = Math.atan2(-Math.sin(angle), Math.cos(angle) * 1.25);
    blimp.update(dt, t);
  }

  function apply(model) {
    const first = model.teams[model.order[0]];
    const name = first ? first.name : '';
    if (panel.sig !== name) {
      panel.sig = name;
      drawTruckPanel(panel.cv, name);
      if (!panel.tex) {
        panel.tex = boardTexture(panel.cv);
        truck.sidePanel.material.map = panel.tex;
        truck.sidePanel.material.needsUpdate = true;
      }
      panel.tex.needsUpdate = true;
    }
    const text = model.blimp || model.meta.leagueName || '';
    if (banner.sig !== text) {
      banner.sig = text;
      if (!banner.cv) {
        const s = blimp.bannerSize || { w: 8, h: 2 };
        banner.cv = makeCanvas(1024, Math.max(64, Math.round((1024 * s.h) / s.w)));
        banner.tex = boardTexture(banner.cv);
        blimp.banner.material.map = banner.tex;
        blimp.banner.material.needsUpdate = true;
      }
      drawBanner(banner.cv, text);
      banner.tex.needsUpdate = true;
    }
  }

  return {
    group,
    apply,
    update(dt, t) {
      updateTruck(dt, t);
      updateBlimp(dt, t);
    },
    truck,
    blimp,
    get truckState() { return { state: T.state, s: T.s, v: T.v, tilt: T.tilt, total }; },
    // tests: start a run right now
    dispatch() {
      T.state = 'wait';
      T.clock = 0;
    },
  };
}
