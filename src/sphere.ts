// ガラス球モード（sphere.html）
import "./style.css";
import { eyeFromAngles, type Vec3 } from "./optics";
import { Renderer } from "./renderer";
import { SPHERE_FS } from "./sphereScene";
import { TiltSensor } from "./level";
import { load, save, type Settings } from "./settings";
import { ReactionDiffusion, RD_PRESETS } from "./rd";
import { computeSky, signText, ASPECTS, type Sky } from "./sky";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hint = $("hint");

// ドームの寸法・素材・画面上の位置は表面モードと共通の設定を使う
const S: Settings = load();

interface PageSettings {
  ratio: number; ballPat: number; wallPat: number;
  lat: number; spd: number; lightAz: number; lightElev: number; D: number;
  lightBearing: number;   // 方位が取れるときの光の方位（北から時計回り、度）
  followTau: number;      // 端末を水平に回したとき、小球が追いつくまでの時間（秒）
  // チューリングパターン
  rdRes: number; rdSteps: number;
  rdFA: number; rdKA: number; rdFB: number; rdKB: number;
  rdVary: number; rdAxisTilt: number; rdBlend: number;
  spread: number;         // 鏡面球の映り込みの広がり
  camSat: number;         // 映り込む映像の彩度
  skyMode: "now" | "set"; // 天球：現在時刻か指定日時か
  skyTime: string;        // 指定日時（日本時間、datetime-local の書式）
  belowDark: number;      // 地平線より下を暗くする度合い
}
const PDEF: PageSettings = {
  ratio: 0.6, ballPat: 0, wallPat: 1, lat: 35, spd: 6, lightAz: 135, lightElev: 55, D: 300, lightBearing: 315, followTau: 3,
  rdRes: 192, rdSteps: 12, rdFA: 0.029, rdKA: 0.057, rdFB: 0.035, rdKB: 0.065, rdVary: 1, rdAxisTilt: 90, rdBlend: 0.25,
  spread: 2.0, camSat: 1.0,
  skyMode: "now", skyTime: "", belowDark: 0.75,
};
const PKEY = "domeLens.sphere.v1";
const P: PageSettings = { ...PDEF };
try { Object.assign(P, JSON.parse(localStorage.getItem(PKEY) ?? "{}")); } catch { /* 既定値で動く */ }
const saveAll = () => { save(S); try { localStorage.setItem(PKEY, JSON.stringify(P)); } catch { /* 無視 */ } };

// ---------- 描画 ----------
const canvas = $<HTMLCanvasElement>("gl");
let renderer: Renderer;
try { renderer = new Renderer(canvas, SPHERE_FS, ["uInnerR", "uBx", "uBy", "uBz", "uBallPat", "uWallPat", "uField", "uFieldN",
    "uCam", "uCamOn", "uCamPos", "uCamF", "uCamSize", "uCamFlip", "uFaceZ", "uSpread", "uCamSat",
    "uBodyDir", "uBodyCol", "uBodySize", "uAspA", "uAspB", "uAspC", "uAspN", "uEc0", "uEc90", "uEcN", "uNcp", "uShadowK", "uBelowDark"]); }
catch (e) { hint.textContent = "WebGL2 が使えないため表示できません。"; throw e; }

let W = 0, H = 0;
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.resize(W, H, window.devicePixelRatio || 1);
  if (!S.cal) S.cal = { cx: W / 2, cy: H * 0.3, diam: 6.3 * S.d };
  placeRing();
}
window.addEventListener("resize", resize);
const pxPerMm = () => S.cal!.diam / S.d;

// ---------- 位置合わせ ----------
const ring = $("ring");
let calMode = false;
function placeRing() {
  const c = S.cal; if (!c) return;
  ring.style.width = ring.style.height = c.diam + "px";
  ring.style.left = (c.cx - c.diam / 2) + "px"; ring.style.top = (c.cy - c.diam / 2) + "px";
  ring.style.display = calMode ? "block" : "none";
}
const pts = new Map<number, { x: number; y: number }>();
let last: { x: number; y: number; dist: number } | null = null;
function snap() {
  const a = [...pts.values()];
  if (a.length === 1) return { x: a[0].x, y: a[0].y, dist: 0 };
  const [p, q] = a;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, dist: Math.hypot(p.x - q.x, p.y - q.y) };
}
canvas.addEventListener("pointerdown", e => {
  if (!calMode) return;
  canvas.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = snap();
});
canvas.addEventListener("pointermove", e => {
  if (!calMode || !pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const now = snap();
  if (last && pts.size <= 2 && S.cal) {
    S.cal.cx += now.x - last.x; S.cal.cy += now.y - last.y;
    if (pts.size === 2 && last.dist > 0) S.cal.diam = Math.max(20, S.cal.diam * now.dist / last.dist);
    placeRing();
  }
  last = now;
});
const up = (e: PointerEvent) => { pts.delete(e.pointerId); last = pts.size ? snap() : null; saveAll(); };
canvas.addEventListener("pointerup", up);
canvas.addEventListener("pointercancel", up);

// ---------- 傾きセンサー ----------
const tilt = new TiltSensor();
let tiltOn = false;
// 小球の「上」：ゆっくり水平に戻る（重力の向きに遅れて追従）
let ballUp: Vec3 = { x: 0, y: 0, z: 1 };

// ---------- UI ----------
type SKey = "d" | "h" | "n" | "gap" | "glass";
type PKey = "ratio" | "lat" | "spd" | "lightAz" | "lightElev" | "D" | "lightBearing" | "followTau"
  | "rdSteps" | "rdFA" | "rdKA" | "rdFB" | "rdKB" | "rdAxisTilt" | "rdBlend" | "spread" | "camSat" | "belowDark";
const units: Record<string, string> = {
  d: "mm", h: "mm", n: "", gap: "mm", glass: "mm",
  ratio: "×", lat: "°", spd: "°/s", lightAz: "°", lightElev: "°", D: "mm", lightBearing: "°", followTau: "秒",
  rdSteps: "/フレーム", rdFA: "", rdKA: "", rdFB: "", rdKB: "", rdAxisTilt: "°", rdBlend: "", spread: "×", camSat: "", belowDark: "",
};
const sKeys: SKey[] = ["d", "h", "n", "gap", "glass"];
const pKeys: PKey[] = ["ratio", "lat", "spd", "lightAz", "lightElev", "D", "lightBearing", "followTau",
  "rdSteps", "rdFA", "rdKA", "rdFB", "rdKB", "rdAxisTilt", "rdBlend", "spread", "camSat", "belowDark"];
const fmt = (k: string, v: number) =>
  (k === "n" || k === "ratio" || k === "rdBlend" || k === "spread" || k === "camSat" || k === "belowDark" ? v.toFixed(2) : k.startsWith("rdF") || k.startsWith("rdK") ? v.toFixed(4) : String(v)) + units[k];

// ---------- 鏡面球に映すインカメラの映像 ----------
const camVideo = document.createElement("video");
camVideo.muted = true; camVideo.playsInline = true;
let camStream: MediaStream | null = null;
let camTex: WebGLTexture | null = null;
async function startCamera() {
  if (camStream) return;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
    });
    camVideo.srcObject = camStream;
    await camVideo.play();
  } catch (e) {
    camStream = null;
    hint.textContent = "カメラを起動できませんでした：" + (e instanceof Error ? e.message : String(e));
  }
}
function stopCamera() {
  camStream?.getTracks().forEach(t => t.stop());
  camStream = null; camVideo.srcObject = null;
}
/** 最新の映像フレームをテクスチャに送る。映像がなければ false */
function updateCamTexture(gl: WebGL2RenderingContext): boolean {
  if (!camStream || camVideo.readyState < 2) return false;
  if (!camTex) {
    camTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, camTex);
    // 画角の外は鏡映しで繰り返し、ミップマップでぼかして読む
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  }
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, camTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, camVideo);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.activeTexture(gl.TEXTURE0);
  return true;
}

// ---------- 天球 ----------
let sky: Sky | null = null;
let skyAt = 0;
let skyDirty = true;
/** 日本時間の "YYYY-MM-DDTHH:MM" ⇔ Date */
const jstToDate = (v: string) => new Date(v + ":00+09:00");
function dateToJst(d: Date) {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return j.toISOString().slice(0, 16);
}
function skyDate(): Date {
  if (P.skyMode === "set" && P.skyTime) { const d = jstToDate(P.skyTime); if (!isNaN(d.getTime())) return d; }
  return new Date();
}
function updateSkyInfo(d: Date) {
  if (!sky) return;
  const when = `${dateToJst(d).replace("T", " ")}（日本時間）${P.skyMode === "now" ? " 現在" : ""}`;
  const bodies = sky.bodies.map(b => `${b.name.padEnd(2, "　")} ${signText(b.lon)}　高度 ${b.alt >= 0 ? " " : ""}${b.alt.toFixed(0)}°`).join("\n");
  const asp = [...sky.aspects].sort((a, b) => a.diff - b.diff)
    .map(a => `${sky!.bodies[a.a].name}–${sky!.bodies[a.b].name} ${a.kind}（ずれ ${a.diff.toFixed(1)}°）`).join("\n");
  $("skyInfo").textContent = `${when}\n\n${bodies}\n\nアスペクト\n${asp || "なし"}`;
}
$<HTMLSelectElement>("skyMode").addEventListener("change", e => {
  P.skyMode = (e.target as HTMLSelectElement).value as "now" | "set";
  if (P.skyMode === "set" && !P.skyTime) P.skyTime = dateToJst(new Date());
  skyDirty = true; sync(); saveAll();
});
$<HTMLInputElement>("skyTime").addEventListener("input", e => {
  P.skyTime = (e.target as HTMLInputElement).value; P.skyMode = "set"; skyDirty = true; sync(); saveAll();
});
$("bSkyNow").onclick = () => { P.skyMode = "now"; skyDirty = true; sync(); saveAll(); };

// ---------- チューリングパターン ----------
let rd: ReactionDiffusion | null = null;
function ensureRD(): ReactionDiffusion | null {
  if (rd) return rd;
  try { rd = new ReactionDiffusion(renderer.context, P.rdRes); }
  catch (e) { hint.textContent = "チューリングパターンを計算できません：" + (e instanceof Error ? e.message : String(e)); }
  return rd;
}
for (const id of ["rdPresetA", "rdPresetB"]) {
  const sel = $<HTMLSelectElement>(id);
  sel.innerHTML = `<option value="-1">カスタム（スライダーの値）</option>` + RD_PRESETS.map((p, i) => `<option value="${i}">${p.name}（${p.f} / ${p.k}）</option>`).join("");
  sel.addEventListener("change", () => {
    const i = parseInt(sel.value, 10); if (i < 0) return;
    const pr = RD_PRESETS[i];
    if (id === "rdPresetA") { P.rdFA = pr.f; P.rdKA = pr.k; } else { P.rdFB = pr.f; P.rdKB = pr.k; }
    sync(); saveAll();
  });
}
/** 今の供給率・除去率に一致するプリセットの番号（なければ -1 ＝カスタム） */
function presetIndex(f: number, k: number) {
  return RD_PRESETS.findIndex(p => Math.abs(p.f - f) < 1e-6 && Math.abs(p.k - k) < 1e-6);
}
// 模様が消えていたら種を足して立て直す（パラメータによっては模様が全滅するため）
let probeAt = 0;
function toggle(id: string, on: boolean, onText: string, offText: string) {
  const b = $(id); b.classList.toggle("on", on); b.textContent = on ? onText : offText;
}
function sync() {
  for (const k of sKeys) { const el = $<HTMLInputElement>(k); el.value = String(S[k]); el.parentElement!.querySelector("output")!.textContent = fmt(k, S[k]); }
  for (const k of pKeys) { const el = $<HTMLInputElement>(k); el.value = String(P[k]); el.parentElement!.querySelector("output")!.textContent = fmt(k, P[k]); }
  $<HTMLSelectElement>("n2").value = String(S.n2);
  $<HTMLSelectElement>("ballPat").value = String(P.ballPat);
  $<HTMLSelectElement>("wallPat").value = String(P.wallPat);
  $<HTMLSelectElement>("rdRes").value = String(P.rdRes);
  $<HTMLSelectElement>("skyMode").value = P.skyMode;
  $<HTMLInputElement>("skyTime").value = P.skyMode === "set" ? P.skyTime : dateToJst(new Date());
  $<HTMLSelectElement>("rdVary").value = String(P.rdVary);
  $<HTMLSelectElement>("rdPresetA").value = String(presetIndex(P.rdFA, P.rdKA));
  $<HTMLSelectElement>("rdPresetB").value = String(presetIndex(P.rdFB, P.rdKB));
  toggle("bTilt", tiltOn, "傾きセンサー 動作中", "傾きセンサーを有効にする");
}
for (const k of sKeys) $<HTMLInputElement>(k).addEventListener("input", e => {
  S[k] = parseFloat((e.target as HTMLInputElement).value);
  if (S.h > S.d / 2) S.h = S.d / 2;
  sync(); saveAll();
});
for (const k of pKeys) $<HTMLInputElement>(k).addEventListener("input", e => {
  P[k] = parseFloat((e.target as HTMLInputElement).value); sync(); saveAll();
});
$<HTMLSelectElement>("n2").addEventListener("change", e => { S.n2 = parseFloat((e.target as HTMLSelectElement).value); saveAll(); });
$<HTMLSelectElement>("ballPat").addEventListener("change", e => {
  P.ballPat = parseInt((e.target as HTMLSelectElement).value, 10); saveAll();
  if (P.ballPat === 3) ($("rdPanel") as HTMLDetailsElement).open = true;
  if (P.ballPat === 5) { ($("skyPanel") as HTMLDetailsElement).open = true; skyDirty = true; }
  if (P.ballPat === 4) void startCamera(); else stopCamera();
});
$<HTMLSelectElement>("rdRes").addEventListener("change", e => {
  P.rdRes = parseInt((e.target as HTMLSelectElement).value, 10); saveAll();
  rd?.resize(P.rdRes);
});
$<HTMLSelectElement>("rdVary").addEventListener("change", e => { P.rdVary = parseInt((e.target as HTMLSelectElement).value, 10); saveAll(); });
$("bRdReset").onclick = () => { ensureRD()?.seed(); };
$<HTMLSelectElement>("wallPat").addEventListener("change", e => { P.wallPat = parseInt((e.target as HTMLSelectElement).value, 10); saveAll(); });
$("bCal").onclick = () => { calMode = !calMode; $("bCal").classList.toggle("on", calMode); placeRing(); };
$("bTilt").onclick = async () => {
  if (tiltOn) { tilt.stop(); tiltOn = false; sync(); return; }
  try { await tilt.start(); tiltOn = true; } catch (e) { hint.textContent = e instanceof Error ? e.message : String(e); }
  sync();
};
$("bLightHere").onclick = () => {
  if (!tiltOn || !tilt.active) { hint.textContent = "先に傾きセンサーを有効にしてください。"; return; }
  // 画面上で「光の方向」（初期値は左上）にあたる向きが、地球上でどの方位かを求めて光の方位にする
  const a = P.lightAz * Math.PI / 180;
  P.lightBearing = Math.round(bearingOf({ x: Math.cos(a), y: Math.sin(a), z: 0 }));
  sync(); saveAll();
  hint.textContent = `光の方位を ${P.lightBearing}° にしました。`;
};
$("bHide").onclick = () => {
  calMode = false; $("bCal").classList.remove("on"); placeRing();
  $("ui").classList.add("hidden"); $("show").style.display = "block";
};
$("show").onclick = () => { $("ui").classList.remove("hidden"); $("show").style.display = "none"; };
$("bFull").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch { hint.textContent = "全画面にできませんでした。"; }
};
async function keepAwake() {
  try { if ("wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch { /* 無視 */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void keepAwake(); });
void keepAwake();

// ---------- 描画ループ ----------
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** 端末座標のベクトルが地球上でどの方位を向いているか（北から時計回り、度） */
function bearingOf(v: Vec3): number {
  const e = tilt.toDevice({ x: 1, y: 0, z: 0 }), n = tilt.toDevice({ x: 0, y: 1, z: 0 });
  return (Math.atan2(dot(v, e), dot(v, n)) * 180 / Math.PI + 360) % 360;
}
/** v から axis 方向の成分を除いて正規化（直交化） */
function orthoTo(v: Vec3, axis: Vec3): Vec3 {
  const k = dot(v, axis);
  return norm({ x: v.x - axis.x * k, y: v.y - axis.y * k, z: v.z - axis.z * k });
}

// 小球の水平方向の向き（x 軸の方位、度）。端末を回すと、その場に留まってからゆっくり追いつく
let ballHeading: number | null = null;
// 光の向き（端末座標）。方位センサーの細かい揺れを抑えるために平滑化する
let lightSm: Vec3 | null = null;
const hud = $("hud");
let lon = 139.7 * Math.PI / 180, prev = performance.now(), hudAt = 0;
let frames = 0, fps = 0, fpsAt = performance.now();

function frame(now: number) {
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  lon += P.spd * Math.PI / 180 * dt;
  frames++;
  if (now - fpsAt > 1000) { fps = frames * 1000 / (now - fpsAt); frames = 0; fpsAt = now; }

  // 重力の「上」（センサーがなければ画面に垂直）。小球は約 0.3 秒の遅れで追従
  const target = tiltOn && tilt.active ? norm(tilt.up) : { x: 0, y: 0, z: 1 };
  const a = 1 - Math.exp(-dt / 0.3);
  ballUp = norm({ x: ballUp.x + (target.x - ballUp.x) * a, y: ballUp.y + (target.y - ballUp.y) * a, z: ballUp.z + (target.z - ballUp.z) * a });
  const sensing = tiltOn && tilt.active;
  const zb = ballUp;
  let xb: Vec3;
  let lightTarget: Vec3;
  const le = P.lightElev * Math.PI / 180;
  if (sensing) {
    // 小球の向き：端末の x 軸の方位に、時定数 followTau で遅れて追いつく
    const devHeading = bearingOf(orthoTo({ x: 1, y: 0, z: 0 }, target));
    if (ballHeading === null) ballHeading = devHeading;
    // 天球では小球の x 軸を東に固定する（地平座標にそろえる）。それ以外は端末の向きに遅れて追いつく
    const goal = P.ballPat === 5 ? 90 : devHeading;
    const diff = ((goal - ballHeading + 540) % 360) - 180;
    ballHeading = (ballHeading + diff * (1 - Math.exp(-dt / Math.max(0.05, P.followTau))) + 360) % 360;
    const hb = ballHeading * Math.PI / 180;
    xb = orthoTo(tilt.toDevice({ x: Math.sin(hb), y: Math.cos(hb), z: 0 }), zb);
    // 光：部屋に固定（方位 lightBearing、高さ lightElev）
    const B = P.lightBearing * Math.PI / 180;
    lightTarget = norm(tilt.toDevice({ x: Math.sin(B) * Math.cos(le), y: Math.cos(B) * Math.cos(le), z: Math.sin(le) }));
  } else {
    // センサーなし：端末を水平に置いた前提。光は画面上の方向（初期値は左上）から
    ballHeading = null;
    xb = orthoTo({ x: 1, y: 0, z: 0 }, zb);
    const la = P.lightAz * Math.PI / 180;
    lightTarget = { x: Math.cos(le) * Math.cos(la), y: Math.cos(le) * Math.sin(la), z: Math.sin(le) };
  }
  const yb = cross(zb, xb);
  if (!lightSm) lightSm = lightTarget;
  const al = 1 - Math.exp(-dt / 0.15);
  lightSm = norm({ x: lightSm.x + (lightTarget.x - lightSm.x) * al, y: lightSm.y + (lightTarget.y - lightSm.y) * al, z: lightSm.z + (lightTarget.z - lightSm.z) * al });
  const light = lightSm;

  // チューリングパターンを進める（小球に固定した座標で計算）
  let field: ReactionDiffusion | null = null;
  if (P.ballPat === 3) {
    field = ensureRD();
    if (field && P.rdSteps > 0) {
      const t = P.rdAxisTilt * Math.PI / 180;
      field.step(Math.round(P.rdSteps), {
        a: [P.rdFA, P.rdKA], b: [P.rdFB, P.rdKB],
        axis: [Math.sin(t), 0, Math.cos(t)],
        blend: P.rdVary ? P.rdBlend : 0,
      });
      if (now - probeAt > 1500) {
        probeAt = now;
        if (field.maxV() < 0.04) field.sprinkle();
      }
    }
  }

  // 天球：現在時刻なら1秒ごと、指定日時なら変更時に計算し直す
  if (P.ballPat === 5 && (skyDirty || (P.skyMode === "now" && now - skyAt > 1000))) {
    const d = skyDate();
    try { sky = computeSky(d); updateSkyInfo(d); } catch (e) { hint.textContent = "天体の計算に失敗しました：" + String(e); }
    skyAt = now; skyDirty = false;
  }

  const E = eyeFromAngles(S, P.D, 0, 0);   // 画面に正対した固定の視点
  const R = (S.d * S.d / 4 + Math.min(S.h, S.d / 2) ** 2) / (2 * Math.min(S.h, S.d / 2));
  renderer.draw({
    optics: S, eye: E, corrected: true,
    centerPx: [S.cal!.cx, S.cal!.cy], pxPerMm: pxPerMm(), sizePx: [W, H],
    lat: P.lat * Math.PI / 180, lon, pattern: 0,
    bubble: null, ringScale: 1, time: now / 1000, beam: null, eyeball: null,
    light, floor: false, shade: false,
  }, (gl, u) => {
    gl.uniform1f(u.uInnerR, R * P.ratio);
    gl.uniform3f(u.uBx, xb.x, xb.y, xb.z);
    gl.uniform3f(u.uBy, yb.x, yb.y, yb.z);
    gl.uniform3f(u.uBz, zb.x, zb.y, zb.z);
    gl.uniform1i(u.uBallPat, P.ballPat);
    gl.uniform1i(u.uWallPat, P.wallPat);
    gl.uniform1f(u.uShadowK, P.ballPat === 5 ? 0.3 : 1.0);   // 天球は半透明なので影は薄く
    if (P.ballPat === 5 && sky) {
      const flat = (vs: number[][]) => new Float32Array(vs.flat());
      gl.uniform3fv(u.uBodyDir, flat(sky.bodies.map(b => b.dir)));
      gl.uniform3fv(u.uBodyCol, flat(sky.bodies.map(b => b.color)));
      gl.uniform1fv(u.uBodySize, new Float32Array(sky.bodies.map(b => b.size)));
      const asp = sky.aspects.slice(0, 21);
      const pad = (a: number[][], n: number) => { while (a.length < n) a.push([0, 0, 0]); return a; };
      gl.uniform3fv(u.uAspA, flat(pad(asp.map(a => sky!.bodies[a.a].dir), 21)));
      gl.uniform3fv(u.uAspB, flat(pad(asp.map(a => sky!.bodies[a.b].dir), 21)));
      const cols = asp.map(a => { const c = ASPECTS.find(x => x.kind === a.kind)!.color; return [c[0], c[1], c[2], a.exactness]; });
      while (cols.length < 21) cols.push([0, 0, 0, 0]);
      gl.uniform4fv(u.uAspC, new Float32Array(cols.flat()));
      gl.uniform1i(u.uAspN, asp.length);
      gl.uniform1f(u.uBelowDark, P.belowDark);
      gl.uniform3fv(u.uEc0, sky.ec0); gl.uniform3fv(u.uEc90, sky.ec90);
      gl.uniform3fv(u.uEcN, sky.ecN); gl.uniform3fv(u.uNcp, sky.ncp);
    }
    // 鏡面球：カメラ位置・画角・左右の向きは表面モードの設定を使う
    const camOn = P.ballPat === 4 && updateCamTexture(gl);
    gl.uniform1i(u.uCamOn, camOn ? 1 : 0);
    gl.uniform1i(u.uCam, 2);
    if (camOn) {
      const w = camVideo.videoWidth, h = camVideo.videoHeight;
      gl.uniform3f(u.uCamPos, S.camX, S.camY, S.glass);
      gl.uniform1f(u.uCamF, S.fxRatio * Math.max(w, h));
      gl.uniform2f(u.uCamSize, w, h);
      gl.uniform1f(u.uCamFlip, S.flipX ? 1 : -1);
      gl.uniform1f(u.uFaceZ, E.z);
      gl.uniform1f(u.uSpread, P.spread);
      gl.uniform1f(u.uCamSat, P.camSat);
    }
    if (field) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, field.texture);
      gl.uniform1i(u.uField, 1);
      gl.uniform1f(u.uFieldN, field.n);
      gl.activeTexture(gl.TEXTURE0);
    }
  });

  if (now - hudAt > 250) {
    hudAt = now;
    const tiltDeg = Math.acos(Math.max(-1, Math.min(1, target.z))) * 180 / Math.PI;
    const src = !tiltOn ? "（センサー未使用）" : tilt.compass ? " ／ 方位：地磁気" : " ／ 方位：ジャイロ（相対）";
    hud.textContent = `描画${fps.toFixed(0)}fps ／ 端末の傾き ${tiltDeg.toFixed(1)}°${src}`;
  }
  requestAnimationFrame(frame);
}

resize(); sync();
if (P.ballPat === 4) void startCamera();
requestAnimationFrame(frame);
