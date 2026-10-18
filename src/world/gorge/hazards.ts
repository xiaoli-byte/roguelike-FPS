/**
 * 4-2 的动态环境（docs/level-design/chuanzang-v1.md 3.6）：涨水、峡谷风、落石。雷暴沿用 plateau/weather，
 * 铁索导电在检视页里接（weather.onStrike → crossings.electrify）。
 * 都只是演示：没有伤害，只改场景（水位、跳石、栈道断段、经幡和溜索速度）并给检视页发提示。
 */
import * as THREE from 'three';
import { WORLD_UNIFORMS } from '../plateau/materials';
import { setWindField, type WindSample } from '../plateau/wind';
import { FLOOD, GUST, ROCKFALL, type RockfallZone } from './spec';
import { PATHS, nearest, type Near } from './terrain';
import type { GorgeTerrain } from './terrain';

const NEAR: Near = { d: 0, s: 0, side: 0, px: 0, pz: 0 };

/**
 * 峡谷风：顺着最近那条河往上游吹（白天的谷风），基础风很弱；阵风来时整条峡谷一起起风，河越窄越强。
 * 返回值同 4-1 的 windAt：单位风向 + 强度 0..1。
 */
export function gorgeWind(gust: () => number): (x: number, z: number) => WindSample {
  return (x, z) => {
    let best = Infinity, tx = 0, tz = -1;
    for (const p of PATHS) {
      const n = nearest(p, x, z, NEAR);
      if (n.d < best) {
        best = n.d;
        // 最近点所在段的方向（按沿程找）
        let i = 0;
        while (i < p.s.length - 2 && p.s[i + 1] < n.s) i++;
        tx = -p.tx[i]; tz = -p.tz[i];
      }
    }
    const inGorge = 1 - Math.min(1, Math.max(0, (best - 30) / 120));
    return { dx: tx, dz: tz, strength: Math.min(1, GUST.base * inGorge + gust() * (0.4 + 0.6 * inGorge)) };
  };
}

interface Rock { mesh: THREE.Mesh; warn: THREE.Mesh; zone: RockfallZone; at: THREE.Vector3; t: number; landed: boolean }

export class Hazards {
  /** 涨水：当前抬高的米数、是否自动定时涨 */
  floodLevel = 0;
  floodAuto = false;
  private floodT = -1;
  private floodClock = 30;
  /** 阵风 0..1 */
  gust = 0;
  gustAuto = true;
  private gustT = -1;
  private nextGust = 12;
  /** 落石 */
  rockAuto = false;
  private rocks: Rock[] = [];
  private nextRock = 4;
  private seed = 7;
  private readonly rockGeo = new THREE.IcosahedronGeometry(1, 0);
  private readonly rockMat = new THREE.MeshLambertMaterial({ color: '#77716a', flatShading: true });
  private readonly warnGeo = new THREE.CircleGeometry(1, 20);
  /** 事件：落石砸中某处（检视页用来断栈道、提示「被砸中」） */
  onRockLand: ((zone: RockfallZone, at: THREE.Vector3) => void) | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly terrain: GorgeTerrain) {
    setWindField(gorgeWind(() => this.gust));
    // 草浪：飞廉的风场在这张图里没有（巢穴放到很远），只按基础风向（大渡河往上游 = 北）弯
    WORLD_UNIFORMS.uWindLair.value.set(1e5, 1e5, 1);
    WORLD_UNIFORMS.uWindBase.value.set(0.1, -1).normalize();
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** 立刻涨一次水 */
  triggerFlood(): void { if (this.floodT < 0) this.floodT = 0; }
  /** 立刻起一阵风 */
  triggerGust(): void { if (this.gustT < 0) this.gustT = 0; }

  /** 指定区（或随机区）落一块石头 */
  triggerRock(zoneId?: string): void {
    const zone = ROCKFALL.find(z => z.id === zoneId) ?? ROCKFALL[Math.floor(this.rand() * ROCKFALL.length)];
    const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * zone.r * 0.7;
    const x = zone.x + Math.cos(a) * r, z = zone.z + Math.sin(a) * r;
    const at = new THREE.Vector3(x, this.terrain.heightAt(x, z), z);
    const warn = new THREE.Mesh(this.warnGeo, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0, depthWrite: false }));
    warn.rotation.x = -Math.PI / 2;
    warn.renderOrder = 3;
    const mesh = new THREE.Mesh(this.rockGeo, this.rockMat);
    mesh.castShadow = true;
    mesh.visible = false;
    this.scene.add(warn, mesh);
    this.rocks.push({ mesh, warn, zone, at, t: 0, landed: false });
  }

  /** 每帧：groundAt 给落石的落点（地形或栈道面） */
  update(dt: number, groundAt: (x: number, z: number, y: number) => number): void {
    // 涨水：up 秒涨到 rise，保持 hold 秒，down 秒退
    if (this.floodAuto) { this.floodClock -= dt; if (this.floodClock <= 0) { this.floodClock = FLOOD.period; this.triggerFlood(); } }
    if (this.floodT >= 0) {
      this.floodT += dt;
      const { up, hold, down, rise } = FLOOD;
      const t = this.floodT;
      const k = t < up ? t / up : t < up + hold ? 1 : t < up + hold + down ? 1 - (t - up - hold) / down : 0;
      this.floodLevel = rise * k * k * (3 - 2 * k);
      if (t >= up + hold + down) { this.floodT = -1; this.floodLevel = 0; }
    }
    this.terrain.flood = this.floodLevel;
    // 阵风：渐起 1.2 秒，持续 dur，渐落 1.5 秒
    if (this.gustAuto) { this.nextGust -= dt; if (this.nextGust <= 0) { this.nextGust = GUST.every[0] + this.rand() * (GUST.every[1] - GUST.every[0]); this.triggerGust(); } }
    if (this.gustT >= 0) {
      this.gustT += dt;
      const t = this.gustT, D = GUST.dur;
      this.gust = Math.min(1, t < 1.2 ? t / 1.2 : t < 1.2 + D ? 0.92 + 0.08 * Math.sin(t * 7) * Math.sin(t * 3) : Math.max(0, 1 - (t - 1.2 - D) / 1.5));
      if (t > 2.7 + D) { this.gustT = -1; this.gust = 0; }
    }
    WORLD_UNIFORMS.uGust.value = this.gust;
    // 落石：先 1.5 秒预警影子，再 0.8 秒从崖顶砸下来，落地后滚向河里消失
    if (this.rockAuto) { this.nextRock -= dt; if (this.nextRock <= 0) { this.nextRock = 3 + this.rand() * 4; this.triggerRock(); } }
    for (const k of this.rocks) {
      k.t += dt;
      const top = k.zone.top;
      const W = 1.5, F = 0.8;
      (k.warn.material as THREE.MeshBasicMaterial).opacity = k.t < W + F ? 0.15 + 0.35 * Math.min(1, k.t / W) : Math.max(0, 0.5 - (k.t - W - F));
      k.warn.scale.setScalar(2.6 - Math.min(1, k.t / W) * 0.8);
      const gy = groundAt(k.at.x, k.at.z, top[1]);
      k.warn.position.set(k.at.x, gy + 0.12, k.at.z);
      if (k.t > W) {
        k.mesh.visible = true;
        const f = Math.min(1, (k.t - W) / F);
        if (f < 1) {
          k.mesh.position.set(top[0] + (k.at.x - top[0]) * f, top[1] + (gy + 0.8 - top[1]) * f * f, top[2] + (k.at.z - top[2]) * f);
        } else {
          if (!k.landed) { k.landed = true; this.onRockLand?.(k.zone, k.at.clone().setY(gy)); }
          // 落地后往低处滚
          const e = 0.6, x = k.mesh.position.x, z = k.mesh.position.z;
          const gx = this.terrain.heightAt(x + e, z) - this.terrain.heightAt(x - e, z), gz = this.terrain.heightAt(x, z + e) - this.terrain.heightAt(x, z - e);
          k.mesh.position.x -= gx * dt * 6; k.mesh.position.z -= gz * dt * 6;
          k.mesh.position.y = this.terrain.heightAt(k.mesh.position.x, k.mesh.position.z) + 0.8;
        }
        k.mesh.rotation.x += dt * 6; k.mesh.rotation.z += dt * 4;
        k.mesh.scale.setScalar(0.9 + (k.zone.id.length % 3) * 0.2);
      }
    }
    this.rocks = this.rocks.filter(k => {
      if (k.t < 6) return true;
      this.scene.remove(k.mesh, k.warn);
      (k.warn.material as THREE.Material).dispose();
      return false;
    });
  }
}
