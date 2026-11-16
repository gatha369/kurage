// 追加章B：タップ（クリック）とドラッグの区別
// 指を置いてすぐ離したときだけ「触る」。少しでも動かしたり、長く押したり、2本指にしたら触らない

export interface TapOptions {
  maxTime: number; // タップとみなす最長の押し時間（秒）
  maxMove: number; // タップとみなす最大の移動量（ピクセル）
}

interface Down { x: number; y: number; t: number; cancelled: boolean }

export class TapTracker {
  private downs = new Map<number, Down>();

  down(id: number, x: number, y: number, t: number) {
    // 2本目の指が置かれたら（ピンチ）、どれもタップにしない
    if (this.downs.size > 0) for (const d of this.downs.values()) d.cancelled = true;
    this.downs.set(id, { x, y, t, cancelled: this.downs.size > 0 });
  }

  move(id: number, x: number, y: number, opt: TapOptions) {
    const d = this.downs.get(id);
    if (d && Math.hypot(x - d.x, y - d.y) > opt.maxMove) d.cancelled = true;
  }

  /** 離したとき。タップならその位置を返す */
  up(id: number, x: number, y: number, t: number, opt: TapOptions): { x: number; y: number } | null {
    const d = this.downs.get(id);
    this.downs.delete(id);
    if (!d || d.cancelled) return null;
    if (Math.hypot(x - d.x, y - d.y) > opt.maxMove) return null;
    if (t - d.t > opt.maxTime) return null;
    return { x: d.x, y: d.y };
  }

  cancel(id: number) {
    this.downs.delete(id);
  }
}
