// GLSL boven de wolken: volumetrische wolken (raymarch met lichtverstrooiing en zelfschaduw),
// bliksem, regensluiers, een diepe wolkenlaag, compositie met de 'glorie', bliksemschichten en vogels.
// De hemel, zon, maan, sterren, sluierwolken en het noorderlicht komen uit de aardse shaders.
import * as THREE from 'three';
import { U as EU, COMMON } from '../../js/shaders.js';
import { WEATHER_GLSL } from './weather.js';

export const W = {
  uNoise: { value: null },
  uFlashPos: { value: new THREE.Vector3(0, -1e6, 0) },
  uFlash: { value: 0 },
};

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const cloudFrag = /* glsl */ `
${COMMON}
uniform highp sampler3D uNoise;
vec4 nz(vec3 p) { return texture(uNoise, p); }
${WEATHER_GLSL}
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uNear;
uniform float uFar;
uniform int uSteps;
uniform int uLSteps;
uniform float uMaxDist;
uniform vec3 uFlashPos;
uniform float uFlash;
uniform float uDeckY;
uniform float uFrame;
varying vec2 vUv;

const float BOTTOM = 150.0;
const float TOP = 13500.0;

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
}

// dichtheid van de wolk op p, gegeven het lokale weer W
float cloudAt(vec3 p, vec4 Wt, bool detail) {
  float hf = (p.y - Wt.y) / Wt.z;
  if (hf < 0.0 || hf > 1.0) return 0.0;
  float prof = smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(0.4, 1.0, hf));
  float anvil = smoothstep(5500.0, 9000.0, Wt.z) * smoothstep(0.78, 0.9, hf) * (1.0 - smoothstep(0.96, 1.0, hf));
  vec3 qs = p * F_S + uOffS;
  vec4 s = nz(qs);
  float shape = s.r * 0.35 + s.g * 0.45 + nz(qs * 2.0).g * 0.2;
  float d = shape * max(prof, anvil * 1.25);
  // koepels: hogerop minder dekking, behalve in het aambeeld van een onweerswolk
  float cov = Wt.x * (1.0 - hf * 0.55) + anvil * 0.35;
  d = clamp((d - (1.0 - cov) * 0.6) / (0.4 + cov * 0.6), 0.0, 1.0);
  if (detail && d > 0.0) {
    vec3 qd = p * F_D + uOffD + vec3(0.0, -uTime * 0.0015, 0.0);
    float det = nz(qd).a * 0.6 + nz(qd * 3.0).g * 0.4;
    d = clamp(d - det * 0.42 * (1.0 - hf * 0.3), 0.0, 1.0);
  }
  return d;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 vp = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 dirV = normalize(vp.xyz / vp.w);
  vec3 dir = normalize(mat3(uCamWorld) * dirV);
  vec3 ro = uCamPos;

  float tScene = uMaxDist;
  float dz = texture(uDepth, vUv).x;
  if (dz < 0.9999999) {
    float z = dz * 2.0 - 1.0;
    float viewZ = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
    tScene = viewZ / max(-dirV.z, 1e-3);
  }

  // waar gaat de straal door de wolkenlaag?
  float t0 = 0.0, t1 = uMaxDist;
  if (abs(dir.y) > 1e-4) {
    float ta = (BOTTOM - ro.y) / dir.y, tb = (TOP - ro.y) / dir.y;
    t0 = max(min(ta, tb), 0.0);
    t1 = min(max(ta, tb), uMaxDist);
  } else if (ro.y < BOTTOM || ro.y > TOP) { t1 = -1.0; }
  t1 = min(t1, tScene);

  vec3 sky = skyBase(normalize(vec3(dir.x, dir.y * 0.35, dir.z)));
  vec3 acc = vec3(0.0);
  float T = 1.0;

  if (t1 > t0) {
    // gebiedsparameters aan het begin en verder weg langs de straal
    vec4 PA, PB; vec2 PA2, PB2;
    regionParams((ro + dir * t0).xz, PA, PA2);
    regionParams((ro + dir * min(t1, t0 + 20000.0)).xz, PB, PB2);
    float cosT = dot(dir, uLightDir);
    float phase = mix(hg(cosT, 0.62), hg(cosT, -0.22), 0.3) * 0.9 + 0.1;
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.61803398);
    float t = t0;
    float N = float(uSteps);
    // stappen groeien met de afstand: fijn dichtbij, grof ver weg (bereik ~30 km)
    float rate = 3.6 / N;
    t += 40.0 * jit;
    for (int i = 0; i < 160; i++) {
      if (i >= uSteps || t > t1 || T < 0.01) break;
      float dt = 40.0 + (t - t0) * rate;
      vec3 p = ro + dir * t;
      float k = clamp((t - t0) / 20000.0, 0.0, 1.0);
      vec4 P = mix(PA, PB, k);
      vec2 P2 = mix(PA2, PB2, k);
      vec4 Wt = localWeather(p.xz, P, P2);
      float d = 0.0;
      float rain = 0.0;
      if (Wt.x > 0.01) d = cloudAt(p, Wt, t < 18000.0);
      // regensluiers onder onweerswolken
      if (Wt.w > 0.3 && p.y < Wt.y) {
        float streak = nz(vec3(p.x * F_D * 0.5, p.y * 0.00002 + uTime * 0.02, p.z * F_D * 0.5) + uOffD).r;
        rain = Wt.w * smoothstep(Wt.y - 3000.0, Wt.y, p.y) * smoothstep(0.45, 0.7, streak) * 0.05;
      }
      if (d > 0.001 || rain > 0.0) {
        float sigma = d * 0.06 + rain * 0.02;
        // licht richting zon: een paar stappen door de wolk
        float od = 0.0;
        float ls = 70.0;
        vec3 lp = p;
        for (int j = 0; j < 6; j++) {
          if (j >= uLSteps) break;
          lp += uLightDir * ls;
          od += cloudAt(lp, Wt, false) * ls;
          ls *= 1.8;
        }
        float ext = od * 0.05;
        float beer = exp(-ext) + 0.22 * exp(-ext * 0.22);
        float powder = 1.0 - exp(-d * 30.0);
        float hf = clamp((p.y - Wt.y) / Wt.z, 0.0, 1.0);
        vec3 amb = mix(uAmbGround * 0.8 + uHorizon * 0.04, uZenith * 0.5 + uAmbSky * 0.4, hf) * mix(0.5, 1.0, hf);
        vec3 sun = uLightCol * vec3(1.08, 0.97, 0.84) * beer * phase * mix(0.5, 1.0, powder) * 2.3;
        vec3 fl = vec3(0.72, 0.78, 1.0) * uFlash * 7.0 / (1.0 + dot(p - uFlashPos, p - uFlashPos) / (1800.0 * 1800.0));
        vec3 S = (sun + amb + fl) * sigma;
        float trans = exp(-sigma * dt);
        vec3 Sint = (S - S * trans) / max(sigma, 1e-6);
        float fog = 1.0 - exp(-t * 0.000022);
        acc += T * mix(Sint, sky * (1.0 - trans), fog);
        T *= trans;
      }
      t += dt;
    }
  }

  // een diepe wolkenlaag ver beneden: door gaten zie je nog meer wolken, nooit grond
  if (dir.y < -0.002 && T > 0.01) {
    float td = (uDeckY - ro.y) / dir.y;
    if (td > 0.0 && td < tScene) {
      vec3 hp = ro + dir * td;
      vec3 qw = vec3(hp.x * F_W * 2.0, 0.71, hp.z * F_W * 2.0) + uOffW * 2.0;
      float n = nz(qw).r * 0.6 + nz(qw * 3.0).g * 0.4;
      float deck = smoothstep(0.3, 0.6, n);
      vec3 dc = uLightCol * (0.55 + 0.45 * n) * max(uLightDir.y, 0.0) * 0.9 + uAmbSky * 0.7;
      float fog = 1.0 - exp(-td * 0.000045);
      vec3 haze = mix(uHorizon * 0.45, uZenith * 0.4, 0.5);
      vec3 c = mix(mix(haze, dc, deck), sky, fog);
      acc += T * c;
      T = 0.0;
    }
  }
  gl_FragColor = vec4(acc, T);
}
`;

const arr = () => new THREE.Vector3();
export function makeCloudMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...EU, ...W, uEdge: { value: 1e9 },
      uDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: arr() }, uNear: { value: 1 }, uFar: { value: 1 },
      uSteps: { value: 64 }, uLSteps: { value: 4 }, uMaxDist: { value: 60000 }, uDeckY: { value: -2500 }, uFrame: { value: 0 },
      uOffR: { value: arr() }, uOffW: { value: arr() }, uOffS: { value: arr() }, uOffD: { value: arr() }, uEye: { value: new THREE.Vector4() },
    },
    vertexShader: quadVert, fragmentShader: cloudFrag, depthTest: false, depthWrite: false,
  });
}

// ---------- compositie met de 'glorie' (gekleurde ring tegenover de zon, op wolken onder je) ----------
const compFrag = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tCloud;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uSunDir;
uniform float uSunVis;
uniform vec3 uLightCol;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tScene, vUv).rgb;
  vec4 c = texture2D(tCloud, vUv);
  vec3 col = s * c.a + c.rgb;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(mat3(uCamWorld) * normalize(vp.xyz / vp.w));
  float th = acos(clamp(dot(dir, -uSunDir), -1.0, 1.0));
  vec3 ring = vec3(0.0);
  // gekleurde ringen: rood buiten, blauw binnen
  ring += vec3(1.0, 0.35, 0.25) * exp(-pow((th - 0.052) / 0.008, 2.0));
  ring += vec3(0.4, 1.0, 0.5) * exp(-pow((th - 0.043) / 0.007, 2.0));
  ring += vec3(0.35, 0.5, 1.0) * exp(-pow((th - 0.035) / 0.007, 2.0));
  ring += vec3(1.0, 0.9, 0.8) * exp(-pow(th / 0.02, 2.0)) * 0.7;
  float onCloud = 1.0 - c.a;
  col += ring * onCloud * uSunVis * uLightCol * 0.22 * step(0.05, uSunDir.y);
  gl_FragColor = vec4(col, 1.0);
}
`;
export function makeCompositeShader() {
  return {
    uniforms: {
      tDiffuse: { value: null }, tScene: { value: null }, tCloud: { value: null },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uSunDir: EU.uSunDir, uSunVis: EU.uSunVis, uLightCol: EU.uLightCol,
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: compFrag,
  };
}

// ---------- bliksemschicht: lint dat naar de camera draait ----------
const boltVert = /* glsl */ `
attribute vec3 aDir;
attribute float aSide;
attribute float aW;
varying float vSide;
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 sideV = normalize(cross(aDir, toCam));
  p += sideV * aSide * aW;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const boltFrag = /* glsl */ `
uniform float uI;
varying float vSide;
void main() {
  float core = exp(-vSide * vSide * 6.0);
  vec3 col = vec3(0.75, 0.82, 1.0) * core * uI * 3.0 + vec3(1.0) * pow(core, 8.0) * uI * 4.0;
  gl_FragColor = vec4(col, 1.0);
}
`;
export function makeBoltMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { uI: { value: 1 } }, vertexShader: boltVert, fragmentShader: boltFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
}

// ---------- vogels: donkere silhouetten met vleugelslag ----------
const birdVert = /* glsl */ `
attribute vec3 aCol;
attribute float aSway;
uniform float uTime;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  p.y += sin(uTime * 4.5 + float(gl_InstanceID) * 1.3) * aSway * 0.9;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const birdFrag = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec3 uAmbSky;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 alb = vec3(0.12, 0.11, 0.1);
  vec3 col = alb * (uAmbSky + uLightCol * max(dot(N, uLightDir), 0.0));
  gl_FragColor = vec4(col, 1.0);
}
`;
export function makeBirdMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: EU.uTime, uLightDir: EU.uLightDir, uLightCol: EU.uLightCol, uAmbSky: EU.uAmbSky },
    vertexShader: birdVert, fragmentShader: birdFrag, side: THREE.DoubleSide,
  });
}

export { EU };

// tijdsfilter: meng het nieuwe wolkenbeeld met het vorige (minder ruis, rustiger beeld)
const temporalFrag = /* glsl */ `
uniform sampler2D tNew;
uniform sampler2D tOld;
uniform float uAlpha;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec4 n = texture2D(tNew, vUv);
  vec4 o = texture2D(tOld, vUv);
  // begrens de geschiedenis tot de buurt van het nieuwe beeld (tegen sporen bij beweging)
  vec4 mn = n, mx = n;
  for (int i = 0; i < 4; i++) {
    vec2 off = vec2(i == 0 ? 1.0 : i == 1 ? -1.0 : 0.0, i == 2 ? 1.0 : i == 3 ? -1.0 : 0.0) * uTexel;
    vec4 s = texture2D(tNew, vUv + off);
    mn = min(mn, s); mx = max(mx, s);
  }
  o = clamp(o, mn, mx);
  gl_FragColor = mix(o, n, uAlpha);
}
`;
export function makeTemporalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { tNew: { value: null }, tOld: { value: null }, uAlpha: { value: 0.35 }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: quadVert, fragmentShader: temporalFrag, depthTest: false, depthWrite: false,
  });
}
