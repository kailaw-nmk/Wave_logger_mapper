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
  carriers: string[];
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
      carriers: [...new Set(group.map((r) => r.carrier).filter((c): c is string => c !== null))],
    };
  });
}

/** CsvRow を集約なしで AggregatedRow に変換する（全行をそのまま表示用） */
export function toAggregatedRows(rows: CsvRow[]): AggregatedRow[] {
  return rows.map((r) => ({
    ...r,
    count: 1,
    sourceFiles: [r._sourceFile],
    vehicle_ids: r.vehicle_id ? [r.vehicle_id] : [],
    route_types: r.route_type ? [r.route_type] : [],
    carriers: r.carrier ? [r.carrier] : [],
  }));
}

/** Haversine距離（メートル） */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 不通再現率の地点データ */
export interface NaRecurrencePoint {
  latitude: number;
  longitude: number;
  /** 不通再現率 0-100 */
  recurrenceRate: number;
  /** 不通だった運行数 */
  naRuns: number;
  /** 通過した運行数 */
  totalRuns: number;
  /** 運行別の不通/正常詳細 */
  runDetails: { file: string; isNa: boolean }[];
  /** 表示用の半径(m) — 0の場合はポイント表示 */
  radius: number;
  /** クラスタ内の測定点数 */
  pointCount: number;
}

/** 地点ごとの不通再現率を算出する（運行=ファイル単位、半径指定でクラスタリング） */
export function computeNaRecurrence(
  rows: CsvRow[],
  naCheckFn: (row: CsvRow) => boolean,
  radiusM: number = 0,
): NaRecurrencePoint[] {
  if (radiusM > 0) {
    return computeNaRecurrenceWithRadius(rows, naCheckFn, radiusM);
  }

  // 従来の5桁グループ化（radiusM=0）
  const locationGroups = new Map<string, { lat: number; lng: number; rows: CsvRow[] }>();
  for (const row of rows) {
    const locKey = `${row.latitude.toFixed(5)},${row.longitude.toFixed(5)}`;
    let loc = locationGroups.get(locKey);
    if (!loc) {
      loc = { lat: row.latitude, lng: row.longitude, rows: [] };
      locationGroups.set(locKey, loc);
    }
    loc.rows.push(row);
  }

  const result: NaRecurrencePoint[] = [];
  for (const loc of locationGroups.values()) {
    const pt = computeRecurrenceForRows(loc.rows, naCheckFn, loc.lat, loc.lng, 0);
    if (pt) result.push(pt);
  }
  return result;
}

/** 半径指定クラスタリングで再現率を算出 */
function computeNaRecurrenceWithRadius(
  rows: CsvRow[],
  naCheckFn: (row: CsvRow) => boolean,
  radiusM: number,
): NaRecurrencePoint[] {
  // 全測定点のユニーク座標を抽出
  const uniqueCoords: { lat: number; lng: number; rows: CsvRow[] }[] = [];
  const coordMap = new Map<string, { lat: number; lng: number; rows: CsvRow[] }>();
  for (const row of rows) {
    const key = `${row.latitude.toFixed(5)},${row.longitude.toFixed(5)}`;
    let entry = coordMap.get(key);
    if (!entry) {
      entry = { lat: row.latitude, lng: row.longitude, rows: [] };
      coordMap.set(key, entry);
      uniqueCoords.push(entry);
    }
    entry.rows.push(row);
  }

  // グリーディクラスタリング
  const assigned = new Set<number>();
  const clusters: { centerLat: number; centerLng: number; members: typeof uniqueCoords }[] = [];

  for (let i = 0; i < uniqueCoords.length; i++) {
    if (assigned.has(i)) continue;
    assigned.add(i);

    const members = [uniqueCoords[i]];
    // 半径内の点を収集
    for (let j = i + 1; j < uniqueCoords.length; j++) {
      if (assigned.has(j)) continue;
      const dist = haversineM(uniqueCoords[i].lat, uniqueCoords[i].lng, uniqueCoords[j].lat, uniqueCoords[j].lng);
      if (dist <= radiusM) {
        assigned.add(j);
        members.push(uniqueCoords[j]);
      }
    }

    // 重心を計算
    let totalLat = 0, totalLng = 0, totalCount = 0;
    for (const m of members) {
      const w = m.rows.length;
      totalLat += m.lat * w;
      totalLng += m.lng * w;
      totalCount += w;
    }
    clusters.push({
      centerLat: totalLat / totalCount,
      centerLng: totalLng / totalCount,
      members,
    });
  }

  // 各クラスタで再現率を算出
  const result: NaRecurrencePoint[] = [];
  for (const cluster of clusters) {
    const allRows = cluster.members.flatMap((m) => m.rows);
    const pt = computeRecurrenceForRows(allRows, naCheckFn, cluster.centerLat, cluster.centerLng, radiusM);
    if (pt) result.push(pt);
  }
  return result;
}

/** 行リストから再現率ポイントを算出（共通ロジック） */
function computeRecurrenceForRows(
  rows: CsvRow[],
  naCheckFn: (row: CsvRow) => boolean,
  lat: number,
  lng: number,
  radius: number,
): NaRecurrencePoint | null {
  // 運行(ファイル)単位でグループ化
  const runs = new Map<string, CsvRow[]>();
  for (const row of rows) {
    let runRows = runs.get(row._sourceFile);
    if (!runRows) {
      runRows = [];
      runs.set(row._sourceFile, runRows);
    }
    runRows.push(row);
  }

  const totalRuns = runs.size;
  // 運行が1件のみの地点は再現率を算出しない（複数運行の比較が必要）
  if (totalRuns < 2) return null;

  const runDetails: { file: string; isNa: boolean }[] = [];
  let naRuns = 0;

  for (const [file, runRows] of runs) {
    const isNa = runRows.every(naCheckFn);
    if (isNa) naRuns++;
    runDetails.push({ file, isNa });
  }

  if (naRuns === 0) return null;

  runDetails.sort((a, b) => a.file.localeCompare(b.file));

  return {
    latitude: lat,
    longitude: lng,
    recurrenceRate: (naRuns / totalRuns) * 100,
    naRuns,
    totalRuns,
    runDetails,
    radius,
    pointCount: rows.length,
  };
}

/** null を除外して平均を計算する */
/** マルチキャリア比較の地点データ */
export interface MultiCarrierPoint {
  latitude: number;
  longitude: number;
  /** 各キャリアの不通有無 */
  carrierStatus: { carrier: string; hasNa: boolean; naRuns: number; totalRuns: number }[];
  /** 全キャリアが不通（マルチでも解消不可） */
  allNa: boolean;
  /** 不通のキャリア数 */
  naCarrierCount: number;
  /** 全キャリア数 */
  totalCarriers: number;
}

/** マルチキャリアサマリ統計 */
export interface MultiCarrierSummary {
  /** キャリア別の不通地点数 */
  perCarrier: { carrier: string; naLocationCount: number }[];
  /** 全キャリア併用時の不通地点数（allNaの数） */
  combinedNaCount: number;
  /** 最大単独不通数 */
  maxSingleNaCount: number;
  /** 削減率 (%) */
  reductionRate: number;
}

/** 地点ごとのマルチキャリアカバレッジを算出する */
export function computeMultiCarrierCoverage(
  rows: CsvRow[],
  naCheckFn: (row: CsvRow) => boolean,
  carriers: string[],
): { points: MultiCarrierPoint[]; summary: MultiCarrierSummary } {
  // 地点キー → { キャリア → { 運行ファイル → その運行の行リスト } }
  const locationGroups = new Map<string, {
    lat: number;
    lng: number;
    carrierRuns: Map<string, Map<string, CsvRow[]>>;
  }>();

  for (const row of rows) {
    if (!row.carrier || !carriers.includes(row.carrier)) continue;
    const locKey = `${row.latitude.toFixed(5)},${row.longitude.toFixed(5)}`;
    let loc = locationGroups.get(locKey);
    if (!loc) {
      loc = { lat: row.latitude, lng: row.longitude, carrierRuns: new Map() };
      locationGroups.set(locKey, loc);
    }
    let carrierMap = loc.carrierRuns.get(row.carrier);
    if (!carrierMap) {
      carrierMap = new Map();
      loc.carrierRuns.set(row.carrier, carrierMap);
    }
    const file = row._sourceFile;
    let runRows = carrierMap.get(file);
    if (!runRows) {
      runRows = [];
      carrierMap.set(file, runRows);
    }
    runRows.push(row);
  }

  const points: MultiCarrierPoint[] = [];
  // キャリア別の不通地点数カウント用
  const perCarrierNaCounts = new Map<string, number>();
  for (const c of carriers) perCarrierNaCounts.set(c, 0);
  let combinedNaCount = 0;

  for (const loc of locationGroups.values()) {
    const carrierStatus: MultiCarrierPoint['carrierStatus'] = [];
    let naCarrierCount = 0;

    for (const carrier of carriers) {
      const runMap = loc.carrierRuns.get(carrier);
      if (!runMap || runMap.size === 0) {
        // このキャリアはこの地点を通過していない → 不通扱い（データなし）
        carrierStatus.push({ carrier, hasNa: true, naRuns: 0, totalRuns: 0 });
        naCarrierCount++;
        perCarrierNaCounts.set(carrier, (perCarrierNaCounts.get(carrier) ?? 0) + 1);
        continue;
      }
      let naRuns = 0;
      const totalRuns = runMap.size;
      for (const runRows of runMap.values()) {
        if (runRows.every(naCheckFn)) naRuns++;
      }
      const hasNa = naRuns > 0;
      carrierStatus.push({ carrier, hasNa, naRuns, totalRuns });
      if (hasNa) {
        naCarrierCount++;
        perCarrierNaCounts.set(carrier, (perCarrierNaCounts.get(carrier) ?? 0) + 1);
      }
    }

    // 全キャリア正常の地点は除外
    if (naCarrierCount === 0) continue;

    const allNa = naCarrierCount === carriers.length;
    if (allNa) combinedNaCount++;

    points.push({
      latitude: loc.lat,
      longitude: loc.lng,
      carrierStatus,
      allNa,
      naCarrierCount,
      totalCarriers: carriers.length,
    });
  }

  const perCarrier = carriers.map((c) => ({
    carrier: c,
    naLocationCount: perCarrierNaCounts.get(c) ?? 0,
  }));
  const maxSingleNaCount = Math.max(...perCarrier.map((p) => p.naLocationCount), 0);
  const reductionRate = maxSingleNaCount > 0
    ? ((maxSingleNaCount - combinedNaCount) / maxSingleNaCount) * 100
    : 0;

  return {
    points,
    summary: { perCarrier, combinedNaCount, maxSingleNaCount, reductionRate },
  };
}

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
