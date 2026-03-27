'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import CsvUploader from '@/components/CsvUploader';
import type { CsvRow } from '@/lib/csvParser';
import { parseCsv, aggregateByLocation } from '@/lib/csvParser';
import type { MapBounds } from '@/components/MapView';
import type { Metric, CustomThresholds } from '@/lib/colorScale';
import { METRIC_LABELS, DEFAULT_THRESHOLDS, syncGroupThresholds } from '@/lib/colorScale';
import type { GroupMode } from '@/lib/groupStyle';
import { assignGroupStyles } from '@/lib/groupStyle';
import { downloadProjectFile, validateAndParseProject } from '@/lib/projectFile';

// Leafletはブラウザ専用のためSSR無効
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });
// SpeedChartもブラウザ専用のためSSR無効
const SpeedChart = dynamic(() => import('@/components/SpeedChart'), { ssr: false });
const ThresholdEditor = dynamic(() => import('@/components/ThresholdEditor'), { ssr: false });

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

  const data = useMemo(() => aggregateByLocation(rawRows), [rawRows]);

  // グループスタイルを計算
  const groupStyles = useMemo(() => {
    if (groupMode === 'none') return new Map();
    const keys = new Set<string>();
    for (const row of rawRows) {
      const key = groupMode === 'vehicle' ? row.vehicle_id : row._sourceFile;
      if (key) keys.add(key);
    }
    return assignGroupStyles(Array.from(keys));
  }, [rawRows, groupMode]);

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

  // 不通ポイント（N/Aフィルタ有効時のみ）
  const naPoints = useMemo(() => {
    if (naFilter === 'none') return [];
    const fn = naFilter === 'tcp' ? isTcpNa : naFilter === 'udp' ? isUdpNa : isBothNa;
    return data.filter(fn);
  }, [data, naFilter]);

  // フィルタ後の生データ（チャート用）
  const filteredRaw = useMemo(() => {
    let result = rawRows;
    if (filterEnabled) {
      const higherWorse = isHigherWorse(metric);
      result = result.filter((row) => {
        const v = row[metric];
        return v === null || (higherWorse ? v >= filterMax : v <= filterMax);
      });
    }
    return result;
  }, [rawRows, filterEnabled, filterMax, metric]);

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
      const newFileNames: string[] = [];

      for (const { text, fileName } of files) {
        // 重複ファイル名チェック
        if (loadedFiles.includes(fileName)) {
          alert(`「${fileName}」は既に読み込まれています`);
          continue;
        }
        const rows = parseCsv(text, fileName);
        if (rows.length === 0) {
          alert(`「${fileName}」に有効なデータがありません`);
          continue;
        }
        newRows.push(...rows);
        newFileNames.push(fileName);
      }

      if (newRows.length > 0) {
        setRawRows((prev) => [...prev, ...newRows]);
        setLoadedFiles((prev) => [...prev, ...newFileNames]);
      }
    },
    [loadedFiles],
  );

  function handleFileRemove(fileName: string) {
    setRawRows((prev) => prev.filter((r) => r._sourceFile !== fileName));
    setLoadedFiles((prev) => prev.filter((f) => f !== fileName));
  }

  const handleExport = useCallback(() => {
    downloadProjectFile({
      rawRows, loadedFiles, metric, customThresholds,
      filterEnabled, filterMax, naFilter, groupMode,
      showChart, binSize, mapHeightPercent,
    });
  }, [rawRows, loadedFiles, metric, customThresholds, filterEnabled, filterMax, naFilter, groupMode, showChart, binSize, mapHeightPercent]);

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
      } catch (err) {
        alert(err instanceof Error ? err.message : 'プロジェクトファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
  }, [rawRows.length]);

  const hasData = data.length > 0;
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={naOnly}
                    onChange={(e) => setNaOnly(e.target.checked)}
                  />
                  不通のみ
                </label>
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
            </select>

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
                const count = rawRows.filter((r) => r._sourceFile === f).length;
                return (
                  <span
                    key={f}
                    style={{
                      fontSize: 12,
                      color: '#555',
                      background: '#f0f0f0',
                      padding: '2px 8px',
                      borderRadius: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {f} ({count}件)
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
                Radio Wave Logger で出力した netlog_*.csv ファイルをアップロードしてください（複数可）
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
                      不通区間表示中: {naFilter === 'tcp' ? 'TCP' : naFilter === 'udp' ? 'UDP' : '完全'}計測 N/A ({naPoints.length}件)
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
