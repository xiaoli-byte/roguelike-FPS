/**
 * Role-aware arrivals with a complete ground warning at the final safe station.
 * Failed selections wait; they never become a centre/nearest-point spawn.
 */
import * as THREE from 'three';
import type { ArenaInfo, EnemyPlacement, GameContext, WavePlan } from '../core/types';
import { getEnemyDef } from '../enemies/Registry';

const WARN_LEAD = .8;
export const BOSS_LEAD = 1;
const MIN_SPAWN_DIST = 10;
const MAX_ALIVE = 10;
const WARN_COLOR = 0xff4a3a, ELITE_COLOR = 0xffc233, BOSS_COLOR = 0xc0182e;
const PROFILE: Record<EnemyPlacement, { min: number; max: number; angle: number }> = {
  assault: { min: 10, max: 16, angle: 0 }, flank: { min: 10, max: 19, angle: Math.PI / 2 },
  ranged: { min: 12, max: 21, angle: .45 }, precision: { min: 18, max: 30, angle: .55 },
  artillery: { min: 18, max: 27, angle: .2 }, support: { min: 13, max: 21, angle: .15 },
};
function defaultPlacement(id: string): EnemyPlacement {
  if (id === 'bomber') return 'flank';
  if (id === 'marksman') return 'precision';
  if (id === 'mortar') return 'artillery';
  if (id === 'shaman') return 'support';
  return id === 'archer' || id === 'wisp' ? 'ranged' : 'assault';
}
export function isBossId(id: string): boolean {
  const def = getEnemyDef(id);
  return def ? def.isBoss === true : id.startsWith('boss_');
}
interface PendingSpawn {
  warnAt: number; at: number; warned: boolean; id: string; elite: boolean;
  affix: string | undefined; boss: boolean; pos: THREE.Vector3 | null;
  placement: EnemyPlacement; lane: number; arrivalDelay: number; spaceBlocked: boolean; cancelWarning?: () => void;
}
interface Selected { pos: THREE.Vector3; placement: EnemyPlacement }
type SpawnBody = Pick<PendingSpawn, 'id' | 'elite'>;
export type WaveStartHandler = (index: number, total: number, hasBoss: boolean) => void;
export interface SpawnRegion {
  center: THREE.Vector3; minRadius: number; maxRadius: number; minPlayerDistance: number;
  /** A route encounter may supply its own stations instead of the altar's. */
  anchors?: ArenaInfo['spawnAnchors'];
  /** Authored rooms may be concave; a radius alone can cross a separating wall. */
  contains?: (point: THREE.Vector3, halfWidth: number) => boolean;
}
export class WaveRunner {
  readonly waves: readonly WavePlan[];
  current = -1;
  lastActivity = 0;
  private next = 0;
  private nextAt: number;
  private pending: PendingSpawn[] = [];
  private used = new Map<string, number>();
  private readonly path: THREE.Vector3[] = [];
  private readonly eye = new THREE.Vector3();
  private readonly target = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext, private readonly arena: ArenaInfo, waves: WavePlan[],
    firstAt: number, private readonly bossPoint: THREE.Vector3, private readonly onWaveStart: WaveStartHandler,
    private readonly spawnRegion?: SpawnRegion,
  ) { this.waves = waves; this.nextAt = firstAt; }

  get allStarted(): boolean { return this.next >= this.waves.length; }
  get done(): boolean { return this.allStarted && this.pending.length === 0; }
  /** Only failed station selection counts; scheduled arrivals and active warnings do not. */
  get waitingForSpace(): boolean { return this.pending.some(p => p.spaceBlocked); }
  cancel(): void {
    this.next = this.waves.length;
    for (const p of this.pending) p.cancelWarning?.();
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
      if (t < p.warnAt) continue;
      if (!p.boss && ctx.enemies.aliveCount() >= MAX_ALIVE) { p.spaceBlocked = false; this.defer(p, t); continue; }
      if (!p.warned) {
        if ((!p.boss || this.spawnRegion?.contains) && (!p.pos || !this.pointSafe(p.pos, p))) p.pos = this.pickPoint(p.placement, p.lane, t, p);
        if (!p.pos) { p.spaceBlocked = true; this.defer(p, t); continue; }
        p.spaceBlocked = false;
        p.warned = true;
        // A slow frame may cross warnAt and at. Actual on-screen lead remains full.
        p.at = Math.max(p.at, t + (p.boss ? BOSS_LEAD : WARN_LEAD));
        const cancel = ctx.fx.groundWarning(p.pos, p.boss ? 3.4 : 1.2, p.at - t, p.boss ? BOSS_COLOR : p.elite ? ELITE_COLOR : WARN_COLOR);
        if (typeof cancel === 'function') p.cancelWarning = cancel;
        if (p.boss) { ctx.audio.play('telegraph', { position: p.pos }); ctx.fx.shake(.25, 1); }
      }
      if (t < p.at) continue;
      if ((!p.boss || this.spawnRegion?.contains) && (!p.pos || !this.pointSafe(p.pos, p))) {
        p.cancelWarning?.(); p.cancelWarning = undefined; p.warned = false;
        p.pos = this.pickPoint(p.placement, p.lane, t, p);
        p.spaceBlocked = !p.pos;
        p.warnAt = t + (p.pos ? 0 : .25); p.at = p.warnAt + (p.boss ? BOSS_LEAD : WARN_LEAD);
        continue;
      }
      const last = this.pending.pop();
      if (last && last !== p) this.pending[i] = last;
      p.cancelWarning?.();
      if (p.pos) this.spawn(p, t);
    }
  }
  private defer(p: PendingSpawn, t: number): void {
    p.cancelWarning?.(); p.cancelWarning = undefined; p.warned = false;
    p.warnAt = t + .25; p.at = p.warnAt + (p.boss ? BOSS_LEAD : WARN_LEAD);
  }
  private spawn(p: PendingSpawn, t: number): void {
    this.lastActivity = t;
    try { this.ctx.enemies.spawn(p.id, { position: p.pos!, elite: p.elite || undefined, affix: p.affix, level: this.ctx.run.difficulty }); }
    catch (err) { console.error('[WaveRunner] spawn failed', p.id, err); }
  }
  private startWave(t: number): void {
    const index = this.next++, w = this.waves[index], rng = this.ctx.rng;
    this.current = index; this.nextAt = NaN; this.lastActivity = t;
    const mobs: { id: string; elite: boolean; affix: string | undefined; placement: EnemyPlacement; arrivalDelay: number; boss: boolean }[] = [];
    for (const e of w.entries) {
      const count = Number.isFinite(e.count) ? Math.max(0, Math.floor(e.count)) : 0;
      for (let k = 0; k < count; k++) mobs.push({
        id: e.enemyId, elite: !!e.elite, affix: e.affix, placement: e.placement ?? defaultPlacement(e.enemyId),
        arrivalDelay: Number.isFinite(e.arrivalDelay) ? Math.max(0, e.arrivalDelay ?? 0) : 0, boss: isBossId(e.enemyId),
      });
    }
    // Shuffle ties only; tactical stations and intentional arrival delays survive.
    rng.shuffle(mobs); mobs.sort((a, b) => Number(b.boss) - Number(a.boss) || a.arrivalDelay - b.arrivalDelay);
    const anchors = this.spawnRegion?.anchors ?? this.arena.spawnAnchors ?? [];
    const lanes = [...new Set(anchors.map(a => a.lane))].sort((a, b) => a - b);
    const base = index % Math.max(1, lanes.length), selected: Selected[] = [];
    let off = 0, bosses = 0, flank = 0;
    for (const m of mobs) {
      const lane = m.placement === 'flank' ? (lanes[(base + 1 + flank++ % 2) % Math.max(1, lanes.length)] ?? 1) : (lanes[base] ?? 0);
      const pos = m.boss ? this.bossPoint.clone() : this.pickPoint(m.placement, lane, t, m, selected);
      if (m.boss && bosses++ > 0) { pos!.x += Math.sin(bosses * 2.4) * 5; pos!.z += Math.cos(bosses * 2.4) * 5; this.ctx.nav.nearestWalkable(pos!, pos!); }
      if (pos && !m.boss) selected.push({ pos, placement: m.placement });
      const lead = m.boss ? BOSS_LEAD : WARN_LEAD;
      const warnAt = t + off + m.arrivalDelay;
      this.pending.push({ ...m, lane, warnAt, at: warnAt + lead, warned: false, pos, spaceBlocked: false });
      off += m.boss ? BOSS_LEAD * .6 : rng.range(.1, .3);
    }
    this.onWaveStart(index, this.waves.length, bosses > 0);
  }

  /** Same full safety test for initial selection, warning and actual arrival. */
  private pointSafe(point: THREE.Vector3, enemy: SpawnBody): boolean {
    if (!Number.isFinite(point.x + point.y + point.z) || Math.abs(point.y - this.arena.floorY) > .1) return false;
    const def = getEnemyDef(enemy.id), scale = enemy.elite ? 1.25 : 1;
    // NavGrid's player-sized foot is narrower than shields and elite bodies.
    // Reserve the full enemy radius plus clearance, rather than its .85 movement collider.
    const halfW = (def?.radius ?? .9) * scale + .15, height = (def?.height ?? 2.5) * scale + .1;
    const P = this.ctx.player.position, region = this.spawnRegion;
    if (Math.hypot(point.x - P.x, point.z - P.z) < Math.max(MIN_SPAWN_DIST, region?.minPlayerDistance ?? 0)) return false;
    const edge = Math.max(.8, halfW);
    if (point.x < this.arena.minX + edge || point.x > this.arena.maxX - edge || point.z < this.arena.minZ + edge || point.z > this.arena.maxZ - edge) return false;
    if (region) {
      const d = Math.hypot(point.x - region.center.x, point.z - region.center.z);
      if (d < region.minRadius || d > region.maxRadius) return false;
      if (region.contains && !region.contains(point, halfW)) return false;
    }
    if (!this.ctx.nav.isWalkable(point.x, point.z)) return false;
    if (typeof this.ctx.world.overlapsBody === 'function' && this.ctx.world.overlapsBody(point.x, point.y, point.z, halfW, height)) return false;
    // The real NavGrid can return a path ending in the nearest reachable cell.
    // Merely returning true must not permit a spawn in an isolated component.
    if (typeof this.ctx.nav.findPath === 'function') {
      this.path.length = 0;
      if (!this.ctx.nav.findPath(P, point, this.path)) return false;
      const end = this.path[this.path.length - 1] ?? P;
      if (Math.hypot(end.x - point.x, end.z - point.z) > .15) return false;
    }
    return true;
  }
  private pointKey(p: THREE.Vector3): string { return p.x.toFixed(2) + '/' + p.z.toFixed(2); }
  private stationScore(point: THREE.Vector3, role: EnemyPlacement, lane: number, t: number, selected: readonly Selected[]): number {
    const P = this.ctx.player.position, center = this.spawnRegion?.center ?? this.arena.center, profile = PROFILE[role];
    const d = Math.hypot(point.x - P.x, point.z - P.z);
    let score = -Math.abs(d - (profile.min + profile.max) / 2) * .13;
    const dx = center.x - P.x, dz = center.z - P.z;
    const axis = Math.hypot(dx, dz) > 1 ? Math.atan2(dx, dz) : Math.atan2(-Math.sin(this.ctx.player.yaw), -Math.cos(this.ctx.player.yaw));
    const desired = axis + profile.angle * (lane % 2 ? -1 : 1), angle = Math.atan2(point.x - center.x, point.z - center.z);
    score += Math.cos(angle - desired) * 1.2;
    if (t - (this.used.get(this.pointKey(point)) ?? -999) < 2.5) score -= 1.5;
    let friend = Infinity;
    for (const other of selected) {
      const distance = Math.hypot(point.x - other.pos.x, point.z - other.pos.z);
      if (distance < 4) score -= (4 - distance) * 1.4;
      if (other.placement === 'assault' || other.placement === 'flank') friend = Math.min(friend, distance);
    }
    if (role === 'support' && Number.isFinite(friend)) score -= Math.max(0, friend - 8) * .3;
    if ((role === 'ranged' || role === 'precision') && typeof this.ctx.world.segmentBlocked === 'function') {
      this.eye.set(point.x, point.y + 1.7, point.z); this.target.set(P.x, P.y + 1.5, P.z);
      if (this.ctx.world.segmentBlocked(this.eye, this.target)) score -= 2;
    }
    return score;
  }
  private pickPoint(role: EnemyPlacement, lane: number, t: number, enemy: SpawnBody, selected: readonly Selected[] = []): THREE.Vector3 | null {
    const anchors = this.spawnRegion?.anchors ?? this.arena.spawnAnchors ?? [];
    const candidates: { point: THREE.Vector3; score: number }[] = [];
    for (const a of anchors) candidates.push({ point: a.position, score: this.stationScore(a.position, role, lane, t, selected) + (a.role === role ? 8 : -3) + (a.lane === lane ? 2 : 0) });
    for (const point of this.arena.spawnPoints) candidates.push({ point, score: this.stationScore(point, role, lane, t, selected) });
    // Ground stations win first, while legacy rings still have role/direction scores.
    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      if (!this.pointSafe(c.point, enemy)) continue;
      this.used.set(this.pointKey(c.point), t);
      return c.point.clone();
    }
    // No legal station: seek the SAME role and angle within this local encounter.
    const region = this.spawnRegion, center = region?.center ?? this.arena.center, profile = PROFILE[role], P = this.ctx.player.position;
    const dx = center.x - P.x, dz = center.z - P.z;
    const axis = Math.hypot(dx, dz) > 1 ? Math.atan2(dx, dz) : Math.atan2(-Math.sin(this.ctx.player.yaw), -Math.cos(this.ctx.player.yaw));
    const min = Math.max(region?.minRadius ?? 10, Math.min(profile.min, region?.maxRadius ?? profile.min));
    const max = Math.max(min, Math.min(region?.maxRadius ?? profile.max, profile.max));
    const target = new THREE.Vector3(), candidate = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const angle = axis + profile.angle * (lane % 2 ? -1 : 1) + this.ctx.rng.range(-.65, .65);
      const radius = this.ctx.rng.range(min, max);
      target.set(center.x + Math.sin(angle) * radius, this.arena.floorY, center.z + Math.cos(angle) * radius);
      if (!this.ctx.nav.randomWalkable(target, 0, .9, candidate) || !this.pointSafe(candidate, enemy)) continue;
      this.used.set(this.pointKey(candidate), t);
      return candidate.clone();
    }
    return null;
  }
}
