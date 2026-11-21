// Blender 手 K 片段 → 网页动画数据（M12 第二期）。要 Blender，不要 Unity。
//
//   node scripts/web/export-keyframed-anims.mjs                       默认这批（鲲 / 鹏 / 火麒麟两形态 / 商人 / 旱魃 / 第四章五种敌人）
//   node scripts/web/export-keyframed-anims.mjs SK_Boss_Kun SK_Boss_Peng
//   node scripts/web/export-keyframed-anims.mjs --list                 列出表里的资产
//   --blender <exe>   Blender 可执行文件（默认环境变量 BLENDER，再默认 D:/AI-Tools/Blender/blender-5.2.1-windows-x64/blender.exe）
//   --dump-only       只跑 Blender 写中间件，不重导发布文件
//
// 两步：
//   1. 每个资产在 Blender 后台模式跑一遍它自己的 art/source/characters/<资产>/anim/*_anims.py（原样，不改脚本），
//      scripts/web/blender-keyframed-dump.py 把脚本里的「导出 FBX」换成逐帧采样，写中间件
//      art/source/characters/<资产>/anim/_tmp/<资产>.keyframed-anim.json（不入库，可重新生成；和 *.native-anim.json 同一种排版）；
//   2. 交给 export-native-anims.mjs：Blender 片段按状态名替换采样片段（Unity 的 Keyframed/<状态>.fbx 同样按名覆盖），
//      没有采样数据的资产（旱魃、商人）整份由 Blender 片段生成；事件 / 连段 / 循环取 Unity 入库的 <资产>.events.json，状态机取 AC_<资产>.controller。
//
// 为什么导成和采样片段同一种 JSON、不烘进 GLB：
//   · 播放器（src/anim）只认这一种格式，首领 / 敌人 / 检视页不用分两条路；事件、连段、状态机本来就在这份 JSON 里，glTF 没有它们的标准位置；
//   · 角色 GLB 是美术管线的产物（Unity *.art.json 记着哈希），往里塞动画会改动 1–20 MB 的模型文件；
//   · Blender 骨骼导入时按骨骼朝向重排过轴：导出端按「增量 = q(t)·q_rest⁻¹，再乘到 GLB 绑定朝向上」换算，和采样片段同一条公式，
//     静止姿势不同的骨架也对得上（Unity 那边是按骨骼名直接拷局部曲线，同一份 GLB 导入，结果一样）。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 资产 → 手 K 脚本（相对仓库根）与脚本参数；--out 指到临时目录：脚本不往 unity/ 写 FBX（中间件脚本也会拦 unity/ 的写入） */
const TMP = join(tmpdir(), 'keyframed-anim-out');
const JOBS = {
  SK_Boss_Kun: { script: 'art/source/characters/SK_Boss_Kun/anim/kun_anims.py', args: ['--out', join(TMP, 'kun')] },
  SK_Boss_Peng: { script: 'art/source/characters/SK_Boss_Peng/anim/peng_anims.py', args: ['--out', join(TMP, 'peng')] },
  SK_Boss_Qilin: { script: 'art/source/characters/SK_Boss_Qilin/anim/qilin_anims.py', args: [] },
  SK_Boss_QilinBurn: { script: 'art/source/characters/SK_Boss_QilinBurn/anim/qilin_burn_anims.py', args: [] },
  SK_Npc_Merchant: { script: 'art/source/characters/SK_Npc_Merchant/anim/merchant_anims.py', args: [] },
  SK_Boss_Hanba: { script: 'art/source/characters/SK_Boss_Hanba/anim/hanba_anims.py', args: ['--out', join(TMP, 'hanba')] },
  SK_Enemy_Aoyin: { script: 'art/source/characters/SK_Enemy_Aoyin/anim/aoyin_anims.py', args: [] },
  SK_Enemy_Jufu: { script: 'art/source/characters/SK_Enemy_Jufu/anim/jufu_anims.py', args: [] },
  SK_Enemy_Manman: { script: 'art/source/characters/SK_Enemy_Manman/anim/manman_anims.py', args: [] },
  SK_Enemy_Qiongqi: { script: 'art/source/characters/SK_Enemy_Qiongqi/anim/qiongqi_anims.py', args: [] },
  SK_Enemy_Tiangou: { script: 'art/source/characters/SK_Enemy_Tiangou/anim/tiangou_anims.py', args: [] },
  // 三领主（4-1）：网页的招式按采样替身片段的事件调过，换手 K 片段要连同 tests/lord-bosses.test.mjs 一起核，默认不跑
  SK_Boss_Feilian: { script: 'art/source/characters/SK_Boss_Feilian/anim/feilian_anims.py', args: ['--out', join(TMP, 'feilian')], optIn: true },
  SK_Boss_Huashe: { script: 'art/source/characters/SK_Boss_Huashe/anim/huashe_anims.py', args: ['--out', join(TMP, 'huashe')], optIn: true },
  SK_Boss_Kui: { script: 'art/source/characters/SK_Boss_Kui/anim/kui_anims.py', args: ['--out', join(TMP, 'kui')], optIn: true },
};

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const [id, j] of Object.entries(JOBS)) console.log(`${id}${j.optIn ? '（要点名）' : ''}  ${j.script}`);
  process.exit(0);
}
let blender = process.env.BLENDER || 'D:/AI-Tools/Blender/blender-5.2.1-windows-x64/blender.exe';
const want = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--blender') blender = args[++i];
  else if (!args[i].startsWith('--')) want.push(args[i]);
}
const dumpOnly = args.includes('--dump-only');
const targets = want.length ? want : Object.keys(JOBS).filter((id) => !JOBS[id].optIn);
for (const id of targets) if (!JOBS[id]) throw new Error(`表里没有 ${id}（--list 看有哪些）`);
if (!existsSync(blender)) throw new Error(`找不到 Blender：${blender}（--blender 或环境变量 BLENDER 指定）`);

const harness = join(ROOT, 'scripts/web/blender-keyframed-dump.py');
const failed = [];
for (const id of targets) {
  const job = JOBS[id];
  const dump = join(ROOT, 'art/source/characters', id, 'anim/_tmp', `${id}.keyframed-anim.json`);
  mkdirSync(dirname(dump), { recursive: true });
  for (const a of job.args) if (a.startsWith(TMP)) mkdirSync(a, { recursive: true });
  const t0 = Date.now();
  const r = spawnSync(blender, ['-b', '--factory-startup', '--python', harness, '--',
    '--kd-script', join(ROOT, job.script), '--kd-asset', id, '--kd-dump', dump, ...job.args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const done = /KD_DONE .*/.exec(log)?.[0];
  if (r.status !== 0 || !done || !existsSync(dump)) {
    failed.push(id);
    console.error(`${id}: Blender 失败（退出码 ${r.status}）\n${log.split('\n').filter((l) => /Error|Traceback|KD_|raise|line \d+/.test(l)).slice(-20).join('\n')}`);
    continue;
  }
  console.log(`${id}: ${done.replace(/^KD_DONE \S+ /, '')}  ${(statSync(dump).size / 1048576).toFixed(1)} MB  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
if (!dumpOnly) {
  const ok = targets.filter((id) => !failed.includes(id));
  if (ok.length) {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/web/export-native-anims.mjs'), ...ok], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exitCode = r.status ?? 1;
  }
}
if (failed.length) {
  console.error(`✘ ${failed.length} 个资产没导出：${failed.join(', ')}`);
  process.exitCode = 1;
}
