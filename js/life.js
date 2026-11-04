// Bewegend leven rond de camera: wandelaars, reuzen, vogels, wolken, zwevende eilanden, lantaarns en deeltjes.
import * as THREE from 'three';
import { heightScene, sampleWorld, origin, biomeIndex } from './world.js';
import * as M from './models.js';
import { makeMotesMaterial, U } from './shaders.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _w = { h: 0, t: 0 };
const UP = new THREE.Vector3(0, 1, 0);

function instanced(scene, geo, mat, n) {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
  scene.add(mesh);
  return mesh;
}

function setInst(mesh, i, x, y, z, rx, ry, rz, s, sy = s) {
  _p.set(x, y, z);
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _s.set(s, sy, s);
  _m.compose(_p, _q, _s);
  _m.toArray(mesh.instanceMatrix.array, i * 16);
}

function hideInst(mesh, i) { mesh.instanceMatrix.array.fill(0, i * 16, i * 16 + 16); }

// zoekt een plek op land vóór de camera
function spotAhead(cam, dir, minD, maxD, spread, out) {
  for (let k = 0; k < 8; k++) {
    const a = Math.atan2(dir.x, dir.z) + (Math.random() - 0.5) * spread;
    const d = minD + Math.random() * (maxD - minD);
    const x = cam.x + Math.sin(a) * d, z = cam.z + Math.cos(a) * d;
    sampleWorld(x + origin.x, z + origin.z, _w);
    if (_w.h > 0.8) { out.x = x; out.z = z; out.h = _w.h; out.t = _w.t; return true; }
  }
  return false;
}

const ROBES = ['#b8473a', '#3d4f8f', '#d19a3a', '#2f8077', '#7a3d7a', '#e8e0d0', '#5b6b3a'].map((c) => new THREE.Color(c));

export class Life {
  constructor(scene, mats, quality) {
    this.scene = scene;
    const q = quality;

    // wandelaars
    this.nW = Math.round(90 * q);
    this.wMesh = instanced(scene, M.wanderer(), mats.prop, this.nW);
    this.walkers = [];
    for (let i = 0; i < this.nW; i++) this.walkers.push({ x: 0, z: 0, y: 0, a: 0, speed: 1, phase: Math.random() * 10, alive: false, leader: -1, ox: 0, oz: 0, scale: 1 });

    // reuzen
    this.nT = 3;
    this.tMesh = instanced(scene, M.titanBody(), mats.titan, this.nT);
    this.titans = [];
    for (let i = 0; i < this.nT; i++) this.titans.push({ x: 0, z: 0, a: 0, alive: false, cool: 4 + i * 25, s: 60 });

    // vogels
    this.nFlocks = 4;
    this.perFlock = 11;
    this.bMesh = instanced(scene, M.bird(), mats.bird, this.nFlocks * this.perFlock);
    this.flocks = [];
    for (let f = 0; f < this.nFlocks; f++) {
      const birds = [];
      for (let i = 0; i < this.perFlock; i++) {
        const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        birds.push({ ox: side * row * 2.2 + (Math.random() - 0.5), oz: -row * 2.0 + (Math.random() - 0.5), oy: (Math.random() - 0.5) * 1.5 });
      }
      this.flocks.push({ x: 0, y: 0, z: 0, a: 0, turn: 0, alive: false, birds, t: Math.random() * 100 });
    }
    const birdCol = new THREE.Color('#2b2733');
    for (let i = 0; i < this.nFlocks * this.perFlock; i++) birdCol.toArray(this.bMesh.instanceColor.array, i * 3);

    // wolken
    this.nC = Math.round(46 * Math.max(q, 0.6));
    this.cMesh = instanced(scene, M.cloud(), mats.cloud, this.nC);
    this.clouds = [];
    const CS = 1536;
    for (let i = 0; i < this.nC; i++) {
      this.clouds.push({ x: (Math.random() - 0.5) * CS, z: (Math.random() - 0.5) * CS, y: 115 + Math.random() * 70, s: 0.8 + Math.random() * 1.4, r: Math.random() * 6 });
    }
    this.CS = CS;

    // zwevende eilanden
    this.nI = 7;
    this.iMesh = instanced(scene, M.island(), mats.island, this.nI);
    this.islands = [];
    const IS = 3072;
    for (let i = 0; i < this.nI; i++) {
      this.islands.push({ x: (Math.random() - 0.5) * IS, z: (Math.random() - 0.5) * IS, y: 95 + Math.random() * 90, s: 0.7 + Math.random() * 0.9, r: Math.random() * 6, ph: Math.random() * 6 });
    }
    this.IS = IS;

    // hemellantaarns
    this.nL = Math.round(70 * q);
    this.lMesh = instanced(scene, M.skyLantern(), mats.prop, this.nL);
    this.lanterns = [];
    const lc = [new THREE.Color('#ffb05a'), new THREE.Color('#ff8a5a'), new THREE.Color('#ffd27a')];
    for (let i = 0; i < this.nL; i++) {
      this.lanterns.push({ x: 0, y: 0, z: 0, vy: 0, alive: false, ph: Math.random() * 6, s: 1 });
      lc[i % 3].toArray(this.lMesh.instanceColor.array, i * 3);
    }

    // deeltjes
    const nP = Math.round(1500 * q);
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(nP * 3), rnd = new Float32Array(nP * 4);
    for (let i = 0; i < nP; i++) {
      pos[i * 3] = Math.random() * 128; pos[i * 3 + 1] = Math.random() * 56; pos[i * 3 + 2] = Math.random() * 128;
      for (let k = 0; k < 4; k++) rnd[i * 4 + k] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
    this.motes = new THREE.Points(g, makeMotesMaterial());
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 5;
    scene.add(this.motes);

    this.tmp = { x: 0, z: 0, h: 0, t: 0 };
    this.time = 0;
  }

  spawnWalker(i, cam, dir, initial) {
    const w = this.walkers[i];
    const sp = this.tmp;
    if (!spotAhead(cam, dir, initial ? 15 : 120, 260, initial ? Math.PI * 2 : 2.2, sp)) { w.alive = false; return; }
    w.x = sp.x; w.z = sp.z;
    w.a = Math.random() * Math.PI * 2;
    w.speed = 0.9 + Math.random() * 0.8;
    w.alive = true;
    w.scale = 1.1 + Math.random() * 0.35;
    w.leader = -1;
    ROBES[Math.floor(Math.random() * ROBES.length)].toArray(this.wMesh.instanceColor.array, i * 3);
    // soms een kleine karavaan
    let k = 1;
    const groupSize = Math.random() < 0.45 ? 2 + Math.floor(Math.random() * 3) : 0;
    for (let j = i + 1; j < this.nW && k <= groupSize; j++) {
      const f = this.walkers[j];
      if (f.alive) continue;
      f.alive = true;
      f.leader = i;
      f.ox = (Math.random() - 0.5) * 2.5;
      f.oz = -k * 2.4;
      f.scale = 1.0 + Math.random() * 0.3;
      f.phase = Math.random() * 10;
      f.x = w.x; f.z = w.z;
      ROBES[Math.floor(Math.random() * ROBES.length)].toArray(this.wMesh.instanceColor.array, j * 3);
      k++;
    }
    this.wMesh.instanceColor.needsUpdate = true;
  }

  init(cam, dir) {
    for (let i = 0; i < this.nW; i++) if (!this.walkers[i].alive) this.spawnWalker(i, cam, dir, true);
  }

  update(dt, cam, dir, night, timeScale) {
    const t = (this.time = U.uTime.value);

    // --- wandelaars
    for (let i = 0; i < this.nW; i++) {
      const w = this.walkers[i];
      if (w.alive && w.leader >= 0 && !this.walkers[w.leader].alive) w.leader = -1;
      if (w.alive) {
        const dx = w.x - cam.x, dz = w.z - cam.z;
        const d = Math.hypot(dx, dz);
        const behind = dx * dir.x + dz * dir.z < -50;
        if (d > 300 || behind) w.alive = false;
      }
      if (!w.alive) {
        if (Math.random() < 0.02) this.spawnWalker(i, cam, dir, false);
        if (!w.alive) { hideInst(this.wMesh, i); continue; }
      }
      w.phase += dt * w.speed * 4.2;
      if (w.leader >= 0) {
        const L = this.walkers[w.leader];
        const ca = Math.cos(L.a), sa = Math.sin(L.a);
        const tx = L.x + ca * w.ox + sa * w.oz, tz = L.z - sa * w.ox + ca * w.oz;
        const ddx = tx - w.x, ddz = tz - w.z;
        const dd = Math.hypot(ddx, ddz);
        if (dd > 0.05) {
          const step = Math.min(dd, L.speed * 1.15 * dt + dd * dt * 0.5);
          w.x += (ddx / dd) * step; w.z += (ddz / dd) * step;
          w.a = Math.atan2(ddx, ddz);
        }
      } else {
        w.a += Math.sin(t * 0.2 + i) * 0.15 * dt;
        const nx = w.x + Math.sin(w.a) * w.speed * dt, nz = w.z + Math.cos(w.a) * w.speed * dt;
        if (heightScene(nx + Math.sin(w.a) * 3, nz + Math.cos(w.a) * 3) < 0.6) w.a += Math.PI * 0.6;
        else { w.x = nx; w.z = nz; }
      }
      const h = heightScene(w.x, w.z);
      const bob = Math.abs(Math.sin(w.phase)) * 0.09;
      setInst(this.wMesh, i, w.x, h - 0.05 + bob, w.z, 0, w.a, Math.sin(w.phase) * 0.05, w.scale);
    }
    this.wMesh.instanceMatrix.needsUpdate = true;

    // --- reuzen
    for (let i = 0; i < this.nT; i++) {
      const T = this.titans[i];
      if (T.alive) {
        const dx = T.x - cam.x, dz = T.z - cam.z;
        if (Math.hypot(dx, dz) > 620 || dx * dir.x + dz * dir.z < -160) { T.alive = false; T.cool = 30 + Math.random() * 60; }
      }
      if (!T.alive) {
        hideInst(this.tMesh, i);
        T.cool -= dt;
        if (T.cool <= 0) {
          const sp = this.tmp;
          if (spotAhead(cam, dir, 300, 480, 1.2, sp)) {
            T.x = sp.x; T.z = sp.z; T.alive = true;
            T.s = 50 + Math.random() * 25;
            // loop ongeveer dwars op de vliegrichting
            T.a = Math.atan2(dir.x, dir.z) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.8);
            new THREE.Color(['#b9b2a6', '#a6b0bf', '#c7b29a'][i % 3]).toArray(this.tMesh.instanceColor.array, i * 3);
            this.tMesh.instanceColor.needsUpdate = true;
          } else T.cool = 2;
        }
        continue;
      }
      const sp = T.s * 0.032;
      T.x += Math.sin(T.a) * sp * dt; T.z += Math.cos(T.a) * sp * dt;
      T.a += Math.sin(t * 0.05 + i) * 0.01 * dt;
      const h = Math.max(heightScene(T.x, T.z), -2);
      const ph = i * 2.1;
      const bob = Math.abs(Math.cos(t * 1.4 + ph)) * 0.02 * T.s;
      setInst(this.tMesh, i, T.x, h - T.s * 0.05 + bob, T.z, 0, T.a, Math.sin(t * 1.4 + ph) * 0.03, T.s);
    }
    this.tMesh.instanceMatrix.needsUpdate = true;

    // --- vogels
    let bi = 0;
    for (const F of this.flocks) {
      if (F.alive) {
        const dx = F.x - cam.x, dz = F.z - cam.z;
        if (Math.hypot(dx, dz) > 420 || dx * dir.x + dz * dir.z < -120) F.alive = false;
      }
      if (!F.alive && Math.random() < 0.01) {
        const a = Math.atan2(dir.x, dir.z) + (Math.random() - 0.5) * 1.6;
        const d = 120 + Math.random() * 200;
        F.x = cam.x + Math.sin(a) * d; F.z = cam.z + Math.cos(a) * d;
        F.y = Math.max(heightScene(F.x, F.z), 0) + 25 + Math.random() * 30;
        F.a = Math.atan2(dir.x, dir.z) + (Math.random() - 0.5) * 3;
        F.alive = true;
      }
      F.t += dt;
      F.turn = Math.sin(F.t * 0.21) * 0.25;
      F.a += F.turn * dt;
      const v = 11;
      F.x += Math.sin(F.a) * v * dt; F.z += Math.cos(F.a) * v * dt;
      const ground = Math.max(heightScene(F.x, F.z), 0) + 22;
      if (F.y < ground) F.y += (ground - F.y) * dt;
      for (const b of F.birds) {
        if (!F.alive) { hideInst(this.bMesh, bi++); continue; }
        const ca = Math.cos(F.a), sa = Math.sin(F.a);
        const x = F.x + ca * b.ox + sa * b.oz, z = F.z - sa * b.ox + ca * b.oz;
        setInst(this.bMesh, bi++, x, F.y + b.oy + Math.sin(F.t * 1.3 + b.ox) * 0.4, z, 0, F.a, -F.turn * 1.2, 1.2);
      }
    }
    this.bMesh.instanceMatrix.needsUpdate = true;

    // --- wolken (wrap rond de camera)
    const CS = this.CS, half = CS / 2;
    for (let i = 0; i < this.nC; i++) {
      const c = this.clouds[i];
      c.x += 2.2 * dt; c.z += 1.1 * dt;
      c.x = cam.x + ((((c.x - cam.x + half) % CS) + CS) % CS) - half;
      c.z = cam.z + ((((c.z - cam.z + half) % CS) + CS) % CS) - half;
      setInst(this.cMesh, i, c.x, c.y, c.z, 0, c.r, 0, c.s, c.s * 0.8);
    }
    this.cMesh.instanceMatrix.needsUpdate = true;

    // --- eilanden
    const IS = this.IS, ih = IS / 2;
    for (let i = 0; i < this.nI; i++) {
      const c = this.islands[i];
      c.x = cam.x + ((((c.x - cam.x + ih) % IS) + IS) % IS) - ih;
      c.z = cam.z + ((((c.z - cam.z + ih) % IS) + IS) % IS) - ih;
      setInst(this.iMesh, i, c.x, c.y + Math.sin(t * 0.25 + c.ph) * 2.5, c.z, Math.sin(t * 0.2 + c.ph) * 0.03, c.r + t * 0.01, 0, c.s);
    }
    this.iMesh.instanceMatrix.needsUpdate = true;

    // --- hemellantaarns (vooral in de schemering en 's nachts)
    for (let i = 0; i < this.nL; i++) {
      const L = this.lanterns[i];
      if (L.alive) {
        L.y += L.vy * dt;
        L.x += Math.sin(t * 0.3 + L.ph) * 0.6 * dt + 0.8 * dt;
        L.z += Math.cos(t * 0.25 + L.ph) * 0.6 * dt;
        const dx = L.x - cam.x, dz = L.z - cam.z;
        if (L.y > 260 || Math.hypot(dx, dz) > 380 || dx * dir.x + dz * dir.z < -80) L.alive = false;
      }
      if (!L.alive) {
        hideInst(this.lMesh, i);
        if (night > 0.35 && Math.random() < 0.006 * night) {
          const sp = this.tmp;
          if (spotAhead(cam, dir, 40, 260, 1.8, sp) && biomeIndex(sp.t) >= 1) {
            L.x = sp.x; L.z = sp.z; L.y = sp.h + 1; L.vy = 1.4 + Math.random() * 1.6; L.alive = true; L.s = 1 + Math.random() * 0.6;
          }
        }
        continue;
      }
      setInst(this.lMesh, i, L.x, L.y, L.z, Math.sin(t + L.ph) * 0.1, L.ph, 0, L.s);
    }
    this.lMesh.instanceMatrix.needsUpdate = true;
  }

  rebase(dx, dz) {
    const shift = (o) => { o.x -= dx; o.z -= dz; };
    this.walkers.forEach(shift);
    this.titans.forEach(shift);
    this.flocks.forEach(shift);
    this.clouds.forEach(shift);
    this.islands.forEach(shift);
    this.lanterns.forEach(shift);
  }
}
