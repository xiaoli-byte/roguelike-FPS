/**
 * 4-1 领主登场 / 死亡演出的公用镜头（Unity LordIntros.AddLand、LordCinema 的镜头表部分；docs/art/ch4-boss-intros.json 的 land 与第三段）。
 * 纯数据（只依赖 intro/BossIntroScript），node 测试直接读；播放在 LordCinema.ts。
 */
import type * as THREE from 'three';
import { Anchors, at, BossIntroScript, Cue, IntroShot } from '../intro/BossIntroScript';
import type { LordDeathSpec } from './LordDef';

/** 过肩机位（米）与视角（Unity LordCinema.Shoulder*） */
export const SHOULDER_BACK = 3.2, SHOULDER_UP = 0.9, SHOULDER_RIGHT = 0.9, SHOULDER_FOV = 60;
/** 过肩机位那一镜的时长：一切到这里就开始落回 */
export const SHOULDER_SHOT = 0.12;
/** 死亡演出的看点锚点（倒下那一刻的身体中心） */
export const FALL = 'fall';

/**
 * 登场 / 死亡演出的最后两段：过肩机位（玩家眼睛后 3.2 m、上 0.9 m、右 0.9 m，看着首领身体）硬切一镜 → 落回第一人称 landSeconds − 0.12 秒。
 * 整段 land 的起止和镜头表一致
 */
export function addLand(s: BossIntroScript, landSeconds: number): void {
  const shot = IntroShot.make('land', SHOULDER_SHOT)
    .hold(at(Anchors.Eye, SHOULDER_RIGHT, SHOULDER_UP, -SHOULDER_BACK))
    .look(at(Anchors.Body))
    .fov(SHOULDER_FOV).hand(0);
  shot.clearance = false;
  s.shots.push(shot);
  s.landSeconds = Math.max(0.6, landSeconds - SHOULDER_SHOT);
}

/**
 * 领主的死亡演出镜头表：show 绕倒下的领主转半圈（看点 = 倒下那一刻的身体中心），开头 slowSeconds 秒 slowScale 倍慢放、cardAt 起名字卡；
 * land 过肩机位 → 落回第一人称（合计 landSeconds）
 */
export function buildLordDeathScript(bossId: string, spec: LordDeathSpec, fall: () => THREE.Vector3): BossIntroScript {
  const s = new BossIntroScript();
  s.id = `${bossId}:death`;
  s.spawnAt = 0;
  s.epithet = spec.epithet || null;
  s.anchors.set(FALL, () => fall());
  const around = (a: number) => at(FALL, -Math.sin(a) * spec.radius, spec.height - 1.5, -Math.cos(a) * spec.radius);
  s.shots.push(IntroShot.make('show', spec.showSeconds)
    .move(around(spec.orbitFrom), around(spec.orbitTo))
    .look(at(FALL, 0, spec.lookHeight - 1.5, 0))
    .fov(55).orbiting().ease('inOut').blend(0.6).hand(0.12));
  addLand(s, spec.landSeconds);
  if (spec.slowScale > 0 && spec.slowScale < 1 && spec.slowSeconds > 0) s.cues.push(Cue.slowMo(0, spec.slowScale, spec.slowSeconds));
  s.cues.push(Cue.nameCard(spec.cardAt, spec.cardSeconds));
  return s;
}
