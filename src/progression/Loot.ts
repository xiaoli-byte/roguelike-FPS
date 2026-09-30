import * as THREE from 'three';
import type { GameContext, IEnemy, ILoot, Rarity, RewardType, WeaponInstance } from '../core/types';
import { TAU } from '../core/math';
import { PickupManager } from './loot/Pickups';
import { WeaponDropManager } from './loot/WeaponDrops';
import { ChestManager } from './loot/Chests';
import { ShopManager } from './loot/Shop';

/**
 * 掉落与奖励：
 *  - 击杀掉落：金币（def.coins × 精英 3 × 章节 × 金币获取）、弹药（12%）、生命（8%），精英必掉，Boss 大量掉落。
 *  - 地上的武器、奖励宝箱、商店。
 *  - grant()：宝箱奖励发放；offerScrolls()：秘卷三选一（排队，保证一次只打开一个模态框）。
 * 所有物体挂在自己的 Group（加入 ctx.scene），clear() 时移除并注销交互。
 */

interface ScrollOffer {
  count: number;
  minRarity?: Rarity;
}

const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();

export class LootSystem implements ILoot {
  readonly group = new THREE.Group();
  private readonly pickups: PickupManager;
  private readonly weaponDrops: WeaponDropManager;
  private readonly chests: ChestManager;
  private readonly shop: ShopManager;
  private offers: ScrollOffer[] = [];

  constructor(readonly ctx: GameContext) {
    this.group.name = 'loot';
    this.pickups = new PickupManager(ctx, this.group);
    this.weaponDrops = new WeaponDropManager(ctx, this.group);
    this.chests = new ChestManager(ctx, this.group, (reward, pos) => this.grant(reward, pos));
    this.shop = new ShopManager(ctx, this.group, (pos, inst) => this.dropWeapon(pos, inst));
  }

  init(): void {
    const ctx = this.ctx;
    ctx.scene.add(this.group);
    ctx.events.on('enemy:killed', ({ enemy }) => this.onEnemyKilled(enemy));
    // 清关后自动吸取场上金币
    ctx.events.on('stage:cleared', () => this.pickups.vacuumCoins(0.8));
    // 每进入新的一关补给一部分备弹（第一关开局时本来就是满的，不受影响）
    ctx.events.on('stage:loaded', () => ctx.weapons.addAmmoFraction(0.35));
    ctx.events.on('run:started', () => {
      this.offers.length = 0;
    });
  }

  update(dt: number): void {
    this.pickups.update(dt);
    this.weaponDrops.update(dt);
    this.chests.update(dt);
    this.shop.update(dt);
    this.flushOffers();
  }

  clear(): void {
    this.pickups.clear();
    this.weaponDrops.clear();
    this.chests.clear();
    this.shop.clear();
  }

  // ───────────── ILoot ─────────────

  dropCoins(pos: THREE.Vector3, amount: number): void {
    this.pickups.dropCoins(pos, amount, amount >= 60 ? 1.8 : 1);
  }

  dropAmmo(pos: THREE.Vector3, fraction = 0.25): void {
    this.pickups.spawn('ammo', pos, fraction);
  }

  dropHealth(pos: THREE.Vector3, amount?: number): void {
    // amount 缺省时在拾取瞬间按最大生命 15% 计算
    this.pickups.spawn('health', pos, amount !== undefined && amount > 0 ? amount : 0);
  }

  dropWeapon(pos: THREE.Vector3, inst: WeaponInstance): void {
    this.weaponDrops.drop(pos, inst);
  }

  spawnChest(pos: THREE.Vector3, reward: RewardType): void {
    this.chests.spawn(pos, reward);
  }

  spawnShop(center: THREE.Vector3, facingYaw?: number): void {
    this.shop.spawn(center, facingYaw);
  }

  grant(reward: RewardType, pos: THREE.Vector3): void {
    const ctx = this.ctx;
    const stageType = ctx.run.stage.type;
    const isBoss = stageType === 'boss';
    const isElite = stageType === 'elite';
    const chapter = Math.max(0, ctx.run.chapter);
    const chapterMult = 1 + 0.35 * chapter;

    switch (reward) {
      case 'scroll':
        this.offerScrolls(3, isBoss || isElite ? 1 : undefined);
        break;
      case 'weapon': {
        const minRarity: Rarity | undefined = isBoss ? 3 : isElite ? 1 : undefined;
        const inst = ctx.weapons.roll({ chapter, minRarity });
        this.tossWeaponToward(pos, inst);
        if (isBoss) {
          // Boss 奖励：同时回满生命与护盾（与 StageDirector 的回满重复也无副作用）
          ctx.player.heal(ctx.player.maxHp());
          ctx.player.addShield(ctx.player.maxShield());
        }
        break;
      }
      case 'coins': {
        const base = ctx.rng.int(60, 120) * chapterMult * (isElite ? 1.4 : 1);
        const amount = Math.round(base * ctx.player.stats.mult('coinGainPct'));
        this.pickups.dropCoins(pos, amount, 1.7);
        break;
      }
      case 'heal': {
        ctx.player.stats.add('maxHp', 10, 'reward');
        ctx.player.heal(ctx.player.maxHp() * 0.5);
        ctx.audio.play('pickup_health');
        ctx.ui.toast('生命上限 +10，回复 50% 生命', '#4cff7a');
        _pos.copy(ctx.player.position);
        _pos.y += 1;
        ctx.fx.burst(_pos, 0x4cff7a, 26, 4, 0.7, 0.1, -3);
        break;
      }
      case 'upgrade': {
        const w = ctx.weapons.active;
        const cost = w ? ctx.weapons.upgradeCost(w) : null;
        if (w && cost !== null) {
          ctx.weapons.upgrade(w);
          const d = ctx.weapons.describe(w);
          ctx.ui.toast(`${d.name} 强化至 +${w.level}`, '#6fb8ff');
          ctx.audio.play('skill_buff', { volume: 0.7 });
          _pos.copy(ctx.player.position);
          _pos.y += 1;
          ctx.fx.burst(_pos, 0x4aa3ff, 24, 3.5, 0.6, 0.09, -2);
        } else {
          ctx.ui.toast(w ? '当前武器已满级，改为金币' : '没有可强化的武器，改为金币', '#ffd54a');
          this.pickups.dropCoins(pos, Math.round(80 * chapterMult * ctx.player.stats.mult('coinGainPct')), 1.5);
        }
        break;
      }
      case 'none':
      default:
        break;
    }
  }

  offerScrolls(count = 3, minRarity?: Rarity): void {
    this.offers.push({ count: Math.max(1, Math.floor(count)), minRarity });
    this.flushOffers();
  }

  // ───────────── 内部 ─────────────

  /** 一次只打开一个秘卷选择；其余排队，回到 playing 后依次打开 */
  private flushOffers(): void {
    const ctx = this.ctx;
    if (this.offers.length === 0 || ctx.game.state !== 'playing') return;
    const offer = this.offers.shift()!;
    let options = ctx.scrolls.roll(offer.count, { minRarity: offer.minRarity });
    if (options.length === 0 && offer.minRarity !== undefined) options = ctx.scrolls.roll(offer.count);
    if (options.length === 0) {
      const amount = Math.round(40 * offer.count * (1 + 0.35 * ctx.run.chapter));
      ctx.ui.toast('秘卷已全部满层，改为金币', '#ffd54a');
      _pos.copy(ctx.player.position);
      _pos.y += 1.2;
      this.pickups.dropCoins(_pos, amount, 1.2);
      return;
    }
    ctx.game.openModal();
    ctx.ui.showScrollChoice(options, (s) => ctx.scrolls.add(s.id));
  }

  /** 从宝箱位置向玩家方向抛出武器 */
  private tossWeaponToward(from: THREE.Vector3, inst: WeaponInstance): void {
    const p = this.ctx.player.position;
    const dx = p.x - from.x;
    const dz = p.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.3) _vel.set((dx / d) * 1.6, 5, (dz / d) * 1.6);
    else {
      const a = Math.random() * TAU;
      _vel.set(Math.cos(a) * 1.6, 5, Math.sin(a) * 1.6);
    }
    _pos.copy(from);
    _pos.y += 0.4;
    this.weaponDrops.drop(_pos, inst, _vel);
  }

  private onEnemyKilled(enemy: IEnemy): void {
    const ctx = this.ctx;
    const pos = enemy.getBodyCenter(_pos);
    const chapterMult = 1 + 0.35 * Math.max(0, ctx.run.chapter);
    const gain = ctx.player.stats.mult('coinGainPct');

    let [lo, hi] = enemy.def.coins ?? [0, 0];
    if (enemy.isBoss && hi <= 0) {
      lo = 60;
      hi = 100;
    }
    if (hi > 0) {
      let base = ctx.rng.int(Math.max(0, Math.round(lo)), Math.max(0, Math.round(hi)));
      if (enemy.isElite) base *= 3;
      const amount = Math.round(base * chapterMult * gain);
      if (amount > 0) this.pickups.dropCoins(pos, amount, enemy.isBoss ? 2.2 : enemy.isElite ? 1.4 : 1);
    }

    if (enemy.isBoss) {
      for (let i = 0; i < 2; i++) {
        this.pickups.spawn('ammo', pos, 0.25, 1.8);
        this.pickups.spawn('health', pos, 0, 1.8);
      }
      return;
    }
    if (enemy.isElite || ctx.rng.chance(0.3)) this.pickups.spawn('ammo', pos, 0.25);
    if (enemy.isElite || ctx.rng.chance(0.1)) this.pickups.spawn('health', pos, 0);
  }
}
