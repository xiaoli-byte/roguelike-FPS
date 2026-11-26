/**
 * 雪域天路（川藏高原）检视页入口（plateau-lab.html）：按 ?map= 选图。
 * 4-1 折多垭口 → plateauLab.ts；4-2 大渡河峡谷 → gorgeLab.ts（设计见 docs/level-design/chuanzang-v1.md）；
 * 4-4 神山海子（雷泽雷神的擂台）→ haiziLab.ts（docs/level-design/chuanzang-combat-v1.md 4.5）。
 * ?matboard=1 → matboardLab.ts：第四章材质样板（共用材质、地表四层、参考球，同一片天光下比）。
 */
const params = new URLSearchParams(location.search);
const map = params.get('map');
document.querySelectorAll<HTMLAnchorElement>('#maps a').forEach(a => a.classList.toggle('on', (a.dataset.map ?? '4-1') === (map ?? '4-1')));
if (params.get('matboard') === '1') void import('./matboardLab');
else if (map === '4-2') void import('./gorgeLab');
else if (map === '4-4') void import('./haiziLab');
else void import('./plateauLab');
