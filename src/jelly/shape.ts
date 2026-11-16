import { contraction } from './pulse';
import { DEFORM_MODES, type DeformState } from './deform';

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

// ---- 傘の形の計算（画面側の bellShapeGlsl と同じ式）。触手や口腕の付け根を求めるのに使う ----

export interface BellState {
  R: number; // 半径
  D: number; // 深さ
  thick: number; // 中心の厚み
  irr: number; // いびつさ
  notch: number; // 切れ込みの深さ
  phase: readonly number[]; // [位相x3, 切れ込みの向き]
  beatT: number;
  tc: number;
  tr: number;
  lag: number;
  strength: number;
  def?: DeformState; // 追加章A：ゆがみ（なければゆがみなし）
}

export const PHI_M = 1.05;

export function radiusFactor(th: number, u: number, s: BellState): number {
  const ph = s.phase;
  const irr = 1 + s.irr * (0.5 * Math.sin(th + ph[0]) + 0.3 * Math.sin(2 * th + ph[1]) + 0.2 * Math.sin(3 * th + ph[2]));
  const q = Math.PI / 4;
  let a = (th - ph[3]) % q;
  if (a < 0) a += q;
  const d = Math.min(a, q - a);
  const sm = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const notch = Math.exp(-(d * d) / (0.045 * 0.045)) * sm(0.8, 1, u) * sm(0.8, 1, u);
  const lobe = 0.008 * sm(0.7, 1, u) * Math.sin((d / (Math.PI / 8)) * Math.PI * 0.5);
  return irr * (1 - s.notch * notch + lobe);
}

export function thicknessAt(u: number, s: BellState): number {
  return s.thick * (0.12 + 0.88 * (1 - Math.pow(u, 1.25)));
}

/** 傘の上の点（傘自身の座標）。u：中心0〜縁1、side：外側0〜内側1、th：角度 */
/** ① 拍動の縮み方のばらつき：[縮む強さの倍率の増分, 縮むタイミングの遅れ] */
export function pulseVariation(th: number, d: DeformState | undefined): [number, number] {
  if (!d) return [0, 0];
  let a = 0, dl = 0;
  for (let j = 0; j < 3; j++) {
    const w = Math.cos(d.pk[j] * th + d.pp[j]);
    a += d.pa[j] * w;
    dl += d.pd[j] * (w * 0.5 + 0.5);
  }
  return [Math.max(-0.9, a), dl];
}

export function bellPos(u: number, side: number, th: number, s: BellState): [number, number, number] {
  const pv = pulseVariation(th, s.def);
  const c = contraction(s.beatT - u * s.lag - u * pv[1], s.tc, s.tr) * s.strength * (1 + u * pv[0]);
  const phi = u * PHI_M;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const sM = Math.sin(PHI_M), cM = Math.cos(PHI_M);
  const R = s.R * radiusFactor(th, u, s);
  let ox = (sp / sM) * R;
  let oy = ((cp - cM) / (1 - cM)) * s.D;
  let tx = (cp / sM) * R, ty = (-sp / (1 - cM)) * s.D;
  const tl = Math.hypot(tx, ty);
  tx /= tl; ty /= tl;
  const nx = -ty, ny = tx;
  const t = thicknessAt(u, s);
  let qx = ox + (ox - nx * t - ox) * side;
  let qy = oy + (oy - ny * t - oy) * side;
  if (u >= 0.999) {
    const b = Math.sin(side * Math.PI) * t * 0.5;
    qx += tx * b;
    qy += ty * b;
  }
  qx *= 1 - 0.3 * c * Math.pow(u, 1.5);
  qy += -c * s.D * 0.65 * u * u + c * s.D * 0.12 * (1 - u);
  // 追加章A：ゆがみ（縁ほど大きく、中心ほど小さい）
  const d = s.def;
  if (d) {
    const w = Math.pow(u, d.hard);
    let dr = 0, dy = 0;
    for (let k = 1; k <= DEFORM_MODES; k++) {
      const m = (k - 1) * 4;
      const ck = Math.cos(k * th), sk = Math.sin(k * th);
      dr += d.modes[m] * ck + d.modes[m + 1] * sk;
      dy += d.modes[m + 2] * ck + d.modes[m + 3] * sk;
    }
    qx += w * dr * s.R;
    qy += w * dy * s.R;
    // ② てっぺんが平たくつぶれ、縁は後ろへめくれる
    qy -= d.flat * s.D * (0.1 * (1 - u * u) + 0.22 * u * u);
    qx += d.flat * s.R * 0.04 * u * u;
  }
  qy -= s.D * 0.45;
  return [qx * Math.cos(th), qy, qx * Math.sin(th)];
}
