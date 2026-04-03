import type { CsvRow } from '@/lib/csvParser';
import type { Metric, CustomThresholds } from '@/lib/colorScale';
import { METRIC_LABELS, DEFAULT_THRESHOLDS } from '@/lib/colorScale';
import type { GroupMode } from '@/lib/groupStyle';
import type { AnalysisCluster } from '@/lib/analysisParser';

/** プロジェクトファイルの型定義 */
export interface WlmProjectFile {
  version: 1;
  exportedAt: string;
  rawRows: CsvRow[];
  loadedFiles: string[];
  metric: Metric;
  customThresholds: CustomThresholds;
  filterEnabled: boolean;
  filterMax: number;
  naFilter: 'none' | 'tcp' | 'udp' | 'both';
  groupMode: GroupMode;
  showChart: boolean;
  binSize: number;
  mapHeightPercent: number;
  analysisClusters?: AnalysisCluster[];
  showAnalysisLayer?: boolean;
  showMeasurementLayer?: boolean;
}

/** エクスポート用のstate */
export interface ProjectState {
  rawRows: CsvRow[];
  loadedFiles: string[];
  metric: Metric;
  customThresholds: CustomThresholds;
  filterEnabled: boolean;
  filterMax: number;
  naFilter: 'none' | 'tcp' | 'udp' | 'both';
  groupMode: GroupMode;
  showChart: boolean;
  binSize: number;
  mapHeightPercent: number;
  analysisClusters?: AnalysisCluster[];
  showAnalysisLayer?: boolean;
  showMeasurementLayer?: boolean;
}

/** stateからJSON文字列を生成する */
export function exportProject(state: ProjectState): string {
  const file: WlmProjectFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    ...state,
  };
  return JSON.stringify(file);
}

/** JSONをバリデーションしてパースする */
export function validateAndParseProject(json: string): WlmProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('JSONの解析に失敗しました。ファイルが破損している可能性があります。');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('無効なプロジェクトファイルです。');
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.version !== 1) {
    throw new Error(`未対応のバージョンです: ${String(obj.version)}（対応: 1）`);
  }

  // rawRows バリデーション（分析クラスタのみの場合は空でも許容）
  const hasAnalysisClusters = Array.isArray(obj.analysisClusters) && (obj.analysisClusters as unknown[]).length > 0;
  if (!Array.isArray(obj.rawRows)) {
    obj.rawRows = [];
  }
  if ((obj.rawRows as unknown[]).length === 0 && !hasAnalysisClusters) {
    throw new Error('プロジェクトファイルにデータ行がありません。');
  }
  const rawRowsArr = obj.rawRows as unknown[];
  for (let i = 0; i < Math.min(rawRowsArr.length, 5); i++) {
    const row = rawRowsArr[i] as Record<string, unknown>;
    if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number' ||
        isNaN(row.latitude as number) || isNaN(row.longitude as number)) {
      throw new Error(`データ行 ${i + 1} に有効な緯度・経度がありません。`);
    }
  }

  // loadedFiles バリデーション
  if (!Array.isArray(obj.loadedFiles)) {
    obj.loadedFiles = [];
  }
  if ((obj.loadedFiles as unknown[]).length === 0 && !hasAnalysisClusters) {
    throw new Error('ファイル一覧がありません。');
  }

  // metric バリデーション
  const validMetrics = Object.keys(METRIC_LABELS);
  const metric = (validMetrics.includes(obj.metric as string) ? obj.metric : 'download_mbps') as Metric;

  // デフォルトフォールバック付きで組み立て
  const result: WlmProjectFile = {
    version: 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    rawRows: obj.rawRows as CsvRow[],
    loadedFiles: obj.loadedFiles as string[],
    metric,
    customThresholds: isValidThresholds(obj.customThresholds) ? obj.customThresholds as CustomThresholds : DEFAULT_THRESHOLDS,
    filterEnabled: typeof obj.filterEnabled === 'boolean' ? obj.filterEnabled : false,
    filterMax: typeof obj.filterMax === 'number' ? obj.filterMax : 50,
    naFilter: isValidNaFilter(obj.naFilter) ? obj.naFilter as 'none' | 'tcp' | 'udp' | 'both' : 'none',
    groupMode: isValidGroupMode(obj.groupMode) ? obj.groupMode as GroupMode : 'none',
    showChart: typeof obj.showChart === 'boolean' ? obj.showChart : false,
    binSize: typeof obj.binSize === 'number' && obj.binSize >= 1 ? obj.binSize : 50,
    mapHeightPercent: typeof obj.mapHeightPercent === 'number' ? obj.mapHeightPercent : 55,
    analysisClusters: Array.isArray(obj.analysisClusters) ? obj.analysisClusters as AnalysisCluster[] : [],
    showAnalysisLayer: typeof obj.showAnalysisLayer === 'boolean' ? obj.showAnalysisLayer : true,
    showMeasurementLayer: typeof obj.showMeasurementLayer === 'boolean' ? obj.showMeasurementLayer : true,
  };

  return result;
}

/** プロジェクトファイルをダウンロードする */
export function downloadProjectFile(state: ProjectState): void {
  const json = exportProject(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const fileName = `wlm_export_${timestamp}.wlm.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function isValidNaFilter(v: unknown): v is 'none' | 'tcp' | 'udp' | 'both' {
  return v === 'none' || v === 'tcp' || v === 'udp' || v === 'both';
}

function isValidGroupMode(v: unknown): v is GroupMode {
  return v === 'none' || v === 'vehicle' || v === 'file';
}

function isValidThresholds(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  const requiredKeys = Object.keys(DEFAULT_THRESHOLDS);
  return requiredKeys.every((key) => {
    const entry = obj[key];
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return typeof e.higherIsBetter === 'boolean' &&
      Array.isArray(e.boundaries) && e.boundaries.length === 4 &&
      Array.isArray(e.labels) && e.labels.length === 5 &&
      typeof e.unit === 'string';
  });
}
