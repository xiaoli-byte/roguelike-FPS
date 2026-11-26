import * as THREE from 'three';
import type { GameContext } from '../core/types';
import { unityPoint, unityQuaternion, type UnitySceneDocument, type UnityWater } from './UnityLevelLibrary';
import { isSpringWater, stageHooks, type StageWaterBody, type StageWaterHook } from '../enemies/bosses/framework/StageHooks';

interface Body {
  def: UnityWater;
  spring: boolean;
  quaternion: THREE.Quaternion;
  renderers: THREE.Object3D[];
  center: THREE.Vector3;
  inverse: THREE.Quaternion;
  scale: THREE.Vector3;
  bottom: number;
  level: number;
  from: number;
  to: number;
  seconds: number;
  time: number;
}

const SOURCE = 'unity.water';
const _local = new THREE.Vector3(), _point = new THREE.Vector3(), _sink = new THREE.Vector3();

export class UnityWaterView implements StageWaterHook {
  private readonly bodies: Body[] = [];
  private readonly safe: THREE.Vector3;
  private slow = 1;
  private wasInWater = false;
  private dropAcc = 0;
  private readonly off: (() => void)[] = [];
  private surfaces: { object: THREE.Object3D; y: number }[] | null = null;
  /** 首领经钩子接手了泉水（之后不再按事件自己吸干 / 复涌） */
  private driven = false;

  constructor(private readonly ctx: GameContext, document: UnitySceneDocument, roots: ReadonlyMap<string, THREE.Object3D[]>) {
    this.safe = ctx.player.position.clone();
    for (const def of document.water ?? []) {
      const renderers = roots.get(def.id) ?? [];
      const scale = new THREE.Vector3().fromArray(def.scale);
      const center = unityPoint(def.center);
      const quaternion = unityQuaternion(def.rotation);
      this.bodies.push({
        def, spring: isSpringWater(def.name ?? '', def.spring), quaternion, renderers, center, scale, bottom: center.y - scale.y * 0.5,
        inverse: quaternion.clone().invert(), level: 1, from: 1, to: 1, seconds: 1, time: 0,
      });
    }
    // 月牙泉的吸干 / 复涌由旱魃经 StageHooks 驱动（Unity HanbaSpring：二阶段演出里吸干、倒下后泉眼复涌）；
    // 没有首领接手时（driven 为 false）照旧按首领阶段 / 击杀事件自己吸干、复涌
    if (this.bodies.length > 0) stageHooks.water = this;
    this.off.push(ctx.events.on('enemy:bossPhase', ({ enemy, phase }) => {
      if (this.driven || enemy.def.id !== 'boss_hanba' || phase !== 1) return;
      enemy.getHeadCenter(_sink);
      for (const body of this.bodies) if (body.spring) this.transition(body, 0, 3.2);
    }));
    this.off.push(ctx.events.on('enemy:killed', ({ enemy }) => {
      if (this.driven || enemy.def.id !== 'boss_hanba') return;
      for (const body of this.bodies) if (body.spring) this.transition(body, 1, 4.2);
    }));
  }

  // ───────────── StageWaterHook ─────────────

  waterBodies(): readonly StageWaterBody[] {
    return this.bodies.map(b => ({ name: b.def.name ?? '', spring: b.spring, center: b.center, scale: b.scale, quaternion: b.quaternion, bottom: b.bottom }));
  }

  depthAt(p: THREE.Vector3, springOnly = false): number {
    let deepest = 0;
    for (const body of this.bodies) if (!springOnly || body.spring) deepest = Math.max(deepest, this.depth(body, p));
    return deepest;
  }

  springLevel(): number {
    const body = this.bodies.find(b => b.spring);
    return body ? body.level : NaN;
  }

  springTo(target: number, seconds: number, sink?: THREE.Vector3 | null): void {
    this.driven = true;
    if (sink) _sink.copy(sink);
    for (const body of this.bodies) if (body.spring) this.transition(body, target, seconds);
  }

  /** 整弯泉共用的水面（名字带 CrescentSpring Surface 的渲染件）：按水位落到泉床最低处，水位 0 时隐去 */
  private springSurfaces(level: number, animating: boolean): void {
    if (!this.surfaces) {
      this.surfaces = [];
      this.ctx.scene?.traverse(o => {
        if (/crescent ?spring/i.test(o.name) && /surface/i.test(o.name)) this.surfaces!.push({ object: o, y: o.position.y });
      });
    }
    if (this.surfaces.length === 0) return;
    let lowest = Infinity;
    for (const b of this.bodies) if (b.spring) lowest = Math.min(lowest, b.bottom);
    for (const s of this.surfaces) {
      s.object.visible = level > 0.001 || animating;
      const floor = Number.isFinite(lowest) ? Math.min(lowest, s.y) : s.y;
      s.object.position.y = floor + (s.y - floor) * level;
    }
  }

  private transition(body: Body, target: number, seconds: number): void {
    body.from = body.level;
    body.to = target;
    body.time = 0;
    body.seconds = seconds;
  }

  private depth(body: Body, position: THREE.Vector3): number {
    if (body.level <= 0.001 && body.to <= body.from) return 0;
    const half = body.scale.y * Math.max(0.02, body.level) * 0.5;
    _local.copy(position).sub(_point.copy(body.center).setY(body.bottom + half)).applyQuaternion(body.inverse);
    // 本地坐标是米（没除缩放）：按盒子的半宽 / 半深判断在不在水里，低于泉床不算
    if (Math.abs(_local.x) > body.scale.x * 0.5 || Math.abs(_local.z) > body.scale.z * 0.5 || _local.y < -half - 1e-3) return 0;
    return Math.max(0, body.bottom + body.scale.y * body.level - position.y);
  }

  private factor(def: UnityWater, depth: number): number {
    if (depth <= def.shallow) return 1;
    const t = THREE.MathUtils.clamp((depth - def.shallow) / Math.max(0.01, def.deep - def.shallow), 0, 1);
    return THREE.MathUtils.lerp(1, def.wadeSlow, t * t * (3 - 2 * t));
  }

  update(dt: number): void {
    if (this.bodies.length === 0) return;
    let deepest = 0;
    let deepestDef = this.bodies[0].def;
    for (const body of this.bodies) {
      if (body.time < body.seconds) {
        body.time = Math.min(body.seconds, body.time + dt);
        const t = body.time / body.seconds;
        body.level = THREE.MathUtils.lerp(body.from, body.to, t * t * (3 - 2 * t));
        if (body.to < body.from) this.droplets(body, dt);
        if (body.spring) this.springSurfaces(body.level, body.time < body.seconds);
      }
      const active = body.level > 0.001 || body.to > body.from;
      for (const renderer of body.renderers) {
        renderer.visible = active;
        if (!active) continue;
        const level = Math.max(0.02, body.level);
        renderer.scale.y = body.scale.y * level;
        renderer.position.y = body.bottom + body.scale.y * level * 0.5;
      }
      const playerDepth = this.depth(body, this.ctx.player.position);
      if (playerDepth > deepest) {
        deepest = playerDepth;
        deepestDef = body.def;
      }
      for (const enemy of this.ctx.enemies.list) {
        if (enemy.alive) enemy.slowMult = Math.min(enemy.slowMult, this.factor(body.def, this.depth(body, enemy.position)));
      }
    }
    const slow = deepest > 0 ? this.factor(deepestDef, deepest) : 1;
    if (Math.abs(slow - this.slow) > 0.005 || slow === 1 && this.slow !== 1) {
      this.ctx.player.stats.removeSource(SOURCE);
      if (slow < 1) this.ctx.player.stats.add('moveSpeed', -this.ctx.player.stats.getBase('moveSpeed') * (1 - slow), SOURCE);
      this.slow = slow;
    }
    if (deepest > 0 && !this.wasInWater) {
      this.ctx.fx.ring(this.ctx.player.position, 1.2, 0xcef0ff, 0.5);
      this.ctx.audio.play('land', { position: this.ctx.player.position, volume: 0.35, pitch: 1.3 });
    }
    this.wasInWater = deepest > 0;
    if (deepest > 0 && deepestDef.deepIsHazard && deepest >= deepestDef.deep) {
      this.ctx.combat.damagePlayer(this.ctx.player.maxHp() * deepestDef.drownBurst, 'none', null, this.ctx.player.position);
      this.ctx.player.teleport(this.safe.clone());
    } else if (this.ctx.player.onGround && deepest <= deepestDef.shallow) {
      if (this.ctx.nav.nearestWalkable(this.ctx.player.position, this.safe)) this.safe.copy(this.ctx.player.position);
    }
  }

  private droplets(body: Body, dt: number): void {
    this.dropAcc += dt;
    if (this.dropAcc < 0.06 || body.level <= 0.001) return;
    this.dropAcc = 0;
    _point.copy(body.center).setY(body.bottom + body.scale.y * body.level);
    for (let i = 0; i < 4; i++) {
      const k = (i + this.ctx.rng.next() * 0.6) / 4;
      const p = _point.clone().lerp(_sink, k);
      p.y += Math.sin(k * Math.PI) * 2.5;
      this.ctx.fx.burst(p, 0xcef0ff, 2, 0.6, 0.35, 0.14, -0.5);
    }
  }

  dispose(): void {
    if (stageHooks.water === this) stageHooks.water = null;
    for (const off of this.off) off();
    this.off.length = 0;
    this.ctx.player.stats.removeSource(SOURCE);
  }
}
