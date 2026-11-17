// Everyone who lives in the town. One actor registry keyed by team id (Contract 6): a resident NPC
// and a live friend are the same kind of avatar, so presence (phase 2) only swaps who drives it.
//
//   const residents = createResidents(world)
//   residents.apply(model)            one resident per team, at home, doing what their tier does
//   residents.setPlayerTeam(id|null)  the visitor's own team has no NPC: they ARE that resident
//   residents.accessoryFor(team)      'crown' | 'visor' | 'cap' | 'bag' | null
//   residents.get(teamId)             -> actor | undefined
//   residents.react(teamId, x, z, s)  stand up, face (x, z) and shake a fist for s seconds (vandals)
//   residents.update(dt, t)

import * as THREE from '../../lib/three.module.min.js';
import { createAvatar, createLawnChair, createGrill } from '../art/index.js';

const SHOW_FAR = 72;
const ANIM_FAR = 60;

export function accessoryFor(team) {
  if (!team) return null;
  if (team.rank === 1) return 'crown';
  if (team.tier === 'heights') return 'visor';
  if (team.tier === 'park') return 'cap';
  if (team.tier === 'dump') return 'bag';
  return null;
}

export function createResidents(w) {
  const { scene, store, interact } = w;
  const group = new THREE.Group();
  group.name = 'residents';
  scene.add(group);
  const actors = new Map();
  let model = null;
  let playerTeam = null;
  const cam = new THREE.Vector3();
  const v = new THREE.Vector3();

  function remove(id) {
    const a = actors.get(id);
    if (!a) return;
    group.remove(a.avatar.group);
    a.avatar.dispose();
    for (const p of a.props) {
      group.remove(p.group);
      p.dispose();
    }
    interact.unregister('resident:' + id);
    actors.delete(id);
  }

  // Where a resident stands and what they do there, from their home's anchors.
  function settle(a) {
    const e = w.town.entry(a.teamId);
    if (!e) return;
    const A = e.home.anchors;
    const tier = a.team.tier;
    const facing = e.lot.facing;
    a.base.copy(e.toWorld(A.resident.clone()));
    a.heading = facing;
    a.mode = tier;
    a.clock = 3 + (a.teamId % 5);
    for (const p of a.props) {
      group.remove(p.group);
      p.dispose();
    }
    a.props = [];
    const addProp = (prop, pos, ry) => {
      prop.group.position.copy(pos);
      prop.group.rotation.y = ry;
      group.add(prop.group);
      a.props.push(prop);
      return prop;
    };
    if (tier === 'hill') {
      const throne = w.town.special('throne');
      if (throne) {
        const seat = throne.anchor(throne.prop.anchors.seat);
        a.seat.set(seat.x, seat.y - a.avatar.sitOffset, seat.z);
        a.stand.copy(throne.anchor(throne.prop.anchors.foot));
        a.base.copy(a.seat);
      }
      a.anim = 'sit';
    } else if (tier === 'heights') {
      if (a.teamId % 2 === 0) {
        addProp(createGrill(), e.toWorld(new THREE.Vector3(A.resident.x, A.resident.y, A.resident.z + 0.85)), facing + Math.PI);
        a.anim = 'grill';
      } else a.anim = 'idle';
    } else if (tier === 'bubble') {
      // pace a short line between the path and the mailbox, never getting anywhere
      a.p0.copy(e.toWorld(new THREE.Vector3(A.resident.x - 1.6, A.resident.y, A.resident.z)));
      a.p1.copy(e.toWorld(new THREE.Vector3(A.resident.x + 1.9, A.resident.y, A.resident.z + 0.4)));
      a.anim = 'pace';
      a.u = (a.teamId % 7) / 7;
      a.dir = 1;
    } else if (tier === 'park') {
      const chair = addProp(createLawnChair(), a.base, facing);
      const seat = chair.anchors.seat;
      v.set(seat.x, 0, seat.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, facing);
      a.base.set(a.base.x + v.x, a.base.y + seat.y - a.avatar.sitOffset, a.base.z + v.z);
      a.anim = 'lounge';
    } else {
      a.anim = 'shiver';
    }
    a.avatar.setAnim(a.anim);
    a.avatar.group.position.copy(a.base);
    a.avatar.group.rotation.y = a.heading;
  }

  function ensure(team) {
    let a = actors.get(team.id);
    if (!a) {
      const avatar = createAvatar({ color: team.color, number: team.rank, accessory: accessoryFor(team) });
      group.add(avatar.group);
      a = {
        kind: 'resident', teamId: team.id, team, avatar, props: [],
        base: new THREE.Vector3(), seat: new THREE.Vector3(), stand: new THREE.Vector3(), p0: new THREE.Vector3(), p1: new THREE.Vector3(),
        heading: 0, mode: '', anim: 'idle', clock: 0, u: 0, dir: 1, sig: '', waving: false,
      };
      actors.set(team.id, a);
      interact.register({
        id: 'resident:' + team.id,
        position: () => a.avatar.group.position,
        radius: 2.1, label: 'Visit', priority: 1,
        onUse: () => store.emit('use', { kind: 'home', teamId: team.id }),
      });
    }
    const sig = team.tier + '|' + team.slot + '|' + team.rank + '|' + team.color;
    const moved = a.sig.split('|').slice(0, 2).join('|') !== team.tier + '|' + team.slot;
    a.team = team;
    if (a.sig !== sig) {
      a.avatar.setNumber(team.rank);
      a.avatar.setColor(team.color);
      a.avatar.setAccessory(accessoryFor(team));
    }
    if (a.react && moved) a.react = null;
    if (a.sig === '' || moved) settle(a);
    a.sig = sig;
    const it = interact.get('resident:' + team.id);
    if (it) it.label = 'Visit ' + Array.from(team.name).slice(0, 22).join('');
    return a;
  }

  function apply(next) {
    model = next;
    for (const id of model.order) {
      if (id === playerTeam) {
        remove(id);
        continue;
      }
      ensure(model.teams[id]);
    }
    for (const id of [...actors.keys()]) if (!model.teams[id]) remove(id);
  }

  function setPlayerTeam(id) {
    const prev = playerTeam;
    playerTeam = id === null || id === undefined ? null : Number(id);
    if (playerTeam !== null) remove(playerTeam);
    if (model && prev !== null && prev !== playerTeam && model.teams[prev]) ensure(model.teams[prev]);
  }

  // Somebody is egging the house: get up, turn to face them, shake a fist, then go back to it.
  function react(teamId, x, z, seconds = 3) {
    const a = actors.get(Number(teamId));
    if (!a) return false;
    const g = a.avatar.group;
    if (!a.react) {
      a.react = { left: 0, x, z, pos: g.position.clone(), rot: g.rotation.y };
      // out of the lawn chair or off the throne first
      if (a.mode === 'park') {
        const e = w.town.entry(a.teamId);
        const f = e ? e.lot.facing : a.heading;
        const px = a.base.x + Math.sin(f) * 0.85;
        const pz = a.base.z + Math.cos(f) * 0.85;
        g.position.set(px, w.terrain.heightAt(px, pz), pz);
      } else if (a.mode === 'hill' && !a.waving) g.position.copy(a.stand);
      a.avatar.setAnim('wave');
    }
    a.react.left = Math.max(a.react.left, seconds);
    a.react.x = x;
    a.react.z = z;
    return true;
  }

  function endReact(a) {
    const g = a.avatar.group;
    g.position.copy(a.react.pos);
    g.rotation.y = a.react.rot;
    a.react = null;
    a.avatar.setAnim(a.mode === 'hill' ? (a.waving ? 'wave' : 'sit') : a.mode === 'heights' && a.anim === 'idle' && a.waving ? 'wave' : a.anim);
  }

  function update(dt, t) {
    cam.copy(w.engine.camera.position);
    for (const a of actors.values()) {
      if (a.react) {
        a.react.left -= dt;
        if (a.react.left <= 0) endReact(a);
        else {
          const g = a.avatar.group;
          const want = Math.atan2(a.react.x - g.position.x, a.react.z - g.position.z);
          let d = want - g.rotation.y;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          g.rotation.y += d * Math.min(1, dt * 8);
          if (g.visible) a.avatar.update(dt, t);
          continue;
        }
      }
      const g = a.avatar.group;
      const d = g.position.distanceTo(cam);
      const show = d < SHOW_FAR;
      if (g.visible !== show) {
        g.visible = show;
        for (const p of a.props) p.group.visible = show;
      }
      if (!show || d > ANIM_FAR) continue;
      if (a.mode === 'bubble') {
        // back and forth, with a nervous pause at each end
        if (a.clock > 0) a.clock -= dt;
        else {
          const len = a.p0.distanceTo(a.p1) || 1;
          a.u += (a.dir * 1.15 * dt) / len;
          if (a.u >= 1 || a.u <= 0) {
            a.u = Math.max(0, Math.min(1, a.u));
            a.dir = -a.dir;
            a.clock = 0.5 + ((a.teamId * 13 + Math.floor(t)) % 5) * 0.25;
          }
          g.position.lerpVectors(a.p0, a.p1, a.u);
          const hx = (a.p1.x - a.p0.x) * a.dir;
          const hz = (a.p1.z - a.p0.z) * a.dir;
          g.rotation.y = Math.atan2(hx, hz);
        }
        a.avatar.setSpeed(a.clock > 0 ? 0.2 : 1.15);
      } else if (a.mode === 'hill') {
        // rule from the throne, stand up to wave at the valley now and then
        a.clock -= dt;
        if (a.clock <= 0) {
          a.waving = !a.waving;
          a.clock = a.waving ? 3.2 : 11 + (Math.floor(t) % 7);
          a.avatar.setAnim(a.waving ? 'wave' : 'sit');
          g.position.copy(a.waving ? a.stand : a.seat);
        }
      } else if (a.mode === 'heights' && a.anim === 'idle') {
        a.clock -= dt;
        if (a.clock <= 0) {
          a.waving = !a.waving;
          a.clock = a.waving ? 2.6 : 9 + (a.teamId % 6);
          a.avatar.setAnim(a.waving ? 'wave' : 'idle');
        }
      }
      a.avatar.update(dt, t);
      for (let i = 0; i < a.props.length; i++) if (a.props[i].update) a.props[i].update(dt, t);
    }
  }

  return {
    group,
    apply,
    setPlayerTeam,
    update,
    accessoryFor,
    get(teamId) { return actors.get(Number(teamId)); },
    react,
    get actors() { return actors; },
    get playerTeam() { return playerTeam; },
  };
}
