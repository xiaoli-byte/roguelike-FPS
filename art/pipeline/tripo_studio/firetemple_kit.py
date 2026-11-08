"""3-3 首领场「火神殿」场景套件（2026-11-08）：按 art/reviews/ch3-fire-temple/fire-temple-v2-1.webp 拆的 Tripo 件。

  python firetemple_kit.py prompts    写 prompts/<ID>.txt（Tripo Studio 图片页 GPT Image 2.5 四视图提示词）
  python firetemple_kit.py registry   打印 registry.toml 登记段

只列走 Tripo 的件（铜香炉试了两轮，GPT Image 都画成熔炉，改用 3-1 套件的楚式升鼎 SM_Tripo_ZhurongDing 当全掩体）（玩家走得到、看得清细节的近 / 中景）；高台、大阶、广场、矮墙、掩体分级件、远景都由场景构建器程序生成，
见 docs/art/fire-temple-33.md。共用的版式 / 风格句沿用 zhurong31_kit.py（同一章、同一套规矩）。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from zhurong31_kit import ROW, GRID, COMMON, STONE, BRONZE, EMISSIVE, STONE_MAT, BRONZE_MAT  # noqa: E402

REF_EDIT = ("REFERENCE: the attached image is a crop of our approved scene concept. Redraw ONLY the {name} from it as a standalone "
            "game asset, keeping its shapes, proportions and materials, simplified as described below, but NOT the coloured scene "
            "lighting of the crop: paint true material colours under even neutral white light (stone is warm charcoal-grey, not "
            "violet). {remove}\n\n")
NO_REF = ("REFERENCE: none. Draw it from the description below, under even neutral white light, true material colours "
          "(stone is warm charcoal-grey, not violet). STRICTLY NOTHING ELSE in the image.\n\n")

# (ID 后缀, 级, 中文名, 用途, 版式, 参考裁图(None = 纯文字), 去掉什么, 英文物名, 色块, W, H, D, Tripo 面数, 规格档, 材质, fx_points, 设定)
KIT = [
 ("Hall", "大", "火神殿殿身", "主焦点：火门空着，王座另成一件放进去；门洞内壁发光 = T_E，火焰走 FX_GateFire", "grid", "Hall",
  "Remove the throne, dragons and fire: the gateway is an EMPTY recess. Ignore the terrace and stairs below the hall's low base.",
  "palace hall", STONE, 56, 18, 24, 30000, "tripo_architecture", STONE_MAT,
  ['{ name = "FX_GateFire", pos = [0, 4.5, 9], dir = [0, 1, 0] }'],
  "A wide ancient Chinese palace hall on its own low plain stone base 1.2m tall. FRONT: thick plain round columns of dark aged bronze "
  "(one simple band top and bottom), four on each side of a wide central bay; the SECOND column from the RIGHT end is MISSING, only its "
  "round plinth and a short jagged broken stump remain. The central bay is a huge square gateway 11m wide, 8m tall, in a thick plain "
  "stone frame with one broad bronze border, opening into a deep EMPTY recess whose back wall is flat bright orange-yellow. Chunky "
  "vermilion lacquered beams and big simplified bracket sets above the columns. Heavy double-eaved hip roof of dark cast bronze tiles, "
  "gently upturned corners, two big curled ridge ornaments. Plain stone side and back walls. PROPORTIONS: FRONT and BACK "
  "about 3.1 times as wide as tall; LEFT and RIGHT about 1.35."),
 ("Throne", "中", "火神王座", "火门里的空王座 + 两条铜龙（魔将登场站位在它前面）", "row", "Throne",
  "Remove all the fire and glow behind it: plain empty background.",
  "empty throne with two bronze dragons", STONE, 12, 7, 7, 15000, "tripo_architecture", STONE_MAT, [],
  "An empty monumental throne of the fire god on a dais: a three-step square stone dais 12m wide, 7m deep and 1.5m tall; on it, at the "
  "back centre, a massive high-backed throne carved from one block of dark warm charcoal-grey stone, 4m wide, its back 5.5m above the "
  "dais, with two broad vermilion-and-bronze cloud-scroll bands and thick square armrests; the seat is EMPTY. On the dais at the front "
  "LEFT and front RIGHT corners, two cast bronze dragons coiled upright on round drum pedestals, 3m tall, bodies wound in one big S, "
  "heads raised and facing forward, chunky simplified forms, warm aged bronze with brown-green patina. PROPORTIONS: FRONT and BACK "
  "views about 1.7 times as wide as tall; LEFT and RIGHT views about 1.0 times as wide as tall."),
 ("FallenColumn", "中", "断柱", "斜靠殿檐（不对称破口）+ 横躺广场当全掩体；画成竖直一整段，Unity 里转", "row", "FallenColumn",
  "Draw it standing straight UP, not leaning, without the rubble.",
  "broken bronze column", BRONZE, 3, 11, 3, 8000, "tripo_architecture", BRONZE_MAT, [],
  "One broken segment of a giant cast bronze column, drawn standing straight upright: a thick plain round shaft 2.4m across and 9m "
  "long, dark aged bronze with brown-green patina and soot, one simple raised band near the top. The TOP end keeps the column head: a "
  "square stone block 3m wide and 1.2m tall with a short broken stub of a vermilion lacquered beam. The BOTTOM end is snapped off: a "
  "jagged broken rim, slightly dented, the broken face dark rough metal. PROPORTIONS: every view about 0.27 times as wide as tall."),
]


def aid(k):
    return f"SM_Tripo_Zhurong{k[0]}"


def prompt(k):
    head = GRID if k[4] == "grid" else ROW
    common = COMMON.format(name=k[7], palette=k[8])
    ref = REF_EDIT.format(name=k[7], remove=k[6]) if k[5] else NO_REF
    pre, post = common.split("REFERENCE:")
    post = post.split("STYLE:", 1)[1]
    return head + pre + ref + "STYLE:" + post + f"OBJECT ({k[9]:g}m wide x {k[10]:g}m tall x {k[11]:g}m deep): " + k[16]


def registry():
    out = ["# ───────────── 3-3 首领场「火神殿」场景套件（2026-11-08；拆自 art/reviews/ch3-fire-temple/fire-temple-v2-1.webp，"
           "docs/art/fire-temple-33.md）─────────────",
           "# 提示词：art/pipeline/tripo_studio/firetemple_kit.py；四视图走 Tripo Studio 图片页（GPT Image 2.5），网格走 Tripo 多视图 P2.0，纹理勾「去光处理」。",
           ""]
    for k in KIT:
        out += [f"[assets.{aid(k)}]",
                f'display = "{k[2]}（{k[1]}件；{k[3]}）"',
                'kind = "static"',
                f'class = "{k[13]}"',
                'source_provider = "tripo"',
                'style_theme = "zhurong"',
                f'blockout = {{ source = "scene", id = "firetemple33.{k[0][0].lower() + k[0][1:]}" }}',
                'reference_mode = "bounds_only"',
                f"reference_dimensions = [{float(k[9])}, {float(k[10])}, {float(k[11])}]",
                f"lod_tris = [{k[12]}]",
                f"emissive_key = {EMISSIVE}",
                'keep_glow = "none"',
                f"material = {k[14]}"]
        if k[15]:
            out += ["fx_points = ["] + [f"  {p}," for p in k[15]] + ["]"]
        out += [f'brief = """{k[16]}"""', ""]
    return "\n".join(out)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "prompts"
    sys.stdout.reconfigure(encoding="utf-8")
    if cmd == "registry":
        print(registry())
    else:
        d = Path(__file__).parent / "prompts"
        d.mkdir(exist_ok=True)
        for k in KIT:
            (d / f"{aid(k)}.txt").write_text(prompt(k), encoding="utf-8")
            print(aid(k), k[1], k[4], len(prompt(k)))
