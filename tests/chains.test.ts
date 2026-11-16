import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ChainSet, tentacleSpecs, armSpecs, MAX_TENTACLES, type ChainPhysics } from '../src/jelly/chains';
import { bellPos, shapePhases, JELLY_SEED, type BellState } from '../src/jelly/shape';
import { JellyMotion, type Cone } from '../src/jelly/motion';
import { spotGeometry } from '../src/logic';

const ph = shapePhases(JELLY_SEED);
const bell = (beatT = 0): BellState => ({
  R: 1, D: 0.36, thick: 0.2, irr: 0.04, notch: 0.035, phase: ph,
  beatT, tc: 0.4, tr: 1.2, lag: 0.12, strength: 1,
});
const tentPhys: ChainPhysics = { stiffness: 8.5, drag: 1, sway: 0.25 };
const armPhys: ChainPhysics = { stiffness: 3, drag: 1.4, sway: 0.15 };

function makeSet(specs = tentacleSpecs(1, ph[3], 60), segs = 10, len = 0.55) {
  specs.forEach((s) => (s.length = len));
  return new ChainSet(specs, segs);
}

describe('傘の形（付け根の計算）', () => {
  it('縁は中心より低く、外側にある', () => {
    const b = bell();
    const top = bellPos(0, 0, 0, b);
    const rim = bellPos(1, 0.5, 0, b);
    expect(rim[1]).toBeLessThan(top[1]);
    expect(Math.hypot(rim[0], rim[2])).toBeGreaterThan(0.9);
  });
  it('縮むと縁が内側へすぼまる', () => {
    const open = bellPos(1, 0.5, 0, bell(0));
    const closed = bellPos(1, 0.5, 0, bell(0.52));
    expect(Math.hypot(closed[0], closed[2])).toBeLessThan(Math.hypot(open[0], open[2]) * 0.85);
  });
});

describe('触手の並び', () => {
  it('切れ込みの所には生えず、本数を減らしても縁全体に均等に残る', () => {
    const specs = tentacleSpecs(1, ph[3]);
    expect(specs.length).toBe(MAX_TENTACLES);
    for (const s of specs) {
      const q = Math.PI / 4;
      let a = (s.theta - ph[3]) % q;
      if (a < 0) a += q;
      expect(Math.min(a, q - a)).toBeGreaterThanOrEqual(0.05);
    }
    // 先頭の40本だけでも、8つの区画すべてにある
    const sectors = new Set(specs.slice(0, 40).map((s) => Math.floor(s.theta / (Math.PI / 4))));
    expect(sectors.size).toBe(8);
  });
  it('口腕は4本で、90度ずつ', () => {
    const a = armSpecs(0.3);
    expect(a.length).toBe(4);
    expect(a[1].theta - a[0].theta).toBeCloseTo(Math.PI / 2);
  });
});

describe('触手の動き', () => {
  it('止まっていれば、付け根から下へ垂れ、長さが保たれる', () => {
    const set = makeSet();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 300; i++) set.update(1 / 60, m, q, bell(), tentPhys);
    const P = set.pointsPerChain;
    for (let c = 0; c < 60; c++) {
      const root = c * P * 3, tip = root + (P - 1) * 3;
      expect(set.pos[tip + 1]).toBeLessThan(set.pos[root + 1] - 0.3);
      let len = 0;
      for (let j = 1; j < P; j++) {
        const i = root + j * 3;
        len += Math.hypot(set.pos[i] - set.pos[i - 3], set.pos[i + 1] - set.pos[i - 2], set.pos[i + 2] - set.pos[i - 1]);
      }
      expect(len).toBeCloseTo(0.55, 1);
    }
  });

  it('傘が上へ進むと、触手は後ろ（下）へなびく', () => {
    const set = makeSet();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 200; i++) set.update(1 / 60, m, q, bell(), tentPhys);
    const P = set.pointsPerChain;
    const spread = () => {
      // 先端の、付け根からの水平の広がり
      let s = 0;
      for (let c = 0; c < 60; c++) {
        const r = c * P * 3, t = r + (P - 1) * 3;
        s += Math.hypot(set.pos[t] - set.pos[r], set.pos[t + 2] - set.pos[r + 2]);
      }
      return s / 60;
    };
    const still = spread();
    // 上へ速く動かす
    let y = 0;
    for (let i = 0; i < 20; i++) {
      y += 0.03;
      m.makeTranslation(0, y, 0);
      set.update(1 / 60, m, q, bell(), tentPhys);
    }
    expect(spread()).toBeLessThan(still * 0.9); // 後ろへ流れて細くまとまる
  });

  it('傘が縮むと、触手の先端は付け根より遅れて動く', () => {
    const set = makeSet(tentacleSpecs(1, ph[3], 20));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 200; i++) set.update(1 / 60, m, q, bell(5), tentPhys); // 開いた状態で落ち着かせる
    const P = set.pointsPerChain;
    const rootR: number[] = [], tipR: number[] = [];
    for (let i = 0; i < 120; i++) {
      set.update(1 / 60, m, q, bell(i / 60), tentPhys);
      rootR.push(Math.hypot(set.pos[0], set.pos[2]));
      const t = (P - 1) * 3;
      tipR.push(Math.hypot(set.pos[t], set.pos[t + 2]));
    }
    const argmin = (a: number[]) => a.indexOf(Math.min(...a));
    expect(argmin(tipR)).toBeGreaterThan(argmin(rootR)); // 先端が一番すぼまるのは、付け根より後
  });

  it('口腕は触手よりさらに遅れる', () => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tent = makeSet(tentacleSpecs(1, ph[3], 4), 10, 0.55);
    const arms = makeSet(armSpecs(ph[3]), 16, 1.4);
    for (let i = 0; i < 300; i++) {
      tent.update(1 / 60, m, q, bell(5), tentPhys);
      arms.update(1 / 60, m, q, bell(5), armPhys);
    }
    // 横へ急に動かし、先端が付け根の真下に戻るまでの時間を比べる
    const settle = (set: ChainSet, phys: ChainPhysics) => {
      const P = set.pointsPerChain;
      const mm = new THREE.Matrix4().makeTranslation(0.5, 0, 0);
      for (let i = 0; i < 600; i++) {
        set.update(1 / 60, mm, q, bell(5), phys);
        const t = (P - 1) * 3;
        const dx = set.pos[t] - set.pos[0];
        const off = Math.abs(dx - Math.cos(set.specs[0].theta) * Math.sin(set.specs[0].restTilt) * set.specs[0].length * 1);
        if (i > 10 && off < 0.05) return i;
      }
      return 600;
    };
    expect(settle(arms, armPhys)).toBeGreaterThan(settle(tent, tentPhys));
  });

  it('5分泳がせても、触手と口腕が傘を突き抜けて上に出ない', () => {
    const g = spotGeometry(4, -3, 12);
    const cone: Cone = {
      apex: new THREE.Vector3(g.apex.x, g.apex.y, g.apex.z),
      axis: new THREE.Vector3(g.axis.x, g.axis.y, g.axis.z),
      tan: Math.tan(THREE.MathUtils.degToRad(11)),
    };
    const motion = new JellyMotion(5);
    const tent = makeSet(tentacleSpecs(1, ph[3], 80));
    const arms = makeSet(armSpecs(ph[3]), 16, 1.4);
    const obj = new THREE.Object3D();
    const inv = new THREE.Matrix4();
    const v = new THREE.Vector3();
    let worst = -Infinity;
    for (let i = 0; i < 60 * 300; i++) {
      motion.update(1 / 60, { period: 1.8, contractTime: 0.4, relaxTime: 1.2, lag: 0.12, thrust: 0.45, sink: 0.06 }, cone);
      obj.position.copy(motion.pos);
      obj.quaternion.copy(motion.quat);
      obj.updateMatrixWorld();
      const b = bell(motion.beat.t);
      tent.update(1 / 60, obj.matrixWorld, obj.quaternion, b, tentPhys);
      arms.update(1 / 60, obj.matrixWorld, obj.quaternion, b, armPhys);
      if (i % 10) continue;
      inv.copy(obj.matrixWorld).invert();
      // 傘の外側の面より上（＝傘を突き抜けた）になっていないか
      for (const set of [tent, arms]) {
        for (let k = 0; k < set.pos.length; k += 3) {
          v.set(set.pos[k], set.pos[k + 1], set.pos[k + 2]).applyMatrix4(inv);
          const r = Math.hypot(v.x, v.z);
          if (r > 0.9) continue;
          const u = Math.min(1, r);
          const outer = bellPos(u, 0, Math.atan2(v.z, v.x), b)[1];
          worst = Math.max(worst, v.y - outer);
        }
      }
    }
    expect(worst).toBeLessThan(0);
  });
});
