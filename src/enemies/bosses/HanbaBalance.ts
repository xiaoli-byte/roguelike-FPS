/**
 * 旱魃击杀用时模拟（Unity Hanba/HanbaBalance.cs 逐行移植；「每个首领：用模拟秒伤算击杀用时，落在 60–120 s」）。纯计算，不碰场景。
 * 模型：按 HanbaDef 的真实数据逐 0.02 s 推进一场战斗——
 *   · 首领：定档耐久（护盾层先吃、再生命层，元素层倍率照 LAYER_MULT）；阶段阈值只看生命层，越线后等当前招式收尾（≤ phaseWait）再进转换演出（不可选中）；
 *     招式按定义的冷却、首次延迟、可用阶段、权重（刚出过的那招 × repeatWeight）用固定种子抽（System.Random 逐位移植），时间轴取各招的 plan（吃阶段节奏），
 *     招式之间喘 recovery × 阶段 restScale；转阶段后先出定义里的第一招。
 *   · 弱点：收招段 + weakGrace、硬直、日蚀窗口里泉珠露出；露出时 weakShare（日蚀窗口里 eclipseShare）的伤害打在泉珠上：必暴 ×2，日蚀窗口里再 × eclipseWeakMult。
 *   · 召沙魇：出手后 addsSeconds 秒里 addsShare 的火力分去打沙魇。
 *   · 飞天之殇：出手后 pipaSeconds 秒里火力全在琵琶上；琵琶碎后踉跄 wardBreakStagger 秒、承伤 × wardBreakTaken、泉珠露出。
 * 差异：Unity 用 float（32 位）累加时间，这里是双精度；同一种子的结果相差在毫秒级，测试断言的范围 / 关系不受影响。
 */
import { layerMult } from './framework/BossDef';
import { DotNetRandom } from './framework/DotNetRandom';
import { HanbaDef } from './HanbaDef';
import { ApsaraCall, Eclipse, hanbaPlan, SandWraiths, type HanbaMovePlan } from './HanbaPlans';
import type { BossMoveSpec } from './framework/BossDef';

/** 目标击杀用时（秒） */
export const TARGET_MIN = 60;
export const TARGET_MAX = 120;
/** D11 的身体秒伤带（不含暴击）与 1-4 的预期装备倍率 */
export const BODY_DPS_LOW = 60;
export const BODY_DPS_HIGH = 90;
export const GEAR_AT_14 = 1.3;
/** 武器之外的输出（增伤秘卷 × 技能 / 灼烧 / 余烬）≈ 1.68 */
export const KIT_AT_14 = 1.68;
/** 弱点必暴、随机暴击的暴伤倍率 */
export const CRIT_MULT = 2;

export interface Profile {
  name: string;
  bodyDps: number;
  aim: number;
  crit: number;
  weakShare: number;
  eclipseShare: number;
  addsShare: number;
  addsSeconds: number;
  pipaSeconds: number;
  element: string;
}

export const LOW: Profile = {
  name: '下沿', bodyDps: BODY_DPS_LOW * GEAR_AT_14 * KIT_AT_14, aim: 0.8, crit: 0.05, weakShare: 0.18, eclipseShare: 0.35,
  addsShare: 0.28, addsSeconds: 9, pipaSeconds: 5.5, element: 'none',
};

export const MID: Profile = {
  name: '中位', bodyDps: (BODY_DPS_LOW + BODY_DPS_HIGH) * 0.5 * GEAR_AT_14 * KIT_AT_14, aim: 0.82, crit: 0.07, weakShare: 0.22, eclipseShare: 0.45,
  addsShare: 0.25, addsSeconds: 8, pipaSeconds: 4.5, element: 'none',
};

export const HIGH: Profile = {
  name: '上沿', bodyDps: BODY_DPS_HIGH * GEAR_AT_14 * KIT_AT_14, aim: 0.84, crit: 0.08, weakShare: 0.26, eclipseShare: 0.5,
  addsShare: 0.22, addsSeconds: 7, pipaSeconds: 3.5, element: 'none',
};

export const PROFILES: readonly Profile[] = [LOW, MID, HIGH];

export interface SimResult {
  seconds: number;
  killed: boolean;
  phase2At: number;
  phase3At: number;
  untargetable: number;
  warded: number;
  weakOpen: number;
  eclipseOpen: number;
  moves: number;
  eclipses: number;
  apsaras: number;
  dealt: number;
}

interface SimMove {
  move: BossMoveSpec;
  readyAt: number;
}

type Stage = 'rest' | 'windup' | 'active' | 'recover' | 'transition' | 'stagger';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 按某种打法、某个种子模拟一场（难度默认 1-4 的 1.48） */
export function simulate(def: HanbaDef, p: Profile, seed = 1, difficulty = HanbaDef.StageDifficulty, dt = 0.02, limit = 600): SimResult {
  const r: SimResult = {
    seconds: 0, killed: false, phase2At: -1, phase3At: -1, untargetable: 0, warded: 0, weakOpen: 0, eclipseOpen: 0,
    moves: 0, eclipses: 0, apsaras: 0, dealt: 0,
  };
  const v = def.vitalsAt(difficulty);
  let shield = v.shield, armor = v.armor, health = v.hp;
  const maxHp = Math.max(1, v.hp);
  const rng = new DotNetRandom(seed);
  const moves: SimMove[] = def.moves.map(m => ({ move: m, readyAt: Math.max(0, m.firstDelay) }));
  let phase = 0;
  let t = 0, stageLeft = Math.max(0, def.intro.firstRest), waitAcc = 0, weakGrace = 0, addsLeft = 0, wardLeft = 0, staggerTaken = 1;
  let stage = 'rest' as Stage;
  let cur: SimMove | null = null;
  let plan: HanbaMovePlan = { windup: 0, active: 0, recover: 0 };
  let lastId: string | null = null, queued: string | null = null;

  const allowed = (m: BossMoveSpec) => phase >= m.minPhase && phase <= m.maxPhase;
  const ready = (s: SimMove) => t >= s.readyAt && allowed(s.move);
  const weightOf = (s: SimMove, others: boolean): number => {
    if (!ready(s)) return 0;
    let w = s.move.weight;
    if (s.move.id === SandWraiths.id && addsLeft > 0) w = 0;
    if (s.move.id === ApsaraCall.id && wardLeft > 0) w = 0;
    if (others && s.move.id === lastId) w *= Math.max(0, def.repeatWeight);
    return w;
  };
  const enter = (s: Stage) => {
    stage = s;
    switch (s) {
      case 'windup':
        stageLeft = plan.windup;
        break;
      case 'active':
        stageLeft = plan.active;
        // 出手的效果
        if (cur!.move.id === SandWraiths.id) addsLeft = p.addsSeconds;
        else if (cur!.move.id === ApsaraCall.id) {
          wardLeft = Math.max(0.01, p.pipaSeconds);
          r.apsaras++;
        } else if (cur!.move.id === Eclipse.id) r.eclipses++;
        break;
      case 'recover':
        stageLeft = plan.recover;
        break;
    }
  };
  const pick = () => {
    let chosen: SimMove | null = null;
    if (queued) {
      for (const s of moves) if (s.move.id === queued && allowed(s.move)) chosen = s;
      queued = null;
    }
    if (!chosen) {
      let total = 0;
      let others = false;
      for (const s of moves) if (ready(s) && s.move.id !== lastId) others = true;
      for (const s of moves) total += weightOf(s, others);
      if (total <= 0) {
        stageLeft = 0.3;
        return;
      }
      let x = rng.nextDouble() * total;
      for (const s of moves) {
        const w = weightOf(s, others);
        if (w <= 0) continue;
        chosen = s;
        x -= w;
        if (x <= 0) break;
      }
    }
    if (!chosen) {
      stageLeft = 0.3;
      return;
    }
    cur = chosen;
    lastId = chosen.move.id;
    chosen.readyAt = t + Math.max(0, chosen.move.cooldown);
    plan = hanbaPlan(chosen.move.id, def.paceAt(phase));
    r.moves++;
    enter('windup');
  };
  const eat = (pool: number, raw: number, mult: number): [number, number] => {
    if (raw <= 0 || pool <= 0) return [pool, raw];
    const dmg = raw * mult;
    if (dmg <= pool) {
      r.dealt += dmg;
      return [pool - dmg, 0];
    }
    r.dealt += pool;
    return [0, raw - pool / mult];
  };
  const apply = (amount: number) => {
    if (!(amount > 0)) return;
    let left = amount;
    [shield, left] = eat(shield, left, layerMult(p.element, 'shield'));
    [armor, left] = eat(armor, left, layerMult(p.element, 'armor'));
    [health, left] = eat(health, left, layerMult(p.element, 'health'));
  };

  while (health > 0 && t < limit) {
    // ── 阶段：越线后等当前招式收尾（≤ phaseWait），再进转换 ──
    if (phase < def.phases.length && stage !== 'transition' && health / maxHp <= def.phases[phase].at) {
      const inMove = stage === 'windup' || stage === 'active' || stage === 'recover';
      if (inMove && waitAcc < def.phaseWait) waitAcc += dt;
      else {
        waitAcc = 0;
        const pd = def.phases[phase];
        phase++;
        if (phase === 1) r.phase2At = t;
        else if (phase === 2) r.phase3At = t;
        cur = null;
        stage = 'transition';
        stageLeft = Math.max(0, pd.seconds);
        queued = pd.firstMove ?? null;
        weakGrace = 0;
      }
    }

    // ── 首领时间轴 ──
    stageLeft -= dt;
    weakGrace -= dt;
    addsLeft -= dt;
    switch (stage as Stage) {
      case 'rest':
        if (stageLeft <= 0) pick();
        break;
      case 'windup':
        if (stageLeft <= 0) enter('active');
        break;
      case 'active':
        if (stageLeft <= 0) enter('recover');
        break;
      case 'recover':
        if (stageLeft <= 0) {
          weakGrace = def.weakGrace;
          stage = 'rest';
          stageLeft = Math.max(0, cur!.move.recovery) * def.restScaleAt(phase);
          cur = null;
        }
        break;
      case 'transition':
        if (stageLeft <= 0) {
          stage = 'rest';
          stageLeft = 0.4;
        }
        break;
      case 'stagger':
        if (stageLeft <= 0) {
          stage = 'rest';
          stageLeft = 0.6;
          staggerTaken = 1;
        }
        break;
    }
    // 护体：琵琶在 pipaSeconds 后碎掉 → 踉跄
    if (wardLeft > 0) {
      wardLeft -= dt;
      r.warded += dt;
      if (wardLeft <= 0 && stage !== 'transition') {
        cur = null;
        stage = 'stagger';
        stageLeft = def.wardBreakStagger;
        staggerTaken = def.wardBreakTaken;
      }
    }

    // ── 玩家输出 ──
    const targetable = stage !== 'transition';
    if (!targetable) r.untargetable += dt;
    else if (wardLeft <= 0) {
      const eclipse = stage === 'active' && (cur as SimMove | null)?.move.id === Eclipse.id;
      const weak = eclipse || stage === 'recover' || stage === 'stagger' || weakGrace > 0;
      if (weak) r.weakOpen += dt;
      if (eclipse) r.eclipseOpen += dt;
      let dps = p.bodyDps * p.aim;
      if (addsLeft > 0) dps *= 1 - clamp01(p.addsShare);
      const share = eclipse ? p.eclipseShare : weak ? p.weakShare : 0;
      const weakMult = CRIT_MULT * (eclipse ? def.eclipseWeakMult : 1);
      const bodyMult = 1 + clamp01(p.crit) * (CRIT_MULT - 1);
      const rate = dps * ((1 - share) * bodyMult + share * weakMult) * (stage === 'stagger' ? staggerTaken : 1);
      apply(rate * dt);
    }
    t += dt;
  }
  r.seconds = t;
  r.killed = health <= 0;
  return r;
}

/** 同一种打法跑 runs 个种子（1000 + i × 7919），返回平均击杀用时与最短 / 最长 */
export function average(def: HanbaDef, p: Profile, runs = 16, difficulty = HanbaDef.StageDifficulty): { mean: number; min: number; max: number; sample: SimResult } {
  let sum = 0, min = Infinity, max = 0;
  let first: SimResult | null = null;
  const n = Math.max(1, runs);
  for (let i = 0; i < n; i++) {
    const r = simulate(def, p, 1000 + i * 7919, difficulty);
    if (i === 0) first = r;
    sum += r.seconds;
    min = Math.min(min, r.seconds);
    max = Math.max(max, r.seconds);
  }
  return { mean: sum / n, min, max, sample: first! };
}

export function describe(r: SimResult): string {
  return `${r.seconds.toFixed(0)} s（二阶段 ${r.phase2At.toFixed(0)} s、三阶段 ${r.phase3At.toFixed(0)} s；出招 ${r.moves}、日蚀 ${r.eclipses}、飞天 ${r.apsaras}；`
    + `转阶段 ${r.untargetable.toFixed(1)} s、护体 ${r.warded.toFixed(1)} s、泉珠 ${r.weakOpen.toFixed(1)} s）`;
}
