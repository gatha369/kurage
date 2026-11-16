import * as THREE from 'three';
import { spotGlsl, spotUniforms } from './shared';

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

/**
 * 第1章の確認用：クラゲの代わりの、仮の半透明の球。
 * 自分では光らず、スポットライトが当たった部分だけが明るく見える。
 */
export function createPlaceholder() {
  const geometry = new THREE.SphereGeometry(1, 96, 64);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#dce9ff'),
    roughness: 0.32,
    metalness: 0,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const extra = {
    uCaustics: { value: 0.35 },
    uRim: { value: 1.0 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, spotUniforms, extra);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         ${spotGlsl}
         ${causticsGlsl}
         uniform float uCaustics;
         uniform float uRim;
         varying vec3 vWPos;
         varying vec3 vWNormal;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `
        {
          float spot = spotFalloff(vWPos) * uLight;
          vec3 wn = normalize(vWNormal);
          vec3 toLight = normalize(uApex - vWPos);
          float facing = max(dot(wn, toLight), 0.0);
          // 縁（視線に対して斜めの部分）ほど白く光る。光が当たっている側だけ
          float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
          float lit = spot * (0.25 + 0.75 * smoothstep(-0.2, 0.6, dot(wn, toLight)));
          outgoingLight += vec3(0.85, 0.92, 1.0) * fres * lit * uRim * 0.9;
          diffuseColor.a = min(1.0, diffuseColor.a + fres * lit * 0.5);
          // 上面にうっすら映る光の網目模様
          vec3 ax = uAxis;
          vec3 tu = normalize(cross(ax, abs(ax.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 tv = cross(ax, tu);
          vec2 cuv = vec2(dot(vWPos, tu), dot(vWPos, tv)) * 2.2;
          float c = caustics(cuv, uTime);
          outgoingLight += vec3(0.8, 0.9, 1.0) * c * uCaustics * spot * facing * 0.6;
          diffuseColor.a = min(1.0, diffuseColor.a + c * uCaustics * spot * facing * 0.15);
        }
        #include <opaque_fragment>`,
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return { mesh, uniforms: extra };
}
