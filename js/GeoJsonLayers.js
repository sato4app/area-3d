// GeoJSON / GPX ファイルの読み込みと2D地図への表示

import { gpxToGeoJson } from './gpx.js';

// ファイルごとに順に割り当てる色（地図の赤枠 #d0302b と紛れない色）
const COLORS = ['#1f6feb', '#e8590c', '#7b2cbf', '#0b8f6a', '#c2255c', '#b08900', '#0c8599'];

export class GeoJsonLayers {
  /** @param {L.Map} map */
  constructor(map) {
    this.map = map;
    /** @type {{id:number, name:string, color:string, data:object, layer:L.GeoJSON, visible:boolean, counts:{point:number, line:number, polygon:number}}[]} */
    this.items = [];
    this._nextId = 1;
    this._colorIndex = 0;
  }

  /**
   * ファイルを読み込んで地図に追加する
   * @param {File} file
   * @returns {Promise<object>} 追加した項目
   */
  async addFile(file) {
    const text = await file.text();
    let data;
    if (isGpx(file, text)) {
      // GPX は GeoJSON に変換してから同じように表示する
      data = gpxToGeoJson(text);
    } else {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('JSONとして読み込めませんでした。');
      }
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
        throw new Error('GeoJSONの形式ではありません。');
      }
      data = connectRouteEnds(data);
    }

    const color = COLORS[this._colorIndex++ % COLORS.length];
    const counts = { point: 0, line: 0, polygon: 0 };
    let layer;
    try {
      layer = L.geoJSON(data, {
        // 点は丸いマーカー（中心点の青いピンと区別するため）
        pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 6 }),
        style: (feature) => featureStyle(feature, color),
        onEachFeature: (feature, l) => {
          countGeometry(feature.geometry, counts);
          const html = popupHtml(feature.properties);
          if (html) l.bindPopup(html, { maxWidth: 320 });
        },
      });
    } catch (e) {
      console.error(e);
      throw new Error('座標データが正しくありません。');
    }
    if (layer.getLayers().length === 0) {
      throw new Error('地図に表示できる地物がありません。');
    }

    layer.addTo(this.map);
    // data は3D表示（地表に描く画像）の作成に使う
    const item = { id: this._nextId++, name: file.name, color, data, layer, visible: true, counts };
    this.items.push(item);
    return item;
  }

  setVisible(id, visible) {
    const item = this._find(id);
    if (!item) return;
    item.visible = visible;
    if (visible) item.layer.addTo(this.map);
    else this.map.removeLayer(item.layer);
  }

  remove(id) {
    const item = this._find(id);
    if (!item) return;
    this.map.removeLayer(item.layer);
    this.items = this.items.filter((i) => i !== item);
  }

  /** 項目の範囲（L.LatLngBounds）。範囲が求められなければ null */
  bounds(id) {
    const b = this._find(id)?.layer.getBounds();
    return b && b.isValid() ? b : null;
  }

  _find(id) {
    return this.items.find((i) => i.id === id);
  }
}

/** GPX ファイルか（拡張子 .gpx、または中身が XML で始まる） */
function isGpx(file, text) {
  return /\.gpx$/i.test(file.name) || text.trimStart().startsWith('<');
}

/**
 * ルートの LineString を「開始点 → LineString の各点 → 終了点」の順につないだ線にする。
 * ルートデータでは coordinates に中間点だけが入り、開始点・終了点は properties に別に持っているため。
 *   - 座標：startPointGPS / endPointGPS（[経度, 緯度, 標高]）
 *   - 上記が無ければ：startPoint / endPoint の ID と一致する Point 地物（properties の id / pointId）
 * 開始点・終了点が座標列の端と同じ位置なら重ねて追加しない。元のデータは書き換えない
 */
function connectRouteEnds(data) {
  if (data.type !== 'FeatureCollection' && data.type !== 'Feature') return data;
  const features = data.type === 'FeatureCollection' ? data.features || [] : [data];

  // ID → Point の座標
  const pointById = new Map();
  for (const f of features) {
    if (f?.geometry?.type !== 'Point') continue;
    for (const key of ['id', 'pointId']) {
      const id = f.properties?.[key];
      if (id != null && id !== '' && !pointById.has(id)) pointById.set(id, f.geometry.coordinates);
    }
  }

  const endCoord = (p, gpsKey, idKey) => {
    if (isCoord(p[gpsKey])) return p[gpsKey];
    const byId = pointById.get(p[idKey]);
    return isCoord(byId) ? byId : null;
  };

  const fix = (f) => {
    if (f?.geometry?.type !== 'LineString' || !f.properties) return f;
    const start = endCoord(f.properties, 'startPointGPS', 'startPoint');
    const end = endCoord(f.properties, 'endPointGPS', 'endPoint');
    if (!start && !end) return f;
    const coords = [...(f.geometry.coordinates || [])];
    if (start && !samePos(start, coords[0])) coords.unshift(start);
    if (end && !samePos(end, coords[coords.length - 1])) coords.push(end);
    return { ...f, geometry: { ...f.geometry, coordinates: coords } };
  };

  return data.type === 'FeatureCollection' ? { ...data, features: features.map(fix) } : fix(data);
}

function isCoord(c) {
  return Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);
}

function samePos(a, b) {
  return isCoord(b) && a[0] === b[0] && a[1] === b[1];
}

/**
 * 地物の表示スタイル（2D地図・3D表示で共通）。
 * 線は線、面は塗りつぶした領域として表示する。
 * 地理院地図の作図データ（_color など）や simplestyle（stroke など）の指定があれば優先
 */
export function featureStyle(feature, color) {
  const p = feature.properties || {};
  const type = feature.geometry?.type;
  if (type === 'Point' || type === 'MultiPoint') {
    return {
      color: '#fff',
      weight: 2,
      fillColor: p._color || p['marker-color'] || color,
      fillOpacity: 1,
    };
  }
  const lineColor = p._color || p.stroke || color;
  return {
    color: lineColor,
    weight: num(p._weight ?? p['stroke-width'], 3),
    opacity: num(p._opacity ?? p['stroke-opacity'], 0.9),
    fillColor: p._fillColor || p.fill || lineColor,
    fillOpacity: num(p._fillOpacity ?? p['fill-opacity'], 0.3),
  };
}

function num(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 点・線・面の数を数える（Multi* は1件、GeometryCollection は中身ごとに数える） */
function countGeometry(geometry, counts) {
  if (!geometry) return;
  switch (geometry.type) {
    case 'Point':
    case 'MultiPoint':
      counts.point++;
      break;
    case 'LineString':
    case 'MultiLineString':
      counts.line++;
      break;
    case 'Polygon':
    case 'MultiPolygon':
      counts.polygon++;
      break;
    case 'GeometryCollection':
      for (const g of geometry.geometries || []) countGeometry(g, counts);
      break;
  }
}

/** 属性をポップアップ用の表にする（_ で始まる表示用の属性は除く） */
function popupHtml(props) {
  if (!props) return '';
  const rows = Object.entries(props).filter(
    ([k, v]) => !k.startsWith('_') && v !== null && v !== undefined && v !== '',
  );
  if (rows.length === 0) return '';
  return (
    '<table class="geojson-popup">' +
    rows
      .map(([k, v]) => {
        const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(value)}</td></tr>`;
      })
      .join('') +
    '</table>'
  );
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
