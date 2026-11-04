// Het weer boven de wolken: welke wolken staan waar, hoe hoog ze reiken, waar onweer zit en waar
// de zeldzame orkaanogen liggen. Dezelfde formules staan in de wolkenshader (WEATHER_GLSL), en de
// CPU leest dezelfde ruistextuur, zodat piloot, onweer en beeld het altijd met elkaar eens zijn.
// Alle posities hier zijn echte wereldcoördinaten in meters.
import { hashFloat } from '../../ruimte/js/noise3d.js';

export const F_REG = 1 / 260000; // gebieden
export const F_W = 1 / 16000;    // wolkenvelden
export const F_S = 1 / 3600;     // 3D-vorm
export const F_D = 1 / 800;      // detail
export const EYE_CELL = 160000;

export const REGIONS = [
  { name: 'De Wolkenzee', sub: 'een eindeloze deken onder een open hemel' },
  { name: 'De Torens', sub: 'wolkenreuzen, bliksem en donder' },
  { name: 'De Passaat', sub: 'losse wolken in een warme wind' },
  { name: 'Het Poolgebied', sub: 'ijle sluiers en het licht van het noorden' },
  { name: 'Het Oog', sub: 'de stilte in het hart van de storm' },
];

const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

export class Weather {
  constructor(sample) {
    this.s = sample;
    this.eye = null;
  }

  // dichtstbijzijnde orkaanoog (of null)
  eyeNear(x, z) {
    const ci = Math.floor(x / EYE_CELL), cj = Math.floor(z / EYE_CELL);
    let best = null, bd = Infinity;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      if (hashFloat(i, 0, j, 501) > 0.22) continue;
      const ex = (i + 0.2 + hashFloat(i, 1, j, 502) * 0.6) * EYE_CELL;
      const ez = (j + 0.2 + hashFloat(i, 2, j, 503) * 0.6) * EYE_CELL;
      const R = 18000 + hashFloat(i, 3, j, 504) * 8000;
      const d = Math.hypot(x - ex, z - ez);
      if (d < bd) { bd = d; best = { x: ex, z: ez, R, d, id: i + ',' + j }; }
    }
    return best;
  }

  // vult out met: mask (0..1 bewolking), base, thick, storm, regiogewichten
  at(x, z, out = {}, eye = this.eye) {
    const s = this.s;
    const r1 = s(0, x * F_REG + 0.13, 0.37, z * F_REG + 0.29);
    const r2 = s(2, x * F_REG + 0.57, 0.61, z * F_REG + 0.83);
    const r3 = s(0, x * F_REG + 0.71, 0.83, z * F_REG + 0.05);
    const sea = sm(0.5, 0.6, r1);
    const tow = sm(0.47, 0.57, r2) * (1 - sea);
    const pol = sm(0.57, 0.65, r3);
    const pas = Math.max(0, 1 - sea - tow);
    const n = sea + tow + pas + 1e-5;
    let cov = (sea * 0.86 + tow * 0.52 + pas * 0.42) / n;
    let tLow = (sea * 450 + tow * 900 + pas * 500) / n;
    let tHigh = (sea * 1000 + tow * 9500 + pas * 2300) / n;
    const base = (sea * 1500 + tow * 1500 + pas * 1300) / n;
    cov *= 1 - pol * 0.45;
    tHigh *= 1 - pol * 0.6;

    const w = s(0, x * F_W, 0.37, z * F_W) * 0.7 + s(1, x * F_W * 3, 1.11, z * F_W * 3) * 0.3;
    let mask = sm(1 - cov, 1 - cov + 0.2, w);
    const tallN = s(2, x * F_W, 0.37, z * F_W);
    let tall = sm(0.36, 0.62, tallN) * sm(0.08, 0.45, mask);
    let eyeW = 0;
    if (eye) {
      const dx = x - eye.x, dz = z - eye.z;
      const r = Math.hypot(dx, dz), R = eye.R;
      eyeW = 1 - sm(R * 1.3, R * 1.8, r);
      if (eyeW > 0) {
        const ang = Math.atan2(dz, dx);
        const wall = Math.exp(-Math.pow((r - R * 0.55) / (R * 0.16), 2));
        const spiral = (0.5 + 0.5 * Math.sin(ang * 2 - Math.log(Math.max(r, 1) / R) * 7)) * sm(R * 0.7, R * 0.9, r);
        const eyeMask = Math.max(wall, spiral * 0.75 * w * 1.4) * sm(R * 0.3, R * 0.42, r);
        mask = mix(mask, Math.min(1, eyeMask * 1.2), eyeW);
        tall = mix(tall, wall, eyeW);
        tHigh = mix(tHigh, 12000, eyeW);
        tLow = mix(tLow, 1500, eyeW);
      }
    }
    out.mask = mask;
    out.base = base;
    out.thick = mix(tLow, tHigh, Math.pow(tall, 1.3)) * (0.45 + 0.55 * mask);
    out.storm = Math.max(tow, eyeW) * sm(0.55, 0.85, tall) * mask;
    out.w = { sea, tow, pas, pol, eye: eyeW };
    return out;
  }

  topAt(x, z) {
    const o = this.at(x, z, _o);
    return o.mask > 0.05 ? o.base + o.thick * Math.min(1, o.mask * 1.25) : 0;
  }

  regionAt(x, z) {
    const o = this.at(x, z, _o);
    const w = o.w;
    if (w.eye > 0.5) return 4;
    if (w.pol > 0.5) return 3;
    if (w.sea >= w.tow && w.sea >= w.pas) return 0;
    return w.tow >= w.pas ? 1 : 2;
  }

  // onweerscellen rond een punt (lokale maxima van het stormveld)
  storms(x, z, radius = 30000, step = 1500) {
    const cells = [];
    const n = Math.ceil(radius / step);
    const grid = [];
    for (let j = -n; j <= n; j++) {
      const row = [];
      for (let i = -n; i <= n; i++) {
        const gx = Math.round(x / step + i) * step, gz = Math.round(z / step + j) * step;
        const o = this.at(gx, gz, _o);
        row.push({ x: gx, z: gz, s: o.storm, top: o.base + o.thick, base: o.base });
      }
      grid.push(row);
    }
    for (let j = 1; j < grid.length - 1; j++) for (let i = 1; i < grid[j].length - 1; i++) {
      const c = grid[j][i];
      if (c.s < 0.35) continue;
      let max = true;
      for (let dj = -1; dj <= 1 && max; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && grid[j + dj][i + di].s > c.s) { max = false; break; }
      if (max) cells.push(c);
    }
    return cells;
  }
}
const _o = {};

// dezelfde berekening in GLSL (gedeeld door wolkenpass en schaduwloze 'goedkope' dichtheid)
export const WEATHER_GLSL = /* glsl */ `
uniform vec3 uOffR;
uniform vec3 uOffW;
uniform vec3 uOffS;
uniform vec3 uOffD;
uniform vec4 uEye;  // xz scènepositie, z straal, w actief
const float F_REG = ${F_REG};
const float F_W = ${F_W};
const float F_S = ${F_S};
const float F_D = ${F_D};
float smo(float a, float b, float v) { return smoothstep(a, b, v); }
// gebiedsparameters veranderen traag (90 km): één keer per straal berekenen
// P = (dekking, dikte laag, dikte hoog, basis), P2 = (torens, pool)
void regionParams(vec2 xz, out vec4 P, out vec2 P2) {
  vec3 qr = vec3(xz.x * F_REG, 0.0, xz.y * F_REG) + uOffR;
  float r1 = nz(qr + vec3(0.13, 0.37, 0.29)).r;
  float r2 = nz(qr + vec3(0.57, 0.61, 0.83)).b;
  float r3 = nz(qr + vec3(0.71, 0.83, 0.05)).r;
  float sea = smo(0.5, 0.6, r1);
  float tow = smo(0.47, 0.57, r2) * (1.0 - sea);
  float pol = smo(0.57, 0.65, r3);
  float pas = max(0.0, 1.0 - sea - tow);
  float n = sea + tow + pas + 1e-5;
  float cov = (sea * 0.86 + tow * 0.52 + pas * 0.42) / n;
  float tLow = (sea * 450.0 + tow * 900.0 + pas * 500.0) / n;
  float tHigh = (sea * 1000.0 + tow * 9500.0 + pas * 2300.0) / n;
  float base = (sea * 1500.0 + tow * 1500.0 + pas * 1300.0) / n;
  P = vec4(cov * (1.0 - pol * 0.45), tLow, tHigh * (1.0 - pol * 0.6), base);
  P2 = vec2(tow, pol);
}
// lokaal weer: mask, basis, dikte, storm
vec4 localWeather(vec2 xz, vec4 P, vec2 P2) {
  float cov = P.x, tLow = P.y, tHigh = P.z;
  vec3 qw = vec3(xz.x * F_W, 0.37, xz.y * F_W) + uOffW;
  float w = nz(qw).r * 0.7 + nz(qw * 3.0).g * 0.3;
  float mask = smo(1.0 - cov, 1.0 - cov + 0.2, w);
  float tallN = nz(qw).b;
  float tall = smo(0.36, 0.62, tallN) * smo(0.08, 0.45, mask);
  float eyeW = 0.0;
  if (uEye.w > 0.5) {
    vec2 d = xz - uEye.xy;
    float r = length(d), R = uEye.z;
    eyeW = 1.0 - smo(R * 1.3, R * 1.8, r);
    if (eyeW > 0.0) {
      float ang = atan(d.y, d.x);
      float wall = exp(-pow((r - R * 0.55) / (R * 0.16), 2.0));
      float spiral = (0.5 + 0.5 * sin(ang * 2.0 - log(max(r, 1.0) / R) * 7.0)) * smo(R * 0.7, R * 0.9, r);
      float eyeMask = max(wall, spiral * 0.75 * w * 1.4) * smo(R * 0.3, R * 0.42, r);
      mask = mix(mask, min(1.0, eyeMask * 1.2), eyeW);
      tall = mix(tall, wall, eyeW);
      tHigh = mix(tHigh, 12000.0, eyeW);
      tLow = mix(tLow, 1500.0, eyeW);
    }
  }
  float thick = mix(tLow, tHigh, pow(tall, 1.3)) * (0.45 + 0.55 * mask);
  float storm = max(P2.x, eyeW) * smo(0.55, 0.85, tall) * mask;
  return vec4(mask, P.w, thick, storm);
}
`;
