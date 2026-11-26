import type { UnityHeightfield, UnitySceneDocument } from '../UnityLevelLibrary';
import type { SceneMechanisms } from '../mechanisms/MechanismData';
import type { DesertLight, DesertMapArt, Rgb } from './spec';

/**
 * 文档层的改写：搭场景之前把 Unity 导出的文档换成「重建后」的那一份。纯数据进、纯数据出（node 里也能跑），
 * 不改库里缓存的原件（UnityLevelLibrary 缓存同一份对象，下一局还要用）。
 */

const rgba = (c: Rgb): [number, number, number, number] => [c[0], c[1], c[2], 1];

/** azimuth / elevation（度）→ 平行光的 forward（光传播方向，网页坐标） */
export function sunForward(azimuth: number, elevation: number): [number, number, number] {
  const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
  const toward = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  return [-toward[0], -toward[1], -toward[2]];
}

/** 把 DesertLight 写进 environment（原地改；传进来的应当是副本） */
export function applyDesertLight(env: UnitySceneDocument['environment'], light: DesertLight): void {
  env.fog = { ...env.fog, enabled: true, mode: 1, color: rgba(light.fog.color), start: light.fog.start, end: light.fog.end };
  env.ambient = {
    ...env.ambient, mode: 1, sky: rgba(light.ambient.sky), equator: rgba(light.ambient.equator), ground: rgba(light.ambient.ground),
    intensity: light.ambient.intensity ?? 1,
  };
  const s = light.sun;
  env.sun = {
    forward: sunForward(s.azimuth, s.elevation), color: rgba(s.color), intensity: s.intensity,
    shadows: env.sun?.shadows ?? 2, shadowStrength: s.shadowStrength ?? env.sun?.shadowStrength ?? 1,
  };
  const k = light.sky;
  // 换成渐变天球：去掉天空盒（UnityEnvironment.createSky 先看 cubemap），shader 名不是 Procedural 就走渐变
  env.sky = {
    name: 'DesertGradientSky', shader: 'Spiritfire/DesertGradientSky',
    colors: { _TopColor: rgba(k.top), _HorizonColor: rgba(k.horizon), _BottomColor: rgba(k.bottom), _SunColor: rgba(k.sun) },
    floats: {
      _HorizonSharpness: k.sharpness ?? 2.5, _HorizonGlow: k.horizonGlow ?? 0.4, _SunSize: k.sunSize ?? 0.0012,
      _SunHalo: k.sunHalo ?? 0.6, _Exposure: k.exposure ?? 1,
    },
    vectors: {},
  };
}

/** 文档的可改副本：会被改的部分都复制一层，导航网格这类只读的大数组共用 */
export function cloneForPatch(doc: UnitySceneDocument): UnitySceneDocument {
  return {
    ...doc,
    spawn: structuredClone(doc.spawn),
    environment: structuredClone(doc.environment),
    renderers: doc.renderers.map(r => ({ ...r, position: [...r.position], rotation: [...r.rotation], scale: [...r.scale] })),
    colliders: doc.colliders.map(c => ({ ...c })),
    encounters: structuredClone(doc.encounters),
    entries: doc.entries ? structuredClone(doc.entries) : doc.entries,
    heightfields: doc.heightfields.map(f => ({ ...f })),
    groundCover: doc.groundCover?.map(g => ({ ...g })),
  };
}

const PATCHED = new WeakSet<UnitySceneDocument>();

/** 这份文档是否已经过美术重建层改写 */
export function isDesertPatched(doc: UnitySceneDocument): boolean {
  return PATCHED.has(doc);
}

/** 按规格改写文档；没有规格原样返回。重复调用安全（已改写过的直接返回） */
export function patchDesertDocument(doc: UnitySceneDocument, art: DesertMapArt | null): UnitySceneDocument {
  if (!art || PATCHED.has(doc)) return doc;
  const out = cloneForPatch(doc);
  if (art.light) applyDesertLight(out.environment, art.light);
  art.patchDocument?.(out);
  PATCHED.add(out);
  return out;
}

/** 机关数据：天气的基础雾色 / 起止跟新光照走（天气每帧拿它写雾色），风向统一成规格里的那一个 */
export function patchDesertMechanisms(data: SceneMechanisms, art: DesertMapArt | null): SceneMechanisms {
  if (!art) return data;
  const out: SceneMechanisms = { ...data };
  if (data.weather) {
    const w = { ...data.weather, regions: data.weather.regions.map(r => ({ ...r })) };
    if (art.light) {
      w.baseFogColor = rgba(art.light.fog.color);
      w.baseFogStart = art.light.fog.start;
      w.baseFogEnd = art.light.fog.end;
    }
    w.windDir = [art.wind[0], art.wind[1]];
    if (art.windStrength !== undefined) w.baseWind = art.windStrength;
    out.weather = w;
  }
  art.patchMechanisms?.(out);
  return out;
}

// ───────────── 高度场 ─────────────

/** 解码高度场（0..1 归一化高度，世界高度 = origin.y + h × scale.y） */
export function decodeHeights(field: UnityHeightfield): Float32Array {
  const binary = atob(field.heights);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer.slice(0));
}

export function encodeHeights(heights: Float32Array): string {
  const bytes = new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/**
 * 逐格改高度场（世界单位）：fn(x, z, y) 返回新的世界高度（不改就原样返回 y）。改完写回 field.heights。
 * 只该用在可走范围之外（导航网格是 Unity 烘的，不会跟着变）：沙丘脊削尖、外圈抬起台地、远处补起伏。
 */
export function editHeights(field: UnityHeightfield, fn: (x: number, z: number, y: number) => number): void {
  const h = decodeHeights(field), n = field.resolution;
  const [ox, oy, oz] = field.origin, [sx, sy, sz] = field.scale;
  let changed = false;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix, y = oy + h[i] * sy;
      const ny = fn(ox + ix * sx, oz + iz * sz, y);
      if (ny !== y) {
        h[i] = Math.min(1, Math.max(0, (ny - oy) / sy));
        changed = true;
      }
    }
  }
  if (changed) field.heights = encodeHeights(h);
}

/** 文档里所有高度场的采样器（双线性，同 UnityHeightSampling） */
export function heightSampler(doc: UnitySceneDocument): (x: number, z: number) => number {
  const fields = doc.heightfields.map(f => ({ f, h: decodeHeights(f) }));
  return (x: number, z: number) => {
    let best = -Infinity;
    for (const { f, h } of fields) {
      const n = f.resolution;
      const fx = (x - f.origin[0]) / f.scale[0], fz = (z - f.origin[2]) / f.scale[2];
      if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) continue;
      const x0 = Math.floor(fx), z0 = Math.floor(fz), x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1);
      const tx = fx - x0, tz = fz - z0;
      const at = (ix: number, iz: number) => f.origin[1] + h[iz * n + ix] * f.scale[1];
      const a = at(x0, z0), b = at(x1, z0), c = at(x0, z1), d = at(x1, z1);
      const y = tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
      best = Math.max(best, y);
    }
    return best;
  };
}

// ───────────── 场景件 ─────────────

const matches = (value: string | undefined, m: string | RegExp): boolean => !!value && (typeof m === 'string' ? value === m || value.startsWith(`${m}/`) : m.test(value));

/** 删场景件：渲染件和同路径的碰撞体一起删（按 scenePath 前缀或正则；也匹配 name） */
export function removeParts(doc: UnitySceneDocument, m: string | RegExp): number {
  const hit = (x: { name: string; scenePath?: string }) => matches(x.scenePath, m) || matches(x.name, m);
  const before = doc.renderers.length;
  doc.renderers = doc.renderers.filter(r => !hit(r));
  doc.colliders = doc.colliders.filter(c => !hit(c));
  return before - doc.renderers.length;
}

/** 列出场景件（调试 / 写规格时用） */
export function findParts(doc: UnitySceneDocument, m: string | RegExp): UnitySceneDocument['renderers'] {
  return doc.renderers.filter(r => matches(r.scenePath, m) || matches(r.name, m));
}
