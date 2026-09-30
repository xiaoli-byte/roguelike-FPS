import * as THREE from 'three';

/**
 * 商店价格牌 / 招牌：CanvasTexture 精灵。内容不变时不重绘。
 * 每个实例拥有自己的画布、贴图与材质，dispose() 释放。
 */

const FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
const W = 256;
const H = 128;

export interface TagContent {
  title: string;
  titleColor: string;
  /** 价格；null 表示不显示金币（用 note 文案代替） */
  price: number | null;
  /** 价格不可用时的说明（如「已售罄」「已满级」） */
  note?: string;
  affordable?: boolean;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** 方孔铜钱图标 */
function drawCoin(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.fillStyle = '#ffc23a';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8a5a10';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#3a2408';
  const h = r * 0.32;
  g.fillRect(cx - h, cy - h, h * 2, h * 2);
}

function fitFont(g: CanvasRenderingContext2D, text: string, weight: string, size: number, maxWidth: number): void {
  let s = size;
  g.font = `${weight} ${s}px ${FONT}`;
  while (s > 14 && g.measureText(text).width > maxWidth) {
    s -= 2;
    g.font = `${weight} ${s}px ${FONT}`;
  }
}

export class PriceTag {
  readonly sprite: THREE.Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private key = '';

  constructor(width = 1.3) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.set(width, width * (H / W), 1);
    this.sprite.renderOrder = 3;
  }

  set(c: TagContent): void {
    const key = `${c.title}|${c.titleColor}|${c.price}|${c.note ?? ''}|${c.affordable !== false}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    if (!g) return;

    g.clearRect(0, 0, W, H);
    roundRect(g, 6, 6, W - 12, H - 12, 18);
    g.fillStyle = 'rgba(16, 12, 18, 0.88)';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#d9a441';
    g.stroke();
    // 内描边
    roundRect(g, 14, 14, W - 28, H - 28, 12);
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(217, 164, 65, 0.45)';
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitFont(g, c.title, 'bold', 30, W - 44);
    g.fillStyle = c.titleColor;
    g.fillText(c.title, W / 2, 44);

    if (c.price !== null) {
      const text = String(c.price);
      g.font = `bold 40px ${FONT}`;
      const tw = g.measureText(text).width;
      const iconR = 15;
      const total = iconR * 2 + 10 + tw;
      const x0 = W / 2 - total / 2;
      drawCoin(g, x0 + iconR, 88, iconR);
      g.textAlign = 'left';
      g.fillStyle = c.affordable === false ? '#ff5a4f' : '#ffd54a';
      g.fillText(text, x0 + iconR * 2 + 10, 90);
    } else {
      fitFont(g, c.note ?? '', 'bold', 30, W - 44);
      g.fillStyle = '#9aa0a8';
      g.fillText(c.note ?? '', W / 2, 88);
    }
    this.texture.needsUpdate = true;
  }

  /** 单行招牌（例如「百宝商铺」） */
  setSign(text: string, color = '#ffd54a'): void {
    const key = `sign|${text}|${color}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    if (!g) return;
    g.clearRect(0, 0, W, H);
    roundRect(g, 4, 18, W - 8, H - 36, 10);
    g.fillStyle = 'rgba(122, 22, 26, 0.95)';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#d9a441';
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitFont(g, text, 'bold', 46, W - 40);
    g.fillStyle = color;
    g.fillText(text, W / 2, H / 2 + 2);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }
}
