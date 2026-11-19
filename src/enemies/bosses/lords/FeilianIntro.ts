/**
 * 飞廉 · 登场「风涡」（Unity Feilian/FeilianIntro.cs；7.8 s，镜头表 docs/art/ch4-boss-intros.json feilian）：
 *   0.0–2.2 establish 冰舌下方仰拍风涡柱（距 34 m、高 5 m，看点从 30 m 降到 26 m）：风声骤起，风涡柱收紧
 *   1.0     生成（Feilian 的登场：1.0–4.0 s 从 40 m 高的风涡里盘旋落下，4.0 s 落地炸开一圈雪，之后人立长嘶）
 *   2.2–4.4 reveal 跟拍盘旋落下（过渡 0.5 s，距 18 m、高 4 m，看着模型）
 *   4.4–6.4 closeup 正面 3/4 特写（过渡 0.45 s），4.6 s 名字卡「飞廉 · 风伯」
 *   6.4–7.8 land 过肩机位 → 平滑推进眼睛
 * 锚点 land = 落地点（首领出生点）。与 Unity 的差异：风涡收紧 / 盘旋落雪的 Fx.FeilianGather 换成 ctx.fx 粒子。
 */
import * as THREE from 'three';
import { Anchors, at, BossIntroScript, Cue, IntroShot } from '../intro/BossIntroScript';
import { FeilianDef } from './FeilianDef';
import { FeilianPalette } from './FeilianPlans';
import { addLand } from './LordIntros';

export const LAND = 'land';
const around = (a: number, r: number, h: number) => at(LAND, -Math.sin(a) * r, h, -Math.cos(a) * r);

export function buildFeilianIntro(): BossIntroScript {
  const s = new BossIntroScript();
  s.id = FeilianDef.Id;
  s.spawnAt = 1.0;
  s.epithet = '4-1 · 冰川口';
  s.anchors.set(LAND, c => c.spawn.clone());
  s.shots.push(IntroShot.make('establish', 2.2)
    .move(around(0.55, 34, 5), around(0.4, 34, 5))
    .look(at(LAND, 0, 30, 0), at(LAND, 0, 26, 0))
    .fov(56).orbiting().blend(0.5).hand(0.15));
  s.shots.push(IntroShot.make('reveal', 2.2)
    .move(around(0.3, 18, 4), around(0.3, 18, 4))
    .look(at(Anchors.Model, 0, 2, 0))
    .fov(50).blend(0.5).hand(0.25));
  s.shots.push(IntroShot.make('closeup', 2.0)
    .move(around(0.25, 9, 3.2), around(0.25, 8.2, 3.2))
    .look(at(Anchors.Head))
    .fov(45).blend(0.45).hand(0.3));
  addLand(s, 1.4);
  // 风声骤起：开演就在落地点卷雪、风线往风涡收
  s.cues.push(Cue.every(0, 4, 0.1, 'vortex gather', c => {
    const p = c.anchor(LAND);
    const a = c.random(0, Math.PI * 2), r = c.random(6, 16);
    c.fx?.burst(new THREE.Vector3(p.x + Math.sin(a) * r, p.y + 14 + c.random(-6, 6), p.z + Math.cos(a) * r), FeilianPalette.Wind, 5, -6, 0.6, 0.2, 0);
  }));
  s.cues.push(Cue.sfx(0.2, 'boss_roar', LAND, 0.4, 1.4));
  s.cues.push(Cue.shake(4.0, 0.4, 0.5));
  s.cues.push(Cue.nameCard(4.6, 2.6));
  return s;
}

export const feilianIntro = buildFeilianIntro();
