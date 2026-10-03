/**
 * 英雄预览台的低多边形石质祭台：八边形多层台座（玄武岩 + 鎏金描边）、
 * 顶面英雄色符文环（缓慢旋转 + 呼吸）、颈部符文带，以及环绕英雄的淡光柱。
 * 英雄站在祭台顶面（y = 0）上，台座向下延伸到 y = −0.6（取景时下半部分通常出画 / 被名牌盖住）。
 *
 * 光柱分前后两半：平时只显示后半圈（在英雄身后衬出剪影，永远不会盖住英雄正面），
 * surge() 时前后两半一起闪亮、符文环增亮并向外扩散一圈光环（切换英雄的「从光中升起」）。
 * 所有几何体 / 材质均为自建，dispose 时释放；传入的贴图由调用方管理。
 */
import * as THREE from 'three';
import { TAU, clamp01 } from '../../core/math';

export interface Altar {
  readonly group: THREE.Group;
  /** 当前闪光强度 0..1（surge 的包络），供灯光调制 */
  readonly flare: number;
  /** 闪亮一下（切换英雄时）。strength 0..1；闪光进行中再次触发会从当前亮度重新起跳 */
  surge(strength?: number): void;
  /** motion：动画速度倍率（减弱动态时 < 1）；calm：是否关闭呼吸闪烁 */
  update(dt: number, t: number, theme: THREE.Color, motion: number, calm: boolean): void;
  dispose(): void;
}

/** 叠加发光特效的渲染次序（在英雄之后绘制，被英雄遮挡的部分由深度测试剔除） */
export const FX_ORDER = 10;

/** 光柱高度（盖过最高的英雄 + 余量；贴图上端渐隐） */
const PILLAR_H = 3.0;
/** 闪光包络：起跳时长与衰减时间常数（秒） */
const SURGE_ATTACK = 0.09;
const SURGE_DECAY = 0.42;
/** 扩散光环的时长（秒）与起止缩放 */
const BURST_TIME = 0.8;
const BURST_FROM = 0.35;
const BURST_TO = 1.2;

export function buildAltar(runeTex: THREE.Texture, pillarTex: THREE.Texture, glowTex: THREE.Texture): Altar {
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };
  const group = new THREE.Group();
  group.name = 'heroPreview:altar';

  const stone = own(new THREE.MeshStandardMaterial({ color: 0x2a2b35, roughness: 0.92, metalness: 0.06, flatShading: true }));
  const stoneTop = own(new THREE.MeshStandardMaterial({ color: 0x353643, roughness: 0.86, metalness: 0.08, flatShading: true }));
  const gold = own(new THREE.MeshStandardMaterial({
    color: 0xd4a94e, roughness: 0.36, metalness: 0.55, emissive: 0x3a2808, flatShading: true,
  }));
  // 颈部符文带：不受光照的英雄色嵌线
  const band = own(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));

  /** 八边形台层（棱角朝向相机，平直着色更显低多边形） */
  const tier = (rTop: number, rBot: number, hgt: number, yTop: number, mat: THREE.Material, open = false): THREE.Mesh => {
    const m = new THREE.Mesh(own(new THREE.CylinderGeometry(rTop, rBot, hgt, 8, 1, open)), mat);
    m.position.y = yTop - hgt / 2;
    group.add(m);
    return m;
  };
  tier(0.82, 0.88, 0.14, 0, stoneTop);
  tier(0.905, 0.905, 0.034, -0.012, gold);
  tier(0.66, 0.72, 0.2, -0.14, stone);
  tier(0.705, 0.705, 0.034, -0.222, band, true);
  tier(0.95, 1.02, 0.12, -0.34, stone);
  tier(1.045, 1.045, 0.03, -0.352, gold);
  tier(1.1, 1.2, 0.14, -0.46, stone);

  // 顶层侧面的鎏金菱钉
  const studGeo = own(new THREE.OctahedronGeometry(0.034, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * (TAU / 8);
    const r = 0.85 * Math.cos(Math.PI / 8) + 0.004;
    const s = new THREE.Mesh(studGeo, gold);
    s.position.set(Math.sin(a) * r, -0.075, Math.cos(a) * r);
    s.rotation.y = a;
    s.scale.set(1, 1.35, 0.55);
    group.add(s);
  }
  // 底座四角的鎏金护角
  const capGeo = own(new THREE.BoxGeometry(0.09, 0.05, 0.09));
  for (let i = 0; i < 8; i += 2) {
    const a = (i / 8) * TAU;
    const c = new THREE.Mesh(capGeo, gold);
    c.position.set(Math.sin(a) * 0.86, -0.315, Math.cos(a) * 0.86);
    c.rotation.y = a + Math.PI / 4;
    group.add(c);
  }

  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const;

  // 顶面符文环（平放、绕 Y 旋转；英雄站在环心）
  const runeMat = own(new THREE.MeshBasicMaterial({ map: runeTex, color: 0xffffff, opacity: 0.8, ...additive }));
  const runeGeo = own(new THREE.PlaneGeometry(1.56, 1.56));
  runeGeo.rotateX(-Math.PI / 2);
  const rune = new THREE.Mesh(runeGeo, runeMat);
  rune.position.y = 0.004;
  rune.renderOrder = FX_ORDER;
  group.add(rune);

  // 符文环中心的柔光（脚下的英雄色反光）
  const glowMat = own(new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffffff, opacity: 0.3, ...additive }));
  const glowGeo = own(new THREE.PlaneGeometry(1.6, 1.6));
  glowGeo.rotateX(-Math.PI / 2);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.y = 0.008;
  glow.renderOrder = FX_ORDER;
  group.add(glow);

  // 切换英雄时自环心向外扩散的光环
  const burstMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0, side: THREE.DoubleSide, ...additive }));
  const burstGeo = own(new THREE.RingGeometry(0.88, 1, 64));
  burstGeo.rotateX(-Math.PI / 2);
  const burst = new THREE.Mesh(burstGeo, burstMat);
  burst.position.y = 0.012;
  burst.renderOrder = FX_ORDER;
  burst.visible = false;
  group.add(burst);

  // 自符文环升起的光柱：后半圈常亮（很淡），前半圈只在闪光时出现
  const pillarGeo = own(new THREE.CylinderGeometry(0.66, 0.78, PILLAR_H, 28, 1, true));
  const pillarBackMat = own(new THREE.MeshBasicMaterial({ map: pillarTex, color: 0xffffff, opacity: 0.08, side: THREE.BackSide, ...additive }));
  const pillarFrontMat = own(new THREE.MeshBasicMaterial({ map: pillarTex, color: 0xffffff, opacity: 0, side: THREE.FrontSide, ...additive }));
  const pillarBack = new THREE.Mesh(pillarGeo, pillarBackMat);
  const pillarFront = new THREE.Mesh(pillarGeo, pillarFrontMat);
  for (const p of [pillarBack, pillarFront]) {
    p.position.y = PILLAR_H / 2;
    p.renderOrder = FX_ORDER;
    group.add(p);
  }
  pillarFront.visible = false;

  let surgeT = Infinity;
  let surgeAmp = 0;
  let surgeFrom = 0;
  let flare = 0;
  const _col = new THREE.Color();

  return {
    group,
    get flare(): number {
      return flare;
    },
    surge(strength = 1): void {
      surgeFrom = flare;
      surgeAmp = clamp01(strength);
      surgeT = 0;
    },
    update(dt, t, theme, motion, calm): void {
      rune.rotation.y += dt * 0.16 * motion;
      pillarBack.rotation.y -= dt * 0.22 * motion;
      pillarFront.rotation.y = pillarBack.rotation.y;

      // 闪光包络：快速起跳（从当前亮度接续），再指数衰减
      surgeT += dt;
      if (surgeT < SURGE_ATTACK) flare = surgeFrom + (surgeAmp - surgeFrom) * (surgeT / SURGE_ATTACK);
      else flare = surgeAmp * Math.exp(-(surgeT - SURGE_ATTACK) / SURGE_DECAY);
      if (flare < 0.002) flare = 0;

      const breath = calm ? 0.6 : 0.5 + 0.5 * Math.sin(t * 1.6);
      runeMat.opacity = Math.min(1, 0.5 + 0.24 * breath + 0.5 * flare);
      glowMat.opacity = Math.min(1, 0.2 + 0.12 * breath + 0.55 * flare);
      pillarBackMat.opacity = 0.06 + 0.03 * breath + 0.42 * flare;
      pillarFrontMat.opacity = 0.34 * flare;
      pillarFront.visible = flare > 0.004;
      rune.scale.setScalar(1 + 0.05 * flare);

      // 闪光时符文环偏白（颜色乘数超过 1 的通道被截断，色相向暖白偏移）
      _col.copy(theme).multiplyScalar(1 + 0.8 * flare);
      runeMat.color.copy(_col);
      glowMat.color.copy(_col);
      pillarBackMat.color.copy(theme);
      pillarFrontMat.color.copy(theme);
      band.color.copy(theme).multiplyScalar(0.85 + 0.6 * flare);

      // 扩散光环
      const k = surgeT / BURST_TIME;
      if (k < 1 && surgeAmp > 0) {
        const e = 1 - (1 - k) * (1 - k) * (1 - k);
        burst.visible = true;
        burst.scale.setScalar(BURST_FROM + (BURST_TO - BURST_FROM) * e);
        burstMat.opacity = 0.85 * surgeAmp * (1 - k) * (1 - k);
        burstMat.color.copy(_col);
      } else {
        burst.visible = false;
      }
    },
    dispose(): void {
      for (const o of owned) o.dispose();
      owned.length = 0;
      group.clear();
    },
  };
}
