/**
 * 投射物系统：对象池、运动（速度 + 重力 + 追踪）、逐帧线段检测防穿透、反弹 / 滚动、穿透、爆炸与回调。
 *
 * 碰撞规则：
 *  - 墙体：ctx.world.raycast，按投射物半径（上限 0.25 米）提前停下；bounces>0 时按法线反射并损失能量，
 *    会反弹的投射物低速落地时改为贴地滚动（不消耗反弹次数），否则命中结算。
 *  - 玩家投射物 vs 敌人：精确射线（ctx.enemies.raycast）+ 按投射物半径膨胀的胶囊 / 头部球补测。
 *  - 敌方投射物 vs 玩家：线段到玩家胶囊（脚底到头顶）的距离 ≤ 玩家半径 + 投射物半径。冲刺无敌时穿过。
 *  - 有爆炸半径的投射物命中时只结算爆炸伤害（不再额外结算直击伤害）。
 */
import * as THREE from 'three';
import type { DamageRequest, Element, GameContext, IEnemy, IProjectileSystem, ProjectileSpec, ProjectileVisual } from '../core/types';
import type { StaticBox, WorldRayHit } from '../world/Collision';
import { clamp, clamp01, distSqPointSegment, raySphere, rayVerticalCapsule } from '../core/math';
import { PROJECTILE_VISUALS, ProjectileView, tailOffset, Trail, viewSize } from './ProjectileVisuals';
import { blastPlayer, explosionShake, lineClear } from './Blast';

// ───────────── 参数 ─────────────

/** 与墙体碰撞时使用的半径上限（大光球不至于离墙老远就爆） */
const WALL_PAD_MAX = 0.25;
/** 小于此半径不做膨胀补测 */
const INFLATE_MIN_RADIUS = 0.06;
/** 落地法向速度低于此值时改为滚动 */
const ROLL_SPEED = 2.2;
const ROLL_FRICTION = 2.8;
const BOUNCE_NORMAL_KEEP = 0.55;
const BOUNCE_TANGENT_KEEP = 0.78;
/** 玩家追踪弹：发射后多久开始转向（让齐射散开） */
const PLAYER_HOMING_DELAY = 0.1;
const PLAYER_HOMING_RANGE = 40;
const HOMING_RETARGET = 0.25;
/** 敌方追踪弹瞄准的胸口高度 */
const PLAYER_CHEST = 1.15;
/** 非爆炸投射物到期前的缩小淡出时长 */
const EXPIRE_FADE = 0.12;
const MAX_SUBSTEPS = 5;

// ───────────── 临时量 ─────────────

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _end = new THREE.Vector3();
const _want = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _head = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();
const _wallN = new THREE.Vector3();
const _wallP = new THREE.Vector3();
const _tail = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _color = new THREE.Color();
const _warm = new THREE.Color(0xffe0b0);
const _wallHit: WorldRayHit = { distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null as unknown as StaticBox };

interface SweepHit {
  enemy: IEnemy | null;
  distance: number;
  point: THREE.Vector3;
  headshot: boolean;
}
const _sweep: SweepHit = { enemy: null, distance: 0, point: new THREE.Vector3(), headshot: false };

interface Projectile {
  active: boolean;
  owner: 'player' | 'enemy';
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  /** 最近一次有效的运动方向（静止时沿用） */
  readonly heading: THREE.Vector3;
  gravity: number;
  radius: number;
  lifetime: number;
  age: number;
  damage: DamageRequest | null;
  enemyDamage: number;
  element: Element;
  explosionRadius: number;
  selfDamage: number;
  pierce: number;
  bounces: number;
  canRoll: boolean;
  homing: number;
  color: number;
  visual: ProjectileVisual;
  size: number;
  explodeOnExpire: boolean;
  sourceEnemy: IEnemy | null;
  onImpact: ((point: THREE.Vector3, hitEnemy: IEnemy | null) => void) | null;
  readonly hitSet: Set<IEnemy>;
  homingTarget: IEnemy | null;
  retargetTimer: number;
  smokeTimer: number;
  view: ProjectileView | null;
  trail: Trail | null;
}

function createProjectile(): Projectile {
  return {
    active: false, owner: 'player',
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: new THREE.Vector3(0, 0, 1),
    gravity: 0, radius: 0.1, lifetime: 1, age: 0,
    damage: null, enemyDamage: 0, element: 'none', explosionRadius: 0, selfDamage: 0,
    pierce: 0, bounces: 0, canRoll: false, homing: 0,
    color: 0xffffff, visual: 'orb', size: 1, explodeOnExpire: false,
    sourceEnemy: null, onImpact: null, hitSet: new Set(),
    homingTarget: null, retargetTimer: 0, smokeTimer: 0,
    view: null, trail: null,
  };
}

/**
 * 线段 p1→q1 与竖直线段 (x, y0..y1, z) 的最近距离平方；线段 1 上最近点的参数写入 segS。
 * （Ericson《Real-Time Collision Detection》5.1.9，特化为第二条线段竖直）
 */
let segS = 0;
function segVerticalDistSq(p1: THREE.Vector3, q1: THREE.Vector3, x: number, y0: number, y1: number, z: number): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2y = y1 - y0;
  const rx = p1.x - x, ry = p1.y - y0, rz = p1.z - z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2y * d2y;
  const f = d2y * ry;
  let s: number;
  let t: number;
  if (a <= 1e-10 && e <= 1e-10) {
    s = 0;
    t = 0;
  } else if (a <= 1e-10) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-10) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1y * d2y;
      const denom = a * e - b * b;
      s = denom > 1e-10 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  segS = s;
  const cx = p1.x + d1x * s - x;
  const cy = p1.y + d1y * s - (y0 + d2y * t);
  const cz = p1.z + d1z * s - z;
  return cx * cx + cy * cy + cz * cz;
}

export class ProjectileSystem implements IProjectileSystem {
  private readonly group = new THREE.Group();
  private active: Projectile[] = [];
  private readonly free: Projectile[] = [];
  private readonly viewPools = new Map<ProjectileVisual, ProjectileView[]>();
  private readonly trailPool: Trail[] = [];
  private readonly dyingTrails: Trail[] = [];
  private live = 0;
  private floorY = 0;

  constructor(readonly ctx: GameContext) {
    this.group.name = 'projectiles';
  }

  get count(): number {
    return this.live;
  }

  init(): void {
    this.ctx.scene.add(this.group);
    // 换关时（黑幕中）预热外观与着色器，避免第一次开火卡顿
    this.ctx.events.on('stage:loaded', () => this.warmUp());
  }

  /**
   * 每种造型取一个外观（池空时新建）+ 一条拖尾，缩成一点放在镜头前，预编译后再画一帧，然后隐藏放回对象池。
   * 只 compile 不够：第一次真正绘制时驱动还要再准备一遍（实测十几毫秒），这一帧在黑幕下看不到。
   * 受光材质随关卡灯光 / 雾变化，所以每次换关都做，已有的程序直接命中缓存。
   */
  private warmUp(): void {
    const { renderer, scene, camera } = this.ctx;
    camera.getWorldPosition(_tail).addScaledVector(camera.getWorldDirection(_dir), 2);
    const views: ProjectileView[] = [];
    for (const kind of PROJECTILE_VISUALS) {
      const view = this.acquireView(kind);
      view.setup(0xffffff, false, 1e-3);
      view.root.position.copy(_tail);
      views.push(view);
    }
    const trail = this.acquireTrail();
    trail.reset(_tail, 0x000000, 0, 1);
    trail.update(_tail);
    try {
      renderer.compile(this.group, camera, scene);
      renderer.render(scene, camera);
    } catch (err) {
      console.warn('[Projectiles] 预热失败（不影响运行）', err);
    }
    for (const view of views) {
      view.hide();
      this.viewPools.get(view.kind)!.push(view);
    }
    trail.hide();
    this.trailPool.push(trail);
  }

  // ───────────── 发射 ─────────────

  spawn(spec: ProjectileSpec): void {
    const sp = spec.position, sv = spec.velocity;
    if (!Number.isFinite(sp.x + sp.y + sp.z) || !Number.isFinite(sv.x + sv.y + sv.z)) return;
    const p = this.free.pop() ?? createProjectile();
    p.active = true;
    p.owner = spec.owner;
    p.pos.copy(sp);
    p.vel.copy(sv);
    const speed = p.vel.length();
    if (speed > 1e-4) p.heading.copy(p.vel).multiplyScalar(1 / speed);
    else p.heading.set(0, 0, 1);
    p.gravity = spec.gravity ?? 0;
    p.radius = Math.max(0.01, spec.radius);
    p.lifetime = spec.lifetime > 0 ? spec.lifetime : 5;
    p.age = 0;
    p.damage = spec.damage ? { ...spec.damage } : null;
    p.enemyDamage = spec.enemyDamage ?? 0;
    p.element = spec.element ?? spec.damage?.element ?? 'none';
    p.explosionRadius = Math.max(0, spec.explosionRadius ?? 0);
    p.selfDamage = spec.selfDamage ?? 0;
    p.pierce = Math.max(0, Math.floor(spec.pierce ?? 0));
    p.bounces = Math.max(0, Math.floor(spec.bounces ?? 0));
    p.canRoll = p.bounces > 0;
    p.homing = Math.max(0, spec.homing ?? 0);
    p.color = spec.color;
    p.visual = spec.visual ?? 'orb';
    p.size = viewSize(p.visual, p.radius, spec.scale ?? 1);
    p.explodeOnExpire = spec.explodeOnExpire ?? p.explosionRadius > 0;
    p.sourceEnemy = spec.sourceEnemy ?? null;
    p.onImpact = spec.onImpact ?? null;
    p.hitSet.clear();
    p.homingTarget = null;
    p.retargetTimer = 0;
    p.smokeTimer = 0;

    const view = this.acquireView(p.visual);
    view.setup(p.color, p.owner === 'enemy', p.size);
    view.root.position.copy(p.pos);
    view.animate(p.heading, 0, p.lifetime, 0, 1);
    p.view = view;

    p.trail = null;
    if (p.visual === 'rocket' || p.visual === 'grenade' || p.visual === 'blade' || (p.homing > 0 && p.visual !== 'arrow')) {
      const trail = this.acquireTrail();
      let width: number;
      let spacing: number;
      _color.setHex(p.color);
      if (p.visual === 'rocket') {
        _color.lerp(_warm, 0.5);
        width = 0.11 * p.size;
        spacing = 0.22;
      } else if (p.visual === 'grenade') {
        width = 0.06 * p.size;
        spacing = 0.18;
      } else if (p.visual === 'blade') {
        // 魔刀千刃飞刃：细拖尾
        width = 0.35 * p.size;
        spacing = 0.16;
      } else {
        width = p.size * (p.owner === 'enemy' ? 0.85 : 0.7);
        spacing = 0.2;
      }
      this.tailPoint(p, _tail);
      trail.reset(_tail, _color.getHex(), width, spacing);
      p.trail = trail;
    }

    this.active.push(p);
    this.live++;
  }

  // ───────────── 每帧 ─────────────

  update(dt: number): void {
    this.floorY = this.ctx.stage.arena?.floorY ?? 0;
    const list = this.active;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (p && p.active) this.step(p, dt);
    }

    // 压缩：死亡的投射物回到空闲池（循环中新发射的投射物保留在末尾）
    if (this.active === list) {
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.active) list[w++] = p;
        else this.free.push(p);
      }
      list.length = w;
    }

    // 拖尾
    const cam = this.ctx.camera.position;
    for (let i = 0; i < this.active.length; i++) {
      const t = this.active[i].trail;
      if (t) t.update(cam);
    }
    for (let i = this.dyingTrails.length - 1; i >= 0; i--) {
      const t = this.dyingTrails[i];
      if (t.tick(dt)) {
        t.update(cam);
      } else {
        t.hide();
        this.dyingTrails[i] = this.dyingTrails[this.dyingTrails.length - 1];
        this.dyingTrails.pop();
        this.trailPool.push(t);
      }
    }
  }

  private step(p: Projectile, dt: number): void {
    p.age += dt;
    if (p.age >= p.lifetime) {
      this.expire(p);
      return;
    }

    if (p.homing > 0) this.steer(p, dt);
    if (p.gravity !== 0) p.vel.y -= p.gravity * dt;

    _origin.copy(p.pos);
    let speed = p.vel.length();
    if (speed > 1e-4) {
      _dir.copy(p.vel).multiplyScalar(1 / speed);
      let remaining = speed * dt;
      const pad = Math.min(p.radius, WALL_PAD_MAX);

      for (let iter = 0; iter < MAX_SUBSTEPS && remaining > 1e-6; iter++) {
        // 墙体 / 地面
        let tWall = Infinity;
        const wh = this.ctx.world.raycast(_origin, _dir, remaining + pad, _wallHit);
        if (wh) {
          tWall = Math.max(0, wh.distance - pad);
          _wallN.copy(wh.normal);
          _wallP.copy(wh.point);
        }
        // 兜底：没有地面碰撞盒时按竞技场地面高度处理
        if (_dir.y < 0) {
          const above = _origin.y - (this.floorY + pad);
          const tf = Math.max(0, above / -_dir.y);
          if (tf <= remaining && tf < tWall) {
            tWall = tf;
            _wallN.set(0, 1, 0);
            _wallP.copy(_origin).addScaledVector(_dir, tf);
            _wallP.y = this.floorY;
          }
        }
        const segLen = Math.min(remaining, tWall);

        if (p.owner === 'player') {
          const eh = this.sweepEnemies(p, _origin, _dir, segLen);
          if (eh) {
            this.onEnemyContact(p, eh);
            if (!p.active) return;
            // 穿透：从命中点继续这一帧剩余的路程
            const adv = Math.min(remaining, eh.distance + 0.02);
            _origin.addScaledVector(_dir, adv);
            remaining -= adv;
            continue;
          }
        } else if (this.touchesPlayer(p, _origin, _dir, segLen)) {
          this.onPlayerContact(p);
          return;
        }

        if (tWall > remaining) {
          _origin.addScaledVector(_dir, remaining);
          remaining = 0;
          break;
        }

        // 接触墙面 / 地面
        _origin.addScaledVector(_dir, tWall);
        remaining -= tWall;
        const vn = p.vel.dot(_wallN);
        if (vn >= 0) {
          // 已经在远离表面（起点贴墙等），推出一点继续
          _origin.addScaledVector(_wallN, 0.02);
          continue;
        }
        const floorLike = _wallN.y > 0.7;
        if (p.canRoll && floorLike && p.gravity > 0 && -vn < ROLL_SPEED) {
          // 贴地滚动：去掉法向速度 + 摩擦
          p.vel.addScaledVector(_wallN, -vn);
          const fr = Math.exp(-ROLL_FRICTION * dt);
          p.vel.x *= fr;
          p.vel.z *= fr;
        } else if (p.bounces > 0) {
          p.bounces--;
          // v = 切向 × 保留 − 法向 × 保留
          _tmp.copy(_wallN).multiplyScalar(vn);
          p.vel.sub(_tmp).multiplyScalar(BOUNCE_TANGENT_KEEP).addScaledVector(_tmp, -BOUNCE_NORMAL_KEEP);
          this.ctx.fx.impact(_wallP, _wallN, p.color, 0.25 * clamp(p.radius / 0.12, 0.6, 1.6));
        } else {
          this.onWallContact(p, _wallP, _wallN);
          return;
        }
        _origin.addScaledVector(_wallN, 0.01);
        const ns = p.vel.length();
        if (ns < 1e-4) break;
        remaining *= ns / speed;
        speed = ns;
        _dir.copy(p.vel).multiplyScalar(1 / ns);
      }
    } else {
      // 静止（滚停的手雷、悬停的法球）：原地做一次重叠检测
      _dir.copy(p.heading);
      if (p.owner === 'enemy') {
        if (this.touchesPlayer(p, _origin, _dir, 0)) {
          this.onPlayerContact(p);
          return;
        }
      } else {
        const r = Math.max(p.radius, 0.1);
        _probe.copy(_origin).addScaledVector(_dir, -r);
        const eh = this.sweepEnemies(p, _probe, _dir, 2 * r);
        if (eh) {
          this.onEnemyContact(p, eh);
          if (!p.active) return;
        }
      }
    }

    p.pos.copy(_origin);
    if (!this.inBounds(p.pos)) {
      this.kill(p);
      return;
    }
    this.present(p, dt);
  }

  /** 更新外观、拖尾与烟迹 */
  private present(p: Projectile, dt: number): void {
    const speed = p.vel.length();
    if (speed > 1e-3) p.heading.copy(p.vel).multiplyScalar(1 / speed);
    const view = p.view!;
    view.root.position.copy(p.pos);
    const fade = p.explodeOnExpire ? 1 : clamp01((p.lifetime - p.age) / EXPIRE_FADE);
    view.animate(p.heading, p.age, p.lifetime, dt, fade);
    if (p.trail || p.visual === 'rocket') this.tailPoint(p, _tail);
    if (p.trail) p.trail.push(_tail);
    if (p.visual === 'rocket') {
      p.smokeTimer -= dt;
      if (p.smokeTimer <= 0) {
        p.smokeTimer = 0.05;
        this.ctx.fx.burst(_tail, 0x8b857c, 1, 0.5, 0.7, 0.26 * p.size, -0.6);
      }
    }
  }

  private tailPoint(p: Projectile, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(p.pos).addScaledVector(p.heading, -tailOffset(p.visual) * p.size);
  }

  private inBounds(pos: THREE.Vector3): boolean {
    if (pos.y < this.floorY - 8 || pos.y > 90) return false;
    const a = this.ctx.stage.arena;
    if (!a) return Math.abs(pos.x) < 200 && Math.abs(pos.z) < 200;
    const m = 20;
    return pos.x > a.minX - m && pos.x < a.maxX + m && pos.z > a.minZ - m && pos.z < a.maxZ + m;
  }

  // ───────────── 追踪 ─────────────

  private steer(p: Projectile, dt: number): void {
    if (p.owner === 'enemy') {
      const pl = this.ctx.player;
      if (!pl.alive) return;
      _want.set(pl.position.x, pl.position.y + Math.min(PLAYER_CHEST, pl.height * 0.64), pl.position.z).sub(p.pos);
      // 已经飞过玩家：不再掉头追，保证可以闪避
      if (_want.dot(p.vel) <= 0) {
        p.homing = 0;
        return;
      }
    } else {
      if (p.age < PLAYER_HOMING_DELAY) return;
      p.retargetTimer -= dt;
      if (!p.homingTarget || !p.homingTarget.alive || p.retargetTimer <= 0) {
        p.homingTarget = this.pickTarget(p);
        p.retargetTimer = HOMING_RETARGET;
      }
      if (!p.homingTarget) return;
      p.homingTarget.getBodyCenter(_want).sub(p.pos);
    }

    const speed = p.vel.length();
    const wl = _want.length();
    if (speed < 1e-4 || wl < 1e-4) return;
    _dir.copy(p.vel).multiplyScalar(1 / speed);
    _want.multiplyScalar(1 / wl);
    const ang = Math.acos(clamp(_dir.dot(_want), -1, 1));
    if (ang < 1e-4) return;
    const stepAng = Math.min(ang, p.homing * dt);
    _axis.crossVectors(_dir, _want);
    if (_axis.lengthSq() < 1e-10) {
      _axis.set(0, 1, 0).cross(_dir);
      if (_axis.lengthSq() < 1e-10) _axis.set(1, 0, 0);
    }
    _axis.normalize();
    _dir.applyAxisAngle(_axis, stepAng);
    p.vel.copy(_dir).multiplyScalar(speed);
  }

  /** 玩家追踪弹选目标：偏好前方、近距离、有视线的敌人 */
  private pickTarget(p: Projectile): IEnemy | null {
    const list = this.ctx.enemies.list;
    const speed = p.vel.length();
    if (speed < 1e-4) return null;
    const hx = p.vel.x / speed, hy = p.vel.y / speed, hz = p.vel.z / speed;
    let best: IEnemy | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || p.hitSet.has(e)) continue;
      e.getBodyCenter(_tmp);
      const dx = _tmp.x - p.pos.x, dy = _tmp.y - p.pos.y, dz = _tmp.z - p.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > PLAYER_HOMING_RANGE || d < 1e-3) continue;
      const cos = (dx * hx + dy * hy + dz * hz) / d;
      if (cos < -0.1) continue;
      const score = d * (1.8 - cos);
      if (score >= bestScore) continue;
      if (!lineClear(this.ctx.world, _tmp, p.pos, 0.1)) continue;
      best = e;
      bestScore = score;
    }
    return best;
  }

  // ───────────── 命中检测 ─────────────

  /** 玩家投射物沿 origin + dir × [0, maxDist] 扫掠敌人，返回最近的命中 */
  private sweepEnemies(p: Projectile, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): SweepHit | null {
    if (maxDist <= 1e-6) return null;
    const exclude = p.hitSet.size > 0 ? p.hitSet : undefined;
    let found = false;
    const h = this.ctx.enemies.raycast(origin, dir, maxDist, exclude);
    if (h && h.enemy.alive && h.distance <= maxDist) {
      _sweep.enemy = h.enemy;
      _sweep.distance = h.distance;
      _sweep.point.copy(h.point);
      _sweep.headshot = h.headshot;
      found = true;
    }

    // 膨胀补测：投射物有体积，擦边也算命中
    const r = p.radius;
    if (r >= INFLATE_MIN_RADIUS) {
      const list = this.ctx.enemies.list;
      _end.copy(origin).addScaledVector(dir, maxDist);
      const limit = found ? _sweep.distance : maxDist;
      let bestT = limit;
      let bestE: IEnemy | null = null;
      let bestHead = false;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive || (exclude && exclude.has(e)) || (found && e === _sweep.enemy)) continue;
        e.getBodyCenter(_tmp);
        const reach = e.height * 0.5 + e.radius + r + 0.3;
        if (distSqPointSegment(_tmp, origin, _end) > reach * reach) continue;
        e.getHeadCenter(_head);
        const defR = e.def.radius > 0 ? e.def.radius : e.radius;
        const headR = (e.def.headRadius ?? e.def.radius * 0.55) * (e.radius / defR);
        const yMin = e.position.y + Math.min(e.radius, e.height * 0.3);
        const yMax = Math.max(yMin, _head.y - headR * 0.6);
        const tb = rayVerticalCapsule(origin, dir, e.position.x, e.position.z, yMin, yMax, e.radius + r);
        const th = raySphere(origin, dir, _head, headR + r * 0.5);
        let t = -1;
        let head = false;
        if (th >= 0 && th <= maxDist) {
          t = th;
          head = true;
        }
        if (tb >= 0 && tb <= maxDist && (t < 0 || tb < t - 0.05)) {
          t = tb;
          head = false;
        }
        if (t >= 0 && t < bestT) {
          bestT = t;
          bestE = e;
          bestHead = head;
        }
      }
      if (bestE) {
        _sweep.enemy = bestE;
        _sweep.distance = bestT;
        _sweep.point.copy(origin).addScaledVector(dir, bestT);
        _sweep.headshot = bestHead;
        found = true;
      }
    }
    return found ? _sweep : null;
  }

  /** 敌方投射物这一段是否碰到玩家；命中点写入 _hitPoint */
  private touchesPlayer(p: Projectile, origin: THREE.Vector3, dir: THREE.Vector3, segLen: number): boolean {
    const pl = this.ctx.player;
    // 冲刺 / 武器技能突进的无敌帧内直接穿过（闪避手感）；其他无敌只是不掉血，投射物照常被吃掉
    if (!pl.alive || ((pl.isDashing || pl.isLunging) && pl.invulnerableTime > 0)) return false;
    const R = pl.radius + p.radius;
    const px = pl.position.x, pz = pl.position.z;
    // 水平粗筛
    const mx = origin.x + dir.x * segLen * 0.5 - px;
    const mz = origin.z + dir.z * segLen * 0.5 - pz;
    const reach = segLen * 0.5 + R + 0.1;
    if (mx * mx + mz * mz > reach * reach) return false;
    const y0 = pl.position.y + pl.radius;
    const y1 = pl.position.y + Math.max(pl.radius, pl.height - pl.radius);
    _end.copy(origin).addScaledVector(dir, segLen);
    if (segVerticalDistSq(origin, _end, px, y0, y1, pz) > R * R) return false;
    _hitPoint.copy(origin).addScaledVector(dir, segLen * segS);
    return true;
  }

  // ───────────── 命中结算 ─────────────

  private onEnemyContact(p: Projectile, hit: SweepHit): void {
    const enemy = hit.enemy!;
    _pt.copy(hit.point);
    if (p.explosionRadius > 0) {
      _pt.addScaledVector(_dir, -0.1);
      this.detonate(p, _pt);
      this.impactCallback(p, _pt, enemy);
      this.kill(p);
      return;
    }
    if (p.damage) {
      this.ctx.combat.damageEnemy(enemy, {
        ...p.damage,
        point: _pt.clone(),
        direction: _dir.clone(),
        headshot: hit.headshot || !!p.damage.headshot,
      });
    }
    this.impactCallback(p, _pt, enemy);
    if (!p.active) return;
    if (p.pierce > 0) {
      p.pierce--;
      p.hitSet.add(enemy);
      if (p.homingTarget === enemy) p.homingTarget = null;
      return;
    }
    this.kill(p);
  }

  private onPlayerContact(p: Projectile): void {
    const at = _hitPoint.clone();
    if (p.explosionRadius > 0) {
      this.enemyBlast(p, at);
    } else {
      this.ctx.combat.damagePlayer(p.enemyDamage, p.element, p.sourceEnemy, at);
      this.ctx.fx.burst(at, p.color, 8, 3, 0.3, 0.08 * clamp(p.radius / 0.2, 0.7, 2), 4);
    }
    this.impactCallback(p, at, null);
    this.kill(p);
  }

  private onWallContact(p: Projectile, point: THREE.Vector3, normal: THREE.Vector3): void {
    // 爆心稍离开表面，避免被自己所在的墙面遮挡
    _pt.copy(point).addScaledVector(normal, 0.08);
    if (p.explosionRadius > 0) {
      if (p.owner === 'player') this.detonate(p, _pt);
      else this.enemyBlast(p, _pt);
    } else {
      const s = p.owner === 'enemy' ? 0.8 : 0.55;
      this.ctx.fx.impact(point, normal, p.color, s * clamp(p.radius / 0.12, 0.6, 2));
    }
    this.impactCallback(p, _pt, null);
    this.kill(p);
  }

  private expire(p: Projectile): void {
    if (p.explodeOnExpire && p.explosionRadius > 0) {
      _pt.copy(p.pos);
      if (p.owner === 'player') this.detonate(p, _pt);
      else this.enemyBlast(p, _pt);
    }
    this.kill(p);
  }

  /** 玩家方爆炸：交给 Combat.explode，原 source 放进 tags 以继承武器 / 技能加成 */
  private detonate(p: Projectile, center: THREE.Vector3): void {
    const base = p.damage;
    let req: DamageRequest;
    if (base) {
      const tags = base.source === 'explosion' ? base.tags : [base.source, ...(base.tags ?? [])];
      req = { ...base, source: 'explosion', tags, headshot: false, point: undefined, direction: undefined };
    } else {
      req = { base: 0, element: p.element, source: 'explosion' };
    }
    this.ctx.combat.explode(center.clone(), p.explosionRadius, req, { playerDamage: p.selfDamage, color: p.color });
  }

  /** 敌方爆炸弹：只伤玩家（按距离衰减、墙体遮挡） */
  private enemyBlast(p: Projectile, center: THREE.Vector3): void {
    const ctx = this.ctx;
    const r = p.explosionRadius;
    ctx.fx.explosion(center, r, p.color);
    ctx.audio.play('explosion', { position: center, volume: clamp(0.45 + r * 0.08, 0.45, 0.95), pitch: clamp(1.2 - r * 0.05, 0.8, 1.15) });
    explosionShake(ctx, center, r, 0.85);
    blastPlayer(ctx, center, r, p.enemyDamage, 0.5, p.element, p.sourceEnemy);
  }

  private impactCallback(p: Projectile, point: THREE.Vector3, enemy: IEnemy | null): void {
    const cb = p.onImpact;
    if (!cb) return;
    try {
      cb(point.clone(), enemy);
    } catch (err) {
      console.error('[Projectiles] onImpact threw', err);
    }
  }

  // ───────────── 回收 ─────────────

  private kill(p: Projectile): void {
    if (!p.active) return;
    p.active = false;
    this.live--;
    if (p.view) {
      p.view.hide();
      this.viewPools.get(p.visual)!.push(p.view);
      p.view = null;
    }
    if (p.trail) {
      p.trail.startDying();
      this.dyingTrails.push(p.trail);
      p.trail = null;
    }
    p.damage = null;
    p.sourceEnemy = null;
    p.onImpact = null;
    p.homingTarget = null;
    p.hitSet.clear();
  }

  private acquireView(kind: ProjectileVisual): ProjectileView {
    let pool = this.viewPools.get(kind);
    if (!pool) {
      pool = [];
      this.viewPools.set(kind, pool);
    }
    let v = pool.pop();
    if (!v) {
      v = new ProjectileView(kind);
      this.group.add(v.root);
    }
    return v;
  }

  private acquireTrail(): Trail {
    let t = this.trailPool.pop();
    if (!t) {
      t = new Trail();
      this.group.add(t.mesh);
    }
    return t;
  }

  /** 回收全部投射物与拖尾（换关 / 新开一局） */
  clear(): void {
    for (let i = 0; i < this.active.length; i++) {
      const p = this.active[i];
      if (p.active) this.kill(p);
      this.free.push(p);
    }
    this.active = [];
    this.live = 0;
    for (const t of this.dyingTrails) {
      t.hide();
      this.trailPool.push(t);
    }
    this.dyingTrails.length = 0;
  }
}
