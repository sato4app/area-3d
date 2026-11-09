// 「このアプリについて」パネル：使い方・よくある質問・バージョン情報・QRコードを縦に並べ、見出しのタップで開閉
// （パネル自体の折りたたみ・移動は Layout.js で、ほかのパネルと同じように行う）

import { QR_LIB_URL } from './config.js';

/**
 * @param {HTMLElement} root パネル
 */
export function setupAbout(root) {
  const $ = (sel) => root.querySelector(sel);

  showVersion($('#appVersion'));

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

/**
 * バージョンを表示する。バージョンは service-worker.js の CACHE_VERSION だけで定義しているので、
 * そのファイルを読んで取り出す（"yyyy-mm-dd.n" 形式）
 */
async function showVersion(el) {
  el.textContent = '確認中…';
  try {
    const text = await (await fetch('./service-worker.js', { cache: 'no-cache' })).text();
    const m = text.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (!m) throw new Error('CACHE_VERSION が見つかりません');
    el.textContent = m[1];
  } catch (e) {
    console.warn('バージョンを読み取れませんでした', e);
    el.textContent = '不明';
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
