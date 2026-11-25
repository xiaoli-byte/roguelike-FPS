// 第一章白盒截图：无头 Chromium 打开检视页 desert-lab.html，逐个机位出图（页面在后台没有 rAF，用 window.lab.setView 手动出帧）。
//   node scripts/desert/whitebox-shots.mjs [端口=5199] [输出目录=docs/art/concepts/ch1-routes/whitebox] [图,逗号分隔=全部] [机位,逗号分隔=全部]
// 每个机位出两张：带标注（点位 + 探针实测的路线）和不带标注（<图>_<机位>_plain.jpg，只在 concept / top 出）。
import { launch } from '../plateau/cdp.mjs';

const port = process.argv[2] ?? '5199';
const out = process.argv[3] ?? 'docs/art/concepts/ch1-routes/whitebox';
const onlyMaps = process.argv[4] && process.argv[4] !== 'all' ? process.argv[4].split(',') : null;
const onlyViews = process.argv[5] ? process.argv[5].split(',') : null;
const log = (...a) => console.log('[whitebox-shots]', ...a);

const b = await launch({ width: 1536, height: 1024 });
try {
  await b.goto(`http://localhost:${port}/desert-lab.html?capture`);
  await b.waitFor('window.lab && window.lab.ready', 120000);
  const maps = onlyMaps ?? await b.eval('window.lab.maps');
  for (const map of maps) {
    await b.goto(`http://localhost:${port}/desert-lab.html?map=${map}&capture`);
    await b.waitFor('window.lab && window.lab.ready', 120000);
    const views = (await b.eval('window.lab.shots')).filter(v => !onlyViews || onlyViews.includes(v));
    const fails = await b.eval('window.lab.report.failures');
    log(map, '机位', views.join(' '), fails ? `探针 ${fails} 项不通过` : '探针全部通过');
    for (const v of views) {
      await b.eval(`(window.lab.overlay(true), window.lab.setView(${JSON.stringify(v)}))`);
      await b.shot(`${out}/${map}_${v}.jpg`);
      if (v === 'concept' || v === 'top') {
        await b.eval(`(window.lab.overlay(false), window.lab.setView(${JSON.stringify(v)}))`);
        await b.shot(`${out}/${map}_${v}_plain.jpg`);
      }
    }
  }
} finally {
  await b.close();
}
log('完成', out);
