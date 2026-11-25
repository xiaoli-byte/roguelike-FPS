// 第一章新做的件截图：无头 Chromium 打开 desert-pieces.html，逐件逐机位出图（页面在后台没有 rAF，用 window.lab 手动出帧）。
//   node scripts/desert/pieces-shots.mjs [端口=5199] [输出目录=docs/art/concepts/ch1-routes/pieces] [件,逗号分隔=全部] [--boxes]
// 每个机位一张 <件>_<机位>.jpg；--boxes 另出一张带碰撞盒线框的 <件>_<机位>_boxes.jpg。
import { mkdirSync } from 'node:fs';
import { launch } from '../plateau/cdp.mjs';

const args = process.argv.slice(2);
const boxes = args.includes('--boxes');
const pos = args.filter(a => !a.startsWith('--'));
const port = pos[0] ?? '5199';
const out = pos[1] ?? 'docs/art/concepts/ch1-routes/pieces';
const only = pos[2] && pos[2] !== 'all' ? pos[2].split(',') : null;
const log = (...a) => console.log('[pieces-shots]', ...a);
mkdirSync(out, { recursive: true });

const b = await launch({ width: 1536, height: 1024 });
try {
  await b.goto(`http://localhost:${port}/desert-pieces.html?capture`);
  await b.waitFor('window.lab && window.lab.ready', 120000);
  const pieces = (await b.eval('window.lab.pieces')).filter(p => !only || only.includes(p));
  for (const piece of pieces) {
    await b.eval(`window.lab.setPiece(${JSON.stringify(piece)})`);
    await b.waitFor('window.lab.ready', 60000);
    const views = await b.eval('window.lab.views()');
    log(piece, views.join(' '));
    for (const v of views) {
      await b.eval(`(window.lab.boxes(false), window.lab.step(0.5), window.lab.setView(${JSON.stringify(v)}))`);
      await b.shot(`${out}/${piece}_${v}.jpg`);
      if (boxes) {
        await b.eval(`(window.lab.boxes(true), window.lab.setView(${JSON.stringify(v)}))`);
        await b.shot(`${out}/${piece}_${v}_boxes.jpg`);
      }
    }
  }
} finally {
  await b.close();
}
log('完成', out);
