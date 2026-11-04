// Dag- en nachtcyclus: interpoleert kleuren en lichtwaarden tussen sleutelmomenten.
import * as THREE from 'three';
import { U } from './shaders.js';

// t: 0 = middernacht, 0.25 = zonsopkomst, 0.5 = middag, 0.75 = zonsondergang
const KEYS = [
  { t: 0.0, zen: '#04060f', hor: '#1a2146', sun: '#3a4f8f', light: '#6d86c8', li: 0.42, amb: 1.28, fog: 0.0026, glow: 1.0, stars: 1.0 },
  { t: 0.19, zen: '#090d2a', hor: '#2b2a55', sun: '#6a5080', light: '#7280bf', li: 0.38, amb: 1.20, fog: 0.0028, glow: 1.0, stars: 0.85 },
  { t: 0.245, zen: '#2c3c7a', hor: '#f0a08e', sun: '#ff9a6a', light: '#ffb78a', li: 0.9, amb: 0.75, fog: 0.0034, glow: 0.55, stars: 0.15 },
  { t: 0.32, zen: '#3c7ad4', hor: '#b6d3ec', sun: '#ffe2b0', light: '#fff0d8', li: 1.15, amb: 0.48, fog: 0.0022, glow: 0.05, stars: 0 },
  { t: 0.5, zen: '#2a68cc', hor: '#a6ccec', sun: '#fff4dc', light: '#fff6e6', li: 1.2, amb: 0.42, fog: 0.0020, glow: 0.0, stars: 0 },
  { t: 0.64, zen: '#3f66bd', hor: '#eccc9c', sun: '#ffc47a', light: '#ffd9a4', li: 1.2, amb: 0.45, fog: 0.0022, glow: 0.05, stars: 0 },
  { t: 0.715, zen: '#343a84', hor: '#ff9560', sun: '#ff7a40', light: '#ffa060', li: 1.1, amb: 0.55, fog: 0.0026, glow: 0.3, stars: 0 },
  { t: 0.765, zen: '#1c1a4c', hor: '#b84e6c', sun: '#ff5a5a', light: '#d07090', li: 0.55, amb: 0.82, fog: 0.0030, glow: 0.8, stars: 0.35 },
  { t: 0.84, zen: '#070a22', hor: '#262452', sun: '#5a4a8a', light: '#6a78bb', li: 0.42, amb: 1.20, fog: 0.0027, glow: 1.0, stars: 1.0 },
  { t: 1.0, zen: '#04060f', hor: '#1a2146', sun: '#3a4f8f', light: '#6d86c8', li: 0.42, amb: 1.28, fog: 0.0026, glow: 1.0, stars: 1.0 },
].map((k) => ({ ...k, zen: new THREE.Color(k.zen), hor: new THREE.Color(k.hor), sun: new THREE.Color(k.sun), light: new THREE.Color(k.light) }));

const _a = new THREE.Color(), _b = new THREE.Color();
const smooth = (x) => x * x * (3 - 2 * x);

export class DayCycle {
  constructor(start = 0.69, duration = 420) {
    this.t = start;
    this.target = start;
    this.duration = duration; // seconden per volledige dag
    this.state = { night: 0, stars: 0, glow: 0, sunY: 0 };
  }

  skip(amount = 0.125) { this.target += amount; }

  update(dt) {
    this.target += dt / this.duration;
    const diff = this.target - this.t;
    this.t += diff > 0.002 ? Math.min(diff, Math.max(diff * 2.2, 0.02) * dt) : diff;
    const t = ((this.t % 1) + 1) % 1;

    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
    const A = KEYS[i], B = KEYS[i + 1];
    const f = smooth((t - A.t) / (B.t - A.t));
    const L = (k) => A[k] + (B[k] - A[k]) * f;

    U.uZenith.value.copy(A.zen).lerp(B.zen, f);
    U.uHorizon.value.copy(A.hor).lerp(B.hor, f);
    U.uSunCol.value.copy(A.sun).lerp(B.sun, f);

    // zonnestand
    const ang = (t - 0.25) * Math.PI * 2;
    const sunY = Math.sin(ang) * 0.82;
    const sun = U.uSunDir.value.set(Math.cos(ang) * 0.9, sunY, 0.38).normalize();
    const moon = U.uMoonDir.value.set(-Math.cos(ang) * 0.85, -sunY * 0.9 + 0.08, -0.45).normalize();
    const sunVis = THREE.MathUtils.smoothstep(sunY, -0.12, 0.05);
    U.uSunVis.value = sunVis;
    U.uMoonVis.value = THREE.MathUtils.smoothstep(moon.y, -0.05, 0.12);

    // hoofdlicht: zon overdag, maan 's nachts; rond de horizon kort uitdoven
    const li = L('li');
    _a.copy(A.light).lerp(B.light, f);
    if (sunY > 0) {
      U.uLightDir.value.copy(sun);
      U.uLightCol.value.copy(_a).multiplyScalar(li * THREE.MathUtils.smoothstep(sunY, 0.0, 0.08));
    } else {
      U.uLightDir.value.copy(moon);
      U.uLightCol.value.copy(_a).multiplyScalar(li * THREE.MathUtils.smoothstep(moon.y, 0.0, 0.1));
    }
    U.uLightDir.value.y = Math.max(U.uLightDir.value.y, 0.06);
    U.uLightDir.value.normalize();

    const amb = L('amb');
    _b.copy(U.uZenith.value).lerp(U.uHorizon.value, 0.45);
    U.uAmbSky.value.copy(_b).multiplyScalar(amb * 0.95).addScalar(0.012);
    U.uAmbGround.value.copy(U.uHorizon.value).multiplyScalar(amb * 0.32).addScalar(0.006);

    U.uFogDensity.value = L('fog');
    U.uGlow.value = L('glow');
    U.uStars.value = L('stars');
    U.uNight.value = THREE.MathUtils.clamp(L('glow'), 0, 1);

    this.state.night = U.uNight.value;
    this.state.sunY = sunY;
    this.tod = t;
    return this.state;
  }

  clock() {
    const mins = Math.floor((((this.t % 1) + 1) % 1) * 24 * 60);
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  }
}
