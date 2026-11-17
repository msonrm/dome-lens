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
  /** 顔の正面方向（カメラ向き）の単位ベクトル。x: 画像の右、y: 画像の下、z: カメラから遠ざかる向き */
  normal: [number, number, number];
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
  // 虹彩：468 と 473 が中心、469〜472 / 474〜477 がその周囲。
  // 顔を横に向けると横の直径が、うなずくと縦の直径が見かけ上縮むので、大きい方を使う
  const dA = Math.max(dist(469, 471), dist(470, 472));
  const dB = Math.max(dist(474, 476), dist(475, 477));
  // 目頭・目尻：33/133 と 362/263
  const eA = mid(33, 133), eB = mid(362, 263);

  // 顔の向き：両目を結ぶ線と、額→あごの線から面の法線を出す（z は x と同じ尺度）
  const P3 = (i: number) => [L[i].x * w, L[i].y * h, L[i].z * w];
  const eyeL3 = [(P3(33)[0] + P3(133)[0]) / 2, (P3(33)[1] + P3(133)[1]) / 2, (P3(33)[2] + P3(133)[2]) / 2];
  const eyeR3 = [(P3(362)[0] + P3(263)[0]) / 2, (P3(362)[1] + P3(263)[1]) / 2, (P3(362)[2] + P3(263)[2]) / 2];
  let a = [eyeR3[0] - eyeL3[0], eyeR3[1] - eyeL3[1], eyeR3[2] - eyeL3[2]];
  if (a[0] < 0) a = a.map(v => -v);               // 画像の左→右の向きにそろえる
  const f = P3(10), c = P3(152);                  // 額、あご
  const b = [c[0] - f[0], c[1] - f[1], c[2] - f[2]];
  let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  n = n.map(v => -v / nl);                          // a×b はカメラから遠ざかる向きなので反転
  if (n[2] > 0) n = n.map(v => -v);
  return { eyes: [eA, eB], irisPx: (dA + dB) / 2, normal: [n[0], n[1], n[2]], w, h };
}
