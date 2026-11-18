// Unity 烘好的音频 → 网页：public/assets/audio/。片段本来就是从网页 src/audio 的合成配方离线烘出来的
// （src/dev/audioBake.ts → scripts/audio/bake.py → unity/Assets/Game/Resources/Audio），这里原样拷回来给 AudioSystem 播。
//
//   node scripts/web/publish-audio.mjs            拷贝（只写有变化的文件，删掉 Unity 里已经没有的片段）
//   node scripts/web/publish-audio.mjs --check    只核对发布目录和 Unity 目录逐字节一致（不写），不一致退出码 1
//   --unity <目录>   Unity 工程目录（默认本仓库的 unity/）
//
// 输入：<unity>/Assets/Game/Resources/Audio/{audio-manifest.json, Sfx/*.ogg, Music/*.ogg}
// 输出：public/assets/audio/{audio-manifest.json, sfx/*.ogg, music/*.ogg}
//   audio-manifest.json = Unity 的清单原样（sampleRate / beamLoop / mix / sfx / music），再加两个字段：
//     clips       sfx/ 下实际有的片段名（不带 .ogg）：<id>_<i>、<id>@enemy_<i>、<id>_t|_b|_r_<i>、shot_beam_loop
//     musicClips  music/ 下实际有的曲目名（配乐 menu / calm / combat / boss / boss_hanba + 声床 amb_*）
//   浏览器列不了目录，GameAudio.Collect 那种「有就收、没有就跳过」靠 clips 判断，不去请求不存在的文件。
//
// DLP：本机的透明加密会把一部分文件存成密文。node 在白名单里，读到的是明文；如果 node 读到的开头仍是「%TSD-Header」，
// 说明是两层加密（Unity 读到密文又原样存回），先跑 node scripts/unity/dlp-unity-fix.mjs --peel 再来。
// 每个 ogg 都核对开头是 OggS，清单核对能按 JSON 解析，不对就不拷。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const unityArg = args.indexOf('--unity');
const UNITY = resolve(unityArg >= 0 ? args[unityArg + 1] : join(ROOT, 'unity'));
const SRC = join(UNITY, 'Assets/Game/Resources/Audio');
const OUT = join(ROOT, 'public/assets/audio');
const DIRS = [['Sfx', 'sfx'], ['Music', 'music']];

const problems = [];
const rel = p => relative(ROOT, p).replace(/\\/g, '/');

function readChecked(path, kind) {
  const buf = readFileSync(path);
  const head = buf.subarray(0, 16).toString('latin1');
  if (head.startsWith('%TSD-Header')) {
    problems.push(`${rel(path)} 是 DLP 密文（两层加密）：先跑 node scripts/unity/dlp-unity-fix.mjs --peel`);
    return null;
  }
  if (kind === 'ogg' && !head.startsWith('OggS')) {
    problems.push(`${rel(path)} 开头不是 OggS（${JSON.stringify(head.slice(0, 8))}）`);
    return null;
  }
  return buf;
}

// ── 读 Unity 侧 ──
if (!existsSync(SRC)) {
  console.error(`没有 ${SRC}`);
  process.exit(1);
}
const manifestBuf = readChecked(join(SRC, 'audio-manifest.json'), 'json');
let manifest = null;
try {
  manifest = manifestBuf ? JSON.parse(manifestBuf.toString('utf8').replace(/^﻿/, '')) : null;
} catch (err) {
  problems.push(`audio-manifest.json 解析失败：${err.message}`);
}

/** 期望的发布内容：相对 OUT 的路径 → Buffer */
const want = new Map();
const names = { Sfx: [], Music: [] };
for (const [from, to] of DIRS) {
  const dir = join(SRC, from);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ogg')).sort()) {
    const buf = readChecked(join(dir, f), 'ogg');
    if (!buf) continue;
    want.set(`${to}/${f}`, buf);
    names[from].push(f.slice(0, -4));
  }
}

if (manifest) {
  // 清单里登记了、目录里却没有的片段：GameAudio 照样跳过（Collect），这里只提示
  const have = new Set(names.Sfx);
  const missing = [];
  for (const e of manifest.sfx ?? []) {
    for (let i = 0; i < (e.variants ?? 0); i++) if (!have.has(`${e.id}_${i}`)) missing.push(`${e.id}_${i}`);
    for (let i = 0; i < (e.enemyVariants ?? 0); i++) if (!have.has(`${e.id}@enemy_${i}`)) missing.push(`${e.id}@enemy_${i}`);
    for (const s of ['_t', '_b', '_r']) for (let i = 0; i < (e.layers ?? 0); i++) if (!have.has(`${e.id}${s}_${i}`)) missing.push(`${e.id}${s}_${i}`);
  }
  if (manifest.beamLoop && !have.has(manifest.beamLoop)) missing.push(manifest.beamLoop);
  const music = new Set(names.Music);
  for (const m of manifest.music ?? []) if (!music.has(m.id)) missing.push(`music/${m.id}`);
  if (missing.length) console.warn(`清单登记了但没有片段（运行时跳过）：${missing.join('、')}`);
  const out = { ...manifest, clips: names.Sfx, musicClips: names.Music };
  want.set('audio-manifest.json', Buffer.from(JSON.stringify(out, null, 1) + '\n', 'utf8'));
}

if (problems.length) {
  for (const p of problems) console.error('  ' + p);
  console.error(`有 ${problems.length} 个问题，没有${check ? '核对' : '拷贝'}`);
  process.exit(1);
}

// ── 发布目录现状 ──
const present = new Map();
if (existsSync(OUT)) {
  if (existsSync(join(OUT, 'audio-manifest.json'))) present.set('audio-manifest.json', join(OUT, 'audio-manifest.json'));
  for (const [, to] of DIRS) {
    const dir = join(OUT, to);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) present.set(`${to}/${f}`, join(OUT, to, f));
  }
}

// 清单是文本：检出时 autocrlf 可能把 LF 换成 CRLF，比较前去掉 \r（ogg 是二进制，逐字节比）
const same = (path, a, b) => path.endsWith('.json')
  ? a.toString('utf8').replace(/\r/g, '') === b.toString('utf8').replace(/\r/g, '')
  : a.equals(b);
const changed = [], extra = [];
for (const [path, buf] of want) {
  const at = present.get(path);
  if (!at || !same(path, readFileSync(at), buf)) changed.push(path);
}
for (const path of present.keys()) if (!want.has(path)) extra.push(path);

let bytes = 0;
for (const b of want.values()) bytes += b.length;
const summary = `${want.size} 个文件（${names.Sfx.length} 个音效片段 + ${names.Music.length} 条曲目 + 清单，${(bytes / 1048576).toFixed(1)} MB）`;

if (check) {
  if (changed.length || extra.length) {
    for (const p of changed) console.error(`  不一致：${p}`);
    for (const p of extra) console.error(`  多余：${p}`);
    console.error(`public/assets/audio 和 Unity 不一致（${changed.length} 个不同、${extra.length} 个多余）：跑 node scripts/web/publish-audio.mjs`);
    process.exit(1);
  }
  console.log(`public/assets/audio 与 Unity 一致：${summary}`);
  process.exit(0);
}

for (const path of changed) {
  const at = join(OUT, path);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, want.get(path));
}
for (const path of extra) rmSync(join(OUT, path));
// 写完再读一遍：DLP 若把写出的文件弄成 node 也读不了的密文，这里能发现
for (const path of changed) {
  const back = readFileSync(join(OUT, path));
  if (!same(path, back, want.get(path))) {
    console.error(`写回核对失败：${path}（DLP？）`);
    process.exit(1);
  }
}
console.log(`已发布 ${summary}；更新 ${changed.length} 个、删除 ${extra.length} 个`);
