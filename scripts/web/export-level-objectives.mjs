// 关卡目标（灵火坛 / LevelObjective / 首领据点）→ 网页：public/assets/unity-levels/objectives.json。不需要 Unity，直接读场景的文本 YAML。
//
//   node scripts/web/export-level-objectives.mjs            写
//   node scripts/web/export-level-objectives.mjs --check    只核对发布的文件是不是由当前 Unity 场景生成的（不写）
//   --unity <目录>   Unity 工程目录（默认本仓库的 unity/）
//
// 为什么单独导：WebSceneExporter 导出的场景文档里没有这几样组件（docs/threejs-migration.md 4.1「导出器补：……灵坛、关卡目标」）。
// 灵火坛的位置在场景文档里能按渲染件的 scenePath（Markers/Spirit Altars · 灵火坛/Altar_<i>_<据点>/…四角石柱）找到，
// 但守卫场地、据点模式、N 选 M、门槛圆只在组件里，所以照 export-volume-profiles.mjs 的做法读 YAML：
//   SpiritAltar（脚本 guid 458742ce…）：物体名、title、guard（EncounterSite → 它的 title）、lightOnGuardCleared、kindleTime、healOnLight、世界位置与朝向
//   LevelObjective（44091cfb…）：title、altarsNeeded、required / optional（场地 title）、altars（物体名，按场景里的顺序）
//   BossEncounter（76a7cb85…）：bossId、stronghold、altar（物体名）、rewardPoint、thresholdInset、tetherSlack、warnSeconds / warnText
//   ZheduoLevel（b06dfa47…）：strongholds 的门槛圆（圆心世界位置、半径、脚的高度范围）——4-1 三领主的进场门槛由它判
// 坐标换成网页：x 取反；朝向 yaw（度，0 = +Z，往 +X 为正）按网页世界算。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { parseUnityYaml } from './unity-yaml.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/assets/unity-levels/objectives.json');
const SCRIPTS = {
  altar: '458742cedd7623a41bf6dec4c471acfe',
  objective: '44091cfba7ad915459297e06acbb128c',
  encounter: '76a7cb85154d1c0488536c2229ab4a0d',
  site: '7bf3af3853e569043aa8736a1037cc5f',
  zheduo: 'b06dfa471c7773244a475bfac32e12a6',
};

const args = process.argv.slice(2);
const check = args.includes('--check');
const unityArg = args.includes('--unity') ? args[args.indexOf('--unity') + 1] : null;
const UNITY = resolve(unityArg ?? join(ROOT, 'unity'));
const warnings = [];

/** YAML 双引号字符串（中文 Unity 写成 "灵…"、\xB7） */
function yamlString(s) {
  if (typeof s !== 'string') return String(s ?? '');
  if (!s.startsWith('"')) return s;
  try {
    return JSON.parse(s.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1'));
  } catch {
    return s.slice(1, -1);
  }
}

const ref = (r) => (r && typeof r === 'object' && r.fileID !== undefined && String(r.fileID) !== '0' ? String(r.fileID) : null);
const round = (v, k = 1e4) => Math.round(v * k) / k;

function sceneObjectives(stageId, scenePath) {
  const docs = parseUnityYaml(readFileSync(scenePath, 'utf8'));
  const transformOf = new Map(); // GameObject → Transform 文档 id
  for (const [id, d] of docs) if (d.type === 'Transform' && d.body?.m_GameObject) transformOf.set(String(d.body.m_GameObject.fileID), id);
  const world = (transformId, depth = 0) => {
    const t = docs.get(transformId)?.body;
    const local = new THREE.Matrix4();
    if (!t) return local;
    const p = t.m_LocalPosition ?? { x: 0, y: 0, z: 0 }, r = t.m_LocalRotation ?? { x: 0, y: 0, z: 0, w: 1 }, s = t.m_LocalScale ?? { x: 1, y: 1, z: 1 };
    local.compose(new THREE.Vector3(+p.x, +p.y, +p.z), new THREE.Quaternion(+r.x, +r.y, +r.z, +r.w), new THREE.Vector3(+s.x, +s.y, +s.z));
    const father = String(t.m_Father?.fileID ?? '0');
    if (father === '0' || depth > 64 || !docs.has(father)) return local;
    return world(father, depth + 1).multiply(local);
  };
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), f = new THREE.Vector3();
  /** 物体（GameObject id）的网页世界位置与朝向 yaw（度） */
  const placeOf = (goId) => {
    const tid = goId ? transformOf.get(goId) : null;
    if (!tid) return null;
    world(tid).decompose(p, q, s);
    // Unity 前方 +Z 转到世界、再换网页坐标（x 取反）
    f.set(0, 0, 1).applyQuaternion(q);
    return { position: [round(-p.x), round(p.y), round(p.z)], yaw: round(Math.atan2(-f.x, f.z) * 180 / Math.PI, 100) };
  };
  /** Transform 引用（BossEncounter.rewardPoint、ZheduoLevel 的 center） */
  const placeOfTransform = (transformRef) => {
    const id = ref(transformRef);
    const goId = id ? String(docs.get(id)?.body?.m_GameObject?.fileID ?? '') : null;
    return goId ? placeOf(goId) : null;
  };
  const goName = (goId) => yamlString(docs.get(goId)?.body?.m_Name ?? '');
  const behaviours = (guid) => [...docs].filter(([, d]) => d.type === 'MonoBehaviour' && d.body?.m_Script?.guid === guid);
  const siteTitle = (siteRef) => {
    const id = ref(siteRef);
    const b = id ? docs.get(id)?.body : null;
    if (!b) return null;
    return yamlString(b.title ?? '') || goName(String(b.m_GameObject?.fileID ?? ''));
  };

  // 灵火坛
  const altarName = new Map(); // MonoBehaviour id → 物体名
  const altars = [];
  for (const [id, d] of behaviours(SCRIPTS.altar)) {
    const b = d.body;
    const goId = String(b.m_GameObject?.fileID ?? '0');
    const name = goName(goId);
    altarName.set(id, name);
    const place = placeOf(goId);
    if (!place) {
      warnings.push(`${stageId}：灵火坛 ${name} 没有 Transform，跳过`);
      continue;
    }
    altars.push({
      name, title: yamlString(b.title ?? '灵火坛'), ...place,
      guard: siteTitle(b.guard), lightOnGuardCleared: Number(b.lightOnGuardCleared) !== 0,
      kindleTime: Number(b.kindleTime ?? 1.2), healOnLight: Number(b.healOnLight ?? 1) !== 0,
    });
  }
  altars.sort((a, b) => a.name.localeCompare(b.name));

  // 关卡目标（一个场景一个）
  const objs = behaviours(SCRIPTS.objective);
  if (objs.length > 1) warnings.push(`${stageId}：场景里有 ${objs.length} 个 LevelObjective，只取第一个`);
  let objective = null;
  if (objs.length) {
    const b = objs[0][1].body;
    const list = (arr, fn) => (Array.isArray(arr) ? arr : []).map(fn).filter(x => x);
    objective = {
      title: yamlString(b.title ?? ''),
      altarsNeeded: Number(b.altarsNeeded ?? 0),
      autoCollect: Number(b.autoCollect ?? 1) !== 0,
      required: list(b.required, siteTitle),
      optional: list(b.optional, siteTitle),
      altars: list(b.altars, r => altarName.get(ref(r) ?? '') ?? null),
    };
  }

  // 首领流程（据点模式）
  const encounterBoss = new Map(); // MonoBehaviour id → bossId
  const bosses = [];
  for (const [id, d] of behaviours(SCRIPTS.encounter)) {
    const b = d.body;
    const bossId = String(b.bossId ?? '');
    encounterBoss.set(id, bossId);
    bosses.push({
      bossId, stronghold: Number(b.stronghold ?? 0) !== 0, enabled: Number(b.m_Enabled ?? 1) !== 0,
      altar: altarName.get(ref(b.altar) ?? '') ?? null,
      rewardPoint: placeOfTransform(b.rewardPoint)?.position ?? null,
      thresholdInset: Number(b.thresholdInset ?? 2), tetherSlack: Number(b.tetherSlack ?? 8),
      warnSeconds: Number(b.warnSeconds ?? 2.5), warnText: yamlString(b.warnText ?? ''),
    });
  }

  // 4-1：据点门槛（ZheduoLevel）
  for (const [, d] of behaviours(SCRIPTS.zheduo)) {
    for (const s of d.body.strongholds ?? []) {
      const bossId = encounterBoss.get(ref(s.encounter) ?? '');
      const boss = bosses.find(x => x.bossId === bossId);
      const center = placeOfTransform(s.center);
      if (!boss || !center) {
        warnings.push(`${stageId}：ZheduoLevel 的据点门槛对不上首领流程（${bossId ?? '?'}），跳过`);
        continue;
      }
      boss.threshold = { center: center.position, radius: Number(s.radius ?? 22), minY: round(Number(s.minY ?? -1000)), maxY: round(Number(s.maxY ?? 1000)) };
    }
  }

  if (!altars.length && !objective && !bosses.some(b => b.stronghold)) return null;
  return { scene: relative(UNITY, scenePath).replace(/\\/g, '/'), objective, altars, bosses };
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'public/assets/unity-levels/manifest.json'), 'utf8'));
const levels = {};
for (const stage of manifest.stages) {
  const scenePath = join(UNITY, stage.scene);
  if (!existsSync(scenePath)) {
    warnings.push(`${stage.id}：场景 ${stage.scene} 不存在，跳过`);
    continue;
  }
  const head = readFileSync(scenePath, 'utf8').slice(0, 64);
  if (!head.startsWith('%YAML')) {
    warnings.push(`${stage.id}：场景 ${stage.scene} 不是文本 YAML（DLP 密文？先跑 node scripts/unity/dlp-unity-fix.mjs），跳过`);
    continue;
  }
  const o = sceneObjectives(stage.id, scenePath);
  if (o) levels[stage.id] = o;
}

const doc = { schema: 1, generator: 'scripts/web/export-level-objectives.mjs', levels };
const text = `${JSON.stringify(doc, null, 1)}\n`;
for (const w of [...new Set(warnings)]) console.warn(`[objectives] ${w}`);
const summary = Object.entries(levels).map(([id, l]) => `${id}（灵火坛 ${l.altars.length}${l.objective ? `，要点亮 ${l.objective.altarsNeeded}` : ''}${l.bosses.some(b => b.stronghold) ? `，据点首领 ${l.bosses.filter(b => b.stronghold).length}` : ''}）`).join('、');
if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== text) {
    console.error(`[objectives] ${relative(ROOT, OUT)} 不是由当前 Unity 场景生成的：重跑 node scripts/web/export-level-objectives.mjs`);
    process.exit(1);
  }
  console.log(`[objectives] 一致：${summary}`);
} else {
  writeFileSync(OUT, text);
  console.log(`[objectives] 写出 ${relative(ROOT, OUT)}：${summary}，${(text.length / 1024).toFixed(1)} KB`);
}
