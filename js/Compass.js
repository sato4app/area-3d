// 3Dビューのコンパス：画面の上が向いている方角を表示する
// 文字盤（北・東・南・西と針）は、北が画面上の北の方向を指すように回転する
// 文字盤を押すと、中心から押した位置への向き（画面上の向き）を通知する（中心点の移動に使う）

const SVG_NS = 'http://www.w3.org/2000/svg';
const DIRECTIONS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

export class Compass {
  /**
   * @param {HTMLElement} el コンパスを入れる要素
   * @param {(angle: number) => void} [onPick] 文字盤が押されたとき（画面上の向き。度。上=0、右=90）
   */
  constructor(el, onPick) {
    this.el = el;
    this.heading = null;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-50 -50 100 100');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `
      <circle r="47" class="compass-face"/>
      <g class="compass-rose">
        ${ticks()}
        <path d="M0,-30 L7,0 L0,4 L-7,0 Z" class="compass-needle-n"/>
        <path d="M0,30 L7,0 L0,-4 L-7,0 Z" class="compass-needle-s"/>
        <circle r="3" class="compass-pin"/>
        <text x="0" y="-35" class="compass-letter compass-letter-n">北</text>
        <text x="37" y="0" class="compass-letter">東</text>
        <text x="0" y="37" class="compass-letter">南</text>
        <text x="-37" y="0" class="compass-letter">西</text>
      </g>
      <path d="M0,-44 L-6,-50 L6,-50 Z" class="compass-mark"/>
      <path d="M0,-44 L-7,-31 L-2.5,-31 L-2.5,-16 L2.5,-16 L2.5,-31 L7,-31 Z" class="compass-aim"/>
    `;
    this.svg = svg;
    this.rose = svg.querySelector('.compass-rose');
    this.aim = svg.querySelector('.compass-aim'); // 押す（押した）方向を示す矢印
    this._aimTimer = null;

    this.label = document.createElement('div');
    this.label.className = 'compass-label';

    el.append(svg, this.label);
    if (!onPick) return;

    // マウスでは、指している方向に矢印を出す
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || this._aimTimer) return;
      const a = this._angleAt(e);
      this._showAim(a);
    });
    svg.addEventListener('pointerleave', () => {
      if (!this._aimTimer) this._showAim(null);
    });
    svg.addEventListener('click', (e) => {
      if (this.el.disabled) return;
      const a = this._angleAt(e);
      if (a === null) return;
      // 押した方向に矢印を少しの間出す（タッチでも分かるように）
      this._showAim(a);
      clearTimeout(this._aimTimer);
      this._aimTimer = setTimeout(() => {
        this._aimTimer = null;
        this._showAim(null);
      }, 600);
      onPick(a);
    });
  }

  /**
   * 押した（指した）位置の、文字盤の中心からの向き（度。上=0、右=90）
   * 文字盤の外や中心のごく近くは向きが決まらないので null
   */
  _angleAt(e) {
    const r = this.svg.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy) / (r.width / 2);
    if (dist < 0.12 || dist > 1) return null;
    return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  }

  _showAim(angle) {
    if (angle === null) {
      this.aim.classList.remove('show');
      return;
    }
    this.aim.setAttribute('transform', `rotate(${angle.toFixed(1)})`);
    this.aim.classList.add('show');
  }

  /** 3Dを作り直している間は押せないようにする */
  setBusy(busy) {
    this.el.disabled = busy;
  }

  /**
   * 画面の上が向いている方位角（度。北=0、東=90）
   * @param {number} deg
   */
  setHeading(deg) {
    const h = ((deg % 360) + 360) % 360;
    // 変化がごく小さいときは書き換えない（描画のたびに呼ばれるため）
    if (this.heading !== null && Math.abs(angleDiff(h, this.heading)) < 0.1) return;
    this.heading = h;
    this.rose.setAttribute('transform', `rotate(${(-h).toFixed(2)})`);
    const rounded = Math.round(h) % 360;
    this.label.textContent = `${DIRECTIONS[Math.round(h / 45) % 8]} ${rounded}°`;
    this.el.setAttribute('aria-label', `画面の上の方角：${this.label.textContent}`);
  }

  setVisible(visible) {
    this.el.classList.toggle('hidden', !visible);
  }
}

/** 文字盤の目盛り（30度ごと。東西南北は長め） */
function ticks() {
  let s = '';
  for (let d = 0; d < 360; d += 30) {
    if (d % 90 === 0) continue; // 東西南北は文字があるので描かない
    const r = (d * Math.PI) / 180;
    const x = Math.sin(r);
    const y = -Math.cos(r);
    s += `<line x1="${(x * 39).toFixed(2)}" y1="${(y * 39).toFixed(2)}" x2="${(x * 44).toFixed(2)}" y2="${(y * 44).toFixed(2)}" class="compass-tick"/>`;
  }
  return s;
}

/** 2つの角度の差（-180〜180度） */
function angleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}
