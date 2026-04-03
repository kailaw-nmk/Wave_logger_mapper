'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Popup, useMap } from 'react-leaflet';
import type { Popup as LPopup } from 'leaflet';

interface DraggablePopupProps {
  maxWidth?: number;
  children: React.ReactNode;
}

/**
 * ドラッグ可能なポップアップ。
 * ドラッグ中はマーカーとポップアップを結ぶ点線を表示する。
 */
export default function DraggablePopup({ maxWidth = 320, children }: DraggablePopupProps) {
  const popupRef = useRef<LPopup>(null);
  const map = useMap();
  const lineRef = useRef<SVGLineElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  /** SVGコンテナを取得（なければ作成） */
  const getOrCreateSvg = useCallback(() => {
    if (svgRef.current) return svgRef.current;
    // 既存のSVGコンテナがあれば再利用
    const container = map.getContainer();
    let existing = container.querySelector('.wlm-popup-lines') as SVGSVGElement | null;
    if (!existing) {
      existing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      existing.classList.add('wlm-popup-lines');
      existing.style.position = 'absolute';
      existing.style.top = '0';
      existing.style.left = '0';
      existing.style.width = '100%';
      existing.style.height = '100%';
      existing.style.pointerEvents = 'none';
      existing.style.zIndex = '650';
      container.appendChild(existing);
    }
    svgRef.current = existing;
    return existing;
  }, [map]);

  /** ポップアップが開かれた後にドラッグ機能をセットアップ */
  const setupDrag = useCallback(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const el = popup.getElement();
    if (!el) return;

    // 前回のクリーンアップ
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    const tip = el.querySelector('.leaflet-popup-tip-container') as HTMLElement | null;
    const wrapper = el.querySelector('.leaflet-popup-content-wrapper') as HTMLElement | null;
    if (!wrapper) return;

    wrapper.style.cursor = 'grab';

    // ライン要素を作成
    const svg = getOrCreateSvg();
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', '#333');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '4 3');
    line.style.display = 'none';
    svg.appendChild(line);
    lineRef.current = line;

    let isDragged = false;

    function getMarkerPoint() {
      const latlng = popup!.getLatLng();
      if (!latlng) return { x: 0, y: 0 };
      const pt = map.latLngToContainerPoint(latlng);
      return { x: pt.x, y: pt.y };
    }

    function updateLine() {
      const popupEl = popup!.getElement();
      if (!popupEl || !line) return;
      const container = map.getContainer();
      const containerRect = container.getBoundingClientRect();
      const popupRect = popupEl.getBoundingClientRect();
      const popupCenterX = popupRect.left + popupRect.width / 2 - containerRect.left;
      const popupBottomY = popupRect.top + popupRect.height - containerRect.top;
      const mp = getMarkerPoint();
      line.setAttribute('x1', String(mp.x));
      line.setAttribute('y1', String(mp.y));
      line.setAttribute('x2', String(popupCenterX));
      line.setAttribute('y2', String(popupBottomY));
    }

    function onMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.tagName === 'INPUT' ||
          target.closest('a') || target.closest('button') || target.closest('input')) {
        return;
      }
      // 閉じるボタン（×）のクリックは除外
      if (target.closest('.leaflet-popup-close-button')) return;

      e.preventDefault();
      e.stopPropagation();
      map.dragging.disable();

      const popupEl = popup!.getElement()!;
      const rect = popupEl.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      if (tip) tip.style.display = 'none';
      line.style.display = '';
      isDragged = true;
      updateLine();
      wrapper!.style.cursor = 'grabbing';

      function onMouseMove(ev: MouseEvent) {
        const container = map.getContainer();
        const containerRect = container.getBoundingClientRect();
        const newLeft = ev.clientX - containerRect.left - offsetX;
        const newTop = ev.clientY - containerRect.top - offsetY;

        popupEl.style.transform = 'none';
        popupEl.style.left = `${newLeft}px`;
        popupEl.style.top = `${newTop}px`;
        popupEl.style.position = 'absolute';

        updateLine();
      }

      function onMouseUp() {
        map.dragging.enable();
        wrapper!.style.cursor = 'grab';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }

    function onMapMove() {
      if (isDragged && line.style.display !== 'none') {
        updateLine();
      }
    }

    wrapper.addEventListener('mousedown', onMouseDown);
    map.on('move zoom', onMapMove);

    cleanupRef.current = () => {
      wrapper.removeEventListener('mousedown', onMouseDown);
      map.off('move zoom', onMapMove);
      if (line.parentNode) line.parentNode.removeChild(line);
      lineRef.current = null;
    };
  }, [map, getOrCreateSvg]);

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;

    // ポップアップが開かれたときにセットアップ
    popup.on('add', setupDrag);

    return () => {
      popup.off('add', setupDrag);
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [setupDrag]);

  return (
    <Popup ref={popupRef} maxWidth={maxWidth} autoClose={false} closeOnClick={false}>
      {children}
    </Popup>
  );
}
