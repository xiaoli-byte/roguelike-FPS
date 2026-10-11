/**
 * 英雄选人演出（docs/art/hero-roster-v2.md「选人界面演出」）：出场、循环待机、待机里随机穿插的小动作。
 *
 * 每位英雄一份时间线，每帧把姿势写进一个 Pose（全部在角色自身坐标里：+Z 面朝、+Y 向上、+X 是角色的左边；
 * 角度为弧度，长度为米、已按英雄身高缩放），由 nativeTripo.ts 执行到骨骼上（髋 / 腿 IK、脊椎、双手 IK、
 * 枪的三个位置、尾巴 / 耳朵的意图姿势 + 弹簧骨骼）。特效字段（fx）由 heroShowFx.ts 画出来。
 *
 * 性格决定节奏：燎快、冲过头再弹回；磐慢、蓄力长、落点重；鼯轻、飘、一惊一乍。
 * 活动范围按绑定检查（art/tools/review_native_rig.py）定：手臂抬起不超过约 100°、尾巴单节不超过约 15°、
 * 耳朵不超过约 20°——再大蒙皮会拉坏。
 */

export type Vec = [number, number, number];

export interface ArmPose {
  /** 0 = 手在 target，1 = 手握在枪上（两者之间平滑插值） */
  onGun: number;
  target: Vec;
  /** 肘部朝向的参考点（角色坐标） */
  pole: Vec;
  /** 空手时的手指弯曲：0 张开、1 握拳 */
  curl: number;
}

export interface Pose {
  /** 整个模型的偏移 / 朝向（空降、滑翔入场） */
  root: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };
  /** 髋：下沉（米）、侧移、俯仰（+ 前倾）、左右转、侧倾（+ 向角色右侧倾） */
  hips: { drop: number; x: number; pitch: number; yaw: number; roll: number };
  /** 脚相对绑定位置的偏移（米）；腿用 IK 钉住，脚掌保持水平 */
  footL: Vec;
  footR: Vec;
  /** 躯干（分给 Spine / Spine1 / Spine2）、脖子、头：[俯仰 + 前倾 / 低头, 转向 + 向左, 侧倾 + 向右] */
  spine: Vec;
  neck: Vec;
  head: Vec;
  /** 枪：shoulder / back 为两个位置的权重（其余为手持低位），spin 为绕扳机护圈的转角 */
  gun: { shoulder: number; back: number; spin: number; lift: number };
  right: ArmPose;
  left: ArmPose;
  /** 尾巴意图：整体俯仰（+ 上翘）、左右（+ 向左）、卷曲（每节递增）、波动相位幅度 */
  tail: { pitch: number; yaw: number; curl: number; wave: number; phase: number };
  /** 耳朵：+ 向后贴 / − 向前甩 */
  earL: number;
  earR: number;
  /** 特效参数（含义见各英雄的 fx 说明） */
  fx: Record<string, number>;
}

export interface HeroShow {
  /** 'rise' = 从光柱里升起（预览台做升起）；'self' = 模型自己入场（空降 / 滑翔），预览台直接显形 */
  entrance: 'rise' | 'self';
  /** 出场时长（秒） */
  intro: number;
  /** 出场中从第几秒起计入取景（之前在画外） */
  frameFrom: number;
  /** 写入一帧姿势：u = 出场进行的秒数（< 0 表示不在出场中），t = 累计时钟，fid = 当前小动作（含进度） */
  pose(P: Pose, u: number, t: number, fid: { index: number; u: number; w: number } | null): void;
  /** 小动作：时长与触发间隔 */
  fidgets: readonly number[];
  fidgetGap: [number, number];
}

// ───────────────────────────── 时间线工具 ─────────────────────────────

type Ease = 'lin' | 'io' | 'out' | 'in' | 'back' | 'hold';
/** 关键帧：[时刻, 数值, 进入这一帧的缓动] */
type Key = readonly [number, number, Ease?];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
function ease(e: Ease, x: number): number {
  switch (e) {
    case 'lin': return x;
    case 'in': return x * x * x;
    case 'out': return 1 - (1 - x) ** 3;
    case 'back': { const c = 1.9; const y = x - 1; return 1 + (c + 1) * y * y * y + c * y * y; }
    case 'hold': return x < 1 ? 0 : 1;
    default: return x * x * (3 - 2 * x);
  }
}
/** 分段关键帧插值（越界取端点） */
export function track(keys: readonly Key[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * ease(e ?? 'io', clamp01((t - t0) / (t1 - t0 || 1)));
    }
  }
  return keys[keys.length - 1][1];
}
/** 0 → 1 → 0 的包络：a 到 b 淡入，c 到 d 淡出 */
export function env(t: number, a: number, b: number, c: number, d: number): number {
  if (t <= a || t >= d) return 0;
  if (t < b) return ease('io', (t - a) / (b - a));
  if (t <= c) return 1;
  return 1 - ease('io', (t - c) / (d - c));
}
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const mixV = (a: Vec, b: Vec, k: number): Vec => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
/** 平滑噪声（几个正弦叠加，-1..1） */
const wob = (t: number, s: number): number => (Math.sin(t * 1.0 + s) * 0.6 + Math.sin(t * 2.31 + s * 1.7) * 0.3 + Math.sin(t * 5.13 + s * 2.9) * 0.1);

export function neutralPose(P: Pose): void {
  P.root.x = P.root.y = P.root.z = P.root.yaw = P.root.pitch = P.root.roll = 0;
  P.hips.drop = P.hips.x = P.hips.pitch = P.hips.yaw = P.hips.roll = 0;
  P.footL = [0, 0, 0];
  P.footR = [0, 0, 0];
  P.spine = [0, 0, 0];
  P.neck = [0, 0, 0];
  P.head = [0, 0, 0];
  P.gun.shoulder = P.gun.back = P.gun.spin = P.gun.lift = 0;
  P.right.onGun = 1;
  P.left.onGun = 1;
  P.right.curl = P.left.curl = 0.3;
  P.tail.pitch = P.tail.yaw = P.tail.curl = P.tail.wave = P.tail.phase = 0;
  P.earL = P.earR = 0;
  for (const k of Object.keys(P.fx)) P.fx[k] = 0;
}

export function createPose(): Pose {
  const arm = (): ArmPose => ({ onGun: 1, target: [0, 0, 0], pole: [0, 0, 0], curl: 0.3 });
  const P: Pose = {
    root: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 },
    hips: { drop: 0, x: 0, pitch: 0, yaw: 0, roll: 0 },
    footL: [0, 0, 0], footR: [0, 0, 0], spine: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    gun: { shoulder: 0, back: 0, spin: 0, lift: 0 },
    right: arm(), left: arm(),
    tail: { pitch: 0, yaw: 0, curl: 0, wave: 0, phase: 0 },
    // 没写到的特效字段读作 0（各英雄只写自己用到的几个）
    earL: 0, earR: 0, fx: new Proxy({} as Record<string, number>, { get: (o, k: string) => o[k] ?? 0 }),
  };
  return P;
}

/**
 * 身体地标（角色坐标、绑定姿势、按英雄身高）：时间线里的空手目标点相对它们写，换英雄不用改数字。
 * s = 身高 / 1.6（时间线里的长度都写成「1.6 米英雄」的米数再乘 s）。
 */
export interface Landmarks {
  s: number;
  shoulderL: Vec; shoulderR: Vec; hipL: Vec; hipR: Vec; chest: Vec; head: Vec;
}

const add = (a: Vec, x: number, y: number, z: number, s: number): Vec => [a[0] + x * s, a[1] + y * s, a[2] + z * s];

// ───────────────────────────── 燎：嘴硬手快的爆竹游侠 ─────────────────────────────
/**
 * fx：cracker（左手里的爆竹：1 = 拿在手里，2 = 飞出去）、crackerT（飞行进度 0–1）、fuse（引信火星 0–1）、
 *     burst（头顶炸开 0–1 的进程）、lamp（火折子灯火苗窜高 0–1）。
 */
export function redPandaShow(L: Landmarks): HeroShow {
  const s = L.s;
  const shoulderGunPole: Vec = add(L.shoulderR, -0.35, -0.35, -0.2, s);
  const hipLeft: Vec = add(L.hipL, 0.06, 0.02, 0.0, s);           // 叉腰：手背贴胯
  const akimboPole: Vec = add(L.shoulderL, 0.45, -0.15, -0.1, s);
  const bandolier: Vec = add(L.chest, -0.05, 0.02, 0.13, s);      // 胸前斜挎的爆竹
  const lamp: Vec = add(L.hipL, 0.05, -0.04, 0.1, s);            // 腰间火折子灯
  const overhead: Vec = add(L.shoulderL, 0.04, 0.3, 0.2, s);      // 手臂抬约 90°、略朝前（再高斜挎带会被左臂扯长）
  const catchPt: Vec = add(L.chest, 0.08, 0.06, 0.24, s);

  return {
    entrance: 'rise',
    intro: 2.2,
    frameFrom: 0,
    fidgets: [2.4, 2.6, 1.8],
    fidgetGap: [7, 11],
    pose(P, u, t, fid) {
      neutralPose(P);
      // ── 待机（6 秒一循环）：重心在两胯之间换，枪扛在肩上随呼吸轻颠，尾巴慢摆，耳朵偶尔一抖
      const w = Math.sin((t * Math.PI * 2) / 6);
      const breath = Math.sin(t * 1.7);
      P.hips.x = 0.025 * s * w;
      P.hips.roll = -0.05 * w;
      P.footL = [0, 0, 0.02 * s];
      P.footR = [0, 0, -0.03 * s];
      P.hips.yaw = 0.08;
      P.spine = [-0.05 + 0.015 * breath, -0.06, 0.04 * w];
      P.head = [0.02 * wob(t * 0.5, 1), 0.12 * wob(t * 0.35, 2) - 0.05, -0.03 * w];
      P.gun.shoulder = 1;
      P.gun.lift = 0.012 * breath;
      P.left.onGun = 0;
      P.left.target = hipLeft;
      P.left.pole = akimboPole;
      P.left.curl = 0.7;
      P.tail.pitch = 0.25 + 0.05 * breath;
      P.tail.yaw = 0.35 * Math.sin(t * 0.9);
      P.tail.wave = 0.08;
      P.tail.phase = t * 1.4;
      const twitch = (tt: number, period: number): number => { const x = tt % period; return x < 0.18 ? Math.sin((x / 0.18) * Math.PI) : 0; };
      P.earR = -0.3 * twitch(t + 0.7, 3.1);
      P.earL = -0.3 * twitch(t + 2.0, 4.3);

      // ── 小动作
      if (fid) {
        const { index, u: fu, w: fw } = fid;
        if (index === 0) {
          // 掏出一枚爆竹（不点火）抛起接住，冲镜头歪头一笑
          const hand: Vec = fu < 0.5 ? mixV(bandolier, catchPt, clamp01(fu / 0.45))
            : fu < 1.0 ? catchPt : fu < 1.6 ? mixV(catchPt, add(catchPt, 0, 0.05, 0, s), env(fu, 1.0, 1.15, 1.35, 1.6)) : catchPt;
          P.left.target = mixV(P.left.target, fu < 2.0 ? hand : hipLeft, fw);
          P.left.pole = mixV(P.left.pole, add(L.shoulderL, 0.3, -0.4, -0.1, s), fw);
          P.left.curl = mix(P.left.curl, fu > 1.05 && fu < 1.45 ? 0.1 : 0.85, fw);
          P.fx.cracker = fu > 0.3 && fu < 2.1 ? 1 : 0;
          P.fx.crackerToss = env(fu, 1.05, 1.25, 1.25, 1.45);
          P.head[0] += fw * track([[0, 0], [1.05, 0], [1.25, -0.22], [1.45, 0.05], [1.9, 0]], fu);
          P.head[2] += fw * track([[0, 0], [1.6, 0], [1.8, 0.22, 'back'], [2.3, 0]], fu);
          P.head[1] += fw * 0.15;
        } else if (index === 1) {
          // 对着火折子灯吹一口气，灯火呼地窜高，满意地点头
          P.spine[0] += fw * 0.28;
          P.spine[1] += fw * 0.22;
          P.head = mixV(P.head, [0.42, 0.35, 0.05], fw * env(fu, 0.2, 0.6, 1.4, 1.8));
          P.left.target = mixV(P.left.target, add(lamp, 0.02, 0.04, 0.03, s), fw);
          P.left.curl = mix(P.left.curl, 0.4, fw);
          P.fx.lamp = env(fu, 0.75, 0.9, 1.3, 1.8);
          P.head[0] += fw * track([[0, 0], [1.9, 0], [2.1, 0.18], [2.3, 0], [2.45, 0.12], [2.6, 0]], fu);
        } else {
          // 一团火灵飘到脸前：嫌烦地用尾巴扫开
          P.tail.yaw = mix(P.tail.yaw, track([[0, 0.35], [0.35, 0.5], [0.55, -1.0, 'out'], [1.1, -0.6], [1.8, 0.35]], fu), fw);
          P.tail.pitch = mix(P.tail.pitch, 0.6, fw * env(fu, 0.2, 0.45, 0.8, 1.4));
          P.head[1] += fw * track([[0, 0], [0.3, -0.25], [0.6, 0.2], [1.2, 0]], fu);
          P.head[0] += fw * track([[0, 0], [0.3, -0.1], [0.6, 0.05], [1.2, 0]], fu);
          P.spine[1] += fw * track([[0, 0], [0.45, 0.12], [0.6, -0.15, 'out'], [1.3, 0]], fu);
          P.fx.swat = env(fu, 0.4, 0.5, 0.7, 1.0);
        }
      }

      // ── 出场（2.2 秒）
      if (u >= 0) {
        const k = 1 - env(u, -1, 0, 1.75, 2.2);  // 0 = 完全按出场，1 = 回到待机
        const crouch = track([[0, 1], [0.25, 1], [0.42, -0.15, 'out'], [0.6, 0.0], [1.0, 0], [1.35, 0.18], [1.6, -0.06, 'out'], [1.9, 0]], u);
        P.hips.drop = mix(0.16 * s * Math.max(0, crouch), P.hips.drop, k) - (crouch < 0 ? -0.02 * s * crouch : 0);
        P.hips.pitch = mix(0.25 * Math.max(0, crouch), P.hips.pitch, k);
        P.spine = mixV([0.35 * crouch - 0.12 * env(u, 0.9, 1.05, 1.2, 1.5), 0.1, 0], P.spine, k);
        P.head = mixV([track([[0, -0.35], [0.4, 0.0], [0.9, -0.2], [1.05, -0.45, 'out'], [1.35, -0.1], [1.7, 0.05]], u), track([[0, 0], [0.5, 0.25], [1.0, 0.1], [1.6, -0.12]], u), 0], P.head, k);
        P.footL = mixV([0.03 * s, 0, 0.05 * s], P.footL, k);
        P.footR = mixV([-0.02 * s, 0, -0.04 * s], P.footR, k);
        // 右手：0.55–1.05 让枪绕扳机护圈甩一圈，1.2–1.5 甩上右肩
        P.gun.spin = track([[0, 0], [0.55, 0], [1.05, Math.PI * 2, 'out']], u);
        P.gun.shoulder = mix(track([[0, 0], [1.2, 0], [1.5, 1, 'back']], u), 1, k);
        // 左手：抽爆竹（0.25）→ 在灯上一擦（0.42）→ 高抛（0.55–0.62 出手）→ 叉腰（1.35）
        const lt: Vec = u < 0.3 ? mixV(lamp, bandolier, clamp01(u / 0.3))
          : u < 0.45 ? mixV(bandolier, lamp, ease('io', (u - 0.3) / 0.15))
            : u < 0.62 ? mixV(lamp, overhead, ease('out', (u - 0.45) / 0.17))
              : u < 1.2 ? mixV(overhead, add(L.shoulderL, 0.15, 0.1, 0.15, s), ease('io', (u - 0.62) / 0.58))
                : mixV(add(L.shoulderL, 0.15, 0.1, 0.15, s), hipLeft, ease('back', clamp01((u - 1.2) / 0.25)));
        P.left.onGun = 0;
        P.left.target = mixV(lt, P.left.target, k);
        P.left.pole = mixV(u < 1.2 ? add(L.shoulderL, 0.4, -0.35, -0.1, s) : akimboPole, P.left.pole, k);
        P.left.curl = mix(u > 0.58 && u < 1.2 ? 0.05 : 0.85, P.left.curl, k);
        // 尾巴：盘在脚边 → 跟着弹起 → 1.35 向上甩成 S 形
        P.tail.pitch = mix(track([[0, -0.35], [0.4, 0.1], [1.3, 0.15], [1.45, 0.6, 'back'], [2.0, 0.3]], u), P.tail.pitch, k);
        P.tail.yaw = mix(track([[0, 0.9], [0.5, 0.2], [1.3, -0.2], [1.5, 0.3]], u), P.tail.yaw, k);
        P.tail.wave = mix(track([[0, 0], [1.35, 0], [1.5, 0.18], [2.2, 0.08]], u), P.tail.wave, k);
        P.tail.phase = u * 6;
        P.earR = mix(track([[0, 0.25], [0.4, 0], [1.4, 0], [1.5, -0.35], [1.62, 0.05], [1.8, 0]], u), P.earR, k);
        P.earL = mix(track([[0, 0.25], [0.4, 0], [1.05, 0.2], [1.3, 0]], u), P.earL, k);
        P.fx.cracker = u > 0.22 && u < 0.6 ? 1 : u >= 0.6 && u < 1.05 ? 2 : 0;
        P.fx.crackerT = clamp01((u - 0.6) / 0.45);
        P.fx.fuse = u > 0.4 && u < 1.05 ? 1 : 0;
        P.fx.burst = u >= 1.05 ? clamp01((u - 1.05) / 0.9) : 0;
      }
    },
  };
}

// ───────────────────────────── 磐：慢吞吞、推不动的工匠武僧 ─────────────────────────────
/**
 * fx：ball（1 = 显示鳞球、隐藏本体）、ballY（鳞球离地高度，米）、impact（落地冲击 0–1 的进程）、
 *     punch（拳砸地裂纹 0–1 的进程）、scales（鳞缝发光强度 0–1）、ripple（背鳞波浪抖动 0–1 的进程）、
 *     knock（敲炮管的火星脉冲）、bob（铜线锤 0–1）。
 */
export function pangolinShow(L: Landmarks): HeroShow {
  const s = L.s;
  const fistFront: Vec = add(L.hipR, -0.05, -0.28, 0.32, s);
  const hugHeadL: Vec = add(L.head, 0.1, 0.02, 0.18, s);
  const hugHeadR: Vec = add(L.head, -0.1, 0.02, 0.18, s);
  const barrel: Vec = add(L.shoulderR, 0.12, 0.08, 0.2, s);
  const bobHold: Vec = add(L.chest, 0.24, 0.16, 0.34, s);   // 举到身侧齐肩高，线锤垂在胸前、不挡脸
  return {
    entrance: 'self',
    intro: 2.6,
    frameFrom: 0.3,
    fidgets: [2.6, 3.2, 3.0],
    fidgetGap: [9, 13],
    pose(P, u, t, fid) {
      neutralPose(P);
      // ── 待机（8 秒）：双脚钉地、胯不晃，只有又深又慢的呼吸；钻炮扛在肩上；尾巴像扫帚一样贴地慢扫
      const br = Math.sin((t * Math.PI * 2) / 4);
      P.footL = [0.02 * s, 0, 0.02 * s];
      P.footR = [-0.02 * s, 0, 0];
      P.spine = [-0.03 * br - 0.02, 0.04, 0];
      P.neck = [0.02 * br, 0, 0];
      P.head = [0.05 + 0.02 * wob(t * 0.3, 3), 0.08 * wob(t * 0.22, 1), 0.04];
      P.gun.shoulder = 1;
      P.gun.lift = 0.006 * br;
      P.left.onGun = 0;
      P.left.target = add(L.hipL, 0.08, 0.05, 0.08, s);
      P.left.pole = add(L.shoulderL, 0.4, -0.3, -0.15, s);
      P.left.curl = 0.8;
      P.tail.pitch = -0.12;
      P.tail.yaw = 0.25 * Math.sin((t * Math.PI * 2) / 8);
      P.tail.phase = t * 0.8;
      P.tail.wave = 0.04;
      P.fx.scales = 0.45 + 0.35 * br;

      if (fid) {
        const { index, u: fu, w: fw } = fid;
        if (index === 0) {
          // 用指节敲敲钻炮炮管，侧耳听声，满意地点头（工匠检查手艺）
          const tap = (x: number): number => Math.max(0, Math.sin(x * Math.PI * 2 * 2.2)) ** 3;
          const knock = fu > 0.6 && fu < 1.7 ? tap(fu - 0.6) : 0;
          P.left.target = mixV(P.left.target, add(barrel, 0, 0.03 * knock * s, 0, s), fw);
          P.left.pole = mixV(P.left.pole, add(L.shoulderL, 0.2, -0.45, 0.0, s), fw);
          P.left.curl = mix(P.left.curl, 1, fw);
          P.head = mixV(P.head, [0.12, -0.35, -0.28], fw * env(fu, 0.4, 0.8, 1.7, 2.0));
          P.head[0] += fw * track([[0, 0], [2.0, 0], [2.2, 0.2], [2.4, 0], [2.6, 0]], fu);
          P.fx.knock = knock;
        } else if (index === 1) {
          // 提起铜线锤看垂线，再看祭台，点头：「正。」
          P.left.target = mixV(P.left.target, bobHold, fw);
          P.left.pole = mixV(P.left.pole, add(L.shoulderL, 0.35, -0.5, 0.0, s), fw);
          P.left.curl = mix(P.left.curl, 0.9, fw);
          P.fx.bob = fw;
          // 先眯眼盯着垂线（头偏向线锤），再低头看祭台，最后郑重点头
          P.head = mixV(P.head, [track([[0, 0.1], [0.6, 0.05], [1.6, 0.05], [2.0, 0.6], [2.5, 0.6], [2.7, 0.85], [2.85, 0.55], [3.0, 0.75]], fu),
            track([[0, 0.05], [0.6, 0.35], [1.6, 0.35], [2.0, 0.0]], fu), track([[0, 0], [0.6, 0.18], [1.6, 0.18], [2.0, 0]], fu)], fw);
          P.spine[0] += fw * 0.1;
          P.spine[1] += fw * 0.12 * env(fu, 0.3, 0.6, 1.6, 2.0);
        } else {
          // 大哈欠伸懒腰（手臂抬到约 90°），背鳞顺着脊背波浪般抖一遍
          const up = env(fu, 0.2, 0.9, 1.6, 2.2);
          P.spine = mixV(P.spine, [-0.22, 0, 0], fw * up);
          P.head = mixV(P.head, [-0.4, 0, 0], fw * up);
          P.gun.shoulder = 1;
          P.left.target = mixV(P.left.target, add(L.shoulderL, 0.32, 0.22, 0.05, s), fw * up);
          P.left.pole = mixV(P.left.pole, add(L.shoulderL, 0.2, -0.3, -0.3, s), fw * up);
          P.left.curl = mix(P.left.curl, 0.2, fw * up);
          P.fx.ripple = clamp01((fu - 2.0) / 0.9);
          P.spine[2] += fw * 0.06 * Math.sin(fu * 30) * env(fu, 2.0, 2.1, 2.6, 2.9);
          P.tail.pitch += fw * 0.15 * up;
        }
      }

      // ── 出场（2.6 秒）：鳞球从天而降 → 砸地弹一下 → 展开（0.55）→ 慢慢站起、背鳞依次张开 →
      //    1.3 右拳砸地 → 1.6 从背后抡出钻炮上肩 → 低头一笑
      if (u >= 0) {
        const k = 1 - env(u, -1, 0, 2.2, 2.6);
        const fall = u < 0.35 ? 3.2 * s * (1 - (u / 0.35) ** 2) : 0;   // 0.35 秒内匀加速落地
        const bounce = u >= 0.35 && u < 0.55 ? 0.12 * s * Math.sin(((u - 0.35) / 0.2) * Math.PI) : 0;
        P.fx.ball = u < 0.55 ? 1 : 0;
        P.fx.ballY = u < 0.35 ? fall : bounce;
        P.fx.impact = u >= 0.35 ? clamp01((u - 0.35) / 0.9) : 0;
        const stand = track([[0, 0], [0.55, 0], [1.15, 1, 'io'], [1.25, 1], [1.4, 0.55, 'out'], [1.6, 0.6], [1.95, 1]], u);
        P.hips.drop = mix(0.3 * s * (1 - stand), P.hips.drop, k);
        P.hips.pitch = mix(0.5 * (1 - stand), P.hips.pitch, k);
        P.spine = mixV([0.75 * (1 - stand) + 0.3 * env(u, 1.2, 1.32, 1.45, 1.7), -0.15 * env(u, 1.2, 1.3, 1.5, 1.7), 0], P.spine, k);
        P.head = mixV([track([[0, 0.5], [0.55, 0.5], [1.1, 0.0], [1.3, 0.25], [1.6, 0.0], [2.05, 0.2], [2.3, 0.08]], u), 0, 0], P.head, k);
        P.footL = mixV([0.05 * s, 0, 0.04 * s], P.footL, k);
        P.footR = mixV([-0.06 * s, 0, 0.0], P.footR, k);
        // 枪：出场前背在背后；右手 1.6–1.72 伸到背后握住，1.75–2.15 抡上右肩
        const toShoulder = track([[0, 0], [1.75, 0], [2.15, 1, 'back']], u);
        P.gun.back = 1 - toShoulder;
        P.gun.shoulder = mix(toShoulder, 1, k);
        // 右手：抱头 → 张开放到胯边 → 1.3 砸地 → 收回 → 1.6–1.72 伸到右肩后方握住背上的钻炮（之后跟着枪走）
        const hipSide = add(L.hipR, -0.2, 0.05, 0.1, s);
        const overBack = add(L.shoulderR, -0.04, 0.12, -0.2, s);
        const rt: Vec = u < 0.6 ? hugHeadR : u < 1.2 ? mixV(hugHeadR, hipSide, ease('io', (u - 0.6) / 0.6))
          : u < 1.5 ? mixV(hipSide, fistFront, env(u, 1.2, 1.3, 1.36, 1.5))
            : mixV(hipSide, overBack, ease('io', clamp01((u - 1.5) / 0.22)));
        P.right.onGun = mix(clamp01((u - 1.66) / 0.08), 1, k);
        P.right.target = rt;
        P.right.curl = u > 1.2 && u < 1.5 ? 1 : 0.4;
        const lt: Vec = u < 0.6 ? hugHeadL : mixV(hugHeadL, P.left.target, ease('io', clamp01((u - 0.6) / 0.6)));
        P.left.target = mixV(lt, P.left.target, k);
        P.left.pole = mixV(add(L.shoulderL, 0.45, -0.25, -0.1, s), P.left.pole, k);
        P.left.curl = mix(u < 0.6 ? 0.5 : 0.8, P.left.curl, k);
        P.tail.pitch = mix(track([[0, -0.5], [0.55, -0.5], [1.1, -0.1], [1.35, 0.15], [1.7, -0.12]], u), P.tail.pitch, k);
        P.tail.curl = mix(track([[0, 0.12], [0.55, 0.12], [1.1, 0]], u), 0, k);
        P.fx.punch = u >= 1.32 ? clamp01((u - 1.32) / 1.0) : 0;
        P.fx.scales = mix(Math.max(env(u, 0.55, 0.6, 1.0, 1.15), env(u, 1.3, 1.35, 1.5, 1.8)) * 1.2, P.fx.scales, k);
        P.fx.ripple = u > 0.55 && u < 1.2 ? (u - 0.55) / 0.65 : u > 1.6 && u < 2.0 ? (u - 1.6) / 0.4 : 0;
      }
    },
  };
}

// ───────────────────────────── 鼯：好奇、毛手毛脚的雷鼓机关师 ─────────────────────────────
/**
 * fx：sparks（护腕线圈火花 0–1）、arc（护腕与枪身线圈之间的电弧 0–1）、drum（雷鼓亮起一圈电光 0–1 的进程）、
 *     wind（滑翔风线 0–1）、dust（落地扬尘 0–1 的进程）、shock（电到手的一下 0–1）。
 */
export function flyingSquirrelShow(L: Landmarks): HeroShow {
  const s = L.s;
  const wideL: Vec = add(L.shoulderL, 0.42, -0.05, 0.02, s);
  const wideR: Vec = add(L.shoulderR, -0.42, -0.05, 0.02, s);
  const goggles: Vec = add(L.head, 0.06, 0.12, 0.12, s);
  const bracerLook: Vec = add(L.chest, 0.12, 0.1, 0.3, s);
  const mouth: Vec = add(L.head, 0.03, -0.06, 0.16, s);
  return {
    entrance: 'self',
    intro: 2.4,
    frameFrom: 0.55,
    fidgets: [2.2, 2.0, 1.6],
    fidgetGap: [6, 9],
    pose(P, u, t, fid) {
      neutralPose(P);
      // ── 待机（5 秒）：站姿轻快、脚跟微抬；头每隔 1–3 秒快速歪一下、停住、再换一边；扁尾一抖一抖
      const bob = Math.abs(Math.sin(t * 2.4));
      P.hips.drop = -0.006 * s * bob;
      P.spine = [-0.04 + 0.01 * Math.sin(t * 2.0), 0, 0];
      // 头：分段保持的随机朝向（一惊一乍：快转、急停）
      const seg = Math.floor(t / 1.7);
      const fr = t / 1.7 - seg;
      const rnd = (n: number): number => { const x = Math.sin(n * 12.9898) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
      const snap = ease('back', clamp01(fr / 0.12));
      P.head = [mix(0.1 * rnd(seg), 0.1 * rnd(seg + 1), snap), mix(0.35 * rnd(seg + 7), 0.35 * rnd(seg + 8), snap), mix(0.22 * rnd(seg + 3), 0.22 * rnd(seg + 4), snap)];
      P.right.onGun = 1;
      P.left.onGun = 1;
      const flick = (tt: number): number => { const x = tt % 2.3; return x < 0.4 ? Math.sin(x * 40) * (1 - x / 0.4) : 0; };
      P.tail.pitch = 0.35 + 0.05 * Math.sin(t * 1.3);
      P.tail.yaw = 0.1 * Math.sin(t * 0.7) + 0.25 * flick(t);
      P.tail.wave = 0.05;
      P.tail.phase = t * 2;
      P.earL = -0.12 * flick(t + 1.1);
      P.earR = -0.12 * flick(t + 0.4);

      if (fid) {
        const { index, u: fu, w: fw } = fid;
        if (index === 0) {
          // 拧护腕上的线圈，电火花炸了一下，甩手吹手指
          P.left.onGun = mix(1, 0, fw);
          const lt: Vec = fu < 1.1 ? bracerLook : fu < 1.6 ? add(bracerLook, 0.04 * Math.sin(fu * 60), 0, 0, s) : mouth;
          P.left.target = lt;
          P.left.pole = add(L.shoulderL, 0.4, -0.4, -0.1, s);
          P.left.curl = fu > 1.6 ? 0.1 : 0.5;
          P.head = mixV(P.head, [0.35, 0.3, 0.1], fw * env(fu, 0.1, 0.4, 1.0, 1.2));
          P.fx.sparks = env(fu, 0.5, 0.6, 0.95, 1.05);
          P.fx.shock = env(fu, 0.95, 1.0, 1.05, 1.3);
          P.earL += fw * -0.3 * env(fu, 0.95, 1.0, 1.2, 1.5);
          P.earR += fw * -0.3 * env(fu, 0.95, 1.0, 1.2, 1.5);
          P.tail.pitch += fw * 0.4 * env(fu, 0.95, 1.0, 1.3, 1.6);
        } else if (index === 1) {
          // 拉下风镜盯着镜头看，再推回去
          P.left.onGun = mix(1, 0, fw * (env(fu, 0, 0.3, 0.5, 0.7) + env(fu, 1.3, 1.5, 1.7, 1.95)));
          P.left.target = goggles;
          P.left.pole = add(L.shoulderL, 0.4, -0.3, -0.1, s);
          P.left.curl = 0.6;
          P.spine = mixV(P.spine, [0.18, -0.15, 0], fw * env(fu, 0.5, 0.75, 1.3, 1.5));
          P.head = mixV(P.head, [0.1, -0.3, 0.1], fw * env(fu, 0.5, 0.75, 1.3, 1.5));
        } else {
          // 抽鼻子嗅一嗅空气：探身仰头、鼻子一抽一抽、耳朵竖起朝前，再好奇地转头看向气味的方向；尾巴卷起来
          const sniff = env(fu, 0.1, 0.3, 1.1, 1.4);
          P.spine = mixV(P.spine, [0.22, 0.12, 0], fw * sniff);
          P.head = mixV(P.head, [-0.42 + 0.1 * Math.sin(fu * 34), track([[0, 0.1], [0.7, 0.15], [0.95, 0.45, 'back'], [1.4, 0.3]], fu), 0.12], fw * sniff);
          P.earL += fw * -0.28 * sniff;
          P.earR += fw * -0.28 * sniff;
          P.hips.drop -= fw * 0.012 * s * sniff;          // 踮脚
          P.tail.curl += fw * 0.1 * env(fu, 0.2, 0.6, 1.0, 1.5);
          P.tail.pitch += fw * 0.3 * env(fu, 0.2, 0.6, 1.0, 1.5);
        }
      }

      // ── 出场（2.4 秒）：从画面左上方张开飞膜滑进来 → 0.6 拉起减速 → 0.8 单膝缓冲落地 →
      //    1.1 弹起、拉下风镜、护腕冒火花 → 1.5 雷鼓亮起、电弧 → 推回风镜、歪头一笑
      if (u >= 0) {
        const k = 1 - env(u, -1, 0, 2.0, 2.4);
        const fly = 1 - ease('out', clamp01(u / 0.8));
        P.root.x = -2.4 * s * fly;              // 角色右侧 = 画面左侧
        P.root.y = 1.5 * s * fly * fly + 0.05 * s * Math.sin(u * 9) * fly;
        P.root.z = 0.4 * s * fly;
        P.root.roll = 0.25 * fly;
        P.root.pitch = track([[0, 0.55], [0.55, 0.45], [0.7, -0.35, 'out'], [0.85, 0]], u);
        P.root.yaw = -0.6 * fly;
        const spread = env(u, -1, 0, 0.65, 0.9);   // 1 = 飞膜张开滑翔，0.65–0.9 收起
        P.right.onGun = mix(1 - spread, 1, k);
        P.left.onGun = mix(u < 1.0 ? 1 - spread : 1 - env(u, 1.0, 1.15, 1.3, 1.45) - env(u, 1.8, 1.9, 2.0, 2.15), 1, k);
        P.right.target = wideR;
        P.right.pole = add(L.shoulderR, -0.2, -0.1, -0.45, s);
        P.right.curl = 0.2;
        P.left.target = u < 1.0 ? wideL : goggles;
        P.left.pole = u < 1.0 ? add(L.shoulderL, 0.2, -0.1, -0.45, s) : add(L.shoulderL, 0.4, -0.3, -0.1, s);
        P.left.curl = 0.2;
        P.footL = mixV(u < 0.75 ? [0.12 * s * spread, 0.05 * s * spread, -0.05 * s] : [0.03 * s, 0, 0.12 * s * env(u, 0.75, 0.8, 1.0, 1.3)], P.footL, k);
        P.footR = mixV(u < 0.75 ? [-0.12 * s * spread, 0.05 * s * spread, -0.05 * s] : [-0.03 * s, 0, -0.14 * s * env(u, 0.75, 0.8, 1.0, 1.3)], P.footR, k);
        const land = env(u, 0.75, 0.82, 0.95, 1.2);
        P.hips.drop = mix(0.3 * s * land, P.hips.drop, k);
        P.hips.pitch = mix(0.3 * land, P.hips.pitch, k);
        P.spine = mixV([0.35 * land + 0.15 * spread, 0, 0], P.spine, k);
        P.head = mixV([-0.3 * spread - 0.1 * land, 0, track([[0, 0], [1.9, 0], [2.05, 0.3, 'back'], [2.4, 0.15]], u)], P.head, k);
        P.tail.pitch = mix(track([[0, 0.05], [0.6, 0.1], [0.8, 0.8, 'out'], [1.2, 0.3]], u), P.tail.pitch, k);
        P.tail.yaw = mix(0.2 * Math.sin(u * 5) * spread, P.tail.yaw, k);
        P.earL = mix(0.35 * spread, P.earL, k);
        P.earR = mix(0.35 * spread, P.earR, k);
        P.fx.wind = spread * clamp01(u / 0.1);
        P.fx.dust = u >= 0.8 ? clamp01((u - 0.8) / 0.7) : 0;
        P.fx.sparks = env(u, 1.1, 1.15, 1.35, 1.45);
        P.fx.arc = env(u, 1.5, 1.55, 1.75, 1.9);
        P.fx.drum = u >= 1.5 ? clamp01((u - 1.5) / 0.8) : 0;
      }
    },
  };
}
