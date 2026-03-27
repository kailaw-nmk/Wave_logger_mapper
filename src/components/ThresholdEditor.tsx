'use client';

import { useState } from 'react';
import type { Metric, CustomThresholds } from '@/lib/colorScale';
import { METRIC_LABELS, DEFAULT_THRESHOLDS, METRIC_GROUPS } from '@/lib/colorScale';

// 色定数（colorScale.tsと同じ）
const COLORS = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444'];

interface ThresholdEditorProps {
  thresholds: CustomThresholds;
  onChange: (thresholds: CustomThresholds) => void;
  onClose: () => void;
}

export default function ThresholdEditor({ thresholds, onChange, onClose }: ThresholdEditorProps) {
  const [activeGroupIdx, setActiveGroupIdx] = useState(0);

  const activeGroup = METRIC_GROUPS[activeGroupIdx];
  // グループ内の代表メトリクス（最初の1つ）から閾値を取得
  const representativeMetric = activeGroup.metrics[0];
  const t = thresholds[representativeMetric];
  const boundaries = t.boundaries;

  // 境界値の順序が正しいかチェック
  const orderError = t.higherIsBetter
    ? boundaries[0] <= boundaries[1] || boundaries[1] <= boundaries[2] || boundaries[2] <= boundaries[3]
    : boundaries[0] >= boundaries[1] || boundaries[1] >= boundaries[2] || boundaries[2] >= boundaries[3];

  /** グループ内の全メトリクスに同じ境界値を適用 */
  function updateBoundary(index: number, value: number) {
    const newBoundaries = [...boundaries] as [number, number, number, number];
    newBoundaries[index] = value;
    const updated = { ...thresholds };
    for (const m of activeGroup.metrics) {
      updated[m] = { ...updated[m], boundaries: newBoundaries };
    }
    onChange(updated);
  }

  function resetMetric() {
    const updated = { ...thresholds };
    for (const m of activeGroup.metrics) {
      updated[m] = { ...DEFAULT_THRESHOLDS[m] };
    }
    onChange(updated);
  }

  function resetAll() {
    onChange({ ...DEFAULT_THRESHOLDS });
  }

  // 各段階のラベルと範囲テキストを生成
  function rangeText(index: number): string {
    const [b0, b1, b2, b3] = boundaries;
    const u = t.unit;
    if (t.higherIsBetter) {
      switch (index) {
        case 0: return `≥ ${b0} ${u}`;
        case 1: return `${b1} ~ ${b0} ${u}`;
        case 2: return `${b2} ~ ${b1} ${u}`;
        case 3: return `${b3} ~ ${b2} ${u}`;
        case 4: return `< ${b3} ${u}`;
        default: return '';
      }
    } else {
      switch (index) {
        case 0: return `≤ ${b0} ${u}`;
        case 1: return `${b0} ~ ${b1} ${u}`;
        case 2: return `${b1} ~ ${b2} ${u}`;
        case 3: return `${b2} ~ ${b3} ${u}`;
        case 4: return `> ${b3} ${u}`;
        default: return '';
      }
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 12, padding: '20px 24px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        minWidth: 420, maxWidth: 520,
        fontFamily: 'sans-serif',
      }}>
        {/* ヘッダー */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>カラー閾値設定</h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#666',
          }}>&times;</button>
        </div>

        {/* メトリクスグループタブ */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
          {METRIC_GROUPS.map((group, idx) => {
            const isModified = group.metrics.some(
              (m) => JSON.stringify(thresholds[m]) !== JSON.stringify(DEFAULT_THRESHOLDS[m]),
            );
            return (
              <button
                key={group.label}
                onClick={() => setActiveGroupIdx(idx)}
                style={{
                  padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  border: idx === activeGroupIdx ? '2px solid #3b82f6' : '1px solid #ccc',
                  background: idx === activeGroupIdx ? '#eff6ff' : '#fff',
                  fontWeight: idx === activeGroupIdx ? 600 : 400,
                  position: 'relative',
                }}
              >
                {group.label}
                {isModified && (
                  <span style={{
                    position: 'absolute', top: -2, right: -2,
                    width: 6, height: 6, borderRadius: '50%', background: '#f97316',
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* 境界値入力 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {activeGroup.label}
            <span style={{ fontWeight: 400, color: '#888', marginLeft: 8, fontSize: 11 }}>
              {t.higherIsBetter ? '（大きいほど良い）' : '（小さいほど良い）'}
            </span>
          </div>
          {activeGroup.metrics.length > 1 && (
            <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
              対象: {activeGroup.metrics.map((m) => METRIC_LABELS[m].replace(/ \(.*\)/, '')).join('、')}
            </div>
          )}

          {/* 5色 × 段階表示 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {COLORS.map((color, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ color, fontSize: 16 }}>●</span>
                <span style={{ width: 60, fontWeight: 500 }}>{t.labels[i]}</span>
                {i < 4 ? (
                  <input
                    type="number"
                    value={boundaries[i]}
                    onChange={(e) => updateBoundary(i, Number(e.target.value))}
                    step="any"
                    style={{
                      width: 70, padding: '3px 6px', borderRadius: 4,
                      border: '1px solid #ccc', fontSize: 13,
                    }}
                  />
                ) : (
                  <span style={{ width: 70 }} />
                )}
                <span style={{ color: '#888', fontSize: 12 }}>{rangeText(i)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 順序警告 */}
        {orderError && (
          <div style={{
            color: '#dc2626', fontSize: 12, marginBottom: 12,
            background: '#fef2f2', padding: '6px 10px', borderRadius: 6,
          }}>
            境界値の順序が不正です。{t.higherIsBetter ? '上から降順' : '上から昇順'}にしてください。
          </div>
        )}

        {/* ボタン */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={resetMetric} style={{
            padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
            background: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
            このグループをリセット
          </button>
          <button onClick={resetAll} style={{
            padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
            background: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
            全てデフォルトに戻す
          </button>
          <button onClick={onClose} style={{
            padding: '6px 12px', borderRadius: 6, border: 'none',
            background: '#3b82f6', color: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
