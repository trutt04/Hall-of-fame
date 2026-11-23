// The cheerleader's looks: preset options for every slot, Bailey's default outfit and the
// validators. Pure data and logic (no three.js, no DOM), so it runs under node --test.
//
//   LOOK_SLOTS                 the 13 slot names, in creator order (the pet last)
//   LOOK_OPTIONS               { slot: [{ id, label, ...colors }] }  (deep frozen; colors are '#rrggbb')
//   DEFAULT_LOOK               Bailey's real outfit (frozen)
//   cleanLook(raw)             -> a fresh, valid look. Input is hostile (it arrives over the network):
//                              anything unknown, mistyped, oversized or inherited falls back slot by slot
//   randomLook(rng)            -> a fresh, valid look, for bots and "Surprise me!". rng() -> [0, 1).
//                              Never a pet: pets are chosen (or won), and bots don't get one
//   lookOption(slot, id)       -> the option object for that id (the default's when unknown)
//   lookKey(look)              -> a short stable string for a clean look (cache keys, equality)
//   petLabel(id)               -> the name a pet goes by: the one lookup for every pet label (the creator's
//                              tiles, anything in the world). setPetLabels({ husky: 'Name' }) overrides
//                              labels (a family's own name for their dog, wired in privately later);
//                              setPetLabels({ husky: null }) puts the default back. Returns the overrides.
//
// A look is a small object of preset ids, never free text:
//   { skin, hair, hairStyle, hat, bow, bowPattern, bowSize, top, bottom, shoes, socks, sparkle, pet }
// hat is what she wears on her head: the cheer bow (the default, so looks saved before hats keep it),
// just her hair, a cap (forward or backwards) or a beanie. The bow colour list colours a cap or beanie
// too; the bow is only drawn when hat is 'bow', so a bow and a hat never clip.
// pet is 'none', 'cloudPuppy' or 'husky' (drawn and walked by js/art/pet.js and js/world/pets.js).

export const LOOK_SLOTS = ['hairStyle', 'hair', 'hat', 'bow', 'bowPattern', 'bowSize', 'top', 'bottom', 'shoes', 'socks', 'sparkle', 'skin', 'pet'];

const RAINBOW = ['#ff4f6d', '#ff9f43', '#ffe066', '#5fdd8b', '#4fb3ff', '#a46bff'];

const OPTIONS = {
  // Eight inclusive skin tones. Labels stay neutral on purpose (never food words).
  skin: [
    { id: 'tone1', label: 'Very light', color: '#ffe4d4' },
    { id: 'tone2', label: 'Light', color: '#f8d1b8' },
    { id: 'tone3', label: 'Light medium', color: '#eebd98' },
    { id: 'tone4', label: 'Medium', color: '#dca47b' },
    { id: 'tone5', label: 'Medium tan', color: '#c4895f' },
    { id: 'tone6', label: 'Tan', color: '#a36c47' },
    { id: 'tone7', label: 'Brown', color: '#7e4f30' },
    { id: 'tone8', label: 'Deep brown', color: '#5a3621' },
  ],
  hair: [
    { id: 'darkBrown', label: 'Dark brown', color: '#3f2618' },
    { id: 'black', label: 'Black', color: '#1e1618' },
    { id: 'chestnut', label: 'Chestnut', color: '#714226' },
    { id: 'auburn', label: 'Auburn', color: '#93391e' },
    { id: 'copper', label: 'Copper', color: '#cf6a2e' },
    { id: 'blonde', label: 'Golden blonde', color: '#e9bf6a' },
    { id: 'platinum', label: 'Platinum', color: '#f2e7cb' },
    { id: 'pink', label: 'Bubblegum pink', color: '#ff8cc6' },
    { id: 'lilac', label: 'Lilac', color: '#b99cf2' },
    { id: 'blue', label: 'Ocean blue', color: '#5aa7ff' },
  ],
  hairStyle: [
    { id: 'highPony', label: 'High pony' },
    { id: 'braidPony', label: 'Braided pony' },
    { id: 'curlyPony', label: 'Curly pony' },
    { id: 'spaceBuns', label: 'Space buns' },
    { id: 'halfUp', label: 'Half-up' },
    { id: 'longDown', label: 'Long and down' },
    { id: 'bob', label: 'Short bob' },
    { id: 'crop', label: 'Short crop' },
    { id: 'curls', label: 'Short curls' },
    { id: 'swoop', label: 'Side swoop' },
    { id: 'buzz', label: 'Buzz cut' },
  ],
  // What goes on her head. The bow colours below colour a cap or a beanie too.
  hat: [
    { id: 'bow', label: 'Cheer bow' },
    { id: 'none', label: 'Just hair' },
    { id: 'cap', label: 'Cap' },
    { id: 'capBack', label: 'Cap backwards' },
    { id: 'beanie', label: 'Beanie' },
  ],
  // accent: the pattern color that reads on top of this bow.
  bow: [
    { id: 'pink', label: 'Hot pink', color: '#ff2e93', dark: '#c4126b', accent: '#17121c' },
    { id: 'black', label: 'Black', color: '#211a26', dark: '#0f0b12', accent: '#ff2e93' },
    { id: 'white', label: 'White', color: '#fdf8fc', dark: '#d8cde3', accent: '#ff2e93' },
    { id: 'purple', label: 'Purple', color: '#8b52ff', dark: '#6232c8', accent: '#ffffff' },
    { id: 'teal', label: 'Teal', color: '#1fc8bf', dark: '#11918b', accent: '#ffffff' },
    { id: 'rainbow', label: 'Rainbow', color: '#ff5fa2', dark: '#c94a86', accent: '#ffffff', rainbow: RAINBOW },
    { id: 'silver', label: 'Silver glitter', color: '#dcdeea', dark: '#a6a9bf', accent: '#ff2e93', glitter: true },
    { id: 'gold', label: 'Gold', color: '#ffcd4a', dark: '#d6951a', accent: '#ffffff', glitter: true },
    { id: 'lavender', label: 'Lavender', color: '#c3a6ff', dark: '#9a78e6', accent: '#ffffff' },
    { id: 'navy', label: 'Navy', color: '#2c3e82', dark: '#1c2a5e', accent: '#ffffff' },
    { id: 'red', label: 'Red', color: '#e63946', dark: '#b02233', accent: '#ffffff' },
  ],
  bowPattern: [
    { id: 'stars', label: 'Stars' },
    { id: 'plain', label: 'Plain' },
    { id: 'polkaDots', label: 'Polka dots' },
    { id: 'hearts', label: 'Hearts' },
    { id: 'glitter', label: 'Glitter' },
    { id: 'checker', label: 'Checkers' },
    { id: 'rhinestones', label: 'Rhinestones' },
    { id: 'rainbow', label: 'Rainbows' },
  ],
  // The cheer joke: the bigger the better.
  bowSize: [
    { id: 'big', label: 'Big', scale: 1 },
    { id: 'huge', label: 'Huge', scale: 1.45 },
    { id: 'ridiculous', label: 'Ridiculous', scale: 2.2 },
    { id: 'mega', label: 'MEGA', scale: 2.75 },
  ],
  // Tops come in the team colors. style picks the shape; stones are rhinestone colors.
  top: [
    { id: 'crop-black', label: 'Black sparkle crop', style: 'crop', color: '#17121c', trim: '#2b2233', stones: ['#ff7ad1', '#a96bff', '#eae8f2'] },
    { id: 'crop-pink', label: 'Pink sparkle crop', style: 'crop', color: '#ff2e93', trim: '#d8197a', stones: ['#ffffff', '#a96bff', '#eae8f2'] },
    { id: 'purpleSparkle', label: 'Purple sparkle crop', style: 'crop', color: '#7b5cff', trim: '#5f40e6', stones: ['#ff7ad1', '#ffffff', '#eae8f2'] },
    { id: 'shell-pink', label: 'Pink uniform', style: 'shell', color: '#ff2e93', trim: '#17121c', accent: '#ffffff' },
    { id: 'shell-black', label: 'Black uniform', style: 'shell', color: '#211a26', trim: '#ff2e93', accent: '#ffffff' },
    { id: 'shell-purple', label: 'Purple uniform', style: 'shell', color: '#7b5cff', trim: '#ffffff', accent: '#ff2e93' },
    { id: 'tee-pink', label: 'Pink team tee', style: 'tee', color: '#ff8cc6', trim: '#ffffff', accent: '#ff2e93' },
    { id: 'tee-white', label: 'White team tee', style: 'tee', color: '#fbf6fb', trim: '#ff2e93', accent: '#ff2e93' },
    { id: 'hoodie-lilac', label: 'Lilac hoodie', style: 'hoodie', color: '#cdb4ff', trim: '#ad92ee', accent: '#ffffff' },
    { id: 'hoodie-pink', label: 'Pink hoodie', style: 'hoodie', color: '#ff8cc6', trim: '#f06aae', accent: '#ffffff' },
    { id: 'hoodie-black', label: 'Black hoodie', style: 'hoodie', color: '#241c2a', trim: '#3a2f43', accent: '#ff2e93' },
    // number: the big number on the front and back of a team jersey (one or two digits)
    { id: 'jersey-pink', label: 'Pink team jersey', style: 'jersey', color: '#ff2e93', trim: '#17121c', accent: '#ffffff', number: 11 },
    { id: 'jersey-black', label: 'Black team jersey', style: 'jersey', color: '#211a26', trim: '#ff2e93', accent: '#ffffff', number: 9 },
    { id: 'jersey-blue', label: 'Blue team jersey', style: 'jersey', color: '#2f6fe0', trim: '#ffffff', accent: '#ffffff', number: 23 },
    // sleeve: the varsity jacket's sleeves; trim: the striped cuffs, collar and hem; accent: the patch
    { id: 'varsity-black', label: 'Black varsity jacket', style: 'varsity', color: '#211a26', trim: '#ff2e93', accent: '#ff2e93', sleeve: '#fbf6fb' },
    { id: 'varsity-navy', label: 'Navy varsity jacket', style: 'varsity', color: '#2c3e82', trim: '#ffcd4a', accent: '#ffcd4a', sleeve: '#f3eee4' },
    { id: 'varsity-red', label: 'Red varsity jacket', style: 'varsity', color: '#d7263d', trim: '#ffffff', accent: '#ffffff', sleeve: '#f6f1ea' },
  ],
  bottom: [
    { id: 'shorts-pink', label: 'Hot pink shorts', style: 'shorts', color: '#ff2e93', trim: '#d4167a' },
    { id: 'shorts-black', label: 'Black shorts', style: 'shorts', color: '#211a26', trim: '#ff2e93' },
    { id: 'shorts-purple', label: 'Purple shorts', style: 'shorts', color: '#7b5cff', trim: '#ffffff' },
    { id: 'skirt-pink', label: 'Pink cheer skirt', style: 'skirt', color: '#ff2e93', trim: '#17121c', accent: '#ffffff' },
    { id: 'skirt-black', label: 'Black cheer skirt', style: 'skirt', color: '#211a26', trim: '#ff2e93', accent: '#ffffff' },
    { id: 'skirt-purple', label: 'Purple cheer skirt', style: 'skirt', color: '#7b5cff', trim: '#ffffff', accent: '#ff2e93' },
    { id: 'leggings-black', label: 'Black leggings', style: 'leggings', color: '#211a26', trim: '#ff2e93' },
    { id: 'leggings-galaxy', label: 'Galaxy leggings', style: 'leggings', color: '#3a2a7a', trim: '#7b5cff', specks: ['#ffffff', '#ff8cc6', '#9fd8ff'] },
    { id: 'joggers-grey', label: 'Grey joggers', style: 'joggers', color: '#a19dae', trim: '#757184' },
    { id: 'joggers-black', label: 'Black joggers', style: 'joggers', color: '#262029', trim: '#ff2e93' },
    { id: 'joggers-navy', label: 'Navy joggers', style: 'joggers', color: '#2c3e82', trim: '#ffffff' },
    { id: 'bball-black', label: 'Black basketball shorts', style: 'bball', color: '#211a26', trim: '#ff2e93' },
    { id: 'bball-blue', label: 'Blue basketball shorts', style: 'bball', color: '#2f6fe0', trim: '#ffffff' },
  ],
  shoes: [
    { id: 'cheer-black', label: 'Black cheer shoes', style: 'cheer', color: '#211a26', sole: '#f3eef6', accent: '#ff2e93', lace: '#3a3042' },
    { id: 'cheer-white', label: 'White cheer shoes', style: 'cheer', color: '#fbf8fc', sole: '#e6dfec', accent: '#ff2e93', lace: '#e3d8ea' },
    { id: 'sneakers-pink', label: 'Pink sneakers', style: 'sneaker', color: '#ff7ab8', sole: '#ffffff', accent: '#ffffff', lace: '#ffffff' },
    { id: 'glitter', label: 'Glitter sneakers', style: 'sneaker', color: '#d7d9e6', sole: '#ffffff', accent: '#ff2e93', lace: '#ffffff', glitter: true },
    { id: 'hightop-black', label: 'Black high-tops', style: 'hightop', color: '#211a26', sole: '#f3eef6', accent: '#ff2e93', lace: '#ffffff' },
    { id: 'hightop-white', label: 'White high-tops', style: 'hightop', color: '#fbf8fc', sole: '#e6dfec', accent: '#2f6fe0', lace: '#e3d8ea' },
    { id: 'hightop-red', label: 'Red high-tops', style: 'hightop', color: '#e63946', sole: '#ffffff', accent: '#ffffff', lace: '#ffffff' },
  ],
  socks: [
    { id: 'sparkle-black', label: 'Black sparkle', color: '#211a26', specks: ['#eae8f2', '#ff7ad1', '#a96bff'] },
    { id: 'sparkle-pink', label: 'Pink sparkle', color: '#ff8cc6', specks: ['#ffffff', '#ff2e93', '#eae8f2'] },
    { id: 'white', label: 'White', color: '#fbf8fc' },
    { id: 'rainbow', label: 'Rainbow', color: '#ffffff', stripes: RAINBOW },
  ],
  // Rhinestone glints that twinkle.
  sparkle: [
    { id: 'none', label: 'None', level: 0 },
    { id: 'some', label: 'Some', level: 1 },
    { id: 'max', label: 'Maximum!', level: 2 },
    { id: 'gold', label: 'Golden', level: 2, gold: true },
  ],
  // A pet that follows her around. The cloud puppy is the 12th spirit stick's prize; the mini husky
  // is there from the start. Labels shown to players come from petLabel(id), never straight from here.
  pet: [
    { id: 'none', label: 'No pet' },
    { id: 'cloudPuppy', label: 'Cloud puppy' },
    { id: 'husky', label: 'Mini husky' },
  ],
};

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

export const LOOK_OPTIONS = deepFreeze(OPTIONS);

// Bailey's real outfit: high pony, dark brown hair, a big hot-pink bow with small black stars, a
// black crop top covered in rhinestone starbursts, hot-pink shorts, black cheer shoes and black
// sparkly socks. The skin tone is a placeholder until the owner says otherwise.
export const DEFAULT_LOOK = Object.freeze({
  skin: 'tone3',
  hair: 'darkBrown',
  hairStyle: 'highPony',
  hat: 'bow',
  bow: 'pink',
  bowPattern: 'stars',
  bowSize: 'big',
  top: 'crop-black',
  bottom: 'shorts-pink',
  shoes: 'cheer-black',
  socks: 'sparkle-black',
  sparkle: 'some',
  pet: 'none',
});

const KEYS = Object.keys(DEFAULT_LOOK);
const MAX_ID = 32;

// id -> option, per slot. Maps, so ids like "__proto__" or "toString" can never match.
const INDEX = new Map(KEYS.map((slot) => [slot, new Map(OPTIONS[slot].map((o) => [o.id, o]))]));

export function lookOption(slot, id) {
  const m = INDEX.get(slot);
  if (!m) return null;
  return (typeof id === 'string' && m.get(id)) || m.get(DEFAULT_LOOK[slot]);
}

function readSlot(raw, slot) {
  try {
    if (!Object.prototype.hasOwnProperty.call(raw, slot)) return null;
    const v = raw[slot];
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID) return null;
    return INDEX.get(slot).has(v) ? v : null;
  } catch (err) {
    return null; // a throwing getter or a revoked proxy
  }
}

export function cleanLook(raw) {
  const out = {};
  let ok = false;
  try {
    ok = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  } catch (err) {
    ok = false;
  }
  for (const slot of KEYS) {
    const v = ok ? readSlot(raw, slot) : null;
    out[slot] = v === null ? DEFAULT_LOOK[slot] : v;
  }
  return out;
}

// Weighted picks for the slots where some answers are more fun than others.
const WEIGHTS = {
  bowSize: { big: 0.36, huge: 0.34, ridiculous: 0.2, mega: 0.1 },
  sparkle: { none: 0.12, some: 0.4, max: 0.36, gold: 0.12 },
  hairStyle: {
    highPony: 0.15, braidPony: 0.09, curlyPony: 0.09, spaceBuns: 0.08, halfUp: 0.08, longDown: 0.08, bob: 0.09,
    crop: 0.09, curls: 0.09, swoop: 0.09, buzz: 0.07,
  },
  hat: { bow: 0.5, none: 0.14, cap: 0.13, capBack: 0.11, beanie: 0.12 },
};

function unit(rng) {
  let r = 0;
  try {
    r = typeof rng === 'function' ? Number(rng()) : Math.random();
  } catch (err) {
    r = Math.random();
  }
  if (!Number.isFinite(r)) r = 0;
  return r < 0 ? 0 : r >= 1 ? 0.999999 : r;
}

export function randomLook(rng) {
  const out = {};
  for (const slot of KEYS) {
    if (slot === 'pet') {
      out.pet = 'none'; // pets are won, never random (and bots never get one)
      continue;
    }
    const list = OPTIONS[slot], w = WEIGHTS[slot];
    let pick;
    if (w) {
      let total = 0;
      for (const o of list) total += w[o.id] || 0;
      let x = unit(rng) * total;
      pick = list[list.length - 1];
      for (const o of list) {
        x -= w[o.id] || 0;
        if (x < 0) { pick = o; break; }
      }
    } else pick = list[Math.floor(unit(rng) * list.length)];
    out[slot] = pick.id;
  }
  return out;
}

export function lookKey(look) {
  const l = cleanLook(look);
  return KEYS.map((k) => l[k]).join('|');
}

// ---- pet names -----------------------------------------------------------------------------------
// One lookup for every pet label, so a family's own name for their dog can be wired in later
// (privately: this repo is public) with one call, e.g. setPetLabels({ husky: 'Name' }).
const PET_LABELS = new Map();
const PET_LABEL_RE = /^[\p{L}\p{N}][\p{L}\p{N} '\u2019.-]{0,23}$/u;

export function petLabel(id) {
  const own = typeof id === 'string' ? PET_LABELS.get(id) : undefined;
  if (own) return own;
  const o = INDEX.get('pet').get(id);
  return o ? o.label : INDEX.get('pet').get('none').label;
}

export function setPetLabels(map) {
  if (map && typeof map === 'object') {
    for (const id of Object.keys(map)) {
      if (id === 'none' || !INDEX.get('pet').has(id)) continue; // only real pets, never "No pet"
      let v = null;
      try {
        v = map[id];
      } catch (err) {
        v = null;
      }
      const name = typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
      if (name && PET_LABEL_RE.test(name)) PET_LABELS.set(id, name);
      else if (v === null || v === undefined || v === '') PET_LABELS.delete(id);
    }
  }
  return Object.fromEntries(PET_LABELS);
}
