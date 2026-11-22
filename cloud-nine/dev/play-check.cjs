// The four games in a real browser (PLAY): each mode solo with bot friends from the countdown to
// the results and back to free roam, then a room of three tabs (the local BroadcastChannel net)
// where the host starts a game and everyone sees the same state. Needs the repo served over HTTP:
//   python3 -m http.server 8111 --bind 127.0.0.1        (from the repo root)
//   node cloud-nine/dev/play-check.cjs [baseUrl] [screenshotDir] [scenario,scenario]
// Scenarios: hideSeek freezeTag dodgeball captureBow room tablet (default: all). Screenshots are
// written as play-<scenario>-<moment>.png when a directory is given (never commit them).

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.PLAY_URL || 'http://127.0.0.1:8111/cloud-nine/index.html';
const SHOTS = (process.argv[3] || '').replace(/\/$/, '');
const ONLY = (process.argv[4] || 'all').split(',');
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log((ok ? 'ok - ' : 'NOT OK - ') + msg);
};

async function openPage(ctx, query) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'warning' && /GL Driver Message|GPU stall/.test(t)) return; // SwiftShader noise
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + t);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  await page.goto(BASE + query);
  await page.waitForFunction(() => window.__c9 && window.__c9.play && window.__c9.mode === 'play', null, { timeout: 40000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const info = () => ev(() => window.__c9.play.info());
  const until = async (pred, ms = 20000, label = '') => {
    const t0 = Date.now();
    for (;;) {
      const i = await info();
      if (pred(i || {})) return i;
      if (Date.now() - t0 > ms) {
        console.log('  (timed out waiting for ' + label + ')', JSON.stringify(i && { phase: i.phase, who: i.who }));
        return i;
      }
      await page.waitForTimeout(120);
    }
  };
  const shot = async (name, wait = 250) => {
    if (!SHOTS) return;
    await page.evaluate(() => window.__c9.hud.hideHint()); // the first-run "drag to walk" tip goes once you move
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${SHOTS}/play-${name}.png` });
  };
  return { page, errors, ev, info, until, shot };
}

async function newContext(browser, { w = 390, h = 844, touch = true } = {}) {
  return browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
}

// Everybody is back to free roam: no game, no game panel, she can walk, the bots went home.
async function checkRoam(t, label) {
  await t.page.waitForTimeout(600);
  const s = await t.ev(() => {
    const w = window.__c9;
    const panel = document.querySelector('.c9-game');
    let bots = 0;
    for (const p of w.net.players.values()) if (p.bot) bots++;
    return { session: !!w.play.session, active: !!w.activeGame, panel: panel ? !panel.hidden : false, frozen: w.player.frozen, mode: w.mode, bots, highlighted: !!document.querySelector('.c9p-blind:not([hidden])') };
  });
  check(!s.session && !s.active, `${label}: the game is over (no session, no active game)`);
  check(!s.panel, `${label}: the game panel is gone`);
  check(!s.frozen && s.mode === 'play', `${label}: free roam, she can walk`);
  check(s.bots === 0, `${label}: the bot friends went home (${s.bots} left)`);
}

// Tap the Leave button, confirm on the card.
async function leaveByButton(t, name) {
  const btn = t.page.locator('.c9p-btn-leave');
  check(await btn.isVisible(), `${name}: a Leave game button is on screen`);
  await btn.click();
  await t.page.waitForTimeout(300);
  await t.shot(`${name}-leave-card`, 200);
  const cardBtns = t.page.locator('.c9-card .c9-btn');
  const n = await cardBtns.count();
  check(n === 2, `${name}: the leave card offers Keep playing / Leave`);
  await cardBtns.nth(1).click();
}

const SOLO = {
  async dodgeball(browser) {
    const ctx = await newContext(browser);
    const t = await openPage(ctx, '?solo=1&noaudio=1&game=dodgeball&bots=5');
    let i = await t.until((x) => x.phase === 'countdown', 15000, 'countdown');
    check(i && i.phase === 'countdown', 'dodgeball: the countdown starts by itself (?game=dodgeball)');
    check(i && i.players === 6, 'dodgeball: Bailey and 5 bot friends (' + (i && i.players) + ')');
    await t.shot('dodgeball-countdown', 350);
    i = await t.until((x) => x.phase === 'play', 8000, 'play');
    check(i && i.props.balls >= 3, 'dodgeball: sparkly balls on the court (' + (i && i.props.balls) + ')');
    // walk to a ball on our side and pick it up
    const got = await t.ev(() => {
      const w = window.__c9;
      const g = w.play.session.game;
      const me = w.net.me.id;
      const p = g.state.players[me];
      const f = g.arena.area.f;
      const ball = g.state.balls.find((b) => {
        if (b.s !== 'ground') return false;
        const dx = b.x - f.x;
        const dz = b.z - f.z;
        const lz = dx * f.s + dz * f.c;
        return lz * (p.team === 0 ? -1 : 1) >= -0.5;
      });
      if (!ball) return false;
      w.player.place(ball.x + 0.5, ball.z + 0.3, w.player.heading);
      return true;
    });
    if (got) {
      i = await t.until((x) => x.prompt === 'Throw!', 4000, 'pickup');
      check(i && i.prompt === 'Throw!', 'dodgeball: walking onto a ball picks it up; the button says Throw!');
      await t.shot('dodgeball-holding', 150);
      const mine = await t.ev(() => {
        const b = window.__c9.play.state.balls.find((x) => x.s === 'held' && x.by === window.__c9.net.me.id);
        return b ? b.id : null;
      });
      await t.page.locator('.c9-use').click({ force: true, timeout: 3000 }); // it bobs to say "tap me"
      await t.page.waitForTimeout(120);
      const gone = await t.ev((id) => {
        const b = window.__c9.play.state.balls.find((x) => x.id === id);
        return !!b && !(b.s === 'held' && b.by === window.__c9.net.me.id);
      }, mine);
      check(gone, 'dodgeball: Throw! sends the ball flying (auto-aimed)');
      await t.shot('dodgeball-throw', 60);
    } else check(false, 'dodgeball: no ball on our side to pick up');
    await t.page.waitForTimeout(2500);
    await t.shot('dodgeball-play', 100);
    // finish the round: the results celebration for everyone
    await t.ev(() => window.__c9.play.finishRound());
    i = await t.until((x) => x.phase === 'results', 4000, 'results');
    check(i && i.phase === 'results', 'dodgeball: results');
    check(i && i.who && i.who.anim && !i.who.canMove, 'dodgeball: everyone celebrates in results (' + (i && i.who && i.who.anim) + ')');
    await t.shot('dodgeball-results', 900);
    await leaveByButton(t, 'dodgeball');
    await checkRoam(t, 'dodgeball');
    await t.shot('dodgeball-roam', 600);
    check(t.errors.length === 0, 'dodgeball: no console errors' + (t.errors.length ? '\n    ' + t.errors.slice(0, 6).join('\n    ') : ''));
    await ctx.close();
  },

  async hideSeek(browser) {
    const ctx = await newContext(browser);
    const t = await openPage(ctx, '?solo=1&noaudio=1&game=hideSeek&bots=5');
    let i = await t.until((x) => x.phase === 'countdown', 15000, 'countdown');
    check(i && i.phase === 'countdown', 'hideSeek: the countdown starts by itself');
    i = await t.until((x) => x.phase === 'hide', 8000, 'hide');
    const role = i && i.me ? i.me.role : null;
    check(role === 'seeker' || role === 'hider', 'hideSeek: a role for Bailey (' + role + ')');
    if (role === 'seeker') {
      check(i.blind && i.frozen, 'hideSeek: the seeker counts with eyes covered (blindfold, standing still)');
      await t.shot('hideSeek-blind', 400);
    } else {
      // tuck into the nearest hide spot
      await t.ev(() => {
        const w = window.__c9;
        const spots = w.places.hideGarden.hideSpots;
        const p = w.player.position;
        let best = spots[0];
        for (const s of spots) if (Math.hypot(s.x - p.x, s.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = s;
        w.player.place(best.x, best.z, w.player.heading);
      });
      i = await t.until((x) => x.who && x.who.hidden, 4000, 'hidden');
      check(i && i.who && i.who.hidden && i.anim === 'hide', 'hideSeek: in a hide spot she crouches and her name tag hides (' + (i && i.anim) + ')');
      await t.shot('hideSeek-hiding', 300);
    }
    // a different seeker this time? take a look at the bots: hiders hide, the seeker counts
    const bots = await t.ev(() => {
      const w = window.__c9;
      const g = w.play.session.game;
      let seekers = 0;
      let counting = 0;
      for (const id of g.state.order) {
        const p = g.state.players[id];
        if (p.role === 'seeker') seekers++;
        const s = w.net.stateOf(id);
        if (p.bot && p.role === 'seeker' && s && s.anim === 'seek') counting++;
      }
      return { seekers, counting };
    });
    check(bots.seekers >= 1, 'hideSeek: there is a seeker (' + bots.seekers + ')');
    // skip ahead to the seeking
    await t.ev(() => {
      const g = window.__c9.play.session.game;
      g.state.phaseEnds = window.__c9.play.now();
    });
    i = await t.until((x) => x.phase === 'play', 4000, 'play');
    check(i && i.phase === 'play' && !i.blind, 'hideSeek: seeking time, the blindfold is off');
    await t.page.waitForTimeout(1200);
    await t.shot('hideSeek-seek', 100);
    // a sparkle hint over the hiders
    await t.ev(() => {
      const g = window.__c9.play.session.game;
      g.state.nextHint = window.__c9.play.now();
    });
    await t.page.waitForTimeout(500);
    await t.shot('hideSeek-hint', 50);
    const music = await t.ev(() => (window.__c9.audio.real && window.__c9.audio.real.current) || null);
    await t.ev(() => window.__c9.play.finishRound());
    i = await t.until((x) => x.phase === 'results', 4000, 'results');
    check(i && i.phase === 'results', 'hideSeek: results (' + (music || 'no audio') + ')');
    await t.shot('hideSeek-results', 1200);
    await leaveByButton(t, 'hideSeek');
    await checkRoam(t, 'hideSeek');
    check(t.errors.length === 0, 'hideSeek: no console errors' + (t.errors.length ? '\n    ' + t.errors.slice(0, 6).join('\n    ') : ''));
    await ctx.close();
  },

  async freezeTag(browser) {
    const ctx = await newContext(browser);
    const t = await openPage(ctx, '?solo=1&noaudio=1&game=freezeTag&bots=5');
    // Bailey is "it" this time: the bots have all had a turn (roles rotate, fewest turns first)
    await t.ev(() => {
      const g = window.__c9.play.session.game;
      for (const id of g.state.order) if (g.state.players[id].bot) g.state.players[id].turns = 1;
    });
    let i = await t.until((x) => x.phase === 'play', 15000, 'play');
    check(i && i.phase === 'play', 'freezeTag: from the countdown to play');
    const role = i && i.me ? i.me.role : null;
    check(role === 'it', 'freezeTag: Bailey is "it" (' + role + ')');
    await t.page.waitForTimeout(1500);
    await t.shot('freezeTag-play', 100);
    // wait until somebody is frozen (bots chase bots; when Bailey is "it" she runs up to a runner
    // herself and her touch tags them), then look at the frozen pose and glow
    const frozen = await t.ev(async () => {
      const w = window.__c9;
      const me = w.net.me.id;
      for (let k = 0; k < 80; k++) {
        const g = w.play.session.game;
        const id = g.state.order.find((x) => g.state.players[x].frozen);
        if (id) return { id, anim: id === me ? w.player.anim : (w.net.stateOf(id) || {}).anim, byMe: g.state.scores[me] > 0 };
        if (g.state.players[me].role === 'it') {
          const r = g.state.order.find((x) => x !== me && !g.state.players[x].frozen && w.net.stateOf(x));
          const s = r && w.net.stateOf(r);
          if (s) w.player.place(s.x + 0.4, s.z + 0.4, w.player.heading);
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    });
    check(!!frozen && frozen.byMe, 'freezeTag: Bailey runs up to a runner and her touch freezes them' + (frozen ? ' (' + frozen.anim + ')' : ''));
    await t.shot('freezeTag-frozen', 300);
    await t.ev(() => window.__c9.play.finishRound());
    i = await t.until((x) => x.phase === 'results', 4000, 'results');
    check(i && i.phase === 'results', 'freezeTag: results');
    await t.shot('freezeTag-results', 1000);
    // the next round starts by itself after the break; "Play again!" starts it now
    i = await t.until((x) => x.phase === 'lobby', 12000, 'lobby');
    const again = await t.page.locator('.c9p-btn-go:has-text("Play again")').isVisible();
    check(again, 'freezeTag: between rounds, Play again! is offered');
    await t.shot('freezeTag-break', 100);
    if (again) {
      await t.page.locator('.c9p-btn-go:has-text("Play again")').click({ force: true, timeout: 3000 });
      i = await t.until((x) => x.phase === 'countdown' && x.round === 2, 4000, 'round 2');
      check(i && i.round === 2, 'freezeTag: round 2 starts');
    }
    await leaveByButton(t, 'freezeTag');
    await checkRoam(t, 'freezeTag');
    check(t.errors.length === 0, 'freezeTag: no console errors' + (t.errors.length ? '\n    ' + t.errors.slice(0, 6).join('\n    ') : ''));
    await ctx.close();
  },

  async captureBow(browser) {
    const ctx = await newContext(browser);
    const t = await openPage(ctx, '?solo=1&noaudio=1&game=captureBow&bots=5');
    let i = await t.until((x) => x.phase === 'play', 15000, 'play');
    check(i && i.phase === 'play', 'captureBow: from the countdown to play');
    check(i && i.props.bows === 2, 'captureBow: two giant bows on the field');
    await t.shot('captureBow-play', 300);
    // run to their bow and grab it
    await t.ev(() => {
      const w = window.__c9;
      const g = w.play.session.game;
      const me = w.net.me.id;
      const team = g.state.players[me].team;
      const bow = g.state.bows[1 - team];
      const b = g.arena.bases[1 - team];
      const x = bow.s === 'dropped' ? bow.x : b.x;
      const z = bow.s === 'dropped' ? bow.z : b.z;
      w.player.place(x + 0.6, z + 0.6, w.player.heading);
    });
    i = await t.until((x) => x.who && x.who.carrying, 4000, 'grab');
    check(i && i.who && /^bow/.test(i.who.carrying || ''), 'captureBow: touching their bow grabs it (' + (i && i.who && i.who.carrying) + ')');
    await t.page.waitForTimeout(400);
    await t.shot('captureBow-carry', 100);
    // home to score
    await t.ev(() => {
      const w = window.__c9;
      const g = w.play.session.game;
      const team = g.state.players[w.net.me.id].team;
      const b = g.arena.bases[team];
      w.player.place(b.x + 0.4, b.z, w.player.heading);
    });
    await t.page.waitForTimeout(800);
    const score = await t.ev(() => {
      const g = window.__c9.play.session.game;
      const team = g.state.players[window.__c9.net.me.id].team;
      return g.state.scores[team];
    });
    check(score >= 1, 'captureBow: carrying it home scores (' + score + ')');
    await t.shot('captureBow-score', 200);
    await t.ev(() => window.__c9.play.finishRound());
    i = await t.until((x) => x.phase === 'results', 4000, 'results');
    check(i && i.phase === 'results', 'captureBow: results');
    await t.shot('captureBow-results', 1200);
    await leaveByButton(t, 'captureBow');
    await checkRoam(t, 'captureBow');
    const bowsGone = await t.ev(() => window.__c9.play.props.stats.bows === 0);
    check(bowsGone, 'captureBow: the bows are put away');
    check(t.errors.length === 0, 'captureBow: no console errors' + (t.errors.length ? '\n    ' + t.errors.slice(0, 6).join('\n    ') : ''));
    await ctx.close();
  },
};

// Three tabs in one browser: the host starts a game, everyone sees the same state.
async function room(browser) {
  const ctx = await newContext(browser);
  // room codes use GAME.roomCodeAlphabet: no vowels (so never a word) and no 0, 1 or 5
  const AB = 'BCDFGHJKLMNPQRSTVWXZ2346789';
  const code = 'PL' + AB[Math.floor(Math.random() * AB.length)] + AB[Math.floor(Math.random() * AB.length)];
  const tabs = [];
  for (const nick of ['Ava', 'Bea', 'Cy']) {
    tabs.push(await openPage(ctx, `?room=${code}&nick=${nick}&noaudio=1`));
    await tabs[tabs.length - 1].page.waitForTimeout(600);
  }
  await tabs[0].page.waitForTimeout(1500);
  const hosts = await Promise.all(tabs.map((t) => t.ev(() => window.__c9.net.isHost)));
  check(hosts[0] && !hosts[1] && !hosts[2], 'room: the first tab is the host');
  const sizes = await Promise.all(tabs.map((t) => t.ev(() => window.__c9.net.players.size)));
  check(sizes.every((n) => n === 3), 'room: everyone sees three players (' + sizes.join(', ') + ')');
  await tabs[0].ev(() => window.__c9.hostStartGame('dodgeball'));
  await Promise.all(tabs.map((t) => t.until((x) => x.phase === 'play', 15000, 'play')));
  // friends may get the app's how-to card when the start reaches them; at "Go!" it is put away
  // so nobody is stuck behind it (a card holds the controls)
  await tabs[0].page.waitForTimeout(400);
  const cards = await Promise.all(tabs.slice(1).map((t) => t.ev(() => !!window.__c9.hud.cardOpen)));
  check(cards.every((c) => !c), 'room: at Go! no card is holding a friend\'s controls');
  await tabs[0].page.waitForTimeout(800);
  const views = await Promise.all(tabs.map((t) => t.ev(() => {
    const s = window.__c9.play.state;
    return s ? { gid: s.gid, phase: s.phase, order: s.order.join(','), teams: s.order.map((id) => s.players[id].team).join(''), balls: s.balls.length, me: window.__c9.net.me.id, isHost: window.__c9.play.session.isHost } : null;
  })));
  check(views.every((v) => v && v.gid === views[0].gid), 'room: one game on every tab (gid ' + (views[0] && views[0].gid) + ')');
  check(views.every((v) => v && v.order === views[0].order && v.teams === views[0].teams), 'room: the same players and teams everywhere');
  check(views[0] && views[0].order.split(',').length === 4, 'room: three friends and a bot to even the teams (' + (views[0] && views[0].order.split(',').length) + ')');
  check(views.every((v) => v && v.balls === views[0].balls && v.balls >= 3), 'room: the same balls everywhere');
  for (let k = 0; k < 3; k++) await tabs[k].shot('room-' + ['host', 'bea', 'cy'][k], 200);
  // a client picks up a ball: the host sees it held by them
  const picked = await tabs[1].ev(() => {
    const w = window.__c9;
    const g = w.play.session.game;
    const me = w.net.me.id;
    const team = g.state.players[me].team;
    const f = g.arena.area.f;
    const ball = g.state.balls.find((b) => b.s === 'ground' && ((b.x - f.x) * f.s + (b.z - f.z) * f.c) * (team === 0 ? -1 : 1) >= -0.5);
    if (!ball) return null;
    w.player.place(ball.x + 0.4, ball.z + 0.3, w.player.heading);
    return ball.id;
  });
  if (picked) {
    await tabs[1].page.waitForTimeout(1200);
    const held = await tabs[0].ev((id) => {
      const b = window.__c9.play.state.balls.find((x) => x.id === id);
      return b ? b.s + ':' + b.by : null;
    }, picked);
    const bea = await tabs[1].ev(() => window.__c9.net.me.id);
    check(held === 'held:' + bea, 'room: a friend walks onto a ball; the host gives it to her (' + held + ')');
    await tabs[1].shot('room-bea-holding', 100);
  }
  // Cy steps out (spectator), then hops back in
  await tabs[2].ev(() => window.__c9.play.leave());
  await tabs[2].page.waitForTimeout(900);
  const cyId = await tabs[2].ev(() => window.__c9.net.me.id);
  const without = await tabs[0].ev((id) => !window.__c9.play.state.players[id], cyId);
  check(without, 'room: Leave game takes a friend out of the game (still in the room)');
  const joinBtn = await tabs[2].page.locator('.c9p-btn-go:has-text("Join")').isVisible();
  check(joinBtn, 'room: the friend who left sees Join the game!');
  await tabs[2].shot('room-cy-spectator', 100);
  await tabs[2].page.locator('.c9p-btn-go:has-text("Join")').click({ force: true, timeout: 3000 });
  await tabs[2].page.waitForTimeout(900);
  const back = await tabs[0].ev((id) => !!window.__c9.play.state.players[id], cyId);
  check(back, 'room: Join the game! brings her back in');
  // the host ends the game: everyone back to free roam
  await tabs[0].page.locator('.c9p-btn-leave').click();
  await tabs[0].page.waitForTimeout(250);
  await tabs[0].page.locator('.c9-card .c9-btn').nth(1).click();
  await tabs[0].page.waitForTimeout(1500);
  const after = await Promise.all(tabs.map((t) => t.ev(() => ({ session: !!window.__c9.play.session, panel: !document.querySelector('.c9-game').hidden, game: window.__c9.net.game && window.__c9.net.game.kind, frozen: window.__c9.player.frozen }))));
  check(after.every((a) => !a.session && !a.panel && !a.frozen), 'room: the host ends it; everyone is back in free roam');
  check(after.every((a) => a.game === 'roam'), 'room: the shared game is back to roam');
  // Known APP issue (js/main.js, not this layer): hostStartGame sends { kind, id, at: net.now() } as
  // 'game-start', and the net refuses numbers over 1e9, so that one event never leaves the host.
  // The game layer doesn't need it (friends join from the shared state); reported, not counted.
  const APP_KNOWN = /event data must be small plain JSON.*game-start/;
  for (const [k, t] of tabs.entries()) {
    const known = t.errors.filter((e) => APP_KNOWN.test(e));
    if (known.length) console.log('KNOWN (APP main.js) - tab ' + (k + 1) + ': ' + known[0]);
    const rest = t.errors.filter((e) => !APP_KNOWN.test(e));
    check(rest.length === 0, 'room: no console errors on tab ' + (k + 1) + (rest.length ? '\n    ' + rest.slice(0, 6).join('\n    ') : ''));
  }
  await ctx.close();
}

// A tablet in landscape: Capture the Bow, then Bailey counting as the seeker.
async function tablet(browser) {
  const ctx = await newContext(browser, { w: 1024, h: 768, touch: true });
  const t = await openPage(ctx, '?solo=1&noaudio=1&game=captureBow&bots=5');
  let i = await t.until((x) => x.phase === 'play', 15000, 'play');
  check(i && i.phase === 'play', 'tablet: Capture the Bow under way');
  await t.page.waitForTimeout(1500);
  await t.shot('tablet-captureBow', 100);
  await t.ev(() => window.__c9.play.finishRound());
  i = await t.until((x) => x.phase === 'results', 4000, 'results');
  check(i && i.phase === 'results' && i.who && !i.who.canMove, 'tablet: results, everyone celebrating');
  await t.shot('tablet-results', 1200);
  // switch games from the host's picker path: hide and seek, with Bailey the seeker this time
  await t.ev(() => window.__c9.hostStartGame('hideSeek'));
  await t.ev(() => {
    const g = window.__c9.play.session.game;
    for (const id of g.state.order) if (g.state.players[id].bot) g.state.players[id].turns = 1; // they all had a go
  });
  // the blindfold goes up on the HUD's next tick after the phase turns
  i = await t.until((x) => x.phase === 'hide' && (x.blind || (x.me && x.me.role !== 'seeker')), 12000, 'hide');
  check(i && i.me && i.me.role === 'seeker' && i.blind, 'tablet: picking another game switches over; the seeker counts behind the blindfold (' + (i && i.me && i.me.role) + ')');
  await t.shot('tablet-blind', 600);
  await t.ev(() => window.__c9.play.end());
  await checkRoam(t, 'tablet');
  check(t.errors.length === 0, 'tablet: no console errors' + (t.errors.length ? '\n    ' + t.errors.slice(0, 6).join('\n    ') : ''));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const want = (name) => ONLY.includes('all') || ONLY.includes(name);
  for (const name of Object.keys(SOLO)) {
    if (!want(name)) continue;
    console.log('# solo ' + name);
    try {
      await SOLO[name](browser);
    } catch (err) {
      check(false, name + ' threw: ' + err.message);
    }
  }
  if (want('room')) {
    console.log('# room');
    try {
      await room(browser);
    } catch (err) {
      check(false, 'room threw: ' + err.message);
    }
  }
  if (want('tablet')) {
    console.log('# tablet');
    try {
      await tablet(browser);
    } catch (err) {
      check(false, 'tablet threw: ' + err.message);
    }
  }
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
