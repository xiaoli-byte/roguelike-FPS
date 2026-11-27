/**
 * 高原图 → 正式游戏的场景文档（UnitySceneDocument）：正式游戏的玩法系统（据点波次、入场点、出口、领主、碰撞、导航、水面、机关）
 * 读的都是这份文档，所以把网页原生的高原场景编成同一种格式（同第一章重做版的 desert/redo/compile.ts）：
 *   - 玩法数据（出生、据点、领主、出口、导航网格、水面、小地图）：public/assets/plateau/<图>.play.json
 *     （scripts/plateau/extract-play.mjs 从 Unity 导出一次性搬来的，运行时不读 unity-levels）；
 *   - 高度场：高原地形（Terrain）按 1 m 采样；碰撞：高原的碰撞世界（CollisionWorld 的方盒 / 圆柱）；
 *   - 模型（renderers）为空：画面由 layer.ts 挂高原自己的场景。
 * 坐标：正式游戏的 4-1 = 高原 4-1 绕竖轴转 180°（x、z 都取反），玩法数据本来就是正式坐标，高度场和碰撞在这里换过去；
 * 4-4 没有 Unity 版，正式坐标就是高原坐标（玩法数据按 spec 编：play44.ts）。
 */
import * as THREE from 'three';
import type { UnitySceneDocument } from '../../UnityLevelLibrary';
import { loadPlateauModels } from '../play/assets';
import { buildPlateau41, type PlateauWorld } from './world41';
import { buildPlateau44 } from './world44';
import { play44 } from './play44';
import { plateauStage } from './active';

const BASE = import.meta.env?.BASE_URL ?? '/';

/** 高原坐标 → 正式坐标（4-1 绕竖轴转 180°；4-4 原样） */
export const toGameFor = (w: PlateauWorld) => (x: number, z: number): [number, number] => (w.yaw !== 0 ? [-x, -z] : [x, z]);

const BUILDERS: Record<string, () => PlateauWorld> = { '4-1': buildPlateau41, '4-4': buildPlateau44 };

let current: { id: string; world: PlateauWorld } | null = null;

/** 这张图建好的高原场景（document 编的时候建一次，layer 挂的时候拿同一份；换图就丢掉） */
export function plateauWorld(id: string): PlateauWorld | null {
  return current?.id === id ? current.world : null;
}

/** 卸载关卡时调：丢掉缓存的场景（下次进图重建） */
export function dropPlateauWorld(): void {
  current = null;
}

function buildWorld(id: string): PlateauWorld {
  if (current?.id === id) return current.world;
  const build = BUILDERS[id];
  if (!build) throw new Error(`高原图 ${id} 还没有网页原生场景`);
  const world = build();
  current = { id, world };
  return world;
}

/** 高度场：覆盖整张高原地形的正方网格（1 m 一格），按正式坐标排（行 = z） */
function heightfield(w: PlateauWorld): UnitySceneDocument['heightfields'][number] {
  const T = w.terrain, toGame = toGameFor(w);
  const [gx0, gz0] = w.yaw !== 0 ? toGame(T.maxX, T.maxZ) : [T.minX, T.minZ];
  const n = Math.max(T.nx, T.nz);
  const raw = new Float32Array(n * n);
  let lo = Infinity, hi = -Infinity;
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const [x, z] = toGame(gx0 + ix, gz0 + iz);
    const h = T.heightAt(x, z);
    raw[iz * n + ix] = h;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < raw.length; i++) raw[i] = (raw[i] - lo) / range;
  const bytes = new Uint8Array(raw.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { origin: [gx0, lo, gz0], scale: [1, range, 1], resolution: n, heights: btoa(bin) };
}

/** 碰撞：高原的方盒（带朝向）→ 正式的方盒（OBB + 外接 AABB）；圆柱 → 外接方盒 */
function colliders(w: PlateauWorld): UnitySceneDocument['colliders'] {
  const out: UnitySceneDocument['colliders'] = [], toGame = toGameFor(w);
  const q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  w.world.list.forEach((c, i) => {
    if (c.off) return;
    const [x, z] = toGame(c.x, c.z);
    const cy = (c.y0 + c.y1) / 2, sy = Math.max(0.05, c.y1 - c.y0);
    if (c.kind === 'cyl') {
      out.push({ kind: 'capsule', name: `plateau-cyl-${i}`, min: [x - c.r, c.y0, z - c.r], max: [x + c.r, c.y1, z + c.r] });
      return;
    }
    // 转 180° 以后朝向不变（盒子绕竖轴转半圈还是它自己）
    q.setFromAxisAngle(Y, c.yaw);
    const cs = Math.abs(Math.cos(c.yaw)), sn = Math.abs(Math.sin(c.yaw));
    const ex = c.hx * cs + c.hz * sn, ez = c.hx * sn + c.hz * cs;
    out.push({
      kind: 'box', name: `plateau-box-${i}`, min: [x - ex, c.y0, z - ez], max: [x + ex, c.y1, z + ez],
      center: [x, cy, z], size: [c.hx * 2, sy, c.hz * 2], rotation: [q.x, q.y, q.z, q.w],
    });
  });
  return out;
}

type PlayData = Omit<UnitySceneDocument, 'renderers' | 'colliders' | 'heightfields' | 'scene'>;
const plays = new Map<string, Promise<PlayData>>();

function play(id: string): Promise<PlayData> {
  let p = plays.get(id);
  if (!p) {
    p = fetch(`${BASE}assets/plateau/${id}.play.json`).then(r => {
      if (!r.ok) throw new Error(`高原图 ${id} 的玩法数据读取失败：${r.status}`);
      return r.json() as Promise<PlayData>;
    });
    p.catch(() => plays.delete(id));
    plays.set(id, p);
  }
  return p;
}

/** 玩法数据：4-1 读搬来的 JSON；4-4 按 spec 编（先等两张绘景大图、雷神的模型） */
async function playFor(id: string, w: PlateauWorld): Promise<PlayData> {
  const h = (w as PlateauWorld & { haizi?: Parameters<typeof play44>[0] }).haizi;
  if (!h) return play(id);
  await Promise.all([h.arena.ready, loadPlateauModels(undefined, ['SK_Boss_Leize'])]);
  return play44(h);
}

/** 这张图走高原原生场景时返回整份场景文档；不走返回 null（照旧读 Unity 导出的） */
export function plateauDocument(id: string): Promise<UnitySceneDocument> | null {
  if (!plateauStage(id)) return null;
  const w = buildWorld(id);
  return playFor(id, w).then(data => {
    return {
      ...data,
      scene: `plateau:${id}`,
      renderers: [],
      colliders: colliders(w),
      heightfields: [heightfield(w)],
      groundCover: [],
      vegetation: undefined,
    } as UnitySceneDocument;
  });
}
