import * as THREE from 'three';
import { EffectComposer } from '../../lib/three/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from '../../lib/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../lib/three/postprocessing/OutputPass.js';
import { ShaderPass } from '../../lib/three/postprocessing/ShaderPass.js';

import { U as EU, makeSkyMaterial } from '../../js/shaders.js';
import { DayCycle } from '../../js/daycycle.js';
import { UI } from '../../js/ui.js';
import { Music } from '../../js/audio.js';
import { bird } from '../../js/models.js';
import { makeNoiseData, makeNoiseTexture, makeSampler } from '../../ruimte/js/noise3d.js';
import { makeBlurMaterial } from '../../ruimte/js/shaders.js';
import { W, makeCloudMaterial, makeCompositeShader, makeBirdMaterial, makeTemporalMaterial } from './shaders.js';
import { Weather, REGIONS, F_REG, F_W, F_S, F_D } from './weather.js';
import { Storms } from './storms.js';
import { Pilot } from './pilot.js';

// ---------- kwaliteit ----------
const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const HIGH = params.get('q') ? parseFloat(params.get('q')) >= 0.9 : !mobile;
const CLOUD_SCALE = HIGH ? 0.5 : 0.34;
const BLUR = !params.has('noblur');

// ---------- renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
let maxPR = Math.min(devicePixelRatio, mobile ? 1.5 : 1.75);
let pixelRatio = Math.min(maxPR, mobile ? 1 : 1.25);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 1, 120000);
const origin = new THREE.Vector3();

// ---------- render targets ----------
const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
sceneRT.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
const cloudRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const cloudRT2 = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const histRT = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
let histIdx = 0, histValid = false;
function sizeTargets() {
  const w = Math.floor(innerWidth * pixelRatio), h = Math.floor(innerHeight * pixelRatio);
  sceneRT.setSize(w, h);
  cloudRT.setSize(Math.max(1, Math.floor(w * CLOUD_SCALE)), Math.max(1, Math.floor(h * CLOUD_SCALE)));
  cloudRT2.setSize(cloudRT.width, cloudRT.height);
  for (const h of histRT) h.setSize(cloudRT.width, cloudRT.height);
  histValid = false;
}
sizeTargets();

// ---------- hemel en vogels ----------
const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), makeSkyMaterial());
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);

const NB = 9;
const flocks = [0, 1].map(() => ({ x: 0, y: 0, z: 0, a: 0, alive: false, t: Math.random() * 50 }));
const birds = new THREE.InstancedMesh(bird(), makeBirdMaterial(), flocks.length * NB);
birds.frustumCulled = false;
birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(birds);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

// ---------- wolkenpass ----------
const cloudMat = makeCloudMaterial();
cloudMat.uniforms.uSteps.value = HIGH ? 72 : 40;
cloudMat.uniforms.uLSteps.value = HIGH ? 4 : 2;
cloudMat.uniforms.uDeckY.value = 450;
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadScene = (mat) => { const s = new THREE.Scene(); const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false; s.add(q); return s; };
const cloudScene = quadScene(cloudMat);
const blurMat = makeBlurMaterial();
const blurScene = quadScene(blurMat);
const temporalMat = makeTemporalMaterial();
const temporalScene = quadScene(temporalMat);
const prevQuat = new THREE.Quaternion();
// tijdsfilter + lichte vervaging; geeft de textuur terug die in de compositie gaat
function filterClouds() {
  const tu = temporalMat.uniforms;
  const rot = prevQuat.angleTo(camera.quaternion);
  prevQuat.copy(camera.quaternion);
  tu.tNew.value = cloudRT.texture;
  tu.tOld.value = histRT[histIdx].texture;
  tu.uAlpha.value = histValid ? THREE.MathUtils.clamp(0.3 + rot * 25, 0.3, 1) : 1;
  tu.uTexel.value.set(1 / cloudRT.width, 1 / cloudRT.height);
  histIdx = 1 - histIdx;
  renderer.setRenderTarget(histRT[histIdx]); renderer.render(temporalScene, quadCam);
  histValid = true;
  if (!BLUR) return histRT[histIdx].texture;
  const u = blurMat.uniforms;
  const BR = HIGH ? 0.35 : 0.8;
  u.tSrc.value = histRT[histIdx].texture; u.uDir.value.set(BR / cloudRT.width, 0);
  renderer.setRenderTarget(cloudRT2); renderer.render(blurScene, quadCam);
  u.tSrc.value = cloudRT2.texture; u.uDir.value.set(0, BR / cloudRT.height);
  renderer.setRenderTarget(cloudRT); renderer.render(blurScene, quadCam);
  return cloudRT.texture;
}

// ---------- nabewerking ----------
const composer = new EffectComposer(renderer);
const composite = new ShaderPass(makeCompositeShader());
composer.addPass(composite);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uBars: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) }, uFade: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uBars; uniform vec2 uRes; uniform float uFade;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      vec3 col = texture2D(tDiffuse, uv).rgb;
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.08);
      col *= mix(1.0, 1.0 - smoothstep(0.2, 0.9, r2 * 1.6), 0.35);
      col += (hash(uv * uRes + fract(uTime) * 100.0) - 0.5) * 0.01;
      float bar = step(uv.y, uBars) + step(1.0 - uBars, uv.y);
      col = mix(col, vec3(0.0), bar);
      gl_FragColor = vec4(col * uFade, 1.0);
    }`,
});
composer.addPass(grade);
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);

// ---------- wereld ----------
const ui = new UI();
const music = new Music((s) => ui.music(s));
ui.music(music.state);
const day = new DayCycle(params.has('t') ? parseFloat(params.get('t')) : 0.7, 480);
let weather, storms, pilot;

// ---------- invoer ----------
const keys = new Set();
let cinema = false, barsT = 0;
const unlockAudio = (e) => {
  if (e.target && e.target.closest && e.target.closest('[data-act="music"], .worlds')) return;
  if (e.type === 'keydown' && e.key.toLowerCase() === 'm') return;
  music.unlock();
};
addEventListener('pointerdown', unlockAudio, true);
addEventListener('keydown', unlockAudio, true);
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  keys.add(k);
  ui.poke();
  if (e.repeat || !pilot) return;
  if (k === ' ') { pilot.paused = !pilot.paused; ui.toast(pilot.paused ? 'Gepauzeerd' : 'Verder'); }
  if (k === 't') { day.skip(); ui.toast('De tijd verstrijkt…'); }
  if (k === 'c') cinema = !cinema;
  if (k === 'h') ui.toggle();
  if (k === 'm') music.toggle();
  if (k === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

let drag = null, dragSteer = 0, dragClimb = 0;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); ui.poke(); });
addEventListener('pointermove', (e) => {
  ui.poke();
  if (!pilot) return;
  if (drag && e.pointerId === drag.id) {
    dragSteer = -THREE.MathUtils.clamp((e.clientX - drag.x) / (innerWidth * 0.22), -1, 1);
    dragClimb = -THREE.MathUtils.clamp((e.clientY - drag.y) / (innerHeight * 0.3), -1, 1);
  } else if (e.pointerType === 'mouse') {
    pilot.lookYawT = -((e.clientX / innerWidth) - 0.5) * 0.35;
    pilot.lookPitchT = -((e.clientY / innerHeight) - 0.5) * 0.25;
  }
});
const endDrag = (e) => {
  if (drag && e && ui.hidden && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) ui.toggle();
  drag = null; dragSteer = 0; dragClimb = 0;
};
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
document.addEventListener('mouseleave', () => { if (pilot) { pilot.lookYawT = 0; pilot.lookPitchT = 0; } });
addEventListener('wheel', (e) => { if (pilot) pilot.cruise = THREE.MathUtils.clamp(pilot.cruise * (e.deltaY > 0 ? 0.92 : 1.08), 25, 300); ui.poke(); }, { passive: true });
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
  e.stopPropagation();
  const a = b.dataset.act;
  if (a === 'time') { day.skip(); ui.toast('De tijd verstrijkt…'); }
  if (a === 'pause' && pilot) { pilot.paused = !pilot.paused; ui.toast(pilot.paused ? 'Gepauzeerd' : 'Verder'); }
  if (a === 'cinema') cinema = !cinema;
  if (a === 'hide') ui.toggle();
  if (a === 'music') music.toggle();
}));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  sizeTargets();
  grade.uniforms.uRes.value.set(innerWidth, innerHeight);
});

const fract = (v) => v - Math.floor(v);
function maybeRebase() {
  const p = pilot.pos;
  if (Math.abs(p.x) < 20000 && Math.abs(p.z) < 20000) return;
  const dx = Math.round(p.x / 8000) * 8000, dz = Math.round(p.z / 8000) * 8000;
  origin.x += dx; origin.z += dz;
  p.x -= dx; p.z -= dz;
  camera.position.x -= dx; camera.position.z -= dz;
}

// ---------- vogels ----------
function updateBirds(dt, dir) {
  let bi = 0;
  const p = pilot.pos;
  for (const F of flocks) {
    if (F.alive) {
      const dx = F.x - p.x, dz = F.z - p.z;
      if (Math.hypot(dx, dz) > 4000 || dx * dir.x + dz * dir.z < -800) F.alive = false;
    }
    if (!F.alive && Math.random() < 0.003) {
      const a = Math.atan2(dir.x, dir.z) + (Math.random() - 0.5) * 1.2;
      const d = 900 + Math.random() * 1600;
      F.x = p.x + Math.sin(a) * d; F.z = p.z + Math.cos(a) * d;
      F.y = p.y + (Math.random() - 0.3) * 160;
      F.a = Math.atan2(dir.x, dir.z) + (Math.random() < 0.5 ? 1 : -1) * (0.9 + Math.random() * 1.2);
      F.alive = true;
    }
    F.t += dt;
    F.x += Math.sin(F.a) * 16 * dt; F.z += Math.cos(F.a) * 16 * dt;
    F.a += Math.sin(F.t * 0.15) * 0.02 * dt;
    for (let i = 0; i < NB; i++) {
      const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      const ox = side * row * 3.2, oz = -row * 2.8;
      const ca = Math.cos(F.a), sa = Math.sin(F.a);
      _p.set(F.x + ca * ox + sa * oz, F.y + Math.sin(F.t * 0.7 + i) * 0.6, F.z - sa * ox + ca * oz);
      _e.set(0, F.a, 0);
      _q.setFromEuler(_e);
      _s.setScalar(F.alive ? 1.4 : 0);
      _m.compose(_p, _q, _s);
      birds.setMatrixAt(bi++, _m);
    }
  }
  birds.instanceMatrix.needsUpdate = true;
}

// ---------- hoofdlus ----------
const clock = new THREE.Clock();
const camTrue = new THREE.Vector3();
let time = 0, distance = 0, started = false, startedAt = 0;
let region = -1, regionCand = -1, regionTimer = 0;
let frameAcc = 0, frameN = 0, qualityTimer = 0;
const TONE = [1, 3, 0, 4, 2];

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt;
  EU.uTime.value = time;
  grade.uniforms.uTime.value = time;
  EU.uPixelRatio.value = pixelRatio;
  const st = day.update(dt);

  if (started) {
    let ks = 0;
    if (keys.has('arrowleft') || keys.has('a')) ks += 1;
    if (keys.has('arrowright') || keys.has('d')) ks -= 1;
    pilot.steer += (THREE.MathUtils.clamp(ks + dragSteer, -1, 1) - pilot.steer) * Math.min(1, dt * 4);
    if (keys.has('arrowup') || keys.has('w')) pilot.cruise = Math.min(300, pilot.cruise + 40 * dt);
    if (keys.has('arrowdown') || keys.has('s')) pilot.cruise = Math.max(25, pilot.cruise - 40 * dt);
    pilot.climb = drag ? dragClimb : (keys.has('e') || keys.has('pageup') ? 1 : 0) - (keys.has('q') || keys.has('pagedown') ? 1 : 0);

    camTrue.copy(pilot.pos).add(origin);
    weather.eye = weather.eyeNear(camTrue.x, camTrue.z);
    pilot.storms = storms.cells;
    const dir = pilot.update(dt);
    distance += pilot.speed * dt;
    maybeRebase();
    camTrue.copy(pilot.pos).add(origin);
    storms.update(dt, pilot.pos, camTrue);
    updateBirds(dt, dir);

    const r = weather.regionAt(camTrue.x, camTrue.z);
    if (r !== regionCand) { regionCand = r; regionTimer = 0; }
    regionTimer += dt;
    if (regionCand !== region && regionTimer > 2.5) { region = regionCand; ui.region(REGIONS[region]); }
    const wx = weather.at(camTrue.x, camTrue.z, {}).w;
    EU.uAurora.value = THREE.MathUtils.smoothstep(st.night, 0.7, 1.0) * (0.15 + 0.85 * wx.pol);
    EU.uCloudCover.value = 0.6 - wx.pol * 0.12 + 0.05 * Math.sin(time * 0.02);
    EU.uCloudOff.value.set((((camTrue.x / 2600) % 64) + 64) % 64, (((camTrue.z / 2600) % 64) + 64) % 64);
    music.setMood({ night: st.night, biome: TONE[Math.max(region, 0)], wind: 0.35 + pilot.speed / 260 });

    ui.update({ clock: day.clock(), distance, speed: pilot.speed, heading: pilot.heading, altitude: pilot.pos.y, paused: pilot.paused });
  }

  sky.position.copy(camera.position);
  camera.updateMatrixWorld();

  // wolken-uniforms
  const cu = cloudMat.uniforms;
  cu.uInvProj.value.copy(camera.projectionMatrixInverse);
  cu.uCamWorld.value.copy(camera.matrixWorld);
  cu.uCamPos.value.copy(camera.position);
  cu.uNear.value = camera.near;
  cu.uFar.value = camera.far;
  cu.uOffR.value.set(fract(origin.x * F_REG), 0, fract(origin.z * F_REG));
  cu.uOffW.value.set(fract(origin.x * F_W), 0, fract(origin.z * F_W));
  cu.uOffS.value.set(fract(origin.x * F_S), 0, fract(origin.z * F_S));
  cu.uOffD.value.set(fract((origin.x + time * 4) * F_D), 0, fract((origin.z + time * 1.5) * F_D));
  if (weather && weather.eye) cu.uEye.value.set(weather.eye.x - origin.x, weather.eye.z - origin.z, weather.eye.R, 1);
  else cu.uEye.value.w = 0;
  cu.uDepth.value = sceneRT.depthTexture;
  cu.uFrame.value = (cu.uFrame.value + 1) % 1000;

  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(cloudRT);
  renderer.render(cloudScene, quadCam);
  const cloudTex = filterClouds();
  renderer.setRenderTarget(null);
  const co = composite.uniforms;
  co.tScene.value = sceneRT.texture;
  co.tCloud.value = cloudTex;
  co.uInvProj.value.copy(camera.projectionMatrixInverse);
  co.uCamWorld.value.copy(camera.matrixWorld);

  bloom.strength = 0.3 + st.night * 0.3 + W.uFlash.value * 0.2;
  barsT += ((cinema ? 0.1 : 0) - barsT) * Math.min(1, dt * 3);
  grade.uniforms.uBars.value = barsT;
  const fade = started ? Math.min(1, (performance.now() - startedAt) / 2500) : 0;
  grade.uniforms.uFade.value = fade * fade;
  composer.render(dt);

  frameAcc += dt; frameN++; qualityTimer += dt;
  if (qualityTimer > 2.5 && started) {
    const avg = frameAcc / frameN;
    let next = pixelRatio;
    if (avg > 1 / 40) next = Math.max(0.6, pixelRatio - 0.15);
    else if (avg < 1 / 58 && pixelRatio < maxPR) next = Math.min(maxPR, pixelRatio + 0.1);
    if (next !== pixelRatio) {
      pixelRatio = next;
      renderer.setPixelRatio(pixelRatio);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(innerWidth, innerHeight);
      sizeTargets();
    }
    frameAcc = 0; frameN = 0; qualityTimer = 0;
  }
  requestAnimationFrame(frame);
}

// ---------- laden ----------
async function boot() {
  const bar = document.getElementById('loadbar');
  bar.style.transform = 'scaleX(0.15)';
  await new Promise((r) => setTimeout(r, 30));
  const data = makeNoiseData();
  W.uNoise.value = makeNoiseTexture(data);
  bar.style.transform = 'scaleX(0.7)';
  await new Promise((r) => setTimeout(r, 30));
  weather = new Weather(makeSampler(data));
  storms = new Storms(scene, weather, origin, (d) => music.thunder(d));
  pilot = new Pilot(camera, weather, origin);
  // startplek: een gebied naar keuze (standaard de wolkenzee of de torens)
  const want = params.has('gebied') ? [parseInt(params.get('gebied'))] : [0, 1];
  const seed = params.has('seed') ? parseInt(params.get('seed')) : 0;
  // kies uit een reeks kandidaten de plek die het diepst in het gewenste gebied ligt
  let sx = seed * 37000, sz = seed * 23000, best = -1;
  for (let i = 0; i < 700; i++) {
    const a = i * 2.399, r = 6000 * Math.sqrt(i);
    const x = seed * 37000 + Math.cos(a) * r, z = seed * 23000 + Math.sin(a) * r;
    weather.eye = weather.eyeNear(x, z);
    const ww = weather.at(x, z, {}).w;
    const strong = [ww.sea, ww.tow, ww.pas, ww.pol, ww.eye];
    for (const g of want) {
      const sc = strong[g] * (weather.regionAt(x, z) === g ? 1 : 0.2) - i * 0.0004;
      if (sc > best) { best = sc; sx = x; sz = z; }
    }
  }
  origin.set(Math.round(sx / 8000) * 8000, 0, Math.round(sz / 8000) * 8000);
  pilot.pos.set(sx - origin.x, Math.max(weather.topAt(sx, sz), 1800) + 350, sz - origin.z);
  camTrue.copy(pilot.pos).add(origin);
  weather.eye = weather.eyeNear(camTrue.x, camTrue.z);
  day.update(0);
  pilot.update(0.016);
  renderer.compile(scene, camera);
  bar.style.transform = 'scaleX(1)';
  started = true;
  startedAt = performance.now();
  document.body.classList.add('ready');
  region = regionCand = weather.regionAt(camTrue.x, camTrue.z);
  setTimeout(() => ui.region(REGIONS[region]), 1800);
  ui.start();
  clock.getDelta();
}

requestAnimationFrame(frame);
boot();
window.__wolken = { get pilot() { return pilot; }, get weather() { return weather; }, get storms() { return storms; }, origin, day, EU, W };
