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
    this.exaggeration = 1;
    this.onHover = null;

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

    const size = Math.max(W, H);
    this.camera.near = size / 2000;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = size * 6;
    this.resetView();
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
  }
}
