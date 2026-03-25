'use client';

import { useMemo, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, Rectangle, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngBounds } from 'leaflet';
import type { AggregatedRow, CsvRow } from '@/lib/csvParser';
import type { Metric, CustomThresholds } from '@/lib/colorScale';
import { getColor, METRIC_LABELS } from '@/lib/colorScale';
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
  showNaPoints?: boolean;
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
}

/** _sourceFile + vehicle_id でグループ化してポリライン用座標を生成する */
function buildPolylineGroups(rawRows: CsvRow[]): PolylineGroup[] {
  const groups = new Map<string, PolylineGroup>();
  for (const row of rawRows) {
    const key = `${row._sourceFile}::${row.vehicle_id}`;
    let group = groups.get(key);
    if (!group) {
      group = { coords: [], sourceFile: row._sourceFile, vehicleId: row.vehicle_id };
      groups.set(key, group);
    }
    group.coords.push([row.latitude, row.longitude]);
  }
  return Array.from(groups.values());
}

/** 数値を見やすく丸める */
function fmt(v: number | null): string {
  if (v === null) return 'N/A';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export default function MapView({ data, metric, rawRows, fileCount, highlightLngRange, onPointClick, onBoundsChange, groupMode = 'none', groupStyles, thresholds, showNaPoints }: MapViewProps) {
  const polylineGroups = buildPolylineGroups(rawRows);

  // ハイライト矩形の緯度範囲を計算（データ全体の緯度範囲 + 余白）
  const latBounds = useMemo(() => {
    if (data.length === 0) return { min: 0, max: 0 };
    const lats = data.map((r) => r.latitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const padding = (maxLat - minLat) * 0.1 || 0.001;
    return { min: minLat - padding, max: maxLat + padding };
  }, [data]);

  if (data.length === 0) return null;

  const centerLat = data.reduce((sum, r) => sum + r.latitude, 0) / data.length;
  const centerLng = data.reduce((sum, r) => sum + r.longitude, 0) / data.length;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
      >
        <FitBounds data={data} />
        {onBoundsChange && <BoundsWatcher onChange={onBoundsChange} />}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* 軌跡の線（ファイル+車両ごと） */}
        {polylineGroups.map((group, i) => {
          if (group.coords.length <= 1) return null;
          // グループモード時はポリラインの色をグループ色にする
          let lineColor = '#6b7280';
          if (groupMode !== 'none' && groupStyles) {
            const gKey = groupMode === 'vehicle' ? group.vehicleId : group.sourceFile;
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

        {/* 計測ポイント */}
        {data.map((row, i) => {
          const value = row[metric];
          if (value === null && !showNaPoints) return null;
          // 不通フィルタ時は全マーカーをグレーで描画
          const fillColor = showNaPoints ? '#6b7280' : getColor(value!, metric, thresholds);

          const popupContent = (
            <Popup maxWidth={320}>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                {/* 基本情報 */}
                <p style={{ margin: 0, fontWeight: 600, borderBottom: '1px solid #eee', paddingBottom: 4, marginBottom: 4 }}>基本情報</p>
                <p style={{ margin: 0 }}><b>日時:</b> {row.timestamp}</p>
                {row.vehicle_ids.length > 0 && <p style={{ margin: 0 }}><b>車両:</b> {row.vehicle_ids.join(', ')}</p>}
                {row.route_types.length > 0 && <p style={{ margin: 0 }}><b>ルート:</b> {row.route_types.join(', ')}</p>}
                <p style={{ margin: 0 }}><b>接続:</b> {row.connection_type}</p>
                {row.cellular_gen && <p style={{ margin: 0 }}><b>世代:</b> {row.cellular_gen}</p>}
                {row.carrier && <p style={{ margin: 0 }}><b>キャリア:</b> {row.carrier}</p>}
                {row.signal_dbm !== null && <p style={{ margin: 0 }}><b>電波:</b> {fmt(row.signal_dbm)} dBm</p>}

                {/* TCP計測 */}
                <p style={{ margin: '6px 0 0', fontWeight: 600, borderBottom: '1px solid #eee', paddingBottom: 4, marginBottom: 4 }}>TCP計測</p>
                <p style={{ margin: 0 }}><b>DL:</b> {fmt(row.download_mbps)} Mbps</p>
                <p style={{ margin: 0 }}><b>UL:</b> {fmt(row.upload_mbps)} Mbps</p>
                <p style={{ margin: 0 }}><b>Ping:</b> {fmt(row.ping_ms)} ms</p>

                {/* UDP計測 */}
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
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    marginTop: 8,
                    padding: '6px 12px',
                    background: '#4285f4',
                    color: '#fff',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  📍 ストリートビューを開く
                </a>
              </div>
            </Popup>
          );

          // グループモード時: 形状アイコン付きMarker
          if (groupMode !== 'none' && groupStyles) {
            const gKey = getGroupKey(row, groupMode);
            const style = gKey ? groupStyles.get(gKey) : undefined;
            if (style) {
              const icon = createShapeIcon(style.shape, fillColor, style.borderColor);
              return (
                <Marker
                  key={`${i}-${fillColor}`}
                  position={[row.latitude, row.longitude]}
                  icon={icon}
                  eventHandlers={{
                    click: () => { if (onPointClick) onPointClick(row.longitude); },
                  }}
                >
                  {popupContent}
                </Marker>
              );
            }
          }

          // 通常モード: CircleMarker
          return (
            <CircleMarker
              key={`${i}-${fillColor}`}
              center={[row.latitude, row.longitude]}
              radius={10}
              pathOptions={{ color: fillColor, fillColor, fillOpacity: 0.7 }}
              eventHandlers={{
                click: () => { if (onPointClick) onPointClick(row.longitude); },
              }}
            >
              {popupContent}
            </CircleMarker>
          );
        })}
      </MapContainer>

      <Legend metric={metric} pointCount={data.length} fileCount={fileCount} groupMode={groupMode} groupStyles={groupStyles} thresholds={thresholds} showNaPoints={showNaPoints} />
    </div>
  );
}
