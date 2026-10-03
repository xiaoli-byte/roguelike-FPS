/**
 * 命中反馈：伤害数字聚合、命中音效节流、命中火花预算。
 *
 * - 同一帧内打在同一个敌人、同一层、同一元素上的伤害合并成一个数字（霰弹 9 颗弹丸显示一个总数），
 *   在 Combat.update 中统一刷出（技能任务在 combat 之后执行，最多晚一帧，肉眼不可见）。
 * - 命中类音效每帧最多 2 次（其中暴击最多 1 次），同一音效之间至少间隔 30ms；击杀音效每帧 1 次。
 * - 元素反应浮字（「焚雷」等）：每帧最多 4 条、同一敌人 0.3 秒一条（大号的「归墟」不受逐敌节流），立即生成不合并。
 */
import * as THREE from 'three';
import type { DamageLayer, Element, GameContext, IEnemy, SfxId } from '../core/types';
import { LABEL_BUDGET } from './Reactions';

type NumberKind = DamageLayer | 'immune';

interface PendingNumber {
  enemy: IEnemy | null;
  pos: THREE.Vector3;
  amount: number;
  crit: boolean;
  element: Element;
  kind: NumberKind;
}

const MAX_PENDING = 48;
const MAX_HIT_SOUNDS_PER_FRAME = 2;
const MAX_SPARKS_PER_FRAME = 10;
const SAME_SOUND_GAP = 0.03;
/** 同一敌人两条反应浮字的最短间隔 */
const LABEL_GAP = 0.3;

const _pos = new THREE.Vector3();

export class HitFeedback {
  private readonly pending: PendingNumber[] = [];
  private count = 0;
  private frame = -1;
  private hitSounds = 0;
  private critSounds = 0;
  private killSounds = 0;
  private sparks = 0;
  private labels = 0;
  private lastSoundAt: Partial<Record<SfxId, number>> = {};
  private immuneAt = new WeakMap<IEnemy, number>();
  private labelAt = new WeakMap<IEnemy, number>();

  constructor(private readonly ctx: GameContext) {}

  private syncFrame(): void {
    const f = this.ctx.time.frame;
    if (f === this.frame) return;
    this.frame = f;
    this.hitSounds = 0;
    this.critSounds = 0;
    this.killSounds = 0;
    this.sparks = 0;
    this.labels = 0;
  }

  // ───────────── 伤害数字 ─────────────

  /** 排队一个伤害数字（同帧同敌人同层同元素会合并） */
  number(enemy: IEnemy, pos: THREE.Vector3, amount: number, crit: boolean, element: Element, kind: NumberKind): void {
    if (!this.ctx.settings.damageNumbers) return;
    for (let i = 0; i < this.count; i++) {
      const p = this.pending[i];
      if (p.enemy === enemy && p.kind === kind && p.element === element) {
        p.amount += amount;
        p.crit = p.crit || crit;
        return;
      }
    }
    if (this.count >= MAX_PENDING) this.flush();
    let p = this.pending[this.count];
    if (!p) {
      p = { enemy: null, pos: new THREE.Vector3(), amount: 0, crit: false, element: 'none', kind: 'health' };
      this.pending.push(p);
    }
    this.count++;
    p.enemy = enemy;
    p.pos.copy(pos);
    p.amount = amount;
    p.crit = crit;
    p.element = element;
    p.kind = kind;
  }

  /** 免疫提示（同一敌人 0.4 秒内只提示一次） */
  immune(enemy: IEnemy, point: THREE.Vector3 | undefined): void {
    const now = this.ctx.time.now;
    const last = this.immuneAt.get(enemy);
    if (last !== undefined && now - last < 0.4) return;
    this.immuneAt.set(enemy, now);
    if (point) _pos.copy(point);
    else {
      enemy.getHeadCenter(_pos);
      _pos.y += 0.35;
    }
    this.number(enemy, _pos, 0, false, 'none', 'immune');
  }

  /**
   * 元素反应浮字（docs/arsenal-expansion.md 2.9）。每帧最多 4 条；同一敌人 0.3 秒一条，
   * big（归墟）不受逐敌节流，免得紧跟在两两反应后面的「归墟」被吞掉。
   */
  reactionLabel(enemy: IEnemy, pos: THREE.Vector3, text: string, color: number, big: boolean): void {
    this.syncFrame();
    if (this.labels >= LABEL_BUDGET) return;
    const now = this.ctx.time.now;
    if (!big) {
      const last = this.labelAt.get(enemy);
      if (last !== undefined && now - last < LABEL_GAP && now >= last) return;
    }
    this.labelAt.set(enemy, now);
    this.labels++;
    try {
      this.ctx.fx.damageNumber(pos, 0, { kind: 'reaction', text, color, big });
    } catch (err) {
      console.error('[Combat] reaction label threw', err);
    }
  }

  flush(): void {
    const fx = this.ctx.fx;
    for (let i = 0; i < this.count; i++) {
      const p = this.pending[i];
      try {
        fx.damageNumber(p.pos, p.amount, { crit: p.crit, element: p.element, kind: p.kind });
      } catch (err) {
        console.error('[Combat] damageNumber threw', err);
      }
      p.enemy = null;
    }
    this.count = 0;
  }

  // ───────────── 音效 ─────────────

  hitSound(layer: DamageLayer, crit: boolean): void {
    this.syncFrame();
    if (this.hitSounds >= MAX_HIT_SOUNDS_PER_FRAME) return;
    if (crit) {
      if (this.critSounds >= 1) return;
      if (this.play('hit_crit', 0.8, 0.96 + Math.random() * 0.08)) {
        this.critSounds++;
        this.hitSounds++;
      }
      return;
    }
    const id: SfxId = layer === 'shield' ? 'hit_shield' : layer === 'armor' ? 'hit_armor' : 'hit';
    if (this.play(id, 0.55, 0.93 + Math.random() * 0.14)) this.hitSounds++;
  }

  /** 护盾 / 护甲被打穿：更低沉的一声（与玩家自身的护盾破碎音区分开） */
  breakSound(layer: 'shield' | 'armor', at: THREE.Vector3): void {
    this.ctx.audio.play(layer === 'shield' ? 'hit_shield' : 'hit_armor', { position: at, volume: 0.95, pitch: 0.7 });
  }

  killSound(big: boolean): void {
    this.syncFrame();
    if (this.killSounds >= 1) return;
    this.killSounds++;
    this.ctx.audio.play('kill', { volume: big ? 1 : 0.8, pitch: big ? 0.85 : 0.97 + Math.random() * 0.06 });
  }

  private play(id: SfxId, volume: number, pitch: number): boolean {
    const now = this.ctx.time.now;
    const last = this.lastSoundAt[id];
    if (last !== undefined && now - last < SAME_SOUND_GAP && now >= last) return false;
    this.lastSoundAt[id] = now;
    this.ctx.audio.play(id, { volume, pitch });
    return true;
  }

  // ───────────── 命中火花 ─────────────

  spark(point: THREE.Vector3, color: number, crit: boolean): void {
    this.syncFrame();
    if (this.sparks >= MAX_SPARKS_PER_FRAME) return;
    this.sparks++;
    this.ctx.fx.enemyHit(point, color, crit);
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) this.pending[i].enemy = null;
    this.count = 0;
    this.lastSoundAt = {};
    this.immuneAt = new WeakMap();
    this.labelAt = new WeakMap();
    this.frame = -1;
  }
}
