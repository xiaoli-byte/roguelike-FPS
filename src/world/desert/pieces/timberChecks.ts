import * as THREE from 'three';
import { WB_1_4 } from '../whitebox/maps/1-4';
import { WB_1_A } from '../whitebox/maps/1-A';
import { buildNineStorey, OPEN_HALL_XS, OPEN_HALL_ZS } from './nineStorey';
import { buildStatueHall, STATUE_COLS } from './statueHall';
import { buildTimberStair, labGround, stairFromWhitebox, STAIR_LIFT } from './timberStairs';
import type { BuiltPiece, PieceBox, PieceContext } from './types';
import { buildYuequanHall, GALLERY_XS, GALLERY_ZS, HALL_XS, HALL_ZS } from './yuequanHall';

/**
 * 木构件的度量自检（不开浏览器也能跑：tests/desert-timber.test.mjs）：
 * 柱子是不是正好在白盒 / 设计给的位置，主线从柱间穿过的净宽、梯段坡度、坐像殿正面的视线和殿内给坐像留的空。
 * 一律按碰撞盒（世界 AABB）量——游戏里挡人的就是它们。
 */

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface Aabb { min: THREE.Vector3; max: THREE.Vector3; name: string; box: PieceBox }

function aabbs(p: BuiltPiece): Aabb[] {
  const v = new THREE.Vector3();
  return p.colliders.map(b => {
    const q = new THREE.Quaternion(...(b.rotation ?? [0, 0, 0, 1]));
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let k = 0; k < 8; k++) {
      v.set((k & 1 ? 0.5 : -0.5) * b.size[0], (k & 2 ? 0.5 : -0.5) * b.size[1], (k & 4 ? 0.5 : -0.5) * b.size[2]).applyQuaternion(q).add(new THREE.Vector3(...b.center));
      min.min(v);
      max.max(v);
    }
    return { min, max, name: b.name ?? '', box: b };
  });
}

/** 沿 x 从 x0 走到 x1、身子在 y 0.3–1.9：中线 zc 两侧最近的碰撞盒之间的最小净宽（只看和身体高度相交的盒） */
function clearAlongX(boxes: Aabb[], x0: number, x1: number, zc: number, y0 = 0.3, y1 = 1.9): { width: number; at: number } {
  let best = { width: Infinity, at: x0 };
  for (let x = x0; x <= x1 + 1e-6; x += 0.1) {
    let lo = -Infinity, hi = Infinity;
    for (const b of boxes) {
      if (b.max.y < y0 || b.min.y > y1 || x < b.min.x || x > b.max.x) continue;
      if (b.max.z <= zc) lo = Math.max(lo, b.max.z);
      else if (b.min.z >= zc) hi = Math.min(hi, b.min.z);
      else return { width: 0, at: x };
    }
    if (hi - lo < best.width) best = { width: hi - lo, at: x };
  }
  return best;
}

/** 线段 a→b 碰到的碰撞盒（slab 法） */
function segmentHits(boxes: Aabb[], a: THREE.Vector3, b: THREE.Vector3): string[] {
  const d = b.clone().sub(a), hits: string[] = [];
  for (const box of boxes) {
    let t0 = 0, t1 = 1, ok = true;
    for (const k of ['x', 'y', 'z'] as const) {
      if (Math.abs(d[k]) < 1e-9) { if (a[k] < box.min[k] || a[k] > box.max[k]) { ok = false; break; } continue; }
      let ta = (box.min[k] - a[k]) / d[k], tb = (box.max[k] - a[k]) / d[k];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) { ok = false; break; }
    }
    if (ok) hits.push(box.name);
  }
  return hits;
}

/** 名字以 prefix 开头的柱子（碰撞盒）是不是正好落在 xs × zs 上（± 2 cm），半径 r */
function columnsAt(boxes: Aabb[], prefix: string, pts: [number, number][], r: number): CheckResult {
  const cols = boxes.filter(b => b.name.startsWith(prefix));
  const missing = pts.filter(([x, z]) => !cols.some(c => Math.abs((c.min.x + c.max.x) / 2 - x) < 0.02 && Math.abs((c.min.z + c.max.z) / 2 - z) < 0.02 && Math.abs(c.max.x - c.min.x - 2 * r) < 0.02));
  return { name: `${prefix} 位置`, ok: !missing.length && cols.length === pts.length, detail: missing.length ? `缺 ${missing.map(p => p.join(',')).join(' / ')}` : `${cols.length} 根，全对上（r ${r}）` };
}

const grid = (xs: number[], zs: number[]): [number, number][] => xs.flatMap(x => zs.map((z): [number, number] => [x, z]));
const flat: PieceContext = { ground: () => 0, low: false };

export function runTimberChecks(): CheckResult[] {
  const out: CheckResult[] = [];
  const push = (name: string, ok: boolean, detail: string): void => { out.push({ name, ok, detail }); };

  // ── 月泉阁 ──
  {
    const p = buildYuequanHall(flat), b = aabbs(p);
    out.push(columnsAt(b, '月泉阁 柱', grid(HALL_XS, HALL_ZS), 0.3));
    out.push(columnsAt(b, '长廊 柱', grid(GALLERY_XS, GALLERY_ZS), 0.25));
    const hall = clearAlongX(b, 151, 169, 160.2), gal = clearAlongX(b, 169.2, 195.8, 160.2), gate = clearAlongX(b, 196, 203, 160.2);
    push('月泉阁 敞厅中跨净宽 ≥ 6 m', hall.width >= 6, `${hall.width.toFixed(2)} m（x ${hall.at.toFixed(1)}）`);
    push('月泉阁 长廊净宽 ≥ 6 m', gal.width >= 6, `${gal.width.toFixed(2)} m（x ${gal.at.toFixed(1)}）`);
    push('月泉阁 门楼门洞净宽 ≥ 6.5 m', gate.width >= 6.5, `${gate.width.toFixed(2)} m（x ${gate.at.toFixed(1)}）`);
    const side = clearAlongX(b, 152, 168, 153.85);
    push('月泉阁 敞厅北跨净宽 ≥ 4 m', side.width >= 4, `${side.width.toFixed(2)} m`);
    // 环线沿 z 160.2 从西到东整段走得通（身体高度上没有横挡）
    const route = segmentHits(b, new THREE.Vector3(145, 1.0, 160.2), new THREE.Vector3(206, 1.0, 160.2)).filter(n => !n.includes('台明'));
    push('月泉阁 环线 z 160.2 无遮挡', !route.length, route.length ? route.join('、') : '通');
    const stair = p.colliders.find(c => c.name === '月泉阁 木梯');
    const slope = stair?.rotation ? (Math.asin(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...stair.rotation)).y)) * 180) / Math.PI : NaN;
    push('月泉阁 木梯坡度 ≤ 30°', slope <= 30, `${slope.toFixed(1)}°`);
    const floor = p.colliders.find(c => c.name === '月泉阁 二层楼面');
    push('月泉阁 二层楼面 5.9', !!floor && Math.abs(floor.center[1] + floor.size[1] / 2 - 5.9) < 0.01, floor ? `顶 ${(floor.center[1] + floor.size[1] / 2).toFixed(2)}` : '没有');
    p.dispose();
  }

  // ── 坐像殿 ──
  {
    const p = buildStatueHall(flat), b = aabbs(p);
    out.push(columnsAt(b, '坐像殿 檐柱', STATUE_COLS.map((x): [number, number] => [x, 175.5]), 0.45));
    const sight = segmentHits(b, new THREE.Vector3(212, 1.6, 208), new THREE.Vector3(210, 13.72, 169.5));
    push('坐像殿 前庭看像顶的视线', !sight.length, sight.length ? `挡：${sight.join('、')}` : '通（过正面约 11.5 m）');
    const front = b.filter(x => x.min.z < 176.2 && x.max.z > 175 && x.min.y < 15 && x.max.y > 0.2 && x.max.x > 206.65 && x.min.x < 212.85);
    push('坐像殿 明间 15 m 以下无构件', !front.length, front.length ? front.map(x => x.name).join('、') : '空');
    const inside = b.filter(x => x.max.x > 203.3 && x.min.x < 216.7 && x.max.z > 163 && x.min.z < 175 && x.max.y > 0.2 && x.min.y < 13.72);
    push('坐像殿 台基 / 坐像的空间留空', !inside.length, inside.length ? inside.map(x => x.name).join('、') : '空');
    const s2 = segmentHits(b, new THREE.Vector3(214, 1.6, 115), new THREE.Vector3(230, 22.16, 246));
    push('坐像殿 不挡 ② 望寺塔（碰撞盒）', !s2.length, s2.length ? s2.join('、') : '通');
    p.dispose();
  }

  // ── 贴崖木栈梯 / 之字木栈道 ──
  for (const [spec, piece] of [[WB_1_A, '贴崖木栈梯'], [WB_1_4, '之字木栈道']] as const) {
    const req = stairFromWhitebox(spec, piece);
    const p = buildTimberStair({ ground: labGround(spec), low: false }, req);
    const runs = p.colliders.filter(c => c.name?.endsWith('梯段'));
    const slopes = runs.map(c => {
      const q = new THREE.Quaternion(...(c.rotation ?? [0, 0, 0, 1]));
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      return (Math.asin(Math.abs(x.y)) * 180) / Math.PI;
    });
    push(`${piece} 梯段坡度 ≤ 30°`, slopes.length > 0 && slopes.every(s => s <= 30), slopes.map(s => `${s.toFixed(1)}°`).join(' / '));
    const widths = runs.map(c => c.size[2]);
    push(`${piece} 梯段宽 = 白盒 2 × half`, widths.every(w => Math.abs(w - 2 * req.half) < 0.01), widths.map(w => w.toFixed(2)).join(' / '));
    const decks = p.colliders.filter(c => c.name?.endsWith('平台'));
    const tops = [...new Set(decks.map(c => Math.round((c.center[1] + c.size[1] / 2) * 100) / 100))].sort((a, z) => a - z);
    const want = [...new Set(req.hs.map(h => Math.round((h + STAIR_LIFT) * 100) / 100))].sort((a, z) => a - z);
    push(`${piece} 平台面高 = 白盒 + ${STAIR_LIFT}`, tops.every(t => want.includes(t)), tops.join(' / '));
    p.dispose();
  }

  // ── 九层楼敞厅 ──
  {
    const p = buildNineStorey(flat), b = aabbs(p);
    out.push(columnsAt(b, '九层楼敞厅 柱', grid(OPEN_HALL_XS, OPEN_HALL_ZS), 0.6));
    const across = clearAlongX(b, 200, 230, 126);
    push('九层楼敞厅 两排柱间净宽 ≥ 6 m', across.width >= 6, `${across.width.toFixed(2)} m`);
    const through = segmentHits(b, new THREE.Vector3(196, 1.0, 126), new THREE.Vector3(234, 1.0, 126)).filter(n => !n.includes('台明'));
    push('九层楼敞厅 东西穿行无遮挡', !through.length, through.length ? through.join('、') : '通');
    const tall = Math.max(...b.map(x => x.max.y));
    push('九层楼 顶 ≈ 35 m', tall > 33 && tall < 36.5, `碰撞顶 ${tall.toFixed(2)} m`);
    p.dispose();
  }
  return out;
}
