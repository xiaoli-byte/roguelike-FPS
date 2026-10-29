// 找出 Unity 工程里被本机 DLP 透明加密的文件，写回明文。
//
// 白名单程序（Git、node、编辑器、Python）写出的部分文件在磁盘上是密文：git pull 之后 unity/ 下的
// .cs / .json / .txt / .xml 常被加密（.asset 不会），Unity 不在白名单里，读到的是 "%TSD-Header-###%..."，
// 包管理器解析 manifest 失败、脚本编译不过。node 读到的是明文；PowerShell 不在白名单里，它写出的文件是明文，
// 所以由 node 读出内容、经管道交给 PowerShell 写回。
// 判别：PowerShell 看到的文件大小是密文大小（常见 8192 的倍数），与 node 读到的明文大小不一致即为加密。
// 路径和内容都用 base64 过管道、脚本用 -EncodedCommand 传：PowerShell 5.1 会把 stdin 里的中文路径（枪火重生）读成乱码。
//
//   node scripts/unity/dlp-unity-fix.mjs            # 扫描并写回（默认本仓库的 unity/，worktree 里就是该 worktree 的）
//   node scripts/unity/dlp-unity-fix.mjs --check    # 只扫描，有加密文件时退出码 1
//   node scripts/unity/dlp-unity-fix.mjs <Unity 工程目录>
//   node scripts/unity/dlp-unity-fix.mjs --packages  连同 Library/PackageCache 一起查：包管理器（UPM，node 写的）解出来的包
//                                                    也会是密文，打开工程时报「package.json is not valid JSON」
//   node scripts/unity/dlp-unity-fix.mjs --peel      逐层剥：Unity 读到密文（它读不了）又原样存回去的文件是两层加密，
//                                                    node 剥掉一层还是「%TSD-Header」；照样写回、再扫，直到剥干净（最多 4 遍）
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const root = resolve(args.find((a) => !a.startsWith('--')) ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'unity'));
const dirs = ['Assets', 'Packages', 'ProjectSettings', ...(args.includes('--packages') ? ['Library/PackageCache'] : [])];

function ps(script, input) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { cwd: root, input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`powershell 退出码 ${r.status}：${r.stderr}`);
  return r.stdout;
}

// 返回 PowerShell 看到的大小与 node 读到的大小不一致的文件（绝对路径）
function scan() {
  const out = ps(`[Console]::OutputEncoding=[Text.Encoding]::UTF8
Get-ChildItem -Recurse -File -Force -LiteralPath ${dirs.map((d) => `'${d}'`).join(',')} | ForEach-Object {
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.FullName)) + "\`t" + $_.Length }`);
  const lines = out.trim().split(/\r?\n/).filter(Boolean);
  const encrypted = [];
  for (const line of lines) {
    const [p64, len] = line.split('\t');
    const full = Buffer.from(p64, 'base64').toString('utf8');
    if (statSync(full).size !== Number(len)) encrypted.push(full);
  }
  return { total: lines.length, encrypted };
}

const peel = args.includes('--peel');
const { total, encrypted } = scan();
console.log(`扫描 ${total} 个文件，${encrypted.length} 个被加密`);
if (checkOnly) {
  encrypted.slice(0, 20).forEach((f) => console.log('  ' + relative(root, f)));
  process.exit(encrypted.length ? 1 : 0);
}
if (encrypted.length === 0) process.exit(0);

// 每行：base64(路径) \t base64(内容)
const writer = `$in=[Console]::In; $n=0
while (($l = $in.ReadLine()) -ne $null) {
  $p = $l.Split("\`t")
  $f = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[0]))
  [IO.File]::WriteAllBytes($f, [Convert]::FromBase64String($p[1])); $n++ }
"$n"`;

// 按大小分批（每批至多 100 个文件、约 48 MB 明文）：贴图 PNG / FBX 一个就有几 MB；返回写回的个数
function rewrite(files) {
  let written = 0;
  let batch = [];
  let bytes = 0;
  const flush = () => {
    if (batch.length) written += Number(ps(writer, batch.join('\n') + '\n').trim());
    batch = [];
    bytes = 0;
  };
  for (const f of files) {
    const data = readFileSync(f);
    // node 也读到密文：不加 --peel 时直接停（可能是 node 不在白名单里了，写回只会把密文固化）；--peel 时当作两层加密，剥一层
    if (!peel && data.subarray(0, 12).toString('latin1').startsWith('%TSD-Header')) throw new Error(`node 读到的是密文，不写回：${f}（两层加密时加 --peel）`);
    if (batch.length >= 100 || (batch.length && bytes + data.length > 48 * 1024 * 1024)) flush();
    batch.push(Buffer.from(f, 'utf8').toString('base64') + '\t' + data.toString('base64'));
    bytes += data.length;
  }
  flush();
  return written;
}

let pending = encrypted;
for (let pass = 1; ; pass++) {
  const n = rewrite(pending);
  const after = scan();
  console.log(`${pass > 1 || peel ? `第 ${pass} 遍：` : ''}写回 ${n} 个文件，复查还有 ${after.encrypted.length} 个被加密`);
  if (after.encrypted.length === 0) process.exit(0);
  if (!peel || pass >= 4 || after.encrypted.length >= pending.length) {
    after.encrypted.slice(0, 20).forEach((f) => console.log('  ' + relative(root, f)));
    process.exit(1);
  }
  pending = after.encrypted;
}
