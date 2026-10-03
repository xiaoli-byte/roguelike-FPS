/**
 * 命中反馈：伤害数字聚合、命中音效节流、命中火花预算。
 *
 * - 同一帧内打在同一个敌人、同一层、同一元素上的伤害合并成一个数字（霰弹 9 颗弹丸显示一个总数），
 *   在 Combat.update 中统一刷出（技能任务在 combat 之后执行，最多晚一帧，肉眼不可见）。
 *   DOT 跳伤单独合并、带 dot 标记（Fx 画得更小更暗、不弹跳），不和同元素的直接命中混在一起。
 * - 命中类音效每帧最多 2 次（其中暴击最多 1 次），同一音效之间至少间隔 30ms；击杀音效每帧 1 次。
 */
import * as THREE from 'three';
import type { DamageLayer, Element, GameContext, IEnemy, SfxId } from '../core/types';

type NumberKind = DamageLayer | 'immune';

interface PendingNumber {
  enemy: IEnemy | null;
  pos: THREE.Vector3;
  amount: number;
  crit: boolean;
  element: Element;
  kind: NumberKind;
  dot: boolean;
}

const MAX_PENDING = 48;
const MAX_HIT_SOUNDS_PER_FRAME = 2;
const MAX_SPARKS_PER_FRAME = 10;
const SAME_SOUND_GAP = 0.03;
/** 单个伤害数字的显示上限（过量击杀时的「溢出伤害」也只显示到这里） */
const MAX_SHOWN = 999999;

const _pos = new THREE.Vector3();

export class HitFeedback {
  private readonly pending: PendingNumber[] = [];
  private count = 0;
  private frame = -1;
  private hitSounds = 0;
  private critSounds = 0;
  private killSounds = 0;
  private sparks = 0;
  private lastSoundAt: Partial<Record<SfxId, number>> = {};
  private immuneAt = new WeakMap<IEnemy, number>();

  constructor(private readonly ctx: GameContext) {}

  private syncFrame(): void {
    const f = this.ctx.time.frame;
    if (f === this.frame) return;
    this.frame = f;
    this.hitSounds = 0;
    this.critSounds = 0;
    this.killSounds = 0;
    this.sparks = 0;
  }

  // ───────────── 伤害数字 ─────────────

  /** 排队一个伤害数字（同帧同敌人同层同元素、且同为 / 同不为 DOT 的会合并） */
  number(enemy: IEnemy, pos: THREE.Vector3, amount: number, crit: boolean, element: Element, kind: NumberKind, dot = false): void {
    if (!this.ctx.settings.damageNumbers) return;
    if (!Number.isFinite(amount) || amount < 0) return;
    if (!Number.isFinite(pos.x + pos.y + pos.z)) return;
    amount = Math.min(amount, MAX_SHOWN);
    for (let i = 0; i < this.count; i++) {
      const p = this.pending[i];
      if (p.enemy === enemy && p.kind === kind && p.element === element && p.dot === dot) {
        p.amount = Math.min(MAX_SHOWN, p.amount + amount);
        p.crit = p.crit || crit;
        return;
      }
    }
    if (this.count >= MAX_PENDING) this.flush();
    let p = this.pending[this.count];
    if (!p) {
      p = { enemy: null, pos: new THREE.Vector3(), amount: 0, crit: false, element: 'none', kind: 'health', dot: false };
      this.pending.push(p);
    }
    this.count++;
    p.enemy = enemy;
    p.pos.copy(pos);
    p.amount = amount;
    p.crit = crit;
    p.element = element;
    p.kind = kind;
    p.dot = dot;
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

  flush(): void {
    const fx = this.ctx.fx;
    for (let i = 0; i < this.count; i++) {
      const p = this.pending[i];
      try {
        fx.damageNumber(p.pos, p.amount, { crit: p.crit, element: p.element, kind: p.kind, dot: p.dot });
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
    this.frame = -1;
  }
}
