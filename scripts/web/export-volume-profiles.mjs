// URP Volume（后处理）→ 网页：public/assets/unity-levels/volumes.json。不需要 Unity，直接读文本 YAML。
//
//   node scripts/web/export-volume-profiles.mjs            写
//   node scripts/web/export-volume-profiles.mjs --check    只核对发布的文件是不是由当前 Unity 资产生成的（不写）
//   --unity <目录>   Unity 工程目录（默认本仓库的 unity/）
//
// 输入：
//   public/assets/unity-levels/manifest.json   关卡 id → 场景（Assets/Scenes/*.unity）
//   场景里的 Volume 组件（脚本 guid 172515602e62fb746b5d573b38a5fe58）：全局 / 局部、优先级、权重、混合距离、Profile 的 guid；
//     局部 Volume 读同一物体上的 BoxCollider，按 Transform 链算世界坐标（换成网页坐标：x 取反、四元数 (x, −y, −z, w)）
//   Profile：Assets/Levels、Assets/Settings、Assets/Showcase 下的 *.asset（*.asset.meta 的 guid 对上场景里的引用）
//   Assets/Settings/PC_RPAsset.asset             调色模式 / LUT 尺寸 / HDR / MSAA
//
// 输出（数值单位和 Unity Inspector 一样，不换算——换算在 src/render/UrpColor.ts，照 URP 源码）：
//   pipeline   { colorGradingMode, lutSize, hdr, msaa }
//   profiles   { "<资产路径>": { guid, components: { Bloom: { active, threshold, … 只有勾了 override 的参数 } … } } }
//   scenes     { "<关卡 id>": { scene, volumes: [{ name, profile, global, priority, weight, blendDistance, boxes? }], resolved } }
//              resolved = 只算全局 Volume 时混好的整栈（src/render/UrpVolume.ts 的 evaluateVolumes），方便核对、调试
//
// LUT 不在这里烘：URP 每帧按混好的 Volume 栈在 GPU 上重烘（ColorGradingLutPass），低血量 / 慢动作这些玩法 Volume 改的是
// 对比度和饱和度，只能跟着参数重烘。网页同样做法：PostStack 在参数变了的那一帧用 LutBuilderLdr 的移植版重烘 32³ 的条带 LUT
// （RGBA8，和 URP 的 LDR 档同格式）。CPU 参考实现 bakeLutLdr 在 UrpColor.ts，测试拿它和公式对照。
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { parseUnityYaml, readMetaGuid } from './unity-yaml.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/assets/unity-levels/volumes.json');
const VOLUME_SCRIPT = '172515602e62fb746b5d573b38a5fe58';
const PROFILE_DIRS = ['Assets/Levels', 'Assets/Settings', 'Assets/Showcase'];

const args = process.argv.slice(2);
const check = args.includes('--check');
const unityArg = args.includes('--unity') ? args[args.indexOf('--unity') + 1] : null;
const UNITY = resolve(unityArg ?? join(ROOT, 'unity'));

/** src/render/UrpVolume.ts（纯 TS，无依赖）：去掉类型后按 data: 模块载入 */
async function loadUrpVolume() {
  const source = readFileSync(join(ROOT, 'src/render/UrpVolume.ts'), 'utf8');
  const code = stripTypeScriptTypes(source, { mode: 'transform' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** YAML 双引号字符串（场景物体名带中文时 Unity 写成 "火…"） */
function yamlString(s) {
  if (typeof s !== 'string') return String(s ?? '');
  if (!s.startsWith('"')) return s;
  try {
    return JSON.parse(s.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1'));
  } catch {
    return s.slice(1, -1);
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.asset')) out.push(path);
  }
  return out;
}

const unityPath = (abs) => relative(UNITY, abs).replace(/\\/g, '/');

// ───────────── Profile ─────────────

function convert(kind, raw) {
  switch (kind) {
    case 'color': return [raw.r, raw.g, raw.b, raw.a].map(Number);
    case 'vector': return ('w' in raw ? [raw.x, raw.y, raw.z, raw.w] : 'z' in raw ? [raw.x, raw.y, raw.z] : [raw.x, raw.y]).map(Number);
    case 'bool': return Number(raw) !== 0;
    default: return Number(raw);
  }
}

function readProfile(path, schema, warnings) {
  const docs = parseUnityYaml(readFileSync(path, 'utf8'));
  const root = [...docs.values()].find(d => d.body?.m_EditorClassIdentifier?.endsWith('UnityEngine.Rendering.VolumeProfile'));
  if (!root) return null;
  const components = {};
  for (const ref of root.body.components ?? []) {
    const doc = docs.get(String(ref.fileID));
    const body = doc?.body;
    if (!body) continue;
    const name = body.m_Name;
    const params = schema[name];
    if (!params) {
      warnings.push(`${unityPath(path)}：组件 ${name} 网页没有对应实现，跳过`);
      continue;
    }
    const out = { active: Number(body.active) !== 0 };
    for (const [key, value] of Object.entries(body)) {
      if (!value || typeof value !== 'object' || !('m_OverrideState' in value) || Number(value.m_OverrideState) !== 1) continue;
      const kind = params[key];
      if (!kind) {
        // 只影响 HDR 输出 / 已弃用的参数：不报
        if (!['skipIterations', 'dirtTexture', 'neutralHDRRangeReductionMode', 'acesPreset', 'hueShiftAmount', 'detectPaperWhite', 'paperWhite', 'detectBrightnessLimits', 'minNits', 'maxNits'].includes(key)) {
          warnings.push(`${unityPath(path)}：${name}.${key} 网页没有对应参数，跳过`);
        }
        continue;
      }
      out[key] = convert(kind, value.m_Value);
    }
    components[name] = out;
  }
  return components;
}

// ───────────── 场景里的 Volume ─────────────

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

function sceneVolumes(scenePath, profileByGuid, warnings) {
  const docs = parseUnityYaml(readFileSync(scenePath, 'utf8'));
  const transformOf = new Map(); // GameObject fileID → Transform 文档
  for (const [id, d] of docs) if (d.type === 'Transform' && d.body?.m_GameObject) transformOf.set(String(d.body.m_GameObject.fileID), { id, body: d.body });
  const world = (transformId, depth = 0) => {
    const t = docs.get(transformId)?.body;
    const local = new THREE.Matrix4();
    if (!t) return local;
    const p = t.m_LocalPosition ?? { x: 0, y: 0, z: 0 }, r = t.m_LocalRotation ?? { x: 0, y: 0, z: 0, w: 1 }, s = t.m_LocalScale ?? { x: 1, y: 1, z: 1 };
    local.compose(new THREE.Vector3(+p.x, +p.y, +p.z), new THREE.Quaternion(+r.x, +r.y, +r.z, +r.w), new THREE.Vector3(+s.x, +s.y, +s.z));
    const father = String(t.m_Father?.fileID ?? '0');
    if (father === '0' || depth > 64) return local;
    if (!docs.has(father)) {
      warnings.push(`${unityPath(scenePath)}：Transform ${transformId} 的父节点 ${father} 不在场景里（预制体？），按根节点算`);
      return local;
    }
    return world(father, depth + 1).multiply(local);
  };
  const activeChain = (goId) => {
    for (let id = goId, depth = 0; id && id !== '0' && depth < 64; depth++) {
      const go = docs.get(id)?.body;
      if (!go) return true;
      if (Number(go.m_IsActive) === 0) return false;
      const t = transformOf.get(id);
      const father = String(t?.body?.m_Father?.fileID ?? '0');
      if (father === '0') return true;
      id = String(docs.get(father)?.body?.m_GameObject?.fileID ?? '0');
    }
    return true;
  };

  const out = [];
  for (const [, d] of docs) {
    const b = d.body;
    if (d.type !== 'MonoBehaviour' || b?.m_Script?.guid !== VOLUME_SCRIPT) continue;
    const goId = String(b.m_GameObject?.fileID ?? '0');
    const go = docs.get(goId)?.body;
    const name = yamlString(go?.m_Name ?? 'Volume');
    if (Number(b.m_Enabled) === 0 || !activeChain(goId)) {
      warnings.push(`${unityPath(scenePath)}：Volume「${name}」停用，跳过`);
      continue;
    }
    const guid = b.sharedProfile?.guid;
    const profile = guid ? profileByGuid.get(guid) : null;
    if (!profile) {
      warnings.push(`${unityPath(scenePath)}：Volume「${name}」的 Profile ${guid ?? '（空）'} 找不到，跳过`);
      continue;
    }
    const volume = {
      name, profile, global: Number(b.m_IsGlobal) !== 0, priority: Number(b.priority ?? 0), weight: Number(b.weight ?? 1),
      blendDistance: Number(b.blendDistance ?? 0),
    };
    if (!volume.global) {
      const boxes = [];
      const transform = transformOf.get(goId);
      const matrix = transform ? world(transform.id) : new THREE.Matrix4();
      matrix.decompose(_p, _q, _s);
      for (const c of go?.m_Component ?? []) {
        const comp = docs.get(String(c.component?.fileID));
        if (!comp) continue;
        if (comp.type === 'BoxCollider') {
          if (Number(comp.body.m_Enabled) === 0) continue;
          const center = comp.body.m_Center ?? { x: 0, y: 0, z: 0 }, size = comp.body.m_Size ?? { x: 1, y: 1, z: 1 };
          const c0 = new THREE.Vector3(+center.x, +center.y, +center.z).applyMatrix4(matrix);
          const round = (v) => Math.round(v * 1e5) / 1e5;
          boxes.push({
            center: [round(-c0.x), round(c0.y), round(c0.z)],
            halfSize: [round(Math.abs(size.x * _s.x) / 2), round(Math.abs(size.y * _s.y) / 2), round(Math.abs(size.z * _s.z) / 2)],
            rotation: [round(_q.x), round(-_q.y), round(-_q.z), round(_q.w)],
          });
        } else if (/Collider$/.test(comp.type)) {
          warnings.push(`${unityPath(scenePath)}：局部 Volume「${name}」用的是 ${comp.type}，网页只认 BoxCollider`);
        }
      }
      if (!boxes.length) {
        warnings.push(`${unityPath(scenePath)}：局部 Volume「${name}」没有可用的盒形碰撞体，跳过`);
        continue;
      }
      volume.boxes = boxes;
    }
    out.push(volume);
  }
  return out;
}

// ───────────── 主流程 ─────────────

const urp = await loadUrpVolume();
const warnings = [];

const rp = parseUnityYaml(readFileSync(join(UNITY, 'Assets/Settings/PC_RPAsset.asset'), 'utf8'));
const rpBody = [...rp.values()][0]?.body ?? {};
const pipeline = {
  colorGradingMode: Number(rpBody.m_ColorGradingMode) === 1 ? 'HighDynamicRange' : 'LowDynamicRange',
  lutSize: Number(rpBody.m_ColorGradingLutSize ?? 32),
  hdr: Number(rpBody.m_SupportsHDR ?? 1) !== 0,
  msaa: Number(rpBody.m_MSAA ?? 1),
};
if (pipeline.colorGradingMode !== 'LowDynamicRange') warnings.push('PC_RPAsset 改成了 HDR 调色：网页的 PostStack 只实现了 LDR 档（LUT 不含色调映射），要跟着改');

const profileByGuid = new Map();
for (const dir of PROFILE_DIRS) {
  for (const path of walk(join(UNITY, dir))) {
    if (!existsSync(`${path}.meta`)) continue;
    const text = readFileSync(path, 'utf8');
    if (!text.includes('UnityEngine.Rendering.VolumeProfile')) continue;
    const guid = readMetaGuid(readFileSync(`${path}.meta`, 'utf8'));
    if (guid) profileByGuid.set(guid, unityPath(path));
  }
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'public/assets/unity-levels/manifest.json'), 'utf8'));
const scenes = {};
const used = new Set();
for (const stage of manifest.stages) {
  const scenePath = join(UNITY, stage.scene);
  if (!existsSync(scenePath)) {
    warnings.push(`${stage.id}：场景 ${stage.scene} 不存在，跳过`);
    continue;
  }
  const volumes = sceneVolumes(scenePath, profileByGuid, warnings);
  if (!volumes.length) warnings.push(`${stage.id}：场景里没有 Volume（网页按 URP 默认值：无调色、无色调映射）`);
  for (const v of volumes) used.add(v.profile);
  scenes[stage.id] = { scene: stage.scene, volumes };
}

const profiles = {};
for (const path of [...used].sort()) {
  const guid = [...profileByGuid].find(([, p]) => p === path)?.[0];
  profiles[path] = { guid, components: readProfile(join(UNITY, path), urp.VOLUME_SCHEMA, warnings) ?? {} };
}
for (const [id, scene] of Object.entries(scenes)) {
  scene.resolved = urp.evaluateVolumes({ profiles }, scene, [], null);
  scenes[id] = scene;
}

const doc = { schema: 1, generator: 'scripts/web/export-volume-profiles.mjs', pipeline, profiles, scenes };
const text = `${JSON.stringify(doc, null, 1)}\n`;
for (const w of [...new Set(warnings)]) console.warn(`[volumes] ${w}`);
if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error(`[volumes] ${relative(ROOT, OUT)} 不是由当前 Unity 资产生成的：重跑 node scripts/web/export-volume-profiles.mjs`);
    process.exit(1);
  }
  console.log(`[volumes] 一致：${Object.keys(scenes).length} 个场景，${Object.keys(profiles).length} 份 Profile`);
} else {
  writeFileSync(OUT, text);
  console.log(`[volumes] 写出 ${relative(ROOT, OUT)}：${Object.keys(scenes).length} 个场景，${Object.keys(profiles).length} 份 Profile，${(text.length / 1024).toFixed(1)} KB`);
}
