// STAGE 1 ONLY: floating labels and facing arrows so the empty town plan can be judged in
// screenshots. Stage 2 replaces these with real homes and props (and keeps them behind ?debug=1).
//
//   const markers = createMarkers(layout, terrain)
//   scene.add(markers.group); markers.setVisible(bool); markers.dispose()

import * as THREE from '../../lib/three.module.min.js';
import { TIERS, BRAND } from '../config.js';

const TIER_COLOR = { hill: '#f5c542', heights: '#5fb8e8', bubble: '#c9b58a', park: '#ff9a3d', dump: '#9bbf5a', plaza: '#f3eedd' };

function makeLabel(title, sub, color, width) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = sub ? 176 : 112;
  const g = cv.getContext('2d');
  const r = 22;
  g.fillStyle = 'rgba(10,16,34,0.88)';
  g.strokeStyle = color;
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(r + 4, 4);
  g.arcTo(cv.width - 4, 4, cv.width - 4, cv.height - 4, r);
  g.arcTo(cv.width - 4, cv.height - 4, 4, cv.height - 4, r);
  g.arcTo(4, cv.height - 4, 4, 4, r);
  g.arcTo(4, 4, cv.width - 4, 4, r);
  g.closePath();
  g.fill();
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  let size = 60;
  g.font = `${size}px Bungee, "Arial Black", sans-serif`;
  while (g.measureText(title).width > cv.width - 48 && size > 22) {
    size -= 4;
    g.font = `${size}px Bungee, "Arial Black", sans-serif`;
  }
  g.fillText(title, cv.width / 2, sub ? 64 : cv.height / 2 + 2);
  if (sub) {
    g.fillStyle = '#f3eedd';
    g.font = '700 40px "Barlow Semi Condensed", "Arial Narrow", sans-serif';
    g.fillText(sub, cv.width / 2, 128);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false }));
  sprite.scale.set(width, (width * cv.height) / cv.width, 1);
  return sprite;
}

export function createMarkers(layout, terrain) {
  const group = new THREE.Group();
  group.name = 'stage1Markers';
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const tri = (a, b, d, color) => {
    c.set(color);
    pos.push(...a, ...b, ...d);
    for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
  };
  // a flat arrow on the ground pointing along `facing` (the way the home's front door looks)
  const arrow = (x, z, y, facing, size, color) => {
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const rx = Math.cos(facing);
    const rz = -Math.sin(facing);
    const tip = [x + fx * size, y, z + fz * size];
    const l = [x - rx * size * 0.5, y, z - rz * size * 0.5];
    const r = [x + rx * size * 0.5, y, z + rz * size * 0.5];
    tri(tip, l, r, color);
    tri(tip, r, l, color);
  };
  const post = (x, z, y, h, color) => {
    const s = 0.08;
    tri([x - s, y, z], [x + s, y, z], [x, y + h, z], color);
    tri([x + s, y, z], [x - s, y, z], [x, y + h, z], color);
    tri([x, y, z - s], [x, y, z + s], [x, y + h, z], color);
    tri([x, y, z + s], [x, y, z - s], [x, y + h, z], color);
  };

  let rank = 1;
  for (const tier of ['hill', 'heights', 'bubble', 'park', 'dump']) {
    for (const lot of layout.lots[tier]) {
      const y = terrain.heightAt(lot.x, lot.z);
      const label = makeLabel(TIERS[tier].name.toUpperCase(), `Rank ${rank}  ·  lot ${lot.index + 1}`, TIER_COLOR[tier], tier === 'hill' ? 13 : 9);
      label.position.set(lot.x, y + (tier === 'hill' ? 11 : 7), lot.z);
      group.add(label);
      post(lot.x, lot.z, y, tier === 'hill' ? 9 : 5.6, TIER_COLOR[tier]);
      arrow(lot.x + Math.sin(lot.facing) * (lot.d / 2 - 3.2), lot.z + Math.cos(lot.facing) * (lot.d / 2 - 3.2), y + 0.12, lot.facing, 2.4, TIER_COLOR[tier]);
      rank++;
    }
  }

  const P = layout.places;
  const named = [
    ['statue', 'Statue'], ['standingsBoard', 'Standings board'], ['matchupBoard', 'Matchup board'], ['newspaperBox', 'Newspaper box'],
    ['hallOfFame', 'Hall of Fame'], ['leagueOffice', 'League Office'], ['graveyard', 'Graveyard'], ['fountain', 'Fountain'],
    ['outhouseRow', 'Outhouse row'], ['burningBarrel', 'Burning barrel'], ['landfillGate', 'Landfill gate'], ['hillGate', 'Gold gates'],
  ];
  for (const [key, text] of named) {
    const p = P[key];
    if (!p) continue;
    const y = terrain.heightAt(p.x, p.z);
    const big = key === 'hallOfFame' || key === 'leagueOffice' || key === 'graveyard';
    const label = makeLabel(text, null, '#f3eedd', big ? 7 : 4.6);
    label.position.set(p.x, y + (big ? 5.2 : 3.4), p.z);
    group.add(label);
    post(p.x, p.z, y, big ? 4.4 : 2.8, BRAND.chalk);
    arrow(p.x, p.z, y + 0.13, p.facing || 0, big ? 2 : 1.1, BRAND.flare);
  }

  // the playoff line through the cul-de-sac, where a 12-team, 6-playoff league would paint it
  if (layout.lots.bubble.length > 1) {
    const cut = P.cutLine(Math.floor(layout.lots.bubble.length / 2) - 1);
    const y = cut.y + 0.14;
    const nx = cut.inSide[0] * 0.22;
    const nz = cut.inSide[1] * 0.22;
    const a = [cut.a[0] - nx, y, cut.a[1] - nz];
    const b = [cut.a[0] + nx, y, cut.a[1] + nz];
    const d = [cut.b[0] + nx, y, cut.b[1] + nz];
    const e = [cut.b[0] - nx, y, cut.b[1] - nz];
    tri(a, b, d, BRAND.flare);
    tri(a, d, e, BRAND.flare);
    tri(a, d, b, BRAND.flare);
    tri(a, e, d, BRAND.flare);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  mesh.name = 'markerGeometry';
  group.add(mesh);

  return {
    group,
    setVisible(v) {
      group.visible = !!v;
    },
    get visible() { return group.visible; },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      if (group.parent) group.parent.remove(group);
    },
  };
}
