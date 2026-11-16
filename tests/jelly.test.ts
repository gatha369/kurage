import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { contraction, BeatClock } from '../src/jelly/pulse';
import { shapePhases, irregularity, notchAngles, JELLY_SEED } from '../src/jelly/shape';
import { JellyMotion, coneRatio, type Cone } from '../src/jelly/motion';
import { spotGeometry } from '../src/logic';

describe('拍動のリズム', () => {
  const tc = 0.4, tr = 1.2;
  it('開ききった状態から始まり、縮みきって、また開ききる', () => {
    expect(contraction(0, tc, tr)).toBe(0);
    expect(contraction(tc, tc, tr)).toBeCloseTo(1);
    expect(contraction(tc + tr, tc, tr)).toBe(0);
  });
  it('縮むのは速く、開くのはゆっくり（同じ割合に達するまでの時間）', () => {
    const tHalfUp = [...Array(1000).keys()].map((i) => (i / 1000) * tc).find((t) => contraction(t, tc, tr) >= 0.5)!;
    const tHalfDown = [...Array(1000).keys()].map((i) => tc + (i / 1000) * tr).find((t) => contraction(t, tc, tr) <= 0.5)! - tc;
    expect(tHalfUp).toBeLessThan(0.25);
    expect(tHalfDown).toBeGreaterThan(tHalfUp);
  });
  it('なめらかに変化し（急に跳ばない）、戻りの最後はふわっと減速する', () => {
    let prev = 0;
    for (let t = 0; t <= tc + tr; t += 1 / 240) {
      const v = contraction(t, tc, tr);
      expect(Math.abs(v - prev)).toBeLessThan(0.02);
      prev = v;
    }
    const endSpeed = (contraction(tc + tr - 0.02, tc, tr) - contraction(tc + tr - 0.01, tc, tr)) / 0.01;
    const midSpeed = (contraction(tc + tr * 0.3, tc, tr) - contraction(tc + tr * 0.3 + 0.01, tc, tr)) / 0.01;
    expect(endSpeed).toBeLessThan(midSpeed * 0.05);
  });
  it('縁は中心より遅れて縮む（中心から縁へ波が伝わる）', () => {
    const lag = 0.12;
    const t = 0.2;
    const center = contraction(t, tc, tr);
    const rim = contraction(t - lag, tc, tr);
    expect(rim).toBeLessThan(center);
  });
  it('周期は 1.5〜2秒程度で、毎回わずかにゆらぐ（一定ではない）', () => {
    const clock = new BeatClock(5, 1.8);
    const periods: number[] = [];
    let since = 0;
    for (let i = 0; i < 60 * 120; i++) {
      since += 1 / 60;
      if (clock.update(1 / 60, 1.8, tc, tr, 0.12)) {
        periods.push(since);
        since = 0;
      }
    }
    expect(periods.length).toBeGreaterThan(50);
    for (const p of periods.slice(1)) {
      expect(p).toBeGreaterThan(1.5);
      expect(p).toBeLessThan(2.05);
    }
    expect(new Set(periods.map((p) => p.toFixed(2))).size).toBeGreaterThan(3);
  });
  it('周期を短くしすぎても、縮む＋開くの時間より短くはならない', () => {
    const clock = new BeatClock(5, 0.5);
    let since = 0;
    const periods: number[] = [];
    for (let i = 0; i < 60 * 30; i++) {
      since += 1 / 60;
      if (clock.update(1 / 60, 0.5, tc, tr, 0.12)) { periods.push(since); since = 0; }
    }
    for (const p of periods) expect(p).toBeGreaterThanOrEqual(tc + tr + 0.12);
  });
});

describe('傘の形の個体差', () => {
  it('同じ種なら毎回同じ形、違う種なら違う形', () => {
    expect(shapePhases(JELLY_SEED)).toEqual(shapePhases(JELLY_SEED));
    expect(shapePhases(JELLY_SEED)).not.toEqual(shapePhases(JELLY_SEED + 1));
  });
  it('いびつさは強さに比例し、0なら真円', () => {
    const ph = shapePhases(JELLY_SEED);
    for (let a = 0; a < 6.28; a += 0.1) {
      expect(irregularity(a, 0, ph)).toBe(1);
      expect(Math.abs(irregularity(a, 0.05, ph) - 1)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });
  it('切れ込みは等間隔に8か所', () => {
    const n = notchAngles(shapePhases(JELLY_SEED));
    expect(n.length).toBe(8);
    for (let i = 1; i < 8; i++) expect(n[i] - n[i - 1]).toBeCloseTo(Math.PI / 4);
  });
});

describe('泳ぎ方', () => {
  const g = spotGeometry(4, -3, 12);
  const cone: Cone = {
    apex: new THREE.Vector3(g.apex.x, g.apex.y, g.apex.z),
    axis: new THREE.Vector3(g.axis.x, g.axis.y, g.axis.z),
    tan: Math.tan(THREE.MathUtils.degToRad(11)),
  };
  const p = { period: 1.8, contractTime: 0.4, relaxTime: 1.2, lag: 0.12, thrust: 0.45, sink: 0.06 };

  it('縮んだ直後に速く進み、開いている間に減速する', () => {
    const m = new JellyMotion(3);
    const speeds: { t: number; v: number }[] = [];
    for (let i = 0; i < 60 * 6; i++) {
      m.update(1 / 60, p, cone);
      speeds.push({ t: m.beat.t, v: m.vel });
    }
    const late = speeds.slice(60 * 2);
    const afterContract = late.filter((s) => s.t > 0.45 && s.t < 0.6).map((s) => s.v);
    const endOfRelax = late.filter((s) => s.t > 1.55 && s.t < 1.65).map((s) => s.v);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(afterContract)).toBeGreaterThan(avg(endOfRelax) * 2);
  });

  it('10分泳がせても、スポットライトの光の中から大きく離れない', () => {
    const m = new JellyMotion(11);
    let maxRatio = 0;
    let edgeTime = 0;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 60 * 600; i++) {
      m.update(1 / 60, p, cone);
      const r = coneRatio(m.pos, cone);
      maxRatio = Math.max(maxRatio, r);
      if (r > 0.45) edgeTime += 1 / 60;
      minY = Math.min(minY, m.pos.y);
      maxY = Math.max(maxY, m.pos.y);
    }
    expect(maxRatio).toBeLessThan(1); // 円錐の外には出ない
    expect(edgeTime).toBeGreaterThan(5); // ときどき光の端に差しかかる
    expect(minY).toBeGreaterThan(-2.6);
    expect(maxY).toBeLessThan(2.6);
  });

  it('逆さまにはならない（傾きは65度まで）', () => {
    const m = new JellyMotion(2);
    for (let i = 0; i < 60 * 300; i++) {
      m.update(1 / 60, p, cone);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quat);
      expect(up.y).toBeGreaterThan(Math.cos(THREE.MathUtils.degToRad(66)));
    }
  });
});
