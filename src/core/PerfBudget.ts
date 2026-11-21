/**
 * 固定机位的性能预算（Unity G/Core/PerfBudget.cs 照译，I4；docs/performance-unity.md「预算」）：
 * 阈值是 Unity 参考机（RTX 3070 / Ryzen 7 3700X，2026-10-30）基线的最大值留余量（计数约 25%，时间约 50%）。
 * 网页的 ?perf=1 性能表（dev/PerformanceMeter）采到的绘制调用 / 三角面可以拿来对这一份；GPU / 主线程时间浏览器里量法不同，只作参考。
 * 换参考机或网页单独定预算时要重测再改。
 */
export interface PerfLimits {
  /** 0 = 这一项不检查 */
  gpuP95Ms: number;
  mainP95Ms: number;
  drawCalls: number;
  setPass: number;
  frustumRenderers: number;
  triangles: number;
}

export const PERF_HIGH: PerfLimits = { gpuP95Ms: 8, mainP95Ms: 16, drawCalls: 4400, setPass: 480, triangles: 8_300_000, frustumRenderers: 460 };
export const PERF_LOW: PerfLimits = { gpuP95Ms: 3.5, mainP95Ms: 15, drawCalls: 1350, setPass: 230, triangles: 2_900_000, frustumRenderers: 390 };

export function perfLimits(high: boolean): PerfLimits {
  return high ? PERF_HIGH : PERF_LOW;
}

/** 构建时估算的上限（Unity L5 PerfBudgetCheck）：视锥内渲染器、三角面、绘制（主画面 + 阴影距离内投影体） */
export interface StaticPerfLimits {
  renderers: number;
  draws: number;
  triangles: number;
}

export const PERF_STATIC_HIGH: StaticPerfLimits = { renderers: 400, triangles: 2_100_000, draws: 480 };
export const PERF_STATIC_LOW: StaticPerfLimits = { renderers: 360, triangles: 2_000_000, draws: 400 };

const group = (v: number) => Math.round(v).toLocaleString('en-US');

function over(parts: string[], what: string, got: number, max: number, ms = false): void {
  if (max <= 0 || got <= 0 || got <= max) return;
  parts.push(ms ? `${what} ${got.toFixed(2)} ms > ${max.toFixed(2)} ms` : `${what} ${group(got)} > ${group(max)}`);
}

/** 运行时超出预算的项（没超 = null）。拿不到的量（≤ 0）不检查 */
export function checkPerf(high: boolean, gpuP95: number, mainP95: number, drawCalls: number, setPass: number, triangles: number, frustumRenderers: number): string | null {
  const l = perfLimits(high), parts: string[] = [];
  over(parts, 'GPU P95', gpuP95, l.gpuP95Ms, true);
  over(parts, '主线程 P95', mainP95, l.mainP95Ms, true);
  over(parts, '绘制调用', drawCalls, l.drawCalls);
  over(parts, 'SetPass', setPass, l.setPass);
  over(parts, '三角面', triangles, l.triangles);
  over(parts, '视锥内渲染器', frustumRenderers, l.frustumRenderers);
  return parts.length > 0 ? parts.join('、') : null;
}

/** 估算超出预算的项（没超 = null） */
export function checkPerfStatic(high: boolean, renderers: number, triangles: number, draws: number): string | null {
  const l = high ? PERF_STATIC_HIGH : PERF_STATIC_LOW, parts: string[] = [];
  over(parts, '视锥内渲染器', renderers, l.renderers);
  over(parts, '三角面', triangles, l.triangles);
  over(parts, '绘制（含投影）', draws, l.draws);
  return parts.length > 0 ? parts.join('、') : null;
}
