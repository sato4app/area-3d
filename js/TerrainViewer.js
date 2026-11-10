// Three.js による地形の3D表示

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { metersPerDegLat, metersPerDegLon } from './geo.js';
import { MAX_PIXEL_RATIO } from './config.js';

const WALL_COLOR = 0x8a6d4e;
const BOTTOM_COLOR = 0x5e4a35;

// 壁面の標高目盛りの間隔の候補(m)。基本は10mごと、詰まりすぎるときは広げる
const ELEV_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000];

export class TerrainViewer {
  constructor(container) {
    this.container = container;
    this.terrain = null;
    this.group = null;
    this.surface = null;
    this.overlay = null;
    this.overlayOpacity = 0.5;
    this.geojsonLayer = null;
    this.exaggeration = 1;
    this.onHover = null;
    this.onHeadingChange = null; // 画面の上が向いている方位角(度。北=0、東=90)を描画のたびに通知
    // 描画は必要なときだけ行う（電池の消費を抑えるため）
    this.active = false; // 3Dビューが表示されているか（地図表示中は描画しない）
    this._frame = null;  // 予約済みの描画（requestAnimationFrame の ID）
    this.scaleBar = null; // 台座の4辺の外側に置く縮尺バー
    this.elevScale = null; // 台座の4面の壁に描く標高目盛り
    this._wallEdges = null; // 4面の壁の上端の形（標高目盛りの位置決めに使う）
    this._elevRes = null;  // 標高目盛りの素材・文字画像（地形を作り直すまで使い回す）

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(pixelRatio());
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 100000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6656, 1.8));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-1, 1.6, -0.6); // 北西上空から照らす（陰影図と同じ向き）
    this.scene.add(this.sun);

    // 視点が動いたら描画（ドラッグ中・慣性で動いている間に呼ばれる）
    this.controls.addEventListener('change', () => this.requestRender());

    this._setupHover();
    new ResizeObserver(() => this._resize()).observe(container);
    this._resize();
  }

  /**
   * 3Dビューの表示・非表示を伝える。非表示の間は描画しない
   * @param {boolean} active
   */
  setActive(active) {
    this.active = active;
    if (active) {
      this.requestRender();
    } else if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
  }

  /** 次のフレームで1回描画する（同じフレーム内で何度呼んでも1回だけ） */
  requestRender() {
    if (!this.active || this._frame !== null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      // 慣性（ダンピング）で動いている間は、update() が 'change' を出して次のフレームを予約する
      // 動きが止まれば予約されず、描画も止まる
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.onHeadingChange?.(this.heading());
    });
  }

  /**
   * 画面の上が向いている方位角（度。北=0、東=90、0〜360）
   * OrbitControls の方位角は「注視点から見たカメラの向き」で、南(+z)にカメラがあれば0（北を向いている）
   */
  heading() {
    const deg = THREE.MathUtils.radToDeg(-this.controls.getAzimuthalAngle());
    return ((deg % 360) + 360) % 360;
  }

  /** 視点の高さ・距離はそのままで、北が画面の上になるよう回す */
  faceNorth() {
    if (!this.terrain) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.set(0, offset.y, Math.hypot(offset.x, offset.z)); // 注視点の真南にカメラを置く
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.requestRender();
  }

  /**
   * TerrainBuilder の結果を表示
   * @param {object} terrain
   * @param {{keepView?: boolean}} [opts] keepView: 視点の向き・距離を変えない（中心点の移動時）
   */
  setTerrain(terrain, opts = {}) {
    // 前の地形があるときだけ視点を引き継げる（注視点から見たカメラの位置を覚えておく）
    const keepOffset = opts.keepView && this.terrain
      ? this.camera.position.clone().sub(this.controls.target)
      : null;
    this._disposeTerrain();
    this.terrain = terrain;

    const { width: W, height: H, segX, segY, heights, uvs, minH, maxH } = terrain;
    const nx = segX + 1;
    const ny = segY + 1;

    // 台座の底の高さ（最低標高より少し下）
    this.baseH = minH - Math.max(20, (maxH - minH) * 0.15);

    // ---- 地表面 ----
    const pos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        pos[k * 3] = -W / 2 + (i / segX) * W; // 東が +x
        pos[k * 3 + 1] = heights[k] - this.baseH;
        pos[k * 3 + 2] = -H / 2 + (j / segY) * H; // 北が -z
      }
    }
    const index = new Uint32Array(segX * segY * 6);
    let p = 0;
    for (let j = 0; j < segY; j++) {
      for (let i = 0; i < segX; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        index[p++] = a; index[p++] = c; index[p++] = b;
        index[p++] = b; index[p++] = c; index[p++] = d;
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(index, 1));
    geom.computeVertexNormals();

    this.surface = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ map: this._makeTexture(terrain.textureCanvas), roughness: 1, metalness: 0 }),
    );

    // ---- 重ね地図：同じ形状のメッシュを半透明で上に描く ----
    this.overlay = null;
    if (terrain.overlayCanvas) {
      this.overlay = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({
          map: this._makeTexture(terrain.overlayCanvas),
          roughness: 1,
          metalness: 0,
          transparent: true,
          opacity: this.overlayOpacity,
          depthWrite: false,
          // 地表面とのちらつき（Zファイティング）を防ぐため手前にずらす
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
        }),
      );
      this.overlay.renderOrder = 1;
      this.overlay.visible = this.overlayOpacity > 0;
    }

    // ---- 側面と底面（ジオラマ風の台座） ----
    const walls = new THREE.Mesh(
      this._buildWalls(pos, nx, ny),
      new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 1, side: THREE.DoubleSide }),
    );
    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: BOTTOM_COLOR, roughness: 1, side: THREE.DoubleSide }),
    );

    this.group = new THREE.Group();
    this.group.add(this.surface, walls, bottom);
    if (this.overlay) this.group.add(this.overlay);
    this.group.scale.y = this.exaggeration;
    this.scene.add(this.group);

    // 縮尺バーは高さ強調の影響を受けないよう、地形とは別に置く（台座の底は高さ強調しても y=0 のまま）
    this.scaleBar = this._buildScaleBar(W, H);
    this.scene.add(this.scaleBar);

    // 壁面の標高目盛り：文字が高さ強調で縦に伸びないよう、これも地形とは別に置く
    this._wallEdges = this._collectWallEdges(heights, nx, ny);
    this._buildElevScale();

    const size = Math.max(W, H);
    this.camera.near = size / 2000;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = size * 6;
    if (keepOffset) {
      // 注視点は新しい領域の中央（高さは resetView と同じ決め方）に置き、カメラは同じ向き・距離に
      const relief = (maxH - this.baseH) * this.exaggeration;
      this.controls.target.set(0, relief * 0.4, 0);
      this.camera.position.copy(this.controls.target).add(keepOffset);
      this.controls.update();
    } else {
      this.resetView();
    }
    this.requestRender();
  }

  /**
   * GeoJSON を描いた透明キャンバスを地表に貼る（null で消す）
   * キャンバスは地表テクスチャと同じく領域ぴったりのメルカトル投影で描いたもの
   */
  setGeoJsonCanvas(canvas) {
    if (this.geojsonLayer) {
      this.group?.remove(this.geojsonLayer);
      this.geojsonLayer.material.map?.dispose();
      this.geojsonLayer.material.dispose();
      this.geojsonLayer = null;
      this.requestRender();
    }
    if (!canvas || !this.surface) return;

    // 透明部分との境目が黒ずまないよう、色にアルファを掛けた状態で扱って合成する
    const texture = this._makeTexture(canvas);
    texture.premultiplyAlpha = true;
    this.geojsonLayer = new THREE.Mesh(
      this.surface.geometry,
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 1,
        metalness: 0,
        transparent: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        depthWrite: false,
        // 地表・重ね地図より手前に描く
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -8,
      }),
    );
    this.geojsonLayer.renderOrder = 2;
    this.group.add(this.geojsonLayer);
    this.requestRender();
  }

  /** 側面の壁：外周の頂点から高さ0まで下ろした四角形を並べる */
  _buildWalls(pos, nx, ny) {
    const edges = [
      Array.from({ length: nx }, (_, i) => i),                         // 北辺
      Array.from({ length: ny }, (_, j) => j * nx + (nx - 1)),          // 東辺
      Array.from({ length: nx }, (_, i) => (ny - 1) * nx + (nx - 1 - i)), // 南辺
      Array.from({ length: ny }, (_, j) => (ny - 1 - j) * nx),          // 西辺
    ];
    const verts = [];
    for (const edge of edges) {
      for (let n = 0; n < edge.length - 1; n++) {
        const a = edge[n] * 3;
        const b = edge[n + 1] * 3;
        const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
        const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
        verts.push(ax, ay, az, ax, 0, az, bx, by, bz);
        verts.push(bx, by, bz, ax, 0, az, bx, 0, bz);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.computeVertexNormals();
    return geom;
  }

  _makeTexture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
  }

  /** 重ね地図の濃さ（0〜1） */
  setOverlayOpacity(value) {
    this.overlayOpacity = value;
    if (!this.overlay) return;
    this.overlay.material.opacity = value;
    this.overlay.visible = value > 0;
    this.requestRender();
  }

  setExaggeration(value) {
    this.exaggeration = value;
    if (this.group) this.group.scale.y = value;
    if (this.terrain) this._buildElevScale(); // 目盛りの高さ・間隔を合わせ直す
    this.requestRender();
  }

  /**
   * 4面の壁それぞれについて、壁に沿った位置と上端の標高を集める
   * 各壁は「中心 (cx, cz)」「向き rot」のローカル座標で扱う（縮尺バーと同じ向き）：
   * ローカル +z が台座の外側、ローカル +x は外から壁を見て右方向
   */
  _collectWallEdges(heights, nx, ny) {
    const { width: W, height: H, segX, segY } = this.terrain;
    const xAt = (i) => -W / 2 + (i / segX) * W;
    const zAt = (j) => -H / 2 + (j / segY) * H;
    const edge = (n, posFn, hFn) => {
      const xs = new Float64Array(n);
      const hs = new Float64Array(n);
      for (let k = 0; k < n; k++) { xs[k] = posFn(k); hs[k] = hFn(k); }
      return { xs, hs };
    };
    // xs が小さい順（外から見て左→右）になるよう、北・東は逆順に並べる
    return [
      // 南：ローカル x = 東西の x
      { cx: 0, cz: H / 2, rot: 0, ...edge(nx, (k) => xAt(k), (k) => heights[(ny - 1) * nx + k]) },
      // 北：ローカル x = -x
      { cx: 0, cz: -H / 2, rot: Math.PI, ...edge(nx, (k) => -xAt(nx - 1 - k), (k) => heights[nx - 1 - k]) },
      // 東：ローカル x = -z
      { cx: W / 2, cz: 0, rot: Math.PI / 2, ...edge(ny, (k) => -zAt(ny - 1 - k), (k) => heights[(ny - 1 - k) * nx + (nx - 1)]) },
      // 西：ローカル x = z
      { cx: -W / 2, cz: 0, rot: -Math.PI / 2, ...edge(ny, (k) => zAt(k), (k) => heights[k * nx]) },
    ];
  }

  /**
   * 台座の4面の壁に、標高の目盛り（横線）と標高値を描く
   * 横線は壁のある所全体に、地表との境界（壁の上端）まで引く
   * 文字は各壁で「壁からはみ出さずに一番高くまで描ける位置」に1列並べる
   * 高さ強調を変えたら作り直す（文字の大きさは変えず、間隔だけ変わる）
   */
  _buildElevScale() {
    this._disposeElevScale();
    if (!this.terrain || !this._wallEdges) return;

    const { width: W, height: H, maxH } = this.terrain;
    const size = Math.max(W, H);
    const exag = this.exaggeration;
    const baseH = this.baseH;
    const toY = (e) => (e - baseH) * exag;

    // 目盛りの間隔：基本10m。画面上で線同士がくっつくほど狭いときだけ広げる
    // （線は壁全体に引くので、詰まりすぎると壁が線で黒っぽく見える）
    const tickStep = ELEV_STEPS.find((s) => s * exag >= size * 0.006) ?? ELEV_STEPS.at(-1);
    // 文字を付ける間隔：読める大きさの文字が重ならない範囲で、なるべく全部の目盛りに付ける
    // （高さ強調が小さいと間隔が詰まるので、文字は1つおきなどに間引く）
    const minLabelH = size * 0.022;
    const labelStep =
      ELEV_STEPS.find((s) => s >= tickStep && s % tickStep === 0 && s * exag * 0.9 >= minLabelH) ?? ELEV_STEPS.at(-1);
    const labelH = Math.min(size * 0.03, labelStep * exag * 0.9);

    // 5本ごとの線（10mごとなら50mごと、20mごとなら100mごと）は太く・濃くして目立たせる
    const majorStep = tickStep * 5;
    const lineW = size * 0.0025;    // 線の太さ（上下方向）
    const majorLineW = lineW * 2;   // 5本ごとの線の太さ
    const majorLen = size * 0.028;  // 文字の列の左端から文字までの距離
    const pad = size * 0.005;       // 線と文字の間
    const lift = size * 0.001;      // 壁から少し浮かせる（ちらつき防止）

    const res = this._elevResources();
    // 一番長い文字の幅で、目盛りの列が占める横幅を見積もる
    const topLabel = Math.floor(maxH / labelStep) * labelStep;
    const maxLabelW = labelH * res.label(`${topLabel}m`).aspect;
    const span = majorLen + pad + maxLabelW;

    const scale = new THREE.Group();
    for (const wall of this._wallEdges) {
      const { xs, hs } = wall;
      const n = xs.length;
      // [x0, x0 + span] の範囲での壁の上端の最低値（この高さまでなら目盛りが壁に収まる）
      const topWithin = (k) => {
        let m = Infinity;
        for (let q = k; q < n && xs[q] <= xs[k] + span; q++) m = Math.min(m, hs[q]);
        if (k > 0) m = Math.min(m, hs[k - 1]); // 線の左端が前の点との間に掛かる分
        return m;
      };
      // 角の近くは隣の壁の目盛りと紛らわしいので避けて、一番高くまで描ける位置を探す
      const margin = size * 0.02;
      let best = null;
      for (let k = 0; k < n; k++) {
        if (xs[k] < xs[0] + margin || xs[k] + span > xs[n - 1] - margin) continue;
        const top = topWithin(k);
        if (!best || top > best.top) best = { x0: xs[k], top };
      }
      if (!best) {
        // 壁が短くて収まらないときは中央に置く
        const k = Math.max(0, xs.findIndex((x) => x >= -span / 2));
        best = { x0: xs[k], top: topWithin(k) };
      }
      const { x0, top } = best;

      const side = new THREE.Group();
      side.position.set(wall.cx, 0, wall.cz);
      side.rotation.y = wall.rot;

      // 横線：通常の線と5本ごとの線で、それぞれ1つの形状にまとめる
      const minorVerts = [];
      const majorVerts = [];
      const wallY = Array.from(hs, toY); // 壁の上端の高さ（表示上の y）
      const wallTop = Math.max(...wallY);
      // 高さ y0〜y1 の帯を、壁の上端より下の部分だけ描く（gap の範囲は文字があるので空ける）
      const drawBand = (y0, y1, gap, verts) => {
        // 多角形（反時計回り＝外側が表）を三角形に分けて追加
        const addPoly = (pts) => {
          for (let q = 1; q + 1 < pts.length; q++) {
            verts.push(pts[0][0], pts[0][1], lift, pts[q][0], pts[q][1], lift, pts[q + 1][0], pts[q + 1][1], lift);
          }
        };
        const emit = (pts) => {
          if (!gap) return addPoly(pts);
          addPoly(clipPolygon(pts, (p) => gap[0] - p[0]));
          addPoly(clipPolygon(pts, (p) => p[0] - gap[1]));
        };
        let runStart = null; // 帯がまるごと壁に収まる区間はつなげて1つの四角形にする
        const flush = (xEnd) => {
          if (runStart === null) return;
          emit([[runStart, y0], [xEnd, y0], [xEnd, y1], [runStart, y1]]);
          runStart = null;
        };
        for (let k = 0; k < n - 1; k++) {
          const xa = xs[k], xb = xs[k + 1], ya = wallY[k], yb = wallY[k + 1];
          if (ya >= y1 && yb >= y1) {
            if (runStart === null) runStart = xa;
            continue;
          }
          flush(xa);
          if (ya <= y0 && yb <= y0) continue; // 壁がこの高さに届いていない
          // 一部だけ壁に掛かる区間：壁の上端（地表との境界）の線で切り取る
          const slope = (yb - ya) / (xb - xa);
          emit(clipPolygon([[xa, y0], [xb, y0], [xb, y1], [xa, y1]], (p) => ya + (p[0] - xa) * slope - p[1]));
        }
        flush(xs[n - 1]);
      };

      const first = Math.ceil(baseH / tickStep) * tickStep;
      for (let e = first; toY(e) < wallTop; e += tickStep) {
        const y = toY(e);
        const major = e % majorStep === 0;
        const halfW = (major ? majorLineW : lineW) / 2;
        if (y - halfW < 0) continue; // 台座の底より下は描かない
        const labeled = e % labelStep === 0 && e <= top && y - labelH / 2 >= 0 && y + labelH / 2 <= toY(top);
        let gap = null;
        if (labeled) {
          const { material, aspect } = res.label(`${e}m`);
          const w = labelH * aspect;
          const left = x0 + majorLen + pad;
          const label = new THREE.Mesh(res.planeGeom, material);
          label.scale.set(w, labelH, 1);
          label.position.set(left + w / 2, y, lift);
          label.renderOrder = 3;
          side.add(label);
          gap = [left - pad, left + w + pad];
        }
        drawBand(y - halfW, y + halfW, gap, major ? majorVerts : minorVerts);
      }
      for (const [verts, material] of [[minorVerts, res.tickMaterial], [majorVerts, res.majorTickMaterial]]) {
        if (!verts.length) continue;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        side.add(new THREE.Mesh(geom, material));
      }
      scale.add(side);
    }
    this.elevScale = scale;
    this.scene.add(scale);
  }

  /** 標高目盛りの素材と文字画像（同じ文字は4面で共用） */
  _elevResources() {
    if (this._elevRes) return this._elevRes;
    const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const labels = new Map();
    this._elevRes = {
      // 光の当たり方で色が変わらないよう陰影なし。壁のすぐ手前に描く
      // 通常の線はやや淡く、5本ごとの線は黒にして区別しやすくする
      tickMaterial: new THREE.MeshBasicMaterial({
        color: 0x3a3028,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
      majorTickMaterial: new THREE.MeshBasicMaterial({
        color: 0x000000,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
      planeGeom: new THREE.PlaneGeometry(1, 1), // 表は +z（台座の外側）。内側からは見えない
      labels,
      label(text) {
        let item = labels.get(text);
        if (!item) {
          const canvas = makeTextCanvas(text);
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = anisotropy; // 斜めから見ても文字がぼやけにくいように
          item = {
            aspect: canvas.width / canvas.height,
            material: new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              depthWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -8,
            }),
          };
          labels.set(text, item);
        }
        return item;
      },
    };
    return this._elevRes;
  }

  /** 標高目盛りを取り除く（素材・文字画像は使い回すので残す） */
  _disposeElevScale() {
    if (!this.elevScale) return;
    this.scene.remove(this.elevScale);
    this.elevScale.traverse((obj) => {
      // 横線の形状だけ毎回作るので解放。文字の板は共用の形状
      if (obj.isMesh && obj.geometry !== this._elevRes?.planeGeom) obj.geometry.dispose();
    });
    this.elevScale = null;
  }

  /**
   * 縮尺バー：台座の4辺それぞれの外側に、辺の中央に合わせて置く
   * どの向きに回転しても手前の辺のバーが見える
   * 図形と一緒に回転・拡大縮小するので、どの向きから見ても図形に対して正しい長さになる
   * 長さを示す1本の線と両端の目盛り、中央に「○○ m」の文字
   */
  _buildScaleBar(W, H) {
    const size = Math.max(W, H);
    // 短い方の辺の3割以下で切りのよい長さ（500m四方 → 100 m、2km四方 → 500 m）
    const length = niceLength(Math.min(W, H) * 0.3);
    const text = length >= 1000 ? `${length / 1000} km` : `${length} m`;
    const gap = size * 0.015; // 台座の壁からの距離

    const bars = new THREE.Group();
    // [置く位置 x, z, 向き]：向きは「バーの外側（文字の側）」が台座の外を向くように回す
    const sides = [
      [0, H / 2 + gap, 0],             // 南
      [0, -(H / 2 + gap), Math.PI],    // 北
      [W / 2 + gap, 0, Math.PI / 2],   // 東
      [-(W / 2 + gap), 0, -Math.PI / 2], // 西
    ];
    for (const [x, z, rot] of sides) {
      const bar = this._makeScaleBar(length, text, size);
      bar.position.set(x, 0, z);
      bar.rotation.y = rot;
      bars.add(bar);
    }
    return bars;
  }

  /**
   * 1本分の縮尺バー（ローカル座標：x 方向に長さ length、中央が原点、+z が台座の外側）
   */
  _makeScaleBar(length, text, size) {
    const thick = size * 0.003;   // 厚み（上下方向）
    const lineW = size * 0.005;   // 線の太さ
    const tickLen = size * 0.02;  // 両端の目盛りの長さ（外側へ伸ばす）
    // 光の当たり方で色が変わらないよう陰影なしの素材。線と目盛りは同じ色なので、
    // 重なった部分の面の前後が入れ替わっても見た目は変わらない（チラつかない）
    const material = new THREE.MeshBasicMaterial({ color: 0x222222 });

    const bar = new THREE.Group();
    const line = new THREE.Mesh(new THREE.BoxGeometry(length, thick, lineW), material);
    line.position.set(0, thick / 2, lineW / 2);
    bar.add(line);
    for (const x of [-length / 2, length / 2]) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(lineW, thick, tickLen), material);
      tick.position.set(x, thick / 2, tickLen / 2);
      bar.add(tick);
    }
    // 中央の文字（常にカメラの方を向く）
    const labelH = size * 0.035;
    bar.add(this._makeLabel(text, 0, tickLen + labelH * 0.6, labelH));
    return bar;
  }

  /** 文字のスプライト（白い縁取り付きの黒文字） */
  _makeLabel(text, x, z, height) {
    const canvas = makeTextCanvas(text);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
    sprite.position.set(x, 0, z);
    return sprite;
  }

  resetView() {
    if (!this.terrain) return;
    const { width: W, height: H, maxH } = this.terrain;
    const size = Math.max(W, H);
    const relief = (maxH - this.baseH) * this.exaggeration;
    this.controls.target.set(0, relief * 0.4, 0);
    // 画面の縦横比を考慮し、領域全体が収まる距離を求める
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const fitDist = (size * 1.0) / Math.tan(halfFov) / Math.min(1, this.camera.aspect);
    // 南やや東の上空から見下ろす
    const dir = new THREE.Vector3(0.25, 0.85, 1).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, fitDist);
    this.controls.update();
    this.requestRender();
  }

  /** 現在の表示をPNGのデータURLで返す */
  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** マウス位置の緯度経度・標高を通知 */
  _setupHover() {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const el = this.renderer.domElement;
    let pending = null;
    let dragging = false;

    el.addEventListener('pointerdown', () => { dragging = true; });
    window.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointerleave', () => this.onHover?.(null));
    el.addEventListener('pointermove', (e) => {
      if (dragging || !this.surface) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (pending) return;
      // 大きなメッシュの判定は重いので間引く
      pending = setTimeout(() => {
        pending = null;
        raycaster.setFromCamera(ndc, this.camera);
        const hit = raycaster.intersectObject(this.surface, false)[0];
        if (!hit) {
          this.onHover?.(null);
          return;
        }
        const { center } = this.terrain;
        this.onHover?.({
          lat: center.lat - hit.point.z / metersPerDegLat(),
          lon: center.lon + hit.point.x / metersPerDegLon(center.lat),
          elevation: hit.point.y / this.exaggeration + this.baseH,
        });
      }, 80);
    });
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    // ブラウザの拡大率や画面の移動で画面密度が変わることもあるので毎回合わせる
    this.renderer.setPixelRatio(pixelRatio());
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender(); // 大きさを変えると画面が消えるので描き直す
  }

  _disposeTerrain() {
    if (this.scaleBar) {
      this.scene.remove(this.scaleBar);
      this.scaleBar.traverse((obj) => {
        if (!obj.isMesh && !obj.isSprite) return;
        if (obj.isMesh) obj.geometry.dispose(); // スプライトの形状は全スプライト共通なので解放しない
        // 面ごとに素材を持つ形状（配列）にも対応
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          m.map?.dispose();
          m.dispose();
        }
      });
      this.scaleBar = null;
    }
    this._disposeElevScale();
    if (this._elevRes) {
      this._elevRes.tickMaterial.dispose();
      this._elevRes.majorTickMaterial.dispose();
      this._elevRes.planeGeom.dispose();
      for (const { material } of this._elevRes.labels.values()) {
        material.map.dispose();
        material.dispose();
      }
      this._elevRes = null;
    }
    this._wallEdges = null;
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry.dispose(); // 地表面と重ね地図は同じ形状を共有（2回呼んでも問題なし）
      obj.material.map?.dispose();
      obj.material.dispose();
    });
    this.group = null;
    this.surface = null;
    this.overlay = null;
    this.geojsonLayer = null;
  }
}

/**
 * 多角形を直線で切り取る（f(p) >= 0 の側を残す。f は1次式）
 * @param {number[][]} pts 頂点 [x, y] の配列
 * @param {(p:number[])=>number} f
 */
function clipPolygon(pts, f) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** 白い縁取り付きの黒文字を描いたキャンバス（縮尺バー・標高目盛りの文字） */
function makeTextCanvas(text) {
  const font = 'bold 48px "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + 24;
  canvas.height = 64;
  ctx.font = font; // 大きさを変えると設定が消えるので設定し直す
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#fff';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = '#222';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas;
}

/** max 以下で一番大きい「1・2・3・5 × 10のべき乗」の長さ(m) */
function niceLength(max) {
  const pow = 10 ** Math.floor(Math.log10(max));
  const d = max / pow;
  return Number((pow * (d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1)).toPrecision(1)); // 0.30000000000000004 などを防ぐ
}

/** 3D描画の解像度の倍率（端末の画面密度。ただし MAX_PIXEL_RATIO まで） */
function pixelRatio() {
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}
