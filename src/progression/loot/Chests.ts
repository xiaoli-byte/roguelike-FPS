import * as THREE from 'three';
import type { GameContext, Interactable, InteractPrompt, RewardType } from '../../core/types';
import { clamp01 } from '../../core/math';
import { cssColor, makeBeam, makeChest, REWARD_COLORS } from './assets';
import type { ChestModel } from './assets';
import { facingTarget, facingToward, groundAt } from './physics';
import { weaponRewardHint } from './rewardRules';

/**
 * 奖励宝箱：从空中落下 → 待机（宝石脉动、盖子偶尔轻颤）→ 按 F 开启（开盖动画 + 音效）→ 发放奖励。
 */

const DROP_TIME = 0.42;
const SETTLE_TIME = 0.62;
const OPEN_TIME = 0.5;
const GRANT_AT = 0.32;

type ChestState = 'spawn' | 'idle' | 'open' | 'done';

interface Chest {
  reward: RewardType;
  color: number;
  model: ChestModel;
  beam: THREE.Group;
  base: THREE.Vector3;
  focus: THREE.Vector3;
  state: ChestState;
  t: number;
  landed: boolean;
  granted: boolean;
  phase: number;
  interactable: Interactable;
  remove: () => void;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

const _p = new THREE.Vector3();

export class ChestManager {
  private list: Chest[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly group: THREE.Group,
    private readonly onGrant: (reward: RewardType, pos: THREE.Vector3) => void,
  ) {}

  spawn(pos: THREE.Vector3, reward: RewardType): void {
    const ctx = this.ctx;
    const color = REWARD_COLORS[reward] ?? REWARD_COLORS.none;
    const model = makeChest(color);
    const g = groundAt(ctx, pos.x, pos.z, pos.y + 2);
    const base = new THREE.Vector3(pos.x, g, pos.z);

    model.root.rotation.y = facingToward(base, facingTarget(ctx));
    model.root.position.set(base.x, base.y + 1.6, base.z);

    const beam = makeBeam(color, 5);
    beam.position.copy(base);
    beam.scale.set(1, 0.01, 1);
    this.group.add(model.root, beam);

    const chest: Chest = {
      reward, color, model, beam, base,
      focus: new THREE.Vector3(base.x, base.y + 0.6, base.z),
      state: 'spawn', t: 0, landed: false, granted: false,
      phase: Math.random() * 10,
      interactable: null as unknown as Interactable,
      remove: () => {},
    };
    chest.interactable = {
      position: chest.focus,
      radius: 2.3,
      enabled: false,
      prompt: () => this.prompt(chest),
      onInteract: () => this.open(chest),
    };
    chest.remove = ctx.interact.add(chest.interactable);
    this.list.push(chest);
    ctx.fx.spawnEffect(base, color);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    for (const c of this.list) {
      c.t += dt;
      const root = c.model.root;
      switch (c.state) {
        case 'spawn': {
          if (c.t < DROP_TIME) {
            const k = c.t / DROP_TIME;
            root.position.y = c.base.y + 1.6 * (1 - k * k);
          } else {
            root.position.y = c.base.y;
            if (!c.landed) {
              c.landed = true;
              _p.set(c.base.x, c.base.y + 0.05, c.base.z);
              ctx.fx.ring(_p, 1.5, c.color, 0.4);
              ctx.fx.burst(_p, 0xcdb89a, 12, 2.5, 0.45, 0.08, 4);
              ctx.audio.play('land', { position: c.base, volume: 0.8, pitch: 0.7 });
            }
            // 落地压扁回弹
            const k = clamp01((c.t - DROP_TIME) / (SETTLE_TIME - DROP_TIME));
            const squash = Math.sin(k * Math.PI) * 0.14 * (1 - k);
            root.scale.set(1 + squash, 1 - squash, 1 + squash);
          }
          c.beam.scale.y = Math.max(0.01, clamp01(c.t / SETTLE_TIME));
          if (c.t >= SETTLE_TIME) {
            root.scale.set(1, 1, 1);
            c.state = 'idle';
            c.t = 0;
            c.interactable.enabled = true;
          }
          break;
        }
        case 'idle': {
          const pulse = Math.sin((c.t + c.phase) * 4);
          c.model.gemMat.emissiveIntensity = 1.3 + pulse * 0.5;
          // 每隔一段时间盖子轻轻颤动，暗示里面有东西
          const rattle = Math.max(0, Math.sin((c.t + c.phase) * 2.2));
          c.model.lid.rotation.x = -0.06 * Math.pow(rattle, 12);
          break;
        }
        case 'open': {
          const k = clamp01(c.t / OPEN_TIME);
          c.model.lid.rotation.x = -1.95 * easeOutBack(k);
          c.model.innerMat.opacity = 0.9 * Math.min(1, k * 2) * (1 - clamp01((c.t - 0.8) / 1.6) * 0.7);
          c.model.gemMat.emissiveIntensity = Math.max(0.15, 1.6 * (1 - k));
          c.beam.scale.y = Math.max(0.01, 1 - k);
          if (!c.granted && c.t >= GRANT_AT) {
            c.granted = true;
            _p.set(c.base.x, c.base.y + 0.7, c.base.z);
            ctx.fx.burst(_p, c.color, 26, 4.5, 0.7, 0.1, -3);
            ctx.fx.ring(c.base, 2.2, c.color, 0.5);
            try {
              this.onGrant(c.reward, _p.clone());
            } catch (err) {
              console.error('[Loot] grant threw', err);
            }
          }
          if (c.t >= 2.4) {
            c.state = 'done';
            c.beam.visible = false;
            c.model.innerMat.opacity = 0.27;
          }
          break;
        }
        case 'done':
          break;
      }
    }
  }

  clear(): void {
    for (const c of this.list) {
      c.remove();
      c.model.root.removeFromParent();
      c.beam.removeFromParent();
      c.model.gemMat.dispose();
      c.model.innerMat.dispose();
    }
    this.list.length = 0;
  }

  // ───────────── 内部 ─────────────

  private open(c: Chest): void {
    if (c.state !== 'idle') return;
    c.state = 'open';
    c.t = 0;
    c.interactable.enabled = false;
    c.remove();
    c.model.lid.rotation.x = 0;
    this.ctx.audio.play('chest_open', { position: c.focus });
    this.ctx.fx.shake(0.08, 0.12);
  }

  private prompt(c: Chest): InteractPrompt {
    const ctx = this.ctx;
    const label = ctx.runPlan.rewardLabel(c.reward);
    return {
      title: c.reward === 'none' ? '宝箱' : `宝箱 · ${label}`,
      subtitle: '开启',
      lines: [this.hint(c.reward)],
      color: cssColor(c.color),
    };
  }

  private hint(reward: RewardType): string {
    const type = this.ctx.run.stage.type;
    switch (reward) {
      case 'scroll':
        return type === 'elite' || type === 'boss' ? '从三个精良及以上的秘卷中选择一个' : '从三个秘卷中选择一个';
      case 'weapon':
        return weaponRewardHint(type, Math.max(0, this.ctx.run.chapter));
      case 'coins':
        return '一大堆金币';
      case 'heal':
        return '回复 50% 生命，生命上限 +10';
      case 'upgrade':
        return '当前武器免费强化一级';
      default:
        return '空空如也';
    }
  }
}
