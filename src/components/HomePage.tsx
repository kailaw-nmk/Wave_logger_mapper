'use client';

import { useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import CsvUploader from '@/components/CsvUploader';
import type { CsvRow } from '@/lib/csvParser';
import { parseCsv, aggregateByLocation } from '@/lib/csvParser';
import type { Metric } from '@/lib/colorScale';
import { METRIC_LABELS } from '@/lib/colorScale';

// Leafletはブラウザ専用のためSSR無効
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

export default function HomePage() {
  const [rawRows, setRawRows] = useState<CsvRow[]>([]);
  const [loadedFiles, setLoadedFiles] = useState<string[]>([]);
  const [metric, setMetric] = useState<Metric>('download_mbps');

  const data = useMemo(() => aggregateByLocation(rawRows), [rawRows]);

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

  const hasData = data.length > 0;

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
      <main style={{ flex: 1, position: 'relative' }}>
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
            </div>
          </div>
        ) : (
          <MapView data={data} metric={metric} rawRows={rawRows} fileCount={loadedFiles.length} />
        )}
      </main>
    </div>
  );
}
