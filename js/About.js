// 「このアプリについて」パネル：使い方・よくある質問・バージョン情報・QRコードを縦に並べ、見出しのタップで開閉
// （パネル自体の折りたたみ・移動は Layout.js で、ほかのパネルと同じように行う）

import { QR_LIB_URL } from './config.js';
import { getCurrentVersion, fetchLatestVersion, canUpdate, applyUpdate } from './pwa.js';

/**
 * @param {HTMLElement} root パネル
 */
export function setupAbout(root) {
  const $ = (sel) => root.querySelector(sel);

  // バージョン情報は開くたびに、更新版が無いか確認する
  $('.about-item[data-item="version"]').addEventListener('toggle', (e) => {
    if (e.currentTarget.open) checkVersion(root);
  });

  // QRコードは開いたときに作る
  $('.about-item[data-item="qr"]').addEventListener('toggle', (e) => {
    if (e.currentTarget.open) showQr(root);
  });

  $('#qrCopy').addEventListener('click', async () => {
    const button = $('#qrCopy');
    try {
      await navigator.clipboard.writeText($('#qrUrl').value);
      button.textContent = 'コピー済み';
    } catch {
      $('#qrUrl').select(); // クリップボードが使えないときは選択だけして手動でコピーしてもらう
      button.textContent = '選択しました';
    }
    setTimeout(() => (button.textContent = 'コピー'), 1500);
  });
}

let checking = false;

/**
 * いまのバージョンを表示し、サーバーに新しい版が無いか確認する。
 * 新しい版があれば、更新するかどうかの確認を出す（キャンセルしても、開き直せばまた確認する）
 * （バージョンは service-worker.js の CACHE_VERSION だけで定義。"yyyy-mm-dd.n" 形式）
 */
async function checkVersion(root) {
  if (checking) return;
  checking = true;
  const versionEl = root.querySelector('#appVersion');
  const statusEl = root.querySelector('#updateStatus');
  versionEl.textContent = '確認中…';
  statusEl.textContent = '更新版を確認中…';

  try {
    const current = await getCurrentVersion();
    versionEl.textContent = current ?? '不明';

    if (!canUpdate()) {
      statusEl.textContent = 'この開き方では更新の確認はできません。';
      return;
    }

    let latest;
    try {
      latest = await fetchLatestVersion();
    } catch (e) {
      console.warn('更新版を確認できませんでした', e);
      statusEl.textContent = '確認できませんでした（インターネット接続を確認してください）。';
      return;
    }

    // いまのバージョンが分からない（null）ときは、バージョンを答えられない古い版で動いているので更新を勧める
    if (current === latest) {
      statusEl.textContent = '最新版です。';
      return;
    }
    statusEl.textContent = `新しいバージョン ${latest} があります。`;
    const now = current ? `いまのバージョン：${current}\n` : '';
    if (!confirm(`新しいバージョンがあります。\n\n${now}新しいバージョン：${latest}\n\n更新しますか？（ページを読み込み直します）`)) {
      return;
    }
    statusEl.textContent = '更新中…';
    try {
      await applyUpdate(); // 成功すればページが読み込み直される
    } catch (e) {
      console.warn('更新できませんでした', e);
      statusEl.textContent = '更新できませんでした（インターネット接続を確認してください）。';
    }
  } finally {
    checking = false;
  }
}

/** このアプリのURL（検索条件やページ内リンクは除く） */
function appUrl() {
  return location.origin + location.pathname;
}

/** パソコンの中だけで開いているアドレス（ほかの端末からは開けない）か */
function isLocalAddress() {
  return location.protocol === 'file:' || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname);
}

let qrDrawn = false;

async function showQr(root) {
  const box = root.querySelector('#qrBox');
  root.querySelector('#qrUrl').value = appUrl();
  root.querySelector('#qrNote').hidden = !isLocalAddress();
  if (qrDrawn) return;

  box.textContent = 'QRコードを作成中…';
  try {
    await loadQrLib();
    const qr = window.qrcode(0, 'M'); // 型番は自動、誤り訂正レベル M
    qr.addData(appUrl());
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
    box.querySelector('svg')?.setAttribute('aria-label', 'このアプリのURLのQRコード');
    qrDrawn = true;
  } catch (e) {
    console.error(e);
    box.textContent = 'QRコードを作成できませんでした（インターネット接続を確認してください）。下のURLをお使いください。';
  }
}

let qrLibPromise = null;

/** QRコード作成ライブラリを必要になったときだけ読み込む */
function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  qrLibPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QR_LIB_URL;
    s.onload = () => (window.qrcode ? resolve() : reject(new Error('qrcode が見つかりません')));
    s.onerror = () => {
      qrLibPromise = null; // 次に開いたとき再挑戦できるように
      s.remove();
      reject(new Error('QRコードのライブラリを読み込めませんでした'));
    };
    document.head.appendChild(s);
  });
  return qrLibPromise;
}
