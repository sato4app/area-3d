// Three.js による地形の3D表示

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { metersPerDegLat, metersPerDegLon } from './geo.js';

const WALL_COLOR = 0x8a6d4e;
const BOTTOM_COLOR = 0x5e4a35;
// 縮尺を測る高さ：画面の下辺から何px上か（縮尺バーの位置に合わせる）
const SCALE_BAR_OFFSET_PX = 15;

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
    /** 縮尺が変わったときに呼ぶ（引数：画面下辺付近の地表での 1px あたりの m。求められなければ null） */
    this.onScale = null;
    this._scaleDirty = true;

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

    // 視点が動いたら縮尺を計算し直す（描画のついでに1フレーム1回だけ）
    this.controls.addEventListener('change', () => { this._scaleDirty = true; });

    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (this._scaleDirty) {
        this._scaleDirty = false;
        this.onScale?.(this._metersPerPixelAtBottom());
      }
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

    const size = Math.max(W, H);
    this.camera.near = size / 2000;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = size * 6;
    this.resetView();
    this._scaleDirty = true;
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
    this._scaleDirty = true;
  }

  /**
   * 画面下辺付近（縮尺バーを置く高さ）の地表での 1px あたりの距離(m)
   * 透視投影なので場所ごとに縮尺が違う。下辺の中央から左右に少し離れた2点が
   * 地表のどこに当たるかを求め、その距離から計算する
   * 大きなメッシュとの交差判定は重いので、地表の高さは標高グリッドから引き、水平面との交点で近似する
   */
  _metersPerPixelAtBottom() {
    if (!this.terrain) return null;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return null;
    const y = h - SCALE_BAR_OFFSET_PX;
    const half = Math.min(60, w / 4);

    const ray = (px) => {
      const ndc = new THREE.Vector2((px / w) * 2 - 1, -(y / h) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, this.camera);
      return rc.ray;
    };
    // 水平面 y = planeY との交点（地平線より上を向いていれば null）
    const hitPlane = (r, planeY) => {
      if (r.direction.y >= -1e-6) return null;
      const t = (planeY - r.origin.y) / r.direction.y;
      return t > 0 ? r.origin.clone().addScaledVector(r.direction, t) : null;
    };

    // 中央の光線で地表の高さを求める（交点の標高で面を置き直すのを数回繰り返す）
    const center = ray(w / 2);
    let planeY = this.controls.target.y;
    for (let n = 0; n < 4; n++) {
      const p = hitPlane(center, planeY);
      if (!p) return null;
      const gy = this._surfaceY(p.x, p.z);
      if (gy === null) break; // 領域の外を見ているときは直前の高さのまま
      planeY = gy;
    }
    const a = hitPlane(ray(w / 2 - half), planeY);
    const b = hitPlane(ray(w / 2 + half), planeY);
    if (!a || !b) return null;
    // 水平方向の距離（m）。高さ強調は縦方向だけなので水平距離には影響しない
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    return d / (half * 2);
  }

  /** 地表の高さ（表示上の y 座標）。領域の外なら null */
  _surfaceY(x, z) {
    const { width: W, height: H, segX, segY, heights } = this.terrain;
    const fi = ((x + W / 2) / W) * segX;
    const fj = ((z + H / 2) / H) * segY;
    if (fi < 0 || fj < 0 || fi > segX || fj > segY) return null;
    const i = Math.round(fi);
    const j = Math.round(fj);
    return (heights[j * (segX + 1) + i] - this.baseH) * this.exaggeration;
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
    this._scaleDirty = true;
  }

  _disposeTerrain() {
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
