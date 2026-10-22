/**
 * 游玩模式的 HUD：血 / 护盾、弹药、技能冷却、秘卷、目标、领主血条与破防条、提示、伤害数字与反应浮字、受击暗角、命中标记、
 * 秘卷三选一的样式、通关结算。
 */
import * as THREE from 'three';
import type { PlayerState } from './core';

export interface BossBar { label: string; hp: number; maxHp: number; phase: number; phaseName: string; breakK: number; broken: boolean }

const CSS = `
#play-hud{position:fixed;inset:0;pointer-events:none;font-family:"Microsoft YaHei",sans-serif;color:#fff;z-index:20}
#play-hud .bars{position:absolute;left:50%;transform:translateX(-50%);bottom:54px;width:340px;text-align:center}
#play-hud .bar{height:12px;background:#0008;border:1px solid #fff4;border-radius:3px;margin-top:6px;overflow:hidden}
#play-hud .bar i{display:block;height:100%}
#play-hud .shield i{background:linear-gradient(90deg,#6ad6ff,#b8f0ff)}
#play-hud .hp i{background:linear-gradient(90deg,#e8434a,#ff8a6a)}
#play-hud .num{font-size:13px;text-shadow:0 1px 2px #000}
#play-hud .ammo{position:absolute;right:28px;bottom:24px;font-size:34px;font-weight:bold;text-shadow:0 2px 4px #000}
#play-hud .ammo small{font-size:16px;opacity:.75}
#play-hud .skills{position:absolute;right:28px;bottom:78px;display:flex;gap:10px}
#play-hud .sk{width:54px;height:54px;border-radius:8px;background:#0009;border:2px solid #ffb04a;position:relative;overflow:hidden;text-align:center;font-size:11px;line-height:1.2}
#play-hud .sk b{display:block;font-size:17px;margin-top:6px;color:#ffd27a}
#play-hud .sk i{position:absolute;left:0;right:0;bottom:0;background:#000b}
#play-hud .sk span{position:relative}
#play-hud .scrolls{position:absolute;left:16px;top:104px;font-size:13px;line-height:1.6;text-shadow:0 1px 2px #000;color:#e8d6ff}
#play-hud .obj{position:absolute;left:50%;top:14px;transform:translateX(-50%);font-size:14px;background:#0007;padding:6px 14px;border-radius:4px;white-space:nowrap}
#play-hud .fires{position:absolute;left:16px;top:78px;font-size:16px;font-weight:bold;color:#9ff0ff;text-shadow:0 1px 3px #000}
#play-hud .boss{position:absolute;left:50%;top:46px;transform:translateX(-50%);width:560px;display:none;text-align:center}
#play-hud .boss .bar{height:14px}
#play-hud .boss .hpb i{background:linear-gradient(90deg,#b2186f,#ff4fd8)}
#play-hud .boss .brk{height:6px;margin-top:3px;border-color:#ffd27a55}
#play-hud .boss .brk i{background:linear-gradient(90deg,#c88a1a,#ffe08a)}
#play-hud .boss.broken .brk i{background:#fff;animation:brk .3s infinite alternate}
@keyframes brk{from{opacity:.4}to{opacity:1}}
#play-hud .boss b{font-size:18px;text-shadow:0 1px 3px #000;letter-spacing:2px}
#play-hud .boss small{font-size:13px;opacity:.85;margin-left:8px}
#play-hud .say{position:absolute;left:50%;top:22%;transform:translateX(-50%);font-size:20px;font-weight:bold;text-shadow:0 2px 6px #000;transition:opacity .4s;white-space:nowrap}
#play-hud .prompt{position:absolute;left:50%;top:60%;transform:translateX(-50%);font-size:16px;text-shadow:0 1px 3px #000;text-align:center}
#play-hud .prompt .bar{width:180px;margin:6px auto 0}
#play-hud .prompt i{background:#9ff0ff}
#play-hud .vig{position:absolute;inset:0;box-shadow:inset 0 0 160px #e00;opacity:0;transition:opacity .25s}
#play-hud .vig.shock{box-shadow:inset 0 0 160px #e04ad0}
#play-hud .dodge{position:absolute;inset:0;box-shadow:inset 0 0 120px #9ff0ff;opacity:0}
#play-hud .hitm{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;opacity:0;
  background:linear-gradient(45deg,transparent 45%,#fff 45%,#fff 55%,transparent 55%),linear-gradient(-45deg,transparent 45%,#fff 45%,#fff 55%,transparent 55%)}
#play-hud .cross{position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:#fff;box-shadow:0 0 2px #000}
#play-hud .center{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);text-align:center;text-shadow:0 2px 8px #000}
#play-hud .center b{font-size:34px;display:block}
#play-hud .center span{font-size:16px;opacity:.85}
#play-hud .dmg{position:absolute;font-weight:bold;font-size:15px;text-shadow:0 1px 2px #000;transform:translate(-50%,-50%);white-space:nowrap}
#play-hud .dmg.rx{font-size:22px;letter-spacing:2px}
#play-hud .loading{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:18px;background:#000a;padding:12px 20px;border-radius:6px}
#play-hud .win{position:absolute;inset:0;background:#000b;display:none;align-items:center;justify-content:center;flex-direction:column;pointer-events:auto}
#play-hud .win h2{font-size:40px;margin:0 0 10px;color:#ffe08a}
#play-hud .win p{margin:4px;font-size:17px}
#play-hud .win button{margin-top:18px;font-size:16px;padding:8px 22px;cursor:pointer}
#scroll-offer{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:40;background:#0b0a14e8;border:1px solid #fff3;border-radius:10px;padding:16px 20px;color:#fff;font-family:"Microsoft YaHei",sans-serif;text-align:center}
#scroll-offer h3{margin:0 0 12px;font-size:20px;color:#ffe6a8}
#scroll-offer h3 small{font-size:13px;opacity:.7;margin-left:8px}
#scroll-offer .cards{display:flex;gap:12px}
#scroll-offer .card{width:190px;border:2px solid;border-radius:8px;padding:10px;background:#ffffff0d;cursor:pointer;text-align:left;position:relative}
#scroll-offer .card:hover{background:#ffffff1f}
#scroll-offer .card b{font-size:18px;display:block;margin:2px 0 6px}
#scroll-offer .card p{margin:0;font-size:13px;line-height:1.5}
#scroll-offer .card i{display:block;margin-top:8px;font-size:12px;opacity:.75;font-style:normal;color:#ffd27a}
#scroll-offer .card kbd{position:absolute;right:8px;top:8px;font-size:12px;opacity:.6}
`;

const ELEM_HEX: Record<string, string> = { fire: '#ffb070', shock: '#ff8ae6', corrode: '#a6ec7a' };

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly el: Record<string, HTMLElement> = {};
  private sayT = 0;
  private vig = 0;
  private dodgeT = 0;
  private hitT = 0;
  private readonly nums: { el: HTMLDivElement; pos: THREE.Vector3; t: number; life: number }[] = [];
  private readonly _p = new THREE.Vector3();
  private lastSay = '';

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'play-hud';
    this.root.innerHTML = `
      <div class="vig"></div><div class="dodge"></div>
      <div class="fires"></div>
      <div class="scrolls"></div>
      <div class="obj"></div>
      <div class="boss"><b></b><small></small><div class="bar hpb"><i></i></div><div class="bar brk"><i></i></div></div>
      <div class="say"></div>
      <div class="cross"></div><div class="hitm"></div>
      <div class="prompt"><span></span><div class="bar"><i></i></div></div>
      <div class="center"><b></b><span></span></div>
      <div class="bars"><div class="num"></div><div class="bar shield"><i></i></div><div class="bar hp"><i></i></div></div>
      <div class="skills"><div class="sk q"><i></i><span><b>Q</b>尾焰火灵</span></div><div class="sk e"><i></i><span><b>E</b>燃爆雷</span></div></div>
      <div class="ammo"></div>
      <div class="loading"></div>
      <div class="win"><h2>通关</h2><div class="stats"></div><button>再打一遍</button></div>`;
    document.body.appendChild(this.root);
    for (const k of ['vig', 'dodge', 'fires', 'scrolls', 'obj', 'boss', 'say', 'hitm', 'prompt', 'center', 'bars', 'ammo', 'loading', 'win']) this.el[k] = this.root.querySelector(`.${k}`)!;
    this.el.skQ = this.root.querySelector('.sk.q i')!;
    this.el.skE = this.root.querySelector('.sk.e i')!;
    (this.root.querySelector('.win button') as HTMLButtonElement).onclick = () => location.reload();
  }

  /** 截图时隐藏 / 显示整个 HUD */
  set visible(v: boolean) { this.root.style.display = v ? '' : 'none'; }
  /** 演出时淡出、落回第一人称后淡入 */
  set alpha(v: number) { const s = v >= 0.999 ? '' : String(v); if (this.root.style.opacity !== s) this.root.style.opacity = s; }

  loading(text: string): void {
    this.el.loading.textContent = text;
    this.el.loading.style.display = text ? '' : 'none';
  }

  say(text: string, seconds: number): void {
    this.el.say.textContent = text;
    this.el.say.style.opacity = '1';
    this.sayT = seconds;
    this.lastSay = text;
  }

  get said(): string { return this.lastSay; }

  center(title: string, sub: string): void {
    (this.el.center.querySelector('b') as HTMLElement).textContent = title;
    (this.el.center.querySelector('span') as HTMLElement).textContent = sub;
  }

  hurt(_dmg: number, shieldOnly: boolean, shock: boolean): void {
    this.vig = shieldOnly ? 0.35 : 0.8;
    this.el.vig.classList.toggle('shock', shock);
  }

  dodged(): void { this.dodgeT = 0.35; }

  hitmark(weak: boolean, killed: boolean): void {
    this.hitT = 0.12;
    this.el.hitm.style.filter = killed ? 'drop-shadow(0 0 4px #f44) brightness(1.2) sepia(1) hue-rotate(-50deg) saturate(6)' : weak ? 'sepia(1) saturate(8) hue-rotate(10deg)' : '';
    this.el.hitm.style.transform = killed ? 'scale(1.5) rotate(45deg)' : weak ? 'scale(1.25)' : '';
  }

  damageNumber(at: THREE.Vector3, dealt: number, weak: boolean, elem?: string): void {
    if (dealt <= 0.5) return;
    this.float(at, String(Math.round(dealt)), weak ? '#ffd24a' : elem ? ELEM_HEX[elem] ?? '#fff' : '#ffffff', weak ? 19 : 15, 0.8, '');
  }

  /** 反应名浮字（焚雷 / 熔金 / 封脉） */
  label(at: THREE.Vector3, text: string, color: string): void { this.float(at, text, color, 22, 1.1, 'rx'); }

  private float(at: THREE.Vector3, text: string, color: string, size: number, life: number, cls: string): void {
    const el = document.createElement('div');
    el.className = `dmg ${cls}`;
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    this.root.appendChild(el);
    this.nums.push({ el, pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)), t: 0, life });
    if (this.nums.length > 40) { const n = this.nums.shift()!; n.el.remove(); }
  }

  numbers(camera: THREE.Camera, dt: number): void {
    for (const n of this.nums) {
      n.t += dt;
      this._p.copy(n.pos).setY(n.pos.y + n.t * 1.2).project(camera);
      const vis = this._p.z < 1 && n.t < n.life;
      n.el.style.display = vis ? '' : 'none';
      n.el.style.left = `${(this._p.x * 0.5 + 0.5) * innerWidth}px`;
      n.el.style.top = `${(-this._p.y * 0.5 + 0.5) * innerHeight}px`;
      n.el.style.opacity = String(1 - (n.t / n.life) ** 2);
    }
    for (let i = this.nums.length - 1; i >= 0; i--) if (this.nums[i].t >= this.nums[i].life) { this.nums[i].el.remove(); this.nums.splice(i, 1); }
  }

  prompt(text: string, progress: number): void {
    (this.el.prompt.querySelector('span') as HTMLElement).textContent = text;
    const bar = this.el.prompt.querySelector('.bar') as HTMLElement;
    bar.style.display = progress > 0 ? '' : 'none';
    (bar.querySelector('i') as HTMLElement).style.width = `${progress * 100}%`;
  }

  update(dt: number, P: PlayerState, ammo: number, mag: number, reloading: boolean, fires: string, boss: BossBar | null, objective: string,
    skills: { q: number; e: number; qMax: number; eMax: number }, scrolls: string[]): void {
    this.sayT -= dt;
    if (this.sayT <= 0) this.el.say.style.opacity = '0';
    this.vig = Math.max(0, this.vig - dt * 1.5);
    this.el.vig.style.opacity = String(this.vig);
    this.dodgeT = Math.max(0, this.dodgeT - dt);
    this.el.dodge.style.opacity = String(this.dodgeT * 2);
    this.hitT -= dt;
    this.el.hitm.style.opacity = this.hitT > 0 ? '1' : '0';
    (this.el.bars.querySelector('.num') as HTMLElement).textContent = `护盾 ${Math.ceil(P.shield)} / ${P.maxShield}　生命 ${Math.ceil(P.hp)} / ${P.maxHp}${P.dmgMul > 1 ? `　伤害 ×${P.dmgMul.toFixed(1)}` : ''}`;
    (this.el.bars.querySelector('.shield i') as HTMLElement).style.width = `${(P.shield / P.maxShield) * 100}%`;
    (this.el.bars.querySelector('.hp i') as HTMLElement).style.width = `${(P.hp / P.maxHp) * 100}%`;
    this.el.ammo.innerHTML = reloading ? '换弹…' : `${ammo}<small> / ${mag}</small>`;
    this.el.skQ.style.height = `${(skills.q / skills.qMax) * 100}%`;
    this.el.skE.style.height = `${(skills.e / skills.eMax) * 100}%`;
    this.el.fires.textContent = fires;
    this.el.fires.style.display = fires ? '' : 'none';
    this.el.scrolls.innerHTML = scrolls.length ? `秘卷<br>${scrolls.join('<br>')}` : '';
    this.el.obj.textContent = objective;
    this.el.obj.style.display = objective ? '' : 'none';
    this.el.boss.style.display = boss ? 'block' : 'none';
    if (boss) {
      (this.el.boss.querySelector('b') as HTMLElement).textContent = boss.label;
      (this.el.boss.querySelector('small') as HTMLElement).textContent = boss.phaseName;
      (this.el.boss.querySelector('.hpb i') as HTMLElement).style.width = `${(boss.hp / boss.maxHp) * 100}%`;
      (this.el.boss.querySelector('.brk i') as HTMLElement).style.width = `${(boss.broken ? 1 : boss.breakK) * 100}%`;
      this.el.boss.classList.toggle('broken', boss.broken);
    }
  }

  victory(title: string, lines: string[]): void {
    this.el.win.style.display = 'flex';
    (this.el.win.querySelector('h2') as HTMLElement).textContent = title;
    (this.el.win.querySelector('.stats') as HTMLElement).innerHTML = lines.map(l => `<p>${l}</p>`).join('');
    document.exitPointerLock();
  }
}
