// The birthday corner's input checks and candle layout (js/art/island-cake.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, cleanAge, candleSpots } from '../js/art/island-cake.js';

test('cleanName keeps letters and spaces, at most 12 characters, else Bailey', () => {
  assert.equal(cleanName('Bailey'), 'Bailey');
  assert.equal(cleanName('  Bailey   Rose '), 'Bailey Rose');
  assert.equal(cleanName('<b>Hi</b>'), 'bHib');
  assert.equal(cleanName('ABCDEFGHIJKLMNOP'), 'ABCDEFGHIJKL');
  assert.equal(cleanName(''), 'Bailey');
  assert.equal(cleanName(null), 'Bailey');
  assert.equal(cleanName(42), 'Bailey');
  assert.equal(cleanName('1234!!'), 'Bailey');
});

test('cleanAge accepts whole numbers from 1 to 99 only', () => {
  assert.equal(cleanAge(11), 11);
  assert.equal(cleanAge('11'), 11);
  for (const bad of [0, -3, 11.5, 100, NaN, null, undefined, 'eleven', Infinity]) assert.equal(cleanAge(bad), null, String(bad));
});

test('one candle per year, all on the top tier, none touching', () => {
  for (const age of [1, 2, 5, 9, 10, 11, 12, 13, 18, 25]) {
    const spots = candleSpots(age, 0.95);
    assert.equal(spots.length, age);
    for (const [x, z] of spots) assert.ok(Math.hypot(x, z) < 0.95 - 0.08, 'on the cake');
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const d = Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]);
        assert.ok(d > 0.12, `candles ${i} and ${j} of ${age} are ${d.toFixed(2)} m apart`);
      }
    }
  }
  assert.deepEqual(candleSpots(0, 1), []);
});
