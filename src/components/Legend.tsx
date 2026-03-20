'use client';

import type { Metric } from '@/lib/colorScale';
import { METRIC_LABELS, getLegendEntries } from '@/lib/colorScale';
import type { GroupMode, GroupStyle, MarkerShape } from '@/lib/groupStyle';

interface LegendProps {
  metric: Metric;
  pointCount: number;
  fileCount?: number;
  groupMode?: GroupMode;
  groupStyles?: Map<string, GroupStyle>;
}

/** 凡例用ミニSVG（16×16）をReact要素で描画 */
function MiniShapeSvg({ shape, borderColor }: { shape: MarkerShape; borderColor: string }) {
  const common = { fill: '#999', stroke: borderColor, strokeWidth: 2, fillOpacity: 0.6 };
  let shapeEl: React.ReactNode;
  switch (shape) {
    case 'circle':
      shapeEl = <circle cx={8} cy={8} r={6} {...common} />;
      break;
    case 'triangle':
      shapeEl = <polygon points="8,1 15,15 1,15" {...common} />;
      break;
    case 'square':
      shapeEl = <rect x={2} y={2} width={12} height={12} {...common} />;
      break;
    case 'diamond':
      shapeEl = <polygon points="8,1 15,8 8,15 1,8" {...common} />;
      break;
    case 'pentagon': {
      const pts = [0, 1, 2, 3, 4].map((i) => {
        const angle = (Math.PI / 2) + (2 * Math.PI * i) / 5;
        return `${8 - 6 * Math.cos(angle)},${8 - 6 * Math.sin(angle)}`;
      }).join(' ');
      shapeEl = <polygon points={pts} {...common} />;
      break;
    }
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const outerAngle = (Math.PI / 2) + (2 * Math.PI * i) / 5;
        pts.push(`${8 - 6 * Math.cos(outerAngle)},${8 - 6 * Math.sin(outerAngle)}`);
        const innerAngle = outerAngle + Math.PI / 5;
        pts.push(`${8 - 3 * Math.cos(innerAngle)},${8 - 3 * Math.sin(innerAngle)}`);
      }
      shapeEl = <polygon points={pts.join(' ')} {...common} />;
      break;
    }
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 16 16" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}>
      {shapeEl}
    </svg>
  );
}

export default function Legend({ metric, pointCount, fileCount, groupMode, groupStyles }: LegendProps) {
  const entries = getLegendEntries(metric);

  const countLabel = fileCount && fileCount >= 2
    ? `計測ポイント: ${pointCount}件 (${fileCount}ファイル)`
    : `計測ポイント: ${pointCount}件`;

  const showGroupLegend = groupMode && groupMode !== 'none' && groupStyles && groupStyles.size > 0;
  const groupHeader = groupMode === 'vehicle' ? '車両ID' : 'ファイル';

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
      maxWidth: showGroupLegend ? 260 : 220,
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

      {/* グループ凡例 */}
      {showGroupLegend && (
        <>
          <h4 style={{ margin: '10px 0 6px 0', fontSize: 13, borderTop: '1px solid #eee', paddingTop: 8 }}>
            {groupHeader}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
            {Array.from(groupStyles!.entries()).map(([key, style]) => (
              <span key={key} style={{ display: 'flex', alignItems: 'center' }}>
                <MiniShapeSvg shape={style.shape} borderColor={style.borderColor} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{style.label}</span>
              </span>
            ))}
          </div>
        </>
      )}

      <p style={{ margin: '8px 0 0 0', fontSize: 11, color: '#666' }}>
        {countLabel}
      </p>
    </div>
  );
}
