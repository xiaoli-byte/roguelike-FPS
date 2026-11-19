/**
 * 关卡目标 + 首领据点模式（Unity Encounters/LevelObjective.cs、BossEncounter.cs 的据点分支、World/Levels/ZheduoLevel.cs 的据点门槛与灵火坛封印）。
 * 数据：public/assets/unity-levels/objectives.json（scripts/web/export-level-objectives.mjs 从场景 YAML 导出）。
 *   · 灵火坛：M 座里点亮 N 座（altarsNeeded；0 = 不要求）→ 目标完成；必清场地全部肃清同理（required，4-1 / 4-3 为空）。
 *     完成后交给关卡导演清关开出口（StageDirector 在没有遭遇进行时调 onCleared）。
 *   · 据点模式（stronghold 首领，4-1 三领主）：首领战不是终点战——倒下 6.3 s（等死亡演出放完）后结算：回满生命与护盾、本关魂晶（每个领主一次，force）、
 *     首领宝箱（秘卷，落在据点的 Lord Reward 点）、点亮本据点的灵火坛、横幅「X · 平息」；不立出口。清关后仍可开打别的领主，不重复清关。
 *   · 领主没平之前，据点的灵火坛封着：交互只给提示「X未平 · 打败它后灵火自动点亮」。
 *   · 门槛圆（ZheduoLevel.strongholds）：夔 = 残鼓 22 m、飞廉 = 冰舌顶 32 m、化蛇 = 湖岸擂台 50 m，脚的高度在圆里地面最低 −3 m 到最高 +5 m（UnitySceneAdapter 判）。
 * 只对 altarsNeeded > 0 或有据点首领的关卡生效；其余关卡照旧（终点战清关）。
 * 与 Unity 的差异：目标栏文字（GameUI.SetObjective）网页界面没有对应的栏，进关 / 点亮时用提示条报进度；据点结算时不另处决场上残余的敌人（领主的召唤物倒下时已崩解）。
 */
import * as THREE from 'three';
import type { GameContext, IEnemy } from '../../core/types';
import { creditStageEssence } from '../../progression/Economy';
import { SpiritAltar, FLAME_COLOR, type AltarSpec } from './SpiritAltar';

/** 据点模式：倒下后多久结算（等领主的死亡演出放完，秒；Unity BossEncounter.StrongholdSettleDelay） */
export const STRONGHOLD_SETTLE_DELAY = 6.3;

export interface StrongholdThreshold {
  center: [number, number, number];
  radius: number;
  minY: number;
  maxY: number;
}

export interface BossEncounterDoc {
  bossId: string;
  stronghold: boolean;
  enabled: boolean;
  altar: string | null;
  rewardPoint: [number, number, number] | null;
  thresholdInset: number;
  tetherSlack: number;
  warnSeconds: number;
  warnText: string;
  threshold?: StrongholdThreshold;
}

export interface ObjectiveDoc {
  title: string;
  altarsNeeded: number;
  autoCollect: boolean;
  required: string[];
  optional: string[];
  altars: string[];
}

export interface LevelObjectivesDoc {
  scene: string;
  objective: ObjectiveDoc | null;
  altars: AltarSpec[];
  bosses: BossEncounterDoc[];
}

interface ObjectivesFile {
  schema: number;
  levels: Record<string, LevelObjectivesDoc>;
}

let filePending: Promise<ObjectivesFile | null> | null = null;

/** 某一关的目标数据（objectives.json 第一次要的时候读，之后缓存；读不到 = null，关卡照旧） */
export async function loadLevelObjectives(levelId: string): Promise<LevelObjectivesDoc | null> {
  if (typeof fetch === 'undefined') return null;
  filePending ??= fetch(`${import.meta.env?.BASE_URL ?? '/'}assets/unity-levels/objectives.json`)
    .then(r => (r.ok ? r.json() as Promise<ObjectivesFile> : null))
    .catch(() => null);
  const file = await filePending;
  if (!file) filePending = null;
  return file?.levels?.[levelId] ?? null;
}

/** 这一关要不要走关卡目标（灵火坛 N 选 M / 据点首领） */
export function objectiveDriven(doc: LevelObjectivesDoc | null | undefined): boolean {
  return !!doc && ((doc.objective?.altarsNeeded ?? 0) > 0 || doc.bosses.some(b => b.stronghold && b.enabled));
}

/** 据点门槛（ZheduoLevel.Stronghold.Contains）：脚在水平圆里、高度在范围里 */
export function inStrongholdThreshold(t: StrongholdThreshold, feet: { x: number; z: number; y?: number }): boolean {
  if (feet.y !== undefined && (feet.y < t.minY || feet.y > t.maxY)) return false;
  return Math.hypot(feet.x - t.center[0], feet.z - t.center[2]) <= t.radius;
}

export interface ObjectiveHooks {
  /** 场地（遭遇 id = 场地 title）肃清了没 */
  siteCleared(title: string): boolean;
  /** 本关代号（魂晶记账） */
  stageCode: string;
}

interface Settle {
  boss: BossEncounterDoc;
  name: string;
  at: number;
  done: boolean;
}

export class LevelObjectives {
  readonly altars: SpiritAltar[] = [];
  complete = false;
  /** 已结算的据点（首领 id） */
  readonly settled = new Set<string>();
  private readonly pending: Settle[] = [];
  private readonly defeated = new Set<string>();
  private readonly off: (() => void)[] = [];
  private t = 0;
  private announced = false;

  constructor(private readonly ctx: GameContext, readonly doc: LevelObjectivesDoc, parent: THREE.Object3D, private readonly hooks: ObjectiveHooks) {
    for (const spec of doc.altars) {
      this.altars.push(new SpiritAltar(ctx, spec, parent, {
        guardCleared: (title) => hooks.siteCleared(title),
        sealedBy: (name) => this.sealedBy(name),
        onLit: () => this.onAltarLit(),
      }));
    }
    const on = ctx.events.on('enemy:killed', ({ enemy }) => this.onKilled(enemy));
    if (typeof on === 'function') this.off.push(on);
  }

  get needed(): number {
    return Math.min(Math.max(0, this.doc.objective?.altarsNeeded ?? 0), this.objectiveAltars.length);
  }

  private get objectiveAltars(): SpiritAltar[] {
    const names = this.doc.objective?.altars;
    return names && names.length ? this.altars.filter(a => names.includes(a.spec.name)) : this.altars;
  }

  get lit(): number {
    return this.objectiveAltars.filter(a => a.lit).length;
  }

  get requiredCleared(): number {
    return (this.doc.objective?.required ?? []).filter(t => this.hooks.siteCleared(t)).length;
  }

  /** 目标栏文字：「肃清据点 2/4 · 点亮灵火 1/3（共 6 处，任选）」（已完成为空） */
  describe(): string {
    if (this.complete) return '';
    const parts: string[] = [];
    const req = this.doc.objective?.required ?? [];
    if (req.length > 0) parts.push(`肃清据点 ${this.requiredCleared}/${req.length}`);
    const need = this.needed;
    if (need > 0) parts.push(`点亮灵火 ${Math.min(this.lit, need)}/${need}${this.objectiveAltars.length > need ? `（共 ${this.objectiveAltars.length} 处，任选）` : ''}`);
    return parts.join(' · ');
  }

  /** 据点的灵火坛封着（领主没平）：返回领主名 */
  sealedBy(altarName: string): string | null {
    const b = this.doc.bosses.find(x => x.stronghold && x.enabled && x.altar === altarName);
    if (!b || this.settled.has(b.bossId)) return null;
    return LORD_NAMES[b.bossId] ?? '领主';
  }

  private onKilled(enemy: IEnemy): void {
    if (!enemy.isBoss) return;
    const b = this.doc.bosses.find(x => x.stronghold && x.enabled && x.bossId === enemy.def.id);
    if (!b || this.defeated.has(b.bossId)) return;
    this.defeated.add(b.bossId);
    this.pending.push({ boss: b, name: enemy.def.name, at: this.t + STRONGHOLD_SETTLE_DELAY, done: false });
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.announced && this.t > 2) {
      this.announced = true;
      const d = this.describe();
      if (d) this.ctx.ui.toast(`${this.doc.objective?.title ? `${this.doc.objective.title}：` : ''}${d}`, '#9ef0ff');
    }
    for (const a of this.altars) a.update(dt);
    for (const s of this.pending) {
      if (s.done || this.t < s.at) continue;
      s.done = true;
      this.settle(s);
    }
    this.refresh();
  }

  /** 据点结算（Unity BossEncounter.Settle 的 stronghold 分支） */
  private settle(s: Settle): void {
    const ctx = this.ctx, b = s.boss;
    this.settled.add(b.bossId);
    const pl = ctx.player;
    if (pl.alive) {
      pl.heal(pl.maxHp());
      pl.addShield(pl.maxShield());
    }
    creditStageEssence(ctx.run, `${this.hooks.stageCode}:${b.bossId}`, true);
    if (b.rewardPoint) ctx.loot.spawnChest(new THREE.Vector3(b.rewardPoint[0], b.rewardPoint[1], b.rewardPoint[2]), 'scroll');
    const altar = b.altar ? this.altars.find(a => a.spec.name === b.altar) : null;
    altar?.light();
    ctx.ui.banner(`${s.name} · 平息`, '灵火已点亮 · 生命已完全恢复', 2.8);
  }

  private onAltarLit(): void {
    if (this.complete) return;
    const need = this.needed;
    if (need > 0 && this.lit <= need) this.ctx.ui.toast(`灵火 ${Math.min(this.lit, need)} / ${need}`, '#9ef0ff');
  }

  /** 重新数进度；新完成时提示 */
  private refresh(): void {
    if (this.complete) return;
    const req = this.doc.objective?.required ?? [];
    if (this.requiredCleared < req.length || this.lit < this.needed) return;
    if (req.length === 0 && this.needed === 0) return;
    this.complete = true;
    if (this.doc.objective?.title) this.ctx.ui.toast(`目标完成 · ${this.doc.objective.title}`, '#a9dec7');
    this.ctx.fx.ring(this.ctx.player.position.clone(), 6, FLAME_COLOR, 0.8);
  }

  dispose(): void {
    for (const o of this.off) o();
    this.off.length = 0;
    for (const a of this.altars) a.dispose();
    this.altars.length = 0;
  }
}

/** 领主的名字（据点封印的提示；不 import 首领模块，免得关卡载入拖进首领的全部依赖） */
const LORD_NAMES: Readonly<Record<string, string>> = { boss_kui: '夔', boss_feilian: '飞廉', boss_huashe: '化蛇' };
