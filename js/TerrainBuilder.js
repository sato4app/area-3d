// 指定領域の標高グリッドと地表テクスチャを作成する

import { DEM_LAYERS, DEM_CHAINS, MAX_GRID_SEGMENTS } from './config.js';
import { computeBounds, boundsToPixels, lonToPx, latToPy } from './geo.js';
import { loadDem, loadTexture } from './tiles.js';

/**
 * @param {object} opts
 * @param {{lat:number, lon:number}} opts.center 中心点
 * @param {number} opts.width  横 x (m)
 * @param {number} opts.height 縦 y (m)
 * @param {string} opts.dem    'dem1a' | 'dem5a' | 'dem10b'
 * @param {object} opts.mapLayer MAP_LAYERS の要素
 * @param {number} opts.texSize テクスチャの最大ピクセル数
 * @param {(msg:string)=>void} onStatus 進捗表示
 */
export async function buildTerrain(opts, onStatus) {
  const { center, width, height } = opts;
  const bounds = computeBounds(center, width, height);

  // ---- 標高データ ----
  // 選んだデータから順に取得し、データの無い所（水面など）は次のデータで補完する
  // 例：1m → 5m → 10m
  const chain = (DEM_CHAINS[opts.dem] ?? DEM_CHAINS.dem5a).map((key) => DEM_LAYERS[key]);
  const demUsed = [];
  const fetchDem = (layer) =>
    loadDem(bounds, layer, (d, t) => onStatus(`標高データ取得中（${layer.label}） ${d}/${t}`));

  // 基本にするデータ（タイル数が多すぎて取得できないものは飛ばす）
  let primary = null;
  let next = 0;
  while (!primary && next < chain.length) primary = await fetchDem(chain[next++]);
  if (!primary) throw new Error('領域が広すぎて標高データを取得できません。サイズを小さくしてください。');
  if (primary.loadedTiles > 0) demUsed.push(chain[next - 1].label);

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

  // データの無い場所は、より粗いデータで順に補完
  while (next < chain.length && hasNaN(heights)) {
    const layer = chain[next++];
    const grid = await fetchDem(layer);
    if (!grid || grid.loadedTiles === 0) continue;
    const fill = sampleGrid(grid, lons, lats);
    let used = false;
    for (let k = 0; k < heights.length; k++) {
      if (Number.isNaN(heights[k]) && !Number.isNaN(fill[k])) {
        heights[k] = fill[k];
        used = true;
      }
    }
    if (used) demUsed.push(layer.label);
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
