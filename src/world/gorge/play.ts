/**
 * 4-2 大渡河峡谷 · 领主战：大鹗（docs/level-design/chuanzang-combat-v1.md 4.4，地图 chuanzang-v1.md 3.5）。
 * 共用的枪、技能、秘卷、元素、演出、HUD 在 plateau/play/session.ts；这里只写大鹗、四个环境机关和这张图的流程。
 * - 一 · 盘空：汇口上空盘旋；俯冲抓人（地上先出影子，抓中被带上天再扔下，打它胸口 / 爪子能挣脱）、羽刃雨、停在江嘴碉楼顶放羽刃。
 * - 二 · 撕桥：落在铁索桥中间抓着铁链摇桥。雷暴里桥头雷桩攒电，攒到六成以上打雷桩：电送进铁链，抓着铁链的大鹗被电晕掉向河面。
 * - 三 · 狂怒：回巢；连环俯冲、巢中扇风。它在巢里时打掉危岩下的木楔，落石砸巢（一次）。
 * - 随时：它从溜索下面低空掠过时打断锚桩，钢索抽中缠住翅膀、坠到卵石滩；燎的火点着碉楼顶的烽火，浓烟 45 m 内它看不见人。
 * 大鹗还没有正式模型（设计稿、四视图、Tripo 都还没做），用检视页的程序化白模（dae.ts），动作在这里直接摆白模的关节。
 */
import * as THREE from 'three';
import type { Walker, CollisionWorld } from '../plateau/walker';
import type { Weather } from '../plateau/weather';
import { MONSTER_NAMES } from '../plateau/spec';
import { loadPlateauModels } from '../plateau/play/assets';
import { Boss } from '../plateau/play/boss';
import { orbitCam, type Shot } from '../plateau/play/cinema';
import type { DamageInfo, HitSphere, Target } from '../plateau/play/core';
import type { EncounterState } from '../plateau/play/foe';
import { Manman, createFoe } from '../plateau/play/foes';
import { defineMoves } from '../plateau/play/moves';
import { NavField } from '../plateau/play/nav';
import { PlaySession, type PlayInput } from '../plateau/play/session';
import type { CrossingField, Zip } from './crossings';
import { buildDaeModel, type DaeModel } from './dae';
import type { GorgeProps } from './landmarks';
import { ENCOUNTERS, LORD, SITES } from './spec';
import type { GorgeTerrain } from './terrain';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const smooth = (x: number): number => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

const DAE = defineMoves('SK_Boss_Dae', [
  { id: 'dive', name: '俯冲抓人', windup: 1.5, active: 1.2, recover: 1.5, cooldown: 3, glint: true, noHit: true, events: [{ at: 2.6, name: 'grab' }] },
  { id: 'diveChain', name: '连环俯冲', windup: 1.0, active: 1.0, recover: 0.6, minPhase: 3, glint: true, noHit: true, events: [{ at: 1.9, name: 'grab' }] },
  { id: 'feathers', name: '羽刃雨', windup: 0.8, active: 0.6, recover: 0.6, cooldown: 4, noHit: true, events: [{ at: 1.4, name: 'land' }] },
  { id: 'flyTo', name: '飞向落脚点', windup: 0, active: 6, recover: 0, noHit: true },
  { id: 'perch', name: '停碉楼俯瞰（放羽刃）', windup: 0.3, active: 6, recover: 0.4, cooldown: 14, noHit: true, events: [{ at: 0.6, name: 'volley' }, { at: 2.6, name: 'volley' }, { at: 4.6, name: 'volley' }] },
  { id: 'shake', name: '落桥摇链', windup: 1.0, active: 4.0, recover: 1.0, cooldown: 10, minPhase: 2, noHit: true, events: [1.2, 2.0, 2.8, 3.6, 4.4].map(at => ({ at, name: 'jolt' })) },
  { id: 'nestGust', name: '巢中扇风', windup: 1.0, active: 1.5, recover: 0.8, cooldown: 12, minPhase: 3, noHit: true },
  { id: 'grab', name: '擒拿（带上天再扔下）', windup: 0, active: 2.0, recover: 0.6, noHit: true, events: [{ at: 2.0, name: 'drop' }] },
  { id: 'fall', name: '坠江 / 缠翼坠地（扑腾）', windup: 0.8, active: 3.6, recover: 0.6, noHit: true },
]);

type PerchId = 'nest' | 'bridge' | 'tower';

export class DaeBoss extends Boss {
  readonly phaseNames = ['一 · 盘空', '二 · 撕桥', '三 · 狂怒'];
  protected readonly breakTime = 4.5;
  protected override downPose = 'fall';
  readonly rig: DaeModel;
  private readonly shadow: THREE.Mesh;
  private readonly perchAt: Record<PerchId, THREE.Vector3>;
  private readonly perchFace: Record<PerchId, THREE.Vector3>;
  /** 现在停在哪（null = 在天上） */
  perched: PerchId | null = 'nest';
  private plan: string[] = [];
  private flyTarget: PerchId = 'tower';
  private angle = 0;
  private flap = 0.3;
  private readonly A = new THREE.Vector3();
  private readonly B = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private grabDmg = 0;
  /** 浓烟里看不见人（GorgePlay 每帧给） */
  blind = false;
  private dropTo = new THREE.Vector3();
  private crashing = '';

  constructor(ctx: GorgePlay, terrain: GorgeTerrain) {
    const model = buildDaeModel();
    const host = new THREE.Group();
    host.name = 'boss-dae';
    host.add(model.bird);
    super('dae', '大鹗', 16000, 1200, host, null, 'bird', 'SK_Boss_Dae', [
      { bone: 'body', r: 1.5, mult: 1 }, { bone: 'chest', r: 1.0, mult: 2.5 }, { bone: 'head', r: 0.75, mult: 1.5 },
      { bone: 'wingL', r: 0.75, mult: 2, part: 'wing' }, { bone: 'wingR', r: 0.75, mult: 2, part: 'wing' }, { bone: 'talons', r: 0.9, mult: 1, part: 'talon' },
    ], ctx, { x: LORD.at[0], z: LORD.at[2], r: LORD.r });
    this.rig = model;
    const perch = (id: PerchId): THREE.Vector3 => {
      const p = LORD.perches.find(q => q.id === id)!;
      const v = new THREE.Vector3(...p.at);
      if (id === 'tower') v.y = terrain.footprintMin(v.x, v.z, 3.2, 3.2, 0) - 0.3 + 25.4;
      return v.add(new THREE.Vector3(0, 1.9, 0));
    };
    this.perchAt = { nest: perch('nest'), bridge: perch('bridge'), tower: perch('tower') };
    this.perchFace = Object.fromEntries(LORD.perches.map(p => [p.id, new THREE.Vector3(p.face[0], 0, p.face[1])])) as Record<PerchId, THREE.Vector3>;
    this.home.copy(this.perchAt.nest);
    this.pos.copy(this.home);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.renderOrder = 3;
    ctx.scene.add(this.shadow);
  }

  private get g(): GorgePlay { return this.ctx as GorgePlay; }

  shouldStart(): boolean {
    const P = this.ctx.feet;
    const mid = this.perchAt.bridge;
    return Math.hypot(P.x - mid.x, P.z - mid.z) < 30 || Math.hypot(P.x - 0, P.z + 100) < 50;
  }

  protected override boneWorld(name: string, out: THREE.Vector3): THREE.Vector3 {
    const M = this.rig;
    switch (name) {
      case 'chest': return M.bird.localToWorld(out.set(0, -0.35, 1.1));
      case 'body': return M.bird.localToWorld(out.set(0, 0, 0));
      case 'head': return M.head.localToWorld(out.set(0, 0, 0.3));
      case 'wingL': return M.wings[0].joints[0].localToWorld(out.set(-0.5, 0.05, 0.1));
      case 'wingR': return M.wings[1].joints[0].localToWorld(out.set(0.5, 0.05, 0.1));
      case 'talons': { M.legs[0].localToWorld(out.set(0, -1.3, 0.2)); M.legs[1].localToWorld(_w.set(0, -1.3, 0.2)); return out.add(_w).multiplyScalar(0.5); }
    }
    return out.copy(this.pos);
  }

  override center(out: THREE.Vector3): THREE.Vector3 { return this.boneWorld('body', out); }

  protected override partMul(sphere: HitSphere | undefined, _info: DamageInfo, dmg: number): number {
    if (this.move.id === 'grab' && (sphere?.part === 'talon' || sphere?.mult === 2.5)) {
      this.grabDmg += dmg * (sphere.mult ?? 1);
      if (this.grabDmg >= 150) this.release(true);
    }
    return 1;
  }

  // ─── 演出 ───

  protected introShot(): Shot {
    const ctx = this.ctx;
    const nest = this.perchAt.nest.clone(), tower = this.perchAt.tower.clone();
    const river = new THREE.Vector3(-6, ctx.terrain.waterLevelAt(-6, -10) + 3, -10);
    if (!Number.isFinite(river.y)) river.y = ctx.terrain.heightAt(-6, -10) + 6;
    ctx.weather.stormy = true;
    this.perched = 'nest';
    this.pos.copy(nest);
    const eye = new THREE.Vector3(ctx.feet.x, ctx.feet.y + 1.6, ctx.feet.z);
    const toT = new THREE.Vector3(eye.x - tower.x, 0, eye.z - tower.z).normalize();
    return {
      name: '大鹗 · 登场', dur: 8, landDur: 1.4, handoff: 0.6, skipKey: 'intro.dae', bars: true,
      shots: [
        // 建立全景：峡谷、汇口、江嘴绝壁上的鹗巢；巢里一声长唳
        { id: 'establish', dur: 1.8, note: '汇口全景，镜头摇向江嘴绝壁的鹗巢；1.0 秒长唳', cam: (t, out) => { out.pos.copy(eye).add(new THREE.Vector3(0, 6, 0)); out.look.lerpVectors(new THREE.Vector3(-6, nest.y - 10, -10), nest, smooth(t / 1.8)); out.fov = 52; } },
        // 首领现身：侧面跟拍——张翼跳下、贴着河面掠过汇口、拔高
        { id: 'reveal', dur: 2.8, blend: 0, note: '侧面跟拍：1.8 秒跳下，贴河面掠过汇口，4.6 秒落碉楼顶', cam: (t, out) => { out.pos.copy(this.pos).add(new THREE.Vector3(-16, 3, 10)); out.look.copy(this.pos); out.fov = 52; } },
        // 特写 + 名字卡：碉楼顶仰拍，16 m 的翅膀展开
        { id: 'closeup', dur: 2.0, blend: 0.5, note: '碉楼顶仰拍展翅；名字卡 4.8 秒起', cam: (t, out) => { out.pos.copy(tower).addScaledVector(toT, 13 - smooth(t / 2)).setY(tower.y - 2); out.look.copy(tower).setY(tower.y + 1.5); out.fov = 48; } },
        this.landShot(1.4),
      ],
      card: { title: '大鹗', sub: '钦䲹所化', quote: '《西山经》：其状如雕而黑文白首，赤喙而虎爪', at: 4.8, dur: 2.6 },
      tick: (t, dt) => {
        // 巢里一声长唳 → 张翼跳下、贴着河面掠过汇口 → 拔高落到江嘴碉楼顶、展翅
        if (t < 1.8) { this.pos.copy(nest); this.perched = 'nest'; this.flap = t > 1.0 ? 0.6 : 0.1; this.yaw = Math.atan2(river.x - nest.x, river.z - nest.z); }
        else if (t < 3.3) { this.perched = null; const k = smooth((t - 1.8) / 1.5); this.pos.lerpVectors(nest, river, k); this.pos.y -= Math.sin(k * Math.PI) * 6; this.flap = 0.4; }
        else if (t < 4.6) { const k = smooth((t - 3.3) / 1.3); this.pos.lerpVectors(river, tower, k); this.pos.y += Math.sin(k * Math.PI) * 10; this.flap = 1; }
        else { this.pos.copy(tower); this.flap = t < 6.4 ? 0.9 : 0.5; this.perched = 'tower'; this.faceTo(ctx.feet.x, ctx.feet.z, dt, 3); }
        if (t > 1.0 && !this.mem.cry) { this.mem.cry = 1; ctx.shake(0.15); ctx.fx.spray(nest, ['#f1ece2', '#26221f'], 30, 5, 3, 6, 1); }
      },
    };
  }

  protected override afterIntro(): void {
    this.perched = 'tower';
    this.mem.cry = 0;
    this.plan = ['takeoff'];
    this.ctx.say('看地上的影子横移；被抓住就打它胸口 / 爪子挣脱。雷暴里桥头雷桩会攒电', 5);
  }

  protected transition(n: number): Shot {
    const ctx = this.ctx;
    const from = this.pos.clone();
    const to = n === 2 ? this.perchAt.bridge.clone() : this.perchAt.nest.clone();
    const side = Math.atan2(ctx.feet.x - to.x, ctx.feet.z - to.z);
    return {
      name: n === 2 ? '大鹗 · 撕桥' : '大鹗 · 狂怒', dur: 3.4, bars: true, landDur: 1.0, handoff: 0.3, skipKey: `phase.${this.id}.${n}`,
      shots: [{ id: 'show', dur: 3.4 - 1.0, cam: orbitCam(to, 26, 8, side - 0.3, side + 0.3, 3.4, 0, 50) }, this.landShot(1.0)],
      banner: { text: n === 2 ? '二 · 撕桥' : '三 · 狂怒', at: 0.6, dur: 2.6 },
      tick: (t) => {
        const k = smooth(t / 2.2);
        this.pos.lerpVectors(from, to, k);
        this.pos.y += Math.sin(k * Math.PI) * 12;
        this.perched = k >= 1 ? (n === 2 ? 'bridge' : 'nest') : null;
        this.flap = k >= 1 ? 0.9 : 0.7;
        if (k >= 1 && !this.mem[`tr${n}`]) {
          this.mem[`tr${n}`] = 1;
          ctx.shake(0.3);
          ctx.fx.spray(to, n === 2 ? ['#6a5a48', '#a89070'] : ['#7d766c', '#c9a27b'], 30, 5, 3, 10, 0.8);
        }
      },
      onEnd: () => {
        if (n === 2) { this.plan = ['shake']; ctx.say('它抓着铁链摇桥——下桥！雷桩攒到六成以上打雷桩，把电送进铁链', 4); }
        else { this.plan = ['nestGust']; ctx.say('它回巢了——巢上方的危岩用木楔撑着，打掉木楔', 4); }
      },
    };
  }

  protected deathShot(): Shot {
    const ctx = this.ctx;
    const from = this.pos.clone();
    const water = new THREE.Vector3(-6, 0, 20);
    water.y = Math.max(ctx.terrain.heightAt(water.x, water.z), ctx.terrain.waterLevelAt(water.x, water.z));
    const down = new THREE.Vector3(-30, 0, 150);
    down.y = Math.max(ctx.terrain.heightAt(down.x, down.z), ctx.terrain.waterLevelAt(down.x, down.z));
    return {
      name: '大鹗 · 坠江', dur: 7, bars: true, landDur: 1.2, handoff: 0.5, skippable: true,
      slow: (t) => (t < 1.2 ? 0.3 : 1),
      shots: [{ id: 'show', dur: 5.8, cam: (t, out) => {
        const look = this.pos;
        out.look.copy(look);
        out.pos.set(look.x + 22, look.y + 9 + 8 * (1 - smooth(t / 3)), look.z - 12);
        out.fov = 50;
      } }, this.landShot(1.2)],
      card: { title: '大鹗 · 坠江', sub: '汇口的天空空了', at: 4, dur: 2.8 },
      tick: (t) => {
        this.perched = null;
        this.flap = 0.05;
        if (t < 2.6) {
          // 翅膀一收，打着旋坠进汇口
          const k = smooth(t / 2.6);
          this.pos.lerpVectors(from, water, k);
          this.rig.bird.rotation.z = t * 5;
          if (k >= 0.98 && !this.mem.splash) { this.mem.splash = 1; ctx.fx.spray(water, ['#e8fbff', '#9fe8ff', '#ffffff'], 120, 9, 9, 14, 1.4); ctx.shake(0.4); }
        } else {
          // 被冲到下游卵石滩，最后扑腾一下
          const k = smooth((t - 2.6) / 3.5);
          this.pos.lerpVectors(water, down, k);
          this.rig.bird.rotation.z = 2.6 * 5 + Math.sin(t * 3) * 0.2;
          if (t > 5.8 && t < 6.2) this.flap = 0.8;
        }
      },
      onEnd: () => { this.inShow = false; },
    };
  }

  protected onBreak(): void {
    const ctx = this.ctx;
    ctx.say('坠江！大鹗翻滚着掉向河面——打', 2.5);
    ctx.fx.burst(this.boneWorld('chest', _v).clone(), 3, '#ffffff');
    this.fallTo('坠江');
  }

  /** 掉下去：落到正下方的水面 / 河滩上方一点 */
  private fallTo(why: string): void {
    const ctx = this.ctx;
    this.interrupt();
    this.perched = null;
    this.crashing = why;
    const x = this.pos.x, z = this.pos.z;
    this.dropTo.set(x, Math.max(ctx.terrain.heightAt(x, z), ctx.terrain.waterLevelAt(x, z)) + 1.2, z);
    this.A.copy(this.pos);
  }

  /** 抓着铁链被电（GorgePlay：铁链带电时调） */
  electrocute(): void {
    if (this.perched !== 'bridge' || this.stunT > 0 || this.brokenT > 0 || this.inShow || !this.active) return;
    const ctx = this.ctx;
    for (let i = 0; i < 4; i++) ctx.fx.arc(this.boneWorld('talons', new THREE.Vector3()), this.boneWorld('chest', new THREE.Vector3()).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), '#ff7ae6', 0.3, 0.6);
    this.hit(400 * ctx.player.dmgMul, 1, this.center(_v), { kind: 'env', elem: 'shock', poise: 0 });
    this.addBreak(this.breakMax * 0.5);
    if (this.brokenT <= 0) { this.fallTo('被铁链电晕'); this.stun(4, '抓着带电的铁链，被电晕了'); }
  }

  /** 溜索钢索抽中翅膀（GorgePlay：打断锚桩时它在钢索附近） */
  tangle(): void {
    if (this.perched || this.inShow || !this.active) return;
    this.hit(300 * this.ctx.player.dmgMul, 1, this.center(_v), { kind: 'env', poise: 0 });
    this.fallTo('缠翼坠地');
    this.stun(5, '钢索缠住一侧翅膀，坠到地上');
  }

  /** 危岩砸巢 */
  crush(): boolean {
    if (this.perched !== 'nest' || !this.active || this.inShow) return false;
    const ctx = this.ctx;
    ctx.fx.burst(this.center(_v).clone(), 4, '#c9a27b');
    ctx.fx.spray(_v, ['#7d766c', '#c9a27b', '#26221f'], 80, 9, 4, 12, 1);
    ctx.shake(0.5);
    this.hit(1200 * ctx.player.dmgMul, 1, _v, { kind: 'env', poise: 0 });
    this.stun(5, '危岩砸进巢里，被砸晕了');
    return true;
  }

  protected override onReset(): void {
    this.ctx.weather.stormy = false;
    this.perched = 'nest';
    this.plan = [];
    this.crashing = '';
    this.rig.bird.rotation.set(0, 0, 0);
  }

  override update(dt: number): void {
    if (this.crashing && !this.inShow) {
      // 掉下去：0.8 秒落到水面 / 河滩，之后在那扑腾（眩晕 / 破防结束再飞起来）
      const k = Math.min(1, (this.mem.crashT = (this.mem.crashT ?? 0) + dt) / 0.8);
      this.pos.lerpVectors(this.A, this.dropTo, smooth(k));
      this.flap = 0.15 + 0.3 * Math.abs(Math.sin(this.ctx.time * 6));
      if (k >= 1 && this.stunT <= 0 && this.brokenT <= 0) { this.crashing = ''; this.mem.crashT = 0; this.plan = ['takeoff']; }
    }
    super.update(dt);
  }

  // ─── 招式 ───

  private circlePos(out: THREE.Vector3): THREE.Vector3 {
    const C = LORD.circle;
    const wob = this.blind ? 1 : 0;
    return out.set(C.x + Math.cos(this.angle) * (C.r + wob * 18 * Math.sin(this.ctx.time * 2.3)), C.y + 6 * Math.sin(this.angle * 2) + wob * 10 * Math.sin(this.ctx.time * 3.1), C.z + Math.sin(this.angle) * (C.r + wob * 18 * Math.cos(this.ctx.time * 1.7)));
  }

  protected override onEvent(ev: string): void {
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id;
    if (ev === 'warn' && (id === 'dive' || id === 'diveChain')) {
      // 俯冲：先飞到玩家身后上方，地上出它的影子和落点圈
      const dx = P.x - this.pos.x, dz = P.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
      this.A.set(P.x - dx / d * 22, ctx.terrain.heightAt(P.x, P.z) + 26, P.z - dz / d * 22);
      this.mem.lockT = 0;
      this.grabDmg = 0;
      this.mem.grabbed = 0;
      ctx.shake(0.08);
    } else if (ev === 'grab' && (id === 'dive' || id === 'diveChain')) {
      // 到点：玩家还在爪下就被抓住
      const t = this.boneWorld('talons', _v);
      if (Math.hypot(P.x - t.x, P.z - t.z) < 2.8 && Math.abs(ctx.center.y - t.y) < 3 && !ctx.invulnerable()) {
        ctx.hurt(18, '大鹗的虎爪');
        if (ctx.player.alive) { this.mem.grabbed = 1; this.begin(DAE.grab); this.warns = []; ctx.say('被抓住了！打它的胸口 / 爪子挣脱', 2); }
      }
    } else if (ev === 'warn' && id === 'feathers') {
      // 八道羽刃划痕
      this.mem.lines = 0;
      const lines: number[] = [];
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI, ox = (Math.random() - 0.5) * (i < 2 ? 1 : 12), oz = (Math.random() - 0.5) * (i < 2 ? 1 : 12);
        const cx = P.x + ox, cz = P.z + oz;
        const ax = cx - Math.cos(a) * 6, az = cz - Math.sin(a) * 6, bx = cx + Math.cos(a) * 6, bz = cz + Math.sin(a) * 6;
        lines.push(ax, az, bx, bz);
        this.warns.push(ctx.fx.lineWarn(ax, az, bx, bz, 1.0, this.move.def!.windup + this.move.def!.active, '#ff5ad8'));
      }
      this.mem.featherLines = 1;
      (this as unknown as { lines: number[] }).lines = lines;
    } else if (ev === 'land' && id === 'feathers') {
      const lines = (this as unknown as { lines: number[] }).lines ?? [];
      let hits = 0;
      for (let i = 0; i < lines.length; i += 4) {
        ctx.fx.spray(_v.set((lines[i] + lines[i + 2]) / 2, ctx.terrain.heightAt(lines[i], lines[i + 1]) + 0.5, (lines[i + 1] + lines[i + 3]) / 2), ['#26221f', '#ff7ae6'], 8, 3, 2, 10, 0.5);
        if (hits < 2 && segDist(P.x, P.z, lines[i], lines[i + 1], lines[i + 2], lines[i + 3]) < 0.7 && !ctx.invulnerable()) { hits++; ctx.hurt(8, '大鹗的羽刃'); }
      }
    } else if (ev === 'volley') {
      // 停在碉楼顶：朝玩家放一串羽刃（直线弹）
      const from = this.boneWorld('chest', new THREE.Vector3());
      for (const off of [-0.12, 0, 0.12]) {
        const dir = _w.copy(ctx.center).sub(from).normalize();
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
        if (this.blind) dir.add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)).normalize();
        ctx.fx.shot(from.clone(), dir.multiplyScalar(30).clone(), 0.5, '#ff7ae6', (at, hitP) => {
          if (hitP && !ctx.invulnerable()) ctx.hurt(8, '大鹗的羽刃'); else ctx.fx.spray(at, '#26221f', 6, 2, 1, 10, 0.4);
        });
      }
    } else if (ev === 'jolt') {
      // 摇桥：桥上的人被晃一下
      const mid = this.g.crossings.ironMid;
      ctx.fx.spray(mid, ['#6a5a48', '#a89070'], 12, 6, 3, 12, 0.6);
      ctx.shake(0.12);
      if (Math.abs(P.y - mid.y) < 3.5 && Math.hypot(P.x - mid.x, P.z - mid.z) < 42 && !ctx.invulnerable()) {
        const a = Math.random() * Math.PI * 2;
        ctx.hurt(4, '大鹗摇桥', { x: Math.cos(a) * 6, z: Math.sin(a) * 6, up: 3 });
      }
    } else if (ev === 'drop') {
      this.release(false);
    } else if (ev === 'warn' && id === 'nestGust') {
      const nest = this.perchAt.nest;
      this.warns.push(ctx.fx.coneWarn(nest.x, nest.z, Math.atan2(P.x - nest.x, P.z - nest.z), 0.9, 40, this.move.def!.windup, '#2fb8ff'));
    }
  }

  /** 擒拿结束：扔下；broke = 被打得松了爪 */
  private release(broke: boolean): void {
    if (this.move.id !== 'grab') return;
    const ctx = this.ctx;
    this.move.cancel();
    ctx.walker.vy = 0;
    ctx.walker.grounded = false;
    if (broke) { ctx.say('挣脱了！', 1.5); this.stun(1.5, '被打得松了爪'); }
    else ctx.hurt(10, '被大鹗扔下来');
    this.plan = ['takeoff'];
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id, st = this.move.stage;
    if (this.crashing) return;
    if (this.move.busy) {
      if (id === 'dive' || id === 'diveChain') {
        if (st === 'windup') {
          // 飞到俯冲起点，影子开始出现；落点在最后 0.3 秒定下来
          this.pos.lerp(this.A, Math.min(1, dt * 2.2));
          this.B.set(P.x + ctx.pvel.x * 0.3, 0, P.z + ctx.pvel.y * 0.3);
          if (this.blind) this.B.x += Math.sin(ctx.time * 7) * 8, this.B.z += Math.cos(ctx.time * 5) * 8;
          this.B.y = ctx.terrain.heightAt(this.B.x, this.B.z) + 1.8;
          this.prev.copy(this.pos);
          this.flap = 0.5;
          return;
        }
        if (st === 'active') {
          const k = this.move.stageK;
          this.pos.lerpVectors(this.prev, this.B, k * k);
          this.flap = 0.1;
          return;
        }
        // 收招：贴着地面拉起来（又低又慢）
        this.pos.y += dt * 6;
        this.pos.x += Math.sin(this.yaw) * 10 * dt; this.pos.z += Math.cos(this.yaw) * 10 * dt;
        this.flap = 1;
        if (this.move.stageK > 0.9 && id === 'diveChain' && (this.mem.chain ?? 0) > 0) { this.mem.chain--; this.begin(DAE.diveChain); }
        return;
      }
      if (id === 'grab') {
        // 带上天：2 秒升 14 m，玩家挂在爪子下面
        this.pos.y += dt * 7;
        this.flap = 1;
        const t = this.boneWorld('talons', _v);
        ctx.walker.feet.set(t.x, t.y - 1.7, t.z);
        ctx.walker.vy = 0;
        return;
      }
      if (id === 'flyTo') {
        const to = this.perchAt[this.flyTarget];
        const d = this.pos.distanceTo(to);
        const step = Math.min(d, 26 * dt);
        this.pos.addScaledVector(_v.subVectors(to, this.pos).normalize(), step);
        if (d > 10) this.pos.y += Math.sin(Math.min(1, d / 60) * Math.PI) * 4 * dt;
        this.flap = d < 12 ? 1 : 0.4;
        if (d < 0.5) { this.pos.copy(to); this.perched = this.flyTarget; this.move.finishActive(); }
        return;
      }
      if (id === 'perch' || id === 'shake' || id === 'nestGust') {
        if (this.perched) this.pos.copy(this.perchAt[this.perched]);
        this.flap = id === 'shake' ? 0.7 + 0.3 * Math.sin(ctx.time * 5) : id === 'nestGust' && st === 'active' ? 1 : 0;
        if (id === 'nestGust' && st === 'active') {
          const nest = this.perchAt.nest, d = Math.hypot(P.x - nest.x, P.z - nest.z);
          if (d < 40 && d > 0.5) ctx.walker.shove((P.x - nest.x) / d * 7 * dt, (P.z - nest.z) / d * 7 * dt);
          if (Math.random() < 0.5) ctx.fx.spray(_v.set(P.x + (Math.random() - 0.5) * 6, P.y + 1.5, P.z + (Math.random() - 0.5) * 6), '#f0f8ff', 1, 1, 0, -1, 0.5);
        }
        return;
      }
      if (id === 'feathers') { this.circle(dt); return; }
      return;
    }
    // 没在出招：照计划走（起飞 / 去落脚点 / 停下来做事），否则盘旋、抽招
    if (this.plan.length) {
      const next = this.plan.shift()!;
      if (next === 'takeoff') { this.perched = null; this.angle = Math.atan2(this.pos.z - LORD.circle.z, this.pos.x - LORD.circle.x); return; }
      if (next.startsWith('fly:')) { this.flyTarget = next.slice(4) as PerchId; this.perched = null; this.begin(DAE.flyTo); return; }
      const m = DAE[next];
      if (m) { this.begin(this.use(m)); this.plan.push('takeoff'); return; }
    }
    if (this.perched) { this.pos.copy(this.perchAt[this.perched]); this.flap = 0; if (this.cd <= 0) this.plan.push('takeoff'); return; }
    this.circle(dt);
    if (this.cd > 0) return;
    this.cd = 1.2 * this.tempo;
    const pick = this.pick([DAE.dive, DAE.feathers, DAE.perch, DAE.shake, DAE.diveChain, DAE.nestGust], (m) => {
      if (m.id === 'dive') return this.phase === 3 ? 0.6 : 2;
      if (m.id === 'feathers') return 1;
      if (m.id === 'perch') return this.phase === 1 ? 1 : 0.4;
      if (m.id === 'shake') return 2.2;
      if (m.id === 'diveChain') return 2;
      if (m.id === 'nestGust') return this.g.rockDropped ? 0.4 : 1.4;
      return 1;
    });
    if (!pick) return;
    if (pick.id === 'perch') this.plan = ['fly:tower', 'perch'];
    else if (pick.id === 'shake') this.plan = ['fly:bridge', 'shake'];
    else if (pick.id === 'nestGust') this.plan = ['fly:nest', 'nestGust'];
    else { if (pick.id === 'diveChain') this.mem.chain = 2; this.begin(pick); }
    void dist;
  }

  private circle(dt: number): void {
    this.angle += dt * 0.32;
    this.pos.lerp(this.circlePos(_v), Math.min(1, dt * 1.5));
    this.flap = 0.15 + 0.1 * Math.sin(this.ctx.time * 0.7);
  }

  protected override showing(): void {}

  protected override after(dt: number): void {
    const ctx = this.ctx, M = this.rig;
    // 朝向：飞行时朝速度方向、按爬升俯冲抬低头、盘旋时往里侧倾；停着时朝落脚点的「正面」
    const dx = this.pos.x - this.prev.x, dz = this.pos.z - this.prev.z, dy = this.pos.y - this.prev.y;
    const sp = Math.hypot(dx, dz);
    if (this.perched && !this.crashing) {
      const f = this.perchFace[this.perched];
      const want = this.move.id === 'perch' || this.move.id === 'nestGust' ? Math.atan2(ctx.feet.x - this.pos.x, ctx.feet.z - this.pos.z) : Math.atan2(f.x - this.pos.x, f.z - this.pos.z);
      this.faceTo(this.pos.x + Math.sin(want), this.pos.z + Math.cos(want), dt, 3);
      M.bird.rotation.x = 0;
      if (!this.inShow) M.bird.rotation.z = 0;
    } else if (!this.crashing && sp > 1e-3 && !this.defeated) {
      this.faceTo(this.pos.x + dx, this.pos.z + dz, dt, 4);
      M.bird.rotation.x = -Math.atan2(dy, sp + 1e-3) * 0.7;
      M.bird.rotation.z = this.move.busy ? 0 : -0.35;
    } else if (this.crashing && !this.defeated) {
      M.bird.rotation.z = Math.sin(ctx.time * 4) * 0.5 + 1.2;
    }
    this.prev.copy(this.pos);
    // 扇翅：flap 0 = 收拢，1 = 大力扇；擒拿 / 停下时腿放下
    const folded = !!this.perched && this.flap < 0.1;
    const t = ctx.time;
    M.wings.forEach((w, i) => {
      const s = i ? 1 : -1;
      const beat = Math.sin(t * (3 + this.flap * 5)) * (0.15 + this.flap * 0.65);
      w.joints[0].rotation.z = folded ? s * -1.2 : s * beat;
      w.joints[1].rotation.z = folded ? s * 2.4 : s * beat * 0.5;
      w.joints[2].rotation.z = folded ? s * 0.4 : s * beat * 0.3;
      w.root.rotation.y = folded ? -s * 0.5 : 0;
    });
    const legsDown = !!this.perched || this.move.id === 'grab' || (this.move.id === 'dive' || this.move.id === 'diveChain') && this.move.stage === 'active';
    for (const lg of M.legs) lg.rotation.x = legsDown ? (this.move.stage === 'active' && this.move.id !== 'grab' ? 0.6 : 0) : -1.1;
    M.head.rotation.y = this.perched ? Math.sin(t * 0.8) * 0.6 : 0;
    // 地上的影子：投在正下方，越低越黑越小；俯冲前摇时变大变黑（预警）
    const g = ctx.terrain.heightAt(this.pos.x, this.pos.z), hgt = this.pos.y - g;
    const diving = (this.move.id === 'dive' || this.move.id === 'diveChain') && this.move.stage !== 'recover';
    const sh = diving ? this.B : this.pos;
    this.shadow.position.set(sh.x, ctx.terrain.heightAt(sh.x, sh.z) + 0.15, sh.z);
    const k = diving ? (this.move.stage === 'windup' ? this.move.stageK * 0.5 : 0.5 + 0.5 * this.move.stageK) : 0;
    this.shadow.scale.setScalar(diving ? 2 + 4 * k : Math.max(2.5, 7 - hgt * 0.05));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = diving ? 0.25 + 0.5 * k : Math.max(0.08, 0.45 - hgt * 0.004);
    this.shadow.visible = this.host.visible && !this.defeated;
    // 破防 / 眩晕后重新起飞
    if (!this.perched && !this.crashing && (this.stunT > 0 || this.brokenT > 0)) this.flap = 0.2;
  }
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1;
  const t = THREE.MathUtils.clamp(((px - ax) * vx + (pz - az) * vz) / L, 0, 1);
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

/** 场地机关里能被子弹打的东西 */
class PropTarget implements Target {
  alive = true;
  private readonly list: HitSphere[];
  constructor(readonly label: string, at: THREE.Vector3, r: number, private readonly onHit: () => void, private readonly enabled: () => boolean = () => true) {
    this.list = [{ c: at, r, mult: 1 }];
  }
  spheres(): readonly HitSphere[] { return this.alive && this.enabled() ? this.list : []; }
  hit(): number { this.onHit(); return 0; }
}

export class GorgePlay extends PlaySession {
  readonly dae: DaeBoss;
  readonly encounter: EncounterState;
  rockDropped = false;
  private beaconT: number[] = [];
  private readonly smoke: THREE.Vector3[] = [];

  constructor(
    scene: THREE.Scene, camera: THREE.PerspectiveCamera, terrain: GorgeTerrain, world: CollisionWorld, walker: Walker, weather: Weather,
    readonly crossings: CrossingField, readonly gp: GorgeProps, conductors: THREE.Vector3[], bound: (x: number, z: number) => number,
  ) {
    super(scene, camera, terrain, world, walker, weather, conductors, bound);
    this.dae = new DaeBoss(this, terrain);
    this.bosses.push(this.dae);
    const s2 = SITES.find(s => s.id === 's2')!;
    this.checkpoint.set(s2.altar![0], 0, s2.altar![1]);
    const E = ENCOUNTERS.find(e => e.site === 's3')!;
    this.encounter = { id: E.id, site: E.site, x: E.x, z: E.z, r: E.r, foes: [], alerted: false, cleared: false, burrows: [], tokens: { melee: 0, pounce: 0, ranged: 0, howl: 0 } };
    // 场地机关：两根雷桩、两个溜索锚桩、危岩木楔
    for (const p of gp.thunderPosts) {
      this.props.push(new PropTarget('雷桩', p.pos, 0.8, () => this.discharge(p)));
    }
    for (const z of crossings.zips) this.props.push(new PropTarget(`${z.spec.name}锚桩`, z.a.clone().add(new THREE.Vector3(0, -1.5, 0)), 0.9, () => this.cutZip(z), () => !z.cut));
    if (gp.looseRock) {
      const rock = gp.looseRock;
      this.props.push(new PropTarget('危岩木楔', rock.pos.clone().add(new THREE.Vector3(0, -1.9, 0.6)), 1.1, () => this.dropRock(), () => !rock.dropped));
    }
    this.beaconT = gp.beacons.map(() => 0);
  }

  async start(): Promise<void> {
    this.hud.loading('正在加载第四章的模型…');
    await loadPlateauModels((d, n) => this.hud.loading(`正在加载第四章的模型… ${d}/${n}`));
    this.hud.loading('');
    this.nav = new NavField(this.terrain, this.world);
    // 江嘴台地的守卫：天狗 ×3、举父
    const E = ENCOUNTERS.find(e => e.site === 's3')!;
    let lastMan: Manman | null = null;
    for (const u of E.units) {
      const ground = this.terrain.heightAt(u.at[0], u.at[2]);
      const f = createFoe(u.kind, this, new THREE.Vector3(u.at[0], ground + u.at[1], u.at[2]), u.at[1], MONSTER_NAMES);
      f.enc = this.encounter;
      if (f instanceof Manman) { if (lastMan) { lastMan.pair(f, true); f.pair(lastMan, false); lastMan = null; } else lastMan = f; }
      this.encounter.foes.push(f);
      this.foes.push(f);
    }
    this.setup();
    this.respawn(true);
    this.ready = true;
    this.say('大渡河 · 江嘴：鹗巢在江嘴的绝壁上。走上铁索桥或江嘴台地，它就会出来', 5);
  }

  /** 打雷桩：攒到六成以上就把电送进铁链 */
  private discharge(p: { pos: THREE.Vector3; charge: number }): void {
    if (p.charge < 0.6) { if (!this.mem.postHint || this.time - this.mem.postHint > 3) { this.mem.postHint = this.time; this.say(`雷桩只攒了 ${Math.round(p.charge * 100)}% 的电——雷暴里等它攒到六成`, 2); } return; }
    p.charge = 0;
    this.crossings.electrify(1);
    const mid = this.crossings.ironMid;
    for (let i = 0; i < 3; i++) this.fx.arc(p.pos, mid.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10)), '#ff7ae6', 0.4, 1.2);
    this.fx.burst(p.pos, 2.5, '#ff7ae6');
    this.shake(0.25);
    this.say('雷桩放电——电送进了铁链！', 2);
  }

  /** 打断溜索锚桩：钢索弹起；大鹗正从索下低空掠过就被抽中缠住翅膀 */
  private cutZip(z: Zip): void {
    if (z.cut) return;
    z.cut = true;
    z.handle.visible = false;
    this.fx.burst(z.a, 2, '#e8d8c0');
    this.fx.spray(z.a, ['#8a6a3a', '#c9a27b'], 20, 5, 3, 12, 0.6);
    // 钢索抽一下：画一道从锚桩扫过去的弧
    for (let k = 0; k <= 6; k++) this.fx.arc(z.at(k / 6), z.at(Math.min(1, (k + 1) / 6)).add(new THREE.Vector3(0, 3 * Math.sin(k), 0)), '#d8d8d8', 0.35, 0.8);
    const B = this.dae;
    const p = B.pos;
    let near = Infinity;
    for (let k = 0; k <= 20; k++) near = Math.min(near, z.at(k / 20, _v).distanceTo(p));
    if (near < 12 && !B.perched && B.active) { B.tangle(); this.say(`${z.spec.name}的钢索抽中了大鹗！`, 2.5); }
    else this.say(`${z.spec.name}的锚桩断了（它不在钢索附近，没抽中）`, 2.5);
  }

  /** 打掉危岩木楔：落石砸巢（一次） */
  private dropRock(): void {
    if (!this.gp.looseRock || this.gp.looseRock.dropped) return;
    this.gp.looseRock.dropped = true;
    this.rockDropped = true;
    this.shake(0.3);
    setTimeout(() => {
      if (this.dae.crush()) this.say('危岩砸进了巢里！', 2.5);
      else this.say('危岩砸进了空巢（它不在巢里）', 2.5);
    }, 700);
  }

  /** 燎的火点着烽火 */
  override onFire(at: THREE.Vector3, r: number): void {
    super.onFire(at, r);
    this.gp.beacons.forEach((b, i) => {
      if (!b.lit && b.pos.distanceTo(at) < r + 3) { b.lit = true; this.beaconT[i] = 20; this.say('烽火点着了——浓烟里大鹗看不见人', 2.5); }
    });
  }

  protected override onStrike(at: THREE.Vector3): void {
    // 雷劈中铁索（落点在桥上）：整座桥带电
    const mid = this.crossings.ironMid;
    if (Math.hypot(at.x - mid.x, at.z - mid.z) < 40 && Math.abs(at.y - mid.y) < 8) this.crossings.electrify(1);
  }

  protected tick(dt: number, input: PlayInput, locked: boolean): void {
    void input; void locked;
    // 烽火：烧 20 秒
    this.smoke.length = 0;
    this.gp.beacons.forEach((b, i) => {
      if (!b.lit) return;
      this.beaconT[i] -= dt;
      if (this.beaconT[i] <= 0) b.lit = false;
      else this.smoke.push(b.pos.clone().add(new THREE.Vector3(6, 20, 0)));
    });
    this.dae.blind = this.smoke.some(s => s.distanceTo(this.dae.pos) < 45);
    // 铁链带电：抓着铁链的大鹗被电
    if (this.crossings.charge > 0.4) this.dae.electrocute();
    // 江嘴守卫：走近整片醒
    const e = this.encounter;
    if (!e.alerted && Math.hypot(this.feet.x - e.x, this.feet.z - e.z) < e.r * 0.75) { e.alerted = true; for (const f of e.foes) if (f.alive) f.notice(); }
    if (!this.won && this.dae.defeated && !this.dae.inShow) this.victory();
  }

  protected onLordDown(): void {
    const P = this.player;
    P.dmgMul += 0.2; P.maxHp += 25; P.hp = P.maxHp; P.shield = P.maxShield;
    this.say('大鹗坠江——③ 江嘴的灵火点亮了', 5);
    this.kit.offer(3);
  }

  protected respawn(first: boolean): void {
    this.resetCommon();
    const c = this.checkpoint;
    this.walker.fly = false;
    this.walker.place(c.x + (first ? 0 : 3), c.z + (first ? 0 : 3));
    if (first) this.walker.lookAt(new THREE.Vector3(-1, 30, -58));
    if (!first) this.hud.center('', '');
    for (const f of this.encounter.foes) f.reset();
    this.encounter.alerted = false;
  }

  protected objective(): string {
    if (this.won) return '';
    if (!this.dae.active && !this.dae.defeated) return '走上铁索桥或江嘴台地：鹗巢里的领主大鹗会出来';
    return '打败大鹗 · 雷桩（攒电六成以上打它）→ 铁链 · 溜索锚桩 · 危岩木楔 · 烽火（用燎的火点）';
  }

  private victory(): void {
    this.won = true;
    const m = Math.floor(this.time / 60), s = Math.floor(this.time % 60);
    this.hud.victory('通关 · 大鹗 · 坠江', [
      `用时 ${m} 分 ${String(s).padStart(2, '0')} 秒 · 倒下 ${this.deaths} 次`,
      `场地机关：${[this.crossings.zips.some(z => z.cut) ? '溜索锚桩' : '', this.rockDropped ? '危岩' : '', this.gp.beacons.some(b => b.lit) ? '烽火' : ''].filter(Boolean).join('、') || '没用'}`,
      `秘卷：${this.kit.list().join('、') || '无'}`,
    ]);
  }
}
