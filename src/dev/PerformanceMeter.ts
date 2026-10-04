/** Opt-in frame profiler. Queries are asynchronous; no GL synchronization or quality changes. */
import type * as THREE from 'three';

const WARMUP_FRAMES = 30;
const SAMPLE_FRAMES = 240;
// Coprime to the common 2/3/4-frame shadow cadence, so GPU samples include
// both cached and refreshed frames instead of always hitting the same phase.
const GPU_STRIDE = 7;
const GPU_PENDING_LIMIT = 4;
const GPU_DRAIN_FRAMES = 60;

interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}
export interface PerformanceSummary { median: number; p95: number; mean: number }
export interface PerformanceMetadata {
  quality: string; theme: string; gameState: string;
  chapter?: number; stageIndex?: number; stageType?: string;
  phase?: string; encounter?: string; enemies?: number;
}
export interface PerformanceReport {
  sampledAt: string;
  warmupFrames: number;
  frames: number;
  fps: number;
  rafMs: PerformanceSummary;
  updateMs: PerformanceSummary;
  renderSubmitMs: PerformanceSummary;
  gpu: { status: 'available' | 'unavailable' | 'disjoint'; samples: number; ms: PerformanceSummary | null; disjointEvents: number };
  render: { calls: number; triangles: number; points: number; lines: number; geometries: number; textures: number; programs: number };
  resolution: { width: number; height: number; cssWidth: number; cssHeight: number; pixelRatio: number };
  metadata: PerformanceMetadata;
  hiddenFrames: number;
}

function summary(values: readonly number[]): PerformanceSummary {
  const sorted = values.slice().sort((a, b) => a - b);
  const percentile = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
  return { median: percentile(.5), p95: percentile(.95), mean: values.reduce((n, value) => n + value, 0) / Math.max(1, values.length) };
}

export class PerformanceMeter {
  state: 'idle' | 'warmup' | 'sampling' | 'pending-gpu' | 'complete' = 'idle';
  report: PerformanceReport | null = null;
  private warmup = 0;
  private frames = 0;
  private drain = 0;
  private lastRaf = NaN;
  private interval = 0;
  private updateStarted = 0;
  private updateTime = 0;
  private renderStarted = 0;
  private sampledAt = '';
  private hiddenFrames = 0;
  private disjointEvents = 0;
  private samplingFrame = false;
  private readonly raf: number[] = [];
  private readonly updates: number[] = [];
  private readonly renders: number[] = [];
  private readonly gpuTimes: number[] = [];
  private calls = 0;
  private triangles = 0;
  private points = 0;
  private lines = 0;
  private readonly gl: WebGL2RenderingContext;
  private readonly extension: TimerExtension | null;
  private activeQuery: WebGLQuery | null = null;
  private readonly pending: WebGLQuery[] = [];

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly metadata: () => PerformanceMetadata) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.extension = typeof this.gl.createQuery === 'function'
      ? this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null : null;
    // Game renders the world and first-person scene separately. Reset once per frame,
    // otherwise Three's default only leaves the second scene in renderer.info.
    renderer.info.autoReset = false;
  }

  get progress(): number { return this.frames; }

  sample(): void {
    this.clearQueries();
    this.state = 'warmup'; this.report = null;
    this.warmup = WARMUP_FRAMES; this.frames = 0; this.drain = 0;
    this.sampledAt = new Date().toISOString();
    this.raf.length = this.updates.length = this.renders.length = this.gpuTimes.length = 0;
    this.calls = this.triangles = this.points = this.lines = this.hiddenFrames = this.disjointEvents = 0;
    this.samplingFrame = false;
  }

  beginFrame(rafTimestamp: number): void {
    this.interval = Number.isFinite(this.lastRaf) ? rafTimestamp - this.lastRaf : 0;
    this.lastRaf = rafTimestamp;
    this.renderer.info.reset();
    this.pollQueries();
    this.samplingFrame = false;
    if (this.state === 'pending-gpu') {
      if (this.pending.length === 0 || ++this.drain >= GPU_DRAIN_FRAMES) this.complete();
    } else if (this.state === 'warmup') {
      if (this.warmup-- <= 0) this.state = 'sampling';
    }
    this.samplingFrame = this.state === 'sampling';
    this.updateStarted = performance.now();
  }

  endUpdate(): void {
    if (this.samplingFrame) this.updateTime = performance.now() - this.updateStarted;
  }

  beginRender(): void {
    if (!this.samplingFrame) return;
    this.renderStarted = performance.now();
    if (!this.extension || this.frames % GPU_STRIDE !== 0 || this.pending.length >= GPU_PENDING_LIMIT) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    this.activeQuery = query;
  }

  endRender(): void {
    if (!this.samplingFrame) return;
    const submitMs = performance.now() - this.renderStarted;
    if (this.activeQuery && this.extension) {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pending.push(this.activeQuery); this.activeQuery = null;
    }
    this.raf.push(this.interval);
    this.updates.push(this.updateTime);
    this.renders.push(submitMs);
    const info = this.renderer.info.render;
    this.calls += info.calls; this.triangles += info.triangles;
    this.points += info.points; this.lines += info.lines;
    if (document.hidden) this.hiddenFrames++;
    if (++this.frames >= SAMPLE_FRAMES) {
      this.state = this.pending.length ? 'pending-gpu' : 'complete';
      if (this.state === 'complete') this.complete();
    }
  }

  private pollQueries(): void {
    const extension = this.extension;
    if (!extension || this.pending.length === 0) return;
    if (this.gl.getParameter(extension.GPU_DISJOINT_EXT)) {
      this.disjointEvents++;
      this.gpuTimes.length = 0;
      this.clearQueries();
      return;
    }
    let retained = 0;
    for (const query of this.pending) {
      if (this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) {
        const nanoseconds = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number;
        if (Number.isFinite(nanoseconds) && nanoseconds >= 0) this.gpuTimes.push(nanoseconds / 1e6);
        this.gl.deleteQuery(query);
      } else this.pending[retained++] = query;
    }
    this.pending.length = retained;
  }

  private clearQueries(): void {
    if (this.activeQuery && this.extension) {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this.activeQuery); this.activeQuery = null;
    }
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending.length = 0;
  }

  private complete(): void {
    const canvas = this.renderer.domElement, info = this.renderer.info;
    const rafMs = summary(this.raf);
    this.report = {
      sampledAt: this.sampledAt, warmupFrames: WARMUP_FRAMES, frames: this.frames,
      fps: rafMs.mean > 0 ? 1000 / rafMs.mean : 0,
      rafMs, updateMs: summary(this.updates), renderSubmitMs: summary(this.renders),
      gpu: { status: this.gpuTimes.length ? 'available' : this.disjointEvents ? 'disjoint' : 'unavailable', samples: this.gpuTimes.length,
        ms: this.gpuTimes.length ? summary(this.gpuTimes) : null, disjointEvents: this.disjointEvents },
      render: { calls: this.calls / this.frames, triangles: this.triangles / this.frames, points: this.points / this.frames, lines: this.lines / this.frames,
        geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 },
      resolution: { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, pixelRatio: this.renderer.getPixelRatio() },
      metadata: this.metadata(), hiddenFrames: this.hiddenFrames,
    };
    this.clearQueries(); this.state = 'complete';
  }
}
