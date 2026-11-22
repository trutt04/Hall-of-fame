// End-of-round awards (GAMES): every player, bots included, gets one small fun award at the
// results, picked from the stats the rules already keep (finds, freezes, rescues, catches, bows).
// Only award ids travel in the shared state; the words live here, so nothing typed ever travels.
//
//   AWARDS                          { id: { title, line, icon } }   icon: a HUD icon name
//   pickAwards(order, candidates) -> { [playerId]: awardId }      everybody in `order` gets one
//       candidates: [{ id: awardId, score(playerId) -> number, many? }] in the mode's priority order.
//       Pass 1: each award goes to its best scorer (score > 0) who has none yet. Pass 2: `many`
//       awards (stayed hidden, still in, still free) also go to others who earned them, up to half
//       the players (so a round where everyone is still in doesn't hand out ten of the same).
//       Pass 3: the rest get a cheer-squad award (Full out!, Team spirit...), spread round.
//   cleanAwards(raw, players) -> { [playerId]: awardId } | null     untrusted state in, known ids only
//   awardRows(awards, order, nameOf, me) -> { mine, rows }          what the results card shows

import { cleanId, isObj, own } from './common.js';

export const AWARDS = Object.freeze({
  // hide and seek
  sneaky: { title: 'Sneakiest hider', line: 'Nobody could find you!', icon: 'eyes' },
  eagle: { title: 'Eagle eyes', line: 'You found the most friends!', icon: 'crown' },
  helper: { title: 'Super seeker', line: 'Found, then found friends too!', icon: 'sparkle' },
  almost: { title: 'Almost made it', line: 'Hidden until the very end!', icon: 'eyes' },
  // freeze tag
  freezer: { title: 'Freeze champ', line: 'Brrr! The most freezes!', icon: 'snow' },
  saver: { title: 'Super saver', line: 'You unfroze your friends!', icon: 'hand' },
  speedy: { title: 'Speedy runner', line: 'Too quick to catch!', icon: 'star' },
  poser: { title: 'Best freeze pose', line: 'What a cheer pose!', icon: 'snow' },
  // dodgeball
  catcher: { title: 'Catch champ', line: 'What a catch!', icon: 'hand' },
  thrower: { title: 'Ace thrower', line: 'Right on target!', icon: 'ball' },
  dodger: { title: 'Dodge master', line: 'Still in at the end!', icon: 'star' },
  matTalk: { title: 'Mat talk MVP', line: 'The loudest cheers from the bench!', icon: 'people' },
  // capture the bow
  bowBoss: { title: 'Bow boss', line: 'You brought their bow home!', icon: 'crown' },
  guard: { title: 'Great guard', line: 'Tag, tag, tag! Super guarding!', icon: 'flag' },
  bowSaver: { title: 'Bow saver', line: 'You sent your bow home!', icon: 'hand' },
  grabber: { title: 'Sneaky grabber', line: 'You snatched their bow!', icon: 'bow' },
  // the cheer squad: for everyone else
  fullOut: { title: 'Full out!', line: 'Max energy all round!', icon: 'star' },
  spirit: { title: 'Team spirit', line: 'Cheering everyone on!', icon: 'sparkle' },
  hustle: { title: 'Great hustle', line: 'You never stopped moving!', icon: 'play' },
  hype: { title: 'Hype squad', line: 'You brought the hype!', icon: 'music' },
});

const SQUAD = ['fullOut', 'spirit', 'hustle', 'hype'];

export function pickAwards(order, candidates) {
  const out = {};
  const ids = Array.isArray(order) ? order : [];
  const list = Array.isArray(candidates) ? candidates.filter((c) => c && own(AWARDS, c.id) && typeof c.score === 'function') : [];
  const scoreOf = (c, id) => {
    try {
      const v = Number(c.score(id));
      return Number.isFinite(v) ? v : 0;
    } catch (err) {
      return 0;
    }
  };
  const given = new Set();
  for (const c of list) {
    let best = null;
    let bestScore = 0;
    for (const id of ids) {
      if (own(out, id)) continue;
      const s = scoreOf(c, id);
      if (s > bestScore) {
        bestScore = s;
        best = id;
      }
    }
    if (best !== null) {
      out[best] = c.id;
      given.add(c.id);
    }
  }
  const cap = Math.ceil(ids.length / 2);
  for (const c of list) {
    if (!c.many) continue;
    let n = ids.filter((id) => out[id] === c.id).length;
    for (const id of ids) {
      if (n >= cap) break;
      if (!own(out, id) && scoreOf(c, id) > 0) {
        out[id] = c.id;
        n++;
      }
    }
  }
  // the cheer squad: unused ones first, then round again
  let k = 0;
  const fresh = SQUAD.filter((a) => !given.has(a));
  const pool = fresh.length ? fresh : SQUAD;
  for (const id of ids) {
    if (own(out, id)) continue;
    out[id] = pool[k % pool.length];
    k++;
  }
  return out;
}

export function cleanAwards(raw, players) {
  if (!isObj(raw)) return null;
  const out = {};
  let n = 0;
  for (const key of Object.keys(raw)) {
    const id = cleanId(key);
    if (!id || !own(players, id) || typeof raw[key] !== 'string' || !own(AWARDS, raw[key])) continue;
    out[id] = raw[key];
    if (++n >= 10) break;
  }
  return n ? out : null;
}

/** The results card: my award first, then everyone's (mine marked), in play order. */
export function awardRows(awards, order, nameOf, me) {
  if (!isObj(awards)) return null;
  const rows = [];
  let mine = null;
  for (const id of Array.isArray(order) ? order : []) {
    const a = own(awards, id) && own(AWARDS, awards[id]) ? AWARDS[awards[id]] : null;
    if (!a) continue;
    const row = { id, name: nameOf(id), award: awards[id], title: a.title, line: a.line, icon: a.icon, me: id === me };
    if (row.me) mine = row;
    rows.push(row);
  }
  return rows.length ? { mine, rows } : null;
}
