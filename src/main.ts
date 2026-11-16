import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cloneParams, defaultParams } from './params';
import { AdaptiveQuality, IdleWatcher, lightFlicker, spotGeometry, QUALITY_TABLE, type QualityLevel } from './logic';
import { spotUniforms } from './scene/shared';
import { createBeam } from './scene/beam';
import { createParticles } from './scene/particles';
import { createPost } from './scene/post';
import { LayeredRenderPass } from './scene/layered';
import { createBell } from './jelly/bell';
import { JellyMotion, type Cone } from './jelly/motion';
import { JELLY_SEED, shapePhases } from './jelly/shape';
import { createGui } from './gui';

const SPOT_HEIGHT = 12;
const LEVEL_NAMES = ['高', '中', '低'];
const BASE_SPOT_INTENSITY = defaultParams.spot.intensity;
const WAVE_LAG = 0.12; // 縮みが中心から縁へ伝わる遅れ（秒）

const params = cloneParams(defaultParams);
const app = document.getElementById('app')!;
const loading = document.getElementById('loading')!;

// ---- 描画の準備 ----
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
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
const markInteraction = () => idle.interact(now());
const el = renderer.domElement;
let pointerDown = false;
el.addEventListener('pointerdown', () => { pointerDown = true; markInteraction(); });
window.addEventListener('pointerup', () => { pointerDown = false; markInteraction(); });
window.addEventListener('pointercancel', () => { pointerDown = false; });
el.addEventListener('pointermove', () => { if (pointerDown) markInteraction(); });
el.addEventListener('wheel', markInteraction, { passive: true });
el.addEventListener('touchstart', markInteraction, { passive: true });

// ---- 物体 ----
const beam = createBeam();
scene.add(beam.mesh);
const particles = createParticles();
scene.add(particles.points);

const jelly = new THREE.Group();
const bell = createBell();
jelly.add(bell.mesh);
scene.add(jelly);
const ph = shapePhases(JELLY_SEED);
bell.uniforms.uPhase.value.set(ph[0], ph[1], ph[2], ph[3]);
const motion = new JellyMotion(5);

// ---- 描画の順番と後処理 ----
const layered = new LayeredRenderPass(scene, camera, jelly, [beam.mesh], (mode) => {
  particles.uniforms.uSplitMode.value = mode === 'back' ? 1 : 2;
});
bell.uniforms.uBg.value = layered.bgTarget.texture;
const post = createPost(renderer, layered);

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
  const q = QUALITY_TABLE[currentLevel()];
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
  bell.uniforms.uResolution.value.set(layered.bgTarget.width, layered.bgTarget.height);
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
const ambientColor = new THREE.Color(0x2a4c80);
const cone: Cone = { apex: new THREE.Vector3(), axis: new THREE.Vector3(), tan: 0 };

function applyParams() {
  bgColor.set(params.background.color).multiplyScalar(params.background.brightness);
  scene.background = bgColor;
  spotUniforms.uFogDensity.value = params.fog.density;

  const { apex, axis } = spotGeometry(params.spot.tiltX, params.spot.tiltZ, SPOT_HEIGHT);
  const ang = THREE.MathUtils.degToRad(params.spot.angle);
  spotUniforms.uApex.value.set(apex.x, apex.y, apex.z);
  spotUniforms.uAxis.value.set(axis.x, axis.y, axis.z);
  spotUniforms.uTanAngle.value = Math.tan(ang);
  spotUniforms.uCosAngle.value = Math.cos(ang);
  cone.apex.copy(spotUniforms.uApex.value);
  cone.axis.copy(spotUniforms.uAxis.value);
  cone.tan = Math.tan(ang);
  beam.uniforms.uStrength.value = params.spot.beam;
  beam.sync();

  const b = params.bell;
  const u = bell.uniforms;
  u.uSpotIntensity.value = params.spot.intensity / BASE_SPOT_INTENSITY;
  u.uAmbient.value.copy(ambientColor).multiplyScalar(params.ambient.intensity);
  u.uCaustics.value = params.caustics.strength;
  u.uR.value = b.size;
  u.uD.value = b.depth * b.size;
  u.uThick.value = 0.2 * b.size;
  u.uIrr.value = b.irregularity;
  u.uTc.value = b.contractTime;
  u.uTr.value = b.relaxTime;
  u.uLag.value = WAVE_LAG;
  u.uStrength.value = b.strength;
  u.uTransparency.value = b.transparency;
  u.uRimWhite.value = b.rimWhite;
  u.uRefract.value = b.refraction;
  u.uBlue.value = b.blue;
  u.uMilk.value = b.milk;
  u.uGonadColor.value.set(b.gonadColor);
  u.uGonad.value = b.gonad;
  u.uCanal.value = b.canal;
  controls.minDistance = 1.9 * b.size + 0.7;

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
const prevTarget = new THREE.Vector3();

function frame() {
  const t = now();
  const dt = Math.min(t - last, 0.1);
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
  spotUniforms.uLight.value = lightFlicker(t, params.spot.flicker);
  spotUniforms.uTime.value = t;
  post.finish.uniforms.uTime.value = t;

  // クラゲの拍動と泳ぎ
  const b = params.bell;
  motion.update(dt, {
    period: b.period, contractTime: b.contractTime, relaxTime: b.relaxTime,
    lag: WAVE_LAG, thrust: b.thrust * b.size, sink: b.sink,
  }, cone);
  jelly.position.copy(motion.pos);
  jelly.quaternion.copy(motion.quat);
  jelly.updateMatrixWorld();
  bell.uniforms.uBeatT.value = motion.beat.t;

  // カメラはクラゲについていく（周回の中心をクラゲに合わせる）
  prevTarget.copy(controls.target);
  controls.target.lerp(motion.pos, 1 - Math.exp(-dt * 1.2));
  camera.position.add(controls.target.clone().sub(prevTarget));

  // 放置10秒で自動周回（操作するとすぐ止まる）
  const f = params.autoRotate.enabled ? idle.factor(t) : 0;
  controls.autoRotate = f > 0;
  controls.autoRotateSpeed = params.autoRotate.speed * f;
  controls.update(dt);

  // ピントはクラゲに合わせる。クラゲより手前の微粒子は最後に重ねる
  const dist = camera.position.distanceTo(motion.pos);
  particles.uniforms.uFocusDist.value = dist;
  particles.uniforms.uSplit.value = dist - b.size * 1.1;
  bell.uniforms.uCamLocal.value.copy(jelly.worldToLocal(camera.position.clone()));

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
  (window as unknown as Record<string, unknown>).__kurage = { params, applyParams, camera, controls, quality, motion, jelly };
}
