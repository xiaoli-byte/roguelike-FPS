/**
 * 熔心魔将登场（Unity Bosses/Warlord/WarlordIntro.cs；3-3 铸范大坊 · 神范台 / 火神殿，docs/level-design/boss-intros.md「熔心魔将」）：约 6.5 s。
 *   0.0–2.0 vista   贴地后退的 establish：熔池、圆环与塔顶同框，沿竖直熔岩柱慢慢仰起——余烬往上飘，高处一团火光，魔将拖火下坠
 *   1.6             生成（Warlord 的登场：从 34 m 高处 1.04 s 砸下来、身后拖火，落地爆炸 + 火环 + 重震；70% 时咆哮）
 *   2.0–3.3 impact  首领后侧低机位 reveal 跟拍下坠，2.66 s 落地：熔铜四溅、地面一圈火环、闪屏、短慢动作
 *   3.3–5.2 roar    略低于头的特写（角盔露全），咆哮，余烬绕身，名字卡
 *   5.2–6.5         拉回玩家眼睛
 * 下坠 / 落地 / 咆哮的身体姿态是片段（fall / introLand / roar，WarlordPoses.ts），火尾、熔铜冠、余烬只加强这些关键姿势。
 * 与 Unity 的差异：镜头转场的风（IntroFx.Wind）没有移植；天上那团火光（Fx.SunFlare / Flash）换成 ctx.fx 的爆炸 + 火星。
 */
import * as THREE from 'three';
import { Anchors, at, BossIntroScript, Cue, IntroShot, sized } from './intro/BossIntroScript';
import { EMBERS, FIRE } from './WarlordDef';

const COPPER = 0xffb347, SLAG = 0xff7a1a;
export const THRONE = 'fireGodThrone';

/** arenaCenter：首领场地中心（场景文档 bosses[0].center）；没有时按出生点 */
export function buildWarlordIntro(arenaCenter: THREE.Vector3 | null = null): BossIntroScript {
  const s = new BossIntroScript();
  s.id = 'boss_warlord';
  s.spawnAt = 1.6;
  s.landSeconds = 1.3;
  s.epithet = '第三章 · 铸范大坊 · 神范台';
  s.anchors.set(THRONE, c => (arenaCenter ? arenaCenter.clone() : c.spawn.clone()).add(new THREE.Vector3(0, 31, 0)));

  // establish：贴地后退，熔池在画面下沿、圆环与塔顶都在画里，视线沿熔岩柱慢慢抬升
  s.shots.push(IntroShot.make('vista', 2.0)
    .move(at(Anchors.Player, 0, 2, -18), at(Anchors.Player, 2, 2.5, -22))
    .look(at(THRONE, 0, -12, 0), at(THRONE, 0, 0, 0))
    .fov(58, 54).blend(0.9).hand(0.15));
  // reveal：从首领后侧低机位跟拍，首领与王座、圆环、熔岩柱同向
  s.shots.push(IntroShot.make('impact', 1.3)
    .move(at(Anchors.Spawn, 7, 1.2, 15), at(Anchors.Spawn, 5, 1.5, 13))
    .look(at(Anchors.Model, 0, 2, 0), at(Anchors.Model, 0, -0.3, 0))
    .fov(58, 54).ease('out').hand(0.3));
  // 角盔要露全：机位只比头低一点
  s.shots.push(IntroShot.make('roar', 1.9)
    .move(sized(Anchors.Head, 2.0, -0.6, -5.8), sized(Anchors.Head, 1.2, -0.4, -4.4))
    .look(at(Anchors.Head, 0, 0.15, 0))
    .fov(42, 36).hand(0.35));

  // 余烬从神范台那边往上飘，高处闷雷
  s.cues.push(Cue.every(0.2, 2.0, 0.12, 'embers', c => {
    const p = c.spawn.clone().add(c.duel(new THREE.Vector3(c.random(-6, 6), c.random(0.2, 1.5), c.random(-2, 10))));
    c.fx?.burst(p, EMBERS, 4, 1.6, 1.4, 0.12, -2.5);
  }));
  s.cues.push(Cue.shake(0.6, 0.2, 0.7));
  s.cues.push(Cue.sfx(1.2, 'skill_fire', Anchors.Spawn, 0.55, 0.6));
  s.cues.push(Cue.call(1.45, 'sky glow', c => {
    const sky = c.spawn.clone().add(new THREE.Vector3(0, 30, 0));
    c.fx?.burst(sky, FIRE, 30, 4, 0.8, 0.6, -1);
    c.fx?.explosion(sky, 3.5, FIRE);
  }));
  // 落地（生成后 1.04 s）：砸地本身在 Warlord.land；这里再往外甩一圈远一点的熔铜（落在 5–8 m）
  s.cues.push(Cue.call(2.66, 'copper splash', c => {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + c.random(-0.4, 0.4), r = c.random(5, 8) * Math.max(0.8, c.size);
      const p = c.spawn.clone().add(new THREE.Vector3(Math.sin(a) * r, 0.3, Math.cos(a) * r));
      c.fx?.burst(p, i % 2 === 0 ? COPPER : SLAG, 12, 4, 0.6, 0.18, 14);
    }
  }));
  s.cues.push(Cue.slowMo(2.68, 0.3, 0.35));
  s.cues.push(Cue.every(2.75, 3.3, 0.09, 'droplets', c => {
    const a = c.random(0, Math.PI * 2), r = c.random(3, 8);
    const p = c.spawn.clone().add(new THREE.Vector3(Math.sin(a) * r, 0.2, Math.cos(a) * r));
    c.fx?.burst(p, COPPER, 5, 4, 0.6, 0.16, 14);
  }));
  s.cues.push(Cue.every(3.3, 5.2, 0.15, 'rage embers', c => {
    if (!c.boss) return;
    const a = c.random(0, Math.PI * 2), r = c.random(0.8, 2.2) * Math.max(0.8, c.size);
    const p = c.boss.position.clone().add(new THREE.Vector3(Math.sin(a) * r, c.random(0.2, 1.5), Math.cos(a) * r));
    c.fx?.burst(p, EMBERS, 3, 1.4, 1.1, 0.1, -3);
  }));
  s.cues.push(Cue.nameCard(3.6, 2.5));
  return s;
}

export const warlordIntro = buildWarlordIntro();
