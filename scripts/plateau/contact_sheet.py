"""把试玩截图拼成一张审阅总图（每张缩小、下面写文件名里的招式名）。

  python scripts/plateau/contact_sheet.py <输出.jpg> <图1> <图2> … [--cols 3] [--w 480]
  python scripts/plateau/contact_sheet.py docs/art/review/ch4-combat/sheet-tiangou.jpg docs/art/review/ch4-combat/foe-tiangou-*.jpg
"""
import glob
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    args = sys.argv[1:]
    cols, width = 3, 480
    if '--cols' in args:
        i = args.index('--cols'); cols = int(args[i + 1]); del args[i:i + 2]
    if '--w' in args:
        i = args.index('--w'); width = int(args[i + 1]); del args[i:i + 2]
    out, pats = args[0], args[1:]
    files: list[str] = []
    for p in pats:
        files.extend(sorted(glob.glob(p)) or [p])
    files = [f for f in files if Path(f).exists() and Path(f).resolve() != Path(out).resolve()]
    if not files:
        print('没有图'); return
    ims = [Image.open(f).convert('RGB') for f in files]
    h = int(width * ims[0].height / ims[0].width)
    label = 26
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * width, rows * (h + label)), (18, 18, 22))
    try:
        font = ImageFont.truetype('msyh.ttc', 16)
    except OSError:
        font = ImageFont.load_default()
    d = ImageDraw.Draw(sheet)
    for k, (f, im) in enumerate(zip(files, ims)):
        x, y = (k % cols) * width, (k // cols) * (h + label)
        sheet.paste(im.resize((width, h), Image.LANCZOS), (x, y))
        d.text((x + 8, y + h + 4), Path(f).stem, fill=(235, 230, 220), font=font)
    sheet.save(out, quality=86)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
