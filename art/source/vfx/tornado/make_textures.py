from pathlib import Path
from PIL import Image
import math

OUT = Path(__file__).resolve().parents[4] / "unity/Assets/Art/VFX/Tornado"
OUT.mkdir(parents=True, exist_ok=True)
W, H = 512, 128
img = Image.new("RGBA", (W, H))
p = img.load()
strands = [(0.22, 0.07, 0.3), (0.38, 0.1, 0.62), (0.52, 0.13, 1.0), (0.68, 0.07, 0.48), (0.82, 0.045, 0.24)]
for y in range(H):
    across = y / (H - 1)
    for x in range(W):
        u = x / (W - 1)
        ends = min(1.0, u * 12.0, (1.0 - u) * 12.0)
        flow = 0.82 + 0.18 * math.sin(u * 17.0 + across * 5.0)
        flow *= 0.9 + 0.1 * math.sin(u * 43.0 - across * 11.0)
        alpha = 0.0
        brightness = 0.0
        for center, width, strength in strands:
            drift = math.sin(u * 5.0 + center * 9.0) * 0.025
            band = math.exp(-((across - center - drift) / width) ** 2)
            alpha += band * strength
            brightness = max(brightness, band * strength)
        soft = math.exp(-((across - 0.5) / 0.48) ** 2) * 0.1
        a = min(1.0, (alpha + soft) * ends * flow)
        value = int(145 + 110 * min(1.0, brightness + soft))
        p[x, y] = (value, value, value, max(0, min(255, int(a * 255))))
img.save(OUT / "T_VFX_WindRibbon.png")
print(OUT / "T_VFX_WindRibbon.png")
