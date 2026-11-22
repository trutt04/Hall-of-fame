// Dev page for the character creator: opens it, shows what comes back. window.__creator is the
// open handle (for tests); window.__creatorReady turns true once it is on screen.
import { openCreator } from '../js/ui/creator.js';
import { DEFAULT_LOOK, randomLook } from '../js/art/character.js';

const q = new URLSearchParams(location.search);
const out = document.getElementById('out');
let look = q.get('random') === '1' ? randomLook(Math.random) : { ...DEFAULT_LOOK };
let nick = q.get('nick') || '';

function open() {
  window.__creatorReady = false;
  window.__creatorResult = null;
  window.__creator = openCreator({
    look,
    nick,
    onDone(l, n) {
      look = l;
      nick = n;
      window.__creatorResult = { done: true, look: l, nick: n };
      out.textContent = 'Done!\n' + JSON.stringify({ nick: n, look: l }, null, 2);
    },
    onCancel() {
      window.__creatorResult = { done: false };
      out.textContent = 'Cancelled. Nothing changed.';
    },
  });
  setTimeout(() => { window.__creatorReady = true; }, 400);
}
document.getElementById('open').addEventListener('click', open);
open();
