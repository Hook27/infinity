// Onweer: zoekt onweerscellen rond de camera, laat ze willekeurig flitsen (met meerdere ontladingen),
// tekent soms een zichtbare schicht en plant de donder op basis van de afstand (geluidssnelheid).
import * as THREE from 'three';
import { W, makeBoltMaterial } from './shaders.js';

const SOUND = 343; // m/s

function boltPoints(a, b, rnd, rough = 0.22, depth = 6) {
  let pts = [a.clone(), b.clone()];
  let off = a.distanceTo(b) * rough;
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const m = pts[i].clone().add(pts[i + 1]).multiplyScalar(0.5);
      m.x += (rnd() - 0.5) * off; m.y += (rnd() - 0.5) * off * 0.7; m.z += (rnd() - 0.5) * off;
      next.push(m, pts[i + 1]);
    }
    pts = next;
    off *= 0.55;
  }
  return pts;
}

function ribbon(pts, width) {
  const pos = [], dir = [], side = [], w = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = b.clone().sub(a).normalize();
    const wa = width * (1 - i / pts.length * 0.7), wb = width * (1 - (i + 1) / pts.length * 0.7);
    const quad = [[a, -1, wa], [a, 1, wa], [b, 1, wb], [a, -1, wa], [b, 1, wb], [b, -1, wb]];
    for (const [p, s, ww] of quad) { pos.push(p.x, p.y, p.z); dir.push(d.x, d.y, d.z); side.push(s); w.push(ww); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(w, 1));
  return g;
}

export class Storms {
  constructor(scene, weather, origin, onThunder) {
    this.scene = scene;
    this.weather = weather;
    this.origin = origin;
    this.onThunder = onThunder;
    this.cells = [];
    this.refresh = 0;
    this.flash = null;
    this.bolts = [];
    this.pending = [];
    this.time = 0;
    this.rnd = Math.random;
  }

  update(dt, camScene, camTrue) {
    this.time += dt;
    const t = this.time;
    this.refresh -= dt;
    if (this.refresh <= 0) {
      this.refresh = 3;
      const fresh = this.weather.storms(camTrue.x, camTrue.z, 32000, 1600);
      // bestaande timers behouden waar mogelijk
      for (const c of fresh) {
        const old = this.cells.find((o) => Math.abs(o.x - c.x) < 2000 && Math.abs(o.z - c.z) < 2000);
        c.next = old ? old.next : t + 1 + this.rnd() * 10;
      }
      this.cells = fresh;
    }
    // nieuwe flitsen: één klok voor alle cellen; hoe dichter de bui, hoe vaker het flitst
    if (this.cells.length) {
      if (this.next === undefined) this.next = t + 3;
      if (t >= this.next) {
        let total = 0;
        const w = this.cells.map((c) => {
          const d = Math.hypot(c.x - camTrue.x, c.z - camTrue.z);
          const v = c.s / (1 + Math.pow(d / 9000, 2));
          total += v;
          return v;
        });
        let r = this.rnd() * total, pick = this.cells[0];
        for (let i = 0; i < this.cells.length; i++) { r -= w[i]; if (r <= 0) { pick = this.cells[i]; break; } }
        this.strike(pick, camScene);
        const closeness = Math.min(1, total / 1.5);
        this.next = t + (4 + this.rnd() * 12) * (1.6 - closeness);
      }
    } else this.next = undefined;
    // helderheid van de huidige flits (meerdere ontladingen)
    let I = 0;
    if (this.flash) {
      for (const s of this.flash.strokes) {
        const dtS = t - this.flash.t - s.at;
        if (dtS >= 0) I += s.i * Math.exp(-dtS / 0.06);
      }
      if (t - this.flash.t > 1.5) this.flash = null;
    }
    W.uFlash.value = I;
    if (this.flash) W.uFlashPos.value.set(this.flash.pos.x - this.origin.x, this.flash.pos.y, this.flash.pos.z - this.origin.z);
    for (const b of this.bolts) {
      b.mesh.position.set(b.anchor.x - this.origin.x, 0, b.anchor.z - this.origin.z);
      b.mesh.material.uniforms.uI.value = I * b.k;
    }
    this.bolts = this.bolts.filter((b) => {
      if (t - b.t > 1.2) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); return false; }
      return true;
    });
    // donder op het juiste moment
    this.pending = this.pending.filter((p) => {
      if (t >= p.at) { this.onThunder(p.dist); return false; }
      return true;
    });
  }

  strike(c, camScene) {
    const r = this.rnd;
    const pos = new THREE.Vector3(c.x + (r() - 0.5) * 1800, c.base + (c.top - c.base) * (0.25 + r() * 0.55), c.z + (r() - 0.5) * 1800);
    const n = 1 + Math.floor(r() * 4);
    const strokes = [];
    let at = 0;
    for (let i = 0; i < n; i++) { strokes.push({ at, i: (i === 0 ? 1 : 0.5 + r() * 0.6) * (0.7 + r() * 0.6) }); at += 0.05 + r() * 0.12; }
    this.flash = { t: this.time, pos, strokes };
    const sx = pos.x - this.origin.x, sz = pos.z - this.origin.z;
    const dist = Math.hypot(sx - camScene.x, pos.y - camScene.y, sz - camScene.z);
    // zichtbare schicht: horizontaal door de wolk of omlaag de diepte in
    if (r() < 0.5 && dist < 26000) {
      const down = r() < 0.55;
      const len = 2500 + r() * 4000;
      const ang = r() * Math.PI * 2;
      const local = new THREE.Vector3(pos.x - c.x, pos.y, pos.z - c.z);
      const end = down
        ? new THREE.Vector3(local.x + Math.cos(ang) * len * 0.3, Math.max(local.y - len, -1500), local.z + Math.sin(ang) * len * 0.3)
        : new THREE.Vector3(local.x + Math.cos(ang) * len, local.y + (r() - 0.5) * 800, local.z + Math.sin(ang) * len);
      const pts = boltPoints(local, end, r);
      const geos = [ribbon(pts, 9 + r() * 6)];
      // een of twee vertakkingen
      for (let k = 0; k < 2; k++) {
        if (r() < 0.6) {
          const from = pts[Math.floor(pts.length * (0.2 + r() * 0.5))];
          const to = from.clone().add(new THREE.Vector3((r() - 0.5) * len * 0.5, -r() * len * 0.3, (r() - 0.5) * len * 0.5));
          geos.push(ribbon(boltPoints(from, to, r, 0.25, 5), 5));
        }
      }
      for (const g of geos) {
        const m = new THREE.Mesh(g, makeBoltMaterial());
        m.frustumCulled = false;
        this.scene.add(m);
        this.bolts.push({ mesh: m, t: this.time, k: 1, anchor: { x: c.x, z: c.z } });
      }
    }
    if (dist < 24000) this.pending.push({ at: this.time + Math.min(dist / SOUND, 14), dist });
  }

  rebase() { /* posities worden elke frame uit echte coördinaten afgeleid */ }
}
