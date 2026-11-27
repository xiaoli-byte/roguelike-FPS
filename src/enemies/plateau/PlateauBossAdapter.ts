/**
 * 4-4 终局首领「雷泽雷神」进正式游戏（第四章网页原生高原场景，plateau=1）：行为、招式、演出仍由检视页的 haizi/leize.ts 驱动，
 * 这一层把它接到和其他首领同样的 EnemyBase / Registry 路径上（同普通雷魅的 PlateauFoeAdapter）：
 *   · 上下文：复用 PlateauFoeAdapter 的 PlateauCombatRuntime（打玩家、落雷、元素、地形、碰撞），另配三样检视页会话才有的：
 *     演出（检视页的 Cinema：登场 / 转阶段 / 倒下的镜头表、黑边、名字卡，按 E / 空格跳过看过的）、玩家朝向 / 眼位、天气（高原层的 Weather）；
 *   · 镜头：演出接管时每帧在玩家写完相机之后（ctx.tasks）改主相机，锁输入、收枪、收 HUD、玩家无敌（同正式的 BossIntroDirector）；
 *   · 伤害：正式的命中换算后交给雷神自己结算（神面 / 腹鼓弱点、破防都照它），正式血量跟着雷神的血量走；演出里不可选中；
 *     柱顶雷晶算进命中判定（打中时不伤雷神）：石柱充满电时把雷劈回神面（同检视页 LeizePlay.discharge）；
 *   · 二阶段起湖水通电：站在浅水里每 0.5 s 挨 4 点电；打赢后湖心岛的灵火点亮。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { raySphere } from '../../core/math';
import { EnemyBase } from '../EnemyBase';
import { BLAST_POISE, isBlastHit, isDotHit, isReactionHit } from '../HitReaction';
import { PlateauCombatRuntime } from './PlateauFoeAdapter';
import { Cinema } from '../../world/plateau/play/cinema';
import type { DamageInfo, Elem, HitSphere, KnockBack } from '../../world/plateau/play/core';
import { FIRE_STATE } from '../../world/plateau/landmarks';
import { LeizeBoss } from '../../world/haizi/leize';
import type { LeizePlay } from '../../world/haizi/play';
import type { Pillar } from '../../world/haizi/scene';
import { activePlateauLayer } from '../../world/plateau/stage/layer';
import type { Haizi44 } from '../../world/plateau/stage/world44';

/** 血量按夔的换算（检视页夔 12000 → 正式 34400 / 3.4）：检视页 30000 → 约 25300 */
export const LEIZE_DEF: EnemyDef = {
  id: 'boss_leize', name: '雷泽雷神', hp: 25300, speed: 0, radius: 3, height: 10, damage: 20,
  coins: [120, 160], essence: 120, isBoss: true, headY: 9, headRadius: 1.1, knockbackResist: 1, color: 0xe03ac8,
};

const _p = new THREE.Vector3();

export class PlateauBossAdapter extends EnemyBase {
  readonly runtime: PlateauCombatRuntime;
  readonly boss: LeizeBoss;
  private readonly cinema: Cinema;
  private readonly haizi: Haizi44;
  private lastHp: number;
  /** 这一帧的射线打中了哪根柱子的雷晶（onDamaged 里转成放电，不伤雷神） */
  private crystal: { pillar: Pillar; frame: number } | null = null;
  private hintAt = -10;
  private soak = 0;
  private locked = false;
  private readonly offTask: () => void;
  private lit = false;
  /**
   * 正式血量的下限：雷神的倒下演出放完之前正式这边不能先死（关卡导演看到首领死了就清关、出结算界面，会盖在演出上），
   * 所以血量最低只降到一个极小的正数（战斗结算只在 hp ≤ 0 时判死）；演出放完放开、补一刀
   */
  private allowDeath = false;
  private hpValue = 0;

  constructor(ctx: GameContext, def: EnemyDef, opts: SpawnOptions) {
    super(ctx, def, opts);
    const layer = activePlateauLayer;
    const haizi = (layer?.world as { haizi?: Haizi44 } | undefined)?.haizi;
    if (!layer || !haizi) throw new Error('雷泽雷神要在 4-4 神山海子的高原场景里（网址 plateau=1）');
    this.haizi = haizi;
    this.runtime = new PlateauCombatRuntime(ctx);
    this.cinema = new Cinema();
    const self = this;
    // 检视页的会话（LeizePlay）：PlayCtx 的部分全转给 PlateauCombatRuntime，再补演出、玩家朝向 / 眼位、天气和两个小工具
    const session = Object.create(this.runtime) as Record<string, unknown>;
    session.cinema = this.cinema;
    session.say = (text: string) => ctx.ui.toast(text, '#ffd25a');
    session.knockFrom = (x: number, z: number, k: number, up = 0): KnockBack => {
      const p = ctx.player.position, dx = p.x - x, dz = p.z - z, d = Math.max(0.5, Math.hypot(dx, dz));
      return { x: dx / d * k, z: dz / d * k, up };
    };
    session.groundAt = (x: number, z: number): number => Math.max(haizi.world.groundAt(x, z, 60), haizi.terrain.waterLevelAt(x, z));
    Object.defineProperty(session, 'weather', { get: () => layer.weather });
    // 检视页的行走者（Walker）：脚底就是正式玩家的位置（同一个向量，改它就是挪人），竖直速度、冲量、推开都转给正式玩家
    const P = ctx.player;
    const walker = {
      get feet() { return P.position; },
      get grounded() { return P.onGround; },
      get vy() { return P.velocity.y; },
      set vy(v: number) { P.velocity.y = v; },
      fly: false,
      lookAt: (v: THREE.Vector3) => self.face(v),
      eye: (out: THREE.Vector3) => out.copy(P.position).setY(P.position.y + 1.62),
      knock: (vx: number, vz: number, up = 0) => P.applyImpulse(new THREE.Vector3(vx, up, vz)),
      shove: (dx: number, dz: number) => { P.position.x += dx; P.position.z += dz; },
    };
    Object.defineProperty(session, 'walker', { get: () => walker });
    this.boss = new LeizeBoss(session as unknown as LeizePlay, haizi.terrain, haizi.world, haizi.arena.lake, haizi.arena.pillars);
    this.boss.maxHp = this.boss.hp = this.maxHp;
    this.hpValue = this.hp;
    Object.defineProperty(this, 'hp', {
      configurable: true, enumerable: true,
      get: () => this.hpValue,
      set: (v: number) => { this.hpValue = !this.allowDeath && v <= 0 ? 1e-6 : v; },
    });
    this.lastHp = this.hp;
    this.position.copy(this.boss.pos);
    this.spawnDuration = 0;
    // 演出的镜头：所有系统（玩家写相机）之后
    this.offTask = ctx.tasks.add(dt => {
      // 演出出错不能把玩家锁死在演出里：报一次错、把镜头和输入交还
      try { this.cinemaFrame(dt); } catch (err) { this.cinemaFailed(err); }
    });
  }

  protected buildModel(): THREE.Object3D { return new THREE.Group(); }
  protected think(_dt: number): void {}

  /** 没开打、演出里（登场、转阶段、倒下）都不可选中 */
  get untargetable(): boolean {
    const B = this.boss;
    return B.inShow || (!B.active && !B.defeated);
  }

  /** 让玩家看向 v（演出第一镜里把人转向首领，落回眼睛时正对着它） */
  private face(v: THREE.Vector3): void {
    const p = this.ctx.player, e = _p.copy(p.position).setY(p.position.y + 1.62);
    const dx = v.x - e.x, dy = v.y - e.y, dz = v.z - e.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, Math.hypot(dx, dz))));
  }

  private cinemaFrame(dt: number): void {
    const ctx = this.ctx, C = this.cinema;
    if (!C.active && !this.locked) return;
    C.update(dt, ctx.camera);
    C.apply(ctx.camera);
    if (C.active && (ctx.input.keyPressed('KeyE') || ctx.input.keyPressed('Space'))) C.skip();
    const lock = C.locked;
    if (lock) {
      ctx.input.enabled = false;
      if (ctx.player.alive) ctx.player.invulnerableTime = Math.max(ctx.player.invulnerableTime, 0.3);
    }
    if (lock !== this.locked) {
      this.locked = lock;
      ctx.ui.showHUD(!lock);
      if (!lock) ctx.input.enabled = true;
    }
    ctx.weapons.setViewmodelVisible(!C.takesCamera);
  }

  private cinemaFailed(err: unknown): void {
    console.error('[PlateauBossAdapter] 演出出错，交还镜头', err instanceof Error ? err.stack : err);
    const ctx = this.ctx;
    try { (this.cinema as unknown as { shot: unknown }).shot = null; } catch { /* */ }
    document.getElementById('cine')?.classList.remove('on');
    ctx.input.enabled = true;
    ctx.ui.showHUD(true);
    ctx.weapons.setViewmodelVisible(true);
    this.locked = false;
    if (this.boss.inShow) this.boss.inShow = false;
  }

  override raycastHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: { distance: number; headshot: boolean }): boolean {
    let best = maxDist, headshot = false, pillar: Pillar | null = null;
    for (const s of this.boss.spheres()) {
      if (s.r <= 0) continue;
      const d = raySphere(origin, dir, s.c, s.r);
      if (d >= 0 && d < best) { best = d; headshot = s.mult > 1; pillar = null; }
    }
    // 柱顶雷晶（检视页的 CrystalTarget：半径 0.8）
    for (const p of this.haizi.arena.pillars) {
      const d = raySphere(origin, dir, p.top, 0.8);
      if (d >= 0 && d < best) { best = d; headshot = false; pillar = p; }
    }
    if (best >= maxDist) return false;
    out.distance = best;
    out.headshot = headshot;
    this.crystal = pillar ? { pillar, frame: this.ctx.time.frame } : null;
    return true;
  }

  override onDamaged(result: DamageResult): void {
    const B = this.boss;
    this.runtime.updateContextOnly(null as never);
    this.lastHurtTime = this.ctx.time.now;
    // 致命的一下被下限挡成了极小的正数：剩下的血整份交给雷神（不然它会剩一丝血死不掉）
    const hpLoss = this.hpValue <= 1e-6 ? this.lastHp : Math.max(0, this.lastHp - this.hp);
    const crystal = this.crystal && this.crystal.frame === this.ctx.time.frame ? this.crystal.pillar : null;
    this.crystal = null;
    if (crystal) {
      // 打的是雷晶：不伤雷神；满电才劈得出去
      this.hp = this.lastHp;
      this.discharge(crystal);
      return;
    }
    if (B.defeated || hpLoss <= 0) {
      if (!B.defeated) this.hp = this.lastHp;
      return;
    }
    const req = result.request;
    const point = req.point ?? B.center(_p);
    let sphere: HitSphere | undefined;
    let dist = Infinity;
    for (const s of B.spheres()) {
      const d = s.c.distanceToSquared(point);
      if (d < dist) { dist = d; sphere = s; }
    }
    const mult = req.headshot ? Math.max(1, sphere?.mult ?? 1.2) : 1;
    const dot = isDotHit(req), blast = isBlastHit(req);
    const info: DamageInfo = {
      kind: dot ? 'dot' : isReactionHit(req) ? 'reaction' : blast ? 'blast' : 'bullet',
      elem: result.element === 'none' ? undefined : result.element as Elem, sphere, from: req.point, poise: dot ? 0 : blast ? BLAST_POISE : undefined,
    };
    B.hp = Math.min(B.maxHp, this.lastHp);
    B.hit(hpLoss / mult, mult, point, info);
    // 正式血量跟着雷神走（它按部位、破防结算，可能和正式的换算不一样）；它还没倒下时正式这边也不能先死
    this.hp = B.defeated ? 0 : Math.max(1, B.hp);   // 倒下时 0 会被下限挡成极小的正数
    this.lastHp = this.hp;
  }

  override onKilled(result: DamageResult): void {
    if (!this.alive) return;
    this.alive = false;
    this.allowDeath = true;
    this.hp = 0;
    const B = this.boss;
    if (!B.defeated) B.hit(B.hp + 1, 1, result.request.point ?? B.center(_p));
  }

  private discharge(p: Pillar): void {
    const B = this.boss;
    if (p.charge < 0.999) {
      if (this.ctx.time.now - this.hintAt > 3) {
        this.hintAt = this.ctx.time.now;
        this.ctx.ui.toast(`${p.name}只充了 ${Math.round(p.charge * 100)}%——站在它旁边，让雷劈它充电`, '#ffd25a');
      }
      return;
    }
    p.setCharge(0);
    if (B.active && !B.defeated && !B.inShow) B.struckByPillar(p);
  }

  override knockback(_impulse: THREE.Vector3): void {}

  override getHeadCenter(out: THREE.Vector3): THREE.Vector3 {
    const face = this.boss.spheres().find(s => s.part === 'face');
    return face ? out.copy(face.c) : this.boss.center(out);
  }

  override update(dt: number): void {
    this.age += dt;
    const ctx = this.ctx, B = this.boss, P = ctx.player;
    this.runtime.updateContextOnly(null as never);
    if (!B.active && !B.defeated && P.alive && B.shouldStart()) B.start();
    const d = Math.hypot(P.position.x - B.arena.x, P.position.z - B.arena.y);
    if (B.active && !B.defeated && !B.inShow && (d > B.arenaR + 30 || !P.alive)) B.reset();
    B.update(dt);
    this.runtime.fx.update(dt, this.runtime.center, P.radius);
    // 二阶段起湖水通电：站在浅水里挨电（同检视页 LeizePlay.tick）
    if (B.active && !B.defeated && B.phase >= 2 && !B.inShow && P.alive) {
      const T = this.haizi.terrain, F = P.position;
      const inWater = T.waterDepthAt(F.x, F.z) > 0.05 && F.y < T.waterLevelAt(F.x, F.z) + 0.15;
      this.soak -= dt;
      if (inWater && this.soak <= 0) { this.soak = 0.5; ctx.combat.damagePlayer(4, 'shock', this, F); }
    }
    this.position.copy(B.pos);
    if (!B.defeated) {
      // 雷神自己掉的血（石柱回劈）同步过来
      if (B.hp < this.hp) { this.hp = Math.max(1, B.hp); this.lastHp = this.hp; }
      return;
    }
    // 倒下：湖心岛的灵火点亮；演出放完再走正式的击杀（补一刀）、再移除
    if (!this.lit) { this.lit = true; FIRE_STATE.mask = undefined; FIRE_STATE.lit = 1; }
    this.hp = 0;   // 下限挡着：极小的正数，血条见底
    if (B.inShow) return;
    if (this.alive) {
      // 倒下演出放完：放开下限、补一刀，走正式的击杀（掉落、首领清关、结算）
      this.allowDeath = true;
      this.hp = this.lastHp = 1;
      ctx.combat.damageEnemy(this, { base: 1e6, element: 'none', source: 'skill', procDepth: 1, point: B.center(_p) });
      return;
    }
    this.removed = true;
  }

  override dispose(): void {
    this.offTask();
    if (this.locked) { this.ctx.input.enabled = true; this.ctx.ui.showHUD(true); this.ctx.weapons.setViewmodelVisible(true); }
    this.boss.host.removeFromParent();
    // 打到一半离开（读档、换关）：把它开的雷暴关掉
    if (activePlateauLayer && !this.boss.defeated) activePlateauLayer.weather.stormy = false;
    this.runtime.fx.clear();
    this.runtime.fx.group.removeFromParent();
    document.getElementById('cine')?.remove();
    super.dispose();
  }
}
