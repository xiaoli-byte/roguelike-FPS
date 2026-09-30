/**
 * 敌人管理器：刷怪、逐帧更新、敌人间分离与玩家推挤、移除与释放，
 * 以及供武器 / 技能 / 战斗使用的空间查询（射线、半径、最近）。
 */
import * as THREE from 'three';
import type { EnemyRayHit, GameContext, IEnemy, IEnemyManager, SpawnOptions } from '../core/types';
import { raySphere } from '../core/math';
import type { MoveResult } from '../world/Collision';
import type { EnemyBase } from './EnemyBase';
import { getEnemyEntry } from './Registry';
import { attackDirector } from './AttackTokens';
import { isAffixId, rollAffix } from './Affixes';

const _c = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _rayOut = { distance: 0, headshot: false };
const _move: MoveResult = { onGround: false, hitWall: false, hitCeiling: false, stepped: false, groundY: 0, wallNormal: new THREE.Vector3() };

/** 分离修正的柔度（每秒趋近速率）与单帧最大修正量 */
const SEPARATION_RATE = 14;
const MAX_PUSH = 0.25;

export class EnemyManager implements IEnemyManager {
  private readonly enemies: EnemyBase[] = [];
  /** 分离修正累积（x, z 交错存放），按需扩容 */
  private push = new Float32Array(64);
  private errorsLogged = 0;

  constructor(readonly ctx: GameContext) {}

  /** 当前所有敌人（含播放死亡动画中的） */
  get list(): readonly IEnemy[] {
    return this.enemies;
  }

  // ───────────── 生命周期 ─────────────

  spawn(defId: string, opts: SpawnOptions): IEnemy | null {
    const entry = getEnemyEntry(defId);
    if (!entry) {
      console.warn(`[EnemyManager] 未注册的敌人 "${defId}"`);
      return null;
    }
    const o: SpawnOptions = {
      position: opts.position,
      elite: opts.elite,
      affix: opts.affix,
      level: opts.level ?? this.ctx.run.difficulty,
    };
    // 精英没有（或给了无法识别的）词缀时随机一个
    if (o.elite && !entry.def.isBoss && !isAffixId(o.affix)) o.affix = rollAffix(this.ctx.rng, defId);

    let e: EnemyBase;
    try {
      e = entry.factory(this.ctx, o);
      e.init();
    } catch (err) {
      console.error(`[EnemyManager] 生成敌人 "${defId}" 失败`, err);
      return null;
    }
    this.enemies.push(e);
    this.ctx.events.emit('enemy:spawned', { enemy: e });
    return e;
  }

  update(dt: number): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.removed) continue;
      try {
        e.update(dt);
      } catch (err) {
        if (this.errorsLogged++ < 5) console.error(`[EnemyManager] 敌人 "${e.def.id}" 更新出错`, err);
      }
    }
    this.separate(dt);

    // 移除死亡动画播完的敌人（原地压缩数组，list 引用保持不变）
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.removed) this.disposeEnemy(e);
      else list[w++] = e;
    }
    list.length = w;
  }

  clear(): void {
    for (const e of this.enemies) this.disposeEnemy(e);
    this.enemies.length = 0;
    attackDirector.reset();
  }

  private disposeEnemy(e: EnemyBase): void {
    try {
      e.dispose();
    } catch (err) {
      console.error('[EnemyManager] dispose 出错', err);
      e.root.removeFromParent();
    }
  }

  // ───────────── 查询 ─────────────

  aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /**
   * 最近的被射线命中的活敌人。dir 需归一化。先用包围球粗筛，再做头部球 + 身体胶囊精测。
   * 只在命中时分配一个结果对象（调用方可以安全保留）。
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: ReadonlySet<IEnemy>): EnemyRayHit | null {
    let best: EnemyBase | null = null;
    let bestD = maxDist;
    let bestHead = false;
    for (const e of this.enemies) {
      if (!e.alive || (exclude && exclude.has(e))) continue;
      e.getBodyCenter(_c);
      const top = Math.max(e.height, e.headY + e.headRadius);
      const R = top * 0.5 + e.radius + e.headRadius;
      const t = raySphere(origin, dir, _c, R);
      if (t < 0 || t > bestD) continue;
      if (e.raycastHit(origin, dir, bestD, _rayOut) && _rayOut.distance <= bestD) {
        best = e;
        bestD = _rayOut.distance;
        bestHead = _rayOut.headshot;
      }
    }
    if (!best) return null;
    return {
      enemy: best,
      distance: bestD,
      headshot: bestHead,
      point: new THREE.Vector3().copy(origin).addScaledVector(dir, bestD),
    };
  }

  /** 半径内的活敌人：身体中心到 center 的距离 ≤ radius + 敌人半径。out 会被清空后填充 */
  queryRadius(center: THREE.Vector3, radius: number, out: IEnemy[] = []): IEnemy[] {
    out.length = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.getBodyCenter(_c);
      const r = radius + e.radius;
      if (_c.distanceToSquared(center) <= r * r) out.push(e);
    }
    return out;
  }

  /** 最近的活敌人（按身体中心距离减去敌人半径），maxDist 之外返回 null */
  nearest(pos: THREE.Vector3, maxDist: number, exclude?: ReadonlySet<IEnemy>): IEnemy | null {
    let best: EnemyBase | null = null;
    let bestD = maxDist;
    for (const e of this.enemies) {
      if (!e.alive || (exclude && exclude.has(e))) continue;
      e.getBodyCenter(_c);
      const d = Math.max(0, _c.distanceTo(pos) - e.radius);
      if (d <= bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  /** 清场：对每个活敌人造成致死伤害（走 combat 管线，计入击杀）；期间跳过死亡爆炸等附带效果 */
  killAll(): void {
    const snapshot = this.enemies.slice();
    attackDirector.purging = true;
    try {
      for (const e of snapshot) {
        if (!e.alive) continue;
        this.ctx.combat.damageEnemy(e, { base: 1e9, element: 'none', source: 'scroll', canCrit: false });
      }
    } finally {
      attackDirector.purging = false;
    }
  }

  // ───────────── 分离 / 推挤 ─────────────

  /**
   * 敌人之间按半径做柔性分离（质量 ∝ 半径²，Boss 不被推动），与玩家重叠时把敌人推开。
   * 修正量累积后统一通过碰撞世界移动，避免被推进墙里。
   */
  private separate(dt: number): void {
    const list = this.enemies;
    const n = list.length;
    if (n === 0) return;
    if (this.push.length < n * 2) this.push = new Float32Array(Math.max(n * 2, this.push.length * 2));
    const push = this.push;
    push.fill(0, 0, n * 2);
    const k = 1 - Math.exp(-SEPARATION_RATE * dt);

    for (let i = 0; i < n; i++) {
      const a = list[i];
      if (!a.alive) continue;
      const ap = a.position;
      for (let j = i + 1; j < n; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const bp = b.position;
        const minD = (a.radius + b.radius) * 0.92;
        const dx = bp.x - ap.x;
        if (dx > minD || dx < -minD) continue;
        const dz = bp.z - ap.z;
        if (dz > minD || dz < -minD) continue;
        // 高度上不重叠（飞行单位在头顶）时不分离
        if (ap.y > bp.y + b.height || bp.y > ap.y + a.height) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD) continue;
        let d = Math.sqrt(d2);
        let nx: number;
        let nz: number;
        if (d < 1e-4) {
          // 完全重合：按 id 取一个确定的方向
          const ang = (a.id * 2.399 + b.id) % (Math.PI * 2);
          nx = Math.cos(ang);
          nz = Math.sin(ang);
          d = 0;
        } else {
          nx = dx / d;
          nz = dz / d;
        }
        const overlap = (minD - d) * k;
        const ma = a.isBoss ? Infinity : a.radius * a.radius;
        const mb = b.isBoss ? Infinity : b.radius * b.radius;
        let wa: number;
        let wb: number;
        if (ma === Infinity && mb === Infinity) {
          wa = wb = 0.5;
        } else if (ma === Infinity) {
          wa = 0;
          wb = 1;
        } else if (mb === Infinity) {
          wa = 1;
          wb = 0;
        } else {
          wa = mb / (ma + mb);
          wb = ma / (ma + mb);
        }
        push[i * 2] -= nx * overlap * wa;
        push[i * 2 + 1] -= nz * overlap * wa;
        push[j * 2] += nx * overlap * wb;
        push[j * 2 + 1] += nz * overlap * wb;
      }
    }

    // 玩家推挤：敌人与玩家重叠时把敌人完全推出去
    const pl = this.ctx.player;
    const pp = pl.position;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const ep = e.position;
      if (ep.y > pp.y + pl.height || pp.y > ep.y + e.height) continue;
      const minD = e.radius * 0.9 + pl.radius;
      const dx = ep.x - pp.x;
      const dz = ep.z - pp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-4 ? dx / d : Math.sin(e.facing + Math.PI);
      const nz = d > 1e-4 ? dz / d : Math.cos(e.facing + Math.PI);
      const overlap = minD - d;
      push[i * 2] += nx * overlap;
      push[i * 2 + 1] += nz * overlap;
    }

    // 应用
    const world = this.ctx.world;
    for (let i = 0; i < n; i++) {
      let px = push[i * 2];
      let pz = push[i * 2 + 1];
      if (px === 0 && pz === 0) continue;
      const e = list[i];
      const len = Math.hypot(px, pz);
      if (len < 1e-5) continue;
      if (len > MAX_PUSH) {
        px *= MAX_PUSH / len;
        pz *= MAX_PUSH / len;
      }
      _delta.set(px, 0, pz);
      world.moveBody(e.position, e.radius * 0.85, e.height, _delta, e.onGround, e.flying ? 0 : 0.55, _move);
    }
  }
}
