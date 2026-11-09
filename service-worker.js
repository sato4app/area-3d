// Area3D のサービスワーカー
//   - アプリ本体（HTML・CSS・JS）：ネットワーク優先。つながらないときはキャッシュを使う（更新がすぐ反映されるように）
//   - ライブラリ（CDN）：キャッシュ優先（バージョン固定のURLなので中身は変わらない）
//   - 地理院タイル・住所検索：キャッシュしない（領域ごとに大量に取得するため、端末の容量を圧迫しないように）

// アプリのバージョン（「このアプリについて」にもこの値を表示する。定義はここだけ）
// 命名規則："yyyy-mm-dd.n"（yyyy-mm-dd は更新日、n はその日の1から始まる連番）
// アプリ本体を変えたときは必ず更新する（古いキャッシュが消え、新しいファイルが使われる）
const CACHE_VERSION = '2026-11-09.3';
const APP_CACHE = `area3d-app-${CACHE_VERSION}`;
const LIB_CACHE = 'area3d-lib-v1';

// 最初に保存しておくアプリ本体
const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './service-worker.js', // 「このアプリについて」でバージョンを読み取るため
  './css/style.css',
  './js/main.js',
  './js/config.js',
  './js/geo.js',
  './js/tiles.js',
  './js/TerrainBuilder.js',
  './js/TerrainViewer.js',
  './js/MapSelector.js',
  './js/GeoJsonLayers.js',
  './js/GeoJsonDrape.js',
  './js/gpx.js',
  './js/Layout.js',
  './js/About.js',
  './js/pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// 最初に保存しておくライブラリ（QRコードのライブラリは使ったときに保存）
const LIB_FILES = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js',
];

const LIB_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const app = await caches.open(APP_CACHE);
      await app.addAll(APP_FILES);
      // ライブラリは取れなくてもインストールは続ける（使ったときに保存される）
      const lib = await caches.open(LIB_CACHE);
      await Promise.all(LIB_FILES.map((url) => lib.add(url).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [APP_CACHE, LIB_CACHE];
      for (const key of await caches.keys()) {
        if (key.startsWith('area3d-') && !keep.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// ページからの問い合わせに、このサービスワーカーのバージョンを返す（更新の確認に使う）
self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage(CACHE_VERSION);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 更新の確認（最新版の取得）はキャッシュを使わず、必ずサーバーに問い合わせる
  if (url.origin === self.location.origin && url.searchParams.has('latest')) return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  }
  // それ以外（地理院タイル・住所検索など）はサービスワーカーを通さない
});

/** ネットワーク優先：取れたらキャッシュも更新、取れなければキャッシュ */
async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    // ブラウザの一時保存（HTTPキャッシュ）に古いファイルが残っていても使わず、サーバーに確かめる
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // ページの読み込みならトップページを返す
    if (req.mode === 'navigate') {
      const index = await cache.match('./index.html');
      if (index) return index;
    }
    throw e;
  }
}

/** キャッシュ優先：無ければ取ってきて保存 */
async function cacheFirst(req) {
  const cache = await caches.open(LIB_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
