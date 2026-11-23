# Cloud Nine

A 3D sky island in the browser, made as a birthday present for Bailey, who is turning 11. She is
a competitive cheerleader and her team's flyer, so this is a place where flyers fly: basket tosses
into the clouds, a cheer routine on a real stage, and games with her sister, cousins and friends.

Everyone plays on their own phone, tablet or computer by opening one link. Nothing to install,
no accounts, no ads, no chat. Players talk with preset quick-cheers only.

## Opening it

- **On the web:** once this folder is on the `main` branch, it lives next to League World at
  `https://trutt04.github.io/Hall-of-fame/cloud-nine/`.
- **On your own computer:** from the top of the repo, run `python3 -m http.server 8000`, then open
  `http://localhost:8000/cloud-nine/`. (Opening `index.html` straight from the folder does not
  work: browsers block the parts from loading that way.)

The first tap turns the sound on. The speaker button turns it off and on, and the game remembers.

## Controls

| | Phone or tablet | Computer |
|---|---|---|
| Walk | Drag on the left side of the screen | WASD or the arrow keys (Shift to walk slowly) |
| Look around | Drag anywhere else, pinch to zoom | Drag with the mouse, scroll to zoom |
| Go somewhere | Tap the ground or a thing | Click it |
| Jump | The big pink button | Space |
| Use (toss pad, stage) | The yellow button that pops up | Space, E or Enter |
| Quick-cheers | The speech bubble button | Q, then 1 to 9 |
| Menu | The three lines, top right | M or Esc |

## What there is to do

A badge floats over each of these places so she can spot them from across the island, and the
"To do" chip (top left, also in the menu as "Things to do") lists eight first goals. Finishing
all eight wins the gold bow in My cheerleader. On a new device, My cheerleader opens once right
after the welcome, so each cousin can make her own look before playing.

- **Basket toss.** Three glittery mats on the headland, each aimed at a cloud (8, 14 and 22 m
  up). Stand on one and tap "Basket toss!". The bases count "5, 6, 7, 8!" and throw her. Swipe
  (or press the arrows) for tricks, and near the top of the arc the swipes become body
  positions. Stick the landing on the cloud, then slide home down the rainbow. Friends standing
  on the mat's glowing spots are her bases and make her fly higher.
- **Hit Zero.** Walk onto the blue mat at the stage (or pick it from "Pick a game"). Gems come
  down three lanes in time with the music; tap each lane as its gem reaches the line. Her
  cheerleader does every motion on the stage behind the lanes, and three judges score it at the
  end. "Hit zero" means nothing was missed.
- **Squad games.** "Pick a game" (the star button) has hide and seek, freeze tag, dodgeball and
  Capture the Bow. In a room the host picks and everyone plays; alone, bot friends fill in.
- **Photo booth.** The pink booth beside the plaza takes pictures. Walk up to it and tap "Photo
  booth!", pick a frame and a pose, and tap "Snap!": the camera swings round, counts 3, 2, 1, and
  friends standing near the booth strike a pose too. The picture has a frame, the date and no
  names on it. "Save" puts it on the device (on a phone, "Share" opens the share sheet, where
  "Save Image" puts it in Photos). Nothing is ever uploaded.
- **Spirit sticks.** Twelve are hidden around the island, a few of them on the clouds. Touching
  one collects it, and each unlocks something new for her cheerleader (a heart bow, space buns,
  rainbow socks...). The menu's "Spirit sticks" row shows how many are found and gives a hint for
  the next one. Locked choices in the creator show a padlock and the same hint.
- **The cloud puppy.** The last stick, Rainbow's End at the island's edge, brings a fluffy cloud
  puppy with a hot-pink bow collar. It poofs in beside her, follows her everywhere, sits when she
  stops, spins when she cheers, waits at the mat while she flies, and hides during squad games so
  it never gives a hider away. Friends in a room see it too. "Pet" in My cheerleader turns it on
  or off.
- **My cheerleader.** Hair, bow, outfit, shoes, sparkle, skin tone and pet, plus her cheer name. Her
  first look is a hot-pink and black cheer outfit: high pony, the big hot-pink bow with black stars, the black
  rhinestone crop top and hot-pink shorts.
- **Rooms.** "Make a room" shows a 4-letter code. Friends tap "Join a room" and type it. Rooms
  are private: there is no list of rooms anywhere, and only someone with the code can come in.
  Once everyone is in, the host can lock the room (in the lobby or the menu) so nobody new can
  join, and can send a friend home if someone shouldn't be there.

## Her birthday

On her birthday the plaza becomes a party: a giant cake with one candle for each year, a
"Happy Birthday Bailey!" banner, balloon arches, fireworks over the island, the birthday song
when she arrives, and a "Happy birthday!" quick-cheer at the front of the wheel.

It turns on by itself on the day, once you fill in her birthday in `js/config.js`:

```js
export const BIRTHDAY = { name: 'Bailey', month: 12, day: 3, year: 2015 };
```

(Those numbers are only an example.) `year` is the year she was born; the candles count from it.
While the numbers are `null`, birthday mode stays off. To see it any day, add `?birthday=1` to the
address.

**Privacy: this repo is public.** Everything in it, and in its history, can be read by anyone:
her birthday in `js/config.js`, the family notes in `js/content/notes.js`, the Firebase project
name. Use first names or relations only ("Grandma", "Aunt Zuzu"), never last names, towns, schools,
gyms or team names. To keep her birthday off the internet, leave the date `null` and send her the
link with `?birthday=1` on the end on the day, and the party turns on. A detail
committed by mistake stays in the history even after it is deleted, so check before you commit.

## Changing things

| To change... | Edit |
|---|---|
| Her birthday | `BIRTHDAY` in `js/config.js` (above) |
| Notes from the family | `FAMILY_NOTES` in `js/content/notes.js`. One line each, like `{ from: 'Grandma', text: 'Happy birthday, sweet flyer!' }`. Sign with first names or relations only, never last names. They show up in the menu as "Notes from your family", and she gets a nudge when she arrives. The notes are public on the site and in the repo, so keep them to things you'd put on a birthday card in a shop window. |
| Her starting look (the skin tone is a guess) | `DEFAULT_LOOK` in `js/art/character-looks.js` |
| The colors | `PALETTE` in `js/config.js` |
| What the game says when things happen | the `js/content/hype-lines-*.js` files |
| The quick-cheers | `js/content/emotes.js` |
| Where the spirit sticks are and what they unlock | `js/content/collectibles.js` |

## Playing together online

Solo play works with no internet at all. Playing together on different devices needs a small,
free Google database called Firebase, set up once (about 15 minutes, no credit card). The steps
are in `firebase/SETUP.md`. Until then, "Make a room" says rooms aren't ready yet, and everything
else works.

## Test switches

Add these to the end of the address (start with `?`, join more with `&`):

| Switch | What it does |
|---|---|
| `?solo=1` | Skip the menus, straight onto the island |
| `?room=PLZ7&nick=Sam` | Join (or make) room PLZ7 as "Sam" with the same-browser test link: open it in several tabs to see each other |
| `?birthday=1` | Birthday mode, any day |
| `?welcome=1` | The first-time welcome again on this visit: My cheerleader opens after the splash, and the "Games!" and "Menu" bubbles show |
| `?quality=low` | Battery saver graphics (also in the menu) |
| `?noaudio=1` | No sound at all |
| `?debug=1` | Frame rate, draw calls and position on screen |
| `?autoplay=1` | Hit Zero plays itself, perfectly (for checking the routine) |
| `?net=local` | Rooms between tabs of one browser, instead of Firebase |
| `?check=online` | The online-play check for grown-ups: tries each step of `firebase/SETUP.md` from this device and says which one to fix (none of the game loads) |

## For grown-ups who code

Plain JavaScript modules and three.js, no build step. `BLUEPRINT.md` is the plan every part was
built to. The pages in `dev/` show single parts on their own (the island, the character lineup,
the toss lab, the sound board, Hit Zero). The tests run with `node --test "cloud-nine/test/*.test.mjs"`
from the top of the repo.
