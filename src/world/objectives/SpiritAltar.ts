/**
 * 灵火坛（Unity Encounters/SpiritAltar.cs；第四章开放图规则 D27，docs/level-design/chuanzang-v1.md 2.6：「据点任意顺序，点亮 M 处里的 N 处灵火开出口」）：
 *   未点亮是暗的余烬；守卫场地（guard）肃清前点不着，提示「守卫未清」；按 F 开始点、按住 F kindleTime 秒点亮（离开或松手就断）；
 *   领主据点的坛不挂守卫、由领主点亮（关卡把它「封着」：交互只给提示「X 未平 · 打败它后灵火自动点亮」，Unity ZheduoLevel.LordAltarSeal）。
 *   点亮 = 青金色灵火 + 光柱 + 回满生命与护盾；进度由 LevelObjectives 计数。
 * 模型：石台 + 石柱 + 火盆 + 余烬（Unity BuildModel 的程序化体块；场景文档里已有四角石柱渲染件）。
 * 与 Unity 的差异：「灵火点亮」浮字换成提示条；Unity 的 LastLit（复活点）网页没有复活点系统，不记。
 */
import * as THREE from 'three';
import type { GameContext, Interactable, InteractPrompt } from '../../core/types';

/** 灵火色（青金，「灵火破晓」）与余烬色 */
export const FLAME_COLOR = 0x9ef0ff;
const EMBER = 0xff6b29;
const FLAME_CSS = '#9ef0ff';

export interface AltarSpec {
  name: string;
  title: string;
  position: [number, number, number];
  yaw: number;
  guard: string | null;
  lightOnGuardCleared: boolean;
  kindleTime: number;
  healOnLight: boolean;
}

export interface AltarHooks {
  /** 守卫场地肃清了没（没有守卫 = true） */
  guardCleared(title: string): boolean;
  /** 领主据点封着：返回领主名（null = 没封） */
  sealedBy(altarName: string): string | null;
  /** 点亮了 */
  onLit(altar: SpiritAltar): void;
}

const _a = new THREE.Vector3();

export class SpiritAltar {
  readonly group = new THREE.Group();
  readonly position: THREE.Vector3;
  lit = false;
  kindling = false;
  private kindleT = 0;
  private readonly flame: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly ember: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly item: Interactable;
  private readonly removeInteract: () => void;
  private readonly owned: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  private time = 0;

  constructor(private readonly ctx: GameContext, readonly spec: AltarSpec, parent: THREE.Object3D, private readonly hooks: AltarHooks) {
    this.position = new THREE.Vector3(spec.position[0], spec.position[1], spec.position[2]);
    this.group.name = `spiritAltar:${spec.name}`;
    this.group.position.copy(this.position);
    this.group.rotation.y = spec.yaw * Math.PI / 180;
    const stone = new THREE.MeshStandardMaterial({ color: 0x807870, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x383333, roughness: 0.9 });
    this.mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.4, 20), stone, 0.2);
    this.mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 12), stone, 0.75);
    this.mesh(new THREE.CylinderGeometry(0.58, 0.45, 0.22, 20), dark, 1.22);
    this.ember = this.mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 20), new THREE.MeshBasicMaterial({ color: EMBER }), 1.34);
    this.flame = this.mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshBasicMaterial({
      color: EMBER, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }), 1.35);
    this.beam = this.mesh(new THREE.CylinderGeometry(0.6, 0.6, 9, 16, 1, true), new THREE.MeshBasicMaterial({
      color: FLAME_COLOR, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }), 4.5);
    this.beam.visible = false;
    parent.add(this.group);
    this.item = {
      position: this.position.clone().setY(this.position.y + 1.2), radius: 3.2, enabled: true,
      prompt: () => this.prompt(),
      onInteract: () => this.interact(),
    };
    this.removeInteract = ctx.interact.add(this.item);
  }

  private mesh<G extends THREE.BufferGeometry, M extends THREE.Material>(g: G, m: M, y: number): THREE.Mesh<G, M> {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = y;
    this.group.add(mesh);
    this.owned.push({ geometry: g, material: m });
    return mesh;
  }

  /** 交互点（火盆上方） */
  get focus(): THREE.Vector3 {
    return _a.copy(this.position).setY(this.position.y + 1.2);
  }

  get progress(): number {
    return this.lit ? 1 : this.kindling ? Math.min(1, this.kindleT / Math.max(0.05, this.spec.kindleTime)) : 0;
  }

  private get guardBlocks(): boolean {
    return !!this.spec.guard && !this.hooks.guardCleared(this.spec.guard);
  }

  private prompt(): InteractPrompt {
    const sealed = this.lit ? null : this.hooks.sealedBy(this.spec.name);
    if (sealed) return { title: this.spec.title, subtitle: `${sealed}未平`, lines: [`${sealed}未平 · 打败它后灵火自动点亮`], color: '#ff9973', key: 'F' };
    const guard = this.guardBlocks;
    return {
      title: this.spec.title,
      subtitle: this.lit ? '已点亮' : guard ? '守卫未清' : this.kindling ? `点燃中 ${Math.round(this.progress * 100)}%` : '按住点亮',
      lines: guard ? [`先肃清「${this.spec.guard}」`] : ['点亮：回满生命与护盾'],
      color: guard ? '#ff9973' : FLAME_CSS, key: 'F',
    };
  }

  private interact(): void {
    if (this.lit || this.kindling) return;
    const sealed = this.hooks.sealedBy(this.spec.name);
    if (sealed) {
      this.ctx.audio.play('ui_deny');
      this.ctx.ui.toast(`${this.spec.title}：${sealed}未平 · 打败它后灵火自动点亮`, '#ffb57c');
      return;
    }
    if (this.guardBlocks) {
      this.ctx.audio.play('ui_deny');
      this.ctx.ui.toast(`${this.spec.title}：守卫还在，先肃清「${this.spec.guard}」`, '#ffb57c');
      return;
    }
    this.kindling = true;
    this.kindleT = 0;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    if (this.lit) {
      const flick = 0.85 + 0.15 * Math.sin(t * 9.3) * Math.sin(t * 5.1 + 1.3);
      this.flame.scale.setScalar(2.2 * flick);
      this.beam.material.opacity = 0.3 + 0.08 * Math.sin(t * 2.2);
    } else {
      const k = this.kindling ? this.progress : 0;
      this.flame.scale.setScalar((1.1 + 0.9 * k) * (0.9 + 0.1 * Math.sin(t * 3)));
      this.flame.material.color.setHex(k > 0 ? lerpColor(EMBER, FLAME_COLOR, k) : EMBER);
      this.flame.material.opacity = 0.4 + 0.4 * k;
    }
    this.item.enabled = !this.lit;
    if (!this.kindling) return;
    const pl = this.ctx.player;
    const holding = this.ctx.input.keyDown('KeyF');
    if (!pl.alive || this.guardBlocks || !holding || pl.eye.distanceTo(this.focus) > this.item.radius + 1) {
      this.kindling = false;
      this.kindleT = 0;
      return;
    }
    this.kindleT += dt;
    if (this.kindleT >= this.spec.kindleTime) this.light();
  }

  /** 点亮（交互按满、领主被打败、脚本 / 测试） */
  light(): void {
    if (this.lit) return;
    this.lit = true;
    this.kindling = false;
    this.flame.material.color.setHex(FLAME_COLOR);
    this.flame.material.opacity = 0.95;
    this.ember.material.color.setHex(FLAME_COLOR);
    this.beam.visible = true;
    const pl = this.ctx.player;
    if (this.spec.healOnLight && pl.alive) {
      pl.heal(pl.maxHp());
      pl.addShield(pl.maxShield());
    }
    const f = this.focus.clone();
    this.ctx.fx.explosion(f, 1.4, FLAME_COLOR);
    this.ctx.fx.ring(this.position.clone().setY(this.position.y + 0.1), 9, FLAME_COLOR, 1);
    this.ctx.audio.play('shield_recharge', { position: f });
    this.ctx.ui.toast(`${this.spec.title} · 灵火点亮`, FLAME_CSS);
    this.hooks.onLit(this);
  }

  dispose(): void {
    this.removeInteract();
    this.group.removeFromParent();
    for (const o of this.owned) {
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (s: number) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
