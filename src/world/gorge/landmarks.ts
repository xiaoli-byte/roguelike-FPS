/**
 * 4-2 专有的地标与机关（docs/level-design/chuanzang-v1.md 3.2、3.5）：桥楼、桥头雷桩、水磨坊、马厩、关楼、
 * 鹗巢、碉楼顶的烽火、鹗巢上方的危岩、渡口木桩、穷奇岩洞。和 4-1 共用的碉楼、民居、灵火坛等走 plateau/landmarks。
 * 会变的东西（雷桩攒电、烽火点燃、危岩落下、磨坊水轮）各给一个开关，检视页面板和动态环境演示用。
 */
import * as THREE from 'three';
import { mat4 } from '../plateau/geo';
import { C, boxC, buildPlacements, cornerHorn, cylC, flagPole, frame, ground, tibetWindow, type BuildCtx } from '../plateau/landmarks';
import type { Placement } from '../plateau/spec';
import { FLAG_LINES, GORGE_PLACEMENTS, PLACEMENTS, type GorgePlacement } from './spec';

export interface GorgeProps {
  /** 桥头雷桩：攒电 0..1（雷暴时慢慢攒满，放电清零） */
  thunderPosts: { pos: THREE.Vector3; charge: number }[];
  /** 碉楼顶烽火 */
  beacons: { pos: THREE.Vector3; lit: boolean }[];
  /** 鹗巢危岩：dropped = 木楔被打掉、石头砸进巢里 */
  looseRock: { dropped: boolean; pos: THREE.Vector3 } | null;
  nest: THREE.Vector3 | null;
}

const asPlacement = (p: GorgePlacement): Placement => ({ kind: 'boulder', x: p.x, z: p.z, face: p.face, yaw: p.yaw, scale: p.scale });

/** 桥楼：铁索桥两头的木构门楼，石台基上两层歇山顶；铁链从门洞穿过锚进后面的锚井 */
function bridgeTower(ctx: BuildCtx, p: GorgePlacement): void {
  const h = ground(ctx, asPlacement(p), 4, 3, 0.2), b = ctx.b;
  frame(ctx, h);
  b.box('stone', 8.4, 1.2, 6, C.stoneDark, 0, -0.6, 0, 0, { tile: 1.6 });
  for (const x of [-3.4, -1.6, 1.6, 3.4]) b.cyl('wood', 0.22, 0.24, 5.2, '#8e3a28', x, 0.6, 2.4, 8);
  for (const x of [-3.4, 3.4]) b.cyl('wood', 0.22, 0.24, 5.2, '#8e3a28', x, 0.6, -2.4, 8);
  b.box('whitewash', 0.6, 4.4, 4.8, C.white, -3.7, 0.6, 0);
  b.box('whitewash', 0.6, 4.4, 4.8, C.white, 3.7, 0.6, 0);
  b.box('wood', 8.2, 0.5, 5.6, '#8e3a28', 0, 5.6, 0);
  // 两层檐（简化成两层压扁的四棱台）
  for (const [y, w, d] of [[6.1, 10, 7.6], [8.0, 7, 5.2]] as const) {
    b.add('plain', new THREE.CylinderGeometry(0.6, Math.SQRT1_2 * w, 1.5, 4, 1).rotateY(Math.PI / 4).scale(1, 1, d / w), '#3c4a52', mat4(0, y + 0.75, 0));
  }
  b.box('wood', 6, 1.6, 4.2, '#a2442e', 0, 6.4, 0);
  tibetWindow(b, mat4(0, 6.5, 2.11, 0), 1.2, 0.9);
  b.box('plain', 3.4, 0.6, 0.12, '#1e1a16', 0, 4.5, 3.02);
  b.box('gold', 2.6, 0.4, 0.14, C.gold, 0, 4.6, 3.04);
  // 锚井：桥后面的石砌井口，铁链头从里面伸出来
  b.box('stone', 4, 0.8, 2.4, C.stoneDark, 0, -0.4, -4.4, 0, { tile: 1.4 });
  boxC(ctx, h, -3.7, 0, 0.35, 2.5, -1, 5, false);
  boxC(ctx, h, 3.7, 0, 0.35, 2.5, -1, 5, false);
  boxC(ctx, h, 0, 0, 4.2, 3.1, -1.2, 0, true);
  ctx.conductors?.push(new THREE.Vector3().copy(b.world(0, 9.5, 0)));
  ctx.icons.push({ name: '桥楼', x: p.x, z: p.z, kind: 'daoban' });
}

/** 桥头雷桩：铁桩顶上一圈铜环，攒电时环上发紫红光；连着一根铁链接到桥的扶手链 */
function thunderPost(ctx: BuildCtx, p: GorgePlacement, props: GorgeProps): void {
  const h = ground(ctx, asPlacement(p), 1, 1, 0.2), b = ctx.b;
  frame(ctx, h);
  b.cyl('stone', 0.9, 1.1, 0.8, C.stoneDark, 0, -0.3, 0, 8);
  b.cyl('plain', 0.16, 0.22, 3.6, '#3a3a40', 0, 0.4, 0, 8);
  for (const y of [1.6, 2.6, 3.6]) b.cyl('gold', 0.34, 0.34, 0.12, '#b98a3a', 0, y, 0, 12);
  const top = b.world(0, 4.2, 0);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), new THREE.MeshBasicMaterial({ color: '#ff6ae0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.copy(top);
  ctx.extra.add(glow);
  const post = { pos: top.clone(), charge: 0 };
  props.thunderPosts.push(post);
  ctx.anim.push({ update: (t) => {
    const c = post.charge;
    (glow.material as THREE.MeshBasicMaterial).opacity = c * (0.55 + 0.35 * Math.sin(t * 9 + top.x));
    glow.scale.setScalar(0.6 + c * (0.8 + 0.15 * Math.sin(t * 23)));
  } });
  cylC(ctx, h, 0, 0, 0.5, -0.3, 4.2);
  ctx.conductors?.push(top.clone());
  ctx.icons.push({ name: '雷桩', x: p.x, z: p.z, kind: 'stele' });
}

/** 水磨坊：石砌小屋架在河汊边，侧面一个水平水轮（藏区的卧式水磨），轮子慢慢转 */
function mill(ctx: BuildCtx, p: GorgePlacement): void {
  const s = p.scale ?? 1;
  const h = ground(ctx, asPlacement(p), 2.6 * s, 2.2 * s, 0.3), b = ctx.b;
  frame(ctx, h);
  b.box('stone', 5.2 * s, 3.2 * s, 4.4 * s, '#d8d0c2', 0, -0.4, 0, 0, { tile: 1.8 });
  b.box('plain', 5.6 * s, 0.3, 4.8 * s, C.ochre, 0, 2.8 * s, 0);
  b.box('wood', 5.8 * s, 0.25, 5 * s, '#c79a6c', 0, 3.1 * s, 0);
  tibetWindow(b, mat4(-1.0 * s, 0, 2.21 * s, 0), 0.9, 1.7, true);
  tibetWindow(b, mat4(1.3 * s, 1.2 * s, 2.21 * s, 0), 0.6, 0.6);
  b.box('wood', 1.2, 0.4, 4.5 * s, '#8a5a3a', 3.2 * s, 0.4, 1.5 * s);
  const wheel = new THREE.Group();
  const wb = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.8, 8), new THREE.MeshLambertMaterial({ color: '#6a4630' }));
  wb.add(hub);
  for (let k = 0; k < 10; k++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.08), new THREE.MeshLambertMaterial({ color: '#8a5a3a' }));
    blade.position.set(Math.cos((k / 10) * Math.PI * 2) * 0.8, 0, Math.sin((k / 10) * Math.PI * 2) * 0.8);
    blade.rotation.y = -(k / 10) * Math.PI * 2;
    wb.add(blade);
  }
  wheel.add(wb);
  wheel.position.copy(b.world(3.2 * s, -0.1, 3.4 * s));
  ctx.extra.add(wheel);
  ctx.anim.push({ update: (t) => { wb.rotation.y = t * 1.6; } });
  boxC(ctx, h, 0, 0, 2.6 * s, 2.2 * s, -0.5, 3.3 * s, true);
  ctx.icons.push({ name: '水磨坊', x: p.x, z: p.z, kind: 'house' });
}

/** 马厩：三面石墙、一面敞开的木棚，里面有草料架 */
function stable(ctx: BuildCtx, p: GorgePlacement): void {
  const h = ground(ctx, asPlacement(p), 4.5, 2.5, 0.2), b = ctx.b;
  frame(ctx, h);
  b.box('stone', 9, 2.4, 0.5, '#cfc6b8', 0, -0.3, -2.3, 0, { tile: 1.6 });
  b.box('stone', 0.5, 2.4, 4.6, '#cfc6b8', -4.3, -0.3, 0, 0, { tile: 1.6 });
  b.box('stone', 0.5, 2.4, 4.6, '#cfc6b8', 4.3, -0.3, 0, 0, { tile: 1.6 });
  for (const x of [-4.3, -1.4, 1.4, 4.3]) b.cyl('wood', 0.12, 0.14, 2.6, '#7a4a30', x, -0.2, 2.2, 6);
  b.box('wood', 9.6, 0.25, 5.4, '#b98d62', 0, 2.3, 0, 0.0, undefined, 0.08);
  b.box('plain', 7, 0.9, 0.8, '#d8c26a', 0, 0.2, -1.6);
  boxC(ctx, h, 0, -2.3, 4.5, 0.3, -0.5, 2.3, false);
  boxC(ctx, h, -4.3, 0, 0.3, 2.3, -0.5, 2.3, false);
  boxC(ctx, h, 4.3, 0, 0.3, 2.3, -0.5, 2.3, false);
  ctx.icons.push({ name: '马厩', x: p.x, z: p.z, kind: 'house' });
}

/** 关楼：古驿道山口的石砌关门，门洞上一层木楼，两侧接一段矮墙 */
function gateTower(ctx: BuildCtx, p: GorgePlacement): void {
  const h = ground(ctx, asPlacement(p), 6, 3, 0.4), b = ctx.b;
  frame(ctx, h);
  for (const x of [-3.6, 3.6]) b.box('stone', 3.2, 6, 5, '#d6cdbf', x, -0.6, 0, 0, { tile: 1.8 });
  b.box('stone', 10.4, 1.6, 5, '#d6cdbf', 0, 4.2, 0, 0, { tile: 1.8 });
  b.box('plain', 10.6, 0.3, 5.2, C.ochre, 0, 5.8, 0);
  b.box('wood', 7, 2.4, 4, '#a2442e', 0, 6.1, 0);
  tibetWindow(b, mat4(0, 6.4, 2.01, 0), 1.6, 1.0);
  b.box('wood', 8.4, 0.3, 5.4, '#c79a6c', 0, 8.5, 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cornerHorn(b, sx * 4.8, 5.8, sz * 2.2);
  for (const x of [-1, 1]) b.box('stone', 8, 2.2, 1.2, '#cfc6b8', x * 9.2, -0.4, 0, 0, { tile: 1.6 });
  boxC(ctx, h, -3.6, 0, 1.6, 2.5, -1, 5.8, false);
  boxC(ctx, h, 3.6, 0, 1.6, 2.5, -1, 5.8, false);
  boxC(ctx, h, -9.2, 0, 4, 0.6, -0.5, 1.8, true);
  boxC(ctx, h, 9.2, 0, 4, 0.6, -0.5, 1.8, true);
  ctx.icons.push({ name: '关楼', x: p.x, z: p.z, kind: 'flagGate' });
}

/** 鹗巢：江嘴绝壁上的大枝杈巢（直径约 7 m），巢里散着骨头和雷击过的焦木 */
function nest(ctx: BuildCtx, p: GorgePlacement, props: GorgeProps): void {
  const h = ground(ctx, asPlacement(p), 3, 3, 0.1), b = ctx.b;
  frame(ctx, h);
  for (let k = 0; k < 46; k++) {
    const a = (k / 46) * Math.PI * 2 + Math.sin(k * 3.7) * 0.2, r = 3.0 + Math.sin(k * 1.9) * 0.4;
    const y = 0.25 + (k % 3) * 0.35;
    const p0 = b.world(Math.cos(a) * r, y, Math.sin(a) * r), p1 = b.world(Math.cos(a + 1.1) * (r + 0.6), y + 0.2 + (k % 2) * 0.3, Math.sin(a + 1.1) * (r + 0.6));
    b.rod('wood', p0, p1, 0.09 + (k % 4) * 0.02, k % 5 ? '#6d5238' : '#2b2420', 4);
  }
  b.cyl('plain', 2.6, 3.0, 0.5, '#5a4632', 0, 0, 0, 14);
  for (let k = 0; k < 7; k++) b.box('plain', 0.12, 0.12, 0.9, '#e6dcc6', Math.cos(k) * 1.4, 0.55, Math.sin(k * 1.7) * 1.2, k);
  b.rock('plain', 2.6, '#6f6a62', 0, -2.2, -2.4, 0.8, 41);
  props.nest = b.world(0, 0.6, 0).clone();
  ctx.icons.push({ name: '鹗巢', x: p.x, z: p.z, kind: 'cave' });
}

/** 危岩：鹗巢上方的一块大石，下面两根木楔撑着；木楔被打掉后石头砸进巢里 */
function looseRock(ctx: BuildCtx, p: GorgePlacement, props: GorgeProps): void {
  const base = ctx.terrain.heightAt(p.x, p.z);
  const rockGroup = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(2.2, 1);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (1 + 0.15 * Math.sin(i * 1.3)), pos.getY(i) * 0.8, pos.getZ(i));
  geo.computeVertexNormals();
  const rock = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#7d766c', flatShading: true }));
  rock.castShadow = true;
  rockGroup.add(rock);
  const wedgeMat = new THREE.MeshLambertMaterial({ color: '#c9a27b' });
  const wedges = [-0.9, 0.9].map(x => { const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), wedgeMat); w.position.set(x, -1.9, 0.6); w.rotation.z = x * 0.25; return w; });
  rockGroup.add(...wedges);
  const top = new THREE.Vector3(p.x, base + 2.4, p.z);
  rockGroup.position.copy(top);
  ctx.extra.add(rockGroup);
  const state = { dropped: false, pos: top.clone() };
  props.looseRock = state;
  let fall = 0;
  ctx.anim.push({ update: (_t, dt) => {
    if (state.dropped) fall = Math.min(1, fall + dt * 1.4); else fall = Math.max(0, fall - dt * 0.5);
    const target = props.nest ?? top;
    rockGroup.position.set(top.x + (target.x - top.x) * fall, top.y + (target.y + 1 - top.y) * fall * fall - Math.sin(fall * Math.PI) * -1.5, top.z + (target.z - top.z) * fall);
    rock.rotation.x = fall * 2.4;
    for (const w of wedges) w.visible = fall < 0.02;
  } });
  ctx.icons.push({ name: '危岩', x: p.x, z: p.z, kind: 'boulder' });
}

/** 烽火：碉楼顶上的铁盆柴堆；点燃后一根浓黑的烟柱（大鹗进烟就看不见人） */
function beacon(ctx: BuildCtx, p: GorgePlacement, props: GorgeProps): void {
  const top = ctx.terrain.footprintMin(p.x, p.z, 3.2, 3.2, 0) - 0.3 + 24 + 0.2;
  const b = ctx.b;
  ctx.b.clearFrame();
  b.cyl('plain', 0.9, 0.55, 0.6, '#3a3a40', p.x, top + 0.6, p.z, 10);
  for (let k = 0; k < 4; k++) b.cyl('plain', 0.05, 0.05, 0.7, '#3a3a40', p.x + Math.cos(k * 1.57 + 0.78) * 0.5, top, p.z + Math.sin(k * 1.57 + 0.78) * 0.5, 4);
  for (let k = 0; k < 6; k++) b.rod('wood', new THREE.Vector3(p.x - 0.6, top + 1.2 + k * 0.08, p.z + (k - 2.5) * 0.18), new THREE.Vector3(p.x + 0.6, top + 1.25 + k * 0.08, p.z + (2.5 - k) * 0.12), 0.07, '#5a3a24', 4);
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb04a', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  fire.position.set(p.x, top + 2.1, p.z);
  const smoke = new THREE.Group();
  const puffMat = new THREE.MeshLambertMaterial({ color: '#2c2a2c', transparent: true, opacity: 0.55, depthWrite: false });
  const puffs: THREE.Mesh[] = [];
  for (let k = 0; k < 18; k++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), puffMat); smoke.add(m); puffs.push(m); }
  smoke.position.set(p.x, top + 2, p.z);
  ctx.extra.add(fire, smoke);
  const state = { pos: new THREE.Vector3(p.x, top + 2, p.z), lit: false };
  props.beacons.push(state);
  ctx.anim.push({ update: (t) => {
    fire.visible = smoke.visible = state.lit;
    if (!state.lit) return;
    fire.scale.set(1 + 0.15 * Math.sin(t * 11), 1 + 0.25 * Math.sin(t * 7.3), 1);
    puffs.forEach((m, k) => {
      const age = (t * 0.18 + k / puffs.length) % 1;
      m.position.set(Math.sin(k * 2.1 + t * 0.3) * (1 + age * 4) + age * 10, age * 34, Math.cos(k * 1.7) * (1 + age * 3));
      m.scale.setScalar(1.2 + age * 6);
    });
  } });
}

/** 渡口木桩：两岸各一根粗木桩，桩之间牵一根过河的牛皮绳（涉水时扶着走） */
function ferryPost(ctx: BuildCtx, p: GorgePlacement): void {
  const g = ctx.terrain.heightAt(p.x, p.z);
  ctx.b.clearFrame();
  ctx.b.cyl('wood', 0.22, 0.28, 2.4, '#6d4a30', p.x, g - 0.4, p.z, 8);
  ctx.b.rock('plain', 0.8, '#8d877d', p.x, g - 0.3, p.z, 0.5, p.x);
  ctx.world.add({ kind: 'cyl', x: p.x, z: p.z, r: 0.3, y0: g - 1, y1: g + 2, walkable: false });
}

/** 穷奇岩洞：坡顶一块大岩体下的黑洞口，洞口散着兽骨 */
function lair(ctx: BuildCtx, p: GorgePlacement): void {
  const h = ground(ctx, asPlacement(p), 5, 4, 0.6), b = ctx.b;
  frame(ctx, h);
  b.rock('plain', 6, '#76716a', 0, -1.5, -4, 0.9, 7, 1);
  b.rock('plain', 4.2, '#827c73', -5.5, -1, -2, 0.85, 9, 1);
  b.rock('plain', 4, '#6c675f', 5.5, -1, -2.5, 0.8, 13, 1);
  b.add('plain', new THREE.CircleGeometry(2.4, 16), '#0d0b0a', mat4(0, 1.8, -0.2));
  for (let k = 0; k < 9; k++) b.box('plain', 0.14, 0.14, 1.0, '#e6dcc6', Math.sin(k * 2.7) * 3, 0.1, 1.5 + Math.cos(k * 1.3) * 1.5, k * 0.7);
  boxC(ctx, h, 0, -3.5, 8, 4.5, -1, 8, false);
  ctx.icons.push({ name: '穷奇岩洞', x: p.x, z: p.z, kind: 'cave' });
}

/** 搭全部地标：共用物件走 plateau 的摆放表，本图专有的在这里 */
export function buildGorgeLandmarks(ctx: BuildCtx): GorgeProps {
  const props: GorgeProps = { thunderPosts: [], beacons: [], looseRock: null, nest: null };
  buildPlacements(ctx, PLACEMENTS, FLAG_LINES);
  for (const p of GORGE_PLACEMENTS) {
    switch (p.kind) {
      case 'bridgeTower': bridgeTower(ctx, p); break;
      case 'thunderPost': thunderPost(ctx, p, props); break;
      case 'mill': mill(ctx, p); break;
      case 'stable': stable(ctx, p); break;
      case 'gateTower': gateTower(ctx, p); break;
      case 'nest': nest(ctx, p, props); break;
      case 'looseRock': looseRock(ctx, p, props); break;
      case 'beacon': beacon(ctx, p, props); break;
      case 'ferryPost': ferryPost(ctx, p); break;
      case 'lair': lair(ctx, p); break;
    }
    ctx.b.clearFrame();
  }
  // 渡口：两根木桩之间的过河绳
  const posts = GORGE_PLACEMENTS.filter(p => p.kind === 'ferryPost');
  if (posts.length === 2) {
    const [a, c] = posts.map(p => new THREE.Vector3(p.x, ctx.terrain.heightAt(p.x, p.z) + 1.7, p.z));
    ctx.b.rod('plain', a, c.clone().lerp(a, 0.5).setY(Math.min(a.y, c.y) - 0.5), 0.03, '#6d5a3c', 4);
    ctx.b.rod('plain', c.clone().lerp(a, 0.5).setY(Math.min(a.y, c.y) - 0.5), c, 0.03, '#6d5a3c', 4);
  }
  // 溜索起点、桥头立两根经幡杆
  flagPole(ctx, -142, -48, 5, true);
  flagPole(ctx, -102, -142, 5, true);
  return props;
}

