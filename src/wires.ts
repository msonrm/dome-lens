// ドームの経線に沿って張った金属線のタッチ入力
//
// 各線はアルミ箔のパッドにつながっていて、パッドは画面に接している。指で線に触れると、
// 指の静電容量が線を通ってパッドに伝わり、画面はパッドの位置をタッチとして検出する。
// 線を横に順になぞると、パッドのタッチが順に起きるので、その順番と間隔から
// なぞった向きと角速度を求める。

export interface Pad { x: number; y: number; }   // 画面上の位置（CSS px）

export class WireInput {
  pads: Pad[] = [];
  registering = false;
  /** なぞりを検出したとき：角速度（ラジアン/秒、左→右が正） */
  onSwipe: (omega: number) => void = () => {};
  /** パッドが反応したとき（表示用） */
  onPad: (k: number) => void = () => {};
  private last: { k: number; t: number } | null = null;

  /** 線の間隔（角度）：本数 N の経線が半球を等分している前提 */
  get spacing() { return Math.PI / (this.pads.length + 1); }

  /** タッチ位置に一番近いパッド（離れすぎていれば -1） */
  padAt(x: number, y: number): number {
    if (!this.pads.length) return -1;
    let best = -1, bd = Infinity;
    this.pads.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i; } });
    // 隣のパッドとの距離の半分、ただし 15〜45px の範囲を受け付ける
    let minGap = Infinity;
    for (let i = 0; i < this.pads.length; i++) for (let j = i + 1; j < this.pads.length; j++) {
      minGap = Math.min(minGap, Math.hypot(this.pads[i].x - this.pads[j].x, this.pads[i].y - this.pads[j].y));
    }
    const lim = Math.max(15, Math.min(45, isFinite(minGap) ? minGap * 0.5 : 45));
    return bd <= lim ? best : -1;
  }

  /** 画面へのタッチ（pointerdown）を渡す。登録中ならパッドとして記録する */
  touch(x: number, y: number, tMs: number): { kind: "register" | "pad" | "none"; k: number } {
    if (this.registering) {
      if (this.pads.some(p => Math.hypot(p.x - x, p.y - y) < 15)) return { kind: "none", k: -1 };
      this.pads.push({ x, y });
      return { kind: "register", k: this.pads.length - 1 };
    }
    const k = this.padAt(x, y);
    if (k < 0) return { kind: "none", k };
    this.onPad(k);
    const t = tMs / 1000;
    if (this.last && this.last.k !== k && t - this.last.t < 0.7) {
      const steps = k - this.last.k;
      const dt = Math.max(t - this.last.t, 0.03);
      const omega = Math.max(-4 * Math.PI, Math.min(4 * Math.PI, steps * this.spacing / dt));
      this.onSwipe(omega);
    }
    this.last = { k, t };
    return { kind: "pad", k };
  }
}

/** 3次元の回転：単位ベクトル v を軸 k のまわりに角 a だけ回す（ロドリゲスの公式） */
export function rotateAbout(v: { x: number; y: number; z: number }, k: { x: number; y: number; z: number }, a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = k.x * v.x + k.y * v.y + k.z * v.z;
  const cx = k.y * v.z - k.z * v.y, cy = k.z * v.x - k.x * v.z, cz = k.x * v.y - k.y * v.x;
  return {
    x: v.x * c + cx * s + k.x * kv * (1 - c),
    y: v.y * c + cy * s + k.y * kv * (1 - c),
    z: v.z * c + cz * s + k.z * kv * (1 - c),
  };
}
