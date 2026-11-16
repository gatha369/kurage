import * as THREE from 'three';
import { BeatClock, contraction } from './pulse';

export interface MotionParams {
  period: number;
  contractTime: number;
  relaxTime: number;
  lag: number;
  thrust: number; // 進む力
  sink: number; // 沈む速さ
}

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
    return contraction(this.beat.t - 0.6 * p.lag, p.contractTime, p.relaxTime);
  }

  private pickTarget(cone: Cone) {
    const edge = this.rand() < 0.22; // ときどき光の端へ向かう
    const y = -1.0 + this.rand() * 2.2;
    // その高さでの円錐の中心と半径
    const h = (y - cone.apex.y) / cone.axis.y;
    const center = cone.apex.clone().addScaledVector(cone.axis, h);
    const R = h * cone.tan;
    const frac = edge ? 0.6 + this.rand() * 0.2 : this.rand() * 0.4;
    const a = this.rand() * Math.PI * 2;
    this.target.set(center.x + Math.cos(a) * R * frac, y, center.z + Math.sin(a) * R * frac);
    this.nextTargetAt = this.time + 10 + this.rand() * 10;
  }

  update(dt: number, p: MotionParams, cone: Cone) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const before = this.bodyContraction(p);
    this.beatStarted = this.beat.update(dt, p.period, p.contractTime, p.relaxTime, p.lag);
    const c = this.bodyContraction(p);
    const dc = Math.max(0, c - before);

    // 目的地の更新（着いたか、時間切れ、光の外に出そうなとき）
    if (this.time >= this.nextTargetAt || this.pos.distanceTo(this.target) < 0.4) this.pickTarget(cone);
    const ratio = coneRatio(this.pos, cone);
    let desired = this.target.clone().sub(this.pos);
    if (ratio > 0.75) {
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
    const maxStep = 0.35 * dt; // 1秒あたり約20度まで
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
    this.vel += p.thrust * dc;
    this.vel *= Math.exp(-1.8 * dt);
    const fwd = UP.clone().applyQuaternion(this.quat);
    this.pos.addScaledVector(fwd, this.vel * dt);
    // 開いている間はゆっくり沈む
    this.pos.y -= p.sink * (1 - c) * dt;
    // 高さの安全範囲
    if (this.pos.y > 2.2) this.pos.y -= (this.pos.y - 2.2) * Math.min(1, dt * 0.5);
    if (this.pos.y < -2.2) this.pos.y += (-2.2 - this.pos.y) * Math.min(1, dt * 0.5);
    return c;
  }
}
