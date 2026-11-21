import { FEEL, type FeelProfile } from './FeelProfile';
import { TimePriority, type TimeScaleArbiter, type TimeScaleHandle } from './TimeScaleArbiter';

/**
 * 清场慢动作（Unity G/Core/ClearSlowMo.cs 照译，I7「击杀慢动作」）：打死一处场地的最后一只（场地至少打过
 * {@link FeelProfile.clearSlowMoMinKills} 只）时，时间压到 ×0.3 约 0.4 s（真实时间），让「这一仗打完了」有个落点。
 * 数值读 {@link FeelProfile}，缩放 1 = 关掉。优先级比顿帧低一档：最后一击的顿帧先「咬」一下，顿帧结束后接着慢放；
 * 首领溃散的慢动作（DeathSlowMo）、暂停、过渡都压得过它。
 */
export interface ClearSlowMoHost {
  /** 真实时间（秒） */
  clock(): number;
  isPlaying(): boolean;
  playerDead(): boolean;
}

export class ClearSlowMo {
  static readonly Priority = TimePriority.ClearSlowMo;

  private handle: TimeScaleHandle | null = null;
  private until = 0;
  /** 放过几次（测试 / 调试读） */
  count = 0;

  constructor(private readonly arbiter: TimeScaleArbiter, private readonly host: ClearSlowMoHost, private readonly feel: FeelProfile = FEEL) {}

  /** 一处场地清掉了；total = 这处场地一共打过几只。返回是否放了慢动作 */
  onCleared(total: number): boolean {
    const f = this.feel;
    if (!(total >= f.clearSlowMoMinKills) || !(f.clearSlowMoScale > 0 && f.clearSlowMoScale < 1) || !(f.clearSlowMoSeconds > 0)) return false;
    if (!this.host.isPlaying() || this.host.playerDead()) return false;
    this.release();
    this.handle = this.arbiter.request(this, f.clearSlowMoScale, ClearSlowMo.Priority);
    this.until = this.host.clock() + f.clearSlowMoSeconds;
    this.count++;
    return true;
  }

  /** 每帧调（真实时间） */
  update(): void {
    if (!this.handle) return;
    if (!this.handle.live || this.host.clock() >= this.until) this.release();
  }

  release(): void {
    this.handle?.dispose();
    this.handle = null;
  }
}

/**
 * 「一处场地清掉了」的侦测（网页的遭遇状态在 StageDirector 的 exploration.encounters 上，没有 Unity 的 EncounterCleared 事件）：
 * 每帧看各处的 phase，从 active 变成 cleared 的那一帧回报，连同它开打期间的击杀数（= Unity EncounterSite.Total 的近似：
 * 同时开打的几处共用同一笔击杀）。换关（列表对象换了）时清空。
 */
export class EncounterClearWatcher {
  private readonly phases = new Map<string, string>();
  private readonly kills = new Map<string, number>();
  private list: unknown = null;

  /** 有敌人被打死：记到所有正在开打的场地上 */
  noteKill(): void {
    for (const [id, phase] of this.phases) if (phase === 'active') this.kills.set(id, (this.kills.get(id) ?? 0) + 1);
  }

  /** 每帧调：返回这一帧清掉的场地各打过几只（没有 = 空数组） */
  observe(encounters: readonly { id: string; phase: string }[] | null | undefined): number[] {
    if (encounters !== this.list) {
      this.list = encounters ?? null;
      this.phases.clear();
      this.kills.clear();
    }
    const cleared: number[] = [];
    if (!encounters) return cleared;
    for (const e of encounters) {
      const before = this.phases.get(e.id);
      if (before === 'active' && e.phase === 'cleared') cleared.push(this.kills.get(e.id) ?? 0);
      if (before !== e.phase) {
        this.phases.set(e.id, e.phase);
        if (e.phase === 'active') this.kills.set(e.id, 0);
      }
    }
    return cleared;
  }
}
