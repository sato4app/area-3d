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
 * フローティングパネル：見出しをドラッグで移動、ボタンで折りたたみ
 * @param {HTMLElement} panel
 * @param {HTMLElement} header ドラッグ用の見出し
 * @param {HTMLButtonElement} toggle 折りたたみボタン
 * @param {HTMLElement} container パネルを動かせる範囲
 */
export function setupFloatingPanel(panel, header, toggle, container) {
  // ---- 折りたたみ ----
  const setCollapsed = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '+' : '−';
    toggle.title = collapsed ? '開く' : '折りたたむ';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    save(PANEL_KEY, collapsed ? '1' : '0');
    clamp();
  };
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));

  // ---- ドラッグ移動 ----
  let drag = null;
  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = {
      id: e.pointerId,
      dx: e.clientX - panel.offsetLeft,
      dy: e.clientY - panel.offsetTop,
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

  // パネルがはみ出さないように位置を制限（見出しは必ず画面内に残す）
  function moveTo(left, top) {
    const maxLeft = Math.max(0, container.clientWidth - panel.offsetWidth);
    const maxTop = Math.max(0, container.clientHeight - header.offsetHeight);
    panel.style.left = `${Math.min(Math.max(left, 0), maxLeft)}px`;
    panel.style.top = `${Math.min(Math.max(top, 0), maxTop)}px`;
  }
  function clamp() {
    moveTo(panel.offsetLeft, panel.offsetTop);
  }
  new ResizeObserver(clamp).observe(container);

  // 狭い画面では最初は折りたたんでおく
  const saved = load(PANEL_KEY);
  setCollapsed(saved !== null ? saved === '1' : window.innerWidth < 600);
}

/**
 * パネルが地図の左側を覆っている幅(px)。地図の表示範囲をずらすのに使う
 */
export function panelOverlapLeft(panel, mapElement) {
  if (panel.classList.contains('collapsed')) return 0;
  const p = panel.getBoundingClientRect();
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
