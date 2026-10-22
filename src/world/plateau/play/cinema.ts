/**
 * 演出（chuanzang-combat-v1.md 第 4 节「领主通用」）：领主登场、转阶段、死亡的镜头、名字卡、黑边、慢放。
 * 一段演出（Shot）给出每一时刻的机位；开头 0.5 秒从玩家的眼睛融进去，结尾 0.6 秒融回眼睛（镜头不跳）。
 * 演出期间玩家不能动、不受伤（PlayMode 看 inputLocked / invulnerable）。按任意键跳过：后面的演出 6 倍速放完，
 * 领主的演出动作照样走完，状态和不跳过时一样。
 */
import * as THREE from 'three';

export interface CamKey { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

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
  /** t 秒时的机位（世界坐标）；不给 = 不接管镜头（只放名字卡 / 慢放） */
  cam?: (t: number, out: CamKey) => void;
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
  skippable?: boolean;
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
#cine.on .skip{opacity:1}
`;

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const smooth = (k: number): number => { const x = Math.min(1, Math.max(0, k)); return x * x * (3 - 2 * x); };

export class Cinema {
  shot: Shot | null = null;
  t = 0;
  private fast = false;
  private readonly key: CamKey = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 72 };
  private readonly eyePos = new THREE.Vector3();
  private readonly eyeQ = new THREE.Quaternion();
  private eyeFov = 72;
  private readonly root: HTMLDivElement;
  private readonly cardEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private bannerT = 0;
  /** 已放过的演出（试玩脚本检查） */
  readonly played: string[] = [];
  /** 镜头避让（PlayMode 给）：从 look 往 pos 走，碰到地形 / 碰撞体就把 pos 拉回来 */
  clip: ((look: THREE.Vector3, pos: THREE.Vector3) => void) | null = null;
  /** 无头试玩时不放 DOM 动画以外的东西；截图需要名字卡时照常显示 */

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
  }

  get active(): boolean { return this.shot !== null; }
  /** 演出接管了镜头 / 锁住玩家 */
  get locked(): boolean { return !!this.shot && (this.shot.lock ?? !!this.shot.cam); }

  play(shot: Shot): void {
    if (this.shot) this.finish();
    this.shot = shot;
    this.t = 0;
    this.fast = false;
    this.played.push(shot.name);
    this.root.classList.toggle('on', !!shot.bars || (!!shot.cam && shot.bars !== false));
    (this.root.querySelector('.skip') as HTMLElement).style.display = shot.skippable === false ? 'none' : '';
  }

  /** 只放一条横幅（不接管镜头） */
  banner(text: string, dur = 2.6): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('show');
    this.bannerT = dur;
  }

  skip(): void { if (this.shot && this.shot.skippable !== false) this.fast = true; }

  private finish(): void {
    const s = this.shot!;
    this.shot = null;
    this.root.classList.remove('on');
    this.cardEl.classList.remove('show');
    s.onEnd?.();
  }

  /**
   * 每帧最先调：记下玩家的眼睛（镜头此刻还是第一人称），推进演出；返回游戏时间倍率。
   * realDt：真实时间。
   */
  update(realDt: number, camera: THREE.PerspectiveCamera): { scale: number; gameDt: number } {
    this.eyePos.copy(camera.position);
    this.eyeQ.copy(camera.quaternion);
    this.eyeFov = camera.fov;
    this.bannerT -= realDt;
    if (this.bannerT <= 0) this.bannerEl.classList.remove('show');
    const s = this.shot;
    if (!s) return { scale: 1, gameDt: realDt };
    const speed = this.fast ? 6 : 1;
    const scale = (s.slow ? s.slow(this.t) : 1);
    const dt = realDt * speed;
    this.t += dt;
    const gameDt = dt * scale;
    s.tick?.(this.t, gameDt);
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
    if (s.banner && this.t >= s.banner.at && this.t < s.banner.at + 0.1) this.banner(s.banner.text, s.banner.dur);
    if (this.t >= s.dur) this.finish();
    return { scale, gameDt };
  }

  /** 每帧最后调：演出接管镜头时覆盖机位（开头、结尾和眼睛融合） */
  apply(camera: THREE.PerspectiveCamera): void {
    const s = this.shot;
    if (!s || !s.cam) return;
    s.cam(Math.min(this.t, s.dur), this.key);
    this.clip?.(this.key.look, this.key.pos);
    const kIn = smooth(this.t / 0.5), kOut = smooth((s.dur - this.t) / 0.6);
    const k = Math.min(kIn, kOut);
    _m.lookAt(this.key.pos, this.key.look, _up);
    _q.setFromRotationMatrix(_m);
    camera.position.lerpVectors(this.eyePos, this.key.pos, k);
    camera.quaternion.slerpQuaternions(this.eyeQ, _q, k);
    camera.fov = this.eyeFov + (this.key.fov - this.eyeFov) * k;
    camera.updateProjectionMatrix();
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
