import * as THREE from 'three';
import { BeatClock, contraction } from './pulse';

export interface MotionParams {
  period: number;
  contractTime: number;
  relaxTime: number;
  lag: number;
  thrust: number; // 進む力
  sink: number; // 沈む速さ
  strength?: number; // 縮む強さ（拍動の区切りで切り替える）
  // 追加章B
  panic?: number; // 慌て度（0〜）
  flee?: number; // 逃げる勢い
  returnSpeed?: number; // 光の端から中心へ戻る速さ
}

/** 拍動の区切りで決めた、その拍動の縮む時間・開く時間・強さ（途中で変わると形が跳ぶため） */
export interface BeatShape { tc: number; tr: number; strength: number }

export interface Cone {
  apex: THREE.Vector3;
  axis: THREE.Vector3;
  tan: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const MAX_TILT = THREE.MathUtils.degToRad(65); // これ以上は傾かない（逆さまに泳がない）

/** 円錐の軸からの距離が、その高さでの円錐の半径の何割か */
export function coneRatio(p: THREE.Vector3, cone: Cone): number {
  const d = p.clone().sub(cone.apex);
  const h = d.dot(cone.axis);
  if (h <= 0) return Infinity;
  const r = d.sub(cone.axis.clone().multiplyScalar(h)).length();
  return r / (h * cone.tan);
}

/**
 * クラゲの泳ぎ。縮んだ瞬間に傘の頂点の方向へ進み、開いている間は減速してゆっくり沈む。
 * 光の円錐の中に目的地を選んでゆっくり向きを変え、光から大きく離れない。
 */
export class JellyMotion {
  pos = new THREE.Vector3();
  quat = new THREE.Quaternion();
  vel = 0;
  /** このフレームで新しい拍動が始まったか */
  beatStarted = false;
  /** 今の拍動の形 */
  shape: BeatShape = { tc: 0.4, tr: 1.2, strength: 1 };
  private fleeDir = new THREE.Vector3();
  private fleeAmount = 0; // 逃げようとする気持ち（ゆっくり薄れる）
  private calmReturn = 0; // 逃げた後、中心寄りへ戻ろうとする時間
  beat: BeatClock;
  target = new THREE.Vector3();
  private nextTargetAt = 0;
  private seed: number;
  private time = 0;
  private wob = [0, 0, 0];

  constructor(seed = 3) {
    this.seed = seed;
    this.beat = new BeatClock(seed * 7 + 1);
    this.wob = [this.rand() * 6.28, this.rand() * 6.28, this.rand() * 6.28];
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /** 縮み具合（傘の真ん中あたりの値）。泳ぐ力の計算に使う */
  bodyContraction(p: MotionParams) {
    return contraction(this.beat.t - 0.6 * p.lag, this.shape.tc, this.shape.tr);
  }

  /** 追加章B：触られた場所から離れる向きへ逃げ始める */
  flee(awayWorld: THREE.Vector3, amount: number) {
    if (awayWorld.lengthSq() < 1e-8) return;
    const dir = awayWorld.clone().normalize();
    // 前の逃げる向きに重ねる（慌ただしく向きが変わる）
    this.fleeDir.multiplyScalar(this.fleeAmount).addScaledVector(dir, amount).normalize();
    this.fleeAmount = Math.min(1.5, this.fleeAmount + amount);
    this.calmReturn = 25;
    this.nextTargetAt = this.time; // 落ち着いたら新しい目的地を選び直す
  }

  private pickTarget(cone: Cone) {
    const edge = this.rand() < 0.22; // ときどき光の端へ向かう
    const y = -1.0 + this.rand() * 2.2;
    // その高さでの円錐の中心と半径
    const h = (y - cone.apex.y) / cone.axis.y;
    const center = cone.apex.clone().addScaledVector(cone.axis, h);
    const R = h * cone.tan;
    // 逃げた後しばらくは、中心寄りの目的地を選んで戻ってくる
    const frac = this.calmReturn > 0 ? this.rand() * 0.25 : edge ? 0.6 + this.rand() * 0.2 : this.rand() * 0.4;
    const a = this.rand() * Math.PI * 2;
    this.target.set(center.x + Math.cos(a) * R * frac, y, center.z + Math.sin(a) * R * frac);
    this.nextTargetAt = this.time + 10 + this.rand() * 10;
  }

  update(dt: number, p: MotionParams, cone: Cone) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const panic = p.panic ?? 0;
    const before = this.bodyContraction(p);
    // 周期の下限は、今の拍動の形と次の拍動の形の、長いほうで決める
    this.beatStarted = this.beat.update(dt, p.period, Math.max(p.contractTime, this.shape.tc), Math.max(p.relaxTime, this.shape.tr), p.lag);
    if (this.beatStarted) {
      // 拍動の区切りで、次の拍動の形を決める（慌てているほど速く強い）
      this.shape = { tc: p.contractTime, tr: p.relaxTime, strength: p.strength ?? 1 };
      if (this.beat.period < BeatClock.minPeriod(this.shape.tc, this.shape.tr, p.lag)) {
        this.beat.period = BeatClock.minPeriod(this.shape.tc, this.shape.tr, p.lag);
      }
    }
    const c = this.bodyContraction(p);
    this.fleeAmount *= Math.exp(-dt / 2.5);
    if (this.calmReturn > 0) this.calmReturn -= dt * (p.returnSpeed ?? 1);
    const dc = Math.max(0, c - before);

    // 目的地の更新（着いたか、時間切れ、光の外に出そうなとき）
    if (this.time >= this.nextTargetAt || this.pos.distanceTo(this.target) < 0.4) this.pickTarget(cone);
    const ratio = coneRatio(this.pos, cone);
    let desired = this.target.clone().sub(this.pos);
    // 慌てて逃げている間は、光の端（体の半分が闇に入るくらい）まで行ってよい
    const edgeLimit = 0.75 + 0.2 * Math.min(1, this.fleeAmount);
    if (this.fleeAmount > 0.05) {
      desired.normalize().multiplyScalar(Math.max(0, 1 - this.fleeAmount)).addScaledVector(this.fleeDir, this.fleeAmount * 2);
    }
    if (ratio > edgeLimit) {
      // 光の端に近づいたら、中心へ戻る向きへ
      const h = this.pos.clone().sub(cone.apex).dot(cone.axis);
      const center = cone.apex.clone().addScaledVector(cone.axis, h);
      desired = center.sub(this.pos).setY(0.3);
    }
    if (desired.lengthSq() < 1e-6) desired.copy(UP);
    desired.normalize();
    // ゆっくりした揺らぎ（傾いたり戻ったり）
    const t = this.time;
    desired.x += 0.25 * Math.sin(t * 0.31 + this.wob[0]);
    desired.z += 0.25 * Math.sin(t * 0.23 + this.wob[1]);
    desired.y += 0.6; // 基本は上向きに泳ぐ
    desired.normalize();
    const tilt = desired.angleTo(UP);
    if (tilt > MAX_TILT) {
      const axis = new THREE.Vector3().crossVectors(UP, desired).normalize();
      desired.copy(UP).applyAxisAngle(axis, MAX_TILT);
    }

    // 今の向きから目標の向きへ、ゆっくり回る
    const cur = UP.clone().applyQuaternion(this.quat);
    const turn = new THREE.Quaternion().setFromUnitVectors(cur, desired);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
    // 1秒あたり約20度まで。慌てているほど向きを変える動きが慌ただしい
    const maxStep = (0.35 + 1.2 * Math.min(1.5, panic) + 0.8 * this.fleeAmount) * dt;
    if (angle > 1e-5) {
      const k = Math.min(1, maxStep / angle);
      const step = new THREE.Quaternion().slerp(turn, k);
      this.quat.premultiply(step).normalize();
    }
    // 自分の軸まわりにもごくゆっくり回る
    const spin = new THREE.Quaternion().setFromAxisAngle(
      UP.clone().applyQuaternion(this.quat),
      0.05 * Math.sin(t * 0.07 + this.wob[2]) * dt,
    );
    this.quat.premultiply(spin).normalize();

    // 縮んだ瞬間に前へ進み、水の抵抗で減速する
    this.vel += p.thrust * dc * (1 + (p.flee ?? 1) * (0.8 * panic + 0.6 * this.fleeAmount));
    this.vel *= Math.exp(-1.8 * dt);
    const fwd = UP.clone().applyQuaternion(this.quat);
    this.pos.addScaledVector(fwd, this.vel * dt);
    // 開いている間はゆっくり沈む
    this.pos.y -= p.sink * (1 - c) * dt;
    // 光の外へは出ない（体の中心が光の端まで＝半身が闇に入るまで）。端に来たら中心へ押し戻す
    const r2 = coneRatio(this.pos, cone);
    if (r2 > 0.98 && Number.isFinite(r2)) {
      const h = this.pos.clone().sub(cone.apex).dot(cone.axis);
      const center = cone.apex.clone().addScaledVector(cone.axis, h);
      const off = this.pos.clone().sub(center);
      this.pos.copy(center).addScaledVector(off, 0.98 / r2);
    }
    if (ratio > 0.7) {
      // ゆっくり中心へ戻る（戻る速さで調整）
      const h = this.pos.clone().sub(cone.apex).dot(cone.axis);
      const center = cone.apex.clone().addScaledVector(cone.axis, h);
      this.pos.lerp(center.setY(this.pos.y), Math.min(1, dt * 0.04 * (p.returnSpeed ?? 1) * (ratio - 0.7) * 10));
    }
    // 高さの安全範囲
    if (this.pos.y > 2.2) this.pos.y -= (this.pos.y - 2.2) * Math.min(1, dt * 0.5);
    if (this.pos.y < -2.2) this.pos.y += (-2.2 - this.pos.y) * Math.min(1, dt * 0.5);
    return c;
  }
}
