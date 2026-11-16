// The flow side's view of Contract 7. Every call into the world goes through here and is guarded,
// so a missing piece (an older world build, a failed system) degrades instead of throwing.

import { TIER_ORDER } from '../config.js';
import { tierName, PLAZA_LINE } from './dom.js';
import { tierWelcome } from '../model/roasts.js';

export function modelOf(ctx) {
  return (ctx.store && ctx.store.get('model')) || ctx.model || null;
}

export function groundY(ctx, x, z) {
  try {
    return ctx.terrain.heightAt(x, z);
  } catch (err) {
    return 0;
  }
}

// HomeInfo worked out from the town plan alone, for when town.getHome is not there.
function homeFromLayout(ctx, team) {
  const lots = ctx.layout && ctx.layout.lots ? ctx.layout.lots[team.tier] : null;
  const lot = lots ? lots[team.slot] || lots[lots.length - 1] : null;
  if (!lot) return null;
  const fx = Math.sin(lot.facing);
  const fz = Math.cos(lot.facing);
  const half = lot.r || lot.d / 2;
  const sx = lot.street[0];
  const sz = lot.street[1];
  const dx = lot.x + fx * (half - 3);
  const dz = lot.z + fz * (half - 3);
  const px = lot.x + fx * (half + 16);
  const pz = lot.z + fz * (half + 16);
  return {
    teamId: team.id, rank: team.rank, tier: team.tier, x: lot.x, y: lot.y, z: lot.z, facing: lot.facing,
    door: { x: dx, y: lot.y, z: dz },
    street: { x: sx, y: groundY(ctx, sx, sz), z: sz, facing: Math.atan2(lot.x - sx, lot.z - sz) },
    view: { pos: [px, Math.max(lot.y + 8, groundY(ctx, px, pz) + 2.5), pz], look: [lot.x, lot.y + 3, lot.z] },
  };
}

function validHome(h) {
  return !!(h && h.street && Number.isFinite(h.street.x) && Number.isFinite(h.street.z));
}

export function getHome(ctx, teamId) {
  if (teamId === null || teamId === undefined) return null;
  try {
    const h = ctx.town && typeof ctx.town.getHome === 'function' ? ctx.town.getHome(teamId) : null;
    if (validHome(h)) return h;
  } catch (err) { /* fall through */ }
  const model = modelOf(ctx);
  const team = model && model.teams ? model.teams[teamId] : null;
  try {
    return team ? homeFromLayout(ctx, team) : null;
  } catch (err) {
    return null;
  }
}

/** Every home, best rank first. */
export function allHomes(ctx) {
  const model = modelOf(ctx);
  if (!model || !model.order) return [];
  return model.order.map((id) => getHome(ctx, id)).filter(Boolean);
}

/** The ride from the crown down to the dump: [[x, y, z], ...]. */
export function boulevard(ctx) {
  try {
    const pts = ctx.world && typeof ctx.world.boulevard === 'function' ? ctx.world.boulevard() : null;
    if (pts && pts.length > 1) return pts;
  } catch (err) { /* fall through */ }
  try {
    return ctx.layout.road.map((p) => [p[0], groundY(ctx, p[0], p[1]), p[1]]);
  } catch (err) {
    return [];
  }
}

/** Fast-travel targets keyed by id: hill, heights, plaza, bubble, park, dump (and whatever else the world lists). */
export function places(ctx) {
  const out = {};
  try {
    const list = ctx.world && typeof ctx.world.places === 'function' ? ctx.world.places() : [];
    for (const p of list || []) if (p && p.id !== undefined && Number.isFinite(p.x) && Number.isFinite(p.z)) out[p.id] = p;
  } catch (err) { /* fall through */ }
  try {
    const zones = ctx.layout ? ctx.layout.zones : null;
    for (const id of ['hill', 'heights', 'plaza', 'bubble', 'park', 'dump']) {
      if (out[id]) continue;
      if (id === 'plaza' && ctx.layout && ctx.layout.places && ctx.layout.places.spawnPlaza) {
        out[id] = Object.assign({ id, kind: 'plaza', name: tierName(id) }, ctx.layout.places.spawnPlaza);
      } else if (zones && zones[id]) {
        out[id] = { id, kind: 'neighborhood', name: tierName(id), x: zones[id].center[0], z: zones[id].center[1], facing: 0 };
      }
    }
  } catch (err) { /* nothing else to add */ }
  return out;
}

export function zoneLine(id) {
  return id === 'plaza' ? PLAZA_LINE : tierWelcome(id);
}

export const ZONE_IDS = ['hill', 'heights', 'plaza', 'bubble', 'park', 'dump'];
export { TIER_ORDER };

export function setPlayerTeam(ctx, teamId) {
  try {
    if (ctx.world && typeof ctx.world.setPlayerTeam === 'function') ctx.world.setPlayerTeam(teamId === undefined ? null : teamId);
  } catch (err) {
    console.warn('[lw] setPlayerTeam failed', err);
  }
}

/** Which neighborhood the player is standing in right now, or null. */
export function currentZone(ctx) {
  try {
    const p = ctx.player.position;
    if (typeof ctx.terrain.dominantZone === 'function') return ctx.terrain.dominantZone(p.x, p.z);
  } catch (err) { /* unknown */ }
  return null;
}

/** Fade out, move the player, close whatever is open, fade back in. */
export async function travel(ctx, x, z, facing) {
  const { hud, player } = ctx;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  try {
    await hud.fade(true, 170);
    hud.closeAll();
    await player.teleport(x, z, Number.isFinite(facing) ? facing : player.heading, { fade: false });
  } catch (err) {
    console.error('[lw] travel failed', err);
  } finally {
    await hud.fade(false, 260);
  }
  return true;
}

export function travelToHome(ctx, teamId) {
  const h = getHome(ctx, teamId);
  return h ? travel(ctx, h.street.x, h.street.z, h.street.facing) : Promise.resolve(false);
}

export function travelToPlace(ctx, id) {
  const p = places(ctx)[id];
  return p ? travel(ctx, p.x, p.z, p.facing) : Promise.resolve(false);
}

// ---------------------------------------------------------------- idle aerial drift
// Used behind the team picker. The world's own idleCamera wins when it exists.
let idleOwn = false;

export function idleCamera(ctx, on) {
  try {
    if (ctx.world && typeof ctx.world.idleCamera === 'function') {
      ctx.world.idleCamera(!!on);
      return;
    }
  } catch (err) {
    console.warn('[lw] idleCamera failed', err);
  }
  const cam = ctx.camera;
  if (!cam || typeof cam.play !== 'function') return;
  if (!on) {
    if (idleOwn) {
      idleOwn = false;
      try {
        cam.skip();
      } catch (err) { /* nothing playing */ }
    }
    return;
  }
  const road = boulevard(ctx);
  const top = road[0] || [0, 25, -100];
  const mid = road[Math.floor(road.length * 0.45)] || [0, 8, 0];
  idleOwn = true;
  cam.play([{
    dur: 3600,
    ease: 'linear',
    pos: (u, t) => {
      const a = t * 0.045;
      return [mid[0] + Math.sin(a) * 62, top[1] + 46 + Math.sin(a * 0.7) * 5, mid[2] + 96 + Math.cos(a) * 26];
    },
    look: () => [mid[0], mid[1] + 6, mid[2] - 34],
  }], { skippable: false, handoff: 0.01 }).then(() => {
    idleOwn = false;
  });
}
