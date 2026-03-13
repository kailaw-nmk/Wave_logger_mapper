'use client';

import type { Metric } from '@/lib/colorScale';
import { METRIC_LABELS, getLegendEntries } from '@/lib/colorScale';

interface LegendProps {
  metric: Metric;
  pointCount: number;
  fileCount?: number;
}

export default function Legend({ metric, pointCount, fileCount }: LegendProps) {
  const entries = getLegendEntries(metric);

  const countLabel = fileCount && fileCount >= 2
    ? `計測ポイント: ${pointCount}件 (${fileCount}ファイル)`
    : `計測ポイント: ${pointCount}件`;

  return (
    <div style={{
      position: 'absolute',
      bottom: 30,
      left: 30,
      zIndex: 1000,
      background: 'white',
      padding: '12px 16px',
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      fontFamily: 'sans-serif',
    }}>
      <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>
        {METRIC_LABELS[metric]}
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        {entries.map((entry) => (
          <span key={entry.color}>
            <span style={{ color: entry.color }}>●</span> {entry.label}
          </span>
        ))}
      </div>
      <p style={{ margin: '8px 0 0 0', fontSize: 11, color: '#666' }}>
        {countLabel}
      </p>
    </div>
  );
}
