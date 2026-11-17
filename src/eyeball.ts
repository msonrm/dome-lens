// 眼球の動き：見ている人の目に視線を向ける。
// ・目標との角度差が大きいと「サッカード」（素早い跳躍運動）で一気に向きを変える
// ・小さい差はゆっくり追う。ときどき微小な揺れ（マイクロサッカード）
// ・まばたきはランダムな間隔で
import type { Vec3 } from "./optics";

const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** 単位ベクトル g を t の方へ最大 maxAng ラジアン回す */
function rotateToward(g: Vec3, t: Vec3, maxAng: number): Vec3 {
  const c = Math.max(-1, Math.min(1, dot(g, t)));
  const ang = Math.acos(c);
  if (ang <= maxAng || ang < 1e-6) return t;
  const p = norm({ x: t.x - g.x * c, y: t.y - g.y * c, z: t.z - g.z * c });
  const a = maxAng;
  return norm({ x: g.x * Math.cos(a) + p.x * Math.sin(a), y: g.y * Math.cos(a) + p.y * Math.sin(a), z: g.z * Math.cos(a) + p.z * Math.sin(a) });
}

export class EyeballMotion {
  gaze: Vec3 = { x: 0, y: 0, z: 1 };
  lidOpen = 1;
  private saccading = false;
  private micro: Vec3 = { x: 0, y: 0, z: 0 };
  private microAt = 0;
  private blinkAt = 2;
  private blinkT = -1;
  private t = 0;

  /** target：眼球の中心から見た、見つめる相手の方向（単位ベクトルでなくてよい） */
  update(target: Vec3, dt: number, maxAngle: number) {
    this.t += dt;
    // マイクロサッカード：0.4〜1秒ごとに目標を 0.3° 程度ずらす
    if (this.t > this.microAt) {
      const a = 0.3 * Math.PI / 180;
      this.micro = { x: (Math.random() * 2 - 1) * a, y: (Math.random() * 2 - 1) * a, z: 0 };
      this.microAt = this.t + 0.4 + Math.random() * 0.6;
    }
    let tg = norm(target);
    tg = norm({ x: tg.x + this.micro.x, y: tg.y + this.micro.y, z: tg.z });
    // 眼球が回れる範囲に制限
    const pol = Math.acos(Math.max(-1, Math.min(1, tg.z)));
    if (pol > maxAngle) {
      const s = Math.sin(maxAngle) / Math.max(1e-6, Math.hypot(tg.x, tg.y));
      tg = { x: tg.x * s, y: tg.y * s, z: Math.cos(maxAngle) };
    }
    const err = Math.acos(Math.max(-1, Math.min(1, dot(this.gaze, tg))));
    if (!this.saccading && err > 2.5 * Math.PI / 180) {
      this.saccading = true;
      if (err > 15 * Math.PI / 180 && Math.random() < 0.5) this.startBlink(); // 大きく動くときはまばたきを伴いやすい
    }
    if (this.saccading) {
      this.gaze = rotateToward(this.gaze, tg, 500 * Math.PI / 180 * dt);
      if (err < 0.2 * Math.PI / 180) this.saccading = false;
    } else {
      this.gaze = rotateToward(this.gaze, tg, err * Math.min(1, 6 * dt));
    }
    // まばたき
    if (this.blinkT < 0 && this.t > this.blinkAt) this.startBlink();
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const d = 0.2;
      this.lidOpen = 1 - Math.sin(Math.min(1, this.blinkT / d) * Math.PI);
      if (this.blinkT >= d) { this.blinkT = -1; this.lidOpen = 1; this.blinkAt = this.t + 2.5 + Math.random() * 4; }
    }
  }

  private startBlink() { if (this.blinkT < 0) this.blinkT = 0; }
}
