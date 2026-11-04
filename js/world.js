// De wereldfunctie: hoogte en temperatuur (bioom) voor elk punt, overal en eindeloos.
import { createNoise2D, clamp, lerp, smoothstep } from './noise.js';

export const SEED = 20261104;

const nC = createNoise2D(SEED + 1);   // continenten
const nH = createNoise2D(SEED + 2);   // heuvels
const nR = createNoise2D(SEED + 3);   // bergruggen
const nW = createNoise2D(SEED + 4);   // domain warp
const nRv = createNoise2D(SEED + 5);  // rivieren
const nT = createNoise2D(SEED + 6);   // temperatuur
const nF = createNoise2D(SEED + 7);   // bossen / clusters
const nD = createNoise2D(SEED + 8);   // fijn detail

// Verschuiving van de 'floating origin': scènecoördinaten + origin = echte wereldcoördinaten.
export const origin = { x: 0, z: 0 };

export const BIOMES = [
  { name: 'De Gouden Duinen', sub: 'zandsteen, stilte en eeuwenoude bogen' },
  { name: 'Smaragdgroene Weiden', sub: 'glooiende heuvels onder een open hemel' },
  { name: 'De Bloesemvallei', sub: 'waar lantaarns de schemer verlichten' },
  { name: 'De Amberwouden', sub: 'een eeuwige herfst van rood en goud' },
  { name: 'De Kristalvlakten', sub: 'ijs, sterrenlicht en zingende kristallen' },
];

function fbm(noise, x, z, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += noise(x * f, z * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

function ridged(noise, x, z, oct) {
  let sum = 0, amp = 0.55, f = 1, prev = 1;
  for (let i = 0; i < oct; i++) {
    // 'zachte' absolute waarde: ronde in plaats van messcherpe kammen (voorkomt zaagtanden)
    const v = noise(x * f, z * f);
    let n = 1 - Math.sqrt(v * v + 0.004);
    n *= n;
    sum += n * amp * prev;
    prev = n;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum;
}

export function temperatureAt(x, z) {
  return clamp(0.5 + 0.95 * fbm(nT, x * 0.00045, z * 0.00045, 3), 0, 1);
}

// Vult out = { h, t } in voor echte wereldcoördinaten.
export function sampleWorld(x, z, out) {
  const wx = x + 45 * nW(x * 0.0025, z * 0.0025);
  const wz = z + 45 * nW(x * 0.0025 + 71.3, z * 0.0025 - 13.7);

  const cont = fbm(nC, wx * 0.0008, wz * 0.0008, 3);
  const hills = fbm(nH, wx * 0.0065, wz * 0.0065, 4);
  const ridge = ridged(nR, wx * 0.0026, wz * 0.0026, 4);
  const mMask = smoothstep(0.02, 0.42, cont);

  let h = 7 + cont * 16 + hills * 8 + ridge * ridge * mMask * 105;
  // fijne glooiing zodat het terrein van dichtbij natuurlijk oogt
  h += nD(x * 0.045, z * 0.045) * 0.9 + nD(x * 0.11 + 37, z * 0.11 - 11) * 0.3;

  let t = temperatureAt(x, z);
  // hogere gebieden zijn kouder
  t = clamp(t - Math.max(h - 30, 0) * 0.0028, 0, 1);

  // woestijn: terrassen en mesa's
  const desert = 1 - smoothstep(0.1, 0.2, t);
  if (desert > 0.001 && h > 2) {
    const step = 8.5;
    const k = h / step;
    const fl = Math.floor(k);
    const q = (fl + smoothstep(0.7, 0.95, k - fl)) * step;
    h = lerp(h, q, desert * 0.9);
  }

  // kronkelende rivieren
  const r = Math.abs(nRv(wx * 0.0014, wz * 0.0014) + 0.25 * nRv(wx * 0.006, wz * 0.006));
  // brede, glooiende dalen in plaats van steile kloven
  const river = smoothstep(0.012, 0.2, r);
  h = lerp(-3.2, h, river * river * (1.6 - 0.6 * river));

  out.h = h;
  out.t = t;
  return out;
}

const _s = { h: 0, t: 0 };
export function heightAt(x, z) {
  return sampleWorld(x, z, _s).h;
}

// voor de scène: x/z zijn scènecoördinaten
export function heightScene(x, z) {
  return sampleWorld(x + origin.x, z + origin.z, _s).h;
}

export function forestAt(x, z) {
  return fbm(nF, x * 0.011, z * 0.011, 2);
}

export function biomeIndex(t) {
  return clamp(Math.round(t * 4), 0, 4);
}
