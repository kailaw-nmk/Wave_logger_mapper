import Papa from 'papaparse';

/** CSVの1行分のデータ */
export interface CsvRow {
  timestamp: string;
  vehicle_id: string;
  route_type: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  download_mbps: number | null;
  upload_mbps: number | null;
  ping_ms: number | null;
  udp_ping_ms: number | null;
  udp_jitter_ms: number | null;
  udp_packet_loss_pct: number | null;
  udp_download_mbps: number | null;
  udp_upload_mbps: number | null;
  connection_type: string;
  cellular_gen: string | null;
  carrier: string | null;
  signal_dbm: number | null;
  memo: string;
  /** 内部用: ソースファイル追跡 */
  _sourceFile: string;
}

/** CSVファイルを解析する */
export function parseCsv(text: string, sourceFile: string): CsvRow[] {
  // BOM除去
  const cleaned = text.replace(/^\uFEFF/, '');

  const result = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
  });

  return result.data
    .filter((row) => row.latitude && row.longitude)
    .map((row) => ({
      timestamp: row.timestamp ?? '',
      vehicle_id: row.vehicle_id ?? '',
      route_type: row.route_type ?? '',
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      accuracy: parseNullableFloat(row.accuracy),
      download_mbps: parseNullableFloat(row.download_mbps),
      upload_mbps: parseNullableFloat(row.upload_mbps),
      ping_ms: parseNullableFloat(row.ping_ms),
      udp_ping_ms: parseNullableFloat(row.udp_ping_ms),
      udp_jitter_ms: parseNullableFloat(row.udp_jitter_ms),
      udp_packet_loss_pct: parseNullableFloat(row.udp_packet_loss_pct),
      udp_download_mbps: parseNullableFloat(row.udp_download_mbps),
      udp_upload_mbps: parseNullableFloat(row.udp_upload_mbps),
      connection_type: row.connection_type ?? 'unknown',
      cellular_gen: row.cellular_gen || null,
      carrier: row.carrier || null,
      signal_dbm: parseNullableFloat(row.signal_dbm),
      memo: row.memo ?? '',
      _sourceFile: sourceFile,
    }))
    .filter((row) => !isNaN(row.latitude) && !isNaN(row.longitude));
}

function parseNullableFloat(value: string | undefined): number | null {
  if (!value || value === 'N/A' || value === 'null' || value === '') return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

/** 集約済みデータ行 */
export interface AggregatedRow extends CsvRow {
  count: number;
  sourceFiles: string[];
  vehicle_ids: string[];
  route_types: string[];
}

/** 同一座標（小数5桁≒約1m精度）の計測データを平均値に集約する */
export function aggregateByLocation(rows: CsvRow[]): AggregatedRow[] {
  const groups = new Map<string, CsvRow[]>();

  for (const row of rows) {
    const key = `${row.latitude.toFixed(5)},${row.longitude.toFixed(5)}`;
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  return Array.from(groups.values()).map((group) => {
    const count = group.length;
    return {
      timestamp: group[0].timestamp,
      vehicle_id: group[0].vehicle_id,
      route_type: group[0].route_type,
      latitude: group[0].latitude,
      longitude: group[0].longitude,
      accuracy: averageNullable(group.map((r) => r.accuracy)),
      download_mbps: averageNullable(group.map((r) => r.download_mbps)),
      upload_mbps: averageNullable(group.map((r) => r.upload_mbps)),
      ping_ms: averageNullable(group.map((r) => r.ping_ms)),
      udp_ping_ms: averageNullable(group.map((r) => r.udp_ping_ms)),
      udp_jitter_ms: averageNullable(group.map((r) => r.udp_jitter_ms)),
      udp_packet_loss_pct: averageNullable(group.map((r) => r.udp_packet_loss_pct)),
      udp_download_mbps: averageNullable(group.map((r) => r.udp_download_mbps)),
      udp_upload_mbps: averageNullable(group.map((r) => r.udp_upload_mbps)),
      connection_type: group[0].connection_type,
      cellular_gen: group[0].cellular_gen,
      carrier: group[0].carrier,
      signal_dbm: averageNullable(group.map((r) => r.signal_dbm)),
      memo: group[0].memo,
      _sourceFile: group[0]._sourceFile,
      count,
      sourceFiles: [...new Set(group.map((r) => r._sourceFile))],
      vehicle_ids: [...new Set(group.map((r) => r.vehicle_id).filter(Boolean))],
      route_types: [...new Set(group.map((r) => r.route_type).filter(Boolean))],
    };
  });
}

/** null を除外して平均を計算する */
function averageNullable(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// ── 箱ひげ図チャート用 ──

import type { Metric } from '@/lib/colorScale';

/** 箱ひげ図用ビンデータ */
export interface BinData {
  /** 西端からの距離（メートル）— X軸表示用 */
  distanceM: number;
  /** ビン中央の経度 */
  lngCenter: number;
  /** ビン経度の最小値 */
  lngMin: number;
  /** ビン経度の最大値 */
  lngMax: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  count: number;
}

/** binByLongitude の戻り値 */
export interface BinResult {
  bins: BinData[];
  minLng: number;
  metersPerDegreeLng: number;
}

/** 線形補間で分位数を計算する */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** 経度方向にビン分割して箱ひげ図用の統計量を計算する */
export function binByLongitude(
  rows: CsvRow[],
  binSizeM: number,
  metricKey: Metric,
): BinResult {
  // メトリックが有効な行のみ抽出
  const valid = rows.filter((r) => r[metricKey] !== null);
  if (valid.length === 0) return { bins: [], minLng: 0, metersPerDegreeLng: 1 };

  // 平均緯度から経度1度あたりのメートルを算出
  const avgLat = valid.reduce((s, r) => s + r.latitude, 0) / valid.length;
  const metersPerDegreeLng = 111320 * Math.cos((avgLat * Math.PI) / 180);

  const minLng = Math.min(...valid.map((r) => r.longitude));
  const degreesPerBin = binSizeM / metersPerDegreeLng;

  // ビンに振り分け
  const bins = new Map<number, number[]>();
  const binLngs = new Map<number, number[]>();
  for (const row of valid) {
    const binIdx = Math.floor((row.longitude - minLng) / degreesPerBin);
    const val = row[metricKey] as number;
    if (!bins.has(binIdx)) {
      bins.set(binIdx, []);
      binLngs.set(binIdx, []);
    }
    bins.get(binIdx)!.push(val);
    binLngs.get(binIdx)!.push(row.longitude);
  }

  // 各ビンの統計量を計算
  const result: BinData[] = [];
  for (const [binIdx, values] of bins.entries()) {
    const sorted = [...values].sort((a, b) => a - b);
    const lngs = binLngs.get(binIdx)!;
    const lngCenter = lngs.reduce((s, v) => s + v, 0) / lngs.length;
    result.push({
      distanceM: (lngCenter - minLng) * metersPerDegreeLng,
      lngCenter,
      lngMin: Math.min(...lngs),
      lngMax: Math.max(...lngs),
      min: sorted[0],
      q1: percentile(sorted, 0.25),
      median: percentile(sorted, 0.5),
      q3: percentile(sorted, 0.75),
      max: sorted[sorted.length - 1],
      mean: values.reduce((s, v) => s + v, 0) / values.length,
      count: values.length,
    });
  }

  // 西から東（binIdx昇順）でソート
  result.sort((a, b) => a.distanceM - b.distanceM);
  return { bins: result, minLng, metersPerDegreeLng };
}

// ── ピクセルベースビン集計 ──

/** ピクセルベースの箱ひげ図用ビンデータ */
export interface PixelBinData {
  /** ビン中央のピクセルX座標 */
  pixelX: number;
  lngCenter: number;
  lngMin: number;
  lngMax: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  count: number;
}

/** 経度をピクセルベースでビン分割して箱ひげ図用の統計量を計算する */
export function binByPixel(
  rows: CsvRow[],
  westLng: number,
  eastLng: number,
  containerWidth: number,
  binWidthPx: number,
  metricKey: Metric,
): { bins: PixelBinData[] } {
  const lngRange = eastLng - westLng;
  if (lngRange <= 0 || containerWidth <= 0 || binWidthPx <= 0) {
    return { bins: [] };
  }

  // メトリックが有効な行のみ抽出
  const valid = rows.filter((r) => r[metricKey] !== null);
  if (valid.length === 0) return { bins: [] };

  // ビンに振り分け
  const binValues = new Map<number, number[]>();
  const binLngs = new Map<number, number[]>();

  for (const row of valid) {
    const px = ((row.longitude - westLng) / lngRange) * containerWidth;
    const binIdx = Math.floor(px / binWidthPx);
    if (binIdx < 0 || binIdx * binWidthPx >= containerWidth) continue;

    const val = row[metricKey] as number;
    if (!binValues.has(binIdx)) {
      binValues.set(binIdx, []);
      binLngs.set(binIdx, []);
    }
    binValues.get(binIdx)!.push(val);
    binLngs.get(binIdx)!.push(row.longitude);
  }

  // 各ビンの統計量を計算
  const bins: PixelBinData[] = [];
  for (const [binIdx, values] of binValues.entries()) {
    const sorted = [...values].sort((a, b) => a - b);
    const lngs = binLngs.get(binIdx)!;
    bins.push({
      pixelX: (binIdx + 0.5) * binWidthPx,
      lngCenter: lngs.reduce((s, v) => s + v, 0) / lngs.length,
      lngMin: Math.min(...lngs),
      lngMax: Math.max(...lngs),
      min: sorted[0],
      q1: percentile(sorted, 0.25),
      median: percentile(sorted, 0.5),
      q3: percentile(sorted, 0.75),
      max: sorted[sorted.length - 1],
      mean: values.reduce((s, v) => s + v, 0) / values.length,
      count: values.length,
    });
  }

  // ピクセルX昇順でソート
  bins.sort((a, b) => a.pixelX - b.pixelX);
  return { bins };
}
