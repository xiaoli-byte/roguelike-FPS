import * as THREE from 'three';
import type { GameContext } from '../core/types';
import { whiteboxPoint } from '../world/WhiteboxGen';
import type { WhiteboxMetadata } from '../world/WhiteboxTypes';

export interface WhiteboxProbeReport {
  planId: string;
  method: 'runtime-body-and-nav-probe';
  passages: { id: string; distance: number; passed: boolean; error?: string }[];
  checkpoints: { id: string; passed: boolean; error?: string }[];
  passed: boolean;
}

/** A separate 0.7 × 1.8 m collision probe, never a teleported player playtest. */
export function probeWhitebox(ctx: GameContext, metadata: WhiteboxMetadata): WhiteboxProbeReport {
  const floorY = ctx.stage.arena?.floorY ?? 0, { plan } = metadata;
  const toWorld = (at: readonly number[]): THREE.Vector3 => {
    const p = whiteboxPoint(plan, at); return new THREE.Vector3(p.x, floorY + .001, p.z);
  };
  const passages: WhiteboxProbeReport['passages'] = plan.passages.map(passage => {
    const points = passage.points.map(toWorld), position = points[0].clone();
    const delta = new THREE.Vector3();
    let distance = 0;
    let error = ctx.world.overlapsBody(position.x, position.y, position.z, .35, 1.8) ? '中心线起点没有玩家净空' : '';
    for (let i = 1; i < points.length && !error; i++) {
      const start = position.clone(), target = points[i], segmentLength = start.distanceTo(target);
      const steps = Math.max(1, Math.ceil(segmentLength / .12));
      for (let step = 1; step <= steps; step++) {
        const expected = start.clone().lerp(target, step / steps);
        delta.set(expected.x - position.x, -.015, expected.z - position.z);
        const before = position.clone();
        ctx.world.moveBody(position, .35, 1.8, delta, true, .45);
        distance += Math.hypot(position.x - before.x, position.z - before.z);
        if (Math.hypot(position.x - expected.x, position.z - expected.z) > .08 || Math.abs(position.y - floorY) > .08) {
          error = `中心线受阻 (${position.x.toFixed(1)}, ${position.z.toFixed(1)})`; break;
        }
      }
    }
    return { id: passage.id, distance: Number(distance.toFixed(2)), passed: !error, ...(error ? { error } : {}) };
  });
  const from = toWorld(plan.entry.at), path: THREE.Vector3[] = [];
  const checkpoints: WhiteboxProbeReport['checkpoints'] = metadata.checkpoints.map(point => {
    const target = new THREE.Vector3(point.x, floorY + .001, point.z);
    const blocked = ctx.world.overlapsBody(point.x, floorY + .001, point.z, .35, 1.8);
    const found = ctx.nav.findPath(from, target, path);
    const end = path[path.length - 1] ?? from;
    const reached = found && Math.hypot(end.x - target.x, end.z - target.z) < 1.2;
    const error = blocked ? '关键点没有玩家净空' : !reached ? '实际导航未抵达关键点' : '';
    return { id: point.id, passed: !error, ...(error ? { error } : {}) };
  });
  return { planId: plan.id, method: 'runtime-body-and-nav-probe', passages, checkpoints, passed: passages.every(p => p.passed) && checkpoints.every(p => p.passed) };
}

export interface WalkReport {
  state: 'idle' | 'walking' | 'passed' | 'failed' | 'stopped';
  targetId: string;
  targetLabel: string;
  elapsed: number;
  distance: number;
  remaining: number;
  message: string;
}

/** Drive the existing PlayerController with its public Input test interface. */
export class WhiteboxWalker {
  report: WalkReport = { state: 'idle', targetId: '', targetLabel: '', elapsed: 0, distance: 0, remaining: 0, message: '' };
  private path: THREE.Vector3[] = [];
  private index = 0;
  private target = new THREE.Vector3();
  private previous = new THREE.Vector3();
  private bestDistance = Infinity;
  private stalled = 0;

  constructor(private readonly ctx: GameContext) {}

  start(id: string, label: string, target: THREE.Vector3, via: readonly THREE.Vector3[] = []): boolean {
    this.stop();
    const ctx = this.ctx;
    this.path.length = 0;
    let from = ctx.player.position;
    for (const next of [...via, target]) {
      const leg: THREE.Vector3[] = [];
      const found = ctx.nav.findPath(from, next, leg);
      const end = leg[leg.length - 1] ?? from;
      if (!found || Math.hypot(end.x - next.x, end.z - next.z) > 1.2) {
        this.report = { state: 'failed', targetId: id, targetLabel: label, elapsed: 0, distance: 0, remaining: ctx.player.position.distanceTo(target), message: '导航没有通向该路线全部折点的完整路径。' };
        return false;
      }
      this.path.push(...leg, next.clone()); from = next;
    }
    this.target.copy(target); this.previous.copy(ctx.player.position);
    this.index = 0; this.stalled = 0; this.bestDistance = Infinity;
    this.report = { state: 'walking', targetId: id, targetLabel: label, elapsed: 0, distance: 0, remaining: ctx.player.position.distanceTo(target), message: '真实控制器步行中；没有传送、改速或跳过碰撞。' };
    return true;
  }

  update(dt: number): void {
    if (this.report.state !== 'walking') return;
    const ctx = this.ctx, p = ctx.player.position;
    this.report.elapsed += dt;
    this.report.distance += Math.hypot(p.x - this.previous.x, p.z - this.previous.z);
    this.previous.copy(p);
    this.report.remaining = Math.hypot(p.x - this.target.x, p.z - this.target.z);
    if (this.index >= this.path.length - 1 && this.report.remaining < .55) { this.finish('passed', '已用真实移动抵达；战斗与人工空间判断仍需试玩。'); return; }
    if (this.report.elapsed > 180) { this.finish('failed', '步行超过 180 秒，检查路线或战斗阻挡。'); return; }
    while (this.index < this.path.length && Math.hypot(p.x - this.path[this.index].x, p.z - this.path[this.index].z) < .5) {
      this.index++; this.bestDistance = Infinity; this.stalled = 0;
    }
    const waypoint = this.path[Math.min(this.index, this.path.length - 1)];
    const dx = waypoint.x - p.x, dz = waypoint.z - p.z, distance = Math.hypot(dx, dz);
    if (distance < this.bestDistance - .06) { this.bestDistance = distance; this.stalled = 0; } else this.stalled += dt;
    if (this.stalled > 3) { this.finish('failed', `在 (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) 停滞，检查掩体拐角与敌人阻挡。`); return; }
    ctx.player.yaw = Math.atan2(-dx, -dz); ctx.player.pitch = 0;
    ctx.input.simulateKey('KeyW', true);
  }

  stop(): void {
    this.ctx.input.simulateKey('KeyW', false);
    if (this.report.state === 'walking') this.finish('stopped', '步行已停止，当前位置保留。');
  }

  reset(): void {
    this.stop(); this.path.length = 0;
    this.report = { state: 'idle', targetId: '', targetLabel: '', elapsed: 0, distance: 0, remaining: 0, message: '' };
  }

  private finish(state: 'passed' | 'failed' | 'stopped', message: string): void {
    this.ctx.input.simulateKey('KeyW', false);
    this.report.state = state; this.report.message = message;
  }
}
