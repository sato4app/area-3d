// 国土地理院タイルの取得（標高タイル・地図タイル）

import { FETCH_CONCURRENCY, MAX_DEM_TILES, MAX_TEXTURE_TILES } from './config.js';
import { TILE_SIZE, boundsToPixels, tileRange, tileCount } from './geo.js';

function tileUrl(template, z, x, y) {
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

/** タイル画像を取得（存在しない場合は null） */
async function fetchTileImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null; // 海域などタイルが無い場所は404
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch (e) {
    console.warn('タイル取得失敗:', url, e);
    return null;
  }
}

/** 同時実行数を制限してタスクを処理 */
async function runPool(items, worker, concurrency, onProgress) {
  let next = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
      done++;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(runners);
}

function listTiles(range) {
  const tiles = [];
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) tiles.push({ x, y });
  }
  return tiles;
}

// ------------------------------------------------------------
// 標高タイル
// ------------------------------------------------------------

/**
 * 標高グリッド：複数の標高タイルを1枚の配列に結合したもの
 * 値は m、データ無しは NaN
 */
export class DemGrid {
  constructor(z, range) {
    this.z = z;
    this.originX = range.x0 * TILE_SIZE;
    this.originY = range.y0 * TILE_SIZE;
    this.width = (range.x1 - range.x0 + 1) * TILE_SIZE;
    this.height = (range.y1 - range.y0 + 1) * TILE_SIZE;
    this.data = new Float32Array(this.width * this.height).fill(NaN);
    this.loadedTiles = 0; // 取得できたタイル数（提供範囲外なら0）
  }

  /** 1枚の標高タイルPNGを数値に変換して格納 */
  putTile(tx, ty, rgba) {
    const ox = tx * TILE_SIZE - this.originX;
    const oy = ty * TILE_SIZE - this.originY;
    for (let j = 0; j < TILE_SIZE; j++) {
      for (let i = 0; i < TILE_SIZE; i++) {
        const p = (j * TILE_SIZE + i) * 4;
        // 地理院の標高PNG仕様: x = R*2^16 + G*2^8 + B, 単位0.01m, 2^23 は無効値
        const v = rgba[p] * 65536 + rgba[p + 1] * 256 + rgba[p + 2];
        let h;
        if (v === 8388608) h = NaN;
        else if (v < 8388608) h = v * 0.01;
        else h = (v - 16777216) * 0.01;
        this.data[(oy + j) * this.width + (ox + i)] = h;
      }
    }
    this.loadedTiles++;
  }

  /** グローバルピクセル座標で双線形補間（無効値は除外して加重平均） */
  sample(gpx, gpy) {
    const x = gpx - this.originX - 0.5;
    const y = gpy - this.originY - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    let sum = 0;
    let wsum = 0;
    const add = (xi, yi, w) => {
      if (w <= 0) return;
      const cx = Math.min(Math.max(xi, 0), this.width - 1);
      const cy = Math.min(Math.max(yi, 0), this.height - 1);
      const h = this.data[cy * this.width + cx];
      if (!Number.isNaN(h)) {
        sum += h * w;
        wsum += w;
      }
    };
    add(x0, y0, (1 - fx) * (1 - fy));
    add(x0 + 1, y0, fx * (1 - fy));
    add(x0, y0 + 1, (1 - fx) * fy);
    add(x0 + 1, y0 + 1, fx * fy);
    return wsum > 0 ? sum / wsum : NaN;
  }
}

/** 標高タイルを取得してDemGridを作る（タイル数が多すぎる場合は null） */
export async function loadDem(bounds, demLayer, onProgress) {
  const z = demLayer.zoom;
  const range = tileRange(boundsToPixels(bounds, z));
  if (tileCount(range) > MAX_DEM_TILES) return null;

  const grid = new DemGrid(z, range);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  await runPool(listTiles(range), async ({ x, y }) => {
    const img = await fetchTileImage(tileUrl(demLayer.url, z, x, y));
    if (!img) return;
    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    ctx.drawImage(img, 0, 0);
    grid.putTile(x, y, ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data);
    img.close();
  }, FETCH_CONCURRENCY, onProgress);

  return grid;
}

// ------------------------------------------------------------
// 地図タイル（3Dの地表テクスチャ）
// ------------------------------------------------------------

/** 指定サイズ・タイル数に収まる最大のズームレベルを選ぶ */
export function chooseTextureZoom(bounds, mapLayer, maxSize) {
  for (let z = mapLayer.maxZoom; z >= 2; z--) {
    const px = boundsToPixels(bounds, z);
    const w = px.right - px.left;
    const h = px.bottom - px.top;
    if (Math.max(w, h) <= maxSize && tileCount(tileRange(px)) <= MAX_TEXTURE_TILES) return z;
  }
  return 2;
}

/**
 * 地図タイルを結合して領域ぴったりに切り抜いたキャンバスを返す
 * @returns {{canvas:HTMLCanvasElement, z:number, px:object}}
 */
export async function loadTexture(bounds, mapLayer, maxSize, onProgress, { fillBackground = true } = {}) {
  const z = chooseTextureZoom(bounds, mapLayer, maxSize);
  const px = boundsToPixels(bounds, z);
  const range = tileRange(px);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(px.right - px.left));
  canvas.height = Math.max(1, Math.round(px.bottom - px.top));
  const ctx = canvas.getContext('2d');
  // 重ね地図ではタイルの無い所を透明のままにして、下の地図が見えるようにする
  if (fillBackground) {
    ctx.fillStyle = '#e8ebe4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  await runPool(listTiles(range), async ({ x, y }) => {
    const img = await fetchTileImage(tileUrl(mapLayer.url, z, x, y));
    if (!img) return;
    ctx.drawImage(img, x * TILE_SIZE - px.left, y * TILE_SIZE - px.top);
    img.close();
  }, FETCH_CONCURRENCY, onProgress);

  return { canvas, z, px };
}
