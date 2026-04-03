'use client';

import React, { useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Marker, Polyline, Popup, Rectangle, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngBounds } from 'leaflet';
import type { AggregatedRow, CsvRow } from '@/lib/csvParser';
import type { Metric, CustomThresholds } from '@/lib/colorScale';
import { getColor, METRIC_LABELS } from '@/lib/colorScale';
import type { AnalysisCluster, FutsuCluster, TeisokuCluster } from '@/lib/analysisParser';
import type { GroupMode, GroupStyle } from '@/lib/groupStyle';
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
  /** 分析クラスタデータ */
  analysisClusters?: AnalysisCluster[];
  /** 分析レイヤー表示 */
  showAnalysisLayer?: boolean;
  /** 計測レイヤー表示 */
  showMeasurementLayer?: boolean;
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

/** _sourceFile + vehicle_id でグループ化してポリライン用座標を生成する */
function buildPolylineGroups(rawRows: CsvRow[]): PolylineGroup[] {
  const groups = new Map<string, PolylineGroup>();
  for (const row of rawRows) {
    const key = `${row._sourceFile}::${row.vehicle_id}`;
    let group = groups.get(key);
    if (!group) {
      group = { coords: [], sourceFile: row._sourceFile, vehicleId: row.vehicle_id, carrier: row.carrier ?? '' };
      groups.set(key, group);
    }
    group.coords.push([row.latitude, row.longitude]);
  }
  return Array.from(groups.values());
}

/** 連続する不通ポイントをポリラインセグメントに変換する */
function buildNaPolylineSegments(rawRows: CsvRow[], naFilter: 'tcp' | 'udp' | 'both'): NaPolylineSegment[] {
  // _sourceFile::vehicle_id でグループ化
  const groups = new Map<string, CsvRow[]>();
  for (const row of rawRows) {
    const key = `${row._sourceFile}::${row.vehicle_id}`;
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
    const [sourceFile, vehicleId] = key.split('::');
    let current: [number, number][] = [];

    for (const row of rows) {
      if (isNa(row)) {
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
    <Popup maxWidth={320}>
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
    </Popup>
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
) {
  const popup = buildPopup(row);

  // グループモード時: 形状アイコン付きMarker
  if (groupMode !== 'none' && groupStyles) {
    const gKey = getGroupKey(row, groupMode);
    const style = gKey ? groupStyles.get(gKey) : undefined;
    if (style) {
      const icon = createShapeIcon(style.shape, fillColor, style.borderColor);
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

  // 通常モード: CircleMarker
  return (
    <CircleMarker
      key={`${prefix}-${i}-${fillColor}`}
      center={[row.latitude, row.longitude]}
      radius={prefix === 'na' ? 8 : 10}
      pathOptions={{ color: fillColor, fillColor, fillOpacity: 0.7 }}
      eventHandlers={{ click: () => { if (onPointClick) onPointClick(row.longitude); } }}
    >
      {popup}
    </CircleMarker>
  );
}

/** 分析クラスタのポップアップ内容を生成 */
function buildClusterPopup(cluster: AnalysisCluster) {
  return (
    <Popup maxWidth={320}>
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
    </Popup>
  );
}

/** 分析クラスタの円の色を取得 */
function getClusterColor(cluster: AnalysisCluster, thresholds?: CustomThresholds): string {
  if (cluster.type === 'futsu') return '#ef4444';
  return getColor(cluster.avg_speed_mbps, 'download_mbps', thresholds);
}

export default function MapView({ data, metric, rawRows, fileCount, highlightLngRange, onPointClick, onBoundsChange, groupMode = 'none', groupStyles, thresholds, naPoints = [], naFilter = 'none', naOnly = false, analysisClusters = [], showAnalysisLayer = true, showMeasurementLayer = true }: MapViewProps) {
  const polylineGroups = buildPolylineGroups(rawRows);

  // 不通区間ポリラインセグメント
  const naPolylineSegments = useMemo(() => {
    if (naFilter === 'none') return [];
    return buildNaPolylineSegments(rawRows, naFilter);
  }, [rawRows, naFilter]);

  // ハイライト矩形の緯度範囲を計算（データ全体の緯度範囲 + 余白）
  const latBounds = useMemo(() => {
    if (data.length === 0) return { min: 0, max: 0 };
    const lats = data.map((r) => r.latitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const padding = (maxLat - minLat) * 0.1 || 0.001;
    return { min: minLat - padding, max: maxLat + padding };
  }, [data]);

  // 分析クラスタを擬似的にAggregatedRow形式に変換（FitBounds用）
  const clusterAsPoints = useMemo((): AggregatedRow[] => {
    if (!showAnalysisLayer || analysisClusters.length === 0) return [];
    return analysisClusters.map((c) => ({
      timestamp: '', vehicle_id: '', route_type: '',
      latitude: c.lat_center, longitude: c.lon_center,
      accuracy: null, download_mbps: null, upload_mbps: null, ping_ms: null,
      udp_ping_ms: null, udp_jitter_ms: null, udp_packet_loss_pct: null,
      udp_download_mbps: null, udp_upload_mbps: null,
      connection_type: '', cellular_gen: null, carrier: null, signal_dbm: null, memo: '',
      _sourceFile: c._sourceFile,
      count: 1, sourceFiles: [c._sourceFile], vehicle_ids: [], route_types: [], carriers: [c.carrier].filter(Boolean),
    }));
  }, [analysisClusters, showAnalysisLayer]);

  // 表示対象ポイント（FitBounds・center計算用）
  const measurementPoints = naOnly && naPoints.length > 0 ? naPoints : (showMeasurementLayer ? data : []);
  const visiblePoints = [...measurementPoints, ...clusterAsPoints];
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

        {/* 軌跡の線（ファイル+車両ごと） */}
        {showMeasurementLayer && polylineGroups.map((group, i) => {
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
        {showMeasurementLayer && naPolylineSegments.map((seg, i) => (
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

        {/* 通常計測ポイント（naOnlyモード時は非表示、レイヤー非表示時も隠す） */}
        {showMeasurementLayer && !naOnly && data.map((row, i) => {
          const value = row[metric];
          if (value === null) return null;
          const fillColor = getColor(value, metric, thresholds);
          return renderMarker(row, i, 'pt', fillColor, groupMode, groupStyles, onPointClick);
        })}

        {/* 不通ポイント（グレーで重ねて表示） */}
        {showMeasurementLayer && naPoints.map((row, i) => renderMarker(row, i, 'na', '#6b7280', groupMode, groupStyles, onPointClick))}

        {/* 分析クラスタ（円＋中心マーカー） */}
        {showAnalysisLayer && analysisClusters.map((cluster, i) => {
          const color = getClusterColor(cluster, thresholds);
          return (
            <React.Fragment key={`cluster-${i}`}>
              <Circle
                center={[cluster.lat_center, cluster.lon_center]}
                radius={cluster.radius_m}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.2,
                  weight: 2,
                  opacity: 0.7,
                }}
              />
              <CircleMarker
                center={[cluster.lat_center, cluster.lon_center]}
                radius={6}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.8,
                  weight: 2,
                }}
              >
                {buildClusterPopup(cluster)}
              </CircleMarker>
            </React.Fragment>
          );
        })}
      </MapContainer>

      <Legend metric={metric} pointCount={data.length} fileCount={fileCount} groupMode={groupMode} groupStyles={groupStyles} thresholds={thresholds} naPointCount={naPoints.length} showNaPolyline={naPolylineSegments.length > 0} analysisClusterCount={showAnalysisLayer ? analysisClusters.length : 0} analysisFutsuCount={showAnalysisLayer ? analysisClusters.filter((c) => c.type === 'futsu').length : 0} />
    </div>
  );
}
