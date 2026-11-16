// 追加章B：慌て度。触られるたびに上がり、触られないとゆっくり下がる

export class Panic {
  /** 本当の慌て度（触ると一気に上がる） */
  level = 0;
  /** 見た目に使う慌て度（急に変わらないよう、なめらかに追いかける） */
  smooth = 0;

  touch(amount: number, max: number) {
    this.level = Math.min(max, this.level + amount);
  }

  /** calmTime：上限から0に戻るまでの秒数 */
  update(dt: number, max: number, calmTime: number) {
    this.level = Math.max(0, Math.min(max, this.level - (dt * max) / Math.max(1, calmTime)));
    const k = 1 - Math.exp(-dt / 0.35);
    this.smooth += (this.level - this.smooth) * k;
    if (this.smooth < 1e-4) this.smooth = 0;
    return this.smooth;
  }
}
