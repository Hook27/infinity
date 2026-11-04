// De piloot boven de wolken: zweeft over de toppen, slalomt tussen torens, duikt af en toe
// dwars door een wolk, houdt afstand van onweer en zoekt zeldzame orkaanogen op.
import * as THREE from 'three';
import { createNoise2D } from '../../js/noise.js';

const wander = createNoise2D(311);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class Pilot {
  constructor(camera, weather, origin) {
    this.camera = camera;
    this.weather = weather;
    this.origin = origin;
    this.pos = new THREE.Vector3(0, 3200, 0);
    this.heading = 0.4;
    this.turn = 0;
    this.speed = 0;
    this.cruise = 85;
    this.paused = false;
    this.steer = 0;
    this.climb = 0;
    this.altOffset = 0;
    this.userTimer = 0;
    this.roll = 0;
    this.pitch = 0;
    this.lookYaw = 0; this.lookPitch = 0; this.lookYawT = 0; this.lookPitchT = 0;
    this.time = 0;
    this.dir = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this.storms = [];
    this.eyeVisited = new Set();
  }

  top(x, z) { return this.weather.topAt(x + this.origin.x, z + this.origin.z); }

  cost(x, z, alt) {
    const tp = this.top(x, z);
    let c = Math.max(0, tp - alt - 300) * 0.002;        // hoge torens: liever eromheen
    for (const s of this.storms) {
      const d = Math.hypot(x + this.origin.x - s.x, z + this.origin.z - s.z);
      c += Math.max(0, 1 - d / 5000) * 6;                // onweer op afstand houden
    }
    return c;
  }

  update(dt) {
    this.time += dt;
    const t = this.time, p = this.pos;
    this.speed = damp(this.speed, this.paused ? 0 : this.cruise, 0.8, dt);

    // koers: langzaam zwerven, weg van torens en onweer, soms naar een orkaanoog
    this.prefHeading = (this.prefHeading ?? this.heading) + wander(t * 0.004, 5.1) * 0.015 * dt;
    let auto = wander(t * 0.025, 1.7) * 0.07;
    const look = 1800;
    let terrain = 0;
    for (const side of [0.35, 0.75]) {
      const cl = this.cost(p.x + Math.sin(this.heading + side) * look, p.z + Math.cos(this.heading + side) * look, p.y);
      const cr = this.cost(p.x + Math.sin(this.heading - side) * look, p.z + Math.cos(this.heading - side) * look, p.y);
      terrain += (cr - cl) * 0.12;
    }
    terrain = THREE.MathUtils.clamp(terrain, -0.22, 0.22);
    const eye = this.weather.eye;
    if (eye && !this.eyeVisited.has(eye.id)) {
      const ex = eye.x - this.origin.x, ez = eye.z - this.origin.z;
      const d = Math.hypot(ex - p.x, ez - p.z);
      if (d < eye.R * 0.2) this.eyeVisited.add(eye.id);
      else if (d < eye.R * 3) this.prefHeading = Math.atan2(ex - p.x, ez - p.z);
    }
    let diff = this.prefHeading - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    auto += THREE.MathUtils.clamp(diff * 0.08, -0.1, 0.1);

    this.userTimer = Math.max(0, this.userTimer - dt);
    if (Math.abs(this.steer) > 0.02) { this.userTimer = 3.5; this.prefHeading = this.heading; }
    const autoW = 1 - Math.min(this.userTimer / 1.5, 1);
    this.turn = damp(this.turn, (auto + terrain) * autoW + this.steer * 0.6, 1.6, dt);
    this.heading += this.turn * dt;
    const dir = this.dir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    p.addScaledVector(dir, this.speed * dt);

    // hoogte: net boven de toppen; af en toe een duik dwars door een wolk
    this.altOffset = THREE.MathUtils.clamp(this.altOffset + this.climb * 300 * dt, -1500, 4000);
    const dive = Math.max(0, Math.sin(t * 0.021 - 1.2)) ** 12;   // zeldzame, korte duiken
    const clearance = 420 + 520 * (0.5 + 0.5 * Math.sin(t * 0.045)) - dive * 900 + this.altOffset;
    let target = 0;
    for (let i = 0; i <= 5; i++) {
      const d = i * 500;
      const tp = this.top(p.x + dir.x * d, p.z + dir.z * d);
      target = Math.max(target, (tp < 6500 ? tp : 0) - d * 0.06);
    }
    target = THREE.MathUtils.clamp(Math.max(target, 1800) + clearance, 1500, 7500);
    p.y = damp(p.y, target, target > p.y ? 0.35 : 0.2, dt);

    // camera
    this.lookYaw = damp(this.lookYaw, this.lookYawT, 3, dt);
    this.lookPitch = damp(this.lookPitch, this.lookPitchT, 3, dt);
    const vs = (target - p.y) * 0.0008;
    this.pitch = damp(this.pitch, THREE.MathUtils.clamp(vs - 0.06, -0.25, 0.15), 0.8, dt);
    this.roll = damp(this.roll, this.turn * 0.55, 1.5, dt);
    const yaw = this.heading + this.lookYaw;
    const pitch = this.pitch + this.lookPitch;
    this._l.set(p.x + Math.sin(yaw) * Math.cos(pitch) * 10, p.y + Math.sin(pitch) * 10, p.z + Math.cos(yaw) * Math.cos(pitch) * 10);
    const cam = this.camera;
    cam.position.copy(p);
    cam.up.set(0, 1, 0);
    cam.lookAt(this._l);
    cam.rotateZ(this.roll);
    return dir;
  }
}
