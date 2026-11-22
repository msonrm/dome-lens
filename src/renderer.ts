import { geometry, N_GLASS, NA, NP, type OpticsParams, type Vec3 } from "./optics";

const VS = `#version 300 es
precision highp float;
precision highp int;
// 屈折計算を頂点シェーダで行う（optics.ts の buildMesh と同じ計算）。
// 頂点バッファは使わず、gl_VertexID から格子上の三角形と頂点を決める。
// 三角形の3頂点すべてを各頂点で計算し、使えない三角形はつぶして描かない。
uniform vec2 uCenter; uniform float uPxPerMm; uniform vec2 uSize;
uniform float uR, uCz, uZb, uA, uAmax, uN, uN2, uGap, uGlass;
uniform vec3 uEye; uniform bool uCorr;
uniform int uNA, uNP;
out vec3 vDir;
out vec3 vS;   // ドーム表面上の点（mm）
out vec3 vT;   // ドーム内部を進む光線の向き（目からの光線を屈折させたもの）
const float PI = 3.14159265358979;
const float NG = ${N_GLASS.toFixed(3)};
vec3 dirAt(ivec2 g){
  float al = uAmax * float(g.x) / float(uNA);
  float ph = 2.0 * PI * float(g.y) / float(uNP);
  return vec3(sin(al) * cos(ph), sin(al) * sin(ph), cos(al));
}
bool land(vec3 u, out vec2 P, out vec3 S, out vec3 Tout){
  S = vec3(uR * u.xy, uCz + uR * u.z);
  P = S.xy;
  Tout = vec3(0.0, 0.0, -1.0);
  if (!uCorr) return true;
  vec3 I = normalize(S - uEye);
  float cosi = -dot(I, u);
  if (cosi <= 0.0) return false;
  float eta = 1.0 / uN;
  float k1 = 1.0 - eta * eta * (1.0 - cosi * cosi);
  if (k1 < 0.0) return false;
  vec3 T = eta * I + (eta * cosi - sqrt(k1)) * u;
  if (T.z >= -1e-6) return false;
  Tout = T;
  vec2 B = S.xy + (uZb - S.z) / T.z * T.xy;
  if (dot(B, B) > uA * uA * 1.000001) return false;
  float sh = length(T.xy);
  float inv = uN * sh;
  float sF = inv / uN2, sG = inv / NG;
  if (sF >= 1.0 || sG >= 1.0) return false;
  P = B;
  if (sh > 1e-6) P += T.xy / sh * (uGap * sF / sqrt(1.0 - sF * sF) + uGlass * sG / sqrt(1.0 - sG * sG));
  return true;
}
float d2(vec2 v){ return dot(v, v); }
float d2(vec3 v){ return dot(v, v); }
void main(){
  int tri = gl_VertexID / 3, c = gl_VertexID - tri * 3;
  int quad = tri / 2, hf = tri - quad * 2;
  int i = quad / uNP, j = quad - i * uNP;
  ivec2 g0, g1, g2;
  if (hf == 0) { g0 = ivec2(i, j);     g1 = ivec2(i + 1, j); g2 = ivec2(i, j + 1); }
  else         { g0 = ivec2(i, j + 1); g1 = ivec2(i + 1, j); g2 = ivec2(i + 1, j + 1); }
  vec3 u0 = dirAt(g0), u1 = dirAt(g1), u2 = dirAt(g2);
  vec2 P0, P1, P2; vec3 S0, S1, S2, T0, T1, T2;
  bool ok0 = land(u0, P0, S0, T0), ok1 = land(u1, P1, S1, T1), ok2 = land(u2, P2, S2, T2);
  bool ok = ok0 && ok1 && ok2;
  if (ok) {
    float ar = (P1.x - P0.x) * (P2.y - P0.y) - (P2.x - P0.x) * (P1.y - P0.y);
    if (ar < 0.0) ok = false;           // 折り返し（同じ画素が2か所から見える）
    else if (ar > 0.0) {                // 全反射寸前で極端に伸びた三角形
      float se = max(max(d2(S0 - S1), d2(S1 - S2)), d2(S2 - S0));
      float pe = max(max(d2(P0 - P1), d2(P1 - P2)), d2(P2 - P0));
      if (pe > 64.0 * se + 0.04) ok = false;
    }
  }
  if (!ok) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vDir = vec3(0.0, 0.0, 1.0); vS = vec3(0.0); vT = vec3(0.0, 0.0, -1.0); return; }
  vec2 P = c == 0 ? P0 : (c == 1 ? P1 : P2);
  vDir = c == 0 ? u0 : (c == 1 ? u1 : u2);
  vS = c == 0 ? S0 : (c == 1 ? S1 : S2);
  vT = c == 0 ? T0 : (c == 1 ? T1 : T2);
  vec2 px = uCenter + vec2(P.x, -P.y) * uPxPerMm;
  gl_Position = vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, 0.0, 1.0);
}`;

export interface FrameUniforms {
  optics: OpticsParams;
  eye: Vec3;
  corrected: boolean;
  centerPx: [number, number];
  pxPerMm: number;
  sizePx: [number, number];
  lat: number; lon: number;   // 模様の向き（ラジアン）
  light: Vec3;                // 光の来る向き（端末座標）
}

/**
 * ドームの屈折を頂点シェーダで計算し、各画素に「そこが見えるドーム表面の点」を対応させて描く。
 * 中身（ドームの向こうに何が見えるか）はフラグメントシェーダ sceneFS が決める。
 */
export class Renderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private canvas: HTMLCanvasElement, sceneFS: string, extraUniforms: string[] = []) {
    const gl = canvas.getContext("webgl2", { antialias: true });
    if (!gl) throw new Error("WebGL2 が使えません");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, sceneFS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    this.prog = prog;
    for (const n of ["uCenter", "uPxPerMm", "uSize", "uLat", "uLon", "uLight",
      "uR", "uCz", "uZb", "uA", "uAmax", "uN", "uN2", "uGap", "uGlass", "uEye", "uCorr", "uNA", "uNP", ...extraUniforms]) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }
    this.vao = gl.createVertexArray()!;   // 頂点属性なし（gl_VertexID だけで描く）
  }

  get context() { return this.gl; }

  resize(cssW: number, cssH: number, dpr: number) {
    this.canvas.style.width = cssW + "px"; this.canvas.style.height = cssH + "px";
    this.canvas.width = Math.round(cssW * dpr); this.canvas.height = Math.round(cssH * dpr);
  }

  draw(f: FrameUniforms, extra?: (gl: WebGL2RenderingContext, u: Record<string, WebGLUniformLocation | null>) => void) {
    const gl = this.gl, u = this.u;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    const g = geometry(f.optics);
    gl.uniform2f(u.uCenter, f.centerPx[0], f.centerPx[1]);
    gl.uniform1f(u.uPxPerMm, f.pxPerMm);
    gl.uniform2f(u.uSize, f.sizePx[0], f.sizePx[1]);
    gl.uniform1f(u.uR, g.R); gl.uniform1f(u.uCz, g.cz); gl.uniform1f(u.uZb, g.zb);
    gl.uniform1f(u.uA, g.a); gl.uniform1f(u.uAmax, g.amax);
    gl.uniform1f(u.uN, f.optics.n); gl.uniform1f(u.uN2, f.optics.n2);
    gl.uniform1f(u.uGap, f.optics.gap); gl.uniform1f(u.uGlass, f.optics.glass || 0);
    gl.uniform3f(u.uEye, f.eye.x, f.eye.y, f.eye.z);
    gl.uniform1i(u.uCorr, f.corrected ? 1 : 0);
    gl.uniform1i(u.uNA, NA); gl.uniform1i(u.uNP, NP);
    gl.uniform1f(u.uLat, f.lat);
    gl.uniform1f(u.uLon, f.lon);
    gl.uniform3f(u.uLight, f.light.x, f.light.y, f.light.z);
    gl.bindVertexArray(this.vao);
    extra?.(gl, u);
    gl.drawArrays(gl.TRIANGLES, 0, NA * NP * 6);
  }
}
