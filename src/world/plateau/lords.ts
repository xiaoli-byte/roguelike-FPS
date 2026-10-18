/**
 * 4-1 的领主（spec.LORDS）程序化白模：风神飞廉守冰川口、夔守经幡山头（只在雷暴时现身，平时只剩一面残破雷鼓；现身后演示蹦跳和拄拳两种步态）、
 * 化蛇守圣湖海子（从湖里游出来，身体一拱一拱地露出水面）。只为看尺寸、轮廓和位置；没有 AI 和战斗。
 */
import * as THREE from 'three';
import { GeoBuilder, mat4 } from './geo';
import { LORDS } from './spec';
import type { Terrain } from './terrain';

const GLOW = '#ffc6f4';
const BONE = '#ddd3bf';
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function sphere(b: GeoBuilder, key: 'plain' | 'glow', color: THREE.ColorRepresentation, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0): void {
  b.add(key, new THREE.SphereGeometry(1, 14, 10), color, mat4(x, y, z, ry, rx, rz, sx, sy, sz));
}

function group(name: string, build: (b: GeoBuilder) => void): THREE.Group {
  const b = new GeoBuilder();
  build(b);
  return b.build(name);
}

const ribbonMat = new THREE.MeshBasicMaterial({ color: '#e8e2ff', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });

/** 飞廉：鹿身豹斑、雀头、鹿角间风雷珠、蛇尾羽扇，身边绕着雕塑式的风带（头高约 4 m） */
function feilian(): { root: THREE.Group; update(t: number): void } {
  // root 由 buildLords 摆到地面上；待机起伏只动 bob，不能改 root 的高度
  const root = new THREE.Group(), bob = new THREE.Group(), head = new THREE.Group(), tail = new THREE.Group(), ribbons = new THREE.Group();
  root.add(bob);
  const tawny = '#c9a066', spot = '#4a3220';
  bob.add(group('feilian-body', b => {
    sphere(b, 'plain', tawny, 0, 2.3, 0, 0.95, 0.8, 1.75);
    sphere(b, 'plain', '#efe3c8', 0, 2.05, 0.3, 0.7, 0.5, 1.2);
    for (let k = 0; k < 22; k++) {
      const a = k * 2.4, zz = -1.3 + (k % 8) * 0.36;
      sphere(b, 'plain', spot, Math.cos(a) * 0.9, 2.45 + Math.sin(a) * 0.45, zz, 0.12, 0.1, 0.14);
    }
    for (const [x, z] of [[0.45, 1.25], [-0.45, 1.25], [0.45, -1.25], [-0.45, -1.25]]) {
      b.cyl('plain', 0.13, 0.1, 1.9, tawny, x, 0.15, z, 8);
      b.cyl('plain', 0.12, 0.14, 0.2, '#2a211b', x, 0, z, 8);
    }
    b.rod('plain', v(0, 2.7, 1.4), v(0, 3.5, 2.0), 0.32, tawny, 8);
  }));
  head.position.set(0, 3.7, 2.15);
  head.add(group('feilian-head', b => {
    sphere(b, 'plain', '#8a4a32', 0, 0, 0, 0.55, 0.52, 0.55);
    sphere(b, 'plain', '#efe3c8', 0, -0.05, 0.3, 0.4, 0.38, 0.28);
    b.cyl('plain', 0, 0.16, 0.42, '#e0a43a', 0, -0.12, 0.55, 8, undefined, 0, Math.PI / 2);
    for (const s of [1, -1]) {
      sphere(b, 'glow', GLOW, s * 0.22, 0.08, 0.45, 0.07, 0.07, 0.05);
      // 鹿角：主干 + 两个分叉
      b.rod('plain', v(s * 0.25, 0.4, -0.1), v(s * 0.75, 1.3, -0.35), 0.07, '#8f7356', 5);
      b.rod('plain', v(s * 0.75, 1.3, -0.35), v(s * 0.85, 1.9, -0.2), 0.05, '#8f7356', 5);
      b.rod('plain', v(s * 0.55, 0.95, -0.25), v(s * 1.05, 1.15, 0.15), 0.045, '#8f7356', 5);
      b.rod('plain', v(s * 0.78, 1.5, -0.3), v(s * 1.15, 1.75, -0.6), 0.04, '#8f7356', 5);
    }
    sphere(b, 'glow', GLOW, 0, 1.25, -0.3, 0.32, 0.32, 0.32);
  }));
  bob.add(head);
  tail.position.set(0, 2.4, -1.7);
  tail.add(group('feilian-tail', b => {
    const pts = [v(0, 0, 0), v(0.3, -0.4, -0.9), v(-0.2, -0.6, -1.9), v(0.25, -0.2, -2.9), v(0, 0.5, -3.6)];
    for (let k = 0; k < pts.length - 1; k++) b.rod('plain', pts[k], pts[k + 1], 0.2 - k * 0.035, '#4e5a4a', 6);
    for (let k = 0; k < 6; k++) {
      const a = -0.9 + k * 0.36;
      b.box('plain', 0.18, 1.2, 0.06, k % 2 ? '#b8452e' : '#e2c9a2', Math.sin(a) * 0.25, 0.5, -3.6, 0, undefined, 0, a);
    }
  }));
  bob.add(tail);
  // 风带：三圈雕塑式的风，绕着身体转
  for (let k = 0; k < 3; k++) {
    const geo = new THREE.TorusGeometry(1.5 + k * 0.5, 0.12, 4, 40, 4.2);
    geo.rotateX(Math.PI / 2);
    geo.scale(1, 0.4, 1.4);
    const m = new THREE.Mesh(geo, ribbonMat);
    m.position.y = 0.6 + k * 1.1;
    ribbons.add(m);
  }
  bob.add(ribbons);
  return {
    root,
    update: (t) => {
      bob.position.y = Math.sin(t * 1.2) * 0.05;
      head.rotation.y = Math.sin(t * 0.5) * 0.4;
      head.rotation.x = Math.sin(t * 0.8) * 0.08;
      tail.rotation.y = Math.sin(t * 1.4) * 0.35;
      ribbons.children.forEach((m, k) => { m.rotation.y = t * (1.2 + k * 0.5) * (k % 2 ? -1 : 1); });
    },
  };
}

// ───────────────────────────── 夔：一足的两种步态 ─────────────────────────────
//
// 设计见 docs/art/enemy-roster-v2.md「夔 · 移动」。夔不走路，只有两种步态：
//   蹦：蓄力下蹲 → 腾空 → 落地。脚只在蓄力和落地时着地，那两段不做水平位移；位移和转身全在空中，所以跳多远、往哪转都不会滑步。
//   拄拳：双拳和一足三点支撑，像拄双拐：拳先往前撑住，身体和腿从两拳之间荡过去，脚落地后拳再往前伸。三个支点轮流着地，也不滑步。
// 白模里四肢是两节 IK（大腿 / 小腿、上臂 / 前臂），按落点实时解算；Unity 版按同样的程序化步态烘成 Generic 动画片段。

type V3 = THREE.Vector3;
const Y_UP = new THREE.Vector3(0, 1, 0);
const ikU = new THREE.Vector3(), ikB = new THREE.Vector3();

/** 两节肢体 IK：a 根、t 目标、l1 / l2 两节长度、pole 关节弯向 → 写入关节点和实际末端（够不着时伸直指向目标） */
function ik2(a: V3, t: V3, l1: number, l2: number, pole: V3, joint: V3, end: V3): void {
  ikU.subVectors(t, a);
  const raw = ikU.length() || 1;
  ikU.divideScalar(raw);
  const len = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, raw));
  end.copy(a).addScaledVector(ikU, len);
  const x = (l1 * l1 - l2 * l2 + len * len) / (2 * len), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  ikB.copy(pole).addScaledVector(ikU, -pole.dot(ikU));
  if (ikB.lengthSq() < 1e-6) ikB.set(0, 1, 0).addScaledVector(ikU, -ikU.y);
  joint.copy(a).addScaledVector(ikU, x).addScaledVector(ikB.normalize(), h);
}

/** 一节肢体：底在 a、顶在 b 的圆台（单位高度的几何，每帧按两点摆放、拉长） */
function limb(parent: THREE.Object3D, rA: number, rB: number, color: THREE.ColorRepresentation): (a: V3, b: V3) => void {
  const g = group('kui-limb', b => {
    const geo = new THREE.CylinderGeometry(rB, rA, 1, 10, 1);
    geo.translate(0, 0.5, 0);
    b.add('plain', geo, color);
  });
  parent.add(g);
  const d = new THREE.Vector3();
  return (a, b) => {
    d.subVectors(b, a);
    const len = d.length() || 1e-3;
    g.position.copy(a);
    g.quaternion.setFromUnitVectors(Y_UP, d.divideScalar(len));
    g.scale.set(1, len, 1);
  };
}

const lerpAngle = (a: number, b: number, x: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * x;
const ease = (x: number): number => 0.6 * x + 0.4 * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x))));
const smooth01 = (x: number): number => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

/** 夔的场地：ground 取根坐标系里的地面高度；path(s) 是绕擂台的弧线，返回 s 处的位置和 s 增大方向的切线（都在根坐标系里） */
export interface KuiEnv {
  ground(x: number, z: number): number;
  path(s: number, pos: V3, fwd: V3): void;
}

// 尺寸（米）：髋高站立 2.9 / 拄拳 2.3；腿两节各 1.6 + 蹄 0.45；长臂两节各 2.3（指节着地时够得着地）
const LEG = 1.6, ARM = 2.3, HOOF = 0.45, FIST = 0.4;
const STAND = 2.9, KNUCKLE = 2.3;
const STRIDE = 3.2, CYCLE = 1.3;
const SHOULDER = new THREE.Vector3(1.75, 1.9, 0.2);

type Act = { kind: 'walk'; cycles: number } | { kind: 'hop'; dist: number; big?: boolean; turn?: boolean };
/** 演示顺序：拄拳绕场 7 步 → 小跳 ×3 → 大跳（落地冲击波）→ 原地转身跳，然后反方向再来一遍 */
const PLAN: Act[] = [
  { kind: 'walk', cycles: 7 },
  { kind: 'hop', dist: 3.5 }, { kind: 'hop', dist: 3.5 }, { kind: 'hop', dist: 3.5 },
  { kind: 'hop', dist: 9, big: true },
  { kind: 'hop', dist: 0, turn: true },
];
const HOP = {
  small: { tc: 0.3, ta: 0.55, tl: 0.25, apex: 1.4, crouch: 0.8, absorb: 0.6 },
  big: { tc: 0.75, ta: 1.05, tl: 0.55, apex: 4.2, crouch: 1.3, absorb: 1.2 },
  turn: { tc: 0.3, ta: 0.6, tl: 0.25, apex: 1.6, crouch: 0.8, absorb: 0.5 },
};
const hopKind = (a: Act & { kind: 'hop' }): keyof typeof HOP => a.big ? 'big' : a.turn ? 'turn' : 'small';
const actTime = (a: Act): number => {
  if (a.kind === 'walk') return a.cycles * CYCLE;
  const h = HOP[hopKind(a)];
  return h.tc + h.ta + h.tl;
};

/** 夔：一足苍牛，胸前肋骨撑着鼓面，长臂拳头指节着地；雷暴时现身（约 6 m） */
function kui(): { root: THREE.Group; setEnv(env: KuiEnv): void; reset(): void; update(t: number, dt: number, moving: boolean): void } {
  const root = new THREE.Group(), body = new THREE.Group();
  const hide = '#5b6a8a', hoofColor = '#2a2420';
  root.add(body);
  // 躯干（髋关节为原点）
  body.add(group('kui-body', b => {
    sphere(b, 'plain', hide, 0, 0, 0, 0.75, 0.75, 0.75);
    sphere(b, 'plain', hide, 0, 1.3, -0.2, 2.0, 1.9, 1.6, 0, 0.25);
    // 背上的雷云
    for (let k = 0; k < 7; k++) sphere(b, 'plain', k % 2 ? '#e3e1ea' : '#a7aec4', Math.cos(k * 0.9) * 1.2, 2.6 + (k % 3) * 0.3, -0.9 + Math.sin(k * 1.3) * 0.5, 0.75, 0.55, 0.65);
    // 胸前肋骨 + 鼓面 + 雷心（弱点）
    for (let k = 0; k < 5; k++) {
      b.add('plain', new THREE.TorusGeometry(1.25 - Math.abs(k - 2) * 0.12, 0.08, 5, 18, Math.PI), BONE, mat4(0, 0.3 + k * 0.42, 1.0, 0, 0, Math.PI / 2 + 0.2, 1, 1, 0.45));
    }
    b.cyl('plain', 1.15, 1.15, 0.12, '#e8dcc4', 0, 1.15, 1.25, 24, undefined, 0, Math.PI / 2);
    b.add('plain', new THREE.TorusGeometry(0.6, 0.07, 5, 24, 5.2), '#a8352b', mat4(0, 1.15, 1.33, 0, 0, 0));
    sphere(b, 'glow', GLOW, 0.25, 1.0, 1.32, 0.22, 0.22, 0.1);
    // 头：无角苍牛
    sphere(b, 'plain', hide, 0, 2.9, 1.5, 0.85, 0.75, 1.0);
    sphere(b, 'plain', '#2f2a2a', 0, 2.65, 2.3, 0.5, 0.38, 0.32);
    for (const s of [1, -1]) {
      sphere(b, 'glow', GLOW, s * 0.42, 3.15, 2.15, 0.13, 0.1, 0.08);
      sphere(b, 'plain', hide, s * 0.85, 3.25, 1.2, 0.3, 0.12, 0.2);
      sphere(b, 'plain', hide, s * SHOULDER.x, SHOULDER.y, SHOULDER.z, 0.6, 0.6, 0.6);
    }
  }));
  // 四肢：每帧按 IK 摆放（根坐标系）
  const thigh = limb(root, 0.6, 0.5, hide), shin = limb(root, 0.5, 0.42, hide);
  const knee = group('kui-knee', b => sphere(b, 'plain', hide, 0, 0, 0, 0.5, 0.5, 0.5));
  const hoof = group('kui-hoof', b => b.cyl('plain', 0.95, 1.1, HOOF, hoofColor, 0, 0, 0, 12));
  root.add(knee, hoof);
  const arms = [1, -1].map(side => {
    const upper = limb(root, 0.42, 0.36, hide), fore = limb(root, 0.36, 0.34, hide);
    const elbow = group('kui-elbow', b => sphere(b, 'plain', hide, 0, 0, 0, 0.36, 0.36, 0.36));
    const fist = group('kui-fist', b => {
      sphere(b, 'plain', hoofColor, 0, 0, 0, 0.55, 0.5, 0.55);
      for (let k = 0; k < 3; k++) sphere(b, 'plain', '#3a322c', (k - 1) * 0.28, 0.32, 0.2, 0.16, 0.14, 0.2);
    });
    root.add(elbow, fist);
    return { side, upper, fore, elbow, fist, cur: new THREE.Vector3(side * 2, 1, 1) };
  });
  // 落地冲击波：一大一小两个环
  const ringMat = (o: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: '#ff7ae0', transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const rings = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), ringMat(0));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    root.add(m);
    return { m, age: 9, size: 1 };
  });
  const shock = (at: V3, size: number): void => {
    const r = rings[0].age < rings[1].age ? rings[1] : rings[0];
    r.m.position.set(at.x, at.y + 0.25, at.z);
    r.age = 0; r.size = size; r.m.visible = true;
  };

  let env: KuiEnv | null = null;
  // 状态：动作序号、动作内时间、动作开始时的弧长、方向；落地冲击波每次跳只放一次
  let act = 0, actT = 0, s0 = 0, dir = 1, landed = false;
  let pitch = 0.1, hipH = STAND, heading = 0;
  const P = new THREE.Vector3(), F = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const footCur = new THREE.Vector3(), footTgt = new THREE.Vector3();
  const fistTgt = [new THREE.Vector3(), new THREE.Vector3()];
  const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3(), hand = new THREE.Vector3();
  const ankle = new THREE.Vector3(), kneeP = new THREE.Vector3(), ankleEnd = new THREE.Vector3(), pole = new THREE.Vector3();

  /** 弧长 s 处：位置写入 out（贴地），返回朝向（按当前方向 d） */
  const at = (s: number, d: number, out: V3): number => {
    env!.path(s, out, F);
    out.y = env!.ground(out.x, out.z);
    return Math.atan2(F.x * d, F.z * d);
  };
  const ground = (v: V3): V3 => { v.y = env!.ground(v.x, v.z); return v; };
  /** 身体坐标 (x, y, z) → 根坐标系 */
  const bodyPoint = (x: number, y: number, z: number, out: V3): V3 => out.set(x, y, z).applyMatrix4(body.matrix);
  const fwdOf = (h: number, out: V3): V3 => out.set(Math.sin(h), 0, Math.cos(h));
  /** 拳头的地面落点：弧长 s 处、左右偏 side */
  const fistPlant = (s: number, side: number, out: V3): V3 => {
    const h = at(s, dir, out);
    out.x += Math.cos(h) * side * 1.9; out.z -= Math.sin(h) * side * 1.9;
    return ground(out).setY(out.y + FIST);
  };

  /** 身体悬空的手（不拄地）：hang 垂在身前、windup 举到身后上方、overhead 举过头顶、sides 张开平衡、pound 交替捶胸 */
  const freeArm = (pose: 'hang' | 'windup' | 'overhead' | 'sides' | 'pound', side: number, t: number, out: V3): void => {
    switch (pose) {
      case 'hang': bodyPoint(side * 2.0, -0.2, 1.2, out); break;
      case 'windup': bodyPoint(side * 2.1, 2.6, -1.2, out); break;
      case 'overhead': bodyPoint(side * 1.3, 4.6, 0.7, out); break;
      case 'sides': bodyPoint(side * 3.4, 1.4, 0.4, out); break;
      case 'pound': {
        const hit = Math.max(0, Math.sin(t * 6.3 + (side > 0 ? 0 : Math.PI)));
        bodyPoint(side * (1.6 - 1.1 * hit), 1.5 - 0.3 * hit, 0.9 + 1.1 * hit, out);
        break;
      }
    }
  };

  function pose(t: number, dt: number, moving: boolean): void {
    let pitchT = 0.1, hipT = STAND, foot: 'plant' | 'set' = 'plant';
    let arm: Parameters<typeof freeArm>[0] | 'plant' = 'pound';
    let airY = 0;
    if (!moving) {
      heading = at(s0, dir, P);
      footTgt.copy(P).addScaledVector(fwdOf(heading, tmp), 0.25);
      ground(footTgt);
    } else {
      const a = PLAN[act];
      if (a.kind === 'walk') {
        const k = Math.floor(actT / CYCLE), phi = actT / CYCLE - k;
        const sStart = s0 + dir * STRIDE * k;
        const prog = phi < 0.5 ? 0.3 * ease(phi / 0.5) : 0.3 + 0.7 * ease((phi - 0.5) / 0.5);
        heading = at(sStart + dir * STRIDE * prog, dir, P);
        pitchT = 0.55 + 0.06 * Math.sin(phi * Math.PI * 2);
        hipT = KNUCKLE + (phi > 0.5 ? 0.25 * Math.sin(Math.PI * (phi - 0.5) / 0.5) : 0);
        // 脚：前半周期踩住，后半周期从两拳之间荡到下一个落点
        const hA = at(sStart, dir, tmp);
        tmp.addScaledVector(fwdOf(hA, tmp2), 0.25);
        if (phi < 0.5) footTgt.copy(tmp);
        else {
          const x = (phi - 0.5) / 0.5;
          const hB = at(sStart + dir * STRIDE, dir, footTgt);
          footTgt.addScaledVector(fwdOf(hB, tmp2), 0.25);
          footTgt.lerpVectors(tmp, footTgt, ease(x));
          ground(footTgt).y += 0.9 * Math.sin(Math.PI * x);
        }
        // 拳：前 45% 周期抬起往前伸到新落点，之后撑住
        arm = 'plant';
        arms.forEach((A, i) => {
          const plantNew = fistPlant(sStart + dir * (0.55 * STRIDE + 1.3), A.side, fistTgt[i]);
          if (phi < 0.45) {
            const x = phi / 0.45;
            fistPlant(sStart + dir * (0.55 * STRIDE + 1.3 - STRIDE), A.side, tmp2);
            plantNew.lerpVectors(tmp2, plantNew, ease(x)).y += 1.1 * Math.sin(Math.PI * x);
          }
        });
      } else {
        const h = HOP[hopKind(a)];
        const sA = s0, sB = s0 + dir * a.dist;
        const hA = at(sA, dir, tmp), hB = a.turn ? hA + Math.PI : at(sB, dir, tmp2);
        const tA = actT, tAir = actT - h.tc, tLand = actT - h.tc - h.ta;
        if (tA < h.tc) {
          // 蓄力：下蹲、手往后举（这就是预警，大跳蹲得更深更久）
          heading = at(sA, dir, P);
          hipT = STAND - h.crouch * smooth01(tA / h.tc);
          pitchT = a.big ? 0.45 : 0.3;
          arm = a.big ? 'windup' : 'sides';
        } else if (tAir < h.ta) {
          // 腾空：水平位移和转身都在空中做，脚收起、落地前伸直
          const x = tAir / h.ta;
          if (a.turn) P.copy(tmp);
          else P.lerpVectors(tmp, tmp2, x);
          heading = lerpAngle(hA, hB, smooth01(x));
          airY = h.apex * 4 * x * (1 - x);
          hipT = STAND;
          pitchT = a.big ? (x < 0.5 ? -0.15 : 0.35) : 0.1;
          arm = a.big ? 'overhead' : 'sides';
          foot = 'set';
        } else {
          // 落地：脚踩住落点，屈膝缓冲；大跳双拳砸地
          heading = a.turn ? hB : at(sB, dir, P);
          if (a.turn) P.copy(tmp);
          const x = tLand / h.tl;
          hipT = STAND - h.absorb * Math.sin(Math.PI * Math.min(1, x));
          pitchT = a.big ? 0.5 : 0.2;
          arm = a.big && x < 0.7 ? 'plant' : 'hang';
          if (a.big && x < 0.7) arms.forEach((A, i) => {
            fistTgt[i].copy(P).addScaledVector(fwdOf(heading, tmp2), 2.3);
            fistTgt[i].x += Math.cos(heading) * A.side * 1.5; fistTgt[i].z -= Math.sin(heading) * A.side * 1.5;
            ground(fistTgt[i]).y += FIST;
          });
          if (!landed) { landed = true; shock(P, a.big ? 16 : a.turn ? 4 : 6); }
        }
        if (foot === 'plant') {
          const onB = tAir >= h.ta;
          at(onB ? sB : sA, dir, footTgt);
          footTgt.addScaledVector(fwdOf(onB ? hB : hA, tmp2), 0.2);
          ground(footTgt);
        }
      }
    }
    // 姿态平滑（动作切换时不跳变）；腾空的高度不平滑
    const k6 = 1 - Math.exp(-dt * 7);
    pitch += (pitchT - pitch) * k6;
    hipH += (hipT - hipH) * (1 - Math.exp(-dt * 10));
    body.position.set(P.x, P.y + hipH + airY, P.z);
    body.rotation.set(pitch, heading, 0, 'YXZ');
    body.updateMatrix();
    // 腾空时脚收在身下，落地前 30% 伸向落点
    if (foot === 'set') {
      const a = PLAN[act] as Act & { kind: 'hop' };
      const h = HOP[hopKind(a)], x = (actT - h.tc) / h.ta;
      bodyPoint(0, -2.0, 0.5, footTgt);
      if (x > 0.7) {
        at(a.turn ? s0 : s0 + dir * a.dist, dir, tmp);
        tmp.addScaledVector(fwdOf(heading, tmp2), 0.2);
        footTgt.lerp(tmp, smooth01((x - 0.7) / 0.3));
      }
    }
    const kf = 1 - Math.exp(-dt * 22);
    footCur.lerp(footTgt, kf);
    // 腿：髋 → 踝（蹄顶），膝盖朝前
    ankle.copy(footCur).setY(footCur.y + HOOF);
    pole.copy(fwdOf(heading, tmp)).setY(0.2);
    ik2(body.position, ankle, LEG, LEG, pole, kneeP, ankleEnd);
    thigh(body.position, kneeP); shin(kneeP, ankleEnd);
    knee.position.copy(kneeP);
    hoof.position.set(ankleEnd.x, ankleEnd.y - HOOF, ankleEnd.z);
    hoof.rotation.y = heading;
    // 手臂：肩 → 拳，手肘朝后朝外
    arms.forEach((A, i) => {
      if (arm !== 'plant') freeArm(arm, A.side, t, fistTgt[i]);
      A.cur.lerp(fistTgt[i], kf);
      bodyPoint(A.side * SHOULDER.x, SHOULDER.y, SHOULDER.z, shoulder);
      fwdOf(heading, pole).multiplyScalar(-1);
      pole.x += Math.cos(heading) * A.side * 0.8; pole.z -= Math.sin(heading) * A.side * 0.8;
      ik2(shoulder, A.cur, ARM, ARM, pole, elbow, hand);
      A.upper(shoulder, elbow); A.fore(elbow, hand);
      A.elbow.position.copy(elbow);
      A.fist.position.copy(hand);
      A.fist.quaternion.setFromUnitVectors(Y_UP, tmp.subVectors(hand, elbow).normalize());
    });
    for (const r of rings) {
      r.age += dt;
      r.m.visible = r.age < 0.8;
      if (!r.m.visible) continue;
      r.m.scale.setScalar(1 + r.size * smooth01(r.age / 0.8));
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - r.age / 0.8);
    }
  }

  return {
    root,
    setEnv: (e) => { env = e; pose(0, 1, false); footCur.copy(footTgt); arms.forEach((A, i) => A.cur.copy(fistTgt[i])); },
    reset: () => { act = 0; actT = 0; s0 = 0; dir = 1; landed = false; },
    update: (t, dt, moving) => {
      if (!env) return;
      if (moving) {
        actT += dt;
        while (actT >= actTime(PLAN[act])) {
          const a = PLAN[act];
          actT -= actTime(a);
          if (a.kind === 'walk') s0 += dir * STRIDE * a.cycles;
          else { s0 += dir * a.dist; if (a.turn) dir = -dir; }
          landed = false;
          act = (act + 1) % PLAN.length;
        }
      }
      pose(t, dt, moving);
    },
  };
}

/** 化蛇：人面豺身、鸟翼、蛇行（设计稿 DS_plateau_boss_huashe_v002）。身体分 16 节，按正弦波左右游、后段一拱一拱地出水；
 * 四条短腿外撇，翅膀（展开约 9 m）慢慢扇，张开的嘴发紫红光（弱点）。全长约 9 m */
function huashe(): { root: THREE.Group; update(t: number): void } {
  const root = new THREE.Group();
  // 全长约 9 m（15 节间距 + 头 + 尾鳍），翼展约 9 m：体型见 enemy-roster-v2.md「领主的体型与建模规格」
  const SEG = 16, GAP = 0.5;
  const slate = '#38475b', fur = '#6e5640', belly = '#e2d6bc';
  const radius = (k: number): number => k < 3 ? 0.62 + k * 0.05 : k < 7 ? 0.72 - (k - 3) * 0.02 : Math.max(0.14, 0.64 - (k - 7) * 0.06);
  const segs: THREE.Group[] = [];
  for (let k = 0; k < SEG; k++) {
    const r = radius(k);
    const seg = group(`huashe-seg${k}`, b => {
      sphere(b, 'plain', k < 7 && k % 2 ? fur : slate, 0, 0, 0, r, r * 0.82, r * 0.95);
      sphere(b, 'plain', belly, 0, -r * 0.35, 0, r * 0.8, r * 0.5, r * 0.85);
      // 脊背上的紫红雷纹鳍
      b.add('glow', new THREE.ConeGeometry(r * 0.22, r * 0.9, 4), GLOW, mat4(0, r * 0.95, 0, 0, -0.5));
      if (k === 2 || k === 6) {
        // 外撇的短腿：大腿朝外下方，小腿撑地
        for (const sd of [1, -1]) {
          b.rod('plain', v(sd * r * 0.7, -0.1, 0), v(sd * (r + 0.55), -0.35, 0.15), 0.2, fur, 6);
          b.rod('plain', v(sd * (r + 0.55), -0.35, 0.15), v(sd * (r + 0.6), -0.85, 0.35), 0.16, fur, 6);
          sphere(b, 'plain', '#2a2730', sd * (r + 0.6), -0.88, 0.45, 0.2, 0.08, 0.26);
        }
      }
      if (k === SEG - 1) {
        // 尾鳍：一把羽扇
        for (let f = 0; f < 5; f++) {
          const a = -0.7 + f * 0.35;
          b.box('plain', 0.08, 1.4, 0.32, f % 2 ? '#3f8f8a' : '#2b3f63', Math.sin(a) * 0.3, 0, -0.2, 0, undefined, -Math.PI / 2 + 0.2, a);
        }
      }
    });
    root.add(seg);
    segs.push(seg);
  }
  // 头：苍白人面面具、深色鬃毛、张开的嘴发光
  const head = group('huashe-head', b => {
    sphere(b, 'plain', '#2a2f3a', 0, 0.05, -0.2, 0.85, 0.8, 0.7);
    sphere(b, 'plain', '#e6dcc6', 0, 0.1, 0.35, 0.55, 0.6, 0.45);
    sphere(b, 'plain', '#e6dcc6', 0, -0.45, 0.45, 0.42, 0.18, 0.4, 0, 0.35);
    sphere(b, 'glow', GLOW, 0, -0.2, 0.62, 0.3, 0.2, 0.18);
    for (const sd of [1, -1]) {
      sphere(b, 'glow', GLOW, sd * 0.2, 0.25, 0.75, 0.08, 0.05, 0.04);
      b.rod('plain', v(sd * 0.3, 0.55, 0), v(sd * 0.55, 1.1, -0.45), 0.07, '#3a2f2a', 5);
      b.cyl('plain', 0, 0.05, 0.2, '#f1ebe0', sd * 0.16, -0.3, 0.7, 5, undefined, 0, Math.PI);
    }
  });
  root.add(head);
  const neck = group('huashe-neck', b => sphere(b, 'plain', slate, 0, 0, 0, 0.5, 0.95, 0.5));
  root.add(neck);
  // 一对大鸟翼：每只 7 根长羽排成扇面，挂在第 2 节肩上
  const wings: THREE.Group[] = [];
  for (const sd of [1, -1]) {
    const w = new THREE.Group();
    w.add(group('huashe-wing', b => {
      // 羽根在翼根，羽尖朝外、往后扫、略微上翘（方块以中心为原点，所以中心放在半根羽长处）
      for (let f = 0; f < 7; f++) {
        const a = 0.05 + f * 0.2, len = 3.2 + f * 0.3;
        b.box('plain', len, 0.07, 0.6, f < 3 ? '#2b3f63' : f < 5 ? '#33677a' : '#3f8f8a',
          sd * Math.cos(a) * len * 0.5, 0, -Math.sin(a) * len * 0.5 - f * 0.1, sd > 0 ? a : Math.PI - a, undefined, 0, 0.1);
      }
      b.box('glow', 2.2, 0.08, 0.06, GLOW, sd * Math.cos(0.55) * 1.1, 0.05, -Math.sin(0.55) * 1.1 - 0.3, sd > 0 ? 0.55 : Math.PI - 0.55);
    }));
    root.add(w);
    wings.push(w);
  }
  const pos = new THREE.Vector3();
  const spine = (k: number, t: number): THREE.Vector3 => {
    const amp = 0.15 + Math.min(1, k / SEG) * 0.9;
    // 前半段贴着水面，后半段一拱一拱地出水
    const hump = k > 5 ? Math.max(-0.5, Math.sin(t * 1.6 - k * 0.55)) * 0.7 : 0;
    return pos.set(Math.sin(t * 1.6 - k * 0.45) * amp, 0.55 + hump - Math.max(0, k - 10) * 0.05, -k * GAP);
  };
  return {
    root,
    update: (t) => {
      const prev = new THREE.Vector3();
      for (let k = 0; k < SEG; k++) {
        const p = spine(k, t);
        segs[k].position.copy(p);
        if (k > 0) segs[k].rotation.y = Math.atan2(prev.x - p.x, prev.z - p.z);
        prev.copy(p);
      }
      const p0 = segs[0].position;
      head.position.set(p0.x * 0.5, 1.75 + Math.sin(t * 1.1) * 0.12, 0.95);
      head.rotation.x = -0.15 + Math.sin(t * 0.9) * 0.06;
      head.rotation.y = Math.sin(t * 0.7) * 0.25;
      neck.position.set(p0.x * 0.75, 1.1, 0.45);
      neck.rotation.x = 0.7;
      const p2 = segs[2].position;
      wings.forEach((w, i) => {
        const sd = i ? -1 : 1;
        w.position.set(p2.x + sd * 0.55, p2.y + 0.5, p2.z);
        w.rotation.z = sd * (0.15 + Math.sin(t * 1.3) * 0.35);
      });
    },
  };
}

/** 夔没现身时：经幡山头上倒着的一面残破雷鼓 */
function brokenDrum(): THREE.Group {
  return group('broken-drum', b => {
    b.add('plain', new THREE.CylinderGeometry(2.1, 2.1, 1.6, 20, 1, true), '#6b5a48', mat4(0, 1.3, 0, 0.4, 0, Math.PI / 2 - 0.25));
    b.add('plain', new THREE.CylinderGeometry(2.0, 2.0, 0.08, 20), '#d9ccb2', mat4(0.85, 1.55, 0.35, 0.4, 0, Math.PI / 2 - 0.25));
    b.add('plain', new THREE.TorusGeometry(2.1, 0.12, 6, 24), '#b07a3e', mat4(-0.75, 1.1, -0.3, 0.4 + Math.PI / 2, 0, 0.25));
    for (let k = 0; k < 4; k++) b.rod('plain', v(-1 + k * 0.7, 0.05, 1.6), v(-0.6 + k * 0.6, 0.35, 2.8 + k * 0.2), 0.08, BONE, 5);
    sphere(b, 'glow', GLOW, 0.9, 1.55, 0.4, 0.12, 0.12, 0.05);
  });
}

export interface LordField {
  group: THREE.Group;
  /** 不等雷暴，让夔一直现身（检视页看步态用） */
  kuiAlways: boolean;
  update(t: number, dt: number, storm: number): void;
}

export function buildLords(terrain: Terrain): LordField {
  const group = new THREE.Group();
  group.name = 'lords';
  const fl = feilian(), kv = kui(), drum = brokenDrum(), hs = huashe();
  /** 站到 perch（默认擂台中心）上，面朝 face；水里的领主站在水面上 */
  const place = (id: string, obj: THREE.Object3D, face: [number, number]): void => {
    const L = LORDS.find(l => l.id === id)!;
    const [x, z] = L.perch ?? [L.at[0], L.at[2]];
    const y = L.water ? terrain.waterLevelAt(x, z) - 0.35 : terrain.heightAt(x, z) - 0.1;
    obj.position.set(x, y, z);
    obj.rotation.y = Math.atan2(face[0] - x, face[1] - z);
    group.add(obj);
  };
  place('feilian', fl.root, [40, -150]);
  place('kui', kv.root, [92, -74]);
  place('kui', drum, [92, -74]);
  place('huashe', hs.root, [-140, -100]);
  // 夔的场地：从残鼓（perch）出发，绕拉则走一段圆弧（半径 = 残鼓到拉则的距离，避开一圈经幡杆）
  const K = LORDS.find(l => l.id === 'kui')!;
  const { x: px, y: py, z: pz } = kv.root.position, yaw = kv.root.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
  const [qx, qz] = K.perch!, cx = K.at[0], cz = K.at[2];
  const R = Math.hypot(qx - cx, qz - cz), th0 = Math.atan2(qz - cz, qx - cx);
  kv.setEnv({
    ground: (x, z) => terrain.heightAt(px + x * c + z * sn, pz - x * sn + z * c) - py,
    path: (s, pos, fwd) => {
      const th = th0 + s / R, wx = cx + R * Math.cos(th) - px, wz = cz + R * Math.sin(th) - pz;
      pos.set(wx * c - wz * sn, 0, wx * sn + wz * c);
      const tx = -Math.sin(th), tz = Math.cos(th);
      fwd.set(tx * c - tz * sn, 0, tx * sn + tz * c);
    },
  });
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const kuiScale = kv.root.scale;
  let shown = 0;
  const field: LordField = {
    group,
    kuiAlways: false,
    update: (t, dt, storm) => {
      fl.update(t);
      hs.update(t);
      // 夔随雷暴现身：雷暴过半时从残鼓里长出来；雷暴退了缩回鼓里（缩放以残鼓为原点，走远了也会被吸回去）
      const target = field.kuiAlways ? 1 : Math.min(1, Math.max(0, (storm - 0.5) / 0.4));
      shown += Math.max(-dt * 0.8, Math.min(dt * 0.8, target - shown));
      kv.root.visible = shown > 0.01;
      drum.visible = shown < 0.99;
      kuiScale.setScalar(0.3 + 0.7 * shown);
      if (!kv.root.visible) kv.reset();
      else kv.update(t, dt, shown >= 0.999);
    },
  };
  return field;
}
