import test from 'node:test';
import assert from 'node:assert/strict';
import { derive } from '../../world/js/model/derive.js';
import { REGIME_LIMITS } from '../../world/js/model/regime.js';
import { REGIME, TIER_ORDER } from '../../world/js/config.js';
import { makeLeague, makeHistory } from './model-fixtures/make-league.mjs';

const NOW = new Date('2026-11-16T12:00:00Z');
const BAD = /undefined|NaN|null|\[object|—|–/;

function checkRegime(r, model, label) {
  assert.ok(r, `${label}: there is a regime`);
  assert.ok(model.teams[r.teamId], `${label}: the leader is a real team`);
  assert.equal(typeof r.name, 'string');
  assert.ok(r.name.length > 0);
  assert.ok(r.slogans.length >= 5 && r.slogans.length <= 8, `${label}: 5 to 8 slogans`);
  for (const s of r.slogans) {
    assert.ok(s.length <= REGIME_LIMITS.slogan, `${label}: slogan fits: ${s}`);
    assert.equal(s, s.toUpperCase(), `${label}: slogans are capitals`);
    assert.ok(!BAD.test(s), s);
  }
  assert.equal(new Set(r.slogans).size, r.slogans.length);
  assert.ok(r.broadcasts.length >= 6, `${label}: enough announcements`);
  for (const b of r.broadcasts) {
    assert.ok(b.length <= REGIME_LIMITS.broadcast, `${label}: announcement fits: ${b}`);
    assert.ok(!BAD.test(b), b);
  }
  assert.equal(new Set(r.broadcasts).size, r.broadcasts.length);
  assert.equal(r.monument.lines.length, 3);
  for (const s of [r.monument.title, r.monument.plaque, ...r.monument.lines, r.residence, r.portrait.title, r.portrait.caption, r.stateMedia.headline, r.stateMedia.body, r.stateMedia.correction]) {
    assert.ok(typeof s === 'string' && s.length > 3 && !BAD.test(s), `${label}: ${s}`);
  }
  assert.ok(r.stateMedia.headline.length <= REGIME_LIMITS.headline);
  assert.ok(r.stateMedia.body.length <= REGIME_LIMITS.body);
  assert.deepEqual(Object.keys(r.busts).sort(), TIER_ORDER.slice().sort(), `${label}: a bust line per neighborhood`);
  for (const id of model.order) assert.ok(typeof r.doors[id] === 'string' && r.doors[id].length > 5 && !BAD.test(r.doors[id]), `${label}: a door line for team ${id}`);
  assert.equal(Object.keys(r.doors).length, model.order.length);
}

test('regime: the saved data crowns the commissioner, and the copy is clean', async () => {
  const fs = await import('node:fs');
  const league = JSON.parse(fs.readFileSync(new URL('../../world/data/league.json', import.meta.url), 'utf8'));
  const history = JSON.parse(fs.readFileSync(new URL('../../world/data/history.json', import.meta.url), 'utf8'));
  const model = derive(league, history, { now: NOW });
  if (!model.teams[REGIME.teamId]) return; // the configured team is not in this league
  checkRegime(model.regime, model, 'saved data');
  assert.equal(model.regime.teamId, REGIME.teamId);
  assert.equal(model.regime.title, REGIME.title);
  // same data, same propaganda
  assert.deepEqual(derive(league, history, { now: NOW }).regime, model.regime);
});

test('regime: wherever the leader stands, the spin follows the real numbers', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const league = makeLeague({ seed, currentWeek: 10, weekState: seed % 2 ? 'live' : 'pre' });
    const base = derive(league, makeHistory({ seed }), { now: NOW, regime: null });
    assert.equal(base.regime, null, 'null switches the joke off');
    for (const rank of [1, 6, 7, 12]) {
      const id = base.order[rank - 1];
      const model = derive(league, null, { now: NOW, regime: { teamId: id, title: 'Supreme Commissioner' } });
      const r = model.regime;
      checkRegime(r, model, `seed ${seed} rank ${rank}`);
      const t = model.teams[id];
      const all = r.broadcasts.join(' | ');
      if (rank === 1) assert.match(all, /first place/);
      if (rank === 12) assert.match(all, /upside down/);
      if (rank === 7) assert.match(all, /playoff line has been moved/);
      assert.equal(r.slogans[0], rank === 1 ? 'FIRST. AS FORETOLD.' : `${rank === 6 ? '6TH' : rank === 7 ? '7TH' : '12TH'} BY CHOICE`);
      if (t.record.losses > 0 && t.record.wins > 0) assert.ok(all.includes(`Official record: ${t.record.wins + t.record.losses + t.record.ties}-0`));
      if (t.lastWeek && t.lastWeek.won === false) {
        assert.match(r.stateMedia.headline, /Landslide/);
        assert.match(r.stateMedia.correction, /lost by/);
      }
      if (t.lastWeek && t.lastWeek.won === true) assert.match(r.stateMedia.headline, /As Scheduled/);
      assert.match(r.doors[id], /enthusiasm/);
      assert.equal(r.name, t.owner || 'the Commish');
    }
  }
});

test('regime: preseason, a finished season, and a missing leader', () => {
  const pre = makeLeague({ seed: 3, currentWeek: 1, weekState: 'pre' });
  let model = derive(pre, null, { now: new Date('2026-08-20T00:00:00Z'), regime: { teamId: pre.teams[0].id } });
  checkRegime(model.regime, model, 'preseason');
  assert.equal(model.regime.slogans[0], 'FIRST. IN ADVANCE.');
  assert.match(model.regime.stateMedia.headline, /In Advance/);
  const done = makeLeague({ seed: 3, seasonComplete: true });
  model = derive(done, null, { now: NOW, regime: { teamId: done.teams[4].id } });
  checkRegime(model.regime, model, 'finished season');
  // the configured team is not in the league: no statues, no error
  assert.equal(derive(done, null, { now: NOW, regime: { teamId: 9999 } }).regime, null);
  assert.equal(derive({}, null, { now: NOW }).regime, null);
  // a very long team name as the opponent still fits or is left out
  const long = makeLeague({ seed: 5, currentWeek: 10, weekState: 'live' });
  for (const t of long.teams) t.name = 'An Extremely Long Team Name That Goes On And On And On Forever';
  model = derive(long, null, { now: NOW, regime: { teamId: long.teams[0].id } });
  checkRegime(model.regime, model, 'long names');
});
