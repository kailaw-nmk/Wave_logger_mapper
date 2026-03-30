import type { AggregatedRow } from '@/lib/csvParser';

/** マーカー形状 */
export type MarkerShape = 'circle' | 'triangle' | 'square' | 'diamond' | 'pentagon' | 'star';

/** グループモード */
export type GroupMode = 'none' | 'vehicle' | 'file' | 'carrier';

/** グループごとのスタイル */
export interface GroupStyle {
  shape: MarkerShape;
  borderColor: string;
  label: string;
}

// 6形状 × 10色 = 60パターン
const SHAPES: MarkerShape[] = ['circle', 'triangle', 'square', 'diamond', 'pentagon', 'star'];
const GROUP_COLORS: string[] = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#393b79',
];

/** グループキーの配列を受け取り、shape+colorを順番に割り当てる */
export function assignGroupStyles(groups: string[]): Map<string, GroupStyle> {
  const map = new Map<string, GroupStyle>();
  for (let i = 0; i < groups.length; i++) {
    const shapeIdx = i % SHAPES.length;
    const colorIdx = i % GROUP_COLORS.length;
    map.set(groups[i], {
      shape: SHAPES[shapeIdx],
      borderColor: GROUP_COLORS[colorIdx],
      label: groups[i],
    });
  }
  return map;
}

/** AggregatedRow からグループキーを取得する */
export function getGroupKey(row: AggregatedRow, mode: GroupMode): string | null {
  if (mode === 'vehicle') return row.vehicle_ids[0] ?? null;
  if (mode === 'file') return row.sourceFiles[0] ?? null;
  if (mode === 'carrier') return row.carriers[0] ?? null;
  return null;
}
