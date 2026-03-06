'use client';

import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from 'react-leaflet';
import type { AggregatedRow } from '@/lib/csvParser';
import type { Metric } from '@/lib/colorScale';
import { getColor, METRIC_LABELS } from '@/lib/colorScale';
import Legend from './Legend';
import 'leaflet/dist/leaflet.css';

interface MapViewProps {
  data: AggregatedRow[];
  metric: Metric;
}

export default function MapView({ data, metric }: MapViewProps) {
  if (data.length === 0) return null;

  const centerLat = data.reduce((sum, r) => sum + r.latitude, 0) / data.length;
  const centerLng = data.reduce((sum, r) => sum + r.longitude, 0) / data.length;

  const coordinates: [number, number][] = data.map((r) => [r.latitude, r.longitude]);

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

        {/* 軌跡の線 */}
        {data.length > 1 && (
          <Polyline
            positions={coordinates}
            weight={2}
            color="#6b7280"
            opacity={0.5}
            dashArray="5 10"
          />
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
              <Popup maxWidth={300}>
                <div style={{ fontSize: 13 }}>
                  <p><b>日時:</b> {row.timestamp}</p>
                  <p><b>DL:</b> {row.download_mbps ?? 'N/A'} Mbps</p>
                  <p><b>UL:</b> {row.upload_mbps ?? 'N/A'} Mbps</p>
                  <p><b>Ping:</b> {row.ping_ms ?? 'N/A'} ms</p>
                  <p><b>接続:</b> {row.connection_type}</p>
                  {row.cellular_gen && <p><b>世代:</b> {row.cellular_gen}</p>}
                  {row.carrier && <p><b>キャリア:</b> {row.carrier}</p>}
                  {row.signal_dbm !== null && <p><b>電波:</b> {row.signal_dbm} dBm</p>}
                  {row.memo && <p><b>メモ:</b> {row.memo}</p>}
                  {row.count > 1 && <p><b>計測回数:</b> {row.count}回 (平均値)</p>}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <Legend metric={metric} pointCount={data.length} />
    </div>
  );
}
