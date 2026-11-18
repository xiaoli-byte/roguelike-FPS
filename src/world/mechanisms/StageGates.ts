/**
 * 机关挂给关卡导演 / 首领的钩子（跨模块的最小接口，不 import 机关本身）：
 *   · fightBlocked(id, player)：据点 / 首领场此刻能不能开打——3-3 风闸没拉开之前「第二次进殿」不触发（Unity FoundryWindGate 把它的
 *     autoTrigger 关掉），领主战在关卡目标完成之前不触发（Unity FoundryLordGate 把 BossEncounter 停用）。StageDirector 选候选据点时问一句；
 *   · foundryChannels：3-3 神范台的熔铜渠（Unity FoundryChannels），熔心魔将的「熔铜渠涨落」招式调 flood(hold) 代替环带兜底
 *     （src/enemies/bosses/WarlordMoves.ts 的 ChannelSurgeMove 接这里——那个文件归首领那边改）。
 */

export interface FoundryChannelsHook {
  /** 渠的数量（0 = 场上没有熔铜渠，招式走兜底） */
  readonly count: number;
  readonly flooding: boolean;
  /** 涨：每段先预警 warn 秒、再 riseTime 秒涨到基准面 + rise，高位停 hold 秒后自己退回；已经在涨时只延长，返回 false */
  flood(hold: number, warnSeconds?: number): boolean;
  recede(): void;
  /** 每片熔岩的漫溢范围（预警长条用）：中心、朝向（度，网页）、宽 × 长或圆半径 */
  readonly surges: readonly { center: [number, number, number]; yaw: number; shape: 'box' | 'disc'; size: [number, number] }[];
  readonly warn: number;
  readonly riseTime: number;
}

type FightGate = (id: string, player: { x: number; y: number; z: number }) => boolean;

const gates = new Set<FightGate>();

export const stageGates = {
  /** 3-3 熔铜渠（没有为 null） */
  foundryChannels: null as FoundryChannelsHook | null,

  /** 登记一个「这个据点现在不能开打」的判断；返回撤销函数 */
  addFightGate(fn: FightGate): () => void {
    gates.add(fn);
    return () => { gates.delete(fn); };
  },

  /** 据点（WhiteboxFight.id：Unity 据点 title / 'boss:<id>:<序号>'）此刻被机关挡着 */
  fightBlocked(id: string, player: { x: number; y: number; z: number }): boolean {
    for (const g of gates) {
      try {
        if (g(id, player)) return true;
      } catch (err) {
        console.error('[stageGates] 判断出错', err);
      }
    }
    return false;
  },
};
