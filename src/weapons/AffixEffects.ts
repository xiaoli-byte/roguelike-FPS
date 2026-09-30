/**
 * 触发类词条与传说特性：监听 Combat 的伤害 / 击杀事件，按 weaponUid 找到对应武器实例。
 *
 * - 只有直接命中（procDepth 0、source 'weapon'）会触发命中类效果；「连环爆」按 procDepth < 2 允许有限连锁。
 * - 会再次造成伤害的效果（爆头爆炸、弹射、连环爆、万象附着）放进队列，在下一次武器更新时执行，
 *   避免在 Combat 的结算 / 事件派发过程中重入。
 * - 「猎首」通过 outgoing modifier 生效（投射物 / 爆炸在发射时不知道目标）。
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, Element, GameContext, IEnemy, OutgoingDamageModifier, StatusId, WeaponInstance } from '../core/types';
import { ELEMENT_COLORS } from '../core/types';
import { hitsPerShot } from './WeaponDefs';
import { novaDamage, type ResolvedWeapon } from './WeaponStats';

/** 每把武器的运行时状态（不存进 WeaponInstance） */
export interface WeaponRuntime {
  /** 累计射击次数（「天命」） */
  shots: number;
  /** 「狂热」层数与最近一次叠层时间 */
  frenzy: number;
  frenzyTime: number;
  /** 最近一次爆头爆炸时间（霰弹多弹丸同帧只炸一次） */
  lastHeadBlast: number;
  /** 切走时记录的射击冷却结束时间（切回后恢复，防止快速切枪绕过射速） */
  readyAt: number;
}

export interface EffectHost {
  find(uid: number): WeaponInstance | null;
  resolve(inst: WeaponInstance): ResolvedWeapon;
  runtime(inst: WeaponInstance): WeaponRuntime;
  /** 回填弹匣 */
  refill(inst: WeaponInstance, rounds: number): void;
}

type ProcKind = 'headBlast' | 'ricochet' | 'nova' | 'status';

interface Proc {
  kind: ProcKind;
  uid: number;
  enemy: IEnemy | null;
  point: THREE.Vector3;
  base: number;
  element: Element;
  elementChance: number;
  critMult: number;
  depth: number;
  radius: number;
  status: StatusId;
}

const PRISM_STATUSES: readonly StatusId[] = ['burn', 'shock', 'corrode'];
const HEAD_BLAST_RADIUS = 2.2;
const RICOCHET_RANGE = 10;
const RICOCHET_DAMAGE = 0.5;
const FRENZY_MAX = 10;

const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

function blastColor(e: Element): number {
  return e === 'none' ? 0xffa040 : ELEMENT_COLORS[e];
}

export class AffixEffects {
  private queue: Proc[] = [];
  private spare: Proc[] = [];
  private readonly pool: Proc[] = [];
  private readonly exclude = new Set<IEnemy>();
  private modOff: (() => void) | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly host: EffectHost,
  ) {}

  init(): void {
    const ev = this.ctx.events;
    ev.on('enemy:damaged', ({ enemy, result }) => this.onDamaged(enemy, result));
    ev.on('enemy:killed', ({ enemy, result }) => this.onKilled(enemy, result));
    this.installModifier();
  }

  /**
   * 注册（或重新注册）「猎首」伤害修饰器。换关时调用一次：
   * 先移除旧的再添加，因此无论 Combat.clear() 是否清空修饰器都只会存在一份。
   */
  installModifier(): void {
    if (this.modOff) this.modOff();
    this.modOff = this.ctx.combat.addOutgoingModifier(this.hunterModifier);
  }

  private readonly hunterModifier: OutgoingDamageModifier = (enemy, req) => {
    if (req.weaponUid === undefined || req.source !== 'weapon') return 1;
    if (!enemy.isBoss && !enemy.isElite) return 1;
    const inst = this.host.find(req.weaponUid);
    if (!inst) return 1;
    const R = this.host.resolve(inst);
    return R.hunter > 0 ? 1 + R.hunter : 1;
  };

  /** 执行上一帧累积的触发效果 */
  flush(): void {
    if (this.queue.length === 0) return;
    const list = this.queue;
    this.queue = this.spare;
    this.spare = list;
    for (const p of list) {
      try {
        this.run(p);
      } catch (err) {
        console.error('[Weapons] proc failed', p.kind, err);
      }
      p.enemy = null;
      this.pool.push(p);
    }
    list.length = 0;
  }

  /** 丢弃未执行的触发（换关） */
  clear(): void {
    for (const p of this.queue) {
      p.enemy = null;
      this.pool.push(p);
    }
    this.queue.length = 0;
  }

  // ───────────── 事件 ─────────────

  private onDamaged(enemy: IEnemy, result: DamageResult): void {
    const req = result.request;
    if (req.weaponUid === undefined || req.source !== 'weapon') return;
    if ((req.procDepth ?? 0) > 0) return;
    const inst = this.host.find(req.weaponUid);
    if (!inst) return;
    const R = this.host.resolve(inst);
    const ctx = this.ctx;
    const now = ctx.time.now;

    // 命中回盾
    if (R.hitShield > 0 && result.dealt > 0 && ctx.player.alive) ctx.player.addShield(result.dealt * R.hitShield);

    // 狂热：命中叠层（同一帧的多弹丸只算一层）
    if (R.legendary === 'lg_frenzy') {
      const rt = this.host.runtime(inst);
      if (rt.frenzy === 0 || now - rt.frenzyTime > 0.05) rt.frenzy = Math.min(FRENZY_MAX, rt.frenzy + 1);
      rt.frenzyTime = now;
    }

    // 爆头爆炸
    if (R.headBlast > 0 && req.headshot) {
      const rt = this.host.runtime(inst);
      if (now - rt.lastHeadBlast > 0.08) {
        rt.lastHeadBlast = now;
        const p = this.alloc('headBlast', inst, R);
        if (req.point) p.point.copy(req.point);
        else enemy.getHeadCenter(p.point);
        p.base = R.perShot * R.headBlast;
        p.radius = HEAD_BLAST_RADIUS * R.blastMult;
        p.depth = 1;
      }
    }

    // 弹射：多弹丸武器按 1/√弹丸数 折算几率
    if (R.ricochet > 0 && this.ctx.rng.next() < R.ricochet / Math.sqrt(hitsPerShot(R.def))) {
      const p = this.alloc('ricochet', inst, R);
      p.enemy = enemy;
      if (req.point) p.point.copy(req.point);
      else enemy.getBodyCenter(p.point);
      p.base = req.base * RICOCHET_DAMAGE;
      p.depth = 1;
    }

    // 万象：各元素独立判定
    if (R.legendary === 'lg_prism' && enemy.alive) {
      for (const s of PRISM_STATUSES) {
        if (this.ctx.rng.next() >= R.legendaryValue) continue;
        const p = this.alloc('status', inst, R);
        p.enemy = enemy;
        p.status = s;
        p.base = Math.max(1, result.dealt);
        p.depth = 1;
      }
    }
  }

  private onKilled(enemy: IEnemy, result: DamageResult): void {
    const req = result.request;
    if (req.weaponUid === undefined || req.source !== 'weapon') return;
    const inst = this.host.find(req.weaponUid);
    if (!inst) return;
    const R = this.host.resolve(inst);
    const depth = req.procDepth ?? 0;

    if (R.killRefill > 0 && depth === 0) this.host.refill(inst, Math.max(1, Math.round(R.magCap * R.killRefill)));

    if (R.legendary === 'lg_nova' && depth < 2) {
      const p = this.alloc('nova', inst, R);
      enemy.getBodyCenter(p.point);
      p.base = novaDamage(R);
      p.radius = R.legendaryValue * R.blastMult;
      p.depth = depth + 1;
      p.elementChance = inst.element === 'none' ? 0 : 1;
    }
  }

  // ───────────── 执行 ─────────────

  private alloc(kind: ProcKind, inst: WeaponInstance, R: ResolvedWeapon): Proc {
    const p = this.pool.pop() ?? {
      kind, uid: 0, enemy: null, point: new THREE.Vector3(), base: 0, element: 'none' as Element,
      elementChance: 0, critMult: 2, depth: 1, radius: 0, status: 'burn' as StatusId,
    };
    p.kind = kind;
    p.uid = inst.uid;
    p.enemy = null;
    p.element = inst.element;
    p.elementChance = R.elementChance;
    p.critMult = R.critMult;
    p.depth = 1;
    p.radius = 0;
    p.base = 0;
    this.queue.push(p);
    return p;
  }

  private run(p: Proc): void {
    const ctx = this.ctx;
    switch (p.kind) {
      case 'headBlast':
      case 'nova': {
        const req: DamageRequest = {
          base: p.base,
          element: p.element,
          source: 'weapon',
          elementChance: p.elementChance,
          canCrit: false,
          weaponUid: p.uid,
          procDepth: p.depth,
          knockback: p.kind === 'nova' ? 6 : 4,
        };
        const color = blastColor(p.element);
        ctx.combat.explode(p.point, p.radius, req, { color });
        if (p.kind === 'nova') ctx.fx.ring(p.point, p.radius, color, 0.45);
        ctx.audio.play('explosion', { position: p.point, volume: p.kind === 'nova' ? 0.6 : 0.45 });
        break;
      }
      case 'ricochet': {
        this.exclude.clear();
        if (p.enemy) this.exclude.add(p.enemy);
        const target = ctx.enemies.nearest(p.point, RICOCHET_RANGE, this.exclude);
        if (!target || !target.alive) break;
        target.getBodyCenter(_c);
        ctx.fx.tracer(p.point, _c, blastColor(p.element), 0.02);
        _d.subVectors(_c, p.point).normalize();
        ctx.combat.damageEnemy(target, {
          base: p.base,
          element: p.element,
          source: 'weapon',
          elementChance: p.elementChance,
          critMult: p.critMult,
          weaponUid: p.uid,
          point: _c.clone(),
          direction: _d.clone(),
          knockback: 0.5,
          procDepth: p.depth,
        });
        break;
      }
      case 'status':
        if (p.enemy && p.enemy.alive) ctx.combat.applyStatus(p.enemy, p.status, p.base);
        break;
    }
  }
}
