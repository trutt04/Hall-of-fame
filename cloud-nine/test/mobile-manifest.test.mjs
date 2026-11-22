// Add to Home Screen: the web app manifest, its icons and the links in index.html.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');

// width, height and colour type straight from a PNG's IHDR chunk (2 = RGB, 6 = RGBA)
function pngInfo(p) {
  const b = readFileSync(root + p);
  assert.equal(b.toString('ascii', 1, 4), 'PNG', p + ' is a PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25], bytes: b.length };
}

test('the manifest names the game, opens standalone and uses the sky pink', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.name, 'Cloud Nine');
  assert.equal(m.short_name, 'Cloud Nine');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  const html = read('index.html');
  assert.ok(html.includes(`<meta name="theme-color" content="${m.theme_color}">`), 'the page and the manifest agree on the theme colour');
});

test('every manifest icon exists at the size it claims, and a maskable one is there', () => {
  const m = JSON.parse(read('manifest.json'));
  const purposes = new Set();
  for (const ic of m.icons) {
    assert.ok(existsSync(root + ic.src), ic.src);
    assert.ok(!/^https?:/.test(ic.src), 'no external assets: ' + ic.src);
    purposes.add(ic.purpose);
    if (ic.type === 'image/png') {
      const [w, h] = ic.sizes.split('x').map(Number);
      const info = pngInfo(ic.src);
      assert.deepEqual([info.w, info.h], [w, h], ic.src);
      assert.ok(info.bytes < 200000, ic.src + ' stays small');
      if (ic.purpose === 'maskable') assert.equal(info.colorType, 2, 'a maskable icon is full bleed, no see-through');
    }
  }
  assert.ok(purposes.has('maskable'));
  assert.ok(m.icons.some((ic) => ic.sizes === '192x192'));
  assert.ok(m.icons.some((ic) => ic.sizes === '512x512' && ic.purpose === 'any'));
});

test('index.html links the manifest, the favicon and an opaque 180px apple-touch-icon', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.json">/);
  assert.match(html, /<link rel="icon" href="icons\/icon\.svg" type="image\/svg\+xml">/);
  const apple = /<link rel="apple-touch-icon" href="([^"]+)">/.exec(html);
  assert.ok(apple, 'apple-touch-icon link');
  const info = pngInfo(apple[1]);
  assert.deepEqual([info.w, info.h], [180, 180]);
  assert.equal(info.colorType, 2, 'iOS fills see-through corners with black: the icon must be opaque');
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Cloud Nine">/);
  const svg = read('icons/icon.svg');
  assert.ok(!/href="http|xlink:href="http|<image/.test(svg), 'the SVG draws everything itself');
});
