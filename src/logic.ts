// 画面に依存しない計算（自動テストの対象）

export interface Vec3 { x: number; y: number; z: number }

const DEG = Math.PI / 180;

/** スポットライトの位置（頂点）と、光が進む向き（単位ベクトル）を求める */
export function spotGeometry(tiltXDeg: number, tiltZDeg: number, height: number) {
  const ax = tiltXDeg * DEG;
  const az = tiltZDeg * DEG;
  // 真下 (0,-1,0) を X軸・Z軸まわりに傾ける
  let x = 0, y = -1, z = 0;
  // X軸まわり
  const y1 = y * Math.cos(ax) - z * Math.sin(ax);
  const z1 = y * Math.sin(ax) + z * Math.cos(ax);
  y = y1; z = z1;
  // Z軸まわり
  const x2 = x * Math.cos(az) - y * Math.sin(az);
  const y2 = x * Math.sin(az) + y * Math.cos(az);
  x = x2; y = y2;
  const axis: Vec3 = { x, y, z };
  // 原点（クラゲの位置）を通るように、頂点は向きの逆側に height だけ離す
  const apex: Vec3 = { x: -x * height, y: -y * height, z: -z * height };
  return { apex, axis };
}

/** 水を通して差す光の、ゆっくりした明るさのゆらぎ。1±amount の範囲に収まる */
export function lightFlicker(t: number, amount: number): number {
  const n =
    0.5 * Math.sin(t * 0.61) +
    0.3 * Math.sin(t * 1.37 + 1.3) +
    0.2 * Math.sin(t * 2.71 + 0.4);
  return 1 + amount * n;
}

/** 何も操作しない状態が続いたら自動周回を始める仕組み */
export class IdleWatcher {
  private last: number;
  constructor(now: number, public readonly delay = 10, public readonly rampTime = 2.5) {
    this.last = now;
  }
  interact(now: number) {
    this.last = now;
  }
  /** 自動周回の強さ（0=止まっている〜1=最大速度）。操作した瞬間に0に戻る */
  factor(now: number): number {
    const t = (now - this.last - this.delay) / this.rampTime;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t); // ふわっと加速
  }
}

export type QualityLevel = 0 | 1 | 2; // 0=高, 1=中, 2=低

export interface QualitySettings {
  particleRatio: number; // 微粒子の数の割合
  postScale: number; // 後処理（ブルーム）の解像度の割合
  maxPixelRatio: number; // 高解像度画面での最大の細かさ
  tentacleRatio: number; // 触手の本数の割合
}

// 下げる順番：微粒子 → 後処理の解像度 → 触手の本数
// 傘の形・透け感・スポットライトの光には手を付けない
export const QUALITY_TABLE: Record<QualityLevel, QualitySettings> = {
  0: { particleRatio: 1, postScale: 1, maxPixelRatio: 2, tentacleRatio: 1 },
  1: { particleRatio: 0.55, postScale: 0.7, maxPixelRatio: 2, tentacleRatio: 1 },
  2: { particleRatio: 0.3, postScale: 0.5, maxPixelRatio: 1.5, tentacleRatio: 0.6 },
};

/**
 * 滑らかさ（fps）を見て、品質を自動で一段ずつ上げ下げする。
 * 数秒単位でゆっくり判断し、ちらちら切り替わらないようにする。
 */
export class AdaptiveQuality {
  level: QualityLevel = 0;
  private samples: { t: number; dt: number }[] = [];
  private lastChange: number;
  private lastDowngrade = -Infinity;

  constructor(
    now: number,
    private opts = {
      window: 3, // 何秒ぶんの平均で判断するか
      lowFps: 48, // これを下回ったら一段下げる
      highFps: 57, // これを上回り続けたら一段上げる
      downCooldown: 4,
      upHold: 10, // 一段上げるまでに必要な、余裕のある時間
      upAfterDownHold: 30, // 一度下げた後に上げ直すまでの時間（行ったり来たり防止）
    },
  ) {
    this.lastChange = now;
  }

  get settings(): QualitySettings {
    return QUALITY_TABLE[this.level];
  }

  averageFps(): number {
    if (this.samples.length === 0) return 60;
    const sum = this.samples.reduce((a, s) => a + s.dt, 0);
    return this.samples.length / sum;
  }

  /** 1フレームごとに呼ぶ。品質を変えたら true を返す */
  update(now: number, dt: number): boolean {
    if (dt <= 0 || dt > 0.5) return false; // タブ切り替えなどの大きな空白は無視
    this.samples.push({ t: now, dt });
    while (this.samples.length && now - this.samples[0].t > this.opts.window) this.samples.shift();
    const span = now - this.lastChange;
    if (span < this.opts.window) return false; // 判断に足るデータがまだない
    const fps = this.averageFps();
    if (fps < this.opts.lowFps && this.level < 2 && span >= this.opts.downCooldown) {
      this.level = (this.level + 1) as QualityLevel;
      this.lastChange = now;
      this.lastDowngrade = now;
      this.samples = [];
      return true;
    }
    const hold = now - this.lastDowngrade < 60 ? this.opts.upAfterDownHold : this.opts.upHold;
    if (fps > this.opts.highFps && this.level > 0 && span >= hold) {
      this.level = (this.level - 1) as QualityLevel;
      this.lastChange = now;
      this.samples = [];
      return true;
    }
    return false;
  }

  reset(now: number) {
    this.level = 0;
    this.samples = [];
    this.lastChange = now;
    this.lastDowngrade = -Infinity;
  }
}
