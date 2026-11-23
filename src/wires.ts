// ドームに張った金属線のタッチ入力
//
// 各線はアルミ箔のパッドにつながっていて、パッドは画面に接している。指で線に触れると、
// 指の静電容量が線を通ってパッドに伝わり、画面はパッドの位置をタッチとして検出する。
// パッドはドームのまわりのどこに置いてもよい（位置は登録時に触った場所を使う）。
//
// ・タップ：1つのパッドに触れ、すぐ別のパッドが続かなければ「タップ」。
//   ドームの中心から見たそのパッドの方向へ、球を弾く。
// ・なぞり：別のパッドへ続けて触れたら「なぞり」。前のパッドから次のパッドへ動いた向きに、
//   2つのパッドがドームの中心に対してなす角度÷時間の速さで回す。

export interface Pad { x: number; y: number; }   // 画面上の位置（CSS px）
export interface Dir2 { x: number; y: number; }  // 画面上の向き（単位ベクトル、y は上向き）

const TAP_WAIT = 0.28;   // この時間内に別のパッドが続かなければタップ（秒）
const SWIPE_GAP = 0.7;   // なぞりとみなすパッド間の最大の時間（秒）

export class WireInput {
  pads: Pad[] = [];
  registering = false;
  /** ドームの中心（画面上、CSS px） */
  center: Pad = { x: 0, y: 0 };
  /** 回す勢い：dir の向きへ球の頂上が転がるように、角速度 omega（ラジアン/秒）を加える */
  onImpulse: (dir: Dir2, omega: number, kind: "tap" | "swipe") => void = () => {};
  /** パッドが反応したとき（表示用） */
  onPad: (k: number) => void = () => {};
  private last: { k: number; t: number } | null = null;
  private pendingTap: ReturnType<typeof setTimeout> | null = null;
  /** タップで加える角速度（ラジアン/秒） */
  tapOmega = 5;

  /** タッチ位置に一番近いパッド（離れすぎていれば -1） */
  padAt(x: number, y: number): number {
    if (!this.pads.length) return -1;
    let best = -1, bd = Infinity;
    this.pads.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i; } });
    let minGap = Infinity;
    for (let i = 0; i < this.pads.length; i++) for (let j = i + 1; j < this.pads.length; j++) {
      minGap = Math.min(minGap, Math.hypot(this.pads[i].x - this.pads[j].x, this.pads[i].y - this.pads[j].y));
    }
    const lim = Math.max(15, Math.min(45, isFinite(minGap) ? minGap * 0.5 : 45));
    return bd <= lim ? best : -1;
  }

  /** ドームの中心からパッド k への向き（画面上、y 上向き） */
  private dirOf(k: number): Dir2 {
    const dx = this.pads[k].x - this.center.x, dy = -(this.pads[k].y - this.center.y);
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
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
    const prev = this.last;
    this.last = { k, t };
    if (prev && prev.k !== k && t - prev.t < SWIPE_GAP) {
      // なぞり：保留中のタップは取り消す
      if (this.pendingTap) { clearTimeout(this.pendingTap); this.pendingTap = null; }
      const a = this.dirOf(prev.k), b = this.dirOf(k);
      const ang = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
      const mx = this.pads[k].x - this.pads[prev.k].x, my = -(this.pads[k].y - this.pads[prev.k].y);
      const ml = Math.hypot(mx, my) || 1;
      const omega = Math.min(4 * Math.PI, Math.max(ang, 0.15) / Math.max(t - prev.t, 0.03));
      this.onImpulse({ x: mx / ml, y: my / ml }, omega, "swipe");
      return { kind: "pad", k };
    }
    // タップかもしれない：少し待って、別のパッドが続かなければ弾く
    if (this.pendingTap) clearTimeout(this.pendingTap);
    this.pendingTap = setTimeout(() => {
      this.pendingTap = null;
      if (this.last && this.last.k === k && this.last.t === t) this.onImpulse(this.dirOf(k), this.tapOmega, "tap");
    }, TAP_WAIT * 1000);
    return { kind: "pad", k };
  }
}

type V3 = { x: number; y: number; z: number };

/** 3次元の回転：v を単位軸 k のまわりに角 a だけ回す（ロドリゲスの公式） */
export function rotateAbout(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = k.x * v.x + k.y * v.y + k.z * v.z;
  const cx = k.y * v.z - k.z * v.y, cy = k.z * v.x - k.x * v.z, cz = k.x * v.y - k.y * v.x;
  return {
    x: v.x * c + cx * s + k.x * kv * (1 - c),
    y: v.y * c + cy * s + k.y * kv * (1 - c),
    z: v.z * c + cz * s + k.z * kv * (1 - c),
  };
}

/** 回転ベクトル（軸×角度、画面の面内）で v を回す */
export function rotateByVec(v: V3, rx: number, ry: number): V3 {
  const a = Math.hypot(rx, ry);
  if (a < 1e-7) return v;
  return rotateAbout(v, { x: rx / a, y: ry / a, z: 0 }, a);
}
