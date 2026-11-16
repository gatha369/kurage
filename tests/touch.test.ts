import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TapTracker } from '../src/interact/tap';
import { Panic } from '../src/jelly/panic';
import { hitBell, hitChains } from '../src/interact/hit';
import { BellDeformer, defaultDeform } from '../src/jelly/deform';
import { bellPos, shapePhases, JELLY_SEED, type BellState } from '../src/jelly/shape';
import { JellyMotion, coneRatio, type Cone } from '../src/jelly/motion';
import { ChainSet, tentacleSpecs } from '../src/jelly/chains';
import { spotGeometry } from '../src/logic';

const opt = { maxTime: 0.3, maxMove: 10 };
const ph = shapePhases(JELLY_SEED);
const bell = (o: Partial<BellState> = {}): BellState => ({
  R: 1, D: 0.36, thick: 0.2, irr: 0.04, notch: 0.035, phase: ph,
  beatT: 5, tc: 0.4, tr: 1.2, lag: 0.12, strength: 1, ...o,
});

describe('タップとドラッグの区別', () => {
  it('置いてすぐ離せばタップ', () => {
    const t = new TapTracker();
    t.down(1, 100, 100, 0);
    expect(t.up(1, 102, 101, 0.15, opt)).toEqual({ x: 100, y: 100 });
  });
  it('少しでも動かしたら（ドラッグ）タップにしない。戻ってきてもだめ', () => {
    const t = new TapTracker();
    t.down(1, 100, 100, 0);
    t.move(1, 130, 100, opt);
    t.move(1, 100, 100, opt);
    expect(t.up(1, 100, 100, 0.2, opt)).toBeNull();
  });
  it('長く押し続けたらタップにしない', () => {
    const t = new TapTracker();
    t.down(1, 100, 100, 0);
    expect(t.up(1, 100, 100, 0.5, opt)).toBeNull();
  });
  it('2本指（ピンチ）はタップにしない', () => {
    const t = new TapTracker();
    t.down(1, 100, 100, 0);
    t.down(2, 200, 200, 0.05);
    expect(t.up(1, 100, 100, 0.1, opt)).toBeNull();
    expect(t.up(2, 200, 200, 0.12, opt)).toBeNull();
  });
});

describe('慌て度', () => {
  it('触るたびに上がり、上限で止まる', () => {
    const p = new Panic();
    p.touch(0.35, 1);
    expect(p.level).toBeCloseTo(0.35);
    for (let i = 0; i < 10; i++) p.touch(0.35, 1);
    expect(p.level).toBe(1);
  });
  it('上限から0に戻るまで、設定した時間（約17秒）かかり、なめらかに下がる', () => {
    const p = new Panic();
    p.touch(1, 1);
    let prev = 0;
    let t = 0;
    for (; t < 40; t += 1 / 60) {
      const s = p.update(1 / 60, 1, 17);
      expect(Math.abs(s - prev)).toBeLessThan(0.05); // 急に変わらない
      prev = s;
      if (t > 1 && s === 0) break;
    }
    expect(t).toBeGreaterThan(15);
    expect(t).toBeLessThan(20.5);
  });
});

describe('当たり判定', () => {
  const m = new THREE.Matrix4();
  it('傘の真上から中心を狙うと傘に当たり、てっぺん付近（u小）で、外側から触った扱い', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));
    const h = hitBell(ray, m, bell());
    expect(h?.kind).toBe('bell');
    if (h?.kind === 'bell') {
      expect(h.u).toBeLessThan(0.1);
      expect(h.fromOutside).toBe(true);
    }
  });
  it('透けている部分でも、傘の形の範囲内なら当たる。真下からなら内側から触った扱い', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0.6, -5, 0.1), new THREE.Vector3(0, 1, 0));
    const h = hitBell(ray, m, bell());
    expect(h?.kind).toBe('bell');
    if (h?.kind === 'bell') expect(h.fromOutside).toBe(false);
  });
  it('傘の外（水だけの場所）は当たらない', () => {
    const ray = new THREE.Ray(new THREE.Vector3(2, 5, 0), new THREE.Vector3(0, -1, 0));
    expect(hitBell(ray, m, bell())).toBeNull();
  });
  it('細い触手も、見た目より広めの範囲で当たる', () => {
    const specs = tentacleSpecs(1, ph[3], 10);
    specs.forEach((s) => (s.length = 0.5));
    const set = new ChainSet(specs, 8);
    set.update(1 / 60, m, new THREE.Quaternion(), bell(), { stiffness: 8, drag: 1, sway: 0 });
    const i = 5 * 3; // 1本目の5番目の節
    const p = new THREE.Vector3(set.pos[i], set.pos[i + 1], set.pos[i + 2]);
    // 0.04 ずれた所を狙う（触手の太さは0.006）
    const ray = new THREE.Ray(new THREE.Vector3(p.x + 0.04, p.y, 5), new THREE.Vector3(0, 0, -1));
    const h = hitChains(ray, set, 10, 0.05, 20, 800);
    expect(h).not.toBeNull();
    const far = new THREE.Ray(new THREE.Vector3(p.x + 0.6, p.y + 2, 5), new THREE.Vector3(0, 0, -1));
    expect(hitChains(far, set, 10, 0.05, 20, 800)).toBeNull();
  });
});

describe('触れた場所のへこみ', () => {
  const rimDent = (u: number) => {
    const d = new BellDeformer(1);
    const p = { ...defaultDeform, pulse: 0, idle: 0, turn: 0, drag: 0 };
    d.update(1 / 60, p, { beatStarted: false, speed: 0, turnX: 0, turnZ: 0 });
    d.poke(u, 0.5, 1, { depth: 0.06, radius: 0.25, recover: 1.5 }, 0.5, 0.15, 1.5);
    const series: number[] = [];
    for (let i = 0; i < 60 * 4; i++) {
      const s = d.update(1 / 60, p, { beatStarted: false, speed: 0, turnX: 0, turnZ: 0 }, { depth: 0.06, radius: 0.25, recover: 1.5 });
      const a = bellPos(u, 0, 0.5, bell({ def: s }));
      const b = bellPos(u, 0, 0.5, bell());
      series.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    return series;
  };
  it('一瞬でへこみ、ジワーッと戻る', () => {
    const s = rimDent(0.85);
    const peakAt = s.indexOf(Math.max(...s)) / 60;
    expect(peakAt).toBeLessThan(0.3);
    expect(s[s.length - 1]).toBeLessThan(Math.max(...s) * 0.15);
  });
  it('縁の近くを触ると大きく、てっぺんを触ると小さくへこむ', () => {
    expect(Math.max(...rimDent(0.9))).toBeGreaterThan(Math.max(...rimDent(0.1)) * 1.8);
  });
});

describe('逃げる動き', () => {
  const g = spotGeometry(4, -3, 12);
  const cone: Cone = {
    apex: new THREE.Vector3(g.apex.x, g.apex.y, g.apex.z),
    axis: new THREE.Vector3(g.axis.x, g.axis.y, g.axis.z),
    tan: Math.tan(THREE.MathUtils.degToRad(11)),
  };
  const base = { period: 1.8, contractTime: 0.4, relaxTime: 1.2, lag: 0.12, thrust: 0.45, sink: 0.06 };

  it('触られた場所から離れる向きへ泳ぐ', () => {
    const m = new JellyMotion(5);
    for (let i = 0; i < 60 * 5; i++) m.update(1 / 60, base, cone);
    const start = m.pos.clone();
    m.flee(new THREE.Vector3(-1, 0.2, 0), 0.6); // +x側から触られた
    for (let i = 0; i < 60 * 3; i++) m.update(1 / 60, { ...base, panic: 0.5 }, cone);
    expect(m.pos.x).toBeLessThan(start.x - 0.1);
  });

  it('光の端で何度も触られても、光の外へ出ていかず、やがて中心へ戻ってくる', () => {
    const m = new JellyMotion(8);
    const p = new Panic();
    let maxRatio = 0;
    for (let i = 0; i < 60 * 40; i++) {
      if (i < 60 * 15 && i % 30 === 0) {
        // 中心から外へ押し出すように、繰り返し触る
        const h = m.pos.clone().sub(cone.apex).dot(cone.axis);
        const center = cone.apex.clone().addScaledVector(cone.axis, h);
        const out = m.pos.clone().sub(center).setY(0);
        if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
        m.flee(out, 0.6);
        p.touch(0.35, 1);
      }
      const panic = p.update(1 / 60, 1, 17);
      const k = 1 + panic * 1.2;
      m.update(1 / 60, { ...base, period: 1.8 / k, contractTime: 0.4 / (1 + panic * 0.6), relaxTime: 1.2 / k, panic, flee: 1 }, cone);
      maxRatio = Math.max(maxRatio, coneRatio(m.pos, cone));
    }
    expect(maxRatio).toBeLessThan(1.0); // 体の中心は光の中（全身が闇に消えない）
    expect(maxRatio).toBeGreaterThan(0.6); // 端の近くまでは行く
    // しばらく触らなければ、中心寄りへ戻っている
    for (let i = 0; i < 60 * 30; i++) m.update(1 / 60, base, cone);
    expect(coneRatio(m.pos, cone)).toBeLessThan(0.7);
  });

  it('拍動の速さが途中で変わっても、傘の形が跳ばない（拍動の区切りで切り替える）', () => {
    const m = new JellyMotion(5);
    let prev: number | null = null;
    let maxJump = 0;
    for (let i = 0; i < 60 * 20; i++) {
      const panic = i > 300 && i < 600 ? 1 : 0; // 途中で急に慌てる
      const k = 1 + panic * 1.2;
      m.update(1 / 60, { ...base, period: 1.8 / k, contractTime: 0.4 / (1 + 0.6 * panic), relaxTime: 1.2 / k, strength: 1 + 0.5 * panic }, cone);
      const b = bell({ beatT: m.beat.t, tc: m.shape.tc, tr: m.shape.tr, strength: m.shape.strength });
      const r = Math.hypot(...([0, 2].map((j) => bellPos(1, 0.5, 0.3, b)[j]) as [number, number]));
      if (prev !== null) maxJump = Math.max(maxJump, Math.abs(r - prev));
      prev = r;
    }
    expect(maxJump).toBeLessThan(0.06); // 1フレームで傘の半径の6％以上は動かない
  });
});

describe('慌て度が上限でも形が破綻しない', () => {
  it('外側の面は内側の面より上（裏返らない）、断面が折れ返らない', () => {
    const d = new BellDeformer(9);
    const p = { ...defaultDeform, strength: 2.5 };
    let s = d.update(1 / 60, p, { beatStarted: true, speed: 0.8, turnX: 1, turnZ: 0.5 });
    for (let k = 0; k < 4; k++) d.poke(0.8, k * 1.5, 1, { depth: 0.06, radius: 0.25, recover: 1.5 }, 0.5, 0.15, 1.5);
    for (let f = 0; f < 120; f++) {
      s = d.update(1 / 60, p, { beatStarted: f % 40 === 0, speed: 0.8, turnX: 1, turnZ: 0.5 }, { depth: 0.06, radius: 0.25, recover: 1.5 });
      const b = bell({ def: s, beatT: (f / 60) % 0.8, tc: 0.18, tr: 0.4, strength: 1.75, twitchT: f / 60, twitchAmp: 1 });
      for (let th = 0; th < 6.28; th += 0.4) {
        let prevT: [number, number] | null = null;
        let prev: [number, number] | null = null;
        for (let u = 0.05; u <= 1.0001; u += 0.05) {
          const o = bellPos(u, 0, th, b);
          const inn = bellPos(u, 1, th, b);
          const cur: [number, number] = [Math.hypot(o[0], o[2]), o[1]];
          if (prev) {
            const t: [number, number] = [cur[0] - prev[0], cur[1] - prev[1]];
            const len = Math.hypot(t[0], t[1]);
            t[0] /= len; t[1] /= len;
            // 断面の向きが急に反転しない（折れ返り・とがった角がない）
            if (prevT) expect(t[0] * prevT[0] + t[1] * prevT[1]).toBeGreaterThan(0.5);
            prevT = t;
          }
          prev = cur;
          expect(o[1]).toBeGreaterThan(inn[1] - 1e-6); // 外側が内側より上（裏返らない）
        }
      }
    }
  });
});
