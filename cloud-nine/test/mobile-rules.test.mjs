// Phones and tablets: rules the stylesheets and the HUD must keep (the mobile review's fixes).
// Reads the CSS as text, so it runs under node --test with no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isLightColor } from '../js/ui/hud.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const SHEETS = ['css/app.css', 'css/menu.css', 'css/rhythm.css', 'css/creator.css', 'css/netcheck.css'];

// every px value a font-size can come out at its smallest: a plain size, or a clamp()'s minimum
function smallestFontSizes(css) {
  const out = [];
  const re = /font-size\s*:\s*([^;}]+)/g;
  let m;
  while ((m = re.exec(css))) {
    const v = m[1].trim();
    const clamp = /^clamp\(\s*([\d.]+)px/.exec(v);
    const px = /^([\d.]+)px$/.exec(v);
    if (clamp) out.push({ v, px: Number(clamp[1]), at: m.index });
    else if (px) out.push({ v, px: Number(px[1]), at: m.index });
  }
  return out;
}

test('no text under 16px in the stylesheets (the blueprint rule for phones)', () => {
  for (const sheet of SHEETS) {
    const css = read(sheet);
    for (const f of smallestFontSizes(css)) {
      assert.ok(f.px >= 16, `${sheet}: font-size ${f.v} near "${css.slice(Math.max(0, f.at - 60), f.at).split('\n').pop()}"`);
    }
  }
});

test('the emote wheel words are full size on every screen', () => {
  const css = read('css/app.css');
  const sizes = [...css.matchAll(/\.c9-wheel-text\{[^}]*font-size:([\d.]+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length >= 1);
  for (const s of sizes) assert.ok(s >= 16, 'wheel text ' + s + 'px');
});

test('the page never pinch-zooms or double-tap-zooms, and the canvas takes every touch', () => {
  const css = read('css/app.css');
  const page = /html,body\{[^}]*touch-action:([^;}]+)/.exec(css);
  assert.ok(page, 'html,body sets touch-action');
  assert.ok(!/pinch-zoom|manipulation|auto/.test(page[1]), 'html,body touch-action allows zoom: ' + page[1]);
  assert.match(css, /#scene\{[^}]*touch-action:none/);
  assert.match(css, /-webkit-touch-callout:none/);
  assert.match(css, /-webkit-tap-highlight-color:transparent/);
  const html = read('index.html');
  assert.match(html, /viewport-fit=cover/);
  assert.match(read('js/ui/dom.js'), /gesturestart/);
});

test('the HUD keeps to the safe areas', () => {
  const css = read('css/app.css');
  for (const v of ['--sat:env(safe-area-inset-top', '--sar:env(safe-area-inset-right', '--sab:env(safe-area-inset-bottom', '--sal:env(safe-area-inset-left']) {
    assert.ok(css.includes(v), v);
  }
  assert.match(css, /\.c9-controls\{[^}]*right:calc\([^)]*var\(--sar\)\);bottom:calc\([^)]*var\(--sab\)\)/);
  assert.match(css, /\.c9-top\{[^}]*var\(--sat\)/);
  assert.match(css, /\.c9-wheel\{[^}]*var\(--sat\)[^}]*var\(--sab\)/);
});

test('reduced motion keeps the teleport fade soft instead of a hard white flash', () => {
  const css = read('css/app.css');
  const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion:reduce)'));
  assert.match(block, /\.c9-hud \.c9-fade\{transition-duration:\.2\d*s !important\}/);
  assert.match(read('js/ui/hud.js'), /if \(reducedMotion\(\)\) ms = Math\.max\(ms, \d+\)/);
});

test('pale role badges get dark words, strong ones keep white', () => {
  assert.equal(isLightColor('#cdb4ff'), true); // lilac
  assert.equal(isLightColor('#9be7c4'), true); // mint
  assert.equal(isLightColor('#ffe68a'), true); // lemon
  assert.equal(isLightColor('#ff2e93'), false); // hot pink
  assert.equal(isLightColor('#7b5cff'), false); // purple
  assert.equal(isLightColor('#17121c'), false);
  assert.equal(isLightColor('pink'), false);
  assert.equal(isLightColor(null), false);
});
