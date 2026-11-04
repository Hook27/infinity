// Procedurele low-poly modellen. Elk model is één samengevoegde geometrie met attributen:
// aCol (basiskleur), aTint (hoeveel de instance-kleur meetelt), aGlow (emissief), aSway (wind/animatie).
import * as THREE from 'three';
import { hash2 } from './noise.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _col = new THREE.Color();

class Builder {
  constructor() { this.parts = []; }

  add(geo, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    const p = o.p || [0, 0, 0], r = o.r || [0, 0, 0], s = o.s || [1, 1, 1];
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    _m.compose(new THREE.Vector3(...p), _q, new THREE.Vector3(...(typeof s === 'number' ? [s, s, s] : s)));
    if (o.jitter) {
      const pos = g.attributes.position;
      const seed = o.seed || 1;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const kx = Math.round(x * 1000), ky = Math.round(y * 1000), kz = Math.round(z * 1000);
        const j = o.jitter;
        pos.setXYZ(i,
          x + (hash2(kx + kz * 7, ky, seed) - 0.5) * j,
          y + (hash2(ky + kx * 3, kz, seed + 1) - 0.5) * j,
          z + (hash2(kz + ky * 5, kx, seed + 2) - 0.5) * j);
      }
    }
    g.applyMatrix4(_m);
    this.parts.push({ g, o });
    return this;
  }

  build(swayRef) {
    let n = 0;
    for (const { g } of this.parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const tint = new Float32Array(n);
    const glow = new Float32Array(n);
    const sway = new Float32Array(n);
    let maxY = 0.001;
    for (const { g } of this.parts) {
      const a = g.attributes.position.array;
      for (let i = 1; i < a.length; i += 3) maxY = Math.max(maxY, a[i]);
    }
    const ref = swayRef || maxY;
    let k = 0;
    for (const { g, o } of this.parts) {
      const a = g.attributes.position.array;
      const cnt = a.length / 3;
      _col.set(o.color || '#ffffff');
      const shadeVar = o.vary || 0;
      for (let i = 0; i < cnt; i++, k++) {
        pos[k * 3] = a[i * 3];
        pos[k * 3 + 1] = a[i * 3 + 1];
        pos[k * 3 + 2] = a[i * 3 + 2];
        const v = 1 + (shadeVar ? (hash2(Math.floor(i / 3), k, 5) - 0.5) * shadeVar : 0);
        col[k * 3] = _col.r * v;
        col[k * 3 + 1] = _col.g * v;
        col[k * 3 + 2] = _col.b * v;
        tint[k] = o.tint || 0;
        glow[k] = o.glow || 0;
        let sw = 0;
        if (o.sway) sw = o.sway * Math.pow(Math.min(Math.max(a[i * 3 + 1] / ref, 0), 1), 1.5);
        if (o.flap) sw = Math.abs(a[i * 3]) * o.flap;
        if (o.leg) sw = o.leg;
        sway[k] = sw;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    geo.computeBoundingSphere();
    return geo;
  }
}

const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const dode = (r) => new THREE.DodecahedronGeometry(r, 0);
const cyl = (rt, rb, h, s = 6, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s, 1);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const octa = (r) => new THREE.OctahedronGeometry(r, 0);

const TRUNK = '#6b4a35';

export function treeRound() {
  return new Builder()
    .add(cyl(0.18, 0.3, 3.2, 5), { color: TRUNK, p: [0, 1.6, 0], sway: 0.15 })
    .add(ico(1.6), { color: '#ffffff', tint: 1, p: [0, 3.8, 0], s: [1, 0.9, 1], jitter: 0.35, seed: 3, sway: 0.5, vary: 0.25 })
    .add(ico(1.15), { color: '#f2f2f2', tint: 1, p: [0.9, 3.2, 0.4], jitter: 0.3, seed: 4, sway: 0.5, vary: 0.25 })
    .add(ico(1.0), { color: '#e6e6e6', tint: 1, p: [-0.8, 3.4, -0.5], jitter: 0.3, seed: 5, sway: 0.5, vary: 0.25 })
    .add(ico(0.9), { color: '#ffffff', tint: 1, p: [0.1, 4.9, 0.2], jitter: 0.25, seed: 6, sway: 0.6, vary: 0.25 })
    .build();
}

export function pine() {
  return new Builder()
    .add(cyl(0.15, 0.25, 1.6, 5), { color: TRUNK, p: [0, 0.8, 0] })
    .add(cone(1.7, 2.6, 7), { color: '#ffffff', tint: 1, p: [0, 2.4, 0], sway: 0.35, vary: 0.2 })
    .add(cone(1.3, 2.3, 7), { color: '#f4f4f4', tint: 1, p: [0, 3.6, 0], r: [0, 0.4, 0], sway: 0.35, vary: 0.2 })
    .add(cone(0.9, 2.0, 7), { color: '#ececec', tint: 1, p: [0, 4.7, 0], r: [0, 0.8, 0], sway: 0.35, vary: 0.2 })
    .add(cone(0.5, 1.2, 6), { color: '#f8fbff', tint: 0.25, p: [0, 5.6, 0], sway: 0.35 })
    .build(6);
}

export function blossomTree() {
  const b = new Builder()
    .add(cyl(0.16, 0.32, 2.4, 5), { color: '#5a3a35', p: [0, 1.2, 0], r: [0, 0, 0.12] })
    .add(cyl(0.1, 0.16, 1.8, 5), { color: '#5a3a35', p: [0.55, 2.6, 0.1], r: [0, 0, -0.7] })
    .add(cyl(0.1, 0.16, 1.6, 5), { color: '#5a3a35', p: [-0.55, 2.5, -0.1], r: [0.2, 0, 0.8] });
  const puffs = [[0, 3.6, 0, 1.3], [1.3, 3.2, 0.3, 1.0], [-1.2, 3.1, -0.2, 1.0], [0.4, 3.0, 1.1, 0.9], [-0.3, 3.2, -1.1, 0.9], [0.2, 4.3, -0.2, 0.8]];
  puffs.forEach(([x, y, z, r], i) => b.add(ico(r * 1.05), { color: i % 2 ? '#ffffff' : '#f3e9ee', tint: 1, p: [x, y, z], jitter: 0.3, seed: 10 + i, sway: 0.5, vary: 0.2 }));
  return b.build();
}

export function acacia() {
  return new Builder()
    .add(cyl(0.12, 0.22, 3.4, 5), { color: '#7a5a3c', p: [0, 1.7, 0], r: [0, 0, 0.15] })
    .add(cyl(0.08, 0.12, 1.6, 5), { color: '#7a5a3c', p: [0.6, 3.4, 0], r: [0, 0, -0.8] })
    .add(cyl(1.0, 2.0, 0.55, 7), { color: '#ffffff', tint: 1, p: [0.3, 3.9, 0], jitter: 0.2, seed: 21, sway: 0.4, vary: 0.2 })
    .add(cyl(0.7, 1.5, 0.45, 7), { color: '#eeeeee', tint: 1, p: [1.3, 3.5, 0.4], jitter: 0.2, seed: 22, sway: 0.4, vary: 0.2 })
    .build();
}

export function cactus() {
  return new Builder()
    .add(cyl(0.38, 0.42, 3.4, 7), { color: '#ffffff', tint: 1, p: [0, 1.7, 0], vary: 0.15 })
    .add(new THREE.SphereGeometry(0.38, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), { color: '#ffffff', tint: 1, p: [0, 3.4, 0] })
    .add(cyl(0.22, 0.24, 1.0, 6), { color: '#f0f0f0', tint: 1, p: [0.6, 1.6, 0], r: [0, 0, Math.PI / 2] })
    .add(cyl(0.22, 0.24, 1.2, 6), { color: '#f0f0f0', tint: 1, p: [1.0, 2.2, 0] })
    .add(cyl(0.2, 0.22, 0.8, 6), { color: '#f0f0f0', tint: 1, p: [-0.5, 2.2, 0], r: [0, 0, Math.PI / 2] })
    .add(cyl(0.2, 0.22, 0.9, 6), { color: '#f0f0f0', tint: 1, p: [-0.8, 2.6, 0] })
    .add(ico(0.16), { color: '#ff7aa8', glow: 0.6, p: [0, 3.55, 0] })
    .build();
}

export function grass() {
  const b = new Builder();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + i;
    const r = 0.15 + (i % 3) * 0.12;
    const h = 0.7 + (i % 4) * 0.22;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.07, 0, 0, 0.07, 0, 0, 0, h, 0.12]), 3));
    b.add(tri, { color: i % 2 ? '#ffffff' : '#d8d8d8', tint: 1, p: [Math.cos(a) * r, 0, Math.sin(a) * r], r: [0, a, 0], sway: 0.55 });
  }
  return b.build(1.4);
}

export function flower() {
  const b = new Builder();
  const stems = [[0, 0, 0.75], [0.25, 0.15, 0.55], [-0.2, 0.2, 0.62]];
  stems.forEach(([x, z, h]) => {
    b.add(new THREE.CylinderGeometry(0.02, 0.025, h, 3, 1, true), { color: '#5d8f3a', p: [x, h / 2, z], sway: 0.4 });
    b.add(octa(0.13), { color: '#ffffff', tint: 1, glow: 0.12, p: [x, h + 0.04, z], s: [1, 0.55, 1], sway: 0.4 });
  });
  return b.build(0.9);
}

export function bush() {
  return new Builder()
    .add(ico(0.75), { color: '#ffffff', tint: 1, p: [0, 0.45, 0], jitter: 0.25, seed: 31, sway: 0.25, vary: 0.25 })
    .add(ico(0.55), { color: '#e8e8e8', tint: 1, p: [0.6, 0.35, 0.2], jitter: 0.2, seed: 32, sway: 0.25, vary: 0.25 })
    .add(ico(0.5), { color: '#f4f4f4', tint: 1, p: [-0.5, 0.3, -0.3], jitter: 0.2, seed: 33, sway: 0.25, vary: 0.25 })
    .build(1.2);
}

export function rock() {
  return new Builder()
    .add(dode(1), { color: '#ffffff', tint: 1, p: [0, 0.3, 0], s: [1.2, 0.75, 1], jitter: 0.45, seed: 41, vary: 0.2 })
    .build();
}

export function boulder() {
  return new Builder()
    .add(ico(2.2, 1), { color: '#ffffff', tint: 1, p: [0, 0.9, 0], s: [1.3, 0.8, 1], jitter: 0.9, seed: 51, vary: 0.18 })
    .add(dode(1.2), { color: '#f0f0f0', tint: 1, p: [2.0, 0.3, 0.7], jitter: 0.4, seed: 52, vary: 0.18 })
    .build();
}

export function crystal() {
  const b = new Builder();
  const shards = [[0, 0, 0, 2.6, 0], [0.5, 0.2, 0.3, 1.7, 0.35], [-0.45, -0.1, 0.2, 1.5, -0.4], [0.1, 0.4, -0.45, 1.2, 0.25], [-0.2, -0.4, -0.3, 1.0, -0.3]];
  shards.forEach(([x, z, , h, lean], i) => {
    b.add(octa(0.35), { color: '#ffffff', tint: 1, glow: 0.55, p: [x, h * 0.45, z], s: [1, h * 1.5, 1], r: [lean * 0.6, i, lean], vary: 0.3 });
  });
  return b.build();
}

export function mushroom() {
  return new Builder()
    .add(cyl(0.22, 0.32, 1.6, 6), { color: '#f2ead8', p: [0, 0.8, 0] })
    .add(new THREE.SphereGeometry(1.0, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), { color: '#ffffff', tint: 1, glow: 0.2, p: [0, 1.5, 0], s: [1, 0.7, 1], vary: 0.15 })
    .add(ico(0.12), { color: '#fff6e8', glow: 0.5, p: [0.45, 2.05, 0.2] })
    .add(ico(0.1), { color: '#fff6e8', glow: 0.5, p: [-0.35, 2.0, -0.35] })
    .add(ico(0.09), { color: '#fff6e8', glow: 0.5, p: [-0.1, 2.15, 0.45] })
    .build();
}

export function monolith() {
  return new Builder()
    .add(box(1.3, 5, 0.75), { color: '#ffffff', tint: 1, p: [0, 2.3, 0], jitter: 0.12, seed: 61, vary: 0.12 })
    .add(box(0.12, 3.2, 0.06), { color: '#8ff0ff', glow: 1.1, p: [0, 2.6, 0.39] })
    .add(box(0.5, 0.1, 0.06), { color: '#8ff0ff', glow: 1.1, p: [0, 3.4, 0.39] })
    .build();
}

export function column() {
  return new Builder()
    .add(box(1.3, 0.35, 1.3), { color: '#ffffff', tint: 1, p: [0, 0.17, 0] })
    .add(cyl(0.42, 0.48, 5, 8), { color: '#f2f2f2', tint: 1, p: [0, 2.7, 0], vary: 0.08 })
    .add(box(1.2, 0.35, 1.2), { color: '#ffffff', tint: 1, p: [0, 5.35, 0] })
    .build();
}

export function arch() {
  return new Builder()
    .add(new THREE.TorusGeometry(7, 1.5, 5, 12, Math.PI), { color: '#ffffff', tint: 1, p: [0, 0, 0], jitter: 0.6, seed: 71, vary: 0.15 })
    .add(dode(2.2), { color: '#eeeeee', tint: 1, p: [7, 0, 0], s: [1, 0.6, 1], jitter: 0.5, seed: 72 })
    .add(dode(2.2), { color: '#eeeeee', tint: 1, p: [-7, 0, 0], s: [1, 0.6, 1], jitter: 0.5, seed: 73 })
    .build();
}

export function lanternPost() {
  return new Builder()
    .add(box(0.6, 0.3, 0.6), { color: '#8c8478', p: [0, 0.15, 0] })
    .add(cyl(0.12, 0.15, 1.6, 6), { color: '#8c8478', p: [0, 1.0, 0] })
    .add(box(0.55, 0.5, 0.55), { color: '#ffffff', tint: 1, glow: 1.6, p: [0, 2.05, 0] })
    .add(cone(0.6, 0.45, 4), { color: '#5d554c', p: [0, 2.52, 0], r: [0, Math.PI / 4, 0] })
    .build();
}

export function colossus() {
  // een eeuwenoud geknield stenen beeld
  const S = '#ffffff';
  return new Builder()
    .add(box(9, 3, 7), { color: S, tint: 1, p: [0, 1.5, 0], jitter: 0.5, seed: 81 })
    .add(box(4.4, 7, 3.4), { color: S, tint: 1, p: [0, 6.2, -1.6], r: [0.12, 0, 0], jitter: 0.4, seed: 82 })
    .add(box(7.6, 2.0, 3.2), { color: S, tint: 1, p: [0, 9.6, -1.2], jitter: 0.4, seed: 83 })
    .add(box(1.6, 6.4, 1.6), { color: S, tint: 1, p: [3.6, 6.6, 0.2], r: [-0.35, 0, 0.12], jitter: 0.3, seed: 84 })
    .add(box(1.6, 6.4, 1.6), { color: S, tint: 1, p: [-3.6, 6.6, 0.2], r: [-0.35, 0, -0.12], jitter: 0.3, seed: 85 })
    .add(box(2.8, 3.4, 2.8), { color: S, tint: 1, p: [0, 12.2, -0.9], r: [0.25, 0.1, 0], jitter: 0.3, seed: 86 })
    .add(box(2.0, 0.3, 0.2), { color: '#9ff3ff', glow: 1.6, p: [0, 12.5, 0.55], r: [0.25, 0.1, 0] })
    .add(cyl(0.2, 1.2, 2.4, 5), { color: '#e0e0e0', tint: 1, p: [0, 14.6, -1.2], r: [0.25, 0.1, 0] })
    .build();
}

export function ring() {
  return new Builder()
    .add(new THREE.TorusGeometry(4.2, 0.65, 6, 18), { color: '#ffffff', tint: 1, p: [0, 5.0, 0], jitter: 0.2, seed: 91 })
    .add(new THREE.TorusGeometry(3.45, 0.12, 4, 24), { color: '#b9a4ff', glow: 1.4, p: [0, 5.0, 0] })
    .add(box(2.4, 1.0, 1.8), { color: '#e8e8e8', tint: 1, p: [0, 0.4, 0], jitter: 0.2, seed: 92 })
    .add(octa(0.6), { color: '#d7c8ff', glow: 1.8, p: [0, 5.0, 0], s: [1, 1.6, 1] })
    .build();
}

export function wanderer() {
  return new Builder()
    .add(cone(0.45, 1.45, 7), { color: '#ffffff', tint: 1, p: [0, 0.72, 0], vary: 0.15 })
    .add(ico(0.22, 0), { color: '#e9d2b8', p: [0, 1.55, 0] })
    .add(cyl(0.02, 0.62, 0.12, 8), { color: '#3e3530', p: [0, 1.66, 0] })
    .add(cone(0.24, 0.5, 6), { color: '#3e3530', p: [0, 1.95, 0] })
    .add(cyl(0.03, 0.03, 2.0, 4), { color: '#5a4636', p: [0.42, 1.0, 0.1] })
    .add(box(0.2, 0.24, 0.2), { color: '#ffd28a', glow: 2.0, p: [0.42, 2.05, 0.1] })
    .build();
}

// Titan als aparte functie met eigen schaal (eenheid = beenhoogte)
export function titanBody() {
  const S = '#ffffff';
  const b = new Builder();
  // benen: van 0 tot 0.5 (heup op 0.5)
  b.add(cyl(0.05, 0.035, 0.5, 6), { color: S, tint: 1, p: [0.09, 0.25, 0], leg: 1 });
  b.add(cyl(0.05, 0.035, 0.5, 6), { color: S, tint: 1, p: [-0.09, 0.25, 0], leg: -1 });
  // romp en kop
  b.add(box(0.3, 0.26, 0.17), { color: S, tint: 1, p: [0, 0.64, 0], jitter: 0.02, seed: 101 });
  b.add(box(0.22, 0.08, 0.14), { color: S, tint: 1, p: [0, 0.5, 0] });
  b.add(dode(0.08), { color: S, tint: 1, p: [0, 0.83, 0.02] });
  b.add(box(0.1, 0.018, 0.02), { color: '#ffe9a8', glow: 2.2, p: [0, 0.84, 0.085] });
  // armen
  b.add(cyl(0.035, 0.025, 0.42, 5), { color: S, tint: 1, p: [0.19, 0.55, 0.0], r: [0, 0, 0.08] });
  b.add(cyl(0.035, 0.025, 0.42, 5), { color: S, tint: 1, p: [-0.19, 0.55, 0.0], r: [0, 0, -0.08] });
  // stenen 'mos'-plateau op de schouders met een boompje
  b.add(cone(0.035, 0.09, 5), { color: '#5f9a48', p: [0.1, 0.81, -0.03] });
  return b.build(1);
}

export function bird() {
  const b = new Builder();
  const wing = (side) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.25, side * 1.1, 0, -0.05, 0, 0, -0.25]), 3));
    return g;
  };
  b.add(octa(0.16), { color: '#ffffff', tint: 1, s: [0.8, 0.7, 2.2] });
  b.add(wing(1), { color: '#f0f0f0', tint: 1, flap: 0.6 });
  b.add(wing(-1), { color: '#f0f0f0', tint: 1, flap: 0.6 });
  return b.build();
}

export function cloud() {
  const b = new Builder();
  const puffs = [[0, 0, 0, 9], [9, -1.5, 2, 7], [-9, -1, -1, 7.5], [4, 4, -2, 6.5], [-4, 3, 3, 6], [15, -3, -1, 5], [-15, -3, 2, 4.5]];
  puffs.forEach(([x, y, z, r], i) => b.add(ico(r, 1), { color: '#ffffff', tint: 1, p: [x, y, z], s: [1, 0.72, 1], jitter: r * 0.25, seed: 120 + i, vary: 0.08 }));
  return b.build();
}

export function island() {
  const b = new Builder();
  b.add(cone(14, 22, 9), { color: '#8a7466', p: [0, -11, 0], r: [Math.PI, 0, 0], jitter: 4.5, seed: 131, vary: 0.25 });
  b.add(cone(7, 16, 7), { color: '#76655c', p: [5, -17, 3], r: [Math.PI, 0.4, 0.15], jitter: 2.5, seed: 134, vary: 0.25 });
  b.add(cone(6, 12, 7), { color: '#9a8070', p: [-6, -13, -4], r: [Math.PI, 0.9, -0.2], jitter: 2, seed: 135, vary: 0.25 });
  b.add(cyl(0.9, 0.9, 30, 6), { color: '#bfe8ff', glow: 0.5, p: [13.2, -14, 2], s: [1, 1, 0.35] });
  b.add(cyl(14.5, 14, 2.2, 9), { color: '#7fb85a', p: [0, 0.6, 0], jitter: 1.2, seed: 132, vary: 0.2 });
  b.add(dode(3.4), { color: '#8a8580', p: [4, 2, -3], jitter: 1, seed: 133 });
  for (let i = 0; i < 5; i++) {
    const a = i * 1.7, r = 4 + (i % 3) * 3;
    b.add(cyl(0.25, 0.4, 3, 5), { color: TRUNK, p: [Math.cos(a) * r, 2.6, Math.sin(a) * r] });
    b.add(ico(2.2), { color: i % 2 ? '#e88fb8' : '#5fa045', p: [Math.cos(a) * r, 5.2, Math.sin(a) * r], jitter: 0.6, seed: 140 + i, vary: 0.2 });
  }
  // een klein heiligdom met licht
  b.add(box(1.4, 2.2, 1.4), { color: '#efe6d8', p: [-5, 2.6, 4] });
  b.add(cone(1.4, 1.4, 4), { color: '#b0533c', p: [-5, 4.4, 4], r: [0, Math.PI / 4, 0] });
  b.add(box(0.5, 0.7, 0.1), { color: '#ffd28a', glow: 2.0, p: [-5, 2.4, 4.72] });
  return b.build();
}

export function skyLantern() {
  return new Builder()
    .add(cyl(0.32, 0.24, 0.62, 6), { color: '#ffffff', tint: 1, glow: 1.0 })
    .build();
}
