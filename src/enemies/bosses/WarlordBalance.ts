/**
 * 熔心魔将击杀用时的模拟（Unity Bosses/Warlord/WarlordBalance.cs + Bosses/BossBalance.cs 的浸泡表；tests/warlord-boss.test.mjs 守着 60–120 s）。
 *   参考秒伤：3-3 首领浸泡的实测（可选中时约 435），换难度时按难度等比；
 *   三层：护盾 → 护甲 → 生命依次吃，各层按元素倍率（无属性打护甲 75%、火克生命、雷克护盾、蚀克护甲）；
 *   输出率 Uptime：躲招、换位之外真正在打的比例；再加上阶段转换演出的不可选中时间。
 */
import { layerMult, type BossDef, type BossVitals } from './framework/BossDef';
import { WarlordDef } from './WarlordDef';

/** 首领浸泡实测（BossBalance.Soak）：关卡、难度、可选中时的秒伤 */
export const SOAK: readonly (readonly [string, number, number])[] = [
  ['1-4', 1.48, 220],
  ['2-4', 2.28, 405],
  ['3-3', 2.92, 435],
  ['3-4', 3.08, 480],
];

/** 击杀用时的目标带（秒）、输出率 */
export const MinSeconds = 60, MaxSeconds = 120, Uptime = 0.8;
export const AnchorDifficulty = WarlordDef.StageDifficulty;

/** 某一关首领的参考秒伤（不在表里为 0） */
export function soakDps(stage: string): number {
  return SOAK.find(s => s[0] === stage)?.[2] ?? 0;
}

/** 锚点秒伤：3-3 浸泡实测 */
export function anchorDps(): number {
  return soakDps('3-3');
}

/** 某个难度下的参考秒伤（首领可选中时） */
export function referenceDps(difficulty: number): number {
  return anchorDps() * Math.max(0.5, difficulty) / AnchorDifficulty;
}

/** 纯输出时间：三层各自 ÷（秒伤 × 元素层倍率）之和 */
export function layerSeconds(v: BossVitals, dps: number, element = 'none'): number {
  const d = Math.max(1, dps);
  return v.shield / (d * layerMult(element, 'shield')) + v.armor / (d * layerMult(element, 'armor')) + v.hp / (d * layerMult(element, 'health'));
}

/** 阶段转换演出（不可选中）的总时长 */
export function downtime(def: BossDef | null): number {
  if (!def) return 0;
  return def.phases.reduce((t, p) => t + Math.max(0, p.seconds), 0);
}

/** 击杀用时（秒）：纯输出 ÷ 输出率 + 转换演出。dpsScale = 相对参考秒伤的倍率（构筑好坏） */
export function killSeconds(def: BossDef | null, difficulty: number, dpsScale = 1, element = 'none', uptime = Uptime): number {
  if (!def) return 0;
  const dps = referenceDps(difficulty) * Math.max(0.05, dpsScale);
  return layerSeconds(def.vitalsAt(difficulty), dps, element) / Math.min(1, Math.max(0.1, uptime)) + downtime(def);
}
