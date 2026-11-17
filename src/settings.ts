import type { OpticsParams } from "./optics";

export type EyeMode = "mid" | "left" | "right" | "head";

export interface Settings extends OpticsParams {
  // 手動の視点
  D: number; tilt: number; az: number;
  // 表示
  lat: number; spd: number; pattern: number; corr: boolean; spin: boolean;
  // 画面上のドーム位置（CSS px）
  cal: { cx: number; cy: number; diam: number } | null;
  // カメラ追跡
  track: boolean;
  eyeMode: EyeMode;
  camX: number; camY: number;   // ドーム中心から見たカメラの位置（mm、x 右・y 上）
  fxRatio: number;              // 焦点距離（ピクセル）÷ 映像の長辺
  flipX: boolean;               // カメラ映像の左右の向き
  calibD: number;               // 距離校正で使う実測距離（mm）
  gain: number;
  headDepth: number;            // 「頭の中心」モードで、両目の中点から頭の回転軸までの奥行き（mm）                 // 感度（横方向のずれの倍率。1.0 が物理的に正しい値）
  showCam: boolean;
  showDot: boolean;
  // 水準器
  levelGain: number;            // 気泡の感度（傾き1°で気泡がドーム上を何度動くか）
  levelBias: { x: number; y: number };   // センサーのゼロ点のずれ
  bubbleAll: boolean;           // 水準器以外の模様にも気泡を重ねる
  // 光の指針
  beamBearing: number;          // 指す方位（北から時計回り、度）
  beamElev: number;             // 仰角（度）
  northOffset: number;          // 方位の補正（度）。磁北と真北のずれや、方位センサーがない端末用
}

export const DEFAULTS: Settings = {
  d: 28, h: 14, n: 1.53, n2: 1.33, gap: 0, glass: 0.7,
  D: 300, tilt: 0, az: 90,
  lat: 35, spd: 12, pattern: 0, corr: true, spin: true,
  cal: null,
  track: false, eyeMode: "head",
  camX: 0, camY: 50, fxRatio: 0.57, flipX: false, calibD: 300, gain: 1, headDepth: 90,
  showCam: false, showDot: true,
  levelGain: 15, levelBias: { x: 0, y: 0 }, bubbleAll: false,
  beamBearing: 0, beamElev: 20, northOffset: 0,
};

const KEY = "domeLens.v1";

export function load(): Settings {
  const s: Settings = { ...DEFAULTS };
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (j && typeof j === "object") Object.assign(s, j);
  } catch { /* 保存領域が使えない環境では既定値で動く */ }
  s.track = false; // カメラは毎回ユーザーの操作で起動する
  return s;
}

export function save(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 無視 */ }
}
