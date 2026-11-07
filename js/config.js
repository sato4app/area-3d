// アプリ全体の設定値

// 初期表示位置（箕面大滝）
export const DEFAULT_CENTER = { lat: 34.853667, lon: 135.472041 };
export const DEFAULT_SIZE = { width: 2000, height: 2000 };
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
  dem5a:  { url: `${GSI_XYZ}/dem5a_png/{z}/{x}/{y}.png`, zoom: 15 }, // 5mメッシュ（レーザ測量）
  dem10b: { url: `${GSI_XYZ}/dem_png/{z}/{x}/{y}.png`,   zoom: 14 }, // 10mメッシュ
};

// タイル取得の上限（サーバー負荷・メモリ対策）
export const MAX_TEXTURE_TILES = 256;
export const MAX_DEM_TILES = 150;
export const FETCH_CONCURRENCY = 8;

// 3Dメッシュの1辺あたりの最大分割数
export const MAX_GRID_SEGMENTS = 512;

export const GSI_SEARCH_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=';
