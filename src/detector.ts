// フロントカメラの映像を顔検出に回す。
// 基本はワーカーで検出し、ワーカーが使えない環境ではメインスレッドで間引いて検出する。
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { createLandmarker, obsFromLandmarks, type FaceObs } from "./face";

export class EyeDetector {
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private mainLm: FaceLandmarker | null = null;
  private ready = false;
  private busy = false;
  private lastSent = 0;
  private lastVideoTime = -1;
  /** 検出結果（顔なしは null）。t は検出に回したフレームの時刻 */
  onObs: (o: FaceObs | null, t: number) => void = () => {};
  onStatus: (s: string) => void = () => {};
  /** 1秒あたりの検出回数（表示用） */
  rate = 0;
  private count = 0; private rateAt = 0;

  constructor(readonly video: HTMLVideoElement) {}

  get running() { return this.stream !== null; }

  async start() {
    this.onStatus("カメラを起動中…");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    const v = this.video;
    v.srcObject = this.stream; v.muted = true; v.playsInline = true;
    await v.play();
    if (this.ready) { this.onStatus("追跡中"); return; }
    this.onStatus("顔検出モデルを読み込み中…");
    try {
      await this.startWorker();
    } catch {
      this.worker?.terminate(); this.worker = null;
      this.onStatus("顔検出モデルを読み込み中…（メインスレッド）");
      this.mainLm = await createLandmarker(false);
      this.ready = true;
    }
    this.onStatus("追跡中");
  }

  private startWorker() {
    return new Promise<void>((resolve, reject) => {
      const w = new Worker(new URL("./detectWorker.ts", import.meta.url), { type: "module" });
      this.worker = w;
      w.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === "ready") { this.ready = true; resolve(); }
        else if (m.type === "error") reject(new Error(m.message));
        else if (m.type === "obs") { this.busy = false; this.tally(); this.onObs(m.obs, m.t); }
      };
      w.onerror = ev => reject(new Error(ev.message || "worker error"));
      w.postMessage({ type: "init" });
    });
  }

  private tally() {
    this.count++;
    const now = performance.now();
    if (now - this.rateAt > 1000) { this.rate = this.count * 1000 / (now - this.rateAt); this.count = 0; this.rateAt = now; }
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.busy = false;
  }

  /** 毎フレーム呼ぶ。準備ができていて手が空いていれば、新しい映像フレームを検出に回す */
  tick(now: number) {
    const v = this.video;
    if (!this.ready || !this.stream || this.busy || v.readyState < 2) return;
    if (v.currentTime === this.lastVideoTime) return;
    if (this.worker) {
      if (now - this.lastSent < 30) return;
      this.lastSent = now; this.lastVideoTime = v.currentTime; this.busy = true;
      createImageBitmap(v).then(
        bmp => this.worker!.postMessage({ type: "frame", bitmap: bmp, t: now }, [bmp]),
        () => { this.busy = false; },
      );
    } else if (this.mainLm) {
      // メインスレッドでは描画を優先して 15回/秒程度に抑える
      if (now - this.lastSent < 66) return;
      this.lastSent = now; this.lastVideoTime = v.currentTime;
      const res = this.mainLm.detectForVideo(v, now);
      this.tally();
      this.onObs(obsFromLandmarks(res.faceLandmarks[0], v.videoWidth, v.videoHeight), now);
    }
  }
}
