// Maakt meshes voor hemellichamen in de buurt, ruimt ze op als je verder vliegt, en levert
// lichtbronnen (voor de nevels), bezienswaardigheden (voor de piloot) en info voor de HUD.
import * as THREE from 'three';
import * as S from './shaders.js';
import { fbm3 } from '../../js/noise.js';
import { smoothNormals } from '../../js/models.js';
import { STAR_TYPES } from './universe.js';

const SPHERE = new THREE.SphereGeometry(1, 96, 64);
const SPHERE_LO = new THREE.SphereGeometry(1, 40, 28);

function rockGeometry(seed, detail = 2) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position.array;
  const cache = new Map();
  for (let i = 0; i < p.length; i += 3) {
    const key = `${Math.round(p[i] * 1e4)},${Math.round(p[i + 1] * 1e4)},${Math.round(p[i + 2] * 1e4)}`;
    let k = cache.get(key);
    if (k === undefined) {
      k = 1 + fbm3(p[i] * 1.4 + seed, p[i + 1] * 1.4, p[i + 2] * 1.4 - seed, 4, 3) * 0.45;
      cache.set(key, k);
    }
    p[i] *= k; p[i + 1] *= k * 0.8; p[i + 2] *= k;
  }
  g.deleteAttribute('normal');
  smoothNormals(g);
  return g;
}
const ROCKS = [rockGeometry(1.3), rockGeometry(7.1)];

const PAL = {
  0: [['#4a4540', '#8a8178', '#b3a796'], ['#3c3a38', '#6e6a66', '#a39e96']],
  1: [['#7a4a30', '#c08458', '#e2bc8e'], ['#6a3a26', '#b06a40', '#d9a070']],
  2: [['#0b2846', '#3d5a2e', '#8a7a5a'], ['#0a2238', '#4a6234', '#9a8a62']],
  3: [['#9fb2c4', '#dfe8f0', '#7a90a8'], ['#b8c4cc', '#eef2f5', '#8aa0b4']],
  4: [['#b8916a', '#ead9bc', '#8a5a3a'], ['#c9a77a', '#f2e6cc', '#a8683a'], ['#a88a6a', '#dccfb8', '#6a4a30']],
  5: [['#4a86b8', '#8ac0e0', '#2f5a8a'], ['#5aa0b8', '#a0d4e0', '#3a7088']],
};
const ATMO = { 0: null, 1: '#d9905a', 2: '#4a8cff', 3: '#8ab8ff', 4: '#e0c090', 5: '#6aaaff' };

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Bodies {
  constructor(scene, universe, origin, camera) {
    this.scene = scene;
    this.universe = universe;
    this.origin = origin;
    this.camera = camera;
    this.active = new Map();
    this.near = [];
    this.pois = [];
    this.lights = [];
    this.obstacles = [];
    this.info = null;
    this.bh = null;
    this.special = null;
    // impostors voor verre sterren
    this.farGeo = new THREE.BufferGeometry();
    this.far = new THREE.Points(this.farGeo, S.makeFarStarsMaterial());
    this.far.frustumCulled = false;
    this.far.renderOrder = 1;
    scene.add(this.far);
    this.farTimer = 0;
  }

  scenePos(o, out) {
    return out.set(o.pos[0] - this.origin.x, o.pos[1] - this.origin.y, o.pos[2] - this.origin.z);
  }

  range(o) {
    switch (o.kind) {
      case 'star': return 6000 + o.radius * 40;
      case 'planet': return 9000 + o.radius * 80;
      case 'belt': return o.radius + 5000;
      case 'comet': return 9000;
      default: return 32000;
    }
  }

  starOf(o) {
    for (const n of this.near) if (n.id === o.star) return n;
    return null;
  }

  create(o) {
    const g = new THREE.Group();
    const e = { o, g, parts: {} };
    const st = o.star ? this.starOf(o) : null;
    e.starCol = st ? new THREE.Color(...st.color).multiplyScalar(1.0 + st.lum * 0.25) : new THREE.Color(1, 1, 1);
    e.star = st;

    if (o.kind === 'star' || o.kind === 'pulsar' || o.kind === 'pneb') {
      const color = o.kind === 'star' ? o.color : o.kind === 'pulsar' ? [0.7, 0.82, 1.0] : [0.85, 0.9, 1.0];
      const R = o.kind === 'pneb' ? 6 : o.radius;
      const lum = o.kind === 'star' ? o.lum : 1.6;
      const sm = new THREE.Mesh(SPHERE, S.makeStarMaterial(color, lum, o.seed));
      sm.scale.setScalar(R);
      g.add(sm);
      e.parts.surface = sm;
      if (o.kind === 'star') {
        const cor = S.makeCorona(color, R, lum, o.seed);
        g.add(cor);
        e.parts.corona = cor;
        const pm = S.makeProminenceMaterial(color, o.seed * 10, lum);
        const tor = new THREE.TorusGeometry(0.2, 0.022, 6, 40, Math.PI);
        let a = o.seed * 100;
        for (let i = 0; i < 5; i++) {
          const d = new THREE.Vector3(Math.sin(a * 1.3 + i), Math.cos(a * 0.7 + i * 2.1), Math.sin(a * 2.3 + i * 0.7)).normalize();
          const m = new THREE.Mesh(tor, pm);
          m.scale.setScalar(R * (0.7 + 0.6 * ((i * 0.37 + o.seed) % 1)));
          m.position.copy(d).multiplyScalar(R * 0.97);
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
          m.rotateY(i * 1.7 + a);
          g.add(m);
        }
      } else {
        const glow = S.makeGlow(o.kind === 'pulsar' ? [0.6, 0.75, 1.6] : [0.9, 1.0, 1.4], o.kind === 'pulsar' ? 220 : 90);
        g.add(glow);
        if (o.kind === 'pulsar') {
          const jm = S.makeJetMaterial([0.55, 0.7, 1.0]);
          const jg = new THREE.ConeGeometry(70, 2400, 24, 1, true);
          jg.translate(0, -1200, 0);
          const jets = new THREE.Group();
          for (const sgn of [1, -1]) {
            const j = new THREE.Mesh(jg, jm);
            j.rotation.x = sgn > 0 ? Math.PI : 0;
            jets.add(j);
          }
          g.add(jets);
          e.parts.jets = jets;
          const ax = new THREE.Vector3(...o.axis).normalize();
          e.spinAxis = ax;
        }
      }
    } else if (o.kind === 'planet') {
      const pal = PAL[o.type][Math.floor(o.seed * PAL[o.type].length)];
      const p = { type: o.type, seed: o.seed, radius: o.radius, colA: pal[0], colB: pal[1], colC: pal[2], atmo: ATMO[o.type] };
      const tilt = new THREE.Group();
      tilt.rotation.set(o.tilt[0], o.tilt[1], 0);
      g.add(tilt);
      const pm = new THREE.Mesh(SPHERE, S.makePlanetMaterial(p));
      pm.scale.setScalar(o.radius);
      tilt.add(pm);
      e.parts.planet = pm;
      e.parts.tilt = tilt;
      if (p.atmo) {
        const am = new THREE.Mesh(SPHERE, S.makeAtmoMaterial(p.atmo));
        am.scale.setScalar(o.radius * (o.type >= 4 ? 1.025 : 1.045));
        tilt.add(am);
        e.parts.atmo = am;
      }
      if (o.rings) {
        const inner = 1.45, outer = 2.3 + o.seed * 0.5;
        const rg = new THREE.RingGeometry(o.radius * inner, o.radius * outer, 160, 1);
        const rm = new THREE.Mesh(rg, S.makeRingMaterial(o.radius * inner, o.radius * outer, o.seed, '#cbb999', '#8c7b64'));
        rm.rotation.x = -Math.PI / 2;
        tilt.add(rm);
        e.parts.ring = rm;
        e.ringOuter = outer;
        pm.material.uniforms.uRing.value.w = outer;
      }
      e.moons = [];
      for (const mo of o.moons) {
        const mm = new THREE.Mesh(SPHERE_LO, S.makePlanetMaterial({ type: 0, seed: mo.seed, radius: mo.radius, colA: '#55504a', colB: '#8f877d', colC: '#b0a89c' }));
        mm.scale.setScalar(mo.radius);
        mm.position.set(mo.pos[0] - o.pos[0], mo.pos[1] - o.pos[1], mo.pos[2] - o.pos[2]);
        g.add(mm);
        e.moons.push({ mesh: mm, mo });
      }
    } else if (o.kind === 'belt') {
      const n = new THREE.Vector3(...o.normal);
      const ax = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 0, 1)).normalize();
      const az = new THREE.Vector3().crossVectors(ax, n);
      const count = 2600;
      const im = new THREE.InstancedMesh(ROCKS[0], S.makeRockMaterial(), count);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
      let s = Math.floor(o.seed * 1e6);
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
      for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2;
        const r = o.radius + gauss() * o.width;
        const h = gauss() * o.thickness;
        ps.copy(ax).multiplyScalar(Math.cos(a) * r).addScaledVector(az, Math.sin(a) * r).addScaledVector(n, h);
        const size = 2 + Math.pow(rnd(), 4) * 38;
        sc.set(size, size * (0.6 + rnd() * 0.5), size * (0.7 + rnd() * 0.5));
        q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6));
        m4.compose(ps, q, sc);
        im.setMatrixAt(i, m4);
      }
      im.frustumCulled = false;
      g.add(im);
      e.parts.rocks = im;
      // fijn puin rond de camera, alleen zichtbaar binnen de gordel
      const nd = 700;
      const deb = new THREE.InstancedMesh(ROCKS[1], S.makeRockMaterial('#6a6058', '#8f8578'), nd);
      deb.frustumCulled = false;
      deb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      e.debris = { mesh: deb, base: [], n: nd, box: 900 };
      for (let i = 0; i < nd; i++) e.debris.base.push([rnd() * 900, rnd() * 900, rnd() * 900, 0.4 + Math.pow(rnd(), 3) * 5]);
      this.scene.add(deb);
      e.beltAxes = { n, ax, az };
    } else if (o.kind === 'comet') {
      const nuc = new THREE.Mesh(ROCKS[1], S.makeRockMaterial('#3a3632', '#5a544c'));
      nuc.scale.setScalar(3.5);
      g.add(nuc);
      e.parts.nucleus = nuc;
      const coma = S.makeGlow([0.65, 0.85, 1.0], 90);
      g.add(coma);
      const ion = S.makeTail([0.35, 0.6, 1.3], 2600, 30, o.seed);
      const dust = S.makeTail([1.0, 0.88, 0.7], 1700, 55, o.seed + 3);
      this.scene.add(ion);
      this.scene.add(dust);
      e.tails = [ion, dust];
    } else if (o.kind === 'blackhole') {
      const R = o.radius;
      const hole = new THREE.Mesh(SPHERE, S.makeBlackMaterial());
      hole.scale.setScalar(R);
      g.add(hole);
      const inner = R * 2.6, outer = R * 11;
      const disk = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 256, 4), S.makeDiskMaterial(inner, outer, o.seed));
      const n = new THREE.Vector3(Math.sin(o.seed * 9) * 0.4, 1, Math.cos(o.seed * 7) * 0.4).normalize();
      disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      g.add(disk);
      e.parts.disk = disk;
      e.diskNormal = n;
    }
    this.scene.add(g);
    this.active.set(o.id, e);
    return e;
  }

  dispose(e) {
    this.scene.remove(e.g);
    e.g.traverse((m) => { if (m.material) m.material.dispose(); if (m.geometry && m.geometry !== SPHERE && m.geometry !== SPHERE_LO && !ROCKS.includes(m.geometry)) m.geometry.dispose(); });
    if (e.tails) for (const t of e.tails) { this.scene.remove(t); t.material.dispose(); t.geometry.dispose(); }
    if (e.debris) { this.scene.remove(e.debris.mesh); e.debris.mesh.material.dispose(); }
    this.active.delete(e.o.id);
  }

  update(dt, time, camScene, camTrue) {
    const near = this.universe.near(camTrue.x, camTrue.y, camTrue.z, 32000, this.near);
    const seen = new Set();
    const todo = [];
    for (const o of near) {
      const dx = o.pos[0] - camTrue.x, dy = o.pos[1] - camTrue.y, dz = o.pos[2] - camTrue.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const r = this.range(o);
      if (d < r) { seen.add(o.id); if (!this.active.has(o.id)) todo.push([d, o]); }
      else if (this.active.has(o.id) && d < r * 1.15) seen.add(o.id);
    }
    // nieuwe objecten gespreid aanmaken (dichtstbijzijnde eerst), sterren vóór hun planeten
    todo.sort((a, b) => (a[1].kind === 'star' ? -1e9 : 0) + a[0] - ((b[1].kind === 'star' ? -1e9 : 0) + b[0]));
    const budget = this.warm ? 4 : 1000;
    for (let i = 0; i < todo.length; i++) {
      if (i < budget) this.create(todo[i][1]); else seen.delete(todo[i][1].id);
    }
    this.warm = true;
    for (const e of [...this.active.values()]) if (!seen.has(e.o.id)) this.dispose(e);

    // posities en uniforms bijwerken
    this.pois.length = 0;
    this.obstacles.length = 0;
    this.lights.length = 0;
    this.bh = null;
    this.special = null;
    let best = null, bestD = Infinity;
    for (const e of this.active.values()) {
      const o = e.o;
      this.scenePos(o, e.g.position);
      const pos = e.g.position;
      const dist = pos.distanceTo(camScene);
      const surf = dist - (o.kind === 'belt' ? 0 : o.radius);
      if (o.kind !== 'belt' && surf < bestD) { bestD = surf; best = o; }
      const starPos = e.star ? this.scenePos(e.star, new THREE.Vector3()) : null;

      if (o.kind === 'star') {
        e.parts.surface.material.uniforms.uSpin.value = time * 0.004;
        this.lights.push({ pos: pos.clone(), col: new THREE.Color(...o.color).multiplyScalar(0.9 * o.lum), d: dist });
        this.obstacles.push({ pos: pos.clone(), r: o.radius * 3.5 });
        this.pois.push({ o, pos: pos.clone(), r: o.radius, pass: o.radius * 5 + 200, w: 1 });
      } else if (o.kind === 'planet') {
        const pm = e.parts.planet.material.uniforms;
        pm.uSpin.value = time * (0.01 + o.seed * 0.01);
        if (starPos) { pm.uStarPos.value.copy(starPos); pm.uStarCol.value.copy(e.starCol); }
        pm.uCenter.value.copy(pos);
        if (e.parts.ring) {
          e.parts.ring.getWorldDirection(_v); // normaal van het ringvlak (lokale z)
          pm.uRing.value.set(_v.x, _v.y, _v.z, e.ringOuter);
          const ru = e.parts.ring.material.uniforms;
          if (starPos) ru.uStarPos.value.copy(starPos);
          ru.uStarCol.value.copy(e.starCol);
          ru.uCenter.value.copy(pos);
          ru.uRadius.value = o.radius;
        }
        if (e.parts.atmo) {
          const au = e.parts.atmo.material.uniforms;
          if (starPos) au.uStarPos.value.copy(starPos);
          au.uStarCol.value.copy(e.starCol);
        }
        for (const { mesh, mo } of e.moons) {
          const mu = mesh.material.uniforms;
          if (starPos) mu.uStarPos.value.copy(starPos);
          mu.uStarCol.value.copy(e.starCol);
          this.obstacles.push({ pos: mesh.getWorldPosition(new THREE.Vector3()), r: mo.radius * 3 });
        }
        this.obstacles.push({ pos: pos.clone(), r: o.radius * (o.rings ? 2.6 : 1.6) });
        this.pois.push({ o, pos: pos.clone(), r: o.radius, pass: o.radius * (o.rings ? 3.2 : 2.6) + 60, w: 1.3 });
      } else if (o.kind === 'belt') {
        const ru = e.parts.rocks.material.uniforms;
        if (starPos) ru.uStarPos.value.copy(starPos);
        ru.uStarCol.value.copy(e.starCol);
        this.updateDebris(e, camScene, starPos);
        // een punt op de gordel vlak voor ons is een mooie bestemming
        const { n, ax, az } = e.beltAxes;
        _v.copy(camScene).sub(pos);
        const h = _v.dot(n);
        _v.addScaledVector(n, -h);
        const a = Math.atan2(_v.dot(az), _v.dot(ax)) + 0.35;
        const pt = pos.clone().addScaledVector(ax, Math.cos(a) * o.radius).addScaledVector(az, Math.sin(a) * o.radius);
        this.pois.push({ o, pos: pt, r: 10, pass: 0, w: 0.9, belt: true });
      } else if (o.kind === 'comet') {
        if (starPos) {
          const axis = pos.clone().sub(starPos).normalize();
          const bend = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.35);
          for (const t of e.tails) {
            t.material.uniforms.uHead.value.copy(pos);
            t.material.uniforms.uAxis.value.copy(axis);
          }
          e.tails[1].material.uniforms.uBend.value.copy(bend);
          const nu = e.parts.nucleus.material.uniforms;
          nu.uStarPos.value.copy(starPos);
          nu.uStarCol.value.copy(e.starCol);
        }
        this.pois.push({ o, pos: pos.clone(), r: 30, pass: 260, w: 1.4 });
      } else if (o.kind === 'blackhole') {
        const du = e.parts.disk.material.uniforms;
        du.uCenter.value.copy(pos);
        du.uNormal.value.copy(e.diskNormal);
        this.obstacles.push({ pos: pos.clone(), r: o.radius * 14 });
        this.pois.push({ o, pos: pos.clone(), r: o.radius, pass: o.radius * 24, w: 1.8 });
        this.bh = { pos: pos.clone(), r: o.radius, dist };
      } else if (o.kind === 'pulsar') {
        // magnetische as draait om de spin-as: de stralen vegen rond
        const spin = e.spinAxis;
        const tilt = new THREE.Vector3().crossVectors(spin, new THREE.Vector3(1, 0, 0)).normalize();
        const ang = time * 2.2;
        const mag = tilt.clone().applyAxisAngle(spin, ang).multiplyScalar(Math.sin(0.5)).addScaledVector(spin, Math.cos(0.5)).normalize();
        e.parts.jets.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mag);
        this.lights.push({ pos: pos.clone(), col: new THREE.Color(0.5, 0.65, 1.0).multiplyScalar(1.2), d: dist });
        this.obstacles.push({ pos: pos.clone(), r: 500 });
        this.pois.push({ o, pos: pos.clone(), r: 12, pass: 900, w: 1.6 });
        this.special = { pos: pos.clone(), r: 520, type: 1, d: dist };
      } else if (o.kind === 'pneb') {
        this.lights.push({ pos: pos.clone(), col: new THREE.Color(0.6, 0.9, 1.0).multiplyScalar(1.6), d: dist });
        this.pois.push({ o, pos: pos.clone(), r: 6, pass: o.radius * 1.9, w: 1.6 });
        if (!this.special || dist < this.special.d) this.special = { pos: pos.clone(), r: o.radius, type: 0, d: dist };
      }
    }
    this.lights.sort((a, b) => a.d - b.d);
    this.info = best ? { name: best.name, dist: bestD } : null;

    this.farTimer -= dt;
    if (this.farTimer <= 0) { this.farTimer = 1.5; this.rebuildFar(camTrue); }
    this.far.position.set(-this.origin.x + this.farOrigin.x, -this.origin.y + this.farOrigin.y, -this.origin.z + this.farOrigin.z);
  }

  updateDebris(e, cam, starPos) {
    const o = e.o, D = e.debris;
    const { n } = e.beltAxes;
    // hoe diep zitten we in de gordel?
    _v.copy(cam).sub(e.g.position);
    const h = _v.dot(n);
    const rr = Math.sqrt(Math.max(_v.lengthSq() - h * h, 0));
    const inside = Math.exp(-Math.pow((rr - o.radius) / o.width, 2) - Math.pow(h / o.thickness, 2));
    D.mesh.visible = inside > 0.05;
    if (!D.mesh.visible) return;
    const m4 = new THREE.Matrix4(), ps = new THREE.Vector3(), sc = new THREE.Vector3();
    const B = D.box;
    for (let i = 0; i < D.n; i++) {
      const b = D.base[i];
      ps.set(
        cam.x + ((((b[0] - cam.x) % B) + B) % B) - B / 2,
        cam.y + ((((b[1] - cam.y) % B) + B) % B) - B / 2,
        cam.z + ((((b[2] - cam.z) % B) + B) % B) - B / 2,
      );
      const s = b[3] * Math.min(1, inside * 1.5);
      sc.set(s, s * 0.8, s);
      _q.set(0, 0, 0, 1);
      m4.compose(ps, _q, sc);
      D.mesh.setMatrixAt(i, m4);
    }
    D.mesh.instanceMatrix.needsUpdate = true;
    const u = D.mesh.material.uniforms;
    if (starPos) u.uStarPos.value.copy(starPos);
    u.uStarCol.value.copy(e.starCol);
    u.uFadeCenter.value.copy(cam);
    u.uFadeR.value = B * 0.5;
  }

  rebuildFar(camTrue) {
    const list = this.universe.near(camTrue.x, camTrue.y, camTrue.z, 54000, []);
    const pos = [], col = [], lum = [];
    this.farOrigin = { x: camTrue.x, y: camTrue.y, z: camTrue.z };
    for (const o of list) {
      if (o.kind !== 'star' && o.kind !== 'pulsar' && o.kind !== 'pneb') continue;
      if (this.active.has(o.id)) continue;
      pos.push(o.pos[0] - camTrue.x, o.pos[1] - camTrue.y, o.pos[2] - camTrue.z);
      const c = o.kind === 'star' ? o.color : [0.75, 0.85, 1.0];
      col.push(c[0], c[1], c[2]);
      lum.push(o.kind === 'star' ? o.lum * (o.radius / 75) : 1.2);
    }
    this.farGeo.dispose();
    this.farGeo = new THREE.BufferGeometry();
    this.farGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.farGeo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    this.farGeo.setAttribute('aLum', new THREE.Float32BufferAttribute(lum, 1));
    this.far.geometry = this.farGeo;
  }
}

export { STAR_TYPES };
