'use client';

import { useState } from 'react';
import type { Metric, CustomThresholds } from '@/lib/colorScale';
import { METRIC_LABELS, getLegendEntries } from '@/lib/colorScale';
import type { GroupMode, GroupStyle, MarkerShape } from '@/lib/groupStyle';

interface LegendProps {
  metric: Metric;
  pointCount: number;
  fileCount?: number;
  groupMode?: GroupMode;
  groupStyles?: Map<string, GroupStyle>;
  thresholds?: CustomThresholds;
  /** 不通ポイント数（0なら非表示） */
  naPointCount?: number;
  /** 不通区間ポリラインが存在するか */
  showNaPolyline?: boolean;
  /** 単点不通ポイント数 */
  naIsolatedCount?: number;
  /** 連続不通ポイント数 */
  naConsecutiveCount?: number;
  /** 不通再現率表示中か */
  showNaRecurrence?: boolean;
  /** 再現率ポイント数 */
  naRecurrenceCount?: number;
  /** 分析クラスタ総数 */
  analysisClusterCount?: number;
  /** 完全不通エリアクラスタ数 */
  analysisFutsuCount?: number;
  /** 参考データポイント数 */
  referencePointCount?: number;
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

export default function Legend({ metric, pointCount, fileCount, groupMode, groupStyles, thresholds, naPointCount = 0, showNaPolyline = false, naIsolatedCount = 0, naConsecutiveCount = 0, showNaRecurrence = false, naRecurrenceCount = 0, analysisClusterCount = 0, analysisFutsuCount = 0, referencePointCount = 0 }: LegendProps) {
  const [collapsed, setCollapsed] = useState(false);
  const entries = getLegendEntries(metric, thresholds);

  const countLabel = fileCount && fileCount >= 2
    ? `計測ポイント: ${pointCount}件 (${fileCount}ファイル)`
    : `計測ポイント: ${pointCount}件`;

  const showGroupLegend = groupMode && groupMode !== 'none' && groupStyles && groupStyles.size > 0;
  const groupHeader = groupMode === 'vehicle' ? '車両ID' : groupMode === 'carrier' ? 'キャリア' : 'ファイル';

  return (
    <div style={{
      position: 'absolute',
      bottom: 30,
      left: 30,
      zIndex: 1000,
      background: 'white',
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      fontFamily: 'sans-serif',
      maxWidth: showGroupLegend ? 260 : 220,
      overflow: 'hidden',
    }}>
      {/* ヘッダー（常に表示 — クリックで開閉） */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          padding: '8px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          userSelect: 'none',
        }}
      >
        <h4 style={{ margin: 0, fontSize: 14 }}>
          {showNaRecurrence ? '不通再現率' : METRIC_LABELS[metric]}
        </h4>
        <span style={{ fontSize: 10, color: '#999', marginLeft: 8 }}>
          {collapsed ? '\u25BC' : '\u25B2'}
        </span>
      </div>

      {/* 本体（折りたたみ時は非表示） */}
      {!collapsed && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {showNaRecurrence ? (
              <>
                {[
                  { color: '#ef4444', label: '75-100% (ほぼ毎回不通)' },
                  { color: '#f97316', label: '50-75%' },
                  { color: '#84cc16', label: '25-50%' },
                  { color: '#22c55e', label: '1-25% (まれに不通)' },
                ].map((e) => (
                  <span key={e.color}>
                    <span style={{ color: e.color }}>●</span> {e.label}
                  </span>
                ))}
                <span style={{ color: '#666', fontSize: 11 }}>
                  対象地点: {naRecurrenceCount}件
                </span>
              </>
            ) : (
              <>
                {entries.map((entry) => (
                  <span key={entry.color}>
                    <span style={{ color: entry.color }}>●</span> {entry.label}
                  </span>
                ))}
                {naIsolatedCount > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                      <polygon points="7,1 13,7 7,13 1,7" fill="#6b7280" fillOpacity={0.7} stroke="#6b7280" strokeWidth={1} />
                    </svg>
                    単点不通 ({naIsolatedCount}件)
                  </span>
                )}
                {naConsecutiveCount > 0 && (
                  <span>
                    <span style={{ color: '#6b7280' }}>●</span> 連続不通 ({naConsecutiveCount}件)
                  </span>
                )}
                {showNaPolyline && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 16, height: 0, borderTop: '3px solid #ef4444', verticalAlign: 'middle' }} /> 不通区間
                  </span>
                )}
              </>
            )}
            {analysisClusterCount > 0 && (
              <>
                {analysisFutsuCount > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '2px solid #ef4444', background: 'rgba(239,68,68,0.2)' }} /> 完全不通エリア ({analysisFutsuCount})
                  </span>
                )}
                {analysisClusterCount - analysisFutsuCount > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '2px solid #f59e0b', background: 'rgba(245,158,11,0.2)' }} /> 低速不通エリア ({analysisClusterCount - analysisFutsuCount})
                  </span>
                )}
              </>
            )}
            {referencePointCount > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#0ea5e9' }} /> 参考データ ({referencePointCount})
              </span>
            )}
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
      )}
    </div>
  );
}
