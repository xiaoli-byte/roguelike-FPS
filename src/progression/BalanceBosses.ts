import { HanbaDef } from '../enemies/bosses/HanbaDef';
import * as HanbaBalance from '../enemies/bosses/HanbaBalance';
import { KunPengBalance, KunPengDef } from '../enemies/bosses/KunPengDef';
import { QilinDef } from '../enemies/bosses/QilinDef';
import { WarlordDef } from '../enemies/bosses/WarlordDef';
import * as WarlordBalance from '../enemies/bosses/WarlordBalance';
import { BOSS_IDS, DPS_SPREAD, HANBA_ID, KUNPENG_ID, QILIN_ID, WARLORD_ID, balanceReport, referenceDps } from './BalanceModel';

/**
 * 平衡模型里依赖首领定档模型的那一半（Unity BalanceModel.BossSeconds / StageDifficultyOf / Report 的首领段）：
 * 四个首领在本场难度、参考秒伤 × dpsScale 下的击杀用时，用各自的定档模型算。单独一个模块：BalanceModel.ts 不引首领代码。
 */

/** 首领所在关的难度 */
export function stageDifficultyOf(bossId: string): number {
  switch (bossId) {
    case HANBA_ID: return HanbaDef.StageDifficulty;
    case KUNPENG_ID: return KunPengDef.StageDifficulty;
    case WARLORD_ID: return WarlordDef.StageDifficulty;
    case QILIN_ID: return QilinDef.StageDifficulty;
    default: return 1;
  }
}

/** 首领在本场难度、参考秒伤 × dpsScale 下的击杀用时（秒） */
export function bossSeconds(bossId: string, dpsScale = 1): number {
  switch (bossId) {
    case HANBA_ID: {
      // 旱魃是逐招模拟：保留中位打法的瞄准 / 暴击 / 弱点比例，只把身体秒伤换成参考曲线
      const p = { ...HanbaBalance.MID };
      p.bodyDps = referenceDps(HanbaDef.StageDifficulty) * dpsScale / p.aim;
      return HanbaBalance.average(new HanbaDef(), p, 8).mean;
    }
    case KUNPENG_ID:
      return KunPengBalance.killSeconds(new KunPengDef(), KunPengDef.StageDifficulty, referenceDps(KunPengDef.StageDifficulty) * dpsScale);
    case WARLORD_ID: {
      const own = WarlordBalance.referenceDps(WarlordDef.StageDifficulty) * WarlordBalance.Uptime;
      return WarlordBalance.killSeconds(new WarlordDef(), WarlordDef.StageDifficulty, referenceDps(WarlordDef.StageDifficulty) * dpsScale / own);
    }
    case QILIN_ID: {
      const v = new QilinDef().vitalsAt(QilinDef.StageDifficulty);
      return QilinDef.estimateKillSeconds(v, referenceDps(QilinDef.StageDifficulty) * dpsScale, 1);
    }
    default:
      return 0;
  }
}

/** 整份推演（Unity BalanceModel.Report；调试命令 __balance()） */
export function fullBalanceReport(): string {
  const lines = ['[Balance] 首领 | 难度 | 参考秒伤 | 击杀用时（秒伤 × 0.85 / 1 / 1.15）'];
  for (const id of BOSS_IDS) {
    const d = stageDifficultyOf(id);
    lines.push(`${id} | ${d.toFixed(2)} | ${Math.round(referenceDps(d))} | ${Math.round(bossSeconds(id, 1 - DPS_SPREAD))} / ${Math.round(bossSeconds(id))} / ${Math.round(bossSeconds(id, 1 + DPS_SPREAD))} s`);
  }
  return balanceReport(lines);
}
