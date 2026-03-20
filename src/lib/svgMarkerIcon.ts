import type { MarkerShape } from '@/lib/groupStyle';

/** SVG形状のパス定義（20×20 viewBox内） */
function shapeSvg(shape: MarkerShape, fillColor: string, borderColor: string): string {
  const common = `fill="${fillColor}" stroke="${borderColor}" stroke-width="2.5" fill-opacity="0.8"`;
  switch (shape) {
    case 'circle':
      return `<circle cx="10" cy="10" r="8" ${common}/>`;
    case 'triangle':
      return `<polygon points="10,2 18,18 2,18" ${common}/>`;
    case 'square':
      return `<rect x="2" y="2" width="16" height="16" ${common}/>`;
    case 'diamond':
      return `<polygon points="10,1 19,10 10,19 1,10" ${common}/>`;
    case 'pentagon': {
      // 正五角形（中心10,10 半径8）
      const pts = [0, 1, 2, 3, 4].map((i) => {
        const angle = (Math.PI / 2) + (2 * Math.PI * i) / 5;
        return `${10 - 8 * Math.cos(angle)},${10 - 8 * Math.sin(angle)}`;
      }).join(' ');
      return `<polygon points="${pts}" ${common}/>`;
    }
    case 'star': {
      // 五芒星（外半径8, 内半径4）
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const outerAngle = (Math.PI / 2) + (2 * Math.PI * i) / 5;
        pts.push(`${10 - 8 * Math.cos(outerAngle)},${10 - 8 * Math.sin(outerAngle)}`);
        const innerAngle = outerAngle + Math.PI / 5;
        pts.push(`${10 - 4 * Math.cos(innerAngle)},${10 - 4 * Math.sin(innerAngle)}`);
      }
      return `<polygon points="${pts.join(' ')}" ${common}/>`;
    }
  }
}

/** キャッシュ */
const iconCache = new Map<string, L.DivIcon>();

/** 形状付きDivIconを生成する（キャッシュ付き） */
export function createShapeIcon(
  shape: MarkerShape,
  fillColor: string,
  borderColor: string,
  size: number = 20,
): L.DivIcon {
  const cacheKey = `${shape}-${fillColor}-${borderColor}-${size}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const L = require('leaflet') as typeof import('leaflet');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20">${shapeSvg(shape, fillColor, borderColor)}</svg>`;

  const icon = L.divIcon({
    html: svg,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });

  iconCache.set(cacheKey, icon);
  return icon;
}
