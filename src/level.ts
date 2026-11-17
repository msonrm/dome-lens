// 傾きセンサー（水準器用）
//
// DeviceOrientation の beta / gamma から「上向き」ベクトルを端末の座標系で求める。
// 端末の座標系：x 画面の右、y 画面の上、z 画面から手前（ドームの座標系と同じ）。
// 加速度センサーの値は iOS と Android で符号が逆になる場合があるため、
// 仕様で向きが決まっている DeviceOrientation を使う。

export interface Tilt { x: number; y: number; }   // 上向きベクトルの水平成分（≒ 傾きのラジアン）

export class TiltSensor {
  up = { x: 0, y: 0, z: 1 };
  active = false;
  private handler = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
    let x = -Math.sin(g) * Math.cos(b), y = Math.sin(b);
    const z = Math.cos(b) * Math.cos(g);
    // 画面が回転している場合（横向き表示）は、画面の座標系に合わせて回す
    const ang = (screen.orientation?.angle ?? 0) * Math.PI / 180;
    if (ang) { const c = Math.cos(ang), s = Math.sin(ang); [x, y] = [c * x + s * y, -s * x + c * y]; }
    this.up = { x, y, z };
    this.active = true;
  };

  /** ボタンを押したときに呼ぶ（iOS / iPadOS は許可ダイアログが必要） */
  async start(): Promise<void> {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
    if (typeof DOE.requestPermission === "function") {
      const r = await DOE.requestPermission();
      if (r !== "granted") throw new Error("傾きセンサーの使用が許可されませんでした");
    }
    window.addEventListener("deviceorientation", this.handler);
  }

  stop() { window.removeEventListener("deviceorientation", this.handler); this.active = false; }
}

/** 気泡の動き：バネとダンパーで目標位置に追従させる（液体の中の気泡らしい遅れ） */
export class Bubble {
  x = 0; y = 0; vx = 0; vy = 0;
  step(tx: number, ty: number, dt: number, omega = 14, zeta = 0.8) {
    // フレームが遅れても発散しないよう、細かい刻みで積分する
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n; i++) {
      const ax = omega * omega * (tx - this.x) - 2 * zeta * omega * this.vx;
      const ay = omega * omega * (ty - this.y) - 2 * zeta * omega * this.vy;
      this.vx += ax * h; this.vy += ay * h;
      this.x += this.vx * h; this.y += this.vy * h;
    }
  }
}
