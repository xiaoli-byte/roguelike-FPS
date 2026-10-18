/**
 * 4-2 领主 · 大鹗（docs/level-design/chuanzang-v1.md 3.5）的程序化白模和演示动作。
 * 西山经·钟山：钦䲹化为大鹗，「其状如雕而黑文白首，赤喙而虎爪」。体长约 5 m，翼展约 16 m；紫红发光处是弱点（胸口、翼根）。
 * 演示循环：汇口上空盘旋 → 俯冲落到铁索桥中间、抓着铁链摇桥 → 再盘旋 → 回鹗巢 → 停到江嘴碉楼顶 → 再来。
 * 停在桥上时铁链带电，它会被电晕、翻滚着掉向河面，几秒后再飞起来；附近的烽火点着时，它在烟里乱飞。
 * 没有 AI 和战斗，只为看尺寸、轮廓、落脚点和「环境帮你打它」的空间关系。
 */
import * as THREE from 'three';
import { GeoBuilder, mat4 } from '../plateau/geo';
import { LORD } from './spec';
import type { GorgeTerrain } from './terrain';

const BLACK = '#26221f', BROWN = '#4a3b2e', WHITE = '#f1ece2', BEAK = '#c23a22', TIGER = '#c9782e', GLOW = '#ffc6f4';

function part(build: (b: GeoBuilder) => void, name: string): THREE.Group {
  const b = new GeoBuilder();
  build(b);
  return b.build(name);
}

function ellipsoid(b: GeoBuilder, key: 'plain' | 'glow', color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0): void {
  b.add(key, new THREE.SphereGeometry(1, 14, 10), color, mat4(x, y, z, ry, rx, 0, sx, sy, sz));
}

/** 一侧翅膀：上臂、前臂、手三节，每节挂一排黑底白纹的飞羽；返回三节的关节组（翅膀扇动时转它们） */
function wing(side: number): { root: THREE.Group; joints: THREE.Group[] } {
  const root = new THREE.Group();
  const lens = [2.4, 2.6, 2.8];
  const joints: THREE.Group[] = [];
  let parent: THREE.Object3D = root;
  lens.forEach((L, k) => {
    const j = new THREE.Group();
    if (k > 0) j.position.x = side * lens[k - 1];
    parent.add(j);
    j.add(part(b => {
      b.add('plain', new THREE.CylinderGeometry(0.22 - k * 0.05, 0.3 - k * 0.05, L, 7).rotateZ(Math.PI / 2), BROWN, mat4(side * L / 2, 0, 0));
      const n = 6;
      for (let f = 0; f < n; f++) {
        const fx = side * (L * (f + 0.5)) / n, len = 1.6 + k * 0.5 + (k === 2 ? f * 0.25 : 0);
        b.box('plain', L / n + 0.15, 0.06, len, f % 2 ? BLACK : '#3a332c', fx, -0.05, -len / 2 + 0.3, side * (k === 2 ? f * 0.05 : 0));
        b.box('plain', 0.12, 0.07, len * 0.7, WHITE, fx + side * 0.15, -0.02, -len / 2 + 0.1);
      }
      if (k === 0) ellipsoid(b, 'glow', GLOW, side * 0.4, 0.05, 0.1, 0.35, 0.22, 0.35);
    }, `dae-wing-${k}`));
    joints.push(j);
    parent = j;
  });
  return { root, joints };
}

export interface Dae {
  group: THREE.Group;
  /** 当前在做什么（HUD 显示） */
  state: string;
  update(t: number, dt: number, env: { bridgeCharge: number; smoke: THREE.Vector3[]; onBridge?: (perched: boolean) => void }): void;
  /** 平面图上的位置 */
  readonly pos: THREE.Vector3;
}

interface Leg { name: string; dur: number; kind: 'circle' | 'fly' | 'perch' | 'stun'; to?: THREE.Vector3; perch?: string }

export function buildDae(terrain: GorgeTerrain): Dae {
  const group = new THREE.Group();
  group.name = 'lord-dae';
  const bird = new THREE.Group();
  group.add(bird);
  const S = 1.0;
  // 身体：胸背黑褐带横纹，胸口雷光（弱点）
  bird.add(part(b => {
    ellipsoid(b, 'plain', BROWN, 0, 0, 0, 0.95, 0.85, 2.2);
    for (let k = 0; k < 5; k++) b.box('plain', 1.7, 0.08, 0.18, BLACK, 0, 0.72 - Math.abs(k - 2) * 0.03, -1.2 + k * 0.6);
    ellipsoid(b, 'glow', GLOW, 0, -0.35, 1.1, 0.42, 0.42, 0.3);
    // 尾扇
    for (let f = -3; f <= 3; f++) b.box('plain', 0.34, 0.06, 2.0, f % 2 ? BLACK : WHITE, f * 0.28, 0.05, -2.9, f * 0.12);
  }, 'dae-body'));
  // 头：白首、赤色钩喙、紫红眼
  const head = new THREE.Group();
  head.position.set(0, 0.55, 2.2);
  head.add(part(b => {
    ellipsoid(b, 'plain', WHITE, 0, 0, 0, 0.62, 0.6, 0.78);
    ellipsoid(b, 'plain', WHITE, 0, -0.15, -0.55, 0.7, 0.6, 0.5);
    b.add('plain', new THREE.ConeGeometry(0.22, 0.9, 8).rotateX(Math.PI / 2), BEAK, mat4(0, -0.05, 0.95));
    b.add('plain', new THREE.ConeGeometry(0.1, 0.4, 6).rotateX(Math.PI * 0.85), BEAK, mat4(0, -0.25, 1.32));
    for (const s of [-1, 1]) ellipsoid(b, 'glow', GLOW, s * 0.4, 0.12, 0.42, 0.11, 0.11, 0.11);
  }, 'dae-head'));
  bird.add(head);
  // 虎腿虎爪：橙黄底黑横纹，三趾 + 后趾，爪尖黑
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.5, -0.6, 0.3);
    leg.add(part(b => {
      b.add('plain', new THREE.CylinderGeometry(0.2, 0.26, 1.4, 8), TIGER, mat4(0, -0.6, 0));
      for (let k = 0; k < 4; k++) b.box('plain', 0.46, 0.08, 0.46, BLACK, 0, -0.15 - k * 0.3, 0, k * 0.5);
      for (let c = 0; c < 4; c++) {
        const a = c === 3 ? Math.PI : (c - 1) * 0.5;
        b.add('plain', new THREE.CylinderGeometry(0.06, 0.1, 0.7, 6).rotateX(Math.PI / 2), TIGER, mat4(Math.sin(a) * 0.3, -1.3, Math.cos(a) * 0.3, a));
        b.add('plain', new THREE.ConeGeometry(0.06, 0.3, 6).rotateX(Math.PI / 2), BLACK, mat4(Math.sin(a) * 0.62, -1.35, Math.cos(a) * 0.62, a));
      }
    }, 'dae-leg'));
    bird.add(leg);
    legs.push(leg);
  }
  const wings = [wing(-1), wing(1)];
  wings[0].root.position.set(-0.8, 0.35, 0.4);
  wings[1].root.position.set(0.8, 0.35, 0.4);
  bird.add(wings[0].root, wings[1].root);
  bird.scale.setScalar(S);
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });

  // 地上的影子（俯冲预警）
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 3;
  group.add(shadow);

  // 落脚点（碉楼顶按地形算）
  const perch = (id: string): THREE.Vector3 => {
    const p = LORD.perches.find(q => q.id === id)!;
    const v = new THREE.Vector3(...p.at);
    if (id === 'tower') v.y = terrain.footprintMin(v.x, v.z, 3.2, 3.2, 0) - 0.3 + 25.4;
    return v.add(new THREE.Vector3(0, 1.9, 0));
  };
  const C = LORD.circle;
  const plan: Leg[] = [
    { name: '盘旋', dur: 14, kind: 'circle' },
    { name: '俯冲落桥', dur: 4.5, kind: 'fly', to: perch('bridge'), perch: 'bridge' },
    { name: '抓着铁链摇桥', dur: 7, kind: 'perch', perch: 'bridge' },
    { name: '盘旋', dur: 10, kind: 'circle' },
    { name: '回巢', dur: 4.5, kind: 'fly', to: perch('nest'), perch: 'nest' },
    { name: '在巢里', dur: 8, kind: 'perch', perch: 'nest' },
    { name: '飞上碉楼', dur: 4.5, kind: 'fly', to: perch('tower'), perch: 'tower' },
    { name: '停在碉楼顶俯瞰', dur: 6, kind: 'perch', perch: 'tower' },
  ];
  const perchFace: Record<string, THREE.Vector3> = Object.fromEntries(LORD.perches.map(p => [p.id, new THREE.Vector3(p.face[0], 0, p.face[1])]));
  let leg = 0, legT = 0, from = new THREE.Vector3(), angle = 0;
  const pos = new THREE.Vector3(C.x + C.r, C.y, C.z);
  const vel = new THREE.Vector3();
  let stunT = 0;
  const circlePos = (a: number, t: number, wobble: number, out: THREE.Vector3): THREE.Vector3 =>
    out.set(C.x + Math.cos(a) * (C.r + wobble * 18 * Math.sin(t * 2.3)), C.y + 6 * Math.sin(a * 2) + wobble * 10 * Math.sin(t * 3.1), C.z + Math.sin(a) * (C.r + wobble * 18 * Math.cos(t * 1.7)));
  const tmp = new THREE.Vector3(), prev = new THREE.Vector3();
  const dae: Dae = {
    group, state: plan[0].name, pos,
    update(t, dt, env) {
      prev.copy(pos);
      // 烟：离点着的烽火 40 m 内就在烟里乱飞
      const inSmoke = env.smoke.some(s => s.distanceTo(pos) < 45) ? 1 : 0;
      let flap = 0.25, perched = false;
      if (stunT > 0) {
        // 电晕：翻滚着往下掉，掉到离水面 6 m 再挣扎着飞起来
        stunT -= dt;
        vel.y = Math.max(vel.y - 18 * dt, -16);
        pos.addScaledVector(vel, dt);
        pos.y = Math.max(pos.y, terrain.heightAt(pos.x, pos.z) + 6);
        bird.rotation.z += dt * 5;
        flap = 0.05;
        this.state = '被电晕，往河面掉';
        if (stunT <= 0) { leg = 3; legT = 0; from.copy(pos); bird.rotation.z = 0; }
      } else {
        const L = plan[leg];
        legT += dt;
        this.state = inSmoke && L.kind !== 'perch' ? `${L.name}（在烟里看不见人，乱飞）` : L.name;
        if (L.kind === 'circle') {
          angle += dt * 0.32;
          const target = circlePos(angle, t, inSmoke, tmp);
          pos.lerp(target, Math.min(1, dt * 1.5));
          flap = 0.15 + 0.1 * Math.sin(t * 0.7);
        } else if (L.kind === 'fly' && L.to) {
          const k = Math.min(1, legT / L.dur), e = k * k * (3 - 2 * k);
          // 先拔高再俯冲：弧线
          pos.lerpVectors(from, L.to, e);
          pos.y += Math.sin(k * Math.PI) * 14;
          flap = k > 0.75 ? 1 : 0.35;
        } else if (L.kind === 'perch' && L.perch) {
          pos.copy(perch(L.perch));
          perched = true;
          flap = L.perch === 'bridge' ? 0.8 + 0.2 * Math.sin(t * 5) : 0;
          if (L.perch === 'bridge' && env.bridgeCharge > 0.4) {
            stunT = 3; vel.set(0, 2, 0);
            env.onBridge?.(false);
          }
        }
        if (legT >= L.dur) {
          legT = 0; from.copy(pos);
          leg = (leg + 1) % plan.length;
          if (plan[leg].kind === 'circle') angle = Math.atan2(pos.z - C.z, pos.x - C.x);
        }
        env.onBridge?.(perched && plan[leg].perch === 'bridge');
      }
      group.position.set(0, 0, 0);
      bird.position.copy(pos);
      // 朝向：飞行时朝速度方向，停着时朝落脚点的「正面」
      const L = plan[leg];
      if (perched && L.perch) {
        const f = perchFace[L.perch];
        bird.rotation.y = Math.atan2(f.x - pos.x, f.z - pos.z);
        bird.rotation.x = 0;
      } else if (stunT <= 0) {
        const dx = pos.x - prev.x, dz = pos.z - prev.z, dy = pos.y - prev.y;
        if (Math.hypot(dx, dz) > 1e-3) bird.rotation.y = Math.atan2(dx, dz);
        bird.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz) + 1e-3) * 0.6;
        bird.rotation.z = L.kind === 'circle' ? -0.35 : 0;
      }
      // 扇翅：flap 0 = 收拢，1 = 大力扇
      const folded = perched && flap < 0.1;
      wings.forEach((w, i) => {
        const s = i ? 1 : -1;
        const beat = Math.sin(t * (3 + flap * 4)) * (0.15 + flap * 0.65);
        w.joints[0].rotation.z = folded ? s * -1.2 : s * beat;
        w.joints[1].rotation.z = folded ? s * 2.4 : s * beat * 0.5;
        w.joints[2].rotation.z = folded ? s * 0.4 : s * beat * 0.3;
        w.root.rotation.y = folded ? -s * 0.5 : 0;
      });
      for (const lg of legs) lg.rotation.x = perched ? 0 : -1.1;
      head.rotation.y = perched ? Math.sin(t * 0.8) * 0.6 : 0;
      // 影子：投在正下方的地面上，越低越黑越小
      const g = terrain.heightAt(pos.x, pos.z), hgt = pos.y - g;
      shadow.position.set(pos.x, g + 0.15, pos.z);
      shadow.scale.setScalar(Math.max(2.5, 7 - hgt * 0.05));
      (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.45 - hgt * 0.004);
    },
  };
  return dae;
}
