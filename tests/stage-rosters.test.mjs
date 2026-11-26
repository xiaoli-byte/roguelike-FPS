// public/assets/unity-levels/rosters.json（每张图 / 每章会出现的敌人与首领，进关按本关读美术用：src/assets/StageArt.ts）
// 必须是由当前发布的场景文档生成的：场景重导出 / 重发布后忘了重跑 scripts/web/export-stage-rosters.mjs，这里就会挂。
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('rosters.json matches the published scene documents', () => {
  const script = fileURLToPath(new URL('../scripts/web/export-stage-rosters.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
