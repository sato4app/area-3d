// 画面レイアウト：フローティングのコントロールパネルと、地図/3Dビューの境界（スプリッター）

const SPLIT_KEY = 'area3d.splitRatio';
const PANEL_KEY = 'area3d.panelCollapsed';
const MIN_PANE_PX = 120; // 地図・3Dビューの最小幅（高さ）

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
 */
export function setupCollapsible(panel, toggle, storageKey, onChange) {
  const setCollapsed = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '+' : '−';
    toggle.title = collapsed ? '開く' : '折りたたむ';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    save(storageKey, collapsed ? '1' : '0');
    onChange?.();
  };
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));

  // 狭い画面では最初は折りたたんでおく
  const saved = load(storageKey);
  setCollapsed(saved !== null ? saved === '1' : window.innerWidth < 600);
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
 * 地図と3Dビューの境界をドラッグで移動
 * @param {HTMLElement} splitter
 * @param {HTMLElement} views 2つのペインを並べた親要素
 * @param {HTMLElement} firstPane 左（縦並び時は上）のペイン
 */
export function setupSplitter(splitter, views, firstPane) {
  const isVertical = () => getComputedStyle(views).flexDirection === 'column';

  const applyRatio = (ratio) => {
    firstPane.style.flex = `0 0 ${(ratio * 100).toFixed(2)}%`;
  };

  const savedRatio = parseFloat(load(SPLIT_KEY));
  applyRatio(Number.isFinite(savedRatio) ? savedRatio : 0.5);

  let dragId = null;
  splitter.addEventListener('pointerdown', (e) => {
    dragId = e.pointerId;
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('dragging');
    document.body.classList.add('resizing');
    document.body.classList.toggle('vertical', isVertical());
    e.preventDefault();
  });
  splitter.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    const rect = views.getBoundingClientRect();
    const vertical = isVertical();
    const total = vertical ? rect.height : rect.width;
    const pos = vertical ? e.clientY - rect.top : e.clientX - rect.left;
    const splitterSize = vertical ? splitter.offsetHeight : splitter.offsetWidth;
    const min = Math.min(MIN_PANE_PX, total / 2);
    const clamped = Math.min(Math.max(pos, min), total - min - splitterSize);
    applyRatio(clamped / total);
  });
  const endDrag = (e) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    splitter.classList.remove('dragging');
    document.body.classList.remove('resizing', 'vertical');
    save(SPLIT_KEY, String(parseFloat(firstPane.style.flexBasis) / 100));
  };
  splitter.addEventListener('pointerup', endDrag);
  splitter.addEventListener('pointercancel', endDrag);

  // ダブルクリックで半分に戻す
  splitter.addEventListener('dblclick', () => {
    applyRatio(0.5);
    save(SPLIT_KEY, '0.5');
  });
}
