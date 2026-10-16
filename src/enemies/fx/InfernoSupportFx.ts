/**
 * 第三章辅助位（熔铜匠、变脸傩巫）共用的特效与玩法小工具。
 *
 * - pourArc：熔铜抛物线（流嘴 → 同伴头顶），纯函数，单元测试直接调用。
 * - MoltenStream：浇出去的那道熔铜液流：沿抛物线排一串加法发光的铜液团（一次 draw call），液流的头和尾分别推进。
 * - BronzeCoat：罩在同伴身上的铜甲着色器层。给同伴模型里每个实体网格（含骨骼蒙皮网格，共用骨架）加一层略微外推的
 *   「镀层」网格：刚浇上时通红、流动的熔铜纹（heat = 1），冷却后转成带铜绿的青铜（heat = 0）；浇的过程从头顶往下盖
 *   （show 0 → 1）；被打得快碎时出现裂纹（crack 0 → 1）。
 * - applyNuoMask：傩巫面具的换脸着色。按蒙皮权重（mask 骨）给几何体算一条 aMask 属性，本体材质里只在面具区域
 *   换配色（赤 / 黑 / 金三张脸）、让面具眼睛按脸色自发光、画碎面裂纹。
 * - maskWeights：从蒙皮属性里取某根骨骼的权重（纯函数，测试用）。
 * - spawnFirePool：地上一摊熔铜 / 余火（流动的熔岩贴花，每 0.5 秒烫一次站在里面的玩家、可选也烫同伴），
 *   登记成地火（src/enemies/inferno/FireFeed.ts），祸斗吃掉时提前熄灭。
 *
 * 本模块只依赖 three.js 和几个无引擎依赖的小模块（单元测试直接加载：tests/inferno-support.test.mjs）。
 */
import * as THREE from 'three';
import type { DamageRequest, GameContext, IEnemy } from '../../core/types';
import { GroundDecal } from '../bosses/Visuals';
import { zonePlayer } from '../Hazards';
import { registerFloorFire, type FloorFireHandle } from '../inferno/FireFeed';

/** 第三章辅助位的配色：熔铜（金橙）、冷青铜、铜绿，傩面三色 */
export const INFERNO_SUPPORT = {
  molten: 0xffa030, moltenHot: 0xfff0b0, moltenDeep: 0xff5a10, bronze: 0x9a6a32, verdigris: 0x5f8f72,
  slag: 0x3a2418, spark: 0xffc860, red: 0xff3a1a, black: 0x2a1830, gold: 0xffc840, ember: 0xff6a20,
} as const;

const _a = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

// ───────────────────────────── 抛物线 ─────────────────────────────

/** 抛物线上参数 u（0 = 起点，1 = 终点）处的点：两端连线再向上抬 4·apex·u·(1-u)（u = 0.5 处抬高 apex 米） */
export function pourArc(from: THREE.Vector3, to: THREE.Vector3, apex: number, u: number, out: THREE.Vector3): THREE.Vector3 {
  out.lerpVectors(from, to, u);
  out.y += 4 * apex * u * (1 - u);
  return out;
}

// ───────────────────────────── 熔铜液流 ─────────────────────────────

const STREAM_BLOBS = 26;
let blobGeo: THREE.IcosahedronGeometry | null = null;
const streamPool: MoltenStream[] = [];
const _blobColor = new THREE.Color();
const _hot = new THREE.Color(INFERNO_SUPPORT.moltenHot);
const _mid = new THREE.Color(INFERNO_SUPPORT.molten);
const _deep = new THREE.Color(INFERNO_SUPPORT.moltenDeep);

/**
 * 熔铜液流：一串铜液团沿抛物线排开（头部最粗最亮，尾部变细转深红），每团带一点抖动，像一股甩出去的稠液。
 * set(head, tail)：液流头、尾在抛物线上的参数（0..1）。用 acquire / release 取还。
 */
export class MoltenStream {
  readonly mesh: THREE.InstancedMesh;
  private pooled = false;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private apex = 1;

  private constructor() {
    if (!blobGeo) blobGeo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(blobGeo, mat, STREAM_BLOBS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.castShadow = false;
    for (let i = 0; i < STREAM_BLOBS; i++) this.mesh.setColorAt(i, _mid);
  }

  static acquire(parent: THREE.Object3D): MoltenStream {
    const s = streamPool.pop() ?? new MoltenStream();
    s.pooled = false;
    s.mesh.visible = true;
    s.mesh.count = 0;
    parent.add(s.mesh);
    return s;
  }

  /** 抛物线：起点（流嘴）、终点（同伴头顶）、最高处比两端连线高出 apex 米 */
  setArc(from: THREE.Vector3, to: THREE.Vector3, apex: number): void {
    this.from.copy(from);
    this.to.copy(to);
    this.apex = apex;
  }

  /** head / tail：液流头、尾的参数（0..1，head ≥ tail）；time 用于抖动；thick 液流粗细（米） */
  update(head: number, tail: number, time: number, thick = 0.09): void {
    const h = THREE.MathUtils.clamp(head, 0, 1), t = THREE.MathUtils.clamp(Math.min(tail, h), 0, 1);
    const n = h - t < 1e-3 ? 0 : STREAM_BLOBS;
    this.mesh.count = n;
    for (let i = 0; i < n; i++) {
      const k = i / (STREAM_BLOBS - 1);              // 0 = 尾，1 = 头
      const u = t + (h - t) * k;
      pourArc(this.from, this.to, this.apex, u, _a);
      const wob = 0.25 * Math.sin(time * 23 + i * 1.7);
      const r = thick * (0.45 + 0.75 * k) * (1 + wob * 0.4);
      _a.x += Math.sin(time * 17 + i * 2.3) * thick * 0.25;
      _a.z += Math.cos(time * 19 + i * 1.1) * thick * 0.25;
      _m.compose(_a, _q.identity(), _s.set(r, r * 1.25, r));
      this.mesh.setMatrixAt(i, _m);
      _blobColor.copy(_deep).lerp(_mid, Math.min(1, k * 1.6));
      if (k > 0.75) _blobColor.lerp(_hot, (k - 0.75) * 3);
      this.mesh.setColorAt(i, _blobColor);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 液流头当前所在的点 */
  headPoint(head: number, out: THREE.Vector3): THREE.Vector3 {
    return pourArc(this.from, this.to, this.apex, THREE.MathUtils.clamp(head, 0, 1), out);
  }

  release(): void {
    if (this.pooled) return;
    this.pooled = true;
    this.mesh.removeFromParent();
    this.mesh.count = 0;
    streamPool.push(this);
  }
}

// ───────────────────────────── 铜甲着色层 ─────────────────────────────

const COAT_NOISE = /* glsl */ `
float bcHash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 51.3))) * 43758.5453); }
float bcNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bcHash(i), bcHash(i + vec3(1, 0, 0)), f.x), mix(bcHash(i + vec3(0, 1, 0)), bcHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bcHash(i + vec3(0, 0, 1)), bcHash(i + vec3(1, 0, 1)), f.x), mix(bcHash(i + vec3(0, 1, 1)), bcHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

interface CoatUniforms {
  uHeat: { value: number };
  uShow: { value: number };
  uCrack: { value: number };
  uTime: { value: number };
  uTopY: { value: number };
  uSpan: { value: number };
  uInflate: { value: number };
}

/** 铜甲材质：外推一点的金属镀层；刚浇上时通红流动，冷却转青铜；从头顶往下盖；快碎时裂开 */
function coatMaterial(u: CoatUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: INFERNO_SUPPORT.bronze, metalness: 0.85, roughness: 0.38, emissive: 0x000000,
    transparent: true, opacity: 0.94, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = 'uniform float uInflate;\nvarying vec3 vCoatW;\nvarying vec3 vCoatO;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(objectNormal) * uInflate;\n  vCoatO = position;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vCoatW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'uniform float uHeat;\nuniform float uShow;\nuniform float uCrack;\nuniform float uTime;\nuniform float uTopY;\nuniform float uSpan;\nvarying vec3 vCoatW;\nvarying vec3 vCoatO;\n'
      + COAT_NOISE + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // 从头顶往下盖：液面前沿带一点噪声起伏
          float edge = uTopY - uShow * (uSpan + 0.3);
          float wave = (bcNoise(vCoatW * 6.0 + vec3(0.0, uTime * 2.0, 0.0)) - 0.5) * 0.18;
          if (vCoatW.y < edge + wave) discard;
          // 快碎时：裂纹网（细缝处镂空，露出下面的身体）
          float cn = bcNoise(vCoatO * 13.0);
          float crackLine = 1.0 - smoothstep(0.0, 0.035, abs(cn - 0.5));
          if (uCrack > 0.35 && crackLine * smoothstep(0.35, 1.0, uCrack) > 0.55) discard;
          float flow = bcNoise(vCoatW * 4.0 - vec3(0.0, uTime * 1.6, 0.0));
          float patina = smoothstep(0.55, 0.8, bcNoise(vCoatO * 7.0 + 3.1));
          vec3 cold = mix(diffuseColor.rgb, vec3(0.30, 0.52, 0.42), patina * 0.45);
          vec3 hot = mix(vec3(0.35, 0.05, 0.01), vec3(0.9, 0.3, 0.05), flow);
          diffuseColor.rgb = mix(cold, hot, uHeat);
        }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float flow2 = bcNoise(vCoatW * 5.0 - vec3(0.0, uTime * 2.2, 0.0));
          float drip = bcNoise(vCoatW * vec3(9.0, 3.0, 9.0) + vec3(0.0, uTime * 3.0, 0.0));
          vec3 lava = mix(vec3(1.0, 0.32, 0.05), vec3(1.0, 0.8, 0.35), smoothstep(0.55, 0.85, flow2 * 0.6 + drip * 0.5));
          totalEmissiveRadiance += lava * uHeat * (1.2 + 1.4 * flow2);
          float cn2 = bcNoise(vCoatO * 13.0);
          float cl = 1.0 - smoothstep(0.0, 0.06, abs(cn2 - 0.5));
          totalEmissiveRadiance += vec3(1.0, 0.45, 0.1) * cl * smoothstep(0.15, 0.6, uCrack) * (0.6 + 0.8 * uHeat);
        }`);
  };
  mat.customProgramCacheKey = () => 'bronze-coat';
  return mat;
}

const coatPool: BronzeCoat[] = [];
const _box = new THREE.Box3();

/**
 * 罩在一个同伴身上的铜甲（着色器层）。attach(root)：给 root 下每个实体网格（不含加法发光件 / 线 / 粒子）各加一个
 * 共用几何体的镀层子网格（骨骼蒙皮网格绑到同一套骨架），release() 摘掉。一只同伴一个，用 acquire / release 取还。
 */
export class BronzeCoat {
  readonly material: THREE.MeshStandardMaterial;
  private readonly u: CoatUniforms;
  private readonly layers: THREE.Mesh[] = [];
  private host: THREE.Object3D | null = null;
  private pooled = false;

  private constructor() {
    this.u = {
      uHeat: { value: 1 }, uShow: { value: 0 }, uCrack: { value: 0 }, uTime: { value: 0 },
      uTopY: { value: 2 }, uSpan: { value: 2 }, uInflate: { value: 0.012 },
    };
    this.material = coatMaterial(this.u);
  }

  static acquire(root: THREE.Object3D | null | undefined): BronzeCoat {
    const c = coatPool.pop() ?? new BronzeCoat();
    c.pooled = false;
    c.u.uHeat.value = 1;
    c.u.uShow.value = 0;
    c.u.uCrack.value = 0;
    if (root) c.attach(root);
    return c;
  }

  /** 镀层网格数（测试用） */
  get layerCount(): number {
    return this.layers.length;
  }

  private attach(root: THREE.Object3D): void {
    this.host = root;
    const targets: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || o.userData.bronzeCoat) return;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined;
      if (!mat || mat.type === 'MeshBasicMaterial' || mat.type === 'ShaderMaterial' || (mat as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending) return;
      targets.push(m);
    });
    for (const m of targets) {
      let layer: THREE.Mesh;
      const sk = m as THREE.SkinnedMesh;
      if (sk.isSkinnedMesh) {
        const s = new THREE.SkinnedMesh(sk.geometry, this.material);
        s.bind(sk.skeleton, sk.bindMatrix);
        s.bindMode = sk.bindMode;
        layer = s;
      } else layer = new THREE.Mesh(m.geometry, this.material);
      layer.userData.bronzeCoat = true;
      layer.castShadow = false;
      layer.receiveShadow = false;
      layer.renderOrder = 1;
      layer.frustumCulled = false;
      m.add(layer);
      this.layers.push(layer);
    }
  }

  /**
   * 每帧摆放：heat 1 = 通红、0 = 冷青铜；show 0..1 = 从头顶往下盖了多少；crack 0..1 = 裂纹；
   * feetY / height：同伴脚底高度与身高（世界坐标，决定从哪里盖到哪里）。
   */
  set(heat: number, show: number, crack: number, time: number, feetY: number, height: number): void {
    const u = this.u;
    u.uHeat.value = THREE.MathUtils.clamp(heat, 0, 1);
    u.uShow.value = THREE.MathUtils.clamp(show, 0, 1);
    u.uCrack.value = THREE.MathUtils.clamp(crack, 0, 1);
    u.uTime.value = time;
    u.uTopY.value = feetY + height + 0.15;
    u.uSpan.value = height + 0.15;
    this.material.opacity = 0.94;
  }

  /** 同伴模型的世界包围盒高度（取不到时返回 fallback） */
  static measureHeight(root: THREE.Object3D, fallback: number): number {
    _box.setFromObject(root, false);
    const h = _box.max.y - _box.min.y;
    return Number.isFinite(h) && h > 0.2 ? h : fallback;
  }

  release(): void {
    if (this.pooled) return;
    this.pooled = true;
    for (const l of this.layers) l.removeFromParent();
    this.layers.length = 0;
    this.host = null;
    coatPool.push(this);
  }
}

// ───────────────────────────── 傩面换脸 ─────────────────────────────

/**
 * 蒙皮属性里骨骼 joint 的权重（每个顶点 0..1）。skinIndex / skinWeight 缺失时全 0。
 */
export function maskWeights(geometry: THREE.BufferGeometry, joint: number): Float32Array {
  const pos = geometry.getAttribute('position');
  const out = new Float32Array(pos ? pos.count : 0);
  const si = geometry.getAttribute('skinIndex');
  const sw = geometry.getAttribute('skinWeight');
  if (!si || !sw || joint < 0) return out;
  for (let i = 0; i < out.length; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === joint) w += sw.getComponent(i, k);
    out[i] = w;
  }
  return out;
}

export interface NuoMaskHandle {
  /** 红漆区换成的颜色（线性空间）与浅色描金区换成的颜色 */
  paint: { value: THREE.Color };
  trim: { value: THREE.Color };
  /** 0 = 原贴图（赤面），1 = 完全换成 paint / trim */
  swap: { value: number };
  /** 面具眼睛的自发光颜色与强度 */
  eye: { value: THREE.Color };
  eyeGlow: { value: number };
  /** 碎面裂纹：0 = 完好，1、2、3 = 打碎过几张脸（裂纹越来越多） */
  crack: { value: number };
  /** 面具区域的中心（几何体空间，裂纹从这里放射） */
  center: THREE.Vector3;
  /** 有多少个顶点在面具区域里（权重 ≥ 0.5） */
  maskVerts: number;
}

/**
 * 在本体材质上叠傩面换脸：geometries 是用这个材质的蒙皮几何体（LOD0..2），joint 是 mask 骨在各自骨架里的下标。
 * 保留材质原有的 onBeforeCompile（角色边缘光）。
 */
export function applyNuoMask(material: THREE.MeshStandardMaterial, parts: readonly { geometry: THREE.BufferGeometry; joint: number }[]): NuoMaskHandle {
  const h: NuoMaskHandle = {
    paint: { value: new THREE.Color(1, 1, 1) }, trim: { value: new THREE.Color(1, 1, 1) }, swap: { value: 0 },
    eye: { value: new THREE.Color(1, 0.6, 0.2) }, eyeGlow: { value: 1 }, crack: { value: 0 },
    center: new THREE.Vector3(), maskVerts: 0,
  };
  const sum = new THREE.Vector3();
  let n = 0;
  parts.forEach((p, idx) => {
    const g = p.geometry;
    let attr = g.getAttribute('aMask') as THREE.BufferAttribute | undefined;
    if (!attr) {
      attr = new THREE.BufferAttribute(maskWeights(g, p.joint), 1);
      g.setAttribute('aMask', attr);
    }
    if (idx === 0) {
      const pos = g.getAttribute('position');
      for (let i = 0; i < attr.count; i++) {
        if (attr.getX(i) < 0.5) continue;
        sum.x += pos.getX(i);
        sum.y += pos.getY(i);
        sum.z += pos.getZ(i);
        n++;
      }
    }
  });
  h.maskVerts = n;
  if (n > 0) h.center.copy(sum).multiplyScalar(1 / n);
  const center = { value: h.center };
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      uNuoPaint: h.paint, uNuoTrim: h.trim, uNuoSwap: h.swap, uNuoEye: h.eye, uNuoEyeGlow: h.eyeGlow,
      uNuoCrack: h.crack, uNuoCenter: center,
    });
    shader.vertexShader = 'attribute float aMask;\nvarying float vNuoMask;\nvarying vec3 vNuoP;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n  vNuoMask = aMask;\n  vNuoP = position;');
    shader.fragmentShader = 'uniform vec3 uNuoPaint;\nuniform vec3 uNuoTrim;\nuniform float uNuoSwap;\nuniform vec3 uNuoEye;\nuniform float uNuoEyeGlow;\nuniform float uNuoCrack;\nuniform vec3 uNuoCenter;\nvarying float vNuoMask;\nvarying vec3 vNuoP;\n'
      + shader.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
        float nuoEye = 0.0;
        float nuoLine = 0.0;
        if (vNuoMask > 0.01) {
          vec3 c0 = diffuseColor.rgb;
          // 面具眼睛：贴图里的黄橙色（线性空间：红高、绿中、蓝很低）
          nuoEye = smoothstep(0.4, 0.7, c0.r) * smoothstep(0.22, 0.45, c0.g) * (1.0 - smoothstep(0.08, 0.25, c0.b)) * vNuoMask;
          float lum = dot(c0, vec3(0.299, 0.587, 0.114));
          float red = clamp((c0.r - max(c0.g, c0.b)) * 3.0, 0.0, 1.0) * (1.0 - nuoEye);
          float light = smoothstep(0.28, 0.5, lum) * (1.0 - red) * (1.0 - nuoEye);
          vec3 recol = c0;
          recol = mix(recol, uNuoPaint * (0.25 + 2.2 * lum), red);
          recol = mix(recol, uNuoTrim * (0.35 + 0.9 * lum), light);
          diffuseColor.rgb = mix(c0, recol, uNuoSwap * vNuoMask);
          // 碎面：从面具中心放射的裂缝（几条主缝 + 抖动），每打碎一张脸多一圈
          if (uNuoCrack > 0.0) {
            vec3 d = vNuoP - uNuoCenter;
            float r = length(d.xy);
            float a = atan(d.y, d.x);
            float k = 3.0 + 2.0 * uNuoCrack;
            float w = abs(fract(a / 6.2832 * k + 0.06 * sin(r * 90.0) + 0.13 * uNuoCrack) - 0.5);
            nuoLine = (1.0 - smoothstep(0.0, 0.025 + 0.01 * uNuoCrack, w * max(r, 0.01) * 9.0))
              * (1.0 - smoothstep(0.04 + 0.04 * uNuoCrack, 0.07 + 0.05 * uNuoCrack, r)) * vNuoMask;
            diffuseColor.rgb *= 1.0 - 0.85 * nuoLine;
          }
        }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uNuoEye * nuoEye * uNuoEyeGlow * 2.2;
        totalEmissiveRadiance += vec3(1.0, 0.42, 0.08) * nuoLine * 1.4;`);
  };
  material.customProgramCacheKey = () => `${prevKey}+nuomask`;
  material.needsUpdate = true;
  return h;
}

// ───────────────────────────── 地上的熔铜 / 余火 ─────────────────────────────

export interface FirePoolOpts {
  /** 每跳（0.5 秒）对玩家的伤害 */
  playerDamage: number;
  /** 每跳烫同伴（含施放者自己）：最大生命的比例（0 = 不烫同伴） */
  allyFrac: number;
  source: IEnemy | null;
  /** 贴花颜色（缺省熔铜金橙） */
  color?: number;
}

const _poolScratch: IEnemy[] = [];
const _pc = new THREE.Vector3();

/**
 * 地上一摊熔铜 / 余火：流动的熔岩贴花（0.35 秒铺开），每 0.5 秒烫一次站在里面的玩家（和同伴），最后 0.6 秒淡掉。
 * 登记成地火（FireFeed）：祸斗吃掉它时立刻熄灭。返回地火登记（测试用）。
 */
export function spawnFirePool(ctx: GameContext, center: THREE.Vector3, radius: number, life: number, opts: FirePoolOpts): FloorFireHandle {
  const at = center.clone();
  const decal = GroundDecal.acquire(ctx.stageGroup, opts.color ?? INFERNO_SUPPORT.molten).circle(at.x, at.y, at.z, 0.2);
  decal.pattern = 1;
  let age = 0, tick = 0.25, out = false;
  const fire = registerFloorFire(ctx, at, radius, life, () => {
    out = true;
  });
  ctx.tasks.add((dt) => {
    age += dt;
    tick -= dt;
    if (out) {
      // 被祸斗吃掉：0.25 秒内收拢熄灭，不再烫人
      age = Math.max(age, life - 0.25);
    }
    decal.setRadii(Math.max(0.2, radius * Math.min(1, age / 0.35)));
    decal.time = ctx.time.now;
    decal.opacity = THREE.MathUtils.clamp((life - age) / 0.6, 0, 1);
    if (!out && tick <= 0 && age < life - 0.3) {
      tick += 0.5;
      if (opts.playerDamage > 0) zonePlayer(ctx, at, radius, opts.playerDamage, 'fire', opts.source, 1.2);
      if (opts.allyFrac > 0) {
        const list = ctx.enemies.queryRadius(at, radius + 0.5, _poolScratch);
        const hit = list.filter((e) => e.alive && !e.flying && !e.isBoss && Math.abs(e.position.y - at.y) < 1
          && Math.hypot(e.position.x - at.x, e.position.z - at.z) <= radius + e.radius * 0.5);
        _poolScratch.length = 0;
        for (const e of hit) {
          const req: DamageRequest = { base: e.maxHp * opts.allyFrac, element: 'fire', source: 'status', canCrit: false, procDepth: 2,
            point: _pc.set(e.position.x, e.position.y + 0.2, e.position.z) };
          ctx.combat.damageEnemy(e, req);
        }
      }
    }
    if (age >= life) {
      decal.release();
      fire.remove();
      return true;
    }
    return false;
  });
  return fire;
}
