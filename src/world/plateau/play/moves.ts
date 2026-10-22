/**
 * 招式时间轴（docs/level-design/chuanzang-combat-v1.md 0.1，和 Unity 的 BossMove 一致）：
 * 前摇 windup（画预警，预警填满的那一刻正好出手）→ 出手 active（判定）→ 收招 recover（固定破绽）。
 * 招式 id 就是动画状态名：以后烘焙进 Unity 时，片段按 id 切，events 写进 <资产>.events.json。
 *
 * 每种怪 / 领主在模块加载时用 defineMoves(资产 ID, [...]) 登记一张表；AI 用 MoveRunner 跑。
 * moveTable() 把全部表按 events.json 的格式导出（{ clips: { <状态>: [{ at: 0–1, name }] } }）。
 */

export type MoveStage = 'windup' | 'active' | 'recover';

export interface MoveEvent {
  /** 从前摇开始算的秒数 */
  at: number;
  /** warn（出预警）、glint（出手闪光）、hit（伤害判定）、release（放出投射物）、land（落地）、end（收招结束），或招式自己的名字 */
  name: string;
}

export interface MoveDef {
  id: string;
  /** 中文名（调试叠层、报告） */
  name: string;
  windup: number;
  /** 出手段时长；按距离结束的招（冲撞、滑翔、踩踏）是上限，AI 调 finishActive() 提前收 */
  active: number;
  recover: number;
  cooldown?: number;
  weight?: number;
  /** 最早哪个阶段可用（领主，1 起） */
  minPhase?: number;
  /** 霸体：出招中不会被硬直打断（眩晕、破防照样打断） */
  armored?: boolean;
  /** 危险招：出手前 0.25 秒在弱点上闪白星 */
  glint?: boolean;
  /** 额外的时间点（出手段里的多段判定、连吐、连捶）；warn / glint / hit / end 自动生成 */
  events?: MoveEvent[];
  /** 没有 hit（位移、待机、增益类） */
  noHit?: boolean;
}

const TABLES = new Map<string, MoveDef[]>();

/** 登记一张招式表（同一资产登记多次会合并：雷牦复用獓狠的模型和片段） */
export function defineMoves(asset: string, moves: MoveDef[]): Record<string, MoveDef> {
  const list = TABLES.get(asset) ?? [];
  for (const m of moves) if (!list.some(o => o.id === m.id)) list.push(m);
  TABLES.set(asset, list);
  return Object.fromEntries(moves.map(m => [m.id, m]));
}

/** 某资产登记的全部招式 */
export function movesOf(asset: string): MoveDef[] { return TABLES.get(asset) ?? []; }

/** 一招的全部时间点（按时间排序） */
export function moveEvents(m: MoveDef): MoveEvent[] {
  const ev: MoveEvent[] = [{ at: 0, name: 'warn' }];
  if (m.glint) ev.push({ at: Math.max(0, m.windup - 0.25), name: 'glint' });
  if (!m.noHit) ev.push({ at: m.windup, name: 'hit' });
  for (const e of m.events ?? []) ev.push(e);
  ev.push({ at: m.windup + m.active + m.recover, name: 'end' });
  return ev.sort((a, b) => a.at - b.at);
}

/** events.json 格式：每个资产一份 { clips: { <招式 id>: [{ at: 0–1, name }] } } */
export function moveTable(): Record<string, { clips: Record<string, { at: number; name: string }[]>; moves: Record<string, { name: string; windup: number; active: number; recover: number; cooldown?: number; minPhase?: number; armored?: boolean }> }> {
  const out: ReturnType<typeof moveTable> = {};
  for (const [asset, list] of [...TABLES.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const clips: Record<string, { at: number; name: string }[]> = {};
    const moves: ReturnType<typeof moveTable>[string]['moves'] = {};
    for (const m of list) {
      const total = Math.max(1e-3, m.windup + m.active + m.recover);
      clips[m.id] = moveEvents(m).map(e => ({ at: Math.round((e.at / total) * 1000) / 1000, name: e.name }));
      moves[m.id] = { name: m.name, windup: m.windup, active: m.active, recover: m.recover, cooldown: m.cooldown, minPhase: m.minPhase, armored: m.armored };
    }
    out[asset] = { clips, moves };
  }
  return out;
}

/**
 * 跑一招：update(dt) 推进时间，返回这一帧经过的时间点（warn / glint / hit / … / end）。
 * speed：出手速度倍率（连鼓灵红鼓加速 1.4、眩晕时 AI 不推进）。
 */
export class MoveRunner {
  def: MoveDef | null = null;
  /** 本招已进行的秒数 */
  t = 0;
  speed = 1;
  /** 本招出过的次数（调试、试玩脚本检查覆盖） */
  readonly count = new Map<string, number>();
  private events: MoveEvent[] = [];
  private next = 0;
  private activeLen = 0;
  private cutAt = Infinity;

  get busy(): boolean { return this.def !== null; }
  get id(): string { return this.def?.id ?? ''; }

  get stage(): MoveStage | null {
    const d = this.def;
    if (!d) return null;
    if (this.t < d.windup) return 'windup';
    if (this.t < d.windup + this.activeLen) return 'active';
    return 'recover';
  }

  /** 当前这一段已进行的秒数 */
  get stageT(): number {
    const d = this.def;
    if (!d) return 0;
    if (this.t < d.windup) return this.t;
    if (this.t < d.windup + this.activeLen) return this.t - d.windup;
    return this.t - d.windup - this.activeLen;
  }

  /** 当前这一段的进度 0..1 */
  get stageK(): number {
    const d = this.def;
    if (!d) return 0;
    const len = this.stage === 'windup' ? d.windup : this.stage === 'active' ? this.activeLen : d.recover;
    return len > 0 ? Math.min(1, this.stageT / len) : 1;
  }

  start(def: MoveDef): void {
    this.def = def;
    this.t = 0;
    this.activeLen = def.active;
    this.cutAt = Infinity;
    this.events = moveEvents(def);
    this.next = 0;
    this.count.set(def.id, (this.count.get(def.id) ?? 0) + 1);
  }

  /** 出手段提前结束（冲撞撞到东西、滑翔落地），直接进收招 */
  finishActive(): void {
    const d = this.def;
    if (!d || this.stage !== 'active') return;
    const cut = this.t - d.windup;
    this.activeLen = cut;
    // 收招之后的时间点平移到新的出手结束时刻
    this.cutAt = d.windup + cut;
    const shift = d.active - cut;
    for (let i = this.next; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.at >= d.windup + d.active - 1e-6) this.events[i] = { at: e.at - shift, name: e.name };
      else if (e.at > this.cutAt) this.events[i] = { at: this.cutAt, name: e.name };
    }
  }

  cancel(): void { this.def = null; this.t = 0; }

  update(dt: number): string[] {
    const d = this.def;
    if (!d) return [];
    this.t += dt * this.speed;
    const fired: string[] = [];
    while (this.next < this.events.length && this.events[this.next].at <= this.t + 1e-6) fired.push(this.events[this.next++].name);
    if (this.t >= d.windup + this.activeLen + d.recover) this.def = null;
    return fired;
  }
}
