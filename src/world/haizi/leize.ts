/**
 * 4-4 神山海子 · 章节终局首领：雷泽雷神（docs/level-design/chuanzang-combat-v1.md 4.5）。
 * 《海内东经》：雷泽中有雷神，龙身而人头，鼓其腹则雷。全游戏最大的首领：上身约 10 m（三阶段站到 12 m），龙身盘在湖里。
 *
 * 还没有正式模型（按设计是「头、上身、双爪进 Tripo，龙身程序化」，设计稿、四视图都还没做），这里是程序化白模：
 * - 龙身：从南岸浅滩（尾尖）往湖心岛北侧螺旋盘进去的一条管子，5 段身子轮流拱出水面——拱起来的身段能站人、挡雷息，是从湖岸到湖心岛的路；
 * - 上身：从湖心岛北侧的漩涡里升起，沿湖里一圈慢慢挪向玩家那一侧；人头戴金色神面（弱点），胸前腹鼓（拍腹前摇时发亮，弱点）；两条长臂带爪。
 * 招式：拍腹雷鸣（两圈落雷，圈在玩家所在的半径上——要沿径向走开）、龙爪拍击、雷息（低头沿湖岸扫 90°，拱起的身段和玛尼堆挡得住）、
 * 二阶段起双爪横扫、湖水通电；三阶段连环拍腹、天雷阵。导雷石柱：雷劈中充电，满电时打柱顶雷晶，一道雷劈向它的神面。破防「神颓」：神面磕在湖岸上。
 */
import * as THREE from 'three';
import { Boss } from '../plateau/play/boss';
import { orbitCam, type Shot } from '../plateau/play/cinema';
import type { DamageInfo, HitSphere } from '../plateau/play/core';
import { defineMoves, type MoveDef } from '../plateau/play/moves';
import type { CollisionWorld, BoxCollider } from '../plateau/walker';
import type { Pillar } from './scene';
import type { LakeSurface } from './scene';
import { COIL, ISLAND, LAKE } from './spec';
import type { HaiziTerrain } from './terrain';
import type { LeizePlay } from './play';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (x: number): number => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

// ───────────────────────────── 程序化的管子（龙身、上身） ─────────────────────────────

class Tube {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: Float32Array;

  constructor(private readonly n: number, private readonly m: number, back: THREE.Color, belly: THREE.Color, mat: THREE.Material) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * m * 3);
    const col = new Float32Array(n * m * 3);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      // j 一圈：sin 正的一侧是背（上），负的一侧是肚子
      const k = (Math.sin((j / m) * Math.PI * 2) + 1) / 2;
      const c = belly.clone().lerp(back, smooth(k * 1.4 - 0.2));
      const o = (i * m + j) * 3;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) {
      const a = i * m + j, b = i * m + (j + 1) % m, c = (i + 1) * m + j, d = (i + 1) * m + (j + 1) % m;
      idx.push(a, c, b, b, c, d);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  /** pts：n 个中心点；radius(i)；ref：参考方向（不能和切线平行：龙身用竖直，上身用它朝向的水平方向） */
  update(pts: THREE.Vector3[], radius: (i: number) => number, ref: THREE.Vector3): void {
    const n = this.n, m = this.m;
    const T = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      S.crossVectors(T, ref);
      if (S.lengthSq() < 1e-6) S.set(1, 0, 0);
      S.normalize();
      N.crossVectors(S, T).normalize();
      const r = radius(i);
      for (let j = 0; j < m; j++) {
        const a = (j / m) * Math.PI * 2, o = (i * m + j) * 3;
        const cx = Math.cos(a) * r, sy = Math.sin(a) * r;
        this.pos[o] = pts[i].x + S.x * cx + N.x * sy;
        this.pos[o + 1] = pts[i].y + S.y * cx + N.y * sy;
        this.pos[o + 2] = pts[i].z + S.z * cx + N.z * sy;
      }
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ───────────────────────────── 螺旋龙身与拱起的身段 ─────────────────────────────

/** 龙身螺旋：s = 0 是南岸浅滩上的尾尖，s = S 是湖心岛北侧（接上身） */
const SPIRAL = { r0: 49, r1: 11, a0: Math.PI / 2, turn: Math.PI * 1.05, samples: 150 };
const ARCHES = 5;
const ARCH_H = 1.7;

interface Arch { s0: number; s1: number; h: number; want: number; t: number; boxes: BoxCollider[] }

function spiralAt(u: number, out: THREE.Vector3): THREE.Vector3 {
  const r = SPIRAL.r0 + (SPIRAL.r1 - SPIRAL.r0) * u, a = SPIRAL.a0 + SPIRAL.turn * u;
  return out.set(Math.cos(a) * r, 0, Math.sin(a) * r);
}

// ───────────────────────────── 招式表 ─────────────────────────────

const LEIZE = defineMoves('SK_Boss_Leize', [
  { id: 'bellyDrum', name: '拍腹雷鸣', windup: 1.2, active: 1.2, recover: 1.0, cooldown: 6, glint: true, noHit: true, events: [{ at: 1.2, name: 'beat' }, { at: 1.8, name: 'beat' }] },
  { id: 'clawSlam', name: '龙爪拍击', windup: 1.0, active: 0.3, recover: 1.4, cooldown: 4, glint: true },
  { id: 'breath', name: '雷息', windup: 1.5, active: 2.0, recover: 1.0, cooldown: 9, glint: true, armored: true, noHit: true },
  { id: 'sweep', name: '双爪横扫', windup: 0.9, active: 0.6, recover: 1.0, cooldown: 6, minPhase: 2 },
  { id: 'tripleDrum', name: '连环拍腹', windup: 1.0, active: 1.8, recover: 1.2, cooldown: 10, minPhase: 3, armored: true, glint: true, noHit: true, events: [{ at: 1.0, name: 'beat' }, { at: 1.6, name: 'beat' }, { at: 2.2, name: 'beat' }] },
  { id: 'skyArray', name: '天雷阵', windup: 2.0, active: 4.0, recover: 1.0, cooldown: 16, minPhase: 3, armored: true, noHit: true },
  { id: 'rise', name: '从漩涡里升起（演出）', windup: 2.4, active: 1.0, recover: 0.5, noHit: true },
  { id: 'slump', name: '神颓（神面磕在湖岸上）', windup: 0.6, active: 4.0, recover: 0.6, noHit: true },
]);

// ───────────────────────────── 首领 ─────────────────────────────

export class LeizeBoss extends Boss {
  readonly phaseNames = ['一 · 鼓腹', '二 · 雷泽', '三 · 天怒'];
  protected readonly breakTime = 5;
  protected override downPose = 'slump';
  private readonly coil: Tube;
  private readonly torso: Tube;
  private readonly head = new THREE.Group();
  private readonly mask: THREE.Mesh;
  private readonly eyeMat: THREE.MeshBasicMaterial;
  private readonly drum: THREE.Mesh;
  private readonly drumGlow: THREE.Mesh;
  private readonly chestMesh: THREE.Mesh;
  private readonly shoulders: THREE.Mesh;
  private readonly arms: { upper: THREE.Mesh; fore: THREE.Mesh; claw: THREE.Group; hand: THREE.Vector3; elbow: THREE.Vector3; side: number }[] = [];
  private readonly vortex: THREE.Group;
  private readonly spikes: THREE.InstancedMesh;
  readonly arches: Arch[] = [];
  private readonly sPts: THREE.Vector3[] = [];
  private readonly spiralXZ: THREE.Vector3[] = [];
  private readonly spiralLen: number[] = [];
  private readonly S: number;
  /** 上身在湖里的角度（绕湖心）、离湖心半径 */
  private ang = -Math.PI / 2;
  private rad = 18;
  /** 上身升出水面的程度 0..1（登场）、身高倍率（三阶段 1.2）、前倾 / 低头 0..1.3 */
  private emerge = 1;
  private height = 1;
  private lean = 0;
  private readonly base = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly headPos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly target = new THREE.Vector3();
  private breathA0 = 0;
  private breathR = 50;
  private readonly beam: { core: THREE.Mesh; glow: THREE.Mesh };
  private archT = 0;

  constructor(private readonly g: LeizePlay, private readonly terrain: HaiziTerrain, world: CollisionWorld, readonly lake: LakeSurface, readonly pillars: Pillar[]) {
    const root = new THREE.Group();
    root.name = 'boss-leize';
    super('leize', '雷泽雷神', 30000, 1500, root, null, 'serpent', 'SK_Boss_Leize', [
      { bone: 'chest', r: 2.3, mult: 1 }, { bone: 'face', r: 1.1, mult: 1.2, part: 'face' }, { bone: 'belly', r: 1.6, mult: 1, part: 'belly' },
      { bone: 'torso', r: 2.0, mult: 1 }, { bone: 'clawL', r: 1.2, mult: 1 }, { bone: 'clawR', r: 1.2, mult: 1 },
    ], g, { x: 0, z: 0, r: 62 });
    const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    this.coil = new Tube(SPIRAL.samples, 12, new THREE.Color('#1f3a45'), new THREE.Color('#c8b58a'), skin);
    this.torso = new Tube(28, 14, new THREE.Color('#244452'), new THREE.Color('#d4c49a'), skin);
    root.add(this.coil.mesh, this.torso.mesh);
    // 螺旋：预先算好平面位置和弧长
    let acc = 0;
    for (let i = 0; i < SPIRAL.samples; i++) {
      const p = spiralAt(i / (SPIRAL.samples - 1), new THREE.Vector3());
      if (i > 0) acc += p.distanceTo(this.spiralXZ[i - 1]);
      this.spiralXZ.push(p); this.spiralLen.push(acc); this.sPts.push(new THREE.Vector3());
    }
    this.S = acc;
    // 5 段身子：每段占 72% 的格、轮流拱起
    const cell = this.S / ARCHES;
    for (let k = 0; k < ARCHES; k++) {
      const s0 = cell * k + cell * 0.14, s1 = cell * (k + 1) - cell * 0.14;
      const boxes: BoxCollider[] = [];
      const nb = 14;
      for (let q = 0; q < nb; q++) {
        const s = s0 + (s1 - s0) * (q + 0.5) / nb;
        const p = this.xzAt(s, new THREE.Vector3()), p2 = this.xzAt(s + 0.5, new THREE.Vector3());
        const yaw = Math.atan2(p2.x - p.x, p2.z - p.z);
        const box: BoxCollider = { kind: 'box', x: p.x, z: p.z, hx: 1.1, hz: (s1 - s0) / nb / 2 + 0.08, yaw, y0: -5, y1: -4, walkable: true, off: true };
        world.add(box);
        boxes.push(box);
      }
      this.arches.push({ s0, s1, h: -1.3, want: -1.3, t: 0, boxes });
    }
    // 背上的棘：沿龙身每 2.2 m 一根
    const nSpike = Math.floor(this.S / 2.2);
    this.spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.28, 1.0, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#2a2440', roughness: 0.5, emissive: '#3a0a30' }), nSpike);
    this.spikes.frustumCulled = false;
    root.add(this.spikes);
    // 头：人头 + 金色神面 + 鬃 + 冠
    const headSkin = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), new THREE.MeshStandardMaterial({ color: '#c9a98a', roughness: 0.6 }));
    headSkin.scale.set(1.25, 1.5, 1.3);
    // 神面：头的正脸（+Z，球面参数 φ = π/2 在 +Z）上一片金面具
    this.mask = new THREE.Mesh(new THREE.SphereGeometry(1.32, 24, 16, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.2, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.75, roughness: 0.3, emissive: '#3a2400', side: THREE.DoubleSide }));
    this.mask.scale.set(1.0, 1.25, 1.05);
    this.mask.rotation.y = 0;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: '#ff6ae0' });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), this.eyeMat);
      eye.position.set(s * 0.45, 0.25, 1.28);
      this.head.add(eye);
    }
    const crown = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.12, 6, 24), new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.8, roughness: 0.3 }));
    crown.rotation.x = Math.PI / 2 - 0.25;
    crown.position.y = 1.15;
    const maneMat = new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.8 });
    for (let k = 0; k < 9; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 3.2, 6).translate(0, 1.6, 0), maneMat);
      const a = -1.2 + (k / 8) * 2.4;
      c.position.set(Math.sin(a) * 0.9, 0.6, -0.6 - Math.cos(a) * 0.3);
      c.rotation.set(-2.2, a * 0.4, 0);
      this.head.add(c);
    }
    this.head.add(headSkin, this.mask, crown);
    root.add(this.head);
    // 腹鼓
    this.drum = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.35, 28).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8a2a22', roughness: 0.5, metalness: 0.2, emissive: '#2a0606' }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 6, 28), new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.8, roughness: 0.3 }));
    this.drum.add(rim);
    this.drumGlow = new THREE.Mesh(new THREE.CircleGeometry(1.45, 28), new THREE.MeshBasicMaterial({ color: '#ff6ae0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.drumGlow.position.z = 0.19;
    this.drum.add(this.drumGlow);
    root.add(this.drum);
    // 胸廓和肩：让上身读起来是人身（管子之外的两块体积）
    this.chestMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), new THREE.MeshStandardMaterial({ color: '#2a4a57', roughness: 0.5 }));
    this.chestMesh.scale.set(3.1, 2.6, 2.3);
    this.shoulders = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 6.2, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#244452', roughness: 0.5 }));
    this.chestMesh.castShadow = this.shoulders.castShadow = true;
    root.add(this.chestMesh, this.shoulders);
    // 两条长臂 + 三爪
    const armMat = new THREE.MeshStandardMaterial({ color: '#2a4a55', roughness: 0.55 });
    const clawMat = new THREE.MeshStandardMaterial({ color: '#e8dcc0', roughness: 0.4 });
    for (const side of [1, -1]) {
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1, 10).translate(0, 0.5, 0).rotateX(Math.PI / 2), armMat);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1, 10).translate(0, 0.5, 0).rotateX(Math.PI / 2), armMat);
      const claw = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), armMat);
      palm.scale.set(1, 0.6, 1.2);
      claw.add(palm);
      for (let f = 0; f < 3; f++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.6, 6).translate(0, 0.8, 0).rotateX(Math.PI / 2), clawMat);
        c.position.set((f - 1) * 0.55, -0.1, 0.8);
        c.rotation.x = 0.4;
        claw.add(c);
      }
      upper.castShadow = fore.castShadow = true;
      root.add(upper, fore, claw);
      this.arms.push({ upper, fore, claw, hand: new THREE.Vector3(), elbow: new THREE.Vector3(), side });
    }
    // 漩涡：上身出水处的一圈圈水纹
    this.vortex = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5 + k * 2.2, 0.12, 4, 40, Math.PI * 1.6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0.5, depthWrite: false }));
      this.vortex.add(ring);
    }
    root.add(this.vortex);
    // 雷息
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    this.beam = {
      core: new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#fff4ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })),
      glow: new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#ff4fd8', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })),
    };
    this.beam.core.visible = this.beam.glow.visible = false;
    root.add(this.beam.core, this.beam.glow);
    this.home.set(0, LAKE.level, COIL.headAt[1]);
    this.pos.copy(this.home);
    this.emerge = 0;
    this.layout(0);
  }

  private xzAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    const L = this.spiralLen;
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const k = THREE.MathUtils.clamp((s - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]), 0, 1);
    return out.lerpVectors(this.spiralXZ[i - 1], this.spiralXZ[i], k);
  }

  override charged(): boolean { return this.move.id === 'bellyDrum' || this.move.id === 'tripleDrum'; }

  shouldStart(): boolean { return Math.hypot(this.ctx.feet.x, this.ctx.feet.z) < 63; }

  override center(out: THREE.Vector3): THREE.Vector3 { return out.copy(this.chest); }

  protected override boneWorld(name: string, out: THREE.Vector3): THREE.Vector3 {
    switch (name) {
      case 'chest': return out.copy(this.chest);
      case 'face': return out.copy(this.headPos).addScaledVector(_u.copy(this.fwd), 1.1).setY(this.headPos.y + 0.1);
      case 'belly': return this.drum.getWorldPosition(out);
      case 'torso': return out.lerpVectors(this.base, this.chest, 0.4);
      case 'clawL': return out.copy(this.arms[0].hand);
      case 'clawR': return out.copy(this.arms[1].hand);
    }
    return out.copy(this.pos);
  }

  /** 神面：平时 ×1.2，低头（雷息收招、扑咬）×2.5，神颓 ×4；腹鼓：拍腹前摇 ×3 */
  protected override weakMult(s: { bone: string; mult: number; part?: string }): number {
    if (s.part === 'face') return this.brokenT > 0 ? 4 : this.lean > 0.7 ? 2.5 : s.mult;
    if (s.part === 'belly') return (this.move.id === 'bellyDrum' || this.move.id === 'tripleDrum') && this.move.stage === 'windup' ? 3 : s.mult;
    return s.mult;
  }

  protected override partMul(sphere: HitSphere | undefined, _info: DamageInfo, dmg: number): number {
    if (sphere?.part === 'belly' && (this.move.id === 'bellyDrum' || this.move.id === 'tripleDrum') && this.move.stage === 'windup') {
      this.mem.drumDmg = (this.mem.drumDmg ?? 0) + dmg * 3;
      if (this.mem.drumDmg >= 300) {
        this.mem.drumDmg = 0;
        this.ctx.fx.burst(this.drum.getWorldPosition(_v).clone(), 3, '#ffffff');
        this.ctx.fx.spray(_v, ['#ff6ae0', '#d9a441'], 40, 8, 4, 10, 0.8);
        this.stun(2, '腹鼓被打破，拍腹落空');
      }
    }
    return 1;
  }

  /** 导雷石柱的雷劈中神面 */
  struckByPillar(p: Pillar): void {
    const ctx = this.ctx;
    const face = this.boneWorld('face', new THREE.Vector3());
    for (let i = 0; i < 5; i++) ctx.fx.arc(p.top, face, i ? '#ff7ae6' : '#ffffff', 0.45, 2.5);
    ctx.fx.bolt(face.x, face.z, '#ffd6fb', face.y);
    ctx.fx.burst(face, 4, '#ffffff');
    ctx.shake(0.45);
    this.hit(600 * ctx.player.dmgMul, 1, face, { kind: 'env', elem: 'shock', poise: 0 });
    this.addBreak(400);
    if (this.brokenT <= 0) this.stun(2, `${p.name}的雷劈中了神面`);
  }

  // ─── 姿态：上身、头、手臂、龙身 ───

  /** 按上身角度、身高、前倾摆好各部位（每帧） */
  private layout(dt: number): void {
    const t = this.ctx.time;
    const H = 10 * this.height * this.emerge;
    this.base.set(Math.cos(this.ang) * this.rad, this.lake.level - 2 + 2 * this.emerge, Math.sin(this.ang) * this.rad);
    this.pos.copy(this.base).setY(this.lake.level);
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const side = _w.set(this.fwd.z, 0, -this.fwd.x);
    const lean = this.lean;
    const sway = Math.sin(t * 0.7) * 0.25;
    // 上身：底 → 腰 → 胸 → 颈；前倾时往前弯、头放低
    const pts: THREE.Vector3[] = [];
    const n = 28;
    const bend = (k: number): THREE.Vector3 => {
      const y = this.base.y - 3 + (H + 3) * k;
      const f = lean * lean * 6 * k * k + lean * 2.5 * k + sway * k;
      return new THREE.Vector3(this.base.x + this.fwd.x * f + side.x * sway * 0.5 * k, y - lean * 3.5 * k * k, this.base.z + this.fwd.z * f + side.z * sway * 0.5 * k);
    };
    for (let i = 0; i < n; i++) pts.push(bend(i / (n - 1) * 0.86));
    this.torso.update(pts, i => (i < 4 ? 2.5 : 2.5 - 1.2 * ((i - 4) / (n - 4)) ** 1.5) * (0.4 + 0.6 * this.emerge), this.fwd);
    this.chest.copy(bend(0.66));
    const em = 0.4 + 0.6 * this.emerge;
    this.chestMesh.position.copy(this.chest).addScaledVector(this.fwd, 0.5);
    this.chestMesh.rotation.set(0, this.yaw, 0);
    this.chestMesh.rotateX(lean * 0.7);
    this.chestMesh.scale.set(3.1 * em, 2.6 * em, 2.3 * em);
    this.shoulders.position.copy(this.chest).add(_u.set(0, 1.0 * em, 0));
    this.shoulders.rotation.set(0, this.yaw, 0);
    this.shoulders.scale.setScalar(em);
    this.chestMesh.visible = this.shoulders.visible = this.emerge > 0.05;
    const neck = bend(0.86);
    this.headPos.copy(neck).addScaledVector(this.fwd, 0.6 + lean * 1.2).add(_u.set(0, 1.4 - lean * 0.8, 0));
    this.head.position.copy(this.headPos);
    this.head.rotation.set(0, this.yaw, 0);
    this.head.rotateX(lean * 0.8 - 0.1 + (this.brokenT > 0 ? 0.3 : 0));
    this.head.scale.setScalar(0.4 + 0.6 * this.emerge);
    this.head.visible = this.emerge > 0.05;
    // 腹鼓
    const belly = bend(0.48);
    this.drum.position.copy(belly).addScaledVector(this.fwd, 1.75 - lean * 0.2);
    this.drum.rotation.set(0, this.yaw, 0);
    this.drum.rotateX(-lean * 0.5);
    this.drum.scale.setScalar(0.4 + 0.6 * this.emerge);
    this.drum.visible = this.emerge > 0.2;
    // 漩涡
    this.vortex.position.set(this.base.x, this.lake.level + 0.08, this.base.z);
    this.vortex.children.forEach((c, k) => { c.rotation.y = -t * (1.2 + k * 0.4); ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (0.25 + 0.35 * (this.phase === 3 ? 1 : 0.4)) * (1 - k * 0.15); });
    // 手臂（两骨 IK：肩 → 肘 → 手），手的目标由招式定
    for (const A of this.arms) {
      const S = _v.copy(this.chest).addScaledVector(side, A.side * 2.4).add(_u.set(0, 1.0, 0));
      const T = A.hand;
      const L1 = 8 * this.emerge + 0.5, L2 = 8 * this.emerge + 0.5;
      const d = THREE.MathUtils.clamp(S.distanceTo(T), 0.5, L1 + L2 - 0.05);
      const dir = _u.subVectors(T, S).normalize();
      const reach = S.clone().addScaledVector(dir, d);
      T.copy(reach);
      const ca = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
      // 肘朝外、略朝后上
      const pole = side.clone().multiplyScalar(A.side).addScaledVector(this.fwd, -0.4).add(new THREE.Vector3(0, 0.5, 0));
      const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
      A.elbow.copy(S).addScaledVector(dir, L1 * ca).addScaledVector(perp, L1 * sa);
      const place = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void => { m.position.copy(a); m.lookAt(b); m.scale.set(1, 1, a.distanceTo(b)); m.visible = this.emerge > 0.1; };
      place(A.upper, S, A.elbow);
      place(A.fore, A.elbow, T);
      A.claw.position.copy(T);
      A.claw.lookAt(T.clone().add(_w.subVectors(T, A.elbow)));
      A.claw.scale.setScalar(0.5 + 0.5 * this.emerge);
      A.claw.visible = this.emerge > 0.1;
    }
    // 龙身：沿螺旋，拱起的身段按各自高度，其余沉在水下；接到上身底下
    const lv = this.lake.level;
    for (let i = 0; i < SPIRAL.samples; i++) {
      const s = this.spiralLen[i];
      let y = lv - 1.4;
      for (const a of this.arches) if (s > a.s0 && s < a.s1) { const u = (s - a.s0) / (a.s1 - a.s0); y = Math.max(y, lv - 1.4 + (a.h + 1.4) * Math.sin(u * Math.PI)); }
      this.sPts[i].set(this.spiralXZ[i].x, y, this.spiralXZ[i].z);
    }
    this.coil.update(this.sPts, i => 0.35 + 1.15 * Math.min(1, this.spiralLen[i] / 18), UP);
    // 背棘
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let k = 0; k < this.spikes.count; k++) {
      const s = (k + 0.5) * 2.2;
      const i = Math.min(SPIRAL.samples - 1, Math.round((s / this.S) * (SPIRAL.samples - 1)));
      const r = 0.35 + 1.15 * Math.min(1, s / 18);
      q.identity();
      m4.compose(_v.copy(this.sPts[i]).setY(this.sPts[i].y + r * 0.85), q, _u.set(r, r * 1.2, r));
      this.spikes.setMatrixAt(k, m4);
    }
    this.spikes.instanceMatrix.needsUpdate = true;
    void dt;
  }

  /** 身段：轮流拱出水面（拱起 1.7 m、能站人），二阶段拱得更久 */
  private updateArches(dt: number): void {
    const ctx = this.ctx;
    this.archT -= dt;
    const upN = this.arches.filter(a => a.want > 0).length;
    if (this.archT <= 0 && this.active) {
      this.archT = this.phase >= 2 ? 3 : 4.5;
      // 从靠近玩家的那段开始，最多同时 3 段（二阶段 4 段）
      const down = this.arches.filter(a => a.want <= 0);
      if (down.length && upN < (this.phase >= 2 ? 4 : 3)) {
        const a = down[Math.floor(Math.random() * down.length)];
        a.want = ARCH_H; a.t = this.phase >= 2 ? 12 : 8;
      }
    }
    const lv = this.lake.level;
    const P = ctx.walker.feet;
    for (const a of this.arches) {
      if (a.want > 0) { a.t -= dt; if (a.t <= 0) a.want = -1.3; }
      const before = a.h;
      a.h += Math.sign(a.want - a.h) * Math.min(Math.abs(a.want - a.h), dt * 1.4);
      // 拱起前 1.5 秒水下发亮（预警）：用水花提示
      if (a.want > 0 && a.h < 0 && Math.random() < 0.4) {
        const p = this.xzAt(a.s0 + Math.random() * (a.s1 - a.s0), _v);
        ctx.fx.spray(_v.set(p.x, lv + 0.05, p.z), ['#e8fbff', '#ff9ae8'], 2, 1, 2, 4, 0.5);
      }
      a.boxes.forEach((b, q) => {
        const u = (q + 0.5) / a.boxes.length;
        const cy = lv - 1.4 + (a.h + 1.4) * Math.sin(u * Math.PI);
        const r = 1.5;
        b.y1 = cy + r * 0.85;
        b.y0 = cy - r;
        b.off = b.y1 < lv + 0.25;
        // 身段从脚下拱起来：把人抛上去
        if (!b.off && a.h > before) {
          const dx = P.x - b.x, dz = P.z - b.z, cs = Math.cos(b.yaw), sn = Math.sin(b.yaw);
          if (Math.abs(dx * cs - dz * sn) < b.hx && Math.abs(dx * sn + dz * cs) < b.hz && P.y < b.y1 - 0.05 && P.y > b.y0) {
            P.y = b.y1; ctx.walker.vy = 0; ctx.walker.knock(0, 0, 6);
          }
        }
      });
    }
  }

  // ─── 演出 ───

  protected introShot(): Shot {
    const ctx = this.ctx;
    ctx.weather.stormy = false;
    this.emerge = 0;
    this.height = 1;
    this.lean = 0;
    this.ang = Math.atan2(COIL.headAt[1], COIL.headAt[0]);
    this.rad = Math.hypot(COIL.headAt[0], COIL.headAt[1]);
    this.yaw = Math.atan2(ctx.feet.x - Math.cos(this.ang) * this.rad, ctx.feet.z - Math.sin(this.ang) * this.rad);
    for (const a of this.arches) { a.want = -1.3; a.h = -1.3; }
    const eye = ctx.walker.eye(new THREE.Vector3());
    const base = new THREE.Vector3(Math.cos(this.ang) * this.rad, this.lake.level, Math.sin(this.ang) * this.rad);
    const toP = new THREE.Vector3(eye.x - base.x, 0, eye.z - base.z).normalize();
    // 贴水面的机位：朝玩家那边 20 m，挡在中间的湖心岛（灵火神龛）绕开——往两侧转到视线不擦岛为止
    const lowAt = new THREE.Vector3();
    for (const turn of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
      const c = Math.cos(turn), s = Math.sin(turn);
      lowAt.set(base.x + (toP.x * c - toP.z * s) * 20, this.lake.level + 1.2, base.z + (toP.x * s + toP.z * c) * 20);
      const dx = lowAt.x - base.x, dz = lowAt.z - base.z;
      const k = THREE.MathUtils.clamp(((ISLAND.x - base.x) * dx + (ISLAND.z - base.z) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(base.x + dx * k - ISLAND.x, base.z + dz * k - ISLAND.z) > ISLAND.r + 3) break;
    }
    const head = new THREE.Vector3();
    let rose = 0;
    return {
      name: '雷泽雷神 · 登场', dur: 9.6, landDur: 1.4, handoff: 0.7, skipKey: 'intro.leize', bars: true,
      shots: [
        // 建立全景：玩家身后高处，越过镜子一样的湖面看神山和倒影；远雷滚过来，湖心开始打漩
        { id: 'establish', dur: 2.8, note: '玩家身后高处越过湖面看神山与倒影；2.0 秒湖心开始打漩', cam: (t, out) => { out.pos.copy(eye).addScaledVector(toP, 14).setY(eye.y + 9 - 2 * smooth(t / 2.8)); out.look.copy(base).setY(this.lake.level + 6 + 10 * (1 - smooth(t / 2.8))); out.fov = 52; } },
        // 首领现身：贴水面仰拍漩涡，雷神从漩涡里升起，龙身一节节拱出水面
        { id: 'reveal', dur: 3.0, blend: 0, note: '贴水面仰拍；2.8–5.2 秒从漩涡升起，身段一节节拱出水面', cam: (t, out) => { out.pos.copy(lowAt); out.look.copy(base).setY(this.lake.level + 2 + 7 * smooth(t / 2.6)); out.fov = 50; } },
        // 特写 + 名字卡：神面特写，双掌拍腹，一圈雷光扫过湖面
        { id: 'closeup', dur: 2.4, blend: 0.5, note: '神面特写；6.4 秒双掌拍腹，一圈雷光扫过湖面；终局名字卡 6.0 秒起', cam: (t, out) => { head.copy(this.headPos); out.pos.copy(head).addScaledVector(this.fwd, 9 - smooth(t / 2.4)).setY(head.y - 1.5); out.look.copy(head).setY(head.y - 0.6); out.fov = 46; } },
        this.landShot(1.4),
      ],
      card: { title: '雷泽雷神', sub: '龙身而人头 · 鼓其腹则雷', quote: '《海内东经》：雷泽中有雷神，龙身而人头，鼓其腹', at: 6.0, dur: 3.0, big: true },
      tick: (t, dt) => {
        if (t > 1.2) ctx.weather.stormy = true;
        // 漩涡打起来、上身升起（2.8–5.2 秒）
        const k = smooth((t - 2.8) / 2.4);
        this.emerge = k;
        this.show = { id: 'rise', stage: k < 1 ? 'windup' : 'active', k };
        // 身段一节节拱出水面
        for (const [i, a] of this.arches.entries()) if (t > 3.0 + i * 0.4 && a.want <= 0) { a.want = ARCH_H; a.t = 10; }
        this.updateArches(dt);
        if (t > 2.0 && Math.random() < 0.5) ctx.fx.spray(_v.set(base.x + (Math.random() - 0.5) * 8, this.lake.level + 0.1, base.z + (Math.random() - 0.5) * 8), ['#e8fbff', '#ffffff'], 2, 2, 2, 6, 0.8);
        // 手：先撑着水面，升起后抬到胸前，6.4 秒拍腹
        const clap = t > 6.0 && t < 6.8 ? Math.sin((t - 6.0) / 0.8 * Math.PI) : 0;
        for (const A of this.arms) A.hand.copy(this.chest).addScaledVector(this.fwd, 3 + 2 * (1 - k) - 1.2 * clap).add(_u.set(this.fwd.z * A.side * (4 - 2.5 * clap), -2 - 4 * (1 - k), -this.fwd.x * A.side * (4 - 2.5 * clap)));
        if (t > 6.4 && !rose) {
          rose = 1;
          ctx.fx.burst(this.drum.getWorldPosition(_v).clone(), 5, '#ff6ae0');
          ctx.fx.shockwave(base.x, base.z, 46, 1.4, undefined, '#ff6ae0');
          ctx.shake(0.4);
          for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.fx.bolt(Math.cos(a) * 40, Math.sin(a) * 40); }
        }
        this.layout(dt);
      },
    };
  }

  protected override afterIntro(): void {
    this.show = null;
    this.emerge = 1;
    this.ctx.say('雷泽雷神：打它的腹鼓（拍腹前摇）和神面（低头时）。拱出水面的身段能站人、挡雷息', 5);
  }

  protected transition(n: number): Shot {
    const ctx = this.ctx;
    const c = this.chest.clone();
    const a0 = Math.atan2(ctx.feet.x - c.x, ctx.feet.z - c.z);
    if (n === 2) {
      return {
        name: '雷泽雷神 · 雷泽', dur: 3.4, bars: true, landDur: 1.0, handoff: 0.3, skipKey: 'phase.leize.2',
        shots: [{ id: 'show', dur: 2.4, cam: orbitCam(c, 26, 2, a0 - 0.3, a0 + 0.2, 2.4, 0, 52) }, this.landShot(1.0)],
        banner: { text: '二 · 雷泽', at: 0.3, dur: 2.6 },
        tick: (t, dt) => {
          // 双掌拍水：湖水通电
          const slap = Math.sin(Math.min(1, t / 1.0) * Math.PI);
          for (const A of this.arms) A.hand.copy(this.base).addScaledVector(this.fwd, 6).add(_u.set(this.fwd.z * A.side * 5, 3 + 4 * slap, -this.fwd.x * A.side * 5));
          if (t > 0.9 && !this.mem.elec) { this.mem.elec = 1; ctx.fx.shockwave(this.base.x, this.base.z, 46, 1.2, undefined, '#ff4fd8'); ctx.shake(0.4); }
          const e = smooth((t - 0.9) / 1.4);
          this.lake.setTint('#ff4fd8', 0.35 * e);
          this.lake.setGlow(0.8 * e);
          this.layout(dt);
        },
        onEnd: () => { this.mem.elec = 0; ctx.say('湖水通电了——浅水里站着会挨电；导雷石柱被雷劈满之后打柱顶雷晶', 4); },
      };
    }
    return {
      name: '雷泽雷神 · 天怒', dur: 3.4, bars: true, landDur: 1.0, handoff: 0.3, skipKey: 'phase.leize.3',
      shots: [{ id: 'show', dur: 2.4, cam: orbitCam(c, 30, 1, a0 + 0.3, a0 - 0.2, 2.4, 2, 54) }, this.landShot(1.0)],
      banner: { text: '三 · 天怒', at: 0.3, dur: 2.6 },
      tick: (t, dt) => {
        this.height = 1 + 0.2 * smooth(t / 1.6);
        this.lean = -0.3 * Math.sin(Math.min(1, t / 2) * Math.PI);
        for (const A of this.arms) A.hand.copy(this.headPos).add(_u.set(this.fwd.z * A.side * 5, 5, -this.fwd.x * A.side * 5));
        if (t > 1.0 && Math.random() < 0.15) ctx.fx.bolt(this.base.x + (Math.random() - 0.5) * 50, this.base.z + (Math.random() - 0.5) * 50);
        this.layout(dt);
      },
      onEnd: () => { this.lean = 0; ctx.say('它站到了 12 米——天雷阵时站到导雷石柱旁边', 3); },
    };
  }

  protected deathShot(): Shot {
    const ctx = this.ctx;
    const c = this.chest.clone();
    const a0 = Math.atan2(ctx.feet.x - c.x, ctx.feet.z - c.z);
    return {
      name: '雷泽雷神 · 归于雷泽', dur: 8.5, bars: true, landDur: 1.4, handoff: 0.6, skippable: true,
      slow: (t) => (t < 1.4 ? 0.3 : 1),
      shots: [{ id: 'show', dur: 7.1, cam: orbitCam(c, 30, 4, a0 - 0.25, a0 + 0.6, 7.1, -2, 52) }, this.landShot(1.4)],
      card: { title: '雷泽雷神 · 归于雷泽', sub: '第四章 · 雪域天路 通关', at: 4.2, dur: 3.6, big: true },
      tick: (t, dt) => {
        // 神面裂开一道光 → 仰天 → 慢慢沉进漩涡，身段一节节没入水中，湖面恢复成镜子，雷暴散开
        if (t > 0.3 && !this.mem.crack) { this.mem.crack = 1; const f = this.boneWorld('face', new THREE.Vector3()); ctx.fx.burst(f, 5, '#ffffff'); ctx.fx.spray(f, ['#d9a441', '#ffffff', '#ff6ae0'], 80, 10, 5, 6, 1.4); ctx.shake(0.5); }
        this.lean = -0.35 * smooth(t / 1.6);
        this.emerge = 1 - smooth((t - 2.0) / 3.2);
        for (const a of this.arches) a.want = -1.3;
        this.updateArches(dt);
        for (const A of this.arms) A.hand.copy(this.headPos).add(_u.set(this.fwd.z * A.side * 6, 4 - 8 * smooth((t - 1.5) / 3), -this.fwd.x * A.side * 6));
        const clear = smooth((t - 2.5) / 3);
        this.lake.setTint('#ff4fd8', 0.35 * (1 - clear) * (this.phase >= 2 ? 1 : 0));
        this.lake.setGlow(0.8 * (1 - clear) * (this.phase >= 2 ? 1 : 0));
        if (t > 2.5) ctx.weather.stormy = false;
        this.layout(dt);
      },
      onEnd: () => { this.inShow = false; this.host.visible = false; },
    };
  }

  protected onBreak(): void {
    const ctx = this.ctx;
    ctx.fx.burst(this.boneWorld('face', _v).clone(), 4, '#ffffff');
    ctx.shake(0.5);
    ctx.say('神颓！雷泽雷神的神面磕在湖岸上——打神面（×4）', 3);
  }

  protected override onReset(): void {
    this.emerge = 0; this.height = 1; this.lean = 0;
    this.lake.setTint('#ff4fd8', 0); this.lake.setGlow(0);
    for (const a of this.arches) { a.want = -1.3; a.h = -1.3; }
    this.ctx.weather.stormy = false;
    this.beam.core.visible = this.beam.glow.visible = false;
    this.mem.crack = 0;
    this.layout(0);
  }

  protected override showing(dt: number): void { if (!this.ctx.cinema.active) this.layout(dt); }

  protected override idle(dt: number): void {
    this.emerge = 0;
    this.updateArches(dt);
    this.layout(dt);
  }

  /** 环形落雷：圈在玩家现在离湖心的半径上（偏 off 米），8 道；靠近导雷石柱的被柱子引走、给柱子充电 */
  private ring(off: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const R = Math.max(12, Math.hypot(P.x, P.z) + off);
    const a0 = Math.atan2(P.z, P.x) + (Math.random() - 0.5) * 0.2;
    for (let i = 0; i < 8; i++) {
      const a = a0 + (i / 8) * Math.PI * 2;
      ctx.bolt(Math.cos(a) * R, Math.sin(a) * R, { r: 3, delay: 1.2, dmg: 20, source: '雷泽雷神的拍腹雷' });
    }
  }

  protected override onEvent(ev: string, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id;
    void dist;
    if (ev === 'warn' && (id === 'bellyDrum' || id === 'tripleDrum')) { this.mem.drumDmg = 0; this.mem.beats = 0; ctx.say('腹鼓亮了——打腹鼓打断它；雷圈落在你所在的半径上，往里或往外走', 2.5); }
    else if (ev === 'beat') {
      const n = this.mem.beats = (this.mem.beats ?? 0) + 1;
      ctx.fx.burst(this.drum.getWorldPosition(_v).clone(), 3, '#ff6ae0');
      ctx.fx.shockwave(this.base.x, this.base.z, 30, 0.8, undefined, '#ff6ae0');
      ctx.shake(0.25);
      this.ring(id === 'tripleDrum' ? (n - 2) * 8 : n === 1 ? 0 : 7);
    } else if (ev === 'warn' && id === 'clawSlam') {
      // 落点：玩家脚下，最远够到离上身 24 m
      const dx = P.x - this.base.x, dz = P.z - this.base.z, d = Math.hypot(dx, dz) || 1;
      const reach = Math.min(d, 24);
      this.target.set(this.base.x + dx / d * reach, 0, this.base.z + dz / d * reach);
      this.target.y = this.g.groundAt(this.target.x, this.target.z);
      this.mem.side = Math.random() < 0.5 ? 0 : 1;
      this.warns.push(ctx.fx.telegraph(this.target.x, this.target.z, 6, this.move.def!.windup, () => {}, '#ffb347'));
    } else if (ev === 'hit' && id === 'clawSlam') {
      const T = this.target;
      ctx.fx.spray(T, ['#e8fbff', '#8a7a60', '#ffffff'], 60, 9, 5, 12, 0.9);
      ctx.shake(0.45);
      if (Math.hypot(P.x - T.x, P.z - T.z) < 6 && !ctx.invulnerable()) ctx.hurt(26, '雷泽雷神的龙爪', this.g.knockFrom(T.x, T.z, 12, 6));
      let done = false;
      ctx.fx.shockwave(T.x, T.z, 12, 0.6, (r) => {
        const d = Math.hypot(ctx.feet.x - T.x, ctx.feet.z - T.z);
        if (!done && d > 6 && Math.abs(d - r) < 1.2 && ctx.walker.grounded && !ctx.invulnerable()) { done = true; ctx.hurt(12, '龙爪的冲击', this.g.knockFrom(T.x, T.z, 8, 4)); }
      });
    } else if (ev === 'warn' && id === 'breath') {
      // 雷息：沿玩家所在的那一圈扫 90°（从玩家的一侧扫到另一侧）
      this.breathR = Math.hypot(P.x, P.z);
      const pa = Math.atan2(P.z, P.x);
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.breathA0 = pa - dir * Math.PI / 4;
      this.mem.bdir = dir;
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const a = this.breathA0 + dir * (Math.PI / 2) * (i / steps), b = this.breathA0 + dir * (Math.PI / 2) * ((i + 1) / steps);
        this.warns.push(ctx.fx.lineWarn(Math.cos(a) * this.breathR, Math.sin(a) * this.breathR, Math.cos(b) * this.breathR, Math.sin(b) * this.breathR, 6, this.move.def!.windup, '#ff4fd8'));
      }
      ctx.say('雷神低头——雷息要沿湖岸扫过来：躲到拱起的身段或玛尼堆后面', 2.5);
    } else if (ev === 'hit' && id === 'sweep') {
      const dx = P.x - this.base.x, dz = P.z - this.base.z, d = Math.hypot(dx, dz);
      let a = Math.atan2(dx, dz) - this.yaw; a = Math.atan2(Math.sin(a), Math.cos(a));
      ctx.shake(0.3);
      if (d < 22 && Math.abs(a) < 1.1 && !ctx.invulnerable()) ctx.hurt(18, '雷泽雷神的双爪横扫', this.g.knockFrom(this.base.x, this.base.z, 12, 5));
    } else if (ev === 'warn' && id === 'sweep') {
      this.warns.push(ctx.fx.coneWarn(this.base.x, this.base.z, this.yaw, 2.2, 22, this.move.def!.windup, '#ffb347'));
    } else if (ev === 'warn' && id === 'skyArray') {
      ctx.say('天雷阵——站到导雷石柱 2–5 m 旁边躲雷，让雷给柱子充电', 3);
    }
  }

  protected think(dt: number, dist: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const id = this.move.id, st = this.move.stage;
    // 上身慢慢沿湖里一圈挪向玩家那一侧
    const pa = Math.atan2(P.z, P.x);
    let da = pa - this.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
    const spd = (this.move.busy ? 0.04 : 0.16) * (this.phase === 3 ? 1.4 : 1);
    this.ang += Math.max(-spd * dt, Math.min(spd * dt, da));
    this.rad += (18 - this.rad) * Math.min(1, dt);
    this.faceTo(P.x, P.z, dt, this.move.busy && id === 'breath' ? 0 : 1.2);
    // 姿态和手
    let leanT = 0;
    const side = _w.set(this.fwd.z, 0, -this.fwd.x);
    const rest = (A: { side: number; hand: THREE.Vector3 }): void => { A.hand.lerp(_u.copy(this.chest).addScaledVector(this.fwd, 3.5).addScaledVector(side, A.side * 4).setY(this.chest.y - 2.5), Math.min(1, dt * 3)); };
    if (id === 'bellyDrum' || id === 'tripleDrum') {
      leanT = -0.15;
      const beat = st === 'active' ? Math.abs(Math.sin(this.move.stageT * Math.PI / 0.6)) : 0;
      for (const A of this.arms) {
        const up = st === 'windup' ? smooth(this.move.stageK) : st === 'active' ? 1 - beat : 0;
        A.hand.lerp(_u.copy(this.drum.position).addScaledVector(this.fwd, 1.2 + 2 * up).addScaledVector(side, A.side * (1.4 + 3 * up)).setY(this.drum.position.y + 3 * up), Math.min(1, dt * 10));
      }
    } else if (id === 'clawSlam') {
      leanT = 0.35;
      const A = this.arms[this.mem.side ?? 0], B = this.arms[1 - (this.mem.side ?? 0)];
      const T = this.target;
      if (st === 'windup') A.hand.lerp(_u.set(T.x, T.y + 12, T.z).lerp(this.chest, 0.3), Math.min(1, dt * 4));
      else A.hand.lerp(_u.copy(T).setY(T.y + 0.6), Math.min(1, dt * (st === 'active' ? 25 : 2)));
      rest(B);
    } else if (id === 'breath') {
      leanT = st === 'recover' ? 0.9 : 1.0;
      for (const A of this.arms) A.hand.lerp(_u.copy(this.base).addScaledVector(this.fwd, 7).addScaledVector(side, A.side * 6).setY(this.lake.level + 1), Math.min(1, dt * 3));
      if (st === 'active') this.breathTick(dt);
    } else if (id === 'sweep') {
      leanT = 0.3;
      const k = st === 'windup' ? -smooth(this.move.stageK) : st === 'active' ? -1 + 2 * smooth(this.move.stageK) : 1;
      for (const A of this.arms) A.hand.lerp(_u.copy(this.base).addScaledVector(this.fwd, 12).addScaledVector(side, (A.side * 3 + k * 14)).setY(this.lake.level + 2.5), Math.min(1, dt * (st === 'active' ? 14 : 4)));
    } else if (id === 'skyArray') {
      leanT = -0.3;
      for (const A of this.arms) A.hand.lerp(_u.copy(this.headPos).addScaledVector(side, A.side * 4).setY(this.headPos.y + 6), Math.min(1, dt * 3));
      if (st === 'active') {
        this.mem.sky = (this.mem.sky ?? 0) - dt;
        if (this.mem.sky <= 0) {
          this.mem.sky = 0.4;
          const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 55;
          // 一半落在玩家附近
          const near = Math.random() < 0.5;
          const x = near ? P.x + (Math.random() - 0.5) * 10 : Math.cos(a) * r, z = near ? P.z + (Math.random() - 0.5) * 10 : Math.sin(a) * r;
          ctx.bolt(x, z, { r: 3, delay: 1.0, dmg: 18, source: '天雷阵' });
        }
      }
    } else for (const A of this.arms) rest(A);
    if (this.brokenT > 0) leanT = 1.3;
    this.lean += (leanT - this.lean) * Math.min(1, dt * 3);
    if (this.move.busy || this.cd > 0) return;
    this.cd = 1.0 * this.tempo;
    const near = Math.hypot(P.x - this.base.x, P.z - this.base.z) < 26;
    const m = this.pick([LEIZE.bellyDrum, LEIZE.clawSlam, LEIZE.breath, LEIZE.sweep, LEIZE.tripleDrum, LEIZE.skyArray], (x: MoveDef) => {
      if (x.id === 'clawSlam') return near ? 2.2 : 0.4;
      if (x.id === 'sweep') return near ? 1.6 : 0;
      if (x.id === 'breath') return near ? 0.6 : 1.6;
      if (x.id === 'bellyDrum') return this.phase === 3 ? 0.6 : 1.5;
      return 1.2;
    });
    if (m) this.begin(m);
    void dist;
  }

  /** 雷息：从嘴里一道雷光扫过湖岸那一圈；被挡住（拱起的身段、玛尼堆、石柱）就不挨 */
  private breathTick(dt: number): void {
    const ctx = this.ctx, P = ctx.feet;
    const k = this.move.stageK;
    const a = this.breathA0 + (this.mem.bdir ?? 1) * (Math.PI / 2) * k;
    const hitP = _v.set(Math.cos(a) * this.breathR, 0, Math.sin(a) * this.breathR);
    hitP.y = this.g.groundAt(hitP.x, hitP.z) + 0.3;
    const mouth = this.boneWorld('face', _w).clone();
    // 打到挡着的东西就停在那
    const end = hitP.clone();
    const n = Math.ceil(mouth.distanceTo(hitP) / 0.8);
    for (let i = 1; i <= n; i++) {
      _u.lerpVectors(mouth, hitP, i / n);
      if (ctx.world.solidAt(_u.x, _u.y, _u.z)) { end.copy(_u); break; }
    }
    for (const [m, r] of [[this.beam.core, 0.35], [this.beam.glow, 1.3]] as const) {
      m.visible = true;
      m.position.copy(mouth);
      m.lookAt(end);
      m.scale.set(r, r, mouth.distanceTo(end));
    }
    if (Math.random() < 0.7) ctx.fx.spray(end, ['#ff6ae0', '#ffffff'], 4, 4, 3, 10, 0.4);
    this.mem.btick = (this.mem.btick ?? 0) - dt;
    if (this.mem.btick <= 0 && end.distanceTo(hitP) < 0.5) {
      // 玩家在扫线附近 4 m 内、而且没被挡住
      const d = Math.hypot(P.x - hitP.x, P.z - hitP.z);
      if (d < 4 && !ctx.invulnerable()) {
        let blocked = false;
        for (let i = 1; i < 20; i++) { _u.lerpVectors(mouth, ctx.center, i / 20); if (ctx.world.solidAt(_u.x, _u.y, _u.z)) { blocked = true; break; } }
        if (!blocked) { this.mem.btick = 0.2; ctx.hurt(8, '雷泽雷神的雷息', undefined, 'shock'); }
      }
    }
  }

  protected override after(dt: number): void {
    const ctx = this.ctx;
    if (this.move.id !== 'breath' || this.move.stage !== 'active') this.beam.core.visible = this.beam.glow.visible = false;
    // 腹鼓：拍腹前摇发亮
    const drumK = (this.move.id === 'bellyDrum' || this.move.id === 'tripleDrum') ? (this.move.stage === 'windup' ? this.move.stageK : this.move.stage === 'active' ? 0.8 : 0) : 0;
    (this.drumGlow.material as THREE.MeshBasicMaterial).opacity = 0.9 * drumK * (0.8 + 0.2 * Math.sin(ctx.time * 30));
    this.eyeMat.color.setRGB(1, 0.42 + 0.5 * (this.lean > 0.7 ? 1 : 0), 0.88);
    (this.mask.material as THREE.MeshStandardMaterial).emissive.setRGB(0.23 + this.flash * 0.6 + (this.brokenT > 0 ? 0.3 : 0), 0.14 + this.flash * 0.5, this.flash * 0.3);
    if (!this.inShow) { this.updateArches(dt); this.layout(dt); }
  }

  /** 白模：不走骨骼动画，自己摆（Boss.render 的骨骼部分跳过） */
  protected override render(dt: number): void {
    this.host.position.set(0, 0, 0);
    this.host.rotation.set(0, 0, 0);
    this.host.updateMatrixWorld(true);
    this.after(dt);
  }
}

export { ISLAND };
