// Basket toss checks in a real browser: drives dev/toss-lab.html through Playwright and asserts on
// what happens (and that the console stays clean). Needs the repo served over HTTP, for example
//   python3 -m http.server 8105 --bind 127.0.0.1        (from the repo root)
//   node cloud-nine/dev/toss-check.cjs [labUrl] [screenshotDir] [scenario,scenario]
// Scenarios: flow cradle swipe touch keys spin basing again calm landscape classic bot (default: all).
// Missing neighbour modules (js/art/character.js, js/content/hype.js) are allowed: the toss falls
// back to stand-ins and built-in lines without them.

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.TOSS_LAB_URL || 'http://127.0.0.1:8105/cloud-nine/dev/toss-lab.html';
const SHOTS = process.argv[3] || '';
const ONLY = process.argv[4] || 'all';
const OPTIONAL = /\/js\/(art\/character|content\/hype)\.js/;
let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log((ok ? 'ok - ' : 'NOT OK - ') + msg);
};

async function open(browser, { w = 390, h = 844, touch = true, query = '', reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    const loc = m.location() || {};
    if (m.type() === 'error' && /Failed to load resource/.test(m.text()) && OPTIONAL.test(loc.url || '')) return;
    if (m.type() === 'warning' && /GL Driver Message/.test(m.text())) return; // SwiftShader noise
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    if (!OPTIONAL.test(r.url())) errors.push('requestfailed: ' + r.url());
  });
  await page.goto(`${BASE}?ui=0${query}`);
  await page.waitForFunction(() => window.__tossLab && window.__tossLab.ready, null, { timeout: 20000 });
  await page.waitForTimeout(400); // the optional modules settle
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // step the lab one frame at a time until the toss state matches (manual mode)
  const until = (src, max = 10) => page.evaluate(({ src, max }) => {
    const pred = new Function('s', 'return ' + src);
    const lab = window.__tossLab;
    let s = lab.state();
    for (let i = 0; i < max * 60 && !pred(s); i++) s = lab.step(1 / 60);
    return s;
  }, { src, max });
  const shot = async (tag, wait = 300) => {
    if (!SHOTS) return;
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${SHOTS.replace(/\/$/, '')}/toss-${tag}.png` });
  };
  return { page, ctx, errors, ev, until, shot };
}

const SCENARIOS = {
  // the whole toss: prompt, count, launch, a trick up, a body position at the apex, a stuck landing
  async flow(browser) {
    const t = await open(browser, { query: '&manual=1&pad=0' });
    await t.ev(() => window.__tossLab.step(1));
    check(await t.ev(() => window.__tossLab.hud.promptLabel) === 'Basket toss!', 'standing on the mat offers "Basket toss!"');
    await t.shot('flow-ready', 50);
    check(await t.ev(() => window.__tossLab.start(0)), 'the toss starts');
    await t.until("s.phase === 'count'");
    await t.ev(() => window.__tossLab.step(1.14));
    await t.shot('flow-dip');
    let s = await t.until("s.phase === 'air' && s.airT > 0.28");
    check(s.apex > 8, 'launched toward the 8 m cloud, apex ' + s.apex.toFixed(1) + ' m');
    await t.shot('flow-launch', 120);
    await t.ev(() => window.__tossLab.gesture('up'));
    s = await t.ev(() => window.__tossLab.state());
    check(s.trick === 'toeTouch', 'swipe up: toe touch');
    s = await t.until('s.inApex && !s.trick');
    await t.ev(() => window.__tossLab.gesture('right'));
    s = await t.ev(() => window.__tossLab.state());
    check(s.trick === 'bowArrow' && s.chain === 2, 'right at the apex: bow and arrow, a two-trick combo');
    await t.ev(() => window.__tossLab.step(0.3));
    await t.shot('flow-apex', 320);
    s = await t.until("s.phase === 'land'");
    check(s.landing === 'stuck', 'stuck the landing');
    const sfx = await t.ev(() => window.__tossLab.audio.log.join(' '));
    check(/count count count count/.test(sfx) && /toss/.test(sfx) && /land/.test(sfx), 'counted 5, 6, 7, 8, tossed and landed with sound');
    await t.ev(() => window.__tossLab.step(0.7));
    await t.shot('flow-land', 450);
    s = await t.until("s.phase === 'idle'");
    const p = await t.ev(() => window.__tossLab.player());
    check(Math.abs(p.y - 8) < 0.05 && p.controlled === null, 'standing on the cloud, control handed back');
    const sent = await t.ev(() => window.__tossLab.net.sent.map((m) => m.data.kind).join(','));
    check(sent === 'toss,tossLand', 'told the squad about the toss and the landing (' + sent + ')');
    return t;
  },

  // still mid-trick at touchdown: a soft cloud cradle, never a crash
  async cradle(browser) {
    const t = await open(browser, { query: '&manual=1&pad=1' });
    await t.ev(() => window.__tossLab.step(1));
    await t.ev(() => window.__tossLab.start(1));
    await t.until("s.phase === 'air' && s.airT > 0.2");
    await t.ev(() => window.__tossLab.gesture('up'));
    await t.until('s.tau > s.T - 0.3');
    await t.ev(() => window.__tossLab.gesture('left'));
    let s = await t.until("s.phase === 'land'");
    check(s.landing === 'cradle', 'mid-trick touchdown is a cradle');
    check(s.tricks.length === 2 && s.tricks[1].done === false, 'the unfinished trick is marked unfinished');
    await t.ev(() => window.__tossLab.step(0.55));
    await t.shot('cradle', 450);
    s = await t.until("s.phase === 'idle'");
    const p = await t.ev(() => window.__tossLab.player());
    check(Math.abs(p.y - 14) < 0.05 && p.controlled === null, 'she ends up standing on the 14 m cloud');
    return t;
  },

  // real mouse swipes through the page
  async swipe(browser) {
    const t = await open(browser, { w: 1024, h: 768, touch: false, query: '&manual=1&pad=0' });
    await t.ev(() => window.__tossLab.step(1));
    await t.ev(() => window.__tossLab.start(0));
    await t.until("s.phase === 'air' && s.airT > 0.2");
    const m = t.page.mouse;
    await m.move(700, 500);
    await m.down();
    for (let i = 1; i <= 8; i++) await m.move(700, 500 - i * 25);
    await m.up();
    let s = await t.ev(() => window.__tossLab.state());
    check(s.trick === 'toeTouch', 'a mouse swipe up is a toe touch');
    await t.until('!s.trick');
    await m.move(770, 400);
    await m.down();
    for (let i = 1; i <= 26; i++) await m.move(700 + Math.cos((i / 24) * Math.PI * 2) * 70, 400 + Math.sin((i / 24) * Math.PI * 2) * 70);
    await m.up();
    s = await t.ev(() => window.__tossLab.state());
    check(s.trick === 'twist' || s.trick === 'arabesque', 'a mouse loop is a twist (or an arabesque at the apex)');
    return t;
  },

  // real touch swipes, the way a phone sends them
  async touch(browser) {
    const t = await open(browser, { query: '&manual=1&pad=0' });
    await t.ev(() => window.__tossLab.step(1));
    await t.ev(() => window.__tossLab.start(0));
    await t.until("s.phase === 'air' && s.airT > 0.2");
    const cdp = await t.ctx.newCDPSession(t.page);
    const swipe = async (x0, y0, x1, y1, n = 8) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= n; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe(300, 300, 300, 480);
    let s = await t.ev(() => window.__tossLab.state());
    check(s.trick === 'pike' || s.trick === 'heelStretch', 'a touch swipe down is a pike');
    await t.until('!s.trick');
    await swipe(120, 650, 280, 650, 6);
    s = await t.ev(() => window.__tossLab.state());
    check(s.trick === 'kickDouble' || s.trick === 'bowArrow', 'a quick swipe from the joystick corner still counts');
    return t;
  },

  // keyboard: Space on the mat tosses, arrows and Space do tricks, WASD steers (never off the cloud)
  async keys(browser) {
    const t = await open(browser, { w: 1024, h: 768, touch: false, query: '&manual=1&pad=2' });
    await t.ev(() => window.__tossLab.step(1));
    await t.page.keyboard.press('Space');
    let s = await t.ev(() => window.__tossLab.state());
    check(s.active && s.phase === 'load', 'Space on the mat starts the toss');
    s = await t.until("s.phase === 'air' && s.airT > 0.2");
    check(s.tricks.length === 0, 'that Space did not also queue a trick');
    await t.page.keyboard.press('ArrowDown');
    s = await t.ev(() => window.__tossLab.state());
    check(s.trick === 'pike', 'ArrowDown: pike');
    await t.page.keyboard.down('KeyD');
    await t.until('!s.trick');
    await t.page.keyboard.press('Space');
    s = await t.ev(() => window.__tossLab.state());
    check(s.trick === 'twist' || s.trick === 'arabesque', 'Space in the air twists');
    s = await t.until("s.phase === 'land'", 12);
    await t.page.keyboard.up('KeyD');
    check(Math.hypot(s.steer[0], s.steer[1]) > 0.3, 'D steered the landing point');
    const p = await t.ev(() => window.__tossLab.player());
    const pad = (await t.ev(() => window.__tossLab.toss.pads))[2];
    check(Math.abs(p.y - 22) < 0.05 && Math.hypot(p.x - pad.target.x, p.z - pad.target.z) < 3.9, 'steered, and still landed on the 22 m cloud');
    return t;
  },

  // twists really turn the flyer: a full twist is one whole turn, a kick double two
  async spin(browser) {
    const t = await open(browser, { query: '&manual=1&pad=2' });
    await t.ev(() => window.__tossLab.step(1));
    await t.ev(() => window.__tossLab.start(2));
    await t.until("s.phase === 'air' && s.airT > 0.2");
    const turns = (g) => t.page.evaluate((g) => {
      const lab = window.__tossLab;
      lab.gesture(g);
      let prev = lab.player().h;
      let total = 0;
      for (let i = 0; i < 70 && lab.state().trick; i++) {
        lab.step(1 / 60);
        const h = lab.player().h;
        let d = h - prev;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        total += d;
        prev = h;
      }
      return total / (Math.PI * 2);
    }, g);
    const a = await turns('circle');
    check(Math.abs(Math.abs(a) - 1) < 0.05, 'a full twist turns once (' + a.toFixed(2) + ')');
    const b = await turns('left');
    check(Math.abs(Math.abs(b) - 2) < 0.05, 'a kick double turns twice (' + b.toFixed(2) + ')');
    return t;
  },

  // the local player bases on a spot while a friend tosses from the same pad
  async basing(browser) {
    const t = await open(browser, { query: '&manual=1&pad=0&friends=1' });
    await t.ev(() => window.__tossLab.step(1));
    await t.ev(() => window.__tossLab.baseMe(0, 1));
    await t.ev(() => window.__tossLab.step(0.8));
    let s = await t.ev(() => window.__tossLab.state());
    check(s.basing && s.crews[0].meSpot === 1 && s.crews[0].friends === 1, 'basing on spot 1 next to one friend');
    check((await t.ev(() => window.__tossLab.player())).avatarAnim === 'base', 'my avatar holds the base pose');
    check(!(await t.ev(() => window.__tossLab.hud.promptLabel)), 'no toss prompt while basing');
    await t.ev(() => window.__tossLab.friendToss(0));
    await t.ev(() => window.__tossLab.step(0.9));
    s = await t.ev(() => window.__tossLab.state());
    check(s.crews[0].cue === 'count', 'our bases dip for the friend');
    await t.ev(() => window.__tossLab.step(1.0));
    const anim = (await t.ev(() => window.__tossLab.player())).avatarAnim;
    check(anim === 'throw' || anim === 'cheer', 'I throw for my friend');
    await t.shot('basing', 150);
    await t.ev(() => window.__tossLab.step(3));
    const toasts = await t.ev(() => window.__tossLab.hud.log.join(' | '));
    check(/basing for Sunny Bow/.test(toasts) && /stuck it/.test(toasts), 'toasts say who I based for and cheer their landing');
    return t;
  },

  // "Toss again!" floats you back to the mat and goes, live (not stepped)
  async again(browser) {
    const t = await open(browser, { query: '&pad=0' });
    await t.page.waitForTimeout(600);
    await t.ev(() => window.__tossLab.start(0));
    await t.page.waitForFunction(() => window.__tossLab.state().phase === 'idle' && window.__tossLab.state().card, null, { timeout: 15000 });
    await t.page.click('.c9t-again');
    await t.page.waitForFunction(() => window.__tossLab.state().active, null, { timeout: 5000 });
    check((await t.ev(() => window.__tossLab.state())).pad === 'toss-1', 'Toss again! starts a new toss on the same pad');
    return t;
  },

  // reduced motion: no hang at the apex
  async calm(browser) {
    const t = await open(browser, { query: '&manual=1&pad=1', reduced: true });
    await t.ev(() => window.__tossLab.step(1));
    await t.ev(() => window.__tossLab.start(1));
    await t.until("s.phase === 'air'");
    const s = await t.ev(() => {
      const lab = window.__tossLab;
      let s2 = lab.state();
      let n = 0;
      while (s2.phase === 'air' && n < 600) {
        s2 = lab.step(1 / 60);
        n++;
      }
      return Object.assign(s2, { n });
    });
    check(Math.abs(s.n / 60 - s.T) < 0.08, `no slow motion: ${(s.n / 60).toFixed(2)} s in the air for a ${s.T.toFixed(2)} s arc`);
    return t;
  },

  // a phone on its side
  async landscape(browser) {
    const t = await open(browser, { w: 844, h: 390, query: '&manual=1&pad=1&friends=1' });
    await t.ev(() => window.__tossLab.step(1));
    await t.ev(() => window.__tossLab.start(1));
    await t.until("s.phase === 'air' && s.airT > 0.2");
    await t.ev(() => window.__tossLab.gesture('up'));
    await t.until('s.inApex');
    await t.ev(() => window.__tossLab.gesture('down'));
    await t.ev(() => window.__tossLab.step(0.25));
    await t.shot('landscape-apex', 320);
    const s = await t.until("s.phase === 'land'");
    check(s.friends === 1 && s.landing === 'stuck', 'a squad toss lands on a phone on its side');
    await t.ev(() => window.__tossLab.step(0.7));
    await t.shot('landscape-land', 450);
    return t;
  },

  // no cloud to aim at: straight up and back into the bases' arms
  async classic(browser) {
    const t = await open(browser, { query: '&manual=1&pad=1&classic=1' });
    await t.ev(() => window.__tossLab.step(1));
    await t.ev(() => window.__tossLab.start(1));
    let s = await t.until("s.phase === 'land'");
    check(s.classic && s.landing === 'stuck', 'a clean classic catch');
    await t.ev(() => window.__tossLab.step(0.5));
    await t.shot('classic', 350);
    s = await t.until("s.phase === 'idle'");
    const p = await t.ev(() => window.__tossLab.player());
    const pad = (await t.ev(() => window.__tossLab.toss.pads))[1];
    check(Math.hypot(p.x - pad.x, p.z - pad.z) < 0.05 && Math.abs(p.y - pad.y) < 0.05, 'back on her feet on the mat');
    return t;
  },

  // bots never base
  async bot(browser) {
    const t = await open(browser, { query: '&manual=1&pad=0&bot=spot' });
    await t.ev(() => window.__tossLab.step(1));
    check((await t.ev(() => window.__tossLab.state())).crews[0].friends === 0, 'a bot on a base spot adds nothing');
    await t.ev(() => window.__tossLab.setFriends(2, 0));
    await t.ev(() => window.__tossLab.step(0.3));
    await t.ev(() => window.__tossLab.start(0));
    const s = await t.until("s.phase === 'air'");
    check(s.friends === 2 && Math.abs(s.apex - 13.8) < 0.01, 'two real friends lift the apex by 3.2 m');
    return t;
  },
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const names = ONLY === 'all' ? Object.keys(SCENARIOS) : ONLY.split(',');
  for (const n of names) {
    console.log('# ' + n);
    const t = await SCENARIOS[n](browser);
    check(t.errors.length === 0, 'a clean console' + (t.errors.length ? ':\n  ' + t.errors.join('\n  ') : ''));
    await t.ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
