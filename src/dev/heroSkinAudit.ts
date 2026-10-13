/**
 * 英雄选人演出的蒙皮审计（hero-skin-audit.html）：把出场、待机和每个小动作逐帧跑一遍，在实际 LOD0 蒙皮上
 * 算手臂区域（主骨骼是 Arm / ForeArm / Hand / 手指 / Shoulder 的三角形）的边长相对绑定姿势的比值，
 * 找出拉伸（> STRETCH）和塌缩（< COLLAPSE，看起来像「手臂不见了」）的帧，渲染最差的几帧。
 *
 *   /hero-skin-audit.html?hero=fox|bear|falcon        &save=名字（把结果图交给本机保存服务 127.0.0.1:8799）
 * 结果同时写在 window.__audit（每段的最差帧：时刻、p99 拉伸、最小比值、超限三角形数、出问题的骨骼）。
 */
import * as THREE from 'three';
import { HEROES } from '../player/Heroes';
import { buildHeroModel } from '../ui/heroPreview/heroes/index';
import { getWeaponDef } from '../weapons/WeaponDefs';
import { buildGunModel } from '../weapons/WeaponModels';
import { AssetLibrary } from '../assets/AssetLibrary';

const STRETCH = 1.8;
const COLLAPSE = 0.35;
const params = new URLSearchParams(location.search);
const hero = HEROES.find((h) => h.id === params.get('hero')) ?? HEROES[0];

await AssetLibrary.preload();
const rig = buildHeroModel(hero.id, hero.color);
const def = getWeaponDef(hero.startingWeapon);
rig.hand.add(buildGunModel(def.id, 0, def.element).root);
const scene = new THREE.Scene();
const pivot = new THREE.Group();
pivot.rotation.y = 27 * Math.PI / 180;
pivot.add(rig.root);
scene.add(pivot);
scene.updateMatrixWorld(true);

let mesh: THREE.SkinnedMesh | null = null;
rig.root.traverse((o) => { if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh && /LOD0$/.test(o.name)) mesh = o as THREE.SkinnedMesh; });
if (!mesh) throw new Error('no LOD0 skinned mesh');
const M = mesh as THREE.SkinnedMesh;
const geo = M.geometry;
const pos = geo.attributes.position;
const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
const boneNames = M.skeleton.bones.map((b) => b.name.replace(/^mixamorig[:_]?/, ''));
const isArm = (n: string): boolean => /(Arm|Hand|Shoulder)/.test(n);
const dominant = (i: number): number => {
  let best = 0, bw = -1;
  for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
  return best;
};
const idx = geo.index!;
// 手臂区域的边（去重）
const edgeSet = new Set<number>();
const edges: [number, number, number][] = [];   // a, b, dominant bone of a
for (let t = 0; t < idx.count; t += 3) {
  const tri = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
  for (let e = 0; e < 3; e++) {
    const a = tri[e], b = tri[(e + 1) % 3];
    const da = dominant(a), db = dominant(b);
    if (!isArm(boneNames[da]) && !isArm(boneNames[db])) continue;
    const key = Math.min(a, b) * 1e6 + Math.max(a, b);
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push([a, b, isArm(boneNames[da]) ? da : db]);
  }
}
const rest = new Float32Array(edges.length);
const va = new THREE.Vector3(), vb = new THREE.Vector3();
edges.forEach(([a, b], k) => { va.fromBufferAttribute(pos, a); vb.fromBufferAttribute(pos, b); rest[k] = va.distanceTo(vb) + 1e-6; });
const cur = new Float32Array(pos.count * 3);
const ratio = new Float32Array(edges.length);

function measure(): { p99: number; min: number; over: number; under: number; seg3: number[]; bones: string[] } {
  M.skeleton.update();
  const used = new Set<number>();
  for (const [a, b] of edges) { used.add(a); used.add(b); }
  for (const i of used) { M.getVertexPosition(i, va); cur[i * 3] = va.x; cur[i * 3 + 1] = va.y; cur[i * 3 + 2] = va.z; }
  let over = 0, under = 0, min = Infinity;
  const badBones = new Map<string, number>();
  // 塌缩 / 拉伸的边落在前臂哪一段：0 = 手肘，1 = 手腕（区分「肘部折太深」和「手腕拧太多」）
  const seg3 = [0, 0, 0];
  const jp = (n: string): THREE.Vector3 => M.skeleton.bones[boneNames.indexOf(n)].getWorldPosition(new THREE.Vector3());
  edges.forEach(([a, b, bone], k) => {
    const dx = cur[a * 3] - cur[b * 3], dy = cur[a * 3 + 1] - cur[b * 3 + 1], dz = cur[a * 3 + 2] - cur[b * 3 + 2];
    const r = Math.hypot(dx, dy, dz) / rest[k] / (M.matrixWorld.getMaxScaleOnAxis() || 1);
    ratio[k] = r;
    if (r < min) min = r;
    if (r > STRETCH || r < COLLAPSE) {
      if (r > STRETCH) over++; else under++;
      const n = boneNames[bone];
      badBones.set(n, (badBones.get(n) ?? 0) + 1);
      const side = n.startsWith('Left') ? 'Left' : n.startsWith('Right') ? 'Right' : '';
      if (side && /ForeArm/.test(n)) {
        const e = jp(side + 'ForeArm'), w = jp(side + 'Hand');
        va.set(cur[a * 3], cur[a * 3 + 1], cur[a * 3 + 2]);
        const tt = va.sub(e).dot(w.clone().sub(e)) / w.distanceToSquared(e);
        seg3[Math.max(0, Math.min(2, Math.floor(tt * 3)))]++;
      }
    }
  });
  const sorted = Float32Array.from(ratio).sort();
  return { p99: sorted[Math.floor(sorted.length * 0.99)], min, over, under, seg3,
    bones: [...badBones.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([n, c]) => `${n}×${c}`) };
}

type Seg = { name: string; start: () => void; dur: number; fid?: number };
const show = rig.show;
const segs: Seg[] = [
  { name: '出场', start: () => rig.playIntro(), dur: show?.intro ?? 1.5 },
  { name: '待机', start: () => undefined, dur: 8 },
  ...[0, 1, 2].map((i) => ({ name: `小动作${i}`, start: () => undefined, dur: 3.2, fid: i })),
];
const step = 1 / 60;
let t = 0;
const results: { seg: string; at: number; p99: number; min: number; over: number; under: number; seg3: number[]; bones: string[] }[] = [];
const worst: { seg: string; at: number; score: number }[] = [];
for (const seg of segs) {
  for (let i = 0; i < 120; i++) { t += step; rig.update(step, t); }
  seg.start();
  let segWorst = { at: 0, score: -1, m: null as ReturnType<typeof measure> | null };
  for (let u = 0; u < seg.dur; u += step) {
    if (seg.fid !== undefined) rig.root.userData.forceFidget = { index: seg.fid, u };
    t += step;
    rig.update(step, t);
    if (Math.round(u / step) % 3) continue;
    scene.updateMatrixWorld(true);
    const m = measure();
    const score = m.over + m.under * 2 + Math.max(0, m.p99 - 1.5) * 50;
    if (score > segWorst.score) segWorst = { at: u, score, m };
  }
  delete rig.root.userData.forceFidget;
  const m = segWorst.m!;
  results.push({ seg: seg.name, at: +segWorst.at.toFixed(2), p99: +m.p99.toFixed(2), min: +m.min.toFixed(2), over: m.over, under: m.under, seg3: m.seg3, bones: m.bones });
  worst.push({ seg: seg.name, at: segWorst.at, score: segWorst.score });
}
(window as unknown as { __audit: unknown }).__audit = results;

// 渲染每段的最差帧（3/4 机位 + 侧面），手臂区域超限的三角形不另上色：直接看形状
const W = 360, H = 400;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
scene.background = new THREE.Color(0x221d29);
scene.add(new THREE.HemisphereLight(0xfff1dc, 0x231a26, 1.3));
const key = new THREE.DirectionalLight(0xffe0b0, 2.4); key.position.set(2.5, 4, 3.5); scene.add(key);
const h = rig.height;
const cams = [new THREE.PerspectiveCamera(30, W / H, 0.1, 40), new THREE.PerspectiveCamera(30, W / H, 0.1, 40)];
const far = 0.72 * h / Math.tan(15 * Math.PI / 180);
cams[0].position.set(0, 0.6 * h, far); cams[0].lookAt(0, 0.6 * h, 0);
cams[1].position.set(-far, 0.6 * h, 0.3); cams[1].lookAt(0, 0.6 * h, 0);
const sheet = document.getElementById('sheet') as HTMLCanvasElement;
sheet.width = W * 4; sheet.height = H * Math.ceil(worst.length / 2);
const g = sheet.getContext('2d')!;
// 按段重放到最差时刻
let k = 0;
for (let s = 0; s < segs.length; s++) {
  const seg = segs[s];
  for (let i = 0; i < 120; i++) { t += step; rig.update(step, t); }
  seg.start();
  for (let u = 0; u <= worst[s].at + 1e-6; u += step) {
    if (seg.fid !== undefined) rig.root.userData.forceFidget = { index: seg.fid, u };
    t += step; rig.update(step, t);
  }
  for (const c of cams) {
    renderer.render(scene, c);
    const x = (k % 4) * W, y = Math.floor(k / 4) * H;
    g.drawImage(renderer.domElement, x, y);
    const r = results[s];
    g.fillStyle = '#f3d9a0'; g.font = '13px Microsoft YaHei';
    g.fillText(`${r.seg} ${r.at}s p99 ${r.p99} min ${r.min}`, x + 6, y + 16);
    g.fillText(`拉伸 ${r.over} 塌缩 ${r.under} ${r.bones.join(' ')}`, x + 6, y + 32);
    k++;
  }
  delete rig.root.userData.forceFidget;
}
(document.getElementById('title') as HTMLDivElement).textContent = `${hero.name} · 蒙皮审计 ` + JSON.stringify(results);
const save = params.get('save');
if (save) await fetch(`http://127.0.0.1:8799/save?name=${encodeURIComponent(save)}.png`, { method: 'POST', body: sheet.toDataURL('image/png') }).catch(() => undefined);
document.title = 'done';
