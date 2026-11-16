// Send a postcard: one tap makes a picture worth dropping in the league group chat.
//
//   const postcard = createPostcard(ctx, { teamId: () => id | null })
//   postcard.open({ teamId })     teamId given: framed on that team's home (from a home card)
//                                 no teamId: the view as it is right now, about the visitor's own team
//
// The picture is a 1080x1350 canvas: the 3D view without the HUD inside a frame in the brand
// style, "GREETINGS FROM <NEIGHBORHOOD>", the team's place and record, one roast line, and the
// address of the world. A preview always comes first. Nothing is ever shared without a tap.
// All league text is drawn with fillText or set with textContent: team names are untrusted.

import { el, button, hex, wait, tierName, ordinal, weekLabel, flowRoot, TIER_CSS } from './dom.js';
import { modelOf, getHome, currentZone, zoneLine } from './seam.js';

const W = 1080;
const H = 1350;
const M = 48; // margin around the photo
const PW = W - 2 * M;
const PH = 1000;
const HOME_URL = 'trutt04.github.io/Hall-of-fame/world';
const DISPLAY = 'Bungee, "Arial Black", Impact, sans-serif';
const BODY = '"Barlow Semi Condensed", "Arial Narrow", Arial, sans-serif';
const C = { night: '#0a1022', navy: '#18213f', gold: '#f5c542', chalk: '#f3eedd', stone: '#aab3bf', flare: '#ff6a3d' };

/** The address printed on the card and sent with it. */
export function worldAddress() {
  try {
    if (window.location.hostname === 'trutt04.github.io') {
      const path = window.location.pathname.replace(/index\.html$/, '').replace(/\/+$/, '');
      return window.location.hostname + path;
    }
  } catch (err) { /* not in a page */ }
  return HOME_URL;
}

async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('400 96px Bungee'),
        document.fonts.load('400 32px "Barlow Semi Condensed"'),
        document.fonts.load('600 24px "Barlow Semi Condensed"'),
        document.fonts.load('700 40px "Barlow Semi Condensed"'),
      ]),
      wait(1500),
    ]);
  } catch (err) { /* the fallback fonts will do */ }
}

// ---------------------------------------------------------------- text that always fits
function graphemes(text) {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (x) => x.segment);
  } catch (err) { /* fall through */ }
  return Array.from(text);
}

/** Shortens text to the width with an ellipsis. Assumes g.font is set. */
function clip(g, text, width) {
  if (g.measureText(text).width <= width) return text;
  const parts = graphemes(text);
  while (parts.length > 1 && g.measureText(parts.join('').trimEnd() + '…').width > width) parts.pop();
  return parts.join('').trimEnd() + '…';
}

/** The largest size from max down to min at which the text fits the width. Leaves g.font set. */
function fit(g, text, font, max, min, width) {
  let size = max;
  for (; size > min; size -= 2) {
    g.font = font(size);
    if (g.measureText(text).width <= width) return size;
  }
  g.font = font(min);
  return min;
}

/** Word wrap to at most maxLines lines. The last line is shortened if there is more. */
function wrap(g, text, width, maxLines) {
  const lines = [];
  let cur = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? cur + ' ' + word : word;
    if (!cur || g.measureText(next).width <= width) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const rest = lines.splice(maxLines - 1).join(' ');
    lines.push(rest);
  }
  return lines.map((line) => clip(g, line, width));
}

function spaced(g, px) {
  try {
    if ('letterSpacing' in g) g.letterSpacing = px + 'px';
  } catch (err) { /* older canvas: no tracking, still fine */ }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * Draws the whole card. Pure canvas work, no scene access.
 * d = { photo, place, team: { name, rank, record, color, tierColor } | null, line, league, week, address, sample }
 */
export function drawPostcard(canvas, d) {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.textBaseline = 'alphabetic';

  // card stock
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d1430');
  bg.addColorStop(1, C.night);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = C.gold;
  g.lineWidth = 5;
  g.strokeRect(17, 17, W - 34, H - 34);
  g.lineWidth = 1.5;
  g.globalAlpha = 0.5;
  g.strokeRect(27, 27, W - 54, H - 54);
  g.globalAlpha = 1;

  // the photo
  g.save();
  roundRect(g, M, M, PW, PH, 10);
  g.clip();
  if (d.photo) g.drawImage(d.photo, 0, 0, d.photo.width, d.photo.height, M, M, PW, PH);
  else {
    const sky = g.createLinearGradient(0, M, 0, M + PH);
    sky.addColorStop(0, C.navy);
    sky.addColorStop(1, '#14553c');
    g.fillStyle = sky;
    g.fillRect(M, M, PW, PH);
  }
  const shade = g.createLinearGradient(0, M + PH - 460, 0, M + PH);
  shade.addColorStop(0, 'rgba(10,16,34,0)');
  shade.addColorStop(0.55, 'rgba(10,16,34,.72)');
  shade.addColorStop(1, 'rgba(10,16,34,.96)');
  g.fillStyle = shade;
  g.fillRect(M, M + PH - 460, PW, 460);
  g.restore();
  roundRect(g, M, M, PW, PH, 10);
  g.strokeStyle = C.gold;
  g.lineWidth = 4;
  g.stroke();

  // GREETINGS FROM <PLACE>, one line when it fits at a good size, otherwise two
  const place = String(d.place || 'League World').toUpperCase();
  const maxW = PW - 88;
  const bungee = (size) => '400 ' + size + 'px ' + DISPLAY;
  let lines = [place];
  let size = fit(g, place, bungee, 128, 40, maxW);
  const words = place.split(' ');
  if (size < 84 && words.length > 1) {
    // break near the middle
    let best = 1;
    let bestDiff = Infinity;
    for (let i = 1; i < words.length; i++) {
      const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
    size = Math.min(fit(g, lines[0], bungee, 112, 40, maxW), fit(g, lines[1], bungee, 112, 40, maxW));
  }
  g.font = bungee(size);
  const x0 = M + 44;
  let y = M + PH - 54 - (lines.length - 1) * size * 1.02;
  const top = y - size * 0.82;
  g.font = '700 38px ' + BODY;
  spaced(g, 9);
  g.fillStyle = C.chalk;
  g.fillText('GREETINGS FROM', x0 + 2, top - 18);
  spaced(g, 0);
  g.font = bungee(size);
  for (const line of lines) {
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fillText(line, x0 + 5, y + 6);
    g.fillStyle = C.gold;
    g.fillText(line, x0, y);
    y += size * 1.02;
  }

  // the place stamp, top right, like the one that slams in on arrival
  if (d.team) {
    const text = ordinal(d.team.rank).toUpperCase();
    g.save();
    g.translate(M + PW - 168, M + 116);
    g.rotate((7 * Math.PI) / 180);
    roundRect(g, -128, -70, 256, 140, 14);
    g.fillStyle = 'rgba(10,16,34,.72)';
    g.fill();
    g.lineWidth = 9;
    g.strokeStyle = d.team.tierColor || C.gold;
    g.stroke();
    fit(g, text, bungee, 96, 40, 212);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = d.team.tierColor || C.gold;
    g.fillText(text, 0, 6);
    g.restore();
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
  }

  // honesty rule: sample data says so
  if (d.sample) {
    g.font = '700 23px ' + BODY;
    spaced(g, 4);
    const label = 'SAMPLE DATA';
    const w = g.measureText(label).width + 26;
    g.fillStyle = C.flare;
    roundRect(g, M + 22, M + 22, w, 38, 5);
    g.fill();
    g.fillStyle = C.night;
    g.fillText(label, M + 35, M + 49);
    spaced(g, 0);
  }

  // who it is about
  const y0 = M + PH;
  const body = (weight, size2, italic) => (italic ? 'italic ' : '') + weight + ' ' + size2 + 'px ' + BODY;
  let tx = M + 4;
  if (d.team) {
    g.fillStyle = hex(d.team.color);
    roundRect(g, M + 2, y0 + 34, 12, 54, 4);
    g.fill();
    tx = M + 32;
    const tail = ' · ' + ordinal(d.team.rank) + ' · ' + d.team.record;
    const room = W - M - tx;
    const s = fit(g, d.team.name + tail, (z) => body(700, z), 48, 34, room);
    g.font = body(700, s);
    const name = clip(g, d.team.name, room - g.measureText(tail).width);
    g.fillStyle = C.chalk;
    g.fillText(name + tail, tx, y0 + 78);
  } else {
    g.font = body(700, 48);
    g.fillStyle = C.chalk;
    g.fillText('Wish you were here.', tx, y0 + 78);
  }
  if (d.line) {
    g.font = body(400, 34, true);
    g.fillStyle = C.stone;
    wrap(g, d.line, W - M - tx, 2).forEach((line, i) => g.fillText(line, tx, y0 + 130 + i * 42));
  }

  // footer: league, week, and where to find the world
  g.fillStyle = C.gold;
  g.globalAlpha = 0.45;
  g.fillRect(M, H - 92, PW, 2);
  g.globalAlpha = 1;
  g.font = body(600, 25);
  g.textAlign = 'right';
  g.fillStyle = C.chalk;
  g.fillText(d.address, W - M, H - 48);
  const used = g.measureText(d.address).width + 40;
  g.textAlign = 'left';
  spaced(g, 3);
  g.fillStyle = C.gold;
  g.fillText(clip(g, [d.league, d.week].filter(Boolean).join(' · ').toUpperCase(), PW - used), M, H - 48);
  spaced(g, 0);
  return canvas;
}

// ---------------------------------------------------------------- the 3D view, without the HUD
// Renders one frame at the photo's size and copies it out in the same task, so the drawing
// buffer never has to be preserved. The camera and the renderer are put back before returning.
function capture(ctx, view) {
  const engine = ctx.engine || (ctx.world && ctx.world.engine);
  const renderer = engine.renderer;
  const scene = engine.scene;
  const cam = engine.camera;
  const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect };
  const hidden = [];
  const out = document.createElement('canvas');
  out.width = PW;
  out.height = PH;
  try {
    // floating name tags are HUD in spirit: the caption names the team
    scene.traverse((o) => {
      if (o.isSprite && o.name === 'nameTag' && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    renderer.setPixelRatio(1);
    renderer.setSize(PW, PH, false);
    if (view) {
      cam.position.set(view.pos[0], view.pos[1], view.pos[2]);
      cam.lookAt(view.look[0], view.look[1], view.look[2]);
      cam.fov = 58;
    }
    cam.aspect = PW / PH;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    out.getContext('2d').drawImage(renderer.domElement, 0, 0, PW, PH);
  } finally {
    for (const o of hidden) o.visible = true;
    cam.position.copy(saved.pos);
    cam.quaternion.copy(saved.quat);
    cam.fov = saved.fov;
    cam.aspect = saved.aspect;
    cam.updateProjectionMatrix();
    if (typeof engine.resize === 'function') engine.resize();
    if (typeof engine.renderOnce === 'function') engine.renderOnce();
  }
  return out;
}

// One roast line in the third person that fits two lines on the card.
function roastLine(team) {
  const r = team.roast || {};
  const box = (r.mailbox || []).filter((s) => s && s.length <= 96);
  return box[box.length - 1] || r.sign || '';
}

export function createPostcard(ctx, api) {
  const { hud, audio } = ctx;
  let busy = false;

  /** What the card says, worked out from the model. */
  function describe(teamId) {
    const m = modelOf(ctx);
    const meta = (m && m.meta) || {};
    const about = teamId !== undefined && teamId !== null ? teamId : api.teamId();
    const team = m && about !== null && about !== undefined ? m.teams[about] : null;
    const framed = teamId !== undefined && teamId !== null && team;
    const zone = framed ? team.tier : currentZone(ctx) || (team ? team.tier : 'plaza');
    return {
      place: tierName(zone) || 'League World',
      team: team ? { name: String(team.name || 'Team ' + team.id).trim(), rank: team.rank, record: team.record.text, color: team.color, tierColor: TIER_CSS[team.tier] } : null,
      line: team ? roastLine(team) : zoneLine(zone),
      league: meta.leagueName || '',
      week: weekLabel(meta),
      address: worldAddress(),
      sample: !!meta.isSample,
      view: framed ? (getHome(ctx, team.id) || {}).view || null : null,
    };
  }

  function flash() {
    const f = el('div', 'lwf-flash');
    flowRoot(hud).appendChild(f);
    setTimeout(() => f.remove(), 420);
    try {
      audio.sfx('pop', { volume: 0.6 });
    } catch (err) { /* sound is optional */ }
  }

  function preview(blob, d) {
    const url = URL.createObjectURL(blob);
    const file = typeof File === 'function' ? new File([blob], 'league-world-postcard.png', { type: 'image/png' }) : null;
    const about = 'Greetings from ' + d.place + (d.team ? '. ' + d.team.name + ', ' + ordinal(d.team.rank) + ', ' + d.team.record : '') + '.';
    const box = el('div', 'lwf-postcard');
    const img = el('img', 'lwf-postcard-img');
    img.src = url;
    img.alt = 'Postcard. ' + about;
    img.width = W;
    img.height = H;
    const acts = el('div', 'lwf-postcard-acts');
    const note = el('p', 'lw-note lwf-postcard-note', 'On an iPhone, press and hold the picture to save it or send it.');
    let canShare = false;
    try {
      canShare = !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    } catch (err) {
      canShare = false;
    }
    if (canShare) {
      const share = button('lw-btn lw-btn-primary', 'Share', async () => {
        try {
          await navigator.share({ files: [file], title: 'League World', text: about + ' https://' + d.address + '/' });
        } catch (err) {
          // closing the share sheet is not an error; anything else points at the other way out
          if (!err || err.name !== 'AbortError') note.textContent = 'Sharing did not work here. Save the picture instead, or press and hold it.';
        }
      });
      acts.appendChild(share);
    }
    const save = el('a', 'lw-btn' + (canShare ? '' : ' lw-btn-primary'), 'Save picture');
    save.href = url;
    save.download = 'league-world-postcard.png';
    acts.appendChild(save);
    box.append(img, acts, note);
    hud.closeCard();
    hud.openPanel({ title: 'Postcard', contentEl: box, onClose: () => setTimeout(() => URL.revokeObjectURL(url), 4000) });
  }

  async function open(o = {}) {
    if (busy) return false;
    busy = true;
    try {
      const d = describe(o.teamId);
      await fontsReady();
      try {
        d.photo = capture(ctx, d.view);
      } catch (err) {
        console.warn('[lw] the postcard photo could not be taken, using a plain card', err);
        d.photo = null;
      }
      flash();
      const canvas = drawPostcard(document.createElement('canvas'), d);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('the picture could not be made');
      preview(blob, d);
      return true;
    } catch (err) {
      console.error('[lw] postcard failed', err);
      hud.toast('The postcard did not come out. Try again.');
      return false;
    } finally {
      busy = false;
    }
  }

  return { open, describe };
}
