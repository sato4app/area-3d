// アプリ全体の設定値

// QRコード作成ライブラリ（「このアプリについて」のQRコードタブを開いたときに読み込む）
export const QR_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

// 初期表示位置（箕面大滝）
export const DEFAULT_CENTER = { lat: 34.853667, lon: 135.472041 };
export const DEFAULT_SIZE = { width: 300, height: 300 };
export const SIZE_LIMIT = { min: 100, max: 20000 };

const GSI_XYZ = 'https://cyberjapandata.gsi.go.jp/xyz';

// 3Dの地表に貼る地図（国土地理院タイル）
export const MAP_LAYERS = {
  std:           { name: '標準地図',     url: `${GSI_XYZ}/std/{z}/{x}/{y}.png`,           maxZoom: 18 },
  pale:          { name: '淡色地図',     url: `${GSI_XYZ}/pale/{z}/{x}/{y}.png`,          maxZoom: 18 },
  seamlessphoto: { name: '写真',         url: `${GSI_XYZ}/seamlessphoto/{z}/{x}/{y}.jpg`, maxZoom: 18 },
  relief:        { name: '色別標高図',   url: `${GSI_XYZ}/relief/{z}/{x}/{y}.png`,        maxZoom: 15 },
  hillshademap:  { name: '陰影起伏図',   url: `${GSI_XYZ}/hillshademap/{z}/{x}/{y}.png`,  maxZoom: 16 },
};

// 標高タイル（PNG形式）
export const DEM_LAYERS = {
  dem1a:  { label: '1m',  url: `${GSI_XYZ}/dem1a_png/{z}/{x}/{y}.png`, zoom: 17 }, // 1mメッシュ（レーザ測量）
  dem5a:  { label: '5m',  url: `${GSI_XYZ}/dem5a_png/{z}/{x}/{y}.png`, zoom: 15 }, // 5mメッシュ（レーザ測量）
  dem10b: { label: '10m', url: `${GSI_XYZ}/dem_png/{z}/{x}/{y}.png`,   zoom: 14 }, // 10mメッシュ
};

// 標高データの選択肢ごとの取得順（先頭が基本、データの無い所を後ろのデータで補完）
export const DEM_CHAINS = {
  dem1a:  ['dem1a', 'dem5a', 'dem10b'],
  dem5a:  ['dem5a', 'dem10b'],
  dem10b: ['dem10b'],
};

// 1mメッシュを使える領域の最大サイズ(m)（横・縦とも）
// 3Dメッシュの分割数の上限(512)で1m間隔を保てるのは500m程度まで
export const DEM1A_MAX_SIZE = 500;

// タイル取得の上限（サーバー負荷・メモリ対策）
export const MAX_TEXTURE_TILES = 256;
export const MAX_DEM_TILES = 150;
export const FETCH_CONCURRENCY = 8;

// 取得したタイルをメモリに取っておく量の上限(バイト。PNG/JPEGの圧縮されたままの大きさで数える)
// 中心点を少し動かして作り直すとき、重なる部分のタイルを取り直さずに済む
// 1回の3D表示で使うのは多くても十数MB(地図・重ね地図とも上限256枚)なので、直前の領域分は収まる
export const TILE_CACHE_BYTES = 40 * 1024 * 1024;

// 3Dメッシュの1辺あたりの最大分割数
export const MAX_GRID_SEGMENTS = 512;

// 3D描画の解像度の上限（画面密度の倍率）
// 高精細なスマホ（3倍など）でも2倍までに抑え、描く画素数を減らして電池の消費・発熱を抑える
export const MAX_PIXEL_RATIO = 2;

export const GSI_SEARCH_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=';
