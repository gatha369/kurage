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
  bell: {
    size: number; // 傘の大きさ（半径）
    depth: number; // 傘の深さ
    irregularity: number; // いびつさの強さ
    period: number; // 拍動の周期（秒）
    contractTime: number; // 縮む時間（秒）＝縮む速さ
    relaxTime: number; // 開く時間（秒）＝開く速さ
    strength: number; // 縮む強さ
    thrust: number; // 進む力
    sink: number; // 沈む速さ
    transparency: number; // 透明度
    rimWhite: number; // 縁の白さ
    refraction: number; // 屈折の強さ
    blue: number; // 青み
    milk: number; // 乳白感
    gonadColor: string; // 四つ葉模様の色
    gonad: number; // 四つ葉模様の濃さ
    canal: number; // 放射管の濃さ
  };
  tentacles: {
    count: number; // 本数
    length: number; // 長さ（傘の半径に対する割合）
    thickness: number; // 太さ
    variation: number; // ばらつき
    suppleness: number; // 遅れ具合（しなやかさ）
    drag: number; // 水の抵抗の強さ
  };
  arms: {
    length: number; // 長さ（傘の半径に対する割合）
    width: number; // 幅（傘の半径に対する割合）
    frill: number; // フリルの強さ
    lag: number; // 遅れ具合
  };
  quality: { mode: QualityMode };
}

export const defaultParams: Params = {
  background: { color: '#03101f', brightness: 0.55 },
  fog: { density: 0.07 },
  spot: { intensity: 3.2, angle: 11, tiltX: 4, tiltZ: -3, beam: 0.04, flicker: 0.12 },
  ambient: { intensity: 0.12 },
  particles: { count: 4000, size: 1, sinkSpeed: 0.04 },
  caustics: { strength: 0.35 },
  bloom: { strength: 0.55 },
  dof: { strength: 1 },
  grain: { strength: 0.045 },
  autoRotate: { enabled: true, speed: 0.35 },
  bell: {
    size: 1,
    depth: 0.36,
    irregularity: 0.04,
    period: 1.8,
    contractTime: 0.4,
    relaxTime: 1.2,
    strength: 1,
    thrust: 0.45,
    sink: 0.06,
    transparency: 0.82,
    rimWhite: 1,
    refraction: 1,
    blue: 0.4,
    milk: 0.35,
    gonadColor: '#f2b6c8',
    gonad: 0.8,
    canal: 0.4,
  },
  tentacles: { count: 240, length: 0.5, thickness: 1, variation: 0.5, suppleness: 0.5, drag: 1 },
  arms: { length: 1.3, width: 0.13, frill: 0.6, lag: 0.6 },
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
