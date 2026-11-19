/**
 * 化蛇 · 登场「湖动」（Unity Huashe/HuasheIntro.cs；7.8 s，镜头表 docs/art/ch4-boss-intros.json huashe）：
 *   0.0–2.0 establish 玩家身后高处俯瞰湖面（身后 10 m、高 12 → 10 m），看点从湖心移到冒头的地方：湖面起涟漪
 *   0.4     生成（Huashe 的登场：水下游 2.2 s，2.6 s 破水而出、张翼，之后张嘴吼）
 *   2.0–4.2 reveal 贴水面低机位（离冒头点 15 m、侧 4 m、高出水面 1 m），看点从水面升到头
 *   4.2–6.4 closeup 人面特写（过渡 0.4 s），4.4 s 名字卡「化蛇 · 人面豺身，鸟翼蛇行」
 *   6.4–7.8 land 过肩机位 → 平滑推进眼睛
 * 锚点 lake = 湖心（水面高度），rise = 冒头的地方（首领出生点；生成后 = 首领位置）。湖由化蛇在开演前登记（setHuasheIntroLake）。
 */
import * as THREE from 'three';
import { Anchors, at, BossIntroScript, Cue, IntroShot } from '../intro/BossIntroScript';
import { HuasheDef } from './HuasheDef';
import type { HuasheLake } from './HuasheLake';
import { HuashePalette } from './HuashePlans';
import { addLand } from './LordIntros';

export const LAKE = 'lake', RISE = 'rise';

let pendingLake: HuasheLake | null = null;

/** 化蛇在开演前登记它的湖（锚点按它算） */
export function setHuasheIntroLake(lake: HuasheLake | null): void {
  pendingLake = lake;
}

export function buildHuasheIntro(): BossIntroScript {
  const s = new BossIntroScript();
  s.id = HuasheDef.Id;
  s.spawnAt = 0.4;
  s.epithet = '4-1 · 圣湖海子';
  s.anchors.set(LAKE, c => pendingLake ? pendingLake.center.clone() : c.center.clone());
  s.anchors.set(RISE, c => c.boss && c.boss.alive ? c.boss.position.clone() : c.spawn.clone());
  s.shots.push(IntroShot.make('establish', 2.0)
    .move(at(Anchors.Player, 0, 12, -10), at(Anchors.Player, 0, 10, -10))
    .look(at(LAKE), at(RISE))
    .fov(55).blend(0.5).hand(0.1));
  s.shots.push(IntroShot.make('reveal', 2.2)
    .move(at(RISE, 4, 1.3, -15), at(RISE, 4, 1.3, -14))
    .look(at(RISE, 0, 0.5, 0), at(Anchors.Head))
    .fov(50).hand(0.25));
  s.shots.push(IntroShot.make('closeup', 2.2)
    .move(at(Anchors.Head, 0, 0.4, -6.5), at(Anchors.Head, 0, 0.4, -5.8))
    .look(at(Anchors.Head))
    .fov(44).blend(0.4).hand(0.3));
  addLand(s, 1.4);
  s.cues.push(Cue.every(0, 2.6, 0.15, 'lake bubbles', c => {
    const p = c.anchor(LAKE);
    c.fx?.ring(new THREE.Vector3(p.x + c.random(-12, 12), p.y + 0.05, p.z + c.random(-12, 12)), c.random(0.8, 1.6), HuashePalette.Shallow, 0.9);
  }));
  s.cues.push(Cue.sfx(1.4, 'boss_roar', RISE, 0.35, 0.6));
  s.cues.push(Cue.nameCard(4.4, 2.6));
  return s;
}

export const huasheIntro = buildHuasheIntro();
