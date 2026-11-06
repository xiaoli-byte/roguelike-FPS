"""grid2row.py <in.png> <out.png>: a 2x2 view grid (TL front, TR left, BL back, BR right) -> one row front,left,back,right."""
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); W, H = im.size
q = [im.crop((0, 0, W // 2, H // 2)), im.crop((W // 2, 0, W, H // 2)), im.crop((0, H // 2, W // 2, H)), im.crop((W // 2, H // 2, W, H))]
bg = im.getpixel((3, 3))
row = Image.new("RGB", (W * 2 + 120, H // 2), bg)
for i, c in enumerate(q):
    row.paste(c, (i * (W // 2 + 40), 0))
row.save(sys.argv[2])
