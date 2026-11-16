/**
 * 旱魃专属特效的网页版（Unity Fx.Hanba* / SkillFx / FlameTongues / Surge / FxDecals 的调用，docs/art/vfx/hanba.md）：
 * 「精神对齐」——每个 Unity 特效换成网页现有 ctx.fx 的粒子 / 冲击环 / 爆炸 / 光束组合，节拍（哪一帧、多大、什么颜色）照 Unity；
 * 逐粒子的外观一致留给 M11b（特效预设 JSON + 粒子引擎）。还有一个 DOM 全屏闪（GameUI.ScreenFlash，网页 IUI 没有）。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';

export const SUN = 0xffe2a0, SAND = 0xd9b27a, WARN = 0xffa23d, GOLD = 0xffd27a, BEAM = 0xfff0b8, AIM = 0xffc060, HEAT = 0xffc070;
export const CRACK = 0xff8a2a, BLAST = 0xffa040, FLARE = 0xfff2c8, STEAM = 0xf2ede0, SPRING = 0x9fdcf0, DROPLET = 0x99dbff;

const _p = new THREE.Vector3();

/** 全屏闪（Unity GameUI.ScreenFlash）：color 是 CSS 颜色，alpha 峰值，seconds 淡出 */
export function screenFlash(ctx: GameContext, color: string, alpha: number, seconds: number): void {
  const host = ctx.dom?.ui;
  if (!host || typeof document === 'undefined') return;
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:39;background:${color};opacity:${Math.min(1, Math.max(0, alpha))};transition:opacity ${Math.max(0.05, seconds)}s ease-out`;
  host.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => { d.style.opacity = '0'; }));
  setTimeout(() => d.remove(), Math.max(0.05, seconds) * 1000 + 120);
}

/** 起沙（Fx.SandBlast）：一团往外炸的沙 */
export function sandBlast(ctx: GameContext, at: THREE.Vector3, size: number, color = SAND): void {
  ctx.fx.burst(at, color, Math.round(10 + size * 8), 3 + size * 2, 0.7 + size * 0.15, 0.25 + size * 0.06, 4);
}

/** 星芒（Fx.SunFlare）：一记亮闪 */
export function sunFlare(ctx: GameContext, at: THREE.Vector3, size: number, color = SUN): void {
  ctx.fx.burst(at, color, Math.round(8 + size * 5), size * 3, 0.35, 0.18 + size * 0.05, 0);
  ctx.fx.ring(at, size * 1.4, color, 0.35);
}

/** 灼点印（Fx.HanbaFocusSeal）：落点一圈收紧的刻符环，seconds 后收完——用地面预警圈表现 */
export function focusSeal(ctx: GameContext, at: THREE.Vector3, radius: number, seconds: number): () => void {
  return ctx.fx.groundWarning(at, radius, seconds, SUN);
}

/** 日轮聚光（Fx.HanbaRingGather）：光点沿八根辐条收进轮毂，u 越大越密 */
export function ringGather(ctx: GameContext, hub: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, radius: number, u: number): void {
  if (Math.random() > 0.25 + u * 0.6) return;
  const a = Math.floor(Math.random() * 8) * Math.PI / 4;
  _p.copy(hub).addScaledVector(right, Math.cos(a) * radius * 0.9).addScaledVector(up, Math.sin(a) * radius * 0.9);
  ctx.fx.burst(_p, SUN, 2, 1.2, 0.3, 0.12 + u * 0.08, 0);
}

/** 释放帧（Fx.HanbaSunStrike）：轮毂 / 落点爆闪 */
export function sunStrike(ctx: GameContext, hub: THREE.Vector3, ground: THREE.Vector3, radius: number): void {
  sunFlare(ctx, hub, radius * 0.6);
  ctx.fx.explosion(ground, 1.6, BEAM);
}

/** 光束犁地的前沿（Fx.HanbaBeamEdge）：落点热芯 + 顺着扫的方向甩金丝和沙 */
export function beamEdge(ctx: GameContext, end: THREE.Vector3): void {
  ctx.fx.burst(end, BEAM, 2, 2.5, 0.35, 0.16, -1);
  if (Math.random() < 0.5) ctx.fx.burst(end, SAND, 2, 3, 0.5, 0.2, 5);
}

/** 光束收细熄灭后沿光束往上飘一串金点（Fx.HanbaBeamFade） */
export function beamFade(ctx: GameContext, from: THREE.Vector3, to: THREE.Vector3): void {
  for (let i = 1; i <= 5; i++) ctx.fx.burst(_p.copy(from).lerp(to, i / 6), GOLD, 2, 0.6, 0.6, 0.1, -1.5);
}

/** 吸气（Fx.HanbaGaleInhale）：身前两侧的沙往她脚下收 */
export function galeInhale(ctx: GameContext, at: THREE.Vector3, yaw: number, halfDeg: number, u: number): void {
  if (Math.random() > 0.2 + u * 0.5) return;
  const a = yaw + (Math.random() * 2 - 1) * halfDeg * Math.PI / 180;
  const r = 4 + Math.random() * 6 * (1 - u * 0.5);
  _p.set(at.x + Math.sin(a) * r, at.y + 0.3, at.z + Math.cos(a) * r);
  ctx.fx.burst(_p, SAND, 2, 1.5, 0.5, 0.18, -0.2);
}

/** 释放帧（Fx.HanbaGaleFront）：掌前爆闪 + 一道贴地的月牙热浪前沿 */
export function galeFront(ctx: GameContext, front: THREE.Vector3, palms: THREE.Vector3): void {
  ctx.fx.explosion(palms, 1.1, HEAT);
  ctx.fx.ring(front, 3.5, HEAT, 0.45);
}

/** 掌心压地（Fx.HanbaSummonPress）：沙尘团 + 沙色冲击环 */
export function summonPress(ctx: GameContext, at: THREE.Vector3): void {
  sandBlast(ctx, _p.copy(at).setY(at.y + 0.3), 2.2);
  ctx.fx.ring(at, 6, SAND, 0.6);
}

/** 手里攥着一团越来越大的日火（Fx.HanbaPalmCharge） */
export function palmCharge(ctx: GameContext, hand: THREE.Vector3, u: number): void {
  if (Math.random() < 0.5) ctx.fx.burst(hand, CRACK, 1 + Math.round(u * 3), 0.6 + u, 0.3, 0.12 + u * 0.18, -0.5);
}

/** 按掌（Fx.HanbaPalmSlam）：掌下爆闪、贴地冲击环、崩起的石块、矮宽尘团 */
export function palmSlam(ctx: GameContext, at: THREE.Vector3): void {
  ctx.fx.explosion(_p.copy(at).setY(at.y + 0.3), 1.8, CRACK);
  ctx.fx.ring(at, 5, WARN, 0.5);
  ctx.fx.burst(at, 0x8a6a48, 10, 6, 0.8, 0.22, 14);
  sandBlast(ctx, at, 2);
}

/** 裂缝最前头的火头（Fx.HanbaCrackHead） */
export function crackHead(ctx: GameContext, at: THREE.Vector3): void {
  ctx.fx.burst(_p.copy(at).setY(at.y + 0.15), BEAM, 2, 2.5, 0.35, 0.14, -1);
}

/** 拔掌（Fx.HanbaPalmOut） */
export function palmOut(ctx: GameContext, hand: THREE.Vector3, ground: THREE.Vector3): void {
  sandBlast(ctx, ground, 0.8);
  ctx.fx.burst(hand, CRACK, 6, 1.5, 0.6, 0.1, 6);
}

/** 心口一记金色「啪」环（Fx.HanbaHeartBloom） */
export function heartBloom(ctx: GameContext, at: THREE.Vector3): void {
  ctx.fx.ring(at, 3, GOLD, 0.45);
  ctx.fx.burst(at, GOLD, 16, 4, 0.6, 0.14, 0);
}

/** 日冕（Fx.Corona）：黑盘周围往外飘的金红光点 */
export function corona(ctx: GameContext, hub: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, radius: number): void {
  if (Math.random() > 0.5) return;
  const a = Math.random() * Math.PI * 2;
  _p.copy(hub).addScaledVector(right, Math.cos(a) * radius * 1.15).addScaledVector(up, Math.sin(a) * radius * 1.15);
  ctx.fx.burst(_p, 0xff8c40, 1, 0.8, 0.6, 0.14, -0.3);
}

/** 日冕倒计时珠（Fx.HanbaCoronaBead） */
export function coronaBead(ctx: GameContext, at: THREE.Vector3, size: number, fresh: boolean): void {
  ctx.fx.burst(at, fresh ? 0xffffff : GOLD, fresh ? 6 : 1, fresh ? 2 : 0.1, fresh ? 0.4 : 0.14, size, 0);
}

/** 泉珠「打这里」（Fx.HanbaPearlMark）：两颗绕着转的青白光点 */
export function pearlMark(ctx: GameContext, pearl: THREE.Vector3, right: THREE.Vector3, t: number): void {
  for (let i = 0; i < 2; i++) {
    const a = t * 5 + i * Math.PI;
    _p.copy(pearl).addScaledVector(right, Math.cos(a) * 0.35).add(new THREE.Vector3(0, Math.sin(a) * 0.35, 0));
    ctx.fx.burst(_p, 0xa5f5f1, 1, 0.1, 0.12, 0.09, 0);
  }
}

/** 强光前兆（Fx.HanbaFlareGather）：脚下一圈收紧的灼点印 */
export function flareGather(ctx: GameContext, ground: THREE.Vector3, radius: number, seconds: number): void {
  ctx.fx.groundWarning(ground, radius, seconds, FLARE);
}

/** 复燃（Fx.HanbaFlare）：日轮巨型爆闪、身上「啪」、脚下金环 */
export function flareBurst(ctx: GameContext, hub: THREE.Vector3, ringRadius: number, body: THREE.Vector3, ground: THREE.Vector3, warnRadius: number): void {
  ctx.fx.explosion(hub, ringRadius * 1.6, FLARE);
  ctx.fx.burst(body, GOLD, 24, 6, 0.6, 0.2, 0);
  ctx.fx.ring(ground, warnRadius * 1.6, SUN, 0.7);
}

/** 泉水喷柱（Fx.SpringSpout）：一根往上冲的水 + 柱脚水花 */
export function springSpout(ctx: GameContext, at: THREE.Vector3, radius: number, height: number): void {
  for (let i = 0; i < 4; i++) ctx.fx.burst(_p.copy(at).setY(at.y + height * (0.2 + i * 0.22)), SPRING, 6, 1.5 + radius, 0.7, 0.24, 4);
  ctx.fx.burst(at, 0xffffff, 10, 3.5, 0.8, 0.22, 6);
  ctx.fx.ring(at, radius * 2.2, SPRING, 0.6);
}

/** 尘浪（Fx.Slam） */
export function slam(ctx: GameContext, at: THREE.Vector3, radius: number, color = SAND): void {
  ctx.fx.ring(at, radius * 1.4, color, 0.55);
  ctx.fx.burst(at, color, 18, radius * 1.4, 0.8, 0.3, 3);
}
