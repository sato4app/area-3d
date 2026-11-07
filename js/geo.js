// 座標計算ユーティリティ（WGS84 ⇔ Web メルカトル タイル座標）

const EARTH_RADIUS = 6378137; // m
const TILE_SIZE = 256;

/** 経度 → ズームzでのグローバルピクセルX */
export function lonToPx(lon, z) {
  return ((lon + 180) / 360) * TILE_SIZE * 2 ** z;
}

/** 緯度 → ズームzでのグローバルピクセルY */
export function latToPy(lat, z) {
  const rad = (lat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
  return y * TILE_SIZE * 2 ** z;
}

/** 緯度1度あたりの距離(m) */
export function metersPerDegLat() {
  return (Math.PI * EARTH_RADIUS) / 180;
}

/** 指定緯度での経度1度あたりの距離(m) */
export function metersPerDegLon(lat) {
  return metersPerDegLat() * Math.cos((lat * Math.PI) / 180);
}

/**
 * 中心点と横x・縦y(m)から矩形領域の緯度経度範囲を求める
 * @returns {{north:number, south:number, east:number, west:number}}
 */
export function computeBounds(center, widthM, heightM) {
  const dLat = heightM / 2 / metersPerDegLat();
  const dLon = widthM / 2 / metersPerDegLon(center.lat);
  return {
    north: center.lat + dLat,
    south: center.lat - dLat,
    east: center.lon + dLon,
    west: center.lon - dLon,
  };
}

/** 範囲をズームzのピクセル矩形に変換 */
export function boundsToPixels(bounds, z) {
  return {
    left: lonToPx(bounds.west, z),
    right: lonToPx(bounds.east, z),
    top: latToPy(bounds.north, z),
    bottom: latToPy(bounds.south, z),
  };
}

/** ピクセル矩形を覆うタイル番号の範囲 */
export function tileRange(px) {
  return {
    x0: Math.floor(px.left / TILE_SIZE),
    x1: Math.floor((px.right - 1e-9) / TILE_SIZE),
    y0: Math.floor(px.top / TILE_SIZE),
    y1: Math.floor((px.bottom - 1e-9) / TILE_SIZE),
  };
}

export function tileCount(range) {
  return (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
}

export { TILE_SIZE };
