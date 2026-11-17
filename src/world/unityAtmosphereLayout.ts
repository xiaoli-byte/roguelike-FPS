import type { BirdFlock, LeafCrown, MoteBox } from './AirLife';
import type { MistKey, MistStream } from './MistStreams';

/**
 * Unity 导出场景的氛围摆位：雾带、贴水面的薄雾、落叶、鸟各摆在哪。按 docs/art/composition.md 第 8 节的规矩从这张图
 * 自己的数据里算出来（高度场、导航网格、遭遇点、水体、树的实例），再叠一张按地图编号的微调表（TUNING）——
 * 图改了重新导出，摆位跟着变；哪张图要加 / 减 / 手摆，改微调表。
 *
 * 规矩：
 *   外圈雾带  摆在「场地之外」：离可走范围 8–28 m 的崖脚（只在岩面前）、30–60 m 一圈薄的、80–125 m 一圈浓的
 *            （雾终点很远的大图再加 200–280 m 一圈）。
 *            每个方位上只在「从场地里看得见」的位置里挑（沿高度场查视线：遭遇场地正中、出生点、出口的人眼高度）：
 *            雾要有比它暗的背景才读得出来，所以先要岩面前的（陡坡：崖脚、台地脚下），再要背后是天或远处的（山口、豁口，
 *            雾在这儿把前后两层切开），最后才是贴在缓坡前的（沙 / 雪 / 草面，按章节打折，沙寺不要）；同一档里取最低的。
 *            沙丘背后看不见的洼地不摆。再只留这一圈里偏低的那几段，断断续续，不是一个环。雾在敌人身后，不在玩家和敌人之间。
 *   谷底雾    只有大图（场地半径 ≥ 220 m）：可走范围里最低的两成地面、避开所有遭遇点和出生点的地方，几条很薄的。
 *   水面      够大的静水（湖、泉、海子）铺一层贴水面的平雾；大湖中线上再浮一条半人高以下的低雾。河（一段段往下流的）不铺。
 *   落叶      只给落叶的树（落叶松、枫……，不给云杉 / 雪松），只挑遭遇场地边上和出生点附近的几棵。
 *   鸟        场地之外、出生点望过去的远处高空一小群；首领场和熔火章不放（火鸦是怪）。
 *   尘        不自动摆：要知道哪儿有光漏进来，在微调表里手给。
 *
 * 这个文件只有类型引用，纯数据进、纯数据出（node 里也能直接跑来检查）；建网格在 unityAtmosphereDressing.ts。
 */
export interface AtmosphereLayoutSource {
  id: string;
  spawn: { position: number[]; forward: number[] };
  heightfields?: { origin: number[]; scale: number[]; resolution: number; heights: string }[];
  navigation?: { vertices: number[][]; indices: number[] } | null;
  encounters?: { position: number[]; arenaRadius: number }[];
  bosses?: { center: number[]; radius: number }[];
  exits?: { position: number[] }[];
  water?: { name: string; center: number[]; scale: number[]; rotation: number[] }[];
  vegetation?: { prototypes: { name: string }[]; instances: { prototype: number; position: number[]; scale: number[] }[] } | null;
  environment?: { fog?: { mode: number; start: number; end: number } };
}

export interface UnityAtmosphereLayout {
  /** 场地外圈和谷底的雾带（先于水面画） */
  mist: MistStream[];
  /** 贴水面的雾（后于水面画） */
  waterMist: MistStream[];
  leaves: LeafCrown[];
  birds: BirdFlock[];
  motes: MoteBox[];
}

interface Tuning {
  /** 各圈雾带的不透明度倍率（由近到远：崖脚 / 内圈 / 外圈 / 最远一圈）；0 = 这一圈不要 */
  rings?: number[];
  /** 谷底雾的不透明度倍率；0 = 不要 */
  interior?: number;
  /** 水面雾的不透明度倍率；0 = 不要 */
  water?: number;
  /** false = 不放鸟 */
  birds?: boolean;
  /** 手摆的 */
  mist?: MistStream[];
  motes?: MoteBox[];
}

/** 按地图编号的微调。没列的图全用规矩算出来的 */
const TUNING: Record<string, Tuning> = {};

const CELL = 6;
const RINGS = [
  // 崖脚：紧贴场地外沿，只在岩面前（rockOnly）——围着场地的崖壁、台地脚下一条矮雾，把场地的地面和围墙切开
  { near: 8, far: 28, size: 22, halfWidth: 7, opacity: 0.62, speed: 0.75, rockOnly: true },
  { near: 26, far: 60, size: 34, halfWidth: 13, opacity: 0.66, speed: 0.7, rockOnly: false },
  { near: 80, far: 125, size: 60, halfWidth: 26, opacity: 0.8, speed: 0.55, rockOnly: false },
  { near: 200, far: 280, size: 100, halfWidth: 46, opacity: 0.85, speed: 0.45, rockOnly: false },
];
/** 谷底雾的雾团直径（检视页按这个数认它） */
export const INTERIOR_MIST_SIZE = 28;
/** 贴在缓坡前的雾（背后 80 m 内是沙 / 雪 / 草面）按章节打几折：沙寺沙色对沙色、霜山白对白，反差小，各留五成半 / 七成；熔火是烟对暗地，雪域是白雾对绿坡，都读得出来 */
const SLOPE_MIST: Record<number, number> = { 1: 0.55, 2: 0.7, 3: 1, 4: 1 };
/** 各章雾带的向阳偏置（MistStream.lit）：沙尘、雪雾要比沙地、雪面亮一档才读得出来；熔火的烟不提亮 */
const CHAPTER_LIT: Record<number, number> = { 1: 0.5, 2: 0.3, 3: 0, 4: 0.2 };
const LEAF_TREE = /larch|maple|birch|poplar|ginkgo/i;
/** 流水（一段段往下走，水面不是一个平面）：不铺水面雾 */
const FLOWING_WATER = /river|stream|creek|brook|waterfall/i;
const LEAF_COLORS: [RegExp, number][] = [[/gold/i, 0xd8a326], [/amber/i, 0xc47a1e], [/yellow/i, 0xdcc040], [/turning/i, 0xa9a23c], [/maple/i, 0xb5452a]];

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0;
}

export function unityAtmosphereLayout(doc: AtmosphereLayoutSource, wind: { x: number; z: number }): UnityAtmosphereLayout {
  const tuning = TUNING[doc.id] ?? {}, chapter = Number.parseInt(doc.id, 10) || 1;
  const layout: UnityAtmosphereLayout = { mist: [...(tuning.mist ?? [])], waterMist: [], leaves: [], birds: [], motes: [...(tuning.motes ?? [])] };
  const encounters = [
    ...(doc.encounters ?? []).map(e => ({ x: e.position[0], z: e.position[2], r: e.arenaRadius })),
    ...(doc.bosses ?? []).map(b => ({ x: b.center[0], z: b.center[2], r: b.radius })),
  ];
  const bossOnly = (doc.encounters?.length ?? 0) === 0 && (doc.bosses?.length ?? 0) > 0;
  /** 顺风排：雾团从路径的头走到尾，头在上风 */
  const downwind = (keys: MistKey[]): MistKey[] => {
    const a = keys[0].position, b = keys[keys.length - 1].position;
    return (b[0] - a[0]) * wind.x + (b[2] - a[2]) * wind.z < 0 ? keys.reverse() : keys;
  };
  const fade = (keys: MistKey[]): MistKey[] => {
    keys[0].opacity = 0;
    keys[keys.length - 1].opacity = 0;
    return keys;
  };

  // ───────────── 高度场 + 可走范围的栅格 ─────────────
  const fields = (doc.heightfields ?? []).map(field => {
    const binary = atob(field.heights), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const span = (field.resolution - 1);
    return { ox: field.origin[0], oy: field.origin[1], oz: field.origin[2], sx: field.scale[0], sy: field.scale[1], sz: field.scale[2], n: field.resolution, w: field.scale[0] * span, d: field.scale[2] * span, heights: new Float32Array(bytes.buffer) };
  });
  const heightAt = (x: number, z: number): number => {
    for (const f of fields) {
      const fx = (x - f.ox) / f.sx, fz = (z - f.oz) / f.sz;
      if (fx < 0 || fz < 0 || fx > f.n - 1 || fz > f.n - 1) continue;
      const x0 = Math.min(f.n - 2, Math.floor(fx)), z0 = Math.min(f.n - 2, Math.floor(fz)), tx = fx - x0, tz = fz - z0, i = z0 * f.n + x0;
      const top = f.heights[i] + (f.heights[i + 1] - f.heights[i]) * tx, bottom = f.heights[i + f.n] + (f.heights[i + f.n + 1] - f.heights[i + f.n]) * tx;
      return f.oy + (top + (bottom - top) * tz) * f.sy;
    }
    return Number.NaN;
  };
  const nav = doc.navigation?.vertices ?? [], tris = doc.navigation?.indices ?? [];
  const navHeights = nav.map(v => v[1]).sort((a, b) => a - b);

  if (fields.length && nav.length) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const f of fields) { x0 = Math.min(x0, f.ox); z0 = Math.min(z0, f.oz); x1 = Math.max(x1, f.ox + f.w); z1 = Math.max(z1, f.oz + f.d); }
    const W = Math.max(1, Math.ceil((x1 - x0) / CELL)), H = Math.max(1, Math.ceil((z1 - z0) / CELL));
    const cx = (i: number): number => x0 + (i + 0.5) * CELL, cz = (j: number): number => z0 + (j + 0.5) * CELL;
    const height = new Float32Array(W * H), walk = new Uint8Array(W * H), dist = new Float32Array(W * H).fill(1e9);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) height[j * W + i] = heightAt(cx(i), cz(j));
    const mark = (x: number, z: number): void => {
      const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL);
      if (i >= 0 && j >= 0 && i < W && j < H) walk[j * W + i] = 1;
    };
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = nav[tris[t]], b = nav[tris[t + 1]], c = nav[tris[t + 2]];
      mark(a[0], a[2]); mark(b[0], b[2]); mark(c[0], c[2]);
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - x0) / CELL)), i1 = Math.min(W - 1, Math.floor((Math.max(a[0], b[0], c[0]) - x0) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - z0) / CELL)), j1 = Math.min(H - 1, Math.floor((Math.max(a[2], b[2], c[2]) - z0) / CELL));
      if (i1 - i0 < 1 && j1 - j0 < 1) continue;
      const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(den) < 1e-9) continue;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = cx(i) - c[0], pz = cz(j) - c[2];
        const u = ((b[2] - c[2]) * px + (c[0] - b[0]) * pz) / den, v = ((c[2] - a[2]) * px + (a[0] - c[0]) * pz) / den;
        if (u >= 0 && v >= 0 && u + v <= 1) walk[j * W + i] = 1;
      }
    }
    // 到可走范围的距离（两遍 chamfer）
    let sumX = 0, sumZ = 0, count = 0;
    for (let k = 0; k < W * H; k++) if (walk[k]) { dist[k] = 0; sumX += cx(k % W); sumZ += cz(Math.floor(k / W)); count++; }
    const relax = (k: number, i: number, j: number, di: number, dj: number, cost: number): void => {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) return;
      const d = dist[nj * W + ni] + cost;
      if (d < dist[k]) dist[k] = d;
    };
    const diagonal = CELL * Math.SQRT2;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; relax(k, i, j, -1, 0, CELL); relax(k, i, j, 0, -1, CELL); relax(k, i, j, -1, -1, diagonal); relax(k, i, j, 1, -1, diagonal); }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) { const k = j * W + i; relax(k, i, j, 1, 0, CELL); relax(k, i, j, 0, 1, CELL); relax(k, i, j, 1, 1, diagonal); relax(k, i, j, -1, 1, diagonal); }
    const centerX = sumX / Math.max(1, count), centerZ = sumZ / Math.max(1, count);
    let radius = 0;
    for (let k = 0; k < W * H; k++) if (walk[k]) radius = Math.max(radius, Math.hypot(cx(k % W) - centerX, cz(Math.floor(k / W)) - centerZ));
    const clearOf = (x: number, z: number, margin: number): boolean => encounters.every(e => Math.hypot(x - e.x, z - e.z) > e.r + margin);

    // ───────────── 外圈雾带 ─────────────
    const fogEnd = doc.environment?.fog?.mode === 1 ? doc.environment.fog.end : 400;
    // 从哪儿看：各遭遇场地正中、出生点、出口，人眼高度。雾带只摆在至少一处看得见的地方——沙丘背后的洼地再低也不摆
    const eyes = [...encounters.map(e => [e.x, e.z]), [doc.spawn.position[0], doc.spawn.position[2]], ...(doc.exits ?? []).map(e => [e.position[0], e.position[2]])]
      .map(([x, z]) => ({ x, z, y: heightAt(x, z) + 1.7 })).filter(eye => !Number.isNaN(eye.y));
    const sightRange = fogEnd * 0.95;
    // 陡的地方（31° 以上）当作岩面：台地、崖壁、冰壁——比雾暗、有颜色，雾贴在它前面读得出来；缓坡是沙、雪、草
    const steep = new Uint8Array(W * H);
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
      const k = j * W + i, h = height[k];
      if (Math.max(Math.abs(height[k - 1] - h), Math.abs(height[k + 1] - h), Math.abs(height[k - W] - h), Math.abs(height[k + W] - h)) > CELL * 0.6) steep[k] = 1;
    }
    /**
     * 从场地里看 (x, y, z)，沿视线每一格查一次地形高度：
     *   0 哪儿都看不见（沙丘背后的洼地）；1 看得见，背后 80 m 内是缓坡（沙 / 雪 / 草面）；
     *   2 看得见，背后是天或远处（山口、豁口）；3 看得见，背后 80 m 内是岩面（崖脚、台地脚下）——反差最大。
     */
    const seenFrom = (x: number, y: number, z: number): number => {
      let best = 0;
      for (const eye of eyes) {
        const dx = x - eye.x, dz = z - eye.z, length = Math.hypot(dx, dz);
        if (length > sightRange || length < 1) continue;
        const steps = Math.ceil(length / CELL), beyond = steps + Math.ceil(80 / CELL);
        let grade = 2;
        for (let s = 1; s <= beyond; s++) {
          if (s === steps) continue;
          const t = s / steps, i = Math.floor((eye.x + dx * t - x0) / CELL), j = Math.floor((eye.z + dz * t - z0) / CELL);
          if (i < 0 || j < 0 || i >= W || j >= H) {
            if (s > steps) break; // 视线出了高度场也没碰到地形：背后是远景
            continue;
          }
          if (height[j * W + i] > eye.y + (y - eye.y) * t - 0.3) {
            grade = s < steps ? 0 : steep[j * W + i] ? 3 : 1;
            break;
          }
        }
        if (grade === 3) return 3;
        if (grade > best) best = grade;
      }
      return best;
    };
    RINGS.forEach((ring, r) => {
      const gain = tuning.rings?.[r] ?? 1;
      if (gain <= 0 || (r === 3 && fogEnd < 900)) return;
      const bins = Math.min(96, Math.max(24, Math.round(2 * Math.PI * (radius * 0.7 + (ring.near + ring.far) / 2) / 18)));
      const low: ({ x: number; y: number; z: number; grade: number } | null)[] = new Array(bins).fill(null), reach = new Float32Array(bins);
      const slope = SLOPE_MIST[chapter] ?? 1, lit = CHAPTER_LIT[chapter] ?? 0;
      for (let k = 0; k < W * H; k++) {
        const d = dist[k], h = height[k], i = k % W, j = Math.floor(k / W);
        // 高度场最外面两格不要：那里是地形和远景地面的接缝，沿着它摆出来是一条直线
        if (d < ring.near || d > ring.far || Number.isNaN(h) || i < 2 || j < 2 || i >= W - 2 || j >= H - 2) continue;
        const x = cx(i), z = cz(j);
        const bin = Math.floor((Math.atan2(z - centerZ, x - centerX) / (2 * Math.PI) + 0.5) * bins) % bins;
        if (d > reach[bin]) reach[bin] = d;
        const best = low[bin];
        if (best && best.grade === 3 && h >= best.y) continue;
        // 先要岩面前的，再要背后是天 / 远处的，最后才是缓坡前的（沙寺不要：沙色的雾贴在沙坡前读不出来）；同一档里取最低的
        const grade = seenFrom(x, h + ring.size * 0.3 + 0.5, z);
        if (grade === 0 || (grade === 1 && slope <= 0) || (ring.rockOnly && grade !== 3)) continue;
        if (!best || grade > best.grade || (grade === best.grade && h < best.y)) low[bin] = { x, y: h, z, grade };
      }
      // 这个方位上高度场没伸到这一圈的外沿：圈被地形边界切掉了，剩下的只是贴着边界的一条直线，不要
      for (let bin = 0; bin < bins; bin++) if (reach[bin] < ring.near + (ring.far - ring.near) * 0.6) low[bin] = null;
      const known = low.filter(Boolean).map(p => p!.y).sort((a, b) => a - b);
      if (known.length < 3) return;
      const limit = percentile(known, 0.8) + 3;
      // 只留低处；最里一圈再让开遭遇场地
      const keep = low.map(p => p !== null && p.y <= limit && (r > 1 || clearOf(p.x, p.z, r === 0 ? 4 : 14)));
      const start = keep.indexOf(false);
      const order = Array.from({ length: bins }, (_, i) => (i + Math.max(0, start)) % bins);
      let run: number[] = [];
      const flush = (): void => {
        // 太长的一段切开，中间留一个缺口：一圈雾是断断续续的几段，不是一个环
        for (let at = 0; at < run.length; at += 10) {
          const part = run.slice(at, at + 9);
          // 太短的一小段只是孤零零的一团，不要
          if (part.length < 4) continue;
          const keys = part.map((bin): MistKey => {
            const p = low[bin]!, q = low[(bin + 1) % bins] ?? p, o = low[(bin + bins - 1) % bins] ?? p;
            // 前后各抹一下：取每个方位最低点连成的线是锯齿的
            // 背后是天的那几处抬高一点，雾团一半露在天际线上面
            return { position: [(o.x + 2 * p.x + q.x) / 4, (o.y + 2 * p.y + q.y) / 4 + ring.size * (p.grade === 2 ? 0.45 : 0.3) + 0.5, (o.z + 2 * p.z + q.z) / 4], halfWidth: ring.halfWidth, size: ring.size, opacity: p.grade === 1 ? slope : 1 };
          });
          let length = 0;
          for (let i = 1; i < keys.length; i++) length += Math.hypot(keys[i].position[0] - keys[i - 1].position[0], keys[i].position[2] - keys[i - 1].position[2]);
          // 雾团只比默认略多：浓度靠不透明度，不靠叠得多（大雾团叠多了填充太贵）
          const count = Math.round(Math.min(96, Math.max(8, 1.75 * (length / ring.size) * (1 + ring.halfWidth / ring.size))));
          layout.mist.push({ keys: fade(downwind(keys)), opacity: ring.opacity * gain, speed: ring.speed, lit, count });
        }
        run = [];
      };
      for (const bin of order) {
        if (keep[bin]) run.push(bin);
        else flush();
      }
      flush();
    });

    // ───────────── 谷底雾（大图） ─────────────
    const interior = tuning.interior ?? 1;
    if (radius >= 220 && interior > 0) {
      const floor = percentile(navHeights, 0.2) + 3, spawnX = doc.spawn.position[0], spawnZ = doc.spawn.position[2];
      const seen = new Uint8Array(W * H), patches: number[][] = [];
      const fits = (k: number): boolean => dist[k] <= 12 && height[k] <= floor && clearOf(cx(k % W), cz(Math.floor(k / W)), 30) && Math.hypot(cx(k % W) - spawnX, cz(Math.floor(k / W)) - spawnZ) > 50;
      for (let k = 0; k < W * H; k++) {
        if (seen[k] || !fits(k)) continue;
        const patch: number[] = [], stack = [k];
        seen[k] = 1;
        while (stack.length) {
          const c = stack.pop()!, i = c % W, j = Math.floor(c / W);
          patch.push(c);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ni = i + di, nj = j + dj, n = nj * W + ni;
            if (ni < 0 || nj < 0 || ni >= W || nj >= H || seen[n] || !fits(n)) continue;
            seen[n] = 1;
            stack.push(n);
          }
        }
        if (patch.length >= 40) patches.push(patch);
      }
      patches.sort((a, b) => b.length - a.length);
      for (const patch of patches.slice(0, 4)) {
        // 顺着这片低地的长轴摆一条（主成分方向），顺风
        let mx = 0, mz = 0;
        for (const c of patch) { mx += cx(c % W); mz += cz(Math.floor(c / W)); }
        mx /= patch.length; mz /= patch.length;
        let sxx = 0, szz = 0, sxz = 0;
        for (const c of patch) { const dx = cx(c % W) - mx, dz = cz(Math.floor(c / W)) - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
        const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
        let ax = Math.cos(angle), az = Math.sin(angle);
        if (ax * wind.x + az * wind.z < 0) { ax = -ax; az = -az; }
        let lo = 0, hi = 0, across = 0;
        for (const c of patch) {
          const dx = cx(c % W) - mx, dz = cz(Math.floor(c / W)) - mz, along = dx * ax + dz * az;
          lo = Math.min(lo, along); hi = Math.max(hi, along); across += Math.abs(dz * ax - dx * az);
        }
        lo = Math.max(lo, -110); hi = Math.min(hi, 110);
        if (hi - lo < 50) continue;
        const heights = patch.map(c => height[c]).sort((a, b) => a - b), size = INTERIOR_MIST_SIZE;
        const keys = [0, 0.15, 0.5, 0.85, 1].map((t): MistKey => {
          const along = lo + (hi - lo) * t, x = mx + ax * along, z = mz + az * along, ground = heightAt(x, z);
          return { position: [x, (Number.isNaN(ground) ? percentile(heights, 0.5) : Math.max(ground, percentile(heights, 0.3))) + size * 0.2 + 0.5, z], halfWidth: Math.min(26, Math.max(10, across / patch.length * 1.6)), size };
        });
        layout.mist.push({ keys: fade(keys), opacity: 0.34 * interior, speed: 0.6, torn: 0.05, lit: CHAPTER_LIT[chapter] ?? 0 });
      }
    }

    // ───────────── 鸟 ─────────────
    if (tuning.birds !== false && chapter !== 3 && !bossOnly) {
      let nx = centerX - doc.spawn.position[0], nz = centerZ - doc.spawn.position[2];
      if (Math.hypot(nx, nz) < 20) { nx = doc.spawn.forward[0]; nz = doc.spawn.forward[2]; }
      const length = Math.hypot(nx, nz) || 1, top = percentile(navHeights, 0.95);
      nx /= length; nz /= length;
      const reach = radius * 0.6 + 140, lift = chapter === 4 ? 110 : chapter === 2 ? 85 : 70;
      layout.birds.push({ center: [centerX + nx * reach, top + lift, centerZ + nz * reach], radius: 62, count: chapter === 4 ? 7 : 5, speed: chapter === 1 ? 7 : 9 });
      // 高原再来一群，在另一侧更远处
      if (chapter === 4) layout.birds.push({ center: [centerX - nz * (reach + 80), top + lift + 40, centerZ + nx * (reach + 80)], radius: 85, count: 5 });
    }
  }

  // ───────────── 水面 ─────────────
  const waterGain = tuning.water ?? 1;
  if (waterGain > 0 && doc.water?.length) {
    // 挨在一起、水面一样高的小块并成一片（月牙泉是 22 条拼的）；水面一段段往下走的是河，不铺
    const pieces = doc.water.filter(w => !FLOWING_WATER.test(w.name)).map(w => ({ x: w.center[0], z: w.center[2], y: w.center[1] + w.scale[1] * 0.5, a: w.scale[0] * 0.5, b: w.scale[2] * 0.5, yaw: 2 * Math.atan2(w.rotation[1], w.rotation[3]), group: -1 }));
    let groups = 0;
    for (const piece of pieces) {
      if (piece.group >= 0) continue;
      const stack = [piece];
      piece.group = groups;
      while (stack.length) {
        const p = stack.pop()!;
        for (const q of pieces) {
          if (q.group >= 0 || Math.abs(q.y - p.y) > 0.35 || Math.hypot(q.x - p.x, q.z - p.z) > Math.max(p.a, p.b) + Math.max(q.a, q.b) + 1) continue;
          q.group = groups;
          stack.push(q);
        }
      }
      groups++;
    }
    const px = -wind.z, pz = wind.x;
    for (let g = 0; g < groups; g++) {
      const body = pieces.filter(p => p.group === g);
      let alongLo = Infinity, alongHi = -Infinity, sideLo = Infinity, sideHi = -Infinity, area = 0;
      for (const p of body) {
        const ux = Math.cos(p.yaw), uz = -Math.sin(p.yaw), vx = Math.sin(p.yaw), vz = Math.cos(p.yaw);
        const along = p.a * Math.abs(ux * wind.x + uz * wind.z) + p.b * Math.abs(vx * wind.x + vz * wind.z), side = p.a * Math.abs(ux * px + uz * pz) + p.b * Math.abs(vx * px + vz * pz);
        const ca = p.x * wind.x + p.z * wind.z, cs = p.x * px + p.z * pz;
        alongLo = Math.min(alongLo, ca - along); alongHi = Math.max(alongHi, ca + along); sideLo = Math.min(sideLo, cs - side); sideHi = Math.max(sideHi, cs + side);
        area += 4 * p.a * p.b;
      }
      const length = alongHi - alongLo, width = sideHi - sideLo, surface = body[0].y;
      // 河的一段段水面也可能一样高：看这一片填满自己的外接矩形多少（试四个朝向取最紧的），沿河道排开的填不满
      let box = Infinity;
      for (let turn = 0; turn < 4; turn++) {
        const c = Math.cos(turn * Math.PI / 8), n = Math.sin(turn * Math.PI / 8);
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const p of body) {
          const reach = Math.hypot(p.a, p.b), u = p.x * c + p.z * n, v = p.z * c - p.x * n;
          u0 = Math.min(u0, u - reach); u1 = Math.max(u1, u + reach); v0 = Math.min(v0, v - reach); v1 = Math.max(v1, v + reach);
        }
        box = Math.min(box, (u1 - u0) * (v1 - v0));
      }
      if (area < 300 || Math.min(length, width) < 14 || area / box < 0.3) continue;
      const lanes = Math.max(1, Math.ceil(width * 0.8 / 110)), lane = width * 0.8 / lanes, size = Math.min(20, Math.max(7, lane * 0.3));
      const at = (along: number, side: number, y: number): [number, number, number] => [wind.x * along + px * side, y, wind.z * along + pz * side];
      for (let l = 0; l < lanes; l++) {
        const side = (sideLo + sideHi) / 2 + (l - (lanes - 1) / 2) * lane;
        const keys = [0, 0.14, 0.5, 0.86, 1].map((t): MistKey => ({ position: at(alongLo + length * t, side, surface + 0.14), halfWidth: lane * 0.5, size }));
        // 平铺在水面上：出了水岸的那部分在地面以下，被地形挡掉
        layout.waterMist.push({ keys: fade(keys), flat: true, opacity: 0.3 * waterGain, speed: 0.45, stretch: 1.6, torn: 0.04, count: Math.round(Math.min(64, Math.max(10, length * lane / (size * size * 1.4)))) });
      }
      // 大湖：中线上再浮一条低雾（顶到半人高以下的不算遮挡，这条在膝盖到胸口，只给够宽的水面，离岸远）
      if (Math.min(length, width) >= 60) {
        const keys = [0, 0.16, 0.5, 0.84, 1].map((t): MistKey => ({ position: at(alongLo + length * (0.08 + 0.84 * t), (sideLo + sideHi) / 2, surface + 2.2), halfWidth: width * 0.26, size: 16, halfHeight: 0.8 }));
        layout.waterMist.push({ keys: fade(keys), opacity: 0.3 * waterGain, speed: 0.5, stretch: 1.8, floorY: surface, soft: 3 });
      }
    }
  }

  // ───────────── 落叶 ─────────────
  const vegetation = doc.vegetation;
  if (vegetation?.instances.length) {
    const sheds = vegetation.prototypes.map(p => LEAF_TREE.test(p.name));
    const trees = vegetation.instances.filter(t => sheds[t.prototype]);
    if (trees.length) {
      const spots = [
        ...(doc.encounters ?? []).map(e => ({ x: e.position[0], z: e.position[2], r: e.arenaRadius, take: 4 })),
        { x: doc.spawn.position[0], z: doc.spawn.position[2], r: 14, take: 3 },
        ...(doc.exits ?? []).map(e => ({ x: e.position[0], z: e.position[2], r: 12, take: 2 })),
      ];
      const chosen: typeof trees = [];
      for (const spot of spots) {
        // 场地边上的那几棵：不在场地正中，也不离得太远
        const near = trees
          .map(tree => ({ tree, d: Math.hypot(tree.position[0] - spot.x, tree.position[2] - spot.z) }))
          .filter(item => item.d >= Math.max(8, spot.r * 0.55) && item.d <= spot.r + 22)
          .sort((a, b) => Math.abs(a.d - spot.r) - Math.abs(b.d - spot.r));
        let taken = 0;
        for (const { tree } of near) {
          if (taken >= spot.take || chosen.length >= 32) break;
          if (chosen.some(other => Math.hypot(other.position[0] - tree.position[0], other.position[2] - tree.position[2]) < 7)) continue;
          chosen.push(tree);
          taken++;
        }
      }
      for (const tree of chosen) {
        const name = vegetation.prototypes[tree.prototype].name;
        // 这批树高约 19.6 m、冠半径约 3.2 m（模型包围盒）：叶子从树身中段往下掉
        layout.leaves.push({
          position: [tree.position[0], tree.position[1] + 11 * tree.scale[1], tree.position[2]], radius: 2.6 * tree.scale[0], ground: tree.position[1] + 0.1, count: 9,
          color: LEAF_COLORS.find(([pattern]) => pattern.test(name))?.[1] ?? 0xb5452a,
        });
      }
    }
  }
  return layout;
}
