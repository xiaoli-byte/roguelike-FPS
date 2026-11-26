import * as THREE from 'three';
import type { GameContext, IEnemy } from '../core/types';
import { type RGB, rgbHex } from './PetDefs';

/**
 * 灵宠的一次性特效（照译 Unity G/Pets/PetVisuals.cs 的 PetFx / PetFxFade / PetMarkFollow / PetPartGlow 的光晕 + FxMaterials 的 GlowSprite / BeamSprite）：
 *   · 灵火一闪（光晕放大淡出）、冲天光柱、头顶标记（重瞳 / 白泽图）、世界空间名牌（封印名、灵兽台标题）；
 *   · 光束 / 雷 / 冲击 / 火花 / 圈环走 ctx.fx 现有方法（fx.beam / lightning / impact / burst / ring / groundWarning），不碰 src/fx 内部。
 * 物体挂在自己的 Group（加进 ctx.scene），按游戏时间推进（暂停时停住，同 Unity Time.time）；clear() 收走关卡里的。
 */

let glowTex: THREE.Texture | null = null;
let beamTex: THREE.Texture | null = null;

/** 径向渐变的光晕贴图（Unity FxMaterials.GlowSprite 的软圆） */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** 竖直光柱贴图：中间亮、两侧淡，自下而上渐隐（Unity FxMaterials.BeamSprite） */
function beamTexture(): THREE.Texture {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(32, 128);
  for (let y = 0; y < 128; y++) {
    const v = 1 - y / 127; // canvas 上方 = 柱顶
    const up = Math.pow(1 - v, 0.6) * Math.min(1, v * 8);
    for (let x = 0; x < 32; x++) {
      const u = Math.abs(x / 31 - 0.5) * 2;
      const across = Math.pow(Math.max(0, 1 - u), 1.6);
      const a = Math.max(0, Math.min(1, across * up));
      const i = (y * 32 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  beamTex = new THREE.CanvasTexture(c);
  beamTex.colorSpace = THREE.SRGBColorSpace;
  return beamTex;
}

/** 朝相机的光晕（加法混合、不写深度）：size 米 */
export function glowSprite(color: RGB | number, alpha: number, size: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(), color: typeof color === 'number' ? color : rgbHex(color), transparent: true, opacity: alpha,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  s.renderOrder = 3;
  return s;
}

/** 竖直光柱（两片十字交叉的面，底在原点）：width × height 米 */
export function beamPillar(color: RGB | number, alpha: number, width: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    map: beamTexture(), color: typeof color === 'number' ? color : rgbHex(color), transparent: true, opacity: alpha,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = i * Math.PI / 2;
    m.renderOrder = 2;
    m.frustumCulled = false;
    g.add(m);
  }
  g.scale.set(width, height, width);
  return g;
}

/** 世界空间文字（朝相机）：第一行彩色、第二行小字（Unity PetFx.Label 的富文本） */
export function textLabel(lines: { text: string; color: string; size: number }[], height: number): THREE.Sprite {
  const c = document.createElement('canvas');
  const scale = 2;
  const fonts = lines.map((l) => `${Math.round(l.size * scale)}px "SF Title", "SF Body", "Microsoft YaHei", "PingFang SC", sans-serif`);
  const g = c.getContext('2d')!;
  let w = 8;
  lines.forEach((l, i) => {
    g.font = fonts[i];
    w = Math.max(w, g.measureText(l.text).width + 16 * scale);
  });
  const lineH = lines.map((l) => l.size * scale * 1.3);
  const h = lineH.reduce((a, b) => a + b, 0) + 8 * scale;
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  let y = 4 * scale;
  lines.forEach((l, i) => {
    g.font = fonts[i];
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.lineWidth = 4 * scale;
    g.strokeStyle = 'rgba(10,8,6,0.8)';
    g.strokeText(l.text, c.width / 2, y);
    g.fillStyle = l.color;
    g.fillText(l.text, c.width / 2, y);
    y += lineH[i];
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  // 高度按第一行字高 height 米算
  const px = height / (lines[0].size * scale * 1.3);
  s.scale.set(c.width * px, c.height * px, 1);
  s.renderOrder = 4;
  return s;
}

interface Fade {
  obj: THREE.Object3D;
  mats: THREE.Material[];
  alpha: number[];
  age: number;
  life: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  follow?: { enemy: IEnemy; until: number; lift: number };
  dispose: boolean;
}

const _v = new THREE.Vector3();

export class PetFxSystem {
  readonly group = new THREE.Group();
  private fades: Fade[] = [];

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'pet-fx';
  }

  attach(): void {
    if (!this.group.parent) this.ctx.scene.add(this.group);
  }

  /** 灵火一闪：size 米的光晕在 life 秒内从 0.4 倍放大到 1 倍并淡出（Unity PetFx.Burst） */
  burst(at: THREE.Vector3, c: RGB, size: number, life = 0.45, alpha = 1): void {
    const s = glowSprite(c, alpha, 1);
    s.position.copy(at);
    this.group.add(s);
    this.track(s, life, _v.setScalar(size * 0.4), new THREE.Vector3().setScalar(size));
  }

  /** 冲天光柱（神兽现世、结契）：自下而上，life 秒淡出（Unity PetFx.Pillar） */
  pillar(at: THREE.Vector3, c: RGB, width: number, height: number, life: number, alpha = 0.6): void {
    const p = beamPillar(c, alpha, 1, 1);
    p.position.copy(at);
    this.group.add(p);
    this.track(p, life, new THREE.Vector3(0.6 * width, 0.2 * height, 0.6 * width), new THREE.Vector3(width, height, width));
  }

  /** 挂在敌人头顶、seconds 秒后消失的标记（Unity PetFx.TimedMarker：白泽图） */
  timedMarker(enemy: IEnemy, c: RGB, seconds: number): void {
    const m = marker(c, false);
    this.group.add(m);
    const f = this.track(m, seconds, _v.setScalar(1), new THREE.Vector3(1, 1, 1));
    // 跟着敌人头顶、不淡出：目标倒下或到时直接收
    f.follow = { enemy, until: this.ctx.time.now + seconds, lift: 0.45 };
  }

  /** 光束（金光、龙息、残影）：fx.beam 两端发亮的线，life 秒（Unity PetFx.Beam） */
  beam(from: THREE.Vector3, to: THREE.Vector3, c: RGB, width: number, life = 0.16): void {
    this.ctx.fx.beam(from, to, rgbHex(c), Math.max(0.02, width), life);
  }

  update(dt: number): void {
    if (this.fades.length === 0) return;
    const now = this.ctx.time.now;
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i];
      f.age += dt;
      if (f.follow) {
        const e = f.follow.enemy;
        if (!e.alive || now >= f.follow.until) {
          this.kill(i);
          continue;
        }
        f.obj.position.set(e.position.x, e.position.y + e.height + f.follow.lift, e.position.z);
        f.obj.scale.setScalar(1 + Math.sin(now * 6) * 0.08);
        continue;
      }
      const k = Math.min(1, f.age / f.life);
      const e = 1 - (1 - k) * (1 - k);
      f.obj.scale.lerpVectors(f.from, f.to, e);
      for (let j = 0; j < f.mats.length; j++) (f.mats[j] as THREE.Material & { opacity: number }).opacity = f.alpha[j] * (1 - k);
      if (f.age >= f.life) this.kill(i);
    }
  }

  /** 换关 / 新开一局：收走全部 */
  clear(): void {
    for (let i = this.fades.length - 1; i >= 0; i--) this.kill(i);
  }

  private track(obj: THREE.Object3D, life: number, from: THREE.Vector3, to: THREE.Vector3): Fade {
    const mats: THREE.Material[] = [];
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !mats.includes(m)) mats.push(m);
    });
    const f: Fade = {
      obj, mats, alpha: mats.map((m) => (m as THREE.Material & { opacity: number }).opacity), age: 0, life: Math.max(0.05, life),
      from: from.clone(), to: to.clone(), dispose: true,
    };
    obj.scale.copy(from);
    this.fades.push(f);
    return f;
  }

  private kill(i: number): void {
    const f = this.fades[i];
    this.fades.splice(i, 1);
    f.obj.removeFromParent();
    if (f.dispose) disposeObject(f.obj);
  }
}

/** 头顶标记（重明鸟的重瞳、白泽图）：朝相机的光圈，twin 时中间两颗瞳仁（Unity PetFx.Marker） */
export function marker(c: RGB, twin: boolean): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pet-mark';
  root.add(glowSprite(c, 0.55, 0.7));
  const pupil: RGB = [c[0] + (1 - c[0]) * 0.5, c[1] + (1 - c[1]) * 0.5, c[2] + (1 - c[2]) * 0.5];
  if (twin) {
    // 两颗瞳仁左右排开：精灵本身朝相机，位置随相机的右方向摆（每帧由调用方的 lookAt 不需要；精灵组整体朝向无关，这里用世界 X 近似，
    // 在 update 里按相机右向量重摆见 PetSystem 的重瞳标记）
    const a = glowSprite(pupil, 1, 0.22), b = glowSprite(pupil, 1, 0.22);
    a.name = 'pupilL';
    b.name = 'pupilR';
    a.position.x = -0.11;
    b.position.x = 0.11;
    root.add(a, b);
  } else root.add(glowSprite([1, 0.95, 0.8], 1, 0.3));
  return root;
}

/** 释放一个特效物体自己建的材质 / 贴图（共享的光晕 / 光柱贴图不释放） */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    const list = Array.isArray(m) ? m : m ? [m] : [];
    for (const mat of list) {
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map && map !== glowTex && map !== beamTex) map.dispose();
      mat.dispose();
    }
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g && !(o as THREE.Sprite).isSprite) g.dispose();
  });
}
