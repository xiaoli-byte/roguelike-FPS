/**
 * 看效果的工具箱（docs/art/reference-tingyuyuan.md 第四节第 10 项「流程工具」）：精致是查出来、改出来的。
 * 三张高原检视页和材质样板页（matboardLab.ts）共用；脚本 scripts/plateau/lookdev.mjs 通过调试入口的 lookdev 调它们。
 *
 *  - 逐项开关（LookSwitch）：出图后期的每一层、柔光、天空可见度 AO、地表混层、交界、淋湿、雨、雾、阴影、云影……
 *    面板上一项一项勾掉看是谁（查回归、找根因）；网址开关（post=0、ao=0……）照旧能用，这里是运行时的。
 *  - 分项计时（profileSwitches）：全开一帧的 GPU 毫秒数，再逐项关掉各测一次，差值就是这一项的开销（没有计时扩展时退回 CPU + 同步）。
 *  - 闪点检测（findFireflies）：镜头在半个像素里抖几下连拍，逐像素算亮度的方差——孤立的一个亮点一闪一闪的标红（闪点：高光、
 *    远处的小亮东西），成线的（细线、剪影边在爬）标黄（边缘 / 细线闪烁）；给出占比和最集中的几块，叠在画面上出一张图。
 *  - 着色器预热（warmLook）：进图时把场景里所有材质的着色器先编好（compileAsync，能并行编的并行编），再空跑一帧后期，
 *    转身第一眼看到新东西时不再卡一下。网址 warm=0 关掉（对照用）。
 */
import * as THREE from 'three';
import { WORLD_UNIFORMS } from './materials';

export interface LookSwitch {
  id: string;
  label: string;
  get(): boolean;
  set(on: boolean): void;
}

/** 出图后期（FilmPost）里开关要用到的那部分 */
interface FilmLike {
  enabled: boolean;
  readonly flags: { bloom: boolean; lut: boolean; ae: boolean; grain: boolean; ca: boolean; vignette: boolean };
}

export interface LookContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  film: FilmLike;
  /** 雨（rain.ts）：关掉就不画 */
  rain?: { enabled: boolean };
  /** 这一页自己的开关（柔光、草……），排在通用开关后面 */
  extra?: LookSwitch[];
}

const uniformSwitch = (id: string, label: string, key: keyof typeof WORLD_UNIFORMS): LookSwitch => ({
  id, label,
  get: () => (WORLD_UNIFORMS[key].value as number) > 0.5,
  set: on => { WORLD_UNIFORMS[key].value = on ? 1 : 0; },
});

/** 一页的全部开关：后期各层 → 光 → 材质 → 天气 → 这一页自己的 */
export function buildLookSwitches(ctx: LookContext): LookSwitch[] {
  const { film, scene, renderer } = ctx;
  const flag = (id: string, label: string, k: keyof FilmLike['flags']): LookSwitch => ({ id, label, get: () => film.flags[k], set: on => { film.flags[k] = on; } });
  let fog: THREE.Fog | THREE.FogExp2 | null = scene.fog;
  const list: LookSwitch[] = [
    { id: 'post', label: '出图后期（整套）', get: () => film.enabled, set: on => { film.enabled = on; } },
    flag('bloom', '泛光', 'bloom'),
    flag('lut', '调色 LUT', 'lut'),
    flag('ae', '自动曝光', 'ae'),
    flag('grain', '颗粒', 'grain'),
    flag('ca', '边角色差', 'ca'),
    flag('vig', '暗角', 'vignette'),
    {
      id: 'shadow', label: '阴影',
      get: () => renderer.shadowMap.enabled,
      set: on => {
        if (renderer.shadowMap.enabled === on) return;
        renderer.shadowMap.enabled = on;
        scene.traverse(o => {   // 阴影开关改了着色器的定义，材质要重编
          const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(m)) m.forEach(x => { x.needsUpdate = true; }); else if (m) m.needsUpdate = true;
        });
      },
    },
    uniformSwitch('ao', '天空可见度 AO', 'uSkyAo'),
    uniformSwitch('cloud', '云影', 'uCloudOn'),
    uniformSwitch('ground', '地表混层', 'uGroundOn'),
    uniformSwitch('contact', '交界（湿暗带 / 苔圈）', 'uContactOn'),
    uniformSwitch('wet', '淋湿 / 积水', 'uWetOn'),
    {
      id: 'fog', label: '雾',
      get: () => scene.fog !== null,
      set: on => { if (on) { if (!scene.fog) scene.fog = fog; } else if (scene.fog) { fog = scene.fog; scene.fog = null; } },
    },
  ];
  const pebbles = scene.getObjectByName('contact-pebbles');
  if (pebbles) list.push({ id: 'pebbles', label: '交界碎石', get: () => pebbles.visible, set: on => { pebbles.visible = on; } });
  if (ctx.rain) {
    const rain = ctx.rain;
    list.push({ id: 'rain', label: '雨（雨丝 / 雨幕 / 水花）', get: () => rain.enabled, set: on => { rain.enabled = on; } });
  }
  return [...list, ...(ctx.extra ?? [])];
}

// ───────────────────────────── 面板 ─────────────────────────────

/**
 * 在检视页面板里加一节「逐项开关」：每项一个勾选框，外加「测开销」「找闪点」两个按钮（结果写在下面）。
 * render：画一帧（不推进时间）；camera：找闪点时抖的镜头。
 */
export function mountLookPanel(parent: HTMLElement, switches: LookSwitch[], tools: { render: () => void; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; film?: FilmLike }): void {
  const h = document.createElement('h2');
  h.textContent = '逐项开关（查回归 / 看开销）';
  const box = document.createElement('div');
  const inputs: [LookSwitch, HTMLInputElement][] = [];
  for (const s of switches) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.get();
    cb.onchange = () => { s.set(cb.checked); sync(); };
    label.append(cb, ` ${s.label}`);
    box.appendChild(label);
    inputs.push([s, cb]);
  }
  const sync = (): void => { for (const [s, cb] of inputs) cb.checked = s.get(); };
  const out = document.createElement('div');
  out.className = 'row';
  const bProf = document.createElement('button');
  bProf.textContent = '测开销';
  bProf.onclick = async () => {
    out.textContent = '测量中…（画面会卡几秒）';
    const r = await profileSwitches(tools.renderer, tools.render, switches);
    sync();
    const head = `整帧 ${r.base.toFixed(2)} ms（${r.width}×${r.height}，${r.method === 'gpu' ? 'GPU 计时' : 'CPU + 同步，偏大'}，噪声 ±${r.noise.toFixed(2)}）`;
    const lines = [...r.rows].sort((a, b) => b.delta - a.delta).map(x => `${x.label}　${Math.abs(x.delta) <= r.noise ? '≈0' : `${x.delta.toFixed(2)} ms`}`);
    out.textContent = [head, ...lines].join('\n');
  };
  const bFly = document.createElement('button');
  bFly.textContent = '找闪点';
  bFly.onclick = () => {
    const r = findFireflies(tools.render, tools.camera, tools.renderer.domElement, { film: tools.film });
    out.textContent = `闪点 ${(r.sparkleRatio * 100).toFixed(3)}%（${r.sparkle} 个像素，红）　边缘 / 细线闪烁 ${(r.shimmerRatio * 100).toFixed(2)}%（黄）\n最集中：${r.hot.slice(0, 3).map(c => `(${c.x},${c.y}) ${c.n}`).join('　') || '无'}`;
    const img = new Image();
    img.src = r.overlay;
    img.style.cssText = 'width:100%;margin-top:4px;border:1px solid #4d6170;cursor:pointer';
    img.title = '点开看大图';
    img.onclick = () => window.open(r.overlay);
    out.appendChild(img);
  };
  parent.append(h, box, bProf, bFly, out);
}

// ───────────────────────────── 分项计时 ─────────────────────────────

export interface SwitchCost { id: string; label: string; ms: number; delta: number }

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

/** 一次计时：frames 帧包在一个计时查询里。有 GPU 计时扩展时返回查询（结果之后再读）；没有就 CPU 计时 + 读像素同步、直接返回毫秒/帧 */
function issueTiming(gl: WebGL2RenderingContext, ext: TimerExt | null, render: () => void, frames: number): WebGLQuery | number {
  if (ext) {
    const q = gl.createQuery()!;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    for (let i = 0; i < frames; i++) render();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    return q;
  }
  const px = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) render();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return (performance.now() - t0) / frames;
}

/**
 * 每一项开着比关着多花几毫秒：开 / 关交替测 rounds 轮（每次 frames 帧包在一个计时查询里），差值取中位数。
 * 全部查询一口气同步发完（中间不 await，主循环插不进来；页面会卡几秒），最后统一读结果——交替着测才压得住 GPU 升降频。
 * noise = 全开那些次测量的离散度（中位绝对偏差 × 1.5），|delta| 不比它大的当作 0。测完恢复原状。base = 全开一帧的毫秒数。
 *
 * 测的时候把渲染分辨率临时放大 pixelScale 倍（缺省 2：像素 ×4，1080p → 4K）：这几张图每帧七百多次绘制，平时是 CPU 慢、显卡空等，
 * GPU 计时量到的其实是 CPU 的节奏（实测噪声 ±0.7 ms，每一项都淹在里面）；放大以后显卡成了瓶颈，量到的才是显卡的开销。
 * width / height = 测的时候的像素尺寸。
 */
export async function profileSwitches(renderer: THREE.WebGLRenderer, render: () => void, switches: LookSwitch[], frames = 12, rounds = 7, pixelScale = 2): Promise<{ base: number; noise: number; method: 'gpu' | 'cpu'; width: number; height: number; rows: SwitchCost[] }> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  const was = switches.map(s => s.get());
  const ratio = renderer.getPixelRatio();
  renderer.setPixelRatio(ratio * pixelScale);
  const width = renderer.domElement.width, height = renderer.domElement.height;
  try {
  const med = (a: number[]): number => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
  // 先把每一项关掉以后的变体编好、热身
  for (const [i, s] of switches.entries()) if (was[i]) { s.set(false); render(); s.set(true); render(); }
  render(); render();
  const plan: { i: number; on: WebGLQuery | number; off: WebGLQuery | number }[] = [];
  for (let r = 0; r < rounds; r++) for (const [i, s] of switches.entries()) {
    if (!was[i]) continue;
    const on = issueTiming(gl, ext, render, frames);
    s.set(false); render();
    const off = issueTiming(gl, ext, render, frames);
    s.set(true); render();
    plan.push({ i, on, off });
  }
  switches.forEach((s, i) => { if (s.get() !== was[i]) s.set(was[i]); });
  renderer.setPixelRatio(ratio);
  const read = async (q: WebGLQuery | number): Promise<number> => {
    if (typeof q === 'number') return q;
    for (let t = 0; t < 400 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); t++) await new Promise(res => setTimeout(res, 5));
    const v = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ? (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6 / frames : NaN;
    gl.deleteQuery(q);
    return v;
  };
  const disjoint = ext ? gl.getParameter(ext.GPU_DISJOINT_EXT) : false;
  const bases: number[] = [];
  const per = new Map<number, { off: number[]; diff: number[] }>();
  for (const p of plan) {
    const a = await read(p.on), b = await read(p.off);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    bases.push(a);
    const e = per.get(p.i) ?? { off: [], diff: [] };
    e.off.push(b); e.diff.push(a - b);
    per.set(p.i, e);
  }
  const rows: SwitchCost[] = [...per.entries()].map(([i, e]) => ({ id: switches[i].id, label: switches[i].label, ms: med(e.off), delta: med(e.diff) }));
  const base = bases.length ? med(bases) : 0;
  const noise = bases.length ? med(bases.map(x => Math.abs(x - base))) * 1.5 : 0;
  if (disjoint) console.warn('[lookdev] 计时期间 GPU 断档（disjoint），这一轮的数不可信');
  return { base, noise, method: ext ? 'gpu' : 'cpu', width, height, rows };
  } finally {
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    render();
  }
}

/**
 * 定格出图：把时间（uTime）定在同一刻画一帧，直接从画布取图（JPEG dataURL，不带面板 / HUD）。
 * 雨丝、水纹、经幡都停在同一刻，同一机位每轮出的图逐像素可比（逐项开关对照、逐轮对比用）。
 */
export function snapshot(render: () => void, canvas: HTMLCanvasElement, opts: { time?: number; quality?: number } = {}): string {
  const u = WORLD_UNIFORMS.uTime, prev = u.value;
  u.value = opts.time ?? 10;
  try {
    render(); render();
    return canvas.toDataURL('image/jpeg', opts.quality ?? 0.9);
  } finally {
    u.value = prev;
  }
}

// ───────────────────────────── 闪点检测 ─────────────────────────────

export interface FireflyReport {
  frames: number;
  width: number;
  height: number;
  /** 孤立的一个亮点、一抖就闪（红）：高光、远处的小亮东西 */
  sparkle: number;
  /** 成线的：细线（经幡、绳子）、剪影边在爬（黄） */
  shimmer: number;
  sparkleRatio: number;
  shimmerRatio: number;
  /** 闪得最集中的 32 像素格（左上角像素坐标、格内个数），多到少 */
  hot: { x: number; y: number; n: number }[];
  /** 叠了红黄标记的画面（JPEG dataURL） */
  overlay: string;
}

/**
 * 镜头在半个像素里按 Halton 序列抖 frames 次连拍（时间不动；颗粒先关掉），逐像素算亮度的均值、方差、最亮值：
 * 方差大、而且最亮时比周围 3×3 的平均亮出一截的 = 闪点；只是方差大的 = 边缘闪烁。测完镜头放回原处、重画一帧。
 */
export function findFireflies(render: () => void, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, opts: { frames?: number; film?: FilmLike } = {}): FireflyReport {
  const frames = opts.frames ?? 8;
  const W = canvas.width, H = canvas.height, N = W * H;
  const c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const g = c2.getContext('2d', { willReadFrequently: true })!;
  const sum = new Float32Array(N), sq = new Float32Array(N), mx = new Float32Array(N);
  const q0 = camera.quaternion.clone();
  const grain = opts.film?.flags.grain;
  if (opts.film) opts.film.flags.grain = false;
  const perPx = THREE.MathUtils.degToRad(camera.fov) / H;
  const halton = (i: number, b: number): number => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  try {
    for (let k = 0; k < frames; k++) {
      camera.quaternion.copy(q0);
      camera.rotateY((halton(k + 1, 2) - 0.5) * perPx);
      camera.rotateX((halton(k + 1, 3) - 0.5) * perPx);
      camera.updateMatrixWorld(true);
      render();
      g.drawImage(canvas, 0, 0);
      const d = g.getImageData(0, 0, W, H).data;
      for (let i = 0, p = 0; i < N; i++, p += 4) {
        const l = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
        sum[i] += l; sq[i] += l * l;
        if (l > mx[i]) mx[i] = l;
      }
    }
  } finally {
    camera.quaternion.copy(q0);
    camera.updateMatrixWorld(true);
    if (opts.film && grain !== undefined) opts.film.flags.grain = grain;
    render();
  }
  const mean = new Float32Array(N);
  for (let i = 0; i < N; i++) mean[i] = sum[i] / frames;
  g.drawImage(canvas, 0, 0);
  const img = g.getImageData(0, 0, W, H);
  const o = img.data;
  const CELL = 32, cw = Math.ceil(W / CELL), cells = new Uint32Array(cw * Math.ceil(H / CELL));
  let sparkle = 0, shimmer = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 4;
    const sd = Math.sqrt(Math.max(0, sq[i] / frames - mean[i] * mean[i]));
    let nb = 0, nn = 0, bright = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H) {
        const m = mean[yy * W + xx];
        nb += m; nn++;
        if (m > mx[i] - 0.15) bright++;
      }
    }
    nb /= Math.max(1, nn);
    const grey = mean[i] * 255 * 0.45;
    let r = grey, gg = grey, b = grey;
    // 闪点 = 孤立的一点（周围 8 格里最多 1 格一样亮）；成线的（经幡、绳子、山脊）归边缘闪烁
    if (sd > 0.06 && mx[i] - nb > 0.22 && mx[i] > 0.5 && bright <= 1) { sparkle++; r = 255; gg = 30; b = 30; cells[Math.floor(y / CELL) * cw + Math.floor(x / CELL)]++; }
    else if (sd > 0.12 || (sd > 0.06 && mx[i] - nb > 0.22)) { shimmer++; r = 255; gg = 210; b = 40; cells[Math.floor(y / CELL) * cw + Math.floor(x / CELL)]++; }
    o[p] = r; o[p + 1] = gg; o[p + 2] = b; o[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const hot = Array.from(cells, (n, k) => ({ x: (k % cw) * CELL, y: Math.floor(k / cw) * CELL, n })).filter(c => c.n > 0).sort((a, b) => b.n - a.n).slice(0, 8);
  return { frames, width: W, height: H, sparkle, shimmer, sparkleRatio: sparkle / N, shimmerRatio: shimmer / N, hot, overlay: c2.toDataURL('image/jpeg', 0.85) };
}

// ───────────────────────────── 着色器预热 ─────────────────────────────

/**
 * 进图时把场景里所有材质的着色器先编好（不管在不在视野里；能并行编的并行编），再空跑一帧（后期、阴影、倒影这些遍也编好）。
 * compile：按真实那一遍的状态预编（出图后期的 FilmPost.compileScene；缺省直接 compileAsync，那是按画到屏幕的状态编的）。
 * 返回用了多少毫秒；网址 warm=0 跳过（对照「转身第一眼卡一下」用）。
 * 按需生成的东西（草的区块）要在调这个之前先全部生成，不然它们的着色器变体编不到。
 */
export async function warmLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, renderOnce: () => void, compile?: () => Promise<void>): Promise<number> {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('warm') === '0') return 0;
  const t0 = performance.now();
  try {
    await (compile ? compile() : renderer.compileAsync(scene, camera));
  } catch (err) {
    console.warn('[lookdev] 预编着色器失败（照常往下走）', err);
  }
  // 只编着色器不够：大贴图（绘景板、细节贴图）和大几何体是第一次画到才传上 GPU 的（实测 4-4 转身第一眼 300 ms）。
  // 先把场景里所有材质用到的贴图传上去，再原地转一圈、每 45° 画一帧（几何体、阴影 / 倒影那几遍的变体也就都齐了）
  const seen = new Set<THREE.Texture>();
  scene.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture && !seen.has(v)) { seen.add(v); renderer.initTexture(v); }
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) for (const k in u) { const v = u[k]?.value; if (v instanceof THREE.Texture && !seen.has(v)) { seen.add(v); renderer.initTexture(v); } }
    }
  });
  const q0 = camera.quaternion.clone();
  for (let k = 0; k < 8; k++) {
    camera.quaternion.copy(q0);
    camera.rotateY(k * Math.PI / 4);
    camera.updateMatrixWorld(true);
    renderOnce();
  }
  camera.quaternion.copy(q0);
  camera.updateMatrixWorld(true);
  renderOnce();
  return performance.now() - t0;
}
