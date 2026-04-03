'use client';

import { useState, useRef } from 'react';
import type { MarkerStyles, MarkerTypeKey, MarkerStyleDef } from '@/lib/markerStyle';
import { MARKER_TYPE_LABELS, DEFAULT_MARKER_STYLES, downloadMarkerStyles, parseMarkerStyles } from '@/lib/markerStyle';
import type { MarkerShape } from '@/lib/groupStyle';

const MARKER_TYPES = Object.keys(MARKER_TYPE_LABELS) as MarkerTypeKey[];
const SHAPES: { value: MarkerShape; label: string }[] = [
  { value: 'circle', label: '●' },
  { value: 'triangle', label: '▲' },
  { value: 'square', label: '■' },
  { value: 'diamond', label: '◆' },
  { value: 'pentagon', label: '⬠' },
  { value: 'star', label: '★' },
];

/** 編集中のタブ種別: マーカー種別 or キャリア名 */
type ActiveTab = { kind: 'type'; key: MarkerTypeKey } | { kind: 'carrier'; name: string };

interface MarkerStyleEditorProps {
  styles: MarkerStyles;
  onChange: (styles: MarkerStyles) => void;
  onClose: () => void;
  /** データに含まれるキャリア一覧 */
  availableCarriers?: string[];
}

export default function MarkerStyleEditor({ styles, onChange, onClose, availableCarriers = [] }: MarkerStyleEditorProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>({ kind: 'type', key: 'measurement' });
  const importRef = useRef<HTMLInputElement>(null);

  // 現在のスタイル取得
  const s: MarkerStyleDef = activeTab.kind === 'type'
    ? styles[activeTab.key]
    : (styles.carrierOverrides?.[activeTab.name] ?? styles.measurement);
  const isDynamic = activeTab.kind === 'type' && (activeTab.key === 'measurement' || activeTab.key === 'clusterTeisoku');
  const isCarrier = activeTab.kind === 'carrier';

  function update(patch: Partial<MarkerStyleDef>) {
    if (activeTab.kind === 'type') {
      onChange({ ...styles, [activeTab.key]: { ...s, ...patch } });
    } else {
      const overrides = { ...(styles.carrierOverrides ?? {}) };
      overrides[activeTab.name] = { ...s, ...patch };
      onChange({ ...styles, carrierOverrides: overrides });
    }
  }

  function resetCurrent() {
    if (activeTab.kind === 'type') {
      onChange({ ...styles, [activeTab.key]: { ...DEFAULT_MARKER_STYLES[activeTab.key] } });
    } else {
      // キャリアオーバーライドを削除
      const overrides = { ...(styles.carrierOverrides ?? {}) };
      delete overrides[activeTab.name];
      onChange({ ...styles, carrierOverrides: Object.keys(overrides).length > 0 ? overrides : undefined });
    }
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseMarkerStyles(reader.result as string);
        onChange(imported);
      } catch (err) {
        alert(err instanceof Error ? err.message : '読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
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
        minWidth: 440, maxWidth: 540,
        fontFamily: 'sans-serif',
      }}>
        {/* ヘッダー */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>マーカースタイル設定</h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#666',
          }}>&times;</button>
        </div>

        {/* マーカー種別タブ */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
          {MARKER_TYPES.map((key) => {
            const isModified = JSON.stringify(styles[key]) !== JSON.stringify(DEFAULT_MARKER_STYLES[key]);
            const isActive = activeTab.kind === 'type' && activeTab.key === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab({ kind: 'type', key })}
                style={{
                  padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  border: isActive ? '2px solid #3b82f6' : '1px solid #ccc',
                  background: isActive ? '#eff6ff' : '#fff',
                  fontWeight: isActive ? 600 : 400,
                  position: 'relative',
                }}
              >
                {MARKER_TYPE_LABELS[key]}
                {isModified && (
                  <span style={{
                    position: 'absolute', top: -2, right: -2,
                    width: 6, height: 6, borderRadius: '50%', background: '#f97316',
                  }} />
                )}
              </button>
            );
          })}
          {/* キャリア別タブ */}
          {availableCarriers.length >= 2 && (
            <>
              <span style={{ fontSize: 10, color: '#999', alignSelf: 'center' }}>|</span>
              {availableCarriers.map((carrier) => {
                const hasOverride = !!styles.carrierOverrides?.[carrier];
                const isActive = activeTab.kind === 'carrier' && activeTab.name === carrier;
                return (
                  <button
                    key={`carrier-${carrier}`}
                    onClick={() => {
                      // 初回クリック時にオーバーライドが無ければベースをコピーして作成
                      if (!styles.carrierOverrides?.[carrier]) {
                        const overrides = { ...(styles.carrierOverrides ?? {}) };
                        overrides[carrier] = { ...styles.measurement };
                        onChange({ ...styles, carrierOverrides: overrides });
                      }
                      setActiveTab({ kind: 'carrier', name: carrier });
                    }}
                    style={{
                      padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      border: isActive ? '2px solid #10b981' : '1px solid #ccc',
                      background: isActive ? '#ecfdf5' : '#fff',
                      fontWeight: isActive ? 600 : 400,
                      position: 'relative',
                    }}
                  >
                    {carrier}
                    {hasOverride && (
                      <span style={{
                        position: 'absolute', top: -2, right: -2,
                        width: 6, height: 6, borderRadius: '50%', background: '#10b981',
                      }} />
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* キャリア別タブの説明 */}
        {isCarrier && (
          <div style={{ fontSize: 11, color: '#666', marginBottom: 8, background: '#f0fdf4', padding: '4px 8px', borderRadius: 4 }}>
            「{activeTab.kind === 'carrier' ? activeTab.name : ''}」キャリアの計測ポイントに適用されるスタイル
          </div>
        )}

        {/* 設定項目 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {/* プレビュー */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 100, fontSize: 13, fontWeight: 500 }}>プレビュー</span>
            <svg width={40} height={40} viewBox="0 0 40 40">
              {renderPreviewShape(s.shape, s.color || '#3b82f6', s.borderColor || s.color || '#3b82f6', s.fillOpacity, s.borderWidth, s.radius)}
            </svg>
          </div>

          {/* 半径 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 100, fontSize: 13, fontWeight: 500 }}>サイズ</span>
            <input
              type="range" min={3} max={20} value={s.radius}
              onChange={(e) => update({ radius: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <input
              type="number" min={3} max={20} value={s.radius}
              onChange={(e) => update({ radius: Number(e.target.value) })}
              style={{ width: 50, padding: '2px 4px', borderRadius: 4, border: '1px solid #ccc', fontSize: 13 }}
            />
          </div>

          {/* 形状 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 100, fontSize: 13, fontWeight: 500 }}>形状</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {SHAPES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => update({ shape: value })}
                  style={{
                    width: 32, height: 32, borderRadius: 6, cursor: 'pointer',
                    border: s.shape === value ? '2px solid #3b82f6' : '1px solid #ccc',
                    background: s.shape === value ? '#eff6ff' : '#fff',
                    fontSize: 16,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 塗り色 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 100, fontSize: 13, fontWeight: 500 }}>塗り色</span>
            {isDynamic && (
              <label style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={s.color === ''}
                  onChange={(e) => update({ color: e.target.checked ? '' : '#3b82f6' })}
                />
                メトリクス色
              </label>
            )}
            {(s.color !== '' || !isDynamic) && (
              <input
                type="color"
                value={s.color || '#3b82f6'}
                onChange={(e) => update({ color: e.target.value })}
                style={{ width: 36, height: 28, border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
              />
            )}
          </div>

          {/* 透明度 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 100, fontSize: 13, fontWeight: 500 }}>不透明度</span>
            <input
              type="range" min={0.1} max={1} step={0.05} value={s.fillOpacity}
              onChange={(e) => update({ fillOpacity: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 12, width: 40, textAlign: 'right' }}>{(s.fillOpacity * 100).toFixed(0)}%</span>
          </div>

          {/* ふち色 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 100, fontSize: 13, fontWeight: 500 }}>ふち色</span>
            <label style={{ fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={s.borderColor === ''}
                onChange={(e) => update({ borderColor: e.target.checked ? '' : '#333333' })}
              />
              塗り色と同じ
            </label>
            {s.borderColor !== '' && (
              <input
                type="color"
                value={s.borderColor}
                onChange={(e) => update({ borderColor: e.target.value })}
                style={{ width: 36, height: 28, border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
              />
            )}
          </div>

          {/* ふち幅 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 100, fontSize: 13, fontWeight: 500 }}>ふち幅</span>
            <input
              type="range" min={0} max={5} step={0.5} value={s.borderWidth}
              onChange={(e) => update({ borderWidth: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 12, width: 40, textAlign: 'right' }}>{s.borderWidth}px</span>
          </div>
        </div>

        {/* ボタン */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button onClick={resetCurrent} style={{
            padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
            background: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
            {isCarrier ? 'オーバーライド削除' : 'リセット'}
          </button>
          <button onClick={() => onChange({ ...DEFAULT_MARKER_STYLES })} style={{
            padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
            background: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
            全てデフォルト
          </button>
          <button onClick={() => downloadMarkerStyles(styles)} style={{
            padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
            background: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
            ↓ JSON保存
          </button>
          <button onClick={() => importRef.current?.click()} style={{
            padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
            background: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
            ↑ JSON読込
          </button>
          <button onClick={onClose} style={{
            padding: '6px 12px', borderRadius: 6, border: 'none',
            background: '#3b82f6', color: '#fff', fontSize: 12, cursor: 'pointer',
          }}>
            閉じる
          </button>
        </div>

        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImport(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

/** プレビュー用SVG形状を描画 */
function renderPreviewShape(shape: MarkerShape, fillColor: string, borderColor: string, fillOpacity: number, borderWidth: number, radius: number) {
  const scale = radius / 10;
  const cx = 20, cy = 20;
  const common = { fill: fillColor, stroke: borderColor, strokeWidth: borderWidth, fillOpacity };

  switch (shape) {
    case 'circle':
      return <circle cx={cx} cy={cy} r={8 * scale} {...common} />;
    case 'triangle':
      return <polygon points={`${cx},${cy - 9 * scale} ${cx + 8 * scale},${cy + 8 * scale} ${cx - 8 * scale},${cy + 8 * scale}`} {...common} />;
    case 'square':
      return <rect x={cx - 8 * scale} y={cy - 8 * scale} width={16 * scale} height={16 * scale} {...common} />;
    case 'diamond':
      return <polygon points={`${cx},${cy - 9 * scale} ${cx + 9 * scale},${cy} ${cx},${cy + 9 * scale} ${cx - 9 * scale},${cy}`} {...common} />;
    case 'pentagon': {
      const pts = [0, 1, 2, 3, 4].map((i) => {
        const angle = (Math.PI / 2) + (2 * Math.PI * i) / 5;
        return `${cx - 8 * scale * Math.cos(angle)},${cy - 8 * scale * Math.sin(angle)}`;
      }).join(' ');
      return <polygon points={pts} {...common} />;
    }
    case 'star': {
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const outerAngle = (Math.PI / 2) + (2 * Math.PI * i) / 5;
        pts.push(`${cx - 8 * scale * Math.cos(outerAngle)},${cy - 8 * scale * Math.sin(outerAngle)}`);
        const innerAngle = outerAngle + Math.PI / 5;
        pts.push(`${cx - 4 * scale * Math.cos(innerAngle)},${cy - 4 * scale * Math.sin(innerAngle)}`);
      }
      return <polygon points={pts.join(' ')} {...common} />;
    }
  }
}
