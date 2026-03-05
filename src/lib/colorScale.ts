/** メトリック種別 */
export type Metric = 'download_mbps' | 'upload_mbps' | 'ping_ms';

/** メトリックのラベル */
export const METRIC_LABELS: Record<Metric, string> = {
  download_mbps: '下り速度 (Mbps)',
  upload_mbps: '上り速度 (Mbps)',
  ping_ms: 'Ping (ms)',
};

/** 凡例の閾値定義 */
interface LegendEntry {
  label: string;
  color: string;
}

/** 速度値に応じたカラーコードを返す (赤=遅い/悪い, 緑=速い/良い) */
export function getColor(value: number, metric: Metric): string {
  if (metric === 'download_mbps' || metric === 'upload_mbps') {
    if (value >= 50) return '#22c55e'; // 緑 (優秀)
    if (value >= 20) return '#84cc16'; // 黄緑 (良好)
    if (value >= 10) return '#eab308'; // 黄色 (普通)
    if (value >= 5) return '#f97316';  // オレンジ (やや遅い)
    return '#ef4444';                   // 赤 (遅い)
  }
  if (metric === 'ping_ms') {
    // Pingは低いほど良い
    if (value <= 20) return '#22c55e';
    if (value <= 50) return '#84cc16';
    if (value <= 100) return '#eab308';
    if (value <= 200) return '#f97316';
    return '#ef4444';
  }
  return '#6b7280';
}

/** 凡例エントリーを返す */
export function getLegendEntries(metric: Metric): LegendEntry[] {
  if (metric === 'download_mbps' || metric === 'upload_mbps') {
    return [
      { label: '50+ Mbps (優秀)', color: '#22c55e' },
      { label: '20-49 Mbps (良好)', color: '#84cc16' },
      { label: '10-19 Mbps (普通)', color: '#eab308' },
      { label: '5-9 Mbps (やや遅い)', color: '#f97316' },
      { label: '0-4 Mbps (遅い)', color: '#ef4444' },
    ];
  }
  return [
    { label: '≤20 ms (優秀)', color: '#22c55e' },
    { label: '21-50 ms (良好)', color: '#84cc16' },
    { label: '51-100 ms (普通)', color: '#eab308' },
    { label: '101-200 ms (やや遅い)', color: '#f97316' },
    { label: '200+ ms (遅い)', color: '#ef4444' },
  ];
}
