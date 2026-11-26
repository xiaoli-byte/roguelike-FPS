"""Tripo 多视图输入：取资产当前概念的四张配准视图（CN_<ID>_v###_{front,left,back,right}.png，配准时已抠成透明底），
按同一比例缩放、居中放到 1024² 透明画布上，写到 inputs/<ID>/{front,left,back,right}.png。

    python crop_registered.py <ID> [...]

和 crop_inputs.py 的区别：那个从 Tripo 图片页的原图（_source.png，平底）洪泛抠图；管线 concept 阶段（OpenAI 接口）出的原图
常带暗底和光晕，洪泛抠不干净，而配准视图已经按白模剪影抠好了，直接用它（2026-11-27 武器改走 Tripo 时加）。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "art" / "pipeline"))
from PIL import Image  # noqa: E402
from lib import imaging  # noqa: E402
from lib.config import CFG  # noqa: E402
from lib.state import AssetState  # noqa: E402

OUT = Path(__file__).parent / "inputs"


def main(aid: str) -> None:
    spec = CFG.asset(aid)
    cn = AssetState(spec).current("concept")  # 不要求已审核：先裁出来和原图一起看，再决定批不批
    crops = []
    for view in imaging.VIEW_ORDER:
        im = Image.open(spec.stage_dir("concept") / f"CN_{aid}_v{cn['version']:03d}_{view}.png").convert("RGBA")
        alpha = im.getchannel("A").point(lambda x: 0 if x < 16 else x)  # 配准留下的极淡毛边不算进边界框
        im.putalpha(alpha)
        crops.append(im.crop(alpha.getbbox()))
    s = 900 / max(max(c.width, c.height) for c in crops)
    out = OUT / aid
    out.mkdir(parents=True, exist_ok=True)
    for view, c in zip(imaging.VIEW_ORDER, crops):
        w, h = max(1, round(c.width * s)), max(1, round(c.height * s))
        canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        canvas.alpha_composite(c.resize((w, h), Image.Resampling.LANCZOS), ((1024 - w) // 2, (1024 - h) // 2))
        canvas.save(out / f"{view}.png")
    row = Image.new("RGBA", (4 * 512, 512), (214, 214, 214, 255))
    for i, view in enumerate(imaging.VIEW_ORDER):
        with Image.open(out / f"{view}.png") as v:
            row.alpha_composite(v.resize((512, 512)), (i * 512, 0))
    row.convert("RGB").save(out / "_contact.jpg", quality=85)
    print(aid, f"concept v{cn['version']:03d}", "->", out)


if __name__ == "__main__":
    for a in sys.argv[1:]:
        main(a)
