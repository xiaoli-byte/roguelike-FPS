/**
 * 刷怪波次规划（combat / elite / boss 关）。随机源一律用 ctx.rng。
 *
 * 设计要点（DESIGN.md 第 8 节）：
 *  - 章节敌人池：第一章 grunt / archer / bomber（第 2 关起加入 brute）；
 *    第二章 grunt / archer / wisp / shaman / marksman / bomber；第三章全部。
 *  - combat：第一章 3 波、第三章 4 波，每关 12 + 章×3 + 关×1.5（+0–2 随机）只，限制在 12–26；
 *    后一波在上一波剩余 ≤ 2（第一、三章）/ 3（第二章）只时进场——第三章敌人伤害高，同时存活数要压住。
 *  - elite：2 波，普通怪更少，外加 2–3 个精英。
 *  - boss：只有 Boss 的一波。
 *  - 每一波按「战术模板」配比近战 / 远程 / 虫群 / 辅助，保证近战压迫 + 远程火力的搭配。
 */
import type { GameContext, StageNode, WaveEntry, WavePlan } from '../core/types';
import type { Rng } from '../core/Rng';
import { bossIdForChapter } from './bosses';

type Role = 'melee' | 'ranged' | 'swarm' | 'support';
const ROLES: readonly Role[] = ['melee', 'ranged', 'swarm', 'support'];

interface PoolEntry {
  id: string;
  role: Role;
  /** 普通出场权重 */
  weight: number;
  /** 单波上限 */
  cap: number;
  /** 被选为精英的权重 */
  eliteWeight: number;
}

type TemplateId = 'assault' | 'volley' | 'swarm' | 'phalanx';

interface Template {
  mix: Record<Role, number>;
  /** 某些敌人在该模板中的权重加成 */
  favor?: Record<string, number>;
}

const TEMPLATES: Record<TemplateId, Template> = {
  /** 强攻：刀客压上，弩手掩护 */
  assault: { mix: { melee: 0.55, ranged: 0.3, swarm: 0.15, support: 0 }, favor: { grunt: 1.5 } },
  /** 火力压制：远程为主，近战护卫 */
  volley: { mix: { melee: 0.3, ranged: 0.55, swarm: 0.05, support: 0.1 }, favor: { mortar: 1.6, marksman: 1.4 } },
  /** 虫潮：爆骸虫蜂拥，刀客夹杂 */
  swarm: { mix: { melee: 0.35, ranged: 0.2, swarm: 0.45, support: 0 }, favor: { wisp: 1.4 } },
  /** 盾阵：重装压阵，巫祝护佑，远程点射 */
  phalanx: { mix: { melee: 0.5, ranged: 0.3, swarm: 0.05, support: 0.15 }, favor: { brute: 1.8, shaman: 1.5 } },
};

function chapterPool(chapter: number, index: number): PoolEntry[] {
  if (chapter <= 0) {
    const pool: PoolEntry[] = [
      { id: 'grunt', role: 'melee', weight: 5, cap: 7, eliteWeight: 3 },
      { id: 'archer', role: 'ranged', weight: 3, cap: 3, eliteWeight: 2 },
      { id: 'bomber', role: 'swarm', weight: 2.2, cap: 4, eliteWeight: 0.4 },
    ];
    if (index >= 2) pool.push({ id: 'brute', role: 'melee', weight: 1.4, cap: index >= 3 ? 2 : 1, eliteWeight: 2 });
    return pool;
  }
  if (chapter === 1) {
    return [
      { id: 'grunt', role: 'melee', weight: 4, cap: 6, eliteWeight: 2.5 },
      { id: 'archer', role: 'ranged', weight: 3, cap: 4, eliteWeight: 2 },
      { id: 'bomber', role: 'swarm', weight: 2, cap: 4, eliteWeight: 0.4 },
      { id: 'wisp', role: 'ranged', weight: 2.6, cap: 3, eliteWeight: 2 },
      { id: 'shaman', role: 'support', weight: 1.3, cap: 1, eliteWeight: 1.5 },
      { id: 'marksman', role: 'ranged', weight: 1.2, cap: 2, eliteWeight: 1.5 },
    ];
  }
  return [
    { id: 'grunt', role: 'melee', weight: 3.5, cap: 5, eliteWeight: 2 },
    { id: 'brute', role: 'melee', weight: 1.4, cap: 2, eliteWeight: 2.4 },
    { id: 'archer', role: 'ranged', weight: 2.4, cap: 3, eliteWeight: 1.5 },
    { id: 'wisp', role: 'ranged', weight: 2.2, cap: 3, eliteWeight: 1.8 },
    { id: 'marksman', role: 'ranged', weight: 1.2, cap: 2, eliteWeight: 1.5 },
    { id: 'mortar', role: 'ranged', weight: 1.4, cap: 2, eliteWeight: 1.8 },
    { id: 'bomber', role: 'swarm', weight: 2, cap: 4, eliteWeight: 0.5 },
    { id: 'shaman', role: 'support', weight: 1.2, cap: 2, eliteWeight: 1.5 },
  ];
}

/** 一波的构成：普通怪计数 + 精英列表 */
interface WaveComp {
  counts: Map<string, number>;
  elites: string[];
}

export function buildWaves(ctx: GameContext, stage: StageNode): WavePlan[] {
  const rng = ctx.rng;
  const ch = Math.max(0, Math.min(2, stage.chapter));
  const idx = Math.max(0, stage.index);
  switch (stage.type) {
    case 'boss':
      return [{ entries: [{ enemyId: bossIdForChapter(stage.chapter), count: 1 }], triggerRemaining: 0, delay: 1.5 }];
    case 'combat':
      return combatWaves(rng, ch, idx);
    case 'elite':
      return eliteWaves(rng, ch, idx);
    default:
      return [];
  }
}

// ───────────── combat ─────────────

function combatTotal(rng: Rng, ch: number, idx: number): number {
  return Math.max(12, Math.min(26, Math.round(12 + ch * 3 + idx * 1.5 + rng.range(0, 2))));
}

function combatWaves(rng: Rng, ch: number, idx: number): WavePlan[] {
  const pool = chapterPool(ch, idx);
  const waveCount = ch === 0 ? 3 : ch === 1 ? (idx >= 2 ? 4 : 3) : 4;
  const total = combatTotal(rng, ch, idx);
  const sizes = splitSizes(total, waveCount === 3 ? [0.27, 0.33, 0.4] : [0.2, 0.24, 0.27, 0.29]);
  const templates = pickTemplates(rng, waveCount, ch, idx);

  // 战斗关的精英总数上限：不超过同章精英关（第二章 2–3 个、第三章 3 个），精英关才是「精英多」的关
  const eliteCap = ch === 0 ? 1 : ch === 1 ? 2 : 3;
  let eliteTotal = 0;
  const plans: WavePlan[] = [];
  for (let w = 0; w < waveCount; w++) {
    const comp: WaveComp = { counts: fillWave(rng, pool, sizes[w], TEMPLATES[templates[w]]), elites: [] };
    const last = w === waveCount - 1;
    let elites = 0;
    if (ch === 0) {
      if (last && rng.chance([0, 0.25, 0.45, 0.6][Math.min(3, idx)])) elites = 1;
    } else if (ch === 1) {
      if (last) elites = 1;
      else if (w > 0 && rng.chance(0.25 + 0.08 * idx)) elites = 1;
    } else {
      // 第三章：中段波次常有精英，压轴波必有（期望约 2.1–2.4 个：多于第二章的 1.2–1.7，少于同章精英关的 3 个）
      if (last) elites = 1 + (rng.chance(0.15 + 0.05 * idx) ? 1 : 0);
      else elites = rng.chance(w === 0 ? 0.2 + 0.1 * idx : 0.4) ? 1 : 0;
    }
    // 压轴波的精英优先保留：前面的波次不能把名额用光
    const reserve = last ? 0 : 1;
    elites = Math.max(0, Math.min(elites, eliteCap - reserve - eliteTotal));
    eliteTotal += elites;
    for (let i = 0; i < elites; i++) promoteElite(rng, pool, comp);
    // 后续波进场阈值：第二章剩 ≤3，第一、三章剩 ≤2（第三章敌人伤害倍率高，压低同时存活数）
    plans.push(toPlan(comp, w === 0 ? 0 : ch === 1 ? 3 : 2, w === 0 ? 1.0 : 1.2 + rng.range(0, 0.8)));
  }
  return plans;
}

/** 波次模板序列：开场强攻，中段变化，收尾压轴 */
function pickTemplates(rng: Rng, count: number, ch: number, idx: number): TemplateId[] {
  const firstRun = ch === 0 && idx === 0;
  if (count === 3) {
    return [
      'assault',
      firstRun ? 'assault' : rng.pick<TemplateId>(['volley', 'swarm']),
      rng.pick<TemplateId>(firstRun ? ['volley', 'assault'] : ['phalanx', 'volley']),
    ];
  }
  return ['assault', rng.pick<TemplateId>(['swarm', 'volley']), rng.pick<TemplateId>(['volley', 'phalanx']), 'phalanx'];
}

// ───────────── elite ─────────────

function eliteWaves(rng: Rng, ch: number, idx: number): WavePlan[] {
  const pool = chapterPool(ch, Math.max(idx, 2));
  const normals = Math.max(6, Math.round(combatTotal(rng, ch, idx) * 0.55));
  const eliteCount = ch === 0 ? 2 : ch === 1 ? rng.int(2, 3) : 3;
  const sizes = splitSizes(normals, [0.45, 0.55]);

  const w1: WaveComp = { counts: fillWave(rng, pool, sizes[0], TEMPLATES[rng.pick<TemplateId>(['assault', 'volley'])]), elites: [] };
  const w2: WaveComp = { counts: fillWave(rng, pool, sizes[1], TEMPLATES.phalanx), elites: [] };
  // 精英尽量不同种类
  const used = new Set<string>();
  for (let i = 0; i < eliteCount; i++) {
    const id = pickElite(rng, pool, used);
    used.add(id);
    (i === 0 ? w1 : w2).elites.push(id);
  }
  return [toPlan(w1, 0, 1.0), toPlan(w2, 2, 1.5)];
}

// ───────────── 构成工具 ─────────────

/** 按比例拆分总数，保证和不变、每份 ≥ 3 */
function splitSizes(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const sizes = weights.map((w) => Math.max(3, Math.round((total * w) / sum)));
  let diff = total - sizes.reduce((a, b) => a + b, 0);
  for (let i = sizes.length - 1; diff !== 0 && i >= 0; i = (i - 1 + sizes.length) % sizes.length) {
    if (diff > 0) {
      sizes[i]++;
      diff--;
    } else if (sizes[i] > 3) {
      sizes[i]--;
      diff++;
    } else if (sizes.every((s) => s <= 3)) {
      break;
    }
  }
  return sizes;
}

/** 按模板配比填充一波 */
function fillWave(rng: Rng, pool: readonly PoolEntry[], size: number, tpl: Template): Map<string, number> {
  const counts = new Map<string, number>();
  const roleAvail = (r: Role): boolean => pool.some((p) => p.role === r);

  // 1) 角色配额（只在池中存在的角色之间归一化，最大余数法取整）
  let fracSum = 0;
  for (const r of ROLES) if (roleAvail(r)) fracSum += tpl.mix[r];
  const quota: Record<Role, number> = { melee: 0, ranged: 0, swarm: 0, support: 0 };
  const rema: { r: Role; f: number }[] = [];
  let assigned = 0;
  for (const r of ROLES) {
    if (!roleAvail(r) || fracSum <= 0) continue;
    const exact = (size * tpl.mix[r]) / fracSum;
    quota[r] = Math.floor(exact);
    assigned += quota[r];
    rema.push({ r, f: exact - quota[r] });
  }
  rema.sort((a, b) => b.f - a.f);
  for (let i = 0; assigned < size && rema.length > 0; i = (i + 1) % rema.length) {
    quota[rema[i].r]++;
    assigned++;
  }
  // 2) 保证近战 + 远程搭配
  if (size >= 3) {
    for (const need of ['melee', 'ranged'] as Role[]) {
      if (quota[need] > 0 || !roleAvail(need)) continue;
      const donor = ROLES.reduce((best, r) => (quota[r] > quota[best] ? r : best), 'melee' as Role);
      if (quota[donor] > 1) {
        quota[donor]--;
        quota[need]++;
      }
    }
  }
  // 3) 在各角色内按权重抽取具体敌人（遵守单波上限，溢出转给近战）
  let overflow = 0;
  for (const r of ROLES) {
    for (let i = 0; i < quota[r]; i++) {
      const id = pickOfRole(rng, pool, r, counts, tpl.favor);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      else overflow++;
    }
  }
  for (let i = 0; i < overflow; i++) {
    const id = pickOfRole(rng, pool, 'melee', counts, tpl.favor) ?? pickAny(rng, pool, counts) ?? 'grunt';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function pickOfRole(rng: Rng, pool: readonly PoolEntry[], role: Role, counts: Map<string, number>, favor?: Record<string, number>): string | null {
  const cands = pool.filter((p) => p.role === role && (counts.get(p.id) ?? 0) < p.cap);
  if (cands.length === 0) return null;
  return rng.weighted(cands, (p) => p.weight * (favor?.[p.id] ?? 1)).id;
}

function pickAny(rng: Rng, pool: readonly PoolEntry[], counts: Map<string, number>): string | null {
  const cands = pool.filter((p) => (counts.get(p.id) ?? 0) < p.cap);
  if (cands.length === 0) return null;
  return rng.weighted(cands, (p) => p.weight).id;
}

/** 把本波的一只普通怪升格为精英（按精英权重挑选） */
function promoteElite(rng: Rng, pool: readonly PoolEntry[], comp: WaveComp): void {
  const cands = pool.filter((p) => (comp.counts.get(p.id) ?? 0) > 0);
  if (cands.length === 0) return;
  const id = rng.weighted(cands, (p) => p.eliteWeight).id;
  const n = (comp.counts.get(id) ?? 0) - 1;
  if (n > 0) comp.counts.set(id, n);
  else comp.counts.delete(id);
  comp.elites.push(id);
}

function pickElite(rng: Rng, pool: readonly PoolEntry[], used: ReadonlySet<string>): string {
  const fresh = pool.filter((p) => !used.has(p.id));
  return rng.weighted(fresh.length > 0 ? fresh : pool, (p) => p.eliteWeight).id;
}

function toPlan(comp: WaveComp, triggerRemaining: number, delay: number): WavePlan {
  const entries: WaveEntry[] = [];
  for (const [enemyId, count] of comp.counts) if (count > 0) entries.push({ enemyId, count });
  for (const enemyId of comp.elites) entries.push({ enemyId, count: 1, elite: true });
  return { entries, triggerRemaining, delay };
}
