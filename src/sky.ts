// 天球モードの天体計算（東京から見た、ある時刻の7天体とアスペクト）
//
// 座標はすべて観測者の地平座標（ENU：x 東、y 北、z 天頂）の単位ベクトルで返す。
// アスペクトは占星術の慣習どおり、地心の黄経（真黄道・春分点は日付のもの）の差で判定する。
import { Body, Ecliptic, Equator, GeoVector, Horizon, MakeTime, Observer } from "astronomy-engine";

export const TOKYO = new Observer(35.6895, 139.6917, 0);

type V3 = [number, number, number];

export interface SkyBody { name: string; dir: V3; lon: number; lat: number; color: V3; size: number; alt: number; }
export interface SkyAspect { a: number; b: number; kind: AspectKind; exactness: number; diff: number; }
export interface Sky {
  bodies: SkyBody[];
  aspects: SkyAspect[];
  ec0: V3; ec90: V3; ecN: V3;   // 黄経0°・90° の方向、黄道の北極（ENU）
  ncp: V3;                      // 天の北極（ENU）
}

export type AspectKind = "合" | "六分" | "矩" | "三分" | "衝";
export const ASPECTS: { kind: AspectKind; angle: number; color: V3 }[] = [
  { kind: "合", angle: 0, color: [1.0, 0.78, 0.25] },
  { kind: "六分", angle: 60, color: [0.45, 0.80, 1.0] },
  { kind: "矩", angle: 90, color: [1.0, 0.45, 0.20] },
  { kind: "三分", angle: 120, color: [0.30, 0.50, 1.0] },
  { kind: "衝", angle: 180, color: [1.0, 0.12, 0.12] },
];

const BODIES: { body: Body; name: string; color: V3; size: number }[] = [
  { body: Body.Sun, name: "太陽", color: [1.0, 0.82, 0.35], size: 1.35 },
  { body: Body.Moon, name: "月", color: [0.88, 0.88, 0.92], size: 1.2 },
  { body: Body.Mercury, name: "水星", color: [0.65, 0.65, 0.68], size: 0.8 },
  { body: Body.Venus, name: "金星", color: [0.98, 0.92, 0.70], size: 0.95 },
  { body: Body.Mars, name: "火星", color: [0.90, 0.35, 0.22], size: 0.9 },
  { body: Body.Jupiter, name: "木星", color: [0.85, 0.70, 0.52], size: 1.1 },
  { body: Body.Saturn, name: "土星", color: [0.90, 0.82, 0.58], size: 1.0 },
];

const RAD = Math.PI / 180;

/** 赤経（時）・赤緯（度）→ 地平座標の単位ベクトル（大気差なし） */
function horizonVec(date: Date, raHours: number, decDeg: number): V3 {
  const h = Horizon(date, TOKYO, raHours, decDeg);
  const alt = h.altitude * RAD, az = h.azimuth * RAD;   // 方位は北から東回り
  return [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
}

/** 日付の黄道座標（黄経・黄緯、度）→ 日付の赤道座標（赤経 時、赤緯 度） */
function eclToEq(lonDeg: number, latDeg: number, epsDeg: number): [number, number] {
  const l = lonDeg * RAD, b = latDeg * RAD, e = epsDeg * RAD;
  const x = Math.cos(b) * Math.cos(l);
  const y = Math.cos(b) * Math.sin(l) * Math.cos(e) - Math.sin(b) * Math.sin(e);
  const z = Math.cos(b) * Math.sin(l) * Math.sin(e) + Math.sin(b) * Math.cos(e);
  const ra = ((Math.atan2(y, x) / RAD + 360) % 360) / 15;
  return [ra, Math.asin(z) / RAD];
}

export function computeSky(date: Date, orb = 8, orbLuminary = 10): Sky {
  const t = MakeTime(date);
  const T = t.tt / 36525;                     // 2000年からのユリウス世紀
  const eps = 23.43929 - 0.0130042 * T;       // 黄道傾斜角（平均、十分な精度）

  const bodies: SkyBody[] = BODIES.map(b => {
    const eq = Equator(b.body, date, TOKYO, true, true);        // 東京から見た位置（日付の赤道座標）
    const dir = horizonVec(date, eq.ra, eq.dec);
    const ecl = Ecliptic(GeoVector(b.body, date, true));         // 地心の真黄道座標
    return { name: b.name, dir, lon: ecl.elon, lat: ecl.elat, color: b.color, size: b.size, alt: Math.asin(dir[2]) / RAD };
  });

  const aspects: SkyAspect[] = [];
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    let d = Math.abs(bodies[i].lon - bodies[j].lon) % 360;
    if (d > 180) d = 360 - d;
    const o = i <= 1 || j <= 1 ? orbLuminary : orb;    // 太陽か月が絡むときは広め
    for (const a of ASPECTS) {
      const diff = Math.abs(d - a.angle);
      if (diff <= o) { aspects.push({ a: i, b: j, kind: a.kind, exactness: 1 - diff / o, diff }); break; }
    }
  }

  const [ra0, de0] = eclToEq(0, 0, eps);
  const [ra90, de90] = eclToEq(90, 0, eps);
  const [raN, deN] = eclToEq(0, 90, eps);
  return {
    bodies, aspects,
    ec0: horizonVec(date, ra0, de0),
    ec90: horizonVec(date, ra90, de90),
    ecN: horizonVec(date, raN, deN),
    ncp: horizonVec(date, 0, 90),
  };
}

const SIGNS = ["牡羊座", "牡牛座", "双子座", "蟹座", "獅子座", "乙女座", "天秤座", "蠍座", "射手座", "山羊座", "水瓶座", "魚座"];
export function signText(lon: number) {
  const l = ((lon % 360) + 360) % 360;
  const s = Math.floor(l / 30), d = l - s * 30;
  return `${SIGNS[s]} ${Math.floor(d)}°${String(Math.floor((d % 1) * 60)).padStart(2, "0")}′`;
}
