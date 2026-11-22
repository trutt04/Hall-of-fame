// Draws Cloud Nine's home-screen icon (the hot-pink star bow on a soft pink sky) as SVG and renders
// the PNG sizes with Playwright. No external assets: every shape is written out below.
//
//   node cloud-nine/dev/mobile-icons.cjs        (from the top of the repo; needs Playwright's Chromium)
//
// Writes cloud-nine/icons/:
//   icon.svg                  rounded square, the favicon and the manifest's "any" vector icon
//   icon-192.png, icon-512.png   the same, rounded, transparent corners (manifest "any")
//   apple-touch-icon.png      180, full bleed: iOS rounds the corners itself (and fills see-through black)
//   icon-maskable-512.png     full bleed, the bow inside the middle 80% circle (Android crops to any shape)
//
// The committed PNGs were then recompressed losslessly (Pillow's optimize; optipng does the same).

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'icons');
const INK = '#17121c';

// the bow from index.html's loading screen (viewBox 0 0 220 150), centred on (110, 76)
const BOW = [
  `<path d="M100 78 L62 140 L82 132 L92 146 L108 82 Z" fill="#e0137c" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`,
  `<path d="M120 78 L158 140 L138 132 L128 146 L112 82 Z" fill="#e0137c" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`,
  `<path d="M104 64 C 78 22, 26 2, 14 38 C 4 70, 46 104, 104 82 Z" fill="url(#loop)" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`,
  `<path d="M116 64 C 142 22, 194 2, 206 38 C 216 70, 174 104, 116 82 Z" fill="url(#loop)" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`,
  '<path d="M30 34 C 40 20, 62 24, 78 40 M142 40 C 158 24, 180 20, 190 34" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".55"/>',
  `<path d="M44 47.5L46.1 53.1L52.1 53.3L47.4 57.1L49 62.9L44 59.6L39 62.9L40.6 57.1L35.9 53.3L41.9 53.1Z M176 47.5L178.1 53.1L184.1 53.3L179.4 57.1L181 62.9L176 59.6L171 62.9L172.6 57.1L167.9 53.3L173.9 53.1Z M70 67.5L71.6 71.8L76.2 72L72.6 74.8L73.8 79.3L70 76.7L66.2 79.3L67.4 74.8L63.8 72L68.4 71.8Z M150 67.5L151.6 71.8L156.2 72L152.6 74.8L153.8 79.3L150 76.7L146.2 79.3L147.4 74.8L143.8 72L148.4 71.8Z" fill="${INK}"/>`,
  `<rect x="92" y="54" width="36" height="38" rx="14" fill="#ff4fa3" stroke="${INK}" stroke-width="6"/>`,
  '<path d="M100 64 C 106 60, 114 60, 120 64" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".6"/>',
].join('');

// a four-point rhinestone glint
function glint(cx, cy, r, fill, stroke = INK) {
  const k = r * 0.28;
  const d = `M${cx} ${cy - r}L${cx + k} ${cy - k}L${cx + r} ${cy}L${cx + k} ${cy + k}L${cx} ${cy + r}L${cx - k} ${cy + k}L${cx - r} ${cy}L${cx - k} ${cy - k}Z`;
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(2, r * 0.14).toFixed(1)}" stroke-linejoin="round"/>`;
}

function iconSvg({ rounded = false, bowScale = 1.9, bowX = 256, bowY = 236 } = {}) {
  const t = `translate(${(bowX - 110 * bowScale).toFixed(1)} ${(bowY - 76 * bowScale).toFixed(1)}) scale(${bowScale})`;
  const body = [
    '<rect width="512" height="512" fill="url(#sky)"/>',
    '<circle cx="256" cy="230" r="230" fill="url(#glow)"/>',
    // a cloud bank along the bottom: lilac behind, white in front
    '<g fill="#efe2ff"><circle cx="92" cy="436" r="64"/><circle cx="424" cy="428" r="72"/></g>',
    '<g fill="#fff8fc"><circle cx="34" cy="490" r="66"/><circle cx="138" cy="466" r="74"/><circle cx="252" cy="490" r="72"/>'
      + '<circle cx="362" cy="462" r="80"/><circle cx="474" cy="486" r="68"/><rect x="0" y="484" width="512" height="28"/></g>',
    glint(96, 112, 22, '#ffffff'),
    glint(424, 96, 28, '#ffffff'),
    glint(446, 300, 15, '#ffd36e'),
    glint(62, 306, 13, '#eae8f2'),
    `<g transform="${t}">${BOW}</g>`,
  ].join('');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">',
    '<defs>',
    '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fc4ff"/><stop offset=".6" stop-color="#ffd1e8"/><stop offset="1" stop-color="#ffe9f3"/></linearGradient>',
    '<radialGradient id="glow"><stop offset="0" stop-color="#ffffff" stop-opacity=".8"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>',
    '<linearGradient id="loop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6fb8"/><stop offset=".55" stop-color="#ff2e93"/><stop offset="1" stop-color="#e0137c"/></linearGradient>',
    rounded ? '<clipPath id="round"><rect width="512" height="512" rx="112"/></clipPath>' : '',
    '</defs>',
    rounded ? `<g clip-path="url(#round)">${body}</g>` : body,
    '</svg>',
  ].join('\n') + '\n';
}

const VARIANTS = {
  any: iconSvg({ rounded: true }),
  apple: iconSvg({ rounded: false }),
  // Android masks may crop to a circle 80% wide: the whole bow stays inside it
  maskable: iconSvg({ rounded: false, bowScale: 1.58, bowY: 250 }),
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'icon.svg'), VARIANTS.any);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const jobs = [
    ['icon-192.png', 'any', 192],
    ['icon-512.png', 'any', 512],
    ['apple-touch-icon.png', 'apple', 180],
    ['icon-maskable-512.png', 'maskable', 512],
  ];
  for (const [file, variant, size] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const svg = VARIANTS[variant].replace('width="512" height="512"', `width="${size}" height="${size}"`);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: path.join(OUT, file), omitBackground: variant === 'any', clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log('wrote icons/' + file);
  }
  await browser.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { iconSvg, VARIANTS };
