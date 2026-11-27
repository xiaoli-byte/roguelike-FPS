// 离线采样用的 EnemyArt 桩：清单里 skeleton.mode = 'native' 的资产，按发布 GLB 的节点层级与 TRS 搭出同名骨架，
// 交给真实的 NativePose——敌人代码看到的骨骼静止朝向与游戏里完全一致，采到的姿势才能原样还原到 Unity。
// 只搭骨骼，不建网格：boneHull 拿不到顶点（返回空），liftAbove 的贴地修正因此不生效（只影响少数飘带的离地检查）。
//
// 部件骨架（rig.mode = 'parts'，熔心魔将这类程序化模型的 Boss）：骨骼就是程序化模型自己的节点，名字是关节路径
// （PartsRig.jointPaths：j_r / j_0 / j_0_1_21…），游戏代码直接转这些节点。这里按清单的骨架指纹核对路径与静止位置
// （与运行时 attachPartsBody 同一套规则，代码改过对不上就不采），把 GLB 蒙皮里的关节按路径名找出来交给采样器。
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { NativePose } from '../../../src/assets/NativeRig.ts';

const ROOT = new URL('../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('public/assets/manifest.json', ROOT), 'utf8')).assets;

function readGlb(url) {
  const b = readFileSync(new URL('public/' + url, ROOT));
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

/** 与 AssetLibrary.findBound 同义：bind = { source: enemy, id, [variant] }、不是挂件、骨骼资产 */
function findBound(defId, variant) {
  const hits = Object.entries(manifest).filter(([, e]) =>
    e.bind?.source === 'enemy' && e.bind.id === defId && !e.bind.attachment && e.kind === 'skeletal');
  return hits.find(([, e]) => (e.bind.variant ?? null) === (variant ?? null)) ?? hits.find(([, e]) => !e.bind.variant);
}

export function findNativeAsset(defId, variant) {
  const pick = findBound(defId, variant);
  return pick && pick[1].skeleton?.mode === 'native' ? { id: pick[0], entry: pick[1] } : null;
}

/** 部件骨架资产（清单 rig.mode = 'parts'） */
export function findPartsAsset(defId, variant) {
  const pick = findBound(defId, variant);
  return pick && pick[1].skeleton?.mode !== 'native' && pick[1].rig?.mode === 'parts' ? { id: pick[0], entry: pick[1] } : null;
}

/** 按 GLB 场景节点重建层级：蒙皮关节建 Bone，其余节点建 Object3D；网格节点跳过（只要骨骼） */
export function buildSkeleton(entry) {
  const doc = readGlb(entry.url);
  const joints = new Set((doc.skins ?? []).flatMap((s) => s.joints));
  const model = new THREE.Group();
  model.name = 'Scene';
  const make = (i, parent) => {
    const n = doc.nodes[i];
    if (n.mesh !== undefined && !joints.has(i)) return;
    const o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name ?? `node_${i}`;
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    parent.add(o);
    for (const c of n.children ?? []) make(c, o);
  };
  for (const r of doc.scenes[doc.scene ?? 0].nodes) make(r, model);
  return model;
}

/** GLB 蒙皮里的关节名（去重、按出现顺序） */
function skinJointNames(entry) {
  const doc = readGlb(entry.url);
  const out = [];
  for (const s of doc.skins ?? []) for (const j of s.joints) {
    const name = doc.nodes[j].name;
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * jointPaths 由采样器在要采部件骨架时动态 import PartsRig.ts 再传进来（globalThis.__bakeParts）：静态 import 会连带加载
 * SkinnedBody 等模块，模块初始化时建的 three 对象会消耗固定种子的 Math.random（uuid），所有敌人的采样都会跟着变
 */
function attachParts(o, hit, jointPaths) {
  const paths = jointPaths(o.host);
  const _v = new THREE.Vector3();
  for (const [name, pos] of hit.entry.rig.joints) {
    const n = paths.get(name);
    if (!n || n.position.distanceTo(_v.fromArray(pos)) > 2e-3) {
      console.warn(`[bake] ${hit.id} 骨架指纹不符（${name}），程序化模型代码改过：不采样`);
      return null;
    }
  }
  const names = skinJointNames(hit.entry).filter((n) => paths.has(n));
  o.host.updateWorldMatrix(true, true);
  o.host.updateMatrix();
  o.host.userData.__restLocal = o.host.matrix.clone();
  // 静止姿势 = 构建姿势（GLB 的绑定姿势），要在登场演出（entrance(0)：从天而降时身体抬在 30 多米高）之前取
  const inv = o.host.matrixWorld.clone().invert();
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const restSample = names.flatMap((n) => {
    m.multiplyMatrices(inv, paths.get(n).matrixWorld).decompose(p, q, s);
    return [q.x, q.y, q.z, q.w, p.x, p.y, p.z];
  });
  const body = {
    __restSample: restSample,
    lod: new THREE.LOD(),
    pose: { host: o.host },
    materials: [new THREE.MeshStandardMaterial()],
    dispose() {},
    __assetId: hit.id,
    __model: o.host,
    __joints: names.map((n) => paths.get(n)),
    __jointNames: names,
  };
  globalThis.__bakeAttached?.(body, o);
  return body;
}

export function attachEnemyArt(o) {
  const hit = findNativeAsset(o.defId, o.variant);
  if (!hit) {
    // 部件骨架只在采样器要它时搭（__bakeParts），平时（原生骨架敌人的场景里出现的旧敌人 / 友军桩）照旧返回空
    const parts = globalThis.__bakeParts ? findPartsAsset(o.defId, o.variant) : null;
    const body = parts ? attachParts(o, parts, globalThis.__bakeParts.jointPaths) : null;
    return { body, native: null, parts: [] };
  }
  const model = buildSkeleton(hit.entry);
  o.host.add(model);
  o.host.updateWorldMatrix(true, true);
  o.host.updateMatrix();
  o.host.userData.__restLocal = o.host.matrix.clone(); // 采样参照系用（bake-native-anims.mjs frameOf）
  const material = new THREE.MeshStandardMaterial();
  const body = {
    lod: new THREE.LOD(),
    pose: new NativePose(model, o.host),
    glowShell: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
    materials: [material],
    dispose() {},
    // 采样器读取：资产 ID 与骨架根
    __assetId: hit.id,
    __model: model,
  };
  globalThis.__bakeAttached?.(body, o);
  return { body, native: body, parts: [] };
}
