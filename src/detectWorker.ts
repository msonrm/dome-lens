// 顔検出を別スレッドで行う（描画を止めないため）
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { createLandmarker, obsFromLandmarks } from "./face";

type Msg = { type: "init" } | { type: "frame"; bitmap: ImageBitmap; t: number };

let lm: FaceLandmarker | null = null;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === "init") {
    try { lm = await createLandmarker(true); post({ type: "ready" }); }
    catch (err) { post({ type: "error", message: err instanceof Error ? err.message : String(err) }); }
    return;
  }
  if (m.type === "frame") {
    const { bitmap, t } = m;
    let obs = null;
    try {
      if (lm) obs = obsFromLandmarks(lm.detectForVideo(bitmap, t).faceLandmarks[0], bitmap.width, bitmap.height);
    } finally { bitmap.close(); }
    post({ type: "obs", obs, t });
  }
};
