// Procedurele modellen met gladde normalen en losse bladkaarten.
// Elk model is één geïndexeerde geometrie met attributen:
//   aCol (basiskleur), aTint (hoeveel de instance-kleur meetelt), aGlow (licht),
//   aSway (wind/animatie), aLeaf (0 massief, 1 blad, 2 naald, 3 gras, 4 bloem) en uv.
import * as THREE from 'three';
import { mulberry32, fbm3 } from './noise.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _col = new THREE.Color();
const _v = new THREE.Vector3();

function keyOf(x, y, z) {
  return Math.round(x * 2000) + ',' + Math.round(y * 2000) + ',' + Math.round(z * 2000);
}

// gladde normalen op een niet-geïndexeerde geometrie: middel de vlaknormalen per positie
export function smoothNormals(g) {
  const p = g.attributes.position.array;
  const n = new Float32Array(p.length);
  const acc = new Map();
  const keys = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.fromArray(p, i); b.fromArray(p, i + 3); c.fromArray(p, i + 6);
    fn.subVectors(c, b).cross(_v.subVectors(a, b));
    for (let k = 0; k < 3; k++) {
      const key = keyOf(p[i + k * 3], p[i + k * 3 + 1], p[i + k * 3 + 2]);
      keys.push(key);
      const s = acc.get(key);
      if (s) { s[0] += fn.x; s[1] += fn.y; s[2] += fn.z; } else acc.set(key, [fn.x, fn.y, fn.z]);
    }
  }
  for (let v = 0; v < keys.length; v++) {
    const s = acc.get(keys[v]);
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    n[v * 3] = s[0] / l; n[v * 3 + 1] = s[1] / l; n[v * 3 + 2] = s[2] / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

// verplaats vertices langs hun richting vanaf het middelpunt met 3D-ruis
function displace(g, amp, freq, seed, center = [0, 0, 0], oct = 3) {
  const p = g.attributes.position.array;
  const cache = new Map();
  for (let i = 0; i < p.length; i += 3) {
    const key = keyOf(p[i], p[i + 1], p[i + 2]);
    let d = cache.get(key);
    if (!d) {
      _v.set(p[i] - center[0], p[i + 1] - center[1], p[i + 2] - center[2]);
      const len = _v.length() || 1;
      _v.divideScalar(len);
      const k = fbm3(p[i] * freq + 11.1, p[i + 1] * freq - 3.7, p[i + 2] * freq + 5.3, oct, seed) * amp;
      d = [_v.x * k, _v.y * k, _v.z * k];
      cache.set(key, d);
    }
    p[i] += d[0]; p[i + 1] += d[1]; p[i + 2] += d[2];
  }
  return g;
}

function bend(g, kx, kz, from = 0) {
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    const t = Math.max(p[i + 1] - from, 0);
    p[i] += kx * t * t;
    p[i + 2] += kz * t * t;
  }
  return g;
}

class Builder {
  constructor() { this.parts = []; }

  // o: color, tint, glow, sway, flap, leaf, vary, p, r, s, order, smooth, flat, disp:[amp,freq,seed], normals(fn)
  add(geo, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (o.disp) { displace(g, o.disp[0], o.disp[1], o.disp[2], [0, 0, 0], o.disp[3] || 3); o.smooth = true; }
    if (o.pre) o.pre(g);
    const p = o.p || [0, 0, 0], r = o.r || [0, 0, 0];
    const s = typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s || [1, 1, 1];
    _e.set(r[0], r[1], r[2], o.order || 'XYZ');
    _q.setFromEuler(_e);
    _m.compose(new THREE.Vector3(...p), _q, new THREE.Vector3(...s));
    g.applyMatrix4(_m);
    if (o.post) o.post(g);
    if (o.flat) { g.deleteAttribute('normal'); g.computeVertexNormals(); }
    else if (o.smooth || !g.attributes.normal) smoothNormals(g);
    if (o.normals) o.normals(g);
    this.parts.push({ g, o });
    return this;
  }

  build(swayRef) {
    let maxY = 0.001;
    for (const { g } of this.parts) {
      const a = g.attributes.position.array;
      for (let i = 1; i < a.length; i += 3) maxY = Math.max(maxY, a[i]);
    }
    const ref = swayRef || maxY;
    // verzamel alle vertices en ontdubbel ze tot een geïndexeerde geometrie
    const map = new Map();
    const P = [], N = [], UV = [], COL = [], TINT = [], GLOW = [], SWAY = [], LEAFA = [], IDX = [];
    for (const { g, o } of this.parts) {
      const a = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv.array;
      const cnt = a.length / 3;
      _col.set(o.color || '#ffffff');
      const rnd = mulberry32(o.seed || 7);
      let triShade = 1;
      for (let i = 0; i < cnt; i++) {
        if (o.vary && i % (o.varyEvery || 3) === 0) triShade = 1 + (rnd() - 0.5) * o.vary;
        const shadeK = (o.shade ? o.shade(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]) : 1) * triShade;
        let sw = 0;
        if (o.sway) sw = o.sway * Math.pow(Math.min(Math.max(a[i * 3 + 1] / ref, 0), 1), 1.5);
        if (o.flap) sw = Math.abs(a[i * 3]) * o.flap;
        const vals = [
          a[i * 3], a[i * 3 + 1], a[i * 3 + 2], n[i * 3], n[i * 3 + 1], n[i * 3 + 2], uv[i * 2], uv[i * 2 + 1],
          _col.r * shadeK, _col.g * shadeK, _col.b * shadeK, o.tint || 0, o.glow || 0, sw, o.leaf || 0,
        ];
        const key = vals.map((v) => Math.round(v * 4096)).join(',');
        let idx = map.get(key);
        if (idx === undefined) {
          idx = P.length / 3;
          map.set(key, idx);
          P.push(vals[0], vals[1], vals[2]);
          N.push(vals[3], vals[4], vals[5]);
          UV.push(vals[6], vals[7]);
          COL.push(vals[8], vals[9], vals[10]);
          TINT.push(vals[11]); GLOW.push(vals[12]); SWAY.push(vals[13]); LEAFA.push(vals[14]);
        }
        IDX.push(idx);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    geo.setAttribute('aCol', new THREE.Float32BufferAttribute(COL, 3));
    geo.setAttribute('aTint', new THREE.Float32BufferAttribute(TINT, 1));
    geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(GLOW, 1));
    geo.setAttribute('aSway', new THREE.Float32BufferAttribute(SWAY, 1));
    geo.setAttribute('aLeaf', new THREE.Float32BufferAttribute(LEAFA, 1));
    geo.setIndex(IDX);
    geo.computeBoundingSphere();
    return geo;
  }
}

// ---------- hulpjes ----------
const sphere = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cyl = (rt, rb, h, s = 8, hs = 3, open = true) => new THREE.CylinderGeometry(rt, rb, h, s, hs, open);
const lathe = (pts, seg = 12) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
const card = (w, h, baseAtZero = false) => {
  const g = new THREE.PlaneGeometry(w, h);
  if (baseAtZero) g.translate(0, h / 2, 0);
  return g;
};

// een tak: taps toelopende cilinder van a naar b
function branch(b, from, to, r0, r1, color) {
  const A = new THREE.Vector3(...from), B = new THREE.Vector3(...to);
  const len = A.distanceTo(B);
  const g = cyl(r1, r0, len, 6, 2);
  g.translate(0, len / 2, 0);
  const dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const e = new THREE.Euler().setFromQuaternion(q);
  b.add(g, { color, p: from, r: [e.x, e.y, e.z], order: e.order, sway: 0.25 });
}

// bladkaarten in een bol rond een middelpunt; normalen wijzen naar buiten (zachte, volumineuze belichting)
function foliage(b, rnd, { center, radius, count, size, color = '#ffffff', leaf = 1, squash = 1, upBlend = 0.25, sway = 0.55, varyCol = 0 }) {
  const [cx, cy, cz] = center;
  for (let i = 0; i < count; i++) {
    // punt in de bol, iets naar de buitenkant
    let x, y, z, l;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 0.12);
    const rr = Math.sqrt(l);
    const px = cx + x * radius, py = cy + y * radius * squash, pz = cz + z * radius;
    const out = new THREE.Vector3(x, y * squash, z).normalize().lerp(new THREE.Vector3(0, 1, 0), upBlend).normalize();
    const ao = 0.5 + 0.5 * rr * (0.75 + 0.25 * (y * 0.5 + 0.5));
    const sz = size * (0.75 + rnd() * 0.5);
    const tint = varyCol ? 1 + (rnd() - 0.5) * varyCol : 1;
    b.add(card(sz, sz), {
      color, tint: 1, leaf, p: [px, py, pz], r: [rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI], sway,
      shade: () => ao * tint,
      normals: (g) => {
        const n = g.attributes.normal.array;
        for (let k = 0; k < n.length; k += 3) { n[k] = out.x; n[k + 1] = out.y; n[k + 2] = out.z; }
      },
    });
  }
}

const BARK = '#5b4636';

// ---------- bomen ----------
export function treeBroad() {
  const rnd = mulberry32(101);
  const b = new Builder();
  b.add(cyl(0.2, 0.34, 4.2, 9, 6), { color: BARK, p: [0, 2.1, 0], pre: (g) => bend(g, 0.02, 0.01, -2.1), sway: 0.12 });
  b.add(lathe([[0.55, 0], [0.38, 0.25], [0.33, 0.6]], 9), { color: BARK, smooth: true });
  branch(b, [0.05, 3.0, 0], [1.4, 4.4, 0.4], 0.14, 0.06, BARK);
  branch(b, [0.0, 3.3, 0], [-1.3, 4.6, -0.5], 0.13, 0.05, BARK);
  branch(b, [0.05, 3.6, 0.05], [0.3, 5.0, -1.3], 0.12, 0.05, BARK);
  const lobes = [[0.1, 5.2, 0.0, 1.9], [1.5, 4.7, 0.5, 1.4], [-1.4, 4.9, -0.5, 1.45], [0.3, 4.8, -1.4, 1.35], [-0.3, 4.6, 1.3, 1.3], [0.0, 6.3, 0.1, 1.2]];
  for (const [x, y, z, r] of lobes) {
    b.add(ico(r * 0.5, 1), { color: '#6f6f6f', tint: 1, p: [x, y, z], disp: [r * 0.1, 1.2, 3], sway: 0.5 });
    foliage(b, rnd, { center: [x, y, z], radius: r, count: Math.round(r * 26), size: 1.25, sway: 0.55, varyCol: 0.3 });
  }
  return b.build();
}

export function pine() {
  const rnd = mulberry32(202);
  const b = new Builder();
  const H = 8.5;
  b.add(cyl(0.08, 0.3, H, 8, 6), { color: '#4e3b2e', p: [0, H / 2, 0], sway: 0.1 });
  b.add(cone(1.5, 6.2, 10), { color: '#8a8a8a', tint: 1, p: [0, 5.1, 0], disp: [0.18, 1.5, 9], sway: 0.25 });
  const levels = 9;
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1);
    const y = 1.8 + t * (H - 2.2);
    const R = 2.5 * Math.pow(1 - t, 0.95) + 0.35;
    const n = 7 + (i % 2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i * 0.6 + rnd() * 0.3;
      const droop = 0.25 + 0.35 * (1 - t) + rnd() * 0.15;
      const w = 0.6 + R * 0.35;
      const out = new THREE.Vector3(Math.sin(a), 0.7, Math.cos(a)).normalize();
      const sk = 0.7 + 0.3 * t + rnd() * 0.1;
      b.add(card(w, R * 1.05, true), {
        color: '#ffffff', tint: 1, leaf: 2, p: [0, y, 0], r: [Math.PI / 2 + droop, a, 0], order: 'YXZ', sway: 0.45,
        shade: () => sk * 1.15,
        normals: (g) => { const nn = g.attributes.normal.array; for (let j = 0; j < nn.length; j += 3) { nn[j] = out.x; nn[j + 1] = out.y; nn[j + 2] = out.z; } },
      });
    }
  }
  b.add(card(0.5, 1.2, true), { color: '#ffffff', tint: 1, leaf: 2, p: [0, H - 0.4, 0], sway: 0.5 });
  b.add(card(0.5, 1.2, true), { color: '#ffffff', tint: 1, leaf: 2, p: [0, H - 0.4, 0], r: [0, Math.PI / 2, 0], sway: 0.5 });
  return b.build(H);
}
function cone(r, h, s) { return new THREE.ConeGeometry(r, h, s, 4, true); }

export function blossomTree() {
  const rnd = mulberry32(303);
  const b = new Builder();
  const BK = '#4a3532';
  b.add(cyl(0.16, 0.32, 3.0, 9, 6), { color: BK, p: [0, 1.5, 0], pre: (g) => bend(g, 0.05, -0.02, -1.5) });
  branch(b, [0.2, 2.5, 0], [1.9, 3.6, 0.5], 0.13, 0.05, BK);
  branch(b, [0.15, 2.7, 0], [-1.6, 3.7, -0.4], 0.12, 0.05, BK);
  branch(b, [0.2, 2.9, 0], [0.4, 4.0, -1.6], 0.11, 0.04, BK);
  branch(b, [0.2, 2.8, 0], [0.0, 3.9, 1.6], 0.11, 0.04, BK);
  const lobes = [[0.3, 4.2, 0, 1.6], [1.9, 3.8, 0.5, 1.2], [-1.6, 3.9, -0.4, 1.2], [0.4, 4.0, -1.7, 1.1], [0.0, 3.9, 1.7, 1.1]];
  for (const [x, y, z, r] of lobes) {
    b.add(ico(r * 0.48, 1), { color: '#8a8a8a', tint: 1, p: [x, y, z], s: [1, 0.75, 1], disp: [r * 0.1, 1.3, 5], sway: 0.5 });
    foliage(b, rnd, { center: [x, y, z], radius: r, count: Math.round(r * 24), size: 1.15, squash: 0.75, varyCol: 0.35, sway: 0.55 });
  }
  return b.build();
}

export function acacia() {
  const rnd = mulberry32(404);
  const b = new Builder();
  const BK = '#6a5240';
  b.add(cyl(0.12, 0.24, 3.0, 8, 5), { color: BK, p: [0, 1.5, 0], pre: (g) => bend(g, 0.06, 0, -1.5) });
  branch(b, [0.4, 2.8, 0], [1.9, 4.2, 0.3], 0.1, 0.05, BK);
  branch(b, [0.4, 2.8, 0], [-1.0, 4.3, -0.6], 0.1, 0.05, BK);
  branch(b, [0.4, 2.9, 0], [0.6, 4.4, 1.4], 0.09, 0.04, BK);
  for (const [x, y, z, r] of [[1.9, 4.4, 0.3, 1.8], [-1.0, 4.5, -0.6, 1.6], [0.6, 4.6, 1.4, 1.5], [0.4, 4.7, 0, 1.6]]) {
    foliage(b, rnd, { center: [x, y, z], radius: r, count: Math.round(r * 10), size: 1.0, squash: 0.28, upBlend: 0.6, sway: 0.4 });
  }
  return b.build();
}

export function bush() {
  const rnd = mulberry32(505);
  const b = new Builder();
  for (const [x, y, z, r] of [[0, 0.55, 0, 0.85], [0.7, 0.45, 0.25, 0.65], [-0.6, 0.4, -0.3, 0.6]]) {
    b.add(ico(r * 0.5, 1), { color: '#707070', tint: 1, p: [x, y, z], disp: [r * 0.12, 2, 6], sway: 0.25 });
    foliage(b, rnd, { center: [x, y, z], radius: r, count: Math.round(r * 22), size: 0.8, sway: 0.3, varyCol: 0.25 });
  }
  return b.build(1.4);
}

export function cactus() {
  const b = new Builder();
  const rib = (g) => {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const a = Math.atan2(p[i + 2], p[i]);
      const k = 1 + 0.08 * Math.cos(a * 12);
      p[i] *= k; p[i + 2] *= k;
    }
  };
  b.add(lathe([[0.001, 0], [0.4, 0.02], [0.42, 1.5], [0.4, 3.0], [0.3, 3.35], [0.12, 3.5], [0.001, 3.54]], 24), { color: '#ffffff', tint: 1, pre: rib, smooth: true });
  const arm = (pts, r) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    b.add(new THREE.TubeGeometry(curve, 10, r, 12, false), { color: '#f2f2f2', tint: 1, smooth: true });
    const end = pts[pts.length - 1];
    b.add(sphere(r, 12, 6), { color: '#f2f2f2', tint: 1, p: end });
  };
  arm([[0.2, 1.3, 0], [0.7, 1.4, 0], [0.95, 1.8, 0], [1.0, 2.6, 0]], 0.22);
  arm([[-0.2, 1.9, 0], [-0.6, 2.0, 0.05], [-0.8, 2.3, 0.1], [-0.82, 2.9, 0.1]], 0.19);
  return b.build();
}

// ---------- grond ----------
export function grassTuft() {
  const rnd = mulberry32(606);
  const b = new Builder();
  const blades = 11;
  for (let i = 0; i < blades; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 0.38;
    const h = 0.45 + rnd() * 0.5;
    const w = 0.045 + rnd() * 0.03;
    const lean = 0.15 + rnd() * 0.35;
    const seg = 4;
    const pos = [], uv = [];
    const pt = (t, side) => [side * w * (1 - t * 0.92), t * h, lean * t * t * h];
    for (let s = 0; s < seg; s++) {
      const t0 = s / seg, t1 = (s + 1) / seg;
      const A = pt(t0, -1), B = pt(t0, 1), Cc = pt(t1, -1), D = pt(t1, 1);
      if (s < seg - 1) {
        pos.push(...A, ...B, ...D, ...A, ...D, ...Cc);
        uv.push(0, t0, 1, t0, 1, t1, 0, t0, 1, t1, 0, t1);
      } else {
        const T = [0, h, lean * h];
        pos.push(...A, ...B, ...T);
        uv.push(0, t0, 1, t0, 0.5, 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    b.add(g, { color: i % 3 ? '#ffffff' : '#d9d9d9', tint: 1, leaf: 3, p: [Math.cos(a) * r, 0, Math.sin(a) * r], r: [0, a, 0], sway: 0.35, flatShade: true });
  }
  return b.build(1.0);
}

export function flower() {
  const b = new Builder();
  const stems = [[0, 0, 0.62], [0.22, 0.14, 0.48], [-0.18, 0.18, 0.54]];
  stems.forEach(([x, z, h], i) => {
    b.add(cyl(0.012, 0.016, h, 4, 2), { color: '#4f7a32', p: [x, h / 2, z], sway: 0.35 });
    b.add(card(0.26, 0.26), { color: '#ffffff', tint: 1, leaf: 4, p: [x, h, z], r: [-Math.PI / 2 + 0.25 * (i - 1), i * 1.3, 0], sway: 0.35,
      normals: (g) => { const n = g.attributes.normal.array; for (let k = 0; k < n.length; k += 3) { n[k] = 0; n[k + 1] = 1; n[k + 2] = 0; } } });
  });
  return b.build(0.8);
}

export function rock() {
  return new Builder()
    .add(ico(1, 2), { color: '#ffffff', tint: 1, p: [0, 0.25, 0], s: [1.25, 0.7, 1], disp: [0.32, 1.1, 41, 4] })
    .build();
}

export function boulder() {
  return new Builder()
    .add(ico(2.2, 3), { color: '#ffffff', tint: 1, p: [0, 0.8, 0], s: [1.3, 0.75, 1], disp: [0.75, 0.55, 51, 4] })
    .add(ico(1.1, 2), { color: '#eeeeee', tint: 1, p: [2.2, 0.2, 0.9], s: [1, 0.7, 1], disp: [0.35, 1.0, 52, 3] })
    .build();
}

export function crystal() {
  const b = new Builder();
  const shards = [[0, 0, 2.4, 0], [0.45, 0.25, 1.6, 0.35], [-0.4, 0.15, 1.4, -0.4], [0.1, -0.4, 1.1, 0.25]];
  shards.forEach(([x, z, h, lean], i) => {
    const g = new THREE.CylinderGeometry(0.0, 0.26, h * 0.35, 6, 1, false);
    g.translate(0, h * 0.5 + h * 0.175, 0);
    const body = new THREE.CylinderGeometry(0.26, 0.24, h, 6, 1, true);
    body.translate(0, h * 0.5, 0);
    b.add(body, { color: '#ffffff', tint: 1, glow: 0.25, p: [x, -0.2, z], r: [lean * 0.5, i, lean], flat: true });
    b.add(g, { color: '#ffffff', tint: 1, glow: 0.3, p: [x, -0.2, z], r: [lean * 0.5, i, lean], flat: true });
  });
  return b.build();
}

export function mushroom() {
  const b = new Builder();
  b.add(lathe([[0.001, 0], [0.24, 0.0], [0.2, 0.4], [0.17, 1.1], [0.2, 1.4], [0.001, 1.42]], 12), { color: '#ece3d0', smooth: true });
  b.add(lathe([[0.001, 1.78], [0.45, 1.72], [0.82, 1.52], [0.98, 1.3], [0.9, 1.26], [0.3, 1.36], [0.001, 1.38]], 16), { color: '#ffffff', tint: 1, smooth: true });
  for (const [x, z] of [[0.45, 0.2], [-0.35, -0.35], [-0.1, 0.5], [0.3, -0.5], [-0.6, 0.1]]) {
    const r = Math.hypot(x, z);
    b.add(sphere(0.07, 6, 4), { color: '#f6efe2', p: [x, 1.75 - r * 0.45, z], s: [1, 0.4, 1] });
  }
  return b.build();
}

// ---------- bouwwerken en stenen ----------
export function monolith() {
  return new Builder()
    .add(ico(1, 3), { color: '#ffffff', tint: 1, p: [0, 2.2, 0], s: [0.75, 2.7, 0.45], disp: [0.12, 1.6, 61, 4] })
    .build();
}

export function column() {
  const b = new Builder();
  const flute = (g) => {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const a = Math.atan2(p[i + 2], p[i]);
      const k = 1 - 0.035 * Math.max(0, Math.cos(a * 16));
      p[i] *= k; p[i + 2] *= k;
    }
  };
  b.add(new THREE.BoxGeometry(1.3, 0.35, 1.3), { color: '#ffffff', tint: 1, p: [0, 0.17, 0], flat: true });
  b.add(lathe([[0.55, 0.35], [0.48, 0.5], [0.47, 2.5], [0.42, 4.9], [0.5, 5.1]], 32), { color: '#f2f2f2', tint: 1, pre: flute, smooth: true });
  b.add(new THREE.BoxGeometry(1.2, 0.35, 1.2), { color: '#ffffff', tint: 1, p: [0, 5.3, 0], flat: true });
  return b.build();
}

export function arch() {
  const b = new Builder();
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI - (i / 12) * Math.PI;
    pts.push(new THREE.Vector3(Math.cos(a) * 7, Math.sin(a) * 7.5, Math.sin(i * 1.3) * 0.3));
  }
  b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 1.7, 12, false), { color: '#ffffff', tint: 1, smooth: true,
    post: (g) => displace(g, 0.7, 0.35, 71, [0, 0, 0], 4) });
  b.add(ico(2.6, 2), { color: '#eeeeee', tint: 1, p: [7, 0, 0], s: [1, 0.7, 1], disp: [0.6, 0.6, 72] });
  b.add(ico(2.6, 2), { color: '#eeeeee', tint: 1, p: [-7, 0, 0], s: [1, 0.7, 1], disp: [0.6, 0.6, 73] });
  return b.build();
}

export function lanternPost() {
  const b = new Builder();
  b.add(lathe([[0.001, 0], [0.42, 0], [0.4, 0.2], [0.16, 0.35], [0.13, 1.3], [0.32, 1.45], [0.001, 1.5]], 10), { color: '#8c867c', smooth: true });
  b.add(new THREE.BoxGeometry(0.5, 0.5, 0.5), { color: '#ffffff', tint: 1, glow: 1.4, p: [0, 1.75, 0], flat: true });
  b.add(new THREE.ConeGeometry(0.62, 0.42, 4, 1), { color: '#6d675e', p: [0, 2.2, 0], r: [0, Math.PI / 4, 0], flat: true });
  b.add(sphere(0.09, 8, 6), { color: '#6d675e', p: [0, 2.45, 0] });
  return b.build();
}

// ---------- figuren ----------
export function wanderer() {
  const b = new Builder();
  b.add(lathe([[0.001, 0.02], [0.42, 0.02], [0.36, 0.5], [0.27, 1.0], [0.2, 1.32], [0.11, 1.42], [0.001, 1.44]], 14), { color: '#ffffff', tint: 1, smooth: true });
  b.add(sphere(0.15, 12, 10), { color: '#d9b896', p: [0, 1.56, 0.02] });
  b.add(sphere(0.21, 12, 8, ), { color: '#ffffff', tint: 1, p: [0, 1.6, -0.03], s: [1, 1.05, 1.1], pre: (g) => {
    // kap: verwijder de voorkant zodat het gezicht zichtbaar blijft
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) if (p[i + 2] > 0.12 && p[i + 1] < 0.12) p[i + 2] = 0.12;
  } });
  b.add(cyl(0.022, 0.026, 2.0, 5, 1), { color: '#5a4636', p: [0.38, 1.0, 0.12] });
  b.add(new THREE.BoxGeometry(0.16, 0.2, 0.16), { color: '#ffd28a', glow: 1.8, p: [0.38, 2.08, 0.12], flat: true });
  return b.build();
}

export function bird() {
  const b = new Builder();
  b.add(sphere(0.16, 10, 6), { color: '#ffffff', tint: 1, s: [0.85, 0.75, 2.4] });
  b.add(sphere(0.09, 8, 6), { color: '#ffffff', tint: 1, p: [0, 0.05, 0.36] });
  const wing = (side) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.2, side * 0.6, 0.03, 0.12, side * 0.6, 0.03, -0.12,
      0, 0, 0.2, side * 0.6, 0.03, -0.12, 0, 0, -0.15,
      side * 0.6, 0.03, 0.12, side * 1.25, 0.0, -0.08, side * 0.6, 0.03, -0.12,
    ], 3));
    return g;
  };
  b.add(wing(1), { color: '#eeeeee', tint: 1, flap: 0.6 });
  b.add(wing(-1), { color: '#eeeeee', tint: 1, flap: 0.6 });
  return b.build();
}

export function skyLantern() {
  return new Builder()
    .add(lathe([[0.001, 0], [0.22, 0], [0.3, 0.2], [0.33, 0.45], [0.28, 0.62], [0.001, 0.64]], 10), { color: '#ffffff', tint: 1, glow: 1.0, smooth: true })
    .build();
}
