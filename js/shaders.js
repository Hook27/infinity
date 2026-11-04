// Alle GLSL: gedeelde atmosfeer, belichting en schaduw + materialen voor terrein, objecten,
// water, lucht (met wolken) en deeltjes.
import * as THREE from 'three';

// Gedeelde uniforms (door referentie gedeeld tussen alle materialen)
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightCol: { value: new THREE.Color(1, 1, 1) },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunCol: { value: new THREE.Color() },
  uSunVis: { value: 1 },
  uMoonVis: { value: 0 },
  uAmbSky: { value: new THREE.Color() },
  uAmbGround: { value: new THREE.Color() },
  uFogDensity: { value: 0.004 },
  uGlow: { value: 0 },
  uStars: { value: 0 },
  uAurora: { value: 0 },
  uWind: { value: new THREE.Vector2(0.6, 0.35) },
  uNight: { value: 0 },
  uSnow: { value: 0 },
  uPixelRatio: { value: 1 },
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowTexel: { value: 1 / 2048 },
  uCloudOff: { value: new THREE.Vector2() },
  uCloudCover: { value: 0.52 },
};

// ---------- gedeelde fragment-code ----------
export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunCol;
uniform float uSunVis;
uniform float uMoonVis;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform float uFogDensity;
uniform float uGlow;
uniform float uEdge;
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform float uShadowTexel;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// periodieke value noise: het patroon herhaalt zich na 'per' cellen
float vnoiseP(vec2 p, float per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, per));
  float b = hash12(mod(i + vec2(1.0, 0.0), per));
  float c = hash12(mod(i + vec2(0.0, 1.0), per));
  float d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// wereldruimte-fbm die naadloos herhaalt over 384 eenheden (zodat de floating origin onzichtbaar is)
float wfbm(vec2 xz, float cells, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  vec2 p = xz * (cells / 384.0);
  float per = cells;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * vnoiseP(p, per);
    n += a;
    p *= 2.0;
    per *= 2.0;
    a *= 0.5;
  }
  return s / n;
}

vec3 skyBase(vec3 d) {
  float y = d.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uHorizon * 0.82, smoothstep(0.0, 0.35, -y));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(s, 5.0) * 0.28 + pow(s, 40.0) * 0.5) * uSunVis;
  float m = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.35, 0.45, 0.8) * pow(m, 30.0) * 0.18 * uMoonVis;
  return col;
}

vec3 atmos(vec3 col, vec3 wpos) {
  vec3 rel = wpos - cameraPosition;
  float dist = length(rel);
  vec3 d = rel / max(dist, 1e-4);
  float hf = exp(-max(wpos.y, 0.0) * 0.022);
  float f = 1.0 - exp(-dist * uFogDensity * (0.3 + 1.1 * hf));
  f = max(f, smoothstep(uEdge * 0.68, uEdge, dist));
  vec3 fc = skyBase(normalize(vec3(d.x, d.y * 0.35, d.z)));
  return mix(col, fc, clamp(f, 0.0, 1.0));
}

float shadowAt(vec3 wp, vec3 N) {
  if (uShadowOn < 0.01) return 1.0;
  vec3 p = wp + N * 0.15 + uLightDir * 0.08;
  vec3 c = (uShadowMatrix * vec4(p, 1.0)).xyz;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float z = c.z - 0.0004;
  float t = uShadowTexel * 1.25;
  float s = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      s += texture(uShadowMap, vec3(c.xy + vec2(float(x), float(y)) * t, z));
    }
  }
  s /= 9.0;
  vec2 e = smoothstep(0.0, 0.1, c.xy) * (1.0 - smoothstep(0.9, 1.0, c.xy));
  return mix(1.0, s, e.x * e.y * uShadowOn);
}

vec3 lighting(vec3 alb, vec3 N, vec3 V, float sh, float ao, float wrap, float spec, float trans) {
  float ndl = dot(N, uLightDir);
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0) * sh;
  vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * ao;
  vec3 c = alb * (amb + uLightCol * diff);
  vec3 H = normalize(uLightDir + V);
  c += uLightCol * pow(max(dot(N, H), 0.0), 48.0) * spec * sh;
  float back = pow(clamp(dot(-V, uLightDir), 0.0, 1.0), 2.5);
  c += alb * uLightCol * trans * (0.25 + back) * (0.35 + 0.65 * sh);
  return c;
}
`;

// ---------- bladmaskers (gedeeld door kleur- en schaduwpass) ----------
export const LEAF = /* glsl */ `
float leafShape(vec2 q, float len, float wid) {
  float t = q.x / len;
  if (t < 0.0 || t > 1.0) return 0.0;
  float w = wid * sin(3.14159 * pow(t, 0.75));
  return 1.0 - smoothstep(w * 0.55, w, abs(q.y));
}
float leafHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// veel kleine blaadjes, willekeurig verspreid over de kaart (celgewijs), binnen een ronde vorm
float leafCluster(vec2 uv) {
  vec2 p = uv * 4.0;
  vec2 ip = floor(p);
  float m = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cc = ip + vec2(float(x), float(y));
      vec2 center = cc + vec2(leafHash(cc * 1.37 + 3.1), leafHash(cc * 2.11 + 7.3));
      if (length(center * 0.25 - 0.5) > 0.43) continue;
      float a = leafHash(cc * 0.71 + 1.9) * 6.2831;
      vec2 d = vec2(cos(a), sin(a));
      vec2 q = p - center;
      q = vec2(dot(q, d), dot(q, vec2(-d.y, d.x)));
      m = max(m, leafShape(q + vec2(0.42, 0.0), 0.95, 0.27));
    }
  }
  return m;
}
// 1 = bladcluster, 2 = naaldtak, 3 = grasspriet, 4 = bloemkroon
float leafMask(vec2 uv, float type) {
  if (type < 1.5) {
    return leafCluster(uv);
  } else if (type < 2.5) {
    float x = uv.x - 0.5;
    float y = uv.y;
    float width = 0.47 * (1.0 - y * 0.8);
    float stem = 1.0 - smoothstep(0.012, 0.03, abs(x));
    float k = fract((y * 1.0 + abs(x) * 0.9) * 26.0);
    float needle = 1.0 - smoothstep(0.18, 0.42, abs(k - 0.5));
    float inside = 1.0 - smoothstep(width * 0.8, width, abs(x));
    return max(stem * step(y, 0.97), needle * inside * step(y, 0.99));
  } else if (type < 3.5) {
    return 1.0;
  }
  vec2 p = uv - 0.5;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float petal = 0.47 * (0.5 + 0.5 * abs(cos(ang * 2.5)));
  return 1.0 - smoothstep(petal * 0.85, petal, r);
}
`;

// ---------- Terrein ----------
const terrainVert = /* glsl */ `
attribute vec3 aData;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vData;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  vData = aData;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const terrainFrag = /* glsl */ `
${COMMON}
uniform vec3 uGLow[5];
uniform vec3 uGHigh[5];
uniform vec3 uRock[5];
uniform vec3 uSand;
uniform vec3 uDeep;
uniform vec3 uDirt;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vData;

vec3 pal(vec3 a0, vec3 a1, vec3 a2, vec3 a3, vec3 a4, float b) {
  float bi = clamp(b * 4.0, 0.0, 4.0);
  float f = smoothstep(0.3, 0.7, fract(bi));
  float i = floor(bi);
  vec3 c0 = i < 0.5 ? a0 : i < 1.5 ? a1 : i < 2.5 ? a2 : i < 3.5 ? a3 : a4;
  vec3 c1 = i < 0.5 ? a1 : i < 1.5 ? a2 : i < 2.5 ? a3 : a4;
  return mix(c0, c1, f);
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 Ng = normalize(vNormal);
  vec2 xz = vWorld.xz;
  float h = vWorld.y;
  float b = vData.x;
  float ao = vData.z;
  float detail = 1.0 - smoothstep(30.0, 160.0, dist);

  float patches = wfbm(xz, 10.0, 4);
  float mid = wfbm(xz, 48.0, 3);
  float fine = 0.5;
  vec3 N = Ng;
  #ifndef LOWQ
    float e = 0.4;
    fine = wfbm(xz, 192.0, 3);
    float fx = wfbm(xz + vec2(e, 0.0), 192.0, 3);
    float fz = wfbm(xz + vec2(0.0, e), 192.0, 3);
    N = normalize(Ng + vec3(fine - fx, 0.0, fine - fz) * 1.8 * detail);
  #endif

  vec3 low = pal(uGLow[0], uGLow[1], uGLow[2], uGLow[3], uGLow[4], b);
  vec3 high = pal(uGHigh[0], uGHigh[1], uGHigh[2], uGHigh[3], uGHigh[4], b);
  vec3 rock = pal(uRock[0], uRock[1], uRock[2], uRock[3], uRock[4], b);
  float cold = smoothstep(0.55, 0.95, b);
  float hot = 1.0 - smoothstep(0.08, 0.22, b);

  // grond: grote vlekken, middelgrote variatie en fijne korrel
  vec3 alb = mix(low, high, smoothstep(2.0, 42.0, h + (patches - 0.5) * 14.0));
  alb *= 0.8 + 0.4 * mix(0.5, mid, 0.9);
  alb *= mix(1.0, 0.85 + 0.3 * fine, detail);
  // droge, gelige plekken en donkere, vochtige plekken in het gras
  float dry = smoothstep(0.55, 0.8, mid + (patches - 0.5) * 0.3) * (1.0 - cold) * (1.0 - hot);
  alb = mix(alb, alb * vec3(1.3, 1.18, 0.72), dry * 0.55);
  alb *= 1.0 - (1.0 - smoothstep(0.25, 0.45, patches)) * 0.18;
  // aarde/kale plekken
  float dirt = smoothstep(0.6, 0.74, patches + (mid - 0.5) * 0.25);
  alb = mix(alb, uDirt * (0.8 + 0.4 * mid), dirt * 0.6 * (1.0 - cold) * (1.0 - hot));
  // zandribbels in de woestijn
  float rip = sin(dot(xz, vec2(0.83, 0.55)) * 2.2 + mid * 9.0) * 0.5 + 0.5;
  alb *= 1.0 - hot * 0.08 * rip * detail;

  // rots op steile hellingen, met gelaagdheid
  float slope = 1.0 - Ng.y;
  float rockAmt = smoothstep(0.2, 0.36, slope + (patches - 0.5) * 0.16 + (mid - 0.5) * 0.06);
  float strata = 1.0 + (0.12 * sin(h * 0.9 + mid * 6.0) + (fine - 0.5) * 0.25) * detail;
  vec3 rockCol = rock * strata * (0.8 + 0.4 * mid);
  alb = mix(alb, rockCol, rockAmt);

  // sneeuw: op vlakke delen boven de sneeuwgrens en in het koude bioom
  float snowLine = mix(80.0, 12.0, cold);
  float snow = smoothstep(snowLine - 6.0, snowLine + 6.0, h + (patches - 0.5) * 18.0) * (1.0 - smoothstep(0.3, 0.55, slope));
  alb = mix(alb, vec3(0.66, 0.7, 0.77) * (0.9 + 0.12 * fine), snow);

  // strand en natte rand
  float beach = 1.0 - smoothstep(0.3, 1.5, h + (mid - 0.5) * 0.8);
  alb = mix(alb, uSand * (0.9 + 0.2 * fine), beach * (1.0 - cold * 0.6));
  float wet = 1.0 - smoothstep(0.0, 0.45, h);
  alb *= 1.0 - wet * 0.35;
  float uw = smoothstep(0.0, 3.5, -h);
  alb = mix(alb, uDeep, uw * 0.85);

  float sh = shadowAt(vWorld, Ng);
  float spec = snow * 0.25 + wet * 0.4;
  vec3 col = lighting(alb, N, V, sh, ao, 0.05, spec, 0.0);

  // schuimrand bij de waterlijn
  float wave = 0.1 * sin(uTime * 1.2 + xz.x * 0.31 + xz.y * 0.17);
  float foam = (1.0 - smoothstep(0.0, 0.22, abs(h - 0.03 + wave))) * (0.6 + 0.4 * fine);
  col = mix(col, (uAmbSky + uLightCol * 0.9) * 0.8, foam * 0.45);

  col = atmos(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

const c = (hex) => new THREE.Color(hex);
export function makeTerrainMaterial(edge, lowq = false) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uEdge: { value: edge },
      // biomen: woestijn, weide, bloesem, herfst, sneeuw
      uGLow: { value: ['#c9a373', '#527832', '#5c823a', '#7f7638', '#c9d2dd'].map(c) },
      uGHigh: { value: ['#b07e52', '#42662b', '#4d7234', '#6c5a2e', '#bcc6d3'].map(c) },
      uRock: { value: ['#9c5a3c', '#7a766e', '#857f7a', '#6d6258', '#5d646e'].map(c) },
      uSand: { value: c('#d6c49a') },
      uDeep: { value: c('#1d4f57') },
      uDirt: { value: c('#6a573f') },
    },
    defines: lowq ? { LOWQ: '' } : {},
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
  });
}

// ---------- Objecten (instanced) ----------
const propVert = /* glsl */ `
attribute vec3 aCol;
attribute float aTint;
attribute float aGlow;
attribute float aSway;
attribute float aLeaf;
uniform float uTime;
uniform vec2 uWind;
uniform float uFieldR;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vCol;
varying float vGlow;
varying float vLeaf;
varying vec2 vUv;
void main() {
  vec3 p = position;
  mat4 im = mat4(1.0);
  #ifdef USE_INSTANCING
    im = instanceMatrix;
  #endif
  #ifdef FLAP
    p.y += sin(uTime * 7.0 + float(gl_InstanceID) * 1.7) * aSway * 0.8;
  #endif
  #ifdef FIELD
    // gras rond de camera krimpt weg aan de rand
    vec3 ip = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float fd = length(ip.xz - cameraPosition.xz);
    p *= 1.0 - smoothstep(uFieldR * 0.62, uFieldR, fd);
  #endif

  vec4 wp = modelMatrix * im * vec4(p, 1.0);

  #ifdef WIND
    float ph = im[3].x * 0.37 + im[3].z * 0.23;
    float gust = 0.6 + 0.4 * sin(uTime * 0.31 + wp.x * 0.02 + wp.z * 0.015);
    float w = sin(uTime * 1.7 + wp.x * 0.09 + wp.z * 0.06) * 0.6 + sin(uTime * 3.1 + ph * 3.0) * 0.25;
    wp.xz += uWind * w * aSway * gust;
  #endif

  vNormal = normalize(mat3(modelMatrix * im) * normal);
  vec3 base = aCol;
  #ifdef USE_INSTANCING_COLOR
    base = mix(aCol, aCol * instanceColor, aTint);
  #endif
  vCol = base;
  vGlow = aGlow;
  vLeaf = aLeaf;
  vUv = uv;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const propFrag = /* glsl */ `
${COMMON}
${LEAF}
uniform float uGlowBase;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vCol;
varying float vGlow;
varying float vLeaf;
varying vec2 vUv;
void main() {
  float alpha = 1.0;
  vec3 alb = vCol;
  bool leafy = vLeaf > 0.5;
  if (leafy) {
    alpha = leafMask(vUv, vLeaf);
    #ifdef A2C
      if (alpha < 0.05) discard;
      alpha = clamp((alpha - 0.3) * 2.2, 0.0, 1.0);
    #else
      if (alpha < 0.5) discard;
      alpha = 1.0;
    #endif
    if (vLeaf > 3.5) {
      float r = length(vUv - 0.5);
      alb = mix(vec3(0.85, 0.62, 0.12), alb, smoothstep(0.08, 0.13, r));
    }
  }
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 N = normalize(vNormal);
  if (!leafy && !gl_FrontFacing) N = -N;
  float wrap = 0.12, trans = 0.0, spec = 0.04;
  if (leafy) {
    wrap = 0.55; trans = 0.55; spec = 0.12;
    if (vLeaf > 2.5 && vLeaf < 3.5) {
      // grassprieten: donker aan de voet, licht aan de top
      alb *= mix(0.42, 1.12, vUv.y);
      N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.55));
    }
  } else {
    // korrel en vlekken op hout, steen en stof
    float tex = wfbm(vWorld.xz * 1.6 + vec2(vWorld.y * 2.3, -vWorld.y * 1.1), 192.0, 3);
    float big = wfbm(vWorld.xz + vec2(vWorld.y * 0.7), 40.0, 2);
    alb *= 0.74 + 0.36 * tex + 0.16 * (big - 0.5);
    // mos en korstmos op de bovenkant van stenen
    float moss = smoothstep(0.55, 0.85, N.y) * smoothstep(0.5, 0.75, big) * step(0.001, 1.0 - vGlow);
    alb = mix(alb, vec3(0.2, 0.28, 0.12), moss * 0.45);
  }
  float sh = shadowAt(vWorld, N);
  vec3 col = lighting(alb, N, V, sh, 1.0, wrap, spec, trans);
  col += vCol * vGlow * (uGlowBase + uGlow * 2.4);
  col = atmos(col, vWorld);
  gl_FragColor = vec4(col, alpha);
}
`;

export function makePropMaterial({ edge, wind = true, flap = false, field = 0, glowBase = 0.15, a2c = false }) {
  const defines = {};
  if (wind) defines.WIND = '';
  if (flap) defines.FLAP = '';
  if (field) defines.FIELD = '';
  if (a2c) defines.A2C = '';
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, uEdge: { value: edge }, uGlowBase: { value: glowBase }, uFieldR: { value: field } },
    defines,
    vertexShader: propVert,
    fragmentShader: propFrag,
    side: THREE.DoubleSide,
  });
  m.alphaToCoverage = a2c;
  return m;
}

// ---------- Schaduwpass ----------
const depthFragLeaf = /* glsl */ `
${LEAF}
varying float vLeaf;
varying vec2 vUv;
void main() {
  if (vLeaf > 0.5 && leafMask(vUv, vLeaf) < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`;
const depthFragPlain = /* glsl */ `void main() { gl_FragColor = vec4(1.0); }`;

// Terrein rendert alleen achterkanten in de schaduwkaart: dat voorkomt 'schaduwacne' en
// zaagtanden op hellingen, terwijl heuvels bij lage zon nog steeds lange schaduwen werpen.
export function makeDepthMaterial(from, leafAware = true) {
  return new THREE.ShaderMaterial({
    uniforms: from.uniforms,
    defines: from.defines,
    vertexShader: from.vertexShader,
    fragmentShader: leafAware ? depthFragLeaf : depthFragPlain,
    side: leafAware ? THREE.DoubleSide : THREE.BackSide,
  });
}

// ---------- Water ----------
const waterVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// golven met frequenties die periodiek zijn over 384 eenheden (naadloos bij de floating origin)
const waterFrag = /* glsl */ `
${COMMON}
uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
varying vec3 vWorld;
const float TAU = 6.28318530718;
vec2 wave(vec2 p, vec2 k, float amp, float speed) {
  vec2 kk = k * (TAU / 384.0);
  float ph = dot(kk, p) + uTime * speed;
  return kk * cos(ph) * amp;
}
void main() {
  vec2 p = vWorld.xz;
  vec2 g = vec2(0.0);
  g += wave(p, vec2(24.0, 7.0), 0.45, 1.1);
  g += wave(p, vec2(-13.0, 19.0), 0.4, 1.3);
  g += wave(p, vec2(31.0, -29.0), 0.2, 1.9);
  g += wave(p, vec2(5.0, 40.0), 0.18, 1.7);
  g += wave(p, vec2(71.0, 43.0), 0.06, 2.9);
  g += wave(p, vec2(-58.0, 77.0), 0.05, 3.3);
  g += wave(p, vec2(97.0, -120.0), 0.03, 4.1);
  g += wave(p, vec2(-151.0, -88.0), 0.02, 5.3);
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // fijne rimpeling dichtbij
  float rip = 1.0 - smoothstep(20.0, 90.0, dist);
  float r0 = wfbm(p * 1.0 + uTime * vec2(0.6, 0.35), 96.0, 2);
  float rx = wfbm(p * 1.0 + vec2(0.3, 0.0) + uTime * vec2(0.6, 0.35), 96.0, 2);
  float rz = wfbm(p * 1.0 + vec2(0.0, 0.3) + uTime * vec2(0.6, 0.35), 96.0, 2);
  g += vec2(rx - r0, rz - r0) * 0.6 * rip;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = skyBase(vec3(R.x, abs(R.y), R.z));
  float sh = shadowAt(vWorld, vec3(0.0, 1.0, 0.0));
  float spec = pow(max(dot(R, uLightDir), 0.0), 320.0);
  refl += uLightCol * spec * 7.0 * sh;
  vec3 body = mix(uWaterShallow, uWaterDeep, 0.65) * (uAmbSky * 0.8 + uLightCol * 0.3 * sh);
  vec3 col = mix(body, refl, fres);
  float a = mix(0.55, 0.96, fres);
  col = atmos(col, vWorld);
  gl_FragColor = vec4(col, a);
}
`;

export function makeWaterMaterial(edge) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uEdge: { value: edge },
      uWaterDeep: { value: c('#0a2f3d') },
      uWaterShallow: { value: c('#1f6f73') },
    },
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    transparent: true,
  });
}

// ---------- Lucht ----------
const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const skyFrag = /* glsl */ `
${COMMON}
uniform float uStars;
uniform float uAurora;
uniform vec2 uCloudOff;
uniform float uCloudCover;
varying vec3 vDir;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float cloudFbm(vec2 p) {
  float s = 0.0, a = 0.5, n = 0.0, per = 64.0;
  for (int i = 0; i < 5; i++) {
    s += a * vnoiseP(p, per);
    n += a;
    p = p * 2.03;
    per *= 2.0;
    a *= 0.5;
  }
  return s / n;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);

  // zon
  float sd = dot(d, uSunDir);
  col += uSunCol * smoothstep(0.99955, 0.99975, sd) * 14.0 * uSunVis;
  col += uSunCol * pow(max(sd, 0.0), 1200.0) * 1.2 * uSunVis;

  // maan
  float md = dot(d, uMoonDir);
  float moon = smoothstep(0.99962, 0.99976, md);
  vec3 off = normalize(uMoonDir + vec3(0.011, 0.007, 0.0));
  moon *= 1.0 - 0.85 * smoothstep(0.99962, 0.99976, dot(d, off));
  col += vec3(1.0, 0.96, 0.88) * moon * 3.0 * uMoonVis;

  // sterren
  if (uStars > 0.01 && d.y > -0.05) {
    float a = uTime * 0.004;
    vec3 sd3 = vec3(d.x * cos(a) - d.z * sin(a), d.y, d.x * sin(a) + d.z * cos(a));
    vec3 sp = sd3 * 300.0;
    vec3 id = floor(sp);
    float h = hash3(id);
    if (h > 0.96) {
      vec3 cpos = vec3(hash3(id + 1.3), hash3(id + 2.7), hash3(id + 4.1)) * 0.7 + 0.15;
      float dd = length(fract(sp) - cpos);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 6.0) + h * 80.0);
      float s = (1.0 - smoothstep(0.0, 0.09, dd)) * tw * (h - 0.96) * 25.0;
      vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.86, 0.72), hash3(id + 9.0));
      col += sc * s * uStars * smoothstep(-0.05, 0.15, d.y) * 1.4;
    }
    float band = exp(-pow(dot(sd3, normalize(vec3(0.3, 0.6, 0.74))) * 3.2, 2.0));
    float mw = vnoiseP(sd3.xz * 9.0 + sd3.y * 4.0, 1e4) * 0.6 + vnoiseP(sd3.xz * 23.0, 1e4) * 0.4;
    col += vec3(0.45, 0.42, 0.65) * band * mw * 0.1 * uStars;
  }

  // noorderlicht
  if (uAurora > 0.01 && d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.18);
    float aur = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 q = p * (0.55 + fi * 0.18) + vec2(fi * 3.7, uTime * 0.012 * (1.0 + fi * 0.4));
      float n = vnoiseP(vec2(q.x * 1.3 + 0.8 * sin(q.y * 1.1 + uTime * 0.09), q.y * 0.35 + fi), 1e4);
      float line = 1.0 - abs(n * 2.0 - 1.0);
      aur += pow(line, 9.0) * (0.7 - fi * 0.17) * (0.6 + 0.4 * vnoiseP(q * 3.0 + uTime * 0.2, 1e4));
    }
    float mask = smoothstep(0.03, 0.22, d.y) * (1.0 - smoothstep(0.35, 0.95, d.y));
    vec3 ac = mix(vec3(0.15, 1.0, 0.6), vec3(0.6, 0.3, 1.0), smoothstep(0.15, 0.6, d.y));
    col += ac * aur * mask * uAurora * 1.3;
  }

  // wolken: een laag op grote hoogte, geprojecteerd op een vlak, met eenvoudige lichtverstrooiing
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.06) * 1.35 + uCloudOff + uTime * vec2(0.004, 0.0016);
    float n = cloudFbm(cp);
    float cover = uCloudCover;
    float dens = smoothstep(cover, cover + 0.28, n);
    if (dens > 0.001) {
      vec2 toSun = normalize(uLightDir.xz + vec2(1e-4)) * 0.06;
      float n2 = cloudFbm(cp + toSun);
      float lit = clamp(0.62 + (n - n2) * 5.0, 0.18, 1.0);
      float day = clamp(uSunVis, 0.0, 1.0);
      vec3 cLit = uLightCol * 1.05 + uSunCol * 0.35 * day + uAmbSky * 0.55;
      vec3 cDark = uAmbSky * 0.75 + uHorizon * 0.22;
      vec3 cc = mix(cDark, cLit, lit);
      float fwd = pow(max(dot(d, uSunDir), 0.0), 6.0) * day;
      cc += uSunCol * fwd * (1.0 - dens) * 1.2;
      float fade = smoothstep(0.0, 0.18, d.y);
      // ver weg vervagen naar de horizon
      cc = mix(skyBase(d), cc, smoothstep(0.0, 0.3, d.y) * 0.85 + 0.15);
      col = mix(col, cc, dens * fade * 0.95);
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uEdge: { value: 1e9 } },
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
}

// ---------- Zwevende deeltjes (pollen overdag, vuurvliegjes 's nachts, sneeuw in de kou) ----------
const motesVert = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSnow;
attribute vec4 aRand;
varying float vA;
varying float vSnowV;
const vec3 BOX = vec3(128.0, 56.0, 128.0);
void main() {
  vec3 p = position;
  float t = uTime;
  vec3 drift = vec3(sin(t * 0.3 + aRand.x * 6.28) * 2.0, sin(t * 0.5 + aRand.y * 6.28) * 1.2, cos(t * 0.27 + aRand.z * 6.28) * 2.0);
  drift.y -= uSnow * t * (2.2 + aRand.w * 1.5);
  drift.xz += uSnow * vec2(sin(t * 0.8 + aRand.x * 9.0), cos(t * 0.7 + aRand.y * 9.0)) * 1.5;
  p += drift;
  vec3 c = cameraPosition + vec3(0.0, -10.0, 0.0);
  p = mod(p - c + BOX * 0.5, BOX) - BOX * 0.5 + c;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float blink = 0.55 + 0.45 * sin(t * (1.2 + aRand.w * 2.5) + aRand.x * 40.0);
  float edge = 1.0 - smoothstep(40.0, 62.0, length(p.xz - c.xz));
  vA = blink * edge * smoothstep(1.0, 4.0, d);
  vSnowV = uSnow;
  gl_PointSize = (mix(0.3, 0.7, aRand.z) + uSnow * 0.5) * 200.0 * uPixelRatio / max(d, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;
const motesFrag = /* glsl */ `
uniform float uNight;
varying float vA;
varying float vSnowV;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q);
  float a = 1.0 - smoothstep(0.0, 0.5, r);
  a *= a;
  vec3 day = vec3(1.0, 0.94, 0.78) * 0.16;
  vec3 night = vec3(0.75, 1.0, 0.35) * 2.4;
  vec3 col = mix(day, night, uNight);
  col = mix(col, vec3(0.9, 0.95, 1.0) * mix(0.8, 0.5, uNight), vSnowV);
  float k = mix(0.45, 1.0, max(uNight, vSnowV));
  gl_FragColor = vec4(col * a * vA * k, 1.0);
}
`;
export function makeMotesMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: motesVert,
    fragmentShader: motesFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
