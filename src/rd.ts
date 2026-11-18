// 球面上の反応拡散（Gray-Scott モデル）
//
// 球を立方体の6面に分けた「キューブスフィア」の格子で計算する。
// 面の内側の座標は等角（equi-angular）にとるので、マスの大きさのムラが小さい。
// 拡散の計算では、各マスの球面上の点から接平面方向に1マス分ずらした点の値を
// 「方向から読む」ので、隣が別の面でも正しく読める。そのため面の継ぎ目も極の特異点もない。
//
// 6面は 3×2 に並べた1枚のテクスチャ（R: U、G: V）に入れ、2枚を交互に使って更新する。

/** 面の基底・方向⇔テクスチャ座標の変換（シミュレーションと表示で共用） */
export const CUBE_GLSL = `
const float PI_C = 3.14159265358979;
void faceBasis(int f, out vec3 N, out vec3 Tu, out vec3 Tv){
  if (f == 0)      { N = vec3( 1, 0, 0); Tu = vec3(0, 0,-1); Tv = vec3(0, 1, 0); }
  else if (f == 1) { N = vec3(-1, 0, 0); Tu = vec3(0, 0, 1); Tv = vec3(0, 1, 0); }
  else if (f == 2) { N = vec3( 0, 1, 0); Tu = vec3(1, 0, 0); Tv = vec3(0, 0,-1); }
  else if (f == 3) { N = vec3( 0,-1, 0); Tu = vec3(1, 0, 0); Tv = vec3(0, 0, 1); }
  else if (f == 4) { N = vec3( 0, 0, 1); Tu = vec3(1, 0, 0); Tv = vec3(0, 1, 0); }
  else             { N = vec3( 0, 0,-1); Tu = vec3(-1, 0, 0); Tv = vec3(0, 1, 0); }
}
// 方向 → 3×2 に並べたテクスチャ上の座標（0〜1）
vec2 dirToAtlas(vec3 d, float n){
  vec3 a = abs(d);
  int f;
  if (a.x >= a.y && a.x >= a.z) f = d.x > 0.0 ? 0 : 1;
  else if (a.y >= a.z)          f = d.y > 0.0 ? 2 : 3;
  else                          f = d.z > 0.0 ? 4 : 5;
  vec3 N, Tu, Tv; faceBasis(f, N, Tu, Tv);
  vec3 p = d / dot(d, N);
  vec2 uv = vec2(atan(dot(p, Tu)), atan(dot(p, Tv))) * (4.0 / PI_C);   // 等角座標 -1〜1
  vec2 t = clamp((uv * 0.5 + 0.5) * n, 0.5, n - 0.5);                  // 面の中のテクセル座標
  vec2 cell = vec2(float(f - (f / 3) * 3), float(f / 3)) * n;
  return (cell + t) / vec2(3.0 * n, 2.0 * n);
}
`;

const VS = `#version 300 es
void main(){
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// 各テクセル → 面と球面上の点
const CELL_GLSL = `
uniform float uN;
vec3 cellDir(ivec2 px, out vec3 e1, out vec3 e2){
  int n = int(uN);
  int fx = px.x / n, fy = px.y / n;
  int f = fy * 3 + fx;
  vec2 t = (vec2(px - ivec2(fx, fy) * n) + 0.5) / uN * 2.0 - 1.0;
  vec3 N, Tu, Tv; faceBasis(f, N, Tu, Tv);
  vec3 p = normalize(N + tan(t.x * PI_C / 4.0) * Tu + tan(t.y * PI_C / 4.0) * Tv);
  e1 = normalize(Tu - p * dot(Tu, p));
  e2 = cross(p, e1);
  return p;
}
`;

const STEP_FS = `#version 300 es
precision highp float;
${CUBE_GLSL}
${CELL_GLSL}
uniform sampler2D uPrev;
uniform vec2 uParamA, uParamB;   // (feed, kill)：軸の＋側が A、－側が B
uniform vec3 uAxis;
uniform float uBlendW;           // 0 なら場所による変化なし（すべて A）
out vec4 o;
vec2 F(vec3 q){ return texture(uPrev, dirToAtlas(normalize(q), uN)).rg; }
void main(){
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 e1, e2;
  vec3 p = cellDir(px, e1, e2);
  float h = (PI_C / 2.0) / uN;             // 1マスの角度（等角なのでほぼ一定）
  vec2 c = texelFetch(uPrev, px, 0).rg;
  vec3 a = e1 * h, b = e2 * h;
  vec2 lap = -c
    + 0.2 * (F(p + a) + F(p - a) + F(p + b) + F(p - b))
    + 0.05 * (F(p + a + b) + F(p + a - b) + F(p - a + b) + F(p - a - b));
  vec2 fk = uParamA;
  if (uBlendW > 0.0) fk = mix(uParamB, uParamA, smoothstep(-uBlendW, uBlendW, dot(p, uAxis)));
  float u = c.x, v = c.y, uvv = u * v * v;
  u += 1.0 * lap.x - uvv + fk.x * (1.0 - u);
  v += 0.5 * lap.y + uvv - (fk.x + fk.y) * v;
  o = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}`;

const SEED_FS = `#version 300 es
precision highp float;
${CUBE_GLSL}
${CELL_GLSL}
uniform float uSeed;
out vec4 o;
float hash(vec3 p){ p = fract(p * 0.3183099 + uSeed); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 e1, e2;
  vec3 p = cellDir(ivec2(gl_FragCoord.xy), e1, e2);
  // 球面上にまばらな小さい種をまく
  float s = step(0.93, hash(floor(p * uN * 0.12)));
  o = vec4(1.0 - 0.5 * s, 0.25 * s, 0.0, 1.0);
}`;

export interface RDParams {
  a: [number, number];      // (feed, kill)
  b: [number, number];
  axis: [number, number, number];
  blend: number;            // 0 で場所による変化なし
}

export class ReactionDiffusion {
  private tex: WebGLTexture[] = [];
  private fbo: WebGLFramebuffer[] = [];
  private cur = 0;
  private stepProg: WebGLProgram;
  private seedProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private su: Record<string, WebGLUniformLocation | null> = {};
  private seedU: Record<string, WebGLUniformLocation | null> = {};
  n = 0;

  constructor(private gl: WebGL2RenderingContext, n: number) {
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("この端末では浮動小数点テクスチャへの描画ができません");
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = (fs: string) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
      return p;
    };
    this.stepProg = prog(STEP_FS);
    this.seedProg = prog(SEED_FS);
    for (const k of ["uPrev", "uN", "uParamA", "uParamB", "uAxis", "uBlendW"]) this.su[k] = gl.getUniformLocation(this.stepProg, k);
    for (const k of ["uN", "uSeed"]) this.seedU[k] = gl.getUniformLocation(this.seedProg, k);
    this.vao = gl.createVertexArray()!;
    this.resize(n);
  }

  /** 1面あたりのマス数を変えて作り直す（模様の細かさが変わる） */
  resize(n: number) {
    const gl = this.gl;
    this.tex.forEach(t => gl.deleteTexture(t)); this.fbo.forEach(f => gl.deleteFramebuffer(f));
    this.tex = []; this.fbo = [];
    this.n = n;
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 3 * n, 2 * n, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      this.tex.push(t); this.fbo.push(f);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.seed();
  }

  /** 最初の状態（まばらな種）に戻す */
  seed() {
    const gl = this.gl;
    gl.useProgram(this.seedProg);
    gl.uniform1f(this.seedU.uN, this.n);
    gl.uniform1f(this.seedU.uSeed, Math.random());
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, 3 * this.n, 2 * this.n);
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[i]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cur = 0;
  }

  step(count: number, p: RDParams) {
    const gl = this.gl, u = this.su;
    gl.useProgram(this.stepProg);
    gl.uniform1f(u.uN, this.n);
    gl.uniform2f(u.uParamA, p.a[0], p.a[1]);
    gl.uniform2f(u.uParamB, p.b[0], p.b[1]);
    gl.uniform3f(u.uAxis, p.axis[0], p.axis[1], p.axis[2]);
    gl.uniform1f(u.uBlendW, p.blend);
    gl.uniform1i(u.uPrev, 0);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, 3 * this.n, 2 * this.n);
    gl.activeTexture(gl.TEXTURE0);
    for (let i = 0; i < count; i++) {
      const next = 1 - this.cur;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next]);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = next;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  get texture() { return this.tex[this.cur]; }
}

/** よく知られた (feed, kill) の組み合わせ */
export const RD_PRESETS: { name: string; f: number; k: number }[] = [
  { name: "迷路", f: 0.029, k: 0.057 },
  { name: "斑点", f: 0.035, k: 0.065 },
  { name: "分裂する点", f: 0.0367, k: 0.0649 },
  { name: "縞・指紋", f: 0.037, k: 0.060 },
  { name: "穴あき", f: 0.039, k: 0.058 },
  { name: "サンゴ", f: 0.0545, k: 0.062 },
  { name: "うごめく虫", f: 0.078, k: 0.061 },
  { name: "波", f: 0.014, k: 0.045 },
];
