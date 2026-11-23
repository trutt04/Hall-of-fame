// The online-play check card. index.html?check=online opens it instead of the game (js/start.js):
// whoever set up Firebase (firebase/SETUP.md) opens the game's address with ?check=online added,
// on one device, and the card runs js/net/check.js, turning each line into a check mark or a cross
// with a sentence, then says the first thing to fix in big letters, or that online play is ready.
// Nothing of the game loads: no 3D, no sound, no menus. Every text goes in with textContent.
//
//   mountOnlineCheck({ host = document.body, run = runOnlineCheck } = {}) -> Promise<{ again() -> Promise<report> }>
//   READY_TITLE, READY_LINE    what the card says when every line passed
// Its look: the menus' card and buttons (css/menu.css) plus css/netcheck.css.

import { runOnlineCheck, CHECK_LINES } from '../net/check.js';
import { el, icon, bowSvg, starSvg, onTap, loadCss, reducedMotion } from './dom.js';

export const READY_TITLE = 'Online play is ready!';
export const READY_LINE = 'Make a room on one device and join it from another.';

const MARKS = { pass: 'check', fail: 'close', running: 'sparkle' };
const SAYS = { waiting: 'not checked yet', running: 'checking', pass: 'works', fail: 'needs a fix', skip: 'not checked' };

export async function mountOnlineCheck({ host = document.body, run = runOnlineCheck } = {}) {
  await loadCss('css/netcheck.css'); // the loading veil stays up until the card has its look
  document.title = 'Cloud Nine: online play check';
  document.documentElement.classList.add('c9nc-page');
  // the game's own page stays asleep: the 3D canvas, the HUD and the loading veil step aside
  for (const id of ['scene', 'hud', 'screens', 'veil', 'fallback']) {
    const node = document.getElementById(id);
    if (node) node.hidden = true;
  }

  const page = el('main', 'c9nc');
  const card = el('section', 'c9m-card c9nc-card');
  card.setAttribute('aria-labelledby', 'c9nc-title');
  const bow = bowSvg({ className: 'c9nc-bow' });
  const kicker = el('p', 'c9m-kicker', 'For grown-ups');
  const title = el('h1', 'c9m-title c9nc-title');
  title.id = 'c9nc-title';
  const intro = el('p', 'c9m-sub c9nc-intro', 'This tries each step of the setup guide (firebase/SETUP.md) from this device. It takes a few seconds and leaves nothing behind.');
  const list = el('ol', 'c9nc-lines');
  const rows = new Map();
  for (const l of CHECK_LINES) {
    const li = el('li', 'c9nc-line');
    li.dataset.id = l.id;
    const mark = el('span', 'c9nc-mark');
    mark.setAttribute('aria-hidden', 'true');
    const words = el('div', 'c9nc-words');
    const name = el('p', 'c9nc-name', l.title);
    const said = el('span', 'c9nc-sr');
    name.appendChild(said);
    const text = el('p', 'c9nc-text');
    const code = el('p', 'c9nc-code');
    words.append(name, text, code);
    li.append(mark, words);
    list.appendChild(li);
    rows.set(l.id, { li, mark, said, text, code, state: null });
  }
  const result = el('div', 'c9nc-result');
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  const again = el('button', 'c9m-btn c9m-btn-primary c9nc-again');
  again.type = 'button';
  again.append(icon('reload'), el('span', 'c9-btn-label', 'Run again'));
  const back = el('a', 'c9nc-back', 'Back to the game');
  back.href = './';
  const actions = el('div', 'c9nc-actions');
  actions.append(again, back);
  card.append(bow, kicker, title, intro, list, result, actions);
  page.appendChild(card);
  host.appendChild(page);

  function showLine(l) {
    const r = rows.get(l.id);
    if (!r) return;
    r.li.dataset.state = l.state;
    r.said.textContent = ': ' + SAYS[l.state];
    r.text.textContent = l.text || '';
    r.text.hidden = !l.text;
    r.code.textContent = l.code ? 'Firebase said: ' + l.code : '';
    r.code.hidden = !l.code;
    if (r.state !== l.state) {
      r.state = l.state;
      r.mark.replaceChildren();
      if (MARKS[l.state]) r.mark.appendChild(icon(MARKS[l.state]));
    }
  }

  function showResult(report) {
    result.replaceChildren();
    if (!report.done) {
      result.hidden = true;
      return;
    }
    result.hidden = false;
    if (report.ok) {
      result.dataset.kind = 'ok';
      const stars = el('div', 'c9nc-stars');
      stars.setAttribute('aria-hidden', 'true');
      for (const c of ['#ff2e93', '#a96bff', '#ffd36e', '#17121c', '#ff7ad1']) stars.appendChild(starSvg(c, 'c9nc-star'));
      result.append(stars, el('p', 'c9nc-big', READY_TITLE), el('p', 'c9nc-small', READY_LINE));
      return;
    }
    const first = report.first;
    const warn = first && first.id === 'safety' && /too open/.test(first.text);
    result.dataset.kind = warn ? 'warn' : 'fix';
    result.append(
      el('p', 'c9nc-result-kicker', warn ? 'Fix this first' : 'First thing to fix'),
      el('p', 'c9nc-big', first ? first.text : 'Something went wrong. Run the check again.'),
      el('p', 'c9nc-small', 'Then tap "Run again" to check once more.'),
    );
  }

  function show(report) {
    for (const l of report.lines) showLine(l);
    title.textContent = report.done ? 'Online play check' : 'Checking online play…';
    page.toggleAttribute('data-busy', !report.done);
    again.disabled = !report.done;
    showResult(report);
  }

  let running = null;
  function start() {
    if (running) return running;
    running = (async () => {
      const report = await run({ onChange: show });
      show(report);
      // the verdict and the buttons come into view on a short screen
      if (typeof actions.scrollIntoView === 'function') actions.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      return report;
    })();
    running.catch((err) => console.error('[c9 check] the card stopped', err)).then(() => {
      running = null;
    });
    return running;
  }
  onTap(again, () => {
    start().catch(() => {});
  });
  start().catch(() => {});
  return { again: start };
}
