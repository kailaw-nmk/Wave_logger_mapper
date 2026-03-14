'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import type { CsvRow } from '@/lib/csvParser';
import { binByPixel } from '@/lib/csvParser';
import type { PixelBinData } from '@/lib/csvParser';
import type { Metric } from '@/lib/colorScale';
import { METRIC_LABELS } from '@/lib/colorScale';

interface SpeedChartProps {
  data: CsvRow[];
  metric: Metric;
  binWidthPx: number;
  westLng: number;
  eastLng: number;
  containerWidth: number;
  onBinHover?: (range: [number, number] | null) => void;
  selectedLng?: number | null;
}

/** メトリックの単位を返す */
function unitForMetric(m: Metric): string {
  if (m === 'udp_packet_loss_pct') return '%';
  if (m.includes('ping') || m.includes('jitter')) return 'ms';
  return 'Mbps';
}

/** 数値フォーマット */
function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** きりの良い目盛り値を生成する */
function computeNiceTicks(min: number, max: number, targetCount: number): number[] {
  if (max <= min) return [0];
  const range = max - min;
  const roughStep = range / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const candidates = [1, 2, 5, 10];
  let step = candidates[0] * magnitude;
  for (const c of candidates) {
    if (c * magnitude >= roughStep) {
      step = c * magnitude;
      break;
    }
  }
  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  if (ticks.length === 0) ticks.push(0);
  return ticks;
}

const Y_AXIS_WIDTH = 48;
const TOP_PADDING = 12;
const BOTTOM_PADDING = 4;

export default function SpeedChart({
  data, metric, binWidthPx, westLng, eastLng, containerWidth,
  onBinHover, selectedLng,
}: SpeedChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(200);
  const [hoveredBin, setHoveredBin] = useState<PixelBinData | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // コンテナ高さの監視
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { bins } = useMemo(
    () => binByPixel(data, westLng, eastLng, containerWidth, binWidthPx, metric),
    [data, westLng, eastLng, containerWidth, binWidthPx, metric],
  );

  const unit = unitForMetric(metric);

  // Y軸範囲
  const yMax = useMemo(() => {
    if (bins.length === 0) return 1;
    return Math.max(...bins.map((b) => b.max));
  }, [bins]);

  const ticks = useMemo(() => computeNiceTicks(0, yMax, 5), [yMax]);
  const yDomainMax = ticks.length > 0 ? Math.max(ticks[ticks.length - 1], yMax) : yMax;

  const chartHeight = height - TOP_PADDING - BOTTOM_PADDING;

  // 値→Y座標変換
  const toY = useCallback((v: number) => {
    return TOP_PADDING + chartHeight * (1 - v / yDomainMax);
  }, [chartHeight, yDomainMax]);

  // マウスイベントハンドラ
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    setMousePos({ x: mouseX, y: mouseY });

    // ホバー中のビンを検出
    const bin = bins.find((b) => Math.abs(b.pixelX - mouseX) <= binWidthPx / 2);
    setHoveredBin(bin ?? null);
    if (onBinHover) {
      onBinHover(bin ? [bin.lngMin, bin.lngMax] : null);
    }
  }, [bins, binWidthPx, onBinHover]);

  const handleMouseLeave = useCallback(() => {
    setHoveredBin(null);
    setMousePos(null);
    if (onBinHover) onBinHover(null);
  }, [onBinHover]);

  // クリックされた経度 → ピクセルX
  const selectedPx = selectedLng != null
    ? ((selectedLng - westLng) / (eastLng - westLng)) * containerWidth
    : null;

  if (bins.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}
      >
        表示できるデータがありません
      </div>
    );
  }

  const boxHalfW = Math.min(binWidthPx * 0.325, 25);
  const capHalfW = boxHalfW * 0.7;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <svg
        width={containerWidth}
        height={height}
        style={{ display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Y軸グリッド線 */}
        {ticks.map((t) => (
          <line
            key={`grid-${t}`}
            x1={0}
            y1={toY(t)}
            x2={containerWidth}
            y2={toY(t)}
            stroke="#e5e7eb"
            strokeDasharray="4 4"
          />
        ))}

        {/* 箱ひげ図 */}
        {bins.map((bin, i) => {
          const cx = bin.pixelX;
          const pMax = toY(bin.max);
          const pMin = toY(bin.min);
          const pQ3 = toY(bin.q3);
          const pQ1 = toY(bin.q1);
          const pMed = toY(bin.median);
          const iqrH = Math.max(pQ1 - pQ3, 2);
          const isHovered = hoveredBin === bin;

          return (
            <g key={i} opacity={isHovered ? 1 : 0.85}>
              {/* ひげ（縦線） */}
              <line x1={cx} y1={pMax} x2={cx} y2={pMin} stroke="#555" strokeWidth={1.5} />
              {/* 上キャップ */}
              <line x1={cx - capHalfW} y1={pMax} x2={cx + capHalfW} y2={pMax} stroke="#555" strokeWidth={1.5} />
              {/* 下キャップ */}
              <line x1={cx - capHalfW} y1={pMin} x2={cx + capHalfW} y2={pMin} stroke="#555" strokeWidth={1.5} />
              {/* IQRボックス */}
              <rect
                x={cx - boxHalfW}
                y={pQ3}
                width={boxHalfW * 2}
                height={iqrH}
                fill={isHovered ? 'rgba(59, 130, 246, 0.55)' : 'rgba(59, 130, 246, 0.4)'}
                stroke="#3b82f6"
                strokeWidth={1.5}
              />
              {/* 中央値ライン */}
              <line x1={cx - boxHalfW} y1={pMed} x2={cx + boxHalfW} y2={pMed} stroke="#ef4444" strokeWidth={2.5} />
            </g>
          );
        })}

        {/* クリックされた経度の赤い破線 */}
        {selectedPx != null && (
          <>
            <line
              x1={selectedPx}
              y1={TOP_PADDING}
              x2={selectedPx}
              y2={height - BOTTOM_PADDING}
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="4 4"
            />
            <text
              x={selectedPx}
              y={TOP_PADDING - 2}
              textAnchor="middle"
              fontSize={10}
              fill="#ef4444"
            >
              lng: {selectedLng!.toFixed(5)}
            </text>
          </>
        )}

        {/* Y軸（半透明背景付きオーバーレイ） */}
        <rect x={0} y={0} width={Y_AXIS_WIDTH} height={height} fill="rgba(255,255,255,0.85)" />
        <line x1={Y_AXIS_WIDTH} y1={TOP_PADDING} x2={Y_AXIS_WIDTH} y2={height - BOTTOM_PADDING} stroke="#d1d5db" />
        {ticks.map((t) => (
          <g key={`tick-${t}`}>
            <line x1={Y_AXIS_WIDTH - 4} y1={toY(t)} x2={Y_AXIS_WIDTH} y2={toY(t)} stroke="#9ca3af" />
            <text x={Y_AXIS_WIDTH - 6} y={toY(t) + 4} textAnchor="end" fontSize={10} fill="#666">
              {fmt(t)}
            </text>
          </g>
        ))}
        {/* Y軸ラベル */}
        <text
          x={12}
          y={height / 2}
          textAnchor="middle"
          fontSize={11}
          fill="#666"
          transform={`rotate(-90, 12, ${height / 2})`}
        >
          {METRIC_LABELS[metric]}
        </text>
      </svg>

      {/* ツールチップ */}
      {hoveredBin && mousePos && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(mousePos.x + 12, containerWidth - 180),
            top: Math.max(mousePos.y - 100, 4),
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 12,
            lineHeight: 1.6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            経度: {hoveredBin.lngCenter.toFixed(5)}
          </div>
          <div>最大: {fmt(hoveredBin.max)} {unit}</div>
          <div>Q3: {fmt(hoveredBin.q3)} {unit}</div>
          <div style={{ fontWeight: 700, color: '#ef4444' }}>
            中央値: {fmt(hoveredBin.median)} {unit}
          </div>
          <div>Q1: {fmt(hoveredBin.q1)} {unit}</div>
          <div>最小: {fmt(hoveredBin.min)} {unit}</div>
          <div style={{ marginTop: 4, color: '#666' }}>データ数: {hoveredBin.count}件</div>
        </div>
      )}
    </div>
  );
}
