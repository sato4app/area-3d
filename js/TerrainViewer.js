// Three.js による地形の3D表示

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { metersPerDegLat, metersPerDegLon } from './geo.js';

const WALL_COLOR = 0x8a6d4e;
const BOTTOM_COLOR = 0x5e4a35;

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
    this.scaleBar = null; // 台座の南側の下辺に置く縮尺バー

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
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

    this._setupHover();
    new ResizeObserver(() => this._resize()).observe(container);
    this._resize();

    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  /** TerrainBuilder の結果を表示 */
  setTerrain(terrain) {
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

    const size = Math.max(W, H);
    this.camera.near = size / 2000;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = size * 6;
    this.resetView();
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
  }

  setExaggeration(value) {
    this.exaggeration = value;
    if (this.group) this.group.scale.y = value;
  }

  /**
   * 縮尺バー：台座の南側の下辺に沿って、西の角から東へ置く
   * 図形と一緒に回転・拡大縮小するので、どの向きから見ても図形に対して正しい長さになる
   * 白黒交互の区切りと、両端に「0」「○○ m」の文字を付ける
   */
  _buildScaleBar(W, H) {
    const size = Math.max(W, H);
    const length = niceLength(W * 0.5);
    // 区切りの数（100 → 4区切り(25m)、300 → 3区切り(100m)、500 → 5区切り(100m) など）
    const lead = Math.round(length / 10 ** Math.floor(Math.log10(length)));
    const segs = { 1: 4, 2: 4, 3: 3, 5: 5 }[lead] ?? 4;

    const depth = size * 0.012; // バーの幅（南北方向）
    const thick = size * 0.004; // バーの厚み（上下方向）
    const border = size * 0.002;
    const x0 = -W / 2;
    const z = H / 2 + size * 0.015 + depth / 2; // 台座の南の壁から少し離す

    const bar = new THREE.Group();
    // 縁取り（黒）
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(length + border * 2, thick * 0.9, depth + border * 2),
      new THREE.MeshBasicMaterial({ color: 0x222222 }),
    );
    frame.position.set(x0 + length / 2, (thick * 0.9) / 2, z);
    bar.add(frame);
    // 白黒交互の区切り（光の当たり方で色が変わらないよう陰影なしの素材）
    const segLen = length / segs;
    for (let k = 0; k < segs; k++) {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(segLen, thick, depth),
        new THREE.MeshBasicMaterial({ color: k % 2 === 0 ? 0x222222 : 0xffffff }),
      );
      seg.position.set(x0 + segLen * (k + 0.5), thick / 2, z);
      bar.add(seg);
    }
    // 両端の文字（常にカメラの方を向く）
    const labelH = size * 0.035;
    const labelZ = z + depth / 2 + labelH * 0.6;
    bar.add(this._makeLabel('0', x0, labelZ, labelH));
    bar.add(this._makeLabel(length >= 1000 ? `${length / 1000} km` : `${length} m`, x0 + length, labelZ, labelH));
    return bar;
  }

  /** 文字のスプライト（白い縁取り付きの黒文字） */
  _makeLabel(text, x, z, height) {
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
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _disposeTerrain() {
    if (this.scaleBar) {
      this.scene.remove(this.scaleBar);
      this.scaleBar.traverse((obj) => {
        if (!obj.isMesh && !obj.isSprite) return;
        if (obj.isMesh) obj.geometry.dispose(); // スプライトの形状は全スプライト共通なので解放しない
        obj.material.map?.dispose();
        obj.material.dispose();
      });
      this.scaleBar = null;
    }
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

/** max 以下で一番大きい「1・2・3・5 × 10のべき乗」の長さ(m) */
function niceLength(max) {
  const pow = 10 ** Math.floor(Math.log10(max));
  const d = max / pow;
  return Number((pow * (d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1)).toPrecision(1)); // 0.30000000000000004 などを防ぐ
}
