// ガラス球モードのフラグメントシェーダ
//
// 見立て：薄いガラスの殻の球（半径 R）の中が空気で、中心を共有する不透明な小球（半径 uInnerR）が浮かび、
// その奥に殻の下半分の内壁が見える。画面はちょうど球の中心の高さ（ドームの底面）にあり、
// 下半分は画面の向こうにあるとみなす。
//
// 頂点シェーダが求めた「ドーム表面の点 vS」から、目からの視線をまっすぐ進め（画面の面は素通り）、
// 小球か内壁に当てて色を決める。
// 座標はすべて端末の座標系（mm、x 右・y 上・z 手前）。

import { CUBE_GLSL } from "./rd";

export const SPHERE_FS = `#version 300 es
precision highp float;
${CUBE_GLSL}
uniform sampler2D uField; uniform float uFieldN;   // 反応拡散の場（キューブスフィア）
in vec3 vDir; in vec3 vS; in vec3 vT;
uniform float uR, uCz, uZb;
uniform float uInnerR;
uniform vec3 uBx, uBy, uBz;          // 小球の座標軸（端末座標）。uBz が重力と逆の「上」
uniform float uLat, uLon;            // 模様の向き：上に来る緯度、経度（自転）
uniform int uBallPat;                // 0 経緯線、1 チェッカー、2 無地（陶器）、3 チューリングパターン、4 鏡面球、5 天球
// 天球モード（方向はすべて地平座標 ENU：x 東、y 北、z 天頂。uBx/uBy/uBz がその各軸の端末座標）
uniform vec3 uBodyDir[7]; uniform vec3 uBodyCol[7]; uniform float uBodySize[7];
uniform vec3 uAspA[21]; uniform vec3 uAspB[21]; uniform vec4 uAspC[21]; uniform int uAspN;
uniform vec3 uEc0, uEc90, uEcN, uNcp;
uniform float uShadowK;              // 小球が内壁に落とす影の濃さ
uniform int uWallPat;                // 0 無地、1 方眼、2 経線（上下端が極）、3 縦横の格子（上下端・左右端が極の経線）
uniform vec3 uLight;                 // 光の来る向き（端末座標、単位ベクトル）
uniform vec3 uEye;                   // 視点（頂点シェーダと共通）
// 鏡面球に映すインカメラの映像
uniform sampler2D uCam; uniform bool uCamOn;
uniform vec3 uCamPos;                // カメラの位置（端末座標、mm）
uniform float uCamF;                 // 焦点距離（ピクセル）
uniform vec2 uCamSize;               // 映像の大きさ（ピクセル）
uniform float uCamFlip;              // 映像の左右の向き（表面モードの「左右反転」と同じ）
uniform float uFaceZ;                // 見る人の顔がある高さ（mm）
uniform float uSpread;               // 映り込みの広がり（1 で物理どおり。大きいほどカメラ映像が球の縁まで広がる）
uniform float uCamSat;               // 映り込む映像の彩度（0 で白黒、1 でそのまま）
out vec4 o;
const float PI = 3.14159265;

float lineMask(float dist, float w){ return 1.0 - smoothstep(w * 0.6, w * 1.6, dist); }

// 球との交差：|o + t d − c| = r の解（近い方 / 遠い方）
vec2 hitSphere(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro - c;
  float b = dot(oc, rd), q = dot(oc, oc) - r * r;
  float disc = b * b - q;
  if (disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

vec3 ballColor(vec3 n){
  // 端末座標の法線 → 小球の座標（重力で水平を保つ）→ 地球儀の座標
  vec3 nb = vec3(dot(n, uBx), dot(n, uBy), dot(n, uBz));
  if (uBallPat == 3) {
    // 反応拡散：小球に固定した座標（自転ぶん回す）で場を読む。V が濃い所を黒に
    float c = cos(-uLon), s = sin(-uLon);
    vec3 q = vec3(c * nb.x - s * nb.y, s * nb.x + c * nb.y, nb.z);
    float v = texture(uField, dirToAtlas(q, uFieldN)).g;
    float w = fwidth(v);
    return mix(vec3(0.93, 0.91, 0.87), vec3(0.05), smoothstep(0.22 - w, 0.22 + w, v));
  }
  float la = uLat, lo = uLon;
  vec3 U  = vec3(cos(la) * cos(lo), cos(la) * sin(lo), sin(la));
  vec3 Ea = vec3(-sin(lo), cos(lo), 0.0);
  vec3 No = vec3(-sin(la) * cos(lo), -sin(la) * sin(lo), cos(la));
  vec3 g = normalize(nb.x * Ea + nb.y * No + nb.z * U);
  float lat = asin(clamp(g.z, -1.0, 1.0));
  float lon = atan(g.y, g.x);
  float latd = degrees(lat), lond = degrees(lon);
  float lon2 = degrees(atan(-g.y, -g.x));
  float wLat = fwidth(latd);
  float wLon = min(fwidth(lond), fwidth(lon2));
  float cl = max(cos(lat), 1e-3);
  if (uBallPat == 0) {
    vec3 col = vec3(0.92, 0.90, 0.84);
    float dLat = abs(fract(latd / 15.0 + 0.5) - 0.5) * 15.0;
    float dLon = abs(fract(lond / 15.0 + 0.5) - 0.5) * 15.0 * cl;
    col = mix(col, vec3(0.20, 0.30, 0.45), max(lineMask(dLat, wLat), lineMask(dLon, wLon * cl)) * 0.8);
    col = mix(col, vec3(0.80, 0.15, 0.12), lineMask(abs(latd), wLat * 1.8));
    col = mix(col, vec3(0.85, 0.60, 0.05), lineMask(abs(lond) * cl, wLon * cl * 1.8));
    return col;
  } else if (uBallPat == 1) {
    float c = mod(floor(latd / 15.0) + floor(lond / 15.0), 2.0);
    return mix(vec3(0.08), vec3(0.92), c);
  }
  return vec3(0.93, 0.91, 0.87);
}

// 内壁の色（点 W、光 L）。視線が直接当たるときと、鏡面球に映るときの両方で使う
vec3 wallShade(vec3 W, vec3 L){
  vec3 C = vec3(0.0, 0.0, uCz);
  vec3 n = normalize(C - W);            // 内側向きの法線
  vec3 wall = vec3(0.80, 0.78, 0.74);
  if (uWallPat == 1) {
    // 方眼：画面に投影したときにます目に見えるよう、x・y の座標で線を引く
    float w = max(fwidth(W.x), fwidth(W.y));
    // 斜めに見える所では 1mm の線が細かすぎてちらつくので薄くする
    float g1 = max(lineMask(abs(fract(W.x + 0.5) - 0.5), w), lineMask(abs(fract(W.y + 0.5) - 0.5), w)) * 0.25 * (1.0 - smoothstep(0.12, 0.35, w));
    float g5 = max(lineMask(abs(fract(W.x / 5.0 + 0.5) - 0.5) * 5.0, w * 1.5), lineMask(abs(fract(W.y / 5.0 + 0.5) - 0.5) * 5.0, w * 1.5)) * 0.6 * (1.0 - smoothstep(1.0, 2.5, w));
    wall = mix(vec3(0.90, 0.90, 0.86), vec3(0.30, 0.55, 0.52), max(g1, g5));
  } else if (uWallPat >= 2) {
    // 外殻の球の経線。底面の円の上端・下端（画面の y 方向の両端）を極とし、
    // 地球儀を真横から見たように縦の線を引く：y 軸を含む面との交線＝ y 軸まわりの角度が一定の線。
    // 格子では、左右端（x 方向の両端）を極とする経線も重ねる。角度は底の極（真下）を 0° とする
    vec3 q = normalize(W - C);
    float latY = degrees(atan(q.x, -q.z));   // 上下端が極の経度（変数名は既存の線描画と共用）
    float latX = degrees(atan(q.y, -q.z));   // 左右端が極の経度
    float wy = fwidth(latY), wx = fwidth(latX);
    // 光学的な折り返し（コースティック）の付近では像の変化が急で fwidth が跳ね上がり、
    // 偽の太線が出るので、変化が急な所では線を消す
    float fl = 3.0;
    float fy = 1.0 - smoothstep(fl, fl * 2.5, wy), fx = 1.0 - smoothstep(fl, fl * 2.5, wx);
    // 空気なので内壁全体が見える。10° ごとの細線と 30° ごとの太線
    float mi = 10.0, ma = 30.0;
    float ly = max(max(lineMask(abs(fract(latY / mi + 0.5) - 0.5) * mi, wy) * 0.35,
                       lineMask(abs(fract(latY / ma + 0.5) - 0.5) * ma, wy * 1.4) * 0.75),
                   lineMask(abs(latY), wy * 2.0)) * fy;
    float lx = 0.0;
    if (uWallPat == 3) lx = max(max(lineMask(abs(fract(latX / mi + 0.5) - 0.5) * mi, wx) * 0.35,
                                    lineMask(abs(fract(latX / ma + 0.5) - 0.5) * ma, wx * 1.4) * 0.75),
                                lineMask(abs(latX), wx * 2.0)) * fx;
    wall = mix(vec3(0.90, 0.90, 0.86), vec3(0.30, 0.55, 0.52), max(ly, lx));
  }
  float lam = max(dot(n, L), 0.0);
  // 小球の影：内壁の点から光の方へ伸ばした線が小球をかすめる度合い（遠いほどぼかす）
  float t = dot(C - W, L);
  float sh = 0.0;
  if (t > 0.0) {
    float d = length(W + L * t - C);
    float soft = 0.25 + 0.07 * t;
    sh = (1.0 - smoothstep(uInnerR - soft, uInnerR + soft, d)) * uShadowK;
  }
  // 深い所ほど暗く（光が届きにくい）
  float depth = clamp((uZb - W.z) / uR, 0.0, 1.0);
  return wall * (0.14 + 0.86 * lam * (1.0 - 0.75 * sh)) * mix(1.0, 0.7, depth);
}

// 鏡面球に映る景色：点 X から方向 r へ進む反射光線の先
vec3 mirrorEnv(vec3 X, vec3 r, vec3 L){
  vec3 C = vec3(0.0, 0.0, uCz);
  // 殻の内壁に当たるなら内壁を映す
  vec2 hs = hitSphere(X, r, C, uR);
  vec3 W = X + r * max(hs.y, 0.0);
  if (W.z <= uZb + 0.01) return wallShade(W, L);
  // 上半分（ガラス）から外へ抜ける：インカメラの映像を映す。
  // 周囲の景色は、球の中心から「見る距離」だけ離れた大きな球面上にあるとみなす（顔もその上）。
  // 反射光線がその球面に当たる点を、カメラから見た方向に直して映像のどこを読むかを決める。
  // カメラの画角を超える方向は、角度をなめらかに外へ伸ばした先を鏡映しの繰り返しで読み、
  // 遠いほどぼかして暗くする（縁の1列を引き伸ばすと放射状の筋になるため）
  vec3 env = vec3(0.04, 0.045, 0.05);
  if (uCamOn) {
    float Renv = max(uFaceZ - C.z, 60.0);
    vec2 he = hitSphere(X, r, C, Renv);
    vec3 Q = X + r * max(he.y, 0.0);
    float Xc = (Q.x - uCamPos.x) * uCamFlip;
    float Yc = uCamPos.y - Q.y;
    float Zc = Q.z - uCamPos.z;
    float th = atan(length(vec2(Xc, Yc)), Zc);          // カメラの正面からの角度
    vec2 dir = normalize(vec2(Xc, Yc) + 1e-6);
    float rho = uCamF * tan(min(th, radians(84.0)));    // ピンホールでの像の位置（画素）
    vec2 uv = 0.5 + dir * rho / uCamSize;
    // 映像の枠をはみ出した分（縦横それぞれ）だけ急速にぼかし、鏡映しの繰り返しが
    // 「もう一つの顔」のようにくっきり出ないようにする
    vec2 over = max(abs(uv - 0.5) - 0.5, 0.0);
    float ov = length(over);
    float lod = clamp(ov * 40.0, 0.0, 7.0);
    vec3 cam = textureLod(uCam, uv, lod).rgb;
    cam = mix(vec3(dot(cam, vec3(0.299, 0.587, 0.114))), cam, uCamSat);
    env = cam * mix(1.0, 0.55, smoothstep(0.0, 1.5, ov));
  }
  return env;
}


// ---------- 天球 ----------
vec3 toENU(vec3 v){ return vec3(dot(v, uBx), dot(v, uBy), dot(v, uBz)); }
vec3 fromENU(vec3 e){ return e.x * uBx + e.y * uBy + e.z * uBz; }

// 2本の線分 p0+s·d0 (0≤s≤l0) と p1+t·d1 (0≤t≤l1) の最短距離²（d0, d1 は単位ベクトル）
float segDist2(vec3 p0, vec3 d0, float l0, vec3 p1, vec3 d1, float l1){
  vec3 r = p0 - p1;
  float b = dot(d0, d1), c = dot(d0, r), f = dot(d1, r);
  float den = 1.0 - b * b;
  float s = den > 1e-6 ? clamp((b * f - c) / den, 0.0, l0) : 0.0;
  float t = clamp(b * s + f, 0.0, l1);
  s = clamp(b * t - c, 0.0, l0);
  vec3 q = p0 + d0 * s - (p1 + d1 * t);
  return dot(q, q);
}

// 天球の表面に描く線（地平線と東西南北、黄道の帯と十二宮の区切り、天の赤道と天の北極）。rgb と不透明度
vec4 skyMarks(vec3 e){
  vec4 m = vec4(0.0);
  // 地平線
  float wz = fwidth(e.z);
  float hz = lineMask(abs(e.z), wz * 1.2);
  float az = atan(e.x, e.y);                            // 北から東回り
  float wa = fwidth(az) + 1e-4;
  float card = 0.0, north = 0.0;
  for (int k = 0; k < 4; k++) {
    float a = float(k) * PI * 0.5;
    float d = abs(atan(sin(az - a), cos(az - a)));
    float tick = lineMask(d, wa * 1.5) * (1.0 - smoothstep(0.0, 0.12, abs(e.z)));
    if (k == 0) north = tick; else card = max(card, tick);
  }
  m = mix(m, vec4(0.75, 0.95, 0.80, 0.85), max(hz, card));
  m = mix(m, vec4(1.0, 0.25, 0.2, 1.0), north);
  // 黄道の帯（黄緯 ±8°）と中心線、30° ごとの区切り（春分点は強め）
  float beta = asin(clamp(dot(e, uEcN), -1.0, 1.0));
  float lam = atan(dot(e, uEc90), dot(e, uEc0));
  float wb = fwidth(beta);
  float band = 1.0 - smoothstep(radians(8.0) - wb, radians(8.0) + wb, abs(beta));
  m = mix(m, vec4(1.0, 0.85, 0.45, 0.22), band * 0.9);
  m = mix(m, vec4(1.0, 0.85, 0.45, 0.9), lineMask(abs(beta), wb * 1.2));
  float wl = fwidth(lam) + 1e-4;
  float dl = abs(fract(lam / radians(30.0) + 0.5) - 0.5) * radians(30.0);
  float d0 = abs(atan(sin(lam), cos(lam)));
  m = mix(m, vec4(1.0, 0.85, 0.45, 0.85), lineMask(dl, wl * 1.2) * band);
  m = mix(m, vec4(1.0, 0.95, 0.75, 1.0), lineMask(d0, wl * 2.2) * band);
  // 天の赤道と天の北極
  float dq = asin(clamp(dot(e, uNcp), -1.0, 1.0));
  m = mix(m, vec4(0.45, 0.65, 1.0, 0.6), lineMask(abs(dq), fwidth(dq) * 1.1));
  float dp = acos(clamp(dot(e, uNcp), -1.0, 1.0));
  m = mix(m, vec4(0.6, 0.8, 1.0, 0.9), 1.0 - smoothstep(0.035, 0.05, dp));
  return m;
}

vec3 skyRender(vec3 ro, vec3 rd, vec3 L, vec3 V){
  vec3 C = vec3(0.0, 0.0, uCz);
  // 背景：殻の内壁か、上へ抜ける
  vec2 hs = hitSphere(ro, rd, C, uR);
  vec3 W = ro + rd * max(hs.y, 0.0);
  vec3 col = W.z > uZb + 0.01 ? vec3(0.01, 0.012, 0.02) : wallShade(W, L);
  float rc = uInnerR;
  vec2 hb = hitSphere(ro, rd, C, rc);
  // 天体（天球の表面に乗った小さな球）
  float tBody = 1e9; vec3 bodyCol = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    vec3 P = C + rc * fromENU(uBodyDir[i]);
    float br = rc * 0.055 * uBodySize[i];
    vec2 h = hitSphere(ro, rd, P, br);
    if (h.x > 0.0 && h.x < tBody) {
      tBody = h.x;
      vec3 nn = normalize(ro + rd * h.x - P);
      float lam = max(dot(nn, L), 0.0);
      // 地平線より下の天体は少し暗く
      float below = uBodyDir[i].z < 0.0 ? 0.6 : 1.0;
      vec3 c = uBodyCol[i] * (0.35 + 0.75 * lam) * below;
      if (i == 0) c = uBodyCol[i] * 1.25;                 // 太陽は自ら光る
      bodyCol = c + pow(max(dot(nn, normalize(L + V)), 0.0), 60.0) * 0.4;
    }
  }
  if (hb.x <= 0.0) return tBody < 1e8 ? bodyCol : col;
  float tMid = 0.5 * (hb.x + hb.y);
  // 奥の面：ガラス越しに薄く
  vec3 eB = toENU(normalize(ro + rd * hb.y - C));
  vec4 mb = skyMarks(eB);
  col = col * 0.78 + vec3(0.015, 0.025, 0.05);
  col = mix(col, mb.rgb, mb.a * 0.45);
  // 奥側の天体
  if (tBody < 1e8 && tBody > tMid) col = bodyCol;
  // 内部：地平面、地軸、観測者、アスペクトの線（加算で光らせる）
  vec3 up = uBz;
  float dn = dot(rd, up);
  if (abs(dn) > 1e-4) {
    float th = dot(C - ro, up) / dn;
    vec3 Ph = ro + rd * th;
    if (th > hb.x && th < hb.y && length(Ph - C) < rc) col = mix(col, vec3(0.55, 0.85, 0.65), 0.10);
  }
  float seg = hb.y - hb.x;
  vec3 ncpD = fromENU(uNcp);
  float da = segDist2(ro + rd * hb.x, rd, seg, C - ncpD * rc, ncpD, 2.0 * rc);
  col += vec3(0.45, 0.65, 1.0) * exp(-da / (2.0 * 0.07 * 0.07)) * 0.5;
  float dc = segDist2(ro + rd * hb.x, rd, seg, C, vec3(0.0, 0.0, 1.0), 0.0);
  col += vec3(1.0) * (exp(-dc / (2.0 * 0.12 * 0.12)) * 1.2 + exp(-dc / (2.0 * 0.5 * 0.5)) * 0.15);
  for (int i = 0; i < 21; i++) {
    if (i >= uAspN) break;
    vec3 A = C + rc * fromENU(uAspA[i]);
    vec3 B = C + rc * fromENU(uAspB[i]);
    vec3 dAB = B - A; float lAB = length(dAB);
    float d2 = segDist2(ro + rd * hb.x, rd, seg, A, dAB / max(lAB, 1e-4), lAB);
    float k = uAspC[i].a;                                  // 正確さ 0〜1
    float wcore = 0.05 + 0.12 * k;
    col += uAspC[i].rgb * (exp(-d2 / (2.0 * wcore * wcore)) * (0.35 + 1.1 * k) + exp(-d2 / (2.0 * 0.45 * 0.45)) * 0.18 * k);
  }
  // 手前側の天体
  if (tBody < 1e8 && tBody <= tMid) col = bodyCol;
  // 手前の面：線と、ガラスの照り
  vec3 nF = normalize(ro + rd * hb.x - C);
  vec4 mf = skyMarks(toENU(nF));
  col = col * 0.92 + vec3(0.01, 0.015, 0.03);
  col = mix(col, mf.rgb, mf.a * 0.85);
  col += pow(max(dot(nF, normalize(L + V)), 0.0), 120.0) * 0.5;
  col += pow(1.0 - max(dot(nF, V), 0.0), 4.0) * 0.12;
  return col;
}

void main(){
  // 見立て：薄いガラスの殻の中が空気で満たされている。
  // 実物のドームでの屈折は「どの画素に届くか」にだけ効かせ、色を決める視線は目からまっすぐ進める。
  // こうすると実物のドームのレンズ効果が打ち消される
  vec3 rd = normalize(vS - uEye);
  vec3 ro = vS;
  vec3 C = vec3(0.0, 0.0, uCz);
  vec3 V = -rd;
  vec3 L = normalize(uLight);
  vec3 col;
  if (uBallPat == 5) { o = vec4(skyRender(ro, rd, L, V), 1.0); return; }

  vec2 hb = hitSphere(ro, rd, C, uInnerR);
  if (hb.x > 0.0) {
    vec3 X = ro + rd * hb.x;
    vec3 n = normalize(X - C);
    if (uBallPat == 4) {
      // 鏡面球：反射方向の景色（内壁かインカメラの映像）と、照明の鋭い光点
      vec3 r = reflect(rd, n);
      // 映り込みの広がり：見る人の方向からの角度を uSpread 分の1に縮める。
      // インカメラは正面の狭い範囲しか写さないので、物理どおり（1）だと映像は球の中央だけになる。
      // 縮めると、狭い映像が球の縁まで広がり、エッシャーの自画像のように部屋全体が映っている見え方になる
      vec3 ax = normalize(uEye - C);
      float th = acos(clamp(dot(r, ax), -1.0, 1.0));
      if (uSpread > 1.0 && th > 1e-4) {
        vec3 pr = normalize(r - ax * cos(th));
        float th2 = th / uSpread;
        r = ax * cos(th2) + pr * sin(th2);
      }
      vec3 env = mirrorEnv(X, r, L);
      float fres = 0.82 + 0.18 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
      float sun = pow(max(dot(r, L), 0.0), 1500.0) * 1.2;   // 実際の照明も映像に映るので控えめに
      col = env * fres * vec3(0.96, 0.96, 0.98) + vec3(sun);
    } else {
      // 小球：拡散＋鏡面反射（無地は陶器のように強めの照り）
      vec3 base = ballColor(n);
      float lam = max(dot(n, L), 0.0);
      vec3 H = normalize(L + V);
      bool glaze = uBallPat >= 2;   // 無地と反応拡散は陶器の釉薬のような強い照り
      float shin = glaze ? 80.0 : 40.0, ks = glaze ? 0.55 : 0.25;
      float spec = pow(max(dot(n, H), 0.0), shin) * ks;
      float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.12;   // 縁のわずかな照り返し
      col = base * (0.16 + 0.84 * lam) + vec3(spec) + vec3(rim);
    }
  } else {
    // 外殻の内壁（視線が球から出ていく点）
    vec2 hs = hitSphere(ro, rd, C, uR);
    vec3 W = ro + rd * max(hs.y, 0.0);
    if (W.z > uZb + 0.01) col = vec3(0.01, 0.012, 0.02);   // 上半分（透明な側）から外へ抜ける視線
    else col = wallShade(W, L);
  }
  o = vec4(col, 1.0);
}`;