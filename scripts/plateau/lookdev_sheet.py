"""lookdev.mjs 的拼图和差异（PIL）。

  python scripts/plateau/lookdev_sheet.py compare <上一轮目录> <这一轮目录> <输出.jpg> <上一轮名> <这一轮名>
      同名的图逐行拼「上一轮 | 这一轮 | 差异（放大 4 倍的红热图）」，标上平均差异和变了的像素占比；行多时分成几张
  python scripts/plateau/lookdev_sheet.py toggles <toggles 目录>
      读 toggles.json：全开一格 + 每关一项一格，标上画面变了多少、这一项省了几毫秒
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

THUMB = 480
ROWS_PER_SHEET = 10


def font(size: int) -> ImageFont.ImageFont:
    # 只给文件名：PIL 会去 %WINDIR%\Fonts 找（这台机器的系统不在 C 盘，写死 C:/Windows 找不到）
    for f in ('msyh.ttc', 'simhei.ttf', 'simsun.ttc', '/System/Library/Fonts/PingFang.ttc', 'NotoSansCJK-Regular.ttc'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def thumb(im: Image.Image) -> Image.Image:
    return im.resize((THUMB, int(THUMB * im.height / im.width)), Image.LANCZOS)


def diff(a: Image.Image, b: Image.Image) -> tuple[Image.Image, float, float]:
    """红热图、平均差异（% of 255）、变了的像素占比（任一通道差 > 8）"""
    if a.size != b.size:
        a = a.resize(b.size, Image.LANCZOS)
    d = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
    g = d.convert('L')
    hist = g.histogram()
    n = sum(hist)
    mean = sum(i * c for i, c in enumerate(hist)) / max(1, n) / 255 * 100
    changed = sum(hist[9:]) / max(1, n) * 100
    heat = g.point(lambda v: min(255, v * 4))
    red = Image.merge('RGB', (heat, heat.point(lambda v: v // 4), heat.point(lambda v: v // 6)))
    return red, mean, changed


def compare(dir_a: str, dir_b: str, out: str, name_a: str, name_b: str) -> None:
    a, b = Path(dir_a), Path(dir_b)
    names = sorted(p.name for p in b.glob('*.jpg') if (a / p.name).exists())
    if not names:
        print(f'  {b.name}：和 {name_a} 没有同名的图')
        return
    f, fs = font(18), font(15)
    rows = []
    print(f'  {b.name}（{name_a} → {name_b}）')
    for n in names:
        ia, ib = Image.open(a / n).convert('RGB'), Image.open(b / n).convert('RGB')
        heat, mean, changed = diff(ia, ib)
        rows.append((n, thumb(ia), thumb(ib), thumb(heat), mean, changed))
        flag = '  ← 变了' if changed > 2 else ''
        print(f'    {n:<44} 平均差 {mean:5.2f}%   变了的像素 {changed:5.1f}%{flag}')
    th = rows[0][1].height
    label = 26
    for page in range(0, len(rows), ROWS_PER_SHEET):
        part = rows[page:page + ROWS_PER_SHEET]
        sheet = Image.new('RGB', (THUMB * 3 + 8, 34 + len(part) * (th + label)), '#111820')
        dr = ImageDraw.Draw(sheet)
        for k, t in enumerate((name_a, name_b, '差异 ×4')):
            dr.text((k * (THUMB + 4) + 8, 8), t, fill='#d9b45a', font=f)
        for r, (n, ta, tb, td, mean, changed) in enumerate(part):
            y = 34 + r * (th + label)
            for k, im in enumerate((ta, tb, td)):
                sheet.paste(im, (k * (THUMB + 4), y))
            dr.text((6, y + th + 3), f'{n}　平均差 {mean:.2f}%　变了的像素 {changed:.1f}%', fill='#ff8a7a' if changed > 2 else '#c6d6df', font=fs)
        dst = out if len(rows) <= ROWS_PER_SHEET else out.replace('.jpg', f'-{page // ROWS_PER_SHEET + 1}.jpg')
        sheet.save(dst, quality=88)
        print(f'  对比图 → {dst}')


def toggles(dir_: str) -> None:
    d = Path(dir_)
    meta = json.loads((d / 'toggles.json').read_text(encoding='utf-8'))
    base = Image.open(d / '00-all.jpg').convert('RGB')
    cells = [(thumb(base), f'全开（{meta.get("size", "")} 整帧 {meta["base"]:.2f} ms，噪声 ±{meta.get("noise", 0):.2f}）', '#d9b45a')]
    print(f'  {"关掉的一项":<20} 画面变了的像素   省下')
    for r in meta['rows']:
        im = Image.open(d / r['file']).convert('RGB')
        _, mean, changed = diff(base, im)
        ms = r.get('ms')
        noise = meta.get('noise', 0)
        mtxt = '—' if ms is None else ('≈0 ms' if abs(ms) <= noise else f'{ms:+.2f} ms')
        cells.append((thumb(im), f'关 {r["label"]}　变 {changed:.1f}%　{mtxt}', '#ff8a7a' if changed < 0.5 else '#c6d6df'))
        print(f'  {r["label"]:<20} {changed:6.1f}%   {mtxt}{"   ← 几乎看不出却在花钱" if changed < 0.5 and (ms or 0) > max(noise, 0.05) else ""}')
    cols, th, label = 4, cells[0][0].height, 26
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (THUMB + 4), rows * (th + label)), '#111820')
    dr, fs = ImageDraw.Draw(sheet), font(15)
    for i, (im, txt, col) in enumerate(cells):
        x, y = (i % cols) * (THUMB + 4), (i // cols) * (th + label)
        sheet.paste(im, (x, y))
        dr.text((x + 6, y + th + 3), txt, fill=col, font=fs)
    out = d / 'toggles-sheet.jpg'
    sheet.save(out, quality=88)
    print(f'  拼图 → {out}')


if __name__ == '__main__':
    if sys.argv[1] == 'compare':
        compare(*sys.argv[2:7])
    elif sys.argv[1] == 'toggles':
        toggles(sys.argv[2])
