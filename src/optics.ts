// 屈折メッシュの計算
//
// 座標系（mm）：画素の面が z=0、x 右・y 上・z 手前（画面から目の方向）。
// ドーム底面の中心が原点の真上にある。
// 下から順に：画素 → カバーガラス（厚み glass）→ 底面の層（厚み gap）→ ドーム。
//
// ドーム表面の各点 S について、目 E → S の光線を屈折させて画素面に着く点 P を求め、
// P を頂点位置、S の球面上の向きをテクスチャ座標にしたメッシュを作る。
// GPU がこれをラスタライズすると「画素 → その画素が見えるドーム表面の点」の対応になる。

export interface OpticsParams {
  d: number;      // ドーム底面の直径
  h: number;      // ドームの高さ
  n: number;      // ドームの屈折率
  n2: number;     // 底面の層（空気・水・油）の屈折率
  gap: number;    // 底面の層の厚み
  glass: number;  // カバーガラスの厚み
}

export interface Vec3 { x: number; y: number; z: number; }

export interface Mesh {
  pos: Float32Array;   // 画素面上の位置 (mm) ×2
  dir: Float32Array;   // ドーム表面の単位方向（球の中心から）×3
  idx: Uint32Array;
}

export const N_GLASS = 1.5;
const NA = 180, NP = 256;

export interface DomeGeometry { a: number; h: number; R: number; zb: number; cz: number; amax: number; }

export function geometry(p: OpticsParams): DomeGeometry {
  const a = p.d / 2;
  const h = Math.min(p.h, a);
  const R = (a * a + h * h) / (2 * h);
  const zb = (p.glass || 0) + p.gap;
  const cz = zb + h - R;
  const amax = Math.acos(Math.max(-1, Math.min(1, (R - h) / R)));
  return { a, h, R, zb, cz, amax };
}

/** スライダーの「距離・傾き・方向」から目の位置を作る（ドーム頂点から測る） */
export function eyeFromAngles(p: OpticsParams, D: number, tiltDeg: number, azDeg: number): Vec3 {
  const g = geometry(p);
  const t = tiltDeg * Math.PI / 180, f = azDeg * Math.PI / 180;
  return { x: D * Math.sin(t) * Math.cos(f), y: D * Math.sin(t) * Math.sin(f), z: g.zb + g.h + D * Math.cos(t) };
}

export function buildMesh(p: OpticsParams, E: Vec3, corrected: boolean): Mesh {
  const { a, R, cz, amax, zb } = geometry(p);
  const tg = p.glass || 0;
  const eta = 1 / p.n;

  const nv = (NA + 1) * (NP + 1);
  const pos = new Float32Array(nv * 2), dir = new Float32Array(nv * 3), ok = new Uint8Array(nv);
  const surf = new Float32Array(nv * 3);
  let k = 0;
  for (let i = 0; i <= NA; i++) {
    const al = amax * i / NA, sa = Math.sin(al), ca = Math.cos(al);
    for (let j = 0; j <= NP; j++, k++) {
      const ph = 2 * Math.PI * j / NP;
      const ux = sa * Math.cos(ph), uy = sa * Math.sin(ph), uz = ca;
      dir[k * 3] = ux; dir[k * 3 + 1] = uy; dir[k * 3 + 2] = uz;
      const Sx = R * ux, Sy = R * uy, Sz = cz + R * uz;
      surf[k * 3] = Sx; surf[k * 3 + 1] = Sy; surf[k * 3 + 2] = Sz;
      if (!corrected) { pos[k * 2] = Sx; pos[k * 2 + 1] = Sy; ok[k] = 1; continue; }

      // 表面での屈折（空気 → ドーム）
      let Ix = Sx - E.x, Iy = Sy - E.y, Iz = Sz - E.z;
      const il = Math.sqrt(Ix * Ix + Iy * Iy + Iz * Iz); Ix /= il; Iy /= il; Iz /= il;
      const cosi = -(Ix * ux + Iy * uy + Iz * uz);
      if (cosi <= 0) continue;                                 // 目から見えない面
      const k1 = 1 - eta * eta * (1 - cosi * cosi);
      if (k1 < 0) continue;
      const m1 = eta * cosi - Math.sqrt(k1);
      const Tx = eta * Ix + m1 * ux, Ty = eta * Iy + m1 * uy, Tz = eta * Iz + m1 * uz;
      if (Tz >= -1e-9) continue;
      const s = (zb - Sz) / Tz;
      const Bx = Sx + s * Tx, By = Sy + s * Ty;
      if (Bx * Bx + By * By > a * a * 1.000001) continue;      // 側面から抜ける

      // 底面から下は平行な層の積み重ね：n·sinθ が保存される
      const sh = Math.sqrt(Tx * Tx + Ty * Ty);
      const inv = p.n * sh;
      const sF = inv / p.n2, sG = inv / N_GLASS;
      if (sF >= 1 || sG >= 1) continue;                        // 全反射：画面が見えない
      let Px = Bx, Py = By;
      if (sh > 1e-9) {
        const run = p.gap * sF / Math.sqrt(1 - sF * sF) + tg * sG / Math.sqrt(1 - sG * sG);
        Px += Tx / sh * run; Py += Ty / sh * run;
      }
      pos[k * 2] = Px; pos[k * 2 + 1] = Py; ok[k] = 1;
    }
  }

  // 三角形の採否：
  // ・裏返った三角形は捨てる（全反射の手前で光線が寝ると画面上の対応が折り返し、
  //   同じ画素が2か所から見える。1画素に2つの絵は出せない）
  // ・画面上で極端に引き伸ばされた三角形も捨てる（全反射寸前の領域）
  const edge2 = (A: number, B: number) => {
    const dx = pos[A * 2] - pos[B * 2], dy = pos[A * 2 + 1] - pos[B * 2 + 1]; return dx * dx + dy * dy;
  };
  const sedge2 = (A: number, B: number) => {
    const dx = surf[A * 3] - surf[B * 3], dy = surf[A * 3 + 1] - surf[B * 3 + 1], dz = surf[A * 3 + 2] - surf[B * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const MAXSTRETCH2 = 8 * 8;
  const good = (A: number, B: number, C: number) => {
    if (!(ok[A] && ok[B] && ok[C])) return false;
    const ar = (pos[B * 2] - pos[A * 2]) * (pos[C * 2 + 1] - pos[A * 2 + 1]) - (pos[C * 2] - pos[A * 2]) * (pos[B * 2 + 1] - pos[A * 2 + 1]);
    if (ar < 0) return false;
    if (ar === 0) return true;  // 頂点の縮退（真上の1点）
    const lim = MAXSTRETCH2 * Math.max(sedge2(A, B), sedge2(B, C), sedge2(C, A)) + 0.04;
    return Math.max(edge2(A, B), edge2(B, C), edge2(C, A)) <= lim;
  };
  const idx = new Uint32Array(NA * NP * 6);
  let ni = 0;
  const W = NP + 1;
  for (let i = 0; i < NA; i++) for (let j = 0; j < NP; j++) {
    const v0 = i * W + j, v1 = v0 + 1, v2 = v0 + W, v3 = v2 + 1;
    if (good(v0, v2, v1)) { idx[ni++] = v0; idx[ni++] = v2; idx[ni++] = v1; }
    if (good(v1, v2, v3)) { idx[ni++] = v1; idx[ni++] = v2; idx[ni++] = v3; }
  }
  return { pos, dir, idx: idx.subarray(0, ni) };
}
