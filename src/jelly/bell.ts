import * as THREE from 'three';
import { causticsGlsl, spotGlsl, spotUniforms } from '../scene/shared';

/** 傘の形と拍動による変形（頂点の計算）。中心が厚く縁で薄い、ゼリー状の殻 */
const bellShapeGlsl = /* glsl */ `
#define BPI 3.14159265
uniform float uR;        // 傘の半径
uniform float uD;        // 傘の深さ
uniform float uThick;    // 中心の厚み
uniform float uIrr;      // いびつさ
uniform float uNotch;    // 切れ込みの深さ
uniform vec4 uPhase;     // いびつさの位相 xyz、切れ込みの向き w
uniform float uBeatT;    // 今の拍動が始まってからの時間
uniform float uTc;       // 縮む時間
uniform float uTr;       // 開く時間
uniform float uLag;      // 中心→縁へ伝わる遅れ
uniform float uStrength; // 縮む強さ
// 追加章A：ゆがみ
uniform vec4 uDef[6];    // k=1..6 の [半径cos, 半径sin, 高さcos, 高さsin]
uniform float uFlat;     // ② つぶれ
uniform float uDefHard;  // 縁と中心の差
uniform vec3 uPK;        // ① ばらつきの波の数
uniform vec3 uPA;        // ① 縮む強さのばらつき
uniform vec3 uPD;        // ① 縮むタイミングのずれ
uniform vec3 uPP;        // ① 位相
// 追加章B：触れたときの反応
uniform float uTwitchT;  // ビクッと縮んでからの時間
uniform float uTwitchAmp;
uniform vec4 uDent[4];   // へこみ [中心u, 中心θ, 深さ, 広がり]
uniform vec2 uRipple[4]; // 波紋 [経過時間, 強さ]

const float PHI_M = 1.05;

float contractionT(float t, float tc, float tr) {
  if (t <= 0.0 || t >= tc + tr) return 0.0;
  if (t < tc) { float s = t / tc; return s * s * (3.0 - 2.0 * s); }
  float s = (t - tc) / tr;
  float a = 1.0 - s;
  return a * a * a * (1.0 + 3.0 * s);
}
float contraction(float t) { return contractionT(t, uTc, uTr); }

float radiusFactor(float th, float u) {
  float irr = 1.0 + uIrr * (0.5 * sin(th + uPhase.x) + 0.3 * sin(2.0 * th + uPhase.y) + 0.2 * sin(3.0 * th + uPhase.z));
  float a = mod(th - uPhase.w, BPI / 4.0);
  float d = min(a, BPI / 4.0 - a); // 一番近い切れ込みまでの角度
  float notch = exp(-(d * d) / (0.045 * 0.045)) * smoothstep(0.8, 1.0, u) * smoothstep(0.8, 1.0, u);
  // 切れ込みの間は、ごくわずかにふくらむ
  float lobe = 0.008 * smoothstep(0.7, 1.0, u) * sin(d / (BPI / 8.0) * BPI * 0.5);
  return irr * (1.0 - uNotch * notch + lobe);
}

float thicknessAt(float u) {
  return uThick * (0.12 + 0.88 * (1.0 - pow(u, 1.25)));
}

// u：中心(0)〜縁(1)、side：外側の面(0)〜内側の面(1)、th：角度
vec2 pulseVariation(float th) {
  float a = 0.0, dl = 0.0;
  for (int j = 0; j < 3; j++) {
    float w = cos(uPK[j] * th + uPP[j]);
    a += uPA[j] * w;
    dl += uPD[j] * (w * 0.5 + 0.5);
  }
  return vec2(max(-0.9, a), dl);
}

vec3 bellPos(float u, float side, float th) {
  vec2 pv = pulseVariation(th);
  float c1 = contraction(uBeatT - u * uLag - u * pv.y);
  float c2 = uTwitchAmp * contractionT(uTwitchT - u * uLag, 0.12, 0.7);
  float c = (c1 + c2 - c1 * c2) * uStrength * (1.0 + u * pv.x);
  float phi = u * PHI_M;
  float sp = sin(phi), cp = cos(phi);
  float sM = sin(PHI_M), cM = cos(PHI_M);
  float R = uR * radiusFactor(th, u);
  // 外側の面の断面（r, y）と、その接線・法線
  vec2 o = vec2(sp / sM * R, (cp - cM) / (1.0 - cM) * uD);
  vec2 tng = normalize(vec2(cp / sM * R, -sp / (1.0 - cM) * uD));
  vec2 nrm = vec2(-tng.y, tng.x);
  float t = thicknessAt(u);
  vec2 inner = o - nrm * t;
  vec2 q = mix(o, inner, side);
  // 縁は丸くつなぐ
  q += tng * sin(side * BPI) * t * 0.5 * step(0.999, u);
  // 拍動：縁ほど大きく内側へすぼまり、傘全体が少し縦長になる
  q.x *= 1.0 - 0.3 * c * pow(u, 1.5);
  q.y += -c * uD * 0.65 * pow(u, 2.0) + c * uD * 0.12 * (1.0 - u);
  // 追加章A：ゆがみ（縁ほど大きく、中心ほど小さい）
  float w = pow(u, uDefHard);
  float dr = 0.0, dy = 0.0;
  for (int k = 0; k < 6; k++) {
    float fk = float(k + 1);
    float ck = cos(fk * th), sk = sin(fk * th);
    dr += uDef[k].x * ck + uDef[k].y * sk;
    dy += uDef[k].z * ck + uDef[k].w * sk;
  }
  q.x += w * dr * uR;
  q.y += w * dy * uR;
  // ② てっぺんが平たくつぶれ、縁は後ろへめくれる
  q.y -= uFlat * uD * (0.1 * (1.0 - u * u) + 0.22 * u * u);
  q.x += uFlat * uR * 0.04 * u * u;
  // 追加章B：触れた場所のへこみと、周りに広がる波紋（殻ごと押す。厚みは保つ）
  float push = 0.0;
  vec2 pp = vec2(u * cos(th), u * sin(th));
  for (int i = 0; i < 4; i++) {
    float amp = uDent[i].z;
    float ra = uRipple[i].y;
    vec2 c0 = uDent[i].x * vec2(cos(uDent[i].y), sin(uDent[i].y));
    float dist = length(pp - c0);
    float rad = max(uDent[i].w, 1e-3);
    push += amp * exp(-(dist * dist) / (rad * rad));
    float front = dist - uRipple[i].x * 0.9;
    push += ra * sin(front * 35.0) * exp(-(front / 0.12) * (front / 0.12));
  }
  q -= nrm * push * uR;
  q.y -= uD * 0.45;
  return vec3(q.x * cos(th), q.y, q.x * sin(th));
}
`;

/** 傘の面の網目：外側の面 → 縁の丸み → 内側の面 */
function createBellGeometry(nu = 44, nr = 8, nt = 224) {
  const params: number[] = [];
  const pushRow = (u: number, side: number) => {
    for (let j = 0; j <= nt; j++) params.push(u, side, (j / nt) * Math.PI * 2);
  };
  for (let i = 0; i <= nu; i++) pushRow(Math.pow(i / nu, 0.85), 0);
  for (let i = 1; i < nr; i++) pushRow(1, i / nr);
  for (let i = nu; i >= 0; i--) pushRow(Math.pow(i / nu, 0.85), 1);
  const rows = params.length / 3 / (nt + 1);
  const index: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < nt; j++) {
      const a = i * (nt + 1) + j;
      const b = a + nt + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(params);
  g.setAttribute('aParam', new THREE.BufferAttribute(arr, 3));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr.length), 3));
  g.setIndex(index);
  return g;
}

export function createBell() {
  const geometry = createBellGeometry();
  const uniforms = {
    ...spotUniforms,
    uR: { value: 1 },
    uD: { value: 0.5 },
    uThick: { value: 0.2 },
    uIrr: { value: 0.05 },
    uNotch: { value: 0.035 },
    uPhase: { value: new THREE.Vector4() },
    uBeatT: { value: 0 },
    uTc: { value: 0.4 },
    uTr: { value: 1.2 },
    uLag: { value: 0.12 },
    uStrength: { value: 1 },
    uDef: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
    uFlat: { value: 0 },
    uDefHard: { value: 2.5 },
    uPK: { value: new THREE.Vector3(2, 3, 4) },
    uPA: { value: new THREE.Vector3() },
    uPD: { value: new THREE.Vector3() },
    uPP: { value: new THREE.Vector3() },
    uTwitchT: { value: 1e3 },
    uTwitchAmp: { value: 0 },
    uDent: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uRipple: { value: Array.from({ length: 4 }, () => new THREE.Vector2()) },
    // 質感
    uBg: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSpotIntensity: { value: 1 },
    uAmbient: { value: new THREE.Color(0x2a4c80).multiplyScalar(0.12) },
    uTransparency: { value: 0.8 },
    uRimWhite: { value: 1 },
    uRefract: { value: 1 },
    uBlue: { value: 0.4 },
    uMilk: { value: 0.35 },
    uGonadColor: { value: new THREE.Color('#e0d7d9') },
    uGonad: { value: 0.8 },
    uCanal: { value: 0.5 },
    uCaustics: { value: 0.35 },
    uCamLocal: { value: new THREE.Vector3() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${bellShapeGlsl}
      attribute vec3 aParam;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vLocal;
      varying float vU;
      varying float vSide;
      varying float vTh;
      varying float vRestR;
      varying float vThick;

      void main() {
        float u = aParam.x, side = aParam.y, th = aParam.z;
        vec3 p = bellPos(u, side, th);
        // 法線：少しずらした点との差から求める
        float uu = max(u, 0.004);
        vec3 pc = bellPos(uu, side, th);
        vec3 dTh = bellPos(uu, side, th + 0.004) - pc;
        vec3 dS;
        bool band = side > 0.001 && side < 0.999;
        if (band) dS = bellPos(uu, side + 0.02, th) - pc;
        else if (uu > 0.99) dS = pc - bellPos(uu - 0.004, side, th);
        else dS = bellPos(uu + 0.004, side, th) - pc;
        vec3 n = normalize(cross(dTh, dS));
        if (side > 0.999) n = -n;

        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * n);
        vLocal = p;
        vU = u;
        vSide = side;
        vTh = th;
        float phi = u * PHI_M;
        vRestR = sin(phi) / sin(PHI_M) * radiusFactor(th, u);
        vThick = thicknessAt(u);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${spotGlsl}
      ${causticsGlsl}
      #define BPI 3.14159265
      uniform sampler2D uBg;
      uniform vec2 uResolution;
      uniform float uR;
      uniform vec4 uPhase;
      uniform float uSpotIntensity;
      uniform vec3 uAmbient;
      uniform float uTransparency;
      uniform float uRimWhite;
      uniform float uRefract;
      uniform float uBlue;
      uniform float uMilk;
      uniform vec3 uGonadColor;
      uniform float uGonad;
      uniform float uCanal;
      uniform float uCaustics;
      uniform vec3 uCamLocal;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vLocal;
      varying float vU;
      varying float vSide;
      varying float vTh;
      varying float vRestR;
      varying float vThick;

      // 四つ葉模様：中心のまわりに、中心側が開いたU字（馬蹄形）が4つ
      float gonadMask(vec2 q) {
        float m = 0.0;
        for (int k = 0; k < 4; k++) {
          float a = BPI * 0.25 + float(k) * BPI * 0.5 + uPhase.w;
          vec2 dir = vec2(cos(a), sin(a));
          vec2 d = q - dir * 0.25;
          float r = length(d);
          float wob = 0.0025 * sin(atan(d.y, d.x) * 7.0 + float(k) * 2.0); // ふちのひだ
          float ring = 1.0 - smoothstep(0.022, 0.042, abs(r - 0.1 + wob));
          float open = dot(d / max(r, 1e-4), -dir);
          ring *= 1.0 - smoothstep(0.0, 0.45, open); // 中心側が開いたU字
          float fill = (1.0 - smoothstep(0.05, 0.095, r)) * 0.12 * (1.0 - smoothstep(-0.2, 0.6, open)); // 内側のうっすらした部分
          m = max(m, max(ring, fill));
        }
        return m;
      }

      // 放射管：中心から縁へ伸びる細い管。8本は先で枝分かれする
      float canalMask(float r, float th) {
        float seg = BPI / 8.0;
        float a = mod(th - uPhase.w, 2.0 * BPI);
        float idx = floor(a / seg + 0.5);
        float d = abs(a - idx * seg);
        float w = 0.003 / max(r, 0.05);
        float m = 1.0 - smoothstep(w * 0.5, w * 1.6, d);
        if (mod(idx, 2.0) < 0.5) {
          float s1 = max(r - 0.55, 0.0) * 0.22 / max(r, 0.1);
          float d2 = abs(d - s1);
          m = max(m, (1.0 - smoothstep(w * 0.4, w * 1.3, d2)) * step(0.55, r));
          float s2 = s1 + max(r - 0.78, 0.0) * 0.4 / max(r, 0.1);
          float d3 = abs(d - s2);
          m = max(m, (1.0 - smoothstep(w * 0.4, w * 1.2, d3)) * step(0.78, r));
        }
        m *= smoothstep(0.32, 0.45, r);
        m = max(m, 1.0 - smoothstep(0.004, 0.012, abs(r - 0.955))); // 縁に沿った管
        return m;
      }

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fres = pow(1.0 - ndv, 3.0);

        // スポットライト（クラゲ自身は光らない。明るさはすべてこの光から）
        vec3 L = normalize(uApex - vWorld);
        float spot = spotFalloff(vWorld) * uLight * uSpotIntensity;
        float ndl = dot(N, L);
        float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
        float back = pow(clamp(dot(L, -V), 0.0, 1.0), 4.0); // 逆光で縁が透けて光る
        float lit = spot * wrap;

        // 視線方向に見たゼリーの厚み
        float thick = vThick / max(ndv, 0.2);

        // 屈折：厚みと面の向きで、背景が少し歪んで見える
        vec2 suv = gl_FragCoord.xy / uResolution;
        vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
        vec2 off = Nv.xy * uRefract * (0.012 + thick * 0.06);
        vec3 bg = texture2D(uBg, suv - off).rgb;
        vec3 bgStraight = texture2D(uBg, suv).rgb;

        // 乳白感と青み
        vec3 tint = mix(vec3(1.0), vec3(0.78, 0.9, 1.0), uBlue);
        vec3 bodyCol = mix(vec3(0.92, 0.95, 1.0), vec3(0.7, 0.84, 1.0), uBlue);
        float cover = (1.0 - uTransparency) * 0.4 + uMilk * (1.0 - exp(-thick * 4.0)) * 0.35;
        cover += fres * 0.45 * uRimWhite;
        cover = clamp(cover, 0.0, 0.92);
        vec3 scatter = bodyCol * (lit * 0.55 + uAmbient * 2.0);
        vec3 col = bg * tint * (1.0 - cover) + scatter * cover;

        // 縁（視線に対して斜めの部分）ほど白く光る
        col += vec3(0.88, 0.94, 1.0) * fres * uRimWhite * spot * (0.35 + 0.65 * wrap + 1.2 * back);

        // 表面のつや
        vec3 H = normalize(L + V);
        float nh = max(dot(N, H), 0.0);
        col += vec3(1.0) * spot * (pow(nh, 220.0) * 0.6 + pow(nh, 30.0) * 0.03) * step(0.0, ndl);

        // 上面にうっすら映るコースティクス
        if (vSide < 0.5) {
          vec3 ax = uAxis;
          vec3 tu = normalize(cross(ax, abs(ax.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 tv = cross(ax, tu);
          float c = caustics(vec2(dot(vWorld, tu), dot(vWorld, tv)) * 2.4, uTime);
          col += vec3(0.8, 0.9, 1.0) * c * uCaustics * spot * max(ndl, 0.0) * 0.35;
        }

        // 傘の中に浮かぶ四つ葉模様（表面より少し内側に見えるよう、視線の傾きでずらす）
        vec3 vd = normalize(vLocal - uCamLocal);
        float depth = vThick * 0.55;
        vec2 par = vd.xz * depth / max(abs(vd.y), 0.35) / uR;
        vec2 q = vRestR * vec2(cos(vTh), sin(vTh)) + par;
        float g = gonadMask(q) * uGonad;
        vec3 gCol = uGonadColor * (spot * (0.55 + 0.45 * wrap) + uAmbient * 2.5);
        col = mix(col, gCol * 0.8 + col * 0.45, g * 0.7);

        // 放射管（近づくとうっすら見える程度）
        float cm = canalMask(vRestR, vTh) * uCanal;
        col += bodyCol * cm * (lit * 0.22 + uAmbient.b * 0.4);

        // 遠いほど霞みに溶ける
        float f = exp(-uFogDensity * length(vWorld - cameraPosition));
        col = mix(bgStraight, col, f);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    // 傘が描かれた所に印を付ける（傘の手前に来た触手・口腕だけを重ね描きするため）
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
