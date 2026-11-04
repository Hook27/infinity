// Naadloos herhalende 3D-ruistextuur (64³, RGBA). De GPU gebruikt hem voor nevels, sterren en
// planeten; de CPU leest exact dezelfde data (trilineair) voor gebieden en de piloot.
//   R: zachte fbm (grote vormen)        G: omgekeerde Worley (bolle cellen, filamenten)
//   B: tweede fbm (andere zaadwaarde)   A: fijne detail-fbm
import * as THREE from 'three';

export const N = 64;

function hash3(x, y, z, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return h >>> 0;
}
export function hashFloat(x, y, z, seed = 0) {
  return hash3(x | 0, y | 0, z | 0, seed) / 4294967296;
}

const GR = [];
for (let i = 0; i < 64; i++) {
  // gelijkmatig verdeelde gradiënten op een bol
  const t = (i + 0.5) / 64, phi = Math.acos(1 - 2 * t), th = i * 2.399963;
  GR.push([Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)]);
}
const mod = (a, n) => ((a % n) + n) % n;
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function perlin(x, y, z, per, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  let r = 0;
  const vals = [0, 0, 0, 0, 0, 0, 0, 0];
  let k = 0;
  for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    const g = GR[hash3(mod(xi + dx, per), mod(yi + dy, per), mod(zi + dz, per), seed) & 63];
    vals[k++] = g[0] * (xf - dx) + g[1] * (yf - dy) + g[2] * (zf - dz);
  }
  const l = (a, b, t) => a + (b - a) * t;
  r = l(l(l(vals[0], vals[1], u), l(vals[2], vals[3], u), v), l(l(vals[4], vals[5], u), l(vals[6], vals[7], u), v), w);
  return r * 1.6; // ongeveer [-1, 1]
}

function worley(x, y, z, per, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz;
    const h = hash3(mod(cx, per), mod(cy, per), mod(cz, per), seed);
    const fx = cx + (h & 1023) / 1023, fy = cy + ((h >>> 10) & 1023) / 1023, fz = cz + ((h >>> 20) & 1023) / 1023;
    const d = (fx - x) ** 2 + (fy - y) ** 2 + (fz - z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function makeNoiseData() {
  const data = new Uint8Array(N * N * N * 4);
  let k = 0;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N, v = y / N, w = z / N;
        const r = perlin(u * 4, v * 4, w * 4, 4, 1) * 0.55 + perlin(u * 8, v * 8, w * 8, 8, 2) * 0.3 + perlin(u * 16, v * 16, w * 16, 16, 3) * 0.15;
        const g = 1 - (worley(u * 4, v * 4, w * 4, 4, 4) * 0.65 + worley(u * 8, v * 8, w * 8, 8, 5) * 0.35) * 1.15;
        const b = perlin(u * 4, v * 4, w * 4, 4, 6) * 0.55 + perlin(u * 8, v * 8, w * 8, 8, 7) * 0.3 + perlin(u * 16, v * 16, w * 16, 16, 8) * 0.15;
        const a = perlin(u * 16, v * 16, w * 16, 16, 9) * 0.65 + perlin(u * 32, v * 32, w * 32, 32, 10) * 0.35;
        data[k++] = Math.max(0, Math.min(255, Math.round((r * 0.5 + 0.5) * 255)));
        data[k++] = Math.max(0, Math.min(255, Math.round(g * 255)));
        data[k++] = Math.max(0, Math.min(255, Math.round((b * 0.5 + 0.5) * 255)));
        data[k++] = Math.max(0, Math.min(255, Math.round((a * 0.5 + 0.5) * 255)));
      }
    }
  }
  return data;
}

export function makeNoiseTexture(data) {
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// trilineaire bemonstering zoals de GPU: coördinaten in textuureenheden (1 = één herhaling)
export function makeSampler(data) {
  return function sample(ch, x, y, z) {
    const fx = x * N - 0.5, fy = y * N - 0.5, fz = z * N - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const X0 = mod(x0, N), X1 = mod(x0 + 1, N), Y0 = mod(y0, N), Y1 = mod(y0 + 1, N), Z0 = mod(z0, N), Z1 = mod(z0 + 1, N);
    const at = (X, Y, Z) => data[((Z * N + Y) * N + X) * 4 + ch];
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(at(X0, Y0, Z0), at(X1, Y0, Z0), tx), l(at(X0, Y1, Z0), at(X1, Y1, Z0), tx), ty),
      l(l(at(X0, Y0, Z1), at(X1, Y0, Z1), tx), l(at(X0, Y1, Z1), at(X1, Y1, Z1), tx), ty),
      tz) / 255;
  };
}
