import { describe, it, expect } from 'vitest';
import { BellDeformer, Viscoelastic, rates, defaultDeform, type DeformParams } from '../src/jelly/deform';
import { bellPos, shapePhases, JELLY_SEED, type BellState } from '../src/jelly/shape';

const ph = shapePhases(JELLY_SEED);
const bell = (def?: BellState['def'], beatT = 5): BellState => ({
  R: 1, D: 0.36, thick: 0.2, irr: 0.04, notch: 0.035, phase: ph,
  beatT, tc: 0.4, tr: 1.2, lag: 0.12, strength: 1, def,
});
const still = { beatStarted: false, speed: 0, turnX: 0, turnZ: 0 };
const P = (o: Partial<DeformParams> = {}): DeformParams => ({ ...defaultDeform, ...o });

/** たたいた後のゆがみの時間変化 */
function impulse(overshoot = 0, attack = 0.15, recover = 2.2, T = 5) {
  const o = new Viscoelastic();
  const { fast, slow } = rates(attack, recover);
  o.kick(1);
  const out: number[] = [];
  for (let t = 0; t < T; t += 1 / 120) {
    o.step(1 / 120, fast, slow, overshoot);
    out.push(o.x);
  }
  return out;
}

describe('一瞬ゆがんで、ジワーッと戻る', () => {
  it('ゆがむのは素早く（0.1〜0.2秒で最大）', () => {
    const r = impulse();
    const peakAt = r.indexOf(Math.max(...r)) / 120;
    expect(peakAt).toBeGreaterThan(0.08);
    expect(peakAt).toBeLessThan(0.22);
  });
  it('戻るのはゆっくり（1.5〜3秒でほぼ元どおり）。戻り始めは速く、元に近づくほどゆっくり', () => {
    const r = impulse();
    const peak = Math.max(...r);
    const back = r.findIndex((x, i) => i > 30 && x < peak * 0.1) / 120;
    expect(back).toBeGreaterThan(1.5);
    expect(back).toBeLessThan(3);
    const i0 = r.indexOf(peak);
    const early = r[i0] - r[i0 + 30];
    const late = r[i0 + 240] - r[i0 + 270];
    expect(early).toBeGreaterThan(late * 3);
  });
  it('揺れ返しの強さ0では、反対側へ揺れ返さない', () => {
    const r = impulse(0, 0.15, 2.2, 8);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(-1e-6);
  });
  it('揺れ返しを強くすると、反対側へ揺れ返す', () => {
    const r = impulse(1, 0.15, 2.2, 8);
    expect(Math.min(...r)).toBeLessThan(0);
  });
  it('戻りきる前の次のゆがみは、今のゆがみの上に重なる', () => {
    const { fast, slow } = rates(0.15, 2.2);
    const a = new Viscoelastic();
    a.kick(1);
    for (let i = 0; i < 60; i++) a.step(1 / 120, fast, slow, 0);
    const before = a.x;
    a.kick(1);
    let peak = 0;
    for (let i = 0; i < 60; i++) { a.step(1 / 120, fast, slow, 0); peak = Math.max(peak, a.x); }
    const single = Math.max(...impulse().slice(0, 60));
    expect(before).toBeGreaterThan(0);
    expect(peak).toBeGreaterThan(single * 1.2);
  });
});

/** 拍動を何回か起こしながら、縁の形を記録する */
function simulate(p: DeformParams, seconds: number, speed = 0, turn = 0) {
  const d = new BellDeformer(77);
  const frames: { t: number; rim: number[]; center: number }[] = [];
  let beatT = 0;
  for (let i = 0; i < seconds * 60; i++) {
    beatT += 1 / 60;
    let started = false;
    if (beatT >= 1.8) { beatT -= 1.8; started = true; }
    if (i === 0) started = true;
    const s = d.update(1 / 60, p, { beatStarted: started, speed, turnX: turn, turnZ: 0 });
    const b = bell(s, beatT);
    const rim: number[] = [];
    for (let k = 0; k < 64; k++) {
      const th = (k / 64) * Math.PI * 2;
      const q = bellPos(1, 0.5, th, b);
      rim.push(Math.hypot(q[0], q[2]));
    }
    const c = bellPos(0.15, 0, 0.3, b);
    frames.push({ t: i / 60, rim, center: Math.hypot(c[0], c[2]) + c[1] });
  }
  return frames;
}

describe('ゆがみの形', () => {
  it('全体の強さ0なら、ゆがみのない形とまったく同じ', () => {
    const d = new BellDeformer(1);
    let s = d.update(1 / 60, P({ strength: 0 }), { beatStarted: true, speed: 0.4, turnX: 0.3, turnZ: 0.1 });
    for (let i = 0; i < 100; i++) s = d.update(1 / 60, P({ strength: 0 }), { ...still, speed: 0.4, turnX: 0.3 });
    for (const [u, side, th, bt] of [[1, 0.5, 0.7, 0.3], [0.5, 0, 2.1, 0.5], [0.8, 1, 4, 1.0]]) {
      expect(bellPos(u, side, th, bell(s, bt))).toEqual(bellPos(u, side, th, bell(undefined, bt)));
    }
  });

  it('ゆがみは控えめ（縁で傘の直径の数％程度）で、中心ほど小さい', () => {
    const ref = simulate(P({ strength: 0 }), 20);
    const def = simulate(P(), 20, 0.3, 0.2);
    let rimMax = 0, centerMax = 0;
    for (let f = 0; f < def.length; f++) {
      for (let k = 0; k < 64; k++) rimMax = Math.max(rimMax, Math.abs(def[f].rim[k] - ref[f].rim[k]));
      centerMax = Math.max(centerMax, Math.abs(def[f].center - ref[f].center));
    }
    const diameter = 2;
    expect(rimMax / diameter).toBeGreaterThan(0.005);
    expect(rimMax / diameter).toBeLessThan(0.07);
    expect(centerMax).toBeLessThan(rimMax * 0.25);
  });

  it('なだらか（隣どうしは似た動き、ギザギザがない）', () => {
    const ref = simulate(P({ strength: 0 }), 10);
    const def = simulate(P({ pulse: 2, waves: 6 }), 10);
    for (let f = 0; f < def.length; f += 7) {
      const d = def[f].rim.map((r, k) => r - ref[f].rim[k]);
      const amp = Math.max(...d.map(Math.abs));
      if (amp < 1e-4) continue;
      let maxSecond = 0;
      for (let k = 0; k < 64; k++) {
        const second = d[(k + 1) % 64] - 2 * d[k] + d[(k + 63) % 64]; // 曲がり具合
        maxSecond = Math.max(maxSecond, Math.abs(second));
      }
      // ギザギザ（細かい凹凸）なら、曲がり具合がゆがみの大きさと同じくらいになる。
      // 大きな波だけなら、ずっと小さい
      expect(maxSecond).toBeLessThan(amp * 0.6);
    }
  });

  it('拍動のたびにゆがみ方の模様が変わる', () => {
    const ref = simulate(P({ strength: 0 }), 12);
    const def = simulate(P(), 12);
    // 各拍動の縮んだ瞬間（拍動開始から0.45秒後）の縁のゆがみ
    const snaps = [1, 2, 3, 4].map((b) => {
      const f = Math.round((b * 1.8 + 0.45) * 60);
      return def[f].rim.map((r, k) => r - ref[f].rim[k]);
    });
    const corr = (a: number[], b: number[]) => {
      const dot = a.reduce((s, x, i) => s + x * b[i], 0);
      return dot / Math.sqrt(a.reduce((s, x) => s + x * x, 0) * b.reduce((s, x) => s + x * x, 0));
    };
    for (let i = 1; i < snaps.length; i++) expect(corr(snaps[i - 1], snaps[i])).toBeLessThan(0.97);
  });

  it('進むとてっぺんが平たくつぶれ、止まると戻る', () => {
    const d = new BellDeformer(3);
    const top = (s: BellState['def']) => bellPos(0, 0, 0, bell(s))[1];
    const ref = top(undefined);
    let s = d.update(1 / 60, P({ pulse: 0, idle: 0 }), still);
    for (let i = 0; i < 60; i++) s = d.update(1 / 60, P({ pulse: 0, idle: 0 }), { ...still, speed: 0.4 });
    const moving = top(s);
    for (let i = 0; i < 60 * 6; i++) s = d.update(1 / 60, P({ pulse: 0, idle: 0 }), still);
    const stopped = top(s);
    expect(moving).toBeLessThan(ref - 0.005);
    expect(Math.abs(stopped - ref)).toBeLessThan(Math.abs(moving - ref) * 0.1);
  });

  it('向きを変えると、曲がる側の外側が膨らみ、内側が縮む', () => {
    const d = new BellDeformer(3);
    let s = d.update(1 / 60, P({ pulse: 0, idle: 0 }), still);
    for (let i = 0; i < 40; i++) s = d.update(1 / 60, P({ pulse: 0, idle: 0 }), { ...still, turnX: 0.35 });
    const r = (th: number, def?: BellState['def']) => Math.hypot(...([0, 2].map((i) => bellPos(1, 0.5, th, bell(def))[i]) as [number, number]));
    // +x側へ曲がる：外側は -x（θ=π）
    expect(r(Math.PI, s)).toBeGreaterThan(r(Math.PI));
    expect(r(0, s)).toBeLessThan(r(0));
  });

  it('何もしていなくても、形がかすかに揺らぎ続ける', () => {
    const d = new BellDeformer(3);
    const shapes: number[] = [];
    for (let i = 0; i < 60 * 20; i++) {
      const s = d.update(1 / 60, P({ pulse: 0 }), still);
      if (i % 60 === 0) shapes.push(bellPos(1, 0.5, 1.0, bell(s))[0]);
    }
    const spread = Math.max(...shapes) - Math.min(...shapes);
    expect(spread).toBeGreaterThan(0.001);
    expect(spread).toBeLessThan(0.03);
  });
});

import * as THREE from 'three';
import { ChainSet, tentacleSpecs } from '../src/jelly/chains';

describe('一緒にゆがむもの', () => {
  it('触手の付け根は、ゆがんだ傘の縁にくっついて動く', () => {
    const d = new BellDeformer(5);
    let s = d.update(1 / 60, P(), { ...still, beatStarted: true });
    for (let i = 0; i < 12; i++) s = d.update(1 / 60, P(), still);
    const specs = tentacleSpecs(1, ph[3], 30);
    specs.forEach((x) => (x.length = 0.5));
    const set = new ChainSet(specs, 8);
    const b = bell(s, 0.2);
    set.update(1 / 60, new THREE.Matrix4(), new THREE.Quaternion(), b, { stiffness: 8, drag: 1, sway: 0 });
    let maxDiffFromUndeformed = 0;
    for (let c = 0; c < 30; c++) {
      const root = [0, 1, 2].map((k) => set.pos[c * set.pointsPerChain * 3 + k]);
      const onRim = bellPos(1, 0.5, specs[c].theta, b);
      const undeformed = bellPos(1, 0.5, specs[c].theta, bell(undefined, 0.2));
      for (let k = 0; k < 3; k++) expect(root[k]).toBeCloseTo(onRim[k], 5);
      maxDiffFromUndeformed = Math.max(maxDiffFromUndeformed, Math.hypot(...[0, 1, 2].map((k) => onRim[k] - undeformed[k])));
    }
    expect(maxDiffFromUndeformed).toBeGreaterThan(0.002); // 実際にゆがんだ位置に付いている
  });
});
