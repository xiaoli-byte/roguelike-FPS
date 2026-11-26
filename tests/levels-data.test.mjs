// 关卡数据目录 public/assets/levels（2026-11-26 从 Unity 导出一次性转来，之后网页自己维护）：
// 关卡目录（src/world/level/catalog.ts）↔ 每张图的 level.json、合并后的碰撞 collision.glb、软边界、小地图、渲染网格和贴图都对得上。
// 接手了 unity-scene-sync（文档结构 / 地址都在）和 unity-collider-frame（网格碰撞落在文档 AABB 上：镜像已在转换时烘掉，这里直接比）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';

const root = new URL('../', import.meta.url);
const tsModule = async (path, imports = {}) => {
  let source = await readFile(new URL(path, root), 'utf8');
  for (const [key, value] of Object.entries(imports)) source = source.replaceAll(`'${key}'`, `'${value}'`);
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64')}`);
};
const { LEVEL_CATALOG, levelUrl } = await tsModule('src/world/level/catalog.ts');
const available = LEVEL_CATALOG.filter(stage => stage.available);
const documents = new Map(await Promise.all(available.map(async stage => [stage.id, JSON.parse(await readFile(new URL(`public/${levelUrl(stage.id)}`, root), 'utf8'))])));

async function exists(url) {
  try { await stat(new URL(url, root)); return true; } catch { return false; }
}

/** GLB → { json, bin } */
async function glb(path) {
  const bytes = await readFile(new URL(path, root));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', path);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${path}: GLB 长度头`);
  const length = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')), bytes };
}

test('关卡目录：主线 16 关 + 三张备选图，可用的都有 level.json，4-2 / 4-4 还没有', async () => {
  const main = LEVEL_CATALOG.filter(stage => !stage.pool);
  const pool = LEVEL_CATALOG.filter(stage => stage.pool);
  assert.deepEqual(main.map(stage => stage.id), ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4', '3-1', '3-2', '3-3', '3-4', '4-1', '4-2', '4-3', '4-4']);
  assert.deepEqual(pool.map(stage => stage.id), ['1-A', '2-A', '3-A']);
  assert.ok(pool.every(stage => stage.available), '备选图都有数据');
  assert.deepEqual(LEVEL_CATALOG.filter(stage => !stage.available).map(stage => stage.id), ['4-2', '4-4']);
  for (const stage of LEVEL_CATALOG) assert.equal(await exists(`public/${levelUrl(stage.id)}`), stage.available, stage.id);
  assert.equal(levelUrl('3-3'), 'assets/levels/3-3/level.json');
});

for (const stage of available) test(`${stage.id}：场景、碰撞、玩法数据齐全，地址都在 assets/levels 下`, async () => {
  const document = documents.get(stage.id);
  assert.equal(document.id, stage.id);
  assert.equal(document.schema, 3);
  assert.equal(document.scene, undefined, '不再带 Unity 场景路径');
  const text = JSON.stringify(document);
  assert.ok(!/unity-levels|Assets\/Scenes/.test(text), '不引用 Unity 导出目录 / 场景');
  for (const match of text.matchAll(/"(assets\/[^"]+)"/g)) {
    assert.ok(match[1].startsWith('assets/levels/'), match[1]);
    assert.ok(match[1].length < 180, `${match[1]}：路径要在 Windows 路径长度内`);
  }
  assert.ok(document.spawn.position.every(Number.isFinite));
  assert.equal(document.spawn.forward.length, 3);
  assert.ok(document.renderers.length > 0);
  assert.ok(document.bounds.min[0] < document.bounds.max[0] && document.bounds.min[2] < document.bounds.max[2], '可玩范围非空');
  assert.ok(document.bounds.max[0] - document.bounds.min[0] < 2000 && document.bounds.max[2] - document.bounds.min[2] < 2000, '导航按可玩范围');
  assert.ok(document.colliders.length > 0);
  for (const collider of document.colliders) {
    for (let axis = 0; axis < 3; axis++) assert.ok(collider.min[axis] <= collider.max[axis], `${stage.id}/${collider.name}: 碰撞盒反了`);
    assert.equal(collider.url, undefined, `${stage.id}/${collider.name}: 网格碰撞改成 mesh 节点名`);
    if (collider.kind === 'box') {
      assert.equal(collider.center.length, 3);
      assert.equal(collider.size.length, 3);
      assert.equal(collider.rotation.length, 4);
      assert.ok(collider.size.every(value => Number.isFinite(value) && value > 0));
    }
    if (['sphere', 'capsule', 'mesh'].includes(collider.kind)) assert.match(collider.mesh ?? '', /^c\d+$/, `${stage.id}/${collider.name}: 网格 / 球 / 胶囊碰撞不能退化成包围盒`);
  }
  assert.ok(document.navigation.vertices.length > 0 && document.navigation.indices.length > 0, '导航网格');
  assert.ok(document.environment.fog.color.length === 4 && document.environment.ambient.sky.length === 4);
  assert.equal(document.environment.sky?.cubemap?.length, 6, '天空盒六个面');
  for (const url of document.environment.sky.cubemap) assert.ok(await exists(`public/${url}`), url);
  assert.equal(document.map?.url, `assets/levels/${stage.id}/map.webp`);
  assert.ok(await exists(`public/${document.map.url}`), document.map.url);
  assert.equal(document.map.area.length, 4);
  for (const renderer of document.renderers) {
    assert.ok(await exists(`public/${renderer.url}`), renderer.url);
    for (const layer of renderer.terrain?.layers ?? []) assert.ok(await exists(`public/${layer.url}`), layer.url);
    for (const map of renderer.terrain?.alphamaps ?? []) assert.ok(await exists(`public/${map}`), map);
    assert.equal(renderer.position.length, 3);
    assert.equal(renderer.rotation.length, 4);
    assert.equal(renderer.scale.length, 3);
  }
  for (const field of document.heightfields) {
    assert.equal(Buffer.from(field.heights, 'base64').length, field.resolution * field.resolution * 4);
    assert.ok(field.resolution > 0 && Number.isInteger(field.resolution));
  }
  for (const prototype of document.vegetation?.prototypes ?? []) assert.ok(await exists(`public/${prototype.url}`), prototype.url);
  for (const instance of document.vegetation?.instances ?? []) assert.ok(document.vegetation.prototypes.some(prototype => prototype.index === instance.prototype));
  if (stage.id === '4-3') assert.ok(document.vegetation?.instances.length > 1000, '落叶松林');
  for (const layer of document.groundCover ?? []) {
    assert.ok(layer.url || layer.texture, `${stage.id}/${layer.name}: 草皮原型`);
    for (const url of [layer.url, layer.texture]) if (url) assert.ok(await exists(`public/${url}`), url);
    assert.equal(Buffer.from(layer.counts, 'base64').length, layer.width * layer.height * 4);
  }
  for (const platform of document.platforms ?? []) {
    assert.ok(platform.path.length >= 2 && platform.path.every(point => point.every(Number.isFinite)), `${stage.id}/${platform.name}: 平台路径`);
    assert.ok(document.renderers.some(renderer => renderer.platform === platform.id), `${stage.id}/${platform.name}: 平台的渲染件`);
  }
  for (const water of document.water ?? []) assert.ok(water.deep >= water.shallow && water.wadeSlow > 0 && water.wadeSlow <= 1);
  for (const encounter of document.encounters) {
    assert.ok(encounter.waves.length > 0, encounter.title);
    assert.ok(encounter.waves.every(wave => wave.entries.every(entry => entry.enemy && entry.count > 0)));
  }
  assert.ok(document.exits.length > 0 || document.bosses.length > 0);
  // 机关段（原 mechanisms.json 里这一关的）：天气都有，软边界除 2-4 外都有，来源字段都去掉了
  const mech = document.mechanisms;
  assert.ok(mech?.weather, '天气导演');
  assert.deepEqual([mech.scene, mech.source, mech.sceneSha1], [undefined, undefined, undefined]);
  if (stage.id === '2-4') assert.equal(mech.boundary, null);
  else {
    assert.equal(mech.boundary.url, `assets/levels/${stage.id}/boundary.f32`);
    assert.deepEqual([mech.boundary.asset, mech.boundary.sha1], [undefined, undefined]);
    assert.equal((await stat(new URL(`public/${mech.boundary.url}`, root))).size, mech.boundary.width * mech.boundary.height * 4);
  }
});

for (const stage of available) test(`${stage.id}：collision.glb 每个节点对一个网格碰撞体，网页坐标、落在文档 AABB 上`, async () => {
  const document = documents.get(stage.id);
  const meshColliders = document.colliders.map((collider, index) => ({ collider, index })).filter(item => item.collider.mesh);
  assert.ok(meshColliders.length > 0);
  assert.equal(document.collision, `assets/levels/${stage.id}/collision.glb`);
  const { json } = await glb(`public/${document.collision}`);
  assert.equal(json.asset.generator, 'levels-convert');
  assert.deepEqual(json.nodes.map(node => node.name).sort(), meshColliders.map(item => item.collider.mesh).sort(), '节点名 = 碰撞体的 mesh');
  const bad = [];
  for (const { collider, index } of meshColliders) {
    assert.equal(collider.mesh, `c${index}`, '节点名按碰撞体在 colliders 里的下标');
    const node = json.nodes.find(n => n.name === collider.mesh);
    assert.ok(!node.matrix && !node.translation && !node.rotation && !node.scale, `${collider.mesh}: 顶点就是世界坐标，节点不带变换`);
    const primitive = json.meshes[node.mesh].primitives[0];
    assert.deepEqual(Object.keys(primitive.attributes), ['POSITION']);
    const accessor = json.accessors[primitive.attributes.POSITION];
    assert.equal(json.accessors[primitive.indices].count % 3, 0);
    // 文档 AABB 是 Unity Collider.bounds（比网格宽 1–3 m）：网格在它里面（容差 1 m）并盖住一半以上宽度。镜像没烘对的话 x 差出两倍的 |x|
    const width = collider.max[0] - collider.min[0];
    if (!(accessor.min[0] >= collider.min[0] - 1 && accessor.max[0] <= collider.max[0] + 1 && accessor.max[0] - accessor.min[0] >= width * 0.5)) {
      bad.push(`${collider.mesh}（${collider.name}）网格 x ${accessor.min[0].toFixed(1)}…${accessor.max[0].toFixed(1)}，文档 ${collider.min[0].toFixed(1)}…${collider.max[0].toFixed(1)}`);
    }
    for (const axis of [1, 2]) if (!(accessor.min[axis] >= collider.min[axis] - 1 && accessor.max[axis] <= collider.max[axis] + 1)) bad.push(`${collider.mesh} 轴 ${axis}`);
  }
  assert.deepEqual(bad, []);
});

test('渲染网格：贴图相对引用都在 levels/textures 下；材质标记是中性键名，顶点属性没有 Unity 前缀', async () => {
  const urls = new Set();
  for (const document of documents.values()) {
    for (const renderer of document.renderers) urls.add(renderer.url);
    for (const prototype of document.vegetation?.prototypes ?? []) urls.add(prototype.url);
    for (const layer of document.groundCover ?? []) if (layer.url) urls.add(layer.url);
  }
  let lava = 0;
  for (const url of urls) {
    assert.ok(url.startsWith('assets/levels/meshes/'), url);
    const { json } = await glb(`public/${url}`);
    for (const image of json.images ?? []) {
      if (!image.uri) continue;
      assert.ok(image.uri.startsWith('../textures/'), `${url}: ${image.uri}`);
      assert.ok(await exists(`public/assets/levels/meshes/${image.uri}`), `${url}: ${image.uri}`);
    }
    for (const material of json.materials ?? []) {
      assert.ok(!Object.keys(material.extras ?? {}).some(key => /unity/i.test(key)), `${url}: 材质 extras ${Object.keys(material.extras ?? {})}`);
    }
    for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
      const names = Object.keys(primitive.attributes);
      assert.ok(!names.some(name => /UNITY/.test(name)), `${url}: ${names}`);
      const shader = json.materials?.[primitive.material]?.extras?.shader;
      if (shader === 'Spiritfire/Lava') {
        lava++;
        assert.ok(names.includes('_LAVA_INFO') && names.includes('_LAVA_FLOW'), `${url}: 熔岩面要有 _LAVA_INFO / _LAVA_FLOW`);
      } else assert.ok(!names.includes('_LAVA_INFO') && !names.includes('_LAVA_FLOW'), `${url}: 只有熔岩面带熔岩属性`);
    }
  }
  assert.ok(urls.size > 500 && lava > 50, `网格 ${urls.size} 个，熔岩面 ${lava} 个`);
});

test('高度场参与地面移动和射线', async () => {
  const threeUrl = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
  const transform = source => Buffer.from(stripTypeScriptTypes(source.replaceAll("'three'", `'${threeUrl}'`), { mode: 'transform' })).toString('base64');
  const trianglesUrl = `data:text/javascript;base64,${transform(await readFile(new URL('src/world/UnityTriangles.ts', root), 'utf8'))}`;
  const heightUrl = `data:text/javascript;base64,${transform(await readFile(new URL('src/world/UnityHeightSampling.ts', root), 'utf8'))}`;
  const collision = (await readFile(new URL('src/world/Collision.ts', root), 'utf8')).replaceAll("'./UnityTriangles'", `'${trianglesUrl}'`).replaceAll("'./UnityHeightSampling'", `'${heightUrl}'`);
  const { CollisionWorld } = await import(`data:text/javascript;base64,${transform(collision)}`);
  const { sampleUnityHeight } = await import(heightUrl);
  const world = new CollisionWorld();
  world.addHeightfield({ origin: new THREE.Vector3(0, 0, 0), scale: new THREE.Vector3(1, 1, 1), resolution: 2, heights: new Float32Array([0, 0, 0, 1]) });
  assert.equal(sampleUnityHeight(world.heightfields[0], 0.75, 0.75), 0.5);
  assert.equal(world.groundHeight(0.75, 0.75, 5), 0.5);
  const position = new THREE.Vector3(0.75, 2, 0.75);
  const result = world.moveBody(position, 0.3, 1.8, new THREE.Vector3(0, -3, 0), false);
  assert.equal(result.onGround, true);
  assert.ok(Math.abs(position.y - 0.5001) < 1e-3);
  const hit = world.raycast(new THREE.Vector3(0.75, 2, 0.75), new THREE.Vector3(0, -1, 0), 5);
  assert.ok(hit && Math.abs(hit.point.y - 0.5) < 1e-3);
});
