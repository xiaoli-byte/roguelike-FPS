/**
 * 演出导演（chuanzang-combat-v1.md 第 4 节「领主通用」；Unity 侧对应 BossIntroDirector + 镜头表）：领主登场、转阶段、死亡。
 *
 * 一段演出（Shot）的时间线：
 *   cam      镜头表 shots[]（建立全景 establish → 首领现身 reveal → 特写 + 名字卡 closeup …）逐镜拍；镜与镜之间 blend 秒融过去（0 = 切）。
 *            开头 0.5 秒从玩家的眼睛融进第一镜；最后 landDur 秒（land）用平滑曲线落回玩家眼睛的位姿——位置、朝向、视角零误差交接，不硬切。
 *   handoff  镜头已经在眼睛上：黑边收起，武器和 HUD 在 handoff 秒内淡入（uiAlpha 0 → 1）；淡入完才调 onEnd（领主这时才开打）。
 * 演出期间玩家不能动、不受伤（PlayMode 看 locked / invulnerable）。
 * 跳过：同一段登场第二次起（skipKey 记在 localStorage）按任意键跳过——从当前机位 0.9 秒平滑落回眼睛，再走 handoff；
 * Shot.tick 会把剩下的时间快进跑完，领主的状态和不跳过时一样。
 */
import * as THREE from 'three';

export interface CamKey { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

/** 镜头表里的一镜 */
export interface CamShot {
  /** 镜头名（Unity 镜头表按它对）：establish / reveal / closeup / … */
  id: string;
  dur: number;
  /** 这一镜里 t（0..dur）时的机位 */
  cam: (t: number, out: CamKey) => void;
  /** 从上一镜融过来的秒数（0 = 硬切；第一镜忽略） */
  blend?: number;
  /** 说明（导出镜头表用） */
  note?: string;
}

export interface NameCard {
  title: string;
  /** 名号（大字下面那一行） */
  sub?: string;
  /** 出处（小字） */
  quote?: string;
  at: number;
  dur: number;
  /** 终局大字 */
  big?: boolean;
}

export interface Shot {
  name: string;
  dur: number;
  /** 单一机位函数（调试观察机位、简单的转阶段） */
  cam?: (t: number, out: CamKey) => void;
  /** 镜头表：依次拍完，总时长就是 dur（最后一镜结束时落在眼睛上） */
  shots?: CamShot[];
  /** 最后落回眼睛的时长（默认 0.6；登场 1.4） */
  landDur?: number;
  /** 落回眼睛之后武器、HUD 淡入的时长（默认 0；登场 0.6） */
  handoff?: number;
  card?: NameCard;
  /** 下方横幅（转阶段「二 · 雷鼓」） */
  banner?: { text: string; at: number; dur: number };
  /** 时间倍率曲线（慢放）：t → 0..1 */
  slow?: (t: number) => number;
  /** 每帧（推进领主的演出动作；dt 是游戏时间） */
  tick?: (t: number, dt: number) => void;
  onEnd?: () => void;
  bars?: boolean;
  /** 演出期间锁住玩家（默认：接管镜头时锁） */
  lock?: boolean;
  /** 能不能跳过：true = 一直能；给了 skipKey = 看过一次之后才能 */
  skippable?: boolean;
  skipKey?: string;
}

const CSS = `
#cine{position:fixed;inset:0;pointer-events:none;z-index:30;font-family:"STKaiti","KaiTi","Kaiti SC","Microsoft YaHei",serif}
#cine .bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height .45s ease}
#cine .bar.t{top:0}#cine .bar.b{bottom:0}
#cine.on .bar{height:11vh}
#cine .card{position:absolute;left:8vw;bottom:17vh;color:#fff;opacity:0;transform:translateX(-30px);transition:opacity .6s,transform .6s;text-shadow:0 3px 12px #000}
#cine .card.show{opacity:1;transform:none}
#cine .card b{display:block;font-size:64px;letter-spacing:10px;color:#ffe6a8;line-height:1.1}
#cine .card.big b{font-size:86px;letter-spacing:16px}
#cine .card span{display:block;font-size:26px;margin-top:6px;letter-spacing:4px}
#cine .card i{display:block;font-size:17px;margin-top:10px;opacity:.8;font-style:normal}
#cine .card hr{width:62%;margin:10px 0 0;border:0;height:2px;background:linear-gradient(90deg,#ffd27a,transparent)}
#cine .banner{position:absolute;left:50%;bottom:22vh;transform:translateX(-50%);font-size:40px;letter-spacing:12px;color:#ffe6a8;opacity:0;transition:opacity .5s;text-shadow:0 2px 10px #000;white-space:nowrap}
#cine .banner.show{opacity:1}
#cine .skip{position:absolute;right:24px;bottom:calc(11vh + 10px);font-size:13px;color:#fff9;font-family:"Microsoft YaHei",sans-serif;opacity:0;transition:opacity .4s}
#cine.on.canskip .skip{opacity:1}
`;

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _a: CamKey = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
const smooth = (k: number): number => { const x = Math.min(1, Math.max(0, k)); return x * x * (3 - 2 * x); };
/** 更柔的起落（落回眼睛用：开头和结尾的速度、加速度都是 0） */
const smoother = (k: number): number => { const x = Math.min(1, Math.max(0, k)); return x * x * x * (x * (x * 6 - 15) + 10); };

const SEEN_KEY = 'ch4.introSeen';

/** 把镜头表合成一个机位函数（镜与镜之间按 blend 融合） */
export function shotList(shots: CamShot[]): (t: number, out: CamKey) => void {
  const starts: number[] = [];
  let acc = 0;
  for (const s of shots) { starts.push(acc); acc += s.dur; }
  return (t, out) => {
    let i = shots.length - 1;
    while (i > 0 && t < starts[i]) i--;
    const s = shots[i], lt = Math.min(s.dur, t - starts[i]);
    s.cam(lt, out);
    const b = i > 0 ? s.blend ?? 0.4 : 0;
    if (b > 0 && lt < b) {
      const p = shots[i - 1];
      p.cam(p.dur, _a);
      const k = smooth(lt / b);
      out.pos.lerpVectors(_a.pos, out.pos, k);
      out.look.lerpVectors(_a.look, out.look, k);
      out.fov = _a.fov + (out.fov - _a.fov) * k;
    }
  };
}

/** 镜头表的时间点（导出给 Unity 的 BossIntroDirector） */
export function shotTable(s: Shot): { name: string; dur: number; landDur: number; handoff: number; card?: { at: number; dur: number; title: string }; shots: { id: string; t0: number; t1: number; blend: number; note?: string }[] } {
  let acc = 0;
  const shots = (s.shots ?? []).map((c, i) => { const r = { id: c.id, t0: +acc.toFixed(2), t1: +(acc + c.dur).toFixed(2), blend: i === 0 ? 0 : c.blend ?? 0.4, note: c.note }; acc += c.dur; return r; });
  return { name: s.name, dur: s.dur, landDur: s.landDur ?? 0.6, handoff: s.handoff ?? 0, card: s.card ? { at: s.card.at, dur: s.card.dur, title: s.card.title } : undefined, shots };
}

export class Cinema {
  shot: Shot | null = null;
  t = 0;
  /** cam = 按镜头表拍；skip = 跳过后正在落回眼睛；handoff = 镜头已在眼睛上、武器和 HUD 淡入 */
  phase: 'cam' | 'skip' | 'handoff' = 'cam';
  /** 武器、HUD 的不透明度（PlayMode 每帧读） */
  uiAlpha = 1;
  private camFn: ((t: number, out: CamKey) => void) | null = null;
  private skipT = 0;
  private skipDur = 0.9;
  private hoT = 0;
  private readonly key: CamKey = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 72 };
  private readonly eyePos = new THREE.Vector3();
  private readonly eyeQ = new THREE.Quaternion();
  private eyeFov = 72;
  /** 上一帧演出改过镜头的视角（没改过时视角就是玩家自己的） */
  private overrode = false;
  /** 上一帧实际用的机位（跳过时从这里落回眼睛） */
  private readonly lastPos = new THREE.Vector3();
  private readonly lastQ = new THREE.Quaternion();
  private lastFov = 72;
  private readonly root: HTMLDivElement;
  private readonly cardEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private bannerT = 0;
  private readonly seen = new Set<string>();
  /** 已放过的演出（试玩脚本检查） */
  readonly played: string[] = [];
  /** 放过的镜头表（导出给 Unity 的 BossIntroDirector） */
  readonly tables = new Map<string, ReturnType<typeof shotTable>>();
  /** 镜头避让（PlayMode 给）：从 look 往 pos 走，碰到地形 / 碰撞体就把 pos 拉回来 */
  clip: ((look: THREE.Vector3, pos: THREE.Vector3) => void) | null = null;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'cine';
    this.root.innerHTML = '<div class="bar t"></div><div class="bar b"></div><div class="card"></div><div class="banner"></div><div class="skip">按任意键跳过</div>';
    document.body.appendChild(this.root);
    this.cardEl = this.root.querySelector('.card')!;
    this.bannerEl = this.root.querySelector('.banner')!;
    try { for (const k of JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]) this.seen.add(k); } catch { /* 隐私模式 */ }
  }

  get active(): boolean { return this.shot !== null; }
  /** 演出接管了镜头 / 锁住玩家（包括落回眼睛之后的淡入） */
  get locked(): boolean { return !!this.shot && (this.shot.lock ?? !!(this.shot.cam || this.shot.shots)); }
  /** 演出正在用自己的机位（武器藏起来） */
  get takesCamera(): boolean { return !!this.shot && !!this.camFn && this.phase !== 'handoff'; }
  /** 这段演出现在能不能跳过 */
  get canSkip(): boolean {
    const s = this.shot;
    if (!s || this.phase !== 'cam') return false;
    return s.skippable === true || (!!s.skipKey && this.seen.has(s.skipKey));
  }

  play(shot: Shot): void {
    if (this.shot) this.finish();
    this.shot = shot;
    this.t = 0;
    this.phase = 'cam';
    this.camFn = shot.shots ? shotList(shot.shots) : shot.cam ?? null;
    this.played.push(shot.name);
    if (shot.shots) this.tables.set(shot.name, shotTable(shot));
    const bars = !!shot.bars || (!!this.camFn && shot.bars !== false);
    this.root.classList.toggle('on', bars);
    this.root.classList.toggle('canskip', this.canSkip);
    if (this.camFn && this.locked) this.uiAlpha = 0;
  }

  /** 只放一条横幅（不接管镜头） */
  banner(text: string, dur = 2.6): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('show');
    this.bannerT = dur;
  }

  /** 按键跳过：从当前机位平滑落回眼睛（剩下的演出动作快进跑完） */
  skip(): void {
    const s = this.shot;
    if (!s || !this.canSkip) return;
    if (s.tick) for (let t = this.t; t < s.dur; t += 1 / 30) s.tick(Math.min(s.dur, t + 1 / 30), 1 / 30);
    this.t = s.dur;
    this.cardEl.classList.remove('show');
    // 落回时长按离眼睛多远定：近 0.8 秒，40 m 外的全景 1.6 秒
    if (this.camFn) { this.phase = 'skip'; this.skipT = 0; this.skipDur = THREE.MathUtils.clamp(0.6 + this.lastPos.distanceTo(this.eyePos) / 40, 0.8, 1.6); } else this.toHandoff();
  }

  private toHandoff(): void {
    const s = this.shot!;
    if (s.skipKey) {
      this.seen.add(s.skipKey);
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...this.seen])); } catch { /* 隐私模式 */ }
    }
    this.root.classList.remove('on');
    this.cardEl.classList.remove('show');
    if ((s.handoff ?? 0) > 0) { this.phase = 'handoff'; this.hoT = 0; } else this.finish();
  }

  private finish(): void {
    const s = this.shot!;
    this.shot = null;
    this.camFn = null;
    this.uiAlpha = 1;
    this.root.classList.remove('on');
    this.cardEl.classList.remove('show');
    s.onEnd?.();
  }

  /**
   * 每帧最先调：记下玩家的眼睛（镜头此刻还是第一人称），推进演出；返回游戏时间倍率。realDt：真实时间。
   */
  update(realDt: number, camera: THREE.PerspectiveCamera): { scale: number; gameDt: number } {
    // 眼睛的位置、朝向每帧由行走重新摆好；视角检视页不重置，只在没有演出时记（演出中冻结，结束时还原）
    this.eyePos.copy(camera.position);
    this.eyeQ.copy(camera.quaternion);
    if (!this.overrode) this.eyeFov = camera.fov;
    this.bannerT -= realDt;
    if (this.bannerT <= 0) this.bannerEl.classList.remove('show');
    const s = this.shot;
    if (!s) { this.uiAlpha = 1; return { scale: 1, gameDt: realDt }; }
    if (this.phase === 'skip') {
      this.skipT += realDt;
      if (this.skipT >= this.skipDur) this.toHandoff();
      return { scale: 1, gameDt: realDt };
    }
    if (this.phase === 'handoff') {
      this.hoT += realDt;
      const ho = s.handoff ?? 0;
      this.uiAlpha = smooth(this.hoT / ho);
      if (this.hoT >= ho) this.finish();
      return { scale: 1, gameDt: realDt };
    }
    const scale = s.slow ? s.slow(this.t) : 1;
    this.t += realDt;
    const gameDt = realDt * scale;
    s.tick?.(Math.min(this.t, s.dur), gameDt);
    const c = s.card;
    if (c) {
      const show = this.t >= c.at && this.t < c.at + c.dur;
      if (show && !this.cardEl.classList.contains('show')) {
        this.cardEl.className = `card${c.big ? ' big' : ''}`;
        this.cardEl.innerHTML = `<b>${c.title}</b>${c.sub ? `<span>${c.sub}</span>` : ''}<hr>${c.quote ? `<i>${c.quote}</i>` : ''}`;
        void this.cardEl.offsetWidth;
        this.cardEl.classList.add('show');
      } else if (!show) this.cardEl.classList.remove('show');
    }
    if (s.banner && this.t >= s.banner.at && this.t - realDt < s.banner.at + 1e-6) this.banner(s.banner.text, s.banner.dur);
    if (this.t >= s.dur) this.toHandoff();
    return { scale, gameDt };
  }

  /** 每帧最后调：演出接管镜头时覆盖机位（开头从眼睛融进来，结尾平滑落回眼睛） */
  apply(camera: THREE.PerspectiveCamera): void {
    const s = this.shot;
    if (!s || !this.camFn || this.phase === 'handoff') {
      // 演出（不管怎么结束的）改过视角：还给玩家
      if (this.overrode) { camera.fov = this.eyeFov; camera.updateProjectionMatrix(); this.overrode = false; }
      return;
    }
    this.overrode = true;
    if (this.phase === 'skip') {
      // 从按键那一刻的机位落回眼睛
      const k = smoother(this.skipT / this.skipDur);
      camera.position.lerpVectors(this.lastPos, this.eyePos, k);
      camera.quaternion.slerpQuaternions(this.lastQ, this.eyeQ, k);
      camera.fov = this.lastFov + (this.eyeFov - this.lastFov) * k;
      camera.updateProjectionMatrix();
      return;
    }
    const t = Math.min(this.t, s.dur);
    this.camFn(t, this.key);
    this.clip?.(this.key.look, this.key.pos);
    const land = s.landDur ?? 0.6;
    const kIn = smooth(t / 0.5), kOut = smoother((s.dur - t) / land);
    const k = Math.min(kIn, kOut);
    _m.lookAt(this.key.pos, this.key.look, _up);
    _q.setFromRotationMatrix(_m);
    camera.position.lerpVectors(this.eyePos, this.key.pos, k);
    camera.quaternion.slerpQuaternions(this.eyeQ, _q, k);
    camera.fov = this.eyeFov + (this.key.fov - this.eyeFov) * k;
    camera.updateProjectionMatrix();
    this.lastPos.copy(camera.position);
    this.lastQ.copy(camera.quaternion);
    this.lastFov = camera.fov;
    this.root.classList.toggle('canskip', this.canSkip);
  }
}

/** 常用机位：绕 center 转的环绕镜头（半径 r、高 h，从角度 a0 转到 a1），看向 center + lookUp */
export function orbitCam(center: THREE.Vector3, r: number, h: number, a0: number, a1: number, dur: number, lookUp = 2, fov = 55): (t: number, out: CamKey) => void {
  return (t, out) => {
    const k = smooth(t / dur), a = a0 + (a1 - a0) * k;
    out.pos.set(center.x + Math.sin(a) * r, center.y + h, center.z + Math.cos(a) * r);
    out.look.set(center.x, center.y + lookUp, center.z);
    out.fov = fov;
  };
}

/** 推拉镜头：机位从 a 移到 b、看的点从 la 移到 lb（缓入缓出） */
export function dollyCam(a: THREE.Vector3, b: THREE.Vector3, la: THREE.Vector3, lb: THREE.Vector3, dur: number, fov0 = 55, fov1 = fov0): (t: number, out: CamKey) => void {
  return (t, out) => {
    const k = smooth(t / dur);
    out.pos.lerpVectors(a, b, k);
    out.look.lerpVectors(la, lb, k);
    out.fov = fov0 + (fov1 - fov0) * k;
  };
}
