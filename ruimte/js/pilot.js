// De automatische piloot in 3D: kiest steeds een volgende bezienswaardigheid vóór zich, scheert
// er op een mooie afstand langs, ontwijkt botsingen, past de snelheid aan de omgeving aan en laat
// zich bijsturen (draaien, stijgen/dalen, snelheid).
import * as THREE from 'three';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class Pilot {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.speed = 0;
    this.factor = 1;      // snelheidsfactor van de gebruiker
    this.paused = false;
    this.yawIn = 0;       // -1..1 (+ = links)
    this.pitchIn = 0;     // -1..1 (+ = omhoog)
    this.userTimer = 0;
    this.target = null;
    this.side = new THREE.Vector3();
    this.visited = new Map();
    this.bank = 0;
    this.yawRate = 0;
    this.lookYaw = 0; this.lookPitch = 0; this.lookYawT = 0; this.lookPitchT = 0;
    this.time = 0;
    this.skip = false;
    this.wanderSeed = Math.random() * 100;
  }

  next() { this.skip = true; }

  choose(pois) {
    let best = null, bestS = 0;
    for (const p of pois) {
      if (this.visited.has(p.o.id) && !p.belt) continue;
      if (this.target && p.o.id === this.target.o.id) continue;
      _a.copy(p.pos).sub(this.pos);
      const d = _a.length();
      if (d < p.pass * 1.2 || d > 45000) continue;
      const ahead = _a.divideScalar(d).dot(this.fwd);
      if (ahead < -0.1) continue;
      const s = p.w * (0.25 + Math.max(ahead, 0)) / (1 + d / 12000) * (p.belt ? 0.5 : 1);
      if (s > bestS) { bestS = s; best = p; }
    }
    return best;
  }

  update(dt, pois, obstacles) {
    this.time += dt;
    const t = this.time;
    // bezienswaardigheid kiezen of loslaten
    if (this.target) {
      const fresh = pois.find((p) => p.o.id === this.target.o.id);
      if (fresh) this.target = fresh; else this.target = null;
    }
    if (this.target) {
      _a.copy(this.target.pos).sub(this.pos);
      const d = _a.length();
      const behind = _a.dot(this.fwd) < 0;
      if ((behind && d < this.target.pass * 3 + 600) || (this.target.belt && d < 400) || this.skip) {
        this.visited.set(this.target.o.id, t);
        this.target = null;
      }
    }
    this.skip = false;
    for (const [id, when] of this.visited) if (t - when > 600) this.visited.delete(id);
    if (!this.target && this.userTimer <= 0) {
      this.target = this.choose(pois);
      if (this.target) {
        // langs welke kant scheren we? kies de kant waar we al een beetje naartoe kijken
        _a.copy(this.target.pos).sub(this.pos).normalize();
        this.side.crossVectors(_a, this.up).normalize();
        if (Math.random() < 0.5) this.side.negate();
        this.side.addScaledVector(this.up, 0.35).normalize();
      }
    }

    // gewenste richting
    const desired = _b.copy(this.fwd);
    if (this.target && this.userTimer <= 0) {
      const aim = _c.copy(this.target.pos).addScaledVector(this.side, this.target.pass);
      desired.copy(aim).sub(this.pos).normalize();
    } else if (this.userTimer <= 0) {
      // zwerven: langzame bocht
      desired.applyAxisAngle(this.up, Math.sin(t * 0.05 + this.wanderSeed) * 0.12 * dt * 10);
    }
    // botsingen vermijden
    let nearest = Infinity;
    for (const ob of obstacles) {
      _a.copy(this.pos).sub(ob.pos);
      const d = _a.length();
      nearest = Math.min(nearest, d - ob.r * 0.4);
      if (d < ob.r * 1.5) {
        const push = (ob.r * 1.5 - d) / (ob.r * 1.5);
        desired.addScaledVector(_a.divideScalar(d), push * 2.5);
      }
    }
    desired.normalize();

    // draaien richting gewenst, plus de input van de gebruiker
    this.userTimer = Math.max(0, this.userTimer - dt);
    if (Math.abs(this.yawIn) > 0.02 || Math.abs(this.pitchIn) > 0.02) { this.userTimer = 2.5; this.target = null; }
    const angle = Math.acos(THREE.MathUtils.clamp(this.fwd.dot(desired), -1, 1));
    const maxRate = this.target && this.target.pass > 0 ? 0.22 : 0.15;
    let yaw = 0;
    if (angle > 1e-4) {
      const axis = _a.crossVectors(this.fwd, desired).normalize();
      const step = Math.min(angle, maxRate * dt * (0.4 + Math.min(angle * 3, 1)));
      _q.setFromAxisAngle(axis, step);
      this.fwd.applyQuaternion(_q);
      yaw = axis.dot(this.up) * step / dt;
    }
    if (this.yawIn) { this.fwd.applyAxisAngle(this.up, this.yawIn * 0.7 * dt); yaw += this.yawIn * 0.7; }
    if (this.pitchIn) {
      const right = _a.crossVectors(this.fwd, this.up).normalize();
      this.fwd.applyAxisAngle(right, this.pitchIn * 0.55 * dt);
      this.up.applyAxisAngle(right, this.pitchIn * 0.55 * dt);
    }
    this.fwd.normalize();
    // up recht houden t.o.v. de wereld, zonder over de kop te gaan
    this.up.addScaledVector(this.fwd, -this.up.dot(this.fwd)).normalize();
    _a.copy(WORLD_UP).addScaledVector(this.fwd, -WORLD_UP.dot(this.fwd));
    if (_a.lengthSq() > 0.01) this.up.lerp(_a.normalize(), Math.min(1, dt * 0.15)).normalize();

    // snelheid: langzaam bij objecten, snel in de leegte
    const base = THREE.MathUtils.clamp(nearest * 0.12, 30, 900);
    const target = this.paused ? 0 : base * this.factor;
    this.speed = damp(this.speed, target, target > this.speed ? 0.5 : 1.4, dt);
    this.pos.addScaledVector(this.fwd, this.speed * dt);

    // camera met overhelling in bochten en wat rondkijken
    this.yawRate = damp(this.yawRate, yaw, 2, dt);
    this.bank = damp(this.bank, THREE.MathUtils.clamp(this.yawRate * 1.6, -0.45, 0.45), 1.5, dt);
    this.lookYaw = damp(this.lookYaw, this.lookYawT, 3, dt);
    this.lookPitch = damp(this.lookPitch, this.lookPitchT, 3, dt);
    const cam = this.camera;
    cam.position.copy(this.pos);
    const look = _a.copy(this.fwd).applyAxisAngle(this.up, this.lookYaw);
    const right = _b.crossVectors(look, this.up).normalize();
    look.applyAxisAngle(right, this.lookPitch);
    cam.up.copy(this.up).applyAxisAngle(this.fwd, -this.bank);
    cam.lookAt(_c.copy(this.pos).add(look));
    return nearest;
  }
}
