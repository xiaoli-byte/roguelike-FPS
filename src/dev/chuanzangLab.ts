/**
 * 雪域天路（川藏高原）检视页入口（plateau-lab.html）：按 ?map= 选图。
 * 4-1 折多垭口 → plateauLab.ts；4-2 大渡河峡谷 → gorgeLab.ts（设计见 docs/level-design/chuanzang-v1.md）。
 */
const map = new URLSearchParams(location.search).get('map');
document.querySelectorAll<HTMLAnchorElement>('#maps a').forEach(a => a.classList.toggle('on', (a.dataset.map ?? '4-1') === (map ?? '4-1')));
if (map === '4-2') void import('./gorgeLab');
else void import('./plateauLab');
