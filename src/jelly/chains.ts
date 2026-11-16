import * as THREE from 'three';
import { bellPos, type BellState } from './shape';

/**
 * 触手・口腕の動き。1本を細かい節のつながり（鎖）として計算する。
 * - 付け根は傘に固定され、傘と一緒に動く
 * - 各節は「水」の中にあり、抵抗で減速する → 傘が動くと遅れてついてきて、進むと後ろへなびく
 * - 元の形（下向きに垂れる）へゆっくり戻ろうとする。戻る力が弱いほどしなやかで遅れる
 * - 傘を突き抜けて上へ出ないよう、傘の内側に入った節は下へ押し出す
 */

export interface ChainSpec {
  theta: number; // 付け根の角度
  u: number; // 付け根の位置（0=中心, 1=縁）
  side: number; // 付け根の面（0=外側, 0.5=縁の丸み, 1=内側）
  rootOffset: number; // 付け根を中心から外へずらす量（傘の半径に対する割合）
  length: number; // 長さ（傘の半径に対する割合）
  restTilt: number; // 垂れる向きの、真下からの外向きの傾き（ラジアン）
  rand: number; // 個体差用の乱数
}

export interface ChainPhysics {
  stiffness: number; // 元の形に戻る強さ（小さいほどしなやか・遅れる）
  drag: number; // 水の抵抗
  sway: number; // 水の揺らぎの強さ
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const restDir = new THREE.Vector3();

export class ChainSet {
  readonly segments: number;
  readonly specs: ChainSpec[];
  /** 全節の位置（世界座標）。[鎖][節][xyz] を平らに並べたもの */
  readonly pos: Float32Array;
  private prev: Float32Array;
  private initialized = false;
  private time = 0;
  private inv = new THREE.Matrix4();

  constructor(specs: ChainSpec[], segments: number) {
    this.specs = specs;
    this.segments = segments;
    const n = specs.length * (segments + 1) * 3;
    this.pos = new Float32Array(n);
    this.prev = new Float32Array(n);
  }

  get pointsPerChain() {
    return this.segments + 1;
  }

  /** 付け根の位置（傘の座標） */
  rootLocal(spec: ChainSpec, bell: BellState, out: THREE.Vector3) {
    const p = bellPos(spec.u, spec.side, spec.theta, bell);
    out.set(p[0], p[1], p[2]);
    if (spec.rootOffset) {
      out.x += Math.cos(spec.theta) * spec.rootOffset * bell.R;
      out.z += Math.sin(spec.theta) * spec.rootOffset * bell.R;
    }
    return out;
  }

  /** 傘の内側（突き抜け禁止の範囲）の下面の高さ。半径 r における、傘の座標での y */
  static ceiling(r: number, bell: BellState, yCenter: number, yRim: number, rimR: number) {
    if (r >= rimR) return Infinity;
    const k = r / rimR;
    return yCenter + (yRim - yCenter) * k * k;
  }

  update(dt: number, matrix: THREE.Matrix4, quat: THREE.Quaternion, bell: BellState, phys: ChainPhysics, count = this.specs.length) {
    const P = this.pointsPerChain;
    const R = bell.R;
    this.inv.copy(matrix).invert();
    // 傘の内側の下面（中心と縁の高さ）
    const cIn = bellPos(0, 1, 0, bell);
    const rimP = bellPos(1, 0.5, 0, bell);
    const yCenter = cIn[1] - 0.01 * R;
    const yRim = rimP[1];
    const rimR = Math.hypot(rimP[0], rimP[2]) * 1.02;

    if (!this.initialized) {
      this.initialized = true;
      for (let c = 0; c < this.specs.length; c++) this.resetChain(c, matrix, quat, bell);
    }

    const sub = dt > 1 / 45 ? 3 : 2;
    const h = Math.min(dt, 0.1) / sub;
    for (let step = 0; step < sub; step++) {
      this.time += h;
      const damp = Math.exp(-(0.5 + phys.drag * 40) * h); // 水中なので勢いはすぐ収まる
      for (let c = 0; c < count; c++) {
        const spec = this.specs[c];
        const base = c * P * 3;
        const seg = (spec.length * R) / this.segments;
        // 付け根
        this.rootLocal(spec, bell, tmp).applyMatrix4(matrix);
        this.prev[base] = this.pos[base]; this.prev[base + 1] = this.pos[base + 1]; this.prev[base + 2] = this.pos[base + 2];
        this.pos[base] = tmp.x; this.pos[base + 1] = tmp.y; this.pos[base + 2] = tmp.z;
        // 垂れる向き（傘の座標で、下向き＋少し外向き）を世界の向きへ
        const ct = Math.cos(spec.theta), st = Math.sin(spec.theta);
        restDir.set(ct * Math.sin(spec.restTilt), -Math.cos(spec.restTilt), st * Math.sin(spec.restTilt)).applyQuaternion(quat);

        for (let j = 1; j < P; j++) {
          const i = base + j * 3;
          // 慣性（水の抵抗で減速）
          const vx = (this.pos[i] - this.prev[i]) * damp;
          const vy = (this.pos[i + 1] - this.prev[i + 1]) * damp;
          const vz = (this.pos[i + 2] - this.prev[i + 2]) * damp;
          this.prev[i] = this.pos[i]; this.prev[i + 1] = this.pos[i + 1]; this.prev[i + 2] = this.pos[i + 2];
          let x = this.pos[i] + vx, y = this.pos[i + 1] + vy, z = this.pos[i + 2] + vz;
          // 元の形へ戻ろうとする力（先へ行くほど弱い）
          const k = Math.min(1, phys.stiffness * (1 - 0.55 * (j / P)) * h);
          const px = this.pos[i - 3], py = this.pos[i - 2], pz = this.pos[i - 1];
          x += (px + restDir.x * seg - x) * k;
          y += (py + restDir.y * seg - y) * k;
          z += (pz + restDir.z * seg - z) * k;
          // 水の揺らぎ（ゆっくり）
          const ph = spec.rand * 50 + j * 0.35;
          const sw = phys.sway * h * h * (j / P);
          x += Math.sin(this.time * 0.9 + ph) * sw;
          z += Math.cos(this.time * 0.7 + ph * 1.3) * sw;
          this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
        }
        // 節の長さを保つ（付け根から順に）
        for (let it = 0; it < 2; it++) {
          for (let j = 1; j < P; j++) {
            const i = base + j * 3;
            tmp.set(this.pos[i] - this.pos[i - 3], this.pos[i + 1] - this.pos[i - 2], this.pos[i + 2] - this.pos[i - 1]);
            const len = tmp.length() || 1e-6;
            tmp.multiplyScalar(seg / len);
            this.pos[i] = this.pos[i - 3] + tmp.x;
            this.pos[i + 1] = this.pos[i - 2] + tmp.y;
            this.pos[i + 2] = this.pos[i - 1] + tmp.z;
          }
        }
        // 傘を突き抜けないように
        for (let j = 1; j < P; j++) {
          const i = base + j * 3;
          tmp2.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]).applyMatrix4(this.inv);
          const r = Math.hypot(tmp2.x, tmp2.z);
          const ceil = ChainSet.ceiling(r, bell, yCenter, yRim, rimR);
          if (tmp2.y > ceil) {
            tmp2.y = ceil;
            tmp2.applyMatrix4(matrix);
            this.pos[i] = tmp2.x; this.pos[i + 1] = tmp2.y; this.pos[i + 2] = tmp2.z;
            // 当たった勢いは消す（跳ね返って暴れないように）
            this.prev[i] = tmp2.x; this.prev[i + 1] = tmp2.y; this.prev[i + 2] = tmp2.z;
          }
        }
      }
    }
  }

  /** まっすぐ垂れた状態に置き直す */
  resetChain(c: number, matrix: THREE.Matrix4, quat: THREE.Quaternion, bell: BellState) {
    const spec = this.specs[c];
    const P = this.pointsPerChain;
    const base = c * P * 3;
    const seg = (spec.length * bell.R) / this.segments;
    this.rootLocal(spec, bell, tmp).applyMatrix4(matrix);
    restDir
      .set(Math.cos(spec.theta) * Math.sin(spec.restTilt), -Math.cos(spec.restTilt), Math.sin(spec.theta) * Math.sin(spec.restTilt))
      .applyQuaternion(quat);
    for (let j = 0; j < P; j++) {
      const i = base + j * 3;
      this.pos[i] = this.prev[i] = tmp.x + restDir.x * seg * j;
      this.pos[i + 1] = this.prev[i + 1] = tmp.y + restDir.y * seg * j;
      this.pos[i + 2] = this.prev[i + 2] = tmp.z + restDir.z * seg * j;
    }
  }

  /**
   * 追加章B：指で払う。chain の節 j を offset だけ押しのける（付け根側・先端側へなだらかに広がる）。
   * その後は元の形へ戻ろうとする力で、ゆっくり元の動きに戻る
   */
  poke(chain: number, j: number, offset: THREE.Vector3, scale = 1) {
    const P = this.pointsPerChain;
    const base = chain * P * 3;
    for (let k = 1; k < P; k++) {
      const fall = Math.exp(-(((k - j) / (P * 0.35)) ** 2)) * Math.min(1, k / 2);
      const i = base + k * 3;
      const dx = offset.x * fall * scale, dy = offset.y * fall * scale, dz = offset.z * fall * scale;
      this.pos[i] += dx; this.pos[i + 1] += dy; this.pos[i + 2] += dz;
      this.prev[i] += dx; this.prev[i + 1] += dy; this.prev[i + 2] += dz;
    }
  }

  /** 長さなどを変えたとき、全部を置き直す */
  reset() {
    this.initialized = false;
  }
}

// ---- 縁の触手と口腕の配置 ----

export const MAX_TENTACLES = 300;

/** 縁の触手：黄金角で並べるので、本数を減らしても縁全体に均等に残る。切れ込みの所には生やさない */
export function tentacleSpecs(seed: number, notchOffset: number, n = MAX_TENTACLES): ChainSpec[] {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const out: ChainSpec[] = [];
  const golden = 0.6180339887;
  let k = 0;
  while (out.length < n) {
    k++;
    const theta = ((k * golden) % 1) * Math.PI * 2;
    const q = Math.PI / 4;
    let a = (theta - notchOffset) % q;
    if (a < 0) a += q;
    if (Math.min(a, q - a) < 0.05) continue; // 切れ込み
    out.push({ theta, u: 1, side: 0.5, rootOffset: 0, length: 1, restTilt: 0.3, rand: rand() });
  }
  return out;
}

/** 口腕：傘の下の中心から4本 */
export function armSpecs(notchOffset: number): ChainSpec[] {
  return [0, 1, 2, 3].map((k) => ({
    theta: notchOffset + (k * Math.PI) / 2,
    u: 0,
    side: 1,
    rootOffset: 0.09,
    length: 1,
    restTilt: 0.28,
    rand: k * 0.37 + 0.11,
  }));
}
