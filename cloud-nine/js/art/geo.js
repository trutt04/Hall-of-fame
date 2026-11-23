// Tiny geometry toolkit for League World art.
// Everything is baked into ONE non-indexed BufferGeometry with vertex colors, so a whole prop
// is a single draw call with the shared flat-shaded material. No normals are stored: the shared
// materials are flat shaded (normals come from screen-space derivatives) or unlit.
import * as THREE from '../../lib/three.module.min.js';

const TAU = Math.PI * 2;
const _color = new THREE.Color();
const _lin = new Map();
const _m = new THREE.Matrix4();

// sRGB hex -> linear rgb triple (cached). Vertex colors live in the linear working space.
export function lin(hex) {
  let c = _lin.get(hex);
  if (!c) {
    _color.set(hex);
    c = [_color.r, _color.g, _color.b];
    _lin.set(hex, c);
  }
  return c;
}

// f < 1 darkens, f > 1 lightens toward white. Works on sRGB hex.
export function shade(hex, f) {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (f <= 1) { r *= f; g *= f; b *= f; } else {
    const k = Math.min(1, f - 1);
    r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k;
  }
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

// Deterministic 0..1 hash of an integer.
export function hash(n) {
  n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

// 3x5 block font (a few glyphs are wider). Rows top to bottom.
const FONT = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'], K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['10001', '11011', '10101', '10001', '10001'], N: ['1001', '1101', '1011', '1001', '1001'], O: ['111', '101', '101', '101', '111'],
  P: ['110', '101', '110', '100', '100'], Q: ['111', '101', '101', '111', '001'], R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'], U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'], W: ['10001', '10001', '10101', '11011', '10001'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['110', '001', '010', '100', '111'],
  3: ['110', '001', '010', '001', '110'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '110', '001', '110'],
  6: ['011', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '110'], '?': ['110', '001', '010', '000', '010'], '!': ['1', '1', '1', '0', '1'],
  '+': ['000', '010', '111', '010', '000'], '-': ['000', '000', '111', '000', '000'], x: ['000', '101', '010', '101', '000'],
  '.': ['0', '0', '0', '0', '1'], "'": ['1', '1', '0', '0', '0'], ' ': ['00', '00', '00', '00', '00'],
  '$': ['011', '110', '010', '011', '110'], '#': ['101', '111', '101', '111', '101'], ':': ['0', '1', '0', '1', '0'],
  '<': ['001', '010', '100', '010', '001'], '>': ['100', '010', '001', '010', '100'], '/': ['001', '001', '010', '100', '100'],
};

export function textWidth(str, px) {
  let w = 0;
  for (const ch of str) w += ((FONT[ch] || FONT[ch.toUpperCase()] || FONT[' '])[0].length + 1);
  return (w - 1) * px;
}

export class Geo {
  // opts: { alpha: store RGBA colors, uv: store uvs, skin: store skin indices/weights }
  constructor(o = {}) {
    this.p = [];
    this.c = [];
    this.alpha = !!o.alpha;
    this.a = 1;                      // current alpha (only stored when alpha is on)
    this.uv = o.uv ? [] : null;
    this.u = 0; this.v = 0;          // current uv (constant per vertex unless set by quadUV)
    this.si = o.skin ? [] : null;
    this.sw = o.skin ? [] : null;
    this.skinFn = null;              // (x, y, z, indices[], weights[]) pushes 4 + 4 values
    this.m = new THREE.Matrix4();
    this.st = [];
    this.flip = false;
    this.jit = 0;                    // per-face brightness jitter (0.04 is plenty)
    this._n = 1;
    this.links = null;
  }

  get tris() { return this.p.length / 9; }

  // Another Geo that follows this one's transform (static body + window panes, for example).
  link(other) {
    other.m = this.m;
    (this.links || (this.links = [])).push(other);
    return this;
  }

  // ---- transform stack -------------------------------------------------------------------
  _upd() {
    this.flip = this.m.determinant() < 0;
    if (this.links) for (const l of this.links) l.flip = this.flip;
    return this;
  }
  save() { this.st.push(this.m.elements.slice()); return this; }
  restore() { this.m.fromArray(this.st.pop()); return this._upd(); }
  translate(x, y, z) { this.m.multiply(_m.makeTranslation(x, y, z)); return this; }
  rotX(a) { this.m.multiply(_m.makeRotationX(a)); return this; }
  rotY(a) { this.m.multiply(_m.makeRotationY(a)); return this; }
  rotZ(a) { this.m.multiply(_m.makeRotationZ(a)); return this; }
  scale(x, y, z) { this.m.multiply(_m.makeScale(x, y === undefined ? x : y, z === undefined ? x : z)); return this._upd(); }
  // save + translate + rotate (Y, then X, then Z)
  at(x, y, z, ry, rx, rz) {
    this.save().translate(x, y, z);
    if (ry) this.rotY(ry);
    if (rx) this.rotX(rx);
    if (rz) this.rotZ(rz);
    return this;
  }

  // ---- low level -------------------------------------------------------------------------
  _col(hex) {
    const c = lin(hex);
    if (!this.jit) return c;
    const k = 1 + (hash(this._n++) - 0.5) * 2 * this.jit;
    return [c[0] * k, c[1] * k, c[2] * k];
  }
  _push(x, y, z, k, a) {
    const e = this.m.elements;
    const X = e[0] * x + e[4] * y + e[8] * z + e[12];
    const Y = e[1] * x + e[5] * y + e[9] * z + e[13];
    const Z = e[2] * x + e[6] * y + e[10] * z + e[14];
    this.p.push(X, Y, Z);
    if (this.alpha) this.c.push(k[0], k[1], k[2], a); else this.c.push(k[0], k[1], k[2]);
    if (this.uv) this.uv.push(this.u, this.v);
    if (this.si) this.skinFn(X, Y, Z, this.si, this.sw);
  }
  _tri(a, b, c, k) {
    if ((a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) || (a[0] === c[0] && a[1] === c[1] && a[2] === c[2]) ||
        (b[0] === c[0] && b[1] === c[1] && b[2] === c[2])) return;
    if (this.flip) { const t = b; b = c; c = t; }
    this._push(a[0], a[1], a[2], k, this.a);
    this._push(b[0], b[1], b[2], k, this.a);
    this._push(c[0], c[1], c[2], k, this.a);
  }
  // Counter-clockwise seen from the front.
  tri(a, b, c, hex) { this._tri(a, b, c, this._col(hex)); return this; }
  quad(a, b, c, d, hex) {
    const k = this._col(hex);
    this._tri(a, b, c, k); this._tri(a, c, d, k);
    return this;
  }
  quad2(a, b, c, d, hex, backHex) {
    this.quad(a, b, c, d, hex);
    return this.quad(d, c, b, a, backHex === undefined ? hex : backHex);
  }
  tri2(a, b, c, hex) { this.tri(a, b, c, hex); return this.tri(c, b, a, hex); }
  // Triangle with a color and alpha per vertex (gradients for glows and beams).
  triG(a, b, c, ha, hb, hc, aa = 1, ab = 1, ac = 1) {
    if (this.flip) { let t = b; b = c; c = t; t = hb; hb = hc; hc = t; t = ab; ab = ac; ac = t; }
    this._push(a[0], a[1], a[2], lin(ha), aa);
    this._push(b[0], b[1], b[2], lin(hb), ab);
    this._push(c[0], c[1], c[2], lin(hc), ac);
    return this;
  }
  // Triangle pushed so it faces away from `from` (a point inside the shape).
  triOut(a, b, c, hex, from) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (a[0] + b[0] + c[0]) / 3 - from[0], cy = (a[1] + b[1] + c[1]) / 3 - from[1], cz = (a[2] + b[2] + c[2]) / 3 - from[2];
    return nx * cx + ny * cy + nz * cz >= 0 ? this.tri(a, b, c, hex) : this.tri(a, c, b, hex);
  }
  // Textured quad: a,b,c,d counter-clockwise from bottom-left, uv rect [u0,v0,u1,v1].
  quadUV(a, b, c, d, hex, u0, v0, u1, v1) {
    const k = this._col(hex), su = this.u, sv = this.v;
    const pts = this.flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    const uvs = this.flip ? [[u0, v0], [u1, v1], [u1, v0], [u0, v0], [u0, v1], [u1, v1]] : [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 6; i++) {
      this.u = uvs[i][0]; this.v = uvs[i][1];
      this._push(pts[i][0], pts[i][1], pts[i][2], k, this.a);
    }
    this.u = su; this.v = sv;
    return this;
  }

  // ---- primitives ------------------------------------------------------------------------
  // Box with its BASE center at (x, y, z). Options: rx/ry/rz (rotate about the base center),
  // tx/tz (top face scale), sx/sz (top face shift), top/front (face colors), bottom: true, noTop.
  box(x, y, z, w, h, d, hex, o) {
    if (o && (o.rx || o.ry || o.rz)) {
      this.at(x, y, z, o.ry, o.rx, o.rz);
      this._box(0, 0, 0, w, h, d, hex, o);
      return this.restore();
    }
    return this._box(x, y, z, w, h, d, hex, o || {});
  }
  _box(x, y, z, w, h, d, hex, o) {
    const tx = o.tx === undefined ? 1 : o.tx, tz = o.tz === undefined ? 1 : o.tz;
    const sx = o.sx || 0, sz = o.sz || 0;
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y + h;
    const X0 = x + sx - (w / 2) * tx, X1 = x + sx + (w / 2) * tx, Z0 = z + sz - (d / 2) * tz, Z1 = z + sz + (d / 2) * tz;
    const A = [x0, y, z1], B = [x1, y, z1], C = [x1, y, z0], D = [x0, y, z0];
    const E = [X0, y1, Z1], F = [X1, y1, Z1], G = [X1, y1, Z0], H = [X0, y1, Z0];
    const side = o.side === undefined ? hex : o.side;
    this.quad(A, B, F, E, o.front === undefined ? hex : o.front);
    this.quad(B, C, G, F, side);
    this.quad(C, D, H, G, o.back === undefined ? hex : o.back);
    this.quad(D, A, E, H, side);
    if (!o.noTop) this.quad(E, F, G, H, o.top === undefined ? hex : o.top);
    if (o.bottom) this.quad(D, C, B, A, o.bottom === true ? hex : o.bottom);
    return this;
  }
  // Box centered on (x, y, z), all six faces.
  cbox(x, y, z, w, h, d, hex, o) {
    return this.box(x, y - h / 2, z, w, h, d, hex, Object.assign({ bottom: true }, o));
  }

  // One ring of quads between two circles (r0 at y0, r1 at y1).
  band(r0, y0, r1, y1, seg, ph, hex, arc = TAU) {
    for (let i = 0; i < seg; i++) {
      const a0 = ph + (arc * i) / seg, a1 = ph + (arc * (i + 1)) / seg;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad([r0 * c1, y0, r0 * s1], [r0 * c0, y0, r0 * s0], [r1 * c0, y1, r1 * s0], [r1 * c1, y1, r1 * s1], hex);
    }
    return this;
  }
  // Flat fan facing +Y (or -Y with down = true) at height y.
  fan(r, y, seg, ph, hex, down) {
    const k = this._col(hex);
    for (let i = 0; i < seg; i++) {
      const a0 = ph + (TAU * i) / seg, a1 = ph + (TAU * (i + 1)) / seg;
      const p0 = [r * Math.cos(a0), y, r * Math.sin(a0)], p1 = [r * Math.cos(a1), y, r * Math.sin(a1)];
      if (down) this._tri([0, y, 0], p0, p1, k); else this._tri([0, y, 0], p1, p0, k);
    }
    return this;
  }
  // Cylinder with its base center at (x, y, z). Options: seg, rt (top radius), ph, rx/ry/rz,
  // top (color or false), bottom (true or color).
  cyl(x, y, z, r, h, hex, o = {}) {
    const seg = o.seg || 8, rt = o.rt === undefined ? r : o.rt, ph = o.ph === undefined ? Math.PI / seg : o.ph;
    this.at(x, y, z, o.ry, o.rx, o.rz);
    this.band(r, 0, rt, h, seg, ph, hex);
    if (rt > 0 && o.top !== false) this.fan(rt, h, seg, ph, o.top === undefined ? hex : o.top);
    if (r > 0 && o.bottom) this.fan(r, 0, seg, ph, o.bottom === true ? hex : o.bottom, true);
    return this.restore();
  }
  cone(x, y, z, r, h, hex, o = {}) { return this.cyl(x, y, z, r, h, hex, Object.assign({ rt: 0 }, o)); }
  // Surface of revolution. profile: [[r, y, color?], ...] bottom to top; a point's color paints
  // the band that starts at it.
  lathe(x, y, z, profile, hex, o = {}) {
    const seg = o.seg || 8, ph = o.ph === undefined ? Math.PI / seg : o.ph;
    this.at(x, y, z, o.ry, o.rx, o.rz);
    if (o.sx || o.sz) this.scale(o.sx || 1, 1, o.sz || 1);
    let col = hex;
    for (let i = 0; i < profile.length - 1; i++) {
      if (profile[i][2] !== undefined) col = profile[i][2];
      this.band(profile[i][0], profile[i][1], profile[i + 1][0], profile[i + 1][1], seg, ph, col);
    }
    const last = profile[profile.length - 1];
    if (o.capTop !== false && last[0] > 0) this.fan(last[0], last[1], seg, ph, o.capTop === undefined || o.capTop === true ? col : o.capTop);
    if (o.capBot && profile[0][0] > 0) this.fan(profile[0][0], profile[0][1], seg, ph, o.capBot === true ? hex : o.capBot, true);
    return this.restore();
  }
  // Sphere CENTERED on (x, y, z). Options: seg, rings, sx/sy/sz.
  sphere(x, y, z, r, hex, o = {}) {
    const seg = o.seg || 8, rings = o.rings || 5, ph = o.ph === undefined ? Math.PI / seg : o.ph;
    this.at(x, y, z, o.ry, o.rx, o.rz);
    if (o.sx || o.sy || o.sz) this.scale(o.sx || 1, o.sy || 1, o.sz || 1);
    for (let j = 0; j < rings; j++) {
      const p0 = -Math.PI / 2 + (Math.PI * j) / rings, p1 = -Math.PI / 2 + (Math.PI * (j + 1)) / rings;
      const r0 = j === 0 ? 0 : r * Math.cos(p0), r1 = j === rings - 1 ? 0 : r * Math.cos(p1);
      this.band(r0, r * Math.sin(p0), r1, r * Math.sin(p1), seg, ph, hex);
    }
    return this.restore();
  }
  // Faceted blob CENTERED on (x, y, z). Options: detail (0 = 20 tris, 1 = 80), sx/sy/sz,
  // jitter (0..0.4 lumpiness), rnd (random function for the jitter), flat (cut below y = -flat*r).
  ico(x, y, z, r, hex, o = {}) {
    const t = (1 + Math.sqrt(5)) / 2;
    let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const norm = (p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; };
    v = v.map(norm);
    for (let d = 0; d < (o.detail || 0); d++) {
      const cache = new Map(), nf = [];
      const mid = (a, b) => {
        const key = a < b ? a * 4096 + b : b * 4096 + a;
        let i = cache.get(key);
        if (i === undefined) { i = v.length; v.push(norm([v[a][0] + v[b][0], v[a][1] + v[b][1], v[a][2] + v[b][2]])); cache.set(key, i); }
        return i;
      };
      for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      f = nf;
    }
    const rnd = o.rnd || Math.random, j = o.jitter || 0;
    const sx = (o.sx || 1) * r, sy = (o.sy || 1) * r, sz = (o.sz || 1) * r;
    const pts = v.map((p) => {
      const k = 1 + (j ? (rnd() - 0.5) * 2 * j : 0);
      let py = p[1] * k;
      if (o.flat !== undefined && py < -o.flat) py = -o.flat;
      return [p[0] * k * sx, py * sy, p[2] * k * sz];
    });
    this.at(x, y, z, o.ry, o.rx, o.rz);
    const c = [0, 0, 0];
    for (const [a, b, d] of f) this.triOut(pts[a], pts[b], pts[d], hex, c);
    return this.restore();
  }
  // Gable prism: base w (x) by d (z) at height y, ridge along X at height h. Options: ends
  // (color of the two end triangles), bottom (color), ry.
  gable(x, y, z, w, h, d, hex, o = {}) {
    this.at(x, y, z, o.ry, 0, 0);
    const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2, e = o.ends === undefined ? hex : o.ends;
    const rx0 = x0 + (o.hip || 0), rx1 = x1 - (o.hip || 0);
    this.quad([x0, 0, z1], [x1, 0, z1], [rx1, h, 0], [rx0, h, 0], hex);
    this.quad([x1, 0, z0], [x0, 0, z0], [rx0, h, 0], [rx1, h, 0], hex);
    this.tri([x1, 0, z1], [x1, 0, z0], [rx1, h, 0], e);
    this.tri([x0, 0, z0], [x0, 0, z1], [rx0, h, 0], e);
    if (o.bottom !== undefined) this.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], o.bottom);
    return this.restore();
  }
  // Loft of chamfered rectangles stacked along Y. rings: [y, w, d, chamfer, ox, oz, color?]
  // (color paints the band starting at that ring). Options: capTop/capBot (bool or color).
  cloft(x, y, z, rings, hex, o = {}) {
    this.at(x, y, z, o.ry, o.rx, o.rz);
    const ring = (r) => {
      const w = r[1] / 2, d = r[2] / 2, c = Math.min(r[3] || 0, w, d), ox = r[4] || 0, oz = r[5] || 0, yy = r[0];
      return [[ox + w, yy, oz - d + c], [ox + w, yy, oz + d - c], [ox + w - c, yy, oz + d], [ox - w + c, yy, oz + d],
        [ox - w, yy, oz + d - c], [ox - w, yy, oz - d + c], [ox - w + c, yy, oz - d], [ox + w - c, yy, oz - d]];
    };
    let col = hex, prev = ring(rings[0]);
    const first = prev;
    for (let i = 0; i < rings.length - 1; i++) {
      if (rings[i][6] !== undefined) col = rings[i][6];
      const next = ring(rings[i + 1]);
      for (let k = 0; k < 8; k++) {
        const k1 = (k + 1) % 8;
        this.quad(prev[k1], prev[k], next[k], next[k1], col);
      }
      prev = next;
    }
    const cap = (pts, r, hexc, down) => {
      const k = this._col(hexc), c = [r[4] || 0, r[0], r[5] || 0];
      for (let i = 0; i < 8; i++) { const i1 = (i + 1) % 8; if (down) this._tri(c, pts[i], pts[i1], k); else this._tri(c, pts[i1], pts[i], k); }
    };
    if (o.capTop !== false) cap(prev, rings[rings.length - 1], o.capTop === undefined || o.capTop === true ? col : o.capTop, false);
    if (o.capBot) cap(first, rings[0], o.capBot === true ? hex : o.capBot, true);
    return this.restore();
  }
  // Tube along a list of points. Options: seg (sides), r1 (end radius, for tapering), caps.
  tube(points, r, hex, o = {}) {
    const seg = o.seg || 4, n = points.length, r1 = o.r1 === undefined ? r : o.r1;
    const rings = [];
    let ux = 0, uy = 1, uz = 0;
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)], p = points[i];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (Math.abs(tx * ux + ty * uy + tz * uz) > 0.95) { if (Math.abs(ty) > 0.9) { ux = 1; uy = 0; uz = 0; } else { ux = 0; uy = 1; uz = 0; } }
      let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      const rr = r + ((r1 - r) * i) / Math.max(1, n - 1), ring = [];
      for (let k = 0; k < seg; k++) {
        const an = (TAU * k) / seg + (o.ph || 0), c = Math.cos(an) * rr, s = Math.sin(an) * rr;
        ring.push([p[0] + nx * c + bx * s, p[1] + ny * c + by * s, p[2] + nz * c + bz * s]);
      }
      rings.push(ring);
      ux = bx; uy = by; uz = bz; // carry the frame along the path
      // keep "up" stable: re-orthogonalised next loop
    }
    for (let i = 0; i < n - 1; i++) {
      const mid = [(points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2, (points[i][2] + points[i + 1][2]) / 2];
      const k0 = this._col(hex);
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg, A = rings[i][k], B = rings[i][k1], C = rings[i + 1][k1], D = rings[i + 1][k];
        const ux2 = B[0] - A[0], uy2 = B[1] - A[1], uz2 = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
        const nx = uy2 * vz - uz2 * vy, ny = uz2 * vx - ux2 * vz, nz = ux2 * vy - uy2 * vx;
        const out = nx * ((A[0] + C[0]) / 2 - mid[0]) + ny * ((A[1] + C[1]) / 2 - mid[1]) + nz * ((A[2] + C[2]) / 2 - mid[2]) >= 0;
        const kk = this.jit ? this._col(hex) : k0;
        if (out) { this._tri(A, B, C, kk); this._tri(A, C, D, kk); } else { this._tri(A, C, B, kk); this._tri(A, D, C, kk); }
      }
    }
    if (o.caps) {
      for (const [ring, p, q] of [[rings[0], points[0], points[1]], [rings[n - 1], points[n - 1], points[n - 2]]]) {
        const from = [q[0], q[1], q[2]];
        for (let k = 1; k < seg - 1; k++) this.triOut(ring[0], ring[k], ring[k + 1], hex, from);
      }
    }
    return this;
  }
  // Flat disc facing +Y at (x, y, z).
  disc(x, y, z, r, hex, o = {}) {
    const seg = o.seg || 8;
    this.at(x, y, z, o.ry, o.rx, o.rz);
    if (o.sx || o.sz) this.scale(o.sx || 1, 1, o.sz || 1);
    this.fan(r, 0, seg, o.ph === undefined ? Math.PI / seg : o.ph, hex);
    return this.restore();
  }
  // Vertical quad facing +Z, bottom center at (x, y, z). Options: ry, rx, double.
  plane(x, y, z, w, h, hex, o = {}) {
    this.at(x, y, z, o.ry, o.rx, o.rz);
    const A = [-w / 2, 0, 0], B = [w / 2, 0, 0], C = [w / 2, h, 0], D = [-w / 2, h, 0];
    if (o.double) this.quad2(A, B, C, D, hex, o.back); else this.quad(A, B, C, D, hex);
    return this.restore();
  }
  // Block-letter text made of flat quads facing +Z. (x, y) is the bottom center (or bottom
  // left with align: 'left'); px is the size of one font pixel. Text is 5 px tall.
  text(str, x, y, z, px, hex, o = {}) {
    this.at(x, y, z, o.ry, o.rx, o.rz);
    let cx = o.align === 'left' ? 0 : -textWidth(str, px) / 2;
    for (const ch of str) {
      const g = FONT[ch] || FONT[ch.toUpperCase()] || FONT[' '];
      for (let row = 0; row < 5; row++) {
        const line = g[row];
        let run = -1;
        for (let i = 0; i <= line.length; i++) {
          const on = i < line.length && line[i] === '1';
          if (on && run < 0) run = i;
          if (!on && run >= 0) {
            const x0 = cx + run * px, x1 = cx + i * px, y0 = (4 - row) * px, y1 = y0 + px;
            this.quad([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], hex);
            run = -1;
          }
        }
      }
      cx += (g[0].length + 1) * px;
    }
    return this.restore();
  }

  // ---- post -------------------------------------------------------------------------------
  // Multiply colors by a vertical ramp: f0 at y0 rising to 1 at y1 (cheap ground occlusion).
  // Only affects vertices added since `fromTri` (default: everything).
  shadeY(y0, y1, f0, fromTri = 0) {
    const n = this.alpha ? 4 : 3;
    for (let i = fromTri * 3; i < this.p.length / 3; i++) {
      const y = this.p[i * 3 + 1];
      let t = (y - y0) / (y1 - y0);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const f = f0 + (1 - f0) * t;
      this.c[i * n] *= f; this.c[i * n + 1] *= f; this.c[i * n + 2] *= f;
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), this.alpha ? 4 : 3));
    if (this.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    if (this.si) {
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(this.si), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(this.sw), 4));
    }
    if (this.p.length) { g.computeBoundingSphere(); g.computeBoundingBox(); }
    return g;
  }
  mesh(material) { return new THREE.Mesh(this.build(), material); }
}

// Merge BufferGeometries that share the same attribute layout (position + color, optional uv).
export function merge(geos) {
  const out = new THREE.BufferGeometry();
  const names = Object.keys(geos[0].attributes);
  for (const name of names) {
    const size = geos[0].attributes[name].itemSize;
    let total = 0;
    for (const g of geos) total += g.attributes[name].array.length;
    const arr = new geos[0].attributes[name].array.constructor(total);
    let off = 0;
    for (const g of geos) { arr.set(g.attributes[name].array, off); off += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

export { TAU };
