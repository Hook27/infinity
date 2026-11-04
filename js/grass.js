// Dicht gras rond de camera. Het veld is een raster van plukjes dat met de camera meeschuift:
// elke rastercel hoort vast bij één instance-index (torus-indeling), dus alleen cellen die net
// in beeld komen worden opnieuw geplaatst. Aan de rand krimpt het gras weg in de shader.
import * as THREE from 'three';
import { sampleWorld, origin, biomeIndex } from './world.js';
import { hash2 } from './noise.js';
import { grassTuft } from './models.js';

const COLORS = [
  ['#a99a5c', '#b8a466', '#9c8f55'],   // woestijn: droog
  ['#5c8c34', '#6a9a3a', '#4f7f2e'],   // weide
  ['#6d9a42', '#7aa64a', '#62903c'],   // bloesem
  ['#9a8a3e', '#a8923f', '#8a7a36'],   // herfst: goudgeel
  ['#7f8f78', '#8a9a84'],              // sneeuw: schaars, grijsgroen
].map((a) => a.map((h) => new THREE.Color(h)));
const DENSITY = [0.25, 1, 0.95, 0.85, 0.15];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _w = { h: 0, t: 0 };

export class GrassField {
  constructor(scene, mat, { radius, spacing }) {
    this.spacing = spacing;
    this.N = Math.ceil((radius * 2) / spacing);
    const n = this.N * this.N;
    this.mesh = new THREE.InstancedMesh(grassTuft(), mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.array.fill(0);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.ci = new Int32Array(n).fill(-2147483647);
    this.cj = new Int32Array(n).fill(-2147483647);
    this.last = { i: NaN, j: NaN };
  }

  placeCell(slot, gi, gj) {
    const S = this.spacing;
    this.ci[slot] = gi; this.cj[slot] = gj;
    const x = (gi + hash2(gi, gj, 31)) * S;
    const z = (gj + hash2(gi, gj, 32)) * S;
    sampleWorld(x, z, _w);
    const h = _w.h;
    const a = this.mesh.instanceMatrix.array;
    let ok = h > 0.35 && _w.t < 0.8;
    const b = biomeIndex(_w.t + (hash2(gi, gj, 33) - 0.5) * 0.08);
    if (ok && hash2(gi, gj, 34) > DENSITY[b]) ok = false;
    if (ok) {
      // geen gras op steile rots of sneeuwkappen
      const hx = sampleWorld(x + 1, z, _w).h, hz = sampleWorld(x, z + 1, _w).h;
      const slope = Math.hypot(hx - h, hz - h);
      if (slope > 0.55) ok = false;
      if (h > 70 || b === 4) ok = false;
    }
    if (!ok) { a.fill(0, slot * 16, slot * 16 + 16); return; }
    const r = hash2(gi, gj, 35);
    const sc = 0.75 + r * 0.7;
    _p.set(x - origin.x, h - 0.04, z - origin.z);
    _e.set((hash2(gi, gj, 36) - 0.5) * 0.15, r * Math.PI * 2, (hash2(gi, gj, 37) - 0.5) * 0.15);
    _q.setFromEuler(_e);
    _s.set(sc, sc * (0.8 + hash2(gi, gj, 38) * 0.6), sc);
    _m.compose(_p, _q, _s);
    _m.toArray(a, slot * 16);
    const pal = COLORS[b];
    pal[Math.floor(hash2(gi, gj, 39) * pal.length)].toArray(this.mesh.instanceColor.array, slot * 3);
  }

  // camX/camZ: echte wereldcoördinaten
  update(camX, camZ) {
    const S = this.spacing, N = this.N;
    const i0 = Math.floor(camX / S) - (N >> 1);
    const j0 = Math.floor(camZ / S) - (N >> 1);
    if (i0 === this.last.i && j0 === this.last.j) return;
    this.last.i = i0; this.last.j = j0;
    let changed = false;
    for (let dj = 0; dj < N; dj++) {
      const gj = j0 + dj;
      const sj = ((gj % N) + N) % N;
      for (let di = 0; di < N; di++) {
        const gi = i0 + di;
        const slot = (((gi % N) + N) % N) + sj * N;
        if (this.ci[slot] !== gi || this.cj[slot] !== gj) { this.placeCell(slot, gi, gj); changed = true; }
      }
    }
    if (changed) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  rebase(dx, dz) {
    const a = this.mesh.instanceMatrix.array;
    for (let i = 0; i < this.ci.length; i++) {
      if (a[i * 16 + 15] !== 0) { a[i * 16 + 12] -= dx; a[i * 16 + 14] -= dz; }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
