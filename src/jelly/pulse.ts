// 傘の拍動（速く縮んで、ゆっくり開く）の計算。画面の計算（GLSL）と同じ式を使う

/**
 * 拍動開始からの経過時間 t における縮み具合（0=開ききり〜1=最も縮む）
 * tc：縮むのにかかる時間、tr：開くのにかかる時間
 */
export function contraction(t: number, tc: number, tr: number): number {
  if (t <= 0 || t >= tc + tr) return 0;
  if (t < tc) {
    const s = t / tc;
    return s * s * (3 - 2 * s);
  }
  // 開く：はじめは少し速く、最後はふわっと減速して止まる
  const s = (t - tc) / tr;
  const a = 1 - s;
  return a * a * a * (1 + 3 * s);
}

/** 拍動のリズムを刻む時計。周期にわずかなゆらぎを持たせる */
export class BeatClock {
  t = 0; // 今の拍動が始まってからの時間
  period: number;
  private seed: number;
  constructor(seed = 1, period = 1.8) {
    this.seed = seed;
    this.period = period;
  }
  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  /** 周期の下限：縮む＋開く＋縁まで波が伝わる時間 */
  static minPeriod(tc: number, tr: number, lag: number) {
    return tc + tr + lag + 0.05;
  }
  update(dt: number, basePeriod: number, tc: number, tr: number, lag: number, jitter = 0.07) {
    this.t += dt;
    const minP = BeatClock.minPeriod(tc, tr, lag);
    if (this.period < minP) this.period = minP;
    if (this.t >= this.period) {
      this.t -= this.period;
      if (this.t > this.period) this.t = 0;
      this.period = Math.max(minP, basePeriod * (1 + jitter * (this.rand() * 2 - 1)));
      return true; // 新しい拍動が始まった
    }
    return false;
  }
}
