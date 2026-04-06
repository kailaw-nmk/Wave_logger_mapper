'use client';

import React, { useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Marker, Polyline, Rectangle, useMap, useMapEvents } from 'react-leaflet';
import DraggablePopup from './DraggablePopup';
import type { LatLngBounds } from 'leaflet';
import type { AggregatedRow, CsvRow, NaRecurrencePoint, MultiCarrierPoint, MultiCarrierSummary } from '@/lib/csvParser';
import type { Metric, CustomThresholds } from '@/lib/colorScale';
import { getColor, METRIC_LABELS } from '@/lib/colorScale';
import type { AnalysisCluster, FutsuCluster, TeisokuCluster, ReferencePoint } from '@/lib/analysisParser';
import type { MarkerStyles } from '@/lib/markerStyle';
import { DEFAULT_MARKER_STYLES, resolveCarrierStyle } from '@/lib/markerStyle';
import type { GroupMode, GroupStyle, MarkerShape } from '@/lib/groupStyle';
import { getGroupKey } from '@/lib/groupStyle';
import { createShapeIcon } from '@/lib/svgMarkerIcon';
import Legend from './Legend';
import 'leaflet/dist/leaflet.css';

/** マップの表示範囲 */
export interface MapBounds {
  south: number;
  north: number;
  west: number;
  east: number;
  containerWidth: number;
}

interface MapViewProps {
  data: AggregatedRow[];
  metric: Metric;
  rawRows: CsvRow[];
  fileCount: number;
  highlightLngRange?: [number, number] | null;
  onPointClick?: (lng: number) => void;
  onBoundsChange?: (bounds: MapBounds) => void;
  groupMode?: GroupMode;
  groupStyles?: Map<string, GroupStyle>;
  thresholds?: CustomThresholds;
  /** 不通ポイント（通常データと重ねて表示） */
  naPoints?: AggregatedRow[];
  /** 不通フィルタ状態 */
  naFilter?: 'none' | 'tcp' | 'udp' | 'both';
  /** 不通ポイントのみ表示 */
  naOnly?: boolean;
  /** 不通サークル表示モード */
  showNaCircle?: boolean;
  /** 不通サークル半径(m) */
  naCircleRadius?: number;
  /** 単点不通ポイント */
  isolatedNaPoints?: AggregatedRow[];
  /** 連続不通ポイント */
  consecutiveNaPoints?: AggregatedRow[];
  /** 連続不通の表示状態 */
  showConsecutiveNa?: boolean;
  /** 不通再現率データ */
  naRecurrencePoints?: NaRecurrencePoint[];
  /** 不通再現率表示モード */
  showNaRecurrence?: boolean;
  /** マルチキャリア比較データ */
  multiCarrierPoints?: MultiCarrierPoint[];
  /** マルチキャリアサマリ統計 */
  multiCarrierSummary?: MultiCarrierSummary | null;
  /** マルチキャリア比較表示モード */
  showMultiCarrier?: boolean;
  /** 分析クラスタデータ */
  analysisClusters?: AnalysisCluster[];
  /** 分析レイヤー表示 */
  showAnalysisLayer?: boolean;
  /** 計測レイヤー表示 */
  showMeasurementLayer?: boolean;
  /** 参考データ */
  referencePoints?: ReferencePoint[];
  /** 参考データレイヤー表示 */
  showReferenceLayer?: boolean;
  /** 参考データサークル表示 */
  showReferenceCircle?: boolean;
  /** ルート区間ポリライン */
  routePolyline?: [number, number][] | null;
  /** マーカースタイル設定 */
  markerStyles?: MarkerStyles;
}

/** データ変更時に地図をデータ範囲にフィットさせる */
function FitBounds({ data }: { data: AggregatedRow[] }) {
  const map = useMap();

  useEffect(() => {
    if (data.length === 0) return;
    const lats = data.map((r) => r.latitude);
    const lngs = data.map((r) => r.longitude);
    const L = require('leaflet') as typeof import('leaflet');
    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    );
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [data, map]);

  return null;
}

/** マップのmoveend/zoomendイベントを監視して表示範囲を通知する */
function BoundsWatcher({ onChange }: { onChange: (bounds: MapBounds) => void }) {
  const map = useMap();

  const toBounds = useCallback((): MapBounds => {
    const b = map.getBounds();
    return {
      south: b.getSouth(),
      north: b.getNorth(),
      west: b.getWest(),
      east: b.getEast(),
      containerWidth: map.getSize().x,
    };
  }, [map]);

  // 初回マウント時に現在の表示範囲を通知
  useEffect(() => {
    onChange(toBounds());
  }, [map, onChange, toBounds]);

  useMapEvents({
    moveend() {
      onChange(toBounds());
    },
    resize() {
      onChange(toBounds());
    },
  });
  return null;
}

/** セグメント分割閾値（km） — 連続する2点がこれ以上離れていたら別セグメントにする */
const SEGMENT_THRESHOLD_KM = 1.0;

/** 2点間の距離をHaversine公式で計算（km） */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** ポリライングループ */
interface PolylineGroup {
  coords: [number, number][];
  sourceFile: string;
  vehicleId: string;
  carrier: string;
}

/** 不通区間ポリラインセグメント */
interface NaPolylineSegment {
  coords: [number, number][];
  sourceFile: string;
  vehicleId: string;
}

/** _sourceFile + vehicle_id + carrier でグループ化し、距離ジャンプでセグメント分割する */
function buildPolylineGroups(rawRows: CsvRow[]): PolylineGroup[] {
  // まず同一キーでグループ化
  const grouped = new Map<string, { rows: [number, number][]; sourceFile: string; vehicleId: string; carrier: string }>();
  for (const row of rawRows) {
    const key = `${row._sourceFile}::${row.vehicle_id}::${row.carrier ?? ''}`;
    let group = grouped.get(key);
    if (!group) {
      group = { rows: [], sourceFile: row._sourceFile, vehicleId: row.vehicle_id, carrier: row.carrier ?? '' };
      grouped.set(key, group);
    }
    group.rows.push([row.latitude, row.longitude]);
  }

  // グループ内を距離閾値でセグメント分割
  const result: PolylineGroup[] = [];
  for (const group of grouped.values()) {
    let current: [number, number][] = [];
    for (const coord of group.rows) {
      if (current.length > 0) {
        const prev = current[current.length - 1];
        if (haversineKm(prev[0], prev[1], coord[0], coord[1]) > SEGMENT_THRESHOLD_KM) {
          if (current.length >= 2) {
            result.push({ coords: current, sourceFile: group.sourceFile, vehicleId: group.vehicleId, carrier: group.carrier });
          }
          current = [];
        }
      }
      current.push(coord);
    }
    if (current.length >= 2) {
      result.push({ coords: current, sourceFile: group.sourceFile, vehicleId: group.vehicleId, carrier: group.carrier });
    }
  }
  return result;
}

/** 連続する不通ポイントをポリラインセグメントに変換する */
function buildNaPolylineSegments(rawRows: CsvRow[], naFilter: 'tcp' | 'udp' | 'both'): NaPolylineSegment[] {
  // _sourceFile::vehicle_id::carrier でグループ化（異なるキャリアを分離）
  const groups = new Map<string, CsvRow[]>();
  for (const row of rawRows) {
    const key = `${row._sourceFile}::${row.vehicle_id}::${row.carrier ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(row);
  }

  const isTcpNaRow = (r: CsvRow) => r.download_mbps === null && r.upload_mbps === null && r.ping_ms === null
      && r.udp_download_mbps === null && r.udp_upload_mbps === null;
  const isUdpNaRow = (r: CsvRow) => r.udp_download_mbps === null && r.udp_upload_mbps === null && r.udp_ping_ms === null
      && r.udp_jitter_ms === null && r.udp_packet_loss_pct === null
      && r.download_mbps === null && r.upload_mbps === null;
  const isNa = naFilter === 'tcp' ? isTcpNaRow
    : naFilter === 'udp' ? isUdpNaRow
    : (r: CsvRow) => isTcpNaRow(r) && isUdpNaRow(r);

  const segments: NaPolylineSegment[] = [];

  for (const [key, rows] of groups) {
    const parts = key.split('::');
    const sourceFile = parts[0];
    const vehicleId = parts[1];
    let current: [number, number][] = [];

    for (const row of rows) {
      if (isNa(row)) {
        // 距離ジャンプがあればセグメントを分割
        if (current.length > 0) {
          const prev = current[current.length - 1];
          if (haversineKm(prev[0], prev[1], row.latitude, row.longitude) > SEGMENT_THRESHOLD_KM) {
            if (current.length >= 2) {
              segments.push({ coords: current, sourceFile, vehicleId });
            }
            current = [];
          }
        }
        current.push([row.latitude, row.longitude]);
      } else {
        // 不通でない行が来たらセグメント確定（2点以上のみ）
        if (current.length >= 2) {
          segments.push({ coords: current, sourceFile, vehicleId });
        }
        current = [];
      }
    }
    // 末尾の不通区間
    if (current.length >= 2) {
      segments.push({ coords: current, sourceFile, vehicleId });
    }
  }

  return segments;
}

/** 数値を見やすく丸める */
function fmt(v: number | null): string {
  if (v === null) return 'N/A';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** ポップアップ内容を生成 */
function buildPopup(row: AggregatedRow) {
  return (
    <DraggablePopup maxWidth={320}>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <p style={{ margin: 0, fontWeight: 600, borderBottom: '1px solid #eee', paddingBottom: 4, marginBottom: 4 }}>基本情報</p>
        <p style={{ margin: 0 }}><b>日時:</b> {row.timestamp}</p>
        {row.vehicle_ids.length > 0 && <p style={{ margin: 0 }}><b>車両:</b> {row.vehicle_ids.join(', ')}</p>}
        {row.route_types.length > 0 && <p style={{ margin: 0 }}><b>ルート:</b> {row.route_types.join(', ')}</p>}
        <p style={{ margin: 0 }}><b>接続:</b> {row.connection_type}</p>
        {row.cellular_gen && <p style={{ margin: 0 }}><b>世代:</b> {row.cellular_gen}</p>}
        {row.carrier && <p style={{ margin: 0 }}><b>キャリア:</b> {row.carrier}</p>}
        {row.signal_dbm !== null && <p style={{ margin: 0 }}><b>電波:</b> {fmt(row.signal_dbm)} dBm</p>}

        <p style={{ margin: '6px 0 0', fontWeight: 600, borderBottom: '1px solid #eee', paddingBottom: 4, marginBottom: 4 }}>TCP計測</p>
        <p style={{ margin: 0 }}><b>DL:</b> {fmt(row.download_mbps)} Mbps</p>
        <p style={{ margin: 0 }}><b>UL:</b> {fmt(row.upload_mbps)} Mbps</p>
        <p style={{ margin: 0 }}><b>Ping:</b> {fmt(row.ping_ms)} ms</p>

        <p style={{ margin: '6px 0 0', fontWeight: 600, borderBottom: '1px solid #eee', paddingBottom: 4, marginBottom: 4 }}>UDP計測</p>
        <p style={{ margin: 0 }}><b>DL:</b> {fmt(row.udp_download_mbps)} Mbps</p>
        <p style={{ margin: 0 }}><b>UL:</b> {fmt(row.udp_upload_mbps)} Mbps</p>
        <p style={{ margin: 0 }}><b>Ping:</b> {fmt(row.udp_ping_ms)} ms</p>
        <p style={{ margin: 0 }}><b>Jitter:</b> {fmt(row.udp_jitter_ms)} ms</p>
        <p style={{ margin: 0 }}><b>パケットロス:</b> {fmt(row.udp_packet_loss_pct)} %</p>

        {row.memo && <p style={{ margin: '6px 0 0' }}><b>メモ:</b> {row.memo}</p>}
        {row.count > 1 && <p style={{ margin: '4px 0 0', color: '#888' }}><b>計測回数:</b> {row.count}回 (平均値)</p>}
        <a
          href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${row.latitude},${row.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 8, padding: '6px 12px',
            background: '#4285f4', color: '#fff', borderRadius: 6,
            fontSize: 12, fontWeight: 600, textDecoration: 'none',
          }}
        >
          📍 ストリートビューを開く
        </a>
      </div>
    </DraggablePopup>
  );
}

/** マーカーを描画する */
function renderMarker(
  row: AggregatedRow,
  i: number,
  prefix: string,
  fillColor: string,
  groupMode: GroupMode,
  groupStyles: Map<string, GroupStyle> | undefined,
  onPointClick?: (lng: number) => void,
  styleDef?: { radius: number; fillOpacity: number; borderColor: string; borderWidth: number; shape: MarkerShape },
) {
  const popup = buildPopup(row);
  const radius = styleDef?.radius ?? (prefix === 'na' ? 8 : 10);
  const fillOpacity = styleDef?.fillOpacity ?? 0.7;
  const strokeColor = (styleDef?.borderColor || fillColor);
  const strokeWidth = styleDef?.borderWidth ?? 1;
  const shape = styleDef?.shape ?? 'circle';

  // グループモード時: 形状アイコン付きMarker
  if (groupMode !== 'none' && groupStyles) {
    const gKey = getGroupKey(row, groupMode);
    const style = gKey ? groupStyles.get(gKey) : undefined;
    if (style) {
      const icon = createShapeIcon(style.shape, fillColor, style.borderColor, radius * 2);
      return (
        <Marker
          key={`${prefix}-${i}-${fillColor}`}
          position={[row.latitude, row.longitude]}
          icon={icon}
          eventHandlers={{ click: () => { if (onPointClick) onPointClick(row.longitude); } }}
        >
          {popup}
        </Marker>
      );
    }
  }

  // 形状がcircle以外の場合: SVGアイコン付きMarker
  if (shape !== 'circle') {
    const icon = createShapeIcon(shape, fillColor, strokeColor, radius * 2);
    return (
      <Marker
        key={`${prefix}-${i}-${fillColor}`}
        position={[row.latitude, row.longitude]}
        icon={icon}
        eventHandlers={{ click: () => { if (onPointClick) onPointClick(row.longitude); } }}
      >
        {popup}
      </Marker>
    );
  }

  // 通常モード: CircleMarker
  return (
    <CircleMarker
      key={`${prefix}-${i}-${fillColor}`}
      center={[row.latitude, row.longitude]}
      radius={radius}
      pathOptions={{ color: strokeColor, fillColor, fillOpacity, weight: strokeWidth }}
      eventHandlers={{ click: () => { if (onPointClick) onPointClick(row.longitude); } }}
    >
      {popup}
    </CircleMarker>
  );
}

/** 分析クラスタのポップアップ内容を生成 */
function buildClusterPopup(cluster: AnalysisCluster) {
  return (
    <DraggablePopup maxWidth={320}>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <p style={{ margin: 0, fontWeight: 600, borderBottom: '1px solid #eee', paddingBottom: 4, marginBottom: 4 }}>
          {cluster.type === 'futsu' ? '完全不通エリア' : '低速不通エリア'}
        </p>
        <p style={{ margin: 0 }}><b>キャリア:</b> {cluster.carrier}</p>
        <p style={{ margin: 0 }}><b>クラスタID:</b> {cluster.cluster_id}</p>
        {cluster.type === 'futsu' && (
          <p style={{ margin: 0 }}><b>計測点数:</b> {(cluster as FutsuCluster).point_count}</p>
        )}
        {cluster.type === 'teisoku' && (
          <>
            <p style={{ margin: 0 }}><b>計測種別:</b> {(cluster as TeisokuCluster).metric} ({(cluster as TeisokuCluster).threshold})</p>
            <p style={{ margin: 0 }}><b>総計測点:</b> {(cluster as TeisokuCluster).total_points}</p>
            <p style={{ margin: 0 }}><b>不通点数:</b> {(cluster as TeisokuCluster).futsu_count}</p>
            <p style={{ margin: 0 }}><b>低速点数:</b> {(cluster as TeisokuCluster).teisoku_count}</p>
            <p style={{ margin: '6px 0 0', fontWeight: 600, borderBottom: '1px solid #eee', paddingBottom: 4, marginBottom: 4 }}>速度情報</p>
            <p style={{ margin: 0 }}><b>平均:</b> {(cluster as TeisokuCluster).avg_speed_mbps.toFixed(2)} Mbps</p>
            <p style={{ margin: 0 }}><b>中央値:</b> {(cluster as TeisokuCluster).median_speed_mbps.toFixed(2)} Mbps</p>
            <p style={{ margin: 0 }}><b>最小:</b> {(cluster as TeisokuCluster).min_speed_mbps.toFixed(2)} Mbps</p>
          </>
        )}
        <p style={{ margin: 0 }}><b>半径:</b> {cluster.radius_m.toFixed(0)} m</p>
        <p style={{ margin: 0 }}><b>日付:</b> {cluster.dates}</p>
        <p style={{ margin: 0 }}><b>車両:</b> {cluster.vehicles}</p>
        <a
          href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${cluster.lat_center},${cluster.lon_center}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 8, padding: '6px 12px',
            background: '#4285f4', color: '#fff', borderRadius: 6,
            fontSize: 12, fontWeight: 600, textDecoration: 'none',
          }}
        >
          ストリートビューを開く
        </a>
      </div>
    </DraggablePopup>
  );
}

/** 分析クラスタの塗り色を取得 */
function getClusterFillColor(cluster: AnalysisCluster, thresholds?: CustomThresholds): string {
  if (cluster.type === 'futsu') return '#ef4444';
  return getColor(cluster.avg_speed_mbps, 'download_mbps', thresholds);
}

/** 分析クラスタのグループキーを取得 */
function getClusterGroupKey(cluster: AnalysisCluster, mode: GroupMode): string | null {
  if (mode === 'vehicle') return cluster.vehicles || null;
  if (mode === 'file') return cluster._sourceFile || null;
  if (mode === 'carrier') return cluster.carrier || null;
  return null;
}

/** 参考データのポップアップ内容を生成 */
/** 不通再現率 → カラー（4段階） */
function getRecurrenceColor(rate: number): string {
  if (rate <= 25) return '#22c55e';   // 緑
  if (rate <= 50) return '#84cc16';   // ライム
  if (rate <= 75) return '#f97316';   // 橙
  return '#ef4444';                   // 赤
}

/** 再現率ポイントのポップアップ */
function buildRecurrencePopup(point: NaRecurrencePoint) {
  return (
    <DraggablePopup>
      <div style={{ fontSize: 12, minWidth: 200, maxHeight: 300, overflow: 'auto' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
          不通再現率: {point.recurrenceRate.toFixed(0)}% ({point.naRuns}/{point.totalRuns}回)
        </div>
        {point.radius > 0 && (
          <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
            半径{point.radius}m / {point.pointCount}測定点
          </div>
        )}
        <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #ddd' }} />
        {point.runDetails.map((d) => (
          <div key={d.file} style={{ display: 'flex', gap: 6, padding: '1px 0' }}>
            <span style={{ color: d.isNa ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
              {d.isNa ? '不通' : '正常'}
            </span>
            <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.file}
            </span>
          </div>
        ))}
      </div>
    </DraggablePopup>
  );
}

/** マルチキャリア地点のカラー */
function getMultiCarrierColor(point: MultiCarrierPoint): string {
  if (point.allNa) return '#ef4444';          // 赤: 全キャリア不通
  if (point.naCarrierCount === 1) return '#22c55e';  // 緑: 1キャリアのみ不通
  return '#f97316';                             // 橙: 複数不通だが全部ではない
}

/** マルチキャリアポイントのポップアップ */
function buildMultiCarrierPopup(point: MultiCarrierPoint) {
  return (
    <DraggablePopup>
      <div style={{ fontSize: 12, minWidth: 220, maxHeight: 300, overflow: 'auto' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
          マルチキャリア比較
        </div>
        <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #ddd' }} />
        {point.carrierStatus.map((cs) => (
          <div key={cs.carrier} style={{ display: 'flex', gap: 6, padding: '2px 0' }}>
            <span style={{ color: cs.hasNa ? '#ef4444' : '#22c55e', fontWeight: 600, minWidth: 28 }}>
              {cs.hasNa ? '不通' : '正常'}
            </span>
            <span style={{ fontWeight: 600 }}>{cs.carrier}</span>
            {cs.totalRuns > 0 && (
              <span style={{ color: '#888' }}>({cs.naRuns}/{cs.totalRuns}回)</span>
            )}
            {cs.totalRuns === 0 && (
              <span style={{ color: '#888' }}>(データなし)</span>
            )}
          </div>
        ))}
        <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #ddd' }} />
        <div style={{ fontWeight: 600, color: point.allNa ? '#ef4444' : '#22c55e' }}>
          {point.allNa ? '全キャリア不通 — マルチでも解消不可' : `マルチで解消 ✓ (${point.naCarrierCount}/${point.totalCarriers}キャリアが不通)`}
        </div>
      </div>
    </DraggablePopup>
  );
}

function buildReferencePopup(point: ReferencePoint) {
  return (
    <DraggablePopup maxWidth={300}>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <p style={{ margin: 0, fontWeight: 600, borderBottom: '1px solid #eee', paddingBottom: 4, marginBottom: 4 }}>
          #{point.rank} {point.label}
        </p>
        {point.direction && <p style={{ margin: 0 }}><b>進行方向:</b> {point.direction}</p>}
        {point.distance_m > 0 && <p style={{ margin: 0 }}><b>配信失敗距離:</b> {point.distance_m.toLocaleString()} m</p>}
        <a
          href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point.lat},${point.lon}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 8, padding: '6px 12px',
            background: '#4285f4', color: '#fff', borderRadius: 6,
            fontSize: 12, fontWeight: 600, textDecoration: 'none',
          }}
        >
          ストリートビューを開く
        </a>
      </div>
    </DraggablePopup>
  );
}

export default function MapView({ data, metric, rawRows, fileCount, highlightLngRange, onPointClick, onBoundsChange, groupMode = 'none', groupStyles, thresholds, naPoints = [], naFilter = 'none', naOnly = false, showNaCircle = false, naCircleRadius = 50, isolatedNaPoints = [], consecutiveNaPoints = [], showConsecutiveNa = true, naRecurrencePoints = [], showNaRecurrence = false, multiCarrierPoints = [], multiCarrierSummary, showMultiCarrier = false, analysisClusters = [], showAnalysisLayer = true, showMeasurementLayer = true, referencePoints = [], showReferenceLayer = true, showReferenceCircle = false, routePolyline, markerStyles = DEFAULT_MARKER_STYLES }: MapViewProps) {
  const polylineGroups = buildPolylineGroups(rawRows);

  // 不通区間ポリラインセグメント（連続不通非表示時は生成しない）
  const naPolylineSegments = useMemo(() => {
    if (naFilter === 'none' || !showConsecutiveNa) return [];
    return buildNaPolylineSegments(rawRows, naFilter);
  }, [rawRows, naFilter, showConsecutiveNa]);

  // ハイライト矩形の緯度範囲を計算（データ全体の緯度範囲 + 余白）
  const latBounds = useMemo(() => {
    if (data.length === 0) return { min: 0, max: 0 };
    const lats = data.map((r) => r.latitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const padding = (maxLat - minLat) * 0.1 || 0.001;
    return { min: minLat - padding, max: maxLat + padding };
  }, [data]);

  // 分析クラスタ・参考データを擬似的にAggregatedRow形式に変換（FitBounds用）
  const overlayAsPoints = useMemo((): AggregatedRow[] => {
    const points: AggregatedRow[] = [];
    const dummy = {
      timestamp: '', vehicle_id: '', route_type: '',
      accuracy: null, download_mbps: null, upload_mbps: null, ping_ms: null,
      udp_ping_ms: null, udp_jitter_ms: null, udp_packet_loss_pct: null,
      udp_download_mbps: null, udp_upload_mbps: null,
      connection_type: '', cellular_gen: null, carrier: null, signal_dbm: null, memo: '',
      count: 1, vehicle_ids: [] as string[], route_types: [] as string[],
    };
    if (showAnalysisLayer) {
      for (const c of analysisClusters) {
        points.push({ ...dummy, latitude: c.lat_center, longitude: c.lon_center, _sourceFile: c._sourceFile, sourceFiles: [c._sourceFile], carriers: [c.carrier].filter(Boolean) });
      }
    }
    if (showReferenceLayer) {
      for (const r of referencePoints) {
        points.push({ ...dummy, latitude: r.lat, longitude: r.lon, _sourceFile: r._sourceFile, sourceFiles: [r._sourceFile], carriers: [] });
      }
    }
    return points;
  }, [analysisClusters, showAnalysisLayer, referencePoints, showReferenceLayer]);

  // 表示対象ポイント（FitBounds・center計算用）
  const visiblePoints = useMemo(() => {
    const measurementPoints = naOnly && naPoints.length > 0 ? naPoints : (showMeasurementLayer ? data : []);
    return [...measurementPoints, ...overlayAsPoints];
  }, [data, naOnly, naPoints, showMeasurementLayer, overlayAsPoints]);

  if (visiblePoints.length === 0) return null;

  const centerLat = visiblePoints.reduce((sum, r) => sum + r.latitude, 0) / visiblePoints.length;
  const centerLng = visiblePoints.reduce((sum, r) => sum + r.longitude, 0) / visiblePoints.length;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
      >
        <FitBounds data={visiblePoints} />
        {onBoundsChange && <BoundsWatcher onChange={onBoundsChange} />}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* 軌跡の線（ファイル+車両ごと） — 再現率・マルチ比較モード時は非表示 */}
        {showMeasurementLayer && !showNaRecurrence && !showMultiCarrier && polylineGroups.map((group, i) => {
          if (group.coords.length <= 1) return null;
          // グループモード時はポリラインの色をグループ色にする
          let lineColor = '#6b7280';
          if (groupMode !== 'none' && groupStyles) {
            const gKey = groupMode === 'vehicle' ? group.vehicleId
              : groupMode === 'carrier' ? group.carrier
              : group.sourceFile;
            const style = gKey ? groupStyles.get(gKey) : undefined;
            if (style) lineColor = style.borderColor;
          }
          return (
            <Polyline
              key={`polyline-${i}`}
              positions={group.coords}
              weight={2}
              color={lineColor}
              opacity={0.5}
              dashArray="5 10"
            />
          );
        })}

        {/* 不通区間ポリライン（赤い実線） */}
        {showMeasurementLayer && !showNaRecurrence && !showMultiCarrier && naPolylineSegments.map((seg, i) => (
          <Polyline
            key={`na-polyline-${i}`}
            positions={seg.coords}
            weight={4}
            color="#ef4444"
            opacity={0.8}
          />
        ))}

        {/* チャートホバー時の経度帯ハイライト */}
        {highlightLngRange && (
          <Rectangle
            bounds={[
              [latBounds.min, highlightLngRange[0]],
              [latBounds.max, highlightLngRange[1]],
            ]}
            pathOptions={{
              fillColor: '#3b82f6',
              fillOpacity: 0.15,
              color: '#3b82f6',
              weight: 2,
            }}
          />
        )}

        {/* 通常計測ポイント（naOnly/再現率/マルチ比較モード時は非表示） */}
        {showMeasurementLayer && !naOnly && !showNaRecurrence && !showMultiCarrier && data.map((row, i) => {
          const value = row[metric];
          if (value === null) return null;
          const ms = resolveCarrierStyle(markerStyles, 'measurement', row.carrier);
          const fillColor = ms.color || getColor(value, metric, thresholds);
          return renderMarker(row, i, 'pt', fillColor, groupMode, groupStyles, onPointClick, ms);
        })}

        {/* 不通再現率マーカー */}
        {showMeasurementLayer && showNaRecurrence && naRecurrencePoints.map((pt, i) => {
          const color = getRecurrenceColor(pt.recurrenceRate);
          if (pt.radius > 0) {
            // 半径指定あり → 実距離Circleで表示
            return (
              <Circle
                key={`recur-${i}`}
                center={[pt.latitude, pt.longitude]}
                radius={pt.radius}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.3,
                  weight: 2,
                }}
              >
                {buildRecurrencePopup(pt)}
              </Circle>
            );
          }
          // 半径0 → 従来のCircleMarker
          return (
            <CircleMarker
              key={`recur-${i}`}
              center={[pt.latitude, pt.longitude]}
              radius={9}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.8,
                weight: 2,
              }}
            >
              {buildRecurrencePopup(pt)}
            </CircleMarker>
          );
        })}

        {/* マルチキャリア比較マーカー */}
        {showMeasurementLayer && showMultiCarrier && multiCarrierPoints.map((pt, i) => {
          const color = getMultiCarrierColor(pt);
          if (pt.radius > 0) {
            return (
              <Circle
                key={`mc-${i}`}
                center={[pt.latitude, pt.longitude]}
                radius={pt.radius}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.3,
                  weight: 2,
                }}
              >
                {buildMultiCarrierPopup(pt)}
              </Circle>
            );
          }
          return (
            <CircleMarker
              key={`mc-${i}`}
              center={[pt.latitude, pt.longitude]}
              radius={9}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.8,
                weight: 2,
              }}
            >
              {buildMultiCarrierPopup(pt)}
            </CircleMarker>
          );
        })}

        {/* 連続不通ポイント — 再現率・マルチ比較モード時は非表示 */}
        {showMeasurementLayer && !showNaRecurrence && !showMultiCarrier && consecutiveNaPoints.map((row, i) => {
          const naStyleKey = naFilter === 'tcp' ? 'naTcp' as const : naFilter === 'udp' ? 'naUdp' as const : 'naBoth' as const;
          const naStyle = markerStyles[naStyleKey];
          const color = naStyle.color || '#6b7280';
          if (showNaCircle) {
            return (
              <Circle key={`na-cons-${i}`} center={[row.latitude, row.longitude]} radius={naCircleRadius}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.25, weight: 1.5 }}>
                {buildPopup(row)}
              </Circle>
            );
          }
          return renderMarker(row, i, 'na-cons', color, groupMode, groupStyles, onPointClick, naStyle);
        })}

        {/* 単点不通ポイント — 再現率・マルチ比較モード時は非表示 */}
        {showMeasurementLayer && !showNaRecurrence && !showMultiCarrier && isolatedNaPoints.map((row, i) => {
          const naStyleKey = naFilter === 'tcp' ? 'naTcp' as const : naFilter === 'udp' ? 'naUdp' as const : 'naBoth' as const;
          const baseStyle = markerStyles[naStyleKey];
          const color = baseStyle.color || '#6b7280';
          if (showNaCircle) {
            return (
              <Circle key={`na-iso-${i}`} center={[row.latitude, row.longitude]} radius={naCircleRadius}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.25, weight: 1.5, dashArray: '4 3' }}>
                {buildPopup(row)}
              </Circle>
            );
          }
          const isolatedStyle = { ...baseStyle, radius: Math.max(5, baseStyle.radius - 2), shape: 'diamond' as MarkerShape };
          return renderMarker(row, i, 'na-iso', color, groupMode, groupStyles, onPointClick, isolatedStyle);
        })}

        {/* 分析クラスタ（円＋中心マーカー） */}
        {showAnalysisLayer && analysisClusters.map((cluster, i) => {
          const styleKey = cluster.type === 'futsu' ? 'clusterFutsu' as const : 'clusterTeisoku' as const;
          const ms = markerStyles[styleKey];
          const defaultFill = getClusterFillColor(cluster, thresholds);
          const fillColor = ms.color || defaultFill;
          // グループモード時はボーダー色をグループスタイルに合わせる
          let borderColor = ms.borderColor || fillColor;
          if (groupMode !== 'none' && groupStyles) {
            const gKey = getClusterGroupKey(cluster, groupMode);
            const style = gKey ? groupStyles.get(gKey) : undefined;
            if (style) borderColor = style.borderColor;
          }
          return (
            <React.Fragment key={`cluster-${i}`}>
              <Circle
                center={[cluster.lat_center, cluster.lon_center]}
                radius={cluster.radius_m}
                pathOptions={{
                  color: borderColor,
                  fillColor,
                  fillOpacity: 0.2,
                  weight: ms.borderWidth,
                  opacity: 0.7,
                }}
              />
              <CircleMarker
                center={[cluster.lat_center, cluster.lon_center]}
                radius={ms.radius}
                pathOptions={{
                  color: borderColor,
                  fillColor,
                  fillOpacity: ms.fillOpacity,
                  weight: ms.borderWidth,
                }}
              >
                {buildClusterPopup(cluster)}
              </CircleMarker>
            </React.Fragment>
          );
        })}

        {/* ルート区間ポリライン */}
        {routePolyline && routePolyline.length > 1 && (
          <Polyline
            positions={routePolyline}
            weight={5}
            color="#3b82f6"
            opacity={0.7}
          />
        )}

        {/* 参考データサークル（時速80km×10秒≒222m） */}
        {showReferenceLayer && showReferenceCircle && referencePoints.map((point, i) => (
          <Circle
            key={`ref-circle-${i}`}
            center={[point.lat, point.lon]}
            radius={222}
            pathOptions={{
              color: '#0ea5e9',
              fillColor: '#0ea5e9',
              fillOpacity: 0.08,
              weight: 1.5,
              dashArray: '6 4',
            }}
          />
        ))}

        {/* 参考データマーカー */}
        {showReferenceLayer && referencePoints.map((point, i) => {
          const rs = markerStyles.reference;
          const refColor = rs.color || '#0ea5e9';
          const refBorder = rs.borderColor || refColor;
          if (rs.shape !== 'circle') {
            const icon = createShapeIcon(rs.shape, refColor, refBorder, rs.radius * 2);
            return (
              <Marker key={`ref-${i}`} position={[point.lat, point.lon]} icon={icon}>
                {buildReferencePopup(point)}
              </Marker>
            );
          }
          return (
            <CircleMarker
              key={`ref-${i}`}
              center={[point.lat, point.lon]}
              radius={rs.radius}
              pathOptions={{
                color: refBorder,
                fillColor: refColor,
                fillOpacity: rs.fillOpacity,
                weight: rs.borderWidth,
              }}
            >
              {buildReferencePopup(point)}
            </CircleMarker>
          );
        })}
      </MapContainer>

      <Legend metric={metric} pointCount={data.length} fileCount={fileCount} groupMode={groupMode} groupStyles={groupStyles} thresholds={thresholds} naPointCount={naPoints.length} showNaPolyline={naPolylineSegments.length > 0} naIsolatedCount={isolatedNaPoints.length} naConsecutiveCount={consecutiveNaPoints.length} showNaRecurrence={showNaRecurrence} naRecurrenceCount={naRecurrencePoints.length} showMultiCarrier={showMultiCarrier} multiCarrierSummary={multiCarrierSummary} analysisClusterCount={showAnalysisLayer ? analysisClusters.length : 0} analysisFutsuCount={showAnalysisLayer ? analysisClusters.filter((c) => c.type === 'futsu').length : 0} referencePointCount={showReferenceLayer ? referencePoints.length : 0} />
    </div>
  );
}
