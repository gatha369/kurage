import * as THREE from 'three';
import { spotGlsl, spotUniforms } from '../scene/shared';
import type { ChainSet } from './chains';

/** 透け感用の描画で、傘の手前に来た部分だけを重ね描きするための設定 */
export function setFrontPass(mat: THREE.Material, front: boolean) {
  mat.stencilWrite = front;
  mat.stencilFunc = THREE.EqualStencilFunc;
  mat.stencilRef = 1;
  mat.stencilZPass = THREE.KeepStencilOp;
}

/**
 * 縁の触手：髪の毛のように細い線。画面上で1ピクセルより細くなる場合は、
 * 太さの代わりに薄さで表す（ちらつき防止）。光が当たると白く光る
 */
export function createTentacleMesh(set: ChainSet) {
  const P = set.pointsPerChain;
  const nChains = set.specs.length;
  const nVert = nChains * P * 2;
  const position = new Float32Array(nVert * 3);
  const next = new Float32Array(nVert * 3);
  const side = new Float32Array(nVert);
  const info = new Float32Array(nVert * 2); // x：付け根0〜先端1, y：太さの個体差
  const index: number[] = [];
  for (let c = 0; c < nChains; c++) {
    for (let j = 0; j < P; j++) {
      const v = (c * P + j) * 2;
      side[v] = -1;
      side[v + 1] = 1;
      info[v * 2] = info[v * 2 + 2] = j / (P - 1);
      info[v * 2 + 1] = info[v * 2 + 3] = 0.7 + 0.6 * set.specs[c].rand;
      if (j < P - 1) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
  const nextAttr = new THREE.BufferAttribute(next, 3).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', posAttr);
  g.setAttribute('aNext', nextAttr);
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 2));
  g.setIndex(index);
  const indicesPerChain = (P - 1) * 6;

  const uniforms = {
    ...spotUniforms,
    uWidth: { value: 0.006 },
    uVariation: { value: 0.5 },
    uProj: { value: 800 },
    uPixelRatio: { value: 1 },
    uSpotIntensity: { value: 1 },
    uAmbient: { value: new THREE.Color() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${spotGlsl}
      attribute vec3 aNext;
      attribute float aSide;
      attribute vec2 aInfo;
      uniform float uWidth;
      uniform float uVariation;
      uniform float uProj;
      uniform float uPixelRatio;
      uniform float uSpotIntensity;
      uniform vec3 uAmbient;
      varying float vAlpha;
      varying float vSide;
      varying vec3 vCol;
      void main() {
        vec4 a = viewMatrix * vec4(position, 1.0);
        vec4 b = viewMatrix * vec4(aNext, 1.0);
        vec3 t = b.xyz - a.xyz;
        t = length(t) > 1e-6 ? normalize(t) : vec3(0.0, -1.0, 0.0);
        vec3 s = normalize(cross(t, normalize(a.xyz)));
        float dist = max(-a.z, 0.05);
        float thick = mix(1.0, aInfo.y, uVariation);
        float w = uWidth * thick * (1.0 - 0.75 * aInfo.x);
        float px = w * uProj / dist;
        float pxc = max(px, 1.2 * uPixelRatio);
        a.xyz += s * aSide * 0.5 * pxc * dist / uProj;
        vSide = aSide;
        // 光：細い糸は、光と直角に近いほど明るく散らす
        vec3 tw = normalize(aNext - position + vec3(0.0, -1e-5, 0.0));
        vec3 L = normalize(uApex - position);
        float tl = dot(tw, L);
        float scatter = sqrt(max(1.0 - tl * tl, 0.0));
        float spot = spotFalloff(position) * uLight * uSpotIntensity;
        float fog = exp(-uFogDensity * dist);
        vCol = vec3(0.86, 0.92, 1.0) * (spot * (0.35 + 0.65 * scatter) * 0.9) + uAmbient * 1.5;
        vAlpha = min(1.0, px / pxc) * fog * (1.0 - smoothstep(0.75, 1.0, aInfo.x) * 0.8);
        gl_Position = projectionMatrix * a;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vSide;
      varying vec3 vCol;
      void main() {
        float a = 1.0 - vSide * vSide;
        gl_FragColor = vec4(vCol * a * vAlpha, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  return {
    mesh,
    uniforms,
    setCount(n: number) {
      g.setDrawRange(0, Math.max(0, Math.min(nChains, Math.round(n))) * indicesPerChain);
    },
    /** 物理計算の結果を描画用に写す */
    sync(count: number) {
      const src = set.pos;
      for (let c = 0; c < count; c++) {
        for (let j = 0; j < P; j++) {
          const i = (c * P + j) * 3;
          const nj = j < P - 1 ? i + 3 : i;
          const pj = j < P - 1 ? i : i - 3;
          const v = (c * P + j) * 2 * 3;
          for (let k = 0; k < 3; k++) {
            position[v + k] = position[v + 3 + k] = src[i + k];
            // 先端は、ひとつ手前からの向きを延長
            const nv = j < P - 1 ? src[nj + k] : src[i + k] * 2 - src[pj + k];
            next[v + k] = next[v + 3 + k] = nv;
          }
        }
      }
      posAttr.clearUpdateRanges();
      posAttr.addUpdateRange(0, count * P * 6);
      posAttr.needsUpdate = true;
      nextAttr.clearUpdateRanges();
      nextAttr.addUpdateRange(0, count * P * 6);
      nextAttr.needsUpdate = true;
    },
  };
}

/**
 * 口腕：縁がフリルのように波打った、薄く平たいリボン。断面は浅いV字に折れている。
 * 傘より少し濃い乳白色で半透明
 */
export function createArmMesh(set: ChainSet) {
  const P = set.pointsPerChain;
  const nChains = set.specs.length;
  const W = 9; // 幅方向の頂点数
  const nVert = nChains * P * W;
  const position = new Float32Array(nVert * 3);
  const across = new Float32Array(nVert * 2); // x：幅方向 -1〜1, y：付け根0〜先端1
  const index: number[] = [];
  for (let c = 0; c < nChains; c++) {
    for (let j = 0; j < P; j++) {
      for (let w = 0; w < W; w++) {
        const v = (c * P + j) * W + w;
        across[v * 2] = (w / (W - 1)) * 2 - 1;
        across[v * 2 + 1] = j / (P - 1);
        if (j < P - 1 && w < W - 1) {
          const n = v + W;
          index.push(v, n, v + 1, v + 1, n, n + 1);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', posAttr);
  g.setAttribute('aAcross', new THREE.BufferAttribute(across, 2));
  g.setIndex(index);

  const uniforms = {
    ...spotUniforms,
    uSpotIntensity: { value: 1 },
    uAmbient: { value: new THREE.Color() },
    uMilk: { value: 0.5 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aAcross;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vAcross;
      void main() {
        vAcross = aAcross;
        vWorld = position;
        vNormal = normal;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${spotGlsl}
      uniform float uSpotIntensity;
      uniform vec3 uAmbient;
      uniform float uMilk;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vAcross;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fres = pow(1.0 - ndv, 2.0);
        vec3 L = normalize(uApex - vWorld);
        float spot = spotFalloff(vWorld) * uLight * uSpotIntensity;
        float wrap = clamp((dot(N, L) + 0.6) / 1.6, 0.0, 1.0);
        float back = pow(clamp(dot(L, -V), 0.0, 1.0), 3.0);
        // フリルの縁ほど白く、薄い所は透ける
        float edge = smoothstep(0.55, 1.0, abs(vAcross.x));
        vec3 milk = vec3(0.93, 0.95, 1.0);
        vec3 col = milk * (spot * (0.45 * wrap + 0.5 * back) + uAmbient * 2.0);
        col += milk * spot * fres * 0.5;
        float alpha = uMilk * (0.35 + 0.35 * fres + 0.3 * edge);
        alpha *= 1.0 - smoothstep(0.85, 1.0, vAcross.y); // 先端はふわっと消える
        alpha *= smoothstep(0.0, 0.06, vAcross.y);
        float fog = exp(-uFogDensity * length(vWorld - cameraPosition));
        gl_FragColor = vec4(col * fog, alpha * fog);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const T = new THREE.Vector3();
  const B = new THREE.Vector3();
  const N = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const p = new THREE.Vector3();

  return {
    mesh,
    uniforms,
    /** 物理計算の結果から、リボンの形を作る */
    sync(quat: THREE.Quaternion, R: number, width: number, frill: number, time: number) {
      const src = set.pos;
      for (let c = 0; c < nChains; c++) {
        const th = set.specs[c].theta;
        radial.set(Math.cos(th), 0, Math.sin(th)).applyQuaternion(quat);
        for (let j = 0; j < P; j++) {
          const i = (c * P + j) * 3;
          const a = j < P - 1 ? i : i - 3;
          T.set(src[a + 3] - src[a], src[a + 4] - src[a + 1], src[a + 5] - src[a + 2]).normalize();
          // 幅の向き：傘の外向きを、リボンの流れに直角にする。ゆっくりねじれる
          B.copy(radial).addScaledVector(T, -radial.dot(T)).normalize();
          const twist = 0.5 * Math.sin(j * 0.25 + time * 0.3 + c * 1.7) * (j / P);
          N.crossVectors(T, B).normalize();
          B.multiplyScalar(Math.cos(twist)).addScaledVector(N, Math.sin(twist)).normalize();
          N.crossVectors(T, B).normalize();
          const s = j / (P - 1);
          // 付け根は細く、中ほどが一番広く、先へ細くなる
          const w = width * R * (0.35 + 0.65 * Math.sin(Math.min(1, s * 1.4) * Math.PI * 0.5)) * (1 - 0.55 * s);
          for (let k = 0; k < W; k++) {
            const x = (k / (W - 1)) * 2 - 1;
            const e = x * x;
            // V字の折れ ＋ 縁のフリル（ゆっくり波打つ）
            const fold = Math.abs(x) * w * 0.35;
            const fr = frill * w * 0.45 * e * Math.sin(s * 34 + x * 2 + time * 0.8 + c) * Math.min(1, s * 5);
            p.set(src[i], src[i + 1], src[i + 2])
              .addScaledVector(B, x * w)
              .addScaledVector(N, fold + fr);
            const v = ((c * P + j) * W + k) * 3;
            position[v] = p.x;
            position[v + 1] = p.y;
            position[v + 2] = p.z;
          }
        }
      }
      posAttr.needsUpdate = true;
      g.computeVertexNormals();
    },
  };
}
