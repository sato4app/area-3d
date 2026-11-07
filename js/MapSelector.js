// Leaflet による2D地図：中心点と領域の指定

import { MAP_LAYERS } from './config.js';
import { computeBounds } from './geo.js';

const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>';

export class MapSelector {
  /**
   * @param {string} elementId
   * @param {{lat:number, lon:number}} center
   * @param {(center:{lat:number, lon:number})=>void} onCenterChange
   */
  constructor(elementId, center, onCenterChange) {
    this.onCenterChange = onCenterChange;
    this.center = center;
    this.size = { width: 1000, height: 1000 };

    this.map = L.map(elementId, { zoomControl: true }).setView([center.lat, center.lon], 14);
    this.baseLayer = null;
    this.setBaseLayer('std');

    this.marker = L.marker([center.lat, center.lon], { draggable: true }).addTo(this.map);
    this.rect = L.rectangle(this._latLngBounds(), {
      color: '#d0302b',
      weight: 2,
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(this.map);

    this.marker.on('drag', () => {
      const ll = this.marker.getLatLng();
      this._applyCenter({ lat: ll.lat, lon: ll.lng }, true);
    });
    this.map.on('click', (e) => {
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

  /** 外部（入力欄・検索）から中心点を設定 */
  setCenter(center, pan = false) {
    this._applyCenter(center, false);
    if (pan) this.map.setView([center.lat, center.lon], Math.max(this.map.getZoom(), 14));
  }

  setSize(width, height) {
    this.size = { width, height };
    this.rect.setBounds(this._latLngBounds());
  }

  /** 領域全体が見えるように表示 */
  fitToArea() {
    this.map.fitBounds(this.rect.getBounds(), { padding: [30, 30] });
  }

  invalidateSize() {
    this.map.invalidateSize();
  }

  _applyCenter(center, notify) {
    this.center = center;
    this.marker.setLatLng([center.lat, center.lon]);
    this.rect.setBounds(this._latLngBounds());
    if (notify) this.onCenterChange?.(center);
  }

  _latLngBounds() {
    const b = computeBounds(this.center, this.size.width, this.size.height);
    return [[b.south, b.west], [b.north, b.east]];
  }
}
