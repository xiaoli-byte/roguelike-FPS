/**
 * 碎刃第一人称刀光（Unity BladeTrail.cs + Fx/FxTrail.cs 的 FxTrailSpec + Fx/Presets/BladeTrail.cs 的数值，M10）。
 * 挂在第一人称视图里（相机空间），视图每帧把这一帧走过的挥砍进度细分采样，每个采样点记下刀身 35% 处（内沿）与伸长后的刀尖（外沿）的位置和外沿速度——
 * 刀光就是刀身扫过的那块面，和刀身严格同步。
 *   · 横截面：刀身扫过的面只画靠刃口的四成——短短一段过渡到带身色（墨笔的边）→ 外沿刃口暖白（两段色阶，普通混合：亮背景上也看得见）→ 外缘一道加色光边；
 *   · 墨笔起收锋：一条刀光沿长度方向两头收尖（最老的起笔端收成尖、贴刀的一端略收），读作一弯月牙；
 *   · 亮度跟速度走（{@link trailBrightness}）：出刀那两三帧满亮、收势越来越暗；最新的 0.04 s 再白热一点；
 *   · 采样点活 0.16 s（游戏时间：顿帧时刀光跟着停住），新一段斩击另起一条（{@link BladeTrail.break}），旧的自然淡掉；
 *   · 侧看补宽：刀身扫过的面侧对镜头时，内沿往屏幕上垂直于挥动方向的一侧推开（最多刀长 × 0.75），一条刀光里朝同一侧推。
 * 网页没有特效引擎的拖尾预设（M11b 在做），这里自带网格；外观参数照 Unity 预设，「随 M11b 换预设」。
 * 顶点色是线性值（THREE.Color.setHex 已按 sRGB 转线性；暖白按 sRGB 读），强度倍率在线性空间里乘，同 Unity FxVertexColor。
 */
import * as THREE from 'three';

/** 刀光外观（Unity FxTrailSpec，BladeTrailPreset 的值） */
export const TRAIL_SPEC = {
  life: 0.16, headTime: 0.04, maxSamples: 64, fringe: 0.1, bodyAlpha: 0.72, hotMix: 0.3, headHotMix: 0.45,
  bodyIntensity: 1.25, fringeIntensity: 2, screenWiden: 0.75, slowSpeed: 2.5, fastSpeed: 18, minBrightness: 0.25,
} as const;

/** 横截面：内沿 → InnerAt 透明 → MidAt 带身色 → 外沿刃口 → 外缘光边；墨笔起收锋 */
const INNER_AT = 0.5, MID_AT = 0.64, MID_ALPHA = 0.6;
const TAIL_TAPER = 0.42, HEAD_TAPER = 0.12;
const STRIDE = 6;
/** 刃口混向的暖白（玩家刀光偏金、偏灵火；sRGB） */
const WARM_WHITE = new THREE.Color().setRGB(1, 0.9, 0.66, THREE.SRGBColorSpace);

/** 外沿速度（米 / 秒，相机空间）→ 亮度 minBrightness..1（smoothstep；Unity FxTrailSpec.Brightness） */
export function trailBrightness(speed: number, spec = TRAIL_SPEC): number {
  const v = Number.isFinite(speed) ? speed : 0;
  let k = (v - spec.slowSpeed) / (spec.fastSpeed - spec.slowSpeed);
  k = Math.max(0, Math.min(1, k));
  k = k * k * (3 - 2 * k);
  return spec.minBrightness + (1 - spec.minBrightness) * k;
}

/** 墨笔起收锋的宽度系数：u = 这一点在这条刀光里的位置（0 = 最老的起笔端，1 = 贴着刀的最新端） */
export function brushWidth(u: number): number {
  let tail = Math.max(0, Math.min(1, u / TAIL_TAPER));
  tail = tail * tail * (3 - 2 * tail);
  const head = 1 - 0.3 * Math.max(0, Math.min(1, (u - (1 - HEAD_TAPER)) / HEAD_TAPER));
  return Math.sqrt(tail) * head;
}

interface Sample {
  inner: THREE.Vector3;
  outer: THREE.Vector3;
  age: number;
  bright: number;
  /** 新的一条从这里开始（不与前一个采样点连成带子） */
  start: boolean;
}

const _e = new THREE.Vector3();
const _m = new THREE.Vector3();
const _view = new THREE.Vector3();
const _n = new THREE.Vector3();
const _side = new THREE.Vector3();
const _push = new THREE.Vector3();
const _in = new THREE.Vector3();
const _hot = new THREE.Color();
const _mid = new THREE.Color();
const _cam = new THREE.Vector3();

export class BladeTrail {
  readonly mesh: THREE.Mesh;
  private readonly samples: Sample[];
  private count = 0;
  private breakNext = true;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly index: THREE.BufferAttribute;
  private readonly bodyMat: THREE.MeshBasicMaterial;
  private readonly fringeMat: THREE.MeshBasicMaterial;
  /** 最近一次 resetPeak 以来推入的最高亮度（测试读） */
  peakBrightness = 0;
  /** 最近一帧最大的侧看补宽比例（0 = 没补） */
  lastWiden = 0;

  constructor(readonly spec = TRAIL_SPEC) {
    const n = Math.max(4, Math.min(256, spec.maxSamples));
    this.samples = Array.from({ length: n }, () => ({ inner: new THREE.Vector3(), outer: new THREE.Vector3(), age: 0, bright: 0, start: true }));
    this.pos = new THREE.BufferAttribute(new Float32Array(n * STRIDE * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(n * STRIDE * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.index = new THREE.BufferAttribute(new Uint16Array((n - 1) * 24), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('color', this.col);
    this.geo.setIndex(this.index);
    // 带身：普通混合（亮背景上加色几乎看不见）；外缘光边：加色（alpha = 强度）
    this.bodyMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.fringeMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, [this.bodyMat, this.fringeMat]);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = 'demonBlade.trail';
    this.mesh.visible = false;
  }

  /** 现存的采样点数 */
  get size(): number {
    return this.count;
  }

  /** 这一帧画出来了（至少两个相连的采样点） */
  get visible(): boolean {
    return this.mesh.visible;
  }

  /** 最新一个采样点的亮度 */
  get lastBrightness(): number {
    return this.count > 0 ? this.samples[this.count - 1].bright : 0;
  }

  /** 全部清掉（切出这把刀、换关） */
  clear(): void {
    this.count = 0;
    this.breakNext = true;
    this.mesh.visible = false;
  }

  /** 下一个采样点另起一条（新一段斩击） */
  break(): void {
    this.breakNext = true;
  }

  resetPeak(): void {
    this.peakBrightness = 0;
  }

  /** 推入一个采样点（父物体局部坐标）：内沿、外沿、外沿速度（米 / 秒） */
  push(inner: THREE.Vector3, outer: THREE.Vector3, speed: number): void {
    if (![inner.x, inner.y, inner.z, outer.x, outer.y, outer.z].every(Number.isFinite)) return;
    const S = this.samples;
    if (this.count >= S.length) {
      const first = S.shift()!;
      S.push(first);
      this.count--;
      S[0].start = true;
    }
    const b = trailBrightness(speed, this.spec);
    const s = S[this.count++];
    s.inner.copy(inner);
    s.outer.copy(outer);
    s.age = 0;
    s.bright = b;
    s.start = this.breakNext;
    this.breakNext = false;
    if (b > this.peakBrightness) this.peakBrightness = b;
  }

  /** 每帧：采样点变老、过期的丢掉、重建网格（color = 这一刀的刀光色，人刀合一时偏白；camera = 侧看补宽用的相机） */
  tick(dt: number, color: THREE.Color, camera: THREE.Object3D | null): void {
    const S = this.samples;
    for (let i = 0; i < this.count; i++) S[i].age += dt;
    let dead = 0;
    while (dead < this.count && S[dead].age > this.spec.life) dead++;
    if (dead > 0) {
      const gone = S.splice(0, dead);
      S.push(...gone);
      this.count -= dead;
      if (this.count > 0) S[0].start = true;
    }
    let hasCam = false;
    if (camera) {
      camera.getWorldPosition(_cam);
      this.mesh.updateWorldMatrix(true, false);
      this.mesh.worldToLocal(_cam);
      hasCam = true;
    }
    this.mesh.visible = this.count >= 2 && this.rebuild(color, hasCam);
  }

  /** 侧看补宽后的内沿（Unity BladeTrail.WidenedInner），写进 out */
  private widenedInner(i: number, hasCam: boolean, st: { sign: number; max: number }, out: THREE.Vector3): THREE.Vector3 {
    const S = this.samples, s = S[i];
    out.copy(s.inner);
    if (!hasCam || this.spec.screenWiden <= 0) return out;
    _e.subVectors(s.outer, s.inner);
    const el = _e.length();
    if (i > 0 && !s.start) _m.subVectors(s.outer, S[i - 1].outer);
    else if (i + 1 < this.count && !S[i + 1].start) _m.subVectors(S[i + 1].outer, s.outer);
    else return out;
    if (el < 1e-4 || _m.lengthSq() < 1e-10) return out;
    _view.subVectors(s.outer, _cam).normalize();
    _n.crossVectors(_e, _m).normalize();
    const facing = Math.abs(_n.dot(_view));
    let need = 1 - Math.max(0, Math.min(1, (facing - 0.25) / 0.5));
    need = need * need * (3 - 2 * need);
    if (need <= 0.01) return out;
    _side.crossVectors(_view, _m).normalize();
    if (st.sign === 0) {
      const d = -_side.dot(_e);
      st.sign = Math.abs(d) > el * 0.05 ? Math.sign(d) : 1;
    }
    st.max = Math.max(st.max, need);
    _push.copy(s.outer).addScaledVector(_side, st.sign * el * this.spec.screenWiden);
    return out.lerp(_push, need);
  }

  /** 重写网格；没有相连的两点（画不出带子）返回 false */
  private rebuild(color: THREE.Color, hasCam: boolean): boolean {
    const S = this.samples, spec = this.spec;
    const P = this.pos.array as Float32Array, C = this.col.array as Float32Array;
    const st = { sign: 0, max: 0 };
    let stripStart = 0, stripEnd = 0;
    const put = (v: number, p: THREE.Vector3, c: THREE.Color, k: number, a: number): void => {
      P[v * 3] = p.x; P[v * 3 + 1] = p.y; P[v * 3 + 2] = p.z;
      C[v * 4] = c.r * k; C[v * 4 + 1] = c.g * k; C[v * 4 + 2] = c.b * k; C[v * 4 + 3] = a;
    };
    for (let i = 0; i < this.count; i++) {
      const s = S[i];
      if (s.start || i === 0) {
        st.sign = 0;
        stripStart = i;
        stripEnd = i;
        while (stripEnd + 1 < this.count && !S[stripEnd + 1].start) stripEnd++;
      }
      this.widenedInner(i, hasCam, st, _in);
      // 起收锋：内沿往刃口收（刃口不动），两头尖、中间饱满的一弯月牙
      const u = stripEnd > stripStart ? (i - stripStart) / (stripEnd - stripStart) : 1;
      const bw = brushWidth(u);
      _in.sub(s.outer).multiplyScalar(bw).add(s.outer);
      const life = Math.max(0, Math.min(1, 1 - s.age / Math.max(0.01, spec.life)));
      const head = Math.max(0, Math.min(1, 1 - s.age / Math.max(0.005, spec.headTime)));
      const fade = life * life;
      _hot.copy(color).lerp(WARM_WHITE, Math.max(0, Math.min(1, spec.hotMix + spec.headHotMix * head)));
      const k = spec.bodyIntensity * (0.55 + 0.45 * s.bright);
      const a = fade * spec.bodyAlpha * s.bright * (0.55 + 0.45 * bw);
      _mid.copy(color).lerp(_hot, 0.2);
      const v = i * STRIDE;
      put(v, _in, _mid, k, 0);
      put(v + 1, _e.copy(_in).lerp(s.outer, INNER_AT), _mid, k, 0);
      put(v + 2, _e.copy(_in).lerp(s.outer, MID_AT), _mid, k, a * MID_ALPHA);
      put(v + 3, s.outer, _hot, k, a);
      // 外缘光边：加色，刃口那一侧亮、向外收掉
      const f = spec.fringeIntensity;
      put(v + 4, s.outer, _hot, f, fade * s.bright * bw);
      put(v + 5, _e.copy(s.outer).sub(_in).multiplyScalar(spec.fringe).add(s.outer), _hot, f, 0);
    }
    this.lastWiden = st.max;
    const I = this.index.array as Uint16Array;
    let nb = 0;
    // 第一组：带身（InnerAt → MidAt → 外沿两段）；第二组：外缘光边
    for (let i = 1; i < this.count; i++) {
      if (S[i].start) continue;
      const A = (i - 1) * STRIDE, B = i * STRIDE;
      for (let r = 1; r < 3; r++) {
        I[nb++] = A + r; I[nb++] = A + r + 1; I[nb++] = B + r;
        I[nb++] = A + r + 1; I[nb++] = B + r + 1; I[nb++] = B + r;
      }
    }
    const body = nb;
    for (let i = 1; i < this.count; i++) {
      if (S[i].start) continue;
      const A = (i - 1) * STRIDE, B = i * STRIDE;
      I[nb++] = A + 4; I[nb++] = A + 5; I[nb++] = B + 4;
      I[nb++] = A + 5; I[nb++] = B + 5; I[nb++] = B + 4;
    }
    if (body === 0) return false;
    this.geo.clearGroups();
    this.geo.addGroup(0, body, 0);
    this.geo.addGroup(body, nb - body, 1);
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.index.needsUpdate = true;
    return true;
  }

  dispose(): void {
    this.geo.dispose();
    this.bodyMat.dispose();
    this.fringeMat.dispose();
  }
}

