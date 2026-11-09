// PWA：サービスワーカーの登録（ホーム画面への追加・オフラインでの起動に必要）

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// で開いたときは登録できない
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((e) => {
      console.warn('サービスワーカーを登録できませんでした', e);
    });
  });
}
