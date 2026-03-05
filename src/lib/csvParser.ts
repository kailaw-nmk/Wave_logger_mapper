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
