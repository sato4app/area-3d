// 画面レイアウト：フローティングのコントロールパネルと、地図/3Dビューの切り替え

const PANEL_KEY = 'area3d.panelCollapsed';

// localStorage は使えない環境もあるので必ず try/catch で囲む
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 保存できなくても動作に支障なし */ }
}

/**
 * フローティングのパネル群（縦に積んだ複数パネル）：どのパネルの見出しをドラッグしてもまとめて移動
 * @param {HTMLElement} stack 移動させる要素（パネルを縦に並べた入れ物）
 * @param {HTMLElement[]} headers ドラッグ用の見出し（先頭が一番上のパネル）
 * @param {HTMLElement} container パネルを動かせる範囲
 * @returns {() => void} 位置を範囲内に収め直す関数（パネルの大きさが変わったときに呼ぶ）
 */
export function setupDraggable(stack, headers, container) {
  let drag = null;
  for (const header of headers) {
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      drag = {
        id: e.pointerId,
        dx: e.clientX - stack.offsetLeft,
        dy: e.clientY - stack.offsetTop,
      };
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    header.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      moveTo(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    const endDrag = (e) => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
  }

  // はみ出さないように位置を制限（一番上の見出しは必ず画面内に残す）
  function moveTo(left, top) {
    const maxLeft = Math.max(0, container.clientWidth - stack.offsetWidth);
    const maxTop = Math.max(0, container.clientHeight - headers[0].offsetHeight);
    stack.style.left = `${Math.min(Math.max(left, 0), maxLeft)}px`;
    stack.style.top = `${Math.min(Math.max(top, 0), maxTop)}px`;
  }
  function clamp() {
    moveTo(stack.offsetLeft, stack.offsetTop);
  }
  new ResizeObserver(clamp).observe(container);
  return clamp;
}

/**
 * パネルの折りたたみ（状態はブラウザに記憶）
 * @param {HTMLElement} panel
 * @param {HTMLButtonElement} toggle 折りたたみボタン
 * @param {string} storageKey 状態を記憶するキー
 * @param {() => void} [onChange] 開閉したときに呼ぶ
 * @param {boolean} [defaultCollapsed] 記憶が無いとき閉じておくか（省略時は狭い画面のときだけ閉じる）
 */
export function setupCollapsible(panel, toggle, storageKey, onChange, defaultCollapsed) {
  const setCollapsed = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '+' : '−';
    toggle.title = collapsed ? '開く' : '折りたたむ';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    save(storageKey, collapsed ? '1' : '0');
    onChange?.();
  };
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));

  // 記憶が無ければ、指定どおり（指定が無ければ狭い画面のときだけ）折りたたんでおく
  const saved = load(storageKey);
  setCollapsed(saved !== null ? saved === '1' : (defaultCollapsed ?? window.innerWidth < 600));
}

/** Area3D パネルの折りたたみ状態を記憶するキー */
export const MAIN_PANEL_KEY = PANEL_KEY;

/**
 * パネル群が地図の左側を覆っている幅(px)。地図の表示範囲をずらすのに使う
 * （すべてのパネルが折りたたまれていれば 0）
 */
export function panelOverlapLeft(stack, mapElement) {
  if (!stack.querySelector('.panel:not(.collapsed)')) return 0;
  const p = stack.getBoundingClientRect();
  const m = mapElement.getBoundingClientRect();
  if (p.bottom < m.top || p.top > m.bottom || p.left > m.left + m.width / 2) return 0;
  // 地図が狭いときは寄せすぎない
  return Math.min(Math.max(0, p.right - m.left), m.width * 0.6);
}

/**
 * 地図と3Dビューの切り替え（同じ場所に重ねて置き、片方だけを表示）
 * 切り替えるたびに views で 'viewchange' イベント（detail: '2d' | '3d'）を出す
 * @param {HTMLButtonElement} button 切り替えボタン（地図表示中は「3D」、3D表示中は「2D」）
 * @param {HTMLElement} views 2つのビューを重ねた親要素
 * @param {() => boolean} [onRequest3d] 地図表示中にボタンが押されたとき先に呼ぶ。
 *   true を返したら、そちらで3D表示を引き受けた（作り直してから切り替える）ものとして、ここでは切り替えない
 * @returns {(mode: '2d' | '3d') => void} 表示を切り替える関数
 */
export function setupViewSwitch(button, views, onRequest3d) {
  const setMode = (mode) => {
    const is3d = mode === '3d';
    views.classList.toggle('show-3d', is3d);
    button.textContent = is3d ? '2D' : '3D';
    button.title = is3d ? '地図表示に戻る' : '3D表示に切り替え';
    button.classList.toggle('is-3d', is3d);
    // 念のためページのずれを戻す（iPhone の Safari でページ全体がずれて右上のボタンが隠れることがあるため）
    window.scrollTo(0, 0);
    views.dispatchEvent(new CustomEvent('viewchange', { detail: mode }));
  };
  button.addEventListener('click', () => {
    if (views.classList.contains('show-3d')) {
      setMode('2d');
    } else if (!onRequest3d?.()) {
      setMode('3d');
    }
  });
  setMode('2d');
  return setMode;
}
