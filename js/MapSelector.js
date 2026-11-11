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

// 頂点ハンドルの掴める範囲(px)。見た目は CSS で10pxの四角を中央に描く
// タッチ操作の端末では指で掴みやすいよう広めにする
const HANDLE_HIT_SIZE = window.matchMedia('(pointer: coarse)').matches ? 36 : 24;

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

    // 左上はコントロールパネルが重なるので、ズームボタンは右上に置く
    this.map = L.map(elementId, { zoomControl: false }).setView([center.lat, center.lon], 14);
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    // 縮尺（メートル表示のみ）
    L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 150 }).addTo(this.map);
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

    // 中心点の移動は中心マーカーのドラッグのみ（地図のタップ・クリックでは動かさない）
    this.marker.on('drag', () => {
      const ll = this.marker.getLatLng();
      this._applyCenter({ lat: ll.lat, lon: ll.lng }, true);
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
    this.fitToBounds(this.rect.getBounds(), insetLeft);
  }

  /** 指定範囲が見えるように表示（insetLeft はパネルに隠れる左側の幅） */
  fitToBounds(bounds, insetLeft = 0, maxZoom = 18) {
    this.map.fitBounds(bounds, {
      paddingTopLeft: [30 + insetLeft, 30],
      paddingBottomRight: [30, 30],
      maxZoom,
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

  /** 頂点ハンドル（見た目10px・掴める範囲は広め）：ドラッグすると中心はそのままで、正方形のままサイズを変更 */
  _createCornerHandle(corner) {
    const handle = L.marker([this.center.lat, this.center.lon], {
      draggable: true,
      keyboard: false,
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: `corner-handle corner-${corner.cursor}`,
        iconSize: [HANDLE_HIT_SIZE, HANDLE_HIT_SIZE],
        iconAnchor: [HANDLE_HIT_SIZE / 2, HANDLE_HIT_SIZE / 2],
      }),
    }).addTo(this.map);
    handle.corner = corner;

    handle.on('drag', () => {
      const ll = handle.getLatLng();
      // 縦横同じ長さ（正方形）のまま大きさを変える：一辺は中心から頂点までの東西・南北の距離の長い方の2倍
      // （反対側へ越えても対称に扱う）
      const dx = Math.abs(ll.lng - this.center.lon) * metersPerDegLon(this.center.lat);
      const dy = Math.abs(ll.lat - this.center.lat) * metersPerDegLat();
      const side = clampSize(Math.max(dx, dy) * 2);
      if (side === this.size.width && side === this.size.height) return;
      this.size = { width: side, height: side };
      this._updateArea(handle); // ドラッグ中のハンドルはマウスに追従させる
      this.onSizeChange?.(this.size);
    });
    // 離したら正しい頂点位置へ（上限・下限で止まった場合もここで揃う）
    handle.on('dragend', () => this._updateCorners());
    return handle;
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
