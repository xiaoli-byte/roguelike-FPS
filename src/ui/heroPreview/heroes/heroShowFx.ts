/**
 * 英雄选人演出的道具与特效（heroShows.ts 里各英雄 fx 字段的画法）。全部是程序化的小物件，挂在英雄 root 下：
 *  - 燎：左手的爆竹（拿在手里 / 抛出去的抛物线）、引信火星、头顶炸开的火花 + 闪光 + 飘落的红纸屑、火折子灯火苗窜高。
 *  - 磐：鳞球形态（发布了 SM_HeroPart_PangolinBall 就用美术模型，否则用程序化的鳞片球顶替）、落地尘环与琥珀色裂纹、
 *        拳砸地的裂纹与碎石、沿脊背 / 尾巴的鳞缝发光（呼吸明暗、张鳞波浪）、敲炮管的火星、铜线锤。
 *  - 鼯：滑翔风线、落地扬尘、护腕线圈火花、护腕与枪之间的电弧、雷鼓一圈电光、电到手的一下闪光。
 * 材质都放进 rig.materials（预览台据此做淡入淡出并负责释放）；不用时整组隐藏。
 */
import * as THREE from 'three';
import type { Pose } from './heroShows';
import { AssetLibrary } from '../../../assets/AssetLibrary';

export interface ShowFxContext {
  /** 角色坐标（绑定姿势参照）→ 世界 */
  toWorld(p: THREE.Vector3): THREE.Vector3;
  /** 骨骼当前位置（角色坐标） */
  live(b: THREE.Bone): THREE.Vector3;
  /** 枪挂点（世界矩阵已更新） */
  gunWorld(): THREE.Object3D;
}

export interface ShowFx {
  bind(ctx: ShowFxContext): void;
  update(P: Pose, dt: number, t: number): void;
  reset(): void;
  dispose(): void;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** 地面裂纹贴图（发光的分叉裂纹，透明底） */
function crackTexture(seed: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  let s = seed;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineCap = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    for (let i = 0; i < 6 && len > 4; i++) {
      const nx = x + Math.cos(a) * len / 6, ny = y + Math.sin(a) * len / 6;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      x = nx; y = ny; a += (rnd() - 0.5) * 0.7; w *= 0.85;
      if (depth < 2 && rnd() < 0.25) branch(x, y, a + (rnd() - 0.5) * 1.6, len * 0.5, w, depth + 1);
    }
  };
  for (let i = 0; i < 9; i++) branch(128, 128, (i / 9) * Math.PI * 2 + rnd() * 0.4, 100 + rnd() * 25, 5, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function createShowFx(id: string, root: THREE.Object3D, bone: (n: string) => THREE.Bone, s: number, materials: THREE.Material[]): ShowFx {
  const group = new THREE.Group();
  group.name = `hero-show-fx-${id}`;
  root.add(group);
  let ctx: ShowFxContext | null = null;
  const geos: THREE.BufferGeometry[] = [];
  const texs: THREE.Texture[] = [];
  const own = <M extends THREE.Material>(m: M): M => {
    materials.push(m);
    return m;
  };
  const addMat = (color: number, opacity = 1): THREE.SpriteMaterial =>
    own(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  const sprite = (color: number, size: number): THREE.Sprite => {
    const sp = new THREE.Sprite(addMat(color));
    sp.scale.setScalar(size * s);
    sp.visible = false;
    group.add(sp);
    return sp;
  };
  const v = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const w = (b: string): THREE.Vector3 => bone(b).getWorldPosition(new THREE.Vector3());
  const toLocal = (p: THREE.Vector3): THREE.Vector3 => group.worldToLocal(p);
  const setOp = (o: THREE.Object3D, op: number): void => {
    o.visible = op > 0.01;
    ((o as THREE.Mesh).material as THREE.Material & { opacity: number }).opacity = op;
  };

  /** 一团粒子（爆开 / 扬尘）：按进度 0–1 算位置，不存状态（快进量取景、重播都不出错） */
  function burst(n: number, color: number, size: number, speed: number, gravity: number, seed: number, spread: 'sphere' | 'ring' = 'sphere') {
    const geo = new THREE.BufferGeometry();
    geos.push(geo);
    const pos = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dirs: THREE.Vector3[] = [];
    let sd = seed;
    const rnd = (): number => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const d = spread === 'ring'
        ? v(Math.cos((i / n) * Math.PI * 2), 0.15 + rnd() * 0.3, Math.sin((i / n) * Math.PI * 2))
        : v(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      dirs.push(d.multiplyScalar(speed * (0.55 + rnd() * 0.45)));
    }
    const mat = own(new THREE.PointsMaterial({ color, size: size * s, map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    group.add(pts);
    return {
      pts,
      at(origin: THREE.Vector3, k: number, dur: number): void {
        if (k <= 0 || k >= 1) { pts.visible = false; return; }
        pts.visible = true;
        const tt = k * dur;
        for (let i = 0; i < n; i++) {
          const d = dirs[i];
          pos[i * 3] = origin.x + d.x * tt * s;
          pos[i * 3 + 1] = origin.y + (d.y * tt - 0.5 * gravity * tt * tt) * s;
          pos[i * 3 + 2] = origin.z + d.z * tt * s;
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = (1 - k) ** 1.5;
      },
    };
  }

  /** 地面上的发光平面（尘环 / 裂纹 / 电光环） */
  function groundDecal(tex: THREE.Texture | null, color: number, size: number, ring = false): THREE.Mesh {
    const geo = ring ? new THREE.RingGeometry(0.93, 1, 64) : new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    geos.push(geo);
    const mat = own(new THREE.MeshBasicMaterial({ color, map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const m = new THREE.Mesh(geo, mat);
    m.scale.setScalar(size * s);
    m.visible = false;
    m.renderOrder = 2;
    group.add(m);
    return m;
  }

  // ─────────────── 燎 ───────────────
  if (id === 'fox') {
    const cracker = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.11 * s, 10), own(new THREE.MeshStandardMaterial({ color: 0xc8231b, roughness: 0.6 })));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032 * s, 0.032 * s, 0.018 * s, 10), own(new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.4, roughness: 0.45 })));
    cap.position.y = 0.06 * s;
    const fuse = sprite(0xffc070, 0.06);
    fuse.position.y = 0.085 * s;
    geos.push(body.geometry, cap.geometry);
    cracker.add(body, cap);
    cracker.add(fuse);
    group.remove(fuse);
    cracker.add(fuse);
    cracker.visible = false;
    group.add(cracker);
    const sparks = burst(140, 0xffb347, 0.09, 2.4, 2.0, 11);
    const glitter = burst(60, 0xfff0b0, 0.06, 1.3, 1.2, 41);
    const confetti = burst(36, 0xe0302a, 0.035, 1.1, 0.7, 29);
    const flash = sprite(0xffa040, 0.5);
    const lampFlare = sprite(0xff9a3c, 0.22);
    let release = v();
    const apex = (): THREE.Vector3 => ctx!.live(bone('Head')).add(v(0.02 * s, 0.5 * s, 0.12 * s));
    return {
      bind(c) { ctx = c; },
      reset() { cracker.visible = false; },
      update(P, _dt, t) {
        if (!ctx) return;
        const handW = w('LeftHandMiddle1').lerp(w('LeftHandThumb2'), 0.5);
        const c = P.fx.cracker;
        cracker.visible = c > 0;
        if (c === 1) {
          release = ctx.live(bone('LeftHandMiddle1'));
          const toss = P.fx.crackerToss ?? 0;
          cracker.position.copy(toLocal(handW.add(v(0, 0.16 * s * toss, 0))));
          cracker.rotation.set(0.4, 0, 0.6 + toss * 6);
        } else if (c === 2) {
          const k = P.fx.crackerT;
          const a = apex();
          const p = release.clone().lerp(a, k);
          p.y += Math.sin(k * Math.PI) * 0.12 * s;
          cracker.position.copy(toLocal(ctx.toWorld(p)));
          cracker.rotation.set(k * 9, 0, k * 5);
        }
        fuse.visible = P.fx.fuse > 0;
        if (fuse.visible) (fuse.material as THREE.SpriteMaterial).opacity = 0.6 + 0.4 * Math.sin(t * 60);
        const b = P.fx.burst;
        const origin = toLocal(ctx.toWorld(apex()));
        sparks.at(origin, b, 0.9);
        confetti.at(origin, b * 0.9, 1.6);
        glitter.at(origin, b, 1.2);
        flash.position.copy(origin);
        flash.scale.setScalar((0.3 + 0.7 * Math.min(1, b * 4)) * s);
        setOp(flash, b > 0 && b < 0.25 ? 0.9 * (1 - b / 0.25) : 0);
        const lp = ctx.live(bone('LeftUpLeg')).add(v(0.05 * s, -0.04 * s, 0.1 * s));
        lampFlare.position.copy(toLocal(ctx.toWorld(lp)));
        lampFlare.scale.setScalar((0.16 + 0.3 * P.fx.lamp) * s);
        setOp(lampFlare, 0.35 + 0.65 * P.fx.lamp);
      },
      dispose() { for (const g of geos) g.dispose(); group.removeFromParent(); },
    };
  }

  // ─────────────── 磐 ───────────────
  if (id === 'bear') {
    const art = AssetLibrary.findAttachments('hero', 'bear').find((a) => /PangolinBall/.test(a.id));
    let ball: THREE.Object3D;
    if (art) {
      ball = art.gltf.scene.clone(true);
      ball.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = own((m.material as THREE.Material).clone());
        // 近景展示只用 LOD0
        if (/_LOD[1-9]$/.test(m.name)) m.visible = false;
      });
    } else {
      // 还没发布美术鳞球时的顶替：一圈圈重叠的青铜鳞片
      ball = new THREE.Group();
      const scaleGeo = new THREE.SphereGeometry(0.16 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
      geos.push(scaleGeo);
      const mat = own(new THREE.MeshStandardMaterial({ color: 0x9a6a2c, metalness: 0.35, roughness: 0.5, emissive: 0x3a1800, flatShading: true }));
      for (let ring = 0; ring < 6; ring++) {
        const lat = -Math.PI / 2 + ((ring + 0.5) / 6) * Math.PI;
        const n = Math.max(4, Math.round(10 * Math.cos(lat)));
        for (let i = 0; i < n; i++) {
          const lon = (i / n) * Math.PI * 2 + ring * 0.4;
          const m = new THREE.Mesh(scaleGeo, mat);
          const dir = v(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
          m.position.copy(dir.clone().multiplyScalar(0.42 * s));
          m.quaternion.setFromUnitVectors(v(0, 1, 0), dir);
          ball.add(m);
        }
      }
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.44 * s, 20, 14), own(new THREE.MeshStandardMaterial({ color: 0x5a3a18, roughness: 0.7, emissive: 0xff7a1a, emissiveIntensity: 0.25 })));
      geos.push(core.geometry);
      ball.add(core);
    }
    ball.visible = false;
    group.add(ball);
    const ballR = 0.5 * s;
    const dust = burst(60, 0xd9b48a, 0.09, 1.6, 0.6, 7, 'ring');
    const dustRing = groundDecal(null, 0x8a6a48, 1.2, true);
    const cracks = groundDecal(crackTexture(3), 0xff8a2a, 1.8);
    const cracks2 = groundDecal(crackTexture(17), 0xff9a3a, 1.1);
    const pebbles = burst(26, 0xb08050, 0.06, 1.4, 4.5, 19);
    const glowBones = ['Spine', 'Spine1', 'Spine2', 'Neck'].concat([1, 2, 3, 4, 5, 6].map((i) => `tail_${i}`));
    const glows = glowBones.map(() => sprite(0xff9a2a, 0.22));
    const knock = sprite(0xffd28a, 0.1);
    const bobGeo = new THREE.ConeGeometry(0.06 * s, 0.15 * s, 12);
    bobGeo.rotateX(Math.PI);
    geos.push(bobGeo);
    const bobMesh = new THREE.Mesh(bobGeo, own(new THREE.MeshStandardMaterial({ color: 0xd4a24a, metalness: 0.7, roughness: 0.3 })));
    const lineGeo = new THREE.BufferGeometry().setFromPoints([v(), v(0, -0.22 * s, 0)]);
    geos.push(lineGeo);
    const bobLine = new THREE.Line(lineGeo, own(new THREE.LineBasicMaterial({ color: 0x3a2a1a })));
    const bob = new THREE.Group();
    bobMesh.position.y = -0.29 * s;
    bob.add(bobMesh, bobLine);
    bob.visible = false;
    group.add(bob);
    let model: THREE.Object3D | null = null;
    root.traverse((o) => { if (!model && /native-hero-.*-lod/.test(o.name)) model = o; });
    return {
      bind(c) { ctx = c; },
      reset() { ball.visible = false; },
      update(P, _dt, t) {
        if (!ctx) return;
        const showBall = P.fx.ball > 0;
        ball.visible = showBall;
        if (model) (model as THREE.Object3D).visible = !showBall;
        ctx.gunWorld().visible = !showBall;
        if (showBall) {
          ball.position.copy(toLocal(ctx.toWorld(v(0, ballR + P.fx.ballY, 0.02 * s))));
          ball.rotation.set(-P.fx.ballY * 2.2, 0.3, 0);
        }
        const im = P.fx.impact;
        const ground = toLocal(ctx.toWorld(v(0, 0.01 * s, 0)));
        dust.at(ground.clone().setY(ground.y + 0.05 * s), im, 1.1);
        dustRing.position.copy(ground);
        dustRing.scale.setScalar((0.6 + 1.6 * im) * s);
        setOp(dustRing, im > 0 && im < 1 ? (1 - im) ** 2 * 0.45 : 0);
        cracks.position.copy(ground).setY(ground.y + 0.002);
        setOp(cracks, im > 0 && im < 1 ? Math.min(1, im * 8) * (1 - im) ** 0.6 : 0);
        const pu = P.fx.punch;
        const fist = toLocal(ctx.toWorld(ctx.live(bone('RightUpLeg')).add(v(-0.05 * s, 0, 0.32 * s)).setY(0.01 * s)));
        cracks2.position.copy(fist);
        cracks2.scale.setScalar((0.6 + 0.8 * Math.min(1, pu * 3)) * s);
        setOp(cracks2, pu > 0 && pu < 1 ? Math.min(1, pu * 10) * (1 - pu) ** 0.7 : 0);
        pebbles.at(fist.clone().setY(fist.y + 0.04 * s), pu * 1.6, 0.7);
        // 鳞缝发光：呼吸明暗 + 张鳞时自颈到尾（ripple 0→1）一节节亮过去
        glows.forEach((g, i) => {
          const b = bone(glowBones[i]);
          const p = ctx!.live(b);
          const back = i < 4 ? v(0, 0.02 * s, -0.2 * s) : v(0, 0.06 * s, 0);
          g.position.copy(toLocal(ctx!.toWorld(p.add(back))));
          const wave = P.fx.ripple > 0 ? Math.exp(-(((P.fx.ripple * (glows.length + 2) - i) / 1.2) ** 2)) : 0;
          const op = showBall ? 0 : Math.min(1, 0.22 * P.fx.scales + 0.9 * wave);
          setOp(g, op);
          g.scale.setScalar((0.2 + 0.12 * wave) * s * (i < 4 ? 1.4 : 1));
        });
        knock.position.copy(toLocal(w('LeftHandMiddle1')));
        setOp(knock, (P.fx.knock ?? 0) * 0.9);
        bob.visible = (P.fx.bob ?? 0) > 0.05;
        if (bob.visible) {
          bob.position.copy(toLocal(w('LeftHandIndex2')));
          bob.rotation.set(0, 0, 0.06 * Math.sin(t * 2.2));
          bob.scale.setScalar(Math.min(1, P.fx.bob * 1.5));
        }
      },
      dispose() { for (const g of geos) g.dispose(); for (const tx of texs) tx.dispose(); group.removeFromParent(); },
    };
  }

  // ─────────────── 鼯 ───────────────
  const COL = 0x8fd8ff;
  const COL2 = 0xb98cff;
  const bracerL = sprite(COL, 0.12);
  const bracerR = sprite(COL, 0.12);
  const shock = sprite(0xe8f6ff, 0.35);
  const drumGlow = sprite(COL2, 0.5);
  const drumRing = groundDecal(null, 0x5a8cc8, 1.0, true);
  const dust = burst(40, 0xd8c6a8, 0.08, 1.3, 0.5, 5, 'ring');
  const winds = [0, 1, 2, 3].map(() => sprite(0xdff4ff, 0.3));
  const arcPts = 14;
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arcPts * 3), 3));
  geos.push(arcGeo);
  const arc = new THREE.Line(arcGeo, own(new THREE.LineBasicMaterial({ color: 0xd6f2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  arc.frustumCulled = false;
  arc.visible = false;
  group.add(arc);
  const bracer = (side: string): THREE.Vector3 => w(`${side}ForeArm`).lerp(w(`${side}Hand`), 0.72);
  return {
    bind(c) { ctx = c; },
    reset() { /* 无状态 */ },
    update(P, _dt, t) {
      if (!ctx) return;
      const sp = P.fx.sparks;
      const flick = (k: number): number => (Math.sin(t * 73 + k) > 0.2 ? 1 : 0.25);
      bracerL.position.copy(toLocal(bracer('Left')));
      bracerR.position.copy(toLocal(bracer('Right')));
      setOp(bracerL, 0.25 + 0.75 * sp * flick(1));
      setOp(bracerR, 0.25 + 0.6 * sp * flick(2.3));
      bracerL.scale.setScalar((0.1 + 0.12 * sp * flick(4)) * s);
      shock.position.copy(toLocal(w('LeftHandMiddle1')));
      setOp(shock, P.fx.shock ?? 0);
      // 电弧：左护腕 → 枪身线圈，每帧重新抖动
      const a = P.fx.arc;
      arc.visible = a > 0.01;
      if (arc.visible) {
        const from = bracer('Left');
        const to = new THREE.Vector3(0, 0.02, -0.12).multiplyScalar(ctx.gunWorld().scale.x);
        ctx.gunWorld().localToWorld(to);
        const arr = arcGeo.attributes.position.array as Float32Array;
        for (let i = 0; i < arcPts; i++) {
          const k = i / (arcPts - 1);
          const p = from.clone().lerp(to, k);
          const j = Math.sin(k * Math.PI) * 0.03 * s;
          p.add(v((Math.random() - 0.5) * j * 2, (Math.random() - 0.5) * j * 2, (Math.random() - 0.5) * j * 2));
          const l = toLocal(p);
          arr[i * 3] = l.x; arr[i * 3 + 1] = l.y; arr[i * 3 + 2] = l.z;
        }
        arcGeo.attributes.position.needsUpdate = true;
        (arc.material as THREE.LineBasicMaterial).opacity = a;
      }
      // 雷鼓：腰间一圈电光
      const d = P.fx.drum;
      const drumP = ctx.live(bone('LeftUpLeg')).add(v(0.07 * s, 0.02 * s, 0.13 * s));
      drumGlow.position.copy(toLocal(ctx.toWorld(drumP)));
      setOp(drumGlow, d > 0 && d < 1 ? (1 - d) * 1.2 : 0.12 + 0.08 * Math.sin(t * 3));
      const ground = toLocal(ctx.toWorld(v(0, 0.01 * s, 0)));
      drumRing.position.copy(ground);
      drumRing.scale.setScalar((0.4 + 1.8 * d) * s);
      setOp(drumRing, d > 0 && d < 1 ? (1 - d) ** 2 * 0.6 : 0);
      dust.at(ground.clone().setY(ground.y + 0.04 * s), P.fx.dust, 0.9);
      // 滑翔风线：手腕 / 脚踝后方拉长的淡光
      const wind = P.fx.wind;
      ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'].forEach((b, i) => {
        winds[i].position.copy(toLocal(w(b)));
        winds[i].scale.set(0.9 * s, 0.06 * s, 1);
        setOp(winds[i], wind * 0.5);
      });
    },
    dispose() { for (const g of geos) g.dispose(); group.removeFromParent(); },
  };
}
