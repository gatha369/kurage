import * as THREE from 'three';

/** スポットライトの状態。光の筋・微粒子・クラゲの質感が同じ値を共有する */
export const spotUniforms = {
  uApex: { value: new THREE.Vector3(0, 12, 0) },
  uAxis: { value: new THREE.Vector3(0, -1, 0) },
  uTanAngle: { value: Math.tan(0.26) },
  uCosAngle: { value: Math.cos(0.26) },
  uLight: { value: 1 }, // 明るさ×ゆらぎ
  uFogDensity: { value: 0.07 },
  uTime: { value: 0 },
};

/** スポットライトの円錐の中で、中心ほど明るく外側へなめらかに暗くなる割合（GLSL） */
export const spotGlsl = /* glsl */ `
uniform vec3 uApex;
uniform vec3 uAxis;
uniform float uTanAngle;
uniform float uCosAngle;
uniform float uLight;
uniform float uFogDensity;
uniform float uTime;

float spotFalloff(vec3 p) {
  vec3 d = p - uApex;
  float h = dot(d, uAxis);
  if (h <= 0.0) return 0.0;
  float r = length(d - uAxis * h);
  float q = r / max(h * uTanAngle, 1e-3);
  return exp(-q * q * 2.6) * (1.0 - smoothstep(0.75, 1.0, q));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;
