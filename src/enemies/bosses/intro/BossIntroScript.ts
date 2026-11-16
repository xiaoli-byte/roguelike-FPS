/**
 * 首领登场演出的数据（Unity Bosses/Intro/BossIntroScript.cs + BossIntroContext.cs）：镜头表 + 事件 + 可选的逐帧钩子，由 {@link BossIntroDirector} 播放。
 * 时间轴：0 = 开演（接管镜头）→ spawnAt 秒首领现身（它自己的登场动作从这一刻起算）→ 镜头表逐镜播完 → landSeconds 秒平滑落回玩家眼睛 → 交还操作、开打。
 * 玩家跳过时：作废后面的镜头和非必需事件，从当前画面用 skipLandSeconds 秒落回第一人称。
 * 点 = 锚点 + 决斗坐标系里的偏移（+Z = 玩家 → 出生点，+X = 玩家右手，+Y = 上）；sized = 偏移乘首领体型系数（身高 4 m = 1）。
 */
import * as THREE from 'three';
import { duelBasis, ease, finite, lookPose, orbit, toWorld, type CamPose, type IntroEase } from './IntroMath';

/** 第一次看至少多少秒（真实时间）才能跳 */
export const FIRST_VIEW_LOCK = 1.5;

/** 跳过规则：看过的随时能跳；第一次看要先看满 FIRST_VIEW_LOCK 秒（真实时间，不含暂停） */
export function skipAllowed(seenBefore: boolean, realElapsed: number): boolean {
  return seenBefore || realElapsed >= FIRST_VIEW_LOCK;
}

export interface IntroPoint {
  anchor: string;
  offset: THREE.Vector3;
  sized: boolean;
}

export const Anchors = {
  /** 首领出生点（地面） */
  Spawn: 'spawn',
  /** 场地中心 */
  Center: 'center',
  /** 首领根节点（实时；生成前 = 出生点） */
  Boss: 'boss',
  /** 首领身体中心（实时；生成前 = 出生点上方 2 m） */
  Body: 'body',
  /** 首领头（实时；生成前 = 出生点上方 3 m） */
  Head: 'head',
  /** 首领模型的视觉中心 */
  Model: 'model',
  /** 玩家脚底 / 眼睛（实时） */
  Player: 'player',
  Eye: 'eye',
} as const;

const BUILT_IN: readonly string[] = Object.values(Anchors);

export function at(anchor: string, x = 0, y = 0, z = 0): IntroPoint {
  return { anchor, offset: new THREE.Vector3(x, y, z), sized: false };
}

export function sized(anchor: string, x = 0, y = 0, z = 0): IntroPoint {
  return { anchor, offset: new THREE.Vector3(x, y, z), sized: true };
}

/** 一个镜头：seconds 秒内机位 from → to、看点 lookFrom → lookTo、视角 fovFrom → fovTo（按 ease）；blendIn 秒从上一镜平滑接过来 */
export class IntroShot {
  from: IntroPoint = at(Anchors.Spawn);
  to: IntroPoint = at(Anchors.Spawn);
  lookFrom: IntroPoint = at(Anchors.Spawn);
  lookTo: IntroPoint = at(Anchors.Spawn);
  fovFrom = 50;
  fovTo = 50;
  rollFrom = 0;
  rollTo = 0;
  easing: IntroEase = 'inOut';
  blendIn = 0;
  handheld = 0.15;
  orbit = false;
  clearance = true;

  constructor(readonly name: string, readonly seconds: number) {}

  static make(name: string, seconds: number): IntroShot {
    return new IntroShot(name, seconds);
  }

  move(a: IntroPoint, b: IntroPoint): this {
    this.from = a;
    this.to = b;
    return this;
  }

  hold(p: IntroPoint): this {
    return this.move(p, p);
  }

  look(a: IntroPoint, b: IntroPoint = a): this {
    this.lookFrom = a;
    this.lookTo = b;
    return this;
  }

  fov(a: number, b: number = a): this {
    this.fovFrom = a;
    this.fovTo = b;
    return this;
  }

  roll(a: number, b: number): this {
    this.rollFrom = a;
    this.rollTo = b;
    return this;
  }

  ease(e: IntroEase): this {
    this.easing = e;
    return this;
  }

  blend(s: number): this {
    this.blendIn = Math.max(0, s);
    return this;
  }

  hand(k: number): this {
    this.handheld = Math.min(1, Math.max(0, k));
    return this;
  }

  orbiting(on = true): this {
    this.orbit = on;
    return this;
  }
}

export type CueKind = 'call' | 'sfx' | 'shake' | 'slowmo' | 'namecard' | 'flash';

/** 演出事件（at = 开演后的秒数，游戏时间）；重复事件在 [at, until) 里每 every 秒一次；essential = 跳过时还没放的也要补放 */
export interface IntroCue {
  kind: CueKind;
  label: string;
  at: number;
  until: number;
  every: number;
  essential: boolean;
  run: (c: BossIntroContext) => void;
}

export const Cue = {
  call: (time: number, label: string, run: (c: BossIntroContext) => void, essential = false): IntroCue =>
    ({ kind: 'call', label, at: time, until: -1, every: 0, essential, run }),
  every: (from: number, until: number, every: number, label: string, run: (c: BossIntroContext) => void): IntroCue =>
    ({ kind: 'call', label, at: from, until, every: Math.max(0.02, every), essential: false, run }),
  sfx: (time: number, id: string, anchor: string = Anchors.Body, volume = 1, pitch = 1): IntroCue =>
    ({ kind: 'sfx', label: `sfx:${id}`, at: time, until: -1, every: 0, essential: false, run: c => c.sfx(id, c.anchor(anchor), volume, pitch) }),
  shake: (time: number, strength: number, seconds = 0.5): IntroCue =>
    ({ kind: 'shake', label: `shake:${strength}`, at: time, until: -1, every: 0, essential: false, run: c => c.shake(strength, seconds) }),
  slowMo: (time: number, scale: number, realSeconds: number): IntroCue =>
    ({ kind: 'slowmo', label: `slowmo:${scale}`, at: time, until: -1, every: 0, essential: false, run: c => c.slowMo(scale, realSeconds) }),
  nameCard: (time: number, seconds = 2.4): IntroCue =>
    ({ kind: 'namecard', label: 'namecard', at: time, until: -1, every: 0, essential: false, run: c => c.nameCard(seconds) }),
};

export function cueRepeats(c: IntroCue): boolean {
  return c.every > 0 && c.until > c.at;
}

/** 演出脚本：一只首领一份（id = 首领 id） */
export class BossIntroScript {
  id = '';
  /** 第几秒首领现身 */
  spawnAt = 1.5;
  landSeconds = 1.3;
  skipLandSeconds = 0.7;
  /** 名字卡上方的小字（场地名） */
  epithet: string | null = null;
  readonly shots: IntroShot[] = [];
  readonly cues: IntroCue[] = [];
  /** 脚本自己的锚点（返回 null = 退回出生点） */
  readonly anchors = new Map<string, (c: BossIntroContext) => THREE.Vector3 | null>();
  onBegin: ((c: BossIntroContext) => void) | null = null;
  onTick: ((c: BossIntroContext, dt: number) => void) | null = null;
  onEnd: ((c: BossIntroContext) => void) | null = null;

  /** 镜头表总长（不含落回第一人称） */
  get shotsSeconds(): number {
    return this.shots.reduce((s, x) => s + Math.max(0, x.seconds), 0);
  }

  /** 整段演出（镜头表 + 落回第一人称） */
  get seconds(): number {
    return this.shotsSeconds + Math.max(0, this.landSeconds);
  }

  shotStart(index: number): number {
    let s = 0;
    for (let i = 0; i < index && i < this.shots.length; i++) s += Math.max(0, this.shots[i].seconds);
    return s;
  }

  /** 演出第 t 秒在哪一镜（local = 镜头内的秒数）；镜头表播完返回 −1（local = 超出的秒数） */
  shotIndexAt(t: number): { index: number; local: number } {
    let start = 0;
    for (let i = 0; i < this.shots.length; i++) {
      const len = Math.max(0, this.shots[i].seconds);
      if (t < start + len) return { index: i, local: Math.max(0, t - start) };
      start += len;
    }
    return { index: -1, local: t - start };
  }

  get hasNameCard(): boolean {
    return this.cues.some(c => c.kind === 'namecard');
  }

  knows(anchor: string): boolean {
    return BUILT_IN.includes(anchor) || this.anchors.has(anchor);
  }

  /** 自检：有镜头、时长为正、锚点有定义、视角 10–120°、生成时刻在镜头表里、落地时长合理、整段 4–11 s、事件在演出内、有名字卡 */
  validate(): string[] {
    const p: string[] = [];
    if (!this.id) p.push('没有 id');
    if (this.shots.length === 0) p.push('没有镜头');
    this.shots.forEach((s, i) => {
      const n = `镜头「${s.name || i + 1}」`;
      if (!(s.seconds > 0.1) || !Number.isFinite(s.seconds)) p.push(`${n}时长 ${s.seconds}`);
      for (const [label, pt] of [['机位起点', s.from], ['机位终点', s.to], ['看点起点', s.lookFrom], ['看点终点', s.lookTo]] as const) {
        if (!pt.anchor) p.push(`${n}的${label}没有锚点`);
        else if (!this.knows(pt.anchor)) p.push(`${n}的${label}用了没定义的锚点「${pt.anchor}」`);
      }
      if (s.fovFrom < 10 || s.fovFrom > 120 || s.fovTo < 10 || s.fovTo > 120) p.push(`${n}视角 ${s.fovFrom}–${s.fovTo} 超出 10–120`);
      if (s.blendIn > s.seconds) p.push(`${n}的过渡 ${s.blendIn}s 比镜头还长`);
    });
    const len = this.shotsSeconds;
    if (this.spawnAt < 0 || this.spawnAt > len) p.push(`生成时刻 ${this.spawnAt}s 不在镜头表（0–${len.toFixed(1)}s）里`);
    if (this.landSeconds < 0.6 || this.landSeconds > 3) p.push(`落回第一人称 ${this.landSeconds}s 不在 0.6–3 s`);
    if (this.skipLandSeconds < 0.3 || this.skipLandSeconds > 2) p.push(`跳过后落回 ${this.skipLandSeconds}s 不在 0.3–2 s`);
    if (this.seconds < 4 || this.seconds > 11) p.push(`整段 ${this.seconds.toFixed(1)}s 不在 4–11 s（设计 6–10 s）`);
    for (const c of this.cues) {
      if (c.at < 0 || c.at > this.seconds) p.push(`事件 ${c.label} 不在演出时间内`);
      if (c.every > 0 && !(c.until > c.at)) p.push(`重复事件 ${c.label} 的结束时刻不在开始之后`);
    }
    if (!this.hasNameCard) p.push('没有名字卡事件');
    return p;
  }
}

/** 演出看到的首领 */
export interface IntroBoss {
  readonly alive: boolean;
  readonly position: THREE.Vector3;
  readonly height: number;
  readonly model: THREE.Object3D;
  getBodyCenter(out: THREE.Vector3): THREE.Vector3;
  getHeadCenter(out: THREE.Vector3): THREE.Vector3;
}

/** 导演给上下文的动作（没有导演的预览上下文里都是空的） */
export interface IntroActions {
  sfx(id: string, at: THREE.Vector3, volume: number, pitch: number): void;
  shake(strength: number, seconds: number): void;
  slowMo(scale: number, realSeconds: number): void;
  nameCard(seconds: number): void;
  offsetModel(offset: THREE.Vector3): void;
  overlay(color: number, amount: number): void;
  fx: {
    burst(pos: THREE.Vector3, color: number, count?: number, speed?: number, life?: number, size?: number, gravity?: number): void;
    ring(center: THREE.Vector3, radius: number, color?: number, duration?: number): void;
    explosion(center: THREE.Vector3, radius: number, color?: number): void;
  } | null;
  waterSurface(p: THREE.Vector3): number | null;
  hasSpring(): boolean;
  skipped(): boolean;
  landProgress(): number;
}

/** 演出脚本看到的上下文（锚点、首领、决斗坐标系、给事件用的动作） */
export class BossIntroContext {
  boss: IntroBoss | null = null;
  elapsed = 0;
  spawnedAt = -1;
  size = 1;
  heightM = 4;
  readonly forward: THREE.Vector3;
  readonly right: THREE.Vector3;
  readonly bag = new Map<string, unknown>();

  constructor(
    readonly script: BossIntroScript,
    readonly spawn: THREE.Vector3,
    readonly center: THREE.Vector3,
    readonly player: () => THREE.Vector3,
    readonly eye: () => THREE.Vector3,
    readonly actions: IntroActions | null,
  ) {
    const b = duelBasis(player(), spawn, new THREE.Vector3(0, 0, 1));
    this.forward = b.forward;
    this.right = b.right;
  }

  /** 没有导演的上下文（测试、镜头预览）：玩家固定在 playerFeet，首领不存在 */
  static preview(script: BossIntroScript, playerFeet: THREE.Vector3, spawn: THREE.Vector3): BossIntroContext {
    const feet = playerFeet.clone();
    const eye = feet.clone().add(new THREE.Vector3(0, 1.6, 0));
    return new BossIntroContext(script, spawn.clone(), spawn.clone(), () => feet, () => eye, null);
  }

  get sinceSpawn(): number {
    return this.boss ? this.elapsed - this.spawnedAt : -1;
  }

  get skipped(): boolean {
    return this.actions?.skipped() ?? false;
  }

  get landProgress(): number {
    return this.actions?.landProgress() ?? 0;
  }

  bindBoss(b: IntroBoss): void {
    this.boss = b;
    this.spawnedAt = this.elapsed;
    this.refreshSize();
  }

  refreshSize(): void {
    const h = this.boss?.height ?? 0;
    if (!(h > 0.1) || !Number.isFinite(h)) return;
    this.heightM = h;
    this.size = Math.min(3.5, Math.max(0.6, h / 4));
  }

  duel(offset: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return toWorld(offset, this.forward, this.right, out);
  }

  /** 锚点的世界位置（实时） */
  anchor(name: string): THREE.Vector3 {
    const b = this.boss && this.boss.alive ? this.boss : null;
    switch (name) {
      case Anchors.Spawn:
        return this.spawn.clone();
      case Anchors.Center:
        return this.center.clone();
      case Anchors.Boss:
        return b ? b.position.clone() : this.spawn.clone();
      case Anchors.Body:
        return b ? b.getBodyCenter(new THREE.Vector3()) : this.spawn.clone().add(new THREE.Vector3(0, 2, 0));
      case Anchors.Head:
        return b ? b.getHeadCenter(new THREE.Vector3()) : this.spawn.clone().add(new THREE.Vector3(0, 3, 0));
      case Anchors.Model:
        return b ? b.model.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, this.heightM * 0.5, 0)) : this.anchor(Anchors.Body);
      case Anchors.Player:
        return this.player().clone();
      case Anchors.Eye:
        return this.eye().clone();
    }
    const f = this.script.anchors.get(name);
    if (f) {
      try {
        const p = f(this);
        if (p && finite(p)) return p.clone();
      } catch (err) {
        console.error(`[BossIntro] 锚点 ${name} 出错`, err);
      }
    }
    return this.spawn.clone();
  }

  /** 镜头表里的一个点 → 世界位置 */
  point(p: IntroPoint): THREE.Vector3 {
    const off = p.sized ? p.offset.clone().multiplyScalar(this.size) : p.offset;
    return this.anchor(p.anchor).add(this.duel(off));
  }

  // ───────────── 给事件 / 逐帧钩子用的动作 ─────────────

  sfx(id: string, at: THREE.Vector3, volume = 1, pitch = 1): void {
    this.actions?.sfx(id, at, volume, pitch);
  }

  shake(strength: number, seconds: number): void {
    this.actions?.shake(strength, seconds);
  }

  slowMo(scale: number, realSeconds: number): void {
    this.actions?.slowMo(scale, realSeconds);
  }

  nameCard(seconds: number): void {
    this.actions?.nameCard(seconds);
  }

  /** 这一帧给首领模型加一个世界位移（下一帧自动撤销） */
  offsetModel(offset: THREE.Vector3): void {
    this.actions?.offsetModel(offset);
  }

  /** 首领身上叠一层发光色（amount 0–1；演出结束时撤掉） */
  overlay(color: number, amount: number): void {
    this.actions?.overlay(color, amount);
  }

  get fx(): IntroActions['fx'] {
    return this.actions?.fx ?? null;
  }

  random(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}

/** 一镜第 u 秒的机位、看点、视角、横滚（不做地形避让） */
export function shotFrame(s: IntroShot, u: number, c: BossIntroContext): { pos: THREE.Vector3; look: THREE.Vector3; fov: number; roll: number } {
  const k = ease(s.easing, s.seconds > 0 ? u / s.seconds : 1);
  const lookA = c.point(s.lookFrom), lookB = c.point(s.lookTo);
  const look = lookA.clone().lerp(lookB, k);
  const pos = s.orbit
    ? look.clone().add(orbit(c.point(s.from).sub(lookA), c.point(s.to).sub(lookB), k))
    : c.point(s.from).lerp(c.point(s.to), k);
  return { pos, look, fov: s.fovFrom + (s.fovTo - s.fovFrom) * k, roll: s.rollFrom + (s.rollTo - s.rollFrom) * k };
}

export function shotPose(s: IntroShot, u: number, c: BossIntroContext): CamPose {
  const f = shotFrame(s, u, c);
  return lookPose(f.pos, f.look, f.fov, f.roll);
}
