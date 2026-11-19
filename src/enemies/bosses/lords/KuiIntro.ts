/**
 * 夔 · 登场「雷暴压境」（Unity Kui/KuiIntro.cs；8.0 s，镜头表 docs/art/ch4-boss-intros.json kui）：
 *   0.0–2.3 establish 山头全景，绕残鼓慢慢环绕（距 40 m、高 17 m）；开头起高原雷暴（M7），0.9 / 1.4 / 1.9 s 三道雷劈在残鼓上
 *   2.3     生成（Kui 的登场：2.3–4.5 s 从残鼓里一节节长出来，4.5 s 一足落地 + 双拳砸地，之后仰头吼）
 *   2.3–4.9 reveal 贴地低机位仰拍残鼓（距 11 → 9.5 m、高 1.3 m），看点跟着长高
 *   4.9–6.6 closeup 正面略低特写（过渡 0.5 s），5.0 s 名字卡「夔 · 一足之雷」
 *   6.6–8.0 land 过肩机位 → 平滑推进眼睛（零误差交还）
 * 锚点 drum = 残鼓（夔在开演前登记 setKuiIntroDrum；没有时在首领出生点上方 0.9 m）。
 * 雷暴与劈残鼓的雷走 KuiStorm 的适配层（M7 接上前：雷暴不起，劈残鼓只剩残鼓自己的裂光和震动）。
 */
import * as THREE from 'three';
import { Anchors, at, BossIntroScript, Cue, IntroShot, type BossIntroContext } from '../intro/BossIntroScript';
import { KuiDef } from './KuiDef';
import type { KuiDrum } from './KuiDrum';
import { KuiPalette } from './KuiPlans';
import { kuiEnsureStorm, kuiStrike } from './KuiStorm';
import { addLand } from './LordIntros';

export const DRUM = 'drum';

let pendingDrum: KuiDrum | null = null;

/** 夔在开演前登记残鼓（锚点按它算） */
export function setKuiIntroDrum(drum: KuiDrum | null): void {
  pendingDrum = drum;
}

const drumAt = (c: BossIntroContext): THREE.Vector3 => pendingDrum ? pendingDrum.center() : c.spawn.clone().setY(c.spawn.y + 0.9);
/** 夹角都以「残鼓 → 玩家」为 0（决斗坐标里是 −Z）；a 弧度往左转 */
const around = (a: number, r: number, h: number) => at(DRUM, -Math.sin(a) * r, h, -Math.cos(a) * r);

export function buildKuiIntro(): BossIntroScript {
  const s = new BossIntroScript();
  s.id = KuiDef.Id;
  s.spawnAt = 2.3;
  s.epithet = '4-1 · 经幡山头';
  s.anchors.set(DRUM, c => drumAt(c));
  s.shots.push(IntroShot.make('establish', 2.3)
    .move(around(1.05, 40, 17), around(0.85, 40, 17))
    .look(at(DRUM, 0, 2, 0))
    .fov(50).orbiting().blend(0.5).hand(0.12));
  s.shots.push(IntroShot.make('reveal', 2.6)
    .move(around(0.35, 11, 0.4), around(0.35, 9.5, 0.4))
    .look(at(DRUM, 0, -0.4, 0), at(DRUM, 0, 3.4, 0))
    .fov(48).hand(0.25));
  s.shots.push(IntroShot.make('closeup', 1.7)
    .move(around(0.12, 7.5, 1.7), around(0.12, 6.9, 1.7))
    .look(at(Anchors.Head, 0, -0.4, 0))
    .fov(44).blend(0.5).hand(0.3));
  addLand(s, 1.4);
  // 高原雷暴（夔的出场条件）：开演就压境，夔死后退场
  s.cues.push(Cue.call(0, 'storm', c => kuiEnsureStorm(c.center), true));
  for (const t of [0.9, 1.4, 1.9]) {
    s.cues.push(Cue.call(t, 'bolt on drum', c => {
      const p = pendingDrum ? pendingDrum.object.getWorldPosition(new THREE.Vector3()) : c.spawn.clone();
      kuiStrike(p, { warn: 0, radius: 3.2, damage: 0, source: null, noTelegraph: true, ignoreConductors: true, height: 45 });
      pendingDrum?.strike();
      c.shake(0.2, 0.35);
    }));
  }
  s.cues.push(Cue.every(2.3, 4.5, 0.12, 'storm clouds', c => {
    const p = drumAt(c);
    c.fx?.burst(p.setY(p.y + 1.5), KuiPalette.Cloud, 4, 1.6, 0.9, 0.7, 0);
  }));
  s.cues.push(Cue.sfx(0.9, 'boss_roar', DRUM, 0.4, 0.7));
  s.cues.push(Cue.nameCard(5.0, 2.6));
  return s;
}

export const kuiIntro = buildKuiIntro();
