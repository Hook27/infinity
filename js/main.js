import * as THREE from 'three';
import { EffectComposer } from '../lib/three/postprocessing/EffectComposer.js';
import { RenderPass } from '../lib/three/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../lib/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../lib/three/postprocessing/OutputPass.js';
import { ShaderPass } from '../lib/three/postprocessing/ShaderPass.js';

import { U, makeTerrainMaterial, makePropMaterial, makeWaterMaterial, makeSkyMaterial } from './shaders.js';
import { World } from './terrain.js';
import { Life } from './life.js';
import { DayCycle } from './daycycle.js';
import { Pilot } from './pilot.js';
import { origin, temperatureAt, biomeIndex, BIOMES } from './world.js';
import { UI } from './ui.js';

// ---------- kwaliteit ----------
const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
const QUALITY = params.get('q') ? parseFloat(params.get('q')) : mobile ? 0.55 : 1;
const RADIUS = QUALITY >= 0.9 ? 7 : QUALITY >= 0.6 ? 6 : 5;
const CHUNK_EDGE = RADIUS * 48;
const VIEW = CHUNK_EDGE - 30;

// ---------- renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
let maxPR = Math.min(devicePixelRatio, mobile ? 1.5 : 2);
let pixelRatio = Math.min(maxPR, mobile ? 1 : 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 2600);

// ---------- materialen ----------
const mats = {
  terrain: makeTerrainMaterial(VIEW),
  prop: makePropMaterial({ edge: VIEW }),
  propDouble: makePropMaterial({ edge: VIEW, side: THREE.DoubleSide }),
  bird: makePropMaterial({ edge: VIEW + 120, wind: false, flap: true, side: THREE.DoubleSide, glowBase: 0 }),
  titan: makePropMaterial({ edge: 900, wind: false, walk: true }),
  cloud: makePropMaterial({ edge: 760, wind: false, soft: true, glowBase: 0 }),
  island: makePropMaterial({ edge: 1500, wind: false }),
};

// ---------- lucht & water ----------
const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), makeSkyMaterial());
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);

const water = new THREE.Mesh(new THREE.PlaneGeometry(VIEW * 2.6, VIEW * 2.6, 1, 1).rotateX(-Math.PI / 2), makeWaterMaterial(VIEW));
water.frustumCulled = false;
water.renderOrder = 2;
scene.add(water);

// ---------- wereld ----------
const world = new World(scene, mats.terrain, mats.prop, mats.propDouble, { radius: RADIUS, density: QUALITY >= 0.9 ? 1 : 0.6 });
const life = new Life(scene, mats, QUALITY);
const day = new DayCycle(params.has('t') ? parseFloat(params.get('t')) : 0.68, 480);
const pilot = new Pilot(camera);

// startpunt: zoek een mooie plek
const seedSpot = params.has('seed') ? parseInt(params.get('seed')) : 0;
pilot.place(seedSpot * 977, seedSpot * 613);

// ---------- nabewerking ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.55, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uBars: { value: 0 },
    uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
    uFade: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uBars; uniform vec2 uRes; uniform float uFade;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      // zachte kleurgrading: lichte S-curve en warme hooglichten
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, 1.14);
      col += vec3(0.012, 0.004, -0.01) * smoothstep(0.4, 1.0, lum);
      // vignet
      col *= mix(1.0, smoothstep(0.85, 0.18, r2 * 1.6), 0.55);
      // filmkorrel
      float n = hash(uv * uRes + fract(uTime) * 100.0) - 0.5;
      col += n * 0.028;
      // filmbalken
      float bar = step(uv.y, uBars) + step(1.0 - uBars, uv.y);
      col = mix(col, vec3(0.0), bar);
      col *= uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);

// ---------- invoer ----------
const keys = new Set();
const ui = new UI();
let cinema = false;
let barsT = 0;

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  keys.add(k);
  ui.poke();
  if (e.repeat) return;
  if (k === ' ') { pilot.paused = !pilot.paused; ui.toast(pilot.paused ? 'Gepauzeerd' : 'Verder'); }
  if (k === 't') { day.skip(); ui.toast('De tijd verstrijkt…'); }
  if (k === 'c') { cinema = !cinema; }
  if (k === 'h') ui.toggle();
  if (k === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// muis/touch: slepen = sturen, muispositie = rondkijken
let drag = null;
let pointerSteer = 0;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
  ui.poke();
});
addEventListener('pointermove', (e) => {
  ui.poke();
  if (drag && e.pointerId === drag.id) {
    const dx = (e.clientX - drag.x) / (innerWidth * 0.22);
    pointerSteer = -THREE.MathUtils.clamp(dx, -1, 1);
    const dy = (e.clientY - drag.y) / (innerHeight * 0.3);
    pilot.climb = -THREE.MathUtils.clamp(dy, -1, 1) * 0.6;
  } else if (e.pointerType === 'mouse') {
    pilot.lookYawT = -((e.clientX / innerWidth) - 0.5) * 0.35;
    pilot.lookPitchT = -((e.clientY / innerHeight) - 0.5) * 0.18;
  }
});
const endDrag = () => { drag = null; pointerSteer = 0; pilot.climb = 0; };
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
document.addEventListener('mouseleave', () => { pilot.lookYawT = 0; pilot.lookPitchT = 0; });
addEventListener('wheel', (e) => {
  pilot.cruise = THREE.MathUtils.clamp(pilot.cruise * (e.deltaY > 0 ? 0.92 : 1.08), 4, 45);
  ui.poke();
}, { passive: true });
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
  e.stopPropagation();
  const a = b.dataset.act;
  if (a === 'time') { day.skip(); ui.toast('De tijd verstrijkt…'); }
  if (a === 'pause') { pilot.paused = !pilot.paused; ui.toast(pilot.paused ? 'Gepauzeerd' : 'Verder'); }
  if (a === 'cinema') cinema = !cinema;
  if (a === 'hide') ui.toggle();
}));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  grade.uniforms.uRes.value.set(innerWidth, innerHeight);
});

// ---------- floating origin ----------
const REBASE = 1536, STEP = 384;
function maybeRebase() {
  const p = pilot.pos;
  if (Math.abs(p.x) < REBASE && Math.abs(p.z) < REBASE) return;
  const dx = Math.round(p.x / STEP) * STEP, dz = Math.round(p.z / STEP) * STEP;
  origin.x += dx; origin.z += dz;
  p.x -= dx; p.z -= dz;
  camera.position.x -= dx; camera.position.z -= dz;
  world.rebase(dx, dz);
  life.rebase(dx, dz);
}

// ---------- hoofdlus ----------
const clock = new THREE.Clock();
let time = 0;
let fade = 0;
let distance = 0;
let biome = -1, biomeCand = -1, biomeTimer = 0;
let frameAcc = 0, frameN = 0, qualityTimer = 0;
let started = false;
let startedAt = 0;

function frame() {
  const rawDt = Math.min(clock.getDelta(), 0.1);
  const dt = rawDt;
  time += dt;
  U.uTime.value = time;
  grade.uniforms.uTime.value = time;

  // besturing
  let ks = 0;
  if (keys.has('arrowleft') || keys.has('a')) ks += 1;
  if (keys.has('arrowright') || keys.has('d')) ks -= 1;
  pilot.steer += ((THREE.MathUtils.clamp(ks + pointerSteer, -1, 1)) - pilot.steer) * Math.min(1, dt * 4);
  if (keys.has('arrowup') || keys.has('w')) pilot.cruise = Math.min(45, pilot.cruise + 12 * dt);
  if (keys.has('arrowdown') || keys.has('s')) pilot.cruise = Math.max(4, pilot.cruise - 12 * dt);
  if (!drag) pilot.climb = (keys.has('e') || keys.has('pageup') ? 1 : 0) - (keys.has('q') || keys.has('pagedown') ? 1 : 0);

  const st = day.update(dt);
  const dir = pilot.update(dt);
  distance += pilot.speed * dt;
  maybeRebase();

  const wx = pilot.pos.x + origin.x, wz = pilot.pos.z + origin.z;
  world.update(wx, wz, dir.x, dir.z, started ? 5 : 40);

  // bioom-afhankelijke effecten
  const temp = temperatureAt(wx, wz);
  const cold = THREE.MathUtils.smoothstep(temp, 0.72, 0.9);
  U.uSnow.value += (cold - U.uSnow.value) * Math.min(1, dt * 0.5);
  U.uAurora.value = THREE.MathUtils.smoothstep(st.night, 0.75, 1.0) * (0.35 + 0.65 * cold);
  const b = biomeIndex(temp);
  if (b !== biomeCand) { biomeCand = b; biomeTimer = 0; }
  biomeTimer += dt;
  if (biomeCand !== biome && biomeTimer > 2.5) {
    biome = biomeCand;
    if (started) ui.region(BIOMES[biome]);
  }

  life.update(dt, pilot.pos, dir, st.night);

  sky.position.copy(camera.position);
  water.position.set(camera.position.x, 0, camera.position.z);

  bloom.strength = 0.42 + st.night * 0.45;
  bloom.threshold = 0.88 - st.night * 0.1;
  barsT += ((cinema ? 0.1 : 0) - barsT) * Math.min(1, dt * 3);
  grade.uniforms.uBars.value = barsT;
  if (started) fade = Math.min(1, (performance.now() - startedAt) / 2200);
  grade.uniforms.uFade.value = fade * fade;
  U.uPixelRatio.value = pixelRatio;

  composer.render(dt);

  ui.update({
    clock: day.clock(),
    distance,
    speed: pilot.speed,
    heading: pilot.heading,
    altitude: pilot.pos.y,
    paused: pilot.paused,
  });

  // adaptieve resolutie
  frameAcc += rawDt; frameN++; qualityTimer += rawDt;
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
    }
    frameAcc = 0; frameN = 0; qualityTimer = 0;
  }

  requestAnimationFrame(frame);
}

// ---------- laden ----------
async function boot() {
  const bar = document.getElementById('loadbar');
  day.update(0);
  pilot.update(0.016);
  const dir = pilot.dir;
  let total = 0;
  for (;;) {
    const left = world.update(pilot.pos.x + origin.x, pilot.pos.z + origin.z, dir.x, dir.z, 30, true);
    total = Math.max(total, left + world.chunks.size);
    bar.style.transform = `scaleX(${world.chunks.size / total})`;
    if (left === 0) break;
    await new Promise((r) => setTimeout(r, 0));
  }
  life.init(pilot.pos, dir);
  // een paar frames voorverwarmen zodat de shaders gecompileerd zijn
  renderer.compile(scene, camera);
  started = true;
  startedAt = performance.now();
  document.body.classList.add('ready');
  clock.getDelta();
  const t0 = temperatureAt(pilot.pos.x + origin.x, pilot.pos.z + origin.z);
  biome = biomeCand = biomeIndex(t0);
  setTimeout(() => ui.region(BIOMES[biome]), 1800);
  ui.start();
}

requestAnimationFrame(frame);
boot();

// voor debuggen / screenshots
window.__oneindig = { pilot, day, world, U };
