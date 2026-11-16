import * as THREE from 'three';
import { MAX_PARTICLES } from '../params';
import { spotGlsl, spotUniforms } from './shared';

/**
 * マリンスノー。スポットライトの中の粒だけがきらりと見える。
 * 沈む・揺れる動きと、ピントのぼけ（近い粒ほど大きくぼやける）はすべて画面側の計算で行う。
 */
export function createParticles(seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;

  const pos = new Float32Array(MAX_PARTICLES * 3);
  const rnd = new Float32Array(MAX_PARTICLES * 4);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pos[i * 3] = rand() - 0.5;
    pos[i * 3 + 1] = rand() - 0.5;
    pos[i * 3 + 2] = rand() - 0.5;
    for (let k = 0; k < 4; k++) rnd[i * 4 + k] = rand();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
  geometry.setDrawRange(0, 4000);

  const uniforms = {
    ...spotUniforms,
    uVolume: { value: new THREE.Vector3(18, 18, 18) },
    uCenter: { value: new THREE.Vector3() },
    uSink: { value: 0.04 },
    uSize: { value: 1 },
    uProj: { value: 800 }, // 画面の高さ(px) / (2·tan(視野角/2))
    uPixelRatio: { value: 1 },
    uFocusDist: { value: 6 },
    uDof: { value: 1 },
    uAmbient: { value: 0.015 },
    uSplit: { value: 0 }, // この距離より手前／奥だけを描く
    uSplitMode: { value: 0 }, // 0=すべて, 1=奥だけ, 2=手前だけ
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${spotGlsl}
      attribute vec4 aRand;
      uniform vec3 uVolume;
      uniform vec3 uCenter;
      uniform float uSink;
      uniform float uSize;
      uniform float uProj;
      uniform float uPixelRatio;
      uniform float uFocusDist;
      uniform float uDof;
      uniform float uAmbient;
      uniform float uSplit;
      uniform float uSplitMode;
      varying float vAlpha;
      varying float vBlur;

      void main() {
        vec3 p = position * uVolume;
        // ゆっくり沈み、下まで行ったら上へ戻る
        float sink = uTime * uSink * (0.5 + aRand.x);
        p.y = mod(p.y + uVolume.y * 0.5 - sink, uVolume.y) - uVolume.y * 0.5;
        // わずかに左右へ揺れる
        p.x += sin(uTime * (0.15 + 0.2 * aRand.y) + aRand.y * 6.283) * 0.12;
        p.z += cos(uTime * (0.12 + 0.2 * aRand.w) + aRand.w * 6.283) * 0.12;
        p += uCenter;

        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = max(-mv.z, 0.05);

        // 本来の大きさ（ごく小さい）
        float worldSize = 0.012 * uSize * (0.5 + aRand.z);
        float px = max(worldSize * uProj / dist, 0.9 * uPixelRatio);
        // ピントのずれによるぼけ
        float coc = uDof * 14.0 * uPixelRatio * abs(1.0 - uFocusDist / dist);
        coc = min(coc, 70.0 * uPixelRatio);
        float size = px + coc;
        gl_PointSize = size;
        vBlur = clamp(coc / (px + coc + 1e-3), 0.0, 1.0);

        // 光の中の粒だけが見える。ときどききらりと光る
        float light = spotFalloff(p) * uLight;
        float twinkle = 0.65 + 0.35 * sin(uTime * (0.8 + aRand.w * 1.6) + aRand.z * 40.0);
        float fog = exp(-uFogDensity * dist);
        // ぼけて広がった分だけ薄くなる（明るさの総量はほぼ保つ）
        float energy = pow(px / size, 1.6);
        vAlpha = (light * 1.6 * twinkle + uAmbient) * fog * energy;
        gl_Position = projectionMatrix * mv;
        bool skip = (uSplitMode > 0.5 && uSplitMode < 1.5 && dist < uSplit) || (uSplitMode > 1.5 && dist >= uSplit);
        if (vAlpha < 0.002 || skip) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // 見えない粒は描かない
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vBlur;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float sharp = exp(-d * d * 5.0);
        float bokeh = (1.0 - smoothstep(0.75, 1.0, d)) * (0.75 + 0.25 * d);
        float a = mix(sharp, bokeh, vBlur) * vAlpha;
        gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * a, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;

  return {
    points,
    uniforms,
    setCount(n: number) {
      geometry.setDrawRange(0, Math.max(0, Math.min(MAX_PARTICLES, Math.round(n))));
    },
  };
}
