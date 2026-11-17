// 屈折メッシュの計算を別スレッドで行う（描画とカメラ検出を止めないため）
import { buildMesh, type OpticsParams, type Vec3 } from "./optics";

interface Req { id: number; p: OpticsParams; E: Vec3; corrected: boolean; }

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, p, E, corrected } = e.data;
  const m = buildMesh(p, E, corrected);
  (self as unknown as Worker).postMessage({ id, m }, [m.pos.buffer, m.dir.buffer, m.idx.buffer]);
};
