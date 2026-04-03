'use client';

import { useEffect, useRef, useState } from 'react';
import { Popup, useMap } from 'react-leaflet';
import type { Popup as LPopup } from 'leaflet';

interface DraggablePopupProps {
  maxWidth?: number;
  children: React.ReactNode;
}

/**
 * ドラッグ可能なポップアップ。
 * ドラッグ中はマーカーとポップアップを結ぶ線を表示する。
 */
export default function DraggablePopup({ maxWidth = 320, children }: DraggablePopupProps) {
  const popupRef = useRef<LPopup>(null);
  const map = useMap();
  const lineRef = useRef<SVGLineElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const markerPointRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;

    const el = popup.getElement();
    if (!el) return;

    // ポップアップのtipを非表示にする（ドラッグ時にラインで代替）
    const tip = el.querySelector('.leaflet-popup-tip-container') as HTMLElement | null;

    // SVGオーバーレイを地図コンテナに追加
    let svg = svgRef.current;
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.position = 'absolute';
      svg.style.top = '0';
      svg.style.left = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.pointerEvents = 'none';
      svg.style.zIndex = '650';
      map.getContainer().appendChild(svg);
      svgRef.current = svg;
    }

    let line = lineRef.current;
    if (!line) {
      line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', '#333');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '4 3');
      line.style.display = 'none';
      svg.appendChild(line);
      lineRef.current = line;
    }

    /** マーカー座標（ピクセル）を更新 */
    function updateMarkerPoint() {
      const latlng = popup!.getLatLng();
      if (!latlng) return;
      const pt = map.latLngToContainerPoint(latlng);
      markerPointRef.current = { x: pt.x, y: pt.y };
    }

    /** ラインの位置を更新 */
    function updateLine() {
      if (!line) return;
      const popupEl = popup!.getElement();
      if (!popupEl) return;

      const container = map.getContainer();
      const containerRect = container.getBoundingClientRect();
      const popupRect = popupEl.getBoundingClientRect();
      const popupCenterX = popupRect.left + popupRect.width / 2 - containerRect.left;
      const popupBottomY = popupRect.top + popupRect.height - containerRect.top;

      updateMarkerPoint();
      line.setAttribute('x1', String(markerPointRef.current.x));
      line.setAttribute('y1', String(markerPointRef.current.y));
      line.setAttribute('x2', String(popupCenterX));
      line.setAttribute('y2', String(popupBottomY));
    }

    // ドラッグヘッダーをラップの先頭に挿入
    const wrapper = el.querySelector('.leaflet-popup-content-wrapper') as HTMLElement | null;
    if (wrapper) {
      wrapper.style.cursor = 'grab';
    }

    function onMouseDown(e: MouseEvent) {
      // リンクやボタンのクリックは除外
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('a') || target.closest('button')) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
      map.dragging.disable();

      const popupEl = popup!.getElement()!;
      const rect = popupEl.getBoundingClientRect();
      offsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      updateMarkerPoint();
      if (tip) tip.style.display = 'none';
      if (line) line.style.display = '';
      updateLine();

      if (wrapper) wrapper.style.cursor = 'grabbing';

      function onMouseMove(ev: MouseEvent) {
        const container = map.getContainer();
        const containerRect = container.getBoundingClientRect();
        const newLeft = ev.clientX - containerRect.left - offsetRef.current.x;
        const newTop = ev.clientY - containerRect.top - offsetRef.current.y;

        popupEl.style.transform = 'none';
        popupEl.style.left = `${newLeft}px`;
        popupEl.style.top = `${newTop}px`;
        popupEl.style.position = 'absolute';

        updateLine();
      }

      function onMouseUp() {
        setDragging(false);
        map.dragging.enable();
        if (wrapper) wrapper.style.cursor = 'grab';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }

    // マップの移動/ズーム時にラインを更新
    function onMapMove() {
      if (line && line.style.display !== 'none') {
        updateLine();
      }
    }

    if (wrapper) {
      wrapper.addEventListener('mousedown', onMouseDown);
    }
    map.on('move zoom', onMapMove);

    return () => {
      if (wrapper) {
        wrapper.removeEventListener('mousedown', onMouseDown);
      }
      map.off('move zoom', onMapMove);
      if (line && line.parentNode) {
        line.parentNode.removeChild(line);
        lineRef.current = null;
      }
      if (svg && svg.childNodes.length === 0 && svg.parentNode) {
        svg.parentNode.removeChild(svg);
        svgRef.current = null;
      }
    };
  }, [map, dragging]);

  return (
    <Popup ref={popupRef} maxWidth={maxWidth} autoClose={false} closeOnClick={false}>
      {children}
    </Popup>
  );
}
