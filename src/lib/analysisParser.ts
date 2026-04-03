import Papa from 'papaparse';

/** 完全不通エリア（Format A）のクラスタ行 */
export interface FutsuCluster {
  type: 'futsu';
  carrier: string;
  cluster_id: number;
  point_count: number;
  lat_center: number;
  lon_center: number;
  radius_m: number;
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
  dates: string;
  vehicles: string;
  _sourceFile: string;
}

/** 低速不通エリア（Format B）のクラスタ行 */
export interface TeisokuCluster {
  type: 'teisoku';
  metric: string;
  threshold: string;
  carrier: string;
  cluster_id: number;
  total_points: number;
  futsu_count: number;
  teisoku_count: number;
  avg_speed_mbps: number;
  median_speed_mbps: number;
  min_speed_mbps: number;
  lat_center: number;
  lon_center: number;
  radius_m: number;
  dates: string;
  vehicles: string;
  _sourceFile: string;
}

/** 参考データ（座標＋ポップアップ情報）の行 */
export interface ReferencePoint {
  type: 'reference';
  rank: number;
  label: string;
  direction: string;
  distance_m: number;
  lat: number;
  lon: number;
  _sourceFile: string;
}

/** 分析クラスタの共用型 */
export type AnalysisCluster = FutsuCluster | TeisokuCluster;

/** CSVの種別 */
export type CsvType = 'measurement' | 'futsu' | 'teisoku' | 'reference';

/** CSVヘッダーからファイル種別を自動判別する */
export function detectCsvType(text: string): CsvType {
  const cleaned = text.replace(/^\uFEFF/, '');
  const firstLine = cleaned.split(/\r?\n/)[0];
  const columns = firstLine.split(',').map((c) => c.trim());

  // 低速不通エリア分析: metric + threshold + 平均速度(Mbps) が存在
  if (columns.includes('metric') && columns.includes('threshold') && columns.includes('平均速度(Mbps)')) {
    return 'teisoku';
  }
  // 完全不通エリア: cluster_id + point_count + lat_center が存在
  if (columns.includes('cluster_id') && columns.includes('point_count') && columns.includes('lat_center')) {
    return 'futsu';
  }
  // 参考データ: 順位 + 緯度 + 経度 が存在
  if (columns.includes('順位') && columns.includes('緯度') && columns.includes('経度')) {
    return 'reference';
  }
  return 'measurement';
}

/** 完全不通エリアCSVをパースする */
export function parseFutsuCsv(text: string, sourceFile: string): FutsuCluster[] {
  const cleaned = text.replace(/^\uFEFF/, '');
  const result = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
  });

  return result.data
    .filter((row) => row.lat_center && row.lon_center)
    .map((row) => ({
      type: 'futsu' as const,
      carrier: row.carrier ?? '',
      cluster_id: parseInt(row.cluster_id, 10) || 0,
      point_count: parseInt(row.point_count, 10) || 0,
      lat_center: parseFloat(row.lat_center),
      lon_center: parseFloat(row.lon_center),
      radius_m: parseFloat(row.radius_m) || 0,
      lat_min: parseFloat(row.lat_min) || 0,
      lat_max: parseFloat(row.lat_max) || 0,
      lon_min: parseFloat(row.lon_min) || 0,
      lon_max: parseFloat(row.lon_max) || 0,
      dates: row.dates ?? '',
      vehicles: row.vehicles ?? '',
      _sourceFile: sourceFile,
    }))
    .filter((row) => !isNaN(row.lat_center) && !isNaN(row.lon_center));
}

/** 低速不通エリア分析CSVをパースする */
export function parseTeisokuCsv(text: string, sourceFile: string): TeisokuCluster[] {
  const cleaned = text.replace(/^\uFEFF/, '');
  const result = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
  });

  return result.data
    .filter((row) => row.lat_center && row.lon_center)
    .map((row) => ({
      type: 'teisoku' as const,
      metric: row.metric ?? '',
      threshold: row.threshold ?? '',
      carrier: row.carrier ?? '',
      cluster_id: parseInt(row.cluster_id, 10) || 0,
      total_points: parseInt(row.total_points, 10) || 0,
      futsu_count: parseInt(row['不通点数'], 10) || 0,
      teisoku_count: parseInt(row['低速点数'], 10) || 0,
      avg_speed_mbps: parseFloat(row['平均速度(Mbps)']) || 0,
      median_speed_mbps: parseFloat(row['中央値(Mbps)']) || 0,
      min_speed_mbps: parseFloat(row['最小速度(Mbps)']) || 0,
      lat_center: parseFloat(row.lat_center),
      lon_center: parseFloat(row.lon_center),
      radius_m: parseFloat(row.radius_m) || 0,
      dates: row.dates ?? '',
      vehicles: row.vehicles ?? '',
      _sourceFile: sourceFile,
    }))
    .filter((row) => !isNaN(row.lat_center) && !isNaN(row.lon_center));
}

/** 参考データCSVをパースする（順位・緯度・経度を含む汎用形式） */
export function parseReferenceCsv(text: string, sourceFile: string): ReferencePoint[] {
  const cleaned = text.replace(/^\uFEFF/, '');
  const result = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
  });

  // ヘッダーからラベル列と距離列を自動検出
  const headers = result.meta.fields ?? [];
  const labelCol = headers.find((h) => h !== '順位' && h !== '緯度' && h !== '経度' && h !== '進行方向' && !h.includes('距離')) ?? '';
  const dirCol = headers.find((h) => h === '進行方向') ?? '';
  const distCol = headers.find((h) => h.includes('距離')) ?? '';

  return result.data
    .filter((row) => row['緯度'] && row['経度'])
    .map((row) => ({
      type: 'reference' as const,
      rank: parseInt(row['順位'], 10) || 0,
      label: labelCol ? (row[labelCol] ?? '') : '',
      direction: dirCol ? (row[dirCol] ?? '') : '',
      distance_m: distCol ? (parseFloat(row[distCol]) || 0) : 0,
      lat: parseFloat(row['緯度']),
      lon: parseFloat(row['経度']),
      _sourceFile: sourceFile,
    }))
    .filter((row) => !isNaN(row.lat) && !isNaN(row.lon));
}
