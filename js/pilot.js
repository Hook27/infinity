// De automatische piloot: glijdt door het landschap, volgt dalen, ontwijkt bergen
// en laat zich een beetje bijsturen door de kijker.
import * as THREE from 'three';
import { heightScene } from './world.js';
import { createNoise2D } from './noise.js';

const wander = createNoise2D(99);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class Pilot {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 30, 0);
    this.heading = 0.6;
    this.turn = 0;
    this.speed = 0;
    this.cruise = 15;
    this.paused = false;
    this.steer = 0;          // -1..1 van de gebruiker (+ = links)
    this.climb = 0;          // -1..1 hoogte-bijsturing
    this.userTimer = 0;
    this.altOffset = 0;
    this.lookYaw = 0; this.lookPitch = 0;
    this.lookYawT = 0; this.lookPitchT = 0;
    this.roll = 0;
    this.pitch = -0.12;
    this.time = 0;
    this.dir = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  cost(h) {
    // voorkeur voor glooiende hoogtes; vermijd hoge bergen en lange stukken water
    return h < 0 ? 14 - h * 0.5 : Math.abs(h - 9) * (h > 9 ? 0.9 : 0.6);
  }

  place(x, z) {
    this.pos.set(x, Math.max(heightScene(x, z), 0) + 12, z);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const p = this.pos;

    // snelheid
    const target = this.paused ? 0 : this.cruise;
    this.speed = damp(this.speed, target, 1.2, dt);

    // automatische koers
    // langzaam verschuivende voorkeursrichting zodat de reis echt vooruit gaat
    this.prefHeading = (this.prefHeading ?? this.heading) + wander(t * 0.004, 11.3) * 0.02 * dt;
    let diff = this.prefHeading - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const auto = wander(t * 0.03, 3.7) * 0.1 + THREE.MathUtils.clamp(diff * 0.08, -0.12, 0.12);
    let terrain = 0;
    const look = 70;
    for (const side of [0.4, 0.8]) {
      const hl = heightScene(p.x + Math.sin(this.heading + side) * look, p.z + Math.cos(this.heading + side) * look);
      const hr = heightScene(p.x + Math.sin(this.heading - side) * look, p.z + Math.cos(this.heading - side) * look);
      terrain += (this.cost(hr) - this.cost(hl)) * 0.006;
    }
    terrain = THREE.MathUtils.clamp(terrain, -0.32, 0.32);

    this.userTimer = Math.max(0, this.userTimer - dt);
    if (Math.abs(this.steer) > 0.02) { this.userTimer = 3.5; this.prefHeading = this.heading; }
    const autoW = 1 - Math.min(this.userTimer / 1.5, 1);
    const targetTurn = (auto + terrain) * autoW + this.steer * 0.85;
    this.turn = damp(this.turn, targetTurn, 2.2, dt);
    this.heading += this.turn * dt * Math.min(1, 0.3 + this.speed / this.cruise);

    const dir = this.dir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    p.addScaledVector(dir, this.speed * dt);

    // hoogte: kijk vooruit naar de hoogste grond op de route
    this.altOffset = THREE.MathUtils.clamp(this.altOffset + this.climb * 14 * dt, -6, 60);
    const clearance = 9 + 5 * Math.sin(t * 0.035) + this.altOffset;
    let tgt = -1e9;
    for (let i = 0; i <= 6; i++) {
      const d = i * 14;
      const h = Math.max(heightScene(p.x + dir.x * d, p.z + dir.z * d), 0);
      tgt = Math.max(tgt, h + clearance - d * 0.06);
    }
    const hereH = Math.max(heightScene(p.x, p.z), 0);
    const up = tgt > p.y;
    p.y = damp(p.y, tgt, up ? 1.3 : 0.45, dt);
    p.y = Math.max(p.y, hereH + 3);

    // camera-oriëntatie
    this.lookYaw = damp(this.lookYaw, this.lookYawT, 3, dt);
    this.lookPitch = damp(this.lookPitch, this.lookPitchT, 3, dt);
    const ahead = Math.max(heightScene(p.x + dir.x * 45, p.z + dir.z * 45), 0);
    const pitchT = THREE.MathUtils.clamp((ahead - p.y) / 70, -0.32, 0.08) - 0.05;
    this.pitch = damp(this.pitch, pitchT, 1.1, dt);
    this.roll = damp(this.roll, this.turn * 0.4, 2.0, dt);

    const yaw = this.heading + this.lookYaw;
    const pitch = this.pitch + this.lookPitch + Math.sin(t * 0.4) * 0.008;
    this._look.set(p.x + Math.sin(yaw) * Math.cos(pitch) * 10, p.y + Math.sin(pitch) * 10, p.z + Math.cos(yaw) * Math.cos(pitch) * 10);
    const cam = this.camera;
    cam.position.set(p.x, p.y + Math.sin(t * 0.7) * 0.15, p.z);
    cam.lookAt(this._look);
    cam.rotateZ(this.roll);
    return dir;
  }
}
