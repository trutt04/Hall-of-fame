// Spirit sticks: 12 hidden around the island, each with a hint and an unlock. Pure data.
//
//   SPIRIT_STICKS           [{ id, name, color, hint, where, unlock }] in hint order
//     color                 a PALETTE key (js/config.js) for tinting the stick
//     where                 { place, index?, spot? }: where ISLAND puts it. place is a Contract 1
//                           places id ('plaza', 'gym', 'stage', 'tossPads', 'slides', 'hideGarden',
//                           'court', 'bowField', 'tagZone') or 'edge' (a scenic spot on the island's
//                           rim, ISLAND's pick). index picks from a list place; spot narrows it:
//                           'target' = on that toss pad's target cloud, 'bottom' = the slide's end.
//     unlock                { slot, id, label, later? }: slot is a look slot (Contract 3), 'pet' included
//                           (the cloud puppy, js/art/pet.js); CHARACTER maps the ids to its LOOK_OPTIONS.
//                           later: true = not built yet (nothing is, any more).
//   SPIRIT_STICK_IDS        the ids in order
//   stickById(id)           -> the stick or null
//   cleanFoundSticks(raw)   -> known, unique ids in SPIRIT_STICKS order (for saved progress)
//   unlocksFor(foundIds)    -> the unlocks those sticks give
//   nextHint(foundIds)      -> the hint for the first stick not found yet, or null when all are found

const stick = (id, name, color, where, hint, unlock) =>
  Object.freeze({ id, name, color, where: Object.freeze(where), hint, unlock: Object.freeze(unlock) });

export const SPIRIT_STICKS = Object.freeze([
  stick('party', 'Party Stick', 'pink', { place: 'plaza' },
    'Start where the party starts! Circle the big birthday cake.',
    { slot: 'bowPattern', id: 'hearts', label: 'Heart bow' }),
  stick('warmUp', 'Warm-Up Stick', 'lavender', { place: 'gym' },
    'Stretch it out in the cheer gym. Peek behind the mats!',
    { slot: 'bow', id: 'lavender', label: 'Lavender bow' }),
  stick('spotlight', 'Spotlight Stick', 'rhinestoneSilver', { place: 'stage' },
    "The judges' table by the stage is keeping a secret.",
    { slot: 'bowPattern', id: 'rhinestones', label: 'Rhinestone bow' }),
  stick('liftoff', 'Liftoff Stick', 'babyBlue', { place: 'tossPads', index: 0, spot: 'target' },
    'Take the first basket toss and look around the cloud you land on.',
    { slot: 'socks', id: 'rainbow', label: 'Rainbow socks' }),
  stick('cloudHop', 'Cloud Hop Stick', 'mint', { place: 'tossPads', index: 1, spot: 'target' },
    "Fly from the second toss pad. It's waiting on a higher cloud!",
    { slot: 'bowPattern', id: 'rainbow', label: 'Rainbow bow' }),
  stick('skyHigh', 'Sky High Stick', 'gold', { place: 'tossPads', index: 2, spot: 'target' },
    'The highest cloud of all! Only the third toss pad flies that high.',
    { slot: 'hairStyle', id: 'spaceBuns', label: 'Space buns hairstyle' }),
  stick('wheee', 'Wheee Stick', 'lemon', { place: 'slides', index: 0, spot: 'bottom' },
    'Zoom down a slide from the clouds and check the bottom.',
    { slot: 'shoes', id: 'glitter', label: 'Glitter cheer shoes' }),
  stick('peekaboo', 'Peekaboo Stick', 'grass', { place: 'hideGarden' },
    'In the hide and seek garden, this stick is hiding too!',
    { slot: 'bowPattern', id: 'polkaDots', label: 'Polka dot bow' }),
  stick('dodge', 'Dodge Stick', 'teamB', { place: 'court' },
    'Look along the middle line of the dodgeball court.',
    { slot: 'top', id: 'purpleSparkle', label: 'Purple sparkle top' }),
  stick('bowBase', 'Bow Base Stick', 'teamA', { place: 'bowField' },
    'Visit the Capture the Bow field and check the team bases.',
    { slot: 'bowSize', id: 'mega', label: 'Mega bow' }),
  stick('brrr', 'Brrr Stick', 'lilac', { place: 'tagZone' },
    'In the freeze tag zone, find the sparkle that never freezes.',
    { slot: 'sparkle', id: 'gold', label: 'Gold rhinestones' }),
  stick('rainbowEnd', "Rainbow's End Stick", 'white', { place: 'edge' },
    'Walk all the way to the edge of the island, where it meets the clouds.',
    { slot: 'pet', id: 'cloudPuppy', label: 'Cloud puppy pet' }),
]);

export const SPIRIT_STICK_IDS = Object.freeze(SPIRIT_STICKS.map((s) => s.id));

const BY_ID = new Map(SPIRIT_STICKS.map((s) => [s.id, s]));

export function stickById(id) {
  return (typeof id === 'string' && BY_ID.get(id)) || null;
}

export function cleanFoundSticks(raw) {
  if (!Array.isArray(raw)) return [];
  const found = new Set();
  for (const id of raw.slice(0, 64)) if (stickById(id)) found.add(id);
  return SPIRIT_STICK_IDS.filter((id) => found.has(id));
}

export function unlocksFor(foundIds) {
  return cleanFoundSticks(foundIds).map((id) => BY_ID.get(id).unlock);
}

export function nextHint(foundIds) {
  const found = new Set(cleanFoundSticks(foundIds));
  const next = SPIRIT_STICKS.find((s) => !found.has(s.id));
  return next ? next.hint : null;
}
