/**
 * 第三章 · 祝融火狱：「地上的火」登记表——祸斗食火用。
 *
 * 祸斗会跑去吃地上的火：炭童死后的余烬炭堆、抛炭落地烧起来的火、熔岩边。各处的火在这里登记成 FireSource，
 * 祸斗按距离找最近的一处、占住（同一处只让一只去吃）、吃完调 consume()：炭堆被吃掉（炭童彻底死）、地火熄灭。
 * 熔岩边不登记——直接按当前关卡的熔岩掩码（StageDirector.lavaSystem.lava）就近找岸边，吃不完。
 *
 * 其他会在地上留火的敌人（毕方的讹火、神火飞鸦的纸灰火、熔铜匠的泼铜……）调用 registerFloorFire 就能被祸斗吃掉：
 *   const fire = registerFloorFire(ctx, ground, radius, seconds, () => { 熄灭自己的贴花 / 伤害任务 });
 *   // 自己提前结束时：fire.remove()；每帧可读 fire.eaten 停掉伤害结算
 *
 * 只依赖 three：测试可以直接加载本文件。登记按 ctx 区分（测试里每个用例一个 ctx），过期 / 熄灭的条目在查询时清掉。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';

export type FireKind = 'ember' | 'floor' | 'lava';

export interface FireSource {
  readonly kind: FireKind;
  /** 火的地面中心（世界坐标） */
  readonly position: THREE.Vector3;
  /** 火区半径（米） */
  readonly radius: number;
  /** 还能吃（炭堆还在、地火没灭） */
  edible(): boolean;
  /** 被祸斗吃掉：炭堆消失、地火熄灭（熔岩边吃不完，什么也不做） */
  consume(): void;
  /** 正在被哪只祸斗占着（敌人 id），没有时为 null */
  claimedBy: number | null;
}

interface Entry {
  ctx: GameContext;
  src: FireSource;
}

const entries: Entry[] = [];

/** 登记一处火（炭堆等自己实现 FireSource 的对象）。返回注销函数 */
export function registerFire(ctx: GameContext, src: FireSource): () => void {
  const e: Entry = { ctx, src };
  entries.push(e);
  return () => {
    const i = entries.indexOf(e);
    if (i >= 0) entries.splice(i, 1);
  };
}

export interface FloorFireHandle extends FireSource {
  /** 已被吃掉 */
  readonly eaten: boolean;
  /** 自己烧完 / 提前结束时注销 */
  remove(): void;
}

/**
 * 登记一片地火：seconds 秒后自动过期；被祸斗吃掉时调用 onEaten（调用方在里面熄灭自己的贴花、停掉伤害），
 * 并把 eaten 置为 true。
 */
export function registerFloorFire(
  ctx: GameContext, ground: THREE.Vector3, radius: number, seconds: number, onEaten?: () => void,
): FloorFireHandle {
  const until = ctx.time.now + seconds;
  let eaten = false;
  let removed = false;
  let unregister: () => void = () => {};
  const h: FloorFireHandle = {
    kind: 'floor',
    position: ground.clone(),
    radius,
    claimedBy: null,
    edible: () => !eaten && !removed && ctx.time.now < until,
    consume: () => {
      if (eaten || removed) return;
      eaten = true;
      unregister();
      onEaten?.();
    },
    get eaten() { return eaten; },
    remove: () => {
      removed = true;
      unregister();
    },
  };
  unregister = registerFire(ctx, h);
  return h;
}

/** 当前 ctx 登记着的、还能吃的火（测试与调试用） */
export function listFires(ctx: GameContext): FireSource[] {
  prune();
  return entries.filter((e) => e.ctx === ctx).map((e) => e.src);
}

function prune(): void {
  for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].src.edible()) entries.splice(i, 1);
}

/**
 * 离 from 最近、maxDist 以内、没被别的祸斗占着、还能吃的火（地火、炭堆）。高差超过 maxRise 的不算（高台上的火够不着）。
 */
export function findFire(ctx: GameContext, from: THREE.Vector3, maxDist: number, eaterId: number, maxRise = 1.2): FireSource | null {
  prune();
  let best: FireSource | null = null;
  let bestD = maxDist;
  for (const e of entries) {
    if (e.ctx !== ctx) continue;
    const s = e.src;
    if (s.claimedBy !== null && s.claimedBy !== eaterId) continue;
    if (Math.abs(s.position.y - from.y) > maxRise) continue;
    const d = Math.hypot(s.position.x - from.x, s.position.z - from.z) - s.radius;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// ───────────── 熔岩边 ─────────────

/** 熔岩掩码（WhiteboxLava 的结构子集；StageDirector.lavaSystem.lava） */
interface LavaMask {
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  cell: number;
  mask: Uint8Array;
}

function lavaOf(ctx: GameContext): LavaMask | null {
  const st = ctx.stage as unknown as { lavaSystem?: { lava?: LavaMask } | null } | null;
  return st?.lavaSystem?.lava ?? null;
}

/** 世界坐标点是否在熔岩格上（没有熔岩的关卡恒为 false） */
export function onLavaCell(ctx: GameContext, x: number, z: number): boolean {
  const L = lavaOf(ctx);
  if (!L) return false;
  const ix = Math.floor((x - L.minX) / L.cell), iz = Math.floor((z - L.minZ) / L.cell);
  return ix >= 0 && iz >= 0 && ix < L.cols && iz < L.rows && L.mask[iz * L.cols + ix] === 1;
}

const _shore = new THREE.Vector3();

/**
 * 离 from 最近（maxDist 以内）的熔岩格，作为一处「熔岩边」的火：返回的 FireSource 位置在熔岩格中心，
 * 吃不完（consume 什么也不做），不占用。没有熔岩或太远时返回 null。
 */
export function findLavaEdge(ctx: GameContext, from: THREE.Vector3, maxDist: number): FireSource | null {
  const L = lavaOf(ctx);
  if (!L) return null;
  const c = L.cell;
  const x0 = Math.max(0, Math.floor((from.x - maxDist - L.minX) / c)), x1 = Math.min(L.cols - 1, Math.floor((from.x + maxDist - L.minX) / c));
  const z0 = Math.max(0, Math.floor((from.z - maxDist - L.minZ) / c)), z1 = Math.min(L.rows - 1, Math.floor((from.z + maxDist - L.minZ) / c));
  let best = maxDist * maxDist;
  let found = false;
  for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
    if (L.mask[iz * L.cols + ix] !== 1) continue;
    const cx = L.minX + (ix + 0.5) * c, cz = L.minZ + (iz + 0.5) * c;
    const d = (cx - from.x) ** 2 + (cz - from.z) ** 2;
    if (d < best) {
      best = d;
      _shore.set(cx, from.y, cz);
      found = true;
    }
  }
  if (!found) return null;
  const position = _shore.clone();
  return { kind: 'lava', position, radius: c * 0.5, claimedBy: null, edible: () => true, consume: () => {} };
}
