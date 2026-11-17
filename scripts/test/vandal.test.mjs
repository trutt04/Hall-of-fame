import test from 'node:test';
import assert from 'node:assert/strict';
import { derive } from '../../world/js/model/derive.js';
import { buildVandalism, PRESET_TAGS, TAG_MAX, VANDAL_ALLOWANCE } from '../../world/js/model/vandal.js';
import { makeLeague } from './model-fixtures/make-league.mjs';

const NOW = new Date('2026-11-16T12:00:00Z');
const BAD = /undefined|NaN|null|\[object|—|–/;

function checkClean(v, label) {
  const texts = [];
  const walk = (x) => {
    if (typeof x === 'string') texts.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(v.lines);
  for (const r of Object.values(v.rights)) walk(r.tags.map((t) => t.text));
  walk(v.tags.map((t) => t.text));
  for (const s of texts) assert.ok(!BAD.test(s), `${label}: ${s}`);
}

test('vandalism: every winner of the last completed week may hit the home of the team they beat, and nobody else', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const league = makeLeague({ seed, currentWeek: 10, weekState: seed % 2 ? 'live' : 'pre' });
    const model = derive(league, null, { now: NOW });
    const v = model.vandalism;
    assert.ok(v, `seed ${seed}: there is a vandalism block`);
    assert.equal(v.resultWeek, model.lastWeek.week);
    assert.deepEqual(v.allowance, VANDAL_ALLOWANCE);
    const winners = model.order.filter((id) => model.teams[id].lastWeek && model.teams[id].lastWeek.won === true);
    assert.deepEqual(Object.keys(v.rights).sort(), winners.map(String).sort(), 'rights are exactly the winners');
    for (const id of winners) {
      const r = v.rights[id];
      const t = model.teams[id];
      assert.equal(r.targetId, t.lastWeek.oppId, 'the target is the team they beat');
      assert.equal(r.targetId, t.beatLastWeek);
      assert.equal(v.victims[r.targetId], t.id);
      assert.ok(r.tags.length >= 2 && r.tags.every((x) => x.text.length <= TAG_MAX));
      assert.ok(v.lines.start[id].startsWith(`Week ${v.resultWeek}: `));
      assert.ok(v.lines.blurb[id].length > 10);
      assert.ok(v.lines.card.theirs[r.targetId].length > 10);
    }
    for (const id of model.order) {
      if (!winners.includes(id)) assert.equal(v.rights[id], undefined, 'losers get nothing');
    }
    checkClean(v, `seed ${seed}`);
  }
});

test('vandalism: preset tags only, short enough to spray', () => {
  assert.ok(PRESET_TAGS.length >= 6);
  assert.equal(new Set(PRESET_TAGS.map((t) => t.id)).size, PRESET_TAGS.length);
  for (const t of PRESET_TAGS) {
    assert.ok(t.text.length > 0 && t.text.length <= TAG_MAX, t.text);
    assert.equal(t.text, t.text.toUpperCase());
  }
});

test('vandalism: the commissioner gets his own lines, and so does his house', () => {
  const league = makeLeague({ seed: 3, currentWeek: 10 });
  const base = derive(league, null, { now: NOW, regime: null });
  const winner = base.order.find((id) => base.teams[id].lastWeek && base.teams[id].lastWeek.won === true);
  const loser = base.teams[winner].lastWeek.oppId;
  let m = derive(league, null, { now: NOW, regime: { teamId: winner } });
  assert.match(m.vandalism.lines.start[winner], /urban planning/);
  m = derive(league, null, { now: NOW, regime: { teamId: loser } });
  assert.ok(m.vandalism.lines.residence.egg.length > 0);
  assert.doesNotMatch(m.vandalism.lines.start[winner], /urban planning/);
});

test('vandalism: nothing before week 1, nothing without results, never an error', () => {
  const pre = makeLeague({ seed: 3, currentWeek: 1, weekState: 'pre' });
  assert.equal(derive(pre, null, { now: new Date('2026-08-20T00:00:00Z') }).vandalism, null);
  assert.equal(derive({}, null, { now: NOW }).vandalism, null);
  assert.equal(buildVandalism(null), null);
  assert.equal(buildVandalism({ teams: {}, order: [] }), null);
  assert.equal(buildVandalism({ teams: {}, order: [], lastWeek: { week: 0 } }), null);
  // a finished season: the champion's rights last until next season
  const done = makeLeague({ seed: 4, seasonComplete: true });
  const m = derive(done, null, { now: NOW });
  if (m.vandalism) {
    for (const s of Object.values(m.vandalism.lines.start)) assert.match(s, /until next season|urban planning/);
  }
});

test('vandalism: the saved sample data gives team 1 the trailer of team 4', async () => {
  const fs = await import('node:fs');
  const league = JSON.parse(fs.readFileSync(new URL('../../world/data/league.json', import.meta.url), 'utf8'));
  if (league.source === 'espn') return;
  const model = derive(league, null, { now: NOW });
  const v = model.vandalism;
  assert.equal(v.rights[1].targetId, 4);
  assert.match(v.lines.start[1], /urban planning/, 'team 1 is the Supreme Commissioner in config.js');
  assert.ok(v.lines.blurb[1].startsWith('The trailer of '));
});
