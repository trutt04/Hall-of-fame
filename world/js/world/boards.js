// The big canvases: the standings board, the matchup board, the statue plaque, the blimp banner
// and the garbage truck's side panel. Everything is drawn large and bold so it reads from across
// the plaza on a phone. Team names are untrusted: fitted, never trusted to be short.

import * as THREE from '../../lib/three.module.min.js';
import { FONT_BODY, FONT_DISPLAY, fit, hex } from './signs.js';

const NAVY = '#0d1430';
const PANEL = '#18213f';
const GOLD = '#f5c542';
const CHALK = '#f3eedd';
const STONE = '#aab3bf';
const FLARE = '#ff6a3d';
const WIN = '#7ddc7a';
const LOSS = '#ff7a6b';
const TIER_BAND = { hill: '#f5c542', heights: '#5fb8e8', bubble: '#c9b58a', park: '#ff9a3d', dump: '#9bbf5a' };
const TIER_SHORT = { hill: 'THE HILL', heights: 'HEIGHTS', bubble: 'BUBBLE', park: 'PARK', dump: 'DUMP' };

export function boardTexture(cv) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function stamp(g, text, x, y, size, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `${size}px ${FONT_DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = g.measureText(text).width + size * 0.7;
  g.strokeStyle = FLARE;
  g.lineWidth = Math.max(3, size * 0.12);
  g.fillStyle = 'rgba(13,20,48,0.82)';
  g.fillRect(-w / 2, -size * 0.75, w, size * 1.5);
  g.strokeRect(-w / 2, -size * 0.75, w, size * 1.5);
  g.fillStyle = FLARE;
  g.fillText(text, 0, size * 0.06);
  g.restore();
}

function updatedText(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  try {
    return 'Updated ' + d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } catch (err) {
    return 'Updated ' + d.toDateString();
  }
}

// ---------------------------------------------------------------- standings
export function drawStandings(cv, model, playerTeam) {
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const n = model.order.length;
  const head = Math.round(H * 0.095);
  const foot = Math.round(H * 0.045);
  const rowH = (H - head - foot - 8) / n;
  const band = 112;
  g.fillStyle = NAVY;
  g.fillRect(0, 0, W, H);
  g.fillStyle = PANEL;
  g.fillRect(0, 0, W, head);
  g.fillStyle = GOLD;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const title = fit(g, 'STANDINGS · WEEK ' + model.meta.week, W - (model.meta.isSample ? 330 : 60), head * 0.56, 26, FONT_DISPLAY, '400');
  g.fillText(title, 28, head / 2 + 4);
  g.fillStyle = GOLD;
  g.fillRect(0, head - 5, W, 5);

  const fsRank = Math.min(58, rowH * 0.74);
  const fsName = Math.min(56, rowH * 0.72);
  const xRank = band + 66;
  const xChip = band + 78;
  const xName = xChip + 40;
  const xStreak = W - 12;
  const xPf = W - 104;
  const xRec = W - 214;
  let tierStart = 0;
  for (let i = 0; i < n; i++) {
    const t = model.teams[model.order[i]];
    const y = head + 4 + i * rowH;
    const mid = y + rowH / 2 + 2;
    if (i % 2) {
      g.fillStyle = 'rgba(255,255,255,0.085)';
      g.fillRect(band, y, W - band, rowH);
    }
    if (t.id === playerTeam) {
      g.fillStyle = 'rgba(245,197,66,0.34)';
      g.fillRect(band, y + 1, W - band, rowH - 2);
      g.strokeStyle = GOLD;
      g.lineWidth = 6;
      g.strokeRect(band + 2, y + 3, W - band - 4, rowH - 6);
    }
    g.textAlign = 'right';
    g.fillStyle = t.rank <= model.cutLine ? GOLD : CHALK;
    g.font = `${fsRank}px ${FONT_DISPLAY}`;
    g.fillText(String(t.rank), xRank, mid);
    g.fillStyle = hex(t.color);
    g.fillRect(xChip, y + rowH * 0.2, 26, rowH * 0.6);
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 2;
    g.strokeRect(xChip, y + rowH * 0.2, 26, rowH * 0.6);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.fillText(fit(g, t.name, xRec - 92 - xName, fsName, 24, FONT_BODY, '700'), xName, mid);
    g.textAlign = 'right';
    g.font = `700 ${fsName}px ${FONT_BODY}`;
    g.fillStyle = '#ffffff';
    g.fillText(t.record.text, xRec, mid);
    g.font = `600 ${fsName * 0.62}px ${FONT_BODY}`;
    g.fillStyle = '#c9d2dc';
    g.fillText(Number(t.pointsFor).toFixed(0), xPf, mid);
    if (t.streak && t.streak.type) {
      g.font = `700 ${fsName * 0.74}px ${FONT_BODY}`;
      g.fillStyle = t.streak.type === 'W' ? WIN : t.streak.type === 'L' ? LOSS : STONE;
      g.fillText(t.streak.type + t.streak.length, xStreak, mid);
    }
    // tier band: one labeled block per neighborhood
    const next = model.teams[model.order[i + 1]];
    if (!next || next.tier !== t.tier) {
      const y0 = head + 4 + tierStart * rowH;
      const h = (i - tierStart + 1) * rowH;
      g.fillStyle = TIER_BAND[t.tier] || STONE;
      g.fillRect(0, y0 + 2, band - 10, h - 4);
      g.fillStyle = NAVY;
      g.textAlign = 'center';
      const label = fit(g, TIER_SHORT[t.tier] || t.tier, band - 22, 28, 15, FONT_DISPLAY, '400');
      g.fillText(label, (band - 10) / 2, y0 + h / 2 + 2);
      tierStart = i + 1;
    }
  }
  // the playoff line
  if (model.cutLine > 0 && model.cutLine < n) {
    const y = head + 4 + model.cutLine * rowH;
    g.save();
    g.strokeStyle = FLARE;
    g.lineWidth = 6;
    g.setLineDash([22, 12]);
    g.beginPath();
    g.moveTo(band, y);
    g.lineTo(W, y);
    g.stroke();
    g.restore();
    g.font = `20px ${FONT_DISPLAY}`;
    const lw = g.measureText('PLAYOFF LINE').width + 20;
    g.fillStyle = FLARE;
    g.fillRect(W - lw - 250, y - 14, lw, 28);
    g.fillStyle = NAVY;
    g.textAlign = 'center';
    g.fillText('PLAYOFF LINE', W - 250 - lw / 2, y + 2);
  }
  g.fillStyle = PANEL;
  g.fillRect(0, H - foot, W, foot);
  g.fillStyle = STONE;
  g.textAlign = 'left';
  g.font = `600 ${foot * 0.56}px ${FONT_BODY}`;
  g.fillText(updatedText(model.meta.generatedAt), 24, H - foot / 2 + 2);
  g.textAlign = 'right';
  g.fillText(fit(g, model.meta.leagueName, W * 0.5, foot * 0.56, 14, FONT_BODY, '600'), W - 24, H - foot / 2 + 2);
  if (model.meta.isSample) stamp(g, 'SAMPLE DATA', W - 152, head / 2 - 2, head * 0.24, -0.04);
  return cv;
}

// ---------------------------------------------------------------- matchups
function countdown(iso, now) {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) return '';
  let s = Math.max(0, Math.round((t - now) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  return d > 0 ? d + 'D ' + h + 'H' : h > 0 ? h + 'H ' + m + 'M' : m + 'M';
}

export function drawMatchups(cv, model, playerTeam, now = Date.now()) {
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const list = model.matchups || [];
  const head = Math.round(H * 0.15);
  g.fillStyle = NAVY;
  g.fillRect(0, 0, W, H);
  g.fillStyle = PANEL;
  g.fillRect(0, 0, W, head);
  g.fillStyle = GOLD;
  g.fillRect(0, head - 5, W, 5);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `${head * 0.52}px ${FONT_DISPLAY}`;
  g.fillText('THIS WEEK', 28, head / 2 + 4);
  // overall status chip
  const st = model.meta.weekStatus;
  const live = st === 'live';
  const cd = countdown(model.meta.nextKickoff, now);
  const chip = live ? (model.meta.nflLive ? 'LIVE NOW' : 'IN PROGRESS') : st === 'final' ? 'FINAL' : cd ? 'KICKOFF IN ' + cd : 'WEEK ' + model.meta.week;
  g.font = `${head * 0.3}px ${FONT_DISPLAY}`;
  const cw = g.measureText(chip).width + 36;
  g.fillStyle = live && model.meta.nflLive ? '#d7263d' : live ? FLARE : '#27335c';
  g.fillRect(W - cw - 24, head * 0.24, cw, head * 0.52);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.fillText(chip, W - 24 - cw / 2, head / 2 + 3);
  if (!list.length) {
    g.fillStyle = STONE;
    g.font = `700 44px ${FONT_BODY}`;
    g.fillText('No games on the board this week', W / 2, (H + head) / 2);
    return cv;
  }
  const rowH = (H - head - 10) / list.length;
  const fs = Math.min(44, rowH * 0.42);
  const cx = W / 2;
  list.forEach((mu, i) => {
    const a = model.teams[mu.homeId];
    const b = model.teams[mu.awayId];
    if (!a || !b) return;
    const y = head + 6 + i * rowH;
    const mid = y + rowH / 2;
    if (i % 2) {
      g.fillStyle = 'rgba(255,255,255,0.045)';
      g.fillRect(0, y, W, rowH);
    }
    if (a.id === playerTeam || b.id === playerTeam) {
      g.fillStyle = 'rgba(245,197,66,0.22)';
      g.fillRect(0, y + 1, W, rowH - 2);
      g.strokeStyle = GOLD;
      g.lineWidth = 4;
      g.strokeRect(2, y + 3, W - 4, rowH - 6);
    }
    const aw = mu.homePts > mu.awayPts;
    const bw = mu.awayPts > mu.homePts;
    const played = mu.status !== 'pre';
    const side = (team, pts, proj, winning, left) => {
      const x0 = left ? 20 : W - 20;
      g.fillStyle = hex(team.color);
      g.fillRect(left ? x0 : x0 - 20, y + rowH * 0.2, 20, rowH * 0.6);
      g.textAlign = left ? 'left' : 'right';
      g.fillStyle = winning || !played ? CHALK : STONE;
      const nameW = cx - 150 - 56;
      const str = fit(g, team.name, nameW, fs, 20, FONT_BODY, '700');
      g.fillText(str, left ? x0 + 32 : x0 - 32, mid - (played ? rowH * 0.12 : 0));
      if (played || proj) {
        g.font = `600 ${fs * 0.56}px ${FONT_BODY}`;
        g.fillStyle = STONE;
        const sub = team.record.text + (proj ? '  ·  proj ' + Number(proj).toFixed(1) : '');
        g.fillText(sub, left ? x0 + 32 : x0 - 32, mid + rowH * 0.24);
      }
      g.textAlign = left ? 'right' : 'left';
      g.font = `${fs * 1.02}px ${FONT_DISPLAY}`;
      g.fillStyle = winning ? GOLD : played ? CHALK : STONE;
      g.fillText(played ? Number(pts).toFixed(1) : '--', left ? cx - 22 : cx + 22, mid + 2);
    };
    side(a, mu.homePts, mu.homeProj, aw, true);
    side(b, mu.awayPts, mu.awayProj, bw, false);
    g.textAlign = 'center';
    g.font = `700 ${fs * 0.5}px ${FONT_BODY}`;
    g.fillStyle = mu.status === 'live' ? FLARE : STONE;
    g.fillText(mu.status === 'live' ? 'LIVE' : mu.status === 'final' ? 'FINAL' : 'VS', cx, mid + 2);
  });
  return cv;
}

// ---------------------------------------------------------------- statue plaque
export function drawChampions(cv, model) {
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#3a2f16');
  grad.addColorStop(1, '#221a0b');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = GOLD;
  g.font = `44px ${FONT_DISPLAY}`;
  g.fillText('CHAMPIONS', W / 2, 44);
  const champs = (model.history && model.history.champions) || [];
  const rows = champs.slice(0, 5);
  const top = 86;
  const rowH = (H - top - (model.meta.historyIsSample ? 34 : 12)) / Math.max(1, rows.length);
  rows.forEach((c, i) => {
    const y = top + rowH * (i + 0.5);
    g.textAlign = 'left';
    g.fillStyle = GOLD;
    g.font = `${Math.min(36, rowH * 0.62)}px ${FONT_DISPLAY}`;
    g.fillText(String(c.season), 28, y + 2);
    g.fillStyle = '#fff3cf';
    g.fillText(fit(g, c.teamName, W - 180, Math.min(40, rowH * 0.7), 18, FONT_BODY, '700'), 150, y);
  });
  if (!rows.length) {
    g.fillStyle = '#fff3cf';
    g.font = `700 34px ${FONT_BODY}`;
    g.fillText('The first champion goes here', W / 2, H / 2 + 20);
  }
  if (model.meta.historyIsSample) {
    g.textAlign = 'center';
    g.font = `700 20px ${FONT_BODY}`;
    g.fillStyle = 'rgba(255,243,207,0.75)';
    g.fillText('SAMPLE HISTORY', W / 2, H - 18);
  }
  return cv;
}

// ---------------------------------------------------------------- blimp banner and truck panel
export function drawBanner(cv, text) {
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  g.fillStyle = CHALK;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#d7263d';
  g.fillRect(0, 0, W, H * 0.06);
  g.fillRect(0, H * 0.94, W, H * 0.06);
  g.fillStyle = PANEL;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(fit(g, String(text || '').toUpperCase(), W - 44, H * 0.78, 20, FONT_DISPLAY, '400'), W / 2, H / 2 + H * 0.04);
  return cv;
}

export function drawTruckPanel(cv, teamName) {
  const g = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  g.fillStyle = '#e9e4d2';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#2e7d4f';
  g.fillRect(0, H * 0.58, W, H * 0.42);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = PANEL;
  g.fillText(fit(g, teamName, W - 40, H * 0.34, 18, FONT_BODY, '700'), W / 2, H * 0.3);
  g.fillStyle = '#ffffff';
  g.fillText(fit(g, 'SANITATION', W - 60, H * 0.3, 18, FONT_DISPLAY, '400'), W / 2, H * 0.8);
  return cv;
}
