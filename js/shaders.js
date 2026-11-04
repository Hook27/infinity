// Alle GLSL: gedeelde atmosfeer + materialen voor terrein, objecten, water, lucht en deeltjes.
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
};

export const ATMOS = /* glsl */ `
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

vec3 skyBase(vec3 d) {
  float y = d.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uHorizon * 0.82, smoothstep(0.0, -0.35, y));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(s, 5.0) * 0.32 + pow(s, 40.0) * 0.55) * uSunVis;
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
  f = max(f, smoothstep(uEdge * 0.55, uEdge, dist));
  vec3 fc = skyBase(normalize(vec3(d.x, d.y * 0.35, d.z)));
  return mix(col, fc, clamp(f, 0.0, 1.0));
}

vec3 shade(vec3 alb, vec3 N, vec3 V, float wrap) {
  float ndl = dot(N, uLightDir);
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  float back = clamp(dot(-V, uLightDir) * 0.6 + 0.4, 0.0, 1.0);
  vec3 c = alb * (amb + uLightCol * diff);
  c += (uLightCol * 0.55 + uAmbSky * 0.4) * rim * back * 0.45;
  return c;
}

vec3 flatNormal(vec3 p, vec3 V) {
  vec3 N = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(N, V) < 0.0) N = -N;
  return N;
}
`;

// ---------- Terrein ----------
const terrainVert = /* glsl */ `
attribute vec2 aData;
varying vec3 vWorld;
varying vec2 vData;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vData = aData;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const terrainFrag = /* glsl */ `
${ATMOS}
uniform vec3 uGLow[5];
uniform vec3 uGHigh[5];
uniform vec3 uRock[5];
uniform vec3 uSand;
uniform vec3 uDeep;
varying vec3 vWorld;
varying vec2 vData;

vec3 pal(vec3 a0, vec3 a1, vec3 a2, vec3 a3, vec3 a4, float b) {
  float bi = clamp(b * 4.0, 0.0, 4.0);
  float f = fract(bi);
  float i = floor(bi);
  f = smoothstep(0.32, 0.68, f);
  vec3 c0 = i < 0.5 ? a0 : i < 1.5 ? a1 : i < 2.5 ? a2 : i < 3.5 ? a3 : a4;
  vec3 c1 = i < 0.5 ? a1 : i < 1.5 ? a2 : i < 2.5 ? a3 : a4;
  return mix(c0, c1, f);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = flatNormal(vWorld, V);
  float h = vWorld.y;
  float b = vData.x;
  float r = vData.y;

  vec3 low = pal(uGLow[0], uGLow[1], uGLow[2], uGLow[3], uGLow[4], b);
  vec3 high = pal(uGHigh[0], uGHigh[1], uGHigh[2], uGHigh[3], uGHigh[4], b);
  vec3 rock = pal(uRock[0], uRock[1], uRock[2], uRock[3], uRock[4], b);

  vec3 alb = mix(low, high, smoothstep(3.0, 34.0, h + r * 6.0));
  alb *= 0.88 + 0.24 * r;
  float slope = 1.0 - N.y;
  alb = mix(alb, rock * (0.9 + 0.2 * r), smoothstep(0.26, 0.42, slope + r * 0.06));

  float cold = smoothstep(0.45, 0.95, b);
  float snowLine = mix(78.0, 14.0, cold);
  float snow = smoothstep(snowLine - 5.0, snowLine + 5.0, h + r * 8.0) * (1.0 - smoothstep(0.35, 0.6, slope));
  alb = mix(alb, vec3(0.86, 0.9, 0.97), snow);

  float beach = 1.0 - smoothstep(0.4, 1.6, h + r * 0.6);
  alb = mix(alb, uSand, beach * (1.0 - cold * 0.5));
  float uw = smoothstep(0.0, -3.5, h);
  alb = mix(alb, uDeep, uw * 0.8);

  vec3 col = shade(alb, N, V, 0.25);

  float wave = 0.12 * sin(uTime * 1.3 + vWorld.x * 0.31 + vWorld.z * 0.17);
  float foam = 1.0 - smoothstep(0.0, 0.32, abs(h - 0.02 + wave));
  col = mix(col, (uAmbSky + uLightCol) * 0.75, foam * 0.55);

  col = atmos(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

const c = (hex) => new THREE.Color(hex);
export function makeTerrainMaterial(edge) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uEdge: { value: edge },
      uGLow: { value: ['#e8c28c', '#86bf55', '#b3d67c', '#d4a448', '#e9f0f7'].map(c) },
      uGHigh: { value: ['#d28a58', '#5c9a46', '#9fc77e', '#a8703a', '#c9d7e8'].map(c) },
      uRock: { value: ['#b0603f', '#8a8478', '#a1909c', '#7c6656', '#76819a'].map(c) },
      uSand: { value: c('#e6d3a3') },
      uDeep: { value: c('#1b5d6e') },
    },
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
uniform float uTime;
uniform vec2 uWind;
varying vec3 vWorld;
varying vec3 vCol;
varying float vGlow;
void main() {
  vec3 p = position;
  mat4 im = mat4(1.0);
  #ifdef USE_INSTANCING
    im = instanceMatrix;
  #endif
  float ph = im[3].x * 0.37 + im[3].z * 0.23;

  #ifdef FLAP
    p.y += sin(uTime * 9.0 + float(gl_InstanceID) * 1.7) * aSway * 0.9;
  #endif
  #ifdef WALK
    if (abs(aSway) > 0.01) {
      float hip = 0.5;
      float a = sin(uTime * 1.4 + float(gl_InstanceID) * 2.1) * 0.38 * sign(aSway);
      vec2 q = p.yz - vec2(hip, 0.0);
      float ca = cos(a), sa = sin(a);
      q = vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca);
      p.yz = q + vec2(hip, 0.0);
    }
  #endif

  vec4 wp = modelMatrix * im * vec4(p, 1.0);

  #ifdef WIND
    float gust = 0.65 + 0.35 * sin(uTime * 0.31 + ph * 0.1);
    float w = sin(uTime * 1.8 + wp.x * 0.09 + wp.z * 0.06) * 0.65 + sin(uTime * 3.3 + ph * 3.0) * 0.3;
    wp.xz += uWind * w * aSway * gust;
  #endif

  vec3 base = aCol;
  #ifdef USE_INSTANCING_COLOR
    base = mix(aCol, aCol * instanceColor, aTint);
  #endif
  vCol = base;
  vGlow = aGlow;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const propFrag = /* glsl */ `
${ATMOS}
uniform float uGlowBase;
varying vec3 vWorld;
varying vec3 vCol;
varying float vGlow;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = flatNormal(vWorld, V);
  #ifdef SOFT
    vec3 col = shade(vCol, N, V, 0.9);
  #else
    vec3 col = shade(vCol, N, V, 0.2);
  #endif
  float g = vGlow * (uGlowBase + uGlow * 2.6);
  col += vCol * g;
  col = atmos(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makePropMaterial({ edge, wind = true, flap = false, walk = false, soft = false, side = THREE.FrontSide, glowBase = 0.35 }) {
  const defines = {};
  if (wind) defines.WIND = '';
  if (flap) defines.FLAP = '';
  if (walk) defines.WALK = '';
  if (soft) defines.SOFT = '';
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uEdge: { value: edge }, uGlowBase: { value: glowBase } },
    defines,
    vertexShader: propVert,
    fragmentShader: propFrag,
    side,
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

// Golven met frequenties die periodiek zijn over 384 eenheden (zodat de floating origin naadloos is)
const waterFrag = /* glsl */ `
${ATMOS}
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
  g += wave(p, vec2(24.0, 7.0), 0.55, 1.1);
  g += wave(p, vec2(-13.0, 19.0), 0.5, 1.3);
  g += wave(p, vec2(31.0, -29.0), 0.22, 1.9);
  g += wave(p, vec2(5.0, 40.0), 0.2, 1.7);
  g += wave(p, vec2(71.0, 43.0), 0.06, 2.9);
  g += wave(p, vec2(-58.0, 77.0), 0.05, 3.3);
  g += wave(p, vec2(97.0, -120.0), 0.025, 4.1);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = skyBase(vec3(R.x, abs(R.y), R.z));
  float spec = pow(max(dot(R, uLightDir), 0.0), 240.0);
  refl += uLightCol * spec * 6.0;
  vec3 body = mix(uWaterShallow, uWaterDeep, 0.6) * (uAmbSky * 0.9 + uLightCol * 0.35);
  vec3 col = mix(body, refl, fres);
  float a = mix(0.62, 0.97, fres);
  col = atmos(col, vWorld);
  gl_FragColor = vec4(col, a);
}
`;

export function makeWaterMaterial(edge) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uEdge: { value: edge },
      uWaterDeep: { value: c('#0b3f5c') },
      uWaterShallow: { value: c('#2f9fa6') },
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
${ATMOS}
uniform float uStars;
uniform float uAurora;
varying vec3 vDir;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);

  // zon
  float sd = dot(d, uSunDir);
  col += uSunCol * smoothstep(0.99935, 0.99965, sd) * 9.0 * uSunVis;
  col += uSunCol * pow(max(sd, 0.0), 900.0) * 1.4 * uSunVis;

  // maan
  float md = dot(d, uMoonDir);
  float moon = smoothstep(0.99955, 0.99972, md);
  // maansikkel
  vec3 off = normalize(uMoonDir + vec3(0.012, 0.008, 0.0));
  moon *= 1.0 - 0.85 * smoothstep(0.99955, 0.99972, dot(d, off));
  col += vec3(1.0, 0.95, 0.85) * moon * 3.0 * uMoonVis;

  // sterren
  if (uStars > 0.01 && d.y > -0.05) {
    float a = uTime * 0.004;
    vec3 sd3 = vec3(d.x * cos(a) - d.z * sin(a), d.y, d.x * sin(a) + d.z * cos(a));
    vec3 sp = sd3 * 260.0;
    vec3 id = floor(sp);
    float h = hash3(id);
    if (h > 0.965) {
      vec3 cpos = vec3(hash3(id + 1.3), hash3(id + 2.7), hash3(id + 4.1)) * 0.7 + 0.15;
      float dd = length(fract(sp) - cpos);
      float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 6.0) + h * 80.0);
      float s = smoothstep(0.11, 0.0, dd) * tw * (h - 0.965) * 30.0;
      vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash3(id + 9.0));
      col += sc * s * uStars * smoothstep(-0.05, 0.15, d.y) * 1.6;
    }
    // melkweg-waas
    float band = exp(-pow(dot(sd3, normalize(vec3(0.3, 0.6, 0.74))) * 3.2, 2.0));
    float mw = vnoise(sd3.xz * 9.0 + sd3.y * 4.0) * 0.6 + vnoise(sd3.xz * 23.0) * 0.4;
    col += vec3(0.45, 0.4, 0.7) * band * mw * 0.12 * uStars;
  }

  // noorderlicht
  if (uAurora > 0.01 && d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.18);
    float aur = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 q = p * (0.55 + fi * 0.18) + vec2(fi * 3.7, uTime * 0.012 * (1.0 + fi * 0.4));
      float n = vnoise(vec2(q.x * 1.3 + 0.8 * sin(q.y * 1.1 + uTime * 0.09), q.y * 0.35 + fi));
      float line = 1.0 - abs(n * 2.0 - 1.0);
      aur += pow(line, 9.0) * (0.7 - fi * 0.17) * (0.6 + 0.4 * vnoise(q * 3.0 + uTime * 0.2));
    }
    float mask = smoothstep(0.03, 0.22, d.y) * smoothstep(0.95, 0.35, d.y);
    vec3 ac = mix(vec3(0.15, 1.0, 0.65), vec3(0.65, 0.3, 1.0), smoothstep(0.15, 0.6, d.y));
    col += ac * aur * mask * uAurora * 1.5;
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
  gl_PointSize = (mix(0.4, 0.9, aRand.z) + uSnow * 0.5) * 220.0 * uPixelRatio / max(d, 1.0);
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
  float a = smoothstep(0.5, 0.0, r);
  a *= a;
  vec3 day = vec3(1.0, 0.92, 0.7) * 0.35;
  vec3 night = vec3(0.75, 1.0, 0.35) * 2.6;
  vec3 col = mix(day, night, uNight);
  col = mix(col, vec3(0.9, 0.95, 1.0) * mix(0.8, 0.5, uNight), vSnowV);
  float k = mix(0.5, 1.0, max(uNight, vSnowV));
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
