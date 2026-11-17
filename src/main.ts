import "./style.css";
import { eyeFromAngles, geometry, type Vec3 } from "./optics";
import { Renderer, type FrameUniforms } from "./renderer";
type FrameUniformsEyeball = FrameUniforms["eyeball"];
import { EyeDetector } from "./detector";
import { IRIS_MM, type FaceObs } from "./face";
import { OneEuro } from "./filter";
import { TiltSensor, Bubble } from "./level";
import { EyeballMotion } from "./eyeball";
import { DEFAULTS, load, save, type Settings, type EyeMode } from "./settings";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let S: Settings = load();
const hint = $("hint");

// ---------- 描画 ----------
const canvas = $<HTMLCanvasElement>("gl");
let renderer: Renderer;
try { renderer = new Renderer(canvas); }
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

// ---------- 位置合わせ（ドームの縁に円を合わせる） ----------
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
const up = (e: PointerEvent) => { pts.delete(e.pointerId); last = pts.size ? snap() : null; save(S); };
canvas.addEventListener("pointerup", up);
canvas.addEventListener("pointercancel", up);

// ---------- カメラ追跡 ----------
const video = $<HTMLVideoElement>("cam");
const detector = new EyeDetector(video);
const filt = [new OneEuro(0.6, 0.02), new OneEuro(0.6, 0.02), new OneEuro(0.3, 0.01)];
let targetEye: Vec3 | null = null;   // 検出ごとに更新される目の位置（フィルタ後）
let targetMid: Vec3 | null = null;   // 見る人の両目の中点（眼球モードの視線の的）
const filtMid = [new OneEuro(0.8, 0.03), new OneEuro(0.8, 0.03), new OneEuro(0.4, 0.01)];
let shownEye: Vec3 | null = null;    // 描画に使う目の位置（毎フレーム targetEye へ滑らかに近づける）
let lastObs: FaceObs | null = null;
let trackStatus = "";

/** カメラの観測 → ドーム座標系での視点の位置（mm） */
function eyesFromObs(o: FaceObs): Record<EyeMode, Vec3> {
  const fx = S.fxRatio * Math.max(o.w, o.h);
  const Z = fx * IRIS_MM / o.irisPx;                 // カメラからの奥行き
  const sx = S.flipX ? 1 : -1;                       // フロントカメラ映像の右 = 画面の左（既定）
  // カメラ座標（X 画像の右、Y 画像の下、Z 奥）→ ドーム座標
  const toDome = (X: number, Y: number, Zc: number): Vec3 => ({ x: S.camX + sx * X, y: S.camY - Y, z: S.glass + Zc });
  const cam = (u: number, v: number) => [(u - o.w / 2) * Z / fx, (v - o.h / 2) * Z / fx, Z];
  const A = cam(o.eyes[0].u, o.eyes[0].v), B = cam(o.eyes[1].u, o.eyes[1].v);
  const a = toDome(A[0], A[1], A[2]), b = toDome(B[0], B[1], B[2]);
  const [left, right] = a.x < b.x ? [a, b] : [b, a]; // 画面に向かって左にある方が左目
  const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
  const mid = toDome(M[0], M[1], M[2]);
  // 頭の中心：両目の中点から顔の正面と逆向きに headDepth 下がった点。
  // 顔を左右に振っても（首を軸に回しても）ほとんど動かない
  const n = o.normal, k = S.headDepth;
  const head = toDome(M[0] - n[0] * k, M[1] - n[1] * k, M[2] - n[2] * k);
  return { mid, left, right, head };
}

detector.onStatus = st => { trackStatus = st; };
detector.onObs = (o, t) => {
  if (!o) { trackStatus = "顔が見つかりません"; return; }
  trackStatus = "追跡中";
  lastObs = o;
  const all = eyesFromObs(o);
  const e = all[S.eyeMode];
  const ts = t / 1000;
  targetEye = { x: filt[0].filter(e.x, ts), y: filt[1].filter(e.y, ts), z: filt[2].filter(e.z, ts) };
  targetMid = { x: filtMid[0].filter(all.mid.x, ts), y: filtMid[1].filter(all.mid.y, ts), z: filtMid[2].filter(all.mid.z, ts) };
};

async function startTracking() {
  try {
    filt.forEach(f => f.reset()); filtMid.forEach(f => f.reset()); targetEye = null; targetMid = null; shownEye = null;
    await detector.start();
    S.track = true;
  } catch (e) {
    S.track = false;
    trackStatus = "カメラを起動できませんでした：" + (e instanceof Error ? e.message : String(e));
    detector.stop();
  }
  syncInputs();
}
function stopTracking() {
  detector.stop(); S.track = false; targetEye = null; shownEye = null; trackStatus = ""; syncInputs();
}

// ---------- UI ----------
const units: Record<string, string> = {
  d: "mm", h: "mm", n: "", gap: "mm", glass: "mm", D: "mm", tilt: "°", az: "°", lat: "°", spd: "°/s",
  camX: "mm", camY: "mm", calibD: "mm", gain: "×", headDepth: "mm", levelGain: "×",
  beamBearing: "°", beamElev: "°", northOffset: "°", pupil: "", lightAz: "°", lightElev: "°",
};
type NumKey = "d" | "h" | "n" | "gap" | "glass" | "D" | "tilt" | "az" | "lat" | "spd" | "camX" | "camY" | "calibD" | "gain" | "headDepth" | "levelGain" | "beamBearing" | "beamElev" | "northOffset" | "pupil" | "lightAz" | "lightElev";

function fmt(k: string, v: number) { return (k === "n" || k === "gain" || k === "pupil" ? v.toFixed(2) : String(v)) + units[k]; }

// ---------- 水準器 ----------
const tiltSensor = new TiltSensor();
const bubble = new Bubble();
let tiltOn = false;
let zero1: { x: number; y: number } | null = null;
/** ゼロ点を差し引いた傾き（上向きベクトルの水平成分） */
function tiltNow() { return { x: tiltSensor.up.x - S.levelBias.x, y: tiltSensor.up.y - S.levelBias.y }; }

/** 端末の座標系のベクトルが地球上でどの方位（北から時計回り、度）を向いているか（補正前） */
function deviceToEarthBearing(v: Vec3): number {
  // toDevice の逆を数値で求める代わりに、東・北の単位ベクトルを端末座標に写して内積をとる
  const e = tiltSensor.toDevice({ x: 1, y: 0, z: 0 }), n = tiltSensor.toDevice({ x: 0, y: 1, z: 0 });
  const ve = v.x * e.x + v.y * e.y + v.z * e.z, vn = v.x * n.x + v.y * n.y + v.z * n.z;
  return (Math.atan2(ve, vn) * 180 / Math.PI + 360) % 360;
}

/** 光の指針の向き（ドーム座標）と、石から表面までの長さ */
function beamNow(): { dir: Vec3; len: number } | null {
  const B = (S.beamBearing - S.northOffset) * Math.PI / 180, el = S.beamElev * Math.PI / 180;
  const earth = { x: Math.sin(B) * Math.cos(el), y: Math.cos(B) * Math.cos(el), z: Math.sin(el) };
  // センサーがなければ「端末を水平に置き、上端が北」とみなす
  const d = tiltSensor.active ? tiltSensor.toDevice(earth) : earth;
  const g = geometry(S);
  const O = { x: 0, y: 0, z: g.zb + 0.8 };
  // 石から球面までの距離：|O + t·d − C| = R を解く
  const oc = { x: O.x, y: O.y, z: O.z - g.cz };
  const bq = oc.x * d.x + oc.y * d.y + oc.z * d.z;
  const cq = oc.x * oc.x + oc.y * oc.y + oc.z * oc.z - g.R * g.R;
  const disc = bq * bq - cq;
  if (disc < 0) return null;
  const t = -bq + Math.sqrt(disc);
  const hitZ = O.z + t * d.z;
  if (t <= 0 || hitZ < g.zb) return null;            // 底面より下に向いている（画面に潜る）
  return { dir: d, len: t };
}
function toggle(id: string, on: boolean, onText: string, offText: string) {
  const b = $(id); b.classList.toggle("on", on); b.textContent = on ? onText : offText;
}
function syncInputs() {
  for (const k of Object.keys(units) as NumKey[]) {
    const el = $<HTMLInputElement>(k); el.value = String(S[k]);
    el.parentElement!.querySelector("output")!.textContent = fmt(k, S[k]);
  }
  $<HTMLSelectElement>("n2").value = String(S.n2);
  $<HTMLSelectElement>("pattern").value = String(S.pattern);
  $<HTMLSelectElement>("eyeMode").value = S.eyeMode;
  toggle("bCorr", S.corr, "補正 ON", "補正 OFF");
  toggle("bSpin", S.spin, "自転 ON", "自転 OFF");
  toggle("bTrack", S.track, "追跡を停止", "追跡を開始");
  toggle("bFlip", S.flipX, "左右反転 ON", "左右反転 OFF");
  toggle("bDot", S.showDot, "目のマーカー ON", "目のマーカー OFF");
  toggle("bCamView", S.showCam, "カメラ映像 ON", "カメラ映像 OFF");
  toggle("bTilt", tiltOn, "傾きセンサー 動作中", "傾きセンサーを有効にする");
  toggle("bBubbleAll", S.bubbleAll, "他の模様にも気泡 ON", "他の模様にも気泡 OFF");
  toggle("bLids", S.lids, "まぶた ON", "まぶた OFF");
  toggle("bFloor", S.floor, "床と影 ON", "床と影 OFF");
  toggle("bShade", S.shade, "ドームの陰影 ON", "ドームの陰影 OFF");
  $<HTMLSelectElement>("irisType").value = String(S.irisType);
  video.style.display = S.track && S.showCam ? "block" : "none";
}
for (const k of Object.keys(units) as NumKey[]) {
  $<HTMLInputElement>(k).addEventListener("input", e => {
    S[k] = parseFloat((e.target as HTMLInputElement).value);
    if ((k === "d" || k === "h") && S.h > S.d / 2) S.h = S.d / 2;
    syncInputs();
    save(S);
  });
}
$<HTMLSelectElement>("n2").addEventListener("change", e => { S.n2 = parseFloat((e.target as HTMLSelectElement).value); save(S); });
$<HTMLSelectElement>("pattern").addEventListener("change", e => { S.pattern = parseInt((e.target as HTMLSelectElement).value, 10); save(S); });
$<HTMLSelectElement>("eyeMode").addEventListener("change", e => { S.eyeMode = (e.target as HTMLSelectElement).value as EyeMode; filt.forEach(f => f.reset()); save(S); });
$("bCorr").onclick = () => { S.corr = !S.corr; syncInputs(); save(S); };
$("bSpin").onclick = () => { S.spin = !S.spin; syncInputs(); save(S); };
$("bTrack").onclick = () => { if (S.track) stopTracking(); else void startTracking(); };
$("bFlip").onclick = () => { S.flipX = !S.flipX; filt.forEach(f => f.reset()); syncInputs(); save(S); };
$("bDot").onclick = () => { S.showDot = !S.showDot; syncInputs(); save(S); };
$("bCamView").onclick = () => { S.showCam = !S.showCam; syncInputs(); save(S); };
$("bCal").onclick = () => { calMode = !calMode; $("bCal").classList.toggle("on", calMode); placeRing(); };
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
$("bCamEst").onclick = () => {
  if (!document.fullscreenElement || !S.cal) { hint.textContent = "全画面にしてから押してください（画面上端＝本体の画面上端として推定します）。"; return; }
  // フロントカメラは画面上端の中央、上端から約4mm下にあると仮定
  S.camX = Math.round((W / 2 - S.cal.cx) / pxPerMm() * 2) / 2;
  S.camY = Math.round((S.cal.cy / pxPerMm() + 4) * 2) / 2;
  hint.textContent = `カメラ位置を 横${S.camX}mm・縦${S.camY}mm と推定しました。定規で確かめて微調整してください。`;
  syncInputs(); save(S);
};
$("bCalib").onclick = () => {
  if (!lastObs) { hint.textContent = "顔が検出されていません。追跡を開始し、カメラに顔を向けてください。"; return; }
  const Z = S.calibD - S.glass;
  S.fxRatio = Z * lastObs.irisPx / IRIS_MM / Math.max(lastObs.w, lastObs.h);
  filt.forEach(f => f.reset());
  hint.textContent = `距離を校正しました（係数 ${S.fxRatio.toFixed(3)}）。`;
  save(S);
};
$("bTilt").onclick = async () => {
  if (tiltOn) { tiltSensor.stop(); tiltOn = false; syncInputs(); return; }
  try { await tiltSensor.start(); tiltOn = true; if (S.pattern !== 4 && !S.bubbleAll) { S.pattern = 4; save(S); } }
  catch (e) { hint.textContent = e instanceof Error ? e.message : String(e); }
  syncInputs();
};
$("bBubbleAll").onclick = () => { S.bubbleAll = !S.bubbleAll; syncInputs(); save(S); };
$("bZero1").onclick = () => {
  if (!tiltSensor.active) { hint.textContent = "先に傾きセンサーを有効にしてください。"; return; }
  zero1 = { x: tiltSensor.up.x, y: tiltSensor.up.y };
  hint.textContent = "1回目を記録しました。同じ場所でスマホを 180° 回して「2回目」を押してください。";
};
$("bZero2").onclick = () => {
  if (!zero1) { hint.textContent = "先に 1回目を押してください。"; return; }
  // 置いた面の傾きは 180° 回すと端末から見て逆向きになり、センサーのずれは変わらない。
  // 2回の平均がセンサーのずれ
  S.levelBias = { x: (zero1.x + tiltSensor.up.x) / 2, y: (zero1.y + tiltSensor.up.y) / 2 };
  zero1 = null; save(S);
  hint.textContent = `ゼロ点を合わせました（ずれ ${(Math.hypot(S.levelBias.x, S.levelBias.y) * 180 / Math.PI).toFixed(2)}°）。`;
};
$("bZeroReset").onclick = () => { S.levelBias = { x: 0, y: 0 }; zero1 = null; save(S); hint.textContent = "ゼロ点を初期状態に戻しました。"; };
$<HTMLSelectElement>("irisType").addEventListener("change", e => { S.irisType = parseInt((e.target as HTMLSelectElement).value, 10); save(S); });
$("bLids").onclick = () => { S.lids = !S.lids; syncInputs(); save(S); };
$("bFloor").onclick = () => { S.floor = !S.floor; syncInputs(); save(S); };
$("bShade").onclick = () => { S.shade = !S.shade; syncInputs(); save(S); };
$("bNorthHere").onclick = () => {
  if (!tiltSensor.active) { hint.textContent = "先に「水準器」欄で傾きセンサーを有効にしてください。"; return; }
  // 今の端末上端の水平な向きが「北」になるよう補正する
  const top = deviceToEarthBearing({ x: 0, y: 1, z: 0 });
  S.northOffset = Math.round(((-top + 540) % 360) - 180);
  syncInputs(); save(S);
  hint.textContent = `方位の補正を ${S.northOffset}° にしました。`;
};
$("bImg").onclick = () => $("file").click();
$<HTMLInputElement>("file").addEventListener("change", e => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    const w = Math.min(4096, img.width), h = Math.round(w / 2);
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    renderer.setImage(c);
    S.pattern = 3; syncInputs(); save(S);
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(f);
});
$("bReset").onclick = () => {
  const cal = S.cal, track = S.track;
  S = { ...DEFAULTS, cal, track };
  syncInputs(); save(S);
};

// 画面が消えないように（使えない環境では何もしない）
async function keepAwake() {
  try { if ("wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch { /* 無視 */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void keepAwake(); });
void keepAwake();

// ---------- 描画ループ ----------
const dot = $("dot"), hud = $("hud");
const eyeball = new EyeballMotion();
let lon = 139.7 * Math.PI / 180, prev = performance.now(), hudAt = 0;
let frames = 0, fps = 0, fpsAt = performance.now();

function currentEye(dt: number): Vec3 {
  if (S.track && targetEye) {
    if (!shownEye) shownEye = { ...targetEye };
    const a = 1 - Math.exp(-dt / 0.06);              // 約60msで追いつく
    shownEye.x += (targetEye.x - shownEye.x) * a;
    shownEye.y += (targetEye.y - shownEye.y) * a;
    shownEye.z += (targetEye.z - shownEye.z) * a;
    // 感度：ドーム中心から見た横方向のずれを拡大・縮小する（1.0 が物理的に正しい値）
    return { x: shownEye.x * S.gain, y: shownEye.y * S.gain, z: shownEye.z };
  }
  return eyeFromAngles(S, S.D, S.tilt, S.az);
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  if (S.spin) lon += S.spd * Math.PI / 180 * dt;
  frames++;
  if (now - fpsAt > 1000) { fps = frames * 1000 / (now - fpsAt); frames = 0; fpsAt = now; }

  if (S.track) detector.tick(now);
  const E = currentEye(dt);

  // 気泡：上向きベクトルの水平成分（傾き）の方向へ、傾き×感度の角度だけ頂点からずれる
  let bubbleU: { dir: Vec3; rad: number } | null = null;
  const levelGain = S.pattern === 4 ? S.levelGain : 1;   // 他の模様では本物の気泡と同じ動き
  if (tiltOn && tiltSensor.active && (S.pattern === 4 || S.bubbleAll)) {
    const t = tiltNow();
    const tilt = Math.asin(Math.min(1, Math.hypot(t.x, t.y)));
    const g = geometry(S);
    const rad = 9 * Math.PI / 180;
    const pol = Math.min(tilt * levelGain, Math.max(0, g.amax - rad * 1.2));
    const az = Math.atan2(t.y, t.x);
    bubble.step(pol * Math.cos(az), pol * Math.sin(az), dt);
    const p = Math.hypot(bubble.x, bubble.y), a = Math.atan2(bubble.y, bubble.x);
    bubbleU = { dir: { x: Math.sin(p) * Math.cos(a), y: Math.sin(p) * Math.sin(a), z: Math.cos(p) }, rad };
  }

  // 眼球：眼球（ドームの球）の中心から見た、見る人の目の方向を向く
  let eyeballU: FrameUniformsEyeball = null;
  if (S.pattern === 6) {
    const g = geometry(S);
    const V = S.track && targetMid ? targetMid : E;
    eyeball.update({ x: V.x, y: V.y, z: V.z - g.cz }, dt, 45 * Math.PI / 180);
    eyeballU = { gaze: eyeball.gaze, pupil: S.pupil, irisType: S.irisType, lidOpen: eyeball.lidOpen, lids: S.lids };
  }

  const ppm = pxPerMm();
  const la = S.lightAz * Math.PI / 180, le = S.lightElev * Math.PI / 180;
  renderer.draw({
    light: { x: Math.cos(le) * Math.cos(la), y: Math.cos(le) * Math.sin(la), z: Math.sin(le) },
    floor: S.floor, shade: S.shade,
    eyeball: eyeballU,
    bubble: bubbleU, ringScale: S.levelGain,
    time: now / 1000, beam: S.pattern === 5 ? beamNow() : null,
    optics: S, eye: E, corrected: S.corr,
    centerPx: [S.cal!.cx, S.cal!.cy], pxPerMm: ppm, sizePx: [W, H],
    lat: S.lat * Math.PI / 180, lon, pattern: S.pattern,
  });

  const showDot = S.track && S.showDot && targetEye;
  dot.style.display = showDot ? "block" : "none";
  if (showDot) {
    dot.style.left = (S.cal!.cx + E.x * ppm) + "px";
    dot.style.top = (S.cal!.cy - E.y * ppm) + "px";
  }

  if (now - hudAt > 200) {
    hudAt = now;
    const r = Math.hypot(E.x, E.y);
    const tilt = Math.atan2(r, E.z) * 180 / Math.PI;
    const az = (Math.atan2(E.y, E.x) * 180 / Math.PI + 360) % 360;
    const head = S.track ? `[${trackStatus} 検出${detector.rate.toFixed(0)}/s] ` : "[手動] ";
    let lv = "";
    if (tiltOn && tiltSensor.active) {
      const t = tiltNow();
      lv = ` ／ 端末の傾き ${(Math.asin(Math.min(1, Math.hypot(t.x, t.y))) * 180 / Math.PI).toFixed(2)}°`;
    }
    hud.textContent = `${head}描画${fps.toFixed(0)}fps ／ 視点 x${E.x.toFixed(0)} y${E.y.toFixed(0)} z${E.z.toFixed(0)}mm 傾き${tilt.toFixed(1)}° 方向${az.toFixed(0)}°${lv}`;
  }
  requestAnimationFrame(frame);
}

resize(); syncInputs();
requestAnimationFrame(frame);
