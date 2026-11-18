/**
 * 张鳞的「鳞冠」（Unity Qilin/QilinScaleCrown.cs 的网页版，设计单 docs/art/vfx/qilin.md「张鳞」）：前摇里，一圈玄铁鳞片从麒麟身上竖起、张开，
 * 正好立在每一片鳞刃要射出的位置上（同样的片数、同样的方位、离地 1.2 m、半径 2.2 m）——前摇就读得出「从哪来、往哪飞、什么时候飞」：
 *   起（0–25%）：鳞片贴着身体冒出来，暗赭；张（25–85%）：往外推到出手半径、向外翻开 40°，暗金越来越亮；顶点（最后 15%）：暖白金、微微一颤；
 *   出手那一帧 release 收掉，鳞刃在同一位置接上。
 * 与 Unity 的差异：一张实例化的薄片网格 + 顶点色（Unity 是程序网格 + 鳞形贴图）；低画质只画一半片数同 Unity。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';

const OCHRE = new THREE.Color(0x8a5a1c), GOLD = new THREE.Color(0xd9a441), GOLD_HOT = new THREE.Color(0xffe6a8);
const SCALE_W = 0.5, SCALE_H = 0.85;
const MAX = 36;
const DEG = Math.PI / 180;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class QilinScaleCrown {
  private readonly mesh: THREE.InstancedMesh;
  private readonly center = new THREE.Vector3();
  private count = 0;
  private t = 0;
  private seconds = 1;
  private radius = 2.2;
  private y = 1.2;
  private yaw0 = 0;
  private offset = 0;
  private stride = 1;
  live = false;

  constructor(private readonly ctx: GameContext) {
    const geo = new THREE.PlaneGeometry(SCALE_W, SCALE_H);
    geo.translate(0, SCALE_H * 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'qilin-scale-crown';
    this.mesh.visible = false;
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, ZERO);
    ctx.stageGroup.add(this.mesh);
    this.stride = ctx.settings.quality === 'low' ? 2 : 1;
  }

  /** 开始张鳞：center = 首领脚下，yaw = 出手时的朝向（度），n 片、出手半径 r、离地高度（世界 y）、seconds 秒后出手；offsetFrac = 起始角偏移（格） */
  begin(center: THREE.Vector3, yawDeg: number, n: number, r: number, worldY: number, seconds: number, offsetFrac = 0): void {
    this.center.copy(center);
    this.count = Math.min(MAX, Math.max(1, n));
    this.yaw0 = yawDeg;
    this.offset = offsetFrac;
    this.radius = r;
    this.y = worldY;
    this.seconds = Math.max(0.05, seconds);
    this.t = 0;
    this.live = true;
    this.mesh.visible = true;
    this.update(0);
  }

  release(): void {
    if (!this.live) return;
    this.live = false;
    this.mesh.visible = false;
  }

  update(dt: number): void {
    if (!this.live) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.seconds);
    // 起：贴身冒出；张：推到出手半径、翻开 40°；顶点：一颤
    const rise = Math.min(1, k / 0.25);
    const open = Math.min(1, Math.max(0, (k - 0.25) / 0.6));
    const peak = Math.max(0, (k - 0.85) / 0.15);
    const r = 0.9 + (this.radius - 0.9) * open;
    const tilt = 40 * open * DEG + Math.sin(this.t * 60) * 0.06 * peak;
    if (k < 0.85) _c.copy(OCHRE).lerp(GOLD, open);
    else _c.copy(GOLD).lerp(GOLD_HOT, peak);
    let idx = 0;
    for (let i = 0; i < this.count; i += this.stride) {
      const yaw = (this.yaw0 + (i + this.offset) * 360 / this.count) * DEG;
      _p.set(this.center.x + Math.sin(yaw) * r, this.y - 0.6 + 0.6 * rise, this.center.z + Math.cos(yaw) * r);
      _e.set(-tilt, yaw, 0);
      _q.setFromEuler(_e);
      _s.setScalar(0.3 + 0.7 * rise);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(idx, _m);
      this.mesh.setColorAt(idx, _c);
      idx++;
    }
    for (let i = idx; i < MAX; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
