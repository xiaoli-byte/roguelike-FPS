/**
 * 美术管线 · 白模导出（仅开发期使用，不进正式流程）。
 *
 * 游戏里的程序化模型就是每个资产的「白模」（blockout）：它定义了比例、骨骼关节、头部判定与武器挂点。
 * 本模块把白模摆成绑定姿势（A-pose）后导出为 GLB + 骨骼说明 JSON，发给本地管线接收端
 * （`python art/pipeline/assetctl.py serve`），后续概念重绘、高模对齐、蒙皮都以它为基准。
 *
 * 用法（游戏以 ?debug 打开后在控制台执行）：
 *   const art = await import('/src/dev/artExport.ts');
 *   await art.exportEnemyBlockout('grunt', 'SK_Enemy_Grunt');                    // 角色身体（骨骼网格）
 *   await art.exportEnemyAttachment('grunt', 'scimitar', 'SM_EnemyWeapon_Scimitar'); // 挂点上的武器（静态网格）
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { GameContext } from '../core/types';
import { getEnemyEntry } from '../enemies/Registry';
import type { HumanoidRig } from '../enemies/Models';
import { applyBindPose, BIND_ARM_SPREAD, HUMANOID_JOINTS, type HumanoidJoint } from '../assets/HumanoidBind';
import { jointPaths } from '../assets/PartsRig';
import { buildGunModel, PROCEDURAL_PARTS } from '../weapons/WeaponModels';
import { buildArm } from '../weapons/Viewmodel';
import { HEROES } from '../player/Heroes';

const RECEIVER = 'http://127.0.0.1:8766';

interface JointInfo {
  name: string;
  parent: string | null;
  /** 绑定姿势下关节在模型空间（脚底原点、朝 +Z、Y 向上、米）的位置 */
  bindPosition: [number, number, number];
  /** 关节在父关节下的局部位置（游戏里 Group.position，静止时不变） */
  restLocal: [number, number, number];
  /** 绑定姿势下的局部旋转（欧拉角 XYZ，弧度）；程序动画的零旋转是「静止」，绑定姿势相对它有这组旋转 */
  bindRotation: [number, number, number];
  /** 关节自身网格（身体部件）在模型空间的包围盒中心；没有身体部件时为 null */
  partCenter: [number, number, number] | null;
}

interface BlockoutMeta {
  schema: 1;
  assetId: string;
  source: { kind: 'enemy'; id: string };
  /** 坐标约定，便于 DCC 侧核对 */
  space: { up: '+Y'; forward: '+Z'; unit: 'm'; origin: 'feet' };
  bindPose: { armSpread: number };
  bounds: { min: number[]; max: number[] };
  joints: JointInfo[];
  headAnchor: { joint: string; local: number[] } | null;
  /** 网格节点名 → 角色：body 身体部件（会被高精度模型取代）/ glow 发光部件 / attachment 武器等挂件 */
  parts: Record<string, 'body' | 'glow' | 'attachment'>;
  exportedAt: string;
}

const v3 = (v: THREE.Vector3): [number, number, number] => [+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5)];

function ctxOf(): GameContext {
  const ctx = (window as unknown as { __ctx?: GameContext }).__ctx;
  if (!ctx) throw new Error('需要以 ?debug 打开游戏（window.__ctx 不存在）');
  return ctx;
}

/** 构造一个不进场景的敌人实例，只取它的程序化模型与骨骼 */
function buildEnemyBlockout(enemyId: string): { root: THREE.Object3D; rig: HumanoidRig | undefined; inst: Record<string, unknown> } {
  const entry = getEnemyEntry(enemyId);
  if (!entry) throw new Error(`未注册的敌人：${enemyId}`);
  const inst = entry.factory(ctxOf(), { position: new THREE.Vector3(0, -1000, 0) }) as unknown as Record<string, unknown>;
  const root = (inst.buildModel as () => THREE.Object3D).call(inst);
  const rig = inst.rig as HumanoidRig | undefined;
  return { root, rig: rig && rig.hips ? rig : undefined, inst };
}

export async function exportEnemyBlockout(enemyId: string, assetId: string): Promise<BlockoutMeta> {
  const { root, rig, inst } = buildEnemyBlockout(enemyId);
  if (!rig) throw new Error(`${enemyId} 不是 HumanoidRig 人形骨骼，暂不支持自动蒙皮`);
  root.name = 'blockout_root';
  const jointOf = new Map<THREE.Object3D, HumanoidJoint>();
  for (const k of HUMANOID_JOINTS) {
    rig[k].name = k;
    jointOf.set(rig[k], k);
  }
  applyBindPose(rig);
  root.updateMatrixWorld(true);

  // 网格角色标注：挂在关节下的非关节子节点（武器等）里的一切都是挂件；
  // 直接挂在关节上的，发光材质（MeshBasicMaterial）是发光部件，其余是身体部件
  const parts: BlockoutMeta['parts'] = {};
  const partBoxes = new Map<HumanoidJoint, THREE.Box3>();
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const glow = (mesh.material as THREE.Material).type === 'MeshBasicMaterial';
    const joint = jointOf.get(mesh.parent as THREE.Object3D);
    const role = !joint ? 'attachment' : glow ? 'glow' : 'body';
    mesh.name = `${role}_${String(n++).padStart(3, '0')}`;
    mesh.userData = { role, joint: joint ?? null };
    parts[mesh.name] = role;
    if (role === 'body' && joint) {
      const b = partBoxes.get(joint) ?? new THREE.Box3();
      b.expandByObject(mesh);
      partBoxes.set(joint, b);
    }
  });

  const joints: JointInfo[] = HUMANOID_JOINTS.map((k) => {
    const o = rig[k];
    const parent = jointOf.get(o.parent as THREE.Object3D) ?? null;
    const box = partBoxes.get(k);
    return {
      name: k,
      parent,
      bindPosition: v3(o.getWorldPosition(new THREE.Vector3())),
      restLocal: v3(o.position),
      bindRotation: [+o.rotation.x.toFixed(6), +o.rotation.y.toFixed(6), +o.rotation.z.toFixed(6)],
      partCenter: box ? v3(box.getCenter(new THREE.Vector3())) : null,
    };
  });

  const anchorObj = inst.headAnchor as THREE.Object3D | null | undefined;
  const anchorLocal = inst.headLocal as THREE.Vector3 | undefined;
  const anchorJoint = anchorObj ? jointOf.get(anchorObj) : undefined;

  const box = new THREE.Box3().setFromObject(root);
  const meta: BlockoutMeta = {
    schema: 1,
    assetId,
    source: { kind: 'enemy', id: enemyId },
    space: { up: '+Y', forward: '+Z', unit: 'm', origin: 'feet' },
    bindPose: { armSpread: BIND_ARM_SPREAD },
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
    joints,
    headAnchor: anchorJoint && anchorLocal ? { joint: anchorJoint, local: anchorLocal.toArray() } : null,
    parts,
    exportedAt: new Date().toISOString(),
  };

  const glb = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })) as ArrayBuffer;
  await post(`${RECEIVER}/blockout/${assetId}/blockout.glb`, glb);
  await post(`${RECEIVER}/blockout/${assetId}/blockout.json`, new TextEncoder().encode(JSON.stringify(meta, null, 2)).buffer);
  console.info(`[art] ${assetId} 白模已导出：${(glb.byteLength / 1024).toFixed(1)} KB，${joints.length} 个关节`);
  return meta;
}

async function post(url: string, body: ArrayBuffer): Promise<void> {
  // 不设置 Content-Type：保持「简单请求」，接收端不需要处理 CORS 预检
  const r = await fetch(url, { method: 'POST', body });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status} ${await r.text()}`);
}

interface AttachmentMeta {
  schema: 1;
  assetId: string;
  source: { kind: 'enemy' | 'fp'; id: string; attachment: string };
  /** 坐标就是挂点（命名的子节点）的局部空间：原点 = 挂点，不含挂点自身的旋转 */
  space: { up: '+Y'; forward: '+Z'; unit: 'm'; origin: 'attachment' };
  /** 实体部件（不含加法混合的特效件）的包围盒 */
  bounds: { min: number[]; max: number[] };
  /** 网格节点名 → 角色：body 实体部件（会被美术资产取代）/ glow 发光提示件 / glowfx 加法混合特效件（不进四视图）/ nested 嵌套子节点里的件 */
  parts: Record<string, 'body' | 'glow' | 'glowfx' | 'nested'>;
  exportedAt: string;
}

/**
 * 导出挂点上的武器 / 道具（静态网格资产的白模）。挂点是 buildModel 里命名过的子节点（如 blade.name = 'scimitar'）。
 * 只取它的直接子网格，挂点自身的位移 / 旋转不带上（运行时美术网格就挂在挂点下面）。
 */
export async function exportEnemyAttachment(enemyId: string, attachment: string, assetId: string): Promise<AttachmentMeta> {
  const { root } = buildEnemyBlockout(enemyId);
  const socket = root.getObjectByName(attachment);
  if (!socket) throw new Error(`${enemyId} 的模型里没有名为 ${attachment} 的挂点`);
  return exportSocket(socket, assetId, { kind: 'enemy', id: enemyId, attachment });
}

/**
 * 第一人称手臂（每位英雄一套左右手）：Viewmodel.buildArm 的分组就是挂点，在挂点局部空间导出。
 * 右手坐标 = 枪模坐标（握把在原点附近），左手以左手握点为原点。
 */
export async function exportFpArm(heroId: string, side: 'r' | 'l', assetId: string): Promise<AttachmentMeta> {
  const color = HEROES.find((h) => h.id === heroId)?.color;
  if (color === undefined) throw new Error(`未知英雄：${heroId}`);
  const arm = buildArm(side, color);
  return exportSocket(arm, assetId, { kind: 'fp', id: heroId, attachment: arm.name });
}

/** 把挂点下的子树导出成静态挂件白模（挂点局部空间，原点 = 挂点） */
async function exportSocket(socket: THREE.Object3D, assetId: string, source: AttachmentMeta['source']): Promise<AttachmentMeta> {
  const out = new THREE.Group();
  out.name = 'blockout_root';
  const parts: AttachmentMeta['parts'] = {};
  const box = new THREE.Box3();
  let n = 0;
  for (const child of socket.children) {
    const c = child.clone(true);
    out.add(c);
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const nested = o !== c;
      const role = nested ? 'nested' : mat.type !== 'MeshBasicMaterial' ? 'body' : mat.blending === THREE.AdditiveBlending ? 'glowfx' : 'glow';
      mesh.name = `${role}_${String(n++).padStart(3, '0')}`;
      mesh.userData = { role };
      parts[mesh.name] = role;
    });
  }
  out.updateMatrixWorld(true);
  out.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.userData.role === 'body' || m.userData.role === 'glow')) box.expandByObject(m);
  });
  const meta: AttachmentMeta = {
    schema: 1,
    assetId,
    source,
    space: { up: '+Y', forward: '+Z', unit: 'm', origin: 'attachment' },
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
    parts,
    exportedAt: new Date().toISOString(),
  };
  const glb = (await new GLTFExporter().parseAsync(out, { binary: true, onlyVisible: true })) as ArrayBuffer;
  await post(`${RECEIVER}/blockout/${assetId}/blockout.glb`, glb);
  await post(`${RECEIVER}/blockout/${assetId}/blockout.json`, new TextEncoder().encode(JSON.stringify(meta, null, 2)).buffer);
  console.info(`[art] ${assetId} 挂点白模已导出：${Object.keys(parts).length} 个部件`);
  return meta;
}

// ───────────────────────────── 通用部件骨架（非人形敌人 / Boss） ─────────────────────────────

interface PartsJoint {
  /** 节点路径名（见 src/assets/PartsRig.ts 的 jointPaths） */
  name: string;
  parent: string | null;
  bindPosition: [number, number, number];
  restLocal: [number, number, number];
  bindRotation: [number, number, number];
  bindScale: [number, number, number];
}

interface PartsMeta {
  schema: 1;
  assetId: string;
  source: { kind: 'enemy' | 'weapon'; id: string };
  rig: 'parts';
  space: { up: '+Y'; forward: '+Z'; unit: 'm'; origin: 'model' };
  bounds: { min: number[]; max: number[] };
  joints: PartsJoint[];
  /** 运行时保持原样（不隐藏）的子树根：关节路径名，或（网格）原名 */
  keep: string[];
  /** rig 字段名 → 关节路径名（管线的 ROM 测试姿势按字段名书写，经它换成关节） */
  fields: Record<string, string>;
  parts: Record<string, 'body' | 'glow' | 'glowfx' | 'attachment'>;
  exportedAt: string;
}

type PartsExport = PartsMeta & { glbSha256?: string };

/**
 * 导出任意节点层级的程序化模型（自爆兵、飞灯、Boss、枪……）：每个非网格节点都是一根骨骼，按子节点索引路径命名；
 * 绑定姿势就是模型构建出来的姿势。exclude 里的子树不进本资产（记为挂件、运行时保留原样）。
 * glowAsFx：发光件全部记为特效件（不进四视图、不烘进贴图）——枪身的稀有度条、元素能量槽按实例变色，不能画进贴图。
 */
async function exportPartsModel(
  root: THREE.Object3D, rigObj: Record<string, unknown> | undefined, assetId: string, source: PartsMeta['source'],
  opts: { exclude: THREE.Object3D[]; glowAsFx?: boolean; dryRun?: boolean },
): Promise<PartsExport> {
  root.updateMatrixWorld(true);
  const excluded = new Set<THREE.Object3D>();
  for (const r of opts.exclude) r.traverse((o) => excluded.add(o));
  const paths = jointPaths(root);
  const nameOf = new Map<THREE.Object3D, string>();
  for (const [name, o] of paths) {
    o.name = name;
    nameOf.set(o, name);
  }
  // 保留列表在网格统一改名之前定下（被排除的网格按原名保留）
  const keep = opts.exclude.map((o) => nameOf.get(o) ?? o.name);

  const parts: PartsMeta['parts'] = {};
  const box = new THREE.Box3();
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const role = excluded.has(mesh) ? 'attachment' : mat.type !== 'MeshBasicMaterial' ? 'body'
      : opts.glowAsFx || mat.blending === THREE.AdditiveBlending || mat.transparent ? 'glowfx' : 'glow';
    mesh.name = `${role}_${String(n++).padStart(3, '0')}`;
    mesh.userData = { role, joint: nameOf.get(mesh.parent as THREE.Object3D) ?? null };
    parts[mesh.name] = role;
    if (role === 'body' || role === 'glow') box.expandByObject(mesh);
  });

  const fields: Record<string, string> = {};
  for (const [f, o] of Object.entries(rigObj ?? {})) {
    const name = (o as THREE.Object3D)?.isObject3D ? nameOf.get(o as THREE.Object3D) : undefined;
    if (name) fields[f] = name;
  }
  const joints: PartsJoint[] = [...paths].map(([name, o]) => ({
    name,
    parent: o.parent ? nameOf.get(o.parent) ?? null : null,
    bindPosition: v3(o.getWorldPosition(new THREE.Vector3())),
    restLocal: v3(o.position),
    bindRotation: [+o.rotation.x.toFixed(6), +o.rotation.y.toFixed(6), +o.rotation.z.toFixed(6)],
    bindScale: v3(o.scale),
  }));
  const meta: PartsMeta = {
    schema: 1, assetId, source, rig: 'parts',
    space: { up: '+Y', forward: '+Z', unit: 'm', origin: 'model' },
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
    joints, keep, fields, parts, exportedAt: new Date().toISOString(),
  };
  const glb = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })) as ArrayBuffer;
  // dryRun：不发给接收端，只返回 GLB 校验和（补说明字段前先确认几何逐字节不变，接收端才会原地修订而不是开新版本）
  if (opts.dryRun) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', glb));
    return { ...meta, glbSha256: [...hash].map((b) => b.toString(16).padStart(2, '0')).join('') };
  }
  await post(`${RECEIVER}/blockout/${assetId}/blockout.glb`, glb);
  await post(`${RECEIVER}/blockout/${assetId}/blockout.json`, new TextEncoder().encode(JSON.stringify(meta, null, 2)).buffer);
  console.info(`[art] ${assetId} 部件骨架白模已导出：${joints.length} 个节点，${Object.keys(parts).length} 个部件`);
  return meta;
}

/**
 * 非人形敌人 / Boss：sockets 是另做静态资产的命名挂点，rigFields 是不进身体资产、运行时保持程序化的 rig 字段
 * （环绕浮石、冰翼、大剑……）。
 */
export async function exportEnemyParts(
  enemyId: string, assetId: string, opts: { sockets?: string[]; rigFields?: string[]; dryRun?: boolean } = {},
): Promise<PartsExport> {
  const { root, inst } = buildEnemyBlockout(enemyId);
  const exclude: THREE.Object3D[] = [];
  for (const s of opts.sockets ?? []) {
    const o = root.getObjectByName(s);
    if (o) exclude.push(o);
  }
  const rigObj = inst.rig as Record<string, unknown> | undefined;
  for (const f of opts.rigFields ?? []) {
    const o = rigObj?.[f] as THREE.Object3D | undefined;
    if (o?.isObject3D) exclude.push(o);
    else throw new Error(`${enemyId} 的 rig 没有字段 ${f}`);
  }
  return exportPartsModel(root, rigObj, assetId, { kind: 'enemy', id: enemyId }, { exclude, dryRun: opts.dryRun });
}

/**
 * 第一人称武器（同时用于掉落模型）：活动部件（弹匣、转轮、枪管组、泵动护木）是骨骼；
 * PROCEDURAL_PARTS（中空瞄具、弩箭、弓弦）不进资产；稀有度条与能量槽记为特效件。
 * 用基础稀有度、无元素的配色导出（发光件不进四视图，配色不影响美术）。
 */
export async function exportWeaponParts(defId: string, assetId: string, opts: { dryRun?: boolean } = {}): Promise<PartsExport> {
  const m = buildGunModel(defId, 0, 'none', { art: false }); // 白模只要程序化模型
  const exclude = PROCEDURAL_PARTS.map((n) => m.root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  const rigObj: Record<string, unknown> = { muzzle: m.muzzle, mag: m.mag, cylinder: m.cylinder, spinner: m.spinner, pump: m.pump, bolt: m.bolt };
  return exportPartsModel(m.root, rigObj, assetId, { kind: 'weapon', id: defId }, { exclude, glowAsFx: true, dryRun: opts.dryRun });
}
