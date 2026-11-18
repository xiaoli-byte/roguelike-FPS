// 地图机关（M7）→ 网页：public/assets/unity-levels/mechanisms.json（+ 软边界距离场 boundary/<关卡>.f32）。不需要 Unity，直接读已提交的文本 YAML 场景。
//
//   node scripts/web/export-mechanisms.mjs            写
//   node scripts/web/export-mechanisms.mjs --check    只核对发布的文件是不是由当前场景生成的（不写）
//   --unity <目录>   Unity 工程目录（默认本仓库的 unity/）
//
// 做法（同 export-volume-profiles.mjs）：
//   · 场景里每个 MonoBehaviour 按 m_Script 的 guid 对上 G/World/**/*.cs.meta 认出机关组件，读它的序列化字段；
//   · 所在 GameObject 的 Transform 链（m_Father）乘出世界矩阵；预制体实例（stripped Transform）按 PrefabInstance 的 m_Modifications
//     + 预制体资产根节点补齐本地变换和名字；
//   · scenePath 照 WebSceneExporter.ScenePath：根物体名 / 子物体名 / …，同一个父物体下有同名兄弟时名字后加「#它在同名兄弟里的序号」
//     （根物体的顺序看 SceneRoots.m_Roots），和场景文档里 renderers / colliders 的 scenePath 一一对上；
//   · 坐标换成网页的：点 / 方向 x 取反，四元数 (x, −y, −z, w)，绕 Y 的朝向（度）取反，本地向量（流向、转轴）按镜像换（流向 x 取反、转轴 (x, −y, −z)），
//     XZ 平面的方向（风向、风暴来向）x 取反；软边界的距离场保留 Unity 坐标（网页按 −x 采样，见 src/world/mechanisms/Boundary.ts）。
//   · 停用的物体（自己或祖先 m_IsActive = 0）和关掉的组件不导出，同 WebSceneExporter（LevelLayout 引用的物体导出器会临时激活：这里也照办）。
//
// 软边界距离场（Boundary_<关>_SDF.asset，RFloat）按 unity/.gitignore 不入库（关卡构建器可再生）：在 --unity 目录找不到时到主检出
// （git 公共目录的上一级）的同一路径找，原样写成小端 float32 的 boundary/<关卡>.f32，mechanisms.json 里记尺寸和 sha1。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { parseUnityYaml, readMetaGuid } from './unity-yaml.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/assets/unity-levels/mechanisms.json');
const SDF_DIR = join(ROOT, 'public/assets/unity-levels/boundary');
const args = process.argv.slice(2);
const check = args.includes('--check');
const unityArg = args.includes('--unity') ? args[args.indexOf('--unity') + 1] : null;
const UNITY = resolve(unityArg ?? join(ROOT, 'unity'));

const warnings = [];
const round = (v, k = 1e5) => Math.round(v * k) / k || 0;

/** YAML 双引号字符串（场景物体名带中文时 Unity 写成 "中…"，\xB7 这类两位转义也有） */
function yamlString(s) {
  if (typeof s === 'number') return String(s);
  if (typeof s !== 'string') return '';
  if (!s.startsWith('"')) return s;
  try {
    return JSON.parse(s.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1'));
  } catch {
    return s.slice(1, -1);
  }
}

function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (name.endsWith(ext)) out.push(path);
  }
  return out;
}

// ───────────── 脚本 guid → 类名 ─────────────

const scriptByGuid = new Map();
for (const meta of walk(join(UNITY, 'Assets/Game/Scripts'), '.cs.meta')) {
  const guid = readMetaGuid(readFileSync(meta, 'utf8'));
  if (guid) scriptByGuid.set(guid, meta.replace(/\\/g, '/').split('/').pop().replace('.cs.meta', ''));
}
// 预制体 guid → 路径（stripped Transform 的名字 / 本地变换缺省值）
let prefabByGuid = null;
function prefabPath(guid) {
  if (!prefabByGuid) {
    prefabByGuid = new Map();
    for (const meta of walk(join(UNITY, 'Assets'), '.prefab.meta')) {
      const g = readMetaGuid(readFileSync(meta, 'utf8'));
      if (g) prefabByGuid.set(g, meta.slice(0, -5));
    }
  }
  return prefabByGuid.get(guid) ?? null;
}
const prefabDocs = new Map();
function prefabRoot(guid) {
  if (prefabDocs.has(guid)) return prefabDocs.get(guid);
  const path = prefabPath(guid);
  let root = null;
  if (path && existsSync(path)) {
    const docs = parseUnityYaml(readFileSync(path, 'utf8'));
    for (const [, d] of docs) {
      if ((d.type === 'Transform' || d.type === 'RectTransform') && String(d.body?.m_Father?.fileID ?? '0') === '0') {
        const go = docs.get(String(d.body.m_GameObject?.fileID))?.body;
        root = { transform: d.body, name: yamlString(go?.m_Name ?? ''), active: Number(go?.m_IsActive ?? 1) !== 0 };
        break;
      }
    }
  }
  prefabDocs.set(guid, root);
  return root;
}

// ───────────── 场景图 ─────────────

class SceneGraph {
  constructor(path) {
    this.path = path;
    this.docs = parseUnityYaml(readFileSync(path, 'utf8'));
    /** GameObject fileID → Transform fileID */
    this.transformOf = new Map();
    /** Transform fileID → 节点 { id, name, active, local: {p, r, s}, father, children[] } */
    this.nodes = new Map();
    for (const [id, d] of this.docs) {
      if (d.type !== 'Transform' && d.type !== 'RectTransform') continue;
      const b = d.body ?? {};
      const pi = String(b.m_PrefabInstance?.fileID ?? '0');
      if (!b.m_LocalPosition && pi !== '0') this.nodes.set(id, this.strippedNode(id, b, pi));
      else {
        const go = this.docs.get(String(b.m_GameObject?.fileID))?.body ?? {};
        this.transformOf.set(String(b.m_GameObject?.fileID), id);
        this.nodes.set(id, {
          id, name: yamlString(go.m_Name ?? ''), active: Number(go.m_IsActive ?? 1) !== 0,
          local: { p: b.m_LocalPosition, r: b.m_LocalRotation, s: b.m_LocalScale },
          father: String(b.m_Father?.fileID ?? '0'), children: (b.m_Children ?? []).map(c => String(c.fileID)),
        });
      }
    }
    // stripped 节点挂到父节点的 children 里（父节点的 m_Children 通常已经列了它）
    for (const [id, n] of this.nodes) {
      if (n.father === '0') continue;
      const f = this.nodes.get(n.father);
      if (f && !f.children.includes(id)) f.children.push(id);
    }
    const roots = [...this.docs.values()].find(d => d.type === 'SceneRoots')?.body?.m_Roots;
    this.roots = roots ? roots.map(r => String(r.fileID)).filter(id => this.nodes.has(id))
      : [...this.nodes.values()].filter(n => n.father === '0').map(n => n.id);
    for (const n of this.nodes.values()) if (n.father === '0' && !this.roots.includes(n.id)) this.roots.push(n.id);
    this.matrices = new Map();
    this.paths = new Map();
  }

  /** 预制体实例的根（stripped Transform）：本地变换 / 名字 / 启用状态 = 预制体根节点 + 实例上的覆盖 */
  strippedNode(id, b, piId) {
    const pi = this.docs.get(piId)?.body ?? {};
    const mod = pi.m_Modification ?? {};
    const guid = pi.m_SourcePrefab?.guid ?? b.m_CorrespondingSourceObject?.guid;
    const root = guid ? prefabRoot(guid) : null;
    const t = root?.transform ?? {};
    const p = { ...(t.m_LocalPosition ?? { x: 0, y: 0, z: 0 }) }, r = { ...(t.m_LocalRotation ?? { x: 0, y: 0, z: 0, w: 1 }) }, s = { ...(t.m_LocalScale ?? { x: 1, y: 1, z: 1 }) };
    let name = root?.name ?? '', active = root?.active ?? true;
    const sourceFile = String(b.m_CorrespondingSourceObject?.fileID ?? '');
    for (const m of mod.m_Modifications ?? []) {
      const path = m.propertyPath, v = m.value;
      const target = String(m.target?.fileID ?? '');
      if (path === 'm_Name') name = yamlString(v);
      else if (path === 'm_IsActive') active = Number(v) !== 0;
      else if (target === sourceFile) {
        const k = /^m_Local(Position|Rotation|Scale)\.([xyzw])$/.exec(path ?? '');
        if (k) ({ Position: p, Rotation: r, Scale: s })[k[1]][k[2]] = Number(v);
      }
    }
    if (!root) warnings.push(`${relative(UNITY, this.path)}：预制体实例 ${piId} 的预制体（${guid}）找不到，按覆盖值算`);
    return {
      id, name, active, local: { p, r, s }, stripped: true,
      father: String(mod.m_TransformParent?.fileID ?? '0'), children: [],
    };
  }

  node(transformId) { return this.nodes.get(transformId) ?? null; }

  /** 世界矩阵（Unity 坐标） */
  matrix(tid, depth = 0) {
    if (this.matrices.has(tid)) return this.matrices.get(tid);
    const n = this.nodes.get(tid);
    const local = new THREE.Matrix4();
    if (!n) return local;
    const p = n.local.p ?? { x: 0, y: 0, z: 0 }, r = n.local.r ?? { x: 0, y: 0, z: 0, w: 1 }, s = n.local.s ?? { x: 1, y: 1, z: 1 };
    local.compose(new THREE.Vector3(+p.x, +p.y, +p.z), new THREE.Quaternion(+r.x, +r.y, +r.z, +r.w), new THREE.Vector3(+s.x, +s.y, +s.z));
    const m = n.father !== '0' && depth < 64 ? this.matrix(n.father, depth + 1).clone().multiply(local) : local;
    this.matrices.set(tid, m);
    return m;
  }

  /** 自己和祖先都启用 */
  activeChain(tid) {
    for (let id = tid, depth = 0; id && id !== '0' && depth < 64; depth++) {
      const n = this.nodes.get(id);
      if (!n) return true;
      if (!n.active) return false;
      id = n.father;
    }
    return true;
  }

  /** WebSceneExporter.ScenePath */
  scenePath(tid) {
    if (this.paths.has(tid)) return this.paths.get(tid);
    const parts = [];
    for (let id = tid, depth = 0; id && id !== '0' && depth < 64; depth++) {
      const n = this.nodes.get(id);
      if (!n) break;
      const siblings = n.father !== '0' ? (this.nodes.get(n.father)?.children ?? [id]) : this.roots;
      const same = siblings.filter(s => this.nodes.get(s)?.name === n.name);
      parts.push(same.length > 1 ? `${n.name}#${same.indexOf(id)}` : n.name);
      id = n.father;
    }
    const path = parts.reverse().join('/');
    this.paths.set(tid, path);
    return path;
  }

  /** 引用（GameObject / Transform / 组件）→ Transform fileID */
  transformRef(ref) {
    const id = ref && typeof ref === 'object' ? String(ref.fileID ?? '0') : '0';
    if (id === '0' || ref.guid) return null;
    const d = this.docs.get(id);
    if (!d) return null;
    if (this.nodes.has(id)) return id;
    if (d.type === 'GameObject') return this.transformOf.get(id) ?? null;
    const go = String(d.body?.m_GameObject?.fileID ?? '0');
    return this.transformOf.get(go) ?? null;
  }

  /** 引用的组件文档 */
  component(ref) {
    const id = ref && typeof ref === 'object' ? String(ref.fileID ?? '0') : '0';
    return id === '0' ? null : this.docs.get(id) ?? null;
  }
}

// ───────────── 坐标换算 ─────────────

const M = new THREE.Matrix4().makeScale(-1, 1, 1);
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const point = v => [round(-Number(v.x)), round(Number(v.y)), round(Number(v.z))];
const dir2 = v => [round(-Number(v.x)), round(Number(v.y))];
const axis = v => [round(Number(v.x)), round(-Number(v.y)), round(-Number(v.z))];
const vec2 = v => [round(Number(v.x)), round(Number(v.y))];
const color = c => [round(Number(c.r)), round(Number(c.g)), round(Number(c.b)), round(Number(c.a ?? 1))];
const num = v => Number(v ?? 0);
const bool = v => Number(v ?? 0) !== 0;

/** Unity 世界矩阵 → 网页的位置 / 四元数 / 缩放 / 朝向（度） */
function placement(m) {
  m.decompose(_p, _q, _s);
  _e.setFromQuaternion(_q, 'YXZ');
  let yaw = THREE.MathUtils.radToDeg(_e.y);
  if (yaw < 0) yaw += 360;
  const web = M.clone().multiply(m).multiply(M);
  return {
    position: [round(-_p.x), round(_p.y), round(_p.z)],
    rotation: [round(_q.x), round(-_q.y), round(-_q.z), round(_q.w)],
    scale: [round(_s.x), round(_s.y), round(_s.z)],
    yaw: round(-yaw === 0 ? 0 : -yaw),
    matrix: web.elements.map(v => round(v)),
  };
}

// ───────────── 组件 → 网页字段 ─────────────

function makeReader(g) {
  const path = ref => {
    const t = g.transformRef(ref);
    return t ? g.scenePath(t) : null;
  };
  const paths = list => (list ?? []).map(path).filter(Boolean);
  const at = ref => {
    const t = g.transformRef(ref);
    if (!t) return null;
    return { scenePath: g.scenePath(t), ...pick(placement(g.matrix(t)), ['position', 'rotation', 'yaw', 'scale']) };
  };
  const site = ref => {
    const c = g.component(ref);
    if (c?.type === 'MonoBehaviour' && scriptByGuid.get(c.body?.m_Script?.guid) === 'EncounterSite') return yamlString(c.body.title ?? '');
    return null;
  };
  const boss = ref => {
    const c = g.component(ref);
    if (c?.type !== 'MonoBehaviour' || scriptByGuid.get(c.body?.m_Script?.guid) !== 'BossEncounter') return null;
    return { bossId: yamlString(c.body.bossId ?? ''), scenePath: path(ref), stronghold: bool(c.body.stronghold) };
  };
  const objective = ref => {
    const c = g.component(ref);
    if (c?.type !== 'MonoBehaviour' || scriptByGuid.get(c.body?.m_Script?.guid) !== 'LevelObjective') return null;
    return { title: yamlString(c.body.title ?? ''), required: (c.body.required ?? []).map(site).filter(Boolean),
      optional: (c.body.optional ?? []).map(site).filter(Boolean), altarsNeeded: num(c.body.altarsNeeded) };
  };
  return { path, paths, at, site, boss, objective };
}

const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
const SHAPES = ['box', 'disc'];
const tide = t => ({
  enabled: bool(t?.enabled), height: num(t?.height), lowHold: num(t?.lowHold), warn: num(t?.warn), rise: num(t?.rise),
  highHold: num(t?.highHold), fall: num(t?.fall), offset: num(t?.offset),
});

/** 每种机关：从组件字段读出网页要的（x = 组件 body，r = 引用解析） */
const SPECS = {
  LavaVolume: (x, r) => ({
    shape: SHAPES[num(x.shape)] ?? 'box', size: vec2(x.size), depth: num(x.depth), tide: tide(x.tide), surface: r.path(x.surface),
    flow: [round(-num(x.flow?.x)), round(num(x.flow?.y))], depthShore: bool(x.depthShore),
  }),
  LavaGeyser: (x, r) => ({
    period: num(x.period), phase: num(x.phase), warnTime: num(x.warnTime), eruptTime: num(x.eruptTime), startActive: bool(x.startActive),
    activeSite: r.site(x.activeSite), radius: num(x.radius), height: num(x.height), column: r.at(x.column), cracks: r.paths(x.cracks),
    crackColor: color(x.crackColor), playerDamage: num(x.playerDamage), playerLaunch: num(x.playerLaunch), enemyDamage: num(x.enemyDamage),
    enemyLaunch: num(x.enemyLaunch), enemyPush: num(x.enemyPush), shell: r.path(x.shell), shellHp: num(x.shellHp),
    detonateWarn: num(x.detonateWarn), hideShellOnBurst: bool(x.hideShellOnBurst),
  }),
  LavaSluice: (x, r) => ({
    trigger: ['hook', 'lever', 'both'][num(x.trigger)] ?? 'hook', hook: r.path(x.hook), lever: r.at(x.lever), title: yamlString(x.title),
    path: (x.path ?? []).map(point), width: num(x.width), floodRise: num(x.floodRise), restDrop: num(x.restDrop),
    segmentLength: num(x.segmentLength), frontSpeed: num(x.frontSpeed), warn: num(x.warn), duration: num(x.duration),
    riseTime: num(x.riseTime), fallTime: num(x.fallTime), cooldown: num(x.cooldown), uses: num(x.uses),
    ladle: r.at(x.ladle), tiltAxis: axis(x.tiltAxis ?? { x: 1, y: 0, z: 0 }), tiltAngle: num(x.tiltAngle), tiltSeconds: num(x.tiltSeconds), pour: r.path(x.pour),
  }),
  Quicksand: x => ({
    radius: num(x.radius), coreRadius: num(x.coreRadius), pullEdge: num(x.pullEdge), pullCore: num(x.pullCore), slowEdge: num(x.slowEdge),
    slowCore: num(x.slowCore), sinkTime: num(x.sinkTime), burst: num(x.burst), above: num(x.above), below: num(x.below), surface: bool(x.surface),
  }),
  SurfaceZone: x => ({
    profile: { id: yamlString(x.profile?.id), title: yamlString(x.profile?.title), accel: num(x.profile?.accel), friction: num(x.profile?.friction),
      enemyAccel: num(x.profile?.enemyAccel), stumble: num(x.profile?.stumble) },
    area: { shape: ['box', 'disc'][num(x.area?.shape)] ?? 'box', radius: num(x.area?.radius), above: num(x.area?.above), below: num(x.area?.below) },
    lifetime: num(x.lifetime), fadeTime: num(x.fadeTime),
  }),
  SafeZone: x => ({ radius: num(x.radius), height: num(x.height), pushMargin: num(x.pushMargin), carveNavMesh: bool(x.carveNavMesh) }),
  SupplyCamp: x => ({ label: yamlString(x.label), safeRadius: num(x.safeRadius), openShop: bool(x.openShop), restoreOnArrive: bool(x.restoreOnArrive) }),
  Destructible: (x, r) => ({
    kind: ['wood', 'clay', 'stone', 'ice', 'metal'][num(x.kind)] ?? 'wood', baseHp: num(x.baseHp), scaleWithDifficulty: bool(x.scaleWithDifficulty),
    accepts: num(x.accepts), weakTo: num(x.weakTo), weakMult: num(x.weakMult), displayName: yamlString(x.displayName), blocksSight: bool(x.blocksSight),
    intact: r.path(x.intact), rubble: r.path(x.rubble), size: num(x.size), coins: vec2(x.coins ?? { x: 0, y: 0 }), ammoChance: num(x.ammoChance),
    healthChance: num(x.healthChance), blastRadius: num(x.blastRadius), blastDamage: num(x.blastDamage), blastPlayerDamage: num(x.blastPlayerDamage),
    targets: r.paths(x.targets),
  }),
  BreakableSpan: (x, r) => ({
    segments: (x.segments ?? []).map(r.at).filter(Boolean), segmentSize: vec2(x.segmentSize), segmentThickness: num(x.segmentThickness),
    triggers: num(x.triggers), stepDelay: num(x.stepDelay), stepByEnemies: bool(x.stepByEnemies), warnTime: num(x.warnTime),
    chainDelay: num(x.chainDelay), baseHp: num(x.baseHp), signalOrigin: num(x.signalOrigin), fallLimit: num(x.fallLimit),
    kind: ['wood', 'clay', 'stone', 'ice', 'metal'][num(x.kind)] ?? 'wood', displayName: yamlString(x.displayName),
  }),
  Conductor: x => ({
    height: num(x.height), attractRadius: num(x.attractRadius), canCharge: bool(x.canCharge), chargePerStrike: num(x.chargePerStrike),
    drainPerSecond: num(x.drainPerSecond), chargedAt: num(x.chargedAt), splashRadius: num(x.splashRadius), splashDamage: num(x.splashDamage),
  }),
  LoreNote: x => ({
    title: yamlString(x.title), place: yamlString(x.place), lines: (x.lines ?? []).map(yamlString), bannerTitle: yamlString(x.bannerTitle),
    bannerSub: yamlString(x.bannerSub), afterLines: (x.afterLines ?? []).map(yamlString), radius: num(x.radius),
  }),
  IcefallIcicle: (x, r) => ({
    hanging: r.at(x.hanging), fallen: r.path(x.fallen), groundY: num(x.groundY), tipDepth: num(x.tipDepth), baseHp: num(x.baseHp),
    dropDamage: num(x.dropDamage), radius: num(x.radius), playerDamage: num(x.playerDamage),
  }),
  FoundryChannels: (x, r) => ({ surge: r.paths(x.surge), rise: num(x.rise), warn: num(x.warn), riseTime: num(x.riseTime), fallTime: num(x.fallTime) }),
  FoundryLordGate: (x, r) => ({
    objective: r.objective(x.objective), encounter: r.boss(x.encounter), clearChestPoint: r.at(x.clearChestPoint)?.position ?? null,
    lockedHint: yamlString(x.lockedHint), wakeTitle: yamlString(x.wakeTitle), wakeSub: yamlString(x.wakeSub), wakeObjective: yamlString(x.wakeObjective),
    clearChest: bool(x.clearChest),
  }),
  FireGodThrone: (x, r) => ({ fallRoot: r.at(x.fallRoot), fallRenderers: r.paths(x.fallRenderers), channels: r.path(x.channels) }),
  FoundryWindGate: (x, r) => ({
    firstVisit: r.site(x.firstVisit), secondVisit: r.site(x.secondVisit), bellows: (x.bellows ?? []).map(r.at).filter(Boolean),
    bellowsRest: num(x.bellowsRest), bellowsLow: num(x.bellowsLow), bellowsHigh: num(x.bellowsHigh), pumpPeriod: num(x.pumpPeriod),
    lever: r.at(x.lever), furnaceMouth: r.at(x.furnaceMouth)?.position ?? null, lightLow: num(x.lightLow), lightHigh: num(x.lightHigh),
    tides: r.paths(x.tides), laneFrom: (x.laneFrom ?? []).map(point), laneTo: (x.laneTo ?? []).map(point), jetEvery: num(x.jetEvery),
    jetWarn: num(x.jetWarn), jetRadius: num(x.jetRadius), jetDuration: num(x.jetDuration), jetTick: num(x.jetTick),
    jetTickInterval: num(x.jetTickInterval), jetSpots: num(x.jetSpots), jetRange: num(x.jetRange),
  }),
  ForgeWellDirector: (x, r) => ({
    deckSite: r.site(x.deckSite), forgeSite: r.site(x.forgeSite), objective: r.objective(x.objective), northBridge: r.path(x.northBridge),
    collapseFrom: num(x.collapseFrom), bridgeMid: point(x.bridgeMid ?? { x: 0, y: 0, z: 0 }), bridgeMidRadius: num(x.bridgeMidRadius),
    forgeBelly: r.at(x.forgeBelly)?.position ?? null, hook: r.at(x.hook), hookUp: point(x.hookUp), hookDown: point(x.hookDown), hookTime: num(x.hookTime),
    hookLamps: r.paths(x.hookLamps), gate: r.at(x.gate), gateGlow: r.paths(x.gateGlow), gateWarn: num(x.gateWarn), gateHalf: num(x.gateHalf),
    gateFull: num(x.gateFull), gateSpeed: num(x.gateSpeed), gateDirection: num(x.gateDirection), geysers: r.paths(x.geysers),
  }),
  ZheduoLevel: (x, r) => ({
    roamerRoute: (x.roamerRoute ?? []).map(t => r.at(t)?.position).filter(Boolean), roamerLair: r.at(x.roamerLair)?.position ?? null,
    roamerDelay: num(x.roamerDelay), roamerId: yamlString(x.roamerId),
    burrows: (x.burrows ?? []).map(b => ({ site: r.site(b.site), holes: (b.holes ?? []).map(t => r.at(t)?.position).filter(Boolean) })),
    strongholds: (x.strongholds ?? []).map(s => ({ encounter: r.boss(s.encounter), center: r.at(s.center)?.position ?? null, radius: num(s.radius),
      minY: num(s.minY), maxY: num(s.maxY) })),
  }),
  WeatherDirector: x => ({
    baseFogColor: color(x.baseFogColor), baseFogStart: num(x.baseFogStart), baseFogEnd: num(x.baseFogEnd), theme: yamlString(x.theme),
    whiteoutProfile: yamlString(x.whiteoutProfile), windDir: dir2(x.windDir), baseWind: num(x.baseWind),
    regions: (x.regions ?? []).map(g => ({
      name: yamlString(g.name), center: point(g.center), radius: num(g.radius), fade: num(g.fade), profile: yamlString(g.profile), from: dir2(g.from),
      calm: num(g.calm), warn: num(g.warn), storm: num(g.storm), abate: num(g.abate), firstDelay: num(g.firstDelay), armRadius: num(g.armRadius), loop: bool(g.loop),
    })),
  }),
  BoundaryZone: x => ({
    sdfGuid: x.sdf?.guid ?? null, origin: vec2(x.origin), cell: num(x.cell), theme: yamlString(x.theme),
    tuning: Object.fromEntries(Object.entries(x.tuning ?? {}).map(([k, v]) => [k, num(v)])),
  }),
};
/** 列表里的键（输出用的分组名） */
const GROUPS = {
  LavaVolume: 'lava', LavaGeyser: 'geysers', LavaSluice: 'sluices', Quicksand: 'quicksand', SurfaceZone: 'surfaces', SafeZone: 'safeZones',
  SupplyCamp: 'camps', Destructible: 'destructibles', BreakableSpan: 'spans', Conductor: 'conductors', LoreNote: 'lore', IcefallIcicle: 'icicles',
  FoundryChannels: 'foundryChannels', FoundryLordGate: 'lordGates', FireGodThrone: 'fireGodThrones', FoundryWindGate: 'windGates',
  ForgeWellDirector: 'forgeWells', ZheduoLevel: 'zheduo',
};

// ───────────── 软边界距离场 ─────────────

let mainCheckout;
function mainUnity() {
  if (mainCheckout !== undefined) return mainCheckout;
  mainCheckout = null;
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const dir = join(dirname(common), 'unity');
    if (resolve(dir) !== UNITY && existsSync(dir)) mainCheckout = dir;
  } catch { /* 不是 git 仓库 */ }
  return mainCheckout;
}

function sdfAsset(guid) {
  for (const meta of walk(join(UNITY, 'Assets/Levels'), '.asset.meta')) {
    if (readMetaGuid(readFileSync(meta, 'utf8')) !== guid) continue;
    const rel = relative(UNITY, meta.slice(0, -5));
    for (const base of [UNITY, mainUnity()].filter(Boolean)) {
      const path = join(base, rel);
      if (existsSync(path)) return { path, rel: rel.replace(/\\/g, '/') };
    }
    return { path: null, rel: rel.replace(/\\/g, '/') };
  }
  return { path: null, rel: null };
}

/** RFloat 的 Texture2D 资产 → { width, height, data: Float32Array } */
function readSdfTexture(text) {
  const width = Number(/m_Width: (\d+)/.exec(text)?.[1]), height = Number(/m_Height: (\d+)/.exec(text)?.[1]);
  const format = Number(/m_TextureFormat: (\d+)/.exec(text)?.[1]);
  const hex = /_typelessdata: ([0-9a-f]+)/.exec(text)?.[1];
  if (!width || !height || !hex) throw new Error('距离场贴图读不了（没有尺寸或 _typelessdata）');
  if (format !== 18) throw new Error(`距离场贴图格式 ${format} 不是 RFloat(18)`);
  const bytes = Buffer.from(hex, 'hex');
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = bytes.readFloatLE(i * 4);
  return { width, height, data };
}

// ───────────── 主流程 ─────────────

/**
 * 场景文件和发布的场景文档对得上多少：场景文档里每个渲染件（scenePath + 世界位置）在这份场景里找同一路径的物体比位置（1 cm 以内算对上）。
 * 发布的场景文档是 Unity 编辑器从磁盘上的场景导出的，可能带着没提交的改动；机关必须和画出来的东西对齐，所以按它选源
 */
function matchScore(g, sceneDoc) {
  if (!sceneDoc) return 0;
  const byPath = new Map();
  for (const id of g.nodes.keys()) byPath.set(g.scenePath(id), id);
  let hit = 0;
  for (const r of sceneDoc.renderers ?? []) {
    const id = r.scenePath && byPath.get(r.scenePath);
    if (!id) continue;
    g.matrix(id).decompose(_p, _q, _s);
    if (Math.abs(-_p.x - r.position[0]) < 0.01 && Math.abs(_p.y - r.position[1]) < 0.01 && Math.abs(_p.z - r.position[2]) < 0.01) hit++;
  }
  return hit;
}

const sha1 = text => createHash('sha1').update(text.replace(/\r\n/g, '\n')).digest('hex');
const manifest = JSON.parse(readFileSync(join(ROOT, 'public/assets/unity-levels/manifest.json'), 'utf8'));
const scenes = {};
const sdfFiles = new Map();
const counts = {};
for (const stage of manifest.stages) {
  const candidates = [{ source: unityArg ? 'unity' : 'committed', base: UNITY }];
  if (!unityArg && mainUnity()) candidates.push({ source: 'main-checkout', base: mainUnity() });
  const docPath = stage.url ? join(ROOT, 'public', stage.url) : null;
  const sceneDoc = docPath && existsSync(docPath) ? JSON.parse(readFileSync(docPath, 'utf8')) : null;
  let best = null;
  const seenText = new Set();
  for (const c of candidates) {
    const path = join(c.base, stage.scene);
    if (!existsSync(path)) continue;
    const hash = sha1(readFileSync(path, 'utf8'));
    if (seenText.has(hash)) continue;
    seenText.add(hash);
    const graph = new SceneGraph(path);
    const score = matchScore(graph, sceneDoc);
    if (!best || score > best.score) best = { ...c, graph, score, hash };
  }
  if (!best) {
    warnings.push(`${stage.id}：场景 ${stage.scene} 不存在，跳过`);
    continue;
  }
  if (best.source !== candidates[0].source) {
    warnings.push(`${stage.id}：发布的场景文档是从主检出没提交的 ${stage.scene} 导出的（对上 ${best.score} 个渲染件），机关按那份场景导出`);
  }
  const g = best.graph;
  const reader = makeReader(g);
  const out = { scene: stage.scene, source: best.source, sceneSha1: best.hash, weather: null, boundary: null };
  // LevelLayout 引用的物体（出生点 / 出口 / only / hide）：导出器临时激活它们，这里也算启用
  const layoutKeep = new Set();
  for (const [, d] of g.docs) {
    if (d.type !== 'MonoBehaviour' || scriptByGuid.get(d.body?.m_Script?.guid) !== 'LevelLayout') continue;
    for (const v of d.body.variants ?? []) {
      for (const ref of [v.spawn, v.exit, ...(v.only ?? []), ...(v.hide ?? [])]) {
        const t = g.transformRef(ref);
        if (t) layoutKeep.add(t);
      }
    }
  }
  const activeFor = tid => {
    for (let id = tid, depth = 0; id && id !== '0' && depth < 64; depth++) {
      const n = g.node(id);
      if (!n) return true;
      if (!n.active && !layoutKeep.has(id)) return false;
      id = n.father;
    }
    return true;
  };
  for (const [, d] of g.docs) {
    if (d.type !== 'MonoBehaviour') continue;
    const kind = scriptByGuid.get(d.body?.m_Script?.guid);
    const spec = kind && SPECS[kind];
    if (!spec) continue;
    const tid = g.transformRef(d.body.m_GameObject);
    if (!tid) {
      warnings.push(`${stage.id}：${kind} 的物体找不到 Transform，跳过`);
      continue;
    }
    const scenePathOf = g.scenePath(tid);
    if (Number(d.body.m_Enabled ?? 1) === 0 || !activeFor(tid)) {
      warnings.push(`${stage.id}：${kind}「${scenePathOf}」停用，跳过`);
      continue;
    }
    const entry = { scenePath: scenePathOf, ...placement(g.matrix(tid)), ...spec(d.body, reader) };
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (kind === 'WeatherDirector') {
      if (out.weather) warnings.push(`${stage.id}：场景里有两个天气导演，用后一个`);
      out.weather = entry;
    } else if (kind === 'BoundaryZone') {
      const { path, rel } = entry.sdfGuid ? sdfAsset(entry.sdfGuid) : { path: null, rel: null };
      if (!path) {
        warnings.push(`${stage.id}：软边界距离场 ${rel ?? entry.sdfGuid ?? '（空）'} 找不到（按 .gitignore 不入库：在主检出的 Unity 里重新生成关卡）`);
        continue;
      }
      const tex = readSdfTexture(readFileSync(path, 'utf8'));
      const bytes = Buffer.from(tex.data.buffer, tex.data.byteOffset, tex.data.byteLength);
      const url = `assets/unity-levels/boundary/${stage.id}.f32`;
      sdfFiles.set(join(SDF_DIR, `${stage.id}.f32`), bytes);
      out.boundary = {
        scenePath: entry.scenePath, asset: rel, url, width: tex.width, height: tex.height, sha1: createHash('sha1').update(bytes).digest('hex'),
        origin: entry.origin, cell: entry.cell, theme: entry.theme, tuning: entry.tuning,
      };
    } else {
      const key = GROUPS[kind];
      (out[key] ??= []).push(entry);
    }
  }
  for (const key of Object.values(GROUPS)) out[key]?.sort((a, b) => a.scenePath < b.scenePath ? -1 : a.scenePath > b.scenePath ? 1 : 0);
  scenes[stage.id] = out;
}

const doc = { schema: 1, generator: 'scripts/web/export-mechanisms.mjs', coordinates: 'web（Unity x 取反）', scenes };
const text = `${JSON.stringify(doc, null, 1)}\n`;
for (const w of [...new Set(warnings)]) console.warn(`[mechanisms] ${w}`);
const summary = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('，');
if (check) {
  let ok = true;
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== text) {
    console.error(`[mechanisms] ${relative(ROOT, OUT)} 不是由当前 Unity 场景生成的：重跑 node scripts/web/export-mechanisms.mjs`);
    ok = false;
  }
  for (const [path, bytes] of sdfFiles) {
    if (!existsSync(path) || !readFileSync(path).equals(bytes)) {
      console.error(`[mechanisms] ${relative(ROOT, path)} 和距离场资产不一致`);
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  console.log(`[mechanisms] 一致：${Object.keys(scenes).length} 个场景（${summary}），${sdfFiles.size} 张距离场`);
} else {
  mkdirSync(SDF_DIR, { recursive: true });
  for (const [path, bytes] of sdfFiles) writeFileSync(path, bytes);
  writeFileSync(OUT, text);
  console.log(`[mechanisms] 写出 ${relative(ROOT, OUT)}：${Object.keys(scenes).length} 个场景（${summary}），${(text.length / 1024).toFixed(1)} KB；${sdfFiles.size} 张距离场`);
}
