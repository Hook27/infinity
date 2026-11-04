// GLSL voor de ruimte: achtergrondhemel, sterrenveld, ruimtestof, volumetrische nevels,
// sterren (plasma-oppervlak, corona, protuberansen), planeten, dampkringen, ringen,
// planetoïden, kometen, het zwarte gat en de compositie (met zwaartekrachtlens).
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uNoise: { value: null },
  uPixelRatio: { value: 1 },
};

const NOISE = /* glsl */ `
uniform highp sampler3D uNoise;
uniform float uTime;
vec4 nz(vec3 p) { return texture(uNoise, p); }
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
`;

// ---------- achtergrondhemel ----------
const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;
const skyFrag = /* glsl */ `
${NOISE}
varying vec3 vDir;
vec3 starColor(float h) {
  // van rood/oranje via wit naar blauw
  vec3 a = vec3(1.0, 0.62, 0.38), b = vec3(1.0, 0.95, 0.88), c = vec3(0.68, 0.8, 1.0);
  return h < 0.5 ? mix(a, b, h * 2.0) : mix(b, c, (h - 0.5) * 2.0);
}
vec3 starLayer(vec3 d, float scale, float density, float bright) {
  vec3 p = d * scale;
  vec3 id = floor(p);
  float h = hash13(id);
  if (h < 1.0 - density) return vec3(0.0);
  vec3 c = vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.9)) * 0.7 + 0.15;
  float r = length(fract(p) - c);
  // minstens ongeveer een pixel breed, zodat sterren niet flikkeren
  float px = length(fwidth(p));
  float w = max(px * 0.85, 0.02);
  float s = exp(-r * r / (w * w)) * min(1.0, 0.0012 / (w * w) + 0.35) + exp(-r * r * 90.0) * 0.06;
  float mag = pow(hash13(id + 9.3), 6.0);
  return starColor(hash13(id + 7.7)) * s * bright * (0.15 + mag * 2.2);
}
void main() {
  vec3 d = normalize(vDir);
  // galactisch vlak en kern
  vec3 G = normalize(vec3(0.25, 0.92, 0.3));
  vec3 C = normalize(vec3(0.85, -0.2, -0.48));
  float lat = dot(d, G);
  float band = exp(-pow(lat / 0.16, 2.0));
  float core = pow(max(dot(d, C), 0.0), 6.0);
  float n1 = nz(d * 0.9).r, n2 = nz(d * 2.7 + 0.31).a, n3 = nz(d * 1.6 + 0.57).g;
  vec3 mw = mix(vec3(0.55, 0.6, 0.85), vec3(1.0, 0.78, 0.55), core * 0.8 + 0.1);
  float glow = band * (0.35 + 0.65 * n1) * (0.6 + 0.5 * n2) + core * band * 1.2;
  // stofbanen in het vlak
  float dust = smoothstep(0.55, 0.85, n3) * exp(-pow(lat / 0.07, 2.0));
  vec3 col = mw * glow * 0.09 * (1.0 - dust * 0.85);

  // sterren in lagen; dichter in de melkwegband
  float dens = 0.04 + band * 0.12;
  col += starLayer(d, 180.0, dens, 1.0);
  col += starLayer(d, 420.0, dens * 1.5, 0.55) * (1.0 - dust * 0.7);
  col += starLayer(d, 900.0, dens * 2.0, 0.3) * (1.0 - dust * 0.8);
  col += vec3(0.5, 0.55, 0.7) * band * pow(n2, 3.0) * 0.05;

  // verre sterrenstelsels: zeldzame kleine vlekjes
  vec3 gp = d * 34.0;
  vec3 gid = floor(gp);
  float gh = hash13(gid + 12.3);
  if (gh > 0.93) {
    vec3 gc = vec3(hash13(gid + 2.0), hash13(gid + 4.0), hash13(gid + 6.0)) * 0.6 + 0.2;
    vec3 q = fract(gp) - gc;
    vec3 ax = normalize(vec3(hash13(gid + 8.0), hash13(gid + 9.0), hash13(gid + 10.0)) - 0.5);
    float fl = dot(q, ax);
    float r = length(q - ax * fl * 0.75);
    float g = exp(-r * r * 2600.0) * 1.0 + exp(-r * r * 420.0) * 0.25;
    col += mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.82, 1.0), hash13(gid + 3.3)) * g * 0.45;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
export function makeSkyMaterial() {
  return new THREE.ShaderMaterial({ uniforms: U, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false });
}

// ---------- sterrenveld met diepte (wrap rond de camera) ----------
const starsVert = /* glsl */ `
uniform float uPixelRatio;
uniform float uBox;
attribute vec4 aRand;
varying vec3 vCol;
varying float vA;
vec3 starColor(float h) {
  vec3 a = vec3(1.0, 0.6, 0.36), b = vec3(1.0, 0.95, 0.88), c = vec3(0.66, 0.78, 1.0);
  return h < 0.5 ? mix(a, b, h * 2.0) : mix(b, c, (h - 0.5) * 2.0);
}
void main() {
  vec3 p = mod(position - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5 + cameraPosition;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = length(mv.xyz);
  float edge = 1.0 - smoothstep(uBox * 0.33, uBox * 0.5, length(p - cameraPosition));
  float mag = pow(aRand.x, 5.0);
  vCol = starColor(aRand.y);
  vA = edge * (0.25 + mag * 3.0) * min(1.0, 4000.0 / d);
  gl_PointSize = clamp((1.2 + mag * 3.0) * uPixelRatio * (1.0 + 1500.0 / d), 1.0, 14.0 * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`;
const starsFrag = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q) * 2.0;
  float a = exp(-r * r * 5.0);
  gl_FragColor = vec4(vCol * a * vA, 1.0);
}
`;
export function makeStarsMaterial(box) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uBox: { value: box } }, vertexShader: starsVert, fragmentShader: starsFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}

// verre sterren van stelsels (impostors)
const farVert = /* glsl */ `
uniform float uPixelRatio;
attribute vec3 aCol;
attribute float aLum;
varying vec3 vCol;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  float d = length(mv.xyz);
  vCol = aCol * aLum * clamp(14000.0 / d, 0.25, 1.6);
  gl_PointSize = clamp(aLum * 2.0 * uPixelRatio * (1.0 + 6000.0 / d), 1.5 * uPixelRatio, 5.0 * uPixelRatio);
  gl_Position = projectionMatrix * mv;
}
`;
const farFrag = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q) * 2.0;
  float a = exp(-r * r * 7.0) + exp(-r * r * 1.5) * 0.15;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;
export function makeFarStarsMaterial() {
  return new THREE.ShaderMaterial({ uniforms: U, vertexShader: farVert, fragmentShader: farFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}

// ---------- ruimtestof: strepen bij hoge snelheid ----------
const dustVert = /* glsl */ `
uniform vec3 uVel;
uniform float uBox;
attribute float aSide;
attribute float aRand;
varying float vA;
void main() {
  vec3 base = mod(position - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5 + cameraPosition;
  vec3 p = base - uVel * aSide * 0.06;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = length(base - cameraPosition);
  float sp = length(uVel);
  vA = (1.0 - smoothstep(uBox * 0.2, uBox * 0.5, d)) * smoothstep(5.0, 20.0, d) * clamp(sp / 150.0, 0.08, 1.0) * (0.4 + 0.6 * aRand);
  gl_Position = projectionMatrix * mv;
}
`;
const dustFrag = /* glsl */ `
varying float vA;
void main() { gl_FragColor = vec4(vec3(0.6, 0.66, 0.8) * vA * 0.28, 1.0); }
`;
export function makeDustMaterial(box) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uVel: { value: new THREE.Vector3() }, uBox: { value: box } }, vertexShader: dustVert, fragmentShader: dustFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}

// ---------- volumetrische nevels (raymarch op halve resolutie) ----------
const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const nebulaFrag = /* glsl */ `
${NOISE}
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uNear;
uniform float uFar;
uniform vec3 uOffN;
uniform vec3 uOffR;
uniform float uFN;
uniform float uFR;
uniform vec3 uLightPos[4];
uniform vec3 uLightCol[4];
uniform vec4 uSpecial;      // xyz positie, w straal (0 = geen)
uniform float uSpecialType; // 0 planetaire nevel, 1 pulsarnevel
uniform float uMaxDist;
uniform int uSteps;
uniform vec2 uRes;
varying vec2 vUv;

const vec3 HA = vec3(1.0, 0.24, 0.32);
const vec3 OIII = vec3(0.2, 0.85, 0.82);
const vec3 REFL = vec3(0.32, 0.5, 1.0);

void sampleNeb(vec3 p, out float dens, out float dust, out vec3 col) {
  vec3 qr = p * uFR + uOffR;
  float r1 = nz(qr + vec3(0.13, 0.71, 0.29)).r;
  float r2 = nz(qr + vec3(0.57, 0.19, 0.83)).b;
  float emis = smoothstep(0.5, 0.62, r1);
  float blue = smoothstep(0.5, 0.62, r2);
  float amt = max(emis, blue * 0.85) + 0.03;
  vec3 qn = p * uFN + uOffN;
  vec4 w = nz(qn);
  vec3 q = qn + (w.rgb - 0.5) * 0.4;
  float base = nz(q).r;
  vec4 c2 = nz(q * 2.0);
  vec4 c5 = nz(q * 5.0);
  float d = base * 0.6 + c2.g * 0.32 + c5.a * 0.18 - 0.08;
  dens = pow(smoothstep(0.42, 0.78, d), 2.0) * amt;
  dust = smoothstep(0.6, 0.82, nz(q * 3.0 + 0.37).g) * smoothstep(0.35, 0.7, base) * amt * 1.6;
  float oiii = smoothstep(0.5, 0.72, c2.b);
  vec3 em = mix(HA, OIII, oiii * 0.7);
  col = mix(REFL, em, emis / (emis + blue * 0.9 + 0.001));
  col *= 0.75 + 0.5 * c5.r;

  // bijzondere nevel: ringvormige schil rond een witte dwerg of pulsar
  if (uSpecial.w > 0.0) {
    vec3 rel = p - uSpecial.xyz;
    float R = uSpecial.w;
    float l = length(rel);
    if (l < R * 1.8) {
      float th = uSpecialType < 0.5 ? 0.2 : 0.5;
      float shell = exp(-pow((l - R) / (R * th), 2.0));
      float fil = 0.45 + 0.9 * nz(rel / R * 0.6 + 0.21).g;
      float eq = 0.55 + 0.45 * (1.0 - abs(normalize(rel).y));
      float sd = shell * fil * eq * (uSpecialType < 0.5 ? 0.9 : 0.5);
      vec3 sc = uSpecialType < 0.5 ? mix(OIII, HA * 1.2, smoothstep(0.88, 1.12, l / R)) : vec3(0.35, 0.5, 1.0);
      col = mix(col, sc, sd / (sd + dens + 0.001));
      dens += sd;
    }
  }
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 vp = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 dirV = normalize(vp.xyz / vp.w);
  vec3 dir = normalize(mat3(uCamWorld) * dirV);
  vec3 ro = uCamPos;

  float dz = texture(uDepth, vUv).x;
  float tMax = uMaxDist;
  if (dz < 0.9999999) {
    float z = dz * 2.0 - 1.0;
    float viewZ = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
    tMax = min(tMax, viewZ / max(-dirV.z, 1e-3));
  }

  // vaste dither tegen bandvorming
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 acc = vec3(0.0);
  float T = 1.0;
  float prevT = 0.0;
  float N = float(uSteps);
  for (int i = 0; i < 96; i++) {
    if (i >= uSteps) break;
    float f = (float(i) + jit) / N;
    float t = uMaxDist * f * f;
    if (t > tMax) { t = tMax; }
    float dt = t - prevT;
    prevT = t;
    if (dt <= 0.0) break;
    vec3 p = ro + dir * t;
    float dens, dust;
    vec3 col;
    sampleNeb(p, dens, dust, col);
    // vlak om de camera ijler, zodat je in een nevel nog structuur ziet in plaats van mist
    float nearFade = smoothstep(150.0, 1800.0, t);
    dens *= nearFade;
    dust *= nearFade;
    if (dens + dust > 0.002) {
      vec3 light = vec3(0.26);
      for (int k = 0; k < 4; k++) {
        vec3 dl = uLightPos[k] - p;
        light += uLightCol[k] * 0.55 / (1.0 + dot(dl, dl) / 6.0e6);
      }
      float sigE = dens * 0.00062;
      float sigA = dens * 0.00014 + dust * 0.0011;
      acc += T * col * light * sigE * dt;
      T *= exp(-sigA * dt);
      if (T < 0.02) break;
    }
    if (t >= tMax) break;
  }
  gl_FragColor = vec4(acc, T);
}
`;
export function makeNebulaMaterial() {
  const arr = (n) => Array.from({ length: n }, () => new THREE.Vector3());
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uDepth: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uNear: { value: 1 },
      uFar: { value: 1 },
      uOffN: { value: new THREE.Vector3() },
      uOffR: { value: new THREE.Vector3() },
      uFN: { value: 1 },
      uFR: { value: 1 },
      uLightPos: { value: arr(4) },
      uLightCol: { value: arr(4) },
      uSpecial: { value: new THREE.Vector4() },
      uSpecialType: { value: 0 },
      uMaxDist: { value: 40000 },
      uSteps: { value: 48 },
      uRes: { value: new THREE.Vector2() },
    },
    vertexShader: quadVert,
    fragmentShader: nebulaFrag,
    depthTest: false,
    depthWrite: false,
  });
}

// ---------- compositie: scène × doorlaatbaarheid + nevellicht, met zwaartekrachtlens ----------
const compositeFrag = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tNeb;
uniform vec4 uBH;      // xy schermpositie (uv), z schaduwstraal (uv-hoogte), w zichtbaar
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  float ring = 0.0;
  float hole = 0.0;
  if (uBH.w > 0.5) {
    vec2 d = (uv - uBH.xy) * vec2(uAspect, 1.0);
    float r = length(d);
    float rs = uBH.z;
    // afbuiging naar binnen ~ rs² / r (Einstein-lens)
    float bend = rs * rs * 1.6 / max(r, 1e-4);
    vec2 dir = d / max(r, 1e-5);
    uv = uv - (dir * min(bend, r * 0.95)) / vec2(uAspect, 1.0);
    hole = 1.0 - smoothstep(rs * 0.98, rs * 1.02, r);
    ring = exp(-pow((r - rs * 1.08) / (rs * 0.05), 2.0));
  }
  vec3 s = texture2D(tScene, uv).rgb;
  vec4 n = texture2D(tNeb, uv);
  vec3 col = s * n.a + n.rgb;
  col = mix(col, vec3(0.0), hole);
  col += vec3(1.0, 0.8, 0.55) * ring * 1.4 * uBH.w;
  gl_FragColor = vec4(col, 1.0);
}
`;
export function makeCompositeShader() {
  return {
    uniforms: { tDiffuse: { value: null }, tScene: { value: null }, tNeb: { value: null }, uBH: { value: new THREE.Vector4() }, uAspect: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: compositeFrag,
  };
}

// ---------- sterren van dichtbij ----------
const bodyVert = /* glsl */ `
uniform float uSpin;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 p = position;
  float c = cos(uSpin), s = sin(uSpin);
  vObj = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const starFrag = /* glsl */ `
${NOISE}
uniform vec3 uColor;
uniform float uLum;
uniform float uSeed;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 n = normalize(vObj);
  vec3 V = normalize(cameraPosition - vWorld);
  float mu = clamp(dot(normalize(vN), V), 0.0, 1.0);
  vec3 s = vec3(uSeed * 7.3, uSeed * 3.1, uSeed * 5.7);
  float gran = nz(n * 3.0 + s + vec3(0.0, uTime * 0.006, 0.0)).g;
  float gran2 = nz(n * 7.0 + s * 2.0 - vec3(uTime * 0.01, 0.0, 0.0)).g;
  float big = nz(n * 0.8 + s).r;
  float spot = smoothstep(0.68, 0.74, big + (gran - 0.5) * 0.08);
  float fl = nz(n * 2.0 + vec3(uTime * 0.015) + s).a;
  float b = 0.7 + 0.35 * gran + 0.2 * gran2 + 0.15 * fl;
  vec3 base = pow(uColor, vec3(1.7));
  vec3 col = base * b;
  col = mix(col, base * vec3(0.5, 0.3, 0.2), spot * 0.85);
  col *= 0.28 + 0.72 * pow(mu, 0.5);
  col = mix(col, mix(base, vec3(1.0), 0.5), 0.2 * pow(mu, 3.0));
  gl_FragColor = vec4(col * uLum * 1.35, 1.0);
}
`;
export function makeStarMaterial(color, lum, seed) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color(...color) }, uLum: { value: lum }, uSeed: { value: seed }, uSpin: { value: 0 } },
    vertexShader: bodyVert, fragmentShader: starFrag,
  });
}

// corona en gloed: billboard rond de ster
const billVert = /* glsl */ `
uniform float uSize;
varying vec2 vQ;
void main() {
  vQ = position.xy;
  vec4 c = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += position.xy * uSize;
  gl_Position = projectionMatrix * c;
}
`;
const coronaFrag = /* glsl */ `
${NOISE}
uniform vec3 uColor;
uniform float uSize;
uniform float uRadius;
uniform float uLum;
uniform float uSeed;
varying vec2 vQ;
void main() {
  float r = length(vQ) * uSize / uRadius; // in sterstralen
  if (r < 0.98) discard;
  float a = atan(vQ.y, vQ.x);
  vec3 ap = vec3(cos(a), sin(a), 0.0);
  float st = nz(ap * 1.3 + vec3(uSeed, uSeed * 2.0, uTime * 0.004 + r * 0.05)).r;
  float st2 = nz(ap * 3.0 + vec3(uSeed * 3.0, 0.0, uTime * 0.007 + r * 0.1)).a;
  float streamers = pow(st, 3.0) * 2.5 + pow(st2, 4.0) * 1.5;
  float x = r - 1.0;
  float corona = exp(-x * 3.5) * (0.5 + streamers) * 0.9;
  float halo = 0.25 / (r * r) + 0.04 / r;
  float edge = 1.0 - smoothstep(0.7, 1.0, length(vQ));
  vec3 col = uColor * (corona + halo) * uLum * 1.6 * edge;
  gl_FragColor = vec4(col, 1.0);
}
`;
const quadGeo = new THREE.PlaneGeometry(2, 2);
export function makeCorona(color, radius, lum, seed) {
  const size = radius * 7;
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color(...color) }, uSize: { value: size }, uRadius: { value: radius }, uLum: { value: lum }, uSeed: { value: seed } },
    vertexShader: billVert, fragmentShader: coronaFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(quadGeo, m);
  mesh.frustumCulled = false;
  return mesh;
}

// algemene zachte gloed (komeetkop, pulsar, verre helderheid)
const glowFrag = /* glsl */ `
uniform vec3 uColor;
varying vec2 vQ;
void main() {
  float r = length(vQ);
  float g = exp(-r * r * 9.0) * 0.9 + exp(-r * r * 2.2) * 0.25;
  g *= 1.0 - smoothstep(0.75, 1.0, r);
  gl_FragColor = vec4(uColor * g, 1.0);
}
`;
export function makeGlow(color, size) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(...color) }, uSize: { value: size } },
    vertexShader: billVert, fragmentShader: glowFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(quadGeo, m);
  mesh.frustumCulled = false;
  return mesh;
}

// protuberansen: gloeiende plasmabogen
const promVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const promFrag = /* glsl */ `
${NOISE}
uniform vec3 uColor;
uniform float uSeed;
uniform float uLum;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float mu = abs(dot(normalize(vN), V));
  float n = nz(vec3(vUv.x * 3.0, vUv.y * 0.5, uSeed + uTime * 0.02)).r;
  float flick = nz(vec3(vUv.x * 9.0 - uTime * 0.05, vUv.y, uSeed * 2.0)).a;
  float a = smoothstep(0.35, 0.7, n) * (0.4 + 0.8 * flick) * mu * sin(vUv.x * 3.14159);
  vec3 col = mix(uColor, vec3(1.0, 0.35, 0.2), 0.5) * a * uLum * 2.2;
  gl_FragColor = vec4(col, 1.0);
}
`;
export function makeProminenceMaterial(color, seed, lum) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color(...color) }, uSeed: { value: seed }, uLum: { value: lum } },
    vertexShader: promVert, fragmentShader: promFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ---------- planeten ----------
const planetFrag = /* glsl */ `
${NOISE}
uniform int uType;
uniform float uSeed;
uniform vec3 uStarPos;
uniform vec3 uStarCol;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uAtmo;
uniform vec4 uRing; // xyz normaal (wereld), w buitenstraal (voor ringschaduw), 0 = geen
uniform vec3 uCenter;
uniform float uRadius;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 n = normalize(vObj);
  vec3 N = normalize(vN);
  vec3 L = normalize(uStarPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndl = dot(N, L);
  vec3 s = vec3(uSeed * 9.1, uSeed * 4.3, uSeed * 6.7);
  vec3 alb;
  float spec = 0.0;
  float cloud = 0.0;
  if (uType <= 3) {
    float h = nz(n * 0.9 + s).r * 0.55 + nz(n * 2.1 + s).b * 0.3 + nz(n * 5.0 + s).a * 0.15;
    float cr = nz(n * 3.0 + s * 1.7).g;
    float crat = smoothstep(0.72, 0.86, cr);
    float rim = smoothstep(0.62, 0.72, cr) * (1.0 - crat);
    if (uType == 2) {
      float land = smoothstep(0.5, 0.53, h);
      vec3 landCol = mix(uB, uC, smoothstep(0.55, 0.72, h));
      alb = mix(uA * (0.7 + 0.6 * h), landCol, land);
      float ice = smoothstep(0.72, 0.86, abs(n.y) + (h - 0.5) * 0.3);
      alb = mix(alb, vec3(0.85, 0.88, 0.92), ice);
      spec = (1.0 - land) * (1.0 - ice) * 0.9;
      vec3 cn = vec3(n.x * cos(uTime * 0.01) - n.z * sin(uTime * 0.01), n.y, n.x * sin(uTime * 0.01) + n.z * cos(uTime * 0.01));
      cloud = smoothstep(0.52, 0.7, nz(cn * 1.4 + s * 0.5).r * 0.6 + nz(cn * 4.0 + s).a * 0.4);
    } else {
      alb = mix(uA, uB, smoothstep(0.35, 0.68, h));
      alb = mix(alb, uC, smoothstep(0.65, 0.85, h) * 0.6);
      alb *= 1.0 - crat * 0.28 + rim * 0.18;
      if (uType == 3) {
        float crack = 1.0 - smoothstep(0.02, 0.06, abs(nz(n * 2.5 + s).g - 0.55));
        alb = mix(alb, uC * 0.6, crack * 0.6);
        spec = 0.25;
      }
    }
  } else {
    // gasreus: banden met turbulentie en soms een storm
    float warp = nz(n * 1.5 + s).r - 0.5;
    float tur = nz(n * vec3(3.0, 9.0, 3.0) + s + vec3(uTime * 0.002, 0.0, 0.0)).a - 0.5;
    float lat = n.y + warp * 0.09 + tur * 0.04;
    float bands = sin(lat * (uType == 4 ? 28.0 : 14.0) + nz(vec3(lat * 3.0, 0.3, uSeed)).r * 6.0);
    float b2 = sin(lat * 61.0 + tur * 4.0);
    alb = mix(uA, uB, bands * 0.5 + 0.5);
    alb = mix(alb, uC, smoothstep(0.4, 1.0, b2) * 0.35);
    vec3 stormC = normalize(vec3(0.6, -0.35, 0.72));
    float storm = exp(-pow(length(n - stormC) / 0.09, 2.0)) * step(0.5, fract(uSeed * 7.0));
    alb = mix(alb, uC * vec3(1.1, 0.75, 0.6), storm * 0.8);
  }
  float day = clamp(ndl * 1.05 + 0.04, 0.0, 1.0);
  // ringschaduw op de planeet
  if (uRing.w > 0.0) {
    float t = dot(uCenter - vWorld, uRing.xyz) / dot(L, uRing.xyz);
    if (t > 0.0) {
      vec3 hit = vWorld + L * t;
      float rr = length(hit - uCenter) / uRadius;
      day *= 1.0 - 0.6 * smoothstep(1.35, 1.45, rr) * (1.0 - smoothstep(uRing.w * 0.95, uRing.w, rr));
    }
  }
  vec3 col = alb * uStarCol * day * 1.15 + alb * 0.012;
  vec3 R = reflect(-L, N);
  col += uStarCol * pow(max(dot(R, V), 0.0), 60.0) * spec * day * 1.5;
  col = mix(col, (uStarCol * day * 1.1 + 0.01) * vec3(0.95, 0.97, 1.0), cloud * 0.92);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  col += uAtmo * pow(1.0 - mu, 2.5) * smoothstep(-0.2, 0.5, ndl) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;
export function makePlanetMaterial(p) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U, uType: { value: p.type }, uSeed: { value: p.seed }, uSpin: { value: 0 },
      uStarPos: { value: new THREE.Vector3() }, uStarCol: { value: new THREE.Color(1, 1, 1) },
      uA: { value: new THREE.Color(p.colA) }, uB: { value: new THREE.Color(p.colB) }, uC: { value: new THREE.Color(p.colC) },
      uAtmo: { value: new THREE.Color(p.atmo || '#000000') }, uRing: { value: new THREE.Vector4() },
      uCenter: { value: new THREE.Vector3() }, uRadius: { value: p.radius },
    },
    vertexShader: bodyVert, fragmentShader: planetFrag,
  });
}

// dampkring: dunne gloeiende rand
const atmoFrag = /* glsl */ `
uniform vec3 uAtmo;
uniform vec3 uStarPos;
uniform vec3 uStarCol;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uStarPos - vWorld);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  float rim = pow(1.0 - mu, 5.0) * 1.6 + pow(1.0 - mu, 2.0) * 0.12;
  float lit = smoothstep(-0.35, 0.5, dot(N, L));
  float fwd = pow(max(dot(-V, L), 0.0), 6.0);
  vec3 col = uAtmo * uStarCol * rim * lit * (1.0 + fwd * 2.0);
  gl_FragColor = vec4(col, 1.0);
}
`;
export function makeAtmoMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uAtmo: { value: new THREE.Color(color) }, uStarPos: { value: new THREE.Vector3() }, uStarCol: { value: new THREE.Color(1, 1, 1) }, uSpin: { value: 0 } },
    vertexShader: bodyVert, fragmentShader: atmoFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// ringen
const ringVert = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const ringFrag = /* glsl */ `
${NOISE}
uniform float uInner;
uniform float uOuter;
uniform float uSeed;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uStarPos;
uniform vec3 uStarCol;
uniform vec3 uCenter;
uniform float uRadius;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  float r = length(vLocal.xy);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float b1 = nz(vec3(t * 2.0, 0.37, uSeed)).r;
  float b2 = nz(vec3(t * 7.0, 0.61, uSeed * 2.0)).a;
  float b3 = nz(vec3(t * 19.0, 0.13, uSeed * 3.0)).r;
  float dens = smoothstep(0.3, 0.75, b1 * 0.5 + b2 * 0.3 + b3 * 0.2);
  dens *= smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.92, 1.0, t));
  float gap = smoothstep(0.0, 0.015, abs(t - 0.62)) ;
  dens *= gap;
  vec3 col = mix(uA, uB, b2);
  vec3 L = normalize(uStarPos - vWorld);
  // schaduw van de planeet op de ringen
  vec3 oc = vWorld - uCenter;
  float bq = dot(oc, L);
  float c = dot(oc, oc) - uRadius * uRadius;
  float disc = bq * bq - c;
  float sh = (disc > 0.0 && -bq - sqrt(disc) > 0.0) ? 0.08 : 1.0;
  vec3 c2 = col * uStarCol * (0.25 + 0.75 * sh) * 0.9;
  gl_FragColor = vec4(c2, dens * 0.85);
}
`;
export function makeRingMaterial(inner, outer, seed, a, b) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U, uInner: { value: inner }, uOuter: { value: outer }, uSeed: { value: seed },
      uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) },
      uStarPos: { value: new THREE.Vector3() }, uStarCol: { value: new THREE.Color(1, 1, 1) }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: 1 },
    },
    vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// ---------- planetoïden (instanced, tollend) ----------
const rockVert = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying float vFade;
uniform vec3 uFadeCenter;
uniform float uFadeR;
mat3 rotAxis(vec3 a, float ang) {
  float c = cos(ang), s = sin(ang), t = 1.0 - c;
  return mat3(t * a.x * a.x + c, t * a.x * a.y + s * a.z, t * a.x * a.z - s * a.y,
              t * a.x * a.y - s * a.z, t * a.y * a.y + c, t * a.y * a.z + s * a.x,
              t * a.x * a.z + s * a.y, t * a.y * a.z - s * a.x, t * a.z * a.z + c);
}
void main() {
  float id = float(gl_InstanceID);
  vec3 ax = normalize(vec3(sin(id * 12.9898), cos(id * 78.233), sin(id * 37.719)) + 0.001);
  mat3 R = rotAxis(ax, uTime * (0.05 + fract(id * 0.618) * 0.25) + id);
  vec3 p = R * position;
  vObj = position;
  mat4 im = mat4(1.0);
  #ifdef USE_INSTANCING
    im = instanceMatrix;
  #endif
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  vec3 ip = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFade = uFadeR > 0.0 ? 1.0 - smoothstep(uFadeR * 0.6, uFadeR, length(ip - uFadeCenter)) : 1.0;
  wp.xyz = ip + (wp.xyz - ip) * vFade;
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix * im) * (R * normal));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const rockFrag = /* glsl */ `
${NOISE}
uniform vec3 uStarPos;
uniform vec3 uStarCol;
uniform vec3 uRockA;
uniform vec3 uRockB;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
varying float vFade;
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(uStarPos - vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float tex = nz(vObj * 0.5 + 0.3).a * 0.6 + nz(vObj * 1.3).r * 0.4;
  vec3 alb = mix(uRockA, uRockB, tex);
  float d = max(dot(N, L), 0.0);
  vec3 col = alb * uStarCol * d * 1.1 + alb * 0.02;
  col += uStarCol * pow(1.0 - max(dot(N, V), 0.0), 4.0) * d * 0.15;
  gl_FragColor = vec4(col, 1.0);
}
`;
export function makeRockMaterial(a = '#6e655c', b = '#9a8f82') {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uStarPos: { value: new THREE.Vector3() }, uStarCol: { value: new THREE.Color(1, 1, 1) }, uRockA: { value: new THREE.Color(a) }, uRockB: { value: new THREE.Color(b) },
      uFadeCenter: { value: new THREE.Vector3() }, uFadeR: { value: 0 } },
    vertexShader: rockVert, fragmentShader: rockFrag,
  });
}

// ---------- komeetstaart (cilindrisch billboard langs de staart) ----------
const tailVert = /* glsl */ `
uniform vec3 uHead;
uniform vec3 uAxis;
uniform vec3 uBend;
uniform float uLen;
uniform float uWidth;
varying vec2 vT;
void main() {
  float t = position.x;
  float side = position.y;
  vec3 c = uHead + uAxis * t * uLen + uBend * t * t * uLen;
  vec3 tang = normalize(uAxis + 2.0 * uBend * t);
  vec3 toCam = normalize(cameraPosition - c);
  vec3 sideV = normalize(cross(tang, toCam));
  float w = uWidth * (0.12 + t * 0.9);
  c += sideV * side * w;
  vT = vec2(t, side);
  gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0);
}
`;
const tailFrag = /* glsl */ `
${NOISE}
uniform vec3 uColor;
uniform float uSeed;
varying vec2 vT;
void main() {
  float t = vT.x;
  float s = vT.y;
  float streak = nz(vec3(s * 1.5 + uSeed, t * 0.6 - uTime * 0.02, uSeed)).a;
  float a = pow(1.0 - t, 1.6) * (1.0 - smoothstep(0.2, 1.0, abs(s))) * (0.55 + 0.9 * streak) * smoothstep(0.0, 0.03, t);
  gl_FragColor = vec4(uColor * a * 0.32, 1.0);
}
`;
export function makeTail(color, len, width, seed) {
  const pos = [];
  const SEG = 40;
  for (let i = 0; i < SEG; i++) {
    const t0 = i / SEG, t1 = (i + 1) / SEG;
    pos.push(t0, -1, 0, t0, 1, 0, t1, 1, 0, t0, -1, 0, t1, 1, 0, t1, -1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, uHead: { value: new THREE.Vector3() }, uAxis: { value: new THREE.Vector3(1, 0, 0) }, uBend: { value: new THREE.Vector3() },
      uLen: { value: len }, uWidth: { value: width }, uColor: { value: new THREE.Color(...color) }, uSeed: { value: seed } },
    vertexShader: tailVert, fragmentShader: tailFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- accretieschijf ----------
const diskFrag = /* glsl */ `
${NOISE}
uniform float uInner;
uniform float uOuter;
uniform float uSeed;
uniform vec3 uCenter;
uniform vec3 uNormal;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  float r = length(vLocal.xy);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float ang = atan(vLocal.y, vLocal.x);
  float rot = uTime * 0.6 / pow(r / uInner, 1.5);
  float a2 = ang - rot;
  vec3 q = vec3(cos(a2) * t * 3.0, sin(a2) * t * 3.0, t * 2.0 + uSeed);
  float tur = nz(q).r * 0.6 + nz(q * 3.0).a * 0.4;
  float streaks = nz(vec3(t * 14.0, cos(a2) * 0.6, sin(a2) * 0.6 + uSeed)).g;
  vec3 hot = vec3(1.0, 0.95, 0.9), warm = vec3(1.0, 0.55, 0.22), cool = vec3(0.6, 0.18, 0.08);
  vec3 col = t < 0.3 ? mix(hot, warm, t / 0.3) : mix(warm, cool, (t - 0.3) / 0.7);
  // dopplerversterking: de naderende kant is helderder
  vec3 tangent = normalize(cross(uNormal, normalize(vWorld - uCenter)));
  vec3 V = normalize(cameraPosition - vWorld);
  float beam = pow(1.0 + 0.65 * dot(tangent, V), 3.0);
  float b = (0.4 + 1.2 * tur) * (0.6 + 0.6 * streaks) * pow(1.0 - t, 1.5) * beam;
  float edge = smoothstep(0.0, 0.04, t);
  gl_FragColor = vec4(col * b * edge * 1.3, 1.0);
}
`;
export function makeDiskMaterial(inner, outer, seed) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uInner: { value: inner }, uOuter: { value: outer }, uSeed: { value: seed }, uCenter: { value: new THREE.Vector3() }, uNormal: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: ringVert, fragmentShader: diskFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// pulsarstralen (kegels langs de as)
const jetFrag = /* glsl */ `
${NOISE}
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float mu = abs(dot(normalize(vN), V));
  float t = 1.0 - vUv.y;
  float n = nz(vec3(vUv.x * 2.0, t * 3.0 - uTime * 0.3, 0.5)).r;
  float a = pow(mu, 1.5) * (1.0 - t) * (0.5 + n) * smoothstep(0.0, 0.05, t);
  gl_FragColor = vec4(uColor * a * 2.5, 1.0);
}
`;
export function makeJetMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color(...color) } },
    vertexShader: promVert, fragmentShader: jetFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function makeBlackMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: `void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }` });
}

// zachte vervaging van de nevel (scheidbaar, op halve resolutie) tegen korrel
const blurFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tSrc, vUv) * 0.2270270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846153846) * 0.3162162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692308) * 0.0702702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692308) * 0.0702702703;
  gl_FragColor = c;
}
`;
export function makeBlurMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: quadVert, fragmentShader: blurFrag, depthTest: false, depthWrite: false });
}
