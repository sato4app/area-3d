// area-3d メイン：UIと各モジュールの連携

import { DEFAULT_CENTER, DEFAULT_SIZE, SIZE_LIMIT, MAP_LAYERS, GSI_SEARCH_URL } from './config.js';
import { MapSelector } from './MapSelector.js';
import { TerrainViewer } from './TerrainViewer.js';
import { buildTerrain } from './TerrainBuilder.js';
import { setupFloatingPanel, setupSplitter, panelOverlapLeft } from './Layout.js';

const $ = (id) => document.getElementById(id);

// ---------- レイアウト ----------
setupSplitter($('splitter'), $('views'), $('mapView'));
setupFloatingPanel($('panel'), $('panelHeader'), $('panelToggle'), $('appBody'));

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

const mapSelector = new MapSelector('map', DEFAULT_CENTER, (c) => {
  els.lat.value = c.lat.toFixed(6);
  els.lon.value = c.lon.toFixed(6);
});
mapSelector.setSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
fitMapToArea();

const viewer = new TerrainViewer($('viewer'));
viewer.setOverlayOpacity(readOverlayOpacity());
viewer.onHover = (h) => {
  if (!h) {
    els.hover.classList.add('hidden');
    return;
  }
  els.hover.textContent = `標高 ${h.elevation.toFixed(1)} m　(${h.lat.toFixed(5)}, ${h.lon.toFixed(5)})`;
  els.hover.classList.remove('hidden');
};

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
  });
}

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

// ---------- 3D表示 ----------
els.buildBtn.addEventListener('click', async () => {
  const center = readCenter();
  const size = readSize();
  if (!center) return alert('中心点の緯度・経度を正しく入力してください。');
  if (!size) return alert(`サイズは ${SIZE_LIMIT.min}〜${SIZE_LIMIT.max} m の範囲で指定してください。`);

  els.buildBtn.disabled = true;
  els.placeholder.classList.add('hidden');
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
    viewer.setTerrain(terrain);
    showInfo(terrain);
  } catch (e) {
    console.error(e);
    alert(`3D表示に失敗しました。\n${e.message}`);
    if (!viewer.terrain) els.placeholder.classList.remove('hidden');
  } finally {
    hideProgress();
    els.buildBtn.disabled = false;
  }
});

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
    ['標高データ', t.demUsed.join(' + ')],
    ['地図ズーム', t.overlayZoom ? `${t.textureZoom}（重ね地図 ${t.overlayZoom}）` : `${t.textureZoom}`],
    ['メッシュ', `${t.segX} × ${t.segY}`],
  ];
  if (t.missingRatio > 0) rows.push(['データ無し', `${(t.missingRatio * 100).toFixed(1)}%（0mで表示）`]);
  els.info.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

/** 領域全体が見えるように地図を合わせる（パネルに隠れる分だけ右へ寄せる） */
function fitMapToArea() {
  mapSelector.fitToArea(panelOverlapLeft($('panel'), $('map')));
}
