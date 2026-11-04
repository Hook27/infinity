// Het heelal: verdeeld in kubusvormige sectoren met vaste, uit hashes afgeleide inhoud
// (sterrenstelsels met planeten, gordels, kometen en zeldzame objecten), plus grote gebieden
// die uit de 3D-ruis volgen. Alle posities hier zijn echte wereldcoördinaten (doubles).
import { hashFloat } from './noise3d.js';

export const SECTOR = 6000;
export const F_NEB = 1 / 9000;   // nevelschaal (textuureenheden per wereldeenheid)
export const F_REG = 1 / 60000;  // gebiedsschaal

export const REGIONS = [
  { name: 'De Rode Nevel', sub: 'waterstof gloeit rond pasgeboren sterren' },
  { name: 'Het Blauwe Cluster', sub: 'jonge reuzen in een sluier van sterrenstof' },
  { name: 'De Gordel', sub: 'werelden, manen en eindeloze rotsen' },
  { name: 'De Leegte', sub: 'stilte tussen de sterrenstelsels' },
  { name: 'De Draaikolk', sub: 'waar zelfs licht niet ontsnapt' },
];

export const STAR_TYPES = [
  { name: 'Rode dwerg', color: [1.0, 0.45, 0.24], radius: 45, lum: 0.8 },
  { name: 'Oranje ster', color: [1.0, 0.72, 0.45], radius: 60, lum: 0.9 },
  { name: 'Gele ster', color: [1.0, 0.9, 0.76], radius: 75, lum: 1.0 },
  { name: 'Witte ster', color: [0.92, 0.95, 1.0], radius: 90, lum: 1.15 },
  { name: 'Blauwe reus', color: [0.62, 0.76, 1.0], radius: 140, lum: 1.4 },
];
// kans per gebied op elk sterrentype
const STAR_W = [
  [0.1, 0.1, 0.2, 0.3, 0.3],
  [0.05, 0.1, 0.15, 0.3, 0.4],
  [0.2, 0.3, 0.35, 0.1, 0.05],
  [0.6, 0.25, 0.15, 0, 0],
];

export const PLANET_TYPES = ['Rotsplaneet', 'Woestijnplaneet', 'Oceaanwereld', 'IJsplaneet', 'Gasreus', 'IJsreus'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (w, r) => { let s = 0; for (let i = 0; i < w.length; i++) { s += w[i]; if (r < s) return i; } return w.length - 1; };

export class Universe {
  constructor(sample) {
    this.sample = sample;
    this.cache = new Map();
  }

  // ruwe gebiedsvelden op een punt (zelfde formule als in de nevelshader)
  fields(x, y, z) {
    const s = this.sample;
    const r1 = s(0, x * F_REG + 0.13, y * F_REG + 0.71, z * F_REG + 0.29);
    const r2 = s(2, x * F_REG + 0.57, y * F_REG + 0.19, z * F_REG + 0.83);
    return { r1, r2 };
  }

  regionAt(x, y, z) {
    const { r1, r2 } = this.fields(x, y, z);
    if (r1 > 0.56 && r1 >= r2) return 0;
    if (r2 > 0.56) return 1;
    if (r1 < 0.47 && r2 < 0.47) return 3;
    return 2;
  }

  // nevelsdichtheid op een punt, voor de piloot (vereenvoudigde versie van de shader)
  nebulaAt(x, y, z) {
    const { r1, r2 } = this.fields(x, y, z);
    const amt = Math.max(smooth(0.5, 0.62, r1), smooth(0.5, 0.62, r2) * 0.8) + 0.12;
    const s = this.sample;
    const d = s(0, x * F_NEB, y * F_NEB, z * F_NEB) * 0.6 + s(1, x * F_NEB * 2, y * F_NEB * 2, z * F_NEB * 2) * 0.4;
    return smooth(0.52, 0.72, d) * amt;
  }

  sector(i, j, k) {
    const key = i + ',' + j + ',' + k;
    let s = this.cache.get(key);
    if (!s) { s = this.generate(i, j, k); this.cache.set(key, s); }
    return s;
  }

  generate(i, j, k) {
    const r = rng(Math.floor(hashFloat(i, j, k, 11) * 4294967296));
    const S = SECTOR;
    const cx = (i + 0.5) * S, cy = (j + 0.5) * S, cz = (k + 0.5) * S;
    const reg = this.regionAt(cx, cy, cz);
    const out = [];
    const id = (n) => `${i},${j},${k}:${n}`;

    // zeldzame objecten
    const rare = hashFloat(i, j, k, 77);
    if (rare < 0.0007) {
      out.push({ kind: 'blackhole', name: 'Zwart gat', id: id('bh'), pos: [cx, cy, cz], radius: 70, seed: r() });
      return out;
    }
    if (rare < 0.0017) {
      out.push({ kind: 'pulsar', name: 'Pulsar', id: id('ps'), pos: [cx + (r() - 0.5) * 2000, cy, cz], radius: 12, seed: r(), axis: [r() - 0.5, 1, r() - 0.5] });
      return out;
    }
    if (rare < 0.0032) {
      out.push({ kind: 'pneb', name: 'Planetaire nevel', id: id('pn'), pos: [cx, cy, cz], radius: 900, seed: r() });
      return out;
    }

    const pSys = [0.45, 0.5, 0.6, 0.08][reg];
    if (r() >= pSys) return out;
    const st = pick(STAR_W[reg], r());
    const T = STAR_TYPES[st];
    const sp = [cx + (r() - 0.5) * S * 0.5, cy + (r() - 0.5) * S * 0.3, cz + (r() - 0.5) * S * 0.5];
    const star = { kind: 'star', type: st, name: T.name, id: id('s'), pos: sp, radius: T.radius * (0.85 + r() * 0.3), color: T.color, lum: T.lum, seed: r() };
    out.push(star);

    // vlak van het stelsel
    const nx = (r() - 0.5) * 0.35, nz = (r() - 0.5) * 0.35;
    const nl = Math.hypot(nx, 1, nz);
    const n = [nx / nl, 1 / nl, nz / nl];
    // twee assen in het vlak
    const ax = norm(cross(n, [0, 0, 1])), az = cross(ax, n);
    const onPlane = (rad, ang, h = 0) => [
      sp[0] + (ax[0] * Math.cos(ang) + az[0] * Math.sin(ang)) * rad + n[0] * h,
      sp[1] + (ax[1] * Math.cos(ang) + az[1] * Math.sin(ang)) * rad + n[1] * h,
      sp[2] + (ax[2] * Math.cos(ang) + az[2] * Math.sin(ang)) * rad + n[2] * h,
    ];

    const nPlanets = reg === 2 ? 2 + Math.floor(r() * 4) : reg === 3 ? Math.floor(r() * 2) : Math.floor(r() * 2.4);
    let orbit = star.radius * 7 + 250;
    for (let p = 0; p < nPlanets; p++) {
      orbit += 380 + r() * 650;
      const outer = orbit > star.radius * 7 + 1400;
      const type = outer ? (r() < 0.65 ? 4 : 5) : [0, 1, 2, 3][Math.floor(r() * 4)];
      const radius = type >= 4 ? 45 + r() * 45 : 9 + r() * 14;
      const ang = r() * Math.PI * 2;
      const pos = onPlane(orbit, ang, (r() - 0.5) * 60);
      const planet = {
        kind: 'planet', type, name: PLANET_TYPES[type], id: id('p' + p), pos, radius, seed: r(), star: star.id,
        rings: type >= 4 && r() < 0.5, tilt: [(r() - 0.5) * 0.8, r() * 6.28], moons: [],
      };
      const nm = type >= 4 ? Math.floor(r() * 3) : r() < 0.35 ? 1 : 0;
      for (let m = 0; m < nm; m++) {
        const mr = radius * (2.2 + m * 1.3 + r() * 0.6);
        const ma = r() * Math.PI * 2;
        planet.moons.push({ pos: [pos[0] + Math.cos(ma) * mr, pos[1] + (r() - 0.5) * radius * 0.4, pos[2] + Math.sin(ma) * mr], radius: 2.5 + r() * (type >= 4 ? 6 : 3), seed: r() });
      }
      out.push(planet);
      if (outer && p === nPlanets - 1) break;
    }

    if (r() < (reg === 2 ? 0.55 : 0.2)) {
      const br = star.radius * 7 + 700 + r() * 900;
      out.push({ kind: 'belt', name: 'Asteroïdengordel', id: id('b'), pos: sp.slice(), normal: n, radius: br, width: 260 + r() * 220, thickness: 50 + r() * 40, seed: r(), star: star.id });
    }
    if (r() < 0.25) {
      const d = star.radius * 8 + 500 + r() * 1500;
      out.push({ kind: 'comet', name: 'Komeet', id: id('c'), pos: onPlane(d, r() * 6.28, (r() - 0.5) * 600), radius: 3, seed: r(), star: star.id });
    }
    return out;
  }

  // alle objecten binnen 'rad' van een punt
  near(x, y, z, rad, out = []) {
    out.length = 0;
    const S = SECTOR, R = Math.ceil(rad / S);
    const ci = Math.floor(x / S), cj = Math.floor(y / S), ck = Math.floor(z / S);
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) for (let k = ck - R; k <= ck + R; k++) {
      for (const o of this.sector(i, j, k)) {
        const dx = o.pos[0] - x, dy = o.pos[1] - y, dz = o.pos[2] - z;
        if (dx * dx + dy * dy + dz * dz < rad * rad) out.push(o);
      }
    }
    if (this.cache.size > 14000) this.prune(ci, cj, ck, R + 2);
    return out;
  }

  prune(ci, cj, ck, keep) {
    for (const key of this.cache.keys()) {
      const [i, j, k] = key.split(',').map(Number);
      if (Math.abs(i - ci) > keep || Math.abs(j - cj) > keep || Math.abs(k - ck) > keep) this.cache.delete(key);
    }
  }
}

function smooth(a, b, v) { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
