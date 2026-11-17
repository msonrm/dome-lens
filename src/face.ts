// MediaPipe Face Landmarker の共通部分（メインスレッドとワーカーの両方で使う）
import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from "@mediapipe/tasks-vision";

const VERSION = "1.2.3";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** 虹彩の直径。人によらずほぼ一定（約11.7mm）なので距離の物差しに使える */
export const IRIS_MM = 11.7;

export interface EyeObs { u: number; v: number; }       // 画像上の目の位置（ピクセル）
export interface FaceObs {
  eyes: [EyeObs, EyeObs];
  irisPx: number;    // 虹彩の直径（ピクセル、両目の平均）
  w: number; h: number;
}

export async function createLandmarker(inWorker: boolean): Promise<FaceLandmarker> {
  const fs = await FilesetResolver.forVisionTasks(WASM, inWorker);
  const opts = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: "VIDEO" as const,
    numFaces: 1,
  });
  // ワーカー内は CPU で動かす（GPU は描画と取り合いになるため）
  if (inWorker) return FaceLandmarker.createFromOptions(fs, opts("CPU"));
  try { return await FaceLandmarker.createFromOptions(fs, opts("GPU")); }
  catch { return FaceLandmarker.createFromOptions(fs, opts("CPU")); }
}

/**
 * ランドマーク → 観測値。
 * 目の位置には「目頭と目尻の中点」を使う。虹彩の中心は視線の向きで動いてしまうが、
 * 目頭・目尻は眼球の回転では動かないため、視点の位置としてより安定する。
 */
export function obsFromLandmarks(L: NormalizedLandmark[] | undefined, w: number, h: number): FaceObs | null {
  if (!L || L.length < 478) return null;
  const P = (i: number) => ({ x: L[i].x * w, y: L[i].y * h });
  const dist = (i: number, j: number) => { const a = P(i), b = P(j); return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid = (i: number, j: number) => { const a = P(i), b = P(j); return { u: (a.x + b.x) / 2, v: (a.y + b.y) / 2 }; };
  // 虹彩：468 と 473 が中心、469〜472 / 474〜477 がその周囲
  const dA = (dist(469, 471) + dist(470, 472)) / 2;
  const dB = (dist(474, 476) + dist(475, 477)) / 2;
  // 目頭・目尻：33/133 と 362/263
  return { eyes: [mid(33, 133), mid(362, 263)], irisPx: (dA + dB) / 2, w, h };
}
