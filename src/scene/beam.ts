import * as THREE from 'three';
import { spotGlsl, spotUniforms } from './shared';

export const BEAM_LENGTH = 26;

/**
 * スポットライトの光の筋。円錐の中を視線に沿って少しずつ進みながら
 * 「スモークに当たった光」を足し合わせて描く（簡易ボリュームライト）。
 */
export function createBeam() {
  const geometry = new THREE.ConeGeometry(1, 1, 48, 1, false);
  // 頂点を原点、底面を -Y 方向 1 の位置に置き、あとで向きと大きさを合わせる
  geometry.translate(0, -0.5, 0);

  const uniforms = {
    ...spotUniforms,
    uStrength: { value: 0.06 },
    uLength: { value: BEAM_LENGTH },
    uColor: { value: new THREE.Color('#cfe0ff') },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${spotGlsl}
      uniform float uStrength;
      uniform float uLength;
      uniform vec3 uColor;
      varying vec3 vWorld;
      #define STEPS 22

      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        float tFar = length(vWorld - ro);

        // 円錐に入る位置を求める（カメラが円錐の中なら 0）
        vec3 co = ro - uApex;
        float dv = dot(rd, uAxis);
        float cv = dot(co, uAxis);
        float c2 = uCosAngle * uCosAngle;
        float a = dv * dv - c2;
        float b = 2.0 * (dv * cv - dot(rd, co) * c2);
        float c = cv * cv - dot(co, co) * c2;
        float tNear = 0.0;
        bool inside = c > 0.0 && cv > 0.0;
        if (!inside && abs(a) > 1e-5) {
          float disc = b * b - 4.0 * a * c;
          if (disc > 0.0) {
            float s = sqrt(disc);
            float t1 = (-b - s) / (2.0 * a);
            float t2 = (-b + s) / (2.0 * a);
            float tn = 1e9;
            if (t1 > 0.0 && dot(ro + rd * t1 - uApex, uAxis) > 0.0) tn = min(tn, t1);
            if (t2 > 0.0 && dot(ro + rd * t2 - uApex, uAxis) > 0.0) tn = min(tn, t2);
            if (tn < tFar) tNear = tn;
          }
        }

        float len = max(tFar - tNear, 0.0);
        float stepL = len / float(STEPS);
        float jitter = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0);
        float acc = 0.0;
        for (int i = 0; i < STEPS; i++) {
          float t = tNear + (float(i) + jitter) * stepL;
          vec3 p = ro + rd * t;
          float h = dot(p - uApex, uAxis);
          // 上は光源の近くでふわっと現れ、下は闇へ溶けていく
          float along = smoothstep(0.0, 2.5, h) * (1.0 - smoothstep(uLength * 0.35, uLength, h));
          // 円錐が広がるほど光は薄まる
          float spread = 1.0 / (1.0 + h * h * uTanAngle * uTanAngle * 0.08);
          // スモークのむら（ゆっくり流れる）
          float smoke = 0.85 + 0.15 * sin(p.x * 1.3 + uTime * 0.21) * sin(p.z * 1.1 - uTime * 0.17 + p.y * 0.4);
          acc += spotFalloff(p) * along * spread * smoke * exp(-uFogDensity * 0.6 * t);
        }
        acc *= stepL * uStrength * uLight;
        gl_FragColor = vec4(uColor * acc, 1.0);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  const up = new THREE.Vector3(0, -1, 0);
  /** 頂点・向き・広がりに合わせて円錐の形を更新する */
  function sync() {
    const r = BEAM_LENGTH * spotUniforms.uTanAngle.value;
    mesh.position.copy(spotUniforms.uApex.value);
    mesh.quaternion.setFromUnitVectors(up, spotUniforms.uAxis.value);
    // 端の計算誤差で切れないよう、形は少し太めにとる
    mesh.scale.set(r * 1.05, BEAM_LENGTH, r * 1.05);
  }

  return { mesh, uniforms, sync };
}
