// Tests for scripts/lib/windows.mjs: "is an NFL game on right now?"
// Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { easternParts, fallbackWindow, inGameWindow, kickoffWindow, POST_KICKOFF_MS, PRE_KICKOFF_MS } from '../lib/windows.mjs';
import { normalizeKickoffs } from '../lib/normalize.mjs';
import { loadFixture } from '../testing/helpers.mjs';

const at = (iso) => new Date(iso);
const MINUTE = 60 * 1000;

test('kickoffs: inside from 30 minutes before kickoff until 4.5 hours after', () => {
  const kickoff = '2026-11-17T01:15:00Z'; // Monday night, 8:15pm Eastern
  const k = Date.parse(kickoff);
  const check = (ms) => inGameWindow(new Date(ms), [kickoff]);
  assert.equal(check(k - PRE_KICKOFF_MS - MINUTE).inWindow, false);
  assert.equal(check(k - PRE_KICKOFF_MS).inWindow, true);
  assert.equal(check(k).inWindow, true);
  assert.equal(check(k + POST_KICKOFF_MS).inWindow, true);
  assert.equal(check(k + POST_KICKOFF_MS + MINUTE).inWindow, false);
  assert.equal(check(k).basis, 'kickoffs');
  assert.equal(PRE_KICKOFF_MS, 30 * MINUTE);
  assert.equal(POST_KICKOFF_MS, 270 * MINUTE);
});

test('kickoffs: any kickoff counts, in any order, and junk entries are ignored', () => {
  const kickoffs = ['2026-11-22T18:00:00Z', 'not a date', null, '2026-11-13T01:15:00Z', 12, '2026-11-17T01:15:00Z'];
  assert.equal(inGameWindow(at('2026-11-13T03:00:00Z'), kickoffs).inWindow, true);
  assert.equal(inGameWindow(at('2026-11-22T17:45:00Z'), kickoffs).inWindow, true);
  const quiet = inGameWindow(at('2026-11-18T15:00:00Z'), kickoffs);
  assert.equal(quiet.inWindow, false);
  assert.equal(quiet.basis, 'kickoffs');
  assert.match(quiet.detail, /next kickoff 2026-11-22T18:00:00Z/);
});

test('kickoffs: saved real kickoffs beat the clock rules', () => {
  // Sunday 1pm Eastern would be a window by the clock, but the saved schedule says no game.
  const sundayAfternoon = at('2026-11-15T18:30:00Z');
  assert.equal(fallbackWindow(sundayAfternoon).inWindow, true);
  assert.equal(inGameWindow(sundayAfternoon, ['2026-11-17T01:15:00Z']).inWindow, false);
});

test('kickoffs: none saved, or only last season saved, falls back to the clock rules', () => {
  const sunday = at('2026-11-15T18:30:00Z');
  for (const saved of [[], null, undefined, 'nope', ['junk']]) {
    const w = inGameWindow(sunday, saved);
    assert.equal(w.basis, 'clock-rules');
    assert.equal(w.inWindow, true);
  }
  assert.equal(kickoffWindow(sunday, []), null);
  const lastSeason = ['2025-09-05T00:20:00Z', '2026-01-04T18:00:00Z'];
  assert.equal(inGameWindow(at('2026-09-13T17:30:00Z'), lastSeason).basis, 'clock-rules');
  // Just after the season ends the saved schedule is still trusted: no games, no window.
  const justOver = inGameWindow(at('2026-01-11T18:30:00Z'), lastSeason);
  assert.deepEqual([justOver.basis, justOver.inWindow], ['kickoffs', false]);
  assert.match(justOver.detail, /no kickoffs left/);
});

test('the placeholder schedule: Monday night Nov 16 2026 is a window, Tuesday morning is not', () => {
  const kickoffs = normalizeKickoffs(loadFixture('pro-schedule-2026.json'));
  assert.equal(inGameWindow(at('2026-11-16T15:00:00Z'), kickoffs).inWindow, false); // Monday 10am Eastern
  assert.equal(inGameWindow(at('2026-11-17T00:50:00Z'), kickoffs).inWindow, true); // 25 minutes before kickoff
  assert.equal(inGameWindow(at('2026-11-17T04:00:00Z'), kickoffs).inWindow, true); // fourth quarter
  assert.equal(inGameWindow(at('2026-11-17T12:00:00Z'), kickoffs).inWindow, false); // Tuesday 7am Eastern
  assert.equal(inGameWindow(at('2026-11-26T17:10:00Z'), kickoffs).inWindow, true); // Thanksgiving early game
  assert.equal(inGameWindow(at('2026-07-04T18:00:00Z'), kickoffs).inWindow, false); // summer
});

test('Eastern clock: daylight saving time is handled', () => {
  // 2026: daylight time ends Sunday Nov 1 at 2am Eastern (06:00 UTC).
  assert.deepEqual(easternParts(at('2026-11-01T05:30:00Z')), { weekday: 0, year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
  assert.deepEqual(easternParts(at('2026-11-01T06:30:00Z')), { weekday: 0, year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
  assert.deepEqual(easternParts(at('2026-11-01T07:30:00Z')), { weekday: 0, year: 2026, month: 11, day: 1, hour: 2, minute: 30 });
  // Midnight is hour 0, not 24, and the date rolls over on the Eastern clock, not UTC.
  assert.deepEqual(easternParts(at('2026-10-05T04:00:00Z')), { weekday: 1, year: 2026, month: 10, day: 5, hour: 0, minute: 0 });
  assert.deepEqual(easternParts(at('2027-01-01T04:59:00Z')), { weekday: 4, year: 2026, month: 12, day: 31, hour: 23, minute: 59 });
  // 2027: daylight time starts Sunday March 14.
  assert.equal(easternParts(at('2027-03-14T06:59:00Z')).hour, 1);
  assert.equal(easternParts(at('2027-03-14T07:00:00Z')).hour, 3);
});

test('clock rules: Sunday 9am Eastern starts the window in daylight time and in standard time', () => {
  // October (UTC-4): 9am Eastern is 13:00 UTC.
  assert.equal(fallbackWindow(at('2026-10-04T12:59:00Z')).inWindow, false);
  assert.equal(fallbackWindow(at('2026-10-04T13:00:00Z')).inWindow, true);
  // December (UTC-5): 9am Eastern is 14:00 UTC.
  assert.equal(fallbackWindow(at('2026-12-06T13:59:00Z')).inWindow, false);
  assert.equal(fallbackWindow(at('2026-12-06T14:00:00Z')).inWindow, true);
  // Sunday runs to midnight and spills to 1am Monday.
  assert.equal(fallbackWindow(at('2026-12-07T04:59:00Z')).inWindow, true); // Sunday 11:59pm
  assert.equal(fallbackWindow(at('2026-12-07T05:30:00Z')).inWindow, true); // Monday 12:30am
  assert.equal(fallbackWindow(at('2026-12-07T06:00:00Z')).inWindow, false); // Monday 1:00am
});

test('clock rules: Thursday night, Monday night, late-season Saturday, Thanksgiving', () => {
  // Thursday Oct 8 2026 (UTC-4): 7pm Eastern is 23:00 UTC.
  assert.equal(fallbackWindow(at('2026-10-08T22:59:00Z')).inWindow, false);
  assert.equal(fallbackWindow(at('2026-10-08T23:00:00Z')).inWindow, true);
  assert.equal(fallbackWindow(at('2026-10-09T03:59:00Z')).inWindow, true); // Thursday 11:59pm
  assert.equal(fallbackWindow(at('2026-10-09T04:00:00Z')).inWindow, false); // Friday midnight: Thursday has no spill
  // Monday Oct 5 2026.
  assert.equal(fallbackWindow(at('2026-10-05T22:59:00Z')).inWindow, false); // 6:59pm
  assert.equal(fallbackWindow(at('2026-10-05T23:00:00Z')).inWindow, true); // 7pm
  assert.equal(fallbackWindow(at('2026-10-06T04:30:00Z')).inWindow, true); // Tuesday 12:30am spill
  assert.equal(fallbackWindow(at('2026-10-06T05:00:00Z')).inWindow, false); // Tuesday 1am
  // Saturdays count only in December and January, from noon.
  assert.equal(fallbackWindow(at('2026-10-10T20:00:00Z')).inWindow, false); // October Saturday 4pm
  assert.equal(fallbackWindow(at('2026-12-19T16:59:00Z')).inWindow, false); // December Saturday 11:59am
  assert.equal(fallbackWindow(at('2026-12-19T17:00:00Z')).inWindow, true); // noon
  assert.equal(fallbackWindow(at('2027-01-09T23:00:00Z')).inWindow, true); // January Saturday 6pm
  // Thanksgiving (Nov 26 2026) starts at noon, an ordinary Thursday does not.
  assert.equal(fallbackWindow(at('2026-11-26T17:30:00Z')).inWindow, true); // 12:30pm
  assert.equal(fallbackWindow(at('2026-11-19T17:30:00Z')).inWindow, false);
  // Quiet days.
  assert.equal(fallbackWindow(at('2026-10-06T23:30:00Z')).inWindow, false); // Tuesday evening
  assert.equal(fallbackWindow(at('2026-10-07T23:30:00Z')).inWindow, false); // Wednesday evening
  assert.equal(fallbackWindow(at('2026-10-09T23:30:00Z')).inWindow, false); // Friday evening
});

test('clock rules: only September through mid February', () => {
  assert.equal(fallbackWindow(at('2026-06-14T18:00:00Z')).inWindow, false); // a June Sunday
  assert.equal(fallbackWindow(at('2026-08-30T18:00:00Z')).inWindow, false); // late August Sunday
  assert.equal(fallbackWindow(at('2026-09-06T18:00:00Z')).inWindow, true); // first September Sunday
  assert.equal(fallbackWindow(at('2027-02-14T23:30:00Z')).inWindow, true); // Sunday Feb 14
  assert.equal(fallbackWindow(at('2027-02-21T23:30:00Z')).inWindow, false); // Sunday Feb 21
  assert.equal(fallbackWindow(at('2027-03-07T18:00:00Z')).inWindow, false);
  assert.match(fallbackWindow(at('2026-06-14T18:00:00Z')).detail, /outside September/);
});
