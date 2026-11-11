// GeoJSON を3Dの地表に貼る画像（透明キャンバス）に描く
// 線は線、面は塗りつぶした領域、点は丸印として描き、地形の起伏に沿って表示される

import { lonToPx, latToPy } from './geo.js';
import { featureStyle } from './GeoJsonLayers.js';

/**
 * @param {{north:number, south:number, east:number, west:number}} bounds 3D表示の領域
 * @param {{data:object, color:string}[]} items 表示する GeoJSON（ファイルごと）
 * @param {number} maxSize キャンバスの長辺(px)
 * @returns {HTMLCanvasElement|null} 描くものが無ければ null
 */
export function drawGeoJsonCanvas(bounds, items, maxSize) {
  if (items.length === 0) return null;

  // 地表テクスチャと同じくメルカトル投影で領域ぴったりに描く（UVをそのまま使える）
  const left = lonToPx(bounds.west, 0);
  const right = lonToPx(bounds.east, 0);
  const top = latToPy(bounds.north, 0);
  const bottom = latToPy(bounds.south, 0);
  const aspect = (right - left) / (bottom - top);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(aspect >= 1 ? maxSize : maxSize * aspect);
  canvas.height = Math.round(aspect >= 1 ? maxSize / aspect : maxSize);
  const sx = canvas.width / (right - left);
  const sy = canvas.height / (bottom - top);
  const project = ([lon, lat]) => [(lonToPx(lon, 0) - left) * sx, (latToPy(lat, 0) - top) * sy];

  // 2D地図の線の太さ(px)を、キャンバス長辺400pxあたりの太さとして扱う
  // （領域全体を表示したときに2D地図と同じくらいの見た目の太さになる）
  const scale = maxSize / 400;

  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 面 → 線 → 点 の順に描いて、点や線が面に隠れないようにする
  const features = items.flatMap((item) => toFeatures(item.data).map((f) => ({ f, color: item.color })));
  for (const kind of ['polygon', 'line', 'point']) {
    for (const { f, color } of features) {
      drawGeometry(ctx, f.geometry, kind, featureStyle(f, color), project, scale);
    }
  }
  return canvas;
}

// 点の丸印の半径（キャンバス長辺400pxあたりのpx。drawPoint で使う）
const POINT_RADIUS = 5;

/**
 * 3Dの地表に描いた点の丸印の、地上での半径(m)
 * キャンバスの長辺は領域の長い方の辺にあたる
 */
export function pointRadiusMeters(width, height) {
  return (POINT_RADIUS * Math.max(width, height)) / 400;
}

/**
 * 表示する GeoJSON の点（Point / MultiPoint）を集める（3Dでマーカーをタップしたときの判定用）
 * @param {{data:object}[]} items
 * @returns {{lon:number, lat:number, properties:object}[]}
 */
export function collectPoints(items) {
  const out = [];
  const walk = (g, properties) => {
    if (!g) return;
    if (g.type === 'Point') out.push({ lon: g.coordinates[0], lat: g.coordinates[1], properties });
    else if (g.type === 'MultiPoint') for (const c of g.coordinates) out.push({ lon: c[0], lat: c[1], properties });
    else if (g.type === 'GeometryCollection') for (const child of g.geometries || []) walk(child, properties);
  };
  for (const item of items) {
    for (const f of toFeatures(item.data)) walk(f.geometry, f.properties || {});
  }
  return out.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
}

/** FeatureCollection / Feature / ジオメトリ単体 / 配列 を Feature の配列にそろえる */
function toFeatures(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(toFeatures);
  if (data.type === 'FeatureCollection') return (data.features || []).flatMap(toFeatures);
  if (data.type === 'Feature') return data.geometry ? [data] : [];
  if (typeof data.type === 'string') return [{ type: 'Feature', geometry: data, properties: {} }];
  return [];
}

function drawGeometry(ctx, g, kind, style, project, scale) {
  if (!g) return;
  const c = g.coordinates;
  switch (g.type) {
    case 'Point':
      if (kind === 'point') drawPoint(ctx, c, style, project, scale);
      break;
    case 'MultiPoint':
      if (kind === 'point') for (const p of c) drawPoint(ctx, p, style, project, scale);
      break;
    case 'LineString':
      if (kind === 'line') drawLines(ctx, [c], style, project, scale);
      break;
    case 'MultiLineString':
      if (kind === 'line') drawLines(ctx, c, style, project, scale);
      break;
    case 'Polygon':
      if (kind === 'polygon') drawPolygon(ctx, c, style, project, scale);
      break;
    case 'MultiPolygon':
      if (kind === 'polygon') for (const poly of c) drawPolygon(ctx, poly, style, project, scale);
      break;
    case 'GeometryCollection':
      for (const child of g.geometries || []) drawGeometry(ctx, child, kind, style, project, scale);
      break;
  }
}

function tracePath(ctx, coords, project, close) {
  coords.forEach((pt, n) => {
    const [x, y] = project(pt);
    if (n === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (close) ctx.closePath();
}

function drawLines(ctx, lines, style, project, scale) {
  ctx.beginPath();
  for (const line of lines) tracePath(ctx, line, project, false);
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.weight * scale;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** 面：塗りつぶし（穴あきにも対応）＋ 輪郭線 */
function drawPolygon(ctx, rings, style, project, scale) {
  ctx.beginPath();
  for (const ring of rings) tracePath(ctx, ring, project, true);
  ctx.globalAlpha = style.fillOpacity;
  ctx.fillStyle = style.fillColor;
  ctx.fill('evenodd');
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.weight * scale;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPoint(ctx, coord, style, project, scale) {
  const [x, y] = project(coord);
  ctx.beginPath();
  ctx.arc(x, y, POINT_RADIUS * scale, 0, Math.PI * 2);
  ctx.fillStyle = style.fillColor;
  ctx.fill();
  ctx.lineWidth = style.weight * scale;
  ctx.strokeStyle = style.color;
  ctx.stroke();
}
