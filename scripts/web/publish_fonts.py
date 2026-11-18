"""Unity 打包的界面字体 → 网页（docs/threejs-migration.md M11c；Unity 侧见 G/UI/Toolkit/UIFonts.cs）。

    python scripts/web/publish_fonts.py           转换并发布（WOFF2 + 许可证 + @font-face 样式表）
    python scripts/web/publish_fonts.py --check   只核对发布物是不是由当前 Unity 字体生成的（不写），不一致退出码 1

输入：unity/Assets/Game/Resources/UI/Fonts/（scripts/unity/subset_fonts.py 裁好的子集，全部 SIL OFL 1.1）
  NotoSansSC-Regular.otf       正文子集（GB2312 一级 + 代码里的全部文案）
  NotoSansSC-Regular-Ext.otf   正文余量（子集之外的字，Unity 里是动态回退）
  WenKaiSF-Medium.ttf          标题（霞鹜文楷子集，OFL 保留字体名，改名 WenKai SF）
  BarlowCondensed-SemiBold.ttf 数字
输出：
  public/assets/fonts/<名>.woff2 + OFL-*.txt + FONTS-NOTICE.txt（许可证随字体分发）
  public/assets/fonts/fonts.json   源文件 sha256 → 发布文件 sha256（--check 用；WOFF2 的 brotli 编码换版本可能逐字节不同，所以核对源而不是重编码）
  src/ui/css/sf-fonts.css           @font-face：每个字体带 unicode-range（按字体实际的字表生成），
                                     浏览器只在页面真用到某段字时才下载那个文件——余量字体（几 MB）平时不会下。
字体族名（src/ui/css/sf-base.css 的 --sf-font-* 回退链用）：SF Body / SF Body Ext / SF Title / SF Number，
都登记成 font-weight 400：USS 的 -unity-font-style: bold 在网页是浏览器合成粗体，同 Unity SDF 字体的加粗。
"""
import hashlib
import json
import os
import shutil
import sys
from io import BytesIO

from fontTools.ttLib import TTFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'unity', 'Assets', 'Game', 'Resources', 'UI', 'Fonts')
OUT = os.path.join(ROOT, 'public', 'assets', 'fonts')
CSS = os.path.join(ROOT, 'src', 'ui', 'css', 'sf-fonts.css')
MANIFEST = os.path.join(OUT, 'fonts.json')

# (源文件, 发布名, 字体族, 角色说明)
FONTS = [
    ('NotoSansSC-Regular.otf', 'NotoSansSC-Regular', 'SF Body', '正文（Noto Sans SC 子集）'),
    ('NotoSansSC-Regular-Ext.otf', 'NotoSansSC-Regular-Ext', 'SF Body Ext', '正文余量（子集之外的字，用到才下载）'),
    ('WenKaiSF-Medium.ttf', 'WenKaiSF-Medium', 'SF Title', '标题（霞鹜文楷子集 WenKai SF）'),
    ('BarlowCondensed-SemiBold.ttf', 'BarlowCondensed-SemiBold', 'SF Number', '数字（Barlow Condensed SemiBold）'),
]
LICENSES = ['OFL-NotoSansSC.txt', 'OFL-LXGWWenKai.txt', 'OFL-Barlow.txt', 'FONTS-NOTICE.txt']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data.startswith(b'%TSD-Header'):
        raise SystemExit(f'{os.path.relpath(path, ROOT)} 是 DLP 密文：先跑 node scripts/unity/dlp-unity-fix.mjs')
    return data


def same_text(path, data):
    """文本文件按 LF 比较（Git 在 Windows 上可能把检出的文件换成 CRLF）"""
    if not os.path.exists(path):
        return False
    return read(path).replace(b'\r\n', b'\n') == data.replace(b'\r\n', b'\n')


def unicode_ranges(font):
    """字体 cmap 里的码位 → 合并成 U+XXXX-YYYY 段"""
    cps = sorted(font.getBestCmap().keys())
    out = []
    start = prev = None
    for c in cps:
        if start is None:
            start = prev = c
        elif c == prev + 1:
            prev = c
        else:
            out.append((start, prev))
            start = prev = c
    if start is not None:
        out.append((start, prev))
    return ', '.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in out), len(cps)


def to_woff2(data):
    font = TTFont(BytesIO(data))
    font.flavor = 'woff2'
    buf = BytesIO()
    font.save(buf, reorderTables=False)
    return buf.getvalue()


def build_css(entries):
    lines = [
        '/*',
        ' * 由 scripts/web/publish_fonts.py 生成，不要手改。Unity 打包的界面字体（SIL OFL 1.1，许可证在 public/assets/fonts/）。',
        ' * unicode-range 按每个字体的实际字表：页面用到某段字时浏览器才下载那个文件（余量字体平时不下）。',
        ' */',
    ]
    for e in entries:
        lines += [
            '',
            f'/* {e["role"]}：{e["glyphs"]} 个码位 */',
            '@font-face {',
            f'  font-family: "{e["family"]}";',
            f'  src: url("/assets/fonts/{e["file"]}") format("woff2");',
            '  font-weight: 400;',
            '  font-style: normal;',
            '  font-display: swap;',
            f'  unicode-range: {e["range"]};',
            '}',
        ]
    return '\n'.join(lines) + '\n'


def main():
    check = '--check' in sys.argv[1:]
    old = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            old = json.load(f)
    problems = []
    entries = []
    manifest = {'fonts': [], 'licenses': []}
    writes = []
    for src_name, out_name, family, role in FONTS:
        data = read(os.path.join(SRC, src_name))
        src_sha = sha(data)
        font = TTFont(BytesIO(data))
        rng, n = unicode_ranges(font)
        file = out_name + '.woff2'
        out_path = os.path.join(OUT, file)
        prev = next((x for x in old.get('fonts', []) if x.get('file') == file), None)
        if prev and prev.get('source') == src_sha and os.path.exists(out_path) and sha(read(out_path)) == prev.get('sha256'):
            woff_sha = prev['sha256']
        elif check:
            problems.append(f'{file} 不是由当前的 {src_name} 生成的')
            woff_sha = prev.get('sha256') if prev else ''
        else:
            woff = to_woff2(data)
            woff_sha = sha(woff)
            writes.append((out_path, woff))
        manifest['fonts'].append({'file': file, 'family': family, 'source': src_sha, 'sha256': woff_sha, 'glyphs': n})
        entries.append({'file': file, 'family': family, 'role': role, 'glyphs': n, 'range': rng})
    for lic in LICENSES:
        data = read(os.path.join(SRC, lic))
        manifest['licenses'].append({'file': lic, 'sha256': sha(data)})
        out_path = os.path.join(OUT, lic)
        if not same_text(out_path, data):
            if check:
                problems.append(f'{lic} 和 Unity 里的不一致')
            else:
                writes.append((out_path, data))
    css = build_css(entries).encode('utf-8')
    if not same_text(CSS, css):
        if check:
            problems.append('src/ui/css/sf-fonts.css 不是最新的')
        else:
            writes.append((CSS, css))
    man = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    if not same_text(MANIFEST, man):
        if check:
            problems.append('public/assets/fonts/fonts.json 不是最新的')
        else:
            writes.append((MANIFEST, man))

    if check:
        if problems:
            print('字体发布物和 Unity 对不上（跑 python scripts/web/publish_fonts.py）：')
            for p in problems:
                print('  ' + p)
            sys.exit(1)
        print('字体发布物是最新的')
        return
    os.makedirs(OUT, exist_ok=True)
    for path, data in writes:
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        shutil.move(tmp, path)
        print('写了 ' + os.path.relpath(path, ROOT).replace('\\', '/'))
    for e in manifest['fonts']:
        size = os.path.getsize(os.path.join(OUT, e['file']))
        print(f'  {e["file"]}  {e["family"]}  {e["glyphs"]} 字  {size / 1024:.0f} KB')
    if not writes:
        print('没有变化')


if __name__ == '__main__':
    main()
