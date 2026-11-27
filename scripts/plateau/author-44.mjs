// 4-4 神山海子进正式游戏要的数据文件（4-4 没有 Unity 版，数据全按检视页的 spec 编；src/world/plateau/stage/play44.ts 读）：
//   public/assets/plateau/4-4-boundary.f32 —— 软边界距离场：到可玩区（湖心半径 78 m，haizi/spec.ts 的 MAP.playRadius）的有符号距离，区内为负；
//     格子 2 m、201 × 201、原点 (−200, −200)，格式同 4-1（mechanisms/Boundary.ts 读）。圆形对称，不用管 Unity 坐标的 x 镜像。
//
//   node scripts/plateau/author-44.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAY_RADIUS = 78, CELL = 2, N = 201, ORIGIN = -200;
const d = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) d[j * N + i] = Math.hypot(ORIGIN + i * CELL, ORIGIN + j * CELL) - PLAY_RADIUS;
const out = join(ROOT, 'public/assets/plateau/4-4-boundary.f32');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(d.buffer));
console.log(`→ ${out}（${N} × ${N}，格子 ${CELL} m，可玩区半径 ${PLAY_RADIUS} m）`);
