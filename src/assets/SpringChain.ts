/**
 * 弹簧骨骼链（VRM spring bone 的 verlet 形式），给尾巴、耳朵这类 Mixamo 没有动画的附属部位加惯性。
 *
 * 和 enemies/types/JerboaBlade.ts 的尾巴同一套算法，抽成通用件：
 *  - 按绑定姿势记下每节骨骼指向下一节的方向（骨骼局部）和节长；末节没有子骨骼时沿用上一节方向，或用 tipLength 指定。
 *  - 每帧先由动画摆好「意图姿势」（尾根抬多高、耳朵往哪甩），再调用 step()：
 *    每节的尾端质点 += 惯性（上一帧位移 ×(1 − 阻尼)）+ 意图方向 × 刚度 × dt + 重力 × dt，
 *    按节长拉回、限制单节最大弯折，然后把骨骼从意图方向转到质点方向。
 *  - 质点存世界坐标：舞台转动、拖拽、角色起跳落地都会自然带出甩动。
 * reset() 把质点放回意图姿势（换英雄、跳帧、快进量取景之后调用，避免一帧甩飞）。
 */
import * as THREE from 'three';

export interface SpringChainOptions {
  /** 每节刚度（从根到尖，个数不足时用最后一个；米/秒，单位同跳鼠尾巴 5.2 / 3.0 / 2.0 / 1.4）：越大越快回到意图方向 */
  stiffness: readonly number[];
  /** 阻尼 0–1：每步损失的速度比例 */
  drag?: number;
  /** 重力（每步把尾端下拉 gravity × dt 米） */
  gravity?: number;
  /** 单节相对意图方向的最大弯折（弧度） */
  maxBend?: number;
  /** 末节的长度（米，世界）；缺省沿用上一节 */
  tipLength?: number;
}

interface Joint {
  bone: THREE.Bone;
  /** 骨骼局部坐标里指向尾端的方向 */
  axis: THREE.Vector3;
  /** 节长（骨骼局部单位） */
  localLen: number;
  tail: THREE.Vector3;
  prev: THREE.Vector3;
}

const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _next = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _delta = new THREE.Quaternion();

export class SpringChain {
  private readonly joints: Joint[] = [];
  private live = false;
  private readonly drag: number;
  private readonly gravity: number;
  private readonly maxBend: number;

  /** bones：从根到尖、相互为父子的骨骼（在绑定姿势下构造） */
  constructor(bones: readonly THREE.Bone[], private readonly opts: SpringChainOptions) {
    this.drag = opts.drag ?? 0.3;
    this.gravity = opts.gravity ?? 0.25;
    this.maxBend = opts.maxBend ?? 0.45;
    bones.forEach((b) => b.updateWorldMatrix(true, false));
    const wp = bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      const inv = b.getWorldQuaternion(new THREE.Quaternion()).invert();
      const s = b.getWorldScale(new THREE.Vector3()).x;
      let dirW: THREE.Vector3;
      let lenW: number;
      if (i + 1 < bones.length) {
        dirW = wp[i + 1].clone().sub(wp[i]);
        lenW = dirW.length();
      } else if (bones.length > 1) {
        dirW = wp[i].clone().sub(wp[i - 1]);
        lenW = opts.tipLength ?? dirW.length();
      } else {
        // 单节（耳朵）：沿骨骼自身 +Y（glTF / Mixamo 的骨骼长轴）
        dirW = new THREE.Vector3(0, 1, 0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()));
        lenW = opts.tipLength ?? 0.1;
      }
      this.joints.push({ bone: b, axis: dirW.normalize().applyQuaternion(inv), localLen: lenW / s, tail: new THREE.Vector3(), prev: new THREE.Vector3() });
    }
  }

  reset(): void {
    this.live = false;
  }

  /** 推进一步：在动画摆好意图姿势、且父骨骼世界矩阵已更新之后调用 */
  step(dt: number): void {
    const h = Math.min(dt, 1 / 20);
    if (h <= 0) return;
    const st = this.opts.stiffness;
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i];
      const b = j.bone;
      b.updateWorldMatrix(true, false);
      b.getWorldPosition(_head);
      b.getWorldQuaternion(_q);
      _dir.copy(j.axis).applyQuaternion(_q);
      const len = j.localLen * b.getWorldScale(_scale).x;
      if (!this.live || j.tail.distanceToSquared(_head) > 4 * len * len + 1) {
        j.tail.copy(_head).addScaledVector(_dir, len);
        j.prev.copy(j.tail);
      }
      _cur.copy(j.tail);
      _next.copy(_cur)
        .addScaledVector(_vel.subVectors(j.tail, j.prev), 1 - this.drag)
        .addScaledVector(_dir, st[Math.min(i, st.length - 1)] * h)
        .add(_vel.set(0, -this.gravity * h, 0));
      _next.sub(_head).setLength(len).add(_head);
      _vel.subVectors(_next, _head).normalize();
      const bend = _vel.angleTo(_dir);
      if (bend > this.maxBend) {
        _delta.setFromUnitVectors(_dir, _vel);
        _pq.identity().slerp(_delta, this.maxBend / bend);
        _next.copy(_dir).applyQuaternion(_pq).multiplyScalar(len).add(_head);
      }
      j.prev.copy(j.tail);
      j.tail.copy(_next);
      _vel.subVectors(_next, _head).normalize();
      _delta.setFromUnitVectors(_dir, _vel);
      b.parent!.getWorldQuaternion(_pq).invert();
      b.quaternion.copy(_pq.multiply(_delta).multiply(_q));
      b.updateWorldMatrix(false, false);
    }
    this.live = true;
  }
}
