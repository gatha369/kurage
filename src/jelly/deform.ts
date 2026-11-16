// 追加章A：傘の歪みと復元
// 柔らかいゼリーが水の圧力で一瞬ゆがみ、粘りながらジワーッと元の形に戻る動きを計算する。
// ゆがみは「縁にそった大きな波」の重ね合わせ（1〜6か所の波）で表すので、
// とがった角やギザギザは原理的に出ない。

export const DEFORM_MODES = 6;

export interface DeformParams {
  strength: number; // 全体のゆがみの強さ（0で追加章Aの前と同じ）
  pulse: number; // ① 拍動時のばらつきの強さ
  waves: number; // ① ゆがみの波の数（縁にそって何か所に出るか）
  variability: number; // ① 拍動ごとの変わり方の大きさ（0=毎回同じ, 1=毎回まったく違う）
  drag: number; // ② 水の抵抗によるつぶれの強さ
  turn: number; // ③ 向きを変えるときのゆがみの強さ
  idle: number; // ④ 何もしていないときのうねりの強さ
  idleSpeed: number; // ④ うねりの速さ
  attack: number; // ゆがむ速さ（ゆがみが最大になるまでの秒数）
  recover: number; // 戻る時間（秒。ほぼ元に戻るまで）
  overshoot: number; // 揺れ返しの強さ（0=揺れ返さない）
  hardness: number; // 中心と縁の差（大きいほど中心が硬く、縁だけがゆがむ）
}

export const defaultDeform: DeformParams = {
  strength: 1,
  pulse: 1,
  waves: 3,
  variability: 0.7,
  drag: 1,
  turn: 1,
  idle: 1,
  idleSpeed: 1,
  attack: 0.15,
  recover: 2.2,
  overshoot: 0,
  hardness: 0.5,
};

/**
 * 1つのゆがみの成分。ばね＋粘り（強い減衰）でできた振動子。
 * 「たたかれると素早くゆがみ、ゆっくり戻る」。粘りが十分強いと、戻るときに反対側へ揺れ返さない。
 */
export class Viscoelastic {
  x = 0;
  v = 0;
  /** ft：ゆがむ速さの率、st：戻る速さの率、zetaMix：揺れ返し(0〜1)、force：押し続ける力 */
  step(dt: number, fast: number, slow: number, overshoot: number, target = 0) {
    const w = Math.sqrt(fast * slow);
    let zeta = (fast + slow) / (2 * w);
    zeta = zeta * (1 - overshoot) + 0.25 * overshoot;
    const F = w * w * target;
    // 陰解法（どんな時間の刻みでも暴れない）
    const v1 = (this.v + dt * (F - w * w * this.x)) / (1 + 2 * zeta * w * dt + w * w * dt * dt);
    this.x += dt * v1;
    this.v = v1;
  }
  kick(dv: number) {
    this.v += dv;
  }
}

/** 戻る時間（ほぼ元に戻るまで）・ゆがむ時間から、2つの速さの率を求める */
export function rates(attack: number, recover: number) {
  const slow = 2.3 / Math.max(0.2, recover); // 約90%戻るまでの時間
  const fast = 2.8 / Math.max(0.03, attack);
  return { fast: Math.max(fast, slow * 2), slow };
}

/** 画面側（傘の形の計算）へ渡すゆがみの状態 */
export interface DeformState {
  modes: Float32Array; // k=1..6 の [半径cos, 半径sin, 高さcos, 高さsin]
  flat: number; // ② つぶれ
  hard: number; // 縁と中心の差の指数
  pk: [number, number, number]; // ① 縮み方のばらつきの波の数
  pa: [number, number, number]; // ① 縮む強さのばらつき
  pd: [number, number, number]; // ① 縮むタイミングのずれ（秒）
  pp: [number, number, number]; // ① 位相
}

export function emptyDeform(): DeformState {
  return {
    modes: new Float32Array(DEFORM_MODES * 4),
    flat: 0,
    hard: 2.5,
    pk: [2, 3, 4],
    pa: [0, 0, 0],
    pd: [0, 0, 0],
    pp: [0, 0, 0],
  };
}

export interface DeformInputs {
  beatStarted: boolean; // 新しい拍動が始まった
  speed: number; // 進む速さ
  turnX: number; // 傘の頂点が傾いていく向きと速さ（傘の座標の水平面）
  turnZ: number;
}

export class BellDeformer {
  readonly osc: Viscoelastic[] = Array.from({ length: DEFORM_MODES * 4 }, () => new Viscoelastic());
  readonly flatOsc = new Viscoelastic();
  readonly state = emptyDeform();
  private base: number[];
  private seed: number;
  private time = 0;
  private idlePhase: number[];

  constructor(seed = 77) {
    this.seed = seed;
    // この個体の「縮むときのクセ」。毎回の拍動はこれと乱数を混ぜる
    this.base = Array.from({ length: DEFORM_MODES * 4 }, () => this.gauss());
    this.idlePhase = Array.from({ length: DEFORM_MODES * 4 }, () => this.rand() * Math.PI * 2);
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  private gauss() {
    const u = Math.max(1e-9, this.rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  /** 拍動の始まり：縮み方のばらつきの模様を新しく決め、ゆがみの成分をたたく */
  private onBeat(p: DeformParams, fast: number) {
    const g = p.strength * p.pulse;
    const n = Math.max(1, Math.round(p.waves));
    const v = Math.min(1, Math.max(0, p.variability));
    const s = this.state;
    s.pk = [Math.max(1, n - 1), n, n + 1];
    for (let j = 0; j < 3; j++) {
      const w = j === 1 ? 1 : 0.5;
      s.pa[j] = g * 0.07 * w * (0.5 + this.rand());
      s.pd[j] = g * 0.025 * w * (0.5 + this.rand());
      s.pp[j] = this.rand() * Math.PI * 2;
    }
    // ゆがみの成分をたたく（波の数の近くの成分ほど強く）
    for (let k = 1; k <= DEFORM_MODES; k++) {
      const wk = Math.exp(-(((k - n) / 1.1) ** 2));
      for (let c = 0; c < 4; c++) {
        const i = (k - 1) * 4 + c;
        const mix = (1 - v) * this.base[i] + v * this.gauss();
        const vertical = c >= 2 ? 0.6 : 1;
        // 最大でおよそ傘の半径の数％のゆがみになる大きさ
        this.osc[i].kick(g * 0.016 * fast * wk * mix * vertical);
      }
    }
  }

  update(dt: number, p: DeformParams, inp: DeformInputs): DeformState {
    this.time += dt;
    const { fast, slow } = rates(p.attack, p.recover);
    const s = this.state;
    s.hard = 1 + 3 * Math.min(1, Math.max(0, p.hardness));
    if (inp.beatStarted) this.onBeat(p, fast);
    if (p.strength * p.pulse <= 0) {
      s.pa = [0, 0, 0];
      s.pd = [0, 0, 0];
    }
    // ③ 向きを変えるとき：曲がる側の外側が膨らみ、内側がしわ寄る（k=1）。縁は少し遅れて下がる
    const tg = p.strength * p.turn;
    const targets = new Float32Array(DEFORM_MODES * 4);
    targets[0] = -inp.turnX * 0.12 * tg;
    targets[1] = -inp.turnZ * 0.12 * tg;
    targets[2] = -inp.turnX * 0.08 * tg;
    targets[3] = -inp.turnZ * 0.08 * tg;
    // 内側のしわ（k=3 の細かめの波を少し）
    targets[8] = Math.abs(inp.turnX) * 0.03 * tg;
    targets[9] = Math.abs(inp.turnZ) * 0.03 * tg;

    const sub = 2;
    for (let i = 0; i < this.osc.length; i++) {
      for (let k = 0; k < sub; k++) this.osc[i].step(dt / sub, fast, slow, p.overshoot, targets[i]);
    }
    // ② 前へ進むとき：てっぺんが押されて平たく、縁は後ろへめくれる（速いほど強い）
    const flatTarget = p.strength * p.drag * Math.max(0, inp.speed) * 1.6;
    for (let k = 0; k < sub; k++) this.flatOsc.step(dt / sub, fast, slow, p.overshoot, flatTarget);

    // ④ 何もしていないときも、ごくかすかにゆっくりうねる
    const ig = p.strength * p.idle * 0.006;
    const t = this.time * p.idleSpeed;
    for (let i = 0; i < this.osc.length; i++) {
      const k = Math.floor(i / 4) + 1;
      const wk = k >= 2 && k <= 4 ? 1 : 0.3;
      const idle = ig * wk * Math.sin(t * (0.21 + 0.07 * k + 0.013 * i) + this.idlePhase[i]);
      s.modes[i] = (this.osc[i].x + idle) * (p.strength > 0 ? 1 : 0);
    }
    s.flat = this.flatOsc.x * (p.strength > 0 ? 1 : 0);
    return s;
  }
}
