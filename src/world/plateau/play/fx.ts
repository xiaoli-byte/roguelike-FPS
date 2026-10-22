/**
 * 游玩模式的战斗特效与投射物：弹道光迹、地面预警（圈 / 线 / 扇形）、落雷、冲击波环、爆闪、雷弧、出手闪光、粒子、
 * 抛物线投石、直线弹。只管画面和「打没打中玩家」，伤害数值由出手的怪决定（回调里扣血）。
 * 预警都返回句柄：怪被硬直 / 眩晕打断时 cancel() 撤回还没填满的预警（不再出手）。
 */
import * as THREE from 'three';
import type { HeightGrid } from '../grid';
import type { CollisionWorld } from '../walker';

const MAGENTA = '#ff4fd8';

interface Timed { t: number; life: number; tick(k: number, dt: number): void; done?(): void; obj: THREE.Object3D; dead?: boolean }
interface Projectile {
  mesh: THREE.Object3D; pos: THREE.Vector3; vel: THREE.Vector3; gravity: number; r: number; life: number;
  /** 碰到玩家或落地时调用；hitPlayer 表示直接打中 */
  onHit(at: THREE.Vector3, hitPlayer: boolean): void;
  /** 不和地形碰撞（贴地飞的风刃） */
  skim?: boolean;
  spin?: boolean;
}

export interface WarnHandle { cancel(): void; readonly done: boolean }

const MAX_PARTICLES = 2400;

export class CombatFx {
  readonly group = new THREE.Group();
  private timed: Timed[] = [];
  private shots: Projectile[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
  private readonly discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  private readonly sphereGeo = new THREE.SphereGeometry(1, 16, 10);
  private readonly boltGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  private readonly tracerMat = new THREE.LineBasicMaterial({ color: '#fff2c4', transparent: true, opacity: 0.9, depthWrite: false });
  private readonly starTex: THREE.Texture;
  // 粒子
  private readonly pPos = new Float32Array(MAX_PARTICLES * 3);
  private readonly pCol = new Float32Array(MAX_PARTICLES * 3);
  private readonly pVel = new Float32Array(MAX_PARTICLES * 3);
  private readonly pLife = new Float32Array(MAX_PARTICLES);
  private readonly pGrav = new Float32Array(MAX_PARTICLES);
  private pNext = 0;
  private readonly points: THREE.Points;

  constructor(scene: THREE.Scene, private readonly terrain: HeightGrid, private readonly world: CollisionWorld) {
    this.group.name = 'combat-fx';
    scene.add(this.group);
    // 出手闪光的四角星
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(32, 0); g.lineTo(35, 29); g.lineTo(64, 32); g.lineTo(35, 35); g.lineTo(32, 64); g.lineTo(29, 35); g.lineTo(0, 32); g.lineTo(29, 29); g.closePath(); g.fill();
    this.starTex = new THREE.CanvasTexture(cv);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.pLife.fill(0);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -1e4;
    this.group.add(this.points);
  }

  ground(x: number, z: number): number {
    return Math.max(this.terrain.heightAt(x, z), this.terrain.waterLevelAt(x, z));
  }

  private add(obj: THREE.Object3D, life: number, tick: Timed['tick'], done?: () => void): Timed {
    this.group.add(obj);
    const T: Timed = { t: 0, life, tick, done, obj };
    this.timed.push(T);
    return T;
  }

  private handle(T: Timed): WarnHandle {
    return { cancel: () => { T.dead = true; T.done = undefined; }, get done() { return T.dead === true || T.t >= T.life; } };
  }

  private additive(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }

  /** 地面预警用普通混合（叠加混合在亮绿的草地上发灰、看不清颜色） */
  private decal(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }

  /** 枪口到命中点的一道光迹 */
  tracer(a: THREE.Vector3, b: THREE.Vector3, color?: THREE.ColorRepresentation): void {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = this.tracerMat.clone();
    if (color) mat.color.set(color);
    const line = new THREE.Line(g, mat);
    this.add(line, 0.06, (k) => { mat.opacity = 0.9 * (1 - k); }, () => { g.dispose(); mat.dispose(); });
  }

  /** 地面预警圈：外圈先出现，里面的实心圆在 delay 秒内涨满，然后 onFire() */
  telegraph(x: number, z: number, r: number, delay: number, onFire: () => void, color: THREE.ColorRepresentation = MAGENTA): WarnHandle {
    const y = this.ground(x, z) + 0.12;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const ring = new THREE.Mesh(this.ringGeo, this.decal(color, 0.95));
    const disc = new THREE.Mesh(this.discGeo, this.decal(color, 0.3));
    const under = new THREE.Mesh(this.discGeo, this.decal(color, 0.12));
    ring.scale.setScalar(r); under.scale.setScalar(r);
    g.add(under, ring, disc);
    return this.handle(this.add(g, delay, (k) => { disc.scale.setScalar(Math.max(0.01, r * k)); (disc.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.3 * k; }, onFire));
  }

  /** 跟着目标走的预警圈（天狗雷标）：follow 返回当前圆心；locked 之后不再跟 */
  followMark(r: number, delay: number, follow: () => THREE.Vector3 | null, onFire: (at: THREE.Vector3) => void, color: THREE.ColorRepresentation = MAGENTA): WarnHandle {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(this.ringGeo, this.decal(color, 0.95));
    const disc = new THREE.Mesh(this.discGeo, this.decal(color, 0.3));
    ring.scale.setScalar(r);
    g.add(ring, disc);
    const at = new THREE.Vector3();
    return this.handle(this.add(g, delay, (k) => {
      const p = follow();
      if (p) at.copy(p);
      g.position.set(at.x, this.ground(at.x, at.z) + 0.12, at.z);
      disc.scale.setScalar(Math.max(0.01, r * k));
      ring.rotation.y += 0.05;
    }, () => onFire(at.clone())));
  }

  /** 地面上的一条预警带（冲撞线、扫线）：从 a 到 b、宽 w，delay 秒内从 a 填到 b */
  lineWarn(ax: number, az: number, bx: number, bz: number, w: number, delay: number, color: THREE.ColorRepresentation = '#ffb347', onFire?: () => void): WarnHandle {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(len / 2));
    const ux = (bx - ax) / Math.max(1e-3, len), uz = (bz - az) / Math.max(1e-3, len);
    const px = -uz * w / 2, pz = ux * w / 2;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const along = new Float32Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      for (let s = 0; s < 2; s++) {
        const sx = x + (s ? px : -px), sz = z + (s ? pz : -pz);
        const o = (i * 2 + s) * 3;
        pos[o] = sx; pos[o + 1] = this.ground(sx, sz) + 0.14; pos[o + 2] = sz;
        along[i * 2 + s] = t;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('along', new THREE.BufferAttribute(along, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uK: { value: 0 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: 'attribute float along; varying float vA; void main(){ vA = along; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uK; uniform vec3 uColor; varying float vA; void main(){ float fill = step(vA, uK); float a = 0.2 + 0.4 * fill; gl_FragColor = vec4(uColor, a); }',
    });
    const mesh = new THREE.Mesh(geo, mat);
    return this.handle(this.add(mesh, delay, (k) => { mat.uniforms.uK.value = k; }, () => { geo.dispose(); mat.dispose(); onFire?.(); }));
  }

  /** 扇形预警（狂风锥、雷掌、横扫）：朝 yaw（0 = +Z）张 angle 弧度、半径 r */
  coneWarn(x: number, z: number, yaw: number, angle: number, r: number, delay: number, color: THREE.ColorRepresentation = '#d8f4ff', onFire?: () => void): WarnHandle {
    // CircleGeometry 在 XY 平面、0 弧度在 +X；绕 X 转 −90° 后 θ = −π/2 落在 +Z（朝前）
    const geo = new THREE.CircleGeometry(1, 32, -Math.PI / 2 - angle / 2, angle).rotateX(-Math.PI / 2);
    const g = new THREE.Group();
    g.position.set(x, this.ground(x, z) + 0.15, z);
    g.rotation.y = yaw;
    const outer = new THREE.Mesh(geo, this.decal(color, 0.2));
    const inner = new THREE.Mesh(geo, this.decal(color, 0.35));
    outer.scale.setScalar(r);
    g.add(outer, inner);
    return this.handle(this.add(g, delay, (k) => { inner.scale.setScalar(Math.max(0.01, r * k)); }, () => { geo.dispose(); onFire?.(); }));
  }

  /** 落雷画面：从 70 m 高空折下来的一道闪电（白芯 + 紫红外光、两条分叉）+ 地面爆闪；y = 落点高度（劈导体时是杆顶） */
  bolt(x: number, z: number, color: THREE.ColorRepresentation = '#ffd6fb', y?: number): void {
    const gy = y ?? this.ground(x, z);
    const g = new THREE.Group();
    const core = this.additive('#fff6ff', 0.95), glow = this.additive('#ff6ae0', 0.38);
    const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number): void => {
      const len = a.distanceTo(b);
      for (const [m, rr] of [[core, r], [glow, r * 3.5]] as const) {
        const mesh = new THREE.Mesh(this.boltGeo, m);
        mesh.position.copy(a);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        mesh.scale.set(rr, len, rr);
        g.add(mesh);
      }
    };
    const top = new THREE.Vector3(x + (Math.random() - 0.5) * 24, gy + 70, z + (Math.random() - 0.5) * 24);
    const end = new THREE.Vector3(x, gy, z);
    const pts: THREE.Vector3[] = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const p = top.clone().lerp(end, i / n);
      const j = (1 - i / n) * 4 + 0.4;
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * j, 0, (Math.random() - 0.5) * j));
      pts.push(p);
    }
    for (let i = 0; i < n; i++) seg(pts[i], pts[i + 1], 0.1);
    for (const from of [3, 7]) {
      let a = pts[from];
      for (let k = 0; k < 3; k++) { const b = a.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, -5 - Math.random() * 4, (Math.random() - 0.5) * 8)); seg(a, b, 0.07); a = b; }
    }
    this.add(g, 0.26, (k) => { g.visible = k < 0.35 || (k > 0.5 && k < 0.75); }, () => { core.dispose(); glow.dispose(); });
    this.burst(new THREE.Vector3(x, gy + 0.5, z), 2.4, color);
    this.spray(new THREE.Vector3(x, gy + 0.3, z), [color, '#ffffff'], 26, 7, 8, 12, 0.6);
  }

  /** 雷弧：a 到 b 的一道折线电光（电网、焚雷跳弧、电会传、回劈） */
  arc(a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation = '#ff7ae6', life = 0.2, jitter = 0.35): void {
    const n = Math.max(4, Math.ceil(a.distanceTo(b) / 0.8));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * jitter * 2, (Math.random() - 0.5) * jitter * 2, (Math.random() - 0.5) * jitter * 2));
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    this.add(line, life, (k) => { mat.opacity = k < 0.5 || Math.random() > 0.4 ? 1 - k * 0.6 : 0.2; }, () => { geo.dispose(); mat.dispose(); });
  }

  /** 出手闪光：0.3 秒的白色四角星（危险招出手前 0.25 秒） */
  glint(at: THREE.Vector3, size = 1.2, color: THREE.ColorRepresentation = '#ffffff'): void {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    sp.position.copy(at);
    sp.renderOrder = 20;
    this.add(sp, 0.3, (k) => {
      const s = size * (k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7 * 0.8);
      sp.scale.setScalar(Math.max(0.01, s));
      sp.material.rotation = k * 1.2;
      sp.material.opacity = 1 - k * k;
    }, () => sp.material.dispose());
  }

  /** 爆闪：一个迅速长大、淡出的发光球 */
  burst(at: THREE.Vector3, r: number, color: THREE.ColorRepresentation = '#ffd2f3'): void {
    // 只画正面：镜头在爆闪球里面时不会整屏发白
    const mat = this.additive(color, 0.8);
    mat.side = THREE.FrontSide;
    const m = new THREE.Mesh(this.sphereGeo, mat);
    m.position.copy(at);
    this.add(m, 0.35, (k) => { m.scale.setScalar(r * (0.3 + 0.7 * k)); (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k); }, () => (m.material as THREE.Material).dispose());
  }

  /** 冲击波：贴地扩散的环，onTick(当前半径) 每帧回调（拿来判定玩家被扫到没有）；height 是环的高度（化蛇的浪） */
  shockwave(x: number, z: number, maxR: number, dur: number, onTick?: (r: number) => void, color: THREE.ColorRepresentation = '#ffb5f0', height = 1): void {
    const y = this.ground(x, z) + 0.25;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 64).rotateX(Math.PI / 2), this.additive(color, 0.9));
    ring.position.set(x, y, z);
    this.add(ring, dur, (k) => {
      const r = 0.5 + maxR * k;
      ring.scale.set(r, (1 + 2 * (1 - k)) * height, r);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k * k);
      onTick?.(r);
    }, () => { ring.geometry.dispose(); (ring.material as THREE.Material).dispose(); });
  }

  /** 地上的一片持续区域（雷石电场、熔池）：每 tick 秒调 onTick()，dur 秒后消失 */
  field(x: number, z: number, r: number, dur: number, color: THREE.ColorRepresentation, tick: number, onTick: () => void): WarnHandle {
    const g = new THREE.Group();
    g.position.set(x, this.ground(x, z) + 0.1, z);
    const disc = new THREE.Mesh(this.discGeo, this.decal(color, 0.28));
    const ring = new THREE.Mesh(this.ringGeo, this.decal(color, 0.8));
    disc.scale.setScalar(r); ring.scale.setScalar(r);
    g.add(disc, ring);
    let acc = 0;
    return this.handle(this.add(g, dur, (k, dt) => {
      acc += dt;
      (disc.material as THREE.MeshBasicMaterial).opacity = (0.2 + 0.12 * Math.sin(k * 60)) * Math.min(1, (1 - k) * 4);
      if (Math.random() < 0.5) this.spray(new THREE.Vector3(x + (Math.random() - 0.5) * r * 1.6, g.position.y + 0.1, z + (Math.random() - 0.5) * r * 1.6), color, 1, 1, 2, 4, 0.3);
      if (acc >= tick) { acc -= tick; onTick(); }
    }));
  }

  /** 粒子：n 颗从 at 往外喷（速度 speed，往上 up），带重力；颜色可以是数组随机取 */
  spray(at: THREE.Vector3, color: THREE.ColorRepresentation | THREE.ColorRepresentation[], n: number, speed = 5, up = 4, gravity = 14, life = 0.7): void {
    const cols = (Array.isArray(color) ? color : [color]).map(c => new THREE.Color(c));
    for (let k = 0; k < n; k++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1, s = speed * (0.4 + 0.6 * Math.random());
      this.pPos[i * 3] = at.x; this.pPos[i * 3 + 1] = at.y; this.pPos[i * 3 + 2] = at.z;
      this.pVel[i * 3] = Math.cos(a) * Math.sqrt(1 - e * e) * s;
      this.pVel[i * 3 + 1] = Math.abs(e) * s * 0.5 + up * Math.random();
      this.pVel[i * 3 + 2] = Math.sin(a) * Math.sqrt(1 - e * e) * s;
      const c = cols[k % cols.length];
      this.pCol[i * 3] = c.r; this.pCol[i * 3 + 1] = c.g; this.pCol[i * 3 + 2] = c.b;
      this.pLife[i] = life * (0.6 + 0.4 * Math.random());
      this.pGrav[i] = gravity;
    }
  }

  /** 抛物线投射物：flight 秒后落到 to；落点提前出预警圈 */
  lob(from: THREE.Vector3, to: THREE.Vector3, flight: number, mesh: THREE.Object3D, splash: number, onLand: (at: THREE.Vector3) => void, color: THREE.ColorRepresentation = '#ff8a3a', warn = true): void {
    const g = 26;
    const vel = new THREE.Vector3((to.x - from.x) / flight, (to.y - from.y + 0.5 * g * flight * flight) / flight, (to.z - from.z) / flight);
    mesh.position.copy(from);
    this.group.add(mesh);
    if (warn) this.telegraph(to.x, to.z, splash, flight * 0.95, () => {}, color);
    this.shots.push({ mesh, pos: from.clone(), vel, gravity: g, r: 0, life: flight + 2, onHit: (at) => onLand(at), spin: true });
  }

  /** 直线弹：碰到玩家（r 内）或地形 / 建筑就停 */
  shot(from: THREE.Vector3, vel: THREE.Vector3, r: number, color: THREE.ColorRepresentation, onHit: (at: THREE.Vector3, hitPlayer: boolean) => void, gravity = 0, mesh?: THREE.Object3D, skim = false): void {
    const m = mesh ?? new THREE.Mesh(this.sphereGeo, this.additive(color, 0.95));
    if (!mesh) m.scale.setScalar(Math.max(0.25, r));
    m.position.copy(from);
    this.group.add(m);
    this.shots.push({ mesh: m, pos: from.clone(), vel: vel.clone(), gravity, r, life: 4, onHit, skim });
  }

  /** player：玩家身体的球心和半径（用来判定直线弹命中） */
  update(dt: number, player: THREE.Vector3, playerR: number): void {
    for (const T of this.timed) {
      if (T.dead) continue;
      T.t += dt;
      T.tick(Math.min(1, T.t / T.life), dt);
    }
    // 先摘掉过期的，再调回调：回调里新加的特效（预警填满 → 落雷）要进新的列表，不能被这次过滤吞掉
    const expired: Timed[] = [];
    this.timed = this.timed.filter(T => {
      if (!T.dead && T.t < T.life) return true;
      expired.push(T);
      return false;
    });
    for (const T of expired) {
      this.group.remove(T.obj);
      if (!T.dead) T.done?.();
    }
    const landed: [Projectile, THREE.Vector3, boolean][] = [];
    this.shots = this.shots.filter(S => {
      S.life -= dt;
      S.vel.y -= S.gravity * dt;
      S.pos.addScaledVector(S.vel, dt);
      S.mesh.position.copy(S.pos);
      if (S.spin) S.mesh.rotation.x += dt * 4;
      else if (S.vel.lengthSq() > 0.01) S.mesh.lookAt(S.pos.clone().add(S.vel));
      let hit: boolean | null = null;
      if (S.r > 0 && S.pos.distanceTo(player) < S.r + playerR) hit = true;
      else if (S.skim) {
        S.pos.y = this.ground(S.pos.x, S.pos.z) + 1.0;
        if (this.world.solidAt(S.pos.x, S.pos.y, S.pos.z) || S.life <= 0) hit = false;
      } else if (S.pos.y <= this.ground(S.pos.x, S.pos.z) || this.world.solidAt(S.pos.x, S.pos.y, S.pos.z) || S.life <= 0) hit = false;
      if (hit === null) return true;
      this.group.remove(S.mesh);
      landed.push([S, S.pos.clone(), hit]);
      return false;
    });
    for (const [S, at, hit] of landed) S.onHit(at, hit);
    // 粒子
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { this.pPos[i * 3 + 1] = -1e4; continue; }
      this.pVel[i * 3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      const k = Math.min(1, this.pLife[i] * 3);
      this.pCol[i * 3] *= 0.98 + 0.02 * k; this.pCol[i * 3 + 1] *= 0.98 + 0.02 * k; this.pCol[i * 3 + 2] *= 0.98 + 0.02 * k;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** 玩家倒下重来时清掉场上所有投射物和预警 */
  clear(): void {
    for (const T of this.timed) this.group.remove(T.obj);
    for (const S of this.shots) this.group.remove(S.mesh);
    this.timed = [];
    this.shots = [];
    this.pLife.fill(0);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -1e4;
  }

  /** 撤掉所有还没出手的预警和敌方投射物（转阶段时） */
  clearHostile(): void {
    for (const T of this.timed) if (T.done) { T.dead = true; }
    for (const S of this.shots) this.group.remove(S.mesh);
    this.shots = [];
  }
}

/**
 * 一道持续的电弧光束（蛮蛮的比翼电弧、啸獭电网）：折线上的一节节圆柱（白芯 + 紫红外光），每帧 set() 重新抖。
 * 1 像素的线在远处看不见，用有粗细的几何体。
 */
export class Beam {
  readonly group = new THREE.Group();
  private readonly cores: THREE.Mesh[] = [];
  private readonly glows: THREE.Mesh[] = [];
  private static readonly geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Object3D, color: THREE.ColorRepresentation = '#ff5ad8', private readonly n = 8, private readonly radius = 0.05) {
    this.coreMat = new THREE.MeshBasicMaterial({ color: '#fff4ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(Beam.geo, this.coreMat), g = new THREE.Mesh(Beam.geo, this.glowMat);
      c.frustumCulled = g.frustumCulled = false;
      this.cores.push(c); this.glows.push(g);
      this.group.add(c, g);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  /** a → b，k 是亮度 0..1，jitter 是折线抖动幅度 */
  set(a: THREE.Vector3, b: THREE.Vector3, k = 1, jitter = 0.25): void {
    this.group.visible = k > 0.01;
    if (!this.group.visible) return;
    let prev = a.clone();
    for (let i = 1; i <= this.n; i++) {
      const p = a.clone().lerp(b, i / this.n);
      if (i < this.n) p.add(new THREE.Vector3((Math.random() - 0.5) * jitter * 2, (Math.random() - 0.5) * jitter * 2, (Math.random() - 0.5) * jitter * 2));
      const len = prev.distanceTo(p);
      const pairs: [THREE.Mesh, number][] = [[this.cores[i - 1], this.radius], [this.glows[i - 1], this.radius * 4]];
      for (const [m, r] of pairs) {
        m.position.copy(prev);
        m.lookAt(p);
        m.scale.set(r * (0.6 + 0.4 * k), r * (0.6 + 0.4 * k), len);
      }
      prev = p;
    }
    this.coreMat.opacity = 0.5 + 0.5 * k;
    this.glowMat.opacity = (0.2 + 0.35 * k) * (0.7 + 0.3 * Math.random());
  }

  hide(): void { this.group.visible = false; }
  dispose(scene: THREE.Object3D): void { scene.remove(this.group); }
}

/** 举父的雷石：裂着紫红雷纹的石块 */
export function boulderMesh(r = 0.7): THREE.Object3D {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshLambertMaterial({ color: '#5e5650', flatShading: true }));
  const vein = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.03, 0), new THREE.MeshBasicMaterial({ color: MAGENTA, wireframe: true }));
  rock.castShadow = true;
  g.add(rock, vein);
  return g;
}

/** 月牙风刃（飞廉） */
export function windBladeMesh(): THREE.Object3D {
  const geo = new THREE.TorusGeometry(1.1, 0.12, 4, 20, Math.PI * 0.8).rotateZ(Math.PI * 0.1).rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#e6f6ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  const g = new THREE.Group();
  m.rotation.y = Math.PI / 2;
  g.add(m);
  return g;
}
