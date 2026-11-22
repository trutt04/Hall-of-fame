// Content preview: prints samples of every hype situation and all the other words, for reading.
// Open /cloud-nine/dev/content-preview.html. Dev only: nothing here ships in the game.

import { BIRTHDAY, PALETTE } from '../js/config.js';
import { mulberry32 } from '../js/core/util.js';
import * as C from '../js/content/index.js';

const app = document.getElementById('app');
const $ = (id) => document.getElementById(id);

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : String(kid));
  return n;
}

const TYPICAL = {
  name: 'Maya', target: 'Ava', seeker: 'Leo', tagger: 'Zo\u00eb', friend: 'Mia', trick: 'toeTouch', tricks: ['pike', 'toeTouch'],
  height: 14, score: 870, team: 0, game: 'freezeTag', age: 11, days: 3, stick: 'skyHigh', count: 3, total: 12, left: 2,
  bases: 2, misses: 2,
};
const LONGEST = {
  name: 'Crystal Sparkler', target: 'Glitter Hedgehog', seeker: 'Twinkle Sparkler', tagger: 'Shimmer Sparkler',
  friend: 'Moonlit Hedgehog', trick: 'bowArrow', tricks: 9, height: 22, score: 12345, team: 1, game: 'captureBow', age: 11,
  days: 6, stick: 'rainbowEnd', count: 12, total: 12, left: 9, bases: 9, misses: 9,
};
// Per-situation tweaks so the samples read like the real thing.
const TWEAKS = { lose: { team: 1 }, birthday: { name: undefined }, birthdayWeek: { name: undefined }, tie: { game: 'dodgeball' } };

const GROUPS = [
  ['On the island', ['welcome', 'idle', 'cloudCatch', 'friendJoin', 'friendLeave', 'collect', 'cheer', 'gameStart']],
  ['Basket toss', ['tossLand', 'cradle', 'trick', 'combo', 'bigToss']],
  ['Hide and seek', ['seeker', 'hiding', 'hidden', 'found', 'gotFound']],
  ['Freeze tag', ['it', 'freeze', 'tag', 'unfreeze', 'unfrozen']],
  ['Dodgeball', ['dodge', 'hit', 'hitThem', 'catch']],
  ['Capture the Bow', ['grab', 'bowTaken', 'score']],
  ['Results', ['win', 'lose', 'tie']],
  ['Hit Zero', ['routineZero', 'routineGood', 'routineOk']],
  ['Rare moments', [...C.RARE_SITUATIONS]],
];
const grouped = new Set(GROUPS.flatMap(([, list]) => list));
const others = C.SITUATIONS.filter((s) => !grouped.has(s));
if (others.length) GROUPS.push(['Other', others]);

let seed = 1;
const ctxFor = (s, long) => Object.assign({}, long ? LONGEST : TYPICAL, TWEAKS[s] || {});
// The ctx fields a situation's lines use (placeholders map back to ctx keys).
const CTX_KEY = { ageOrd: 'age', unlock: 'stick', world: null };
function showCtx(s, ctx) {
  const keys = new Set();
  for (const t of C.HYPE_LINES[s]) {
    for (const [, p] of t.matchAll(/\{(\w+)\}/g)) {
      const key = p in CTX_KEY ? CTX_KEY[p] : p;
      if (key) keys.add(key);
      if (p === 'trick') keys.add('tricks');
    }
  }
  const shown = [...keys].filter((k) => ctx[k] !== undefined).map((k) => `${k}: ${JSON.stringify(ctx[k])}`);
  return shown.length ? `ctx { ${shown.join(', ')} }` : 'no ctx needed';
}

function hypeSection(long, raw) {
  const rng = mulberry32(seed);
  const say = C.createHype();
  const out = [el('h2', { id: 'hype' }, 'Hype lines')];
  for (const [title, list] of GROUPS) {
    out.push(el('h3', { style: 'margin-top:18px' }, title));
    const grid = el('div', { class: 'grid' });
    for (const s of list) {
      const ctx = ctxFor(s, long);
      const values = C.hypeValues(ctx, s);
      const max = C.SHORT_SITUATIONS.includes(s) ? C.HYPE_SHORT_MAX : C.HYPE_MAX;
      const samples = Array.from({ length: 5 }, () => say(s, ctx, rng));
      const all = C.HYPE_LINES[s].map((t) => {
        const filled = C.fillTemplate(t, values);
        const shown = raw || !filled ? t : filled;
        const tooLong = filled && filled.length > max;
        return el('li', { class: tooLong ? 'long' : '' }, shown, tooLong ? ` (too long: ${filled.length})` : '');
      });
      grid.append(el('div', { class: 'card' + (C.RARE_SITUATIONS.includes(s) ? ' rare' : '') },
        el('h3', {}, s, el('span', { class: 'tag' }, `${C.HYPE_LINES[s].length} lines`)),
        el('p', { class: 'ctx mono' }, showCtx(s, ctx)),
        el('ul', {}, samples.map((line) => el('li', {}, line))),
        el('details', {}, el('summary', {}, `All ${C.HYPE_LINES[s].length} lines`), el('ul', {}, all))));
    }
    out.push(grid);
  }
  return out;
}

function emoteSection() {
  return [el('h2', { id: 'emotes' }, `Quick-cheers (${C.EMOTES.length})`),
    el('div', { class: 'emotes' }, C.EMOTES.map((e) => el('div', { class: 'emote' },
      el('span', { class: 'icon', 'aria-hidden': 'true' }, e.icon),
      el('span', {}, el('b', {}, e.text), el('small', { class: 'mono' }, `${e.id} / ${e.iconId} / ${e.anim} / ${e.sfx}`)))))];
}

function nickSection() {
  const rng = mulberry32(seed * 7 + 1);
  const result = el('span', {}, 'Type a nickname to test cleanNick.');
  const input = el('input', { type: 'text', maxlength: '24', placeholder: 'Try a nickname', 'aria-label': 'Try a nickname', autocomplete: 'off' });
  input.addEventListener('input', () => {
    const v = C.cleanNick(input.value);
    result.className = v ? 'ok' : 'no';
    result.textContent = input.value ? (v ? `OK: "${v}"` : 'Not allowed (letters and spaces, 12 at most, nothing rude)') : '';
  });
  return [el('h2', { id: 'names' }, 'Nicknames'),
    el('p', {}, `${C.NICK_FIRST.length} x ${C.NICK_SECOND.length} words. Typed names: letters and spaces, at most ${C.NICK_MAX}.`),
    el('div', { class: 'nicks' }, Array.from({ length: 24 }, () => el('span', { class: 'nick' }, C.randomNick(rng)))),
    el('div', { class: 'row' }, input, result)];
}

function birthdaySection() {
  const today = C.birthdayInfo(new Date());
  const out = el('pre', { class: 'mono' });
  const lines = el('ul', {});
  const month = el('input', { type: 'number', min: '1', max: '12', value: '11', 'aria-label': 'Month' });
  const day = el('input', { type: 'number', min: '1', max: '31', value: '24', 'aria-label': 'Day' });
  const year = el('input', { type: 'number', min: '1990', max: '2030', value: '2015', 'aria-label': 'Birth year' });
  const when = el('input', { type: 'date', value: '2026-11-22', 'aria-label': 'Pretend today is' });
  const update = () => {
    const [y, m, d] = when.value.split('-').map(Number);
    const info = C.birthdayInfo(new Date(y, m - 1, d, 12), { name: BIRTHDAY.name, month: +month.value, day: +day.value, year: +year.value });
    out.textContent = JSON.stringify(info, null, 1);
    const say = C.createHype();
    const rng = mulberry32(seed);
    lines.replaceChildren();
    if (info.isBirthday) for (let i = 0; i < 3; i++) lines.append(el('li', {}, say('birthday', { age: info.age }, rng)));
    else if (info.isBirthdayWeek) {
      for (let i = 0; i < 3; i++) lines.append(el('li', {}, say('birthdayWeek', { days: info.daysUntil <= 3 ? info.daysUntil : undefined }, rng)));
    } else lines.append(el('li', {}, 'Not birthday week: no birthday lines.'));
  };
  for (const i of [month, day, year, when]) i.addEventListener('input', update);
  update();
  return [el('h2', { id: 'birthday' }, 'Birthday mode'),
    el('p', {}, today.enabled ? `On: ${JSON.stringify(today)}` : 'Off for now: js/config.js still has null placeholders. Try a date here:'),
    el('div', { class: 'row' }, 'Month', month, 'Day', day, 'Year', year, 'Pretend today is', when), out, lines];
}

function notesSection() {
  const samples = [
    { from: 'Grandma', text: 'Happy birthday, sweet flyer! We are so proud of you. Fly high!' },
    { from: 'mom and dad', text: 'Hit zero, superstar! We love you to the clouds and back.' },
    { from: 'Aunt Zuzu', text: 'Full out, every day! ' + 'You make every squad better. '.repeat(5) },
    { from: 'Zuzu Sparkleton', text: 'Last names are refused.' },
    { from: 'Nana', text: 'Links like www.example.com are refused.' },
  ];
  return [el('h2', { id: 'notes' }, 'Family notes'),
    el('p', {}, `FAMILY_NOTES has ${C.FAMILY_NOTES.length} notes (the owner fills it in). How cleanNote treats some samples:`),
    el('div', { class: 'table-wrap' }, el('table', {}, el('tr', {}, el('th', {}, 'Signed'), el('th', {}, 'Result')),
      samples.map((s) => {
        const n = C.cleanNote(s);
        return el('tr', {}, el('td', {}, s.from), el('td', { class: n ? '' : 'no' }, n ? `${n.from}: ${n.text}${n.clipped ? ' (clipped)' : ''}` : 'refused'));
      })))];
}

function glossarySection() {
  return [el('h2', { id: 'glossary' }, `Glossary (${C.GLOSSARY.length})`),
    el('div', { class: 'table-wrap' }, el('table', {}, el('tr', {}, el('th', {}, 'Word'), el('th', {}, 'Kind'), el('th', {}, 'Meaning')),
      C.GLOSSARY.map((e) => el('tr', {}, el('td', {}, el('b', {}, e.word)), el('td', {}, e.kind), el('td', {}, e.meaning)))))];
}

function howtoSection() {
  return [el('h2', { id: 'howto' }, 'How to play'),
    el('div', { class: 'grid' }, C.HOWTO_ORDER.map((id) => {
      const c = C.HOWTO[id];
      return el('div', { class: 'card howto' }, el('h3', {}, `${c.icon} ${c.title}`), el('p', { class: 'ctx' }, c.blurb),
        el('ol', {}, c.steps.map((s) => el('li', {}, s))), el('p', { class: 'tip' }, `Tip: ${c.tip}`));
    }))];
}

function stickSection() {
  return [el('h2', { id: 'sticks' }, `Spirit sticks (${C.SPIRIT_STICKS.length})`),
    el('div', { class: 'grid' }, C.SPIRIT_STICKS.map((s) => el('div', { class: 'card' },
      el('h3', {}, el('span', { class: 'swatch', style: `background:${PALETTE[s.color]}` }), s.name),
      el('p', {}, s.hint),
      el('p', { class: 'ctx mono' }, `where: ${JSON.stringify(s.where)}`),
      el('p', {}, el('b', {}, 'Unlocks: '), s.unlock.label, s.unlock.later ? ' (later)' : '', el('span', { class: 'mono ctx' }, ` ${s.unlock.slot}:${s.unlock.id}`)))))];
}

function render() {
  const long = $('long').checked;
  const raw = $('raw').checked;
  const lineCount = C.SITUATIONS.reduce((n, s) => n + C.HYPE_LINES[s].length, 0);
  $('stats').textContent = `${C.SITUATIONS.length} situations, ${lineCount} lines, seed ${seed}`;
  app.replaceChildren(...hypeSection(long, raw), ...emoteSection(), ...nickSection(), ...birthdaySection(), ...notesSection(),
    ...glossarySection(), ...howtoSection(), ...stickSection());
}

$('nav').append(...[['hype', 'Hype'], ['emotes', 'Quick-cheers'], ['names', 'Nicknames'], ['birthday', 'Birthday'], ['notes', 'Notes'],
  ['glossary', 'Glossary'], ['howto', 'How to play'], ['sticks', 'Spirit sticks']].map(([id, label]) => el('a', { href: `#${id}` }, label)));
$('reshuffle').addEventListener('click', () => {
  seed += 1;
  render();
});
$('long').addEventListener('change', render);
$('raw').addEventListener('change', render);
render();
