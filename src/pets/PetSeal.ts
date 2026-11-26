import * as THREE from 'three';
import type { GameContext, Interactable, InteractPrompt } from '../core/types';
import { type PetDef, PET_GOLD, lerpRgb, rarityColor, rgbCss, rgbHex } from './PetDefs';
import { type PetModel, buildPetModel, disposePetModel } from './PetVisuals';
import { beamPillar, disposeObject, glowSprite, glowTexture, textLabel } from './PetFx';
import { groundY } from './Pet';

/**
 * 灵兽封印（照译 Unity G/Pets/PetSeal.cs；docs/pet-system.md 第 2 节）：地上一团带品阶光柱的封印，灵宠的身影缩小浮在里面慢慢转，两道符环交错旋转。
 * 神兽：更高更粗的金红光柱冲天、环绕金色火星（Unity 另有一盏金色点光：网页不加动态点光——加一盏会让场景里所有材质重新编译，改成光晕）。
 * 按 F 结契；已有灵宠时 = 换宠（旧的变回封印留在原地，灵契等级保留）。
 */

export interface SealHost {
  readonly ctx: GameContext;
  /** 当前结契的灵宠名（提示里「换下 X」；没有为 null） */
  currentName(): string | null;
  /** 结契（封印被按 F） */
  bindFrom(seal: PetSeal): void;
}

const UP = new THREE.Vector3(0, 1, 0);
let floorTex: THREE.Texture | null = null;

/** 地面光圈（径向渐变的方片，平放） */
function floorGlow(color: number, alpha: number, size: number): THREE.Mesh {
  floorTex ??= glowTexture();
  const mat = new THREE.MeshBasicMaterial({ map: floorTex, color, transparent: true, opacity: alpha, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(size);
  m.renderOrder = 1;
  return m;
}

/** 一道符环（细圆环，加法混合）：环在容器的 XZ 平面里，转容器 */
function ring(radius: number, color: number, width: number): THREE.Group {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, width * 0.5, 4, 40), mat);
  m.rotation.x = Math.PI / 2;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export class PetSeal {
  readonly def: PetDef;
  level: number;
  xp: number;
  /** 灵兽台上的（测试）：标签常亮 */
  fromAltar = false;
  /** 换下来的灵宠：灵技冷却结束时刻（ctx.time.now），换回来接着算 */
  cooldownEndsAt = 0;
  /** 结契过（换下来的）：再结契不重放神兽出场演出 */
  bound = false;
  readonly root = new THREE.Group();
  readonly interactable: Interactable;
  removed = false;

  private readonly velocity = new THREE.Vector3();
  private grounded = false;
  private age = 0;
  private readonly phase = Math.random() * 10;
  private readonly holder = new THREE.Group();
  private readonly spirit = new THREE.Group();
  private readonly turn = new THREE.Group();
  private model: PetModel | null = null;
  private ringA: THREE.Object3D | null = null;
  private ringB: THREE.Object3D | null = null;
  private readonly sparks: THREE.Sprite[] = [];
  private spiritBase = 1.15;
  private removeInteract: (() => void) | null = null;

  constructor(private readonly host: SealHost, def: PetDef, pos: THREE.Vector3, toss: THREE.Vector3 | null, level = 1, xp = 0) {
    this.def = def;
    this.level = Math.max(1, level);
    this.xp = xp;
    this.root.name = `灵兽封印 · ${def.name}`;
    this.root.position.copy(pos);
    this.velocity.copy(toss ?? new THREE.Vector3(0, 4, 0));
    const self = this;
    this.interactable = {
      position: new THREE.Vector3(),
      radius: 2.6,
      enabled: false,
      prompt: () => self.prompt(),
      onInteract: () => self.host.bindFrom(self),
    };
    this.build();
    host.ctx.scene.add(this.root);
    this.removeInteract = host.ctx.interact.add(this.interactable);
  }

  private build(): void {
    const ctx = this.host.ctx;
    const def = this.def;
    const c = rarityColor(def.rarity);
    const hex = rgbHex(c);
    const mythic = def.rarity === 2;
    this.root.add(this.holder);
    // 灵宠身影：缩到约 0.9 m 见方，包围盒中心对准封印中心
    this.holder.add(this.spirit);
    this.spirit.add(this.turn);
    const visual = new THREE.Group();
    this.turn.add(visual);
    this.model = buildPetModel(ctx, def, visual, { display: true });
    const s = Math.min(1, 0.9 / Math.max(0.3, this.model.size));
    visual.scale.setScalar(s);
    visual.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(visual);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      this.turn.worldToLocal(center);
      visual.position.sub(center);
    }
    visual.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = false;
    });
    this.spirit.position.y = this.spiritBase;

    // 封印：淡淡的光球 + 两道交错旋转的符环 + 地面光圈
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.725, 24, 16),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: mythic ? 0.12 : 0.07, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    shell.renderOrder = 2;
    this.spirit.add(shell);
    this.ringA = ring(0.82, hex, mythic ? 0.035 : 0.025);
    this.ringB = ring(0.74, rgbHex(mythic ? PET_GOLD : lerpRgb(c, [1, 1, 1], 0.4)), 0.02);
    this.spirit.add(this.ringA, this.ringB);
    this.spirit.add(glowSprite(c, mythic ? 0.45 : 0.3, mythic ? 2.6 : 1.8));
    const floor = floorGlow(hex, 0.55, mythic ? 3.4 : 2.2);
    floor.position.y = 0.04;
    this.holder.add(floor);

    // 品阶光柱；神兽额外一根金色冲天柱 + 环绕火星
    this.holder.add(beamPillar(c, mythic ? 0.45 : 0.3, mythic ? 1 : 0.7, mythic ? 7 : 3.4));
    if (mythic) {
      this.holder.add(beamPillar(PET_GOLD, 0.35, 2.2, 26));
      for (let i = 0; i < 8; i++) {
        const spark = glowSprite([1, 0.85, 0.45], 0.95, 0.35);
        this.holder.add(spark);
        this.sparks.push(spark);
      }
    }

    // 名牌：品阶 · 名字 / 称号
    const label = textLabel([
      { text: def.label, color: rgbCss(c), size: 40 },
      { text: def.title + (this.level > 1 ? ` · 灵契 Lv.${this.level}` : ''), color: '#ffffff', size: 25 },
    ], mythic ? 0.3 : 0.24);
    label.position.y = 2.25;
    this.holder.add(label);
  }

  // ── 交互 ──

  get canInteract(): boolean {
    return this.grounded || this.age > 0.6;
  }

  private prompt(): InteractPrompt {
    const cur = this.host.currentName();
    const lines = [this.def.title + (this.level > 1 ? ` · 灵契 Lv.${this.level}` : '')];
    if (cur) lines.push(`换下 ${cur}`);
    return { title: `灵兽封印 · ${this.def.label}`, subtitle: '结契', lines, color: rgbCss(rarityColor(this.def.rarity)) };
  }

  /** 从场景里拿走（结契 / 换关） */
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.removeInteract?.();
    this.removeInteract = null;
    this.interactable.enabled = false;
    this.root.removeFromParent();
    // 灵宠身影的几何体与资产共享：先摘下来单独释放，封印自己的光球 / 符环 / 光柱再整体释放
    this.turn.removeFromParent();
    if (this.model) disposePetModel(this.model);
    disposeObject(this.holder);
  }

  update(dt: number): void {
    if (this.removed) return;
    const ctx = this.host.ctx;
    this.age += dt;
    const pos = this.root.position;
    if (!this.grounded) {
      this.velocity.y -= 18 * dt;
      const next = pos.clone().addScaledVector(this.velocity, dt);
      if (this.velocity.y < 0) {
        const g = ctx.world.groundHeight(next.x, next.z, pos.y + 0.3);
        if (g > -Infinity && next.y <= g) {
          next.y = g;
          this.grounded = true;
          this.velocity.set(0, 0, 0);
          ctx.fx.impact(next, UP, undefined, 1.5);
        }
      }
      pos.copy(next);
      if (this.age > 6 && !this.grounded) {
        // 掉出地图：直接贴到地面
        pos.y = groundY(ctx, new THREE.Vector3(pos.x, pos.y + 10, pos.z));
        this.grounded = true;
      }
    }
    this.interactable.enabled = this.canInteract;
    this.interactable.position.copy(this.spirit.getWorldPosition(new THREE.Vector3())).addScaledVector(UP, -1);
    const t = this.age + this.phase;
    this.spirit.position.y = this.spiritBase + Math.sin(t * 1.8) * 0.08;
    this.turn.rotation.y += 40 * Math.PI / 180 * dt;
    // Unity Euler(20 + sin t × 10, t × 70, 0) / Euler(70, −t × 55, sin 0.7t × 15)：网页镜像绕 Y / Z 取反
    const D = Math.PI / 180;
    if (this.ringA) this.ringA.rotation.set((20 + Math.sin(t) * 10) * D, -t * 70 * D, 0, 'YXZ');
    if (this.ringB) this.ringB.rotation.set(70 * D, t * 55 * D, -Math.sin(t * 0.7) * 15 * D, 'YXZ');
    for (let i = 0; i < this.sparks.length; i++) {
      const a = t * 1.6 + i * Math.PI * 2 / this.sparks.length;
      this.sparks[i].position.set(Math.cos(a) * 1.15, 0.5 + (i % 4) * 0.45 + Math.sin(t * 2.4 + i) * 0.15, Math.sin(a) * 1.15);
    }
    this.model?.clips?.update(dt);
  }
}
