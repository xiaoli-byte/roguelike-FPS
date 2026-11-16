/**
 * 旱魃登场（Unity Hanba/HanbaIntro.cs；1-4 鸣沙山月牙泉，docs/level-design/boss-intros.md「旱魃」）：约 7.9 s。
 *   0.0–2.6 basin   从玩家眼中拔起，摇臂下压俯拍沙山盆地：月牙泉、泉南的月牙阁都在画里，泉心开始冒泡、沙山闷响
 *   2.2             旱魃现身（她自己的 intro 片段：蜷起 → 舒展长啸，4 s；长啸在片段 58% = 4.5 s，日轮炸亮 + 慢动作）
 *   2.6–4.5 emerge  泉边贴水面的低机位微微抬起、仰拍：泉心炸开，旱魃从水下 6 m 缓缓升起（代码驱动模型位移），水沙飞溅、身上金光褪去
 *   4.5–6.5 roar    正面略偏的特写推近：竖悬在头顶后方的日轮正好衬在头后；长啸，名字卡
 *   6.5–7.9         沿着决斗线拉回玩家眼睛
 * 与 Unity 的差异（特效精神对齐，M11b 再做逐粒子一致）：泉面翻涌 / 水包 / 三面水幕 / 身上流泻（WaterChurn、Surge.Dome / Sheet、BodyStream、WetPatch）
 * 换成网页 ctx.fx 的粒子、冲击环与爆炸；转场风（IntroFx.Wind）没有移植。
 */
import * as THREE from 'three';
import { stageHooks } from './framework/StageHooks';
import { Anchors, at, BossIntroScript, Cue, IntroShot, sized, type BossIntroContext } from './intro/BossIntroScript';
import { ease } from './intro/IntroMath';

export const RISE_DEPTH = 6;
export const RISE_SECONDS = 1.6;
const WATER = 0xbfe6e0, GOLD = 0xffd27a, SAND = 0xd9b27a;

/** 泉心的水面（有水时）/ 出生点 */
function surface(c: BossIntroContext): THREE.Vector3 {
  const cached = c.bag.get('surface') as THREE.Vector3 | undefined;
  if (cached) return cached.clone();
  const p = c.spawn.clone();
  const water = stageHooks.water;
  if (water) {
    const d = water.depthAt(p, true);
    if (d > 0) p.y += d;
  }
  c.bag.set('surface', p.clone());
  return p;
}

/** 场地里有月牙泉的水（1-4）：水花用水色，没有时用沙色 */
function hasSpring(c: BossIntroContext): boolean {
  const cached = c.bag.get('spring') as boolean | undefined;
  if (cached !== undefined) return cached;
  const has = !!stageHooks.water?.waterBodies().some(b => b.spring || /crescent ?spring/i.test(b.name));
  c.bag.set('spring', has);
  return has;
}

export function buildHanbaIntro(): BossIntroScript {
  const s = new BossIntroScript();
  s.id = 'boss_hanba';
  s.spawnAt = 2.2;
  s.landSeconds = 1.4;
  s.epithet = '第一章 · 鸣沙山月牙泉';

  s.shots.push(IntroShot.make('basin', 2.6)
    .move(at(Anchors.Spawn, -16, 30, -52), at(Anchors.Spawn, -7, 20, -38))
    .look(at(Anchors.Spawn, 0, 1, 8), at(Anchors.Spawn, 0, 2, 0))
    .fov(52, 46).blend(0.9).hand(0.12));
  s.shots.push(IntroShot.make('emerge', 1.9)
    .move(at(Anchors.Spawn, 6.5, 0.8, -11.5), at(Anchors.Spawn, 5, 2.0, -10))
    .look(at(Anchors.Spawn, 0, 1.5, 0), at(Anchors.Head, 0, -0.6, 0))
    .fov(48, 44).ease('out').hand(0.3));
  s.shots.push(IntroShot.make('roar', 2.0)
    .move(sized(Anchors.Head, 1.6, 0, -6.6), sized(Anchors.Head, 0.7, 0, -5.0))
    .look(at(Anchors.Head, 0, 0.3, 0))
    .fov(42, 36).hand(0.3));

  // 泉心冒泡、沙山闷响
  s.cues.push(Cue.every(0.5, 2.2, 0.14, 'spring bubbles', c => {
    const p = c.spawn.clone().add(new THREE.Vector3(c.random(-1.5, 1.5), 0.2, c.random(-1.5, 1.5)));
    p.y = surface(c).y + 0.1;
    c.fx?.burst(p, hasSpring(c) ? WATER : SAND, 5, 2.5, 0.6, 0.18, 6);
  }));
  // 1.6 s 起鼓起一个水包 / 沙包
  s.cues.push(Cue.call(1.6, 'spring dome', c => {
    const w = surface(c);
    c.fx?.ring(w, 2.4, hasSpring(c) ? WATER : SAND, 0.6);
    c.fx?.burst(w, hasSpring(c) ? WATER : SAND, 14, 1.5, 0.6, 0.3, 2);
  }));
  s.cues.push(Cue.shake(0.7, 0.2, 0.8));
  s.cues.push(Cue.sfx(1.2, 'boss_roar', Anchors.Spawn, 0.45, 0.5));
  s.cues.push(Cue.shake(1.8, 0.35, 0.6));
  // 现身那一刻：泉心炸开——冲天水柱、水冠、大涟漪（没有泉水：沙柱）
  s.cues.push(Cue.call(2.2, 'spring burst', c => {
    const w = surface(c);
    const spring = hasSpring(c);
    const color = spring ? WATER : SAND;
    const fx = c.fx;
    if (!fx) return;
    for (let i = 0; i < 6; i++) fx.burst(w.clone().setY(w.y + 1.4 * i), color, 10, 2.5, 0.9, 0.35, 6);
    fx.explosion(w.clone().setY(w.y + 0.4), 3.2, color);
    fx.ring(w, 9, color, 0.9);
    fx.ring(w, 5, 0xffffff, 0.6);
    fx.burst(c.spawn.clone().setY(c.spawn.y + 0.4), SAND, 24, 6, 1.2, 0.4, 3);
    fx.ring(c.spawn.clone().setY(c.spawn.y + 0.1), 8, SAND, 0.8);
    c.sfx('boss_slam', c.spawn, 0.7, 0.6);
    c.shake(0.45, 0.6);
  }));
  // 升起时水线上一圈飞溅、身上往下淌水 / 泻沙
  s.cues.push(Cue.every(2.25, 2.2 + RISE_SECONDS, 0.08, 'rise spray', c => {
    const a = c.random(0, Math.PI * 2), r = c.random(1.2, 2.8) * Math.max(0.8, c.size);
    const p = c.spawn.clone().add(new THREE.Vector3(Math.sin(a) * r, 0.3, Math.cos(a) * r));
    p.y = surface(c).y + 0.3;
    c.fx?.burst(p, hasSpring(c) ? WATER : SAND, 6, 4, 0.7, 0.2, 9);
    const body = c.anchor(Anchors.Body);
    c.fx?.burst(body.setY(body.y + c.random(-1, 1.5)), hasSpring(c) ? WATER : SAND, 2, 0.6, 0.8, 0.16, 8);
  }));
  s.cues.push(Cue.call(3.9, 'wet patch', c => c.fx?.ring(surface(c), 5, hasSpring(c) ? WATER : SAND, 0.8)));
  s.cues.push(Cue.nameCard(4.8, 2.6));

  s.onTick = (c) => {
    if (!c.boss) return;
    const t = c.sinceSpawn;
    // 没有破水片段：模型从泉下 RISE_DEPTH 米升起（ease-out），身上的金光跟着褪去；跳过时按落地进度赶完
    let rise = t / RISE_SECONDS, fade = t / 2.4;
    if (c.skipped) {
      rise = Math.max(rise, c.landProgress);
      fade = Math.max(fade, c.landProgress);
    }
    const k = ease('out', rise);
    if (k < 1) c.offsetModel(new THREE.Vector3(0, -RISE_DEPTH * (1 - k), 0));
    c.overlay(GOLD, Math.min(1, Math.max(0, 1 - fade)) * 0.55);
  };
  return s;
}

export const hanbaIntro = buildHanbaIntro();
