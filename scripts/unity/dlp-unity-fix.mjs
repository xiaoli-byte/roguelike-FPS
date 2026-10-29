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
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const root = resolve(args.find((a) => !a.startsWith('--')) ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'unity'));
const dirs = ['Assets', 'Packages', 'ProjectSettings'];

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

let written = 0;
for (let i = 0; i < encrypted.length; i += 100) {
  const input = encrypted.slice(i, i + 100).map((f) => {
    const data = readFileSync(f);
    // node 也读到密文说明不在白名单里了，写回只会把密文固化成明文文件，直接停
    if (data.subarray(0, 12).toString('latin1').startsWith('%TSD-Header')) throw new Error(`node 读到的是密文，不写回：${f}`);
    return Buffer.from(f, 'utf8').toString('base64') + '\t' + data.toString('base64');
  }).join('\n') + '\n';
  written += Number(ps(writer, input).trim());
}
console.log(`写回 ${written} 个文件`);

const after = scan();
console.log(`复查：还有 ${after.encrypted.length} 个被加密`);
after.encrypted.slice(0, 20).forEach((f) => console.log('  ' + relative(root, f)));
process.exit(after.encrypted.length ? 1 : 0);
