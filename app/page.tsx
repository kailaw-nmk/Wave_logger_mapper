'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import CsvUploader from '@/components/CsvUploader';
import type { CsvRow } from '@/lib/csvParser';
import { parseCsv } from '@/lib/csvParser';
import type { Metric } from '@/lib/colorScale';
import { METRIC_LABELS } from '@/lib/colorScale';

// Leafletはブラウザ専用のためSSR無効
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

export default function Home() {
  const [data, setData] = useState<CsvRow[]>([]);
  const [metric, setMetric] = useState<Metric>('download_mbps');
  const [fileName, setFileName] = useState<string | null>(null);

  function handleFileLoaded(text: string, name: string) {
    const rows = parseCsv(text);
    setData(rows);
    setFileName(name);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* ヘッダー */}
      <header style={{
        padding: '12px 20px',
        background: '#fff',
        borderBottom: '1px solid #e0e0e0',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Wave Logger Mapper
        </h1>

        {data.length > 0 && (
          <>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #ccc',
                fontSize: 14,
              }}
            >
              {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
                <option key={m} value={m}>{METRIC_LABELS[m]}</option>
              ))}
            </select>

            <span style={{ fontSize: 13, color: '#888' }}>
              {fileName} ({data.length}件)
            </span>
          </>
        )}
      </header>

      {/* メインコンテンツ */}
      <main style={{ flex: 1, position: 'relative' }}>
        {data.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: 40,
          }}>
            <div style={{ maxWidth: 500, width: '100%' }}>
              <CsvUploader onFileLoaded={handleFileLoaded} />
              <p style={{
                marginTop: 16,
                fontSize: 13,
                color: '#999',
                textAlign: 'center',
              }}>
                Radio Wave Logger で出力した netlog_*.csv ファイルをアップロードしてください
              </p>
            </div>
          </div>
        ) : (
          <MapView data={data} metric={metric} />
        )}
      </main>
    </div>
  );
}
