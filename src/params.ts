// 調整パネルで変えられる値と、その初期値。
// 「今の設定を書き出す」で出たJSONを、ここの初期値に貼り付けて本採用にする。

export type QualityMode = 'auto' | 'high' | 'mid' | 'low';

export interface Params {
  background: { color: string; brightness: number };
  fog: { density: number };
  spot: {
    intensity: number;
    angle: number; // 円錐の半角（度）
    tiltX: number; // 向き（度）
    tiltZ: number;
    beam: number; // 光の筋の見え方の強さ
    flicker: number; // ゆらぎ
  };
  ambient: { intensity: number };
  particles: { count: number; size: number; sinkSpeed: number };
  caustics: { strength: number };
  bloom: { strength: number };
  dof: { strength: number };
  grain: { strength: number };
  autoRotate: { enabled: boolean; speed: number };
  quality: { mode: QualityMode };
}

export const defaultParams: Params = {
  background: { color: '#03101f', brightness: 0.55 },
  fog: { density: 0.07 },
  spot: { intensity: 3.2, angle: 9, tiltX: 4, tiltZ: -3, beam: 0.04, flicker: 0.12 },
  ambient: { intensity: 0.12 },
  particles: { count: 4000, size: 1, sinkSpeed: 0.04 },
  caustics: { strength: 0.35 },
  bloom: { strength: 0.55 },
  dof: { strength: 1 },
  grain: { strength: 0.045 },
  autoRotate: { enabled: true, speed: 0.35 },
  quality: { mode: 'auto' },
};

export const MAX_PARTICLES = 9000;

export function cloneParams(p: Params): Params {
  return JSON.parse(JSON.stringify(p)) as Params;
}

/** 現在の値を、初期値として貼り付けられる整形済みJSONにする */
export function exportParams(p: Params): string {
  const round = (v: unknown): unknown => {
    if (typeof v === 'number') return Math.round(v * 10000) / 10000;
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
    }
    return v;
  };
  return JSON.stringify(round(p), null, 2);
}
