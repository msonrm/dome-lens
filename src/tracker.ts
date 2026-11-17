// フロントカメラで目の位置を取る（MediaPipe Face Landmarker の虹彩ランドマーク）
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const VERSION = "1.2.3";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** 虹彩の直径。人によらずほぼ一定（約11.7mm）なので距離の物差しに使える */
export const IRIS_MM = 11.7;

export interface EyeObs { u: number; v: number; }       // 画像上の虹彩中心（ピクセル）
export interface FaceObs {
  eyes: [EyeObs, EyeObs];
  irisPx: number;    // 虹彩の直径（ピクセル、両目の平均）
  w: number; h: number;
}

export class FaceTracker {
  readonly video: HTMLVideoElement;
  private lm: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private lastTime = -1;
  private last: FaceObs | null = null;

  constructor(video: HTMLVideoElement) { this.video = video; }

  get running() { return this.stream !== null; }

  async start(onStatus: (s: string) => void) {
    onStatus("カメラを起動中…");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    if (!this.lm) {
      onStatus("顔検出モデルを読み込み中…");
      const fs = await FilesetResolver.forVisionTasks(WASM);
      const opts = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO" as const,
        numFaces: 1,
      });
      try { this.lm = await FaceLandmarker.createFromOptions(fs, opts("GPU")); }
      catch { this.lm = await FaceLandmarker.createFromOptions(fs, opts("CPU")); }
    }
    onStatus("追跡中");
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.last = null; this.lastTime = -1;
  }

  /** 新しいフレームがあれば検出して返す。顔が見つからなければ null */
  detect(nowMs: number): FaceObs | null {
    const v = this.video;
    if (!this.lm || !this.stream || v.readyState < 2) return null;
    if (v.currentTime === this.lastTime) return this.last;
    this.lastTime = v.currentTime;
    const res = this.lm.detectForVideo(v, nowMs);
    const L = res.faceLandmarks[0];
    if (!L || L.length < 478) { this.last = null; return null; }
    const w = v.videoWidth, h = v.videoHeight;
    const P = (i: number) => ({ x: L[i].x * w, y: L[i].y * h });
    const dist = (i: number, j: number) => { const a = P(i), b = P(j); return Math.hypot(a.x - b.x, a.y - b.y); };
    // 468: 片方の虹彩中心（469〜472 が周囲）、473: もう片方（474〜477 が周囲）
    const dA = (dist(469, 471) + dist(470, 472)) / 2;
    const dB = (dist(474, 476) + dist(475, 477)) / 2;
    const cA = P(468), cB = P(473);
    this.last = { eyes: [{ u: cA.x, v: cA.y }, { u: cB.x, v: cB.y }], irisPx: (dA + dB) / 2, w, h };
    return this.last;
  }
}
