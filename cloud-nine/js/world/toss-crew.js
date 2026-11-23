// The computer-controlled stunt group on one pad: three bases and a back spot (Contract 3
// characters in team looks). They wait, wave at a flyer walking up, get ready when she is on the
// mat, dip and throw on "5, 6, 7, 8!", cheer while she flies and clap when she lands. When a real
// friend stands on a spot, the base there steps aside to the edge of the mat and cheers from
// there instead (mat talk). Bots never base: that is the squad's thing.
//
//   const crew = createCrew({ parent, center, spots })     spots: world space [{ x, y, z }]
//   crew.populate(makeCharacter)    makeCharacter(i) -> a Contract 3 character (or a stand-in)
//   crew.ready                      true once populated
//   crew.setTaken(i, taken)         a real player stands on spot i
//   crew.cue(name)                  'idle' | 'ready' | 'count' | 'throw' | 'air' | 'land' | 'catch'
//   crew.wave(x, z)                 the base nearest to (x, z) waves hello
//   crew.dip(metres)                the shared dip (negative is down), for the bases on their spots
//   crew.watch(x, z) / crew.watch(null)   turn to follow the flyer
//   crew.setVisible(on) / crew.visible
//   crew.update(dt, t)
//   crew.dispose()

import * as THREE from '../../lib/three.module.min.js';
import { dampAngle, damp } from '../core/util.js';

const STEP_TIME = 0.55;

export function createCrew({ parent, center, spots }) {
  const group = new THREE.Group();
  group.name = 'tossCrew';
  parent.add(group);
  const faceCenter = (x, z) => Math.atan2(center.x - x, center.z - z);
  const members = spots.map((s, i) => {
    const dx = s.x - center.x;
    const dz = s.z - center.z;
    const d = Math.hypot(dx, dz) || 1;
    const out = 2.55 / d;
    const side = { x: center.x + dx * out, y: s.y, z: center.z + dz * out };
    return {
      i, home: { x: s.x, y: s.y, z: s.z }, side, char: null, taken: false, k: 0, x: s.x, z: s.z,
      h: faceCenter(s.x, s.z), anim: '', hold: 0, holdAnim: '', seed: i * 1.7,
    };
  });
  let cueName = 'idle';
  let cueAge = 0;
  let dipY = 0;
  let watchX = null;
  let watchZ = null;
  let visible = true;
  let ready = false;

  function play(m, name) {
    if (!m.char || m.anim === name) return;
    m.anim = name;
    try {
      m.char.setAnim(name);
    } catch (err) { /* an unknown anim is the character's business */ }
  }

  // What a member should be doing right now for the current cue.
  function wanted(m) {
    if (m.hold > 0) return m.holdAnim;
    if (m.k > 0.02 && m.k < 0.98) return 'walk';
    const aside = m.taken;
    switch (cueName) {
      case 'ready':
        return aside ? 'clap' : 'base';
      case 'count':
        return aside ? 'clap' : 'base';
      case 'throw':
        return aside ? 'cheer' : cueAge < 0.45 ? 'throw' : 'highV';
      case 'air':
        return 'cheer';
      case 'land':
        return 'clap';
      case 'catch':
        return aside ? 'cheer' : 'catch';
      default: {
        // waiting: mostly idle, now and then a little cheer motion so the pad feels alive
        const beat = Math.sin(cueAge * 0.45 + m.seed * 2.3);
        if (beat > 0.93) return m.i % 2 ? 'highV' : 'clap';
        return 'idle';
      }
    }
  }

  return {
    group,
    get ready() { return ready; },
    get visible() { return visible; },
    populate(make) {
      for (const m of members) {
        if (m.char) continue;
        try {
          m.char = make(m.i);
        } catch (err) {
          console.warn('[c9] a base could not be built', err);
          m.char = null;
        }
        if (!m.char || !m.char.group) {
          m.char = null;
          continue;
        }
        m.char.group.position.set(m.x, m.home.y, m.z);
        m.char.group.rotation.y = m.h;
        m.char.group.visible = visible;
        group.add(m.char.group);
        m.anim = '';
      }
      ready = true;
    },
    setTaken(i, taken) {
      const m = members[i];
      if (m) m.taken = !!taken;
    },
    isTaken(i) {
      return !!(members[i] && members[i].taken);
    },
    cue(name) {
      if (name === cueName) return;
      cueName = name;
      cueAge = 0;
    },
    get cueName() { return cueName; },
    wave(x, z) {
      let best = null;
      let bd = Infinity;
      for (const m of members) {
        if (m.taken) continue;
        const d = Math.hypot(m.x - x, m.z - z);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (best) {
        best.hold = 1.6;
        best.holdAnim = 'wave';
        best.waveAt = { x, z };
      }
    },
    dip(y) {
      dipY = y;
    },
    watch(x, z) {
      watchX = x;
      watchZ = x === null ? null : z;
    },
    setVisible(on) {
      on = !!on;
      if (on === visible) return;
      visible = on;
      for (const m of members) if (m.char) m.char.group.visible = on;
    },
    update(dt, t) {
      cueAge += dt;
      if (!visible) return;
      for (const m of members) {
        // step aside for a real friend, step back when the spot is free again
        const want = m.taken ? 1 : 0;
        if (m.k !== want) m.k = want > m.k ? Math.min(1, m.k + dt / STEP_TIME) : Math.max(0, m.k - dt / STEP_TIME);
        const e = m.k * m.k * (3 - 2 * m.k);
        const px = m.x;
        const pz = m.z;
        m.x = m.home.x + (m.side.x - m.home.x) * e;
        m.z = m.home.z + (m.side.z - m.home.z) * e;
        if (m.hold > 0) m.hold -= dt;
        // where to look: the flyer when one is up, whoever they wave at, else the middle of the mat
        let h;
        if (m.k > 0.02 && m.k < 0.98) h = Math.atan2(m.x - px, m.z - pz) || m.h;
        else if (m.hold > 0 && m.waveAt) h = Math.atan2(m.waveAt.x - m.x, m.waveAt.z - m.z);
        else if (watchX !== null) h = Math.atan2(watchX - m.x, watchZ - m.z);
        else h = faceCenter(m.x, m.z);
        m.h = dampAngle(m.h, h, 7, dt);
        if (!m.char) continue;
        play(m, wanted(m));
        const onSpot = m.k < 0.02;
        const g = m.char.group;
        g.position.set(m.x, damp(g.position.y, m.home.y + (onSpot ? dipY : 0), 30, dt), m.z);
        g.rotation.y = m.h;
        if (m.char.setSpeed) m.char.setSpeed(m.k > 0.02 && m.k < 0.98 ? 2.6 : 0);
        m.char.update(dt, t);
      }
    },
    dispose() {
      for (const m of members) {
        if (!m.char) continue;
        group.remove(m.char.group);
        try {
          m.char.dispose();
        } catch (err) { /* already gone */ }
        m.char = null;
      }
      if (group.parent) group.parent.remove(group);
    },
  };
}
