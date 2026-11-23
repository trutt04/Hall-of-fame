// Birthday mode: is today the day, how old, how many days to go, and is it birthday week. Pure.
//
//   BIRTHDAY_WEEK = { before: 3, after: 3 }
//   birthdayInfo(date = new Date(), birthday = BIRTHDAY, week = BIRTHDAY_WEEK) -> {
//     enabled,         false while month or day is null or invalid; then everything below is off
//     isBirthday,      true on the day itself
//     age,             completed years today (the new age on the day itself), or null without a year
//     turning,         the age at the next birthday (today's, on the day), or null without a year
//     daysUntil,       whole days until the next birthday: 0 on the day (null when disabled)
//     daysSince,       whole days since the last birthday: 0 on the day (null when disabled)
//     isBirthdayWeek,  the 7 days around it: 3 days before, the day itself and 3 days after
//     name,            the birthday person's first name
//   }
//   isLeapYear(year), celebrationDay(year, month, day)
//
// The private gift link can carry the date instead of js/config.js (js/core/gift.js giftBirthday,
// which main.js passes here), so her birthday never has to go in the public repo.
// Dates are read on the device's local calendar (getFullYear, getMonth, getDate), so the party
// starts at local midnight wherever the family plays. Day counts use calendar days, so daylight
// saving changes never shift them. A Feb 29 birthday is celebrated on Feb 28 in other years.

import { BIRTHDAY } from '../config.js';

export const BIRTHDAY_WEEK = Object.freeze({ before: 3, after: 3 });

const DAY_MS = 86400000;
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function celebrationDay(year, month, day) {
  return month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
}

const dayNumber = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

function off(name) {
  return { enabled: false, isBirthday: false, age: null, turning: null, daysUntil: null, daysSince: null, isBirthdayWeek: false, name };
}

export function birthdayInfo(date = new Date(), birthday = BIRTHDAY, week = BIRTHDAY_WEEK) {
  const b = birthday && typeof birthday === 'object' ? birthday : {};
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : null;
  const now = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(now.getTime())) return off(name);
  const { month, day } = b;
  if (!isInt(month) || month < 1 || month > 12) return off(name);
  if (!isInt(day) || day < 1 || day > MONTH_DAYS[month - 1]) return off(name);

  const Y = now.getFullYear();
  const today = dayNumber(Y, now.getMonth() + 1, now.getDate());
  const at = (y) => dayNumber(y, month, celebrationDay(y, month, day));
  const thisYear = at(Y);
  let daysUntil;
  let daysSince;
  if (today === thisYear) {
    daysUntil = 0;
    daysSince = 0;
  } else if (today < thisYear) {
    daysUntil = thisYear - today;
    daysSince = today - at(Y - 1);
  } else {
    daysSince = today - thisYear;
    daysUntil = at(Y + 1) - today;
  }

  let age = null;
  let turning = null;
  if (isInt(b.year) && b.year > 1900) {
    const completed = Y - b.year - (today < thisYear ? 1 : 0);
    if (completed >= 0) {
      age = completed;
      turning = daysUntil === 0 ? completed : completed + 1;
    }
  }

  const before = Math.max(0, Number(week && week.before) || 0);
  const after = Math.max(0, Number(week && week.after) || 0);
  return {
    enabled: true,
    isBirthday: daysUntil === 0,
    age,
    turning,
    daysUntil,
    daysSince,
    isBirthdayWeek: daysUntil <= before || daysSince <= after,
    name,
  };
}
