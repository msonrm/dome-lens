// 傾きセンサー（水準器用）
//
// DeviceOrientation の beta / gamma から「上向き」ベクトルを端末の座標系で求める。
// 端末の座標系：x 画面の右、y 画面の上、z 画面から手前（ドームの座標系と同じ）。
// 加速度センサーの値は iOS と Android で符号が逆になる場合があるため、
// 仕様で向きが決まっている DeviceOrientation を使う。

export interface Tilt { x: number; y: number; }   // 上向きベクトルの水平成分（≒ 傾きのラジアン）

type V3 = { x: number; y: number; z: number };

export class TiltSensor {
  up: V3 = { x: 0, y: 0, z: 1 };
  active = false;
  /** 方位が取れているか（北を基準にした alpha） */
  compass = false;
  private a = 0; private b = 0; private g = 0;   // ラジアン
  private gotAbsolute = false;

  private update(alphaDeg: number | null, betaDeg: number, gammaDeg: number, absolute: boolean) {
    this.b = betaDeg * Math.PI / 180; this.g = gammaDeg * Math.PI / 180;
    if (alphaDeg !== null) {
      if (absolute) { this.a = alphaDeg * Math.PI / 180; this.compass = true; }
      else if (!this.gotAbsolute) this.a = alphaDeg * Math.PI / 180;
    }
    this.up = this.toDevice({ x: 0, y: 0, z: 1 });
    this.active = true;
  }

  /**
   * 地球の座標系（x 東、y 北、z 上）のベクトルを端末の座標系に直す。
   * 端末→地球の回転は R = Rz(α)·Rx(β)·Ry(γ)（W3C の定義）なので、その転置をかける。
   */
  toDevice(v: V3): V3 {
    const ca = Math.cos(this.a), sa = Math.sin(this.a), cb = Math.cos(this.b), sb = Math.sin(this.b), cg = Math.cos(this.g), sg = Math.sin(this.g);
    // Rz^T
    let x = ca * v.x + sa * v.y, y = -sa * v.x + ca * v.y, z = v.z;
    // Rx^T
    [y, z] = [cb * y + sb * z, -sb * y + cb * z];
    // Ry^T
    [x, z] = [cg * x - sg * z, sg * x + cg * z];
    // 画面が回転している場合（横向き表示）は、画面の座標系に合わせて回す
    const ang = (screen.orientation?.angle ?? 0) * Math.PI / 180;
    if (ang) { const c = Math.cos(ang), s = Math.sin(ang); [x, y] = [c * x + s * y, -s * x + c * y]; }
    return { x, y, z };
  }

  private handler = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    // iOS / iPadOS：方位は webkitCompassHeading（北から時計回り）。alpha は反時計回りなので符号を反転
    const heading = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
    if (typeof heading === "number" && !Number.isNaN(heading)) this.update(360 - heading, e.beta, e.gamma, true);
    else this.update(e.alpha, e.beta, e.gamma, e.absolute === true);
  };
  // Android Chrome：北を基準にした alpha は deviceorientationabsolute で届く
  private absHandler = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null || e.alpha === null) return;
    this.gotAbsolute = true;
    this.update(e.alpha, e.beta, e.gamma, true);
  };

  /** ボタンを押したときに呼ぶ（iOS / iPadOS は許可ダイアログが必要） */
  async start(): Promise<void> {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
    if (typeof DOE.requestPermission === "function") {
      const r = await DOE.requestPermission();
      if (r !== "granted") throw new Error("傾きセンサーの使用が許可されませんでした");
    }
    window.addEventListener("deviceorientation", this.handler);
    window.addEventListener("deviceorientationabsolute", this.absHandler as EventListener);
  }

  stop() {
    window.removeEventListener("deviceorientation", this.handler);
    window.removeEventListener("deviceorientationabsolute", this.absHandler as EventListener);
    this.active = false;
  }
}
