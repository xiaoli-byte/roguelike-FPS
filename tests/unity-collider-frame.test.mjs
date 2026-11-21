// Unity 网格碰撞体的坐标系：碰撞 GLB 是 Unity 坐标（x 没取反），文档是网页坐标。加载时按文档 AABB 判断要不要镜像
// （src/world/UnityColliderFrame.ts）。这里遍历发布目录里每张图的每个网格碰撞体，用 GLB 访问器的 min / max 核对：
// 判断之后的 x 范围必须和文档 AABB 对得上（2026-11-22 查出原样加载时全部落在 x = 0 的镜像位置）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/world/UnityColliderFrame.ts', import.meta.url), 'utf8');
const { colliderNeedsMirror, mirrorColliderX } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64')}`);

/** GLB 里所有 POSITION 访问器的 x 范围（访问器自带 min / max，不用解 meshopt） */
async function glbXRange(path) {
  const bytes = await readFile(path);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  let min = Infinity, max = -Infinity;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const accessor = json.accessors[primitive.attributes.POSITION];
      if (!accessor?.min || !accessor?.max) return null;
      min = Math.min(min, accessor.min[0]);
      max = Math.max(max, accessor.max[0]);
    }
  }
  return Number.isFinite(min) ? [min, max] : null;
}

test('镜像判断：Unity 坐标的网格翻过来，网页坐标的不动', () => {
  assert.equal(colliderNeedsMirror(19.9, 24.8, -24.9, -19.8), true);
  assert.equal(colliderNeedsMirror(-24.9, -19.8, -24.9, -19.8), false);
  // 跨 x = 0 的件（1-2 出生祭坛）：镜像后 (−1.0 … 7.0) 对得上文档
  assert.equal(colliderNeedsMirror(-7.0, 1.0, -1.2, 7.0), true);
});

test('镜像会把 x 取反并换回三角形绕序', () => {
  const positions = new Float32Array([1, 0, 0, 2, 0, 0, 1, 1, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  mirrorColliderX(positions, indices);
  assert.deepEqual([...positions], [-1, 0, 0, -2, 0, 0, -1, 1, 0]);
  assert.deepEqual([...indices], [0, 2, 1]);
});

test('发布目录里每个网格碰撞体判断之后都落在文档的 AABB 上', async () => {
  const dir = new URL('../public/assets/unity-levels/scenes/', import.meta.url);
  const files = (await readdir(dir)).filter(name => name.endsWith('.json'));
  assert.ok(files.length > 0);
  let checked = 0;
  const bad = [];
  for (const file of files) {
    const doc = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    for (const collider of doc.colliders ?? []) {
      if (!collider.url || collider.platform !== undefined) continue;
      const range = await glbXRange(new URL(`../public/${collider.url}`, import.meta.url));
      if (!range) continue;
      let [min, max] = range;
      if (colliderNeedsMirror(min, max, collider.min[0], collider.max[0])) [min, max] = [-max, -min];
      checked++;
      // 文档的 AABB 是 Unity Collider.bounds（比网格宽 1–3 m）：网格要落在它里面（容差 1 m），并且盖住它一半以上的宽度——
      // 镜像错了的话两者差出两倍的 |x|，这两条都过不了
      const width = collider.max[0] - collider.min[0];
      const inside = min >= collider.min[0] - 1 && max <= collider.max[0] + 1;
      if (!inside || (max - min) < width * 0.5) bad.push(`${doc.id}/${collider.name}: 网格 x ${min.toFixed(1)}…${max.toFixed(1)}，文档 ${collider.min[0].toFixed(1)}…${collider.max[0].toFixed(1)}`);
    }
  }
  assert.ok(checked > 100, `只核对了 ${checked} 个`);
  assert.deepEqual(bad, []);
});
