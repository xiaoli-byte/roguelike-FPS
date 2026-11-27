// 动画测试（anim-*.test.mjs）共用：直接 import src/anim 的 TS 源码（ts-hooks），按发布 GLB 的节点层级搭无网格骨架，
// 读导出的 public/assets/anim/*.json 与（不入库的）采样源数据 *.native-anim.json。
import { register } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

register('../scripts/node/ts-hooks.mjs', import.meta.url);
export const anim = await import('../src/anim/index.ts');

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const ANIM_DIR = join(ROOT, 'public/assets/anim');

export function readGlbJson(path) {
  const b = readFileSync(path);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

/** 按 GLB 场景节点重建层级（与 GLTFLoader 同样的节点名清洗）；蒙皮关节建 Bone，其余 Object3D；网格节点跳过 */
export function buildSkeleton(id) {
  const doc = readGlbJson(join(ROOT, 'public/assets/characters', `${id}.glb`));
  const joints = new Set((doc.skins ?? []).flatMap((s) => s.joints));
  const model = new THREE.Group();
  model.name = 'Scene';
  const make = (i, parent) => {
    const n = doc.nodes[i];
    if (n.mesh !== undefined && !joints.has(i)) return;
    const o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
    o.name = THREE.PropertyBinding.sanitizeNodeName(n.name ?? `node_${i}`);
    o.userData.gltfName = n.name;
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    parent.add(o);
    for (const c of n.children ?? []) make(c, o);
  };
  for (const r of doc.scenes[doc.scene ?? 0].nodes) make(r, model);
  model.updateMatrixWorld(true);
  return model;
}

export const manifest = () => JSON.parse(readFileSync(join(ANIM_DIR, 'manifest.json'), 'utf8'));
export const animData = (id) => JSON.parse(readFileSync(join(ANIM_DIR, `${id}.json`), 'utf8'));

/** 采样中间件（不入库）：<根>/<资产>/anim/_tmp/<资产>.native-anim.json */
const samplePath = (dir, id) => join(dir, id, 'anim/_tmp', `${id}.native-anim.json`);

/**
 * 采样源数据所在的目录（art/source/characters，scripts/anim/bake-*.mjs 写的，不入库）：本仓库的；在 git worktree 里没有就退到主工作区；
 * 都没有返回 null（相关用例跳过）。2026-11-27 前在 unity/Assets/Art/Characters/<资产>/Anim/。
 */
export function sourceDir() {
  const has = (dir) => existsSync(dir) && readdirSync(dir).some((id) => existsSync(samplePath(dir, id)));
  const own = join(ROOT, 'art/source/characters');
  if (has(own)) return own;
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(ROOT, '.git'), 'utf8'));
    if (m) {
      const main = join(resolve(m[1].trim(), '../../..'), 'art/source/characters');
      if (has(main)) return main;
    }
  } catch { /* .git 是目录 */ }
  return null;
}

export function loadSource(dir, id) {
  return JSON.parse(readFileSync(samplePath(dir, id), 'utf8'));
}

/** 事件叠加表（入库，手写）：art/anim/<资产>.events.json */
export function loadOverlay(id) {
  const p = join(ROOT, 'art/anim', `${id}.events.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).clips ?? {} : {};
}

/** 一个片段在 t 秒时的姿势：新混合器、单动作求值，返回 节点名 → 模型空间矩阵（之后动作停掉、骨骼回到原值） */
export function poseAt(model, clip, t) {
  const mixer = new THREE.AnimationMixer(model);
  const a = mixer.clipAction(clip);
  a.play();
  a.time = t;
  a.timeScale = 0;
  mixer.update(0);
  model.updateMatrixWorld(true);
  const out = new Map();
  model.traverse((o) => { if (o !== model) out.set(o.name, o.matrixWorld.clone()); });
  a.stop();
  mixer.uncacheRoot(model);
  model.updateMatrixWorld(true);
  return out;
}
