/**
 * 打包字体（照译 Unity G/UI/Toolkit/UIFonts.cs）。字体文件由 scripts/web/publish_fonts.py 从 Unity 的子集发布到
 * public/assets/fonts/，@font-face 在 src/ui/css/sf-fonts.css（按字表生成 unicode-range，余量字体用到才下载）。
 *   角色：正文 Noto Sans SC（子集 + 余量）、标题 霞鹜文楷子集 WenKai SF、数字 Barlow Condensed；
 *   回退链（同 Unity）：标题 / 数字 → 正文子集 → 正文余量；
 *   行高（Unity 写在字体资产里）：正文 1.5、标题 1.3、数字 1.15（× 字号，sf-base.css / 转换脚本照这里写）。
 * CSS 里用 var(--sf-font-body | --sf-font-title | --sf-font-num)；.sf-title / .sf-num / .sf-body 是 theme.css 的类。
 */

export const UIFontRole = { Body: 0, Title: 1, Number: 2 } as const;
export type UIFontRole = (typeof UIFontRole)[keyof typeof UIFontRole];

/** 字体族（sf-fonts.css 的 font-family） */
export const FAMILY = { body: 'SF Body', bodyExt: 'SF Body Ext', title: 'SF Title', number: 'SF Number' } as const;

/** 行高（× 字号） */
export const LINE_HEIGHT: Record<UIFontRole, number> = { 0: 1.5, 1: 1.3, 2: 1.15 };

/** 角色 → 类名（HudArt.Font：内联字体的同时加上这个类） */
export function fontClass(role: UIFontRole): string {
  return role === UIFontRole.Title ? 'sf-title' : role === UIFontRole.Number ? 'sf-num' : 'sf-body';
}

/** 角色 → font-family 串（canvas / 测量用） */
export function fontStack(role: UIFontRole): string {
  const body = `"${FAMILY.body}", "${FAMILY.bodyExt}", "Microsoft YaHei", "PingFang SC", sans-serif`;
  if (role === UIFontRole.Title) return `"${FAMILY.title}", ${body}`;
  if (role === UIFontRole.Number) return `"${FAMILY.number}", ${body}`;
  return body;
}

/**
 * 预先加载一批字形（打开字多的界面前调用，避免第一次显示时先用系统字体再跳成打包字体）。
 * 浏览器按 unicode-range 只下载用得到的文件；没有 document.fonts（测试环境）时什么都不做
 */
export function warmup(characters: string, role: UIFontRole = UIFontRole.Body): Promise<void> {
  const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  if (!fonts || !characters) return Promise.resolve();
  const fam = role === UIFontRole.Title ? FAMILY.title : role === UIFontRole.Number ? FAMILY.number : FAMILY.body;
  return fonts.load(`16px "${fam}"`, characters).then(
    () => undefined,
    () => undefined,
  );
}
