// PWA：サービスワーカーの登録（ホーム画面への追加・オフラインでの起動に必要）と、更新の確認
// バージョンは service-worker.js の CACHE_VERSION だけで定義している（"yyyy-mm-dd.n" 形式）

const SW_URL = './service-worker.js';

/** サービスワーカーを使える環境か（file:// や、https でないサイトでは使えない） */
function swAvailable() {
  return 'serviceWorker' in navigator && (location.protocol === 'https:' || location.protocol === 'http:');
}

/** ページを開いた時点で動いていたバージョン（このページの中身のバージョン） */
let loadedVersionPromise = null;

export function registerServiceWorker() {
  if (!swAvailable()) return;
  // サービスワーカー経由で開いたなら、そのサービスワーカーのバージョン。
  // 初めて開いた（まだサービスワーカーが無い）ときは、サーバーから直接取ったので最新版
  const controller = navigator.serviceWorker.controller;
  loadedVersionPromise = controller ? askVersion(controller) : fetchLatestVersion().catch(() => null);

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SW_URL).catch((e) => {
      console.warn('サービスワーカーを登録できませんでした', e);
    });
  });
}

/**
 * いま使っているバージョン。分からなければ null
 * （サービスワーカーが使えない環境では、サーバーのファイルから読み取る）
 */
export async function getCurrentVersion() {
  if (loadedVersionPromise) return loadedVersionPromise;
  return fetchLatestVersion().catch(() => null);
}

/** サーバーに公開されている最新のバージョン（つながらなければ例外） */
export async function fetchLatestVersion() {
  // ?latest を付けるとサービスワーカーはキャッシュを使わずサーバーへ取りに行く
  const res = await fetch(`${SW_URL}?latest=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const m = (await res.text()).match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('CACHE_VERSION が見つかりません');
  return m[1];
}

/** 更新の確認・適用ができる環境か */
export function canUpdate() {
  return swAvailable();
}

/**
 * 最新版に更新してページを読み込み直す。
 * 新しいサービスワーカーを入れ（すぐ有効になる）、切り替わったら再読み込み
 */
export async function applyUpdate() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) {
    const switched = new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      setTimeout(resolve, 10000); // 切り替わりが確認できなくても10秒で読み込み直す
    });
    await reg.update();
    // 新しいサービスワーカーを入れている最中なら、切り替わるのを待つ
    if (reg.installing || reg.waiting) await switched;
  }
  location.reload();
}

/** サービスワーカーにバージョンを問い合わせる（答えが無ければ null） */
function askVersion(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(typeof e.data === 'string' ? e.data : null);
    };
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });
}
