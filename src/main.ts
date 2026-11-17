import "./style.css";
import { buildMesh, eyeFromAngles, type Mesh, type Vec3 } from "./optics";
import { Renderer } from "./renderer";
import { FaceTracker, IRIS_MM, type FaceObs } from "./tracker";
import { OneEuro } from "./filter";
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
const tracker = new FaceTracker(video);
const filt = [new OneEuro(1.0, 0.03), new OneEuro(1.0, 0.03), new OneEuro(1.0, 0.03)];
let trackedEye: Vec3 | null = null;
let lastObs: FaceObs | null = null;
let trackStatus = "";

/** カメラの観測 → ドーム座標系での目の位置（mm） */
function eyesFromObs(o: FaceObs): { mid: Vec3; left: Vec3; right: Vec3 } {
  const fx = S.fxRatio * Math.max(o.w, o.h);
  const Z = fx * IRIS_MM / o.irisPx;                 // カメラからの奥行き
  const sx = S.flipX ? 1 : -1;                       // フロントカメラ映像の右 = 画面の左（既定）
  const conv = (u: number, v: number): Vec3 => ({
    x: S.camX + sx * (u - o.w / 2) * Z / fx,
    y: S.camY - (v - o.h / 2) * Z / fx,
    z: S.glass + Z,
  });
  const a = conv(o.eyes[0].u, o.eyes[0].v), b = conv(o.eyes[1].u, o.eyes[1].v);
  const [left, right] = a.x < b.x ? [a, b] : [b, a]; // 画面に向かって左にある方が左目
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  return { mid, left, right };
}

async function startTracking() {
  try {
    await tracker.start(s => { trackStatus = s; });
    S.track = true;
    filt.forEach(f => f.reset());
  } catch (e) {
    S.track = false;
    trackStatus = "カメラを起動できませんでした：" + (e instanceof Error ? e.message : String(e));
    tracker.stop();
  }
  syncInputs();
}
function stopTracking() {
  tracker.stop(); S.track = false; trackedEye = null; trackStatus = ""; syncInputs();
}

// ---------- UI ----------
const units: Record<string, string> = {
  d: "mm", h: "mm", n: "", gap: "mm", glass: "mm", D: "mm", tilt: "°", az: "°", lat: "°", spd: "°/s",
  camX: "mm", camY: "mm", calibD: "mm",
};
const meshKeys = new Set(["d", "h", "n", "gap", "glass", "D", "tilt", "az"]);
type NumKey = "d" | "h" | "n" | "gap" | "glass" | "D" | "tilt" | "az" | "lat" | "spd" | "camX" | "camY" | "calibD";

let meshDirty = true;
function fmt(k: string, v: number) { return (k === "n" ? v.toFixed(2) : String(v)) + units[k]; }
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
  video.style.display = S.track && S.showCam ? "block" : "none";
}
for (const k of Object.keys(units) as NumKey[]) {
  $<HTMLInputElement>(k).addEventListener("input", e => {
    S[k] = parseFloat((e.target as HTMLInputElement).value);
    if ((k === "d" || k === "h") && S.h > S.d / 2) S.h = S.d / 2;
    syncInputs();
    if (meshKeys.has(k)) meshDirty = true;
    save(S);
  });
}
$<HTMLSelectElement>("n2").addEventListener("change", e => { S.n2 = parseFloat((e.target as HTMLSelectElement).value); meshDirty = true; save(S); });
$<HTMLSelectElement>("pattern").addEventListener("change", e => { S.pattern = parseInt((e.target as HTMLSelectElement).value, 10); save(S); });
$<HTMLSelectElement>("eyeMode").addEventListener("change", e => { S.eyeMode = (e.target as HTMLSelectElement).value as EyeMode; filt.forEach(f => f.reset()); save(S); });
$("bCorr").onclick = () => { S.corr = !S.corr; meshDirty = true; syncInputs(); save(S); };
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
  meshDirty = true; syncInputs(); save(S);
};

// 画面が消えないように（使えない環境では何もしない）
async function keepAwake() {
  try { if ("wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch { /* 無視 */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void keepAwake(); });
void keepAwake();

// ---------- メッシュ計算（ワーカー、使えなければ同期） ----------
let builtEye: Vec3 | null = null;
let busy = false, reqId = 0;
let worker: Worker | null = null;
try {
  worker = new Worker(new URL("./meshWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; m: Mesh }>) => {
    renderer.setMesh(e.data.m);
    busy = false;
  };
  worker.onerror = () => { worker = null; busy = false; };
} catch { worker = null; }

function requestMesh(E: Vec3) {
  const p = { d: S.d, h: S.h, n: S.n, n2: S.n2, gap: S.gap, glass: S.glass };
  builtEye = E; meshDirty = false;
  if (worker) { busy = true; worker.postMessage({ id: ++reqId, p, E, corrected: S.corr }); }
  else renderer.setMesh(buildMesh(p, E, S.corr));
}

// ---------- 描画ループ ----------
const dot = $("dot"), hud = $("hud");
let lon = 139.7 * Math.PI / 180, prev = performance.now(), hudAt = 0;

function currentEye(now: number): Vec3 {
  if (S.track && tracker.running) {
    const o = tracker.detect(now);
    if (o) {
      lastObs = o;
      const e = eyesFromObs(o)[S.eyeMode];
      const t = now / 1000;
      trackedEye = { x: filt[0].filter(e.x, t), y: filt[1].filter(e.y, t), z: filt[2].filter(e.z, t) };
      trackStatus = "追跡中";
    } else if (video.readyState >= 2) {
      trackStatus = "顔が見つかりません";
    }
    if (trackedEye) return trackedEye;
  }
  return eyeFromAngles(S, S.D, S.tilt, S.az);
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
  if (S.spin) lon += S.spd * Math.PI / 180 * dt;

  const E = currentEye(now);
  if (!busy && (meshDirty || !builtEye || Math.hypot(E.x - builtEye.x, E.y - builtEye.y, E.z - builtEye.z) > 0.2)) {
    requestMesh(E);
  }

  const ppm = pxPerMm();
  renderer.draw({
    centerPx: [S.cal!.cx, S.cal!.cy], pxPerMm: ppm, sizePx: [W, H],
    lat: S.lat * Math.PI / 180, lon, pattern: S.pattern,
  });

  const showDot = S.track && S.showDot && trackedEye;
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
    const head = S.track ? `[${trackStatus}] ` : "[手動] ";
    hud.textContent = `${head}目 x${E.x.toFixed(0)} y${E.y.toFixed(0)} z${E.z.toFixed(0)}mm ／ 傾き${tilt.toFixed(1)}° 方向${az.toFixed(0)}°`;
  }
  requestAnimationFrame(frame);
}

resize(); syncInputs();
requestAnimationFrame(frame);
