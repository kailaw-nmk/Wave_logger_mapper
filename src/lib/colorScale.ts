/** メトリック種別 */
export type Metric =
  | 'download_mbps'
  | 'upload_mbps'
  | 'ping_ms'
  | 'udp_ping_ms'
  | 'udp_jitter_ms'
  | 'udp_packet_loss_pct'
  | 'udp_download_mbps'
  | 'udp_upload_mbps';

/** メトリックのラベル */
export const METRIC_LABELS: Record<Metric, string> = {
  download_mbps: '下り速度 (Mbps)',
  upload_mbps: '上り速度 (Mbps)',
  ping_ms: 'Ping (ms)',
  udp_ping_ms: 'UDP Ping (ms)',
  udp_jitter_ms: 'UDP Jitter (ms)',
  udp_packet_loss_pct: 'UDP パケットロス (%)',
  udp_download_mbps: 'UDP 下り速度 (Mbps)',
  udp_upload_mbps: 'UDP 上り速度 (Mbps)',
};

/** 凡例の閾値定義 */
interface LegendEntry {
  label: string;
  color: string;
}

// 色定数
const GREEN = '#22c55e';
const LIME = '#84cc16';
const YELLOW = '#eab308';
const ORANGE = '#f97316';
const RED = '#ef4444';

/** 速度値に応じたカラーコードを返す (赤=遅い/悪い, 緑=速い/良い) */
export function getColor(value: number, metric: Metric): string {
  switch (metric) {
    case 'download_mbps':
    case 'upload_mbps':
    case 'udp_download_mbps':
    case 'udp_upload_mbps':
      if (value >= 50) return GREEN;
      if (value >= 20) return LIME;
      if (value >= 10) return YELLOW;
      if (value >= 5) return ORANGE;
      return RED;

    case 'ping_ms':
    case 'udp_ping_ms':
      if (value <= 20) return GREEN;
      if (value <= 50) return LIME;
      if (value <= 100) return YELLOW;
      if (value <= 200) return ORANGE;
      return RED;

    case 'udp_jitter_ms':
      if (value <= 5) return GREEN;
      if (value <= 10) return LIME;
      if (value <= 20) return YELLOW;
      if (value <= 50) return ORANGE;
      return RED;

    case 'udp_packet_loss_pct':
      if (value === 0) return GREEN;
      if (value <= 1) return LIME;
      if (value <= 3) return YELLOW;
      if (value <= 5) return ORANGE;
      return RED;

    default:
      return '#6b7280';
  }
}

/** 凡例エントリーを返す */
export function getLegendEntries(metric: Metric): LegendEntry[] {
  switch (metric) {
    case 'download_mbps':
    case 'upload_mbps':
    case 'udp_download_mbps':
    case 'udp_upload_mbps':
      return [
        { label: '50+ Mbps (優秀)', color: GREEN },
        { label: '20-49 Mbps (良好)', color: LIME },
        { label: '10-19 Mbps (普通)', color: YELLOW },
        { label: '5-9 Mbps (やや遅い)', color: ORANGE },
        { label: '0-4 Mbps (遅い)', color: RED },
      ];

    case 'ping_ms':
    case 'udp_ping_ms':
      return [
        { label: '≤20 ms (優秀)', color: GREEN },
        { label: '21-50 ms (良好)', color: LIME },
        { label: '51-100 ms (普通)', color: YELLOW },
        { label: '101-200 ms (やや遅い)', color: ORANGE },
        { label: '200+ ms (遅い)', color: RED },
      ];

    case 'udp_jitter_ms':
      return [
        { label: '≤5 ms (優秀)', color: GREEN },
        { label: '6-10 ms (良好)', color: LIME },
        { label: '11-20 ms (普通)', color: YELLOW },
        { label: '21-50 ms (やや遅い)', color: ORANGE },
        { label: '50+ ms (遅い)', color: RED },
      ];

    case 'udp_packet_loss_pct':
      return [
        { label: '0% (損失なし)', color: GREEN },
        { label: '≤1% (良好)', color: LIME },
        { label: '≤3% (普通)', color: YELLOW },
        { label: '≤5% (やや悪い)', color: ORANGE },
        { label: '5%+ (悪い)', color: RED },
      ];

    default:
      return [];
  }
}
