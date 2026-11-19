/**
 * 三领主的场地件与特效（Unity Fx.Feilian / Fx.Huashe / Fx.Kui 与 FeilianSpiral 的网页近似）：
 *   · Spiral：螺旋带柱（飞廉的风涡柱、龙卷风柱）——几条加法混合的螺旋管，按高度从窄到宽，绕竖轴转；能整体淡出、换火色。
 *   · FloodSheet：化蛇的涨水面（一张半透明水面圆盘，跟着水位升降；地形高出水面的地方自然盖住它）。
 *   · 其余一次性的声光（聚风、雪冠、珠碎、水花、鼓皮环、雷云……）用 ctx.fx 的粒子 / 冲击环 / 爆炸拼，精神对齐。
 * 与 Unity 的差异（M11b 再做逐粒子一致）：Unity 的手绘风带、风线贴地、水帘、潜游黑影、雷鼓裂光是专门的网格 / 着色器，这里都是 ctx.fx 的粒子。
 */
import * as THREE from 'three';
import type { GameContext } from '../../../core/types';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** 螺旋带柱（Unity FeilianSpiral）：bottom → top 半径，height 高，turns 圈数（每条），strands 条 */
export class Spiral {
  readonly group = new THREE.Group();
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private alpha = 1;
  private fadeLeft = -1;
  private fadeTotal = 0;
  private spin: number;
  private baseColor: number;
  private disposed = false;
  /** 反转（风眼：往里吸） */
  reversed = false;

  constructor(color: number, bottom: number, top: number, height: number, turnsDeg: number, strands = 4, spin = 2.2, thickness = 0.12) {
    this.baseColor = color;
    this.spin = spin;
    const turns = turnsDeg / 360;
    for (let s = 0; s < strands; s++) {
      const off = (s / strands) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      const n = 48;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const r = bottom + (top - bottom) * k;
        const a = off + k * turns * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.sin(a) * r, k * height, Math.cos(a) * r));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 64, thickness * (1 + s % 2), 5, false);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
      });
      this.geos.push(geo);
      this.mats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 3;
      this.group.add(m);
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.group.rotation.y += (this.reversed ? -1 : 1) * this.spin * dt;
    if (this.fadeLeft >= 0) {
      this.fadeLeft -= dt;
      this.setAlpha(Math.max(0, this.fadeLeft / Math.max(0.01, this.fadeTotal)));
      if (this.fadeLeft <= 0) this.dispose();
    }
  }

  setAlpha(a: number): void {
    this.alpha = Math.max(0, Math.min(1, a));
    for (const m of this.mats) m.opacity = 0.55 * this.alpha;
    this.group.visible = this.alpha > 0.01;
  }

  setFire(on: boolean, fire = 0xff8a3a): void {
    for (const m of this.mats) m.color.setHex(on ? fire : this.baseColor);
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
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
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
