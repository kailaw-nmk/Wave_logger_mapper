'use client';

import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from 'react-leaflet';
import type { AggregatedRow, CsvRow } from '@/lib/csvParser';
import type { Metric } from '@/lib/colorScale';
import { getColor, METRIC_LABELS } from '@/lib/colorScale';
import Legend from './Legend';
import 'leaflet/dist/leaflet.css';

interface MapViewProps {
  data: AggregatedRow[];
  metric: Metric;
  rawRows: CsvRow[];
  fileCount: number;
}

/** _sourceFile + vehicle_id でグループ化してポリライン用座標を生成する */
function buildPolylineGroups(rawRows: CsvRow[]): [number, number][][] {
  const groups = new Map<string, [number, number][]>();
  for (const row of rawRows) {
    const key = `${row._sourceFile}::${row.vehicle_id}`;
    let coords = groups.get(key);
    if (!coords) {
      coords = [];
      groups.set(key, coords);
    }
    coords.push([row.latitude, row.longitude]);
  }
  return Array.from(groups.values());
}

/** 数値を見やすく丸める */
function fmt(v: number | null): string {
  if (v === null) return 'N/A';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export default function MapView({ data, metric, rawRows, fileCount }: MapViewProps) {
  if (data.length === 0) return null;

  const centerLat = data.reduce((sum, r) => sum + r.latitude, 0) / data.length;
  const centerLng = data.reduce((sum, r) => sum + r.longitude, 0) / data.length;

  const polylineGroups = buildPolylineGroups(rawRows);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* 軌跡の線（ファイル+車両ごと） */}
        {polylineGroups.map((coords, i) =>
          coords.length > 1 ? (
            <Polyline
              key={`polyline-${i}`}
              positions={coords}
              weight={2}
              color="#6b7280"
              opacity={0.5}
              dashArray="5 10"
            />
          ) : null,
        )}

        {/* 計測ポイント */}
        {data.map((row, i) => {
          const value = row[metric];
          if (value === null) return null;
          const color = getColor(value, metric);

          return (
            <CircleMarker
              key={i}
              center={[row.latitude, row.longitude]}
              radius={10}
              color={color}
              fillColor={color}
              fillOpacity={0.7}
            >
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
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <Legend metric={metric} pointCount={data.length} fileCount={fileCount} />
    </div>
  );
}
