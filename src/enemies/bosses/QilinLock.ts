/**
 * 吊鼎锁扣：火麒麟（boss_qilin）在炉心殿东南西北四面外墙上召出的可射击目标（Unity QilinLock：象限中线上、离圆心 23.1 m、离地 12 m，血量 110 × 难度）。巨鼎的四条铁链各拴在
 * 一个锁扣上：打碎一个，鼎的那一角坠下——麒麟正在那一侧熔池边饮熔时砸中它（眩晕 4 秒、鳞甲崩裂），否则砸空、白费一个。
 * 不移动、不攻击、不掉落；锁扣碎掉时通知首领（owner.onLockBroken）。55% 时剩下的铁链全断，首领把锁扣静默移除。
 */
import * as THREE from 'three';
import type { DamageResult, EnemyDef, GameContext, SpawnOptions } from '../../core/types';
import { EnemyBase } from '../EnemyBase';
import { geo, glow, glowMesh, mesh, pivot, std } from './parts';

export const QILIN_LOCK_DEF: EnemyDef = {
  id: 'boss_qilin_lock',
  name: '吊鼎锁扣',
  // 第三章难度约 3 时 ≈ 300：常规武器 1 秒多打碎，比 Boss 弱点好打，但要专门瞄
  hp: 110,
  speed: 0,
  radius: 0.55,
  height: 1.5,
  flying: true,
  damage: 0,
  coins: [0, 0],
  essence: 0,
  // 发光锁芯就是爆头点
  headY: 0.75,
  headRadius: 0.32,
  knockbackResist: 1,
  color: 0xff9a3a,
};

export interface LockOwner {
  onLockBroken(lock: QilinLock): void;
}

const _a = new THREE.Vector3();
const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4();

export class QilinLock extends EnemyBase {
  owner: LockOwner | null = null;
  /** 第几个锁扣（首领的象限下标） */
  index = 0;
  /** 锁扣朝向殿心的方位（facing 约定），由首领在召出后设置 */
  faceAngle = 0;
  /** 首领正在这一侧饮熔：锁扣大亮（提示该打哪一个） */
  highlight = false;
  private glowK = 0;
  private core: THREE.Mesh | null = null;
  private halo: THREE.Mesh | null = null;
  private body: THREE.Object3D | null = null;
  /** 场景里的正式件（SM_Prop_QilinChainLock）：跟着锁身走，碎了 / 移除时藏起来 */
  private art: THREE.Object3D | null = null;
  private readonly artLocal = new THREE.Matrix4();

  constructor(ctx: GameContext, opts: SpawnOptions) {
    super(ctx, QILIN_LOCK_DEF, opts);
    this.spawnDuration = 0.5;
    this.deathDuration = 0.6;
    this.flyTargetY = opts.position.y;
  }

  protected override buildModel(): THREE.Object3D {
    const bronze = std(0x6a4a24, { emissive: 0x3a1a04, ei: 0.4, rough: 0.45, metal: 0.7 });
    const iron = std(0x1e1a18, { rough: 0.6, metal: 0.6 });
    const root = new THREE.Group();
    const body = pivot(root, 0, 0, 0);
    this.body = body;
    // 背板（嵌在墙上）+ 锁身 + 锁梁 + 兽面锁芯
    mesh(body, geo.box(1.3, 1.5, 0.25), iron, 0, 0.75, -0.25);
    mesh(body, geo.box(0.95, 0.75, 0.5), bronze, 0, 0.55, 0);
    const shackle = mesh(body, geo.torus(0.34, 0.09, 6, 12), iron, 0, 1.05, 0);
    shackle.scale.set(1, 1.1, 1);
    this.core = glowMesh(body, geo.octa(0.2), glow(0xffd070), 0, 0.6, 0.27, 'core');
    this.halo = glowMesh(body, geo.sphere(0.45, 10, 8), glow(0xff7a20, 0.32, true), 0, 0.6, 0.2, 'halo');
    return root;
  }

  override init(): void {
    super.init();
    this.model.traverse((o) => {
      if (o.userData.glow) o.castShadow = false;
    });
  }

  protected override think(_dt: number): void {
    this.stopMoving();
    this.facing = this.faceAngle;
    this.flyTargetY = this.position.y;
  }

  protected override animate(dt: number): void {
    this.glowK += ((this.highlight ? 1 : 0) - this.glowK) * Math.min(1, dt * 5);
    const k = 0.75 + 0.25 * Math.sin(this.age * (4 + 6 * this.glowK) + this.index);
    if (this.halo) this.halo.scale.setScalar((0.9 + 0.2 * k) * (1 + 0.9 * this.glowK));
    if (this.core) this.core.rotation.z += 0.02 + 0.08 * this.glowK;
    this.driveArt();
  }

  /**
   * 认领场景里的正式件（Unity 关卡把锁扣正式件贴墙摆好，网页场景视图把它画成静态网格）：之后跟着锁身走（碎了往下掉），
   * 程序锁身藏起来，只留发光锁芯（弱点）和光晕
   */
  adoptArt(art: THREE.Object3D): void {
    this.root.updateMatrixWorld(true);
    art.updateMatrixWorld(true);
    this.art = art;
    this.artLocal.copy(this.model.matrixWorld).invert().multiply(art.matrixWorld);
    if (this.body) for (const c of this.body.children) if (c !== this.core && c !== this.halo) c.visible = false;
    // 锁芯往殿心挪一点，露在正式件的正面
    this.core?.position.setZ(0.45);
    this.halo?.position.setZ(0.4);
  }

  private driveArt(): void {
    const art = this.art;
    if (!art) return;
    this.root.updateMatrixWorld(true);
    _m.multiplyMatrices(this.model.matrixWorld, this.artLocal);
    if (art.parent) {
      art.parent.updateMatrixWorld(true);
      _m.premultiply(_mi.copy(art.parent.matrixWorld).invert());
    }
    _m.decompose(art.position, art.quaternion, art.scale);
  }

  protected override onDispose(): void {
    if (this.art) this.art.visible = false;
    this.art = null;
  }

  protected override onDeath(result: DamageResult): void {
    this.getBodyCenter(_a);
    const purge = result.request.tags?.includes('purge');
    this.ctx.fx.burst(_a, 0xffb050, purge ? 10 : 30, 8, 0.8, 0.3, 14);
    this.ctx.fx.burst(_a, 0x3a2a20, 14, 5, 0.9, 0.35, 16);
    if (!purge) {
      this.ctx.audio.play('shield_break', { position: this.position, pitch: 0.7, volume: 1 });
      this.owner?.onLockBroken(this);
    }
  }

  protected override animateDeath(t: number): void {
    // 锁身碎开、往下掉
    this.model.position.y = -3 * t * t;
    this.model.rotation.x = t * 1.4;
    this.model.scale.setScalar(Math.max(0.01, 1 - t * 0.6));
    this.driveArt();
    // 碎完（Unity CollapseTime 0.6 s）：正式件跟着藏起来
    if (t >= 0.95 && this.art) {
      this.art.visible = false;
      this.art = null;
    }
  }
}
