// "Since you were last here": what changed for this member since their last visit.
// The last visit is one small JSON record in localStorage (STORAGE_KEYS.lastSeen): the model
// snapshot from roasts.js plus the team id. Storage may be unavailable; then there is simply no recap.

import { STORAGE_KEYS } from '../config.js';
import { snapshot, recapChanges } from '../model/roasts.js';
import { loadJson, saveJson } from './dom.js';

const MAX_LINES = 5;

/** The stored record of the last visit, or null. */
export function readLastSeen() {
  const v = loadJson(STORAGE_KEYS.lastSeen);
  return v && typeof v === 'object' && v.teams && typeof v.teams === 'object' ? v : null;
}

export function saveLastSeen(model, teamId) {
  if (!model || teamId === null || teamId === undefined) return false;
  try {
    return saveJson(STORAGE_KEYS.lastSeen, Object.assign(snapshot(model), { teamId, seenAt: Date.now() }));
  } catch (err) {
    return false;
  }
}

/** Opens the recap card when there is something to say. Returns true if it opened. */
export function showRecap(ctx, model, teamId, prev) {
  if (!prev || prev.teamId !== teamId) return false;
  let lines = [];
  try {
    lines = recapChanges(prev, model, teamId) || [];
  } catch (err) {
    lines = [];
  }
  if (!lines.length) return false;
  const team = model.teams[teamId];
  ctx.hud.openCard({
    kicker: 'Since you were last here',
    title: prev.week && prev.week !== model.meta.week ? 'Week ' + model.meta.week + ' report' : 'While you were out',
    lines: lines.slice(0, MAX_LINES),
    accentColor: team ? team.color : undefined,
    actions: [{ label: 'Got it' }],
  });
  return true;
}
