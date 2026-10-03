/**
 * 敌人管理器：刷怪、逐帧更新、敌人间分离与玩家推挤、移除与释放，
 * 以及供武器 / 技能 / 战斗使用的空间查询（射线、半径、最近）。
 */
import * as THREE from 'three';
import type { DamageRequest, DamageResult, EnemyRayHit, GameContext, IEnemy, IEnemyManager, SpawnOptions } from '../core/types';
import { raySphere } from '../core/math';
import type { MoveResult } from '../world/Collision';
import type { EnemyBase } from './EnemyBase';
import { getEnemyEntry } from './Registry';
import { attackDirector } from './AttackTokens';
import { isAffixId, rollAffix } from './Affixes';

const _c = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _spawnPos = new THREE.Vector3();
const _rayOut = { distance: 0, headshot: false };
const _move: MoveResult = { onGround: false, hitWall: false, hitCeiling: false, stepped: false, groundY: 0, wallNormal: new THREE.Vector3() };
/** raycast 的结果对象（复用，见 raycast 注释） */
const _hit: { enemy: IEnemy; distance: number; point: THREE.Vector3; headshot: boolean } = {
  enemy: null as unknown as IEnemy, distance: 0, point: new THREE.Vector3(), headshot: false,
};

/** 分离修正的柔度（每秒趋近速率）与单帧最大修正量 */
const SEPARATION_RATE = 14;
const MAX_PUSH = 0.25;
/** 玩家贴进不可推动的非首领敌人（冰晶）时，向外推玩家的速度：每米重叠 12 m/s，最多 6 m/s */
const PLAYER_PUSH_GAIN = 12;
const PLAYER_PUSH_MAX = 6;
const PLAYER_PUSH_STEP = 2.9;

/** 不会被分离 / 玩家推动的敌人：首领与完全免疫击退的（如寒霜冰晶） */
function immovable(e: EnemyBase): boolean {
  return e.isBoss || e.knockbackResist >= 1;
}

/** 可被武器 / 技能 / 战斗查询选中：活着且不处于不可选中状态（Boss 登场、转阶段等） */
function targetable(e: IEnemy): boolean {
  return e.alive && !e.untargetable;
}

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
    // 强度：缺省 / 非法时用本关难度
    let level = opts.level;
    if (!(typeof level === 'number' && Number.isFinite(level) && level > 0)) level = this.ctx.run.difficulty;
    if (!(Number.isFinite(level) && level > 0)) level = 1;
    // 位置非法（NaN）时放到竞技场中心附近的可走点，避免整只敌人变成 NaN
    const p = opts.position;
    let position = p;
    if (!p || !Number.isFinite(p.x + p.y + p.z)) {
      const arena = this.ctx.stage.arena;
      _spawnPos.set(0, arena?.floorY ?? 0, 0);
      if (arena) this.ctx.nav.nearestWalkable(arena.center, _spawnPos);
      position = _spawnPos;
    }
    const elite = !!opts.elite;
    const o: SpawnOptions = { position, elite, level };
    // 词缀只属于普通敌人里的精英：精英没有（或给了无法识别的）词缀时随机一个；非精英 / Boss 一律无词缀
    if (elite && !entry.def.isBoss) o.affix = isAffixId(opts.affix) ? opts.affix : rollAffix(this.ctx.rng, defId);

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
   * 最近的被射线命中的活敌人（跳过 untargetable）。dir 需归一化。先用包围球粗筛，再交给 enemy.raycastHit 精测（头部球 + 身体胶囊，Boss 自定义）。
   * 光束武器、准星每帧都会调用，所以返回的结果对象（含 point）是复用的：下一次调用 raycast 时会被改写，
   * 调用方需要立即读取或复制，不要跨调用保留。
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: ReadonlySet<IEnemy>): EnemyRayHit | null {
    if (!(maxDist > 0)) return null;
    let best: EnemyBase | null = null;
    let bestD = maxDist;
    let bestHead = false;
    for (const e of this.enemies) {
      if (!targetable(e) || (exclude && exclude.has(e))) continue;
      e.getBodyCenter(_c);
      // 粗筛球：包住身体与头部，并给头部随动画的位移（前倾 / 下蹲）留出余量
      const top = Math.max(e.height, e.headY + e.headRadius);
      const R = top * 0.5 + e.radius + e.headRadius * 2;
      const t = raySphere(origin, dir, _c, R);
      if (t < 0 || t > bestD) continue;
      if (e.raycastHit(origin, dir, bestD, _rayOut) && _rayOut.distance <= bestD) {
        best = e;
        bestD = _rayOut.distance;
        bestHead = _rayOut.headshot;
      }
    }
    if (!best) return null;
    _hit.enemy = best;
    _hit.distance = bestD;
    _hit.headshot = bestHead;
    _hit.point.copy(origin).addScaledVector(dir, bestD);
    return _hit;
  }

  /** 半径内的活敌人（跳过 untargetable）：身体中心到 center 的距离 ≤ radius + 敌人半径。out 会被清空后填充 */
  queryRadius(center: THREE.Vector3, radius: number, out: IEnemy[] = []): IEnemy[] {
    out.length = 0;
    for (const e of this.enemies) {
      if (!targetable(e)) continue;
      e.getBodyCenter(_c);
      const r = radius + e.radius;
      if (_c.distanceToSquared(center) <= r * r) out.push(e);
    }
    return out;
  }

  /** 最近的活敌人（跳过 untargetable；按身体中心距离减去敌人半径），maxDist 之外返回 null */
  nearest(pos: THREE.Vector3, maxDist: number, exclude?: ReadonlySet<IEnemy>): IEnemy | null {
    let best: EnemyBase | null = null;
    let bestD = maxDist;
    for (const e of this.enemies) {
      if (!targetable(e) || (exclude && exclude.has(e))) continue;
      e.getBodyCenter(_c);
      const d = Math.max(0, _c.distanceTo(pos) - e.radius);
      if (d <= bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * 清场（首领倒下后残余爪牙溃散、调试 F2）：对每个活敌人造成致死伤害。这是「静默处决」，不算玩家击杀：
   *  - 伤害请求带 tags: ['purge']（契约约定）：照常派发 'enemy:killed'（死亡计数、关卡进度需要），
   *    掉落与「击杀时」效果（连环爆、夺魂、凤羽等）应识别该标签并忽略；
   *  - 伤害按敌人剩余三层血量给足（不用 1e9，否则会冒出「1000000000」的伤害数字）；
   *  - procDepth = 2：不触发命中时 / 击杀时的连锁效果（尸爆、蔓延等），也不显示命中标记；
   *  - 期间 purging = true：爆裂词缀、爆骸虫的死亡爆炸不会发动；
   *  - 伤害被免疫（不可选中、修饰器返回 0 等）而没死的，由 forceKill 直接走死亡流程（同样不给奖励），
   *    保证结束后全部 alive = false。
   */
  killAll(): void {
    const snapshot = this.enemies.slice();
    attackDirector.purging = true;
    try {
      for (const e of snapshot) {
        if (!e.alive) continue;
        const pool = Math.max(0, e.hp) + Math.max(0, e.shield) + Math.max(0, e.armor) * 2;
        const req: DamageRequest = {
          base: Math.max(10, Math.ceil(pool * 2 + 10)), element: 'none', source: 'scroll',
          canCrit: false, procDepth: 2, tags: ['purge'],
        };
        try {
          this.ctx.combat.damageEnemy(e, req);
        } catch (err) {
          console.error('[EnemyManager] killAll 伤害结算出错', err);
        }
        if (e.alive) this.forceKill(e, req);
      }
    } finally {
      attackDirector.purging = false;
    }
  }

  /** 不经过 combat 直接进入死亡流程：不派发 'enemy:killed'，因此不计击杀、不掉落、不触发击杀时效果 */
  private forceKill(e: EnemyBase, req: DamageRequest): void {
    e.hp = 0;
    e.shield = 0;
    e.armor = 0;
    const res: DamageResult = {
      request: req, dealt: 0, isCrit: false, killed: true, layer: 'health',
      shieldBroken: false, armorBroken: false, element: 'none', statusApplied: null,
    };
    try {
      e.onKilled(res);
    } catch (err) {
      console.error('[EnemyManager] forceKill 出错', err);
      e.alive = false;
    }
  }

  // ───────────── 分离 / 推挤 ─────────────

  /**
   * 敌人之间按半径做柔性分离（质量 ∝ 半径²，Boss / 冰晶不被推动），与玩家重叠时把普通敌人推开。
   * 不可推动的敌人不会被玩家挤动：
   *  - 首领：完全跳过，玩家与首领身体的重叠由玩家控制器自己解决（resolveBossOverlap），这里再推一次会叠加；
   *  - 其他免疫击退的（冰晶）：玩家控制器不处理，改为把玩家向外推（施加速度，不直接改玩家位置）。
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
        const ma = immovable(a) ? Infinity : a.radius * a.radius;
        const mb = immovable(b) ? Infinity : b.radius * b.radius;
        let wa: number;
        let wb: number;
        if (ma === Infinity && mb === Infinity) {
          // 两个都不可推动（例如冰晶贴着 Boss）：谁也不动
          continue;
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

    // 玩家推挤：普通敌人与玩家重叠时把敌人完全推出去；首领与免疫击退的敌人一律不被推动
    // （首领由玩家控制器处理重叠；冰晶等则把玩家往外推）
    const pl = this.ctx.player;
    const pp = pl.position;
    let pushX = 0;
    let pushZ = 0;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (!e.alive || e.isBoss) continue;
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
      if (e.knockbackResist >= 1) {
        pushX -= nx * overlap;
        pushZ -= nz * overlap;
      } else {
        push[i * 2] += nx * overlap;
        push[i * 2 + 1] += nz * overlap;
      }
    }
    if ((pushX !== 0 || pushZ !== 0) && pl.alive) this.pushPlayer(pushX, pushZ);

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

  /**
   * 把玩家从不可推动的敌人身上推开：只把「向外的速度」补到目标值（不超过 6 m/s），不会逐帧累加；
   * 单帧补量 < 3 m/s，不会触发玩家控制器的击退硬直（水平冲量 > 3 m/s 才算击退）。
   */
  private pushPlayer(ox: number, oz: number): void {
    const len = Math.hypot(ox, oz);
    if (len < 1e-5) return;
    const nx = ox / len;
    const nz = oz / len;
    const want = Math.min(PLAYER_PUSH_MAX, len * PLAYER_PUSH_GAIN);
    const v = this.ctx.player.velocity;
    const cur = v.x * nx + v.z * nz;
    if (!(cur < want)) return;
    const add = Math.min(PLAYER_PUSH_STEP, want - cur);
    _imp.set(nx * add, 0, nz * add);
    this.ctx.player.applyImpulse(_imp);
  }
}
