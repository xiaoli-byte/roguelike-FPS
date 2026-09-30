import * as THREE from 'three';
import type { GameContext, Interactable, WeaponInstance } from '../../core/types';
import { RARITY_COLORS } from '../../core/types';
import { TAU } from '../../core/math';
import { rarityBeam } from './assets';
import { stepToss } from './physics';
import type { TossState } from './physics';
import { weaponPrompt } from './weaponPrompt';

/**
 * 地上的武器：抛出落地后缓缓升起悬浮、旋转，脚下有稀有度色光柱。
 * 按 F 拾取：放入空槽或替换当前武器，被替换的武器掉在原地。
 */

const REST = 0.18;
const HOVER = 0.62;

interface WeaponDrop extends TossState {
  inst: WeaponInstance;
  root: THREE.Group;
  holder: THREE.Group;
  beam: THREE.Group;
  landed: boolean;
  groundY: number;
  age: number;
  hover: number;
  interactable: Interactable;
  remove: () => void;
}

const _p = new THREE.Vector3();

let fallbackGeo: THREE.BoxGeometry | null = null;
const fallbackMats = new Map<number, THREE.MeshStandardMaterial>();

/** 武器系统建模失败时的占位模型（缓存几何体与材质） */
function fallbackModel(inst: WeaponInstance): THREE.Object3D {
  fallbackGeo ??= new THREE.BoxGeometry(0.15, 0.15, 0.7);
  let m = fallbackMats.get(inst.rarity);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: RARITY_COLORS[inst.rarity], flatShading: true });
    fallbackMats.set(inst.rarity, m);
  }
  return new THREE.Mesh(fallbackGeo, m);
}

export class WeaponDropManager {
  private list: WeaponDrop[] = [];

  constructor(private readonly ctx: GameContext, private readonly group: THREE.Group) {}

  /**
   * 掉落一把武器。vel 为初速度（缺省：向随机方向小幅抛出）。
   */
  drop(pos: THREE.Vector3, inst: WeaponInstance, vel?: THREE.Vector3): void {
    const ctx = this.ctx;
    const root = new THREE.Group();
    const holder = new THREE.Group();
    let model: THREE.Object3D;
    try {
      model = ctx.weapons.createWorldModel(inst);
    } catch (err) {
      console.error('[Loot] createWorldModel threw', err);
      model = fallbackModel(inst);
    }
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    holder.add(model);
    root.add(holder);
    root.position.copy(pos);
    holder.rotation.y = Math.random() * TAU;

    const beam = rarityBeam(inst.rarity);
    beam.visible = false;
    beam.scale.set(1, 0.01, 1);
    this.group.add(root, beam);

    const d: WeaponDrop = {
      inst, root, holder, beam,
      pos: root.position,
      vel: new THREE.Vector3(),
      rest: REST,
      landed: false,
      groundY: pos.y,
      age: 0,
      hover: 0,
      interactable: null as unknown as Interactable,
      remove: () => {},
    };
    if (vel) {
      d.vel.copy(vel);
    } else {
      const a = Math.random() * TAU;
      d.vel.set(Math.cos(a) * 1.4, 4.4, Math.sin(a) * 1.4);
    }
    d.interactable = {
      position: root.position,
      radius: 2.1,
      enabled: false,
      prompt: () => weaponPrompt(ctx, inst, '拾取'),
      onInteract: () => this.pickUp(d),
    };
    d.remove = ctx.interact.add(d.interactable);
    this.list.push(d);
  }

  update(dt: number): void {
    const now = this.ctx.time.now;
    for (const d of this.list) {
      d.age += dt;
      if (!d.interactable.enabled && d.age > 0.25) d.interactable.enabled = true;

      if (!d.landed) {
        const g = stepToss(this.ctx, d, dt);
        d.holder.rotation.y += dt * 6;
        d.holder.rotation.z = Math.sin(d.age * 9) * 0.3;
        if (!Number.isNaN(g)) {
          d.landed = true;
          d.groundY = g;
          d.holder.rotation.z = 0;
          d.beam.visible = true;
          d.beam.position.set(d.pos.x, g, d.pos.z);
          _p.set(d.pos.x, g + 0.05, d.pos.z);
          this.ctx.fx.burst(_p, RARITY_COLORS[d.inst.rarity], 8, 1.8, 0.35, 0.06, 1);
        }
        continue;
      }

      // 落地后升起悬浮
      d.hover = Math.min(1, d.hover + dt * 1.8);
      const e = 1 - Math.pow(1 - d.hover, 3);
      d.pos.y = d.groundY + REST + e * HOVER + Math.sin(now * 2.1 + d.inst.uid) * 0.06 * e;
      d.holder.rotation.y += dt * 1.1;
      d.beam.scale.y = Math.max(0.01, e);
    }
  }

  clear(): void {
    for (const d of this.list) this.detach(d);
    this.list.length = 0;
  }

  // ───────────── 内部 ─────────────

  private pickUp(d: WeaponDrop): void {
    const ctx = this.ctx;
    if (!this.list.includes(d)) return;
    const desc = ctx.weapons.describe(d.inst);
    const base = _p.set(d.pos.x, d.landed ? d.groundY : d.pos.y, d.pos.z).clone();

    this.detach(d);
    this.list.splice(this.list.indexOf(d), 1);

    const old = ctx.weapons.give(d.inst);
    ctx.audio.play('pickup_weapon');
    ctx.events.emit('pickup', { kind: 'weapon', amount: 1 });
    base.y += 0.6;
    ctx.fx.burst(base, RARITY_COLORS[d.inst.rarity], 16, 3, 0.45, 0.08, 1);
    ctx.ui.toast(`获得武器：${desc.name}`, desc.color);

    if (old) {
      // 旧武器留在原地，轻轻弹起
      const a = Math.random() * TAU;
      this.drop(base, old, new THREE.Vector3(Math.cos(a) * 0.6, 3.2, Math.sin(a) * 0.6));
    }
  }

  private detach(d: WeaponDrop): void {
    d.remove();
    d.interactable.enabled = false;
    d.root.removeFromParent();
    d.beam.removeFromParent();
  }
}
