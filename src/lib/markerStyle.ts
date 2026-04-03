import type { MarkerShape } from '@/lib/groupStyle';

/** マーカースタイル定義 */
export interface MarkerStyleDef {
  radius: number;
  color: string;
  fillOpacity: number;
  borderColor: string;
  borderWidth: number;
  shape: MarkerShape;
}

/** マーカー種別キー */
export type MarkerTypeKey =
  | 'measurement'
  | 'naTcp'
  | 'naUdp'
  | 'naBoth'
  | 'clusterFutsu'
  | 'clusterTeisoku'
  | 'reference';

/** マーカー種別のラベル */
export const MARKER_TYPE_LABELS: Record<MarkerTypeKey, string> = {
  measurement: '計測ポイント',
  naTcp: 'TCP不通',
  naUdp: 'UDP不通',
  naBoth: '完全不通 (TCP+UDP)',
  clusterFutsu: '完全不通エリア (分析)',
  clusterTeisoku: '低速不通エリア (分析)',
  reference: '参考データ',
};

/** 全マーカースタイル設定 */
export type MarkerStyles = Record<MarkerTypeKey, MarkerStyleDef>;

/** デフォルトスタイル */
export const DEFAULT_MARKER_STYLES: MarkerStyles = {
  measurement: {
    radius: 10,
    color: '', // 空 = メトリクス色を使用
    fillOpacity: 0.7,
    borderColor: '', // 空 = fillColorと同じ
    borderWidth: 1,
    shape: 'circle',
  },
  naTcp: {
    radius: 8,
    color: '#f97316',
    fillOpacity: 0.7,
    borderColor: '#f97316',
    borderWidth: 1,
    shape: 'circle',
  },
  naUdp: {
    radius: 8,
    color: '#8b5cf6',
    fillOpacity: 0.7,
    borderColor: '#8b5cf6',
    borderWidth: 1,
    shape: 'circle',
  },
  naBoth: {
    radius: 8,
    color: '#6b7280',
    fillOpacity: 0.7,
    borderColor: '#6b7280',
    borderWidth: 1,
    shape: 'circle',
  },
  clusterFutsu: {
    radius: 6,
    color: '#ef4444',
    fillOpacity: 0.8,
    borderColor: '#ef4444',
    borderWidth: 2,
    shape: 'circle',
  },
  clusterTeisoku: {
    radius: 6,
    color: '', // 空 = メトリクス色を使用
    fillOpacity: 0.8,
    borderColor: '',
    borderWidth: 2,
    shape: 'circle',
  },
  reference: {
    radius: 8,
    color: '#0ea5e9',
    fillOpacity: 0.8,
    borderColor: '#0ea5e9',
    borderWidth: 2,
    shape: 'circle',
  },
};

/** マーカースタイル設定をJSONファイルとしてダウンロードする */
export function downloadMarkerStyles(styles: MarkerStyles): void {
  const json = JSON.stringify(styles, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'marker_styles.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** JSONファイルからマーカースタイル設定を読み込む */
export function parseMarkerStyles(json: string): MarkerStyles {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('JSONの解析に失敗しました。');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('無効なマーカースタイルファイルです。');
  }

  const obj = parsed as Record<string, unknown>;
  const result = { ...DEFAULT_MARKER_STYLES };

  // 旧形式の 'na' キーを3種に展開（後方互換）
  if (obj.na && typeof obj.na === 'object' && !obj.naTcp) {
    obj.naTcp = obj.na;
    obj.naUdp = obj.na;
    obj.naBoth = obj.na;
  }

  for (const key of Object.keys(DEFAULT_MARKER_STYLES) as MarkerTypeKey[]) {
    const entry = obj[key];
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    result[key] = {
      radius: typeof e.radius === 'number' ? e.radius : DEFAULT_MARKER_STYLES[key].radius,
      color: typeof e.color === 'string' ? e.color : DEFAULT_MARKER_STYLES[key].color,
      fillOpacity: typeof e.fillOpacity === 'number' ? e.fillOpacity : DEFAULT_MARKER_STYLES[key].fillOpacity,
      borderColor: typeof e.borderColor === 'string' ? e.borderColor : DEFAULT_MARKER_STYLES[key].borderColor,
      borderWidth: typeof e.borderWidth === 'number' ? e.borderWidth : DEFAULT_MARKER_STYLES[key].borderWidth,
      shape: isValidShape(e.shape) ? e.shape : DEFAULT_MARKER_STYLES[key].shape,
    };
  }
  return result;
}

const VALID_SHAPES: MarkerShape[] = ['circle', 'triangle', 'square', 'diamond', 'pentagon', 'star'];
function isValidShape(v: unknown): v is MarkerShape {
  return typeof v === 'string' && VALID_SHAPES.includes(v as MarkerShape);
}
