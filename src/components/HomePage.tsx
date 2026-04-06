'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import CsvUploader from '@/components/CsvUploader';
import type { CsvRow, AggregatedRow, NaRecurrencePoint, MultiCarrierPoint, MultiCarrierSummary } from '@/lib/csvParser';
import { parseCsv, aggregateByLocation, toAggregatedRows, computeNaRecurrence, computeMultiCarrierCoverage } from '@/lib/csvParser';
import type { AnalysisCluster, ReferencePoint, KyotenPoint } from '@/lib/analysisParser';
import { detectCsvType, parseFutsuCsv, parseTeisokuCsv, parseReferenceCsv, parseKyotenCsv } from '@/lib/analysisParser';
import type { MapBounds } from '@/components/MapView';
import type { Metric, CustomThresholds } from '@/lib/colorScale';
import { METRIC_LABELS, DEFAULT_THRESHOLDS, syncGroupThresholds } from '@/lib/colorScale';
import type { GroupMode } from '@/lib/groupStyle';
import { assignGroupStyles } from '@/lib/groupStyle';
import { downloadProjectFile, validateAndParseProject } from '@/lib/projectFile';
import type { MarkerStyles } from '@/lib/markerStyle';
import { DEFAULT_MARKER_STYLES } from '@/lib/markerStyle';
import { fetchRoute, filterRowsByRoute } from '@/lib/routeFilter';

// Leafletはブラウザ専用のためSSR無効
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });
// SpeedChartもブラウザ専用のためSSR無効
const SpeedChart = dynamic(() => import('@/components/SpeedChart'), { ssr: false });
const ThresholdEditor = dynamic(() => import('@/components/ThresholdEditor'), { ssr: false });
const MarkerStyleEditor = dynamic(() => import('@/components/MarkerStyleEditor'), { ssr: false });

/** TCP計測が全てN/Aか（UDP帯域テスト行は除外） */
function isTcpNa(row: { download_mbps: number | null; upload_mbps: number | null; ping_ms: number | null; udp_download_mbps: number | null; udp_upload_mbps: number | null }): boolean {
  const tcpAllNull = row.download_mbps === null && row.upload_mbps === null && row.ping_ms === null;
  if (!tcpAllNull) return false;
  // UDP帯域テスト行は「TCP不通」ではない
  return row.udp_download_mbps === null && row.udp_upload_mbps === null;
}

/** UDP計測が全てN/Aか（TCP帯域テスト行は除外） */
function isUdpNa(row: { udp_download_mbps: number | null; udp_upload_mbps: number | null; udp_ping_ms: number | null; udp_jitter_ms: number | null; udp_packet_loss_pct: number | null; download_mbps: number | null; upload_mbps: number | null }): boolean {
  const udpAllNull = row.udp_download_mbps === null && row.udp_upload_mbps === null && row.udp_ping_ms === null && row.udp_jitter_ms === null && row.udp_packet_loss_pct === null;
  if (!udpAllNull) return false;
  // TCP帯域テスト行は「UDP不通」ではない
  return row.download_mbps === null && row.upload_mbps === null;
}

/** 完全不通: TCP+UDP両方の計測が全てN/A */
function isBothNa(row: { download_mbps: number | null; upload_mbps: number | null; ping_ms: number | null; udp_download_mbps: number | null; udp_upload_mbps: number | null; udp_ping_ms: number | null; udp_jitter_ms: number | null; udp_packet_loss_pct: number | null }): boolean {
  return isTcpNa(row) && isUdpNa(row);
}

/** NA行を単点不通と連続不通に分類する（ルートグループ内の順序に基づく） */
function classifyNaRows(
  allRows: CsvRow[],
  naCheckFn: (row: CsvRow) => boolean,
): { isolated: CsvRow[]; consecutive: CsvRow[] } {
  // _sourceFile::vehicle_id::carrier でグループ化
  const groups = new Map<string, CsvRow[]>();
  for (const row of allRows) {
    const key = `${row._sourceFile}::${row.vehicle_id}::${row.carrier ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(row);
  }

  const isolated: CsvRow[] = [];
  const consecutive: CsvRow[] = [];

  for (const rows of groups.values()) {
    const naFlags = rows.map(naCheckFn);
    for (let i = 0; i < rows.length; i++) {
      if (!naFlags[i]) continue;
      const prevNa = i > 0 && naFlags[i - 1];
      const nextNa = i < rows.length - 1 && naFlags[i + 1];
      if (prevNa || nextNa) {
        consecutive.push(rows[i]);
      } else {
        isolated.push(rows[i]);
      }
    }
  }

  return { isolated, consecutive };
}

/** メトリックがping系かどうか */
function isPingMetric(m: Metric): boolean {
  return m === 'ping_ms' || m === 'udp_ping_ms';
}

/** 値が大きいほど悪いメトリクスか（ping/jitter/packet loss） */
function isHigherWorse(m: Metric): boolean {
  return m === 'ping_ms' || m === 'udp_ping_ms' || m === 'udp_jitter_ms' || m === 'udp_packet_loss_pct';
}

/** メトリックの単位 */
function metricUnit(m: Metric): string {
  if (m === 'udp_packet_loss_pct') return '%';
  if (isPingMetric(m) || m === 'udp_jitter_ms') return 'ms';
  return 'Mbps';
}

export default function HomePage() {
  const [rawRows, setRawRows] = useState<CsvRow[]>([]);
  const [loadedFiles, setLoadedFiles] = useState<string[]>([]);

  // 分析クラスタデータ
  const [analysisClusters, setAnalysisClusters] = useState<AnalysisCluster[]>([]);
  // 参考データ
  const [referencePoints, setReferencePoints] = useState<ReferencePoint[]>([]);
  // 拠点データ
  const [kyotenPoints, setKyotenPoints] = useState<KyotenPoint[]>([]);
  // レイヤー表示切替
  const [showMeasurementLayer, setShowMeasurementLayer] = useState(true);
  const [showAnalysisLayer, setShowAnalysisLayer] = useState(true);
  const [showReferenceLayer, setShowReferenceLayer] = useState(true);
  const [showReferenceCircle, setShowReferenceCircle] = useState(false);
  const [showKyotenLayer, setShowKyotenLayer] = useState(true);
  const [metric, setMetric] = useState<Metric>('download_mbps');

  // カラー閾値（読み込み時にグループ内を同期）
  const [customThresholds, setCustomThresholds] = useState<CustomThresholds>(() => {
    if (typeof window === 'undefined') return DEFAULT_THRESHOLDS;
    try {
      const saved = localStorage.getItem('wlm_color_thresholds');
      if (saved) return syncGroupThresholds(JSON.parse(saved) as CustomThresholds);
    } catch { /* 破損データは無視 */ }
    return DEFAULT_THRESHOLDS;
  });
  const [showThresholdEditor, setShowThresholdEditor] = useState(false);
  const [markerStyles, setMarkerStyles] = useState<MarkerStyles>(() => ({ ...DEFAULT_MARKER_STYLES }));
  const [showMarkerStyleEditor, setShowMarkerStyleEditor] = useState(false);

  const handleThresholdsChange = useCallback((t: CustomThresholds) => {
    setCustomThresholds(t);
    try { localStorage.setItem('wlm_color_thresholds', JSON.stringify(t)); } catch { /* noop */ }
  }, []);

  // グループモード
  const [groupMode, setGroupMode] = useState<GroupMode>('none');

  // フィルタ
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [filterMax, setFilterMax] = useState<number>(50);
  // N/A（不通区間）フィルタ: 'none' | 'tcp' | 'udp'
  const [naFilter, setNaFilter] = useState<'none' | 'tcp' | 'udp' | 'both'>('none');
  // 不通ポイントのみ表示モード
  const [naOnly, setNaOnly] = useState(false);
  // 単点不通 / 連続不通の表示切替
  const [showIsolatedNa, setShowIsolatedNa] = useState(true);
  const [showConsecutiveNa, setShowConsecutiveNa] = useState(true);
  // 不通サークル表示（マーカー→サークル切替）
  const [showNaCircle, setShowNaCircle] = useState(false);
  const [naCircleRadius, setNaCircleRadius] = useState(50);
  // 不通再現率表示
  const [showNaRecurrence, setShowNaRecurrence] = useState(false);
  // マルチキャリア比較表示
  const [showMultiCarrier, setShowMultiCarrier] = useState(false);
  // マルチキャリア: 全社不通のみ表示
  const [multiCarrierAllNaOnly, setMultiCarrierAllNaOnly] = useState(false);
  // マルチキャリア比較半径(m)
  const [multiCarrierRadius, setMultiCarrierRadius] = useState(50);
  // 再現率クラスタリング半径(m)
  const [recurrenceRadius, setRecurrenceRadius] = useState(50);
  // 再現率フィルタ閾値(%)
  const [recurrenceMinPct, setRecurrenceMinPct] = useState(0);
  // ルート区間フィルタ
  const [routeFrom, setRouteFrom] = useState<KyotenPoint | null>(null);
  const [routeTo, setRouteTo] = useState<KyotenPoint | null>(null);
  const [routePolyline, setRoutePolyline] = useState<[number, number][] | null>(null);
  const [routeDistance, setRouteDistance] = useState(100);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  // 集約モード: true=近傍点を集約, false=全測定点を個別表示
  const [aggregate, setAggregate] = useState(true);
  // キャリアフィルタ: 選択中のキャリア（空=全表示）
  const [selectedCarriers, setSelectedCarriers] = useState<Set<string>>(new Set());

  // チャート
  const [showChart, setShowChart] = useState(false);
  const [binSize, setBinSize] = useState<number>(50);

  // チャート⇔マップ連動
  const [highlightLngRange, setHighlightLngRange] = useState<[number, number] | null>(null);
  const [selectedLng, setSelectedLng] = useState<number | null>(null);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);

  // ドラッグリサイズ
  const [mapHeightPercent, setMapHeightPercent] = useState(55);
  const mainRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);

  // プロジェクトファイル読込用
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !mainRef.current) return;
      const rect = mainRef.current.getBoundingClientRect();
      const percent = ((e.clientY - rect.top) / rect.height) * 100;
      setMapHeightPercent(Math.min(80, Math.max(20, percent)));
    };
    const handleMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ルート区間取得
  useEffect(() => {
    if (!routeFrom || !routeTo) {
      setRoutePolyline(null);
      setRouteError(null);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    setRouteError(null);
    fetchRoute(
      { lat: routeFrom.lat, lon: routeFrom.lon },
      { lat: routeTo.lat, lon: routeTo.lon },
    ).then((polyline) => {
      if (!cancelled) {
        setRoutePolyline(polyline);
        setRouteLoading(false);
      }
    }).catch((err) => {
      if (!cancelled) {
        setRouteError(err instanceof Error ? err.message : 'ルート取得エラー');
        setRoutePolyline(null);
        setRouteLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [routeFrom, routeTo]);

  // データに含まれるキャリア一覧
  const availableCarriers = useMemo(() => {
    const set = new Set<string>();
    for (const row of rawRows) {
      if (row.carrier) set.add(row.carrier);
    }
    for (const cluster of analysisClusters) {
      if (cluster.carrier) set.add(cluster.carrier);
    }
    return Array.from(set).sort();
  }, [rawRows, analysisClusters]);

  // キャリアフィルタ適用後の生データ
  const carrierFilteredRows = useMemo(() => {
    if (selectedCarriers.size === 0) return rawRows;
    return rawRows.filter((r) => r.carrier !== null && selectedCarriers.has(r.carrier));
  }, [rawRows, selectedCarriers]);

  // ルートフィルタ適用後の生データ
  const routeFilteredRows = useMemo(() => {
    if (!routePolyline) return carrierFilteredRows;
    return filterRowsByRoute(carrierFilteredRows, routePolyline, routeDistance);
  }, [carrierFilteredRows, routePolyline, routeDistance]);

  // キャリアフィルタ適用後の分析クラスタ
  const carrierFilteredClusters = useMemo(() => {
    if (selectedCarriers.size === 0) return analysisClusters;
    return analysisClusters.filter((c) => selectedCarriers.has(c.carrier));
  }, [analysisClusters, selectedCarriers]);

  const data = useMemo(() => aggregate ? aggregateByLocation(routeFilteredRows) : toAggregatedRows(routeFilteredRows), [routeFilteredRows, aggregate]);

  // グループスタイルを計算（分析クラスタのキーも含める）
  const groupStyles = useMemo(() => {
    if (groupMode === 'none') return new Map();
    const keys = new Set<string>();
    for (const row of rawRows) {
      const key = groupMode === 'vehicle' ? row.vehicle_id
        : groupMode === 'carrier' ? (row.carrier ?? '')
        : row._sourceFile;
      if (key) keys.add(key);
    }
    for (const cluster of analysisClusters) {
      const key = groupMode === 'vehicle' ? cluster.vehicles
        : groupMode === 'carrier' ? cluster.carrier
        : cluster._sourceFile;
      if (key) keys.add(key);
    }
    return assignGroupStyles(Array.from(keys));
  }, [rawRows, analysisClusters, groupMode]);

  // フィルタ後の集約データ（マップ用 — 通常ポイント）
  const filteredAggregated = useMemo(() => {
    let result = data;
    if (filterEnabled) {
      const higherWorse = isHigherWorse(metric);
      result = result.filter((row) => {
        const v = row[metric];
        return v === null || (higherWorse ? v >= filterMax : v <= filterMax);
      });
    }
    return result;
  }, [data, filterEnabled, filterMax, metric]);

  // 不通ポイントを単点/連続に分類（N/Aフィルタ有効時のみ）
  const { isolatedNaPoints, consecutiveNaPoints } = useMemo(() => {
    if (naFilter === 'none') return { isolatedNaPoints: [] as AggregatedRow[], consecutiveNaPoints: [] as AggregatedRow[] };
    const fn = naFilter === 'tcp' ? isTcpNa : naFilter === 'udp' ? isUdpNa : isBothNa;
    const { isolated, consecutive } = classifyNaRows(routeFilteredRows, fn);
    return {
      isolatedNaPoints: aggregate ? aggregateByLocation(isolated) : toAggregatedRows(isolated),
      consecutiveNaPoints: aggregate ? aggregateByLocation(consecutive) : toAggregatedRows(consecutive),
    };
  }, [routeFilteredRows, naFilter, aggregate]);

  // 表示用に結合（フィルタ状態に応じて）
  const naPoints = useMemo(() => {
    const result: AggregatedRow[] = [];
    if (showIsolatedNa) result.push(...isolatedNaPoints);
    if (showConsecutiveNa) result.push(...consecutiveNaPoints);
    return result;
  }, [isolatedNaPoints, consecutiveNaPoints, showIsolatedNa, showConsecutiveNa]);

  // 不通再現率（地点ごとの不通頻度）
  const naRecurrencePointsAll = useMemo((): NaRecurrencePoint[] => {
    if (naFilter === 'none' || !showNaRecurrence) return [];
    const fn = naFilter === 'tcp' ? isTcpNa : naFilter === 'udp' ? isUdpNa : isBothNa;
    return computeNaRecurrence(routeFilteredRows, fn, recurrenceRadius);
  }, [routeFilteredRows, naFilter, showNaRecurrence, recurrenceRadius]);

  // 再現率フィルタ適用
  const naRecurrencePoints = useMemo((): NaRecurrencePoint[] => {
    if (recurrenceMinPct <= 0) return naRecurrencePointsAll;
    return naRecurrencePointsAll.filter((pt) => pt.recurrenceRate >= recurrenceMinPct);
  }, [naRecurrencePointsAll, recurrenceMinPct]);

  // マルチキャリア比較（キャリアフィルタ無視で全キャリアの生データ���使う）
  const { multiCarrierPoints, multiCarrierSummary } = useMemo((): {
    multiCarrierPoints: MultiCarrierPoint[];
    multiCarrierSummary: MultiCarrierSummary | null;
  } => {
    if (naFilter === 'none' || !showMultiCarrier || availableCarriers.length < 2) {
      return { multiCarrierPoints: [], multiCarrierSummary: null };
    }
    const fn = naFilter === 'tcp' ? isTcpNa : naFilter === 'udp' ? isUdpNa : isBothNa;
    const { points, summary } = computeMultiCarrierCoverage(rawRows, fn, availableCarriers, multiCarrierRadius);
    return { multiCarrierPoints: points, multiCarrierSummary: summary };
  }, [rawRows, naFilter, showMultiCarrier, availableCarriers, multiCarrierRadius]);

  // フィルタ後の生データ（チャート用）
  const filteredRaw = useMemo(() => {
    let result = routeFilteredRows;
    if (filterEnabled) {
      const higherWorse = isHigherWorse(metric);
      result = result.filter((row) => {
        const v = row[metric];
        return v === null || (higherWorse ? v >= filterMax : v <= filterMax);
      });
    }
    return result;
  }, [routeFilteredRows, filterEnabled, filterMax, metric]);

  // マップ表示範囲内の生データ（チャート用）
  const chartData = useMemo(() => {
    if (!mapBounds) return filteredRaw;
    return filteredRaw.filter((row) =>
      row.latitude >= mapBounds.south &&
      row.latitude <= mapBounds.north &&
      row.longitude >= mapBounds.west &&
      row.longitude <= mapBounds.east,
    );
  }, [filteredRaw, mapBounds]);

  const handleFilesLoaded = useCallback(
    (files: { text: string; fileName: string }[]) => {
      const newRows: CsvRow[] = [];
      const newClusters: AnalysisCluster[] = [];
      const newRefs: ReferencePoint[] = [];
      const newKyoten: KyotenPoint[] = [];
      const newFileNames: string[] = [];

      for (const { text, fileName } of files) {
        // 重複ファイル名チェック
        if (loadedFiles.includes(fileName)) {
          alert(`「${fileName}」は既に読み込まれています`);
          continue;
        }

        const csvType = detectCsvType(text, fileName);

        if (csvType === 'futsu') {
          const clusters = parseFutsuCsv(text, fileName);
          if (clusters.length === 0) {
            alert(`「${fileName}」に有効なクラスタデータがありません`);
            continue;
          }
          newClusters.push(...clusters);
          newFileNames.push(fileName);
        } else if (csvType === 'teisoku') {
          const clusters = parseTeisokuCsv(text, fileName);
          if (clusters.length === 0) {
            alert(`「${fileName}」に有効なクラスタデータがありません`);
            continue;
          }
          newClusters.push(...clusters);
          newFileNames.push(fileName);
        } else if (csvType === 'kyoten') {
          const pts = parseKyotenCsv(text, fileName);
          if (pts.length === 0) {
            alert(`「${fileName}」に有効な拠点データがありません`);
            continue;
          }
          newKyoten.push(...pts);
          newFileNames.push(fileName);
        } else if (csvType === 'reference') {
          const refs = parseReferenceCsv(text, fileName);
          if (refs.length === 0) {
            alert(`「${fileName}」に有効な参考データがありません`);
            continue;
          }
          newRefs.push(...refs);
          newFileNames.push(fileName);
        } else {
          const rows = parseCsv(text, fileName);
          if (rows.length === 0) {
            alert(`「${fileName}」に有効なデータがありません`);
            continue;
          }
          newRows.push(...rows);
          newFileNames.push(fileName);
        }
      }

      if (newRows.length > 0) {
        setRawRows((prev) => [...prev, ...newRows]);
      }
      if (newClusters.length > 0) {
        setAnalysisClusters((prev) => [...prev, ...newClusters]);
      }
      if (newRefs.length > 0) {
        setReferencePoints((prev) => [...prev, ...newRefs]);
      }
      if (newKyoten.length > 0) {
        setKyotenPoints((prev) => [...prev, ...newKyoten]);
      }
      if (newFileNames.length > 0) {
        setLoadedFiles((prev) => [...prev, ...newFileNames]);
      }
    },
    [loadedFiles],
  );

  function handleFileRemove(fileName: string) {
    setRawRows((prev) => prev.filter((r) => r._sourceFile !== fileName));
    setAnalysisClusters((prev) => prev.filter((c) => c._sourceFile !== fileName));
    setReferencePoints((prev) => prev.filter((r) => r._sourceFile !== fileName));
    setKyotenPoints((prev) => prev.filter((k) => k._sourceFile !== fileName));
    setLoadedFiles((prev) => prev.filter((f) => f !== fileName));
  }

  const handleExport = useCallback(() => {
    downloadProjectFile({
      rawRows, loadedFiles, metric, customThresholds,
      filterEnabled, filterMax, naFilter, groupMode,
      showChart, binSize, mapHeightPercent,
      analysisClusters, referencePoints,
      showAnalysisLayer, showMeasurementLayer, showReferenceLayer,
      markerStyles,
      showIsolatedNa, showConsecutiveNa, showNaRecurrence, showMultiCarrier, recurrenceRadius, multiCarrierRadius,
    });
  }, [rawRows, loadedFiles, metric, customThresholds, filterEnabled, filterMax, naFilter, groupMode, showChart, binSize, mapHeightPercent, analysisClusters, referencePoints, showAnalysisLayer, showMeasurementLayer, showReferenceLayer, markerStyles, showIsolatedNa, showConsecutiveNa, showNaRecurrence, showMultiCarrier, recurrenceRadius, multiCarrierRadius]);

  const handleImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project = validateAndParseProject(reader.result as string);
        if (rawRows.length > 0 && !confirm('現在のデータを置き換えますか？')) return;
        setRawRows(project.rawRows);
        setLoadedFiles(project.loadedFiles);
        setMetric(project.metric);
        setCustomThresholds(project.customThresholds);
        try { localStorage.setItem('wlm_color_thresholds', JSON.stringify(project.customThresholds)); } catch { /* noop */ }
        setFilterEnabled(project.filterEnabled);
        setFilterMax(project.filterMax);
        setNaFilter(project.naFilter);
        setGroupMode(project.groupMode);
        setShowChart(project.showChart);
        setBinSize(project.binSize);
        setMapHeightPercent(project.mapHeightPercent);
        setAnalysisClusters(project.analysisClusters ?? []);
        setReferencePoints(project.referencePoints ?? []);
        setShowAnalysisLayer(project.showAnalysisLayer ?? true);
        setShowMeasurementLayer(project.showMeasurementLayer ?? true);
        setShowReferenceLayer(project.showReferenceLayer ?? true);
        if (project.markerStyles) setMarkerStyles(project.markerStyles);
        setShowIsolatedNa(project.showIsolatedNa ?? true);
        setShowConsecutiveNa(project.showConsecutiveNa ?? true);
        setShowNaRecurrence(project.showNaRecurrence ?? false);
        setShowMultiCarrier(project.showMultiCarrier ?? false);
        setRecurrenceRadius(project.recurrenceRadius ?? 50);
        setMultiCarrierRadius(project.multiCarrierRadius ?? 50);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'プロジェクトファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
  }, [rawRows.length]);

  const hasData = data.length > 0 || analysisClusters.length > 0 || referencePoints.length > 0 || kyotenPoints.length > 0;
  const unit = metricUnit(metric);
  const filterStep = isPingMetric(metric) ? 10 : 5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* ヘッダー */}
      <header style={{
        padding: '8px 20px',
        background: '#fff',
        borderBottom: '1px solid #e0e0e0',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Wave Logger Mapper
        </h1>

        {hasData && (
          <>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid #ccc',
                fontSize: 13,
              }}
            >
              {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
                <option key={m} value={m}>{METRIC_LABELS[m]}</option>
              ))}
            </select>

            {/* 閾値設定ボタン */}
            <button
              onClick={() => setShowThresholdEditor(true)}
              title="カラー閾値設定"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #ccc',
                background: JSON.stringify(customThresholds) !== JSON.stringify(DEFAULT_THRESHOLDS) ? '#fef3c7' : '#fff',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              &#9881; 閾値
            </button>

            {/* マーカースタイル設定ボタン */}
            <button
              onClick={() => setShowMarkerStyleEditor(true)}
              title="マーカースタイル設定"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #ccc',
                background: JSON.stringify(markerStyles) !== JSON.stringify(DEFAULT_MARKER_STYLES) ? '#e0f2fe' : '#fff',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              &#9679; マーカー
            </button>

            {/* 集約モード切替 */}
            <button
              onClick={() => setAggregate((v) => !v)}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: aggregate ? '1px solid #ccc' : '2px solid #8b5cf6',
                background: aggregate ? '#fff' : '#f5f3ff',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: aggregate ? 400 : 600,
              }}
              title={aggregate ? '近傍点を集約表示中（クリックで全点表示）' : '全測定点を個別表示中（クリックで集約表示）'}
            >
              {aggregate ? '集約' : '全点'} ({data.length})
            </button>

            {/* フィルタUI */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={filterEnabled}
                  onChange={(e) => setFilterEnabled(e.target.checked)}
                />
                フィルタ
              </label>
              {filterEnabled && (
                <>
                  <input
                    type="number"
                    value={filterMax}
                    onChange={(e) => setFilterMax(Number(e.target.value))}
                    step={filterStep}
                    min={0}
                    style={{
                      width: 60,
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: '1px solid #ccc',
                      fontSize: 13,
                    }}
                  />
                  <span style={{ color: '#666' }}>{unit} {isHigherWorse(metric) ? '以上' : '以下'}</span>
                  <span style={{
                    fontSize: 11,
                    background: '#e0e7ff',
                    color: '#3b4fc4',
                    padding: '1px 6px',
                    borderRadius: 8,
                  }}>
                    {filteredAggregated.length} / {data.length} 件
                  </span>
                </>
              )}
            </div>

            {/* 不通区間フィルタ */}
            <div style={{ display: 'flex', gap: 4, fontSize: 13 }}>
              <button
                onClick={() => {
                  const next = naFilter === 'tcp' ? 'none' : 'tcp';
                  setNaFilter(next);
                  if (next === 'none') setNaOnly(false);
                }}
                style={{
                  padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                  border: naFilter === 'tcp' ? '2px solid #ef4444' : '1px solid #ccc',
                  background: naFilter === 'tcp' ? '#fef2f2' : '#fff',
                  fontWeight: naFilter === 'tcp' ? 600 : 400,
                }}
              >
                TCP不通
              </button>
              <button
                onClick={() => {
                  const next = naFilter === 'udp' ? 'none' : 'udp';
                  setNaFilter(next);
                  if (next === 'none') setNaOnly(false);
                }}
                style={{
                  padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                  border: naFilter === 'udp' ? '2px solid #ef4444' : '1px solid #ccc',
                  background: naFilter === 'udp' ? '#fef2f2' : '#fff',
                  fontWeight: naFilter === 'udp' ? 600 : 400,
                }}
              >
                UDP不通
              </button>
              <button
                onClick={() => {
                  const next = naFilter === 'both' ? 'none' : 'both';
                  setNaFilter(next);
                  if (next === 'none') setNaOnly(false);
                }}
                style={{
                  padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                  border: naFilter === 'both' ? '2px solid #ef4444' : '1px solid #ccc',
                  background: naFilter === 'both' ? '#fef2f2' : '#fff',
                  fontWeight: naFilter === 'both' ? 600 : 400,
                }}
              >
                完全不通
              </button>
              {naFilter !== 'none' && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={showIsolatedNa}
                      onChange={(e) => setShowIsolatedNa(e.target.checked)}
                    />
                    単点不通
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={showConsecutiveNa}
                      onChange={(e) => setShowConsecutiveNa(e.target.checked)}
                    />
                    連続不通
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={showNaCircle}
                      onChange={(e) => setShowNaCircle(e.target.checked)}
                    />
                    サークル
                  </label>
                  {showNaCircle && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#666' }}>
                      <input
                        type="number"
                        value={naCircleRadius}
                        onChange={(e) => setNaCircleRadius(Math.max(1, Number(e.target.value)))}
                        min={1}
                        step={10}
                        style={{
                          width: 52,
                          padding: '2px 4px',
                          borderRadius: 4,
                          border: '1px solid #ccc',
                          fontSize: 12,
                        }}
                      />
                      m
                    </label>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={showNaRecurrence}
                      onChange={(e) => {
                        setShowNaRecurrence(e.target.checked);
                        if (e.target.checked) setShowMultiCarrier(false);
                      }}
                    />
                    再現率
                  </label>
                  {showNaRecurrence && (
                    <>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#666' }}>
                        半径:
                        <input
                          type="number"
                          value={recurrenceRadius}
                          onChange={(e) => setRecurrenceRadius(Math.max(0, Number(e.target.value)))}
                          min={0}
                          step={10}
                          style={{
                            width: 52,
                            padding: '2px 4px',
                            borderRadius: 4,
                            border: '1px solid #ccc',
                            fontSize: 12,
                          }}
                        />
                        m
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#666' }}>
                        ≥
                        <input
                          type="number"
                          value={recurrenceMinPct}
                          onChange={(e) => setRecurrenceMinPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                          min={0}
                          max={100}
                          step={10}
                          style={{
                            width: 46,
                            padding: '2px 4px',
                            borderRadius: 4,
                            border: '1px solid #ccc',
                            fontSize: 12,
                          }}
                        />
                        %
                      </label>
                      {recurrenceMinPct > 0 && (
                        <span style={{ fontSize: 11, background: '#e0e7ff', color: '#3b4fc4', padding: '1px 6px', borderRadius: 8 }}>
                          {naRecurrencePoints.length} / {naRecurrencePointsAll.length} 件
                        </span>
                      )}
                    </>
                  )}
                  {availableCarriers.length >= 2 && (
                    <>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={showMultiCarrier}
                          onChange={(e) => {
                            setShowMultiCarrier(e.target.checked);
                            if (e.target.checked) setShowNaRecurrence(false);
                          }}
                        />
                        マルチ比較
                      </label>
                      {showMultiCarrier && (
                        <>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#666' }}>
                            半径:
                            <input
                              type="number"
                              value={multiCarrierRadius}
                              onChange={(e) => setMultiCarrierRadius(Math.max(0, Number(e.target.value)))}
                              min={0}
                              step={10}
                              style={{
                                width: 52,
                                padding: '2px 4px',
                                borderRadius: 4,
                                border: '1px solid #ccc',
                                fontSize: 12,
                              }}
                            />
                            m
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={multiCarrierAllNaOnly}
                              onChange={(e) => setMultiCarrierAllNaOnly(e.target.checked)}
                            />
                            全社不通のみ
                          </label>
                        </>
                      )}
                    </>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={naOnly}
                      onChange={(e) => setNaOnly(e.target.checked)}
                    />
                    不通のみ
                  </label>
                </>
              )}
            </div>

            {/* グループ表示 */}
            <select
              value={groupMode}
              onChange={(e) => setGroupMode(e.target.value as GroupMode)}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid #ccc',
                fontSize: 13,
              }}
            >
              <option value="none">グループ: なし</option>
              <option value="vehicle">グループ: 車両ID</option>
              <option value="file">グループ: ファイル</option>
              <option value="carrier">グループ: キャリア</option>
            </select>

            {/* キャリアフィルタ */}
            {availableCarriers.length >= 2 && (
              <div style={{ display: 'flex', gap: 4, fontSize: 13, alignItems: 'center' }}>
                <span style={{ color: '#666' }}>キャリア:</span>
                {availableCarriers.map((c) => {
                  const active = selectedCarriers.size === 0 || selectedCarriers.has(c);
                  return (
                    <button
                      key={c}
                      onClick={() => {
                        setSelectedCarriers((prev) => {
                          const next = new Set(prev);
                          if (prev.size === 0) {
                            // 全表示→このキャリアだけ選択
                            return new Set([c]);
                          }
                          if (next.has(c)) {
                            next.delete(c);
                            // 全部外れたら全表示に戻す
                            return next.size === 0 ? new Set<string>() : next;
                          }
                          next.add(c);
                          // 全キャリアが選択されたら全表示に戻す
                          return next.size === availableCarriers.length ? new Set<string>() : next;
                        });
                      }}
                      style={{
                        padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                        border: active ? '2px solid #8b5cf6' : '1px solid #ccc',
                        background: active ? '#f5f3ff' : '#f5f5f5',
                        fontWeight: active ? 600 : 400,
                        opacity: active ? 1 : 0.5,
                      }}
                    >
                      {c}
                    </button>
                  );
                })}
                {selectedCarriers.size > 0 && (
                  <button
                    onClick={() => setSelectedCarriers(new Set())}
                    style={{
                      padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                      border: '1px solid #ccc', background: '#fff', fontSize: 12,
                    }}
                  >
                    全表示
                  </button>
                )}
              </div>
            )}

            {/* グラフ表示ボタン（全メトリクスで表示可能） */}
            <button
              onClick={() => setShowChart((v) => !v)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #ccc',
                background: showChart ? '#e0e7ff' : '#fff',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {showChart ? '\u25B2 グラフ非表示' : '\u25BC グラフ表示'}
            </button>

            {/* レイヤー切替 */}
            {(rawRows.length > 0 || analysisClusters.length > 0 || referencePoints.length > 0 || kyotenPoints.length > 0) && (
              <div style={{ display: 'flex', gap: 4, fontSize: 13 }}>
                {rawRows.length > 0 && (
                  <button
                    onClick={() => setShowMeasurementLayer((v) => !v)}
                    style={{
                      padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                      border: showMeasurementLayer ? '2px solid #3b82f6' : '1px solid #ccc',
                      background: showMeasurementLayer ? '#eff6ff' : '#fff',
                      fontWeight: showMeasurementLayer ? 600 : 400,
                    }}
                  >
                    {showMeasurementLayer ? '■' : '□'} 計測ログ
                  </button>
                )}
                {analysisClusters.length > 0 && (
                  <button
                    onClick={() => setShowAnalysisLayer((v) => !v)}
                    style={{
                      padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                      border: showAnalysisLayer ? '2px solid #f59e0b' : '1px solid #ccc',
                      background: showAnalysisLayer ? '#fffbeb' : '#fff',
                      fontWeight: showAnalysisLayer ? 600 : 400,
                    }}
                  >
                    {showAnalysisLayer ? '■' : '□'} 分析エリア ({analysisClusters.length})
                  </button>
                )}
                {referencePoints.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowReferenceLayer((v) => !v)}
                      style={{
                        padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                        border: showReferenceLayer ? '2px solid #0ea5e9' : '1px solid #ccc',
                        background: showReferenceLayer ? '#e0f2fe' : '#fff',
                        fontWeight: showReferenceLayer ? 600 : 400,
                      }}
                    >
                      {showReferenceLayer ? '■' : '□'} 参考データ ({referencePoints.length})
                    </button>
                    {showReferenceLayer && (
                      <button
                        onClick={() => setShowReferenceCircle((v) => !v)}
                        style={{
                          padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                          border: showReferenceCircle ? '2px solid #0ea5e9' : '1px solid #ccc',
                          background: showReferenceCircle ? '#e0f2fe' : '#fff',
                          fontWeight: showReferenceCircle ? 600 : 400,
                          fontSize: 12,
                        }}
                        title="参考データ中心に時速80km×10秒(222m)の範囲を表示"
                      >
                        ◎ サークル
                      </button>
                    )}
                  </>
                )}
                {kyotenPoints.length > 0 && (
                  <button
                    onClick={() => setShowKyotenLayer((v) => !v)}
                    style={{
                      padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                      border: showKyotenLayer ? '2px solid #10b981' : '1px solid #ccc',
                      background: showKyotenLayer ? '#d1fae5' : '#fff',
                      fontWeight: showKyotenLayer ? 600 : 400,
                    }}
                  >
                    {showKyotenLayer ? '■' : '□'} 拠点データ ({kyotenPoints.length})
                  </button>
                )}
              </div>
            )}

            {/* ルート区間フィルタ */}
            {kyotenPoints.length >= 2 && (
              <div style={{ display: 'flex', gap: 4, fontSize: 12, alignItems: 'center' }}>
                <span style={{ color: '#666', fontWeight: 600 }}>区間:</span>
                <select
                  value={routeFrom ? `${routeFrom.lat},${routeFrom.lon}` : ''}
                  onChange={(e) => {
                    if (!e.target.value) { setRouteFrom(null); return; }
                    const pt = kyotenPoints.find((r) => `${r.lat},${r.lon}` === e.target.value);
                    setRouteFrom(pt ?? null);
                  }}
                  style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc', fontSize: 12, maxWidth: 120 }}
                >
                  <option value="">始点...</option>
                  {kyotenPoints.map((r, i) => (
                    <option key={`from-${i}`} value={`${r.lat},${r.lon}`}>{r.label || `#${r.rank}`}</option>
                  ))}
                </select>
                <span>→</span>
                <select
                  value={routeTo ? `${routeTo.lat},${routeTo.lon}` : ''}
                  onChange={(e) => {
                    if (!e.target.value) { setRouteTo(null); return; }
                    const pt = kyotenPoints.find((r) => `${r.lat},${r.lon}` === e.target.value);
                    setRouteTo(pt ?? null);
                  }}
                  style={{ padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc', fontSize: 12, maxWidth: 120 }}
                >
                  <option value="">終点...</option>
                  {kyotenPoints.map((r, i) => (
                    <option key={`to-${i}`} value={`${r.lat},${r.lon}`}>{r.label || `#${r.rank}`}</option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 2, color: '#666' }}>
                  <input
                    type="number"
                    value={routeDistance}
                    onChange={(e) => setRouteDistance(Math.max(1, Number(e.target.value)))}
                    min={1}
                    step={10}
                    style={{ width: 48, padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc', fontSize: 12 }}
                  />
                  m
                </label>
                {routePolyline && (
                  <button
                    onClick={() => { setRouteFrom(null); setRouteTo(null); }}
                    style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', fontSize: 12, cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                )}
                {routeLoading && <span style={{ color: '#3b82f6' }}>読込中...</span>}
                {routeError && <span style={{ color: '#ef4444' }}>{routeError}</span>}
                {routePolyline && !routeLoading && (
                  <span style={{ fontSize: 11, background: '#e0e7ff', color: '#3b4fc4', padding: '1px 6px', borderRadius: 8 }}>
                    {routeFilteredRows.length} / {carrierFilteredRows.length} 件
                  </span>
                )}
              </div>
            )}

            {/* プロジェクト保存/読込 */}
            <button
              onClick={handleExport}
              title="プロジェクトファイルを保存"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #ccc',
                background: '#fff',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              ↓ 保存
            </button>
            <button
              onClick={() => importInputRef.current?.click()}
              title="プロジェクトファイルを読込"
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #ccc',
                background: '#fff',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              ↑ 読込
            </button>

            <CsvUploader onFilesLoaded={handleFilesLoaded} compact />

            {/* ファイル一覧 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {loadedFiles.map((f) => {
                const measureCount = rawRows.filter((r) => r._sourceFile === f).length;
                const clusterCount = analysisClusters.filter((c) => c._sourceFile === f).length;
                const refCount = referencePoints.filter((r) => r._sourceFile === f).length;
                const kyotenCount = kyotenPoints.filter((k) => k._sourceFile === f).length;
                const label = kyotenCount > 0 ? `${kyotenCount}拠点` : refCount > 0 ? `${refCount}地点` : clusterCount > 0 ? `${clusterCount}クラスタ` : `${measureCount}件`;
                return (
                  <span
                    key={f}
                    style={{
                      fontSize: 12,
                      color: '#555',
                      background: kyotenCount > 0 ? '#d1fae5' : refCount > 0 ? '#e0f2fe' : clusterCount > 0 ? '#fef3c7' : '#f0f0f0',
                      padding: '2px 8px',
                      borderRadius: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {f} ({label})
                    <button
                      onClick={() => handleFileRemove(f)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#999',
                        fontSize: 14,
                        padding: '0 2px',
                        lineHeight: 1,
                      }}
                      title={`${f} を削除`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          </>
        )}
      </header>

      {/* メインコンテンツ */}
      <main ref={mainRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!hasData ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: 40,
          }}>
            <div style={{ maxWidth: 500, width: '100%' }}>
              <CsvUploader onFilesLoaded={handleFilesLoaded} />
              <p style={{
                marginTop: 16,
                fontSize: 13,
                color: '#999',
                textAlign: 'center',
              }}>
                Radio Wave Logger の netlog_*.csv または分析CSV（不通エリア・低速エリア）をアップロードしてください（複数可）
              </p>
              <p style={{
                marginTop: 8,
                fontSize: 13,
                textAlign: 'center',
              }}>
                <button
                  onClick={() => importInputRef.current?.click()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#3b82f6',
                    cursor: 'pointer',
                    fontSize: 13,
                    textDecoration: 'underline',
                  }}
                >
                  またはプロジェクトファイルを読み込む (.wlm.json)
                </button>
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* マップエリア */}
            <div style={{
              flex: showChart ? `0 0 ${mapHeightPercent}%` : '1 1 auto',
              position: 'relative',
              minHeight: 160,
            }}>
              <MapView
                data={filteredAggregated}
                metric={metric}
                rawRows={filteredRaw}
                fileCount={loadedFiles.length}
                highlightLngRange={highlightLngRange}
                onPointClick={setSelectedLng}
                onBoundsChange={setMapBounds}
                groupMode={groupMode}
                groupStyles={groupStyles}
                thresholds={customThresholds}
                naPoints={naPoints}
                naFilter={naFilter}
                naOnly={naOnly}
                showNaCircle={showNaCircle}
                naCircleRadius={naCircleRadius}
                isolatedNaPoints={showIsolatedNa ? isolatedNaPoints : []}
                consecutiveNaPoints={showConsecutiveNa ? consecutiveNaPoints : []}
                showConsecutiveNa={showConsecutiveNa}
                naRecurrencePoints={naRecurrencePoints}
                showNaRecurrence={showNaRecurrence}
                multiCarrierPoints={multiCarrierAllNaOnly ? multiCarrierPoints.filter((p) => p.allNa) : multiCarrierPoints}
                multiCarrierSummary={multiCarrierSummary}
                showMultiCarrier={showMultiCarrier}
                analysisClusters={carrierFilteredClusters}
                showAnalysisLayer={showAnalysisLayer}
                showMeasurementLayer={showMeasurementLayer}
                referencePoints={referencePoints}
                showReferenceLayer={showReferenceLayer}
                showReferenceCircle={showReferenceCircle}
                kyotenPoints={kyotenPoints}
                showKyotenLayer={showKyotenLayer}
                routePolyline={routePolyline}
                markerStyles={markerStyles}
              />
              {/* フィルタ適用中バッジ */}
              {(filterEnabled || naFilter !== 'none') && (
                <div style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  zIndex: 1000,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}>
                  {filterEnabled && (
                    <div style={{
                      background: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #3b82f6',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 12,
                      color: '#1e40af',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                    }}>
                      フィルタ適用中: {METRIC_LABELS[metric]} {isHigherWorse(metric) ? '≥' : '≤'} {filterMax} {unit}
                    </div>
                  )}
                  {naFilter !== 'none' && (
                    <div style={{
                      background: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #ef4444',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 12,
                      color: '#991b1b',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                    }}>
                      不通区間表示中: {naFilter === 'tcp' ? 'TCP' : naFilter === 'udp' ? 'UDP' : '完全'}計測 N/A ({naPoints.length}件{showIsolatedNa && isolatedNaPoints.length > 0 ? ` 単点${isolatedNaPoints.length}` : ''}{showConsecutiveNa && consecutiveNaPoints.length > 0 ? ` 連続${consecutiveNaPoints.length}` : ''} / 全{filteredAggregated.length + naPoints.length}件)
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ドラッグハンドル */}
            {showChart && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  draggingRef.current = true;
                  document.body.style.cursor = 'row-resize';
                  document.body.style.userSelect = 'none';
                }}
                style={{
                  flex: '0 0 8px',
                  cursor: 'row-resize',
                  background: '#e0e0e0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#bbb'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#e0e0e0'; }}
              >
                {/* グリップインジケーター */}
                <div style={{ display: 'flex', gap: 3 }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: '#999' }} />
                  ))}
                </div>
              </div>
            )}

            {/* チャートパネル */}
            {showChart && (
              <div style={{
                flex: `0 0 ${100 - mapHeightPercent}%`,
                display: 'flex',
                flexDirection: 'column',
              }}>
                {/* チャートヘッダー */}
                <div style={{
                  padding: '6px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  background: '#fafafa',
                  borderBottom: '1px solid #eee',
                }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    東西方向 vs {METRIC_LABELS[metric]}
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    集計幅:
                    <input
                      type="number"
                      value={binSize}
                      onChange={(e) => setBinSize(Math.max(1, Number(e.target.value)))}
                      min={1}
                      step={10}
                      style={{
                        width: 56,
                        padding: '2px 4px',
                        borderRadius: 4,
                        border: '1px solid #ccc',
                        fontSize: 12,
                      }}
                    />
                    px
                  </label>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 11, color: '#666' }}>
                    <span><span style={{ display: 'inline-block', width: 12, height: 8, background: 'rgba(59,130,246,0.4)', border: '1px solid #3b82f6', marginRight: 3, verticalAlign: 'middle' }} />IQR (Q1-Q3)</span>
                    <span><span style={{ display: 'inline-block', width: 12, height: 0, borderTop: '2px solid #ef4444', marginRight: 3, verticalAlign: 'middle' }} />中央値</span>
                    <span><span style={{ display: 'inline-block', width: 0, height: 10, borderLeft: '1.5px solid #555', marginRight: 3, verticalAlign: 'middle' }} />最小-最大</span>
                  </div>
                </div>
                {/* チャート本体 */}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <SpeedChart
                    data={chartData}
                    metric={metric}
                    binWidthPx={binSize}
                    westLng={mapBounds?.west ?? 0}
                    eastLng={mapBounds?.east ?? 0}
                    containerWidth={mapBounds?.containerWidth ?? 800}
                    onBinHover={setHighlightLngRange}
                    selectedLng={selectedLng}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* 閾値編集モーダル */}
      {showThresholdEditor && (
        <ThresholdEditor
          thresholds={customThresholds}
          onChange={handleThresholdsChange}
          onClose={() => setShowThresholdEditor(false)}
        />
      )}

      {showMarkerStyleEditor && (
        <MarkerStyleEditor
          styles={markerStyles}
          onChange={setMarkerStyles}
          onClose={() => setShowMarkerStyleEditor(false)}
          availableCarriers={availableCarriers}
        />
      )}

      {/* プロジェクトファイル読込用hidden input */}
      <input
        ref={importInputRef}
        type="file"
        accept=".wlm.json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImport(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
