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

/** コースティクス（光の網目模様）。ゆっくりうごめく（GLSL） */
export const causticsGlsl = /* glsl */ `
vec2 cHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// セル模様の「境目」ほど明るくなる
float cVoronoiEdge(vec2 x, float t) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = cHash(n + g);
    o = 0.5 + 0.45 * sin(t + 6.2831 * o);
    float d = length(g + o - f);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return f2 - f1;
}
float caustics(vec2 uv, float t) {
  float a = cVoronoiEdge(uv, t * 0.55);
  float b = cVoronoiEdge(uv * 1.7 + 3.1, -t * 0.4);
  float ca = 1.0 - smoothstep(0.0, 0.16, a);
  float cb = 1.0 - smoothstep(0.0, 0.2, b);
  return ca * 0.7 + ca * cb * 0.8 + cb * 0.15;
}
`;
