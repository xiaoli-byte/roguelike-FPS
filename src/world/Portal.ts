/**
 * 出口传送门：月洞门石框 + 旋涡 shader + 按关卡类型着色的光环 / 光柱 / 地面辉光，
 * 头顶漂浮文字牌（CanvasTexture 精灵），从地下升起，升起完成后才可交互（F 进入）。
 * 石框、屋顶等几何与共享材质做模块级缓存；每个门自己的 shader 材质与文字纹理在 dispose() 释放。
 */
import * as THREE from 'three';
import type { GameContext, Interactable, InteractPrompt, StageNode, StageType } from '../core/types';
import { getStageDesign } from './StageDesign';
import { usesAuthoredLayout } from './WhiteboxMode';
import { getWhiteboxPlan } from './WhiteboxGen';

export const STAGE_TYPE_COLORS: Record<StageType, number> = {
  combat: 0xe8452c,   // 朱红
  elite: 0xa64dff,    // 紫
  treasure: 0xffc233, // 金
  shop: 0x2fd98a,     // 翠绿
  boss: 0xa3142a,     // 暗红
};

export const STAGE_TYPE_NAMES: Record<StageType, string> = {
  combat: '战斗',
  elite: '精英',
  treasure: '宝藏',
  shop: '商店',
  boss: '首领',
};

const TYPE_HINTS: Record<StageType, string> = {
  combat: '击退数波敌人，清场后开启宝箱',
  elite: '强敌环伺，奖励更加丰厚',
  treasure: '没有敌人，宝箱唾手可得',
  shop: '购买武器、秘卷与补给，强化武器',
  boss: '本章首领在此等候',
};

const TYPE_NO_REWARD: Record<StageType, string> = {
  combat: '清场奖励',
  elite: '清场奖励',
  treasure: '宝箱',
  shop: '补给与强化',
  boss: '首领战利品',
};

const RISE_TIME = 1.5;
const RISE_DEPTH = 6.6;
const HOLE_Y = 2.2;
const HOLE_R = 1.7;
const BASE_H = 0.3;

function cssHex(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// ───────────────────────────── 共享资源（模块级缓存，永不释放） ─────────────────────────────

interface Shared {
  gate: THREE.ExtrudeGeometry;
  rim: THREE.TorusGeometry;
  disc: THREE.CircleGeometry;
  box: THREE.BoxGeometry;
  cone: THREE.ConeGeometry;
  beacon: THREE.CylinderGeometry;
  glow: THREE.CircleGeometry;
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  rims: Map<number, THREE.MeshBasicMaterial>;
}

let shared: Shared | null = null;

function getShared(): Shared {
  if (shared) return shared;
  const shape = new THREE.Shape();
  shape.moveTo(-2.3, 0);
  shape.lineTo(2.3, 0);
  shape.lineTo(2.3, 5.0);
  shape.lineTo(-2.3, 5.0);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, HOLE_Y, HOLE_R, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const gate = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false, curveSegments: 32 });
  gate.translate(0, 0, -0.3);
  const beacon = new THREE.CylinderGeometry(1.45, 1.9, 26, 24, 1, true);
  beacon.translate(0, 13, 0);
  const glow = new THREE.CircleGeometry(3.2, 40);
  glow.rotateX(-Math.PI / 2);
  shared = {
    gate,
    rim: new THREE.TorusGeometry(HOLE_R, 0.1, 8, 48),
    disc: new THREE.CircleGeometry(HOLE_R * 0.99, 48),
    box: new THREE.BoxGeometry(1, 1, 1),
    cone: new THREE.ConeGeometry(1, 1, 4),
    beacon,
    glow,
    stone: new THREE.MeshStandardMaterial({ color: 0x9c948b, roughness: 0.9, flatShading: true }),
    stoneDark: new THREE.MeshStandardMaterial({ color: 0x6b645e, roughness: 0.95, flatShading: true }),
    roof: new THREE.MeshStandardMaterial({ color: 0x2f3542, roughness: 0.8, flatShading: true }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a948, roughness: 0.4, metalness: 0.45, flatShading: true }),
    rims: new Map(),
  };
  return shared;
}

function rimMaterial(color: number): THREE.MeshBasicMaterial {
  const s = getShared();
  let m = s.rims.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    s.rims.set(color, m);
  }
  return m;
}

// ───────────────────────────── 着色器 ─────────────────────────────

const FX_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SWIRL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float s1 = sin(a * 3.0 - r * 10.0 + uTime * 3.2) * 0.5 + 0.5;
  float s2 = sin(a * 5.0 + r * 16.0 - uTime * 4.6) * 0.5 + 0.5;
  float swirl = mix(s1, s2, 0.35);
  float core = smoothstep(0.55, 0.0, r);
  float edge = smoothstep(1.0, 0.9, r);
  float rim = smoothstep(0.62, 0.97, r) * edge;
  vec3 col = uColor * (0.35 + swirl * 0.9) + vec3(1.0) * core * 0.6 + uColor * rim;
  float alpha = edge * uAlpha * (0.5 + 0.35 * swirl + core * 0.4);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

const BEACON_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float fade = pow(1.0 - vUv.y, 2.4);
  float stripes = 0.7 + 0.3 * sin(vUv.y * 46.0 - uTime * 4.0 + vUv.x * 6.2831 * 3.0);
  gl_FragColor = vec4(uColor, fade * stripes * uAlpha * 0.3);
  #include <colorspace_fragment>
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float g = pow(max(0.0, 1.0 - r), 1.6);
  float ring = smoothstep(0.08, 0.0, abs(r - 0.55 - 0.08 * sin(uTime * 2.0)));
  gl_FragColor = vec4(uColor, (g * 0.55 + ring * 0.35) * uAlpha * (0.85 + 0.15 * sin(uTime * 3.0)));
  #include <colorspace_fragment>
}
`;

function fxMaterial(frag: string, color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: FX_VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

// ───────────────────────────── 文字牌 ─────────────────────────────

function roundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function makeLabel(title: string, sub: string, stage: string, color: number): THREE.CanvasTexture {
  const W = 512;
  const H = 232;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!g) return tex;
  const col = cssHex(color);
  const font = '"Microsoft YaHei", "PingFang SC", sans-serif';
  roundedRect(g, 10, 10, W - 20, H - 20, 26);
  g.fillStyle = 'rgba(14, 10, 12, 0.8)';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = col;
  g.shadowColor = col;
  g.shadowBlur = 16;
  g.stroke();
  g.shadowBlur = 0;
  roundedRect(g, 22, 22, W - 44, H - 44, 18);
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255, 222, 160, 0.35)';
  g.stroke();
  // 四角菱形饰
  g.fillStyle = col;
  for (const [x, y] of [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]]) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.PI / 4);
    g.fillRect(-5, -5, 10, 10);
    g.restore();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `28px ${font}`;
  g.fillStyle = 'rgba(243, 227, 192, 0.7)';
  g.fillText(stage, W / 2, 50, W - 64);
  g.font = `bold 78px ${font}`;
  g.shadowColor = col;
  g.shadowBlur = 20;
  g.fillStyle = '#ffffff';
  g.fillText(title, W / 2, 112);
  g.shadowBlur = 0;
  g.font = `36px ${font}`;
  g.fillStyle = '#f3e3c0';
  g.fillText(sub, W / 2, 180);
  tex.needsUpdate = true;
  return tex;
}

// ───────────────────────────── 传送门 ─────────────────────────────

const _v = new THREE.Vector3();

export class Portal {
  readonly root = new THREE.Group();
  readonly position: THREE.Vector3;
  private readonly lift = new THREE.Group();
  private readonly swirlMat: THREE.ShaderMaterial;
  private readonly beaconMat: THREE.ShaderMaterial;
  private readonly glowMat: THREE.ShaderMaterial;
  private readonly labelTex: THREE.CanvasTexture;
  private readonly labelMat: THREE.SpriteMaterial;
  private readonly sprite: THREE.Sprite;
  private readonly color: number;
  private readonly item: Interactable;
  private removeInteract: (() => void) | null = null;
  private age: number;
  private started = false;
  private ready = false;
  private lastUse = -10;
  private disposed = false;
  private readonly yaw: number;

  /**
   * @param yaw 门朝向（模型 +Z 指向玩家一侧），建议为 90° 的整数倍以便碰撞盒精确
   * @param delay 延迟多少秒后开始升起
   */
  constructor(private readonly ctx: GameContext, readonly node: StageNode, pos: THREE.Vector3, yaw: number, parent: THREE.Object3D, delay = 0) {
    const s = getShared();
    this.position = pos.clone();
    this.age = -Math.max(0, delay);
    this.color = STAGE_TYPE_COLORS[node.type] ?? 0xffffff;
    const color = this.color;

    this.root.name = `portal:${node.type}`;
    this.root.position.copy(pos);
    this.root.rotation.y = yaw;
    this.root.add(this.lift);
    this.lift.position.y = -RISE_DEPTH;
    this.root.visible = false;

    // 基座 + 台阶
    const base = new THREE.Mesh(s.box, s.stoneDark);
    base.scale.set(5.6, BASE_H, 2.2);
    base.position.y = BASE_H / 2;
    const step = new THREE.Mesh(s.box, s.stoneDark);
    step.scale.set(3.6, 0.15, 0.8);
    step.position.set(0, 0.075, 1.45);
    // 月洞门石框
    const gate = new THREE.Mesh(s.gate, s.stone);
    gate.position.y = BASE_H;
    // 屋顶
    const roof = new THREE.Mesh(s.box, s.roof);
    roof.scale.set(5.4, 0.24, 1.4);
    roof.position.y = BASE_H + 5.12;
    const ridge = new THREE.Mesh(s.box, s.gold);
    ridge.scale.set(5.7, 0.26, 0.3);
    ridge.position.y = BASE_H + 5.37;
    this.lift.add(base, step, gate, roof, ridge);
    for (const sx of [-1, 1]) {
      const tip = new THREE.Mesh(s.cone, s.roof);
      tip.scale.set(0.16, 0.8, 0.16);
      tip.position.set(sx * 2.95, BASE_H + 5.3, 0);
      tip.rotation.z = -sx * 0.9;
      this.lift.add(tip);
    }
    const orb = new THREE.Mesh(s.cone, rimMaterial(color));
    orb.scale.set(0.22, 0.55, 0.22);
    orb.position.set(0, BASE_H + 5.5, 0);
    this.lift.add(orb);
    // 光环（前后两圈）与旋涡
    for (const z of [-0.31, 0.31]) {
      const rim = new THREE.Mesh(s.rim, rimMaterial(color));
      rim.position.set(0, BASE_H + HOLE_Y, z);
      this.lift.add(rim);
    }
    this.swirlMat = fxMaterial(SWIRL_FRAG, color);
    const swirl = new THREE.Mesh(s.disc, this.swirlMat);
    swirl.position.set(0, BASE_H + HOLE_Y, 0);
    swirl.renderOrder = 4;
    this.lift.add(swirl);

    // 文字牌
    const title = STAGE_TYPE_NAMES[node.type] ?? '未知';
    const sub = node.reward !== 'none' ? `奖励：${ctx.runPlan.rewardLabel(node.reward)}` : TYPE_NO_REWARD[node.type];
    this.labelTex = makeLabel(title, sub, ctx.runPlan.stageLabel(node), color);
    this.labelMat = new THREE.SpriteMaterial({ map: this.labelTex, transparent: true, depthWrite: false, fog: false, opacity: 0, toneMapped: false });
    this.sprite = new THREE.Sprite(this.labelMat);
    this.sprite.scale.set(4.2, 1.9, 1);
    this.sprite.position.y = BASE_H + 6.7;
    this.sprite.renderOrder = 6;
    this.lift.add(this.sprite);

    // 光柱与地面辉光（不随门升起，只淡入）
    this.beaconMat = fxMaterial(BEACON_FRAG, color);
    const beacon = new THREE.Mesh(s.beacon, this.beaconMat);
    beacon.renderOrder = 4;
    this.glowMat = fxMaterial(GLOW_FRAG, color);
    const glow = new THREE.Mesh(s.glow, this.glowMat);
    glow.position.y = 0.04;
    glow.renderOrder = 3;
    this.root.add(beacon, glow);

    parent.add(this.root);

    // 交互（升起完成后启用）
    // 与宝箱 / 武器等交互提示一致：副标题以动作开头
    const prompt: InteractPrompt = {
      title: ctx.runPlan.stageLabel(node),
      subtitle: `进入 · ${node.reward !== 'none' ? `奖励：${ctx.runPlan.rewardLabel(node.reward)}` : TYPE_NO_REWARD[node.type]}`,
      lines: node.type === 'shop' || node.type === 'treasure' ? [TYPE_HINTS[node.type]]
        : usesAuthoredLayout() ? [getWhiteboxPlan(node).routeChoice, '接近战区自动触发守卫，击败终点守军开启出口']
          : [getStageDesign(node).routeHint, getStageDesign(node).combatHint, TYPE_HINTS[node.type]],
      color: cssHex(color),
      key: 'F',
    };
    this.item = {
      position: new THREE.Vector3(pos.x, pos.y + 1.0, pos.z),
      radius: 2.6,
      enabled: false,
      prompt: () => prompt,
      onInteract: () => this.enter(),
    };
    this.removeInteract = ctx.interact.add(this.item);
    this.yaw = yaw;
  }

  /**
   * 基座、月洞门石框（两侧 / 洞下 / 洞上）的 AABB（yaw 为 90° 整数倍时精确）；旋涡本身可穿过。
   * 任何一块与玩家当前身体（略放大）重叠时整组不加。
   */
  private addColliders(pos: THREE.Vector3, yaw: number): void {
    const top = BASE_H + 5.0;
    const sill = BASE_H + HOLE_Y - HOLE_R + 0.05;
    const head = BASE_H + HOLE_Y + HOLE_R - 0.05;
    // [x0, x1, y0, y1, z0, z1]（局部坐标）
    const parts: [number, number, number, number, number, number][] = [
      [-2.8, 2.8, 0, BASE_H, -1.1, 1.1],
      [-2.3, -HOLE_R + 0.05, BASE_H, top, -0.3, 0.3],
      [HOLE_R - 0.05, 2.3, BASE_H, top, -0.3, 0.3],
      [-HOLE_R, HOLE_R, BASE_H, sill, -0.3, 0.3],
      [-HOLE_R, HOLE_R, head, top, -0.3, 0.3],
    ];
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const boxes: [number, number, number, number, number, number][] = [];
    for (const [x0, x1, y0, y1, z0, z1] of parts) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const lx of [x0, x1]) {
        for (const lz of [z0, z1]) {
          const wx = pos.x + lx * c + lz * sn;
          const wz = pos.z - lx * sn + lz * c;
          minX = Math.min(minX, wx);
          maxX = Math.max(maxX, wx);
          minZ = Math.min(minZ, wz);
          maxZ = Math.max(maxZ, wz);
        }
      }
      boxes.push([minX, pos.y + y0, minZ, maxX, pos.y + y1, maxZ]);
    }
    const pl = this.ctx.player;
    const r = pl.radius + 0.15;
    const p = pl.position;
    for (const b of boxes) {
      if (p.x - r < b[3] && p.x + r > b[0] && p.z - r < b[5] && p.z + r > b[2] && p.y < b[4] && p.y + pl.height > b[1]) return;
    }
    for (const b of boxes) this.ctx.world.addBox(b[0], b[1], b[2], b[3], b[4], b[5], 'portal');
  }

  private enter(): void {
    if (!this.ready || this.disposed) return;
    const now = this.ctx.time.now;
    if (now - this.lastUse < 1) return;
    this.lastUse = now;
    this.ctx.game.advance(this.node);
  }

  update(dt: number, t: number): void {
    if (this.disposed) return;
    this.age += dt;
    if (this.age < 0) return;
    if (!this.started) {
      this.started = true;
      this.root.visible = true;
      // 开始升起时才加碰撞（之前门还没出现，不能有看不见的墙）；此刻玩家正站在门的位置上就不加，避免卡人
      this.addColliders(this.position, this.yaw);
      this.ctx.audio.play('portal', { position: this.position, volume: 0.8 });
      _v.copy(this.position);
      this.ctx.fx.burst(_v, this.color, 26, 5, 0.9, 0.16, 6);
    }
    const k = Math.min(1, this.age / RISE_TIME);
    const e = 1 - Math.pow(1 - k, 3);
    this.lift.position.y = -RISE_DEPTH * (1 - e);
    if (k < 1) {
      // 升起时轻微震动
      this.lift.position.x = Math.sin(t * 60) * 0.04 * (1 - k);
    } else {
      this.lift.position.x = 0;
      if (!this.ready) {
        this.ready = true;
        this.item.enabled = true;
        _v.set(this.position.x, this.position.y + BASE_H + HOLE_Y, this.position.z);
        this.ctx.fx.burst(_v, this.color, 30, 6, 1.0, 0.14, 2);
        _v.set(this.position.x, this.position.y + 0.1, this.position.z);
        this.ctx.fx.ring(_v, 4, this.color, 0.7);
      }
    }
    const a = Math.min(1, this.age / (RISE_TIME * 0.8));
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.4);
    this.swirlMat.uniforms.uTime.value = t;
    this.swirlMat.uniforms.uAlpha.value = (this.ready ? 1 : k * k) * pulse;
    this.beaconMat.uniforms.uTime.value = t;
    this.beaconMat.uniforms.uAlpha.value = a * pulse;
    this.glowMat.uniforms.uTime.value = t;
    this.glowMat.uniforms.uAlpha.value = a;
    this.labelMat.opacity = Math.max(0, (k - 0.6) / 0.4);
    this.sprite.position.y = BASE_H + 6.7 + Math.sin(t * 1.6 + this.position.x) * 0.12;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.item.enabled = false;
    this.removeInteract?.();
    this.removeInteract = null;
    this.root.removeFromParent();
    this.swirlMat.dispose();
    this.beaconMat.dispose();
    this.glowMat.dispose();
    this.labelMat.dispose();
    this.labelTex.dispose();
  }
}
