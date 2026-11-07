// Leaflet による2D地図：中心点と領域の指定

import { MAP_LAYERS, SIZE_LIMIT } from './config.js';
import { computeBounds, metersPerDegLat, metersPerDegLon } from './geo.js';

const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>';

// 領域の4頂点（ドラッグでサイズ変更するハンドル）
const CORNERS = [
  { key: 'nw', lat: 'north', lon: 'west', cursor: 'nwse' },
  { key: 'ne', lat: 'north', lon: 'east', cursor: 'nesw' },
  { key: 'se', lat: 'south', lon: 'east', cursor: 'nwse' },
  { key: 'sw', lat: 'south', lon: 'west', cursor: 'nesw' },
];

export class MapSelector {
  /**
   * @param {string} elementId
   * @param {{lat:number, lon:number}} center
   * @param {(center:{lat:number, lon:number})=>void} onCenterChange 中心点が地図上で変更されたとき
   * @param {(size:{width:number, height:number})=>void} onSizeChange 頂点のドラッグでサイズが変更されたとき
   */
  constructor(elementId, center, onCenterChange, onSizeChange) {
    this.onCenterChange = onCenterChange;
    this.onSizeChange = onSizeChange;
    this.center = center;
    this.size = { width: 1000, height: 1000 };
    this._lastDragEnd = -Infinity;

    // 左上はコントロールパネルが重なるので、ズームボタンは右上に置く
    this.map = L.map(elementId, { zoomControl: false }).setView([center.lat, center.lon], 14);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    // 境界のドラッグなどで地図の大きさが変わったら再描画
    new ResizeObserver(() => this.map.invalidateSize()).observe(this.map.getContainer());
    this.baseLayer = null;
    this.overlayLayer = null;
    this.setBaseLayer('std');

    this.marker = L.marker([center.lat, center.lon], { draggable: true }).addTo(this.map);
    this.rect = L.rectangle(this._latLngBounds(), {
      color: '#d0302b',
      weight: 2,
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(this.map);

    this.corners = CORNERS.map((c) => this._createCornerHandle(c));
    this._updateCorners();

    this.marker.on('drag', () => {
      const ll = this.marker.getLatLng();
      this._applyCenter({ lat: ll.lat, lon: ll.lng }, true);
    });
    this.marker.on('dragend', () => this._markDragEnd());
    this.map.on('click', (e) => {
      // ドラッグを離した直後のクリックは中心点の指定として扱わない
      // （ハンドルが頂点位置へ戻ると、離した場所の下が地図になるため）
      if (performance.now() - this._lastDragEnd < 300) return;
      this._applyCenter({ lat: e.latlng.lat, lon: e.latlng.lng }, true);
    });
  }

  setBaseLayer(key) {
    const layer = MAP_LAYERS[key];
    if (this.baseLayer) this.map.removeLayer(this.baseLayer);
    this.baseLayer = L.tileLayer(layer.url, {
      attribution: GSI_ATTRIBUTION,
      maxZoom: 18,
      maxNativeZoom: layer.maxZoom,
    }).addTo(this.map);
  }

  /** 重ね地図（key が空なら解除） */
  setOverlayLayer(key, opacity) {
    if (this.overlayLayer) this.map.removeLayer(this.overlayLayer);
    this.overlayLayer = null;
    if (!key) return;
    const layer = MAP_LAYERS[key];
    this.overlayLayer = L.tileLayer(layer.url, {
      attribution: GSI_ATTRIBUTION,
      maxZoom: 18,
      maxNativeZoom: layer.maxZoom,
      opacity,
      zIndex: 2,
    }).addTo(this.map);
  }

  setOverlayOpacity(opacity) {
    this.overlayLayer?.setOpacity(opacity);
  }

  /** 外部（入力欄・検索）から中心点を設定 */
  setCenter(center, pan = false) {
    this._applyCenter(center, false);
    if (pan) this.map.setView([center.lat, center.lon], Math.max(this.map.getZoom(), 14));
  }

  setSize(width, height) {
    this.size = { width, height };
    this._updateArea();
  }

  /** 領域全体が見えるように表示 */
  fitToArea(insetLeft = 0) {
    this.map.fitBounds(this.rect.getBounds(), {
      paddingTopLeft: [30 + insetLeft, 30],
      paddingBottomRight: [30, 30],
    });
  }

  invalidateSize() {
    this.map.invalidateSize();
  }

  _applyCenter(center, notify) {
    this.center = center;
    this.marker.setLatLng([center.lat, center.lon]);
    this._updateArea();
    if (notify) this.onCenterChange?.(center);
  }

  /** 矩形と頂点ハンドルを現在の中心・サイズに合わせる（exclude は動かさないハンドル） */
  _updateArea(exclude = null) {
    this.rect.setBounds(this._latLngBounds());
    this._updateCorners(exclude);
  }

  _updateCorners(exclude = null) {
    const b = computeBounds(this.center, this.size.width, this.size.height);
    for (const handle of this.corners) {
      if (handle === exclude) continue;
      handle.setLatLng([b[handle.corner.lat], b[handle.corner.lon]]);
    }
  }

  /** 10pxの頂点ハンドル：ドラッグすると中心はそのままでサイズを変更 */
  _createCornerHandle(corner) {
    const handle = L.marker([this.center.lat, this.center.lon], {
      draggable: true,
      keyboard: false,
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: `corner-handle corner-${corner.cursor}`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      }),
    }).addTo(this.map);
    handle.corner = corner;

    handle.on('drag', () => {
      const ll = handle.getLatLng();
      // 中心から頂点までの距離の2倍が横・縦のサイズ（反対側へ越えても対称に扱う）
      const width = clampSize(Math.abs(ll.lng - this.center.lon) * metersPerDegLon(this.center.lat) * 2);
      const height = clampSize(Math.abs(ll.lat - this.center.lat) * metersPerDegLat() * 2);
      if (width === this.size.width && height === this.size.height) return;
      this.size = { width, height };
      this._updateArea(handle); // ドラッグ中のハンドルはマウスに追従させる
      this.onSizeChange?.(this.size);
    });
    // 離したら正しい頂点位置へ（上限・下限で止まった場合もここで揃う）
    handle.on('dragend', () => {
      this._markDragEnd();
      this._updateCorners();
    });
    return handle;
  }

  _markDragEnd() {
    this._lastDragEnd = performance.now();
  }

  _latLngBounds() {
    const b = computeBounds(this.center, this.size.width, this.size.height);
    return [[b.south, b.west], [b.north, b.east]];
  }
}

/** 1m単位に丸めて上限・下限内に収める */
function clampSize(meters) {
  return Math.min(Math.max(Math.round(meters), SIZE_LIMIT.min), SIZE_LIMIT.max);
}
