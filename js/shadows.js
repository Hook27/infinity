// Schaduwen van zon (en maan) met een eigen schaduwkaart: een orthografische camera boven het
// gebied vóór de kijker rendert de diepte van alle objecten op laag 1. De shaders vergelijken
// daar tegen met hardware-PCF (sampler2DShadow) voor zachte randen.
import * as THREE from 'three';
import { U } from './shaders.js';

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const _c = new THREE.Vector3();
const _v = new THREE.Vector3();

export class Shadows {
  constructor(renderer, { size, extent }) {
    this.renderer = renderer;
    this.size = size;
    this.extent = extent;
    const dt = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = THREE.LinearFilter;
    dt.magFilter = THREE.LinearFilter;
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, depthTexture: dt });
    const e = extent / 2;
    this.cam = new THREE.OrthographicCamera(-e, e, e, -e, 1, 1100);
    this.cam.layers.set(1);
    // één keer leeg renderen zodat de dieptetextuur (met vergelijkingsmodus) meteen bestaat
    renderer.setRenderTarget(this.rt);
    renderer.clear(false, true, false);
    renderer.setRenderTarget(null);
    U.uShadowMap.value = dt;
    U.uShadowTexel.value = 1 / size;
    this.strength = 0;
  }

  render(scene, center, lightDir, strength, casters) {
    this.strength += (strength - this.strength) * 0.1;
    U.uShadowOn.value = THREE.MathUtils.smoothstep(this.strength, 0.02, 0.12);
    if (U.uShadowOn.value <= 0) return;
    const cam = this.cam;
    const texel = this.extent / this.size;
    _c.copy(center);
    cam.position.copy(_c).addScaledVector(lightDir, 500);
    cam.lookAt(_c);
    cam.updateMatrixWorld();
    // op het texelraster vastzetten tegen 'zwemmende' schaduwranden
    _v.copy(_c).applyMatrix4(cam.matrixWorldInverse);
    const sx = _v.x - Math.round(_v.x / texel) * texel;
    const sy = _v.y - Math.round(_v.y / texel) * texel;
    const m = cam.matrixWorld.elements;
    cam.position.x -= m[0] * sx + m[4] * sy;
    cam.position.y -= m[1] * sx + m[5] * sy;
    cam.position.z -= m[2] * sx + m[6] * sy;
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

    for (const mesh of casters) {
      mesh.userData.mat = mesh.material;
      mesh.material = mesh.userData.depth;
    }
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.clear(false, true, false);
    r.render(scene, cam);
    r.setRenderTarget(prev);
    for (const mesh of casters) mesh.material = mesh.userData.mat;

    U.uShadowMatrix.value.copy(BIAS).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  }
}
