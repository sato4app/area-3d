// GPXファイル（GPS Exchange Format）を GeoJSON に変換する
//   - wpt（ウェイポイント）→ Point
//   - rte（ルート）        → LineString
//   - trk（トラック）      → LineString（セグメントが複数なら MultiLineString）

/**
 * GPX の文字列を GeoJSON の FeatureCollection に変換する
 * @param {string} text GPX（XML）の文字列
 * @returns {object} FeatureCollection
 */
export function gpxToGeoJson(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('GPX（XML）として読み込めませんでした。');
  }
  const root = doc.documentElement;
  if (localName(root) !== 'gpx') {
    throw new Error('GPXの形式ではありません。');
  }

  const features = [];

  for (const wpt of children(root, 'wpt')) {
    const coord = pointCoord(wpt);
    if (!coord) continue;
    features.push(feature({ type: 'Point', coordinates: coord }, props(wpt)));
  }

  for (const rte of children(root, 'rte')) {
    const coords = children(rte, 'rtept').map(pointCoord).filter(Boolean);
    if (coords.length < 2) continue;
    features.push(feature({ type: 'LineString', coordinates: coords }, props(rte)));
  }

  for (const trk of children(root, 'trk')) {
    const segs = children(trk, 'trkseg')
      .map((seg) => children(seg, 'trkpt').map(pointCoord).filter(Boolean))
      .filter((coords) => coords.length >= 2);
    if (segs.length === 0) continue;
    const geometry =
      segs.length === 1
        ? { type: 'LineString', coordinates: segs[0] }
        : { type: 'MultiLineString', coordinates: segs };
    features.push(feature(geometry, props(trk)));
  }

  return { type: 'FeatureCollection', features };
}

function feature(geometry, properties) {
  return { type: 'Feature', geometry, properties };
}

/** 名前空間の接頭辞を除いたタグ名 */
function localName(el) {
  return (el.localName || el.nodeName).replace(/^.*:/, '');
}

/** 直下の子要素のうち、指定したタグ名のもの */
function children(el, name) {
  return [...el.children].filter((c) => localName(c) === name);
}

/** 直下の子要素の文字列（無ければ空文字） */
function childText(el, name) {
  return children(el, name)[0]?.textContent.trim() ?? '';
}

/** wpt / rtept / trkpt の座標 [経度, 緯度, 標高?]。正しくなければ null */
function pointCoord(el) {
  const lat = parseFloat(el.getAttribute('lat'));
  const lon = parseFloat(el.getAttribute('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ele = parseFloat(childText(el, 'ele'));
  return Number.isFinite(ele) ? [lon, lat, ele] : [lon, lat];
}

/** ポップアップに出す属性（値のあるものだけ） */
function props(el) {
  const p = {};
  for (const key of ['name', 'desc', 'cmt', 'type', 'ele', 'time']) {
    const v = childText(el, key);
    if (v) p[key] = v;
  }
  return p;
}
