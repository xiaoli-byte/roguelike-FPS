import * as THREE from 'three';
import type { AnimatorStateMachine } from './AnimatorStateMachine';
import type { CreatureRig } from './CreatureRig';

/**
 * Unity CreatureLocomotion.cs 照译：从角色根节点的实际运动推导动画参数，玩法只管移动根节点。
 *   Speed      水平速度（平滑）；原地转身时取「脚掌绕身体转动的弧速度」，混合树播慢步态 + 脚步锁定 = 原地小碎步
 *   MoveScale  超过最快片段的录制速度时加快播放（最多 2.5 倍）
 *   倾斜        偏航角速度 × 速度 → 身体压向弯内侧（CreatureRig.lean，正 = 向右）
 * 执行顺序：移动根节点 → CreatureLocomotion.tick → AnimatorStateMachine.update → CreatureRig.tick。
 * 偏航：three 绕 +Y 正转 = 从上往下看逆时针（左转），Unity eulerAngles.y 正 = 右转，所以倾斜公式里换号。
 */
export class CreatureLocomotion {
  /** 最快的移动片段录制速度（米 / 秒；Unity ArtAssetInfo.moveSpeed，导出数据的 moveSpeed） */
  maxClipSpeed: number;
  /** 原地转身的弧速度半径（米）；默认腿长 × 0.8（≥ 0.2），没有腿 0.4 */
  turnRadius: number;
  /** 度 / (弧度每秒 × 米每秒) */
  leanPerTurn = 2.2;
  maxLean = 12;
  /** ≥ 0 时替代实测水平速度（位移本身不均匀的步态：蜃楼蟾只在腾空段前进） */
  speedOverride = -1;

  planarSpeed = 0;
  /** 偏航角速度（弧度 / 秒，Unity 约定：正 = 右转） */
  yawRate = 0;

  private readonly root: THREE.Object3D;
  private readonly animator: AnimatorStateMachine | null;
  private readonly rig: CreatureRig | null;
  private readonly lastPos = new THREE.Vector3();
  private lastYaw = 0;
  private speedSmoothed = 0;

  constructor(root: THREE.Object3D, animator: AnimatorStateMachine | null, rig: CreatureRig | null, maxClipSpeed = 0) {
    this.root = root;
    this.animator = animator;
    this.rig = rig;
    this.maxClipSpeed = maxClipSpeed > 0 ? maxClipSpeed : 2;
    this.turnRadius = rig ? Math.max(0.2, rig.legLength * 0.8) : 0.4;
    this.teleported();
  }

  /** 根节点被瞬移（重生、对象池复用）后调用 */
  teleported() {
    this.root.getWorldPosition(this.lastPos);
    this.lastYaw = this.yawDeg();
    this.speedSmoothed = 0;
  }

  /** Unity 约定的偏航（度，正 = 右转） */
  private yawDeg(): number {
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    return -Math.atan2(f.x, f.z) / (Math.PI / 180);
  }

  tick(dt: number) {
    if (dt <= 0) return;
    const pos = this.root.getWorldPosition(new THREE.Vector3());
    const yaw = this.yawDeg();
    this.planarSpeed = Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z) / dt;
    this.yawRate = THREE.MathUtils.degToRad(deltaAngle(this.lastYaw, yaw)) / dt;
    this.lastPos.copy(pos);
    this.lastYaw = yaw;
    if (this.planarSpeed > 20) this.planarSpeed = 0; // 瞬移

    const turnStep = Math.abs(this.yawRate) * this.turnRadius;
    const planar = this.speedOverride >= 0 ? this.speedOverride : this.planarSpeed;
    const want = planar < 0.3 && turnStep > 0.15 ? Math.max(planar, Math.min(turnStep, this.maxClipSpeed * 0.5)) : planar;
    this.speedSmoothed = THREE.MathUtils.lerp(this.speedSmoothed, want, 1 - Math.exp(-12 * dt));
    if (this.animator) {
      this.animator.setFloat('Speed', this.speedSmoothed);
      if (this.animator.hasParameter('MoveScale')) {
        this.animator.setFloat('MoveScale', this.speedSmoothed > this.maxClipSpeed ? Math.min(2.5, this.speedSmoothed / this.maxClipSpeed) : 1);
      }
    }
    if (this.rig) this.rig.lean = THREE.MathUtils.clamp(this.yawRate * planar * this.leanPerTurn, -this.maxLean, this.maxLean);
  }
}

/** Mathf.DeltaAngle：两个角度（度）之间最短的有符号差 */
export function deltaAngle(current: number, target: number): number {
  let d = (target - current) % 360;
  if (d < 0) d += 360;
  if (d > 180) d -= 360;
  return d;
}
