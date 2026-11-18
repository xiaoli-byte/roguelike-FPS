/**
 * 界面图标（照译 Unity G/UI/Toolkit/UIIcons.cs：Three.js icons.ts 的 9 个内联 SVG 移植过去后的版本）。
 * Unity 把白色 SVG 解析成矢量图、靠 -unity-background-image-tint-color 染色；网页直接内联 SVG，白色换成 currentColor，
 * 颜色由 .sf-icon { color: var(--sf-tint) } 给（转换脚本把 tint 属性转成 --sf-tint）。尺寸在 theme.css 的 .sf-icon--*。
 */
import { addClasses } from './el';

export const UIIcon = {
  /** 方孔铜钱（灵石） */ Coin: 'coin',
  /** 魂晶 */ Essence: 'essence',
  /** 双刃（剩余敌人） */ Blades: 'blades',
  /** 祥云纹（装饰，横幅两侧） */ Cloud: 'cloud',
  /** 锁 */ Lock: 'lock',
  /** 沙漏（用时） */ Hourglass: 'hourglass',
  /** 骷髅（击杀） */ Skull: 'skull',
  /** 火花（总伤害） */ Spark: 'spark',
  /** 门（清关） */ Gate: 'gate',
} as const;
export type UIIcon = (typeof UIIcon)[keyof typeof UIIcon];

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">';
const C = 'currentColor';

const SVG: Record<UIIcon, string> = {
  coin:
    HEAD +
    `<circle cx="12" cy="12" r="10" fill="${C}"/>` +
    '<circle cx="12" cy="12" r="7.8" fill="none" stroke="#281806" stroke-opacity="0.45" stroke-width="1.1"/>' +
    '<rect x="8.9" y="8.9" width="6.2" height="6.2" fill="#180e04" fill-opacity="0.9" stroke="#fff0c8" stroke-opacity="0.35" stroke-width="0.6"/></svg>',
  essence:
    HEAD +
    `<path d="M12 1.5 L18.5 9 L12 22.5 L5.5 9 Z" fill="${C}"/>` +
    '<path d="M12 1.5 L9.2 9 L12 22.5 L14.8 9 Z M5.5 9 H18.5" fill="none" stroke="#0a0a1e" stroke-opacity="0.45" stroke-width="0.9"/>' +
    '<path d="M12 3.6 L13.4 8.6" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1" stroke-linecap="round"/></svg>',
  blades:
    HEAD +
    `<path d="M4 3.5 L15 14.5 M20 3.5 L9 14.5" fill="none" stroke="${C}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M12.5 17 L17 12.5 M11.5 17 L7 12.5" fill="none" stroke="${C}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="M16.5 17.5 L20 21 M7.5 17.5 L4 21" fill="none" stroke="${C}" stroke-width="2" stroke-linecap="round"/></svg>`,
  cloud:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">' +
    `<path d="M8 32 C2 32 2 22 10 22 C10 12 24 10 28 18 C32 6 52 6 54 18 C60 10 74 12 72 22 C82 20 90 28 84 32 Z" fill="none" stroke="${C}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M28 18 c2 6 10 6 10 0 c0 -4 -6 -4 -6 0 M54 18 c0 7 10 8 10 2 c0 -4 -6 -4 -5 0 M10 22 c3 4 8 3 8 -1" fill="none" stroke="${C}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  lock:
    HEAD +
    `<rect x="5" y="10.5" width="14" height="10" rx="1.5" ry="1.5" fill="none" stroke="${C}" stroke-width="2"/>` +
    `<path d="M8 10.5 V7.5 A4 4 0 0 1 16 7.5 V10.5" fill="none" stroke="${C}" stroke-width="2"/></svg>`,
  hourglass:
    HEAD +
    `<path d="M6 3 H18 M6 21 H18 M7 3 C7 8 17 9 17 12 C17 15 7 16 7 21 M17 3 C17 8 7 9 7 12 C7 15 17 16 17 21" fill="none" stroke="${C}" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  skull:
    HEAD +
    `<path fill-rule="evenodd" fill="${C}" d="M12 2.5 c-4.7 0 -8 3.2 -8 7.6 c0 2.6 1.2 4.4 2.8 5.5 V19 h2.4 v-2 h1.6 v2 h2.4 v-2 h1.6 v2 h2.4 v-3.4 ` +
    'c1.6 -1.1 2.8 -2.9 2.8 -5.5 c0 -4.4 -3.3 -7.6 -8 -7.6 Z M8.8 12.8 a1.9 1.9 0 1 1 0 -3.8 a1.9 1.9 0 0 1 0 3.8 Z M15.2 12.8 a1.9 1.9 0 1 1 0 -3.8 a1.9 1.9 0 0 1 0 3.8 Z"/></svg>',
  spark:
    HEAD +
    `<path fill="${C}" d="M12 1.5 c0.6 4.6 2.4 7.4 6.6 8.4 c-4.2 1 -6 3.8 -6.6 8.4 c-0.6 -4.6 -2.4 -7.4 -6.6 -8.4 c4.2 -1 6 -3.8 6.6 -8.4 Z"/>` +
    `<path fill="${C}" fill-opacity="0.7" d="M19 15.5 c0.3 2 1.1 3.2 3 3.6 c-1.9 0.4 -2.7 1.6 -3 3.6 c-0.3 -2 -1.1 -3.2 -3 -3.6 c1.9 -0.4 2.7 -1.6 3 -3.6 Z"/></svg>`,
  gate:
    HEAD +
    `<path d="M3 6 H21 M5 3.5 H19 M6 6 V21 M18 6 V21 M9.5 6 V21 M14.5 6 V21" fill="none" stroke="${C}" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

export const ICON_COUNT = Object.keys(SVG).length;

/** SVG 源码（调试 / 测试用） */
export function iconSource(icon: UIIcon): string {
  return SVG[icon];
}

/** 一个图标元素：类 sf-icon + sf-icon--<名字>（theme.css 里定尺寸和颜色），再加上 extraClasses */
export function makeIcon(icon: UIIcon, ...extraClasses: (string | null | undefined)[]): HTMLDivElement {
  const e = document.createElement('div');
  e.dataset.name = 'icon-' + icon;
  e.classList.add('sf-icon', 'sf-icon--' + icon);
  for (const c of extraClasses) addClasses(e, c);
  e.innerHTML = SVG[icon] ?? '';
  return e;
}
