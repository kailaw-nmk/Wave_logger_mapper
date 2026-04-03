'use client';

import { useCallback, useRef } from 'react';
import { Popup, useMap } from 'react-leaflet';
import type { Popup as LPopup } from 'leaflet';

interface DraggablePopupProps {
  maxWidth?: number;
  children: React.ReactNode;
}

/** SVGコンテナを取得（なければ作成） */
function getOrCreateSvg(container: HTMLElement): SVGSVGElement {
  let existing = container.querySelector('.wlm-popup-lines') as SVGSVGElement | null;
  if (!existing) {
    existing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    existing.classList.add('wlm-popup-lines');
    existing.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:650';
    container.appendChild(existing);
  }
  return existing;
}

export default function DraggablePopup({ maxWidth = 320, children }: DraggablePopupProps) {
  const map = useMap();
  const lineRef = useRef<SVGLineElement | null>(null);
  const cleanupFnRef = useRef<(() => void) | null>(null);

  const onAdd = useCallback((e: { target: LPopup }) => {
    const popup = e.target;
    // 少し遅延してDOM確定後にセットアップ
    requestAnimationFrame(() => {
      const el = popup.getElement();
      if (!el) return;

      // 前回のクリーンアップ
      if (cleanupFnRef.current) {
        cleanupFnRef.current();
        cleanupFnRef.current = null;
      }

      const tip = el.querySelector('.leaflet-popup-tip-container') as HTMLElement | null;
      const wrapper = el.querySelector('.leaflet-popup-content-wrapper') as HTMLElement | null;
      if (!wrapper) return;

      wrapper.style.cursor = 'grab';

      // 接続線を作成
      const svg = getOrCreateSvg(map.getContainer());
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', '#333');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '4 3');
      line.style.display = 'none';
      svg.appendChild(line);
      lineRef.current = line;

      let isDragged = false;

      function updateLine() {
        const popupEl = popup.getElement();
        if (!popupEl) return;
        const container = map.getContainer();
        const cRect = container.getBoundingClientRect();
        const pRect = popupEl.getBoundingClientRect();
        const latlng = popup.getLatLng();
        if (!latlng) return;
        const mp = map.latLngToContainerPoint(latlng);
        line.setAttribute('x1', String(mp.x));
        line.setAttribute('y1', String(mp.y));
        line.setAttribute('x2', String(pRect.left + pRect.width / 2 - cRect.left));
        line.setAttribute('y2', String(pRect.top + pRect.height - cRect.top));
      }

      function onMouseDown(evt: MouseEvent) {
        const tgt = evt.target as HTMLElement;
        if (tgt.closest('a') || tgt.closest('button') || tgt.closest('input') || tgt.closest('.leaflet-popup-close-button')) return;

        evt.preventDefault();
        evt.stopPropagation();
        map.dragging.disable();

        const popupEl = popup.getElement()!;
        const cRect = map.getContainer().getBoundingClientRect();
        const pRect = popupEl.getBoundingClientRect();

        // 現在の画面位置をコンテナ相対の left/top に変換してからtransformを解除
        const currentLeft = pRect.left - cRect.left;
        const currentTop = pRect.top - cRect.top;
        popupEl.style.transform = 'none';
        popupEl.style.position = 'absolute';
        popupEl.style.left = `${currentLeft}px`;
        popupEl.style.top = `${currentTop}px`;
        // Leafletが設定するbottomを無効化
        popupEl.style.bottom = 'auto';

        const ox = evt.clientX - pRect.left;
        const oy = evt.clientY - pRect.top;

        if (tip) tip.style.display = 'none';
        line.style.display = '';
        isDragged = true;
        updateLine();
        wrapper!.style.cursor = 'grabbing';

        function onMove(ev: MouseEvent) {
          const cr = map.getContainer().getBoundingClientRect();
          popupEl.style.left = `${ev.clientX - cr.left - ox}px`;
          popupEl.style.top = `${ev.clientY - cr.top - oy}px`;
          updateLine();
        }

        function onUp() {
          map.dragging.enable();
          wrapper!.style.cursor = 'grab';
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }

      function onMapMove() {
        if (isDragged) updateLine();
      }

      wrapper.addEventListener('mousedown', onMouseDown);
      map.on('move zoom', onMapMove);

      cleanupFnRef.current = () => {
        wrapper.removeEventListener('mousedown', onMouseDown);
        map.off('move zoom', onMapMove);
        if (line.parentNode) line.parentNode.removeChild(line);
        lineRef.current = null;
      };
    });
  }, [map]);

  const onRemove = useCallback(() => {
    if (cleanupFnRef.current) {
      cleanupFnRef.current();
      cleanupFnRef.current = null;
    }
  }, []);

  return (
    <Popup
      maxWidth={maxWidth}
      autoClose={false}
      closeOnClick={false}
      eventHandlers={{ add: onAdd, remove: onRemove }}
    >
      {children}
    </Popup>
  );
}
