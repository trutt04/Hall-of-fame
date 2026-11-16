/**
 * windows.mjs
 *
 * "Is an NFL game on right now?" Pure functions, no I/O.
 *
 * The frequent (every 10 minutes) job only does work inside a game window, so ESPN is
 * not polled around the clock. The hourly job ignores this and always runs.
 *
 * Primary rule: use the real kickoff times saved in league.json (nfl.kickoffs).
 *   In a window when any kickoff is between 30 minutes from now and 4.5 hours ago.
 * Fallback (no usable kickoffs saved): US Eastern clock rules for the usual NFL slots.
 */

export const PRE_KICKOFF_MS = 30 * 60 * 1000;
export const POST_KICKOFF_MS = 4.5 * 60 * 60 * 1000;
/** Saved kickoffs older than this are last season's: ignore them and use the clock rules. */
export const STALE_KICKOFFS_MS = 150 * 24 * 60 * 60 * 1000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const easternFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** Wall-clock parts in US Eastern time (handles daylight saving time). weekday: 0 = Sunday. */
export function easternParts(date) {
  const parts = {};
  for (const p of easternFormat.formatToParts(date)) parts[p.type] = p.value;
  return {
    weekday: WEEKDAYS.indexOf(parts.weekday),
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** Clock-rule fallback. Returns { inWindow, detail }. */
export function fallbackWindow(now) {
  const { weekday, month, day, hour } = easternParts(now);
  const inSeason = month >= 9 || month === 1 || (month === 2 && day <= 15);
  if (!inSeason) return { inWindow: false, detail: 'outside September to mid February (Eastern clock rules)' };

  const thanksgiving = weekday === 4 && month === 11 && day >= 22 && day <= 28;
  let slot = null;
  if (weekday === 4 && hour >= 19) slot = 'Thursday night';
  else if (thanksgiving && hour >= 12) slot = 'Thanksgiving';
  else if (weekday === 0 && hour >= 9) slot = 'Sunday';
  else if (weekday === 1 && hour < 1) slot = 'Sunday night (spill past midnight)';
  else if (weekday === 1 && hour >= 19) slot = 'Monday night';
  else if (weekday === 2 && hour < 1) slot = 'Monday night (spill past midnight)';
  else if (weekday === 6 && hour >= 12 && (month === 12 || month === 1)) slot = 'late-season Saturday';

  return slot
    ? { inWindow: true, detail: `${slot} slot (Eastern clock rules)` }
    : { inWindow: false, detail: 'no usual NFL slot right now (Eastern clock rules)' };
}

/** Kickoff-based check. Returns null when there are no usable kickoffs. */
export function kickoffWindow(now, kickoffs) {
  const t = now.getTime();
  const times = (Array.isArray(kickoffs) ? kickoffs : [])
    .map((k) => (typeof k === 'string' || typeof k === 'number' ? new Date(k).getTime() : NaN))
    .filter((ms) => Number.isFinite(ms));
  if (times.length === 0) return null;
  const newest = Math.max(...times);
  if (newest < t - STALE_KICKOFFS_MS) return null; // last season's schedule

  const hit = times.find((k) => k >= t - POST_KICKOFF_MS && k <= t + PRE_KICKOFF_MS);
  if (hit !== undefined) {
    return { inWindow: true, detail: `kickoff at ${new Date(hit).toISOString().replace('.000Z', 'Z')} is in play` };
  }
  const next = times.filter((k) => k > t).sort((a, b) => a - b)[0];
  return {
    inWindow: false,
    detail: next ? `next kickoff ${new Date(next).toISOString().replace('.000Z', 'Z')}` : 'no kickoffs left this season',
  };
}

/**
 * Are we inside a game window?
 * Returns { inWindow, basis: 'kickoffs' | 'clock-rules', detail }.
 */
export function inGameWindow(now, kickoffs) {
  const byKickoff = kickoffWindow(now, kickoffs);
  if (byKickoff) return { ...byKickoff, basis: 'kickoffs' };
  return { ...fallbackWindow(now), basis: 'clock-rules' };
}
