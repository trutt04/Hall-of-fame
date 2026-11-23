// Games review checks in a real browser (PLAY): the results awards card, a hider who can tell she
// is hidden, a spectator kept off the field, and rooms where people come and go mid-game (a late
// joiner, the seeker / "it" / the bow carrier leaving, the host leaving, Play again!).
//   python3 -m http.server 8116 --bind 127.0.0.1          (from the repo root)
//   node cloud-nine/dev/play-review-check.cjs [baseUrl] [shotsDir] [scenario,scenario]
// Scenarios: awards hidden toasts spectator leavers hostleaves perf (default: all). Screenshots are
// written as games-<name>.png when a directory is given (never commit them).

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:8116/cloud-nine/index.html';
const SHOTS = (process.argv[3] || '').replace(/\/$/, '');
const ONLY = (process.argv[4] || 'all').split(',');
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log((ok ? 'ok - ' : 'NOT OK - ') + msg);
};
const want = (s) => ONLY.includes('all') || ONLY.includes(s);

async function openPage(ctx, query) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'warning' && /GL Driver Message|GPU stall/.test(t)) return;
    if (m.type() === 'error') errors.push(t);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + query);
  await page.waitForFunction(() => window.__c9 && window.__c9.play && window.__c9.mode === 'play', null, { timeout: 45000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const info = () => ev(() => window.__c9.play.info());
  const until = async (pred, ms = 20000, label = '') => {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try {
        v = await pred();
      } catch (err) {
        v = null;
      }
      if (v) return v;
      if (Date.now() - t0 > ms) {
        console.log('  (timed out waiting for ' + label + ')');
        return null;
      }
      await page.waitForTimeout(150);
    }
  };
  const shot = async (name, wait = 250) => {
    if (!SHOTS) return;
    await ev(() => window.__c9.hud.hideHint && window.__c9.hud.hideHint());
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${SHOTS}/games-${name}.png` });
  };
  return { page, errors, ev, info, until, shot };
}

const phone = (browser) => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });

// ---------------------------------------------------------------- solo: awards for everyone
async function awards(browser, kind) {
  const ctx = await phone(browser);
  const t = await openPage(ctx, `?solo=1&game=${kind}&bots=5&speed=4&quick=1&noaudio=1`);
  await t.until(async () => (await t.info())?.phase === 'play', 40000, 'play');
  await t.page.waitForTimeout(kind === 'dodgeball' ? 2500 : 1500);
  await t.ev(() => window.__c9.play.finishRound());
  await t.until(async () => (await t.info())?.phase === 'results', 10000, 'results');
  // the splash first, then the card
  const card = await t.until(() => t.ev(() => {
    const n = document.querySelector('.c9p-awards');
    return n && !n.hidden ? { mine: (n.querySelector('.c9p-award-title') || {}).textContent, rows: n.querySelectorAll('.c9p-award-row').length } : null;
  }), 9000, 'the awards card');
  check(!!card && !!card.mine, `${kind}: my award shows (${card && card.mine})`);
  check(!!card && card.rows === 5, `${kind}: everybody else's award is listed too (${card && card.rows})`);
  const st = await t.ev(() => {
    const s = window.__c9.play.state;
    return { n: s.order.length, a: s.result && s.result.awards ? Object.keys(s.result.awards).length : 0 };
  });
  check(st.a === st.n, `${kind}: ${st.a} awards for ${st.n} players`);
  await t.shot(`awards-${kind}`, 400);
  // it stays through the break, and goes at the next countdown
  await t.until(async () => (await t.info())?.phase === 'lobby', 12000, 'the break');
  const still = await t.ev(() => !document.querySelector('.c9p-awards').hidden);
  check(still, `${kind}: the awards stay up through the break`);
  await t.ev(() => window.__c9.play.again());
  await t.until(async () => (await t.info())?.phase === 'countdown', 5000, 'countdown');
  await t.page.waitForTimeout(300);
  const gone = await t.ev(() => document.querySelector('.c9p-awards').hidden);
  check(gone, `${kind}: Play again! puts the awards away`);
  check(t.errors.length === 0, `${kind}: no console errors` + (t.errors.length ? '\n    ' + t.errors.slice(0, 4).join('\n    ') : ''));
  await ctx.close();
}

// ---------------------------------------------------------------- solo hide and seek: hidden!
async function hidden(browser) {
  // the seeker rotates at random: try a few times until she is a hider
  let ctx = null;
  let t = null;
  for (let k = 0; k < 4; k++) {
    ctx = await phone(browser);
    t = await openPage(ctx, '?solo=1&game=hideSeek&bots=5&speed=2&noaudio=1');
    await t.until(async () => (await t.info())?.phase === 'hide', 40000, 'hide');
    if ((await t.info()).me.role === 'hider') break;
    await ctx.close();
    ctx = null;
  }
  if (!ctx) {
    console.log('# (she was the seeker every time: the hidden check is skipped)');
    return;
  }
  // gold glints over the hide spots near her, while she hides
  await t.page.waitForTimeout(1800); // the "Hide!" splash goes first
  const glints = await t.until(async () => (await t.info())?.props?.spots > 0, 4000, 'spot glints');
  check(!!glints, 'hide and seek: glints over the hide spots near her while she hides');
  const calls = await t.ev(() => window.__c9.renderer.info.render.calls);
  // look into the garden for the picture (the camera's yaw points back at the view)
  await t.ev(() => {
    const w = window.__c9;
    const a = w.play.session.game.arena.area.f;
    const p = w.player.position;
    w.rig.yaw = Math.atan2(a.x - p.x, a.z - p.z) + Math.PI;
  });
  await t.shot('hide-spots', 600);
  // walk her into a hedge spot (teleporting her there, like a kid who ran there)
  await t.ev(() => {
    const w = window.__c9;
    const s = w.play.session.game.arena.spots[0];
    w.player.position.x = s.x;
    w.player.position.z = s.z;
  });
  const badge = await t.until(() => t.ev(() => {
    const n = document.querySelector('.c9-game');
    return n && /Hidden!/.test(n.textContent) ? n.textContent : null;
  }), 4000, 'Hidden! badge');
  check(!!badge, 'hide and seek: tucked into a spot, her badge says Hidden!');
  await t.shot('hidden', 300);
  const seek = await t.until(async () => (await t.info())?.phase === 'play', 25000, 'seeking');
  const off = seek && (await t.info()).props.spots === 0;
  check(!!off, `hide and seek: the glints go when seeking starts (${calls} draw calls while hiding)`);
  await ctx.close();
}

// ---------------------------------------------------------------- a toast during a splash waits
async function toasts(browser) {
  const ctx = await phone(browser);
  const t = await openPage(ctx, '?solo=1&noaudio=1');
  await t.page.waitForTimeout(1500);
  const during = await t.ev(async () => {
    const hud = window.__c9.hud;
    const done = hud.big('Bonk!', 'To the bench. Cheer them on!', { ms: 1500 });
    hud.toast('Ava hit you! Cheer from the bench.');
    hud.toast('Bea made a great catch!');
    const shown = document.querySelectorAll('.c9-toast').length;
    await done;
    return { shown };
  });
  check(during.shown === 0, `toasts: while a splash is up, toasts wait (${during.shown} on screen)`);
  const after = await t.until(() => t.ev(() => {
    const big = document.querySelector('.c9-big');
    const n = document.querySelectorAll('.c9-toast').length;
    return n >= 2 && big && big.hidden ? n : null;
  }), 3000, 'the held toasts');
  check(after >= 2, `toasts: once the splash has gone, the held toasts show (${after})`);
  await t.shot('toasts-after-splash', 100);
  // a real game moment: the countdown and "Go!" splash, then the news
  check(t.errors.length === 0, 'toasts: no console errors' + (t.errors.length ? '\n    ' + t.errors.slice(0, 4).join('\n    ') : ''));
  await ctx.close();
}

// ---------------------------------------------------------------- rooms
async function room(browser, nicks, code) {
  const ctx = await phone(browser);
  const tabs = [];
  for (const nick of nicks) {
    tabs.push(await openPage(ctx, `?room=${code}&nick=${nick}&noaudio=1`));
    await tabs[tabs.length - 1].page.waitForTimeout(600);
  }
  await tabs[0].until(() => tabs[0].ev((n) => window.__c9.net.players.size >= n, nicks.length), 15000, 'everyone in');
  return { ctx, tabs };
}

async function spectator(browser) {
  const { ctx, tabs } = await room(browser, ['Ava', 'Bea'], 'PLZ8');
  const [host, bea] = tabs;
  await host.ev(() => window.__c9.hostStartGame('dodgeball'));
  await bea.until(async () => (await bea.info())?.phase === 'play', 30000, 'play on Bea');
  await bea.ev(() => window.__c9.play.leave());
  await bea.until(async () => (await bea.info())?.inGame === false, 8000, 'Bea out');
  // she walks to the middle of the court
  const c = await bea.ev(() => {
    const w = window.__c9;
    const f = w.play.session.game.arena.area.f;
    w.player.position.x = f.x;
    w.player.position.z = f.z;
    return { x: f.x, z: f.z };
  });
  const out = await bea.until(() => bea.ev(() => {
    const w = window.__c9;
    const a = w.play.session.game.arena.area;
    const p = w.player.position;
    const dx = p.x - a.f.x;
    const dz = p.z - a.f.z;
    const lx = dx * a.f.c - dz * a.f.s;
    const lz = dx * a.f.s + dz * a.f.c;
    return Math.abs(lx) > a.hw + 0.5 || Math.abs(lz) > a.hd + 0.5;
  }), 6000, 'off the court');
  check(out, 'spectator: a friend who stepped out is eased off the court to the sideline');
  await bea.shot('spectator', 300);
  await host.ev(() => window.__c9.play.end());
  await ctx.close();
}

// The seeker, "it" and the bow carrier leave mid-game: the round goes on (or ends kindly).
async function leavers(browser) {
  for (const kind of ['hideSeek', 'freezeTag', 'captureBow']) {
    const { ctx, tabs } = await room(browser, ['Ava', 'Bea', 'Cy'], kind === 'hideSeek' ? 'PLZ9' : kind === 'freezeTag' ? 'PLQ9' : 'PLW9');
    const [host] = tabs;
    await host.ev((k) => window.__c9.hostStartGame(k), kind);
    await host.until(async () => ['play', 'hide'].includes((await host.info())?.phase), 30000, 'play');
    if (kind !== 'hideSeek') await host.until(async () => (await host.info())?.phase === 'play', 15000, 'play');
    // make a friend (tab 2 or 3) the key player, then close their tab
    const key = await host.ev((k) => {
      const w = window.__c9;
      const g = w.play.session.game;
      const st = g.state;
      const humans = st.order.filter((id) => !st.players[id].bot && id !== w.net.me.id);
      const id = humans[0];
      const p = st.players[id];
      if (k === 'hideSeek') {
        for (const o of st.order) if (st.players[o].role === 'seeker') st.players[o].role = 'hider';
        p.role = 'seeker';
      } else if (k === 'freezeTag') {
        for (const o of st.order) st.players[o].role = 'runner';
        p.role = 'it';
      } else {
        const bow = st.bows[1 - p.team];
        bow.s = 'carried';
        bow.by = id;
      }
      st.seq++;
      return { id, nick: p.nick };
    }, kind);
    const leaving = tabs.find((x) => true) && tabs.slice(1);
    let closed = false;
    for (const t of leaving) {
      const me = await t.ev(() => window.__c9.net.me.id);
      if (me === key.id) {
        await t.page.close();
        closed = true;
      }
    }
    check(closed, `${kind}: the key player's tab closed (${key.nick})`);
    const after = await host.until(() => host.ev((k) => {
      const w = window.__c9;
      const s = w.play.session;
      if (!s || !s.game) return { gone: true };
      const st = s.game.state;
      if (st.order.length >= 0 && !st.players) return null;
      const ok = k === 'hideSeek' ? st.order.some((o) => st.players[o].role === 'seeker') || st.phase !== 'play'
        : k === 'freezeTag' ? st.order.some((o) => st.players[o].role === 'it') || st.phase !== 'play'
          : st.bows.every((b) => b.s !== 'carried' || st.players[b.by]);
      return Object.keys(st.players).length < 5 && ok ? { phase: st.phase, n: st.order.length } : null;
    }, kind), 25000, 'the round carries on');
    check(!!after, `${kind}: with the key player gone the round carries on (${JSON.stringify(after)})`);
    // and it still finishes and comes back round
    await host.ev(() => window.__c9.play.finishRound());
    const res = await host.until(async () => ['results', 'lobby'].includes((await host.info())?.phase), 8000, 'results');
    check(!!res, `${kind}: the round still finishes`);
    await host.ev(() => window.__c9.play.end());
    await ctx.close();
  }
}

// The host leaves mid-game: the next host carries on, a late joiner is added, Play again! works.
async function hostLeaves(browser) {
  const { ctx, tabs } = await room(browser, ['Ava', 'Bea', 'Cy'], 'PLX8');
  const [host, bea, cy] = tabs;
  await host.ev(() => window.__c9.hostStartGame('freezeTag'));
  await bea.until(async () => (await bea.info())?.phase === 'play', 30000, 'play');
  const gid = (await bea.info()).gid;
  await host.page.close();
  const next = await bea.until(async () => {
    const [a, b] = [await bea.info(), await cy.info()];
    return (a && a.isHost) || (b && b.isHost) ? { a, b } : null;
  }, 30000, 'a new host');
  check(!!next, 'host leaves: a friend becomes the host');
  const nh = next && next.a && next.a.isHost ? bea : cy;
  const other = nh === bea ? cy : bea;
  const carry = await nh.until(async () => {
    const i = await nh.info();
    return i && i.gid === gid && i.isHost ? i : null;
  }, 5000, 'same game');
  check(!!carry, 'host leaves: the same game carries on with the new host');
  // the clock still runs: the phase timer moves on
  const t0 = await nh.ev(() => window.__c9.play.session.game.ui(window.__c9.net.me.id).timer);
  await nh.page.waitForTimeout(2500);
  const t1 = await nh.ev(() => window.__c9.play.session.game.ui(window.__c9.net.me.id).timer);
  check(t1 !== null && t0 !== null && t1 < t0, `host leaves: the timer keeps counting (${t0} -> ${t1})`);
  // the bots went home with the old host; the new host's game has no ghosts
  const ghosts = await nh.ev(() => {
    const w = window.__c9;
    const st = w.play.session.game.state;
    return st.order.filter((id) => !w.net.players.has(id)).length;
  });
  check(ghosts === 0, `host leaves: nobody stuck in the game who isn't in the room (${ghosts})`);
  // a late joiner
  const dee = await openPage(ctx, '?room=PLX8&nick=Dee&noaudio=1');
  const joined = await dee.until(async () => (await dee.info())?.inGame, 25000, 'Dee in the game');
  check(!!joined, 'late joiner: Dee joins the game in progress');
  // finish, Play again!
  await nh.ev(() => window.__c9.play.finishRound());
  await nh.until(async () => (await nh.info())?.phase === 'lobby', 15000, 'the break');
  const btn = nh.page.locator('.c9p-btn-go:not([hidden])').first();
  const visible = await btn.isVisible().catch(() => false);
  check(visible, 'Play again! is on the new host\'s screen');
  if (visible) await btn.click({ force: true }); // it bobs forever (the nudge), so never 'stable'
  const again = await other.until(async () => (await other.info())?.phase === 'countdown', 8000, 'countdown everywhere');
  check(!!again, 'Play again! starts the next round on every device');
  await nh.page.locator('.c9p-btn-leave').click();
  await nh.page.locator('.c9-card button').last().click().catch(() => {});
  const roam = await other.until(() => other.ev(() => !window.__c9.play.session && !window.__c9.player.frozen), 8000, 'free roam');
  check(!!roam, 'everyone is back in free roam after End game');
  for (const t of [nh, other, dee]) {
    const errs = t.errors.filter((e) => !/Failed to load resource/.test(e));
    check(errs.length === 0, 'no console errors' + (errs.length ? '\n    ' + errs.slice(0, 4).join('\n    ') : ''));
  }
  await ctx.close();
}

// 10 players: draw calls, triangles, and memory after three games
async function perf(browser) {
  const ctx = await phone(browser);
  const t = await openPage(ctx, '?solo=1&bots=9&noaudio=1');
  await t.page.waitForTimeout(2500);
  // two rounds of the three games: the first builds the pooled props and uploads the court, the
  // field and the garden the first time they're seen; the second must add nothing
  const mems = [];
  const rows = [];
  for (const kind of ['dodgeball', 'captureBow', 'hideSeek', 'dodgeball', 'captureBow', 'hideSeek']) {
    await t.ev((k) => window.__c9.hostStartGame(k), kind);
    await t.until(async () => ['play', 'hide'].includes((await t.info())?.phase), 30000, kind + ' play');
    await t.page.waitForTimeout(2500);
    const r = await t.ev(() => {
      const w = window.__c9;
      const i = w.renderer.info.render;
      return { calls: i.calls, tris: i.triangles, players: w.play.info().players };
    });
    rows.push({ kind, ...r });
    check(r.calls <= 220 && r.tris <= 160000, `perf ${kind}: ${r.players} players, ${r.calls} draw calls, ${r.tris} triangles`);
    await t.ev(() => window.__c9.play.end());
    await t.page.waitForTimeout(1500);
    mems.push(await t.ev(() => ({ ...window.__c9.renderer.info.memory })));
  }
  console.log('# memory after each game', JSON.stringify(mems));
  let [a, b] = [mems[2], mems[5]];
  if (b.geometries - a.geometries > 3) {
    // a part of the island seen for the first time uploads its geometry once (the garden when the
    // camera only got there in the second round): one more round must then add nothing
    for (const kind of ['dodgeball', 'captureBow', 'hideSeek']) {
      await t.ev((k) => window.__c9.hostStartGame(k), kind);
      await t.until(async () => ['play', 'hide'].includes((await t.info())?.phase), 30000, kind + ' play');
      await t.page.waitForTimeout(2500);
      await t.ev(() => window.__c9.play.end());
      await t.page.waitForTimeout(1500);
    }
    a = b;
    b = await t.ev(() => ({ ...window.__c9.renderer.info.memory }));
    console.log('# one more round', JSON.stringify(b));
  }
  check(b.geometries - a.geometries <= 3 && b.textures <= a.textures + 1, `perf: three more games leave nothing behind (geometries ${a.geometries} -> ${b.geometries}, textures ${a.textures} -> ${b.textures})`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  try {
    if (want('awards')) for (const k of ['hideSeek', 'freezeTag', 'dodgeball', 'captureBow']) {
      console.log('# awards ' + k);
      await awards(browser, k).catch((e) => check(false, 'awards threw: ' + e.message));
    }
    if (want('hidden')) {
      console.log('# hidden');
      await hidden(browser).catch((e) => check(false, 'hidden threw: ' + e.message));
    }
    if (want('toasts')) {
      console.log('# toasts');
      await toasts(browser).catch((e) => check(false, 'toasts threw: ' + e.message));
    }
    if (want('spectator')) {
      console.log('# spectator');
      await spectator(browser).catch((e) => check(false, 'spectator threw: ' + e.message));
    }
    if (want('leavers')) {
      console.log('# leavers');
      await leavers(browser).catch((e) => check(false, 'leavers threw: ' + e.message));
    }
    if (want('hostleaves')) {
      console.log('# hostleaves');
      await hostLeaves(browser).catch((e) => check(false, 'hostleaves threw: ' + e.message));
    }
    if (want('perf')) {
      console.log('# perf');
      await perf(browser).catch((e) => check(false, 'perf threw: ' + e.message));
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
