import * as THREE from 'three';
import { EffectComposer } from '../../lib/three/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from '../../lib/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../lib/three/postprocessing/OutputPass.js';
import { ShaderPass } from '../../lib/three/postprocessing/ShaderPass.js';

import { U, makeSkyMaterial, makeStarsMaterial, makeDustMaterial, makeNebulaMaterial, makeCompositeShader, makeBlurMaterial } from './shaders.js';
import { makeNoiseData, makeNoiseTexture, makeSampler } from './noise3d.js';
import { Universe, REGIONS, F_NEB, F_REG, SECTOR } from './universe.js';
import { Bodies } from './bodies.js';
import { Pilot } from './pilot.js';
import { Hud } from './hud.js';
import { Music } from '../../js/audio.js';

// ---------- kwaliteit ----------
const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const HIGH = params.get('q') ? parseFloat(params.get('q')) >= 0.9 : !mobile;
const NEB_SCALE = HIGH ? 0.5 : 0.34;
const NEB_STEPS = HIGH ? 56 : 28;

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
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1, 400000);
const origin = new THREE.Vector3();

// ---------- render targets ----------
function makeSceneRT() {
  const w = Math.floor(innerWidth * pixelRatio), h = Math.floor(innerHeight * pixelRatio);
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
  rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  return rt;
}
let sceneRT = makeSceneRT();
const nebRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const nebRT2 = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
function sizeTargets() {
  const w = Math.floor(innerWidth * pixelRatio), h = Math.floor(innerHeight * pixelRatio);
  sceneRT.setSize(w, h);
  sceneRT.depthTexture.image.width = w;
  sceneRT.depthTexture.image.height = h;
  nebRT.setSize(Math.max(1, Math.floor(w * NEB_SCALE)), Math.max(1, Math.floor(h * NEB_SCALE)));
  nebRT2.setSize(nebRT.width, nebRT.height);
}
sizeTargets();

// ---------- hemel, sterren en stof ----------
const sky = new THREE.Mesh(new THREE.SphereGeometry(300000, 64, 32), makeSkyMaterial());
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);

const STAR_BOX = 8000, DUST_BOX = 800;
function points(n, box, extra) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3);
  for (let i = 0; i < p.length; i++) p[i] = Math.random() * box;
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  if (extra) extra(g, n);
  return g;
}
const starsGeo = points(HIGH ? 7000 : 3500, STAR_BOX, (g, n) => {
  const r = new Float32Array(n * 4);
  for (let i = 0; i < r.length; i++) r[i] = Math.random();
  g.setAttribute('aRand', new THREE.BufferAttribute(r, 4));
});
const stars = new THREE.Points(starsGeo, makeStarsMaterial(STAR_BOX));
stars.frustumCulled = false;
scene.add(stars);

const nDust = HIGH ? 700 : 400;
const dustGeo = new THREE.BufferGeometry();
{
  const p = new Float32Array(nDust * 6), side = new Float32Array(nDust * 2), rnd = new Float32Array(nDust * 2);
  for (let i = 0; i < nDust; i++) {
    const x = Math.random() * DUST_BOX, y = Math.random() * DUST_BOX, z = Math.random() * DUST_BOX, r = Math.random();
    p.set([x, y, z, x, y, z], i * 6);
    side[i * 2] = 0; side[i * 2 + 1] = 1;
    rnd[i * 2] = r; rnd[i * 2 + 1] = r;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  dustGeo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  dustGeo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
}
const dustMat = makeDustMaterial(DUST_BOX);
const dust = new THREE.LineSegments(dustGeo, dustMat);
dust.frustumCulled = false;
scene.add(dust);

// ---------- nevels ----------
const nebMat = makeNebulaMaterial();
nebMat.uniforms.uSteps.value = NEB_STEPS;
nebMat.uniforms.uFN.value = F_NEB;
nebMat.uniforms.uFR.value = F_REG;
const nebScene = new THREE.Scene();
const nebQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), nebMat);
nebQuad.frustumCulled = false;
nebScene.add(nebQuad);
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blurMat = makeBlurMaterial();
const blurScene = new THREE.Scene();
const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat);
blurQuad.frustumCulled = false;
blurScene.add(blurQuad);
function blurNebula() {
  const u = blurMat.uniforms;
  for (let k = 0; k < 2; k++) {
    u.tSrc.value = nebRT.texture; u.uDir.value.set(1 / nebRT.width, 0);
    renderer.setRenderTarget(nebRT2); renderer.render(blurScene, quadCam);
    u.tSrc.value = nebRT2.texture; u.uDir.value.set(0, 1 / nebRT.height);
    renderer.setRenderTarget(nebRT); renderer.render(blurScene, quadCam);
  }
}

// ---------- nabewerking ----------
const composer = new EffectComposer(renderer);
const composite = new ShaderPass(makeCompositeShader());
composer.addPass(composite);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.75);
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
      vec2 off = c * r2 * 0.004;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      col *= mix(1.0, 1.0 - smoothstep(0.2, 0.9, r2 * 1.6), 0.4);
      float n = hash(uv * uRes + fract(uTime) * 100.0) - 0.5;
      col += n * 0.008 * (0.3 + dot(col, vec3(0.33)));
      float bar = step(uv.y, uBars) + step(1.0 - uBars, uv.y);
      col = mix(col, vec3(0.0), bar);
      col *= uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);

// ---------- wereld ----------
const hud = new Hud();
const music = new Music((s) => hud.music(s));
hud.music(music.state);
let universe, bodies;
const pilot = new Pilot(camera);

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
  hud.poke();
  if (e.repeat) return;
  if (k === ' ') { pilot.paused = !pilot.paused; hud.toast(pilot.paused ? 'Gepauzeerd' : 'Verder'); }
  if (k === 'n') { pilot.next(); hud.toast('Op naar de volgende bezienswaardigheid'); }
  if (k === 'c') cinema = !cinema;
  if (k === 'h') hud.toggle();
  if (k === 'm') music.toggle();
  if (k === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

let drag = null, dragYaw = 0, dragPitch = 0;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); hud.poke(); });
addEventListener('pointermove', (e) => {
  hud.poke();
  if (drag && e.pointerId === drag.id) {
    dragYaw = -THREE.MathUtils.clamp((e.clientX - drag.x) / (innerWidth * 0.22), -1, 1);
    dragPitch = -THREE.MathUtils.clamp((e.clientY - drag.y) / (innerHeight * 0.25), -1, 1);
  } else if (e.pointerType === 'mouse') {
    pilot.lookYawT = -((e.clientX / innerWidth) - 0.5) * 0.35;
    pilot.lookPitchT = -((e.clientY / innerHeight) - 0.5) * 0.2;
  }
});
const endDrag = (e) => {
  if (drag && e && hud.hidden && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) hud.toggle();
  drag = null; dragYaw = 0; dragPitch = 0;
};
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
document.addEventListener('mouseleave', () => { pilot.lookYawT = 0; pilot.lookPitchT = 0; });
addEventListener('wheel', (e) => { pilot.factor = THREE.MathUtils.clamp(pilot.factor * (e.deltaY > 0 ? 0.9 : 1.1), 0.2, 4); hud.poke(); }, { passive: true });
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
  e.stopPropagation();
  const a = b.dataset.act;
  if (a === 'next') { pilot.next(); hud.toast('Op naar de volgende bezienswaardigheid'); }
  if (a === 'pause') { pilot.paused = !pilot.paused; hud.toast(pilot.paused ? 'Gepauzeerd' : 'Verder'); }
  if (a === 'cinema') cinema = !cinema;
  if (a === 'hide') hud.toggle();
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

// ---------- floating origin ----------
const REBASE = 20000, STEP = 8000;
function maybeRebase() {
  const p = pilot.pos;
  if (Math.abs(p.x) < REBASE && Math.abs(p.y) < REBASE && Math.abs(p.z) < REBASE) return;
  const d = new THREE.Vector3(Math.round(p.x / STEP) * STEP, Math.round(p.y / STEP) * STEP, Math.round(p.z / STEP) * STEP);
  origin.add(d);
  p.sub(d);
  camera.position.sub(d);
}
const fract = (v) => v - Math.floor(v);

// ---------- hoofdlus ----------
const clock = new THREE.Clock();
const camTrue = new THREE.Vector3();
const tmp = new THREE.Vector3();
const MOODS = ['nebula', 'nebula', 'nebula', 'void', 'vortex'];
let time = 0, distance = 0, started = false, startedAt = 0;
let region = -1, regionCand = -1, regionTimer = 0;
let lastTargetId = null;
let frameAcc = 0, frameN = 0, qualityTimer = 0;
const RARE = { blackhole: 'Een zwart gat in zicht', pulsar: 'Een pulsar in zicht', pneb: 'Een planetaire nevel in zicht', comet: 'Een komeet in zicht' };

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt;
  U.uTime.value = time;
  grade.uniforms.uTime.value = time;
  U.uPixelRatio.value = pixelRatio;

  if (started) {
    let yaw = 0, pitch = 0;
    if (keys.has('arrowleft') || keys.has('a')) yaw += 1;
    if (keys.has('arrowright') || keys.has('d')) yaw -= 1;
    if (keys.has('e') || keys.has('pageup')) pitch += 1;
    if (keys.has('q') || keys.has('pagedown')) pitch -= 1;
    pilot.yawIn += (THREE.MathUtils.clamp(yaw + dragYaw, -1, 1) - pilot.yawIn) * Math.min(1, dt * 4);
    pilot.pitchIn += (THREE.MathUtils.clamp(pitch + dragPitch, -1, 1) - pilot.pitchIn) * Math.min(1, dt * 4);
    if (keys.has('arrowup') || keys.has('w')) pilot.factor = Math.min(4, pilot.factor * (1 + dt * 0.8));
    if (keys.has('arrowdown') || keys.has('s')) pilot.factor = Math.max(0.2, pilot.factor / (1 + dt * 0.8));

    camTrue.copy(pilot.pos).add(origin);
    bodies.update(dt, time, pilot.pos, camTrue);
    const nearest = pilot.update(dt, bodies.pois, bodies.obstacles);
    distance += pilot.speed * dt;
    maybeRebase();
    camTrue.copy(pilot.pos).add(origin);

    // bijzonder doel: korte melding
    const tg = pilot.target;
    if (tg && tg.o.id !== lastTargetId) {
      lastTargetId = tg.o.id;
      if (RARE[tg.o.kind]) hud.toast(RARE[tg.o.kind], 3200);
    }

    // gebied
    let r = universe.regionAt(camTrue.x, camTrue.y, camTrue.z);
    if (bodies.bh && bodies.bh.dist < 16000) r = 4;
    if (r !== regionCand) { regionCand = r; regionTimer = 0; }
    regionTimer += dt;
    if (regionCand !== region && regionTimer > 2.5) {
      region = regionCand;
      hud.region(REGIONS[region].name, REGIONS[region].sub);
    }
    music.setMood({ name: MOODS[Math.max(region, 0)], biome: Math.max(region, 0), night: 0, wind: 0.15 + pilot.speed / 1400, bright: [950, 1150, 850, 650, 520][Math.max(region, 0)] });

    // dichtbij-vlak afhankelijk van de afstand tot het dichtstbijzijnde object
    camera.near = THREE.MathUtils.clamp(nearest * 0.02, 0.5, 40);
    camera.updateProjectionMatrix();

    hud.update(dt, { distance, speed: pilot.speed, near: bodies.info });
  }

  sky.position.copy(camera.position);
  tmp.copy(pilot.fwd).multiplyScalar(pilot.speed);
  dustMat.uniforms.uVel.value.lerp(tmp, Math.min(1, dt * 3));
  camera.updateMatrixWorld();

  // nevel-uniforms
  const nu = nebMat.uniforms;
  nu.uInvProj.value.copy(camera.projectionMatrixInverse);
  nu.uCamWorld.value.copy(camera.matrixWorld);
  nu.uCamPos.value.copy(camera.position);
  nu.uNear.value = camera.near;
  nu.uFar.value = camera.far;
  nu.uOffN.value.set(fract(origin.x * F_NEB), fract(origin.y * F_NEB), fract(origin.z * F_NEB));
  nu.uOffR.value.set(fract(origin.x * F_REG), fract(origin.y * F_REG), fract(origin.z * F_REG));
  for (let i = 0; i < 4; i++) {
    const l = bodies && bodies.lights[i];
    if (l) { nu.uLightPos.value[i].copy(l.pos); nu.uLightCol.value[i].set(l.col.r, l.col.g, l.col.b); }
    else { nu.uLightPos.value[i].set(0, 1e7, 0); nu.uLightCol.value[i].set(0, 0, 0); }
  }
  const sp = bodies && bodies.special;
  if (sp) { nu.uSpecial.value.set(sp.pos.x, sp.pos.y, sp.pos.z, sp.r); nu.uSpecialType.value = sp.type; }
  else nu.uSpecial.value.w = 0;
  nu.uDepth.value = sceneRT.depthTexture;

  // zwaartekrachtlens
  const cu = composite.uniforms;
  cu.uAspect.value = camera.aspect;
  cu.uBH.value.w = 0;
  if (bodies && bodies.bh) {
    const bh = bodies.bh;
    tmp.copy(bh.pos).sub(camera.position);
    const front = tmp.dot(pilot.fwd) > 0;
    if (front) {
      const v = bh.pos.clone().project(camera);
      const ang = Math.atan((bh.r * 2.6) / Math.max(bh.dist, 1));
      const rad = Math.tan(ang) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.5;
      cu.uBH.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, rad, 1);
    }
  }

  // renderen: scène → nevel → compositie en nabewerking
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(nebRT);
  renderer.render(nebScene, quadCam);
  blurNebula();
  renderer.setRenderTarget(null);
  cu.tScene.value = sceneRT.texture;
  cu.tNeb.value = nebRT.texture;

  barsT += ((cinema ? 0.1 : 0) - barsT) * Math.min(1, dt * 3);
  grade.uniforms.uBars.value = barsT;
  const fade = started ? Math.min(1, (performance.now() - startedAt) / 2500) : 0;
  grade.uniforms.uFade.value = fade * fade;
  composer.render(dt);

  // adaptieve resolutie
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
function startSpot() {
  // begin op een paar duizend eenheden van een sterrenstelsel met planeten
  const seed = params.has('seed') ? parseInt(params.get('seed')) : 0;
  const want = params.has('gebied') ? parseInt(params.get('gebied')) : -1;
  const base = seed * 7;
  for (let n = 0; n < 20000; n++) {
    const i = base + (n % 25) - 12, j = (Math.floor(n / 625) % 25) - 12, k = (Math.floor(n / 25) % 25) - 12;
    const objs = universe.sector(i, j, k);
    const star = objs.find((o) => o.kind === 'star');
    if (!star) continue;
    if (want >= 0 && universe.regionAt(...star.pos) !== want) continue;
    if (want < 0 && !objs.some((o) => o.kind === 'planet')) continue;
    return star;
  }
  return null;
}

async function boot() {
  const bar = document.getElementById('loadbar');
  bar.style.transform = 'scaleX(0.15)';
  await new Promise((r) => setTimeout(r, 30));
  const data = makeNoiseData();
  U.uNoise.value = makeNoiseTexture(data);
  bar.style.transform = 'scaleX(0.7)';
  await new Promise((r) => setTimeout(r, 30));
  universe = new Universe(makeSampler(data));
  bodies = new Bodies(scene, universe, origin, camera);
  const star = startSpot();
  if (star) {
    const dir = new THREE.Vector3(0.6, 0.12, 0.8).normalize();
    pilot.pos.set(star.pos[0], star.pos[1], star.pos[2]).addScaledVector(dir, star.radius * 30 + 2500);
    pilot.fwd.copy(dir).negate();
    pilot.fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.25).normalize();
  }
  maybeRebase();
  camTrue.copy(pilot.pos).add(origin);
  bodies.update(0.016, 0, pilot.pos, camTrue);
  pilot.update(0.016, bodies.pois, bodies.obstacles);
  renderer.compile(scene, camera);
  bar.style.transform = 'scaleX(1)';
  started = true;
  startedAt = performance.now();
  document.body.classList.add('ready');
  hud.start();
  clock.getDelta();
}

requestAnimationFrame(frame);
boot();
window.__ruimte = { pilot, get bodies() { return bodies; }, get universe() { return universe; }, origin, U };
