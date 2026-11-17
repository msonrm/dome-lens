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
const float PI = 3.14159265358979;
const float NG = ${N_GLASS.toFixed(3)};
vec3 dirAt(ivec2 g){
  float al = uAmax * float(g.x) / float(uNA);
  float ph = 2.0 * PI * float(g.y) / float(uNP);
  return vec3(sin(al) * cos(ph), sin(al) * sin(ph), cos(al));
}
bool land(vec3 u, out vec2 P, out vec3 S){
  S = vec3(uR * u.xy, uCz + uR * u.z);
  P = S.xy;
  if (!uCorr) return true;
  vec3 I = normalize(S - uEye);
  float cosi = -dot(I, u);
  if (cosi <= 0.0) return false;
  float eta = 1.0 / uN;
  float k1 = 1.0 - eta * eta * (1.0 - cosi * cosi);
  if (k1 < 0.0) return false;
  vec3 T = eta * I + (eta * cosi - sqrt(k1)) * u;
  if (T.z >= -1e-6) return false;
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
  vec2 P0, P1, P2; vec3 S0, S1, S2;
  bool ok0 = land(u0, P0, S0), ok1 = land(u1, P1, S1), ok2 = land(u2, P2, S2);
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
  if (!ok) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vDir = vec3(0.0, 0.0, 1.0); return; }
  vec2 P = c == 0 ? P0 : (c == 1 ? P1 : P2);
  vDir = c == 0 ? u0 : (c == 1 ? u1 : u2);
  vec2 px = uCenter + vec2(P.x, -P.y) * uPxPerMm;
  gl_Position = vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vDir;
uniform float uLat, uLon; uniform int uPattern; uniform sampler2D uTex; uniform bool uHasTex;
out vec4 o;
const float PI = 3.14159265;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
float lineMask(float dist, float w){ return 1.0 - smoothstep(w * 0.6, w * 1.6, dist); }
void main(){
  vec3 u = normalize(vDir);
  float la = uLat, lo = uLon;
  vec3 U  = vec3(cos(la) * cos(lo), cos(la) * sin(lo), sin(la));
  vec3 Ea = vec3(-sin(lo), cos(lo), 0.0);
  vec3 No = vec3(-sin(la) * cos(lo), -sin(la) * sin(lo), cos(la));
  vec3 g = normalize(u.x * Ea + u.y * No + u.z * U);
  float lat = asin(clamp(g.z, -1.0, 1.0));
  float lon = atan(g.y, g.x);
  float latd = degrees(lat), lond = degrees(lon);
  float lon2 = degrees(atan(-g.y, -g.x));
  float wLat = fwidth(latd);
  float wLon = min(fwidth(lond), fwidth(lon2));
  float cl = max(cos(lat), 1e-3);
  vec3 col;
  if (uPattern == 0) {
    float band = mod(floor(latd / 30.0) + floor(lond / 30.0), 2.0);
    col = mix(vec3(0.05, 0.12, 0.28), vec3(0.08, 0.20, 0.40), band);
    float dLat = abs(fract(latd / 15.0 + 0.5) - 0.5) * 15.0;
    float dLon = abs(fract(lond / 15.0 + 0.5) - 0.5) * 15.0 * cl;
    float ln = max(lineMask(dLat, wLat), lineMask(dLon, wLon * cl));
    col = mix(col, vec3(0.85), ln * 0.85);
    col = mix(col, vec3(1.0, 0.25, 0.2), lineMask(abs(latd), wLat * 1.6));
    col = mix(col, vec3(1.0, 0.85, 0.2), lineMask(abs(lond) * cl, wLon * cl * 1.6));
    vec3 jp = vec3(cos(radians(35.7)) * cos(radians(139.7)), cos(radians(35.7)) * sin(radians(139.7)), sin(radians(35.7)));
    float dj = acos(clamp(dot(g, jp), -1.0, 1.0));
    col = mix(col, vec3(0.2, 1.0, 0.4), 1.0 - smoothstep(0.035, 0.045, dj));
    float dn = acos(clamp(g.z, -1.0, 1.0));
    col = mix(col, vec3(1.0), 1.0 - smoothstep(0.035, 0.045, dn));
  } else if (uPattern == 1) {
    float c = mod(floor(latd / 15.0) + floor(lond / 15.0), 2.0);
    col = vec3(c * 0.9 + 0.05);
  } else if (uPattern == 2) {
    float e = fbm(g * 2.2 + 3.1);
    float land = smoothstep(0.50, 0.53, e);
    vec3 sea = mix(vec3(0.02, 0.08, 0.25), vec3(0.05, 0.25, 0.45), smoothstep(0.35, 0.50, e));
    vec3 gnd = mix(vec3(0.15, 0.40, 0.12), vec3(0.55, 0.45, 0.25), smoothstep(0.55, 0.68, e));
    col = mix(sea, gnd, land);
    col = mix(col, vec3(0.95), smoothstep(0.80, 0.86, abs(g.z)));
    float cloud = smoothstep(0.55, 0.75, fbm(g * 4.0 + vec3(uLon * 0.3, 0.0, 7.0)));
    col = mix(col, vec3(1.0), cloud * 0.6);
  } else {
    if (uHasTex) col = texture(uTex, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI)).rgb;
    else col = vec3(0.3);
  }
  o = vec4(col, 1.0);
}`;

export interface FrameUniforms {
  optics: OpticsParams;
  eye: Vec3;
  corrected: boolean;
  centerPx: [number, number];
  pxPerMm: number;
  sizePx: [number, number];
  lat: number; lon: number;   // ラジアン
  pattern: number;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private tex: WebGLTexture;
  hasTex = false;

  constructor(private canvas: HTMLCanvasElement) {
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
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    this.prog = prog;
    gl.useProgram(prog);
    for (const n of ["uCenter", "uPxPerMm", "uSize", "uLat", "uLon", "uPattern", "uTex", "uHasTex",
      "uR", "uCz", "uZb", "uA", "uAmax", "uN", "uN2", "uGap", "uGlass", "uEye", "uCorr", "uNA", "uNP"]) this.u[n] = gl.getUniformLocation(prog, n);
    this.vao = gl.createVertexArray()!; // 頂点属性なし（gl_VertexID だけで描く）

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setImage(src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.hasTex = true;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.canvas.style.width = cssW + "px"; this.canvas.style.height = cssH + "px";
    this.canvas.width = Math.round(cssW * dpr); this.canvas.height = Math.round(cssH * dpr);
  }

  draw(f: FrameUniforms) {
    const gl = this.gl, u = this.u;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(u.uCenter, f.centerPx[0], f.centerPx[1]);
    gl.uniform1f(u.uPxPerMm, f.pxPerMm);
    gl.uniform2f(u.uSize, f.sizePx[0], f.sizePx[1]);
    const g = geometry(f.optics);
    gl.uniform1f(u.uR, g.R); gl.uniform1f(u.uCz, g.cz); gl.uniform1f(u.uZb, g.zb);
    gl.uniform1f(u.uA, g.a); gl.uniform1f(u.uAmax, g.amax);
    gl.uniform1f(u.uN, f.optics.n); gl.uniform1f(u.uN2, f.optics.n2);
    gl.uniform1f(u.uGap, f.optics.gap); gl.uniform1f(u.uGlass, f.optics.glass || 0);
    gl.uniform3f(u.uEye, f.eye.x, f.eye.y, f.eye.z);
    gl.uniform1i(u.uCorr, f.corrected ? 1 : 0);
    gl.uniform1i(u.uNA, NA); gl.uniform1i(u.uNP, NP);
    gl.uniform1f(u.uLat, f.lat);
    gl.uniform1f(u.uLon, f.lon);
    gl.uniform1i(u.uPattern, f.pattern);
    gl.uniform1i(u.uHasTex, this.hasTex ? 1 : 0);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, NA * NP * 6);
  }
}
