/**
 * 音频规则：Unity 版（unity/Assets/Game/Scripts/Audio/）里的常数和纯函数，一比一照译。
 * AudioSystem / AudioMixer 只管接 WebAudio 节点，数都从这里取；tests/audio-parity.test.mjs 直接读这个文件
 * （去掉类型后 import），断言和 C# 的 EditMode 测试（AudioI6Tests、GraphicsAudioTests）一样的数——所以这里不能有运行时 import。
 *
 * 出处：
 *   GameAudio.cs       声道数、距离衰减、分层配比 LayerGain、密集音 DenseAllow、近处声像、远处 / 背后低通、光束、配乐淡入淡出
 *   AudioMix.cs        总线、限幅器、暂停低通、dB ↔ 线性
 *   AudioDuck.cs       状态 → 快照（暂停 / 模态 0.45 + 6 kHz，结算 0.8）
 *   AudioMixerBuilder  快照里的值、SFX Reverb 的参数
 *   AudioOcclusion.cs  遮挡射线与发闷
 *   AmbienceZone.cs    声床（AmbienceDirector）、章节混响送、局部混响区
 *   MusicDirector.cs   选曲
 *   UISound.cs         按钮音
 */

// ───────────── Unity Mathf ─────────────

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
/** Mathf.InverseLerp */
export const inverseLerp = (a: number, b: number, v: number): number => (a !== b ? clamp01((v - a) / (b - a)) : 0);
/** Mathf.SmoothStep */
export function smoothStep(from: number, to: number, t: number): number {
  t = clamp01(t);
  t = -2 * t * t * t + 3 * t * t;
  return to * t + from * (1 - t);
}
/** Mathf.MoveTowards */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

// ───────────── GameAudio ─────────────

export const MAX_VOICES = 48;
/** 40 m 外静音、2 m 内不衰减 */
export const SILENT_DIST = 40;
export const NEAR_DIST = 2;
/** 距离衰减指数（k^1.6） */
export const DISTANCE_EXPONENT = 1.6;
/** 光束 0.24 s（游戏时间）没被刷新就淡出 */
export const BEAM_HOLD = 0.24;
/** 配乐：旧曲淡出 1.6 s、新曲淡入 1.3 s */
export const MUSIC_FADE_OUT = 1.6;
export const MUSIC_FADE_IN = 1.3;
/** 增益低于这个就不发声 */
export const MIN_GAIN = 0.003;
/** 调用方 volume 的上限 */
export const MAX_VOLUME = 4;
/** 声道低通的共振（Unity AudioLowPassFilter.lowpassResonanceQ） */
export const VOICE_LOWPASS_Q = 0.7;

/** 清单里 mix 的缺省（Unity GameAudio.Mix 的字段初值）：主 0.8、音效 0.9、音乐 0.3 */
export const DEFAULT_MIX = { master: 0.8, sfx: 0.9, music: 0.3 } as const;

/** 分层的三层：瞬态（前 30 ms 的「咔」）、主体、尾音（混响和回声） */
export const LAYER_TRANSIENT = 0;
export const LAYER_BODY = 1;
export const LAYER_TAIL = 2;
export const LAYER_SUFFIX = ['_t', '_b', '_r'] as const;
/** 分层每层的音高再抖 ±1.5% */
export const LAYER_PITCH_JITTER = 0.015;

/**
 * 分层的距离配比（GameAudio.LayerGain）：近处瞬态清楚；8–25 m 瞬态渐渐听不到；
 * 尾音的距离衰减比主体缓（k^1.0 而不是 k^1.6），远处的枪声 / 爆炸主要剩轰的那一下和回声
 */
export function layerGain(layer: number, dist: number, k: number): number {
  let atten = Math.pow(clamp01(k), layer === LAYER_TAIL ? 1 : DISTANCE_EXPONENT);
  if (layer === LAYER_TRANSIENT) atten *= 1 - smoothStep(0, 1, inverseLerp(8, 25, dist));
  return atten;
}

/** 密集音（跳伤、雷弧）：同时最多几声、最小间隔（秒） */
export const DENSE: Readonly<Record<string, readonly [maxVoices: number, gap: number]>> = {
  burn_tick: [3, 0.09],
  corrode_tick: [3, 0.1],
  shock_zap: [3, 0.07],
};

/**
 * 密集音放行规则（GameAudio.DenseAllow）：live = 这个 id 正在响的声数，sinceLast = 距上一声的秒数。
 * 不在表里的 id 一律放行、增益 1；在表里的：满了或间隔不够就不放，否则增益 1 / (1 + 0.35 × live)
 */
export function denseAllow(id: string | null | undefined, live: number, sinceLast: number): { allow: boolean; gain: number } {
  const rule = id ? DENSE[id] : undefined;
  if (!rule) return { allow: true, gain: 1 };
  if (live >= rule[0] || sinceLast < rule[1]) return { allow: false, gain: 1 };
  return { allow: true, gain: 1 / (1 + 0.35 * live) };
}

/** 距离 → 衰减用的 k（2 m 内 1，40 m 处 0） */
export const distanceK = (dist: number): number => (dist <= NEAR_DIST ? 1 : 1 - (dist - NEAR_DIST) / (SILENT_DIST - NEAR_DIST));

/** 距离衰减（非分层的那一份）：k^1.6 */
export const distanceGain = (k: number): number => Math.pow(k, DISTANCE_EXPONENT);

/** 近处声像收窄（Unity spatialBlend；同 Three.js：pan × min(1, dist/3) × 0.85）。dist ≤ 0.3 m 时 0 */
export const panBlend = (dist: number): number => (dist > 0.3 ? Math.min(1, dist / 3) * 0.85 : 0);

/**
 * 远处渐闷、背后发闷：front = 声源方向和听者朝向的点积。返回低通截止（Hz），0 = 不开。
 * 10 m 外 900 + 17000 × (1 − dist / 48)²，背后（front < −0.25）5.5 kHz，取小；≥ 19 kHz 不开
 */
export function spatialLowpass(dist: number, front: number): number {
  if (!(dist > 0.3)) return 0;
  const far = dist > 10 ? 900 + 17000 * Math.pow(1 - dist / (SILENT_DIST + 8), 2) : 20000;
  const behind = front < -0.25 ? 5500 : 20000;
  const lp = Math.min(far, behind);
  return lp < 19000 ? lp : 0;
}

/** 把一个低通并进已有的（0 = 原来不开）：取更闷的 */
export const mergeLowpass = (lowpass: number, lp: number): number => (lp > 0 ? (lowpass > 0 ? Math.min(lowpass, lp) : lp) : lowpass);

/** 调用方的 volume：非数 / 负数 / 无穷按 1，再夹到 4 */
export const sanitizeVolume = (v: number | undefined): number => Math.min(MAX_VOLUME, v === undefined || !(v >= 0) || !Number.isFinite(v) ? 1 : v);
/** 调用方的 pitch：非正 / 非数 / 无穷按 1 */
export const sanitizePitch = (p: number | undefined): number => (p === undefined || !(p > 0) || !Number.isFinite(p) ? 1 : p);
/** 随机音高：pitch × (1 + r × meta.pitch)，r ∈ [−1, 1]，夹到 0.25..3 */
export const voicePitch = (pitch: number, r: number, metaPitch: number): number => clamp(pitch * (1 + r * metaPitch), 0.25, 3);
/** 分层每层的音高：p × (1 + r)，r ∈ [−0.015, 0.015]，夹到 0.25..3 */
export const layerPitch = (p: number, r: number): number => clamp(p * (1 + r), 0.25, 3);
/** 声道音量：AudioSource.volume 上限 1 */
export const voiceVolume = (gain: number): number => Math.min(1, gain);

/** 音效总线电平（接了混音台：清单的 sfx × master，不乘玩家音量——玩家音量在推子上） */
export const sfxBusLevel = (mix: { master: number; sfx: number }): number => mix.sfx * mix.master;
/** 配乐总线电平（同上：music × master） */
export const musicBusLevel = (mix: { master: number; music: number }): number => mix.music * mix.master;

/** 光束：目标音量 clamp01(volume × 音效总线)、音高夹 0.5..2 */
export const beamTarget = (volume: number, sfxBus: number): number => clamp01(volume * sfxBus);
export const beamPitch = (pitch: number): number => clamp(pitch, 0.5, 2);
/** 光束音量一帧：保持时 0.05 s 起满、松开 0.12 s 收完（都按 max(0.2, 目标) 缩放），dt = 不缩放时间 */
export const beamStep = (volume: number, held: boolean, target: number, dt: number): number =>
  moveTowards(volume, held ? target : 0, (dt / (held ? 0.05 : 0.12)) * Math.max(0.2, target));

/** ui_* 走 UI 总线，其余走 SFX */
export const isUiSound = (id: string): boolean => id.startsWith('ui_');

/** 片段名：<id>_<i>、<id>@enemy_<i>、分层 <id>_t|_b|_r_<i>（同 GameAudio.Awake 的 Collect） */
export const clipName = (id: string, i: number): string => `${id}_${i}`;
export const enemyClipName = (id: string, i: number): string => `${id}@enemy_${i}`;
export const layerClipName = (id: string, layer: number, i: number): string => `${id}${LAYER_SUFFIX[layer]}_${i}`;

// ───────────── AudioMix（混音台） ─────────────

export type BusId = 'master' | 'world' | 'sfx' | 'music' | 'ambience' | 'reverb' | 'ui';

/** 限幅器：阈值 dB、起音 ms、释音 ms（Unity Compressor：硬拐点高压缩比，当限幅器用） */
export const LIMITER_THRESHOLD = -2;
export const LIMITER_ATTACK = 10;
export const LIMITER_RELEASE = 120;
/** 暂停时 World 总线的低通截止（Hz）；游玩 / 结算 22 kHz = 不滤 */
export const PAUSED_LOWPASS = 6000;
export const OPEN_LOWPASS = 22000;

/** 线性音量 → dB（0 = −80 dB 静音） */
export const linearToDb = (v: number): number => (v <= 0.0001 ? -80 : clamp(20 * Math.log10(v), -80, 20));
/** dB → 线性（−80 dB 及以下 = 0） */
export const dbToLinear = (db: number): number => (db <= -79.9 ? 0 : Math.pow(10, db / 20));
/** 玩家音量（设置里的 0..1）→ 推子的线性增益：先换成 dB 写进暴露参数（夹 −80..20），推子再按 dB 放 */
export const faderGain = (linear: number): number => dbToLinear(linearToDb(Number.isFinite(linear) ? clamp01(linear) : 1));

// ───────────── AudioDuck（快照） ─────────────

export const SNAPSHOT_GAMEPLAY = 'Gameplay';
export const SNAPSHOT_PAUSED = 'Paused';
export const SNAPSHOT_SUMMARY = 'Summary';
export type SnapshotName = typeof SNAPSHOT_GAMEPLAY | typeof SNAPSHOT_PAUSED | typeof SNAPSHOT_SUMMARY;

export const PAUSED_DUCK = 0.45;
export const SUMMARY_DUCK = 0.8;
/** 快照过渡（不缩放时间，暂停时照样过渡） */
export const DUCK_TRANSITION = 0.3;

/** 快照里的 World 总线：推子（线性）与低通截止 */
export const SNAPSHOTS: Readonly<Record<SnapshotName, { world: number; lowpass: number }>> = {
  Gameplay: { world: 1, lowpass: OPEN_LOWPASS },
  Paused: { world: PAUSED_DUCK, lowpass: PAUSED_LOWPASS },
  // Summary 从 Gameplay 克隆，只改了 World 推子
  Summary: { world: SUMMARY_DUCK, lowpass: OPEN_LOWPASS },
};

/** 网页的 GameState 字符串（'paused' / 'modal' / 'summary' / 其余） */
export const duckFor = (state: string): number =>
  state === 'paused' || state === 'modal' ? PAUSED_DUCK : state === 'summary' ? SUMMARY_DUCK : 1;
export const snapshotFor = (state: string): SnapshotName =>
  state === 'paused' || state === 'modal' ? SNAPSHOT_PAUSED : state === 'summary' ? SNAPSHOT_SUMMARY : SNAPSHOT_GAMEPLAY;

/**
 * 混响返回（AudioMixerBuilder 写进 Reverb 组的 SFX Reverb，mB / 秒）：纯湿声、通用房间。
 * 网页用卷积近似：衰减时间 1.49 s 的指数衰减噪声脉冲，回送电平 Room + Reverb = −10 dB + 2 dB
 */
export const REVERB = { dryLevel: -10000, room: -1000, roomHF: -100, decayTime: 1.49, reflections: -2602, reverb: 200 } as const;
/** 混响发送关 = −80 dB（Builder 的默认值、AmbienceDirector.OnDisable） */
export const REVERB_SEND_OFF = -80;

// ───────────── AudioOcclusion ─────────────

/** 被挡住时的低通截止（Hz）与增益；太近（3 m 内）不算遮挡；射线首尾各让开 0.4 m */
export const OCCLUSION_CUTOFF = 1400;
export const OCCLUSION_GAIN = 0.7;
export const OCCLUSION_MIN_DIST = 3;
export const OCCLUSION_INSET = 0.4;

/** 把遮挡并进已有的低通 / 增益（lowpass = 0 表示原来不开低通）：原来已经更闷就不往回调 */
export function applyOcclusion(lowpass: number, gain: number): { lowpass: number; gain: number } {
  return { lowpass: lowpass > 0 ? Math.min(lowpass, OCCLUSION_CUTOFF) : OCCLUSION_CUTOFF, gain: gain * OCCLUSION_GAIN };
}

// ───────────── AmbienceDirector / AmbienceZone ─────────────

/** 声床电平（相对环境音总线）、进关淡入秒数、阵亡时的电平 */
export const BED_LEVEL = 0.5;
export const BED_FADE_IN = 2.5;
export const BED_DEAD_LEVEL = 0.35;
/** 混响发送的平滑：每秒 20 dB */
export const REVERB_SEND_RATE = 20;
/** 局部混响区边缘的渐变宽度（m） */
export const ZONE_EDGE = 3;

/** 章节（1 起）→ 声床 id；未知章节按第一章 */
export const bedFor = (chapter: number): string => (chapter === 2 ? 'amb_frost' : chapter === 3 ? 'amb_inferno' : 'amb_desert');

/** 封闭的关卡（2-4 冰窟、3-2 铸神井、3-4 炉心圆殿）：Unity 场景名 L2_4 / L3_2 / L3_4，网页地图 id 2-4 / 3-2 / 3-4 */
const ENCLOSED = new Set(['2-4', '3-2', '3-4']);
const mapKey = (scene: string | null | undefined): string | null => {
  const m = scene ? /^L?(\d)[_-]([0-9A-Za-z])/.exec(scene) : null;
  return m ? `${m[1]}-${m[2]}` : null;
};

/** 章节 + 场景 → 混响发送的底（dB）：沙寺开阔 −20、霜山山谷 −12、熔火岩洞 −10，封闭的关卡 +5 */
export function reverbBaseDb(chapter: number, scene: string | null | undefined): number {
  let db = chapter === 2 ? -12 : chapter === 3 ? -10 : -20;
  const key = mapKey(scene);
  if (key && ENCLOSED.has(key)) db += 5;
  return db;
}

/** 混响发送一帧：从关（−80）直接跳到目标，之后按 20 dB/s 平滑；目标先夹到 ≤ 0 */
export function reverbSendStep(sendDb: number, target: number, dt: number): number {
  target = Math.min(0, target);
  return sendDb <= REVERB_SEND_OFF + 0.1 ? target : moveTowards(sendDb, target, dt * REVERB_SEND_RATE);
}

export interface AmbienceZoneDef {
  x: number; y: number; z: number;
  radius: number;
  extraDb: number;
}

/** 听者所在位置的局部混响加量（dB，取最大的那个区；球边 3 m 渐变） */
export function zoneExtraAt(x: number, y: number, z: number, zones: readonly AmbienceZoneDef[]): number {
  let best = 0;
  for (const zn of zones) {
    const d = Math.hypot(x - zn.x, y - zn.y, z - zn.z);
    const w = 1 - clamp01((d - zn.radius) / ZONE_EDGE);
    best = Math.max(best, zn.extraDb * w);
  }
  return best;
}

/**
 * 关卡里摆的 AmbienceZone（Unity 只有 3-3 火神殿一个：Level_3_3.Dressing 挂在「Foundry Direction」根上，
 * 根在世界原点，半径 48 m、+4 dB）。导出的场景文档里没有这个组件，这里按地图 id 列（坐标是网页坐标：x 取反，原点不变）。
 */
export const AMBIENCE_ZONES: Readonly<Record<string, readonly AmbienceZoneDef[]>> = {
  '3-3': [{ x: 0, y: 0, z: 0, radius: 48, extraDb: 4 }],
};

/** 地图 id（「1-2」/ 备选图「1-A」）→ 章节（1 起），同 FxTone.Detect：先看地图名的首位数字，没有再用局里的章节 */
export function chapterOf(map: string | null | undefined, runChapter1: number): number {
  const m = map ? /^L?(\d)/.exec(map) : null;
  if (m && m[1] >= '1' && m[1] <= '9') return Number(m[1]);
  return runChapter1 > 0 ? runChapter1 : 1;
}

// ───────────── MusicDirector ─────────────

/** 选曲每 0.5 s（不缩放时间）判一次 */
export const MUSIC_POLL = 0.5;

/** 首领的曲目：旱魃有自己的主题（没烘焙时退回通用首领曲），其他首领用 boss */
export const bossMusic = (enemyId: string, hasHanbaTheme: boolean): string =>
  enemyId === 'boss_hanba' && hasHanbaTheme ? 'boss_hanba' : 'boss';

/** 有场地在交战 → combat；有活着的首领（id 以 boss 开头）→ 首领曲；否则 calm */
export function musicWant(encounterActive: boolean, bossId: string | null, hasHanbaTheme: boolean): string {
  if (bossId) return bossMusic(bossId, hasHanbaTheme);
  return encounterActive ? 'combat' : 'calm';
}

// ───────────── UISound ─────────────

export const UI_CLICK = 'ui_click';
export const UI_HOVER = 'ui_hover';
export const UI_CONFIRM = 'ui_confirm';
export const UI_DENY = 'ui_deny';
/** 悬停音节流（不缩放时间，秒） */
export const UI_HOVER_GAP = 0.04;
/** UITheme 的类名：按钮、换确认音、换拒绝音、不出声 */
export const UI_CLASS = { button: 'sf-btn', confirm: 'sf-sound-confirm', deny: 'sf-sound-deny', silent: 'sf-silent' } as const;

/** 按钮被激活时出哪个音（null = 不出声）：静音类 > 禁用 → 拒绝 > 确认类 > 拒绝类 > 点击 */
export function uiClickSound(b: { silent: boolean; disabled: boolean; confirm: boolean; deny: boolean } | null): string | null {
  if (!b || b.silent) return null;
  if (b.disabled) return UI_DENY;
  if (b.confirm) return UI_CONFIRM;
  if (b.deny) return UI_DENY;
  return UI_CLICK;
}
