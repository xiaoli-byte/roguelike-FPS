/**
 * 熔心魔将 v2（Unity Bosses/Warlord/WarlordBrain.cs 的网页版；定义 WarlordDef.ts，招式 WarlordMoves.ts，模型 / 片段 WarlordModel.ts + WarlordPoser.ts，
 * 登场 WarlordIntro.ts，特效 WarlordFx.ts）。首领框架（framework/BossBrain）之上加这几层：
 *   · 动作导演：招式调 act 起片段（片段按「出手事件在片段里的位置」拉伸到实际时间轴）；释放帧（判定那一刻）调 bladeStroke / iaiCut / … ，
 *     等片段的 hit / impact / cast 事件再放顿帧（只冻魔将自己的动作 0.04×，之后 ×1.6 追回）+ 震屏 + 刀光；0.15 s（且 ≥ 4 帧）没等到按判定时刻兜底。
 *   · 登场：从 34 m 高处砸进场地（模型下落，身后拖火），落地播 introLand（单膝跪地插剑 → 抬头怒视），70% 时从缩身那一帧接着咆哮；结束提示「胸口的地火之心是弱点」。
 *   · 读招轮廓：前摇里本体甲缝熔铜跳着烧亮、大剑烧亮；收招喘息是破绽窗口（胸口地火之心一跳一跳地亮）。
 *   · 狂怒（20%）：咆哮炸开那一帧白热冲击环（狂怒换挡），之后铠甲 / 剑身转白热铜、两肩冒火、背后飘紫褐烟；陨石雨冷却缩到 7 s，三阶段起每 2.4 s 一颗零星陨石。
 *   · 转身时目光领先：招式间隙里头先转、上身跟一半（叠在动画之上）。
 *   · 场地：Unity 是 3-3 的 BossArena（矩形 88 × 88 m，出生点在火神殿高台上）；网页按场景文档 bosses[0] 的中心，半径取到出生点也在场内。
 * 与 Unity 的差异（M7 / M11b 再补）：熔铜渠（FoundryChannels）没导出，涨落走环带兜底；本体发光遮罩（T_Boss_Warlord_E）没有，甲缝熔铜用本体贴图当自发光遮罩；
 * 火尾 / 火舌体积（Surge / FlameTongue）换成粒子。
 * 网址带 ?dev 时（只在开发服务器里）挂 window.__warlord 调试钩子（跳演出、跳阶段、强制出招），生产构建里整段不存在。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { BossBrain, hexColor } from './framework/BossBrain';
import type { BossMove } from './framework/BossMove';
import { DefeatTimeline } from './framework/DefeatSequence';
import { BossIntroDirector, introEnabled, type DirectedBoss } from './intro/BossIntroDirector';
import { EMBERS, FIRE, RAGE, WarlordDef, WarlordPalette as Pal, WarlordSword, SwordWave, BladeCombo } from './WarlordDef';
import * as Fx from './WarlordFx';
import { buildWarlordIntro } from './WarlordIntro';
import { buildWarlord, WarlordAnimator, type WarlordRig } from './WarlordModel';
import { createWarlordMove, IaiMove, ThrustMove, WaveRunner } from './WarlordMoves';

/** 敌人名册里的条目（首领自己的耐久按 WarlordDef 的定档表另算；这里是难度 1 的参考值 = 定档 ÷ 2.92） */
export const WARLORD_DEF: EnemyDef = {
  id: 'boss_warlord', name: '熔心魔将 · 熔火深渊的统帅', hp: 18000 / 2.92, shield: 4600 / 2.92, armor: 5000 / 2.92,
  speed: 4.6, radius: 1.3, height: 3.6, damage: 24, coins: [60, 100], essence: 60,
  isBoss: true, headY: 3.47, headRadius: 0.45, knockbackResist: 1, color: 0xff5a1f,
};

/** 登场停顿片段、咆哮里缩身那一帧（12 / 72） */
const INTRO_LAND = 'introLand', ROAR_GATHER_AT = 12 / 72;
/** 顿帧时动作的倍速、顿完追回欠下时间的倍速 */
const HOLD_SPEED = 0.04, CATCH_UP = 1.6;
/** 转身时「目光领先」：度 / (度每秒)、上限（度） */
const LEAD_PER_RATE = 0.16, LEAD_MAX = 26;
/** 台沿：前方落差多少算台沿（米） */
const LEDGE_DROP = 2;
const GRAVITY = 26;
const DEG = Math.PI / 180;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

interface Dash {
  vx: number; vz: number; vy: number; g: number;
  run: number; travelled: number; guarded: boolean;
  hitWall: boolean; hitLedge: boolean; grounded: boolean; spent: boolean;
  last: THREE.Vector3;
}

interface ArenaDoc {
  bosses?: { id: string; position: number[]; center: number[]; floorY: number; radius: number }[];
}

export class Warlord extends BossBrain implements DirectedBoss {
  readonly wdef: WarlordDef;
  rig!: WarlordRig;
  animator!: WarlordAnimator;
  readonly waves: WaveRunner;
  director: BossIntroDirector | null = null;
  /** StageDirector 读：登场演出自己打名字卡，不再打横幅 */
  introDirected = false;
  readonly introOffset = new THREE.Vector3();

  // ───────────── 状态（测试 / 调试读） ─────────────
  lastAct: string | null = null;
  actsFired = 0;
  dropNow = 0;
  landed = false;
  /** 铠甲的炽热程度（0 → 阶段数，平滑跟随） */
  heat = 0;
  /** 狂怒换挡的外观程度（0..1） */
  furyLook = 0;
  furyShifted = false;
  /** 前摇亮度（0..1） */
  windupGlow = 0;
  seamGlow = 0;
  coreGlow = 0;
  exposures = 0;
  ambientMeteors = 0;
  releases = 0;
  fxFallbacks = 0;
  holds = 0;
  lastStrike: string | null = null;
  lastHitSkew = 0;
  /** 危险物打中玩家的次数 */
  playerHits = 0;

  private roared = false;
  private actMissing = false;
  private pendingFx: (() => void) | null = null;
  private pendingFrames = 0;
  private strikeAt = -1;
  private hitSeenAt = -1;
  private holdUntil = -1;
  private holdDebt = 0;
  private strikeFlare = 0;
  private exposeUntil = -1;
  private ambientAcc = 0;
  private fxAcc = 0;
  private dragAcc = 0;
  private smokeAcc = 0;
  private flameAcc = 0;
  private leadYaw = 0;
  private lastFacing = 0;
  private dash: Dash | null = null;
  private defeatKneel = false;
  private defeatCollapse = false;
  private defeatLine: DefeatTimeline | null = null;
  private bodyMat: THREE.MeshStandardMaterial | null = null;
  private bodyFlash: { baseEmissive: THREE.Color; baseIntensity: number } | null = null;
  private swordMat: THREE.MeshStandardMaterial | null = null;
  private coreGlowMesh: THREE.Mesh | null = null;
  private readonly bones = new Map<string, THREE.Object3D>();

  constructor(ctx: GameContext, opts: SpawnOptions) {
    const def = new WarlordDef();
    super(ctx, WARLORD_DEF, def, opts);
    this.wdef = def;
    this.waves = new WaveRunner(this);
    this.fitArena(opts.position);
    // 危险物打中玩家计数
    const hz = this.hazards;
    const hurt = hz.hurt.bind(hz);
    hz.hurt = (base, element, from) => {
      const r = hurt(base, element, from);
      if (r > 0) this.playerHits++;
      return r;
    };
  }

  /** 场地：场景文档里离出生点最近的 boss_warlord 首领场（中心、地面高）；半径取到出生点也在场内（Unity 3-3 是 88 × 88 m 的矩形） */
  private fitArena(spawn: THREE.Vector3): void {
    this.arenaRadius = 30;
    let doc: ArenaDoc | null = null;
    try {
      doc = (this.ctx.stage as unknown as { unityDocument?: ArenaDoc | null }).unityDocument ?? null;
    } catch {
      doc = null;
    }
    const entry = doc?.bosses?.filter(b => b.id === WarlordDef.Id)
      .sort((a, b) => Math.hypot(a.position[0] - spawn.x, a.position[2] - spawn.z) - Math.hypot(b.position[0] - spawn.x, b.position[2] - spawn.z))[0];
    if (!entry || Math.hypot(entry.position[0] - spawn.x, entry.position[2] - spawn.z) > 8) return;
    this.bossCenter.set(entry.center[0], entry.floorY, entry.center[2]);
    this.arenaRadius = Math.max(entry.radius, Math.hypot(spawn.x - entry.center[0], spawn.z - entry.center[2]) + 4);
  }

  // ───────────── 模型 ─────────────

  protected override buildModel(): THREE.Object3D {
    this.rig = buildWarlord();
    this.animator = new WarlordAnimator(this.rig, (evt) => this.emitAnimEvent(evt));
    this.weakAnchor = this.rig.core;
    this.muzzleAnchor = this.rig.bladeTip;
    this.hitShapes = [
      { anchor: this.rig.core, radius: 0.45, halfHeight: 0, weak: true },
      { anchor: this.rig.chest, radius: 0.75, halfHeight: 0.85, weak: false },
      { anchor: this.rig.head, radius: 0.4, halfHeight: 0, weak: false },
      { anchor: this.rig.pauldronL, radius: 0.46, halfHeight: 0, weak: false },
      { anchor: this.rig.pauldronR, radius: 0.46, halfHeight: 0, weak: false },
      { anchor: this.rig.kneeL, radius: 0.3, halfHeight: 0.72, weak: false },
      { anchor: this.rig.kneeR, radius: 0.3, halfHeight: 0.72, weak: false },
    ];
    return this.rig.root;
  }

  protected override createMove(id: string): BossMove | null {
    return createWarlordMove(this, id);
  }

  /** 美术已挂好：原生骨骼、大剑挪到握点、命中区挂到骨上、本体 / 大剑材质；登场演出 */
  protected override onModelReady(): void {
    const host = this.model.children[0];
    const native = host.children.find(c => c !== this.rig.proc && c !== this.rig.sword && !!c.getObjectByName('socket_sword')) ?? null;
    if (native && this.animator.bindNative(native)) {
      native.traverse((o) => {
        if (o.name && !this.bones.has(o.name)) this.bones.set(o.name, o);
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh && !this.bodyMat) this.bodyMat = m.material as THREE.MeshStandardMaterial;
      });
      this.rig.proc.visible = false;
      this.mountSword();
      const bone = (n: string) => this.animator.bone(n);
      const zone = (i: number, n: string) => {
        const b = bone(n);
        if (b) this.hitShapes[i].anchor = b;
      };
      zone(0, WarlordDef.WeakBone);
      zone(1, 'spine');
      zone(2, 'head');
      zone(3, 'pauldron_L');
      zone(4, 'pauldron_R');
      zone(5, 'shin_L');
      zone(6, 'shin_R');
      this.weakAnchor = bone(WarlordDef.WeakBone) ?? this.rig.core;
      this.muzzleAnchor = bone(WarlordDef.TipBone) ?? this.rig.bladeTip;
      // 胸口地火之心：破绽窗口里一跳一跳地亮（本体没有发光遮罩，补一团加法光）
      const core = bone(WarlordDef.WeakBone);
      if (core) {
        const mat = new THREE.MeshBasicMaterial({ color: Pal.Hot, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
        this.clonedMats.push(mat);
        this.coreGlowMesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), mat);
        this.coreGlowMesh.renderOrder = 2;
        core.add(this.coreGlowMesh);
      }
      // 甲缝熔铜：本体贴图当自发光遮罩（亮的熔铜纹烧得最亮），强度跟前摇 / 狂怒 / 倒下走
      if (this.bodyMat) {
        this.bodyMat.emissiveMap = this.bodyMat.map;
        this.bodyMat.needsUpdate = true;
        this.bodyFlash = this.flashMats.find(f => f.mat === this.bodyMat) ?? null;
      }
    }
    this.setDrop(this.wdef.dropHeight);
    this.lastFacing = this.facing;
    if (introEnabled()) {
      const center = this.bossCenter.clone();
      const script = buildWarlordIntro(center);
      if (script.validate().length === 0) {
        this.director = new BossIntroDirector(this.ctx, script, this, this.position.clone());
        this.introHold = this.director;
        this.introDirected = true;
      }
    }
    if (devHookEnabled()) installDevHook(this);
  }

  /** 大剑（程序化 greatsword 挂点 + 挂上的 SM_BossWeapon_Greatsword）挪到 socket_sword 下：剑身 −Y 对准握点 → 剑尖，刃朝 ±X */
  private mountSword(): void {
    const grip = this.animator.bone(WarlordDef.GripBone), tip = this.animator.bone(WarlordDef.TipBone);
    if (!grip) return;
    const sword = this.rig.sword;
    grip.add(sword);
    sword.position.set(0, 0, 0);
    // 剑尖在握点局部的方向（v006：−Z）→ 剑的 −Y；剑首 +Y → 局部 +Z；刃 X → 局部 −X（绑定姿势下 = 模型 +X）
    const down = tip ? tip.position.clone().normalize() : new THREE.Vector3(0, 0, -1);
    const up = down.clone().negate();
    const x0 = new THREE.Vector3(-1, 0, 0);
    const x = x0.addScaledVector(up, -x0.dot(up)).normalize();
    const z = new THREE.Vector3().crossVectors(x, up).normalize();
    sword.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
    sword.scale.set(1, 1, 1);
    const art = sword.children.find(c => c.name.endsWith('_lod'));
    if (!art) {
      // 美术大剑没挂上：程序化剑身照常显示
      sword.traverse(o => { if ((o as THREE.Mesh).isMesh) o.visible = true; });
      return;
    }
    for (const c of sword.children) if (c !== art) c.visible = false;
    art.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !this.swordMat) this.swordMat = m.material as THREE.MeshStandardMaterial;
    });
    if (this.swordMat) {
      this.swordMat.emissiveMap = this.swordMat.map;
      this.swordMat.emissive.setHex(Pal.Copper);
      this.swordMat.emissiveIntensity = 0;
      this.swordMat.needsUpdate = true;
      const i = this.flashMats.findIndex(f => f.mat === this.swordMat);
      if (i >= 0) this.flashMats.splice(i, 1);
    }
  }

  private setDrop(h: number): void {
    this.dropNow = Math.max(0, h);
  }

  // ───────────── DirectedBoss ─────────────

  get name(): string {
    return this.wdef.name;
  }

  get title(): string | null {
    return this.wdef.title;
  }

  introOverlay(color: number, amount: number): void {
    if (amount > 0.001) this.setEmissive(new THREE.Color(color), amount);
  }

  get barTicks(): readonly number[] {
    return this.wdef.barTicks;
  }

  override getHeadCenter(out: THREE.Vector3): THREE.Vector3 {
    const h = this.animator?.bone(WarlordDef.HeadBone);
    if (h) return h.getWorldPosition(out).setY(out.y + 0.25);
    return this.rig.head.getWorldPosition(out);
  }

  override getBodyCenter(out: THREE.Vector3): THREE.Vector3 {
    const s = this.animator?.bone('spine');
    if (s) return s.getWorldPosition(out).setY(out.y + 0.35);
    return out.set(this.position.x, this.position.y + this.height * 0.55, this.position.z);
  }

  // ───────────── 每帧 ─────────────

  protected override think(dt: number): void {
    super.think(dt);
    this.applyDash(dt);
  }

  override update(dt: number): void {
    super.update(dt);
    this.postDash();
    if (this.waitingForSpawn) return;
    this.waves.update(dt);
    if (this.pendingFx && (!this.alive || (this.now - this.strikeAt > 0.15 && ++this.pendingFrames >= 4))) this.flushRelease(true);
    this.updateHold(dt);
    this.animator.moveSpeed = this.dash ? 0 : Math.hypot(this.velocity.x, this.velocity.z);
    this.animator.update(dt);
    this.updateLead(dt);
    this.model.position.set(this.introOffset.x, this.dropNow + this.introOffset.y, this.introOffset.z);
    this.updateLook(dt);
    this.updateFuryFlames(dt);
  }

  private get now(): number {
    return this.ctx.time.now;
  }

  /** 转身时目光领先：招式间隙里按偏航角速度把头往要转的方向先拧过去、上身跟一半 */
  private updateLead(dt: number): void {
    const free = this.alive && this.introDone && !this.currentMove && !this.staggered && !this.transitioning;
    let d = this.facing - this.lastFacing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.lastFacing = this.facing;
    const rate = free && dt > 0 ? d / dt / DEG : 0;
    this.leadYaw += (Math.min(LEAD_MAX, Math.max(-LEAD_MAX, rate * LEAD_PER_RATE)) - this.leadYaw) * (1 - Math.exp(-8 * dt));
    if (Math.abs(this.leadYaw) >= 0.2) this.animator.leadTurn(this.leadYaw * 0.45, this.leadYaw * 0.55);
  }

  /**
   * 读招轮廓（UpdateLook）：前摇中 0.25 s 升满、甲缝熔铜按 18 rad/s 跳动烧亮；狂怒换挡后常亮一档；破绽窗口里胸口地火之心按 9 rad/s 一跳一跳；倒下后 2 s 熄掉。
   * 铠甲炽热度跟阶段走；大剑前摇烧亮、释放帧再一跳（0.35 s 退回）
   */
  private updateLook(dt: number): void {
    const dead = !this.alive;
    const target = dead ? 0 : this.phase + (this.enraged ? 0.4 : 0);
    this.heat += Math.sign(target - this.heat) * Math.min(Math.abs(target - this.heat), dt * 0.8);
    this.furyLook += Math.sign((!dead && this.furyShifted ? 1 : 0) - this.furyLook) * Math.min(Math.abs((!dead && this.furyShifted ? 1 : 0) - this.furyLook), dt * (dead ? 0.6 : 2.2));
    const windup = !dead && this.currentMove !== null && this.currentMove.stage === 'windup';
    this.windupGlow += Math.sign((windup ? 1 : 0) - this.windupGlow) * Math.min(Math.abs((windup ? 1 : 0) - this.windupGlow), dt * (windup ? 4 : 2.5));
    const t = this.now;
    const pulse = this.windupGlow * (0.75 + 0.25 * Math.sin(t * 18));
    const life = dead ? Math.max(0, 1 - this.deathTime / 2) : 1;
    this.seamGlow = (0.45 + 1.5 * pulse + 0.9 * this.furyLook) * life;
    const exposed = this.exposed ? 0.65 + 0.35 * Math.sin(t * 9) : 0;
    this.coreGlow = (0.12 + 1.4 * pulse + 1.8 * this.furyLook + 1.6 * exposed) * life;
    if (this.bodyFlash) {
      this.bodyFlash.baseEmissive.setHex(Pal.copperAt(this.furyLook)).lerp(new THREE.Color(Pal.hotAt(this.furyLook)), pulse * 0.5);
      // 阶段炽热：Unity 的覆盖色 warlordFury（暗红 → 赤红）叠在甲缝上
      if (this.heat > 1) this.bodyFlash.baseEmissive.lerp(new THREE.Color(RAGE), Math.min(1, this.heat - 1) * 0.35);
      this.bodyFlash.baseIntensity = this.seamGlow * 0.42 + this.heat * 0.05;
    }
    if (this.coreGlowMesh) {
      const m = this.coreGlowMesh.material as THREE.MeshBasicMaterial;
      m.color.setHex(Pal.lerp(Pal.copperAt(this.furyLook), Pal.hotAt(this.furyLook), Math.min(1, exposed + pulse)));
      m.opacity = Math.min(0.9, Math.max(0, (this.coreGlow - 0.1) * 0.22));
      this.coreGlowMesh.scale.setScalar(0.8 + 0.25 * exposed);
    }
    this.strikeFlare = Math.max(0, this.strikeFlare - dt / 0.35);
    if (this.swordMat) {
      const heatB = dead ? 0 : Math.max(this.windupGlow, this.strikeFlare);
      this.swordMat.emissive.setHex(Pal.copperAt(this.furyLook)).lerp(new THREE.Color(Pal.hotAt(this.furyLook)), heatB * 0.6);
      this.swordMat.emissiveIntensity = (0.25 + 1.6 * heatB + 0.8 * this.furyLook) * life;
    }
  }

  /** 狂怒常驻：两肩、角盔各一团白热火、背后隔一会儿飘一团紫褐烟 */
  private updateFuryFlames(dt: number): void {
    if (this.furyLook < 0.01 || !this.alive) return;
    this.flameAcc += dt;
    if (this.flameAcc >= 0.07) {
      this.flameAcc = 0;
      for (const [n, k] of [[WarlordDef.PauldronL, 1], [WarlordDef.PauldronR, 1], [WarlordDef.HelmBone, 0.6]] as const) {
        const b = this.animator.bone(n);
        if (!b) continue;
        b.getWorldPosition(_a);
        this.ctx.fx.burst(_a, Math.random() < 0.3 ? Pal.FuryHot : Math.random() < 0.6 ? Pal.FuryCopper : Pal.FuryDeep, 2, 0.9 * k, 0.4, 0.2 * k * this.furyLook, -8);
      }
    }
    this.smokeAcc += dt;
    if (this.smokeAcc < 0.3) return;
    this.smokeAcc = 0;
    this.getBodyCenter(_a).addScaledVector(_b.set(Math.sin(this.facing), 0, Math.cos(this.facing)), -this.radius * 0.6).setY(_a.y + 0.6);
    this.ctx.fx.burst(_a, Pal.Smoke, 1, 0.5, 1.1, 0.7, -1.4);
  }

  // ───────────── 动作 ─────────────

  /** 播一个招式动作并拉伸到 seconds 秒播完（Unity Act：act_ 触发器 + ActScale） */
  act(state: string, seconds: number): void {
    if (!state) return;
    this.lastAct = state;
    this.actsFired++;
    this.resetHold();
    // 没有这个片段（或没有正式骨骼）：不会有片段事件，释放帧当帧就放
    this.actMissing = !this.animator.hasNative || !this.animator.hasState(state);
    this.animator.play(state, seconds);
  }

  /** 交叉淡入一个动作（从头播）：上一段片段可能正在退回待机时用 */
  actCrossfade(state: string, seconds: number): void {
    this.actFrom(state, seconds, 0, 0.1);
  }

  private actFrom(state: string, seconds: number, offset: number, fade = 0.1): void {
    if (!this.animator.hasState(state)) {
      this.act(state, seconds);
      return;
    }
    this.resetHold();
    this.lastAct = state;
    this.actsFired++;
    this.actMissing = !this.animator.hasNative;
    this.animator.playFrom(state, seconds, offset, fade);
  }

  override playAct(state: string, seconds: number): void {
    this.act(state, seconds);
  }

  /** 顿帧：动作冻住 seconds 秒（只冻魔将自己的动作），顿完以 ×1.6 追回欠下的时间；新的动作一起，顿帧和追赶都作废 */
  private hold(seconds: number): void {
    if (!(seconds > 0)) return;
    const until = this.now + seconds;
    const added = this.holdUntil > this.now ? Math.max(0, until - this.holdUntil) : seconds;
    this.holdUntil = Math.max(this.holdUntil, until);
    this.holdDebt += added * (1 - HOLD_SPEED);
    this.animator.speed = HOLD_SPEED;
    this.holds++;
  }

  private updateHold(dt: number): void {
    if (this.holdUntil >= 0) {
      if (this.now < this.holdUntil && this.alive) return;
      this.holdUntil = -1;
      this.animator.speed = this.holdDebt > 0.001 && this.alive ? CATCH_UP : 1;
      return;
    }
    if (this.holdDebt <= 0) return;
    this.holdDebt -= dt * (CATCH_UP - 1);
    if (this.holdDebt > 0 && this.alive) return;
    this.holdDebt = 0;
    this.animator.speed = 1;
  }

  private resetHold(): void {
    if (this.holdUntil < 0 && this.holdDebt <= 0) return;
    this.holdUntil = -1;
    this.holdDebt = 0;
    this.animator.speed = 1;
  }

  /**
   * 释放帧的表现（顿帧 + 震屏 + 出手特效）对到动作的释放帧上：招式判定那一刻登记，等片段的 hit / impact / cast 事件再放；
   * 事件先到（动作比判定早）就立刻放；0.15 s（且至少 4 帧）内没等到按判定时刻兜底放
   */
  private release(what: string, fx: () => void): void {
    this.strikeAt = this.now;
    this.lastStrike = what;
    this.pendingFx = null;
    const rigged = this.animator.hasNative && !this.actMissing;
    if (!rigged || (this.hitSeenAt >= 0 && this.now - this.hitSeenAt < 0.1)) {
      this.lastHitSkew = rigged ? this.hitSeenAt - this.strikeAt : 0;
      this.hitSeenAt = -1;
      this.releases++;
      this.strikeFlare = 1;
      this.safe(fx);
      return;
    }
    this.pendingFx = fx;
    this.pendingFrames = 0;
  }

  private flushRelease(fallback: boolean): void {
    const fx = this.pendingFx;
    this.pendingFx = null;
    if (!fx) return;
    if (fallback) this.fxFallbacks++;
    else this.lastHitSkew = this.now - this.strikeAt;
    this.releases++;
    this.strikeFlare = 1;
    this.safe(fx);
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error('[Warlord] 释放帧特效出错', err);
    }
  }

  private get fk(): number {
    return this.furyLook;
  }

  private fwd(yawDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(yawDeg * DEG), 0, Math.cos(yawDeg * DEG));
  }

  /** 剑上的点：0 = 握点、1 = 剑尖（没挂上大剑时身前） */
  private bladeAt(k: number, fwd: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const g = this.animator.bone(WarlordDef.GripBone), t = this.animator.bone(WarlordDef.TipBone);
    if (g && t) return g.getWorldPosition(out).lerp(t.getWorldPosition(_c), k);
    return this.getBodyCenter(out).addScaledVector(fwd, 1 + 2 * k);
  }

  /** 剑尖 */
  bladeTip(out = new THREE.Vector3()): THREE.Vector3 {
    return this.bladeAt(1, this.fwd(this.facing / DEG), out);
  }

  headPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return this.getHeadCenter(out);
  }

  // ───────────── 释放帧：给招式调 ─────────────

  /** 横扫的释放帧：大月牙（腰高、朝玩家低头 14°）、沿弧甩出的方铜渣、脚下紫褐尘；顿帧 0.06 s。backhand = 二阶段的反手再扫 */
  sweepStrike(ground: THREE.Vector3, yawDeg: number, backhand: boolean): void {
    const g = ground.clone();
    this.release(backhand ? 'sweepBack' : 'sweep', () => {
      this.hold(0.06);
      this.quake(0.45, 0.3);
      const dir = backhand ? -1 : 1;
      Fx.crescent(this.ctx, g.clone().setY(g.y + 1.45), yawDeg, 4.4, 64.74 * 2 * DEG, dir, 0, 1.7, this.fk, { life: 0.34, pitchDeg: 14 });
      for (let i = -1; i <= 1; i++) {
        const d = this.fwd(yawDeg + i * 38);
        const side = new THREE.Vector3(d.z, 0, -d.x).multiplyScalar(dir);
        Fx.shards(this.ctx, g.clone().addScaledVector(d, 3.6).setY(g.y + 0.9), side.negate().setY(0.3), 0.8, this.fk, i === 0);
      }
      Fx.smoke(this.ctx, g.clone().addScaledVector(this.fwd(this.facing / DEG), 0.6), 1.2, 3);
    });
  }

  /**
   * 连斩一刀的释放帧（state = slashA / slashB / slashUp / slashC）：袈裟 / 逆袈裟 = 斜月牙，上挑 = 从左下往右上翻起的月牙 + 往上甩的火星，
   * 下劈 = 竖月牙 + 刀落处重击 + 沿预警长条一节一节崩开的裂地线。刀越往后越大（每刀 +7%），狂怒多一层残月
   */
  bladeStroke(state: string, index: number, _count: number, yawDeg: number, hit: boolean, laneLength: number): void {
    const feet = this.position.clone();
    this.release(state, () => {
      const f = this.fwd(yawDeg);
      const grow = (1 + 0.07 * index) * (this.fk > 0.5 ? WarlordSword.FuryReach : 1);
      const body = this.getBodyCenter(new THREE.Vector3());
      switch (state) {
        case 'slashC': {
          this.hold(0.1);
          this.quake(0.75, 0.42);
          Fx.crescent(this.ctx, feet.clone().setY(feet.y + 2.4).addScaledVector(f, 0.5), yawDeg, 3.4 * grow, 105 * DEG, 1, -Math.PI / 2, 1.4, this.fk, { life: 0.32 });
          const at = feet.clone().addScaledVector(f, 3.2);
          at.y = this.groundY(at.x, at.z, feet.y + 2);
          Fx.impact(this.ctx, at, 2.6, this.fk);
          if (laneLength > 3.6) Fx.cleaveLine(this.ctx, at, f, laneLength - 3.2, this.fk);
          this.playSfx('boss_slam', 0.9, 1.15);
          break;
        }
        case 'slashUp': {
          this.hold(0.07);
          this.quake(0.4, 0.25);
          Fx.crescent(this.ctx, body.clone().addScaledVector(f, 0.6).setY(body.y + 0.1), yawDeg, 3.7 * grow, 120 * DEG, -1, 64 * DEG, 1.2, this.fk, { life: 0.3 });
          Fx.shards(this.ctx, this.bladeAt(0.9, f), new THREE.Vector3(0, 1, 0).addScaledVector(f, 0.3), 0.8, this.fk, false);
          Fx.smoke(this.ctx, feet.clone().addScaledVector(f, 1.6), 1, 2);
          break;
        }
        default: {
          this.hold(hit ? 0.06 : 0.045);
          this.quake(hit ? 0.35 : 0.25, 0.22);
          const dir = state === 'slashA' ? 1 : -1;
          Fx.crescent(this.ctx, body.clone().setY(body.y + 0.35), yawDeg, BladeCombo.SlashRange * 0.85 * grow, BladeCombo.SlashHalf * 2 * DEG, dir, -38 * DEG, 1.25,
            this.fk, { life: 0.3 });
          Fx.shards(this.ctx, this.bladeAt(1, f), f.clone().setY(0.4), 0.7, this.fk, false);
          break;
        }
      }
    });
  }

  /** 居合拔刀（前摇结束、突进开始）：一道白热的「一闪」直线 + 起步的紫褐尘（不顿帧） */
  iaiDraw(from: THREE.Vector3, dir: THREE.Vector3, dash: number): void {
    Fx.iaiDraw(this.ctx, from, dir, dash, this.fk);
    this.quake(0.25, 0.18);
  }

  /** 居合收刀「咔」的释放帧：整条线上的刀光现形——顿帧 0.1 s、重震、沿线一道长刀光 + 火星 + 方铜渣 */
  iaiCut(from: THREE.Vector3, dir: THREE.Vector3, length: number, halfWidth: number, hit: boolean): void {
    const f = from.clone(), d = dir.clone();
    this.release('iai', () => {
      this.hold(0.1);
      this.quake(hit ? 0.65 : 0.5, 0.35);
      Fx.iaiCut(this.ctx, f, d, length, halfWidth, this.fk);
      this.playSfx('explosion', 0.6, 1.4);
    });
  }

  /** 剑气出手的释放帧（waveSlash / waveCross / waveCross2）：刀口一弯月牙（竖剑气竖着、横剑气平放）+ 一闪，顿帧 0.06 s */
  waveSwing(what: string, yawDeg: number, vertical: boolean): void {
    this.release(what, () => {
      this.hold(0.06);
      this.quake(0.35, 0.25);
      const f = this.fwd(yawDeg);
      const p = this.position;
      if (vertical) Fx.crescent(this.ctx, p.clone().setY(p.y + 2.2).addScaledVector(f, 0.8), yawDeg, 3, 100 * DEG, 1, -Math.PI / 2, 1.2, this.fk, { life: 0.26 });
      else Fx.crescent(this.ctx, p.clone().setY(p.y + 1.1), yawDeg, 3.6, 130 * DEG, 1, 0, 1.3, this.fk, { life: 0.26, pitchDeg: 10 });
      Fx.shards(this.ctx, this.bladeAt(1, f), f.clone().setY(0.3), 0.6, this.fk, false);
    });
  }

  /** 突刺起跑：突刺片段（按跑程定长，比跑程长 0.35 s）、剑尖往前一道细长的刺光；起步紫褐尘 */
  thrustRun(dir: THREE.Vector3, runSeconds: number): void {
    this.strikeAt = this.now;
    this.lastStrike = 'thrust';
    this.releases++;
    this.act('thrust', Math.min(1.8, Math.max(0.6, runSeconds + 0.35)));
    Fx.thrustFlare(this.ctx, this.bladeTip(), dir, this.fk);
    Fx.smoke(this.ctx, this.position.clone().setY(this.position.y + 0.3), 1, 3);
    this.quake(0.3, 0.25);
  }

  /** 突刺刹住：剑尖犁地一扇火星 + 一小块方形裂纹 + 紫褐尘，同时起收刀横斩的动作（按横斩的预警拉伸） */
  thrustStop(p: THREE.Vector3, dir: THREE.Vector3, cutSeconds: number): void {
    this.actCrossfade('thrustCut', cutSeconds / WarlordSword.ThrustCutHitAt);
    const tip = this.bladeTip().setY(p.y + 0.1);
    this.ctx.fx.burst(tip, Pal.hotAt(this.fk), 14, 8, 0.35, 0.08, 12);
    Fx.ch3Crack(this.ctx, tip.clone().setY(p.y), 1.2, this.fk);
    Fx.smoke(this.ctx, p.clone().addScaledVector(dir, 0.8), 1.1, 3);
    this.quake(0.3, 0.25);
  }

  /** 收刀横斩的释放帧：一弯平放的大月牙（腰高、朝玩家低头），顿帧 */
  thrustCut(yawDeg: number, hit: boolean, range: number): void {
    this.release('thrustCut', () => {
      this.hold(hit ? 0.07 : 0.05);
      this.quake(hit ? 0.45 : 0.3, 0.25);
      const p = this.position;
      Fx.crescent(this.ctx, p.clone().setY(p.y + 1.35), yawDeg, range * 0.82, 70 * 2 * DEG, 1, 0, 1.4, this.fk, { life: 0.3, pitchDeg: 12 });
      Fx.smoke(this.ctx, p.clone().addScaledVector(this.fwd(this.facing / DEG), 0.6), 1, 2);
    });
  }

  /** 冲锋结束：撞墙 = crash（撞击点一团熔铜 + 方铜渣 + 重震，顿帧，破绽窗口），否则刹停 chargeStop */
  chargeEnd(crashed: boolean, p: THREE.Vector3, dir: THREE.Vector3): void {
    if (crashed) {
      this.act('crash', 1);
      this.expose(1);
      const at = p.clone().addScaledVector(dir, 1.2).setY(p.y + 1.4);
      this.release('crash', () => {
        this.hold(0.08);
        Fx.moltenBurst(this.ctx, at, 1.6, Pal.copperAt(this.fk));
        Fx.shards(this.ctx, at, dir.clone().negate().setY(0.5), 1.4, this.fk);
        Fx.smoke(this.ctx, at, 1.2, 4);
      });
      return;
    }
    this.act('chargeStop', 0.5);
    const tip = this.bladeTip().setY(p.y + 0.1);
    this.ctx.fx.burst(tip, Pal.hotAt(this.fk), 16, 8, 0.35, 0.08, 12);
    Fx.ch3Crack(this.ctx, tip.clone().setY(p.y), 1.3, this.fk);
    Fx.smoke(this.ctx, p.clone().addScaledVector(dir, 0.8), 1.1, 3);
    this.quake(0.3, 0.25);
  }

  /** 回旋斩的释放帧（k = 0 第一圈 / 1 二连的第二圈）：一整圈月牙 + 贴地粗环 + 方铜渣一圈往外甩，顿帧 0.07 / 0.09 s */
  spinStrike(k: number, twice: boolean, radius: number, inner: number, _hit: boolean): void {
    this.release(k === 0 ? (twice ? 'spinTwice' : 'spin') : 'spinTwice2', () => {
      this.hold(k === 0 ? 0.07 : 0.09);
      this.quake(k === 0 ? 0.5 : 0.65, 0.3);
      Fx.spinRing(this.ctx, this.position, radius, inner, this.facing / DEG, this.fk, k === 1);
    });
  }

  /** 跃击起跳：脚下紫褐尘浪 + 一圈铜火星，空中拖火（粒子） */
  leapTakeoff(from: THREE.Vector3, air: number): void {
    this.strikeAt = this.now;
    this.lastStrike = 'leap';
    Fx.smoke(this.ctx, from.clone().setY(from.y + 0.3), 1.4, 4);
    this.ctx.fx.ring(from.clone().setY(from.y + 0.08), 3, Pal.deepAt(this.fk), 0.3);
    this.ctx.fx.burst(from.clone().setY(from.y + 0.2), Pal.copperAt(this.fk), 16, 6, 0.5, 0.12, 6);
    let t = 0;
    this.ctx.tasks.add((dt) => {
      t += dt;
      if (!this.alive) return true;
      this.getBodyCenter(_a);
      this.ctx.fx.burst(_a, Math.random() < 0.5 ? FIRE : Pal.copperAt(this.fk), 3, 1.5, 0.5, 0.3, -3);
      return t >= air + 0.1;
    });
  }

  /** 跃击落地的释放帧：这一刻才播 land（剑插入地的深蹲）、重击落地、剑尖处熔铜冠、顿帧 0.09 s */
  leapLand(floor: THREE.Vector3, onMark: boolean): void {
    this.act('land', 0.8);
    const f = floor.clone();
    this.release('land', () => {
      this.hold(0.09);
      const tip = this.bladeTip().setY(f.y);
      Fx.impact(this.ctx, f, onMark ? 4.6 : 3.4, this.fk);
      Fx.moltenBurst(this.ctx, tip.setY(f.y + 0.3), 1.4, Pal.copperAt(this.fk));
    });
  }

  /** 陨石雨的释放帧（举剑号令）：剑尖冲天光柱 + 天上一团火光 */
  meteorCast(): void {
    this.release('cast', () => {
      Fx.beacon(this.ctx, this.bladeTip(), this.fk);
      this.quake(0.3, 0.4);
    });
  }

  /** 熔铜渠：大剑插地那一刻——剑尖处熔铜冠 + 方铜渣、贴地粗环、紫褐尘浪；顿帧 */
  plantStrike(ground: THREE.Vector3): void {
    const g = ground.clone();
    this.release('plant', () => {
      this.hold(0.08);
      const tip = this.bladeTip().setY(g.y);
      Fx.impact(this.ctx, tip, 2.4, this.fk);
    });
  }

  /** 首领发一颗火弹（伤害已是招式伤害；难度倍率在这里乘） */
  fireBolt(from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, color: number): void {
    this.fireProjectile(from, dir.clone().normalize(), speed, damage, { color, visual: 'flame', radius: 0.3, lifetime: 2.2, scale: 1.3, element: 'fire' });
  }

  /**
   * 破绽窗口：胸口地火之心在 seconds 秒里烧亮、一跳一跳，开头在弱点上一闪 + 一撮火星，读作「打这里」
   */
  expose(seconds: number): void {
    if (seconds <= 0.05 || !this.alive) return;
    const fresh = this.now >= this.exposeUntil;
    this.exposeUntil = Math.max(this.exposeUntil, this.now + seconds);
    this.exposures++;
    if (fresh) Fx.glare(this.ctx, (this.weakAnchor ?? this.rig.core).getWorldPosition(new THREE.Vector3()), this.fk);
  }

  get exposed(): boolean {
    return this.now < this.exposeUntil && this.alive;
  }

  // ───────────── 给招式用的走位 / 场地工具 ─────────────

  /** 朝某点转（度 / 秒） */
  facePoint(p: THREE.Vector3, degPerSec: number, dt: number): void {
    this.faceTowards(p, degPerSec * DEG, dt);
  }

  /** 往 dest 走（速度 × speedMult，夹进场地） */
  moveToward(dest: THREE.Vector3, speedMult = 1): void {
    _a.copy(dest);
    this.clampToArena(_a, this.arenaMargin);
    this.moveTo(_a, this.bdef.speed * speedMult);
  }

  /** 预测玩家 lead 秒后的位置（只取水平速度） */
  predict(lead: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.ctx.player;
    return out.set(p.position.x + p.velocity.x * lead, p.position.y, p.position.z + p.velocity.z * lead);
  }

  groundY(x: number, z: number, fromY: number): number {
    const y = this.ctx.world.groundHeight(x, z, fromY, 0.1);
    return Number.isFinite(y) && y > fromY - 40 ? y : this.position.y;
  }

  /** 从 from 沿水平方向 dir 走到场地边界（留 margin）的距离 */
  toEdge(from: THREE.Vector3, dir: THREE.Vector3, margin: number, fallback = 30): number {
    const r = this.arenaRadius - margin;
    if (!(r > 0)) return 0;
    const ox = from.x - this.bossCenter.x, oz = from.z - this.bossCenter.z;
    const l = Math.hypot(dir.x, dir.z);
    if (l < 1e-6) return fallback;
    const dx = dir.x / l, dz = dir.z / l;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - r * r;
    const disc = b * b - c;
    if (disc < 0) return 0;
    return Math.max(0, -b + Math.sqrt(disc));
  }

  /** 从 from 沿水平方向 dir 冲 want 米，台沿（前方落差 2 m 以上）之前最远能冲多远 */
  ledgeFreeRun(from: THREE.Vector3, dir: THREE.Vector3, want: number): number {
    const l = Math.hypot(dir.x, dir.z);
    if (l < 1e-6 || !(want > 0)) return want;
    const base = this.groundY(from.x, from.z, from.y + 2);
    for (let s = 0.5; s <= want + 0.6; s += 0.5) {
      const x = from.x + dir.x / l * s, z = from.z + dir.z / l * s;
      const y = this.ctx.world.groundHeight(x, z, base + 3, 0.1);
      if (!Number.isFinite(y) || y < base - LEDGE_DROP) return Math.max(0.5, Math.min(want, s - 0.6));
    }
    return want;
  }

  /** 落点：夹进场地（离边 margin 米），再贴到最近的可走地面上（还在场地里才用），最后贴地 */
  landingPoint(want: THREE.Vector3, margin: number, out: THREE.Vector3): THREE.Vector3 {
    out.copy(want);
    this.clampToArena(out, Math.max(0, margin));
    if (this.ctx.nav.nearestWalkable(out, _b) && _b.distanceTo(out) <= 4 && this.arenaContains(_b, Math.min(margin, 1))) out.set(_b.x, out.y, _b.z);
    out.y = this.groundY(out.x, out.z, Math.max(out.y, this.position.y) + 1.5);
    return out;
  }

  // ───────────── 脚本位移（冲刺 / 跃击） ─────────────

  /** 脚本位移：velocity（米/秒，含竖直）、重力；maxRun 有限时走护栏冲刺（台沿前刹住、里程用完即停） */
  beginDash(velocity: THREE.Vector3, gravity: number, maxRun = Infinity): void {
    this.dash = {
      vx: velocity.x, vz: velocity.z, vy: velocity.y, g: gravity > 0 ? gravity : GRAVITY, run: maxRun, travelled: 0, guarded: Number.isFinite(maxRun),
      hitWall: false, hitLedge: false, grounded: false, spent: false, last: this.position.clone(),
    };
    this.stopMoving();
  }

  endDash(): void {
    if (!this.dash) return;
    this.dash = null;
    this.velocity.x = this.velocity.z = 0;
    this.stopMoving();
  }

  setDashVelocity(x: number, y: number, z: number): void {
    if (!this.dash) return;
    this.dash.vx = x;
    this.dash.vy = y;
    this.dash.vz = z;
  }

  get dashHitWall(): boolean {
    return this.dash?.hitWall ?? false;
  }

  get dashHitLedge(): boolean {
    return this.dash?.hitLedge ?? false;
  }

  get dashGrounded(): boolean {
    return this.dash?.grounded ?? false;
  }

  get dashRunSpent(): boolean {
    return this.dash?.spent ?? false;
  }

  /** think 之后、积分之前：把脚本速度写进速度（积分只剩重力补偿） */
  private applyDash(dt: number): void {
    const d = this.dash;
    if (!d || !this.alive || dt <= 0) return;
    let vx = d.vx, vz = d.vz;
    const sp = Math.hypot(vx, vz);
    if (d.guarded && sp > 1e-3) {
      const left = d.run - d.travelled;
      if (left <= 1e-3) {
        d.spent = true;
        vx = vz = 0;
      } else if (sp * dt > left) {
        vx *= left / (sp * dt);
        vz *= left / (sp * dt);
      }
      // 台沿：这一步（加 0.6 m 提前量）落脚处比脚下低 2 m 以上就刹住
      const step = Math.hypot(vx, vz) * dt + 0.6;
      const px = this.position.x + vx / sp * step, pz = this.position.z + vz / sp * step;
      const here = this.groundY(this.position.x, this.position.z, this.position.y + 2);
      const there = this.ctx.world.groundHeight(px, pz, here + 3, 0.1);
      if (!Number.isFinite(there) || there < here - LEDGE_DROP) {
        d.hitLedge = true;
        vx = vz = 0;
      }
    }
    this.desiredX = vx;
    this.desiredZ = vz;
    this.velocity.x = vx;
    this.velocity.z = vz;
    this.velocity.y = d.vy + GRAVITY * dt;
  }

  /** 积分之后：读撞墙 / 着地，推进竖直速度与里程 */
  private postDash(): void {
    const d = this.dash;
    if (!d) return;
    const dt = this.ctx.time.dt ?? 1 / 60;
    d.travelled += Math.hypot(this.position.x - d.last.x, this.position.z - d.last.z);
    d.last.copy(this.position);
    if (this.moveResult.hitWall) d.hitWall = true;
    d.grounded = this.moveResult.onGround;
    d.vy = d.grounded && d.vy <= 0 ? 0 : d.vy - d.g * dt;
    if (d.guarded && d.travelled >= d.run - 1e-3) d.spent = true;
  }

  // ───────────── 框架钩子 ─────────────

  protected override onAnimEvent(evt: string): void {
    switch (evt) {
      case 'hit':
      case 'impact':
      case 'cast':
        if (this.pendingFx) this.flushRelease(false);
        else this.hitSeenAt = this.now;
        break;
      case 'step':
        if (this.currentMove instanceof ThrustMove) {
          this.ctx.fx.burst(_a.copy(this.position).setY(this.position.y + 0.15), Pal.Smoke, 2, 1.2, 0.6, 0.5, -0.6);
          this.quake(0.12, 0.12);
        }
        break;
      case 'brake':
        Fx.smoke(this.ctx, _a.copy(this.position).addScaledVector(this.fwd(this.facing / DEG), 1.2).setY(this.position.y + 0.3), 1, 3);
        break;
      case 'gather':
        this.ctx.fx.burst(this.getBodyCenter(_a), Pal.copperAt(this.fk), 14, 6, 0.5, 0.1, -2);
        break;
      case 'roar':
        if (this.transitioning && this.phase >= 2) this.shiftFury();
        break;
      case 'kneel':
        if (!this.alive) this.kneel();
        break;
      case 'glare':
        // 登场落地后抬头怒视：角盔一亮
        if (!this.introDone) Fx.glare(this.ctx, this.headPoint(_a).setY(_a.y + 0.3), this.fk);
        break;
      case 'collapse':
        if (!this.alive) this.collapse();
        break;
    }
  }

  /** 招式间隙和出招中每帧：突刺时剑尖犁地甩火星；狂怒（三阶段）每 2.4 s 一颗零星陨石 */
  protected override passiveTick(dt: number): void {
    const m = this.currentMove;
    if (m instanceof ThrustMove && m.running) {
      this.dragAcc += dt;
      if (this.dragAcc >= 0.045) {
        this.dragAcc = 0;
        this.ctx.fx.burst(this.bladeTip(_a), Pal.hotAt(this.fk), 3, 5, 0.25, 0.07, 4);
      }
    }
    if (this.phase < 2) return;
    this.ambientAcc += dt;
    if (this.ambientAcc < this.wdef.ambientMeteorEvery) return;
    this.ambientAcc = 0;
    this.dropAmbientMeteor();
  }

  /** 零星陨石：玩家周围 1.5–6 m（夹进场地），从 30 m 高处斜着直线坠落 1.25 s，落点预警、落地留 3.5 s 的火 */
  dropAmbientMeteor(): void {
    const d = this.wdef;
    const rng = this.ctx.rng;
    const ang = rng.range(0, Math.PI * 2), r = rng.range(d.ambientMeteorRange[0], d.ambientMeteorRange[1]);
    const p = this.ctx.player.position;
    const to = new THREE.Vector3(p.x + Math.sin(ang) * r, p.y, p.z + Math.cos(ang) * r);
    this.clampToArena(to, 2);
    to.y = this.groundY(to.x, to.z, Math.max(p.y, this.bossCenter.y) + 30);
    const from = to.clone().add(new THREE.Vector3(rng.range(-7, 7), 30, rng.range(-7, 7)));
    const k = 1 / Math.max(1, d.damage);
    const fireDmg = this.moveDamage(4 * k);
    const hz = this.hazards;
    hz.lob({
      from, to, time: 1.25, arc: 0, radius: 3, damage: this.moveDamage(22 * k), color: FIRE, kind: 'meteor', element: 'fire',
      onLand: (q) => { hz.zone({ x: q.x, y: q.y, z: q.z, radius: 2.2, duration: 3.5, damage: fireDmg, color: FIRE, arm: 0.1, embers: EMBERS, element: 'fire' }); },
    });
    this.ambientMeteors++;
  }

  /** 收招后的喘息就是破绽窗口：胸口的地火之心烧亮 */
  protected override onMoveEnded(m: BossMove): void {
    if (!m.cancelled && m.reachedActive && this.alive) this.expose(Math.min(1.2, m.recovery * this.restScale));
  }

  /** 登场：前 40% 从高处砸下来（模型下落，身后拖火），落地；70% 时咆哮 */
  protected override introTick(t: number, dt: number): void {
    const d = this.wdef;
    const fall = Math.min(1, t / Math.max(0.05, d.dropFraction));
    if (!this.landed) {
      if (dt > 0 && this.animator.state !== 'fall') this.act('fall', 1);
      this.setDrop(d.dropHeight * (1 - fall * fall));
      // 下坠的火尾（Unity Surge.Trail：从身上拖到天上的锥形火尾，长度随速度、最长 14 m）+ 往后甩的火星；火尾体积换成一串粒子
      this.fxAcc += dt;
      if (this.fxAcc >= 0.03 && dt > 0) {
        this.fxAcc = 0;
        const base = this.position.y + this.dropNow + 2.2;
        const speed = 2 * d.dropHeight * fall / Math.max(0.05, d.dropFraction * this.wdef.intro.seconds);
        const len = Math.min(14, 2 + speed * 0.35);
        for (let i = 0; i < 6; i++) {
          const k = i / 5;
          _a.set(this.position.x + (Math.random() - 0.5) * 0.5, base + k * len, this.position.z + (Math.random() - 0.5) * 0.5);
          this.ctx.fx.burst(_a, k < 0.35 ? Pal.copperAt(0) : k < 0.7 ? FIRE : RAGE, 2, 0.6, 0.35 + 0.3 * (1 - k), 0.55 * (1 - k * 0.6), 0);
        }
        this.ctx.fx.burst(_b.copy(this.position).setY(base - 0.7), EMBERS, 3, 2.5, 0.6, 0.12, -3);
      }
      if (fall >= 1) this.land();
    }
    if (t >= d.roarAt && !this.roared) {
      this.roared = true;
      // 登场停顿的最后一帧是咆哮的缩身姿势：从缩身那一帧接着播
      this.actFrom('roar', 1.2, ROAR_GATHER_AT);
      this.playSfx('boss_roar');
      this.quake(0.45, 0.8);
      this.roarFx();
    }
  }

  /** 咆哮：肩头两道火柱窜起、胸口一圈热浪、脚下一圈残火 */
  private roarFx(): void {
    const c = this.getBodyCenter(new THREE.Vector3());
    const right = new THREE.Vector3(-Math.cos(this.facing), 0, Math.sin(this.facing));
    Fx.flamePillar(this.ctx, c.clone().setY(c.y + 1.1).addScaledVector(right, 0.9), 0.35, 2.6);
    Fx.flamePillar(this.ctx, c.clone().setY(c.y + 1.1).addScaledVector(right, -0.9), 0.35, 2.6);
    this.ctx.fx.ring(this.position.clone().setY(this.position.y + 0.15), 7, FIRE, 0.6);
    Fx.groundFlames(this.ctx, this.position.clone(), this.radius + 1.4, 8, 2.4);
  }

  /** 落地：登场停顿片段、熔铜落地（重击 + 十字熔铜裂口 + 紫褐尘浪）、外圈熔铜滴、一圈残火、重震 */
  private land(): void {
    this.landed = true;
    this.setDrop(0);
    const floor = this.position.clone();
    floor.y = this.groundY(floor.x, floor.z, floor.y + 2);
    const pause = Math.max(0.35, (this.wdef.roarAt - this.wdef.dropFraction) * this.wdef.intro.seconds);
    this.act(INTRO_LAND, pause);
    this.hold(0.1);
    Fx.landing(this.ctx, floor, 6, this.fwd(this.facing / DEG), this.fk);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.6, r = 2.6 + Math.random() * 2.4;
      Fx.moltenSplash(this.ctx, floor.clone().add(new THREE.Vector3(Math.sin(a) * r, 0.2, Math.cos(a) * r)), 1.3);
    }
    Fx.groundFlames(this.ctx, floor, 3.8, 9, 2.4);
    this.ctx.fx.burst(floor.clone().setY(floor.y + 0.3), EMBERS, 30, 10, 1.2, 0.2, 12);
    Fx.screenFlash(this.ctx, 'rgba(255,140,51,1)', 0.32, 0.35);
    this.quake(1, 0.8);
    this.playSfx('boss_slam');
    this.playSfx('explosion', 1, 0.6);
  }

  protected override onIntroEnd(): void {
    if (!this.landed) this.land();
    this.setDrop(0);
    this.ctx.ui.toast(this.animator.hasNative ? '熔火深渊的统帅——胸口的地火之心是弱点' : '熔火深渊的统帅——角盔是弱点', '#ff7a2a');
  }

  protected override onPhase(phase: number): void {
    const c = this.getBodyCenter(new THREE.Vector3());
    this.ctx.fx.burst(c, Pal.copperAt(this.fk), 40, 10, 1, 0.3, -2);
    this.ctx.fx.ring(this.position.clone().setY(this.position.y + 0.1), 12, Pal.deepAt(this.fk), 0.9);
    if (phase >= 2) this.fury2();
  }

  /** 狂怒换挡的那一下（转阶段咆哮炸开那一帧：roar 事件，时间兜底 0.75 s）：白热冲击环 + 紫褐烟环 + 全身喷铜火星、顿帧、重震 */
  private shiftFury(): void {
    if (this.furyShifted) return;
    this.furyShifted = true;
    Fx.furyShift(this.ctx, this.position, this.getBodyCenter(new THREE.Vector3()).setY(this.getBodyCenter(_a).y + 0.6));
    this.hold(0.1);
    this.quake(0.8, 0.6);
    Fx.screenFlash(this.ctx, 'rgba(255,153,64,1)', 0.28, 0.3);
    this.playSfx('explosion', 0.8, 0.7);
  }

  protected override transitionTick(t: number, dt: number): void {
    if (this.phase >= 2 && t >= 0.75) this.shiftFury();
    if (t < 0.15 || t > 1.8) return;
    this.fxAcc += dt;
    if (this.fxAcc < 0.18) return;
    this.fxAcc = 0;
    this.quake(0.2, 0.2);
    const a = Math.random() * Math.PI * 2;
    this.ctx.fx.burst(_a.copy(this.position).add(_b.set(Math.sin(a) * 1.5, 0.5 + Math.random() * 2.5, Math.cos(a) * 1.5)), Pal.copperAt(this.fk), 6, 5, 0.6, 0.2, -6);
  }

  protected override onEnrage(): void {
    this.fury2();
  }

  /** 狂怒：陨石雨冷却缩短（零星陨石由 passiveTick 在三阶段起落） */
  private fury2(): void {
    const meteor = this.moveById('warlord_meteor');
    if (meteor) meteor.cooldown = Math.min(meteor.cooldown, this.wdef.furyMeteorCooldown);
  }

  protected override onDefeated(_result: DamageResult): void {
    this.holdUntil = -1;
    this.holdDebt = 0;
    this.animator.speed = 1;
    this.endDash();
    this.setDrop(0);
    this.glow(0, 0);
    this.waves.clear();
    this.act('death', this.wdef.defeat.seconds);
    this.director?.abort('首领倒下');
    this.defeatFx();
  }

  /**
   * 倒下（death 片段：中招后仰 → 踉跄拄剑 → 单膝跪地低头 → 剑滑、向前扑倒）：甲缝里的熔铜往外淌；跪地那一帧（kneel，兜底 45%）膝下、剑下各一蓬熔铜；
   * 扑倒那一帧（collapse，兜底 88%）整个人化成一滩熔铜
   */
  private defeatFx(): void {
    const secs = this.wdef.defeat.seconds;
    Fx.moltenBurst(this.ctx, this.getBodyCenter(new THREE.Vector3()), 1.8, Pal.copperAt(this.fk));
    this.defeatLine = new DefeatTimeline(this.ctx)
      .during(secs * 0.88, () => {
        if (Math.random() < 0.4) this.ctx.fx.burst(this.getBodyCenter(_a).add(_b.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 1.6, (Math.random() - 0.5) * 1.2)),
          Math.random() < 0.5 ? FIRE : Pal.Copper, 3, 1.2, 0.7, 0.24, 6);
      })
      .at(secs * 0.45, () => this.kneel())
      .at(secs * 0.62, () => Fx.moltenBurst(this.ctx, this.getBodyCenter(new THREE.Vector3()), 1.6))
      .at(secs * 0.88, () => this.collapse());
  }

  private kneel(): void {
    if (this.defeatKneel) return;
    this.defeatKneel = true;
    const feet = this.position.clone();
    const f = this.fwd(this.facing / DEG);
    Fx.moltenBurst(this.ctx, feet.clone().addScaledVector(f, 0.6).setY(feet.y + 0.3), 1.6);
    Fx.moltenSplash(this.ctx, this.bladeTip().setY(feet.y + 0.2), 1.2, Pal.Copper);
    Fx.smoke(this.ctx, feet, 1.2, 3);
    this.quake(0.45, 0.4);
  }

  private collapse(): void {
    if (this.defeatCollapse) return;
    this.defeatCollapse = true;
    const feet = this.position.clone().addScaledVector(this.fwd(this.facing / DEG), 0.8);
    Fx.moltenBurst(this.ctx, feet.clone().setY(feet.y + 0.3), 3.4);
    Fx.moltenSplat(this.ctx, feet, 6.5);
    Fx.groundFlames(this.ctx, feet, 3.4, 9, 3.5);
    Fx.smoke(this.ctx, feet, 2.4, 5);
  }

  protected override animateDeath(t: number): void {
    // 倒下由 death 片段演；第 92% 化成熔铜后模型隐去
    if (t >= 0.92) this.model.visible = false;
  }

  protected override onReleased(): void {
    this.waves.clear();
    this.director?.abort('首领释放');
    this.defeatLine = null;
    if (devHook?.boss === this) devHook = null;
  }

  override glow(_channel: number, _value: number): void {
    // 前摇亮度由 updateLook 按「当前招式在前摇里」统一算（Unity WindupGlow）；这里留给框架的通用调用
  }
}

// ───────────────────────────── 开发钩子（?dev，只在开发服务器里） ─────────────────────────────

interface DevHook {
  boss: Warlord;
}

let devHook: DevHook | null = null;

function devHookEnabled(): boolean {
  return !!import.meta.env?.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');
}

function installDevHook(boss: Warlord): void {
  devHook = { boss };
  (window as unknown as Record<string, unknown>).__warlord = {
    get boss() { return boss; },
    /** 跳过登场演出（不看首次锁） */
    skipIntro: () => boss.director?.requestSkip(true) ?? false,
    /** 把生命层打到某个比例（跳阶段用；门槛照常起作用：每次只越一道线） */
    setHealth: (fraction: number) => {
      boss.shield = 0;
      boss.armor = 0;
      boss.hp = Math.max(1, boss.maxHp * fraction);
    },
    forceMove: (id: string) => boss.forceMove(id),
    state: () => {
      const m = boss.currentMove;
      return {
        pos: boss.position.toArray().map(v => +v.toFixed(2)), cam: boss.ctx.camera.position.toArray().map(v => +v.toFixed(2)),
        center: boss.bossCenter.toArray().map(v => +v.toFixed(1)), radius: +boss.arenaRadius.toFixed(1),
        phase: boss.phase, introDone: boss.introDone, transitioning: boss.transitioning, enraged: boss.enraged, move: m?.id ?? null, stage: m?.stage ?? null,
        hp: Math.round(boss.hp), maxHp: boss.maxHp, shield: Math.round(boss.shield), armor: Math.round(boss.armor), drop: +boss.dropNow.toFixed(2), landed: boss.landed,
        act: boss.lastAct, anim: boss.animator.state, u: +boss.animator.u.toFixed(2), native: boss.animator.hasNative,
        director: boss.director ? { stage: boss.director.stage, shot: boss.director.shotName, t: +boss.director.t.toFixed(2), released: boss.director.released } : null,
        releases: boss.releases, fallbacks: boss.fxFallbacks, holds: boss.holds, exposures: boss.exposures, exposed: boss.exposed, furyLook: +boss.furyLook.toFixed(2),
        waves: boss.waves.alive, wavesLaunched: boss.waves.launched, meteors: boss.ambientMeteors, playerHits: boss.playerHits,
        iaiCuts: (boss.moveById('warlord_iai') as IaiMove | null)?.cuts ?? 0, color: hexColor(boss.wdef.color), waveRange: SwordWave.Range,
      };
    },
  };
}
