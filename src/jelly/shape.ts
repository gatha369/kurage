// 傘のいびつさ（個体差）を、乱数の種から毎回同じに決める

export const JELLY_SEED = 20261116;

/** [1倍・2倍・3倍の波の位相, 切れ込みの向き] を返す */
export function shapePhases(seed: number): [number, number, number, number] {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const tau = Math.PI * 2;
  return [r() * tau, r() * tau, r() * tau, r() * (Math.PI / 4)];
}

/** ある角度での傘の半径の倍率（いびつさ。切れ込みは含まない） */
export function irregularity(theta: number, amount: number, ph: readonly number[]): number {
  return (
    1 +
    amount *
      (0.5 * Math.sin(theta + ph[0]) + 0.3 * Math.sin(2 * theta + ph[1]) + 0.2 * Math.sin(3 * theta + ph[2]))
  );
}

/** 8か所の切れ込みの角度 */
export function notchAngles(ph: readonly number[]): number[] {
  return Array.from({ length: 8 }, (_, k) => ph[3] + (k * Math.PI) / 4);
}
