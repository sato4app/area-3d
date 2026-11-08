// 指定領域の標高グリッドと地表テクスチャを作成する

import { DEM_LAYERS, MAX_GRID_SEGMENTS } from './config.js';
import { computeBounds, boundsToPixels, lonToPx, latToPy } from './geo.js';
import { loadDem, loadTexture } from './tiles.js';

/**
 * @param {object} opts
 * @param {{lat:number, lon:number}} opts.center 中心点
 * @param {number} opts.width  横 x (m)
 * @param {number} opts.height 縦 y (m)
 * @param {string} opts.dem    'dem5a' | 'dem10b'
 * @param {object} opts.mapLayer MAP_LAYERS の要素
 * @param {number} opts.texSize テクスチャの最大ピクセル数
 * @param {(msg:string)=>void} onStatus 進捗表示
 */
export async function buildTerrain(opts, onStatus) {
  const { center, width, height } = opts;
  const bounds = computeBounds(center, width, height);

  // ---- 標高データ ----
  const demUsed = [];
  let primary = null;
  if (opts.dem === 'dem5a') {
    primary = await loadDem(bounds, DEM_LAYERS.dem5a, (d, t) => onStatus(`標高データ取得中（5m） ${d}/${t}`));
    if (primary) demUsed.push('5m');
  }
  let secondary = null;
  const loadDem10 = async () => {
    const g = await loadDem(bounds, DEM_LAYERS.dem10b, (d, t) => onStatus(`標高データ取得中（10m） ${d}/${t}`));
    if (!g) throw new Error('領域が広すぎて標高データを取得できません。サイズを小さくしてください。');
    demUsed.push('10m');
    return g;
  };
  if (!primary) primary = await loadDem10();

  // メッシュの分割数：標高データの解像度に合わせる（上限あり）
  const demPx = boundsToPixels(bounds, primary.z);
  const segX = clampInt(Math.round(demPx.right - demPx.left), 2, MAX_GRID_SEGMENTS);
  const segY = clampInt(Math.round(demPx.bottom - demPx.top), 2, MAX_GRID_SEGMENTS);
  const nx = segX + 1;
  const ny = segY + 1;

  // 各頂点の緯度経度
  const lons = new Float64Array(nx);
  const lats = new Float64Array(ny);
  for (let i = 0; i < nx; i++) lons[i] = bounds.west + (i / segX) * (bounds.east - bounds.west);
  for (let j = 0; j < ny; j++) lats[j] = bounds.north - (j / segY) * (bounds.north - bounds.south);

  onStatus('標高を計算中…');
  const heights = sampleGrid(primary, lons, lats);

  // 5mメッシュが無い場所は10mメッシュで補完
  if (opts.dem === 'dem5a' && primary.z === DEM_LAYERS.dem5a.zoom && hasNaN(heights)) {
    secondary = await loadDem10();
    const fill = sampleGrid(secondary, lons, lats);
    for (let k = 0; k < heights.length; k++) {
      if (Number.isNaN(heights[k])) heights[k] = fill[k];
    }
  }

  // それでも無い場所（海域など）は 0m
  let minH = Infinity;
  let maxH = -Infinity;
  let missing = 0;
  for (let k = 0; k < heights.length; k++) {
    if (Number.isNaN(heights[k])) {
      heights[k] = 0;
      missing++;
    }
    minH = Math.min(minH, heights[k]);
    maxH = Math.max(maxH, heights[k]);
  }

  // ---- 地表テクスチャ ----
  const tex = await loadTexture(bounds, opts.mapLayer, opts.texSize, (d, t) => onStatus(`地図画像取得中 ${d}/${t}`));

  // ---- 重ね地図（半透明で上に重ねる） ----
  let overlay = null;
  if (opts.overlayLayer) {
    overlay = await loadTexture(
      bounds,
      opts.overlayLayer,
      opts.texSize,
      (d, t) => onStatus(`重ね地図取得中 ${d}/${t}`),
      { fillBackground: false },
    );
  }

  // 各頂点のUV（メルカトル投影の画像に合わせて計算）
  // 画像は領域ぴったりに切り抜いているため、UVはズームレベルに依存せず重ね地図にもそのまま使える
  const uvs = new Float32Array(nx * ny * 2);
  const texW = tex.px.right - tex.px.left;
  const texH = tex.px.bottom - tex.px.top;
  const us = Array.from(lons, (lon) => (lonToPx(lon, tex.z) - tex.px.left) / texW);
  const vs = Array.from(lats, (lat) => 1 - (latToPy(lat, tex.z) - tex.px.top) / texH);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 2;
      uvs[k] = us[i];
      uvs[k + 1] = vs[j];
    }
  }

  return {
    center,
    width,
    height,
    bounds,
    segX,
    segY,
    heights,
    uvs,
    minH,
    maxH,
    missingRatio: missing / heights.length,
    demUsed,
    textureCanvas: tex.canvas,
    textureZoom: tex.z,
    texSize: opts.texSize, // GeoJSON を地表に描く画像の大きさにも使う
    overlayCanvas: overlay?.canvas ?? null,
    overlayZoom: overlay?.z ?? null,
  };
}

function sampleGrid(grid, lons, lats) {
  const nx = lons.length;
  const out = new Float32Array(nx * lats.length);
  const gpx = Array.from(lons, (lon) => lonToPx(lon, grid.z));
  for (let j = 0; j < lats.length; j++) {
    const gpy = latToPy(lats[j], grid.z);
    for (let i = 0; i < nx; i++) out[j * nx + i] = grid.sample(gpx[i], gpy);
  }
  return out;
}

function hasNaN(arr) {
  for (let k = 0; k < arr.length; k++) if (Number.isNaN(arr[k])) return true;
  return false;
}

function clampInt(v, min, max) {
  return Math.min(Math.max(Math.round(v), min), max);
}
