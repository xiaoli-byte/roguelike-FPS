/**
 * 检视页 / 游玩版的行走声：陆地上的脚步、起跳、落地、冲刺（正式游戏音效表里的 footstep / jump / land / dash，
 * 经 src/audio/SynthPlayer.ts 实时合成）。人在水里时脚步和冲刺交给各图自己的水声（4-4：haizi/waterFx.ts），这里不出。
 * 飞行模式不出声。每帧在 walker.update 之后调。
 */
import * as THREE from 'three';
import type { SynthPlayer } from '../../audio/SynthPlayer';
import type { HeightGrid } from './grid';
import type { Walker } from './walker';

/** 步幅（m）：走 7.5 m/s 时一秒大约三步半 */
const STRIDE = 2.1;

export class WalkerSounds {
  private readonly prev = new THREE.Vector3();
  private hasPrev = false;
  private stride = 0;
  private wasGrounded = true;
  private prevVy = 0;
  private prevSpeed = 0;

  constructor(private readonly player: SynthPlayer, private readonly terrain: HeightGrid) {}

  update(dt: number, walker: Walker): void {
    if (dt <= 0) return;
    const f = walker.feet;
    if (!this.hasPrev || walker.fly) {
      this.prev.copy(f); this.hasPrev = true; this.stride = 0; this.wasGrounded = walker.grounded; this.prevVy = 0; this.prevSpeed = 0;
      return;
    }
    const speed = Math.hypot(f.x - this.prev.x, f.z - this.prev.z) / dt;
    const fallSpeed = -(f.y - this.prev.y) / dt;
    this.prev.copy(f);
    if (speed > 80) { this.stride = 0; this.prevSpeed = 0; this.wasGrounded = walker.grounded; return; }   // 切机位
    const wl = this.terrain.waterLevelAt(f.x, f.z);
    const inWater = Number.isFinite(wl) && wl > this.terrain.heightAt(f.x, f.z) + 0.03 && f.y <= wl + 0.06;

    // 起跳：刚离地、往上的速度
    if (this.wasGrounded && !walker.grounded && walker.vy > 4) this.player.play('jump');
    // 落地（落进水里的那一下归水声）
    if (!this.wasGrounded && walker.grounded && !inWater && Math.max(fallSpeed, -this.prevVy) > 5) {
      this.player.play('land', { volume: THREE.MathUtils.clamp((Math.max(fallSpeed, -this.prevVy) - 5) / 10, 0.4, 1) });
    }
    // 冲刺起步
    if (speed > 12 && this.prevSpeed <= 12 && !inWater) this.player.play('dash');
    // 脚步：在地上走，按走过的距离
    if (walker.grounded && !inWater && speed > 1) {
      this.stride += speed * dt;
      if (this.stride > STRIDE) { this.stride = 0; this.player.play('footstep', { volume: speed > 10 ? 0.8 : 0.6 }); }
    } else if (!walker.grounded) {
      this.stride = STRIDE * 0.7;   // 落地后很快接上第一步
    }
    this.wasGrounded = walker.grounded;
    this.prevVy = walker.vy;
    this.prevSpeed = speed;
  }
}
