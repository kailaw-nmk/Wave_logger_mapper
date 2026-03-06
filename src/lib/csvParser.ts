import Papa from 'papaparse';

/** CSVの1行分のデータ */
export interface CsvRow {
  timestamp: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  download_mbps: number | null;
  upload_mbps: number | null;
  ping_ms: number | null;
  connection_type: string;
  cellular_gen: string | null;
  carrier: string | null;
  signal_dbm: number | null;
  memo: string;
}

/** CSVファイルを解析する */
export function parseCsv(text: string): CsvRow[] {
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
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      accuracy: parseNullableFloat(row.accuracy),
      download_mbps: parseNullableFloat(row.download_mbps),
      upload_mbps: parseNullableFloat(row.upload_mbps),
      ping_ms: parseNullableFloat(row.ping_ms),
      connection_type: row.connection_type ?? 'unknown',
      cellular_gen: row.cellular_gen || null,
      carrier: row.carrier || null,
      signal_dbm: parseNullableFloat(row.signal_dbm),
      memo: row.memo ?? '',
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
      latitude: group[0].latitude,
      longitude: group[0].longitude,
      accuracy: averageNullable(group.map((r) => r.accuracy)),
      download_mbps: averageNullable(group.map((r) => r.download_mbps)),
      upload_mbps: averageNullable(group.map((r) => r.upload_mbps)),
      ping_ms: averageNullable(group.map((r) => r.ping_ms)),
      connection_type: group[0].connection_type,
      cellular_gen: group[0].cellular_gen,
      carrier: group[0].carrier,
      signal_dbm: averageNullable(group.map((r) => r.signal_dbm)),
      memo: group[0].memo,
      count,
    };
  });
}

/** null を除外して平均を計算する */
function averageNullable(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}
