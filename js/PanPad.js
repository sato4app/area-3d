// 3Dビューの中心点移動ボタン（コンパスの下の十字ボタン）
// ボタンは画面の前後左右に並べ、視点の向きに合わせて一番近い東西南北へ移動する
// （例：東が画面の上なら［前］は東へ移動）。ボタンの文字は移動する方角を表示する

const CARDINALS = ['north', 'east', 'south', 'west'];
const CARDINAL_NAMES = { north: '北', east: '東', south: '南', west: '西' };
// 画面上の向き（前=0°、右=90°、後=180°、左=270°）
const SCREEN_DIRS = [
  { key: 'front', angle: 0, arrow: '▲' },
  { key: 'right', angle: 90, arrow: '▶' },
  { key: 'back', angle: 180, arrow: '▼' },
  { key: 'left', angle: 270, arrow: '◀' },
];

export class PanPad {
  /**
   * @param {HTMLElement} el ボタンを入れる要素
   * @param {(dir: 'north'|'east'|'south'|'west') => void} onMove ボタンが押されたとき（移動する方角）
   */
  constructor(el, onMove) {
    this.el = el;
    this.quadrant = null; // 画面の上に一番近い方角（0=北、1=東、2=南、3=西）
    this.buttons = SCREEN_DIRS.map((d) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pan-btn pan-${d.key}`;
      const arrow = document.createElement('span');
      arrow.className = 'pan-arrow';
      arrow.textContent = d.arrow;
      const name = document.createElement('span');
      name.className = 'pan-name';
      btn.append(arrow, name);
      btn.addEventListener('click', () => {
        if (btn.dataset.dir) onMove(btn.dataset.dir);
      });
      el.appendChild(btn);
      return { btn, name, angle: d.angle };
    });
    this.setHeading(0);
  }

  /**
   * 画面の上が向いている方位角（度。北=0、東=90）
   * @param {number} deg
   */
  setHeading(deg) {
    const q = ((Math.round(deg / 90) % 4) + 4) % 4;
    if (q === this.quadrant) return; // 描画のたびに呼ばれるので、変わったときだけ書き換える
    this.quadrant = q;
    for (const b of this.buttons) {
      const dir = CARDINALS[(q + b.angle / 90) % 4];
      b.btn.dataset.dir = dir;
      b.name.textContent = CARDINAL_NAMES[dir];
      b.btn.title = `${CARDINAL_NAMES[dir]}へ移動（領域の20%）`;
      b.btn.setAttribute('aria-label', b.btn.title);
    }
  }

  setVisible(visible) {
    this.el.classList.toggle('hidden', !visible);
  }

  setDisabled(disabled) {
    for (const b of this.buttons) b.btn.disabled = disabled;
  }
}
