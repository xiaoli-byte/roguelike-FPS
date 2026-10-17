// 离线采样用的 EnemyArt 桩：清单里 skeleton.mode = 'native' 的资产，按发布 GLB 的节点层级与 TRS 搭出同名骨架，
// 交给真实的 NativePose——敌人代码看到的骨骼静止朝向与游戏里完全一致，采到的姿势才能原样还原到 Unity。
// 只搭骨骼，不建网格：boneHull 拿不到顶点（返回空），liftAbove 的贴地修正因此不生效（只影响少数飘带的离地检查）。
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
export function findNativeAsset(defId, variant) {
  const hits = Object.entries(manifest).filter(([, e]) =>
    e.bind?.source === 'enemy' && e.bind.id === defId && !e.bind.attachment && e.kind === 'skeletal');
  const pick = hits.find(([, e]) => (e.bind.variant ?? null) === (variant ?? null)) ?? hits.find(([, e]) => !e.bind.variant);
  return pick && pick[1].skeleton?.mode === 'native' ? { id: pick[0], entry: pick[1] } : null;
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

export function attachEnemyArt(o) {
  const hit = findNativeAsset(o.defId, o.variant);
  if (!hit) return { body: null, native: null, parts: [] };
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
