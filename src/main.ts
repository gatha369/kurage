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
import { JELLY_SEED, shapePhases, type BellState } from './jelly/shape';
import { ChainSet, armSpecs, tentacleSpecs } from './jelly/chains';
import { BellDeformer } from './jelly/deform';
import { createArmMesh, createTentacleMesh, setFrontPass } from './jelly/appendages';
import { createGui } from './gui';
import { TapTracker } from './interact/tap';
import { hitBell, hitChains } from './interact/hit';
import { Panic } from './jelly/panic';
import type { DeformParams } from './jelly/deform';

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

// 触手と口腕（形は世界の座標で直接計算するので、クラゲのグループには入れない）
const tentacles = new ChainSet(tentacleSpecs(JELLY_SEED, ph[3]), 10);
const arms = new ChainSet(armSpecs(ph[3]), 18);
const tentacleMesh = createTentacleMesh(tentacles);
const armMesh = createArmMesh(arms);
scene.add(tentacleMesh.mesh, armMesh.mesh);
const tentacleRand = tentacles.specs.map((s) => s.rand);
const tentacleBaseLen = tentacles.specs.map(() => 0.5);
const deformer = new BellDeformer(JELLY_SEED % 1000);
const bellState: BellState = {
  R: 1, D: 0.36, thick: 0.2, irr: 0.04, notch: 0.035, phase: ph,
  beatT: 0, tc: 0.4, tr: 1.2, lag: WAVE_LAG, strength: 1,
};

// ---- 描画の順番と後処理 ----
const layered = new LayeredRenderPass(scene, camera, jelly, [beam.mesh], (mode) => {
  particles.uniforms.uSplitMode.value = mode === 'back' ? 1 : 2;
  setFrontPass(tentacleMesh.mesh.material as THREE.Material, mode === 'front');
  setFrontPass(armMesh.mesh.material as THREE.Material, mode === 'front');
});
bell.uniforms.uBg.value = layered.bgTarget.texture;
const post = createPost(renderer, layered);

// ---- 追加章B：触れたときの反応 ----
let screenProj = 800;
const tapTracker = new TapTracker();
const panic = new Panic();
let twitchT = 1e3;
let twitchAmp = 0;
let pushNext = 0;
const raycaster = new THREE.Raycaster();
const tapOpt = () => ({ maxTime: params.touch.tapTime, maxMove: params.touch.tapMove });
el.addEventListener('pointerdown', (e) => tapTracker.down(e.pointerId, e.clientX, e.clientY, performance.now() / 1000));
el.addEventListener('pointermove', (e) => tapTracker.move(e.pointerId, e.clientX, e.clientY, tapOpt()));
el.addEventListener('pointercancel', (e) => tapTracker.cancel(e.pointerId));
el.addEventListener('pointerup', (e) => {
  const tap = tapTracker.up(e.pointerId, e.clientX, e.clientY, performance.now() / 1000, tapOpt());
  if (tap) onTap(tap.x, tap.y);
});

function onTap(x: number, y: number) {
  const tp = params.touch;
  const R = params.bell.size;
  const rect = el.getBoundingClientRect();
  const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const ray = raycaster.ray;
  const hb = hitBell(ray, jelly.matrixWorld, bellState);
  const ht = hitChains(ray, tentacles, tentacleCount, 0.04 * R, 22, screenProj);
  const ha = hitChains(ray, arms, arms.specs.length, 0.08 * R, 28, screenProj);
  // 一番手前にあるものに触れる
  const cands = [
    hb ? { kind: 'bell' as const, t: hb.t } : null,
    ht ? { kind: 'tentacle' as const, t: ht.t } : null,
    ha ? { kind: 'arm' as const, t: ha.t } : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null).sort((a, b) => a.t - b.t);
  const first = cands[0]?.kind;

  if (first === 'bell' && hb && hb.kind === 'bell') {
    // 触れた場所がへこみ、ビクッと縮み、触れた場所から離れる向きへ逃げる
    const d = params.deform;
    deformer.poke(hb.u, hb.theta, hb.fromOutside ? 1 : -1,
      { depth: tp.dentDepth, radius: tp.dentRadius, recover: tp.dentRecover }, d.hardness, d.attack, tp.dentRecover);
    panic.touch(tp.panicRise, tp.panicMax);
    twitchT = 0;
    twitchAmp = Math.min(1, 0.55 + 0.45 * panic.level);
    motion.flee(motion.pos.clone().sub(hb.point), 0.5 + 0.3 * Math.min(1, panic.level));
  } else if ((first === 'tentacle' && ht) || (first === 'arm' && ha)) {
    // 触手・口腕：払われたようにぴくっとなびく。周りも少しつられる。反応は傘より控えめ
    const hit = first === 'tentacle' ? ht! : ha!;
    const set = first === 'tentacle' ? tentacles : arms;
    const k = tp.appendageReaction;
    const push = ray.direction.clone().multiplyScalar(0.18 * R * k);
    set.poke(hit.chain, hit.index, push);
    const th0 = set.specs[hit.chain].theta;
    const n = first === 'tentacle' ? tentacleCount : set.specs.length;
    for (let c = 0; c < n; c++) {
      if (c === hit.chain) continue;
      let dth = Math.abs(set.specs[c].theta - th0) % (Math.PI * 2);
      dth = Math.min(dth, Math.PI * 2 - dth);
      if (dth < 0.25) set.poke(c, hit.index, push, 0.35 * (1 - dth / 0.25));
    }
    panic.touch(tp.panicRise * 0.4 * Math.min(1.5, k), tp.panicMax);
    twitchT = 0;
    twitchAmp = Math.min(1, 0.25 + 0.25 * panic.level);
    motion.flee(motion.pos.clone().sub(hit.point), 0.25);
  } else {
    // 水だけの場所：クラゲは反応せず、周りの微粒子だけが押し流される
    const dist = camera.position.distanceTo(motion.pos);
    const pt = ray.at(dist, new THREE.Vector3());
    const i = pushNext;
    pushNext = (pushNext + 1) % 4;
    particles.uniforms.uPush.value[i].set(pt.x, pt.y, pt.z, 0);
    particles.uniforms.uPushDir.value[i].set(ray.direction.x, ray.direction.y, ray.direction.z, 0.6 * tp.waterPush);
  }
}

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
  const proj = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  screenProj = proj / pr; // 当たり判定用（CSSピクセル）
  particles.uniforms.uPixelRatio.value = pr;
  particles.uniforms.uProj.value = proj;
  tentacleMesh.uniforms.uPixelRatio.value = pr;
  tentacleMesh.uniforms.uProj.value = proj;
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
  tentacleCount = Math.round(params.tentacles.count * QUALITY_TABLE[level].tentacleRatio);
  tentacleMesh.setCount(tentacleCount);
}
let tentacleCount = 0;

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
  Object.assign(bellState, {
    R: u.uR.value, D: u.uD.value, thick: u.uThick.value, irr: b.irregularity, notch: u.uNotch.value,
    tc: b.contractTime, tr: b.relaxTime, strength: b.strength,
  });

  // 触手：長さと太さに個体差
  const tp = params.tentacles;
  tentacles.specs.forEach((s, i) => {
    tentacleBaseLen[i] = tp.length * (1 + tp.variation * (tentacleRand[i] - 0.5) * 1.2);
    s.length = tentacleBaseLen[i];
  });
  tentacleMesh.uniforms.uWidth.value = 0.006 * tp.thickness * b.size;
  tentacleMesh.uniforms.uVariation.value = tp.variation;
  arms.specs.forEach((s, i) => {
    s.length = params.arms.length * (1 + 0.12 * Math.sin(i * 2.3));
  });
  for (const m of [tentacleMesh, armMesh]) {
    m.uniforms.uSpotIntensity.value = u.uSpotIntensity.value;
    m.uniforms.uAmbient.value.copy(u.uAmbient.value);
  }

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
let simT = 0; // クラゲや水の動きの時間（時間の速さで遅くできる）
const deformEff: DeformParams = { ...params.deform };
const prevQuat = new THREE.Quaternion();
const turnSmooth = new THREE.Vector2();
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

  // 時間の速さ（スローモーション）。カメラ操作とフィルムグレインは普通の速さのまま
  const sdt = dt * params.time.scale;
  simT += sdt;

  // 光のゆらぎ
  spotUniforms.uLight.value = lightFlicker(simT, params.spot.flicker);
  spotUniforms.uTime.value = simT;
  post.finish.uniforms.uTime.value = t;

  // 追加章B：慌て度（触られないとゆっくり下がる）
  const tc = params.touch;
  const P0 = panic.update(sdt, tc.panicMax, tc.calmTime);
  // 見た目の慌て具合：1回触っただけでもはっきり反応するよう、低いところを持ち上げる
  const P = P0 > 0 ? Math.pow(P0, 0.6) : 0;
  twitchT += sdt;

  // クラゲの拍動と泳ぎ（慌てているほど拍動が速く強い。切り替えは拍動の区切りで）
  const b = params.bell;
  const fast = 1 + P * tc.beatSpeedMax;
  prevQuat.copy(motion.quat);
  motion.update(sdt, {
    period: b.period / fast,
    contractTime: b.contractTime / (1 + 0.5 * P * tc.beatSpeedMax),
    relaxTime: b.relaxTime / fast,
    strength: b.strength * (1 + P * tc.beatStrengthMax),
    lag: WAVE_LAG, thrust: b.thrust * b.size, sink: b.sink,
    panic: P, flee: tc.flee, returnSpeed: tc.returnSpeed,
  }, cone);
  bell.uniforms.uTc.value = bellState.tc = motion.shape.tc;
  bell.uniforms.uTr.value = bellState.tr = motion.shape.tr;
  bell.uniforms.uStrength.value = bellState.strength = motion.shape.strength;
  bell.uniforms.uTwitchT.value = bellState.twitchT = twitchT;
  bell.uniforms.uTwitchAmp.value = bellState.twitchAmp = twitchAmp;
  jelly.position.copy(motion.pos);
  jelly.quaternion.copy(motion.quat);
  jelly.updateMatrixWorld();
  bell.uniforms.uBeatT.value = motion.beat.t;
  const bu = bell.uniforms;

  // 触手と口腕（傘の動きから遅れてついてくる）
  bellState.beatT = motion.beat.t;

  // 追加章A：傘のゆがみ（拍動・進む・向きを変える・何もしない）
  if (sdt > 0) {
    // 傘の頂点が傾いていく向きと速さ（傘の座標で）
    const dq = motion.quat.clone().multiply(prevQuat.clone().invert());
    const ang = 2 * Math.acos(Math.min(1, Math.abs(dq.w)));
    const axis = new THREE.Vector3(dq.x, dq.y, dq.z);
    if (axis.lengthSq() > 1e-12) axis.normalize().multiplyScalar((dq.w < 0 ? -ang : ang) / sdt);
    else axis.set(0, 0, 0);
    axis.applyQuaternion(motion.quat.clone().invert());
    turnSmooth.lerp(new THREE.Vector2(-axis.z, axis.x), 1 - Math.exp(-sdt * 6));
  }
  // 慌てているほど、ゆがみも大きくなる
  Object.assign(deformEff, params.deform);
  deformEff.strength = params.deform.strength * (1 + P);
  const def = deformer.update(sdt, deformEff, {
    beatStarted: motion.beatStarted,
    speed: motion.vel / Math.max(0.3, b.size),
    turnX: turnSmooth.x,
    turnZ: turnSmooth.y,
  }, { depth: tc.dentDepth, radius: tc.dentRadius, recover: tc.dentRecover });
  for (let i = 0; i < 4; i++) {
    bu.uDent.value[i].set(def.dents[i * 4], def.dents[i * 4 + 1], def.dents[i * 4 + 2], def.dents[i * 4 + 3]);
    bu.uRipple.value[i].set(def.ripples[i * 2], def.ripples[i * 2 + 1]);
    particles.uniforms.uPush.value[i].w += sdt;
  }
  bellState.def = def;
  for (let k = 0; k < 6; k++) bu.uDef.value[k].set(def.modes[k * 4], def.modes[k * 4 + 1], def.modes[k * 4 + 2], def.modes[k * 4 + 3]);
  bu.uFlat.value = def.flat;
  bu.uDefHard.value = def.hard;
  bu.uPK.value.set(...def.pk);
  bu.uPA.value.set(...def.pa);
  bu.uPD.value.set(...def.pd);
  bu.uPP.value.set(...def.pp);

  // 慌てているほど、触手がきゅっと縮こまる
  const shrink = 1 - tc.tentacleShrink * Math.min(1, P);
  for (let i = 0; i < tentacles.specs.length; i++) tentacles.specs[i].length = tentacleBaseLen[i] * shrink;
  const tp = params.tentacles;
  tentacles.update(sdt, jelly.matrixWorld, jelly.quaternion, bellState, {
    stiffness: THREE.MathUtils.lerp(14, 3, tp.suppleness),
    drag: tp.drag,
    sway: 0.25,
  }, tentacleCount);
  tentacleMesh.sync(tentacleCount);
  arms.update(sdt, jelly.matrixWorld, jelly.quaternion, bellState, {
    stiffness: THREE.MathUtils.lerp(6, 1, params.arms.lag),
    drag: tp.drag * 1.4,
    sway: 0.15,
  });
  armMesh.sync(jelly.quaternion, b.size, params.arms.width, params.arms.frill, simT);

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
  (window as unknown as Record<string, unknown>).__kurage = { params, applyParams, camera, controls, quality, motion, jelly, tentacles, arms, tentacleMesh, armMesh, bellState, renderer, panic, onTap };
}
