// 音频（M11e）：网页 src/audio/AudioRules.ts 对照 Unity 的 GameAudio / AudioMix / AudioDuck / AudioOcclusion / AmbienceZone /
// MusicDirector / UISound / AudioMixerBuilder。
// 一半断言照搬 Unity EditMode 测试（AudioI6Tests、GraphicsAudioTests 的 DuckRulesMatchThreeJs / DenseSoundsAreThrottled），
// 另一半把网页的常数和 Unity 删除前冻结的 C# 规格（tests/fixtures/spec/audio.json）逐个比。
// 最后核对发布的素材：每个 SfxId 都有片段。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../', import.meta.url);
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const ts = async path => import(data(stripTypeScriptTypes(readFileSync(new URL(path, root), 'utf8'), { mode: 'transform' })));
const R = await ts('src/audio/AudioRules.ts');
// Unity 删除前冻结的音频 C# 规格；下面的 GameAudio / AudioMix … 是规格里的文件名（num(文件, 名字) 查 consts）
const AUDIO = JSON.parse(readFileSync(new URL('tests/fixtures/spec/audio.json', root), 'utf8'));
const [GameAudio, AudioMix, AudioDuck, Occlusion, Ambience] = ['GameAudio', 'AudioMix', 'AudioDuck', 'Occlusion', 'Ambience'];

const close = (a, b, eps = 1e-5, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≠ ${b}（±${eps}）`);
/** 冻结规格里 C# 文件 file 的 `Name = 1.5f` 的值 */
function num(file, name) {
  const v = AUDIO.consts[`${file}.${name}`];
  assert.ok(v !== undefined, `规格里没有 ${file}.${name}`);
  return v;
}

// ───────────── AudioI6Tests ─────────────

test('分层：近处三层都在，25 m 外没有「咔」，尾音比主体衰减得缓（AudioI6Tests.LayersKeepTheCrackNearAndTheTailFar）', () => {
  close(R.layerGain(R.LAYER_TRANSIENT, 2, 1), 1);
  close(R.layerGain(R.LAYER_BODY, 2, 1), 1);
  close(R.layerGain(R.LAYER_TAIL, 2, 1), 1);
  close(R.layerGain(R.LAYER_TRANSIENT, 26, 0.37), 0);
  for (let k = 0.1; k < 1; k += 0.2) assert.ok(R.layerGain(R.LAYER_TAIL, 20, k) > R.layerGain(R.LAYER_BODY, 20, k), `k = ${k}`);
  // 具体的数：16.5 m 正好在 8–25 m 的一半，SmoothStep(0.5) = 0.5
  close(R.layerGain(R.LAYER_TRANSIENT, 16.5, 0.6), Math.pow(0.6, 1.6) * 0.5);
  close(R.layerGain(R.LAYER_BODY, 16.5, 0.6), Math.pow(0.6, 1.6));
  close(R.layerGain(R.LAYER_TAIL, 16.5, 0.6), 0.6);
  close(R.layerGain(R.LAYER_TRANSIENT, 8, 1), 1, 1e-9, '8 m 内瞬态不减');
  close(R.layerGain(R.LAYER_BODY, 30, 1.4), 1, 1e-9, 'k 先夹到 0..1');
  close(R.layerGain(R.LAYER_TAIL, 30, -0.2), 0, 1e-9);
  // C#：瞬态 / 主体 / 尾音的下标与后缀
  assert.deepEqual([...R.LAYER_SUFFIX], ['_t', '_b', '_r']);
  close(R.LAYER_PITCH_JITTER, 0.015);
});

test('遮挡：发闷、轻一点，原来更闷的不往回调（AudioI6Tests.OcclusionMufflesAndQuietens）', () => {
  const a = R.applyOcclusion(0, 1);
  assert.equal(a.lowpass, R.OCCLUSION_CUTOFF);
  assert.ok(a.gain < 1 && a.gain > 0.4);
  const b = R.applyOcclusion(900, 1);
  assert.equal(b.lowpass, 900, '原来已经更闷（远处）就不往回调');
  assert.equal(R.OCCLUSION_CUTOFF, num(Occlusion, 'CutoffHz'));
  assert.equal(R.OCCLUSION_GAIN, num(Occlusion, 'Gain'));
  assert.equal(R.OCCLUSION_MIN_DIST, num(Occlusion, 'MinDist'));
  assert.equal(R.OCCLUSION_INSET, num(Occlusion, 'Inset'));
});

test('每章声床、封闭关卡混响更多（AudioI6Tests.EachChapterHasItsBedAndEnclosedLevelsRingMore）', () => {
  assert.equal(R.bedFor(1), 'amb_desert');
  assert.equal(R.bedFor(2), 'amb_frost');
  assert.equal(R.bedFor(3), 'amb_inferno');
  assert.equal(R.bedFor(9), 'amb_desert', '未知章节按第一章');
  assert.ok(R.reverbBaseDb(1, 'L1_1_GobiRoad') < R.reverbBaseDb(2, 'L2_1_Icefall'), '沙漠开阔、混响最少');
  assert.ok(R.reverbBaseDb(3, 'L3_2_ForgeWell') > R.reverbBaseDb(3, 'L3_1_Causeway'), '铸神井（封闭）比熔湖堤道更响');
  assert.ok(R.reverbBaseDb(3, 'L3_4_Zhurong') <= 0);
  // 具体的数（AmbienceDirector.ReverbBaseDb）：Unity 场景名和网页地图 id 两种写法一样
  for (const [ch, scene, db] of [[1, 'L1_1_GobiRoad', -20], [2, 'L2_1_Icefall', -12], [3, 'L3_1_Causeway', -10], [2, 'L2_4_IceCave', -7],
    [3, 'L3_2_ForgeWell', -5], [3, 'L3_4_Zhurong', -5], [4, 'L4_1_Plateau', -20], [1, '1-1', -20], [2, '2-4', -7], [3, '3-2', -5],
    [3, '3-4', -5], [3, '3-3', -10], [3, '3-A', -10], [1, null, -20]]) {
    assert.equal(R.reverbBaseDb(ch, scene), db, `${ch} ${scene}`);
  }
  assert.equal(R.BED_LEVEL, num(Ambience, 'BedLevel'));
  assert.equal(R.BED_FADE_IN, num(Ambience, 'FadeIn'));
  assert.equal(R.BED_DEAD_LEVEL, num(Ambience, 'DeadLevel'));
  assert.equal(R.REVERB_SEND_OFF, num(Ambience, 'Off'));
});

// ───────────── GraphicsAudioTests ─────────────

test('压低快照照 Three.js（GraphicsAudioTests.DuckRulesMatchThreeJs）', () => {
  close(R.duckFor('paused'), 0.45);
  close(R.duckFor('modal'), 0.45);
  close(R.duckFor('summary'), 0.8);
  assert.equal(R.duckFor('playing'), 1);
  assert.equal(R.duckFor('menu'), 1);
  assert.equal(R.snapshotFor('modal'), R.SNAPSHOT_PAUSED);
  assert.equal(R.snapshotFor('summary'), R.SNAPSHOT_SUMMARY);
  assert.equal(R.snapshotFor('transition'), R.SNAPSHOT_GAMEPLAY);
  assert.equal(R.snapshotFor('paused'), 'Paused');
  close(R.linearToDb(1), 0, 1e-4);
  close(R.linearToDb(0.45), -6.936, 0.01);
  assert.equal(R.linearToDb(0), -80);
  close(R.dbToLinear(R.linearToDb(0.45)), 0.45, 1e-4);
  assert.equal(R.dbToLinear(-80), 0);
  assert.equal(R.linearToDb(1e9), 20, '上限 +20 dB');
  // 快照里的 World：游玩 0 dB、暂停 0.45、结算 0.8；低通暂停 6 kHz，其余 22 kHz
  close(R.linearToDb(R.SNAPSHOTS.Gameplay.world), 0, 0.05);
  close(R.linearToDb(R.SNAPSHOTS.Paused.world), R.linearToDb(0.45), 0.05, '暂停压到 0.45');
  close(R.linearToDb(R.SNAPSHOTS.Summary.world), R.linearToDb(0.8), 0.05, '结算压到 0.8');
  assert.equal(R.SNAPSHOTS.Paused.lowpass, num(AudioMix, 'PausedLowpass'));
  assert.equal(R.SNAPSHOTS.Gameplay.lowpass, num(AudioMix, 'OpenLowpass'));
  assert.equal(R.SNAPSHOTS.Summary.lowpass, num(AudioMix, 'OpenLowpass'), 'Summary 从 Gameplay 克隆，只改 World');
  assert.equal(R.PAUSED_DUCK, num(AudioDuck, 'PausedDuck'));
  assert.equal(R.SUMMARY_DUCK, num(AudioDuck, 'SummaryDuck'));
  assert.equal(R.DUCK_TRANSITION, num(AudioDuck, 'TransitionSeconds'));
});

test('密集音节流（GraphicsAudioTests.DenseSoundsAreThrottled）', () => {
  const g0 = R.denseAllow('burn_tick', 0, 1);
  assert.ok(g0.allow);
  close(g0.gain, 1);
  const g2 = R.denseAllow('burn_tick', 2, 1);
  assert.ok(g2.allow);
  close(g2.gain, 1 / 1.7, 1e-4, '已有 2 声在响：× 1 / (1 + 0.35 × 2)');
  assert.equal(R.denseAllow('burn_tick', 3, 1).allow, false, '同时最多 3 声');
  assert.equal(R.denseAllow('shock_zap', 0, 0.03).allow, false, '雷弧最小间隔 0.07 s');
  assert.equal(R.denseAllow('corrode_tick', 1, 0.05).allow, false);
  const g = R.denseAllow('shot_smg', 40, 0);
  assert.ok(g.allow, '不在表里的音不受限');
  assert.equal(g.gain, 1);
  assert.ok(R.denseAllow(null, 9, 0).allow);
  // 表和 C# 的 Dense 字典逐条一致
  const table = AUDIO.dense;
  assert.deepEqual(table, Object.fromEntries(Object.entries(R.DENSE).map(([k, v]) => [k, [...v]])));
});

test('混音台：限幅器、总线、暴露的五档音量（AudioMix / AudioMixerBuilder）', () => {
  assert.equal(R.LIMITER_THRESHOLD, num(AudioMix, 'LimiterThreshold'));
  assert.equal(R.LIMITER_ATTACK, num(AudioMix, 'LimiterAttack'));
  assert.equal(R.LIMITER_RELEASE, num(AudioMix, 'LimiterRelease'));
  // 组结构：UI 直接挂 Master，SFX / Music / Ambience / Reverb 在 World 下
  // 推子：玩家音量 → dB → 线性（0 = 静音）
  close(R.faderGain(1), 1, 1e-9);
  close(R.faderGain(0.5), 0.5, 1e-9);
  assert.equal(R.faderGain(0), 0);
  assert.equal(R.faderGain(0.00005), 0, '−80 dB 以下静音');
  assert.equal(R.faderGain(Number.NaN), 1, '坏存档按 1');
  // SFX Reverb 的参数（mB / 秒）
  for (const [k, name] of [['dryLevel', 'Dry Level'], ['room', 'Room'], ['roomHF', 'Room HF'], ['decayTime', 'Decay Time'], ['reflections', 'Reflections'], ['reverb', 'Reverb']]) {
    assert.equal(R.REVERB[k], AUDIO.reverb[name], name);
  }
  // 基础电平（GameAudio.Mix 的初值，清单缺 mix 时用）
  assert.deepEqual({ ...R.DEFAULT_MIX }, { master: 0.8, sfx: 0.9, music: 0.3 });
  close(R.sfxBusLevel(R.DEFAULT_MIX), 0.72);
  close(R.musicBusLevel(R.DEFAULT_MIX), 0.24);
});

// ───────────── GameAudio 的其余公式 ─────────────

test('声道数、距离衰减、近处声像、远处 / 背后低通（GameAudio.PlayInternal）', () => {
  assert.equal(R.MAX_VOICES, num(GameAudio, 'MaxVoices'));
  assert.equal(R.SILENT_DIST, num(GameAudio, 'SilentDist'));
  assert.equal(R.NEAR_DIST, num(GameAudio, 'NearDist'));
  assert.equal(R.BEAM_HOLD, num(GameAudio, 'BeamHold'));
  assert.equal(R.MUSIC_FADE_OUT, num(GameAudio, 'FadeOut'));
  assert.equal(R.MUSIC_FADE_IN, num(GameAudio, 'FadeIn'));
  assert.equal(R.VOICE_LOWPASS_Q, 0.7);

  assert.equal(R.distanceK(0), 1);
  assert.equal(R.distanceK(2), 1);
  close(R.distanceK(21), 0.5);
  close(R.distanceK(40), 0);
  close(R.distanceGain(0.5), Math.pow(0.5, 1.6));

  // 近处声像收窄：min(1, dist/3) × 0.85，0.3 m 内不收
  assert.equal(R.panBlend(0.2), 0);
  close(R.panBlend(1.5), 0.425);
  close(R.panBlend(3), 0.85);
  close(R.panBlend(30), 0.85);

  // 低通
  assert.equal(R.spatialLowpass(5, 1), 0, '近处正前方不开');
  assert.equal(R.spatialLowpass(5, -0.5), 5500, '背后 5.5 kHz');
  assert.equal(R.spatialLowpass(5, -0.2), 0, '侧后方 −0.2 不算背后');
  close(R.spatialLowpass(20, 1), 900 + 17000 * Math.pow(1 - 20 / 48, 2));
  close(R.spatialLowpass(30, -1), Math.min(900 + 17000 * Math.pow(1 - 30 / 48, 2), 5500));
  close(R.spatialLowpass(11, 1), 900 + 17000 * Math.pow(1 - 11 / 48, 2), 1e-9, '11 m：≈ 11 kHz < 19 kHz → 开');
  close(R.spatialLowpass(10, 1), 0, 1e-9, '10 m 以内不算远');
  // 合并：遮挡 1.4 kHz 之后再算远处，取更闷的
  assert.equal(R.mergeLowpass(1400, 5500), 1400);
  assert.equal(R.mergeLowpass(0, 5500), 5500);
  assert.equal(R.mergeLowpass(1400, 0), 1400);

  // 调用方参数
  assert.equal(R.sanitizeVolume(undefined), 1);
  assert.equal(R.sanitizeVolume(Number.NaN), 1);
  assert.equal(R.sanitizeVolume(-1), 1);
  assert.equal(R.sanitizeVolume(Infinity), 1);
  assert.equal(R.sanitizeVolume(9), 4);
  assert.equal(R.sanitizeVolume(0), 0);
  assert.equal(R.sanitizePitch(0), 1);
  assert.equal(R.sanitizePitch(Number.NaN), 1);
  assert.equal(R.sanitizePitch(0.7), 0.7);
  assert.equal(R.voicePitch(1, 1, 0.04), 1.04);
  assert.equal(R.voicePitch(0.1, 0, 0.04), 0.25, '下限 0.25');
  assert.equal(R.voicePitch(5, 0, 0), 3, '上限 3');
  assert.equal(R.voiceVolume(1.7), 1, 'AudioSource.volume 上限 1');
  assert.equal(R.isUiSound('ui_click'), true);
  assert.equal(R.isUiSound('hit'), false);
  assert.equal(R.clipName('hit', 2), 'hit_2');
  assert.equal(R.enemyClipName('shot_sniper', 0), 'shot_sniper@enemy_0');
  assert.equal(R.layerClipName('explosion', R.LAYER_TAIL, 1), 'explosion_r_1');
});

test('光束：0.05 s 起满、0.12 s 收完，目标 = clamp01(volume × 音效总线)（GameAudio.HoldBeam / Update）', () => {
  close(R.beamTarget(0.35, 0.72), 0.252);
  assert.equal(R.beamTarget(3, 0.72), 1);
  assert.equal(R.beamPitch(0.1), 0.5);
  assert.equal(R.beamPitch(5), 2);
  // 目标 0.252：保持时每帧（1/60 s）涨 1/60 / 0.05 × 0.252 = 0.084
  close(R.beamStep(0, true, 0.252, 1 / 60), (1 / 60 / 0.05) * 0.252);
  close(R.beamStep(0.252, false, 0.252, 1 / 60), 0.252 - (1 / 60 / 0.12) * 0.252);
  assert.equal(R.beamStep(0.1, true, 0.252, 1), 0.252, '不过冲');
  // 目标很小时按 0.2 的速度走（不会拖很久）
  close(R.beamStep(0.05, false, 0.05, 0.012), 0.05 - (0.012 / 0.12) * 0.2);
});

test('Unity Mathf 的语义（MoveTowards / SmoothStep / InverseLerp）', () => {
  assert.equal(R.moveTowards(0, 1, 0.3), 0.3);
  assert.equal(R.moveTowards(0.9, 1, 0.3), 1);
  assert.equal(R.moveTowards(1, 0, 0.25), 0.75);
  assert.equal(R.smoothStep(0, 1, 0.5), 0.5);
  close(R.smoothStep(0, 1, 0.25), 0.15625);
  assert.equal(R.smoothStep(0, 1, 2), 1);
  assert.equal(R.inverseLerp(8, 25, 4), 0);
  close(R.inverseLerp(8, 25, 16.5), 0.5);
  assert.equal(R.inverseLerp(3, 3, 9), 0);
});

// ───────────── 声床 / 混响区 / 选曲 / 按钮音 ─────────────

test('混响发送：从关直接跳到目标，之后 20 dB/s；局部混响区球边 3 m 渐变（AmbienceDirector.Update / AmbienceZone.ExtraAt）', () => {
  assert.equal(R.reverbSendStep(-80, -12, 0.016), -12, '第一帧直接到');
  close(R.reverbSendStep(-12, -7, 0.1), -10, 1e-9, '2 dB / 0.1 s');
  assert.equal(R.reverbSendStep(-3, 6, 1), 0, '目标夹到 ≤ 0 dB');

  const zones = [{ x: 0, y: 0, z: 0, radius: 20, extraDb: 8 }, { x: 100, y: 0, z: 0, radius: 10, extraDb: 3 }];
  assert.equal(R.zoneExtraAt(5, 0, 0, zones), 8);
  close(R.zoneExtraAt(21.5, 0, 0, zones), 4, 1e-9, '出球 1.5 m = 一半');
  assert.equal(R.zoneExtraAt(23.5, 0, 0, zones), 0);
  assert.equal(R.zoneExtraAt(100, 0, 5, zones), 3);
  assert.equal(R.zoneExtraAt(0, 0, 0, []), 0);
  // 关卡里摆的区：Unity 只有 3-3（Level_3_3.Dressing：半径 48、+4 dB，挂在原点的根上）
  assert.deepEqual(R.AMBIENCE_ZONES['3-3'], [{ x: 0, y: 0, z: 0, radius: 48, extraDb: 4 }]);
  assert.equal(Object.keys(R.AMBIENCE_ZONES).length, 1);
});

test('章节：地图名的首位数字优先（FxTone.Detect）', () => {
  assert.equal(R.chapterOf('2-4', 1), 2);
  assert.equal(R.chapterOf('1-A', 3), 1);
  assert.equal(R.chapterOf('L3_2_ForgeWell', 1), 3);
  assert.equal(R.chapterOf(undefined, 3), 3);
  assert.equal(R.chapterOf(null, 0), 1);
});

test('选曲：交战 → combat，首领 → boss / 旱魃主题，其余 calm（MusicDirector）', () => {
  assert.equal(R.MUSIC_POLL, 0.5);
  assert.equal(R.bossMusic('boss_hanba', true), 'boss_hanba');
  assert.equal(R.bossMusic('boss_hanba', false), 'boss', '没烘焙时退回通用首领曲');
  assert.equal(R.bossMusic('boss_qilin', true), 'boss');
  assert.equal(R.musicWant(false, null, true), 'calm');
  assert.equal(R.musicWant(true, null, true), 'combat');
  assert.equal(R.musicWant(true, 'boss_hanba', true), 'boss_hanba', '首领在场压过交战');
  assert.equal(R.musicWant(false, 'boss_warlord', true), 'boss');
});

test('按钮音：静音类 > 禁用 → 拒绝 > 确认类 > 拒绝类 > 点击；悬停节流 40 ms（UISound）', () => {
  const b = o => ({ silent: false, disabled: false, confirm: false, deny: false, ...o });
  assert.equal(R.uiClickSound(null), null);
  assert.equal(R.uiClickSound(b({ silent: true, disabled: true })), null);
  assert.equal(R.uiClickSound(b({ disabled: true, confirm: true })), 'ui_deny');
  assert.equal(R.uiClickSound(b({ confirm: true })), 'ui_confirm');
  assert.equal(R.uiClickSound(b({ deny: true })), 'ui_deny');
  assert.equal(R.uiClickSound(b({})), 'ui_click');
  assert.equal(R.UI_HOVER_GAP, 0.04);
  assert.deepEqual({ ...R.UI_CLASS }, { button: 'sf-btn', confirm: 'sf-sound-confirm', deny: 'sf-sound-deny', silent: 'sf-silent' });
});

// ───────────── 发布的素材 ─────────────

test('public/assets/audio：每个 SfxId 都有片段', () => {
  const m = JSON.parse(readFileSync(new URL('public/assets/audio/audio-manifest.json', root), 'utf8'));
  const clips = new Set(m.clips);
  const types = readFileSync(new URL('src/core/types.ts', root), 'utf8');
  const union = /export type SfxId =([\s\S]*?);/.exec(types)[1];
  const ids = [...union.matchAll(/'(\w+)'/g)].map(x => x[1]);
  assert.ok(ids.length > 70);
  const byId = new Map(m.sfx.map(e => [e.id, e]));
  for (const id of ids) {
    const e = byId.get(id);
    assert.ok(e, `清单里没有 ${id}`);
    assert.ok(clips.has(`${id}_0`), `${id} 没有片段`);
  }
  // 分层的 id 三层都齐（否则 GameAudio 当不分层处理）
  for (const e of m.sfx.filter(e => e.layers > 0)) {
    for (const s of R.LAYER_SUFFIX) assert.ok(clips.has(`${e.id}${s}_0`), `${e.id}${s}`);
  }
  assert.ok(clips.has(m.beamLoop), '光束循环片段');
  for (const id of ['menu', 'calm', 'combat', 'boss', 'boss_hanba', 'amb_desert', 'amb_frost', 'amb_inferno']) assert.ok(m.musicClips.includes(id), id);
});
