// area-3d メイン：UIと各モジュールの連携

import { DEFAULT_CENTER, DEFAULT_SIZE, SIZE_LIMIT, DEM1A_MAX_SIZE, MAP_LAYERS, GSI_SEARCH_URL } from './config.js';
import { MapSelector } from './MapSelector.js';
import { TerrainViewer } from './TerrainViewer.js';
import { Compass } from './Compass.js';
import { metersPerDegLat, metersPerDegLon } from './geo.js';
import { buildTerrain } from './TerrainBuilder.js';
import { GeoJsonLayers } from './GeoJsonLayers.js';
import { drawGeoJsonCanvas, collectPoints, pointRadiusMeters } from './GeoJsonDrape.js';
import { setupDraggable, setupCollapsible, setupViewSwitch, panelOverlapLeft, MAIN_PANEL_KEY } from './Layout.js';
import { setupAbout } from './About.js';
import { registerServiceWorker } from './pwa.js';

registerServiceWorker();

const $ = (id) => document.getElementById(id);

const PAN_RATIO = 0.2; // コンパスを1回押して動かす距離（領域の横・縦に対する割合）
const DEG = Math.PI / 180;

// ---------- レイアウト ----------
// 地図と3Dビューは右上のボタンで切り替え
// 地図表示中に押したとき、中心点・領域サイズが3Dと変わっていれば（まだ3Dが無ければ）作り直してから3Dにする
const setViewMode = setupViewSwitch($('viewToggle'), $('views'), () => {
  if (!needsRebuild()) return false;
  build({ keepView: true });
  return true;
});
// 「指定領域の3D表示」「ファイル読み込み」「このアプリについて」の3つのパネルはまとめて移動（上から順）
const clampPanels = setupDraggable(
  $('panelStack'),
  [$('panelHeader'), $('filePanelHeader'), $('aboutPanelHeader')],
  $('appBody'),
);
setupCollapsible($('panel'), $('panelToggle'), MAIN_PANEL_KEY, clampPanels);
setupCollapsible($('filePanel'), $('filePanelToggle'), 'area3d.filePanelCollapsed', clampPanels);
// 「このアプリについて」は最初は閉じておく
setupCollapsible($('aboutPanel'), $('aboutPanelToggle'), 'area3d.aboutPanelCollapsed', clampPanels, true);
setupAbout($('aboutPanel'));

const els = {
  lat: $('lat'),
  lon: $('lon'),
  width: $('width'),
  height: $('height'),
  layer: $('layer'),
  overlay: $('overlay'),
  overlayOpacity: $('overlayOpacity'),
  overlayOpacityOut: $('overlayOpacityOut'),
  dem: $('dem'),
  demHint: $('demHint'),
  texSize: $('texSize'),
  buildBtn: $('buildBtn'),
  exag: $('exag'),
  exagOut: $('exagOut'),
  resetViewBtn: $('resetViewBtn'),
  shotBtn: $('shotBtn'),
  info: $('info'),
  progress: $('progress'),
  placeholder: $('placeholder'),
  hover: $('hover'),
  searchForm: $('searchForm'),
  searchInput: $('searchInput'),
  searchResults: $('searchResults'),
  markerPopup: $('markerPopup'),
  markerPopupName: $('markerPopupName'),
  markerPopupClose: $('markerPopupClose'),
  sizeBar: $('sizeBar'),
  sizeSlider: $('sizeSlider'),
  sizeOut: $('sizeOut'),
  geojsonInput: $('geojsonInput'),
  fileList: $('fileList'),
};

// ---------- 初期化 ----------
for (const [key, layer] of Object.entries(MAP_LAYERS)) {
  els.layer.add(new Option(layer.name, key));
  els.overlay.add(new Option(layer.name, key));
}
els.lat.value = DEFAULT_CENTER.lat.toFixed(6);
els.lon.value = DEFAULT_CENTER.lon.toFixed(6);
els.width.value = DEFAULT_SIZE.width;
els.height.value = DEFAULT_SIZE.height;

const mapSelector = new MapSelector(
  'map',
  DEFAULT_CENTER,
  // 中心点の変更 → パネルの緯度・経度を更新
  (c) => {
    els.lat.value = c.lat.toFixed(6);
    els.lon.value = c.lon.toFixed(6);
  },
  // 頂点ドラッグでのサイズ変更 → パネルの横・縦を更新
  (s) => {
    els.width.value = s.width;
    els.height.value = s.height;
    updateDemChoices();
  },
);
mapSelector.setSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
fitMapToArea();

const viewer = new TerrainViewer($('viewer'));
// 3Dビューが表示されている間だけ描画する（地図表示中は止めて電池の消費を抑える）
$('views').addEventListener('viewchange', (e) => viewer.setActive(e.detail === '3d'));
viewer.setActive($('views').classList.contains('show-3d'));
viewer.setOverlayOpacity(readOverlayOpacity());
viewer.onHover = (h) => {
  if (!h) {
    els.hover.classList.add('hidden');
    return;
  }
  els.hover.textContent = `標高 ${h.elevation.toFixed(1)} m　(${h.lat.toFixed(5)}, ${h.lon.toFixed(5)})`;
  els.hover.classList.remove('hidden');
};
// コンパス：視点を回すたびに画面の上の方角へ合わせる。
// 押すと、押した位置の方向（画面上の向き）へ中心点を移動する
const compass = new Compass($('compass'), (angle) => moveCenter(angle));
viewer.onHeadingChange = (deg) => compass.setHeading(deg);

// ---------- 入力値 ----------
function readCenter() {
  const lat = parseFloat(els.lat.value);
  const lon = parseFloat(els.lon.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function readSize() {
  const w = parseFloat(els.width.value);
  const h = parseFloat(els.height.value);
  const ok = (v) => Number.isFinite(v) && v >= SIZE_LIMIT.min && v <= SIZE_LIMIT.max;
  if (!ok(w) || !ok(h)) return null;
  return { width: w, height: h };
}

for (const el of [els.lat, els.lon]) {
  el.addEventListener('change', () => {
    const c = readCenter();
    if (c) mapSelector.setCenter(c, true);
  });
}

for (const el of [els.width, els.height]) {
  el.addEventListener('change', () => {
    const s = readSize();
    if (!s) {
      alert(`サイズは ${SIZE_LIMIT.min}〜${SIZE_LIMIT.max} m の範囲で指定してください。`);
      return;
    }
    mapSelector.setSize(s.width, s.height);
    fitMapToArea();
    updateDemChoices();
  });
}

// 1mメッシュは小さい領域（横・縦とも DEM1A_MAX_SIZE 以下）のときだけ選べる
function canUseDem1a(size) {
  return !!size && size.width <= DEM1A_MAX_SIZE && size.height <= DEM1A_MAX_SIZE;
}

function updateDemChoices() {
  const ok = canUseDem1a(readSize());
  els.dem.querySelector('option[value="dem1a"]').disabled = !ok;
  // 1mメッシュを選んでいて領域が大きくなったら5mメッシュに戻す
  const switched = !ok && els.dem.value === 'dem1a';
  if (switched) els.dem.value = 'dem5a';
  els.demHint.classList.toggle('warn', switched);
  els.demHint.textContent = switched
    ? `領域が${DEM1A_MAX_SIZE}mを超えたため、標高データを5mメッシュに切り替えました。`
    : `1mメッシュは領域が横・縦とも${DEM1A_MAX_SIZE}m以下のときだけ選べます。`;
}
els.dem.addEventListener('change', updateDemChoices); // 切り替えの注意表示を消す
updateDemChoices();

els.layer.addEventListener('change', () => mapSelector.setBaseLayer(els.layer.value));

function readOverlayOpacity() {
  return parseInt(els.overlayOpacity.value, 10) / 100;
}

els.overlay.addEventListener('change', () => {
  mapSelector.setOverlayLayer(els.overlay.value, readOverlayOpacity());
});

// 濃さは2D地図・3Dビューの両方に即時反映
els.overlayOpacity.addEventListener('input', () => {
  const v = readOverlayOpacity();
  els.overlayOpacityOut.textContent = Math.round(v * 100);
  mapSelector.setOverlayOpacity(v);
  viewer.setOverlayOpacity(v);
});

// 中心点の移動：表示中の領域の20%だけ、コンパスで押した方向へずらして3Dを作り直す（視点の向きはそのまま）
// 東西方向は横幅の20%、南北方向は縦幅の20%を基準に、斜めはその楕円上の距離で動かす
/** @param {number} screenAngle 画面上の向き（度。上=0、右=90） */
function moveCenter(screenAngle) {
  const t = viewer.terrain;
  if (!t || building) return;
  const az = DEG * (viewer.heading() + screenAngle); // 地図上の方位角（北=0、東=90）
  const dLat = (Math.cos(az) * t.height * PAN_RATIO) / metersPerDegLat();
  const dLon = (Math.sin(az) * t.width * PAN_RATIO) / metersPerDegLon(t.center.lat);
  const c = { lat: t.center.lat + dLat, lon: t.center.lon + dLon };
  if (Math.abs(c.lat) > 85) return;
  c.lon = ((c.lon + 540) % 360) - 180; // 経度±180度をまたいだとき
  els.lat.value = c.lat.toFixed(6);
  els.lon.value = c.lon.toFixed(6);
  mapSelector.setCenter(c);
  fitMapToArea();
  build({ keepView: true });
}

/**
 * ［3D］ボタンで作り直すか：まだ3Dが無いか、パネルの中心点・領域サイズが表示中の3Dと違うとき
 * （地図の種類・標高データなど、ほかの設定の変更では作り直さない。それは「3D表示」ボタンで行う）
 * 作り直し中は、終われば3Dになるので作り直さない
 */
function needsRebuild() {
  const t = viewer.terrain;
  if (building) return false;
  if (!t) return true;
  const c = readCenter();
  if (!c) return true; // 入力が正しくなければ build() で知らせる
  const EPS = 1e-7; // 度（パネルは小数6桁なので、それより細かい差は同じ場所とみなす）
  return Math.abs(c.lat - t.center.lat) > EPS || Math.abs(c.lon - t.center.lon) > EPS || !sameSizeAsTerrain();
}

/** パネルの領域サイズが表示中の3Dと同じか */
function sameSizeAsTerrain() {
  const t = viewer.terrain;
  const s = readSize();
  return !!t && !!s && s.width === t.width && s.height === t.height;
}

// ---------- 3Dビュー下部の一辺のサイズ（正方形） ----------
// 100m〜20kmを均等に刻むと小さい領域で細かく選べないので、切りのよい値を段階で選ぶ
const SIDE_STEPS = [100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000, 15000, 20000];
els.sizeSlider.max = SIDE_STEPS.length - 1;

function formatSide(m) {
  return m >= 1000 ? `${m / 1000} km` : `${m} m`;
}

/** スライダーを表示中の3Dに合わせる（正方形でなければ長い方の辺に近い段階に置き、表示は横×縦） */
function syncSizeSlider() {
  const t = viewer.terrain;
  if (!t) return;
  const side = Math.max(t.width, t.height);
  let best = 0;
  for (let i = 1; i < SIDE_STEPS.length; i++) {
    if (Math.abs(Math.log(SIDE_STEPS[i] / side)) < Math.abs(Math.log(SIDE_STEPS[best] / side))) best = i;
  }
  els.sizeSlider.value = best;
  els.sizeOut.textContent = t.width === t.height ? formatSide(t.width) : `${formatSide(t.width)} × ${formatSide(t.height)}`;
}

// 動かしている間は値だけ表示し、指を離したら縦横とも同じ長さ（正方形）にして作り直す
els.sizeSlider.addEventListener('input', () => {
  els.sizeOut.textContent = formatSide(SIDE_STEPS[els.sizeSlider.value]);
});
els.sizeSlider.addEventListener('change', () => {
  const side = SIDE_STEPS[els.sizeSlider.value];
  const t = viewer.terrain;
  if (!t || building || (t.width === side && t.height === side)) return syncSizeSlider();
  els.width.value = side;
  els.height.value = side;
  mapSelector.setSize(side, side);
  fitMapToArea();
  updateDemChoices(); // 1mメッシュで500mを超えたら5mメッシュに切り替える
  build({ keepView: true });
});

// ---------- 3D表示 ----------
let building = false;
els.buildBtn.addEventListener('click', () => build());

/**
 * パネルの指定で3Dを作る
 * @param {{keepView?: boolean}} [opts] keepView: 視点の向き・距離を変えない（中心点の移動時）
 */
async function build(opts = {}) {
  if (building) return;
  const center = readCenter();
  const size = readSize();
  if (!center) return alert('中心点の緯度・経度を正しく入力してください。');
  if (!size) return alert(`サイズは ${SIZE_LIMIT.min}〜${SIZE_LIMIT.max} m の範囲で指定してください。`);
  if (els.dem.value === 'dem1a' && !canUseDem1a(size)) {
    return alert(`1mメッシュは領域が横・縦とも ${DEM1A_MAX_SIZE} m 以下のときだけ使えます。`);
  }

  building = true;
  compass.setBusy(true);
  els.sizeSlider.disabled = true;
  els.buildBtn.disabled = true;
  els.placeholder.classList.add('hidden');
  setViewMode('3d'); // 作成の進み具合が見えるように先に3Dへ切り替える
  showProgress('準備中…');
  try {
    const terrain = await buildTerrain(
      {
        center,
        width: size.width,
        height: size.height,
        dem: els.dem.value,
        mapLayer: MAP_LAYERS[els.layer.value],
        overlayLayer: els.overlay.value ? MAP_LAYERS[els.overlay.value] : null,
        texSize: parseInt(els.texSize.value, 10),
      },
      showProgress,
    );
    showProgress('3Dモデル作成中…');
    await nextFrame();
    viewer.setTerrain(terrain, { keepView: opts.keepView });
    compass.setVisible(true);
    els.sizeBar.classList.remove('hidden');
    update3dGeoJson();
    showInfo(terrain);
  } catch (e) {
    console.error(e);
    alert(`3D表示に失敗しました。\n${e.message}`);
    if (!viewer.terrain) els.placeholder.classList.remove('hidden');
  } finally {
    hideProgress();
    building = false;
    compass.setBusy(false);
    els.sizeSlider.disabled = false;
    syncSizeSlider(); // 失敗したときは表示中の3Dの大きさに戻す
    els.buildBtn.disabled = false;
  }
}

els.exag.addEventListener('input', () => {
  const v = parseFloat(els.exag.value);
  els.exagOut.textContent = v.toFixed(1);
  viewer.setExaggeration(v);
});

els.resetViewBtn.addEventListener('click', () => viewer.resetView());

els.shotBtn.addEventListener('click', () => {
  if (!viewer.terrain) return;
  const a = document.createElement('a');
  a.href = viewer.screenshot();
  const { lat, lon } = viewer.terrain.center;
  a.download = `area3d_${lat.toFixed(4)}_${lon.toFixed(4)}.png`;
  a.click();
});

// ---------- ファイル読み込み（GeoJSON / GPX を2D地図に表示） ----------
const geojson = new GeoJsonLayers(mapSelector.map);

els.geojsonInput.addEventListener('change', async () => {
  const files = [...els.geojsonInput.files];
  els.geojsonInput.value = ''; // 同じファイルをもう一度選べるように
  const added = [];
  const errors = [];
  for (const file of files) {
    try {
      added.push(await geojson.addFile(file));
    } catch (e) {
      errors.push(`${file.name}：${e.message}`);
    }
  }
  renderFileList();
  update3dGeoJson();
  if (added.length > 0) {
    // 読み込んだファイル全体が見えるように地図を移動
    const bounds = L.latLngBounds([]);
    for (const item of added) {
      const b = geojson.bounds(item.id);
      if (b) bounds.extend(b);
    }
    fitMapToBounds(bounds);
  }
  if (errors.length > 0) alert(`読み込めなかったファイルがあります。\n${errors.join('\n')}`);
});

function renderFileList() {
  hideMarkerPopup(); // ファイルの追加・削除でマーカーが変わるので閉じる
  els.fileList.innerHTML = '';
  for (const item of geojson.items) {
    const li = document.createElement('li');
    li.classList.toggle('off', !item.visible);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = item.visible;
    check.title = '表示／非表示';
    check.addEventListener('change', () => {
      geojson.setVisible(item.id, check.checked);
      hideMarkerPopup();
      li.classList.toggle('off', !check.checked);
      update3dGeoJson();
    });

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = item.color;

    const name = document.createElement('span');
    name.className = 'file-name';
    name.title = `${item.name}（クリックでこの範囲へ移動）`;
    const strong = document.createElement('strong');
    strong.textContent = item.name;
    const small = document.createElement('small');
    small.textContent = countText(item.counts);
    name.append(strong, small);
    name.addEventListener('click', () => fitMapToBounds(geojson.bounds(item.id)));

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '×';
    del.title = '地図から削除';
    del.addEventListener('click', () => {
      geojson.remove(item.id);
      renderFileList();
      update3dGeoJson();
    });

    li.append(check, swatch, name, del);
    els.fileList.appendChild(li);
  }
}

/** 表示中の GeoJSON を3Dの地表に描き直す（3D表示前は何もしない） */
function update3dGeoJson() {
  const t = viewer.terrain;
  if (!t) return;
  const visible = geojson.items.filter((i) => i.visible);
  viewer.setGeoJsonCanvas(drawGeoJsonCanvas(t.bounds, visible, t.texSize));
}

// ---------- 3Dのマーカー（GeoJSON の点）をタップして名称を表示 ----------
// マーカーは地表の画像に描いた丸印なので、各点の画面上の位置とタップ位置の近さで判定する
const TAP_TOLERANCE_PX = 22; // 指で押しやすいよう、丸印が小さく見えるときもこの距離までは当たりとする
const NAME_KEYS = ['name', '名称', 'title', 'タイトル', 'pointId', 'id'];
let popupPoint = null; // ポップアップを出している点

viewer.onTap = (x, y) => {
  const p = pickMarker(x, y);
  if (p) showMarkerPopup(p);
  else hideMarkerPopup();
};
// 視点を動かしても、ポップアップがマーカーに付いて動くように
viewer.onRender = () => positionMarkerPopup();
els.markerPopupClose.addEventListener('click', hideMarkerPopup);

/** タップ位置に一番近いマーカー（無ければ null） */
function pickMarker(x, y) {
  const t = viewer.terrain;
  if (!t) return null;
  const rMeters = pointRadiusMeters(t.width, t.height);
  let best = null;
  for (const p of collectPoints(geojson.items.filter((i) => i.visible))) {
    const pos = viewer.surfacePoint(p.lat, p.lon);
    if (!pos) continue;
    const s = viewer.toScreen(pos);
    if (!s.visible) continue;
    // 丸印の画面上の半径（近づくと大きく見えるので、その分も当たりにする）
    const edge = viewer.toScreen(pos.clone().setX(pos.x + rMeters));
    const rPx = Math.hypot(edge.x - s.x, edge.y - s.y);
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= Math.max(TAP_TOLERANCE_PX, rPx + 4) && (!best || d < best.d)) best = { d, p };
  }
  return best?.p ?? null;
}

function markerName(props) {
  for (const key of NAME_KEYS) {
    const v = props[key];
    if (v !== null && v !== undefined && v !== '') return String(v);
  }
  return '（名称なし）';
}

function showMarkerPopup(p) {
  popupPoint = p;
  els.markerPopupName.textContent = markerName(p.properties);
  positionMarkerPopup();
}

function hideMarkerPopup() {
  popupPoint = null;
  els.markerPopup.classList.add('hidden');
}

function positionMarkerPopup() {
  if (!popupPoint) return;
  const pos = viewer.surfacePoint(popupPoint.lat, popupPoint.lon);
  if (!pos) return hideMarkerPopup(); // 中心点の移動などで領域の外に出た
  const s = viewer.toScreen(pos);
  els.markerPopup.classList.toggle('hidden', !s.visible);
  els.markerPopup.style.left = `${s.x}px`;
  els.markerPopup.style.top = `${s.y}px`;
}

function countText({ point, line, polygon }) {
  const parts = [];
  if (point) parts.push(`点 ${point}`);
  if (line) parts.push(`線 ${line}`);
  if (polygon) parts.push(`面 ${polygon}`);
  return parts.join('・');
}

// ---------- 地名検索（国土地理院 住所検索API） ----------
els.searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = els.searchInput.value.trim();
  if (!q) return;
  els.searchResults.innerHTML = '<li>検索中…</li>';
  try {
    const res = await fetch(GSI_SEARCH_URL + encodeURIComponent(q));
    const items = (await res.json()).slice(0, 20);
    els.searchResults.innerHTML = '';
    if (items.length === 0) {
      els.searchResults.innerHTML = '<li>見つかりませんでした</li>';
      return;
    }
    for (const item of items) {
      const [lon, lat] = item.geometry.coordinates;
      const li = document.createElement('li');
      li.textContent = item.properties.title;
      li.addEventListener('click', () => {
        const c = { lat, lon };
        els.lat.value = lat.toFixed(6);
        els.lon.value = lon.toFixed(6);
        mapSelector.setCenter(c);
        fitMapToArea();
      });
      els.searchResults.appendChild(li);
    }
  } catch (err) {
    console.error(err);
    els.searchResults.innerHTML = '<li>検索に失敗しました</li>';
  }
});

// ---------- 表示補助 ----------
function showProgress(msg) {
  els.progress.textContent = msg;
  els.progress.classList.remove('hidden');
}

function hideProgress() {
  els.progress.classList.add('hidden');
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function showInfo(t) {
  const rows = [
    ['中心', `${t.center.lat.toFixed(6)}, ${t.center.lon.toFixed(6)}`],
    ['範囲', `横 ${t.width} m × 縦 ${t.height} m`],
    ['最高標高', `${t.maxH.toFixed(1)} m`],
    ['最低標高', `${t.minH.toFixed(1)} m`],
    ['標高差', `${(t.maxH - t.minH).toFixed(1)} m`],
    ['標高データ', t.demUsed.join(' + ') || 'なし'],
    ['地図ズーム', t.overlayZoom ? `${t.textureZoom}（重ね地図 ${t.overlayZoom}）` : `${t.textureZoom}`],
    ['メッシュ', `${t.segX} × ${t.segY}`],
  ];
  if (t.missingRatio > 0) rows.push(['データ無し', `${(t.missingRatio * 100).toFixed(1)}%（0mで表示）`]);
  els.info.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

/** 領域全体が見えるように地図を合わせる（パネルに隠れる分だけ右へ寄せる） */
function fitMapToArea() {
  mapSelector.fitToArea(panelOverlapLeft($('panelStack'), $('map')));
}

/** 指定範囲が見えるように地図を合わせる（点1つなどで寄りすぎないよう最大ズーム16） */
function fitMapToBounds(bounds) {
  if (!bounds || !bounds.isValid()) return;
  mapSelector.fitToBounds(bounds, panelOverlapLeft($('panelStack'), $('map')), 16);
}
