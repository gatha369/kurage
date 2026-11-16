import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';

/**
 * 透け感のための描画の順番：
 * 1. クラゲより奥のもの（背景・光の筋・奥の微粒子）を一枚の絵に描く
 * 2. その絵を画面に写し、クラゲはその絵を歪めて透かしながら描く（屈折）
 * 3. クラゲより手前の微粒子と、傘の手前に来た触手・口腕を最後に重ねる
 */
export class LayeredRenderPass extends Pass {
  bgTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private copy: FullScreenQuad;
  private copyMat: THREE.ShaderMaterial;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private jelly: THREE.Object3D,
    private backOnly: THREE.Object3D[],
    private setParticleMode: (mode: 'back' | 'front') => void,
  ) {
    super();
    this.needsSwap = false;
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat.uniforms.tDiffuse.value = this.bgTarget.texture;
    this.copy = new FullScreenQuad(this.copyMat);
  }

  setSize(width: number, height: number) {
    this.bgTarget.setSize(width, height);
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const autoClear = renderer.autoClear;
    // 1. 奥
    this.jelly.visible = false;
    this.setParticleMode('back');
    renderer.setRenderTarget(this.bgTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    // 2. 写す → クラゲ
    renderer.setRenderTarget(readBuffer);
    renderer.clear();
    this.copy.render(renderer);
    const bg = this.scene.background;
    this.scene.background = null;
    this.jelly.visible = true;
    for (const o of this.backOnly) o.visible = false;
    this.setParticleMode('front'); // 3. 手前の微粒子も一緒に
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);

    renderer.autoClear = autoClear;
    for (const o of this.backOnly) o.visible = true;
    this.scene.background = bg;
  }

  dispose() {
    this.bgTarget.dispose();
    this.copyMat.dispose();
    this.copy.dispose();
  }
}
