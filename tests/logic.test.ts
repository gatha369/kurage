import { describe, it, expect } from 'vitest';
import { spotGeometry, lightFlicker, IdleWatcher, AdaptiveQuality } from '../src/logic';
import { defaultParams, exportParams, cloneParams } from '../src/params';

describe('スポットライトの向き', () => {
  it('傾き0なら真上から真下へ差す', () => {
    const { apex, axis } = spotGeometry(0, 0, 12);
    expect(axis.y).toBeCloseTo(-1);
    expect(apex.y).toBeCloseTo(12);
    expect(Math.abs(apex.x) + Math.abs(apex.z)).toBeCloseTo(0);
  });
  it('傾けても向きの長さは1で、光は原点（クラゲの位置）を通る', () => {
    const { apex, axis } = spotGeometry(10, -7, 12);
    expect(Math.hypot(axis.x, axis.y, axis.z)).toBeCloseTo(1);
    expect(axis.y).toBeLessThan(0); // 下向き
    // apex + axis*12 = 原点
    expect(apex.x + axis.x * 12).toBeCloseTo(0);
    expect(apex.y + axis.y * 12).toBeCloseTo(0);
    expect(apex.z + axis.z * 12).toBeCloseTo(0);
  });
});

describe('光のゆらぎ', () => {
  it('常に 1±強さ の範囲に収まり、ゆっくり変化する', () => {
    let prev = lightFlicker(0, 0.2);
    for (let t = 0; t < 200; t += 1 / 60) {
      const v = lightFlicker(t, 0.2);
      expect(v).toBeGreaterThanOrEqual(0.8 - 1e-9);
      expect(v).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(Math.abs(v - prev)).toBeLessThan(0.01); // 1フレームで急に変わらない
      prev = v;
    }
  });
  it('強さ0ならゆらがない', () => {
    expect(lightFlicker(3.3, 0)).toBe(1);
  });
});

describe('放置したときの自動周回', () => {
  it('10秒経つまでは回らない', () => {
    const w = new IdleWatcher(0);
    expect(w.factor(5)).toBe(0);
    expect(w.factor(9.99)).toBe(0);
  });
  it('10秒を過ぎるとゆっくり加速し、最大になる', () => {
    const w = new IdleWatcher(0);
    const a = w.factor(10.5);
    const b = w.factor(11.5);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(w.factor(30)).toBe(1);
  });
  it('操作するとすぐ止まり、そこから再び10秒数える', () => {
    const w = new IdleWatcher(0);
    expect(w.factor(20)).toBe(1);
    w.interact(20);
    expect(w.factor(20)).toBe(0);
    expect(w.factor(29)).toBe(0);
    expect(w.factor(32)).toBeGreaterThan(0);
  });
});

function run(q: AdaptiveQuality, from: number, to: number, fps: number) {
  const dt = 1 / fps;
  const changes: number[] = [];
  for (let t = from; t < to; t += dt) if (q.update(t, dt)) changes.push(q.level);
  return changes;
}

describe('品質の自動調整', () => {
  it('60fps出ていれば高品質のまま', () => {
    const q = new AdaptiveQuality(0);
    expect(run(q, 0, 30, 60)).toEqual([]);
    expect(q.level).toBe(0);
  });
  it('重いと一段ずつ下がり、最低で止まる', () => {
    const q = new AdaptiveQuality(0);
    const changes = run(q, 0, 30, 30);
    expect(changes).toEqual([1, 2]);
    expect(q.level).toBe(2);
  });
  it('一瞬のカクつきでは下がらない', () => {
    const q = new AdaptiveQuality(0);
    run(q, 0, 10, 60);
    run(q, 10, 10.3, 20); // 0.3秒だけ重い
    run(q, 10.3, 20, 60);
    expect(q.level).toBe(0);
  });
  it('余裕が戻っても、すぐには上げず時間をおいて一段上げる（行ったり来たりしない）', () => {
    const q = new AdaptiveQuality(0);
    run(q, 0, 5, 30);
    expect(q.level).toBe(1);
    const t0 = 5;
    expect(run(q, t0, t0 + 15, 60)).toEqual([]); // 15秒では戻らない
    const changes = run(q, t0 + 15, t0 + 45, 60);
    expect(changes).toEqual([0]);
  });
  it('タブ切り替えなどの長い空白は無視する', () => {
    const q = new AdaptiveQuality(0);
    run(q, 0, 5, 60);
    expect(q.update(5, 3)).toBe(false);
    expect(q.level).toBe(0);
  });
});

describe('設定の書き出し', () => {
  it('全項目をJSONで書き出し、読み戻すと同じ値になる', () => {
    const json = exportParams(defaultParams);
    expect(JSON.parse(json)).toEqual(defaultParams);
  });
  it('小数は4桁に丸める', () => {
    const p = cloneParams(defaultParams);
    p.fog.density = 0.0712345678;
    expect(JSON.parse(exportParams(p)).fog.density).toBe(0.0712);
  });
});
