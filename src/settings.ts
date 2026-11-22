import type { OpticsParams } from "./optics";

/** ドームの寸法・素材、画面上の位置、インカメラの設定（端末に保存） */
export interface Settings extends OpticsParams {
  // 画面上のドーム位置（CSS px）
  cal: { cx: number; cy: number; diam: number } | null;
  // インカメラ（鏡面球の映り込み用）
  camX: number; camY: number;   // ドーム中心から見たカメラの位置（mm、x 右・y 上）
  fxRatio: number;              // 焦点距離（ピクセル）÷ 映像の長辺
  flipX: boolean;               // カメラ映像の左右の向き
}

export const DEFAULTS: Settings = {
  d: 28, h: 14, n: 1.53, n2: 1.33, gap: 0, glass: 0.7,
  cal: null,
  camX: 0, camY: 50, fxRatio: 0.57, flipX: false,
};

// 以前の表面モードと同じ保存場所（位置合わせなどをそのまま引き継ぐ）
const KEY = "domeLens.v1";

export function load(): Settings {
  const s: Settings = { ...DEFAULTS };
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (j && typeof j === "object") for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (k in j) (s as unknown as Record<string, unknown>)[k] = j[k];
  } catch { /* 保存領域が使えない環境では既定値で動く */ }
  return s;
}

export function save(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 無視 */ }
}
