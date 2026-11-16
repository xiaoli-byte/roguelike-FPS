/**
 * 首领登场演出的导演（Unity Bosses/Intro/BossIntroDirector.cs，代码驱动机位，不用时间轴资源）：首领生成时开演，按脚本的镜头表接管镜头，最后连续地落回玩家眼睛。
 *   接管：锁玩家输入（ctx.input.enabled，每帧重申）、玩家无敌、HUD 收起、第一人称武器收起、上下黑边、名字卡、跳过提示（{@link CinematicOverlay}）。
 *   镜头：每帧在玩家写完相机之后（ctx.tasks 在所有系统之后跑）直接写主相机的位姿与 FOV；手持晃动 + 震屏由这里叠（权重随落地淡到 0）；机位被地形挡住时往看点收。
 *   首领：spawnAt 秒前藏着（{@link IntroHold.spawnDue}），之后它自己的登场动作照常跑完再停在登场里，直到镜头交还（{@link IntroHold.released}）才开打。
 *   交接：镜头表播完（或跳过）→ landSeconds 秒把位置、朝向、视角插值到玩家眼睛（smootherstep，最后一帧原样等于眼睛：零误差）；
 *     玩家视线在演出里已经转向首领。落地过半收黑边、HUD 回来，72% 时抬枪；到达那一帧解锁输入、清震屏、记「看过」。
 *   跳过：按住交互键（E）0.6 s；第一次看要先看满 1.5 s（真实时间），看过的一开始就能跳（localStorage 记录）。
 *   安全：时间缩放只走仲裁（演出慢动作优先级 = 顿帧 + 60）；暂停时演出跟着停（任务只在游玩时推进）；玩家阵亡、首领丢失、超时都立刻恢复一切。
 * 网址带 ?intro=0 时不放演出（首领照常从登场动作开打）。
 * 与 Unity 的差异：场上小怪不设为待机 / 不可选中（1-4 开打时场上只有首领）；收枪 / 抬枪是隐藏 / 显示枪模，没有上仰动画；IntroFx.Wind（转场风）没有移植。
 */
import * as THREE from 'three';
import type { GameContext, SfxId } from '../../../core/types';
import { slowMo } from '../framework/DefeatSequence';
import { TimePriority, type TimeScaleHandle } from '../framework/TimeScaleArbiter';
import type { IntroHold } from '../framework/BossBrain';
import { CinematicOverlay } from './CinematicOverlay';
import { BossIntroContext, cueRepeats, shotFrame, skipAllowed, type BossIntroScript, type IntroBoss } from './BossIntroScript';
import { blend, copyPose, dampTo, ease, finite, landLift, landLiftFor, landStretch, landWeight, lookPose, noise3, poseError, yawPitch, type CamPose } from './IntroMath';

export { FIRST_VIEW_LOCK, skipAllowed } from './BossIntroScript';
export const SKIP_HOLD_SECONDS = 0.6;
export const WATCHDOG = 8;
export const BARS_OUT_AT = 0.55;
export const HUD_IN_AT = 0.6;
export const RAISE_AT = 0.72;
export const AIM_MAX_PITCH = 32;
const HAND_POS = 0.035, HAND_FREQ = 0.55, SHAKE_FREQ = 18;
const HAND_ROT = new THREE.Vector3(0.55, 0.75, 0.35), SHAKE_POS = new THREE.Vector3(0.04, 0.04, 0.02), SHAKE_ROT = new THREE.Vector3(1.4, 1.1, 1.7);
const SEEN_KEY = 'spiritfire.bossIntroSeen';
const DEG = Math.PI / 180;

export function introEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search);
  return q.get('intro') !== '0';
}

export function introSeen(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]).includes(id);
  } catch {
    return false;
  }
}

function markSeen(id: string): void {
  try {
    const l = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
    if (!l.includes(id)) l.push(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify(l));
  } catch { /* 存不了就算了 */ }
}

/** 导演需要的首领（BossBrain 子类实现） */
export interface DirectedBoss extends IntroBoss {
  readonly name: string;
  readonly title: string | null;
  /** 首领身上叠一层发光（演出里的金光褪去） */
  introOverlay(color: number, amount: number): void;
  /** 演出给模型加的世界位移（首领摆模型时加上；没有专用动画时「从水下升起」） */
  readonly introOffset: THREE.Vector3;
}

type Stage = 'shots' | 'landing' | 'outro' | 'done';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _hit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as never };

export class BossIntroDirector implements IntroHold {
  readonly ctx: BossIntroContext;
  stage = 'shots' as Stage;
  /** 演出已进行（游戏时间 / 真实时间，不含暂停） */
  t = 0;
  realT = 0;
  skipped = false;
  released = false;
  spawnDue = false;
  seen: boolean;
  endReason: string | null = null;
  shotIndex = -1;
  cuts = 0;
  frames = 0;
  handoff: { meters: number; degrees: number; fov: number } | null = null;
  nameCardShown = false;

  private readonly overlay: CinematicOverlay | null;
  private readonly nextAt: number[];
  private readonly startPose: CamPose;
  private lastPose: CamPose;
  private hasLast = false;
  private skipFrom: CamPose | null = null;
  private landT = 0;
  private landSeconds = 1;
  private hasLandStart = false;
  private landLiftM = 0;
  private skipHold = 0;
  private clearDist = Infinity;
  private seed = Math.random() * 100;
  private slow: TimeScaleHandle | null = null;
  private modelOffset = new THREE.Vector3();
  private lastReal = 0;
  private hudShown = false;
  private raised = false;
  private cancelTask: (() => void) | null = null;
  private overlayColor = 0;
  private overlayAmount = 0;

  constructor(private readonly game: GameContext, readonly script: BossIntroScript, private readonly boss: DirectedBoss, spawn: THREE.Vector3) {
    const p = game.player;
    this.ctx = new BossIntroContext(script, spawn.clone(), spawn.clone(), () => p.position, () => p.eye, this.actions());
    this.nextAt = script.cues.map(c => c.at);
    this.seen = introSeen(script.id);
    const cam = game.camera;
    this.startPose = { position: cam.position.clone(), quaternion: cam.quaternion.clone(), fov: cam.fov };
    this.lastPose = { position: cam.position.clone(), quaternion: cam.quaternion.clone(), fov: cam.fov };
    this.overlay = CinematicOverlay.create(game.dom?.ui);
    if (this.overlay) this.overlay.barsTarget = 1;
    this.lastReal = now();
    this.lockInput();
    game.ui.showHUD(false);
    game.weapons.setViewmodelVisible(false);
    try {
      script.onBegin?.(this.ctx);
    } catch (err) {
      console.error('[BossIntro] onBegin threw', err);
    }
    this.cancelTask = game.tasks.add((dt) => this.tick(dt));
  }

  /** 落回第一人称的进度 0–1 */
  get landProgress(): number {
    return this.stage === 'landing' ? Math.min(1, this.landT / Math.max(0.01, this.landSeconds)) : this.stage === 'shots' ? 0 : 1;
  }

  get canSkip(): boolean {
    return this.stage === 'shots' && !this.skipped && !this.released && skipAllowed(this.seen, this.realT);
  }

  get shotName(): string {
    return this.stage === 'shots' && this.shotIndex >= 0 ? this.script.shots[this.shotIndex].name : this.stage === 'landing' ? 'land' : 'outro';
  }

  private actions() {
    const g = this.game;
    return {
      sfx: (id: string, at: THREE.Vector3, volume: number, pitch: number) => g.audio.play(id as SfxId, { position: at, volume, pitch }),
      shake: (strength: number, seconds: number) => g.fx.shake(strength, seconds),
      slowMo: (scale: number, realSeconds: number) => this.slowMo(scale, realSeconds),
      nameCard: (seconds: number) => this.showNameCard(seconds),
      offsetModel: (o: THREE.Vector3) => { if (finite(o)) this.modelOffset.add(o); },
      overlay: (color: number, amount: number) => { this.overlayColor = color; this.overlayAmount = amount; },
      fx: g.fx,
      waterSurface: (_p: THREE.Vector3) => null,
      hasSpring: () => false,
      skipped: () => this.skipped,
      landProgress: () => this.landProgress,
    };
  }

  // ───────────── 每帧（ctx.tasks：所有系统更新之后、渲染之前） ─────────────

  private tick(dt: number): boolean {
    if (this.stage === 'done') return true;
    const t0 = now();
    const udt = Math.min(0.1, Math.max(0, t0 - this.lastReal));
    this.lastReal = t0;
    if (this.stage === 'outro') return this.tickOutro(udt);
    const g = this.game;
    if (!g.player.alive) {
      this.abort('玩家阵亡');
      return true;
    }
    this.modelOffset.set(0, 0, 0);
    this.lockInput();
    this.realT += udt;
    const prev = this.t;
    this.t += dt;
    this.ctx.elapsed = this.t;
    if (!this.spawnDue && this.t >= this.script.spawnAt) this.spawnDue = true;
    this.bindBoss();
    if (!this.skipped) this.fireCues(prev, this.t);
    try {
      this.script.onTick?.(this.ctx, dt);
    } catch (err) {
      console.error('[BossIntro] onTick threw', err);
    }
    this.ctx.refreshSize();
    if (this.stage === 'landing') this.landT += dt;
    else if (this.t >= this.script.shotsSeconds) this.beginLanding(this.script.landSeconds);
    this.pollSkip(udt);
    this.aimPlayer(dt);
    if (this.t > this.script.seconds + WATCHDOG) {
      this.abort('超时');
      return true;
    }
    this.boss.introOffset.copy(this.modelOffset);
    if (this.overlayAmount > 0.001 || this.overlayColor) this.boss.introOverlay(this.overlayColor, this.overlayAmount);
    this.writeCamera(dt, udt);
    return (this.stage as Stage) === 'done';
  }

  private writeCamera(dt: number, udt: number): void {
    const cam = this.game.camera;
    // 玩家这一帧写好的第一人称姿态（眼睛 + 视线 + 视角），落地的终点
    const fp: CamPose = { position: cam.position.clone(), quaternion: cam.quaternion.clone(), fov: cam.fov };
    let p: CamPose;
    let w = 0, u = 0;
    if (this.stage === 'shots') p = this.evalTimeline(dt);
    else {
      const last = this.script.shots.length - 1;
      const from = this.skipped && this.skipFrom ? this.skipFrom : this.evalShot(last, this.script.shots[last].seconds, true, dt);
      if (!this.hasLandStart) {
        this.hasLandStart = true;
        const e = poseError(from, fp);
        this.landSeconds *= landStretch(e.meters);
        this.landLiftM = this.pickLift(from.position, fp.position, e.meters);
      }
      w = landWeight(this.landT, this.landSeconds);
      u = Math.min(1, this.landT / Math.max(0.01, this.landSeconds));
      p = blend(from, fp, w);
      if (w < 1) p = { position: p.position.clone().add(_a.set(0, landLift(this.landLiftM, w), 0)), quaternion: p.quaternion, fov: p.fov };
    }
    if (w < 1) p = this.perturb(p, 1 - w, this.stage === 'shots' ? this.currentHandheld() : this.script.shots[this.script.shots.length - 1]?.handheld ?? 0);
    if (!finite(p.position) || !Number.isFinite(p.fov)) p = fp;
    cam.position.copy(p.position);
    cam.quaternion.copy(p.quaternion);
    if (Math.abs(cam.fov - p.fov) > 1e-4) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    copyPose(this.lastPose, p);
    this.hasLast = true;
    this.frames++;
    this.present(u, udt);
    if (this.stage === 'landing' && w >= 1) this.doHandoff(fp);
  }

  private evalTimeline(dt: number): CamPose {
    let { index, local } = this.script.shotIndexAt(this.t);
    if (index < 0) {
      index = this.script.shots.length - 1;
      local = this.script.shots[index].seconds;
    }
    if (index !== this.shotIndex) {
      if (this.shotIndex >= 0) this.cuts++;
      this.shotIndex = index;
      this.clearDist = Infinity;
    }
    const s = this.script.shots[index];
    let pose = this.evalShot(index, local, true, dt);
    if (s.blendIn > 0 && local < s.blendIn) {
      const prev = index === 0 ? this.startPose : this.evalShot(index - 1, this.script.shots[index - 1].seconds, false, dt);
      pose = blend(prev, pose, ease('inOut', local / s.blendIn));
    }
    return pose;
  }

  private evalShot(i: number, u: number, stateful: boolean, dt: number): CamPose {
    const s = this.script.shots[i];
    const f = shotFrame(s, u, this.ctx);
    const pos = s.clearance ? this.clear(f.look, f.pos, stateful, dt) : f.pos;
    return lookPose(pos, f.look, f.fov, f.roll);
  }

  private currentHandheld(): number {
    return this.shotIndex >= 0 ? this.script.shots[this.shotIndex].handheld : 0;
  }

  /** 避让：从看点往机位打射线，被世界几何挡住就把机位收到挡板前面（收得快、放得慢）；机位贴地太低时抬到离地 0.45 m */
  private clear(look: THREE.Vector3, pos: THREE.Vector3, stateful: boolean, dt: number): THREE.Vector3 {
    const world = this.game.world;
    const origin = _a.copy(look).setY(look.y + 0.4);
    _dir.subVectors(pos, origin);
    const len = _dir.length();
    if (!(len > 0.5) || !Number.isFinite(len)) return pos;
    _dir.multiplyScalar(1 / len);
    let allowed = len;
    const hit = world.raycast(origin, _dir, len, _hit as never);
    if (hit) allowed = Math.max(0.6, hit.distance - 0.5);
    let use = allowed;
    if (stateful) {
      this.clearDist = allowed <= this.clearDist ? allowed : dampTo(this.clearDist, allowed, 3, dt);
      use = Math.min(len, this.clearDist);
    }
    const p = origin.clone().addScaledVector(_dir, use);
    const gy = world.groundHeight(p.x, p.z, p.y + 2.5, 0.1);
    if (Number.isFinite(gy) && p.y < gy + 0.45 && p.y > gy - 3.2) p.y = gy + 0.45;
    return p;
  }

  /** 手持晃动 + 震屏（weight = 1 − 落地权重：交接那一帧正好是 0） */
  private perturb(p: CamPose, weight: number, handheld: number): CamPose {
    if (!(weight > 0)) return p;
    const time = this.game.time.now;
    const hk = Math.min(1, Math.max(0, handheld)) * weight;
    const dp = new THREE.Vector3(), dr = new THREE.Vector3();
    if (hk > 0) {
      noise3(this.seed, time * HAND_FREQ, _n);
      noise3(this.seed + 13.1, time * HAND_FREQ * 0.8, _m);
      dp.addScaledVector(_n, HAND_POS * hk);
      dr.add(_m.multiply(HAND_ROT).multiplyScalar(hk));
    }
    const fx = this.game.cameraFx;
    const shake = Math.min(1.6, (fx.shakeTime > 0 ? fx.shakeIntensity : 0) * (this.game.settings.screenShake ?? 1) * 2.5) * weight;
    if (shake > 1e-4) {
      noise3(this.seed + 51, time * SHAKE_FREQ, _n);
      noise3(this.seed + 97, time * SHAKE_FREQ * 0.85, _m);
      dp.add(_n.multiply(SHAKE_POS).multiplyScalar(shake));
      dr.add(_m.multiply(SHAKE_ROT).multiplyScalar(shake));
    }
    _e.set(dr.x * DEG, dr.y * DEG, dr.z * DEG);
    return {
      position: p.position.clone().add(dp.applyQuaternion(p.quaternion)),
      quaternion: p.quaternion.clone().multiply(_q.setFromEuler(_e)),
      fov: p.fov,
    };
  }

  /** 回程的抬升：沿途 9 个点查一下，有东西挡着就换不抬 / 抬两倍，都挡着就挑挡得最少的 */
  private pickLift(a: THREE.Vector3, b: THREE.Vector3, meters: number): number {
    const lift0 = landLiftFor(meters);
    if (!(lift0 > 0.2)) return 0;
    let best = lift0, fewest = Infinity;
    for (const m of [1, 0, 2]) {
      const lift = lift0 * m;
      let blocked = 0;
      for (let i = 1; i < 10; i++) {
        const w = i / 10;
        _b.copy(a).lerp(b, w).setY(a.y + (b.y - a.y) * w + landLift(lift, w));
        if (this.game.world.sphereOverlaps?.(_b, 0.25)) blocked++;
      }
      if (blocked === 0) return lift;
      if (blocked < fewest) {
        fewest = blocked;
        best = lift;
      }
    }
    return best;
  }

  // ───────────── 事件 ─────────────

  private fireCues(prev: number, t: number): void {
    const cues = this.script.cues;
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (cueRepeats(c)) {
        while (this.nextAt[i] <= t && this.nextAt[i] < c.until) {
          this.nextAt[i] += c.every;
          this.run(c.label, () => c.run(this.ctx));
        }
        if (this.nextAt[i] >= c.until) this.nextAt[i] = Infinity;
      } else if (this.nextAt[i] <= t) {
        this.nextAt[i] = Infinity;
        this.run(c.label, () => c.run(this.ctx));
      }
    }
    void prev;
  }

  private run(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[BossIntro] 事件 ${label} 出错`, err);
    }
  }

  private bindBoss(): void {
    if (this.spawnDue && !this.ctx.boss && this.boss.alive) this.ctx.bindBoss(this.boss);
    if (!this.boss.alive && this.stage === 'shots') {
      this.endReason = '首领丢失';
      this.skipFrom = this.hasLast ? { ...this.lastPose, position: this.lastPose.position.clone(), quaternion: this.lastPose.quaternion.clone() } : this.startPose;
      this.skipped = true;
      this.beginLanding(this.script.skipLandSeconds);
    }
  }

  // ───────────── 跳过 ─────────────

  private pollSkip(udt: number): void {
    const can = this.canSkip;
    const held = can && this.game.input.keyDown('KeyE');
    this.skipHold = held ? this.skipHold + udt : Math.max(0, this.skipHold - udt * 3);
    this.overlay?.setHint(can, Math.min(1, this.skipHold / SKIP_HOLD_SECONDS), can ? '按住 E 跳过' : null);
    if (this.skipHold >= SKIP_HOLD_SECONDS) this.requestSkip();
  }

  /** 跳过：作废后面的镜头与非必需事件，必需事件立刻补放，首领立刻现身，从当前画面落回第一人称 */
  requestSkip(force = false): boolean {
    if (!force && !this.canSkip) return false;
    if (this.stage !== 'shots') return false;
    this.skipped = true;
    this.endReason = 'skipped';
    this.spawnDue = true;
    this.bindBoss();
    this.script.cues.forEach((c, i) => {
      if (!c.essential || !Number.isFinite(this.nextAt[i])) return;
      this.nextAt[i] = Infinity;
      this.run(c.label, () => c.run(this.ctx));
    });
    this.skipFrom = this.hasLast ? { position: this.lastPose.position.clone(), quaternion: this.lastPose.quaternion.clone(), fov: this.lastPose.fov } : this.startPose;
    this.overlay?.hideCaption();
    this.beginLanding(this.script.skipLandSeconds);
    return true;
  }

  private beginLanding(seconds: number): void {
    if (this.stage !== 'shots') return;
    this.stage = 'landing';
    this.landT = 0;
    this.landSeconds = Math.max(0.05, seconds);
    this.hasLandStart = false;
    this.game.audio.play('dash', { volume: this.skipped ? 0.35 : 0.45, pitch: 0.75 });
  }

  // ───────────── 玩家 ─────────────

  private lockInput(): void {
    const g = this.game;
    g.input.enabled = false;
    if (g.player.alive) g.player.invulnerableTime = Math.max(g.player.invulnerableTime, 0.3);
  }

  /** 视线转向首领：镜头表里直接转（玩家看不见），落地时平滑跟着 */
  private aimPlayer(dt: number): void {
    const p = this.game.player;
    const target = this.ctx.boss && this.boss.alive ? this.boss.getBodyCenter(_a) : _a.copy(this.ctx.spawn).setY(this.ctx.spawn.y + 2);
    const want = yawPitch(p.eye, target, AIM_MAX_PITCH);
    if (this.stage === 'shots') {
      p.yaw = want.yaw;
      p.pitch = want.pitch;
      return;
    }
    const k = 1 - Math.exp(-5 * Math.max(0, dt));
    let d = want.yaw - p.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    p.yaw += d * k;
    p.pitch += (want.pitch - p.pitch) * k;
  }

  // ───────────── 画面元素 ─────────────

  private present(landU: number, udt: number): void {
    const landing = this.stage === 'landing';
    const o = this.overlay;
    if (o) {
      if (landing && landU >= BARS_OUT_AT) o.barsTarget = 0;
      if (landing && landU >= 0.5) o.hideCaption();
      if (landing) o.setHint(false, 0, null);
      o.tick(udt);
    }
    if (landing && landU >= HUD_IN_AT && !this.hudShown) {
      this.hudShown = true;
      this.game.ui.showHUD(true);
    }
    if (landing && landU >= RAISE_AT && !this.raised) this.raise();
  }

  private raise(): void {
    this.raised = true;
    this.game.weapons.setViewmodelVisible(true);
    this.game.audio.play('weapon_switch', { volume: 0.5 });
  }

  showNameCard(seconds: number): void {
    if (this.nameCardShown) return;
    this.nameCardShown = true;
    this.overlay?.showCaption(this.boss.name, this.boss.title, this.script.epithet, seconds);
  }

  slowMo(scale: number, realSeconds: number): void {
    if (this.released) return;
    this.slow?.dispose();
    this.slow = slowMo(this.game, this, scale, realSeconds, TimePriority.BossIntro);
  }

  // ───────────── 交接 / 收尾 ─────────────

  private doHandoff(fp: CamPose): void {
    this.handoff = poseError(this.lastPose, fp);
    if (!this.endReason) this.endReason = 'done';
    this.release(true);
    this.stage = 'outro';
  }

  private release(completed: boolean): void {
    if (this.released) return;
    this.released = true;
    this.modelOffset.set(0, 0, 0);
    this.boss.introOffset.set(0, 0, 0);
    const g = this.game;
    if (g.game.state === 'playing') g.input.enabled = true;
    if (g.player.alive) g.player.invulnerableTime = Math.max(g.player.invulnerableTime, 0.5);
    this.slow?.dispose();
    this.slow = null;
    if (!this.hudShown) {
      this.hudShown = true;
      g.ui.showHUD(true);
    }
    if (!this.raised) this.raise();
    g.cameraFx.shakeIntensity = 0;
    g.cameraFx.shakeTime = 0;
    this.boss.introOverlay(0, 0);
    if (completed) {
      if (!this.nameCardShown) g.ui.banner(this.boss.name, this.boss.title ?? '首领', 2.4);
      this.nameCardShown = true;
      markSeen(this.script.id);
    }
    try {
      this.script.onEnd?.(this.ctx);
    } catch (err) {
      console.error('[BossIntro] onEnd threw', err);
    }
  }

  private tickOutro(udt: number): boolean {
    const o = this.overlay;
    if (o) {
      o.barsTarget = 0;
      o.setHint(false, 0, null);
      o.hideCaption();
      o.tick(udt);
    }
    if (o && (o.bars > 0 || o.captionVisible)) return false;
    this.finish();
    return true;
  }

  private finish(): void {
    this.overlay?.dispose();
    this.stage = 'done';
  }

  /** 打断：不等动画，立刻恢复一切 */
  abort(reason: string): void {
    if (this.stage === 'done') return;
    if (!this.endReason || this.endReason === 'done') this.endReason = reason;
    this.release(false);
    this.finish();
    this.cancelTask?.();
  }
}

function now(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}
