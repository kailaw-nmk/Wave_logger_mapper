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

const COLORS = [GREEN, LIME, YELLOW, ORANGE, RED] as const;

/** メトリクスごとの閾値定義 */
export interface MetricThresholds {
  higherIsBetter: boolean;
  boundaries: [number, number, number, number]; // 4境界値で5色を分ける
  labels: [string, string, string, string, string]; // 各段階のラベル
  unit: string;
}

export type CustomThresholds = Record<Metric, MetricThresholds>;

/** デフォルト閾値 */
export const DEFAULT_THRESHOLDS: CustomThresholds = {
  download_mbps: {
    higherIsBetter: true,
    boundaries: [50, 20, 10, 5],
    labels: ['優秀', '良好', '普通', 'やや遅い', '遅い'],
    unit: 'Mbps',
  },
  upload_mbps: {
    higherIsBetter: true,
    boundaries: [50, 20, 10, 5],
    labels: ['優秀', '良好', '普通', 'やや遅い', '遅い'],
    unit: 'Mbps',
  },
  udp_download_mbps: {
    higherIsBetter: true,
    boundaries: [50, 20, 10, 5],
    labels: ['優秀', '良好', '普通', 'やや遅い', '遅い'],
    unit: 'Mbps',
  },
  udp_upload_mbps: {
    higherIsBetter: true,
    boundaries: [50, 20, 10, 5],
    labels: ['優秀', '良好', '普通', 'やや遅い', '遅い'],
    unit: 'Mbps',
  },
  ping_ms: {
    higherIsBetter: false,
    boundaries: [20, 50, 100, 200],
    labels: ['優秀', '良好', '普通', 'やや遅い', '遅い'],
    unit: 'ms',
  },
  udp_ping_ms: {
    higherIsBetter: false,
    boundaries: [20, 50, 100, 200],
    labels: ['優秀', '良好', '普通', 'やや遅い', '遅い'],
    unit: 'ms',
  },
  udp_jitter_ms: {
    higherIsBetter: false,
    boundaries: [5, 10, 20, 50],
    labels: ['優秀', '良好', '普通', 'やや遅い', '遅い'],
    unit: 'ms',
  },
  udp_packet_loss_pct: {
    higherIsBetter: false,
    boundaries: [0, 1, 3, 5],
    labels: ['損失なし', '良好', '普通', 'やや悪い', '悪い'],
    unit: '%',
  },
};

/** 速度値に応じたカラーコードを返す (赤=遅い/悪い, 緑=速い/良い) */
export function getColor(value: number, metric: Metric, thresholds?: CustomThresholds): string {
  const t = (thresholds ?? DEFAULT_THRESHOLDS)[metric];
  const [b0, b1, b2, b3] = t.boundaries;

  if (t.higherIsBetter) {
    // 大きいほど良い: b0 >= b1 >= b2 >= b3
    if (value >= b0) return COLORS[0];
    if (value >= b1) return COLORS[1];
    if (value >= b2) return COLORS[2];
    if (value >= b3) return COLORS[3];
    return COLORS[4];
  } else {
    // 小さいほど良い: b0 <= b1 <= b2 <= b3
    if (value <= b0) return COLORS[0];
    if (value <= b1) return COLORS[1];
    if (value <= b2) return COLORS[2];
    if (value <= b3) return COLORS[3];
    return COLORS[4];
  }
}

/** 凡例エントリーを返す */
export function getLegendEntries(metric: Metric, thresholds?: CustomThresholds): LegendEntry[] {
  const t = (thresholds ?? DEFAULT_THRESHOLDS)[metric];
  const [b0, b1, b2, b3] = t.boundaries;
  const u = t.unit;

  if (t.higherIsBetter) {
    return [
      { label: `≥${b0} ${u} (${t.labels[0]})`, color: COLORS[0] },
      { label: `${b1}~${b0} ${u} (${t.labels[1]})`, color: COLORS[1] },
      { label: `${b2}~${b1} ${u} (${t.labels[2]})`, color: COLORS[2] },
      { label: `${b3}~${b2} ${u} (${t.labels[3]})`, color: COLORS[3] },
      { label: `<${b3} ${u} (${t.labels[4]})`, color: COLORS[4] },
    ];
  } else {
    return [
      { label: `≤${b0} ${u} (${t.labels[0]})`, color: COLORS[0] },
      { label: `${b0}~${b1} ${u} (${t.labels[1]})`, color: COLORS[1] },
      { label: `${b1}~${b2} ${u} (${t.labels[2]})`, color: COLORS[2] },
      { label: `${b2}~${b3} ${u} (${t.labels[3]})`, color: COLORS[3] },
      { label: `>${b3} ${u} (${t.labels[4]})`, color: COLORS[4] },
    ];
  }
}
