// 动画检视页（anim-lab.html）的无头截图 → docs/art/review/threejs-migration/anim-*.jpg
//
//   npx vite --port 5641 --strictPort          （另开一个终端；别占用别的会话的端口）
//   node scripts/web/anim-lab-shots.mjs [端口] [资产:片段:模式[:参数], …]
//
// 模式：strip = 同一片段 5 个时刻并排（参数无）；machine = 状态机里触发 act_<片段> 后跑「参数」秒；clip = 停在归一化时刻「参数」。
// 默认三只：拂竹 charge、火鼍 roar、夔 leap 的连拍，加狐巫在状态机里尖啸。用 scripts/plateau/cdp.mjs 起无头 Chromium，结束时关掉。
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../plateau/cdp.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = process.argv[2] ?? '5641';
const shots = (process.argv[3] ?? 'SK_Enemy_Fuzhu:charge:strip,SK_Enemy_Tuo:roar:strip,SK_Boss_Kui:leap:strip,SK_Enemy_FoxWitch:scream:machine:0.55').split(',');

const b = await launch({ width: 1600, height: 900 });
try {
  for (const s of shots) {
    const [id, clip, mode, extra] = s.split(':');
    const q = new URLSearchParams({ id, clip, shot: '1' });
    if (mode === 'strip') q.set('strip', '5');
    if (mode === 'machine') q.set('mode', 'machine');
    if (mode === 'clip' && extra) q.set('t', extra);
    const url = `http://localhost:${port}/anim-lab.html?${q}`;
    console.log('→', url);
    await b.goto(url);
    await b.waitFor('window.animLab?.ready || window.animLab?.error', 240000);
    const err = await b.eval('window.animLab.error');
    if (err) throw new Error(err);
    if (mode === 'machine') {
      await b.eval(`(() => { const L = window.animLab; L.simulate(0.5); L.animator.act(${JSON.stringify(clip)}); L.simulate(${Number(extra ?? 0.6)}); })()`);
    }
    await b.eval('window.animLab.render()');
    await new Promise((r) => setTimeout(r, 300));
    await b.eval('window.animLab.render()');
    const name = `anim-${id.replace(/^SK_/, '').replace(/_/g, '-').toLowerCase()}-${clip}${mode === 'machine' ? '-machine' : ''}.jpg`;
    const out = join(ROOT, 'docs/art/review/threejs-migration', name);
    await b.shot(out, 88);
    console.log('  ✔', out);
  }
  const logs = b.logs.filter((l) => /error|exception/i.test(l));
  if (logs.length) console.log(logs.slice(-15).join('\n'));
} finally {
  await b.close();
}
