/**
 * 机关的地面预警（Unity Telegraph.Circle / Telegraph.Lane 的网页版）：圆走 ctx.fx.groundWarning；长条是一张贴地的半透明条带，
 * 从一头往另一头填满（填满的那一刻兑现），到时自己消失。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';

/** 第三章（火狱）的危险色是品红，其余正红（Unity TelegraphPalette.Danger） */
export const DANGER_INFERNO = 0xff2bd6, DANGER = 0xff1c24, THUNDER = 0xff4fd8;

interface Lane { mesh: THREE.Mesh; fill: THREE.Mesh; t: number; duration: number }

export class Telegraphs {
  readonly group = new THREE.Group();
  private readonly lanes: Lane[] = [];
  private readonly geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);

  constructor(private readonly ctx: GameContext, parent: THREE.Object3D) {
    this.group.name = 'mechanism-telegraphs';
    parent.add(this.group);
  }

  circle(center: THREE.Vector3, radius: number, duration: number, color: number): () => void {
    return this.ctx.fx.groundWarning(center, radius, duration, color);
  }

  /** a → b 的长条（宽 width），duration 秒填满 */
  lane(a: THREE.Vector3, b: THREE.Vector3, width: number, duration: number, color: number): void {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.05) return;
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const make = (opacity: number): THREE.Mesh => {
      const m = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false }));
      m.position.set(a.x, Math.max(a.y, b.y) + 0.06, a.z);
      m.rotation.y = yaw;
      m.scale.set(width, 1, len);
      m.renderOrder = 3;
      this.group.add(m);
      return m;
    };
    const mesh = make(0.22);
    const fill = make(0.42);
    fill.scale.z = 0.001;
    this.lanes.push({ mesh, fill, t: 0, duration: Math.max(0.05, duration) });
  }

  update(dt: number): void {
    for (let i = this.lanes.length - 1; i >= 0; i--) {
      const l = this.lanes[i];
      l.t += dt;
      const k = Math.min(1, l.t / l.duration);
      l.fill.scale.z = Math.max(0.001, l.mesh.scale.z * k);
      if (l.t >= l.duration) {
        for (const m of [l.mesh, l.fill]) {
          m.removeFromParent();
          (m.material as THREE.Material).dispose();
        }
        this.lanes.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const l of this.lanes) for (const m of [l.mesh, l.fill]) (m.material as THREE.Material).dispose();
    this.lanes.length = 0;
    this.geometry.dispose();
    this.group.removeFromParent();
  }
}
