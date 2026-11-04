// Chunk-gebaseerd oneindig terrein + deterministische verspreiding van objecten.
import * as THREE from 'three';
import { sampleWorld, origin, forestAt, biomeIndex } from './world.js';
import { mulberry32, seedFor, hash2 } from './noise.js';
import * as M from './models.js';

export const CHUNK = 48;
const SEG = 32;
const CELL = CHUNK / SEG;
const VN = SEG + 1;
const BN = SEG + 3; // met een rand van één cel extra voor de normalen

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
// Bewust minder objecten dan voorheen: elk object is nu veel gedetailleerder.
const TYPES = {
  flower: { frac: 0.6, model: M.flower, per: 30, tries: 40, dens: [0.03, 0.6, 0.9, 0.2, 0], slope: 0.4, scale: [0.9, 1.3], sink: 0.02, noShadow: true,
    colors: P([['#e86a8e'], ['#e8556f', '#f2c541', '#f4f1ea', '#8f73d9', '#e8823a'], ['#f29ac0', '#f7f2f2', '#f6c8dc', '#b99be6'], ['#e89a3c', '#d8583a'], null]) },
  tree: { frac: 0.45, model: M.treeBroad, per: 14, tries: 34, dens: [0, 0.8, 0.18, 0.65, 0], slope: 0.38, scale: [0.85, 1.5], sink: 0.25, forest: 0.0,
    colors: P([null, ['#4f7f30', '#5b8a34', '#43702c', '#668f3a'], ['#62903c'], ['#c4642a', '#d89a34', '#a8432a', '#c9a73a', '#b8572a'], null]) },
  pine: { frac: 0.5, model: M.pine, per: 16, tries: 36, dens: [0, 0.18, 0, 0.35, 1], slope: 0.5, scale: [0.85, 1.7], sink: 0.25, forest: -0.1,
    colors: P([null, ['#4f8a55', '#5a9058'], null, ['#62844a', '#6e8c4e'], ['#4a7a64', '#548470', '#46705e']]) },
  blossom: { frac: 0.5, model: M.blossomTree, per: 12, tries: 30, dens: [0, 0.06, 1, 0, 0], slope: 0.38, scale: [0.9, 1.4], sink: 0.25, forest: -0.05,
    colors: P([null, ['#f0b8cc'], ['#efa6c2', '#f5c3d6', '#e894b3', '#f7e6ee', '#dba6d9'], null, null]) },
  acacia: { frac: 0.25, model: M.acacia, per: 5, tries: 7, dens: [0.35, 0.08, 0, 0, 0], slope: 0.35, scale: [1, 1.5], sink: 0.2,
    colors: P([['#6f8338', '#7c8a3e'], ['#5e7d34'], null, null, null]) },
  cactus: { frac: 0.25, model: M.cactus, per: 6, tries: 9, dens: [0.6, 0, 0, 0, 0], slope: 0.35, scale: [0.8, 1.4], sink: 0.15,
    colors: P([['#4f7340', '#587d46', '#466a3c'], null, null, null, null]) },
  bush: { frac: 0.55, model: M.bush, per: 12, tries: 18, dens: [0.3, 0.55, 0.55, 0.7, 0.25], slope: 0.45, scale: [0.8, 1.5], sink: 0.15,
    colors: P([['#7f8540', '#8a8648'], ['#3f7030', '#4d7d35'], ['#d68fb0', '#5f8a3a'], ['#a8502a', '#9c7430'], ['#355e4e']]) },
  rock: { frac: 0.6, model: M.rock, per: 8, tries: 10, dens: [0.8, 0.45, 0.4, 0.5, 0.6], slope: 1.2, scale: [0.6, 1.8], sink: 0.25,
    colors: P([['#a7684a', '#9a5d42', '#b37a58'], ['#85827b', '#7a7770'], ['#918a88', '#857f7c'], ['#7a6a5d', '#6d6056'], ['#77808f', '#8a93a2']]) },
  boulder: { frac: 0.75, model: M.boulder, per: 2, tries: 2, dens: [0.6, 0.3, 0.3, 0.35, 0.5], slope: 0.8, scale: [0.8, 1.6], sink: 0.6,
    colors: P([['#a66a4c'], ['#807d77'], ['#8f8986'], ['#75685d'], ['#78818f']]) },
  crystal: { frac: 0.35, model: M.crystal, per: 4, tries: 5, dens: [0.08, 0, 0.03, 0, 0.6], slope: 0.9, scale: [0.8, 2.0], sink: 0.4, tilt: 0.25,
    colors: P([['#e9a3c8'], null, ['#c8b4e8'], null, ['#a9dcef', '#b9c8f2', '#c9eef6']]) },
  mushroom: { frac: 0.4, model: M.mushroom, per: 5, tries: 7, dens: [0, 0.25, 0.08, 1, 0], slope: 0.4, scale: [0.4, 1.2], sink: 0.08, noShadow: true,
    colors: P([null, ['#b8865a', '#a0704a'], ['#c9a08a'], ['#b8321f', '#c4462a', '#9c2a1a'], null]) },
  lantern: { frac: 0.4, model: M.lanternPost, per: 3, tries: 4, dens: [0, 0.06, 0.6, 0.15, 0.04], slope: 0.3, scale: [1, 1.25], sink: 0.1,
    colors: P([null, ['#ffd28a'], ['#ffc9a0', '#ffd28a'], ['#ffb46a'], ['#ffe2b0']]) },
  monolith: { frac: 0.25, model: M.monolith, per: 12, tries: 0, colors: null },
  column: { frac: 0.3, model: M.column, per: 10, tries: 0, colors: null },
  arch: { frac: 0.15, model: M.arch, per: 1, tries: 0, colors: null },
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
      const pool = (this.pools[name] = new Pool(scene, t.model(), propMat, Math.ceil(this.slots * per * t.frac) + 16, per));
      if (!t.noShadow && opts.depthProp) { pool.mesh.layers.enable(1); pool.mesh.userData.depth = opts.depthProp; }
    }
    this.depthTerrain = opts.depthTerrain;
    this.heights = new Float32Array(BN * BN);
    this.temps = new Float32Array(BN * BN);
    this.allMeshes = [];

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
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(VN * VN * 3), 3));
    g.setAttribute('aData', new THREE.BufferAttribute(new Float32Array(VN * VN * 3), 3));
    g.setIndex(this.index);
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.matrixAutoUpdate = false;
    if (this.depthTerrain) { mesh.layers.enable(1); mesh.userData.depth = this.depthTerrain; }
    this.scene.add(mesh);
    this.allMeshes.push(mesh);
    return mesh;
  }

  buildChunk(cx, cz) {
    const mesh = this.makeMesh();
    const g = mesh.geometry;
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal.array;
    const dat = g.attributes.aData.array;
    const H = this.heights, T = this.temps;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    let minY = 1e9, maxY = -1e9;
    // hoogtes inclusief een rand, zodat normalen over chunkgrenzen naadloos zijn
    for (let j = 0; j < BN; j++) {
      for (let i = 0; i < BN; i++) {
        sampleWorld(ox + (i - 1) * CELL, oz + (j - 1) * CELL, _w);
        H[j * BN + i] = _w.h;
        T[j * BN + i] = _w.t;
      }
    }
    for (let j = 0; j < VN; j++) {
      for (let i = 0; i < VN; i++) {
        const k = j * VN + i;
        const bi = (j + 1) * BN + (i + 1);
        const h = H[bi];
        const hl = H[bi - 1], hr = H[bi + 1], hd = H[bi - BN], hu = H[bi + BN];
        pos[k * 3] = i * CELL;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = j * CELL;
        let nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
        const l = Math.hypot(nx, ny, nz);
        nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
        // holtes iets donkerder (goedkope ambient occlusion)
        const cav = (hl + hr + hd + hu) * 0.25 - h;
        dat[k * 3] = T[bi];
        dat[k * 3 + 1] = hash2(cx * SEG + i, cz * SEG + j, 9);
        dat[k * 3 + 2] = Math.min(1, Math.max(0.55, 1 - cav * 0.35));
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
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
    const stone = [C('#8a857c'), C('#b08a66'), C('#97908c'), C('#7d7064'), C('#848b96')][b];
    const ruin = [C('#cdb390'), C('#cfc9bd'), C('#d6cdcb'), C('#bfb09c'), C('#cdd3da')][b];

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
      _c.copy(b === 0 ? C('#b06e48') : stone);
      this.place('arch', x0, h0 - 2, z0, rnd() * Math.PI, 0.8 + rnd() * 0.6, _c);
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
