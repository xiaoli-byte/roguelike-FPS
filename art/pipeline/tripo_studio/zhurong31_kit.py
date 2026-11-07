"""祝融火狱 3-1「熔湖关隘」场景套件（2026-11-06/07）：按 art/reviews/ch3-zhurong-scene-concepts/3-1-molten-lake-pass-v3.webp 拆的大中小件。

  python zhurong31_kit.py prompts    写 prompts/<ID>.txt（Tripo Studio 图片页 GPT Image 2.5 四视图提示词，附参考裁图）
  python zhurong31_kit.py registry   打印 registry.toml 登记段

注意：这是第一版拆件提示词；尺寸、设定的最终值以 registry.toml 为准（11-07 祝融像按用户参考方向重做成人形火神乘两龙、
宫门 / 升鼎改楚式、宫墙 / 大阶去掉火盆，大阶改程序生成），实际发出的提示词记在各资产 asset.json 的概念版本里。

规则来源：docs/art/composition.md（大中小三级、中景不立假人形竖杆、地标不对称）、art/README.md（厚实大形、两三个色块、
不写商业游戏名、不要细砖缝 / 密集裂纹 / 小刻花）、docs/art/ch3-look.md（631 配色）、碰熔岩的只能是石 / 铸铁（用户 11-06）。
"""
import sys
from pathlib import Path

ROW = ("MANDATORY: ONE SINGLE HORIZONTAL ROW of exactly four separate orthographic views of the SAME object, left to right: "
       "1 FRONT view; 2 LEFT side view (object turned so its front points to the LEFT edge of the image); 3 BACK view; "
       "4 RIGHT side view (object turned so its front points to the RIGHT edge of the image). Same scale and same ground line "
       "in all four, wide empty gaps between the views")
GRID = ("MANDATORY: a 2 by 2 GRID of exactly four separate orthographic views of the SAME object: TOP-LEFT = FRONT view; "
        "TOP-RIGHT = LEFT side view (object turned so its front points to the LEFT edge of the image); BOTTOM-LEFT = BACK view; "
        "BOTTOM-RIGHT = RIGHT side view (object turned so its front points to the RIGHT edge of the image). Each view seen "
        "straight on from slightly above (about 15 degrees) so the top surface is just visible, same scale in all four, wide empty "
        "gaps between the views")
COMMON = (", every view complete and not cropped. Plain flat light neutral grey background (#D6D6D6). No floor, no ground "
          "shadow, no text, no labels, no frames, no perspective, no extra objects. No fire, no smoke, no sparks, no lava, no glow "
          "halo: hot cracks, ember beds, flame tips and lantern glass are painted only as flat opaque bright orange-yellow colour "
          "areas.\n\n"
          "REFERENCE: the attached image is a crop of our approved scene concept. Redraw ONLY the {name} from it as a standalone "
          "game asset, keeping its shapes, proportions and materials, simplified as described below, but NOT the coloured scene lighting of the crop: paint true material colours under even neutral white light (stone is warm charcoal-grey, not violet); ignore everything "
          "else in the crop.\n\n"
          "STYLE: stylized hand-painted 3D game environment asset: thick chunky silhouette that still reads as a solid black "
          "shape, broad clean faceted planes, two or three dominant colour blocks ({palette}), soft painted gradients, a few "
          "medium-size ornaments, sparse wear, soot-darkened edges. No photorealism, no micro-grain, no fine brick seams, no dense "
          "cracks, no tiny carvings, no harsh highlights. Anything at ground level is basalt, stone or cast iron; timber only high "
          "up on buildings.\n\n")

STONE = "dark warm charcoal-grey basalt, warm aged bronze, deep vermilion lacquer"
BRONZE = "warm aged bronze, dark brown-green patina, dark warm charcoal-grey basalt"
ROCK = "dark warm charcoal-grey basalt, slightly lighter worn top planes"
EMISSIVE = '{ hue = [0.02, 0.17], min_sat = 0.65, min_val = 0.85 }'
STONE_MAT = "{ roughness = 0.85, metallic = 0.05 }"
BRONZE_MAT = "{ roughness = 0.5, metallic = 0.6 }"

# (ID 后缀, 级, 中文名, 用途, 版式, 参考裁图, 英文物名, 色块, W, H, D, Tripo 面数, 规格档, 材质, fx_points, 设定)
KIT = [
 ("Statue", "大", "祝融坐像", "崖顶主地标（次焦点），不对称：右手立杖、左手按膝", "row", "Statue", "colossal seated statue", STONE,
  20, 28, 16, 30000, "tripo_architecture", STONE_MAT, [],
  "A colossal seated stone statue of the fire god of the south, carved from dark warm charcoal-grey basalt with warm bronze trims, on a "
  "stepped rock throne base. He sits upright facing the FRONT: broad muscular bare chest with a bronze collar plate, a stern "
  "bearded human face, and a tall crown of flame-shaped bronze spikes rising behind the head like a halo (solid sculpted metal, the "
  "flame tips painted flat bright orange-yellow). ASYMMETRIC POSE: his right hand (on the image's left in the FRONT view) holds a "
  "very tall bronze staff planted on the base, topped with a ring-and-trident head that rises above the crown; his left hand rests "
  "flat on his left knee. A heavy draped stone robe over the legs, big bare feet with clear toes. The throne base is a chunky "
  "stepped rock plinth about 6m tall. PROPORTIONS: FRONT and BACK views about 0.75 times as wide as tall; LEFT and RIGHT views about "
  "0.6 times as wide as tall."),
 ("PalaceGate", "大", "祝融宫门", "主焦点：圆形日轮铜门；城垛上的火盆座留给 Brazier 件", "row", "PalaceGate", "palace gate", STONE,
  26, 18, 10, 30000, "tripo_architecture", STONE_MAT, [],
  "The main gate of a fire god's palace: a massive block of dark warm charcoal-grey basalt masonry 26m wide. In its centre a deep "
  "rectangular recess holds a huge ROUND cast bronze door 9m across with a raised sun disc and a flame emblem; the emblem lines and "
  "the ring around the disc are painted flat bright orange-yellow. The door is closed. The recess is flanked by two thick square "
  "pylons a little taller than the wall, each with a long vermilion banner with a gold flame emblem hanging flat against its face. "
  "The top is a walkable rampart edged with chunky square merlons, with two empty square stone pedestals on the parapet above the "
  "pylons. A plain stone base course at the foot. The BACK is a plain flat masonry face showing the back of the round door. "
  "PROPORTIONS: FRONT and BACK views about 1.45 times as wide as tall; LEFT and RIGHT views about 0.55 times as wide as tall."),
 ("FerryTower", "大", "渡口关楼", "近景左框（前景压暗的框架）", "row", "FerryTower", "ferry gate tower", STONE,
  14, 20, 12, 30000, "tripo_architecture", STONE_MAT, [],
  "A fortified ferry gate tower: two massive square pylons of big dark warm charcoal-grey basalt blocks 12m tall stand left and right of "
  "an open gate passage 5m wide and 8m tall that goes straight through from FRONT to BACK under a flat stone lintel; the passage is "
  "EMPTY. On top of the pylons stands one wide dark timber pavilion with deep vermilion lacquered posts, a balcony railing around "
  "it, and a big double-eaved dark tiled roof with sweeping upturned corners and ridge ornaments, reaching 20m. A long vermilion "
  "banner with a gold flame emblem hangs flat over the FRONT face of the right pylon. Two simple guardian reliefs set flat into the "
  "pylons beside the passage. A short flight of stone steps at the foot of the passage. PROPORTIONS: FRONT and BACK views about 0.7 "
  "times as wide as tall; LEFT and RIGHT views about 0.6 times as wide as tall."),
 ("CustomsFort", "大", "湖心税关", "中景岛上的建筑群（岛体走地形 / 岩块）", "grid", "CustomsFort", "island toll fort", STONE,
  24, 14, 20, 30000, "tripo_architecture", STONE_MAT, [],
  "A walled toll fort: a square stone platform 3m tall of big dark warm charcoal-grey basalt blocks with a crenellated parapet around its "
  "edge; one wide straight stone stair climbs the FRONT face from the ground to a gateway in the parapet. On the platform: a "
  "two-storey toll pavilion of stone walls and dark timber with vermilion posts and double-eaved dark tiled roofs (the tallest "
  "part, 14m) at the back centre, a smaller one-storey side hall with a tiled roof on the RIGHT, and a round doorway in the main "
  "pavilion's front wall painted flat bright orange-yellow inside. PROPORTIONS: FRONT and BACK views about 1.7 times as wide as "
  "tall; LEFT and RIGHT views about 1.4 times as wide as tall."),
 ("DingPier", "大", "镇鼎墩", "右侧中景大块面，顶上放镇湖鼎", "grid", "DingPier", "square stone pier", STONE,
  14, 8, 14, 15000, "tripo_architecture", STONE_MAT, [],
  "A massive square pier of big dark warm charcoal-grey basalt blocks, 14m wide and 6m tall with slightly rounded corners and a plain "
  "stone top edge; on its flat top, at the back centre, a stepped square plinth two steps high (2m) that is EMPTY (it will carry a "
  "giant cauldron). On the FRONT face: a big round cast bronze emblem disc in the centre and two long vermilion banners with gold "
  "flame emblems hanging flat on either side of it. Four heavy black iron mooring rings bolted to the top edge at the corners. "
  "PROPORTIONS: all four views about 1.75 times as wide as tall."),
 ("CliffSpire", "大", "玄武岩峰", "火口崖壁 / 远景剪影，随机偏航和缩放", "row", "CliffSpire", "basalt crag", ROCK,
  20, 45, 18, 15000, "tripo_architecture", STONE_MAT, [],
  "A tall jagged basalt crag rising from the ground like a sheer cliff pillar, 45m tall, dark warm charcoal-grey rock in BIG smooth faceted "
  "planes: three or four huge vertical slabs leaning together, a broad foot spreading to 20m, a narrower broken top with two uneven "
  "peaks of different heights, one or two big horizontal ledges. Soft painted gradients, slightly lighter on the upper planes; no "
  "fine vertical striations, no small rubble. The silhouette is clearly different from every side. PROPORTIONS: FRONT and BACK views "
  "about 0.45 times as wide as tall; LEFT and RIGHT views about 0.4 times as wide as tall."),
 ("Ding", "中", "镇湖鼎", "镇鼎墩顶上；四条巨链用 SM_Prop_InfernoChainLink 运行时拼", "row", "Ding", "bronze ding cauldron", BRONZE,
  7, 8, 6, 15000, "tripo_architecture", BRONZE_MAT, [],
  "A giant ancient Chinese bronze ding cauldron: a deep round bowl-shaped belly 6m wide with a wide flat rim, two big upright square "
  "loop handles standing on the rim at the LEFT and RIGHT, and four thick short beast legs with clawed feet. The FRONT and the BACK "
  "of the belly each carry one big raised taotie monster face with broad simplified features (heavy brows, round eyes, fangs) and a "
  "band of large meander pattern under the rim. Warm aged bronze with dark brown-green patina in the recesses and soot at the "
  "bottom; the bowl is empty and dark inside. PROPORTIONS: FRONT and BACK views about 0.9 times as wide as tall; LEFT and RIGHT views "
  "about 0.75 times as wide as tall."),
 ("DrumTower", "中", "鼓楼", "宫门两侧，东侧 ×0.8（地标不对称）", "row", "DrumTower", "drum tower", STONE,
  7, 20, 7, 15000, "tripo_architecture", STONE_MAT, [],
  "A tall square drum tower: a slightly tapering square shaft of dark warm charcoal-grey basalt 6m wide rising to 14m with a crenellated "
  "balcony ring at its top, then a one-storey dark timber pavilion with deep vermilion lacquered posts and a dark tiled pyramid roof "
  "with upturned corners and a small bronze finial, reaching 20m. A big round bronze drum face 3.5m across with a raised flame "
  "emblem fills the FRONT side of the pavilion and the same on the BACK. A vertical vermilion banner hangs flat on the FRONT face of "
  "the shaft. PROPORTIONS: all four views about 0.35 times as wide as tall."),
 ("PalaceWall", "中", "宫墙段", "宫门两翼的模块墙，12 m 首尾拼", "row", "PalaceWall", "fortress wall section", STONE,
  12, 12, 5, 8000, "tripo_architecture", STONE_MAT, [],
  "A straight modular section of a fortress wall, 12m long, of big dark warm charcoal-grey basalt blocks laid in a few large courses, "
  "leaning back very slightly. Its top is a walkable rampart 4m wide with chunky square merlons along the FRONT edge and a low plain "
  "parapet along the BACK edge. One shallow square buttress in the middle of the FRONT face rises to the top. The LEFT and RIGHT ends "
  "are clean flat vertical cut faces so sections join end to end. No banners. PROPORTIONS: FRONT and BACK views about 1.0 times as "
  "wide as tall; LEFT and RIGHT views about 0.42 times as wide as tall."),
 ("ArchBridge", "中", "石拱堤段", "主引导线：近景石台 → 湖心税关，12 m 首尾拼", "grid", "ArchBridge", "arched causeway bridge segment", STONE,
  12, 7, 6, 8000, "tripo_architecture", STONE_MAT, [],
  "One straight modular segment of a stone causeway bridge, 12m long from LEFT to RIGHT: one wide round arch 7m wide and 4m high "
  "going straight through from FRONT to BACK, heavy dark warm charcoal-grey basalt voussoirs and big blocks; a FLAT walkable paved deck 6m "
  "wide on top; a solid stone parapet 1m tall along the FRONT and BACK edges, with a short square stone post at each end of each "
  "parapet carrying nothing. The LEFT and RIGHT ends are clean flat vertical cut faces so segments join end to end. PROPORTIONS: "
  "FRONT and BACK views about 1.7 times as wide as tall; LEFT and RIGHT views about 0.85 times as wide as tall."),
 ("Landing", "中", "石码头台", "出生近景平台（替代木码头）", "grid", "Landing", "stone landing terrace", STONE,
  14, 4, 10, 8000, "tripo_architecture", STONE_MAT, [],
  "A stone landing terrace built out from a rocky shore: a large FLAT paved platform 14m wide and 10m deep, 3m tall, of big dark "
  "warm charcoal-grey basalt blocks; its FRONT, LEFT and RIGHT edges are lined with a low solid parapet 0.9m tall with square stone posts "
  "at the corners and every 4m; at the FRONT-LEFT a wide straight stone stair of six steps runs down from the platform to ground "
  "level; the BACK edge is a plain wall meant to sit against the shore rock. Three short squat basalt mooring bollards stand on the "
  "FRONT edge. PROPORTIONS: FRONT and BACK views about 3.5 times as wide as tall; LEFT and RIGHT views about 2.5 times as wide as "
  "tall."),
 ("Boulders", "中", "前景岩堆", "前景压暗框景、死角", "grid", "Boulders", "boulder cluster", ROCK,
  8, 4, 6, 8000, "tripo_architecture", STONE_MAT, [],
  "A low cluster of four big rounded-off faceted basalt boulders fused together, 8m wide, 4m tall at the highest boulder on the "
  "LEFT stepping down to 1.5m on the RIGHT: chunky dark warm charcoal-black rock with broad flat facets and a few lighter worn top planes, "
  "no cracks, no small rubble. PROPORTIONS: FRONT and BACK views about 2 times as wide as tall; LEFT and RIGHT views about 1.5 "
  "times as wide as tall."),
 ("ParapetLantern", "小", "栏墩青金灯", "唯一的冷色点缀：只放桥栏 / 石台栏墩上（矮，不做中景竖杆）", "row", "ParapetLantern",
  "small parapet lantern", "dark warm charcoal-grey basalt, teal-green patinated bronze, flat bright warm yellow glass",
  0.9, 1.6, 0.9, 3000, "tripo_prop", BRONZE_MAT,
  ['{ name = "FX_Lamp", pos = [0, 1.15, 0], dir = [0, 1, 0] }'],
  "A small guide lantern for a stone parapet: a square dark warm charcoal-grey basalt pedestal 0.9m wide and 0.8m tall with a simple top "
  "slab, carrying a square cast bronze lantern cage with a teal-green patinated frame, four glass panes painted flat bright warm "
  "yellow, and a small pagoda-shaped bronze roof cap with upturned corners. The same from all four sides. PROPORTIONS: every view "
  "about 0.55 times as wide as tall."),
 ("Brazier", "小", "铜火盆", "宫门城垛、关楼台上；火焰是特效（FX_Fire）", "row", "Brazier", "bronze brazier", BRONZE,
  1.6, 1.4, 1.6, 3000, "tripo_prop", BRONZE_MAT,
  ['{ name = "FX_Fire", pos = [0, 1.3, 0], dir = [0, 1, 0] }'],
  "A wide cast bronze brazier: a shallow round bowl 1.6m across with a thick rolled rim and a band of large simple meander pattern, "
  "standing on three short thick beast-paw legs on a square black iron base plate; the bowl is filled with a heap of coals painted "
  "flat bright orange-yellow on top (no flames). Warm aged bronze with soot. The same from all four sides. PROPORTIONS: every view "
  "about 1.15 times as wide as tall."),
]


def aid(k):
    return f"SM_Tripo_Zhurong{k[0]}"


def prompt(k):
    head = GRID if k[4] == "grid" else ROW
    return (head + COMMON.format(name=k[6], palette=k[7]) +
            f"OBJECT ({k[8]:g}m wide x {k[9]:g}m tall x {k[10]:g}m deep): " + k[15])


def registry():
    out = ["# ───────────── 祝融火狱 3-1 熔湖关隘场景套件（2026-11-07；拆自 art/reviews/ch3-zhurong-scene-concepts/3-1-molten-lake-pass-v3.webp，"
           "docs/art/zhurong-kit-31.md）─────────────",
           "# 提示词与参考裁图：art/pipeline/tripo_studio/zhurong31_kit.py；四视图走 Tripo Studio 图片页（GPT Image 2.5），网格走 Tripo 多视图 P2.0，纹理勾「去光处理」。",
           ""]
    for k in KIT:
        out += [f"[assets.{aid(k)}]",
                f'display = "{k[2]}（{k[1]}件；{k[3]}）"',
                'kind = "static"',
                f'class = "{k[12]}"',
                'source_provider = "tripo"',
                'style_theme = "zhurong"',
                f'blockout = {{ source = "scene", id = "zhurong31.{k[0][0].lower() + k[0][1:]}" }}',
                'reference_mode = "bounds_only"',
                f"reference_dimensions = [{float(k[8])}, {float(k[9])}, {float(k[10])}]",
                f"lod_tris = [{k[11]}]",
                f"emissive_key = {EMISSIVE}",
                'keep_glow = "none"',
                f"material = {k[13]}"]
        if k[14]:
            out += ["fx_points = ["] + [f"  {p}," for p in k[14]] + ["]"]
        out += [f'brief = """{k[15]}"""', ""]
    return "\n".join(out)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "prompts"
    if cmd == "registry":
        sys.stdout.reconfigure(encoding="utf-8")
        print(registry())
    else:
        d = Path(__file__).parent / "prompts"
        d.mkdir(exist_ok=True)
        for k in KIT:
            (d / f"{aid(k)}.txt").write_text(prompt(k), encoding="utf-8")
            print(aid(k), k[1], k[4], len(prompt(k)))
