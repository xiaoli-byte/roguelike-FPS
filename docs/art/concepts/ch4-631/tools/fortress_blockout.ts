// 4-A 雪域宫堡的最简白模（还没有正式场景时用来出概念图的底图）：地形 + 墙块 + 坡道 + 村寨 + 石桥 + 残碉。
// 坐标、标高和 route_check_4A.py、docs/level-design/maps/4-A.md 一致（x 东、z 南、y 上，米）。
// 打成 iife 后在无头 Chromium 里跑：window.fortress = { scene, camera, renderer, heightAt, render(yawDeg, pitchDeg, fov) , project(points, routes) }。
import * as THREE from 'three';

// ───────────── 地形 ─────────────
const STREAM: [number, number][] = [[26, -230], [16, -120], [6, -60], [0, 0], [-8, 50], [-20, 95], [-30, 140], [-22, 230]];
const SPUR: [number, number][] = [[30, 110], [60, 150], [150, 150], [215, 90], [225, -40], [190, -130], [110, -140], [50, -90], [28, -10]];
function segDist(px: number, pz: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
}
function polyDist(px: number, pz: number, poly: [number, number][], closed: boolean): number {
  let d = Infinity;
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) d = Math.min(d, segDist(px, pz, poly[i], poly[(i + 1) % poly.length]));
  return d;
}
function inPoly(x: number, z: number, poly: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function heightAt(x: number, z: number): number {
  // 草甸：西、南略高（0–6 m），往溪边低
  let h = 2 + 3 * smooth(-40, -230, x) + 1.5 * smooth(40, 200, z) - 1.0 * smooth(-60, 60, z);
  // 山嘴：沿「山门 (50, 80) → 后山口 (150, −90)」这条轴一级级抬高（+6 → +52），离轴越远越往下收；边上 14 m 落回草甸
  const inside = inPoly(x, z, SPUR);
  const de = polyDist(x, z, SPUR, true);
  const ax = 100, az = -170, al = ax * ax + az * az;
  const t = ((x - 50) * ax + (z - 80) * az) / al;
  const lateral = Math.abs((x - 50) * az - (z - 80) * ax) / Math.sqrt(al);
  const spurH = 6 + 46 * smooth(0.1, 1.0, t) * (1 - smooth(30, 110, lateral));
  if (inside) h = Math.max(h, h + (spurH - h) * smooth(0, 14, de));
  // 残碉山脊：(−60, −168) 一座 34 m 的小山
  const dr = Math.hypot((x + 62) / 1.3, z + 170);
  h = Math.max(h, 34 * (1 - smooth(0, 60, dr)) + 2);
  // 外圈雪山：离可玩区越远越高（软边界外），坡缓一些，像山不像墙
  const edge = Math.max(Math.abs(x) - 215, Math.abs(z) - 195, 0);
  h += 170 * smooth(0, 420, edge) + 18 * Math.sin(x * 0.013) * Math.cos(z * 0.011) * smooth(0, 120, edge);
  // 冰溪：槽深 1.6 m、宽 9 m；上游 z −40…−10 是冰滩（浅、宽）
  const ds = polyDist(x, z, STREAM, false);
  const ice = z > -45 && z < -5;
  const w = ice ? 14 : 5;
  if (!inside && edge === 0) h -= (ice ? 0.6 : 1.8) * (1 - smooth(w * 0.6, w * 1.6, ds));
  return h;
}

// ───────────── 场景 ─────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9cde3);
scene.fog = new THREE.Fog(0xd7e2ec, 300, 2600);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(-400, 180, 60);
scene.add(sun, new THREE.HemisphereLight(0xcfe0ff, 0x8a8478, 1.1));
const mat = (c: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const M = { white: mat(0xf1ece2), red: mat(0x8e2a24), band: mat(0x8a4a2e), gold: mat(0xd9a93a), stone: mat(0x9a948c), dark: mat(0x5b5550), wood: mat(0x6e4b33), ice: mat(0xbfdbe6) };

// 地形网格：2 m 一格，顶点色（雪 / 枯草 / 岩 / 路 / 溪）
{
  const X0 = -760, X1 = 760, Z0 = -760, Z1 = 760, S = 4;
  const nx = (X1 - X0) / S + 1, nz = (Z1 - Z0) / S + 1;
  const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx - 1, nz - 1);
  g.rotateX(-Math.PI / 2);
  g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const ROAD: [number, number][] = [[-150, 130], [-110, 128], [-70, 110], [-40, 112], [-20, 95], [6, 86], [30, 82], [45, 75]];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z);
    pos.setY(i, h);
    const e = 0.6, sl = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    let c = new THREE.Color(0xe9ecef);                                   // 雪
    if (Math.sin(x * 0.05) * Math.cos(z * 0.04) > 0.55 && h < 8) c = new THREE.Color(0xcdbb8e); // 枯草斑
    if (sl > 0.9) c = new THREE.Color(0x8c8780);                          // 陡处露岩
    if (polyDist(x, z, ROAD, false) < 2.5) c = new THREE.Color(0x9a8566); // 土路
    if (polyDist(x, z, STREAM, false) < (z > -45 && z < -5 ? 8 : 4) && !inPoly(x, z, SPUR)) c = new THREE.Color(z > -45 && z < -5 ? 0xcfe6ee : 0x6f9fb0);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));
}

const solids: THREE.Object3D[] = [];
function box(x: number, z: number, w: number, d: number, y0: number, hgt: number, m: THREE.Material, yaw = 0, taper = 0): THREE.Mesh {
  // 收分墙块：顶面比底面每边收 taper 米
  const g = new THREE.BoxGeometry(w, hgt, d);
  if (taper) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * (1 - (2 * taper) / w)); p.setZ(i, p.getZ(i) * (1 - (2 * taper) / d)); }
    g.computeVertexNormals();
  }
  const m3 = new THREE.Mesh(g, m);
  m3.position.set(x, y0 + hgt / 2, z);
  m3.rotation.y = yaw;
  scene.add(m3);
  solids.push(m3);
  return m3;
}
/** 白墙块 + 顶上一圈赭红墙带 + 两排黑窗（窗用薄片） */
function wallBlock(x: number, z: number, w: number, d: number, top: number, hgt: number, yaw = 0): void {
  const y0 = top - hgt;
  box(x, z, w, d, y0 - 6, hgt + 6, M.white, yaw, 0.6);
  box(x, z, w - 1.0, d - 1.0, top - 1.4, 1.2, M.band, yaw);
}

// 远山：四座雪峰一层层往后退（只给轮廓）
for (const [x, z, r, hh] of [[520, -900, 420, 620], [-200, -1100, 520, 700], [900, -300, 380, 520], [-700, -700, 420, 560], [250, -1500, 600, 900]] as [number, number, number, number][]) {
  const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 7), mat(0xe4e9ef));
  c.position.set(x, hh / 2 - 20, z); c.rotation.y = x * 0.01;
  scene.add(c);
}

// 宫堡：下院（+6）、中台（+26）、上层（+48）、红殿 + 金顶
wallBlock(45, 75, 10, 8, 15, 9);                // 山门
wallBlock(64, 84, 24, 10, 14, 8);               // 下院围墙
wallBlock(86, 62, 10, 24, 14, 8);
wallBlock(62, 44, 24, 10, 22, 12);
wallBlock(92, 26, 24, 10, 26, 16);              // 中台墙块
wallBlock(116, 10, 12, 10, 32, 14);
wallBlock(100, -4, 12, 10, 34, 14);
wallBlock(128, -8, 24, 10, 36, 14);
wallBlock(112, -40, 12, 10, 52, 12);            // 上层角楼
wallBlock(146, -30, 12, 10, 56, 14);
box(128, -52, 18, 14, 48, 10, M.red, 0, 0.5);   // 红殿
box(128, -52, 17, 13, 56.5, 1.6, M.dark);
const roof = new THREE.Mesh(new THREE.ConeGeometry(9, 4, 4), M.gold);
roof.position.set(128, 60.2, -52); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.75);
scene.add(roof); solids.push(roof);

// 坡道：和 route_check_4A.py 同一组节点（x, z, 标高）；每段一块斜板 + 外侧女墙
const RAMPS: [number, number, number][][] = [
  [[58, 62, 6], [80, 50, 11], [60, 38, 16], [84, 26, 21], [104, 30, 26]],
  [[104, 30, 26], [122, 18, 26]],
  [[122, 18, 26], [106, 4, 32], [126, -14, 38], [112, -24, 43], [126, -36, 48]],
];
for (const r of RAMPS) for (let i = 0; i + 1 < r.length; i++) {
  const [ax, az, ay] = r[i], [bx, bz, by] = r[i + 1];
  const len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.2, len + 2), M.stone);
  slab.position.set((ax + bx) / 2, (ay + by) / 2 - 0.6, (az + bz) / 2);
  slab.rotation.order = 'YXZ'; slab.rotation.y = yaw; slab.rotation.x = -Math.atan2(by - ay, len);
  scene.add(slab); solids.push(slab);
  const par = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, len + 2), M.white);
  par.position.copy(slab.position).add(new THREE.Vector3(Math.cos(yaw) * 1.75, 1.1, -Math.sin(yaw) * 1.75));
  par.rotation.copy(slab.rotation);
  scene.add(par); solids.push(par);
  // 坡道下面的墙体（把斜板托在山嘴上）
  const under = new THREE.Mesh(new THREE.BoxGeometry(3.6, 12, len + 2), M.white);
  under.position.copy(slab.position).add(new THREE.Vector3(0, -6.6, 0));
  under.rotation.copy(slab.rotation);
  scene.add(under); solids.push(under);
}
// 回头平台
for (const [x, z, y] of [[80, 50, 11], [60, 38, 16], [84, 26, 21], [106, 4, 32], [126, -14, 38], [112, -24, 43]] as [number, number, number][]) box(x, z, 7, 7, y - 8, 8, M.white, 0, 0.3);

// 村寨（三座）、柴垛、玛尼墙
for (const [x, z] of [[-90, -8], [-70, 10], [-62, -14]] as [number, number][]) {
  const g0 = heightAt(x, z);
  box(x, z, 9, 9, g0 - 1, 4, M.stone);
  box(x, z, 9, 9, g0 + 3, 3.4, M.white);
  box(x, z, 8.6, 8.6, g0 + 6, 0.8, M.band);
}
{ const g0 = heightAt(-82, 22); box(-82, 22, 30, 0.8, g0 - 0.3, 1.4, M.stone, 0.18); }
// 石桥
{ const y = 2.5; box(-20, 95, 5, 12, y - 1.2, 1.2, M.stone, 0.9); }
// 残碉：碉楼一角塌掉（两块高低不同的方块）
{ const g0 = heightAt(-60, -168); box(-60, -168, 8, 8, g0 - 1, 13, M.white, 0.3, 0.5); box(-57, -165, 3.4, 3.4, g0 + 12, 4, M.white, 0.3); }
// 出生点玛尼堆
{ const g0 = heightAt(-146, 134); box(-146, 134, 2.4, 2.4, g0 - 0.3, 1.4, M.stone, 0.4); }

// ───────────── 相机与投影 ─────────────
const W = 1536, H = 864;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.5, 4000);
const ray = new THREE.Raycaster();

function render(px: number, pz: number, yawDeg: number, pitchDeg: number, fov: number): void {
  camera.position.set(px, heightAt(px, pz) + 1.62, pz);
  camera.fov = fov; camera.updateProjectionMatrix();
  camera.rotation.set((pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0, 'YXZ');
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
}
/** 世界点 → 画面像素 + 是否在画面里 + 是否被地形 / 墙块挡住 */
function project(x: number, z: number, y?: number | null): [number, number, number, number, number] {
  const yy = y ?? heightAt(x, z);
  const v = new THREE.Vector3(x, yy, z).project(camera);
  const target = new THREE.Vector3(x, yy + 1.2, z);
  const dir = target.clone().sub(camera.position);
  const dist = dir.length();
  ray.set(camera.position, dir.normalize());
  ray.far = dist - 1.5;
  let los = ray.intersectObjects(solids, false).length === 0;
  if (los) for (let t = 4; t < dist - 2; t += 2) { const p = camera.position.clone().addScaledVector(dir, t); if (heightAt(p.x, p.z) > p.y + 0.2) { los = false; break; } }
  return [+(((v.x + 1) / 2) * W).toFixed(1), +(((1 - v.y) / 2) * H).toFixed(1), v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 ? 1 : 0, los ? 1 : 0, +Math.hypot(x - camera.position.x, z - camera.position.z).toFixed(0)];
}
(window as any).fortress = { scene, camera, renderer, heightAt, render, project };
