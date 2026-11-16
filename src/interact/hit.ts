import * as THREE from 'three';
import { bellPos, type BellState } from '../jelly/shape';
import type { ChainSet } from '../jelly/chains';

// 追加章B：タップした場所に何があるか

export type Hit =
  | { kind: 'bell'; t: number; point: THREE.Vector3; u: number; theta: number; fromOutside: boolean }
  | { kind: 'tentacle' | 'arm'; t: number; point: THREE.Vector3; chain: number; index: number }
  | null;

const NT = 48, NU = 14;

/** 今の傘の形（ゆがみ・拍動込み）の、当たり判定用の粗い面を作る（傘の座標） */
export function bellHitMesh(bell: BellState): THREE.Mesh {
  const pos: number[] = [];
  const sides: number[] = [];
  for (const side of [0, 1]) {
    for (let i = 0; i <= NU; i++) {
      for (let j = 0; j <= NT; j++) {
        const p = bellPos(i / NU, side, (j / NT) * Math.PI * 2, bell);
        pos.push(...p);
        sides.push(side);
      }
    }
  }
  const index: number[] = [];
  for (let s = 0; s < 2; s++) {
    const o = s * (NU + 1) * (NT + 1);
    for (let i = 0; i < NU; i++) for (let j = 0; j < NT; j++) {
      const a = o + i * (NT + 1) + j, b = a + NT + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
    // 縁で外側と内側をつなぐ
  }
  const oRim = NU * (NT + 1), iRim = (NU + 1) * (NT + 1) + NU * (NT + 1);
  for (let j = 0; j < NT; j++) index.push(oRim + j, iRim + j, oRim + j + 1, oRim + j + 1, iRim + j, iRim + j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('side', new THREE.Float32BufferAttribute(sides, 1));
  g.setIndex(index);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

/** 傘の上の点（傘の座標）から、u（中心0〜縁1）を求める */
export function findU(local: THREE.Vector3, side: number, bell: BellState): number {
  const theta = Math.atan2(local.z, local.x);
  const r = Math.hypot(local.x, local.z);
  let lo = 0, hi = 1;
  for (let k = 0; k < 20; k++) {
    const mid = (lo + hi) / 2;
    const p = bellPos(mid, side, theta, bell);
    if (Math.hypot(p[0], p[2]) < r) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function hitBell(ray: THREE.Ray, matrix: THREE.Matrix4, bell: BellState): Hit {
  const inv = matrix.clone().invert();
  const local = ray.clone().applyMatrix4(inv);
  const mesh = bellHitMesh(bell);
  const rc = new THREE.Raycaster(local.origin, local.direction.clone().normalize());
  const hits = rc.intersectObject(mesh);
  mesh.geometry.dispose();
  if (!hits.length) return null;
  const h = hits[0];
  const sideAttr = mesh.geometry.getAttribute('side');
  const side = h.face ? sideAttr.getX(h.face.a) : 0;
  const u = findU(h.point, side, bell);
  const theta = Math.atan2(h.point.z, h.point.x);
  const world = h.point.clone().applyMatrix4(matrix);
  return { kind: 'bell', t: world.distanceTo(ray.origin), point: world, u, theta, fromOutside: side < 0.5 };
}

/**
 * 触手・口腕：細いので、見た目より広めの範囲で当たりとする。
 * minRadius：最低限の当たりの太さ（世界の長さ）、pxRadius：画面上の当たりの太さ（ピクセル）、proj：1離れた所の1単位が何ピクセルか
 */
export function hitChains(ray: THREE.Ray, set: ChainSet, count: number, minRadius: number, pxRadius: number, proj: number) {
  const P = set.pointsPerChain;
  const o = ray.origin, d = ray.direction;
  let best: { t: number; chain: number; index: number; point: THREE.Vector3 } | null = null;
  const v = new THREE.Vector3();
  for (let c = 0; c < count; c++) {
    for (let j = 1; j < P; j++) {
      const i = (c * P + j) * 3;
      v.set(set.pos[i] - o.x, set.pos[i + 1] - o.y, set.pos[i + 2] - o.z);
      const t = v.dot(d);
      if (t <= 0) continue;
      const dist = Math.sqrt(Math.max(0, v.lengthSq() - t * t));
      const radius = Math.max(minRadius, (pxRadius * t) / proj);
      if (dist < radius && (!best || t < best.t)) {
        best = { t, chain: c, index: j, point: new THREE.Vector3(set.pos[i], set.pos[i + 1], set.pos[i + 2]) };
      }
    }
  }
  return best;
}
