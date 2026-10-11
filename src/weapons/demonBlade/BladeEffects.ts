/**
 * 魔刀千刃 v2 的世界特效（docs/demon-blade-v2.md 第 7–9 节）：人刀合一的碎刃斩波、噬灵鬼眼的魂力光点。
 * 斩波的伤害判定由 DemonBlade 控制器按 waveProgress 结算，这里只管表现；暂停时不推进（控制器不调用 update）。
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { BLADE_PURPLE, bladeGlowTexture } from './BladeModel';

const WAVE_POOL = 4;
const WISP_POOL = 10;
/** 魂力从尸体飞到刀根的时长 */
export const WISP_TIME = 0.38;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** 新月形弧带（半径 1，张角 ±60°，宽度从中间向两端收窄），在 XY 平面、朝 +Y 凸出 */
function crescentGeometry(): THREE.BufferGeometry {
  const seg = 28;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = (t - 0.5) * (Math.PI * 2 / 3);
    const w = 0.28 * Math.sin(Math.PI * t);
    const ix = Math.sin(a), iy = Math.cos(a);
    pos.push(ix * (1 - w), iy * (1 - w), 0, ix, iy, 0);
    const k = Math.sin(Math.PI * t);
    col.push(0, 0, 0, k, k, k);
    if (i < seg) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

interface Wave {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  roll: number;
  range: number;
  t: number;
  dur: number;
}

interface Wisp {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  t: number;
}

export class BladeEffects {
  readonly group = new THREE.Group();
  private readonly waves: Wave[] = [];
  private readonly wisps: Wisp[] = [];

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'demonBlade.effects';
    const geo = crescentGeometry();
    for (let i = 0; i < WAVE_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.waves.push({ mesh, mat, origin: new THREE.Vector3(), dir: new THREE.Vector3(), roll: 0, range: 0, t: 1, dur: 1 });
    }
    for (let i = 0; i < WISP_POOL; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: bladeGlowTexture(), color: 0xc9a2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      sprite.visible = false;
      sprite.renderOrder = 7;
      this.group.add(sprite);
      this.wisps.push({ sprite, from: new THREE.Vector3(), t: 1 });
    }
  }

  init(): void {
    this.ctx.scene.add(this.group);
  }

  /**
   * 斩波：从 origin 沿 dir 飞出 range 米、耗时 dur 秒；roll 为新月相对水平的倾斜（与挥砍方向一致）。
   * 返回槽位（控制器据此读进度结算伤害），池满时覆盖最旧的。
   */
  wave(origin: THREE.Vector3, dir: THREE.Vector3, roll: number, range: number, dur: number): number {
    let k = this.waves.findIndex((w) => w.t >= 1);
    if (k < 0) {
      let best = 0;
      for (let i = 1; i < this.waves.length; i++) if (this.waves[i].t > this.waves[best].t) best = i;
      k = best;
    }
    const w = this.waves[k];
    w.origin.copy(origin);
    w.dir.copy(dir).normalize();
    w.roll = roll;
    w.range = range;
    w.t = 0;
    w.dur = dur;
    w.mesh.visible = true;
    return k;
  }

  /** 魂力光点：从 from 飞向 target()（刀根，随镜头移动） */
  wisp(from: THREE.Vector3): void {
    const w = this.wisps.find((x) => x.t >= 1) ?? this.wisps[0];
    w.from.copy(from);
    w.t = 0;
    w.sprite.visible = true;
  }

  update(dt: number, target: (out: THREE.Vector3) => THREE.Vector3 | null): void {
    for (const w of this.waves) {
      if (w.t >= 1) continue;
      w.t = Math.min(1, w.t + dt / w.dur);
      const e = 1 - (1 - w.t) * (1 - w.t);
      // 新月立在垂直于飞行方向的平面里、正对玩家（局部 Z = 飞行方向），弧顶朝上；按 roll 绕飞行方向倾斜成挥砍的角度
      _z.copy(w.dir);
      _x.set(-w.dir.z, 0, w.dir.x);
      if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
      _x.normalize().applyAxisAngle(_z, w.roll);
      _y.crossVectors(_z, _x).normalize();
      _m.makeBasis(_x, _y, _z);
      w.mesh.quaternion.setFromRotationMatrix(_m);
      const r = 1.2 + 1.4 * e;
      w.mesh.scale.set(r * 1.3, r * 0.7, r);
      // 弧心放在视线下方一点，新月的弧顶正好扫过准星高度
      w.mesh.position.copy(w.origin).addScaledVector(w.dir, w.range * e).addScaledVector(_y, -r * 0.62);
      const fade = w.t < 0.12 ? w.t / 0.12 : 1 - Math.max(0, (w.t - 0.55) / 0.45);
      w.mat.color.setHex(BLADE_PURPLE).multiplyScalar(1.6 * fade);
      if (w.t >= 1) w.mesh.visible = false;
    }
    for (const w of this.wisps) {
      if (w.t >= 1) continue;
      w.t = Math.min(1, w.t + dt / WISP_TIME);
      const to = target(_b);
      if (!to) {
        w.t = 1;
      } else {
        const e = w.t * w.t;
        // 向上弯一点的弧线
        _a.copy(w.from).lerp(to, e);
        _a.y += Math.sin(Math.PI * w.t) * 0.8;
        w.sprite.position.copy(_a);
      }
      const s = 0.55 * (1 - 0.6 * w.t);
      w.sprite.scale.setScalar(s);
      (w.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, (1 - w.t) * 3);
      if (w.t >= 1) w.sprite.visible = false;
    }
  }

  /** 斩波当前飞到的距离（米）与是否仍在飞行 */
  waveFront(k: number): number {
    const w = this.waves[k];
    if (!w || w.t >= 1) return -1;
    const e = 1 - (1 - w.t) * (1 - w.t);
    return w.range * e;
  }

  clear(): void {
    for (const w of this.waves) {
      w.t = 1;
      w.mesh.visible = false;
    }
    for (const w of this.wisps) {
      w.t = 1;
      w.sprite.visible = false;
    }
  }
}
