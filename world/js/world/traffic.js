// Things that move through the town on their own: the garbage truck that works the Boulevard from
// the Hill down to the dump, and the blimp that circles the valley with the week's headline.
// The truck waits at a "Truck stop" by the gold gates between runs, and anyone may ride it.
//
//   const traffic = createTraffic(world)
//   traffic.apply(model)      truck side panel (first place's name) and blimp banner text
//   traffic.update(dt, t)
//   traffic.stop              { x, z, facing } where a visitor stands to catch the truck
//   traffic.riding            true while the visitor is on the back of the truck
//   traffic.hopOff()          end the ride now (safe to call any time)

import * as THREE from '../../lib/three.module.min.js';
import { createGarbageTruck, createBlimp } from '../art/index.js';
import { makeCanvas, drawSign } from './signs.js';
import { boardTexture, drawBanner, drawTruckPanel } from './boards.js';

const CRUISE = 6.6;
const LOOP_SECONDS = 90;
const RIDE_SPOT = new THREE.Vector3(0.95, 0.62, -4.35); // the step at the back, truck-local
const TIP_LINES = {
  last: 'Door to door service.',
  first: 'You rode your own trash to the bottom. Humility looks good on you.',
  other: 'End of the line. Mind the raccoons.',
};

export function createTraffic(w) {
  const { scene, layout, terrain, colliders, audio, player, interact, hud, input, rig } = w;
  const group = new THREE.Group();
  group.name = 'traffic';
  scene.add(group);
  const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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
  function onRoute(d, out) {
    d = Math.max(0, Math.min(total, d));
    if (cum[seg] > d) seg = 0;
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const k = (d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    out.x = route[seg][0] + (route[seg + 1][0] - route[seg][0]) * k;
    out.z = route[seg][1] + (route[seg + 1][1] - route[seg][1]) * k;
    return out;
  }
  // Between runs the truck waits on the verge beside the gold gates, then pulls onto the Boulevard.
  const hillLot = layout.lots.hill[0];
  const S0 = 3;
  const PULL = 14;
  const park = { x: hillLot.x + 9.6, z: hillLot.z + hillLot.d / 2 + 2.4 };
  function at(d, out) {
    onRoute(d, out);
    let k = Math.max(0, Math.min(1, (d - S0) / PULL));
    k = k * k * (3 - 2 * k);
    out.x = park.x + (out.x - park.x) * k;
    out.z = park.z + (out.z - park.z) * k;
    return out;
  }
  const T = { state: 'wait', s: S0, v: 0, clock: 14, tilt: 0, honk: 0, beeped: false, dumped: false, started: 0 };
  const panel = { cv: makeCanvas(512, 256), tex: null, sig: '' };
  const fwd = { x: 0, z: 1 };

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
    fwd.x = Math.sin(truck.group.rotation.y);
    fwd.z = Math.cos(truck.group.rotation.y);
    hitA.x = x + fwd.x * 1.9;
    hitA.z = z + fwd.z * 1.9;
    hitB.x = x - fwd.x * 1.9;
    hitB.z = z - fwd.z * 1.9;
  }
  placeTruck();

  // the stop: a small sign on the verge, and a place on the map
  const stop = { x: park.x, z: park.z, facing: 0 };
  {
    // where to stand to catch it: beside the back step
    const c = Math.cos(truck.group.rotation.y);
    const s = Math.sin(truck.group.rotation.y);
    stop.x = truck.group.position.x + 3 * c - 3.4 * s;
    stop.z = truck.group.position.z - 3 * s - 3.4 * c;
    stop.facing = Math.atan2(truck.group.position.x - stop.x, truck.group.position.z - stop.z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.5, 0.12), new THREE.MeshLambertMaterial({ color: 0x5f666b }));
    const cv = drawSign(['TRUCK STOP', 'Rides to the dump'], 1.9, { height: 160, bg: '#2e7d4f', color: '#ffffff', borderColor: '#f3eedd', subBody: true });
    const tex = boardTexture(cv);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 0.06), [
      new THREE.MeshLambertMaterial({ color: 0x2e7d4f }), new THREE.MeshLambertMaterial({ color: 0x2e7d4f }),
      new THREE.MeshLambertMaterial({ color: 0x2e7d4f }), new THREE.MeshLambertMaterial({ color: 0x2e7d4f }),
      new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex }),
    ]);
    const sx = park.x + 4.4;
    const sz = park.z + 0.4;
    const sy = terrain.heightAt(sx, sz);
    post.position.set(sx, sy + 1.25, sz);
    board.position.set(sx, sy + 2.25, sz);
    board.rotation.y = Math.atan2(route[4][0] - sx, route[4][1] - sz);
    group.add(post, board);
    colliders.addCircle(sx, sz, 0.25, 'truck-stop');
  }

  // ------------------------------------------------------------------ riding
  const ride = { active: false, age: 0, release: null, zone: '', seen: null, tip: -1, from: new THREE.Vector3(), to: new THREE.Vector3(), camFrom: new THREE.Vector3(), lookFrom: new THREE.Vector3() };
  const v3 = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();

  function local(v, out) {
    // truck-local to world, yaw only (the rider stays upright on grades)
    const c = Math.cos(truck.group.rotation.y);
    const s = Math.sin(truck.group.rotation.y);
    return out.set(truck.group.position.x + v.x * c + v.z * s, truck.group.position.y + v.y, truck.group.position.z - v.x * s + v.z * c);
  }

  function seatRider() {
    local(RIDE_SPOT, v3);
    player.setSeat(v3.x, v3.y, v3.z, truck.group.rotation.y);
  }

  function canBoard() {
    return !ride.active && (T.state === 'wait' || (T.state === 'drive' && T.s < stopAt - 12));
  }

  function board() {
    if (!canBoard() || player.seated) return;
    ride.active = true;
    ride.age = 0;
    ride.tip = -1;
    ride.seen = new Set([terrain.dominantZone(truck.group.position.x, truck.group.position.z)]);
    ride.release = w.freezePlayer();
    local(RIDE_SPOT, v3);
    player.sit(v3.x, v3.y, v3.z, truck.group.rotation.y, () => hopOff(), 'idle');
    hud.setCue('Tap to hop off');
    audio.sfx('pop', { volume: 0.6 });
    if (T.state === 'wait') T.clock = 0.8; // all aboard: leave now
    ride.camFrom.copy(w.camera3D.position);
    ride.lookFrom.copy(rig.lookTarget);
    // chase view from behind and to the side: the rider, the truck, and the town going by
    const portrait = w.camera3D.aspect < 1;
    const off = portrait ? new THREE.Vector3(5.2, 4.6, -11.5) : new THREE.Vector3(6.5, 3.6, -9.5);
    const aim = new THREE.Vector3(0.2, 1.7, 1.5);
    const easeIn = (sec) => {
      if (calm) return 1;
      const k = Math.min(1, sec / 0.9);
      return k * k * (3 - 2 * k);
    };
    rig.play([{
      cut: true, dur: 1e7, ease: 'linear',
      pos: (u, sec) => {
        local(off, camPos);
        camPos.y = Math.max(camPos.y, terrain.heightAt(camPos.x, camPos.z) + 1.4);
        return camPos.lerpVectors(ride.camFrom, camPos, easeIn(sec));
      },
      look: (u, sec) => camLook.lerpVectors(ride.lookFrom, local(aim, camLook), easeIn(sec)),
    }], { skippable: false, handoff: calm ? 0.01 : 0.8 }).then(() => hopOff(null, true));
  }

  // Ends the ride from any state. The rider lands on the road beside the truck, unless something
  // else (fast travel) has already put them somewhere.
  function hopOff(line, fromCamera) {
    if (!ride.active) return;
    ride.active = false;
    ride.tip = -1;
    hud.setCue(null);
    if (player.seated) {
      const b = terrain.bounds;
      const x = Math.max(b.minX + 1, Math.min(b.maxX - 1, truck.group.position.x + fwd.z * 3.1 - fwd.x * 2.2));
      const z = Math.max(b.minZ + 1, Math.min(b.maxZ - 1, truck.group.position.z - fwd.x * 3.1 - fwd.z * 2.2));
      player.stand(x, z, truck.group.rotation.y);
    }
    // (if the camera shot was ended by something else, that something owns the camera now)
    if (!fromCamera && rig.isCinematic) rig.skip();
    rig.setView({ yaw: player.heading + Math.PI });
    if (ride.release) ride.release();
    ride.release = null;
    if (line) hud.toast(line, { ms: 4200 });
  }

  function tipOut() {
    // out the back with the trash: a short arc onto the road behind the truck
    ride.tip = 0;
    ride.from.copy(player.position);
    local(v3.set(0.6, 0, -7.2), ride.to);
    ride.to.y = terrain.heightAt(ride.to.x, ride.to.z);
    audio.sfx('whoosh', { volume: 0.5 });
  }

  function updateRide(dt) {
    if (!ride.active) return;
    ride.age += dt;
    if (ride.tip >= 0) {
      ride.tip += dt / (calm ? 0.01 : 0.75);
      const u = Math.min(1, ride.tip);
      v3.lerpVectors(ride.from, ride.to, u);
      v3.y += Math.sin(Math.PI * u) * 1.5;
      player.setSeat(v3.x, v3.y, v3.z, truck.group.rotation.y + Math.PI);
      if (u >= 1) {
        const m = w.model;
        const t = m && w.playerTeam !== null ? m.teams[w.playerTeam] : null;
        const line = t && t.rank === m.order.length ? TIP_LINES.last : t && t.rank === 1 ? TIP_LINES.first : TIP_LINES.other;
        const to = ride.to.clone();
        const face = truck.group.rotation.y + Math.PI;
        ride.active = false;
        ride.tip = -1;
        hud.setCue(null);
        player.stand(to.x, to.z, face);
        if (rig.isCinematic) rig.skip();
        if (ride.release) ride.release();
        ride.release = null;
        hud.toast(line, { ms: 5200 });
      }
      return;
    }
    seatRider();
    const zone = terrain.dominantZone(truck.group.position.x, truck.group.position.z);
    if (!ride.seen.has(zone)) {
      ride.seen.add(zone);
      hud.toast(w.zoneName(zone), { ms: 1900 });
      audio.sfx('tick', { volume: 0.6 });
    }
  }

  interact.register({
    id: 'truck', position: () => local(v3.set(0, 0, -3.2), new THREE.Vector3()), radius: 4.6, label: 'Ride the garbage truck', priority: 2,
    object3D: truck.group, enabled: true, onUse: board,
  });
  const truckItem = interact.get('truck');
  const leave = () => {
    if (ride.active && ride.age > 0.6 && ride.tip < 0) hopOff();
  };
  input.on('tap', leave);
  input.on('use', leave);
  input.on('escape', leave);
  // a card or panel opening ends the ride cleanly instead of carrying on behind it
  hud.on('modal', (open) => {
    if (open && ride.active) hopOff();
  });

  function updateTruck(dt, t) {
    truckItem.enabled = canBoard();
    if (T.state === 'wait') {
      T.clock -= dt;
      truck.update(dt, t);
      if (T.clock > 0) return;
      T.state = 'drive';
      T.s = S0;
      T.v = 0;
      T.tilt = 0;
      T.beeped = false;
      T.dumped = false;
      T.started = t;
      truck.setBedTilt(0);
    }
    placeTruck();
    const px = player.position.x - truck.group.position.x;
    const pz = player.position.z - truck.group.position.z;
    const ahead = px * fwd.x + pz * fwd.z;
    const side = Math.abs(px * fwd.z - pz * fwd.x);
    const near = Math.hypot(px, pz);
    if (T.state === 'drive') {
      const blocked = !ride.active && ahead > 1.5 && ahead < 10 && side < 2.6;
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
        if (ride.active && ride.tip < 0) tipOut();
      }
      if (T.clock > 8) {
        // job done: back to the truck stop at the top of the hill for the next round
        if (ride.active) hopOff();
        T.state = 'wait';
        T.s = S0;
        T.clock = Math.max(8, LOOP_SECONDS - (t - T.started));
        truck.setBedTilt(0);
        placeTruck();
      }
    }
    truck.update(dt, t);
  }

  // ------------------------------------------------------------------ blimp
  // Scaled up and flown lower than the art's default so the banner reads from the ground on a
  // phone. The headline is shown a few words at a time, as large as the banner allows.
  const BLIMP_SCALE = 1.7;
  const blimp = createBlimp();
  blimp.group.scale.setScalar(BLIMP_SCALE);
  group.add(blimp.group);
  const path = layout.places.blimpPath;
  const orbit = Math.min(path.radius, 52);
  const altitude = Math.min(path.height, 45);
  const banner = { cv: null, tex: null, sig: '', pages: [''], page: 0, clock: 0 };
  let angle = 1.1;
  function paginate(text, max = 15) {
    const pages = [];
    let cur = '';
    for (const word of String(text || '').toUpperCase().split(/\s+/).filter(Boolean)) {
      const next = cur ? cur + ' ' + word : word;
      if (next.length <= max || !cur) cur = next;
      else {
        pages.push(cur);
        cur = word;
      }
    }
    if (cur) pages.push(cur);
    return pages.length ? pages : [''];
  }
  function showPage() {
    drawBanner(banner.cv, banner.pages[banner.page % banner.pages.length]);
    banner.tex.needsUpdate = true;
  }
  function updateBlimp(dt, t) {
    angle += (3.4 / orbit) * dt;
    const x = path.center[0] + Math.cos(angle) * orbit;
    const z = path.center[1] + Math.sin(angle) * orbit * 1.25;
    blimp.group.position.set(x, altitude, z);
    blimp.group.rotation.y = Math.atan2(-Math.sin(angle), Math.cos(angle) * 1.25);
    blimp.update(dt, t);
    if (banner.cv && banner.pages.length > 1) {
      banner.clock += dt;
      if (banner.clock > 3.4) {
        banner.clock = 0;
        banner.page = (banner.page + 1) % banner.pages.length;
        showPage();
      }
    }
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
      banner.pages = paginate(text);
      banner.page = 0;
      banner.clock = 0;
      showPage();
    }
  }

  return {
    group,
    apply,
    update(dt, t) {
      updateTruck(dt, t);
      updateRide(dt);
      updateBlimp(dt, t);
    },
    truck,
    blimp,
    stop,
    hopOff: () => hopOff(),
    get riding() { return ride.active; },
    get truckState() { return { state: T.state, s: T.s, v: T.v, tilt: T.tilt, total, clock: T.clock }; },
    // tests: start a run right now
    dispatch() {
      if (T.state === 'wait') T.clock = 0;
    },
  };
}
