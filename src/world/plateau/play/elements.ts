/**
 * 元素与反应（网页版简化实现；名字、组成、效果对齐正式游戏的 src/combat/Reactions.ts，设计见 chuanzang-combat-v1.md 1.2）：
 * - 状态：灼烧（4 秒，每 0.5 秒跳一次）、雷殛（4 秒）、蚀化（5 秒）。
 * - 两两反应（每个单位每种反应 1 秒冷却，领主 1.5 秒）：
 *   焚雷 = 灼烧 + 雷殛：3 m 爆炸（周围吃 60%），雷弧跳到 8 m 内最多 4 个同群单位并挂灼烧；
 *   熔金 = 灼烧 + 蚀化：对护甲 / 蓑毛中心 ×2，留 2.5 m 熔池 3 秒；
 *   封脉 = 雷殛 + 蚀化：眩晕 0.7 秒、减速 40% 3 秒；领主吃「脉滞」受伤 +12% 4 秒、打断非霸体前摇。
 * - 本章规则：带电（Actor.charged()）算有雷殛；带电的单位死时把电放给 8 m 内最多 2 个同群单位（电会传）。
 * - 防递归：反应扩散出去的元素 depth + 1，depth ≥ 2 不再反应。
 */
import * as THREE from 'three';
import type { Actor, Elem, PlayCtx } from './core';

export type ReactionId = 'thunderfire' | 'meltdown' | 'veinseal';

export const REACTION_NAMES: Record<ReactionId, string> = { thunderfire: '焚雷', meltdown: '熔金', veinseal: '封脉' };
export const ELEM_COLORS: Record<Elem, string> = { fire: '#ff8a3a', shock: '#ff5ad8', corrode: '#7ddc4a' };
const REACTION_COLORS: Record<ReactionId, string> = { thunderfire: '#ffb04a', meltdown: '#ffd24a', veinseal: '#c78bff' };

const BURN_TIME = 4, SHOCK_TIME = 4, CORRODE_TIME = 5;

export class StatusBag {
  burn = 0;
  /** 灼烧每秒伤害 */
  burnDps = 0;
  shock = 0;
  corrode = 0;
  /** 减速剩余秒数（封脉） */
  slow = 0;
  /** 领主脉滞（受伤倍率）剩余秒数 */
  vuln = 0;
  vulnMul = 1;
  /** 反应冷却：就绪时刻 */
  readonly ready: Partial<Record<ReactionId, number>> = {};
  /** 灼烧跳伤的累计 */
  burnAcc = 0;
  burnTick = 0;
  clear(): void { this.burn = this.shock = this.corrode = this.slow = this.vuln = 0; this.burnDps = 0; this.vulnMul = 1; }
  get any(): boolean { return this.burn > 0 || this.shock > 0 || this.corrode > 0; }
}

const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

interface Pool { at: THREE.Vector3; r: number; dmg: number; t: number; tick: number; mesh: THREE.Mesh }

export class ElementSystem {
  private pools: Pool[] = [];
  /** 浮字（反应名） */
  onLabel: ((at: THREE.Vector3, text: string, color: string) => void) | null = null;
  /** 反应计数（试玩脚本检查） */
  readonly counts: Record<ReactionId | 'discharge', number> = { thunderfire: 0, meltdown: 0, veinseal: 0, discharge: 0 };

  constructor(private readonly ctx: PlayCtx) {}

  /** 附着元素；power = 元素强度（决定反应威力）；返回触发的反应 */
  apply(a: Actor, elem: Elem, power: number, depth = 0): ReactionId | null {
    if (!a.alive) return null;
    const S = a.status;
    if (elem === 'fire') {
      // 化蛇这类泡在水里的：灼烧时长减半（湿身）
      const wet = (a as { wet?: () => boolean }).wet?.() ? 0.5 : 1;
      S.burn = Math.max(S.burn, BURN_TIME * wet);
      S.burnDps = Math.max(S.burnDps * (S.burn > 0 ? 1 : 0), Math.max(4, power * 0.35));
    } else if (elem === 'shock') S.shock = SHOCK_TIME;
    else S.corrode = CORRODE_TIME;
    if (depth >= 2) return null;
    const shock = S.shock > 0 || a.charged();
    let id: ReactionId | null = null;
    if (elem === 'fire' && shock) id = 'thunderfire';
    else if (elem === 'shock' && S.burn > 0) id = 'thunderfire';
    else if (elem === 'fire' && S.corrode > 0) id = 'meltdown';
    else if (elem === 'corrode' && S.burn > 0) id = 'meltdown';
    else if ((elem === 'shock' && S.corrode > 0) || (elem === 'corrode' && shock)) id = 'veinseal';
    if (!id) return null;
    const now = this.ctx.time;
    if ((S.ready[id] ?? 0) > now) return null;
    const haste = 1 + 0.25 * this.ctx.kit.stacks('rx_haste');
    S.ready[id] = now + (a.isBoss ? 1.5 : 1.0) / haste;
    this.react(id, a, power, depth);
    return id;
  }

  private react(id: ReactionId, a: Actor, pin: number, depth: number): void {
    const K = this.ctx.kit;
    const at = a.center(new THREE.Vector3());
    this.counts[id]++;
    const catalyst = 1 + 0.1 * K.stacks('rx_catalyst');
    this.onLabel?.(at.clone().setY(at.y + 0.6), REACTION_NAMES[id], REACTION_COLORS[id]);
    const fx = this.ctx.fx;
    if (id === 'thunderfire') {
      const B = THREE.MathUtils.clamp(pin, 14, 80) * catalyst * (1 + 0.4 * K.stacks('rx_tf_charm'));
      const R = 3 * (1 + 0.5 * K.stacks('rx_tf_scatter'));
      fx.burst(at, R, '#ffb04a');
      fx.burst(at, R * 0.6, '#ff5ad8');
      this.ctx.shake(0.25);
      a.hit(B, 1, at, { kind: 'reaction', from: at, poise: 3 });
      for (const o of this.ctx.actors()) {
        if (o === a || !o.alive) continue;
        const d = o.center(_c).distanceTo(at);
        if (d < R) o.hit(B * 0.6, 1, o.center(_d), { kind: 'reaction', from: at, poise: 3 });
      }
      // 雷弧：跳到 8 m 内最多 4（爆焰 +2）个同群单位，挂灼烧（depth + 1：它们带电时会再炸一次）
      const arcs = 4 + 2 * K.stacks('rx_tf_scatter');
      const near = this.ctx.actors().filter(o => o !== a && o.alive && o.group === a.group && o.center(_c).distanceTo(at) < 8)
        .sort((p, q) => p.center(_c).distanceToSquared(at) - q.center(_d).distanceToSquared(at)).slice(0, arcs);
      for (const o of near) {
        const p = o.center(new THREE.Vector3());
        fx.arc(at, p, '#ff7ae6');
        o.hit(B * 0.3, 1, p, { kind: 'reaction', from: at, poise: 1 });
        this.apply(o, 'fire', B * 0.5, depth + 1);
      }
      // 打在玩家身边：自己也会被炸到一点（不致命的提醒）
      if (this.ctx.center.distanceTo(at) < R * 0.7) this.ctx.hurt(4, '焚雷的余波');
    } else if (id === 'meltdown') {
      const B = THREE.MathUtils.clamp(pin, 14, 100) * catalyst;
      const armored = (a as { armored?: () => boolean }).armored?.() ?? false;
      a.hit(B * (armored ? 2 : 1), 1, at, { kind: 'reaction', from: at, poise: 2 });
      (a as { melt?: (k: number) => void }).melt?.(1 + K.stacks('rx_mg_shatter'));
      const g = this.ctx.terrain.heightAt(at.x, at.z);
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(2.5, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        color: '#ff9a2a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      mesh.position.set(at.x, g + 0.1, at.z);
      this.ctx.scene.add(mesh);
      this.pools.push({ at: new THREE.Vector3(at.x, g, at.z), r: 2.5, dmg: B * 0.12, t: 3, tick: 0.5, mesh });
      fx.burst(at, 2.2, '#ffd24a');
    } else {
      const lock = K.stacks('rx_vs_lock');
      const B = THREE.MathUtils.clamp(pin, 14, 90) * catalyst;
      a.hit(B * 0.6, 1, at, { kind: 'reaction', from: at, poise: 1 });
      a.status.slow = 3;
      if (a.isBoss) {
        a.status.vuln = 4;
        a.status.vulnMul = 1.12 + 0.06 * lock;
        a.stun(0, '封脉');
      } else {
        // 水里导电：多晕 0.5 秒
        const wet = (a as { wet?: () => boolean }).wet?.() ? 0.5 : 0;
        a.stun(0.7 + 0.6 * lock + wet, '封脉');
      }
      fx.burst(at, 1.8, '#c78bff');
    }
  }

  /** 带电的单位死了：电传给 8 m 内最多 2 个同群单位 */
  discharge(a: Actor): void {
    const at = a.center(new THREE.Vector3());
    const near = this.ctx.actors().filter(o => o !== a && o.alive && o.group === a.group && o.center(_c).distanceTo(at) < 8)
      .sort((p, q) => p.center(_c).distanceToSquared(at) - q.center(_d).distanceToSquared(at)).slice(0, 2);
    if (!near.length) return;
    this.counts.discharge++;
    for (const o of near) {
      const p = o.center(new THREE.Vector3());
      this.ctx.fx.arc(at, p, '#ff5ad8');
      o.charge(6);
      o.hit(6, 1, p, { kind: 'reaction', from: at, poise: 1 });
    }
  }

  /** 每帧：状态计时、灼烧跳伤、熔池 */
  update(dt: number): void {
    for (const a of this.ctx.actors()) {
      const S = a.status;
      if (!S.any && S.slow <= 0 && S.vuln <= 0) continue;
      S.shock = Math.max(0, S.shock - dt);
      S.corrode = Math.max(0, S.corrode - dt);
      S.slow = Math.max(0, S.slow - dt);
      S.vuln = Math.max(0, S.vuln - dt);
      if (S.vuln <= 0) S.vulnMul = 1;
      if (S.burn > 0) {
        S.burn = Math.max(0, S.burn - dt);
        S.burnAcc += S.burnDps * dt;
        S.burnTick -= dt;
        if (S.burnTick <= 0) {
          S.burnTick = 0.5;
          if (S.burnAcc > 0.5) a.hit(S.burnAcc, 1, a.center(_c), { kind: 'dot', poise: 0 });
          S.burnAcc = 0;
        }
      }
    }
    this.pools = this.pools.filter(P => {
      P.t -= dt; P.tick -= dt;
      (P.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, P.t);
      if (P.tick <= 0) {
        P.tick = 0.5;
        for (const o of this.ctx.actors()) {
          if (!o.alive || o.isBoss && o.pos.distanceTo(P.at) > P.r + 3) continue;
          if (Math.hypot(o.pos.x - P.at.x, o.pos.z - P.at.z) < P.r + (o.isBoss ? 2.5 : 0.5) && o.pos.y < P.at.y + 2) {
            o.hit(P.dmg, 1, o.center(_c), { kind: 'dot', poise: 0 });
            o.status.corrode = Math.max(o.status.corrode, 1.5);
          }
        }
      }
      if (P.t > 0) return true;
      this.ctx.scene.remove(P.mesh);
      P.mesh.geometry.dispose();
      return false;
    });
  }

  clear(): void {
    for (const P of this.pools) this.ctx.scene.remove(P.mesh);
    this.pools = [];
  }
}
