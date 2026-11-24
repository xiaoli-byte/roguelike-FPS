import * as THREE from 'three';
import type { Element, GameContext, PetSave, RunState, System } from '../core/types';
import type { PetDefView, PetSource, PetView } from '../ui/PetData';
import { PET_TAG } from '../combat/PetContract';
import { type PetDef, type PetRarity, PET_GOLD, PET_LIBRARY, defView, getPetDef, petForReward, rarityColor, rgbCss, rgbHex, rollPet } from './PetDefs';
import { AWAKEN_LEVEL, MAX_LEVEL, Pet, type PetHost, type StoneSpec, flat, groundY } from './Pet';
import { BEHAVIOURS, type PetZoneHandle } from './PetBehaviours';
import { PetFxSystem, disposeObject, glowSprite, textLabel } from './PetFx';
import { PetSeal, type SealHost } from './PetSeal';
import { instantiatePart } from './PetVisuals';
import { clipData } from '../anim/ClipPlayer';

/**
 * 灵宠系统（照译 Unity G/Pets/PetOwner.cs + PetBootstrap.cs + PetHud.cs，以及 LootDirector 的精英掉封印、PetReward 奖励串）：
 *   · 结契 / 换宠（旧灵宠变回封印留在它现在的位置，灵契等级、经验、灵技冷却都留着）、G 键灵技、任何敌人被击杀给灵契经验（普通 1、精英 4）；
 *   · 每局只带 1 只；跨关：每帧把 { id, 灵契等级 / 经验, 灵技冷却剩余 } 写进 ctx.run.pet（进关快照 / 续玩档跟着存），
 *     新一关 stage:loaded 时按快照重新结契（Unity PetOwner.Restore：按「换回来」处理，神兽不再放出场演出，冷却接着算）；
 *   · 掉落：精英被击杀 6% 掉一个随机封印（Unity EconomyConfig.ElitePetChance）；宝箱 / 藏宝点奖励串 "pet" / "pet:<id>" / "pet:rarity=<0–2>"；
 *   · 嘲讽：被灵宠讙嘲讽的敌人（EnemyBase.taunted）打不到玩家——Combat 的受伤修饰器把它们的伤害记 0（Unity EnemyAI.HitTarget / spirit 弹丸）；
 *   · 界面：UIManager.setPetSource（HUD 灵宠面板、行囊灵宠页、图鉴灵宠页签）；
 *   · 调试：?debug 时 window.__pets（give / altar / skill / xp / swap…）；?petAltar 时进关在出生点旁摆灵兽台（八只灵宠的封印）。
 * 场景里的东西（封印、火石、蚀雾、特效）在 clear()（Game.clearStage：换关 / 新开一局 / 回主菜单）收走；灵宠本体在回主菜单 / 新开一局时解除。
 */

export const NORMAL_XP = 1;
export const ELITE_XP = 4;
/** 精英被击杀掉灵兽封印的概率（Unity EconomyConfig.ElitePetChance） */
export const ELITE_PET_CHANCE = 0.06;

/** 灵宠快照（Unity PetSave，定义在 core/types：RunState.pet） */
export type { PetSave };

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();

interface Stone {
  spec: StoneSpec;
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  owner: Pet;
}

class Zone implements PetZoneHandle {
  readonly center: THREE.Vector3;
  next: number;
  circleUntil: number;
  readonly glow: THREE.Sprite;
  dead = false;

  constructor(private readonly sys: PetSystem, readonly owner: Pet, center: THREE.Vector3, readonly radius: number, public until: number,
    readonly damage: number, readonly element: Element, readonly chance: number, readonly color: readonly [number, number, number]) {
    this.center = center.clone();
    const now = sys.ctx.time.now;
    this.next = now + 0.25;
    this.circleUntil = until;
    sys.ctx.fx.groundWarning(this.center, radius, until - now, rgbHex(color));
    this.glow = glowSprite(color, 0.25, radius * 2.4);
    this.glow.position.copy(this.center).addScaledVector(UP, 0.4);
    sys.fx.group.add(this.glow);
  }

  get alive(): boolean {
    return !this.dead && this.sys.ctx.time.now < this.until;
  }

  /** 续期到 seconds 秒后；上一圈预警快结束时再画一圈 */
  refresh(seconds: number): void {
    const now = this.sys.ctx.time.now;
    this.until = Math.max(this.until, now + seconds);
    if (now < this.circleUntil - 0.1) return;
    this.sys.ctx.fx.groundWarning(this.center, this.radius, this.until - now, rgbHex(this.color));
    this.circleUntil = this.until;
  }

  update(): boolean {
    const now = this.sys.ctx.time.now;
    if (this.owner.released || now >= this.until) return false;
    if (now < this.next) return true;
    this.next += 0.5;
    const from = _v.copy(this.center).addScaledVector(UP, 1).clone();
    for (const d of this.owner.enemiesNear(new THREE.Vector3().copy(this.center).addScaledVector(UP, 0.5), this.radius + 1.5)) {
      if (flat(d.position, this.center) <= this.radius) this.owner.hit(d, this.damage, { element: this.element, statusChance: this.chance, from });
    }
    return true;
  }

  dispose(): void {
    this.dead = true;
    this.glow.removeFromParent();
    this.glow.material.dispose();
  }
}

/** UIManager 上灵宠用到的方法（IUI 之外） */
interface PetUi {
  setPetSource?(source: PetSource | null): void;
  floatText?(pos: THREE.Vector3, text: string, color?: number | string, scale?: number): void;
  screenFlash?(color: [number, number, number, number], seconds: number): void;
  keys?: { codes(id: 'petSkill'): string[] };
}

export class PetSystem implements System, PetHost, SealHost {
  readonly fx: PetFxSystem;
  /** 当前结契的灵宠（Unity PetOwner.Current） */
  current: Pet | null = null;
  /** 当前灵宠属于哪一局（只往这一局的 run.pet 里写：开新局 / 继续征程时 Game 先换 ctx.run 再清场，不能把上一局的灵宠写进新局） */
  private petRun: RunState | null = null;
  readonly seals: PetSeal[] = [];
  private stones: Stone[] = [];
  private zones: Zone[] = [];
  private castStamp = 0;
  private viewCache: PetView | null = null;
  private catalogCache: PetDefView[] | null = null;
  private encounterPhase = new Map<string, string>();
  private altarPlaced = false;
  private altarLabel: THREE.Object3D | null = null;
  private readonly listeners: (() => void)[] = [];
  /** 界面数据（UIManager.setPetSource）：HUD 灵宠面板、行囊灵宠页、图鉴灵宠页签 */
  readonly uiSource: PetSource = { current: () => this.view(), catalog: () => this.catalog() };
  /** 结契 / 解除 / 放灵技的回调（测试 / 调试） */
  onBound: ((pet: Pet) => void) | null = null;
  onSkillCast: ((pet: Pet) => void) | null = null;

  constructor(readonly ctx: GameContext) {
    this.fx = new PetFxSystem(ctx);
  }

  private get ui(): PetUi {
    return this.ctx.ui as unknown as PetUi;
  }

  // ───────────── System ─────────────

  init(): void {
    const ctx = this.ctx, ev = ctx.events;
    this.fx.attach();
    // 八只的动画数据（每只 30–80 KB）开局就读：结契的那一刻就有骨骼动画，不先露一帧绑定姿势（Unity 预制体自带控制器）
    for (const d of PET_LIBRARY) void clipData(d.assetId);
    this.ui.setPetSource?.(this.uiSource);
    this.listeners.push(
      ev.on('enemy:killed', ({ enemy, result }) => {
        if (result.request.tags?.includes('purge')) return;
        // 灵契经验：任何敌人被击杀（普通 1、精英 4）
        if (this.current) this.current.addXp(enemy.isElite ? ELITE_XP : NORMAL_XP);
        // 精英掉封印（首领不掉：Unity 首领包另算）
        if (enemy.isElite && !enemy.isBoss && ctx.rng.chance(ELITE_PET_CHANCE)) {
          this.dropSeal(rollPet(() => ctx.rng.next()), enemy.getBodyCenter(new THREE.Vector3()), null, 1, 0, true);
        }
      }),
      ev.on('enemy:damaged', ({ enemy, result }) => {
        const req = result.request;
        const pet = this.current;
        if (!pet) return;
        if (req.source === 'pet' || req.tags?.includes(PET_TAG)) {
          pet.damageDealt += result.dealt;
          return;
        }
        // 玩家正在打的目标：记 3 s（反应伤害不算）
        if (!req.tags?.includes('reaction') && enemy.alive && (req.source === 'weapon' || req.source === 'skill' || req.source === 'explosion' || req.source === 'melee')) {
          pet.notePlayerTarget(enemy);
        }
      }),
      ev.on('stage:loaded', () => this.onStageLoaded()),
      ev.on('run:started', () => {
        // 新开一局 / 继续征程：上一局的灵宠解除；继续征程的那只等进关时按快照（ctx.run.pet）结契
        this.dropCurrent();
        this.petRun = null;
        this.altarPlaced = false;
      }),
      ev.on('game:stateChanged', ({ to }) => {
        if (to === 'menu') {
          this.dropCurrent();
          this.clear();
        }
      }),
      // 被嘲讽的敌人打不到玩家（Unity EnemyAI.HitTarget：打在灵体诱饵上无效；spirit 弹丸不伤玩家）
      ctx.combat.addIncomingModifier((_amount, _element, source) => (source && (source as unknown as { taunted?: boolean }).taunted ? 0 : 1)),
    );
    // 宝箱 / 藏宝点的灵宠奖励（LootSystem.grant 的 'pet' 交给这里）
    (ctx.loot as unknown as { petReward?: (reward: string, pos: THREE.Vector3) => void }).petReward = (reward, pos) => this.grantReward(reward, pos);
    if (ctx.game.debug) this.installDebug();
  }

  update(dt: number): void {
    const ctx = this.ctx;
    // G：灵技（输入启用、鼠标锁定之类由 input.enabled 体现）
    if (this.current && ctx.input.enabled && ctx.player.alive && this.skillPressed()) this.tryCast();
    this.current?.update(dt);
    for (let i = this.seals.length - 1; i >= 0; i--) {
      const s = this.seals[i];
      if (s.removed) this.seals.splice(i, 1);
      else s.update(dt);
    }
    this.updateStones(dt);
    for (let i = this.zones.length - 1; i >= 0; i--) {
      if (!this.zones[i].update()) {
        this.zones[i].dispose();
        this.zones.splice(i, 1);
      }
    }
    this.fx.update(dt);
    this.watchEncounters();
    this.syncRun();
  }

  /** 换关 / 新开一局 / 回主菜单：收走场景里的东西（封印、火石、蚀雾、特效）；灵宠本体留着（进关时按快照重新结契） */
  clear(): void {
    this.syncRun();
    for (const s of this.seals) s.remove();
    this.seals.length = 0;
    for (const st of this.stones) this.killStone(st);
    this.stones.length = 0;
    for (const z of this.zones) z.dispose();
    this.zones.length = 0;
    this.fx.clear();
    this.encounterPhase.clear();
    if (this.altarLabel) {
      this.altarLabel.removeFromParent();
      disposeObject(this.altarLabel);
      this.altarLabel = null;
    }
  }

  // ───────────── 结契（PetOwner） ─────────────

  /**
   * 结契：生成灵宠（出场弹出 + 横幅）。已有灵宠时旧的变回封印留在它现在的位置（带着灵契等级）。
   * at = 灵宠出现的位置（默认玩家身侧）；cooldownEndsAt = 灵技冷却结束时刻（换回来不刷新冷却）；rebind = 结契过又换回来的（神兽不再放「神兽现世」演出）
   */
  bind(def: PetDef | null, level = 1, xp = 0, at: THREE.Vector3 | null = null, cooldownEndsAt = 0, rebind = false): Pet | null {
    if (!def) return null;
    const ctx = this.ctx;
    const now = ctx.time.now;
    const f = ctx.player.getForward(new THREE.Vector3()).setY(0);
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
    f.normalize();
    const right = new THREE.Vector3(-f.z, 0, f.x);
    const pos = at ? at.clone() : ctx.player.position.clone().addScaledVector(right, 1.4).addScaledVector(f, -0.6);
    const old = this.current;
    if (old) {
      this.current = null;
      old.release();
      const seal = this.dropSeal(old.def, old.position.clone().addScaledVector(UP, 0.6), new THREE.Vector3(0, 3, 0), old.level, old.xp);
      seal.cooldownEndsAt = now + old.skillLeft;
      seal.bound = true;
      old.dispose();
    }
    const make = BEHAVIOURS[def.behaviour];
    if (!make) {
      console.error(`[pets] 没有 ${def.id} 的行为（${def.behaviour}）`);
      return null;
    }
    const pet = Pet.spawn(this, def, make(), pos, Math.atan2(f.x, f.z), level, xp, cooldownEndsAt - now);
    this.current = pet;
    this.petRun = ctx.run;
    this.announce(def, rebind);
    this.syncRun();
    this.onBound?.(pet);
    return pet;
  }

  /** 解除结契（不留封印，测试 / 剧情用） */
  unbind(): void {
    const old = this.current;
    if (!old) return;
    this.current = null;
    old.release();
    this.fx.burst(old.center(), old.def.rarityColor, 2, 0.4);
    old.dispose();
    this.syncRun();
  }

  /** 回主菜单 / 新开一局：直接拿走，不出特效 */
  private dropCurrent(): void {
    const old = this.current;
    this.current = null;
    old?.dispose();
  }

  private announce(def: PetDef, rebind: boolean): void {
    const pet = this.current!;
    if (def.rarity === 2 && !rebind) {
      // 神兽：大横幅 + 金色光柱冲天 + 全屏金光
      this.banner('神兽现世', undefined, 3.2);
      this.fx.pillar(pet.position, PET_GOLD, 2.4, 30, 2.6);
      this.fx.pillar(pet.position, rarityColor(2), 1, 30, 2.2);
      this.flash([1, 0.82, 0.4, 0.45], 0.9);
      this.fx.burst(_v.copy(pet.position).addScaledVector(UP, 1), [1, 0.9, 0.7], 4 * 0.7, 0.15);
    } else {
      this.banner(`结契 · ${def.label}`, undefined, 2.2);
      this.fx.pillar(pet.position, def.rarityColor, 1, 6, 1.2);
    }
    this.toast(def.rarity === 2 && !rebind
      ? `结契 · 神兽 ${def.name} · ${def.title}　[G] ${def.skillName}`
      : `${def.title} · ${def.role}　[G] ${def.skillName}`, undefined, 3.2);
  }

  /** 放灵技：成功时 castStamp 加一（HUD 灵技盘闪一下）；冷却中提示 */
  tryCast(): boolean {
    const pet = this.current;
    if (!pet) return false;
    if (!pet.tryCast()) {
      if (pet.skillLeft > 0) this.toast(`${pet.def.skillName} 冷却中 ${pet.skillLeft.toFixed(0)} 秒`, undefined, 0.8);
      return false;
    }
    this.castStamp++;
    this.onSkillCast?.(pet);
    return true;
  }

  private skillPressed(): boolean {
    const input = this.ctx.input;
    const codes = this.ui.keys?.codes('petSkill') ?? ['KeyG'];
    for (const c of codes) if (input.keyPressed(c)) return true;
    return false;
  }

  // ───────────── 跨关 / 存档 ─────────────

  /** 快照（Unity PetOwner.Capture） */
  capture(): PetSave | null {
    const p = this.current;
    return p ? { id: p.def.id, level: p.level, xp: p.xp, cooldownLeft: p.skillLeft } : null;
  }

  /** 把快照写进当前局（进关快照 / 续玩档跟着存） */
  private syncRun(): void {
    const run = this.ctx.run;
    if (!run || !run.heroId || run !== this.petRun) return;
    const s = this.capture();
    if (!s) {
      if (run.pet) run.pet = null;
      return;
    }
    if (!run.pet) run.pet = { ...s };
    else Object.assign(run.pet, s);
  }

  /** 新一关：按快照重新结契（Unity PetOwner.Restore：换回来，不放神兽演出，冷却接着算）；?petAltar 摆灵兽台 */
  private onStageLoaded(): void {
    const ctx = this.ctx;
    const save = ctx.run.pet;
    const old = this.current;
    this.current = null;
    old?.dispose();
    const def = save ? getPetDef(save.id) : null;
    if (save && def) {
      try {
        this.bind(def, Math.max(1, save.level), Number.isFinite(save.xp) ? save.xp : 0, null, ctx.time.now + (Number.isFinite(save.cooldownLeft) ? save.cooldownLeft : 0), true);
      } catch (err) {
        console.error('[pets] 进关重新结契失败', err);
      }
    }
    if (new URLSearchParams(location.search).has('petAltar') && !this.altarPlaced) this.placeAltar();
  }

  // ───────────── 掉落 / 封印 ─────────────

  /** 落一个封印：抛出 toss 后落地；announce = 掉落提示（神兽：「神兽现世」横幅 + 金色光柱冲天） */
  dropSeal(def: PetDef, pos: THREE.Vector3, toss: THREE.Vector3 | null = null, level = 1, xp = 0, announce = false): PetSeal {
    const seal = new PetSeal(this, def, pos, toss, level, xp);
    this.seals.push(seal);
    if (announce) {
      if (def.rarity === 2) {
        this.banner('神兽现世', undefined, 3);
        this.toast(`灵兽封印 · ${def.label}`, undefined, 3);
        this.flash([1, 0.82, 0.4, 0.4], 0.9);
        this.fx.pillar(pos, PET_GOLD, 3, 40, 3);
      } else this.toast(`灵兽封印 · ${def.label}`, undefined, 2.5);
    }
    return seal;
  }

  /** 宝箱 / 藏宝点奖励（Unity PetReward）：封印落在宝箱前方，朝玩家抛一点 */
  grantReward(reward: string, at: THREE.Vector3): void {
    const ctx = this.ctx;
    const def = petForReward(reward, () => Math.random());
    const to = _v.subVectors(ctx.player.position, at).setY(0);
    if (to.lengthSq() > 1e-4) to.normalize();
    const toss = to.multiplyScalar(1.4).addScaledVector(UP, 4.5).clone();
    this.dropSeal(def, at.clone().addScaledVector(UP, 0.4), toss, 1, 0, true);
  }

  currentName(): string | null {
    return this.current?.def.name ?? null;
  }

  /** 封印被按 F：拿走封印，在它的位置结契 */
  bindFrom(seal: PetSeal): void {
    if (seal.removed) return;
    const at = seal.root.position.clone();
    seal.remove();
    this.bind(seal.def, seal.level, seal.xp, at, seal.cooldownEndsAt, seal.bound);
  }

  /**
   * 灵兽台（测试便利，Unity PetAltar + PetBootstrap.PlaceTestAltar）：在玩家（出生点）周围挑一块开阔平地，八只灵宠的封印摆成朝玩家敞开的半圆。
   * 候选点按八个封印位的落差、出生点看过去有没有遮挡、在不在导航网格上打分，正前方 40° 内是去场地 ① 的路，不放
   */
  placeAltar(): void {
    const ctx = this.ctx;
    this.altarPlaced = true;
    const radius = 7;
    const player = ctx.player.position.clone();
    const f = ctx.player.getForward(new THREE.Vector3()).setY(0);
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
    f.normalize();
    const eye = player.clone().addScaledVector(UP, 1.6);
    const baseY = groundY(ctx, player.clone().addScaledVector(UP, 2));
    let bestCenter = player.clone().addScaledVector(f, -12), bestFacing = f.clone(), best = Infinity;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      const dir = f.clone().applyAxisAngle(UP, i * 22.5 * Math.PI / 180);
      const off = dir.angleTo(f) * 180 / Math.PI;
      if (off < 40) continue;
      for (const dist of [10, 13, 16]) {
        const c = player.clone().addScaledVector(dir, dist);
        const facing = dir.clone().negate();
        const right = new THREE.Vector3().crossVectors(UP, facing);
        let cost = dist * 0.05 + (180 - off) * 0.004;
        for (let k = 0; k < 8; k++) {
          const a = Math.PI * k / 7;
          const p = c.clone().addScaledVector(right, -Math.cos(a) * radius).addScaledVector(facing, -Math.sin(a) * radius);
          const y = groundY(ctx, tmp.set(p.x, p.y + 30, p.z));
          cost += Math.abs(y - baseY);
          p.y = y + 1;
          if (ctx.world.segmentBlocked(eye, p)) cost += 3;
          if (!ctx.nav.isWalkable(p.x, p.z)) cost += 1;
        }
        if (cost < best) {
          best = cost;
          bestCenter = c;
          bestFacing = facing;
        }
      }
    }
    // 半圆从左端经过最深处到右端，开口朝向出生点
    const right = new THREE.Vector3().crossVectors(UP, bestFacing);
    const away = bestFacing.clone().negate();
    PET_LIBRARY.forEach((def, i) => {
      const a = Math.PI * i / (PET_LIBRARY.length - 1);
      const p = bestCenter.clone().addScaledVector(right, -Math.cos(a) * radius).addScaledVector(away, Math.sin(a) * radius);
      p.y = groundY(ctx, tmp.set(p.x, p.y + 5, p.z)) + 0.05;
      const seal = this.dropSeal(def, p, new THREE.Vector3(0, -0.1, 0));
      seal.fromAltar = true;
    });
    const title = bestCenter.clone().addScaledVector(away, radius + 1.2);
    title.y = groundY(ctx, tmp.set(title.x, title.y + 5, title.z)) + 3.6;
    const label = textLabel([{ text: '灵兽台', color: '#ffd27a', size: 44 }, { text: '（测试）凡灵 · 灵兽 · 神兽', color: '#ffffff', size: 26 }], 0.42);
    label.position.copy(title);
    ctx.scene.add(label);
    this.altarLabel = label;
  }

  // ───────────── 火石 / 蚀雾（PetHost） ─────────────

  throwStone(spec: StoneSpec): void {
    const owner = this.current;
    if (!owner) return;
    const obj = new THREE.Group();
    const part = spec.partId ? instantiatePart(spec.partId) : null;
    if (part) {
      part.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      const box = new THREE.Box3().setFromObject(part);
      const size = box.getSize(new THREE.Vector3());
      part.scale.setScalar(spec.size / Math.max(1e-3, Math.max(size.x, size.y, size.z)));
      obj.add(part);
    } else {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshStandardMaterial({ color: 0x736b66, roughness: 0.9 }));
      ball.scale.setScalar(spec.size);
      obj.add(ball);
    }
    obj.add(glowSprite(spec.glow, 0.8, 0.8));
    obj.position.copy(spec.from);
    this.fx.group.add(obj);
    this.stones.push({ spec, obj, pos: spec.from.clone(), vel: spec.velocity.clone(), life: spec.life, owner });
  }

  private updateStones(dt: number): void {
    if (this.stones.length === 0) return;
    const ctx = this.ctx;
    const hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };
    for (let i = this.stones.length - 1; i >= 0; i--) {
      const s = this.stones[i];
      s.life -= dt;
      s.vel.y -= s.spec.gravity * dt;
      const step = s.vel.clone().multiplyScalar(dt);
      const len = step.length();
      let at: THREE.Vector3 | null = null;
      if (len > 1e-6) {
        const dir = step.clone().divideScalar(len);
        let best = len + s.spec.radius;
        const e = ctx.enemies.raycast(s.pos, dir, best);
        if (e) {
          best = e.distance;
          at = e.point.clone();
        }
        if (ctx.world.raycast(s.pos, dir, best, hit)) at = hit.point.clone();
      }
      const prev = s.pos.clone();
      if (!at) {
        s.pos.add(step);
        const g = ctx.world.groundHeight(s.pos.x, s.pos.z, prev.y + 0.05);
        if (g > -Infinity && s.pos.y <= g) at = new THREE.Vector3(s.pos.x, g, s.pos.z);
      }
      if (at || s.life <= 0) {
        this.detonateStone(s, at ?? s.pos);
        this.stones.splice(i, 1);
        continue;
      }
      s.obj.position.copy(s.pos);
      s.obj.rotation.x += dt * 9;
      // 余烬拖尾（Unity TrailRenderer 0.25 s）：一段段短促的曳光
      ctx.fx.tracer(prev, s.pos, rgbHex(s.spec.glow), 0.07);
    }
  }

  private detonateStone(s: Stone, at: THREE.Vector3): void {
    if (!s.owner.released) this.ctx.combat.explode(at, s.spec.explodeRadius, s.spec.request, { noFx: true, falloff: 0.5 });
    try {
      s.spec.onImpact?.(at.clone());
    } catch (err) {
      console.error('[pets] 火石落地特效出错', err);
    }
    this.killStone(s);
  }

  private killStone(s: Stone): void {
    s.obj.removeFromParent();
    s.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.dispose();
    });
  }

  spawnZone(pet: Pet, center: THREE.Vector3, radius: number, duration: number, damage: number, element: Element, chance: number,
    color: readonly [number, number, number]): PetZoneHandle {
    const z = new Zone(this, pet, center, radius, this.ctx.time.now + duration, damage, element, chance, color);
    this.zones.push(z);
    return z;
  }

  // ───────────── 据点肃清（当康「丰穰」） ─────────────

  /** 一处据点从开打变成肃清（首领场不算，同 Unity EncounterSite.AnySiteCleared） */
  private watchEncounters(): void {
    const list = this.ctx.stage.exploration?.encounters;
    if (!list) return;
    for (const e of list) {
      const was = this.encounterPhase.get(e.id);
      if (was !== e.phase) {
        this.encounterPhase.set(e.id, e.phase);
        if (was === 'active' && e.phase === 'cleared' && !e.id.startsWith('boss:')) this.current?.behaviour.onSiteCleared();
      }
    }
  }

  // ───────────── PetHost：界面门面 ─────────────

  floatText(pos: THREE.Vector3, text: string, color: readonly [number, number, number], scale: number): void {
    this.ui.floatText?.(pos, text, rgbCss(color), scale);
  }

  banner(title: string, sub?: string, seconds?: number): void {
    this.ctx.ui.banner(title, sub, seconds);
  }

  toast(text: string, color?: readonly [number, number, number], _seconds?: number): void {
    this.ctx.ui.toast(text, color ? rgbCss(color) : undefined);
  }

  flash(rgba: readonly [number, number, number, number], seconds: number): void {
    this.ui.screenFlash?.([rgba[0], rgba[1], rgba[2], rgba[3]], seconds);
  }

  leveledUp(): void {
    this.syncRun();
  }

  // ───────────── PetSource（界面数据） ─────────────

  catalog(): readonly PetDefView[] {
    return this.catalogCache ??= PET_LIBRARY.map(defView);
  }

  private view(): PetView | null {
    const p = this.current;
    if (!p) return null;
    let v = this.viewCache;
    if (!v || v.def.id !== p.def.id) {
      v = this.viewCache = {
        def: defView(p.def), level: 1, maxLevel: MAX_LEVEL, awakenLevel: AWAKEN_LEVEL, awakened: false, xp: 0, xpNext: 0,
        skillLeft: 0, skillCooldown: 0, skillReady: true, busy: false, damageDealt: 0, castStamp: 0,
      };
    }
    v.level = p.level;
    v.awakened = p.awakened;
    v.xp = p.xp;
    v.xpNext = p.xpNext;
    v.skillLeft = p.skillLeft;
    v.skillCooldown = p.skillCooldown;
    v.skillReady = p.skillReady;
    v.busy = p.isBusy;
    v.damageDealt = p.damageDealt;
    v.castStamp = this.castStamp;
    return v;
  }

  // ───────────── 调试 ─────────────

  private installDebug(): void {
    const sys = this;
    const api = {
      /** 八只的 id */
      ids: () => PET_LIBRARY.map((d) => d.id),
      /** 直接结契（id / 资产 id），可给等级 */
      give: (id: string, level = 1) => sys.bind(getPetDef(id), level),
      /** 在玩家面前掉一个封印 */
      seal: (id: string) => {
        const def = getPetDef(id);
        if (!def) return null;
        const p = sys.ctx.player.position.clone().addScaledVector(sys.ctx.player.getForward(new THREE.Vector3()).setY(0).normalize(), 3);
        return sys.dropSeal(def, p.addScaledVector(UP, 1), null, 1, 0, true);
      },
      altar: () => sys.placeAltar(),
      skill: () => sys.tryCast(),
      /** 冷却清零再放 */
      forceSkill: () => {
        if (sys.current) sys.current.skillLeft = 0;
        return sys.tryCast();
      },
      xp: (n: number) => sys.current?.addXp(n),
      unbind: () => sys.unbind(),
      get pet() { return sys.current; },
      get seals() { return sys.seals; },
      rollRarity: (r?: PetRarity) => rollPet(Math.random, r ?? null).id,
      sys,
    };
    (window as unknown as Record<string, unknown>).__pets = api;
  }
}
