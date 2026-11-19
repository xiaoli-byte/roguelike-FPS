/**
 * 三领主的场地件与特效（Unity Fx.Feilian / Fx.Huashe / Fx.Kui 与 FeilianSpiral 的网页近似）：
 *   · Spiral：螺旋带柱（飞廉的风涡柱、龙卷风柱）——照 Unity FeilianSpiral 的三条竖向风带（收紧再外翻、转 3.2π、两层、两端渐隐），绕竖轴转；能整体淡出、换火色。
 *   · FloodSheet：化蛇的涨水面（一张半透明水面圆盘，跟着水位升降；地形高出水面的地方自然盖住它）。
 *   · 其余一次性的声光（聚风、雪冠、珠碎、水花、鼓皮环、雷云……）用 ctx.fx 的粒子 / 冲击环 / 爆炸拼，精神对齐。
 * 与 Unity 的差异（M11b 再做逐粒子一致）：Unity 的手绘风带、风线贴地、水帘、潜游黑影、雷鼓裂光是专门的网格 / 着色器，这里都是 ctx.fx 的粒子。
 */
import * as THREE from 'three';
import type { GameContext } from '../../../core/types';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/**
 * 螺旋带柱（Unity FeilianSpiral）：三条竖向宽度的风带，从底半径 r0 往上收紧再外翻到 r1（r = lerp(r0, r1, u²) × (1 + 0.15 sin πu)），
 * 全高转 3.2π；上层亮带 + 下层暗边（宽 1.45 倍）两层、两端渐隐（顶点色 alpha），普通透明混合；整体按 spinDeg 度 / 秒自转（负 = 反向）。
 * 能整体淡出、换火色（风 → 火：WindCore / Wind / WindEdge → FireCore / Fire / FireEdge）。
 */
export class Spiral {
  static readonly Ribbons = 3;
  static readonly Segs = 36;
  readonly group = new THREE.Group();
  private readonly top: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly under: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private alpha = 1;
  private fadeLeft = -1;
  private fadeTotal = 0;
  private disposed = false;
  private fire = false;
  /** 反转（风眼：往里吸） */
  reversed = false;

  /**
   * @param colors [亮芯, 主色, 暗边]（风；火色由 setFire 换）
   * @param spinDeg 每秒自转（度）
   */
  constructor(private readonly colors: readonly [number, number, number], r0: number, r1: number, height: number, private readonly spinDeg: number,
    ribbonWidth = 1, private readonly fireColors: readonly [number, number, number] = [0xffe08a, 0xff8a3a, 0xa8381a]) {
    this.under = this.ribbon(r0, r1, height, ribbonWidth * 1.45, -1);
    this.top = this.ribbon(r0, r1, height, ribbonWidth, 0);
    this.paint();
  }

  private ribbon(r0: number, r1: number, height: number, width: number, order: number): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let b = 0; b < Spiral.Ribbons; b++) {
      const start = pos.length / 3;
      const a0 = b * Math.PI * 2 / Spiral.Ribbons;
      for (let i = 0; i <= Spiral.Segs; i++) {
        const u = i / Spiral.Segs;
        const y = u * height;
        const r = (r0 + (r1 - r0) * u * u) * (1 + 0.15 * Math.sin(u * Math.PI));
        const a = a0 + u * Math.PI * 3.2;
        const w = (0.5 + 0.9 * u) * width;
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        pos.push(x, y + w * 0.5, z, x, y - w * 0.5, z);
        uv.push(u, 1, u, 0);
        if (i === 0) continue;
        const k = start + i * 2;
        idx.push(k - 2, k - 1, k, k, k - 1, k + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 4), 4));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 3 + order;
    this.group.add(m);
    return m;
  }

  /** 顶点色：两端渐隐、中段实；亮带的上沿偏亮（芯） */
  private paint(): void {
    const [core, body, edge] = this.fire ? this.fireColors : this.colors;
    const paint = (m: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>, c0: number, c1: number, a: number) => {
      const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute;
      const col = m.geometry.getAttribute('color') as THREE.BufferAttribute;
      const cb = new THREE.Color(c0), ch = new THREE.Color(c1), c = new THREE.Color();
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        const fade = Math.min(1, Math.max(0, u / 0.12)) * Math.min(1, Math.max(0, (1 - u) / 0.2));
        c.copy(cb).lerp(ch, v * 0.6);
        col.setXYZW(i, c.r, c.g, c.b, a * fade);
      }
      col.needsUpdate = true;
    };
    paint(this.top, body, core, 0.85);
    paint(this.under, edge, edge, 0.6);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const spin = (this.reversed ? -1 : 1) * this.spinDeg * (this.fire ? 1.6 : 1);
    this.group.rotation.y += spin * Math.PI / 180 * dt;
    if (this.fadeLeft >= 0) {
      this.fadeLeft -= dt;
      this.setAlpha(Math.max(0, this.fadeLeft / Math.max(0.01, this.fadeTotal)));
      if (this.fadeLeft <= 0) this.dispose();
    }
  }

  setAlpha(a: number): void {
    this.alpha = Math.max(0, Math.min(1, a));
    this.top.material.opacity = this.alpha;
    this.under.material.opacity = this.alpha;
    this.group.visible = this.alpha > 0.01;
  }

  setFire(on: boolean): void {
    if (this.fire === on) return;
    this.fire = on;
    this.paint();
  }

  fadeOut(seconds: number): void {
    if (this.fadeLeft >= 0) return;
    this.fadeLeft = this.fadeTotal = Math.max(0.05, seconds);
  }

  get done(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const m of [this.top, this.under]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}

/** 化蛇的涨水面：一张半透明圆盘，中心 / 半径固定，高度跟着水位 */
export class FloodSheet {
  readonly mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;

  constructor(parent: THREE.Object3D, center: THREE.Vector3, radius: number, color: number) {
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.62, roughness: 0.15, metalness: 0.05, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.copy(center);
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
  }

  set level(y: number) {
    this.mesh.position.y = y;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** 一次性的声光（ctx.fx 拼） */
export const LordFx = {
  /** 聚风：风痕往 p 收（strength 0..1） */
  gather(ctx: GameContext, p: THREE.Vector3, color: number, size = 4, strength = 0.5): void {
    ctx.fx.burst(p, color, Math.max(2, Math.round(4 + strength * 6)), -size * 0.8, 0.45, 0.16, 0);
  },
  /** 雪冠 / 落地炸开一圈雪 */
  snowCrown(ctx: GameContext, p: THREE.Vector3, size: number, color = 0xe6f0f8): void {
    ctx.fx.burst(_a.copy(p).setY(p.y + 0.3), color, Math.round(18 * size), 5 * size, 0.9, 0.3, 6);
    ctx.fx.ring(_b.copy(p).setY(p.y + 0.08), 3 * size, color, 0.6);
  },
  /** 一锥狂风（from 起往 dir 吹 range） */
  gust(ctx: GameContext, from: THREE.Vector3, dir: THREE.Vector3, range: number, color: number): void {
    for (let i = 1; i <= 6; i++) {
      const k = i / 6;
      _a.copy(from).addScaledVector(dir, range * k * 0.85);
      _a.y += 1.2;
      ctx.fx.burst(_a, color, 8, 6 + 6 * k, 0.6, 0.3 + k * 0.4, 0);
    }
  },
  /** 撞击（冲撞撞上 / 咬中 / 砸中） */
  impact(ctx: GameContext, p: THREE.Vector3, color: number, big: boolean): void {
    ctx.fx.burst(p, color, big ? 30 : 14, big ? 9 : 5, 0.7, 0.32, 8);
    if (big) ctx.fx.ring(_a.copy(p).setY(p.y - 1), 5, color, 0.5);
  },
  /** 珠碎 / 鼓面炸开 */
  shatter(ctx: GameContext, p: THREE.Vector3, core: number, color: number): void {
    ctx.fx.explosion(p, 1.6, color);
    ctx.fx.burst(p, core, 36, 10, 0.9, 0.22, 2);
  },
  /** 星光（出手前 0.25 s 的白星） */
  glint(ctx: GameContext, p: THREE.Vector3, color: number): void {
    ctx.fx.burst(p, color, 10, 2.5, 0.25, 0.4, 0);
  },
  /** 圆形冲击（风雷爆、捶胸） */
  blast(ctx: GameContext, p: THREE.Vector3, radius: number, color: number, core: number): void {
    ctx.fx.ring(_a.copy(p).setY(p.y + 0.1), radius, color, 0.6);
    ctx.fx.ring(_b.copy(p).setY(p.y + 0.1), radius * 0.6, core, 0.45);
    ctx.fx.burst(_a.copy(p).setY(p.y + 1), core, 40, radius * 0.9, 0.7, 0.35, 0);
  },
  /** 水花（吐水落地、扑岸、破水） */
  splash(ctx: GameContext, p: THREE.Vector3, size: number, color = 0x7fdcd6, foam = 0xf4fffc): void {
    ctx.fx.burst(_a.copy(p).setY(p.y + 0.2), foam, Math.round(14 * size), 4 * size, 0.8, 0.28, 9);
    ctx.fx.burst(_b.copy(p).setY(p.y + 0.1), color, Math.round(10 * size), 3 * size, 1.0, 0.36, 7);
  },
  /** 涟漪 */
  ripple(ctx: GameContext, p: THREE.Vector3, radius: number, color = 0x7fdcd6): void {
    ctx.fx.ring(_a.copy(p).setY(p.y + 0.05), radius, color, 0.9);
  },
  /** 尘土（落地、拳撑地） */
  dust(ctx: GameContext, p: THREE.Vector3, size: number, count: number, color = 0x8a7a60): void {
    ctx.fx.burst(_a.copy(p).setY(p.y + 0.2), color, Math.max(3, count * 3), 3 * size, 0.9, 0.4 * size, 3);
  },
};
