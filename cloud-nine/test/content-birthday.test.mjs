import test from 'node:test';
import assert from 'node:assert/strict';
import { BIRTHDAY } from '../js/config.js';
import { birthdayInfo, isLeapYear, celebrationDay, BIRTHDAY_WEEK } from '../js/content/birthday.js';

const B = { name: 'Bailey', month: 11, day: 24, year: 2015 };
const local = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0);

test('birthday: the null placeholders keep birthday mode off', () => {
  assert.equal(BIRTHDAY.month, null, 'config still has placeholders (update this test once the owner fills them in)');
  for (const date of [new Date(), local(2026, 11, 24), local(2027, 2, 28)]) {
    const info = birthdayInfo(date);
    assert.deepEqual(info, {
      enabled: false, isBirthday: false, age: null, turning: null, daysUntil: null, daysSince: null, isBirthdayWeek: false, name: 'Bailey',
    });
  }
  assert.equal(birthdayInfo().enabled, false, 'no date means today');
});

test('birthday: on the day, before and after', () => {
  const on = birthdayInfo(local(2026, 11, 24), B);
  assert.deepEqual(on, { enabled: true, isBirthday: true, age: 11, turning: 11, daysUntil: 0, daysSince: 0, isBirthdayWeek: true, name: 'Bailey' });
  const before = birthdayInfo(local(2026, 11, 22), B);
  assert.equal(before.isBirthday, false);
  assert.equal(before.daysUntil, 2);
  assert.equal(before.age, 10);
  assert.equal(before.turning, 11);
  const after = birthdayInfo(local(2026, 11, 25), B);
  assert.equal(after.daysSince, 1);
  assert.equal(after.daysUntil, 364);
  assert.equal(after.age, 11);
  assert.equal(after.turning, 12);
});

test('birthday: the week is 3 days before to 3 days after', () => {
  assert.deepEqual(BIRTHDAY_WEEK, { before: 3, after: 3 });
  const week = (d) => birthdayInfo(local(2026, 11, d), B).isBirthdayWeek;
  assert.deepEqual([20, 21, 22, 23, 24, 25, 26, 27, 28].map(week), [false, true, true, true, true, true, true, true, false]);
  assert.equal(birthdayInfo(local(2026, 11, 23), B, { before: 0, after: 0 }).isBirthdayWeek, false);
  assert.equal(birthdayInfo(local(2026, 11, 30), B, { before: 0, after: 7 }).isBirthdayWeek, true);
});

test('birthday: counting across New Year', () => {
  const jan2 = { name: 'Bailey', month: 1, day: 2, year: 2016 };
  const eve = birthdayInfo(local(2026, 12, 31), jan2);
  assert.equal(eve.daysUntil, 2);
  assert.equal(eve.isBirthdayWeek, true);
  assert.equal(eve.turning, 11);
  const dec30 = { name: 'Bailey', month: 12, day: 30, year: 2015 };
  const ny = birthdayInfo(local(2027, 1, 1), dec30);
  assert.equal(ny.daysSince, 2);
  assert.equal(ny.isBirthdayWeek, true);
  assert.equal(ny.age, 11);
});

test('birthday: Feb 29 is celebrated on Feb 28 in other years', () => {
  assert.ok(isLeapYear(2028) && isLeapYear(2000) && !isLeapYear(2027) && !isLeapYear(1900));
  assert.equal(celebrationDay(2027, 2, 29), 28);
  assert.equal(celebrationDay(2028, 2, 29), 29);
  assert.equal(celebrationDay(2027, 3, 1), 1);
  const leapling = { name: 'Bailey', month: 2, day: 29, year: 2016 };
  const y27 = birthdayInfo(local(2027, 2, 28), leapling);
  assert.equal(y27.isBirthday, true);
  assert.equal(y27.age, 11);
  assert.equal(birthdayInfo(local(2027, 3, 1), leapling).daysSince, 1);
  assert.equal(birthdayInfo(local(2027, 2, 27), leapling).daysUntil, 1);
  const y28 = birthdayInfo(local(2028, 2, 29), leapling);
  assert.equal(y28.isBirthday, true);
  assert.equal(y28.age, 12);
  const eve28 = birthdayInfo(local(2028, 2, 28), leapling);
  assert.equal(eve28.isBirthday, false);
  assert.equal(eve28.daysUntil, 1);
  assert.equal(eve28.age, 11);
  assert.equal(birthdayInfo(local(2028, 3, 1), leapling).daysUntil, 364, 'next one is Feb 28, 2029');
});

test('birthday: uses the local calendar date, any time of day, in any time zone', () => {
  const saved = process.env.TZ;
  try {
    for (const tz of ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      process.env.TZ = tz;
      assert.equal(birthdayInfo(new Date(2026, 10, 24, 0, 1), B).isBirthday, true, `${tz}: just after midnight`);
      assert.equal(birthdayInfo(new Date(2026, 10, 24, 23, 59), B).isBirthday, true, `${tz}: just before midnight`);
      assert.equal(birthdayInfo(new Date(2026, 10, 23, 23, 59), B).daysUntil, 1, `${tz}: the night before`);
      // Daylight saving ends on Nov 1, 2026 in the US and begins on Mar 8, 2026: day counts don't drift.
      assert.equal(birthdayInfo(new Date(2026, 9, 30, 23, 30), B).daysUntil, 25, `${tz}: across the clock change`);
      assert.equal(birthdayInfo(new Date(2026, 2, 7, 0, 30), { name: 'B', month: 3, day: 9, year: 2015 }).daysUntil, 2, tz);
    }
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14: already Nov 24 there
    assert.equal(birthdayInfo(new Date(Date.UTC(2026, 10, 23, 11, 0)), B).isBirthday, true);
    process.env.TZ = 'Pacific/Pago_Pago'; // UTC-11: still Nov 23 there
    assert.equal(birthdayInfo(new Date(Date.UTC(2026, 10, 24, 10, 0)), B).isBirthday, false);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test('birthday: odd settings and dates turn it off instead of breaking', () => {
  for (const bad of [
    { month: 13, day: 1 }, { month: 0, day: 1 }, { month: 4, day: 31 }, { month: 2, day: 30 }, { month: '11', day: 24 },
    { month: 11, day: 24.5 }, { month: NaN, day: 3 }, { month: 11 }, {}, null, 'Nov 24',
  ]) {
    assert.equal(birthdayInfo(local(2026, 11, 24), bad).enabled, false, JSON.stringify(bad));
  }
  assert.equal(birthdayInfo('not a date', B).enabled, false);
  assert.equal(birthdayInfo(new Date(NaN), B).enabled, false);
  assert.equal(birthdayInfo(local(2026, 11, 24).getTime(), B).isBirthday, true, 'a timestamp works too');
  const noYear = birthdayInfo(local(2026, 11, 24), { name: 'Bailey', month: 11, day: 24, year: null });
  assert.equal(noYear.isBirthday, true);
  assert.equal(noYear.age, null);
  assert.equal(noYear.turning, null);
  assert.equal(birthdayInfo(local(2026, 11, 24), { ...B, year: 2030 }).age, null, 'a birth year in the future');
  assert.equal(birthdayInfo(local(2026, 11, 24), { ...B, name: '  ' }).name, null);
});
