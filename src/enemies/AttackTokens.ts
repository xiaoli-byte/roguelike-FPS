/**
 * 攻击令牌：限制同屏同时进入「前摇 / 开火」的敌人数量，并在相邻两次授予之间留出最小间隔，
 * 避免一群远程怪同步齐射、让玩家无从闪避。
 *
 *  - melee：近战出手（刀客劈砍、盾卫冲锋 / 盾击、炮兵枪托）
 *  - ranged：普通远程（弩矢、光球）
 *  - heavy：高伤远程（狙击瞄准、炮击、法阵），单独更严格的上限
 *
 * 令牌带过期时间，持有者死亡 / 被清理而没有归还时也会自动回收。
 * 由 EnemyManager 在 clear() 时 reset()。
 */
export type TokenKind = 'melee' | 'ranged' | 'heavy';

interface Hold {
  kind: TokenKind;
  until: number;
}

/** 两次授予之间的最小间隔（秒） */
const MIN_GAP: Record<TokenKind, number> = { melee: 0.12, ranged: 0.32, heavy: 0.7 };

class AttackDirector {
  private holds = new Map<number, Hold>();
  private lastGrant: Record<TokenKind, number> = { melee: -99, ranged: -99, heavy: -99 };
  /** 为 true 时正在被 killAll 清场：死亡爆炸等附带效果应跳过 */
  purging = false;

  /** 各类令牌的同时持有上限（随章节放宽） */
  cap(kind: TokenKind, chapter: number): number {
    const ch = Math.max(0, Math.min(2, chapter));
    switch (kind) {
      case 'melee': return 4 + ch;
      case 'ranged': return 2 + ch;
      case 'heavy': return ch === 0 ? 1 : 2;
    }
  }

  /**
   * 申请令牌。已持有则刷新时限并返回 true。
   * @param hold 最长持有秒数（超时自动回收）
   */
  tryAcquire(id: number, kind: TokenKind, now: number, hold: number, chapter: number): boolean {
    this.prune(now);
    const cur = this.holds.get(id);
    if (cur) {
      cur.kind = kind;
      cur.until = now + hold;
      return true;
    }
    if (now - this.lastGrant[kind] < MIN_GAP[kind]) return false;
    let n = 0;
    let rangedTotal = 0;
    for (const h of this.holds.values()) {
      if (h.kind === kind) n++;
      if (h.kind !== 'melee') rangedTotal++;
    }
    if (n >= this.cap(kind, chapter)) return false;
    // 远程与重型合计也有上限，防止两类同时满额
    if (kind !== 'melee' && rangedTotal >= this.cap('ranged', chapter) + 1) return false;
    this.holds.set(id, { kind, until: now + hold });
    this.lastGrant[kind] = now;
    return true;
  }

  release(id: number): void {
    this.holds.delete(id);
  }

  holding(id: number): boolean {
    return this.holds.has(id);
  }

  reset(): void {
    this.holds.clear();
    this.lastGrant.melee = this.lastGrant.ranged = this.lastGrant.heavy = -99;
    this.purging = false;
  }

  private prune(now: number): void {
    // 时钟回退（理论上不会发生，保险起见）时整体复位，避免旧时间戳长期卡住授予
    if (now + 1 < this.lastGrant.melee || now + 1 < this.lastGrant.ranged || now + 1 < this.lastGrant.heavy) {
      this.holds.clear();
      this.lastGrant.melee = this.lastGrant.ranged = this.lastGrant.heavy = -99;
      return;
    }
    for (const [id, h] of this.holds) if (h.until <= now) this.holds.delete(id);
  }
}

/** 全局唯一的攻击调度器 */
export const attackDirector = new AttackDirector();
