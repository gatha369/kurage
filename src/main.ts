import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cloneParams, defaultParams } from './params';
import { AdaptiveQuality, IdleWatcher, lightFlicker, spotGeometry, QUALITY_TABLE, type QualityLevel } from './logic';
import { spotUniforms } from './scene/shared';
import { createBeam } from './scene/beam';
import { createParticles } from './scene/particles';
import { createPlaceholder } from './scene/placeholder';
import { createPost } from './scene/post';
import { createGui } from './gui';

const SPOT_HEIGHT = 12;
const LEVEL_NAMES = ['高', '中', '低'];

const params = cloneParams(defaultParams);
const app = document.getElementById('app')!;
const loading = document.getElementById('loading')!;

// ---- 描画の準備 ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
camera.position.set(0, 0.8, 8.5);

// ---- カメラ操作 ----
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true; // 指を離した後の惰性
controls.dampingFactor = 0.045;
controls.rotateSpeed = 0.7;
controls.enablePan = false;
controls.minDistance = 2.6; // クラゲの中に入らない
controls.maxDistance = 16; // 遠すぎて見えなくならない
controls.zoomSpeed = 0.7;

const clockStart = performance.now() / 1000;
const now = () => performance.now() / 1000 - clockStart;
const idle = new IdleWatcher(now());
const markInteraction = () => {
  idle.interact(now());
};
const el = renderer.domElement;
let pointerDown = false;
el.addEventListener('pointerdown', () => { pointerDown = true; markInteraction(); });
window.addEventListener('pointerup', () => { pointerDown = false; markInteraction(); });
window.addEventListener('pointercancel', () => { pointerDown = false; });
el.addEventListener('pointermove', () => { if (pointerDown) markInteraction(); });
el.addEventListener('wheel', markInteraction, { passive: true });
el.addEventListener('touchstart', markInteraction, { passive: true });

// ---- 照明 ----
const spot = new THREE.SpotLight(0xe6efff, 3, 0, 0.3, 0.7, 0);
scene.add(spot, spot.target);
const ambient = new THREE.AmbientLight(0x2a4c80, 0.12);
scene.add(ambient);

// ---- 物体 ----
const beam = createBeam();
scene.add(beam.mesh);
const particles = createParticles();
scene.add(particles.points);
const placeholder = createPlaceholder();
scene.add(placeholder.mesh);

// ---- 後処理 ----
const post = createPost(renderer, scene, camera);

// ---- 品質 ----
const quality = new AdaptiveQuality(now());
let appliedLevel: QualityLevel | null = null;
const status = { fps: '--', level: '高' };

function currentLevel(): QualityLevel {
  switch (params.quality.mode) {
    case 'high': return 0;
    case 'mid': return 1;
    case 'low': return 2;
    default: return quality.level;
  }
}

function resize() {
  const level = currentLevel();
  const q = QUALITY_TABLE[level];
  const pr = Math.min(window.devicePixelRatio || 1, q.maxPixelRatio);
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  post.bloom.scale = q.postScale;
  post.composer.setPixelRatio(pr);
  post.composer.setSize(w, h);
  particles.uniforms.uPixelRatio.value = pr;
  particles.uniforms.uProj.value = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
window.addEventListener('resize', resize);

function applyQuality() {
  const level = currentLevel();
  if (level !== appliedLevel) {
    appliedLevel = level;
    resize();
  }
  status.level = LEVEL_NAMES[level] + (params.quality.mode === 'auto' ? '（自動）' : '');
  particles.setCount(params.particles.count * QUALITY_TABLE[level].particleRatio);
}

// ---- 調整パネルの値を反映 ----
const bgColor = new THREE.Color();
function applyParams() {
  bgColor.set(params.background.color).multiplyScalar(params.background.brightness);
  scene.background = bgColor;
  spotUniforms.uFogDensity.value = params.fog.density;
  if (!scene.fog) scene.fog = new THREE.FogExp2(bgColor, params.fog.density);
  (scene.fog as THREE.FogExp2).color.copy(bgColor);
  (scene.fog as THREE.FogExp2).density = params.fog.density;

  const { apex, axis } = spotGeometry(params.spot.tiltX, params.spot.tiltZ, SPOT_HEIGHT);
  const ang = THREE.MathUtils.degToRad(params.spot.angle);
  spotUniforms.uApex.value.set(apex.x, apex.y, apex.z);
  spotUniforms.uAxis.value.set(axis.x, axis.y, axis.z);
  spotUniforms.uTanAngle.value = Math.tan(ang);
  spotUniforms.uCosAngle.value = Math.cos(ang);
  spot.position.set(apex.x, apex.y, apex.z);
  spot.target.position.set(apex.x + axis.x * 20, apex.y + axis.y * 20, apex.z + axis.z * 20);
  spot.angle = Math.min(ang * 1.15, Math.PI / 2 - 0.01);
  spot.penumbra = 0.75;
  beam.uniforms.uStrength.value = params.spot.beam;
  beam.sync();

  ambient.intensity = params.ambient.intensity;
  placeholder.uniforms.uCaustics.value = params.caustics.strength;

  particles.uniforms.uSize.value = params.particles.size;
  particles.uniforms.uSink.value = params.particles.sinkSpeed;
  particles.uniforms.uDof.value = params.dof.strength;

  post.bloom.strength = params.bloom.strength;
  post.finish.uniforms.uGrain.value = params.grain.strength;
  applyQuality();
}

createGui(params, status, applyParams);
applyParams();
resize();

// ---- 毎フレームの処理 ----
let last = now();
let fpsAcc = 0;
let fpsFrames = 0;

function frame() {
  const t = now();
  const dt = t - last;
  last = t;

  // fps表示（0.5秒ごとに更新）
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc >= 0.5) {
    status.fps = (fpsFrames / fpsAcc).toFixed(0);
    fpsAcc = 0;
    fpsFrames = 0;
  }
  if (params.quality.mode === 'auto' && quality.update(t, dt)) applyQuality();

  // 光のゆらぎ
  const flick = lightFlicker(t, params.spot.flicker);
  spotUniforms.uLight.value = flick;
  spotUniforms.uTime.value = t;
  spot.intensity = params.spot.intensity * flick;
  post.finish.uniforms.uTime.value = t;

  // 放置10秒で自動周回（操作するとすぐ止まる）
  const f = params.autoRotate.enabled ? idle.factor(t) : 0;
  controls.autoRotate = f > 0;
  controls.autoRotateSpeed = params.autoRotate.speed * f;
  controls.update(dt);

  // ピントはクラゲ（中心）に合わせる
  particles.uniforms.uFocusDist.value = camera.position.distanceTo(controls.target);

  post.composer.render(dt);
}

// シェーダーの準備ができてから表示する（途中のカクつきを避ける）
async function start() {
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    /* 古い環境では普通に描画を始める */
  }
  frame();
  renderer.setAnimationLoop(frame);
  requestAnimationFrame(() => {
    renderer.domElement.classList.add('ready');
    loading.classList.add('hidden');
  });
}
start();

// 開発中だけ：動作確認用に値へアクセスできるようにする
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__kurage = { params, applyParams, camera, controls, quality };
}
