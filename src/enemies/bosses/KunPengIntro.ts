/**
 * 鲲鹏登场（Unity KunPeng/KunPengIntro.cs；2-4 北冥冰台，docs/level-design/boss-intros.md「鲲鹏」）：约 7.6 s。
 *   0.0–2.3 abyss   从玩家眼中拔起，高处环绕俯拍环形冰台和中央冰窟：水面翻涌、一圈圈涟漪，深处一声闷吼
 *   1.8             生成（鲲在水下 13 m；KunPeng 的登场：0.3–2.4 s 升起、2.16 s 吼叫并在冰沿炸一圈）
 *   2.3–4.3 breach  贴着水面的低机位、正对破水点：水柱炸开，鲲破水而出（升起是 KunPeng 的 sunk，这里补水柱、飞沫、短慢动作）
 *   4.3–6.2 pearl   仰拍头部和额前的鲛珠（弱点），名字卡
 *   6.2–7.6         拉回玩家眼睛
 * 锚点：hole = 冰窟圆心（水面高度），breach = 鲲升起的位置（出生点那一侧、离圆心 半径 − 4.6，水面高度）。冰窟由首领在开演前登记（setIntroHole），
 * 没有登记（预览、测试）时按出生点建虚拟冰窟。
 * 与 Unity 的差异（特效精神对齐，M11b 再做逐粒子一致）：水面扰动 / 白沫漩涡 / 水包 / 四面水墙 / 身上淌水（WaterChurn、Surge.Disk / Dome / Sheet、BodyStream）
 * 换成 ctx.fx 的粒子、冲击环与爆炸；破水那一下的屏幕闪白、转场风（IntroFx.Wind）没有移植。
 */
import * as THREE from 'three';
import { Anchors, at, BossIntroScript, Cue, IntroShot, sized, type BossIntroContext } from './intro/BossIntroScript';
import { IceHoleInfo } from './KunPengArena';
import { KunPengDef } from './KunPengDef';

export const HOLE = 'hole';
export const BREACH = 'breach';
const FOAM = 0xeefcff, ICE = KunPengDef.Ice, WARN = KunPengDef.Warn;

let pendingHole: IceHoleInfo | null = null;

/** 首领在开演前登记它的冰窟（锚点按它算） */
export function setIntroHole(hole: IceHoleInfo | null): void {
  pendingHole = hole;
}

function info(c: BossIntroContext): IceHoleInfo {
  const cached = c.bag.get('hole') as IceHoleInfo | undefined;
  if (cached) return cached;
  const h = pendingHole ?? IceHoleInfo.fallback(null, null, c.spawn);
  c.bag.set('hole', h);
  return h;
}

export function buildKunPengIntro(): BossIntroScript {
  const s = new BossIntroScript();
  s.id = KunPengDef.Id;
  s.spawnAt = 1.8;
  s.landSeconds = 1.4;
  s.epithet = '第二章 · 北冥冰台';
  s.anchors.set(HOLE, c => {
    const h = info(c);
    return new THREE.Vector3(h.center.x, h.waterY, h.center.z);
  });
  s.anchors.set(BREACH, c => {
    const h = info(c);
    const theta = h.distance(c.spawn) > 0.5 ? h.angle(c.spawn) : 0;
    const p = h.point(theta, Math.max(1, h.radius - 4.6));
    return p.setY(h.waterY);
  });

  s.shots.push(IntroShot.make('abyss', 2.3)
    .move(at(HOLE, -14, 22, -26), at(HOLE, -4, 17, -24))
    .look(at(HOLE), at(HOLE, 0, 0, 2))
    .fov(56, 50).orbiting().blend(0.8).hand(0.12));
  // 鲲 8 m 高、吼的时候仰头：机位退远一点、视角放宽；放在决斗线左边，拍到的是侧脸而不是背鳍
  s.shots.push(IntroShot.make('breach', 2.0)
    .move(at(BREACH, -8, 1.5, -15), at(BREACH, -6.5, 2.0, -12.5))
    .look(at(BREACH, 0, 1, 0), at(Anchors.Head, 0, 0.5, 0))
    .fov(52, 46).ease('out').hand(0.4));
  // 鲲的头离水面只有 4 m 上下：机位只比头略低，额前的鲛珠露在头顶轮廓上
  s.shots.push(IntroShot.make('pearl', 1.9)
    .move(sized(Anchors.Head, -2.2, -0.35, -7.5), sized(Anchors.Head, -1.4, -0.15, -5.6))
    .look(at(Anchors.Head, 0, 0.5, 0))
    .fov(40, 34).hand(0.35));

  // 水面翻涌：冰窟里到处冒水花，隔一会儿一圈涟漪
  s.cues.push(Cue.every(0.3, 2.3, 0.1, 'churn', c => {
    const h = info(c);
    const a = c.random(0, Math.PI * 2), r = Math.sqrt(c.random(0, 1)) * h.radius * 0.8;
    c.fx?.burst(new THREE.Vector3(h.center.x + Math.sin(a) * r, h.waterY + 0.15, h.center.z + Math.cos(a) * r), ICE, 6, 3.5, 0.7, 0.22, 8);
  }));
  s.cues.push(Cue.every(0.6, 2.3, 0.45, 'ripples', c => {
    const h = info(c);
    const a = c.random(0, Math.PI * 2), r = c.random(0.2, 0.7) * h.radius;
    c.fx?.ring(new THREE.Vector3(h.center.x + Math.sin(a) * r, h.waterY + 0.05, h.center.z + Math.cos(a) * r), c.random(2.5, 4.5), WARN, 0.9);
  }));
  // 破水点上转起白沫漩涡（越转越快、往里收）
  s.cues.push(Cue.every(0.6, 1.8, 0.12, 'whirlpool', c => {
    const b = c.anchor(BREACH);
    const k = (c.elapsed - 0.6) / 1.2;
    const a = c.elapsed * (4 + 8 * k), r = 5.5 * (1 - 0.5 * k);
    c.fx?.burst(new THREE.Vector3(b.x + Math.sin(a) * r, b.y + 0.1, b.z + Math.cos(a) * r), FOAM, 4, 1.5, 0.6, 0.2, 2);
  }));
  // 破水前一刻水面鼓起
  s.cues.push(Cue.call(1.55, 'dome', c => {
    const b = c.anchor(BREACH);
    c.fx?.ring(b, 4.2, FOAM, 0.6);
    c.fx?.burst(b, FOAM, 16, 2, 0.6, 0.3, 2);
  }));
  s.cues.push(Cue.shake(0.8, 0.2, 0.8));
  s.cues.push(Cue.sfx(0.9, 'boss_roar', HOLE, 0.5, 0.45));
  s.cues.push(Cue.shake(1.7, 0.35, 0.6));
  // 破水：冲天水柱、水冠、大涟漪、白沫
  s.cues.push(Cue.call(2.15, 'breach', c => {
    const w = c.anchor(BREACH);
    const fx = c.fx;
    if (!fx) return;
    for (let i = 0; i < 7; i++) fx.burst(w.clone().setY(w.y + 2.1 * i), FOAM, 12, 3, 1.0, 0.4, 7);
    fx.explosion(w.clone().setY(w.y + 0.5), 4.5, ICE);
    fx.burst(w.clone().setY(w.y + 0.3), FOAM, 60, 12, 1.2, 0.36, 9);
    fx.burst(w.clone().setY(w.y + 0.3), ICE, 30, 7, 1.4, 0.5, 5);
    fx.ring(w, 10, WARN, 1);
    fx.ring(w, 6, 0xffffff, 0.7);
    c.sfx('boss_slam', w, 0.8, 0.55);
    c.shake(0.5, 0.7);
  }));
  s.cues.push(Cue.every(2.2, 3.6, 0.07, 'spray', c => {
    const a = c.random(0, Math.PI * 2), r = c.random(2.5, 5.5) * Math.max(0.8, c.size * 0.6);
    const b = c.anchor(BREACH);
    c.fx?.burst(new THREE.Vector3(b.x + Math.sin(a) * r, b.y + 0.2, b.z + Math.cos(a) * r), FOAM, 5, 5, 0.8, 0.25, 10);
  }));
  // 出水后身上一路淌水
  s.cues.push(Cue.every(2.3, 4.6, 0.1, 'body streams', c => {
    if (!c.boss) return;
    const body = c.anchor(Anchors.Body);
    c.fx?.burst(body.setY(body.y + c.random(-1.5, 2.5)), FOAM, 2, 0.6, 0.9, 0.16, 9);
  }));
  s.cues.push(Cue.slowMo(3.0, 0.4, 0.35));
  s.cues.push(Cue.nameCard(4.5, 2.5));
  return s;
}

export const kunPengIntro = buildKunPengIntro();
