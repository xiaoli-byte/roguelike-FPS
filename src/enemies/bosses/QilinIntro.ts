/**
 * 火麒麟登场（Unity Qilin/QilinIntro.cs；3-4 祝融炉心，docs/level-design/boss-intros.md「火麒麟」）：约 7.0 s。
 *   0.0–2.4 furnace 从玩家眼中拔起，殿内中景：熔池咕嘟冒泡、一圈圈热浪，镜头仰到悬在池上的青铜巨鼎——鼎被地底的震动晃起来
 *   2.0             生成（Qilin.introTick：熔池喷出熔岩柱，0.38–1.44 s 从池心跃起划一道 7 m 高的弧落到出生点，落地人立长啸）
 *   2.4–3.8 leap    侧面机位跟拍跃出的弧线（看点 = 模型），弧顶短慢动作、带出的熔浆往下滴，鼎被带得猛晃
 *   3.8–5.7 rear    仰拍人立长啸的麒麟，巨鼎在它头顶后方，名字卡
 *   5.7–7.0         拉回玩家眼睛
 * 锚点：pool = 熔池圆心，cauldron = 吊鼎的鼎身（没有就熔池上方 7.2 m）。
 * 与 Unity 的差异（特效精神对齐，M11b 再做逐粒子一致）：熔浆冠 / 身上流泻 / 熔浆尾（Surge.Crown / BodyStream / Trail）换成 ctx.fx 的粒子、冲击环与爆炸；
 * 转场风（IntroFx.Wind）没有移植（同旱魃）。
 */
import * as THREE from 'three';
import { Anchors, at, BossIntroScript, Cue, IntroShot, sized, type BossIntroContext } from './intro/BossIntroScript';
import { QilinDef } from './QilinDef';

export const POOL = 'pool';
export const CAULDRON = 'cauldron';

/** 演出看到的火麒麟场地（Qilin 在 onModelReady 里登记） */
export interface QilinIntroStage {
  pool: THREE.Vector3;
  poolRadius: number;
  cauldron(): THREE.Vector3 | null;
  rattle(amount: number): void;
}

function stage(c: BossIntroContext): QilinIntroStage | null {
  return (c.bag.get('qilin') as QilinIntroStage | undefined) ?? null;
}

function poolRadius(c: BossIntroContext): number {
  return stage(c)?.poolRadius ?? 6;
}

export function buildQilinIntro(): BossIntroScript {
  const s = new BossIntroScript();
  s.id = QilinDef.Id;
  s.spawnAt = 2.0;
  s.landSeconds = 1.3;
  s.epithet = '第三章 · 祝融炉心';
  s.anchors.set(POOL, c => stage(c)?.pool.clone() ?? c.center.clone());
  s.anchors.set(CAULDRON, c => stage(c)?.cauldron() ?? c.anchor(POOL).add(new THREE.Vector3(0, 7.2, 0)));

  // 殿内中景、正对熔池、比柱头略高：熔池在下半、整只吊鼎连同链子在上半，镜头从池面慢慢仰到鼎腹
  s.shots.push(IntroShot.make('furnace', 2.4)
    .move(at(POOL, 0.5, 5.2, -17.5), at(POOL, -1, 5.8, -15.5))
    .look(at(POOL, 0, 2, 0), at(CAULDRON, 0, -2, 0))
    .fov(56, 50).blend(0.7).hand(0.2));
  s.shots.push(IntroShot.make('leap', 1.4)
    .move(at(POOL, 12, 1.6, -3), at(POOL, 11, 2.2, -1.5))
    .look(at(Anchors.Model))
    .fov(54, 50).ease('out').hand(0.3));
  s.shots.push(IntroShot.make('rear', 1.9)
    .move(sized(Anchors.Head, -2.0, -1.8, -5.8), sized(Anchors.Head, -1.3, -1.5, -4.4))
    .look(at(Anchors.Head, 0, 0.3, 0))
    .fov(42, 36).hand(0.35));

  // 熔池涌动
  s.cues.push(Cue.every(0.2, 2.4, 0.09, 'lava bubbles', c => {
    const r = poolRadius(c);
    const a = c.random(0, Math.PI * 2), d = Math.sqrt(c.random(0, 1)) * r * 0.85;
    const p = c.anchor(POOL).add(new THREE.Vector3(Math.sin(a) * d, 0.1, Math.cos(a) * d));
    c.fx?.burst(p, c.random(0, 1) < 0.5 ? QilinDef.Fire : QilinDef.Hot, 5, 3, 0.7, 0.22, 7);
  }));
  s.cues.push(Cue.every(0.4, 2.4, 0.35, 'heat rings', c =>
    c.fx?.ring(c.anchor(POOL).add(new THREE.Vector3(0, 0.1, 0)), poolRadius(c) * c.random(0.5, 1), QilinDef.Warn, 0.8)));
  // 吊鼎被地底的震动晃起来
  s.cues.push(Cue.call(0.5, 'cauldron sway', c => {
    stage(c)?.rattle(2.5);
    c.sfx('boss_slam', c.anchor(CAULDRON), 0.35, 0.5);
  }));
  s.cues.push(Cue.shake(0.6, 0.2, 0.7));
  s.cues.push(Cue.call(1.5, 'cauldron jolt', c => {
    stage(c)?.rattle(3.5);
    c.sfx('explosion', c.anchor(POOL), 0.5, 0.5);
    c.shake(0.35, 0.6);
  }));
  // 熔池炸开、麒麟跃出
  s.cues.push(Cue.call(2.0, 'eruption', c => {
    const p = c.anchor(POOL);
    const up = p.clone().add(new THREE.Vector3(0, 0.3, 0));
    const fx = c.fx;
    if (fx) {
      fx.explosion(up, 3.6, QilinDef.Fire);
      fx.ring(p.clone().add(new THREE.Vector3(0, 0.15, 0)), poolRadius(c) * 0.9, QilinDef.Hot, 0.7);
      fx.burst(up, QilinDef.Hot, 24, 6, 1.2, 0.45, 4);
      for (let i = 0; i < 4; i++) fx.burst(p.clone().add(new THREE.Vector3(0, 1.2 * i, 0)), QilinDef.Fire, 10, 3, 0.8, 0.35, 6);
    }
    c.sfx('explosion', up, 0.7, 0.6);
    c.shake(0.4, 0.6);
  }));
  // 跃起：身上一路往下滴熔浆
  s.cues.push(Cue.every(2.4, 3.4, 0.12, 'lava drips', c => {
    const m = c.anchor(Anchors.Model);
    c.fx?.burst(m.add(new THREE.Vector3(c.random(-1, 1), c.random(-1, 1), c.random(-1, 1))), c.random(0, 1) < 0.5 ? QilinDef.Fire : QilinDef.Hot, 4, 1.2, 0.8, 0.22, 9);
  }));
  s.cues.push(Cue.slowMo(2.9, 0.4, 0.3));
  s.cues.push(Cue.call(2.95, 'cauldron swing', c => stage(c)?.rattle(4)));
  s.cues.push(Cue.nameCard(4.0, 2.5));
  return s;
}

export const qilinIntro = buildQilinIntro();
