// Chunk-gebaseerd oneindig terrein + deterministische verspreiding van objecten.
import * as THREE from 'three';
import { sampleWorld, origin, forestAt, biomeIndex } from './world.js';
import { mulberry32, seedFor, hash2 } from './noise.js';
import * as M from './models.js';

export const CHUNK = 48;
const SEG = 24;
const CELL = CHUNK / SEG;
const VN = SEG + 1;

// ---------- Instance-pools ----------
// Eén InstancedMesh per objecttype. Chunks krijgen 'pages' van 8 instances uit een vrije lijst,
// en mesh.count volgt de hoogst gebruikte page, zodat er nooit lege slots getekend worden.
class Pool {
  constructor(scene, geo, mat, cap, perChunk) {
    // kleine pages voor zeldzame objecten, grotere voor gras en bloemen
    const PS = (this.PS = Math.max(1, Math.min(8, Math.floor(perChunk / 6))));
    this.pages = Math.ceil(cap / PS);
    this.cap = this.pages * PS;
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.array.fill(0);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(1), 3);
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.used = new Uint8Array(this.pages);
    this.free = [];
    for (let i = this.pages - 1; i >= 0; i--) this.free.push(i);
    this.per = perChunk;
    this.stM = new Float32Array(perChunk * 16);
    this.stC = new Float32Array(perChunk * 3);
    this.n = 0;
  }
  begin() { this.n = 0; }
  stage(m4, color) {
    if (this.n >= this.per) return false;
    m4.toArray(this.stM, this.n * 16);
    color.toArray(this.stC, this.n * 3);
    this.n++;
    return true;
  }
  commit() {
    const PS = this.PS;
    const pages = [];
    const M = this.mesh.instanceMatrix, Cc = this.mesh.instanceColor;
    let k = 0;
    while (k < this.n && this.free.length) {
      const pg = this.free.pop();
      this.used[pg] = 1;
      pages.push(pg);
      const base = pg * PS;
      for (let j = 0; j < PS; j++, k++) {
        const i = base + j;
        if (k < this.n) {
          M.array.set(this.stM.subarray(k * 16, k * 16 + 16), i * 16);
          Cc.array.set(this.stC.subarray(k * 3, k * 3 + 3), i * 3);
        } else M.array.fill(0, i * 16, i * 16 + 16);
      }
      M.addUpdateRange(base * 16, PS * 16);
      Cc.addUpdateRange(base * 3, PS * 3);
    }
    if (pages.length) { M.needsUpdate = true; Cc.needsUpdate = true; this.recount(); }
    return pages;
  }
  release(pages) {
    if (!pages.length) return;
    const PS = this.PS;
    const M = this.mesh.instanceMatrix;
    for (const pg of pages) {
      this.used[pg] = 0;
      M.array.fill(0, pg * PS * 16, (pg + 1) * PS * 16);
      M.addUpdateRange(pg * PS * 16, PS * 16);
      this.free.push(pg);
    }
    M.needsUpdate = true;
    this.free.sort((a, b) => b - a);
    this.recount();
  }
  recount() {
    let h = this.pages;
    while (h > 0 && !this.used[h - 1]) h--;
    this.mesh.count = h * this.PS;
  }
  shift(dx, dz) {
    const a = this.mesh.instanceMatrix.array;
    for (let i = 0; i < this.cap; i++) {
      if (a[i * 16 + 15] !== 0) { a[i * 16 + 12] -= dx; a[i * 16 + 14] -= dz; }
    }
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const C = (h) => new THREE.Color(h);
const P = (arr) => arr.map((a) => (a ? a.map(C) : null));

// Bioomindex: 0 woestijn, 1 weide, 2 bloesem, 3 herfst, 4 sneeuw
const TYPES = {
  grass: { frac: 0.65, model: M.grass, per: 120, tries: 150, dens: [0.3, 1, 0.95, 0.75, 0.12], slope: 0.45, scale: [0.9, 1.7], sink: 0.05, double: true,
    colors: P([['#c9a65a', '#d8b56a'], ['#7cc04f', '#91cf55', '#6aab45'], ['#a8d66a', '#bfe07a'], ['#d6a243', '#c98a3a', '#e0b85a'], ['#b7c9b0']]) },
  flower: { frac: 0.6, model: M.flower, per: 44, tries: 60, dens: [0.04, 0.75, 1, 0.25, 0], slope: 0.4, scale: [0.9, 1.4], sink: 0.02, double: true,
    colors: P([['#ff7aa8'], ['#ff6b8b', '#ffd34e', '#ffffff', '#9b7bff', '#ff8a3d'], ['#ff9ac8', '#ffffff', '#ffd1e8', '#c7a0ff'], ['#ffb347', '#ff6b4a'], null]) },
  tree: { frac: 0.45, model: M.treeRound, per: 28, tries: 60, dens: [0, 0.85, 0.2, 0.65, 0], slope: 0.38, scale: [0.9, 1.6], sink: 0.3, forest: -0.05,
    colors: P([null, ['#4f9a3c', '#6cb043', '#3d7d3a', '#5aa640'], ['#7cbf55'], ['#e0662c', '#f2a33a', '#c0392b', '#e8c547', '#d9531e'], null]) },
  pine: { frac: 0.5, model: M.pine, per: 28, tries: 60, dens: [0, 0.18, 0, 0.35, 1], slope: 0.5, scale: [0.9, 1.9], sink: 0.3, forest: -0.15,
    colors: P([null, ['#2f6b46', '#3a7a4c'], null, ['#4b6b3a', '#5c7a3c'], ['#2f5d50', '#3c6e5e', '#2a5248']]) },
  blossom: { frac: 0.5, model: M.blossomTree, per: 24, tries: 50, dens: [0, 0.06, 1, 0, 0], slope: 0.38, scale: [0.9, 1.5], sink: 0.3, forest: -0.1,
    colors: P([null, ['#ffc4dd'], ['#f7a8c8', '#ffc4dd', '#f48fb1', '#fff0f5', '#e7a0ff'], null, null]) },
  acacia: { frac: 0.25, model: M.acacia, per: 8, tries: 10, dens: [0.35, 0.08, 0, 0, 0], slope: 0.35, scale: [1, 1.6], sink: 0.2,
    colors: P([['#8aa04a', '#9aa84e'], ['#6f9a3e'], null, null, null]) },
  cactus: { frac: 0.25, model: M.cactus, per: 10, tries: 12, dens: [0.65, 0, 0, 0, 0], slope: 0.35, scale: [0.8, 1.5], sink: 0.2,
    colors: P([['#5e8c4a', '#6a9a50', '#4f7d44'], null, null, null, null]) },
  bush: { frac: 0.55, model: M.bush, per: 22, tries: 28, dens: [0.3, 0.6, 0.6, 0.75, 0.25], slope: 0.45, scale: [0.8, 1.6], sink: 0.15,
    colors: P([['#9aa24e', '#a8a058'], ['#4c8f3a', '#5ea844'], ['#e79abf', '#7cbf55'], ['#c65a2a', '#b8862f'], ['#3c6e5e']]) },
  rock: { frac: 0.6, model: M.rock, per: 16, tries: 18, dens: [0.8, 0.45, 0.4, 0.5, 0.6], slope: 1.2, scale: [0.6, 1.8], sink: 0.2,
    colors: P([['#c47a52', '#b5694a', '#d29266'], ['#9a958c', '#8a8780'], ['#b0a3ad', '#9d9399'], ['#8c7666', '#7a6a5e'], ['#8a94aa', '#a8b3c6']]) },
  boulder: { frac: 0.75, model: M.boulder, per: 3, tries: 3, dens: [0.6, 0.3, 0.3, 0.35, 0.5], slope: 0.8, scale: [0.8, 1.6], sink: 0.6,
    colors: P([['#bf7550'], ['#8f8b84'], ['#a59aa2'], ['#86705f'], ['#8590a6']]) },
  crystal: { frac: 0.35, model: M.crystal, per: 8, tries: 9, dens: [0.12, 0, 0.05, 0, 0.75], slope: 0.9, scale: [0.8, 2.2], sink: 0.4, tilt: 0.25,
    colors: P([['#ff7ac8', '#ffa0d8'], null, ['#c7a0ff'], null, ['#7fe0ff', '#b48cff', '#9ff0ff', '#7fb0ff']]) },
  mushroom: { frac: 0.4, model: M.mushroom, per: 10, tries: 12, dens: [0, 0.3, 0.1, 1, 0], slope: 0.4, scale: [0.6, 2.2], sink: 0.1,
    colors: P([null, ['#4ff0d0', '#6fd8ff'], ['#ff9ad0'], ['#d9412b', '#e8642c', '#c7341f'], null]) },
  lantern: { frac: 0.4, model: M.lanternPost, per: 6, tries: 6, dens: [0, 0.08, 0.7, 0.18, 0.05], slope: 0.3, scale: [1, 1.3], sink: 0.1,
    colors: P([null, ['#ffd28a'], ['#ffb0d0', '#ffd28a'], ['#ffb46a'], ['#bfe8ff']]) },
  monolith: { frac: 0.25, model: M.monolith, per: 12, tries: 0, colors: null },
  column: { frac: 0.3, model: M.column, per: 10, tries: 0, colors: null },
  arch: { frac: 0.15, model: M.arch, per: 1, tries: 0, colors: null },
  colossus: { frac: 0.12, model: M.colossus, per: 1, tries: 0, colors: null },
  ring: { frac: 0.12, model: M.ring, per: 1, tries: 0, colors: null },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _w = { h: 0, t: 0 };

export class World {
  constructor(scene, terrainMat, propMat, propMatDouble, opts) {
    this.scene = scene;
    this.mat = terrainMat;
    this.radius = opts.radius;
    this.density = opts.density;
    const R = this.radius + 1;
    this.slots = 0;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) if (x * x + z * z <= R * R + R) this.slots++;
    this.slots += 8;

    this.pools = {};
    for (const [name, t] of Object.entries(TYPES)) {
      const per = Math.max(1, Math.round(t.per * (t.tries ? this.density : 1)));
      this.pools[name] = new Pool(scene, t.model(), t.double ? propMatDouble : propMat, Math.ceil(this.slots * per * t.frac) + 16, per);
    }

    // gedeelde index-buffer
    const idx = [];
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * VN + i, b = a + 1, c = a + VN, d = c + 1;
        if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    this.index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    this.chunks = new Map();
    this.meshPool = [];
    this.queue = [];
    this.center = { x: 1e9, z: 1e9 };
  }

  key(cx, cz) { return cx + ',' + cz; }

  makeMesh() {
    if (this.meshPool.length) return this.meshPool.pop();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VN * VN * 3), 3));
    g.setAttribute('aData', new THREE.BufferAttribute(new Float32Array(VN * VN * 2), 2));
    g.setIndex(this.index);
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    return mesh;
  }

  buildChunk(cx, cz) {
    const mesh = this.makeMesh();
    const g = mesh.geometry;
    const pos = g.attributes.position.array;
    const dat = g.attributes.aData.array;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    let minY = 1e9, maxY = -1e9;
    for (let j = 0; j < VN; j++) {
      for (let i = 0; i < VN; i++) {
        const gx = cx * SEG + i, gz = cz * SEG + j;
        const edgeX = i === 0 || i === SEG, edgeZ = j === 0 || j === SEG;
        const jx = (hash2(gx, gz, 7) - 0.5) * CELL * 0.7;
        const jz = (hash2(gx, gz, 8) - 0.5) * CELL * 0.7;
        const lx = i * CELL + (edgeX ? 0 : jx);
        const lz = j * CELL + (edgeZ ? 0 : jz);
        sampleWorld(ox + lx, oz + lz, _w);
        const k = j * VN + i;
        pos[k * 3] = lx;
        pos[k * 3 + 1] = _w.h;
        pos[k * 3 + 2] = lz;
        dat[k * 2] = _w.t;
        dat[k * 2 + 1] = hash2(gx, gz, 9);
        if (_w.h < minY) minY = _w.h;
        if (_w.h > maxY) maxY = _w.h;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aData.needsUpdate = true;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CHUNK / 2, (minY + maxY) / 2, CHUNK / 2), Math.hypot(CHUNK * 0.71, (maxY - minY) / 2 + 2));
    mesh.position.set(ox - origin.x, 0, oz - origin.z);
    mesh.updateMatrix();
    mesh.visible = true;

    const chunk = { cx, cz, mesh, pages: {} };
    this.scatter(chunk);
    return chunk;
  }

  place(name, x, y, z, rotY, scale, color, tiltX = 0, tiltZ = 0, sy = 1) {
    _p.set(x - origin.x, y, z - origin.z);
    _e.set(tiltX, rotY, tiltZ);
    _q.setFromEuler(_e);
    _s.set(scale, scale * sy, scale);
    _m.compose(_p, _q, _s);
    return this.pools[name].stage(_m, color);
  }

  scatter(chunk) {
    const { cx, cz } = chunk;
    for (const p of Object.values(this.pools)) p.begin();
    const rnd = mulberry32(seedFor(cx, cz, 4242));
    const ox = cx * CHUNK, oz = cz * CHUNK;

    for (const [name, t] of Object.entries(TYPES)) {
      if (!t.tries) continue;
      const tries = Math.round(t.tries * this.density);
      for (let i = 0; i < tries; i++) {
        const x = ox + rnd() * CHUNK, z = oz + rnd() * CHUNK;
        const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(), r5 = rnd();
        sampleWorld(x, z, _w);
        const h = _w.h;
        if (h < 0.7) continue;
        let b = biomeIndex(_w.t + (r1 - 0.5) * 0.1);
        // bergen: dennen hoger op, sneeuw-props op hoge pieken
        let dens = t.dens[b];
        if (name === 'pine' && h > 40) dens = Math.max(dens, 0.7);
        if ((name === 'tree' || name === 'blossom' || name === 'flower') && h > 48) dens *= 0.2;
        if (r2 > dens) continue;
        if (t.forest !== undefined && forestAt(x, z) < t.forest) continue;
        if (t.slope < 1) {
          const hx = sampleWorld(x + 1.5, z, _w).h;
          const hz = sampleWorld(x, z + 1.5, _w).h;
          const sl = Math.hypot(hx - h, hz - h) / 1.5;
          if (sl > t.slope) continue;
        }
        const palette = t.colors[b] || t.colors.find((c) => c);
        _c.copy(palette[Math.floor(r3 * palette.length)]);
        _c.multiplyScalar(0.9 + r5 * 0.2);
        const sc = t.scale[0] + (t.scale[1] - t.scale[0]) * r4 * r4;
        const tilt = t.tilt || 0.04;
        this.place(name, x, h - t.sink * sc, z, r5 * Math.PI * 2, sc, _c, (r1 - 0.5) * tilt, (r3 - 0.5) * tilt);
      }
    }

    this.landmarks(chunk, rnd);
    for (const [name, p] of Object.entries(this.pools)) chunk.pages[name] = p.commit();
  }

  landmarks(chunk, rnd) {
    const { cx, cz } = chunk;
    const x0 = cx * CHUNK + CHUNK * 0.5 + (rnd() - 0.5) * 16;
    const z0 = cz * CHUNK + CHUNK * 0.5 + (rnd() - 0.5) * 16;
    sampleWorld(x0, z0, _w);
    const h0 = _w.h;
    const b = biomeIndex(_w.t);
    if (h0 < 1.2) return;
    const roll = rnd();
    const stone = [C('#9a958c'), C('#d9b48a'), C('#b8adb5'), C('#8f7a6a'), C('#a0aabf')][b];
    const ruin = [C('#e6caa0'), C('#e8e2d6'), C('#f2e8ea'), C('#d8c8b4'), C('#e8eef6')][b];

    if (roll < 0.03) {
      // steencirkel
      const n = 9 + Math.floor(rnd() * 3), R = 9 + rnd() * 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = x0 + Math.cos(a) * R, z = z0 + Math.sin(a) * R;
        const h = sampleWorld(x, z, _w).h;
        _c.copy(stone).multiplyScalar(0.85 + rnd() * 0.3);
        this.place('monolith', x, h - 0.6, z, -a + Math.PI / 2, 0.85 + rnd() * 0.5, _c, (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.15);
      }
      _c.copy(stone);
      this.place('monolith', x0, h0 - 0.4, z0, rnd() * 6, 1.5, _c);
    } else if (roll < 0.07) {
      // ruïnes
      const n = 4 + Math.floor(rnd() * 6);
      const rot = rnd() * Math.PI;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const along = Math.floor(i / 2) * 6 - 9;
        const lx = side * 4, lz = along;
        const x = x0 + Math.cos(rot) * lx - Math.sin(rot) * lz;
        const z = z0 + Math.sin(rot) * lx + Math.cos(rot) * lz;
        const h = sampleWorld(x, z, _w).h;
        if (h < 0.5) continue;
        const broken = rnd() < 0.4;
        _c.copy(ruin).multiplyScalar(0.85 + rnd() * 0.2);
        this.place('column', x, h - 0.2, z, rnd(), 1, _c, broken ? (rnd() - 0.5) * 0.4 : 0, 0, broken ? 0.3 + rnd() * 0.5 : 1);
      }
    } else if (roll < (b === 0 ? 0.16 : 0.085)) {
      _c.copy(b === 0 ? C('#d58a5a') : stone);
      this.place('arch', x0, h0 - 2, z0, rnd() * Math.PI, 0.8 + rnd() * 0.6, _c);
    } else if (roll < (b === 0 ? 0.175 : 0.1)) {
      _c.copy(stone).multiplyScalar(1.1);
      this.place('colossus', x0, h0 - 1.2, z0, rnd() * Math.PI * 2, 1.2 + rnd() * 0.6, _c);
    } else if (roll < (b === 0 ? 0.19 : 0.12)) {
      _c.copy(ruin);
      this.place('ring', x0, h0 - 0.3, z0, rnd() * Math.PI, 1 + rnd() * 0.4, _c);
    }
  }

  releaseChunk(chunk) {
    chunk.mesh.visible = false;
    this.meshPool.push(chunk.mesh);
    for (const [name, p] of Object.entries(this.pools)) p.release(chunk.pages[name]);
  }

  // camX/camZ in echte wereldcoördinaten; dir = kijkrichting (x,z)
  update(camX, camZ, dirX, dirZ, budgetMs = 4, force = false) {
    const ccx = Math.floor(camX / CHUNK), ccz = Math.floor(camZ / CHUNK);
    const R = this.radius;
    if (ccx !== this.center.x || ccz !== this.center.z) {
      this.center.x = ccx; this.center.z = ccz;
      // vrijgeven
      for (const [k, ch] of this.chunks) {
        const dx = ch.cx - ccx, dz = ch.cz - ccz;
        if (dx * dx + dz * dz > (R + 1) * (R + 1) + R) {
          this.releaseChunk(ch);
          this.chunks.delete(k);
        }
      }
      // wachtrij opbouwen
      this.queue.length = 0;
      for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > R * R + R) continue;
          const cx = ccx + dx, cz = ccz + dz;
          if (this.chunks.has(this.key(cx, cz))) continue;
          const len = Math.sqrt(d2) || 1;
          const front = (dx * dirX + dz * dirZ) / len;
          this.queue.push({ cx, cz, pr: d2 - front * R * 2.5 });
        }
      }
      this.queue.sort((a, b) => b.pr - a.pr); // pop() pakt de laagste
    }
    const t0 = performance.now();
    let built = 0;
    while (this.queue.length) {
      if (!force && built > 0 && performance.now() - t0 > budgetMs) break;
      const q = this.queue.pop();
      const k = this.key(q.cx, q.cz);
      if (this.chunks.has(k)) continue;
      this.chunks.set(k, this.buildChunk(q.cx, q.cz));
      built++;
      if (force && performance.now() - t0 > budgetMs) break;
    }
    return this.queue.length;
  }

  rebase(dx, dz) {
    for (const ch of this.chunks.values()) {
      ch.mesh.position.x -= dx;
      ch.mesh.position.z -= dz;
      ch.mesh.updateMatrix();
    }
    for (const p of Object.values(this.pools)) p.shift(dx, dz);
  }
}
