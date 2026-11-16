// The three special things you can do with the town's landmarks, plus the Dump's thunder.
//   Throne (the Hill): first place may sit and look down the whole valley. Everyone else may not.
//   Telescope (the Hill): a long lens on whoever lives at the Dump.
//   Periscope (the Dump): the same view, from the other end of the standings.
// Each emits a store 'use' event (Contract 7); the camera work happens here on the world side.

import * as THREE from '../../lib/three.module.min.js';

export function createLandmarks(w) {
  const { store, interact, player, rig, hud, audio, sky, layout } = w;
  const bound = { throne: null, telescope: null, periscope: null, cloud: null };
  let seated = false;

  function lensFov(dist, radius) {
    const aspect = w.camera3D.aspect;
    const half = Math.atan(radius / Math.max(1, dist));
    return THREE.MathUtils.clamp((2 * Math.atan(Math.tan(half) / Math.min(1, aspect)) * 180) / Math.PI, 3, 40);
  }

  function scope(from, to, radius, fog, kind) {
    store.emit('use', { kind });
    const dist = from.distanceTo(to);
    hud.el.classList.add('lw-scope');
    sky.setFogScale(fog);
    w.hideTags = true;
    audio.sfx('whoosh', { volume: 0.4 });
    rig.play([{ cut: true, dur: 1e6, pos: [from.x, from.y, from.z], look: [to.x, to.y, to.z], fov: lensFov(dist, radius) }], { skippable: true, handoff: 0.7 })
      .then(() => {
        hud.el.classList.remove('lw-scope');
        sky.setFogScale(1);
        w.hideTags = false;
      });
  }

  function dumpTarget() {
    const e = w.town.entries().find((x) => x.team.tier === 'dump');
    if (!e) return null;
    return new THREE.Vector3(e.lot.x, e.lot.y + 5.2, e.lot.z);
  }

  function sit(throne) {
    const seat = throne.anchor(throne.prop.anchors.seat);
    const foot = throne.anchor(throne.prop.anchors.foot);
    const facing = throne.entry.lot.facing;
    const release = w.freezePlayer();
    seated = true;
    player.sit(seat.x, seat.y - ((player.avatar && player.avatar.sitOffset) || 0.27), seat.z, facing);
    audio.sfx('fanfare', { volume: 0.7 });
    // behind and above the throne, looking over it at the statue and everything below
    const s = layout.places.statue;
    const target = new THREE.Vector3(s.x, layout.stations.plaza.y + 1.5, s.z);
    // from the seat itself, just above the sitter's head: nothing between the champion and the valley
    const back = new THREE.Vector3(seat.x - target.x, 0, seat.z - target.z).normalize();
    const pos = [seat.x - back.x * 1.1, seat.y + 2.25, seat.z - back.z * 1.1];
    sky.setFogScale(0.7);
    rig.play([
      { dur: 2.2, ease: 'inOut', pos, look: [target.x, target.y, target.z], fov: w.camera3D.aspect < 1 ? 62 : 48 },
      { dur: 1e6 },
    ], { skippable: true, handoff: 0.9 }).then(() => {
      seated = false;
      sky.setFogScale(1);
      player.stand(foot.x, foot.z, facing);
      release();
    });
  }

  function bind() {
    const town = w.town;
    const throne = town.special('throne');
    if (throne && bound.throne !== throne.prop) {
      bound.throne = throne.prop;
      interact.register({
        id: 'throne', position: throne.anchor(throne.prop.anchors.foot), radius: 2.4, label: 'The throne', priority: 3,
        onUse: () => {
          if (seated) return;
          const t = w.playerTeam !== null ? w.model.teams[w.playerTeam] : null;
          const allowed = !!(t && t.rank === 1);
          store.emit('use', { kind: 'throne', allowed });
          if (allowed) sit(throne);
        },
      });
    }
    const tele = town.special('telescope');
    if (tele && bound.telescope !== tele.prop) {
      bound.telescope = tele.prop;
      interact.register({
        id: 'telescope', position: tele.anchor(tele.prop.anchors.viewer), radius: 2, label: 'Telescope', priority: 3, object3D: tele.prop.group,
        onUse: () => {
          const to = dumpTarget();
          if (!to) return;
          const from = tele.position.clone();
          from.y += 1.7;
          scope(from, to, 10, 0.5, 'telescope');
        },
      });
    }
    const peri = town.special('periscope');
    if (peri && bound.periscope !== peri.prop) {
      bound.periscope = peri.prop;
      interact.register({
        id: 'periscope', position: peri.anchor(peri.prop.anchors.viewer), radius: 2, label: 'Periscope', priority: 3, object3D: peri.prop.group,
        onUse: () => {
          const crown = town.special('crown');
          if (!crown) return;
          const to = crown.position.clone();
          to.y -= 2.5;
          const from = peri.position.clone();
          from.y += 2.5;
          scope(from, to, 13, 0.22, 'periscope');
        },
      });
    }
    const cloud = town.special('cloud');
    if (cloud && bound.cloud !== cloud.prop) {
      bound.cloud = cloud.prop;
      cloud.prop.onFlash = () => {
        const p = cloud.position;
        if (Math.hypot(player.position.x - p.x, player.position.z - p.z) < 60) audio.sfx('thunder', { position: p, volume: 0.9 });
      };
    }
  }

  let clock = 1;
  return {
    update(dt) {
      clock += dt;
      if (clock < 0.5) return;
      clock = 0;
      bind();
    },
    get seated() { return seated; },
  };
}
