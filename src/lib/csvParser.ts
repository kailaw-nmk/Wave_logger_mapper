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
