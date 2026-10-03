import * as THREE from 'three';
import type { GameContext, Interactable, InteractPrompt, Rarity, ScrollDef, WeaponInstance } from '../../core/types';
import { RARITY_COLORS, RARITY_CSS, RARITY_NAMES } from '../../core/types';
import { DEG } from '../../core/math';
import type { StaticBox } from '../../world/Collision';
import {
  cssColor, makeAmmoCrateModel, makeAnvil, makeBeam, makePotionModel, makeScrollModel, makeStall, PALETTE,
} from './assets';
import { clampToArena, facingTarget, facingToward, groundAt } from './physics';
import { PriceTag } from './PriceTag';
import { weaponPrompt } from './weaponPrompt';

/**
 * 商店：弧形排列的摊位（武器 ×2、秘卷 ×1–2、生命药剂、弹药箱）+ 居中的强化台。
 * 摊位上悬浮展示商品模型，头顶是 CanvasTexture 价格牌；按 F 购买。
 */

const WEAPON_PRICES: readonly number[] = [60, 100, 160, 240, 360];
const SCROLL_PRICES: readonly number[] = [80, 110, 145, 185, 220];
const POTION_PRICE = 40;
const AMMO_PRICE = 20;
const POTION_HEAL = 0.4;
const ARC_RADIUS = 6.4;
const ARC_STEP = 25 * DEG;
const TAG_REFRESH = 0.25;
const DENY_COLOR = '#ff5a4f';

type StallKind = 'weapon' | 'scroll' | 'potion' | 'ammo' | 'upgrade';

interface StallSpec {
  kind: StallKind;
  price: number;
  weapon?: WeaponInstance;
  scroll?: ScrollDef;
}

interface Stall {
  kind: StallKind;
  root: THREE.Group;
  display: THREE.Group;
  displayY: number;
  spin: number;
  tag: PriceTag;
  focus: THREE.Vector3;
  /** 摊位前方（掉落被替换下来的武器） */
  front: THREE.Vector3;
  price: number;
  /** 价格牌标题与颜色（构建时确定） */
  label: string;
  labelColor: string;
  sold: boolean;
  weapon: WeaponInstance | null;
  scroll: ScrollDef | null;
  rune: THREE.Object3D | null;
  box: StaticBox | null;
  phase: number;
  interactable: Interactable;
  remove: () => void;
}

const _p = new THREE.Vector3();

export class ShopManager {
  private stalls: Stall[] = [];
  private signs: PriceTag[] = [];
  private refreshTimer = 0;
  private upgradePreview: { key: string; lines: string[] } | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly group: THREE.Group,
    private readonly dropWeapon: (pos: THREE.Vector3, inst: WeaponInstance) => void,
  ) {}

  spawn(center: THREE.Vector3, facingYaw?: number): void {
    const ctx = this.ctx;
    const chapter = Math.max(0, ctx.run.chapter);
    const factor = 1 + 0.25 * chapter;
    const price = (base: number): number => Math.max(5, Math.round((base * factor) / 5) * 5);

    // facingYaw：商店正面朝向（模型约定 facing = atan2(dx, dz)）；缺省朝向玩家 / 出生点
    const yaw = facingYaw !== undefined && Number.isFinite(facingYaw) ? facingYaw : facingToward(center, facingTarget(ctx));

    // 商品清单（玩家视角从左到右），强化台居中
    const w1 = ctx.weapons.roll({ chapter });
    const w2 = ctx.weapons.roll({ chapter, minRarity: (chapter >= 1 ? 2 : 1) as Rarity });
    const scrolls = ctx.scrolls.roll(ctx.rng.chance(0.5) ? 2 : 1);
    const scrollSpec = (s: ScrollDef): StallSpec => ({ kind: 'scroll', scroll: s, price: price(SCROLL_PRICES[s.rarity] ?? 150) });

    const left: StallSpec[] = [{ kind: 'weapon', weapon: w1, price: price(WEAPON_PRICES[w1.rarity] ?? 100) }];
    if (scrolls[0]) left.push(scrollSpec(scrolls[0]));
    left.push({ kind: 'potion', price: price(POTION_PRICE) });
    const right: StallSpec[] = [{ kind: 'ammo', price: price(AMMO_PRICE) }];
    if (scrolls[1]) right.push(scrollSpec(scrolls[1]));
    right.push({ kind: 'weapon', weapon: w2, price: price(WEAPON_PRICES[w2.rarity] ?? 100) });
    const specs: StallSpec[] = [...left, { kind: 'upgrade', price: 0 }, ...right];
    const mid = left.length;

    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    let signPos: THREE.Vector3 | null = null;
    for (let i = 0; i < specs.length; i++) {
      // 局部坐标：+Z 指向玩家一侧，摊位围在中心后方的弧上
      const a = (i - mid) * ARC_STEP;
      const lx = Math.sin(a) * ARC_RADIUS;
      const lz = -Math.cos(a) * ARC_RADIUS;
      _p.set(center.x + lx * cy + lz * sy, center.y, center.z - lx * sy + lz * cy);
      clampToArena(ctx, _p, 1.6);
      const gy = groundAt(ctx, _p.x, _p.z, center.y + 2.5);
      const facing = Math.atan2(center.x - _p.x, center.z - _p.z);
      this.buildStall(specs[i], _p.x, gy, _p.z, facing);
      if (specs[i].kind === 'upgrade') signPos = new THREE.Vector3(_p.x, gy + 3.35, _p.z);
    }

    if (signPos) {
      const sign = new PriceTag(2.6);
      sign.setSign('百宝商铺');
      sign.sprite.position.copy(signPos);
      this.group.add(sign.sprite);
      this.signs.push(sign);
    }
  }

  update(dt: number): void {
    if (this.stalls.length === 0) return;
    const now = this.ctx.time.now;
    for (const s of this.stalls) {
      if (!s.sold) {
        s.display.rotation.y += s.spin * dt;
        s.display.position.y = s.displayY + Math.sin(now * 2 + s.phase) * 0.05;
      }
      if (s.rune) {
        s.rune.rotation.x = Math.PI / 2 + Math.sin(now * 1.3 + s.phase) * 0.25;
        s.rune.rotation.z += dt * 1.5;
        s.rune.position.y = 1.45 + Math.sin(now * 2) * 0.05;
      }
    }
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = TAG_REFRESH;
      for (const s of this.stalls) this.refreshTag(s);
    }
  }

  clear(): void {
    const world = this.ctx.world;
    for (const s of this.stalls) {
      s.remove();
      s.tag.dispose();
      s.root.removeFromParent();
      if (s.box) world.remove(s.box);
    }
    this.stalls.length = 0;
    for (const sign of this.signs) sign.dispose();
    this.signs.length = 0;
    this.upgradePreview = null;
  }

  // ───────────── 构建 ─────────────

  private buildStall(spec: StallSpec, x: number, y: number, z: number, facing: number): void {
    const ctx = this.ctx;
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = facing;
    const display = new THREE.Group();
    let displayY = 1.3;
    let tagY = 1.98;
    let rune: THREE.Object3D | null = null;

    switch (spec.kind) {
      case 'weapon': {
        const inst = spec.weapon!;
        root.add(makeStall(RARITY_COLORS[inst.rarity]));
        try {
          display.add(ctx.weapons.createWorldModel(inst));
        } catch (err) {
          console.error('[Shop] createWorldModel threw', err);
        }
        break;
      }
      case 'scroll':
        root.add(makeStall(RARITY_COLORS[spec.scroll!.rarity]));
        display.add(makeScrollModel(spec.scroll!.rarity));
        break;
      case 'potion':
        root.add(makeStall(0xff5a6a));
        display.add(makePotionModel());
        displayY = 1.22;
        break;
      case 'ammo':
        root.add(makeStall(PALETTE.gold));
        display.add(makeAmmoCrateModel());
        displayY = 1.12;
        break;
      case 'upgrade': {
        const anvil = makeAnvil();
        root.add(anvil.root);
        root.add(makeBeam(PALETTE.rune, 3.2));
        rune = anvil.rune;
        displayY = 0;
        tagY = 2.25;
        break;
      }
    }
    display.position.set(0, displayY, 0.02);
    root.add(display);

    const tag = new PriceTag(1.25);
    tag.sprite.position.set(0, tagY, 0.12);
    root.add(tag.sprite);
    this.group.add(root);

    // 碰撞：桌子 / 铁砧（与玩家当前位置重叠时跳过，避免把玩家卡住）
    const half = spec.kind === 'upgrade' ? 0.5 : 0.62;
    const pl = ctx.player.position;
    let box: StaticBox | null = null;
    if (Math.abs(pl.x - x) > half + 0.45 || Math.abs(pl.z - z) > half + 0.45) {
      box = ctx.world.addBox(x - half, y, z - half, x + half, y + 0.86, z + half, 'prop');
    }

    const stall: Stall = {
      kind: spec.kind,
      root, display, displayY,
      spin: spec.kind === 'weapon' ? 0.9 : 1.3,
      tag,
      focus: new THREE.Vector3(x, y + (spec.kind === 'upgrade' ? 0.95 : 1.15), z),
      front: new THREE.Vector3(x + Math.sin(facing) * 1.4, y + 0.8, z + Math.cos(facing) * 1.4),
      price: spec.price,
      label: '',
      labelColor: '',
      sold: false,
      weapon: spec.weapon ?? null,
      scroll: spec.scroll ?? null,
      rune,
      box,
      phase: Math.random() * 10,
      interactable: null as unknown as Interactable,
      remove: () => {},
    };
    stall.interactable = {
      position: stall.focus,
      radius: 2.3,
      enabled: true,
      prompt: () => this.prompt(stall),
      onInteract: () => this.buy(stall),
    };
    stall.remove = ctx.interact.add(stall.interactable);
    stall.label = this.tagTitle(stall);
    stall.labelColor = this.tagColor(stall);
    this.refreshTag(stall);
    this.stalls.push(stall);
  }

  // ───────────── 交易 ─────────────

  private buy(s: Stall): void {
    const ctx = this.ctx;
    if (s.sold) return;
    const w = ctx.weapons;
    let price = s.price;

    switch (s.kind) {
      case 'potion':
        if (ctx.player.hp >= ctx.player.maxHp() - 0.01) return this.deny('生命已满');
        break;
      case 'ammo':
        if (!this.needsAmmo()) return this.deny('弹药已满');
        break;
      case 'scroll':
        if (s.scroll && ctx.scrolls.stacks(s.scroll.id) >= s.scroll.maxStacks) return this.deny('该秘卷已达最大层数');
        break;
      case 'upgrade': {
        const a = w.active;
        if (!a) return this.deny('没有可强化的武器');
        const cost = w.upgradeCost(a);
        if (cost === null) return this.deny('当前武器已满级');
        price = cost;
        break;
      }
      default:
        break;
    }
    if (ctx.run.coins < price) return this.deny('金币不足');

    ctx.run.coins -= price;
    ctx.events.emit('coins:changed', { coins: ctx.run.coins, delta: -price });
    ctx.audio.play('buy');
    _p.copy(s.focus);

    switch (s.kind) {
      case 'weapon': {
        const inst = s.weapon!;
        const desc = w.describe(inst);
        const old = w.give(inst);
        ctx.events.emit('pickup', { kind: 'weapon', amount: 1 });
        ctx.ui.toast(`购得武器：${desc.name}`, desc.color);
        ctx.fx.burst(_p, RARITY_COLORS[inst.rarity], 18, 3, 0.5, 0.08, 1);
        if (old) this.dropWeapon(s.front.clone(), old);
        this.markSold(s);
        break;
      }
      case 'scroll':
        ctx.fx.burst(_p, RARITY_COLORS[s.scroll!.rarity], 18, 3, 0.5, 0.08, 1);
        ctx.scrolls.add(s.scroll!.id);
        this.markSold(s);
        break;
      case 'potion': {
        const healed = ctx.player.heal(ctx.player.maxHp() * POTION_HEAL);
        ctx.audio.play('pickup_health');
        ctx.ui.toast(`生命药剂：回复 ${Math.round(healed)} 生命`, '#ff8a96');
        ctx.fx.burst(_p, 0xff5a6a, 16, 2.5, 0.5, 0.08, -1);
        this.markSold(s);
        break;
      }
      case 'ammo':
        w.addAmmoFraction(1);
        ctx.audio.play('pickup_ammo');
        ctx.ui.toast('弹药箱：备弹已补满', '#ffd54a');
        ctx.fx.burst(_p, PALETTE.gold, 14, 2.5, 0.45, 0.07, 2);
        this.markSold(s);
        break;
      case 'upgrade': {
        const a = w.active!;
        w.upgrade(a);
        const desc = w.describe(a);
        ctx.ui.toast(`${desc.name} 强化至 +${a.level}`, '#6fb8ff');
        _p.set(s.focus.x, s.focus.y + 0.5, s.focus.z);
        ctx.fx.burst(_p, PALETTE.rune, 24, 3.5, 0.6, 0.09, -1);
        ctx.fx.ring(s.root.position, 1.8, PALETTE.rune, 0.4);
        ctx.audio.play('skill_buff', { volume: 0.6 });
        this.refreshTag(s);
        break;
      }
    }
  }

  private markSold(s: Stall): void {
    s.sold = true;
    s.display.visible = false;
    s.interactable.enabled = false;
    s.remove();
    this.refreshTag(s);
  }

  private deny(msg: string): void {
    this.ctx.audio.play('ui_deny');
    this.ctx.ui.toast(msg, DENY_COLOR);
  }

  private needsAmmo(): boolean {
    const w = this.ctx.weapons;
    for (const inst of w.slots) {
      if (inst && inst.reserve < w.reserveCapacity(inst)) return true;
    }
    return false;
  }

  // ───────────── 提示与价格牌 ─────────────

  private prompt(s: Stall): InteractPrompt {
    const ctx = this.ctx;
    switch (s.kind) {
      case 'weapon':
        return weaponPrompt(ctx, s.weapon!, '购买', s.price);
      case 'scroll': {
        const d = s.scroll!;
        const have = ctx.scrolls.stacks(d.id);
        const lines = [d.description];
        if (have >= d.maxStacks) lines.push('已达最大层数，无法购买');
        const owned = have > 0 ? ` · 已有 ${have}/${d.maxStacks} 层` : '';
        return {
          title: d.name,
          subtitle: `购买 · ${RARITY_NAMES[d.rarity]}秘卷${owned}`,
          lines,
          color: RARITY_CSS[d.rarity],
          cost: s.price,
        };
      }
      case 'potion': {
        const full = ctx.player.hp >= ctx.player.maxHp() - 0.01;
        return {
          title: '生命药剂',
          subtitle: `购买 · 立即回复 ${Math.round(POTION_HEAL * 100)}% 生命`,
          lines: full ? ['生命已满'] : [],
          color: '#ff8a96',
          cost: s.price,
        };
      }
      case 'ammo':
        return {
          title: '弹药箱',
          subtitle: '购买 · 补满所有武器的备弹',
          lines: this.needsAmmo() ? [] : ['弹药已满'],
          color: '#ffd54a',
          cost: s.price,
        };
      case 'upgrade': {
        const w = ctx.weapons;
        const a = w.active;
        if (!a) return { title: '强化台', subtitle: '没有可强化的武器', color: '#6fb8ff' };
        const d = w.describe(a);
        const cost = w.upgradeCost(a);
        if (cost === null) {
          return { title: '强化台', subtitle: `${d.name} 已满级`, lines: [`强化等级 ${a.level}（已满）`], color: '#6fb8ff' };
        }
        return {
          title: '强化台',
          subtitle: `强化 · ${d.name} +${a.level} → +${a.level + 1}`,
          lines: this.upgradeLines(a),
          color: '#6fb8ff',
          cost,
        };
      }
    }
  }

  /** 强化预览：伤害与秒伤的变化（按武器 / 等级 / 属性版本缓存，提示每 0.2 秒刷新一次） */
  private upgradeLines(a: WeaponInstance): string[] {
    const w = this.ctx.weapons;
    const key = `${a.uid}|${a.level}|${a.rarity}|${a.element}|${a.affixes.length}|${this.ctx.player.stats.version}`;
    if (this.upgradePreview && this.upgradePreview.key === key) return this.upgradePreview.lines;
    const lines = ['每级武器伤害 +12%'];
    try {
      const now = w.describe(a);
      const next = w.describe({ ...a, level: a.level + 1 });
      for (const label of ['伤害', '秒伤']) {
        const x = now.stats.find((s) => s.label === label)?.value;
        const y = next.stats.find((s) => s.label === label)?.value;
        if (x && y && x !== y) lines.push(`${label}  ${x} → ${y} ▲`);
      }
    } catch (err) {
      console.error('[Shop] upgrade preview threw', err);
    }
    this.upgradePreview = { key, lines };
    return lines;
  }

  private refreshTag(s: Stall): void {
    const ctx = this.ctx;
    const coins = ctx.run.coins;
    if (s.sold) {
      s.tag.set({ title: s.label, titleColor: '#6f747c', price: null, note: '已售罄' });
      return;
    }
    if (s.kind === 'upgrade') {
      const a = ctx.weapons.active;
      const cost = a ? ctx.weapons.upgradeCost(a) : null;
      if (!a) s.tag.set({ title: '强化台', titleColor: '#6fb8ff', price: null, note: '无武器' });
      else if (cost === null) s.tag.set({ title: '强化台', titleColor: '#6fb8ff', price: null, note: '已满级' });
      else s.tag.set({ title: `强化 +${a.level + 1}`, titleColor: '#6fb8ff', price: cost, affordable: coins >= cost });
      return;
    }
    s.tag.set({ title: s.label, titleColor: s.labelColor, price: s.price, affordable: coins >= s.price });
  }

  private tagTitle(s: Stall): string {
    switch (s.kind) {
      case 'weapon':
        return this.ctx.weapons.describe(s.weapon!).name;
      case 'scroll':
        return s.scroll!.name;
      case 'potion':
        return '生命药剂';
      case 'ammo':
        return '弹药箱';
      default:
        return '强化台';
    }
  }

  private tagColor(s: Stall): string {
    switch (s.kind) {
      case 'weapon':
        return RARITY_CSS[s.weapon!.rarity];
      case 'scroll':
        return RARITY_CSS[s.scroll!.rarity];
      case 'potion':
        return '#ff8a96';
      case 'ammo':
        return cssColor(0xffd54a);
      default:
        return '#6fb8ff';
    }
  }
}
