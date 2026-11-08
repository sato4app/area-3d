// GeoJSONファイルの読み込みと2D地図への表示

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
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('JSONとして読み込めませんでした。');
    }
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
      throw new Error('GeoJSONの形式ではありません。');
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
      throw new Error('GeoJSONの座標データが正しくありません。');
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
