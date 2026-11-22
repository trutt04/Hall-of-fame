// The game layer's pure side (js/play/logic.js): test switches, fx over the network (cleaning,
// batching, the rate-limited outbox), music, splashes, poses, hype lines, tags and aiming.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAY_KINDS, parseSwitches, gameSettings, soloBots, cleanFx, cleanBatch, shareFx, packFx, createOutbox,
  musicFor, splashFor, forcedAnim, hypeFor, toastPriority, burstStyle, pickAim, holdAnim, isOneShot,
  gameClock, isTeamGame, leaveCopy, trimBoard, tagStyle, COPY,
} from '../js/play/logic.js';
import { MODES, settingsFor } from '../js/games/index.js';
import { HYPE_LINES } from '../js/content/hype.js';
import { copyProblems } from './content-copy-rules.mjs';

test('the four games are the GAMES modes', () => {
  assert.deepEqual([...PLAY_KINDS].sort(), Object.keys(MODES).sort());
});

test('test switches: game, bots, speed, quick, bot level', () => {
  assert.deepEqual(parseSwitches('?solo=1&game=hideSeek&bots=5'), { game: 'hideSeek', bots: 5, speed: 1, quick: false, botLevel: null });
  const s = parseSwitches('?game=dodgeball&bots=40&speed=4&quick=1&botLevel=easy');
  assert.equal(s.game, 'dodgeball');
  assert.equal(s.bots, 9, 'at most 9 bot friends (10 players)');
  assert.equal(s.speed, 4);
  assert.equal(s.quick, true);
  assert.equal(s.botLevel, 'easy');
  const bad = parseSwitches('?game=__proto__&bots=-3&speed=999&botLevel=evil');
  assert.equal(bad.game, null);
  assert.equal(bad.bots, null);
  assert.equal(bad.speed, 10);
  assert.equal(bad.botLevel, null);
  assert.equal(parseSwitches('').game, null);
  assert.equal(parseSwitches(undefined).speed, 1);
});

test('quick settings are real options of each game', () => {
  for (const kind of PLAY_KINDS) {
    const raw = gameSettings(kind, { quick: true, botLevel: 'hard' });
    const clean = settingsFor(kind, raw);
    for (const [k, v] of Object.entries(raw)) assert.equal(clean[k], v, `${kind}.${k} = ${v} is an option`);
    assert.equal(clean.botLevel, 'hard');
  }
  assert.deepEqual(gameSettings('dodgeball', {}), {});
});

test('solo games get bot friends', () => {
  assert.equal(soloBots('dodgeball', {}), 5);
  assert.equal(soloBots('hideSeek', { bots: 3 }), 3);
  assert.equal(soloBots('captureBow', { bots: 0 }), 1, 'every game needs somebody to play with');
  assert.equal(soloBots('freezeTag', { bots: 12 }), 9);
});

test('fx from the network are cleaned field by field', () => {
  const f = cleanFx({ type: 'found', ids: ['a1', 'b2', '<img>', 7], x: 1.234, z: 1e9, sfx: 'found', burst: true, hype: 'found', evil: 'x', n: 6 });
  assert.deepEqual(f, { type: 'found', sfx: 'found', hype: 'found', x: 1.23, z: 500, burst: true, ids: ['a1', 'b2'], n: 6 });
  assert.equal(cleanFx({ type: 'te leport' }), null);
  assert.equal(cleanFx(null), null);
  assert.equal(cleanFx({ type: 'teleport', id: 'p1', x: 1 }), null, 'a teleport needs a place');
  assert.deepEqual(cleanFx({ type: 'teleport', id: 'p1', x: 1, z: 2, facing: 0.5 }), { type: 'teleport', id: 'p1', x: 1, z: 2, facing: 0.5 });
  const h = cleanFx({ type: 'hint', spots: [{ x: 1, z: 2 }, { x: 'no' }, ...Array(20).fill({ x: 0, z: 0 })] });
  assert.equal(h.spots.length, 9, 'ten at most are read, the broken one is dropped');
  assert.equal(cleanFx({ type: 'win', winner: 'everyone' }).winner, undefined);
  assert.equal(cleanFx({ type: 'win', winner: 1 }).winner, 1);
  assert.equal(cleanFx({ type: 'phase', phase: 'party' }).phase, undefined);
  assert.equal(cleanFx({ type: 'x', id: '__proto__' }).id, undefined);
});

test('fx batches: a game id and a list, or nothing', () => {
  assert.equal(cleanBatch(null), null);
  assert.equal(cleanBatch({ g: 'Bad Id', f: [] }), null);
  assert.equal(cleanBatch({ g: 'abc123', f: 'no' }), null);
  const b = cleanBatch({ g: 'abc123', f: [{ type: 'count', n: 5, sfx: 'count' }, { nope: 1 }] });
  assert.equal(b.g, 'abc123');
  assert.equal(b.f.length, 1);
});

test('the host shares fx, but not a bot teleport', () => {
  assert.equal(shareFx({ type: 'teleport', id: 'b1' }, true), false);
  assert.equal(shareFx({ type: 'teleport', id: 'p1' }, false), true);
  assert.equal(shareFx({ type: 'hit', ids: ['b1', 'p1'] }, true), true);
  assert.equal(shareFx({ type: 'join', id: 'b1' }, true), false);
  assert.equal(shareFx(null, false), false);
});

test('fx batches fit in one network event (1 KB)', () => {
  const list = [];
  for (let i = 0; i < 30; i++) list.push({ type: 'teleport', id: 'player-with-a-long-id-' + i, x: 12.34, z: -56.78, facing: 1.57 });
  const batches = packFx(list, 'abc123', 900);
  assert.ok(batches.length > 1, 'split into several');
  let n = 0;
  for (const b of batches) {
    assert.ok(JSON.stringify(b).length <= 900, 'each batch is small enough');
    assert.equal(b.g, 'abc123');
    n += b.f.length;
  }
  assert.equal(n, 30, 'nothing lost');
  // a win with ten long ids loses its id list rather than the whole batch
  const ids = Array.from({ length: 10 }, (_, i) => 'x'.repeat(60) + i);
  const [w] = packFx([{ type: 'win', winner: 0, ids, sfx: 'tada' }], 'g1', 400);
  assert.equal(w.f[0].ids.length, 2);
});

test('the outbox batches fx and waits when the net says no', () => {
  const sent = [];
  let open = true;
  const box = createOutbox({ send: (b) => (open ? (sent.push(b), true) : false), gapMs: 150 });
  box.push({ type: 'count', n: 5 });
  box.push({ type: 'count', n: 6 });
  assert.equal(box.flush(1000, 'g1'), 2);
  assert.equal(sent.length, 1, 'one event for both');
  box.push({ type: 'count', n: 7 });
  assert.equal(box.flush(1100, 'g1'), 0, 'too soon: waits for the gap');
  open = false;
  assert.equal(box.flush(1200, 'g1'), 0, 'refused (rate limit)');
  assert.equal(box.size, 1, 'kept for the next try');
  open = true;
  assert.equal(box.flush(1400, 'g1'), 1);
  assert.equal(box.size, 0);
  for (let i = 0; i < 100; i++) box.push({ type: 'bounce' });
  assert.ok(box.size <= 48, 'a capped queue');
  box.clear();
  assert.equal(box.size, 0);
});

test('music: the game beat, tense seeking, a victory sting', () => {
  assert.equal(musicFor('dodgeball', 'countdown'), 'game');
  assert.equal(musicFor('hideSeek', 'hide'), 'game');
  assert.equal(musicFor('hideSeek', 'play'), 'tense');
  assert.equal(musicFor('freezeTag', 'play'), 'game');
  assert.equal(musicFor('captureBow', 'results'), 'victory');
  assert.equal(musicFor('captureBow', 'lobby'), 'game');
  assert.equal(musicFor('dodgeball', 'play', { spectator: true }), 'island');
});

test('splashes: the countdown counts, results linger, the blindfold shows its own count', () => {
  const c = splashFor({ phase: 'countdown', round: 1, big: { text: '5', sub: 'Get ready!' } });
  assert.equal(c.text, '5');
  assert.ok(c.ms < 750, 'gone before the next count');
  const r = splashFor({ phase: 'results', round: 2, big: { text: 'Team Pink wins!', sub: 'So close!' } });
  assert.ok(r.ms >= 3000);
  assert.notEqual(c.key, r.key);
  assert.equal(splashFor({ phase: 'hide', round: 1, blind: true, big: { text: '27', sub: 'No peeking!' } }), null);
  assert.equal(splashFor({ phase: 'play', big: null }), null);
  assert.equal(splashFor(null), null);
});

test('forced anims: who().anim wins, the pose only when still, my own reaction is left alone', () => {
  assert.equal(forcedAnim({ anim: 'frozen', pose: null }), 'frozen');
  assert.equal(forcedAnim({ anim: null, pose: 'hide' }, { still: true }), 'hide');
  assert.equal(forcedAnim({ anim: null, pose: 'hide' }, { still: false }), null);
  assert.equal(forcedAnim({ anim: 'cheer' }, { react: true }), null);
  assert.equal(forcedAnim(null), null);
  assert.equal(holdAnim('throw') > 0.5, true);
  assert.equal(holdAnim('walk'), 0);
  assert.equal(isOneShot('dodge'), true);
  assert.equal(isOneShot('run'), false);
});

test('hype lines talk to the player whose screen shows them', () => {
  const info = { kind: 'hideSeek', name: (id) => ({ a: 'Ava', b: 'Bea' })[id] || 'A friend', teamOf: (id) => ({ a: 0, b: 1, c: 0 })[id] ?? null };
  assert.deepEqual(hypeFor({ type: 'found', ids: ['a', 'b'] }, 'a', info), { situation: 'found', ctx: { target: 'Bea' } });
  assert.deepEqual(hypeFor({ type: 'found', ids: ['a', 'b'] }, 'b', info), { situation: 'gotFound', ctx: { seeker: 'Ava' } });
  assert.equal(hypeFor({ type: 'found', ids: ['a', 'b'] }, 'c', info), null);
  assert.equal(hypeFor({ type: 'freeze', ids: ['a', 'b'] }, 'b', info).situation, 'freeze');
  assert.equal(hypeFor({ type: 'freeze', ids: ['a', 'b'] }, 'a', info).situation, 'tag');
  assert.equal(hypeFor({ type: 'unfreeze', ids: ['a', 'b'] }, 'a', info).situation, 'unfreeze');
  assert.equal(hypeFor({ type: 'unfreeze', ids: ['a', 'b'] }, 'b', info).situation, 'unfrozen');
  assert.equal(hypeFor({ type: 'hit', ids: ['a', 'b'] }, 'b', info).situation, 'hit');
  assert.equal(hypeFor({ type: 'hit', ids: ['a', 'b'] }, 'a', info).situation, 'hitThem');
  assert.equal(hypeFor({ type: 'catch', ids: ['a', 'b'] }, 'a', info).situation, 'catch');
  assert.equal(hypeFor({ type: 'bowGrab', ids: ['b'], team: 0 }, 'c', info).situation, 'bowTaken', 'they grabbed our bow');
  assert.equal(hypeFor({ type: 'bowGrab', ids: ['a'], team: 1 }, 'a', info).situation, 'grab');
  assert.equal(hypeFor({ type: 'score', ids: ['a'], team: 0 }, 'c', info).situation, 'score');
  assert.equal(hypeFor({ type: 'score', ids: ['b'], team: 1 }, 'c', info), null);
  const team = { ...info, kind: 'dodgeball' };
  assert.equal(hypeFor({ type: 'win', winner: 0, ids: ['a', 'c'] }, 'c', team).situation, 'win');
  assert.equal(hypeFor({ type: 'win', winner: 0, ids: ['a', 'c'] }, 'b', team).situation, 'lose');
  assert.equal(hypeFor({ type: 'win', winner: 'tie', ids: [] }, 'b', team).situation, 'tie');
  assert.equal(hypeFor({ type: 'win', winner: 'none', ids: [] }, 'b', team), null);
  assert.equal(hypeFor({ type: 'phase', phase: 'hide' }, 'a', { ...info, isSeeker: true }).situation, 'seeker');
  assert.equal(hypeFor({ type: 'phase', phase: 'hide' }, 'b', { ...info, seekerName: 'Ava' }).ctx.seeker, 'Ava');
  assert.equal(hypeFor({ type: 'phase', phase: 'play' }, 'a', { kind: 'freezeTag', isIt: true }).situation, 'it');
  // every situation used here has lines (Contract 8)
  for (const s of ['found', 'gotFound', 'freeze', 'tag', 'unfreeze', 'unfrozen', 'hit', 'hitThem', 'catch', 'grab', 'bowTaken', 'score', 'win', 'lose', 'tie', 'seeker', 'hiding', 'it']) {
    assert.ok(Array.isArray(HYPE_LINES[s]) && HYPE_LINES[s].length > 0, s + ' has hype lines');
  }
});

test('toasts: about me always, the rest when it is quiet', () => {
  const info = { kind: 'dodgeball', teamOf: (id) => ({ me: 0, x: 0 })[id] ?? null };
  assert.equal(toastPriority({ type: 'hit', ids: ['b', 'me'] }, 'me', info), 2);
  assert.equal(toastPriority({ type: 'hit', ids: ['b', 'c'] }, 'me', info), 1);
  assert.equal(toastPriority({ type: 'count', n: 5 }, 'me', info), 0);
  assert.equal(toastPriority({ type: 'teleport', id: 'me' }, 'me', info), 0);
  assert.equal(toastPriority({ type: 'back', id: 'me' }, 'me', info), 0, 'the Back in! splash says it');
  assert.equal(toastPriority({ type: 'back', id: 'x' }, 'me', info), 1);
  assert.equal(toastPriority({ type: 'score', ids: ['q'], team: 1 }, 'me', info), 2, 'big news');
  assert.equal(toastPriority({ type: 'win', winner: 1 }, 'me', info), 2);
  assert.equal(toastPriority(null, 'me', info), 0);
});

test('bursts get colours that fit the moment', () => {
  assert.ok(burstStyle({ type: 'freeze' }).colors.includes('#9fd8ff'), 'icy');
  assert.ok(burstStyle({ type: 'score', team: 1 }).colors.includes('#7b5cff'), 'team colour');
  assert.equal(burstStyle({ type: 'bounce' }), null);
  assert.deepEqual(burstStyle({ type: 'other', burst: true }), { count: 26 });
});

test('auto-aim prefers the friend in front, then the closest', () => {
  const me = { x: 0, z: 0 };
  const opp = [{ id: 'behind', x: 0, z: -3 }, { id: 'ahead', x: 0.5, z: 5 }, { id: 'side', x: 6, z: 0 }];
  assert.equal(pickAim(me, 0, opp), 'ahead');
  assert.equal(pickAim(me, Math.PI, opp), 'behind');
  assert.equal(pickAim(me, 0, []), null);
  assert.equal(pickAim(me, 0, [{ id: 'bad', x: NaN, z: 1 }]), null);
});

test('a faster clock for solo tests, the shared clock otherwise', () => {
  let t = 1000;
  const base = () => t;
  assert.equal(gameClock(base, 1), base);
  const fast = gameClock(base, 4, 1000);
  t = 1500;
  assert.equal(fast(), 3000);
});

test('scoreboards: the leaders and me', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, label: id, value: 5 - i, me: id === 'e' }));
  const t = trimBoard({ title: 'Points', rows }, 3);
  assert.deepEqual(t.rows.map((r) => r.id), ['a', 'b', 'e']);
  assert.equal(trimBoard({ rows: rows.slice(0, 2) }, 3).rows.length, 2);
  const mine = trimBoard({ rows: rows.map((r) => ({ ...r, me: r.id === 'a' })) }, 3);
  assert.deepEqual(mine.rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(trimBoard(null), null);
});

test('role tags: team colours, "it", frozen, the seeker', () => {
  assert.equal(tagStyle('dodgeball', { team: 0, role: 'player' }).icon, 'heart');
  assert.equal(tagStyle('captureBow', { team: 1, role: 'player' }).icon, 'star');
  assert.equal(tagStyle('captureBow', { team: 1, role: 'carrier', carrying: 'bow0' }).icon, 'bow');
  assert.equal(tagStyle('dodgeball', { team: 1, role: 'out' }).color, '#cdb4ff');
  assert.equal(tagStyle('freezeTag', { role: 'it' }).icon, 'star');
  assert.equal(tagStyle('freezeTag', { role: 'frozen' }).icon, 'snow');
  assert.equal(tagStyle('freezeTag', { role: 'runner' }), null);
  assert.equal(tagStyle('hideSeek', { role: 'seeker' }).icon, 'eye');
  assert.equal(tagStyle('hideSeek', { role: 'hider' }), null);
  assert.equal(tagStyle('dodgeball', { team: null }), null);
  assert.ok(isTeamGame('captureBow') && !isTeamGame('hideSeek'));
});

test('every word on screen is kind (house copy rules)', () => {
  const all = [];
  for (const o of [{ solo: true }, { host: true }, {}]) {
    const c = leaveCopy(o);
    all.push(c.kicker, c.title, c.yes, c.no, ...c.lines);
  }
  all.push(...Object.values(COPY));
  for (const s of all) assert.deepEqual(copyProblems(s, 'play', { praise: true, max: 120 }), []);
  assert.equal(leaveCopy({ host: true }).yes, 'End game');
  assert.equal(leaveCopy({ solo: true, host: true }).yes, 'Leave game');
});
