// src/assets/stageRosters.ts（每张图 / 每章会出现的敌人与首领，进关按本关读美术用：src/assets/StageArt.ts）
// 必须是由当前关卡数据 public/assets/levels/<图>/level.json 生成的：关卡数据改了忘了重跑 scripts/web/export-stage-rosters.mjs，这里就会挂。
// 关卡数据还没从 Unity 导出转换过来（2026-11-26「Unity 迁移至 Three.js」会话在做）时跳过。
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { levelIds } from '../scripts/web/export-stage-rosters.mjs';

test('stageRosters.ts matches the level data', { skip: levelIds().length === 0 && '还没有 public/assets/levels/<图>/level.json' }, () => {
  const script = fileURLToPath(new URL('../scripts/web/export-stage-rosters.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
