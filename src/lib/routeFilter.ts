import { haversineM } from '@/lib/csvParser';
import type { CsvRow } from '@/lib/csvParser';

/** OSRM APIでルートを取得し、[lat, lng]配列で返す */
export async function fetchRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<[number, number][]> {
  // OSRM APIは lng,lat の順序
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ルート取得に失敗しました (HTTP ${res.status})`);

  const data = await res.json() as {
    code: string;
    routes?: { geometry: { coordinates: [number, number][] } }[];
  };
  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error('ルートが見つかりませんでした');
  }

  // GeoJSONは [lng, lat] → [lat, lng] に変換
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

/** 点からポリライン（線分列）への最短距離(m)を計算 */
function distanceToPolylineM(
  lat: number, lng: number,
  polyline: [number, number][],
): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return haversineM(lat, lng, polyline[0][0], polyline[0][1]);

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distanceToSegmentM(lat, lng, polyline[i], polyline[i + 1]);
    if (d < minDist) minDist = d;
    // 十分近ければ早期終了
    if (minDist < 1) return minDist;
  }
  return minDist;
}

/** 点から線分への最短距離(m) — 球面近似 */
function distanceToSegmentM(
  lat: number, lng: number,
  p1: [number, number], p2: [number, number],
): number {
  const d12 = haversineM(p1[0], p1[1], p2[0], p2[1]);
  if (d12 < 0.1) return haversineM(lat, lng, p1[0], p1[1]); // 退化セグメント

  // p1→qとp1→p2のなす角を使って射影点を計算
  const d1q = haversineM(p1[0], p1[1], lat, lng);
  const d2q = haversineM(p2[0], p2[1], lat, lng);

  // コサイン定理で射影比率を算出
  const cosAngle = (d1q * d1q + d12 * d12 - d2q * d2q) / (2 * d1q * d12);
  const proj = d1q * cosAngle;

  if (proj < 0) return d1q;       // 射影がp1の手前
  if (proj > d12) return d2q;     // 射影がp2の先

  // 垂線距離 = sqrt(d1q^2 - proj^2)
  const perpSq = d1q * d1q - proj * proj;
  return perpSq > 0 ? Math.sqrt(perpSq) : 0;
}

/** 測定点をルートポリラインでフィルタする */
export function filterRowsByRoute(
  rows: CsvRow[],
  polyline: [number, number][],
  thresholdM: number,
): CsvRow[] {
  if (polyline.length === 0) return rows;

  // バウンディングボックスで大幅に絞る（threshold分のマージン付き）
  const latMargin = thresholdM / 111000; // 緯度1度≒111km
  const lngMargin = thresholdM / (111000 * Math.cos((polyline[0][0] * Math.PI) / 180));
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of polyline) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  minLat -= latMargin;
  maxLat += latMargin;
  minLng -= lngMargin;
  maxLng += lngMargin;

  return rows.filter((row) => {
    // バウンディングボックスチェック
    if (row.latitude < minLat || row.latitude > maxLat ||
        row.longitude < minLng || row.longitude > maxLng) {
      return false;
    }
    // 詳細な距離チェック
    return distanceToPolylineM(row.latitude, row.longitude, polyline) <= thresholdM;
  });
}
