/**
 * 波次调度：按 WavePlan 依次开波；每只怪刷新前在刷怪点显示 0.8 秒地面预警，同波内错开 0.1–0.3 秒刷出。
 * 后一波在「上一波全部刷完且存活数 <= triggerRemaining」后再等 delay 秒开始。
 * 刷怪点选择：离玩家 >= 10 米、彼此分散，避免全部集中在玩家正前方视野中心或全部在背后。
 */
import * as THREE from 'three';
import type { ArenaInfo, GameContext, WavePlan } from '../core/types';
import { getEnemyDef } from '../enemies/Registry';

/** 预警提前量（秒） */
const WARN_LEAD = 0.8;
/** Boss 登场预警提前量 */
export const BOSS_LEAD = 1.0;
const MIN_SPAWN_DIST = 10;
const WARN_COLOR = 0xff4a3a;
const ELITE_COLOR = 0xffc233;
const BOSS_COLOR = 0xc0182e;

export function isBossId(id: string): boolean {
  const def = getEnemyDef(id);
  if (def) return def.isBoss === true;
  return id.startsWith('boss_');
}

interface PendingSpawn {
  warnAt: number;
  at: number;
  warned: boolean;
  id: string;
  elite: boolean;
  affix: string | undefined;
  boss: boolean;
  pos: THREE.Vector3;
}

export type WaveStartHandler = (index: number, total: number, hasBoss: boolean) => void;

export class WaveRunner {
  readonly waves: readonly WavePlan[];
  /** 最近开始的波次（-1 = 尚未开始） */
  current = -1;
  /** 最近一次开波 / 刷怪的时间 */
  lastActivity = 0;
  private next = 0;
  private nextAt: number;
  private pending: PendingSpawn[] = [];
  /** 每个刷怪点最近一次被使用的时间 */
  private used: Float64Array;

  constructor(
    private readonly ctx: GameContext,
    private readonly arena: ArenaInfo,
    waves: WavePlan[],
    firstAt: number,
    private readonly bossPoint: THREE.Vector3,
    private readonly onWaveStart: WaveStartHandler,
  ) {
    this.waves = waves;
    this.nextAt = firstAt;
    this.used = new Float64Array(Math.max(1, arena.spawnPoints.length)).fill(-999);
  }

  get allStarted(): boolean {
    return this.next >= this.waves.length;
  }

  /** 所有波次都已开始且没有待刷出的怪 */
  get done(): boolean {
    return this.allStarted && this.pending.length === 0;
  }

  /** 取消剩余波次与待刷出的怪（Boss 倒下时） */
  cancel(): void {
    this.next = this.waves.length;
    this.pending.length = 0;
  }

  update(t: number): void {
    const ctx = this.ctx;
    if (this.next < this.waves.length) {
      if (Number.isNaN(this.nextAt) && this.pending.length === 0) {
        const w = this.waves[this.next];
        if (ctx.enemies.aliveCount() <= Math.max(0, w.triggerRemaining ?? 0)) this.nextAt = t + Math.max(0, w.delay ?? 1.2);
      }
      if (t >= this.nextAt) this.startWave(t);
    }

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (!p.warned && t >= p.warnAt) {
        p.warned = true;
        const color = p.boss ? BOSS_COLOR : p.elite ? ELITE_COLOR : WARN_COLOR;
        ctx.fx.groundWarning(p.pos, p.boss ? 3.4 : 1.2, Math.max(0.1, p.at - t), color);
        if (p.boss) {
          ctx.audio.play('telegraph', { position: p.pos });
          ctx.fx.shake(0.25, 1.0);
        }
      }
      if (t >= p.at) {
        // 交换删除（倒序遍历，被换过来的元素本帧已处理过）
        const last = this.pending.pop();
        if (last && last !== p) this.pending[i] = last;
        this.spawn(p, t);
      }
    }
  }

  private spawn(p: PendingSpawn, t: number): void {
    this.lastActivity = t;
    try {
      this.ctx.enemies.spawn(p.id, {
        position: p.pos,
        elite: p.elite || undefined,
        affix: p.affix,
        level: this.ctx.run.difficulty,
      });
    } catch (err) {
      console.error(`[WaveRunner] spawn "${p.id}" failed`, err);
    }
  }

  private startWave(t: number): void {
    const ctx = this.ctx;
    const rng = ctx.rng;
    const index = this.next++;
    this.current = index;
    this.nextAt = NaN;
    this.lastActivity = t;
    const w = this.waves[index];

    const bosses: { id: string; elite: boolean; affix: string | undefined }[] = [];
    const mobs: { id: string; elite: boolean; affix: string | undefined }[] = [];
    for (const e of w.entries) {
      const n = Math.max(0, Math.floor(e.count));
      for (let k = 0; k < n; k++) {
        const item = { id: e.enemyId, elite: !!e.elite, affix: e.affix };
        if (isBossId(e.enemyId)) bosses.push(item);
        else mobs.push(item);
      }
    }
    rng.shuffle(mobs);

    let off = 0;
    for (let k = 0; k < bosses.length; k++) {
      const b = bosses[k];
      const pos = this.bossPoint.clone();
      if (k > 0) {
        const a = (k / bosses.length) * Math.PI * 2;
        pos.x += Math.sin(a) * 5;
        pos.z += Math.cos(a) * 5;
        ctx.nav.nearestWalkable(pos, pos);
      }
      this.pending.push({ warnAt: t, at: t + BOSS_LEAD, warned: false, id: b.id, elite: b.elite, affix: b.affix, boss: true, pos });
      off = BOSS_LEAD * 0.6;
    }
    const pts = this.pickPoints(mobs.length, t);
    for (let k = 0; k < mobs.length; k++) {
      const m = mobs[k];
      this.pending.push({ warnAt: t + off, at: t + off + WARN_LEAD, warned: false, id: m.id, elite: m.elite, affix: m.affix, boss: false, pos: pts[k] });
      off += rng.range(0.1, 0.3);
    }
    this.onWaveStart(index, this.waves.length, bosses.length > 0);
  }

  /**
   * 为 n 只怪挑选刷怪位置：打分 = 距离偏好 + 视角惩罚（正前方视野中心 / 背后都会随数量递增扣分）
   * + 分散惩罚（与本波已选点太近）+ 最近使用惩罚 + 随机扰动；最后在点附近 0.3–1.8 米随机偏移。
   */
  private pickPoints(n: number, t: number): THREE.Vector3[] {
    const ctx = this.ctx;
    const rng = ctx.rng;
    const pts = this.arena.spawnPoints;
    const out: THREE.Vector3[] = [];
    if (n <= 0) return out;
    if (pts.length === 0) {
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3();
        ctx.nav.randomWalkable(ctx.player.position, 12, 24, v);
        out.push(v);
      }
      return out;
    }
    const P = ctx.player.position;
    const yaw = ctx.player.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const waveUse = new Array<number>(pts.length).fill(0);
    let front = 0;
    let behind = 0;
    for (let k = 0; k < n; k++) {
      let best = 0;
      let bestS = -Infinity;
      let bestCls = 0;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        const dx = q.x - P.x;
        const dz = q.z - P.z;
        const d = Math.hypot(dx, dz);
        let s = rng.next() * 0.8;
        if (d < MIN_SPAWN_DIST) s -= 60 - d; // 太近：除非别无选择
        else if (d <= 30) s += 0.6;
        else s += 0.2;
        const cos = d > 1e-3 ? (dx * fx + dz * fz) / d : 0;
        let cls = 0;
        if (cos > 0.93) {
          cls = 1;
          s -= 0.8 + front * 0.35;
        } else if (cos < -0.6) {
          cls = -1;
          s -= 0.45 + behind * 0.45;
        }
        s -= waveUse[i] * 1.4;
        if (t - this.used[i] < 2.5) s -= 0.6;
        for (const c of out) {
          const dd = Math.hypot(q.x - c.x, q.z - c.z);
          if (dd < 7) s -= (7 - dd) * 0.16;
        }
        if (s > bestS) {
          bestS = s;
          best = i;
          bestCls = cls;
        }
      }
      waveUse[best]++;
      this.used[best] = t;
      if (bestCls > 0) front++;
      else if (bestCls < 0) behind++;
      const v = new THREE.Vector3();
      if (!ctx.nav.randomWalkable(pts[best], 0.3, 1.8, v)) v.copy(pts[best]);
      out.push(v);
    }
    return out;
  }
}
