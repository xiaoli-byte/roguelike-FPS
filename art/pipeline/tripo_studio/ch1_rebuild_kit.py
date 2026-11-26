"""第一章重建件（2026-11-22，1-1 / 1-2 场景重搭用）：5 件 Tripo 新模型的定义。

  python ch1_rebuild_kit.py prompts           写 prompts/<ID>.txt（OpenAI gpt-image-2.6-sunburst 四视图提示词，< 2500 字）
  python ch1_rebuild_kit.py registry          打印 registry.toml 登记段
  python ch1_rebuild_kit.py concept <ID> [--extra "..."] [--round N]
                                              调 OpenAI 出四视图原图 → sheets_raw/<ID>_r<N>.png + 同名 .json（用量、请求号）

四视图走 OpenAI 接口（art/pipeline/lib/openai_image.py generate()；调用前把 .env 的 OPENAI_API_KEY 强制写进 os.environ，
本机系统变量里有一把没额度的旧 key），网格走 Tripo Studio 多视图 P2.0。记录见 docs/art/ch1-rebuild-kit.md。
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

MODEL = "gpt-image-2.6-sunburst"
SIZE = "2048x1152"

ROW = ("MANDATORY: ONE SINGLE HORIZONTAL ROW of exactly four separate orthographic views of the SAME object, left to right: "
       "1 FRONT view; 2 LEFT side view (object turned so its front points to the LEFT edge of the image); 3 BACK view; "
       "4 RIGHT side view (object turned so its front points to the RIGHT edge of the image). Same scale and same ground line "
       "in all four, wide empty gaps between the views, every view complete and not cropped. Pure flat white background. "
       "No floor, no ground shadow, no text, no labels, no frames, no perspective, no extra objects.")
STYLE = ("STYLE: stylized hand-painted 3D game environment asset painted under even neutral white light with true base colours "
         "only: no baked lighting, no cast shadows, no ambient-occlusion darkening, no rim light. Thick chunky simplified "
         "silhouette, broad clean faceted planes, two or three dominant colour blocks ({palette}), soft painted gradients, "
         "sparse medium-size wear. No photorealism, no micro-grain, no fine cracks, no realistic erosion detail, no tiny "
         "carvings. Physically plausible.")

EARTH = "pale sand-yellow rammed earth, dark khaki reed layers, grey-brown timber, a small faded vermilion accent"
ROCK = "ochre-red sandstone, paler sand-yellow strata bands, sand-yellow drift sand"
BONE = "aged warm ivory-grey bone (never white), sand-yellow drift sand"
WOOD = "weathered silver-grey and warm grey-brown dead wood, sand-yellow dune sand"
STUPA_COLORS = "chalky warm-white lime plaster, ochre mud brick, dull bronze-gold, a faded vermilion accent, sand-yellow sand"
GATE_COLORS = "faded vermilion lacquer, weathered grey-brown wood, grey stone, dull gold tassels, sand-yellow sand"
TENT_COLORS = "khaki-brown felt, beige canvas, grey-brown timber, a faded indigo accent, sand-yellow sand"

# (ID, 中文名, 用途, 规格档, W, H, D, Tripo 面数, architecture_role, 粗糙度, 色块, 英文物名, 设定)
KIT = [
 ("SM_Tripo_DesertPosthouseGate", "驿站残门", "1-1 出生点前的门框：走出门洞看到古道、长城缺口和远处烽燧", "tripo_architecture",
  9.0, 5.5, 2.4, 15000, "gate", 0.9, EARTH, "ruined post-station gateway",
  "The ruined gateway of a Han-dynasty Silk Road relay post station: two massive free-standing gate piers of sand-yellow "
  "rammed earth in broad horizontal courses with thin darker khaki reed layers every half metre, sand "
  "drifted against the feet of both piers. The LEFT pier (in the FRONT view) is intact: a "
  "slender 1.8m wide, 2.4m deep, 5.2m tall, flat top. The RIGHT pier has collapsed to a ragged stepped top only 3.6m tall. Between them a "
  "WIDE clear walk-through opening 4m wide, more than twice the tall pier's width and three quarters of the tall pier's height. One thick squared grey-brown timber "
  "lintel beam lies ON TOP of the tall left pier's flat top, "
  "slopes gently down to the right across the opening and rests on the broken top of the short right pier; just beyond the "
  "right pier the beam is snapped and its splintered outer piece drops steeply down the outside of the right pier, its broken "
  "end stuck in the sand drift. One faded vermilion band on the beam. Nothing hangs into the opening "
  "below 3.4m. BACK view: mirrored, tall pier on the image-right. LEFT side view: the short pier and hanging beam piece "
  "nearest, the tall pier behind. RIGHT side view: the tall pier nearest. PROPORTIONS: FRONT and BACK about 1.65 times as wide as tall; side views about 0.5 times as wide as tall."),
 ("SM_Tripo_DesertLowRockA", "风蚀卧石·长", "半身掩体：低长的赭红砂岩卧石，钝头尖尾流线形", "tripo_prop",
  3.6, 1.0, 1.6, 6000, "cover", 0.9, ROCK, "long low wind-carved boulder",
  "A low, long wind-carved ochre-red sandstone boulder lying on the ground, streamlined by the desert wind like a stone whale "
  "back: a blunt rounded head at one end and a long tapering tail at the other. The top is broad and nearly flat; along both "
  "long sides run two or three chunky horizontal wind-cut grooves following the rock strata, paler sand-yellow bands between "
  "darker ochre-red layers. The base sinks into a low skirt of drifted sand wrapping all around it. FRONT view: the long side, "
  "blunt head on the image-LEFT, tail tapering to the image-RIGHT, about 3.6 times as wide as tall. BACK view: the other long "
  "side, head on the image-RIGHT. LEFT side view: the tapered tail end, a low rounded hump about 1.6 times as wide as tall. "
  "RIGHT side view: the blunt head end, broader and rounder. One solid low cover rock, no loose pebbles."),
 ("SM_Tripo_DesertLowRockB", "风蚀卧石·块", "半身掩体：敦实的蘑菇形砂岩块，底部风蚀收腰，顶面宽平", "tripo_prop",
  2.2, 1.2, 1.8, 6000, "cover", 0.9, ROCK, "squat mushroom-shaped rock",
  "A sturdy wind-eroded ochre-red sandstone block shaped a little like a mushroom: a broad thick cap with a wide flat top and "
  "gently rounded edges, sitting on a narrower waist that the sand-laden wind has undercut near the ground, so the cap "
  "overhangs the waist by about 0.3m on every side; the waist stands in a low mound of drifted sand. Horizontal strata bands of "
  "ochre-red and paler sand-yellow run around it, one chunky wind groove under the lip of the cap. Slightly asymmetric: one "
  "side of the cap a little lower and rounder than the other. FRONT and BACK views about 1.8 times as wide as tall; LEFT and "
  "RIGHT views about 1.5 times as wide as tall. One solid compact cover rock, no loose pebbles."),
 ("SM_Tripo_DesertCamelSkeleton", "半埋驼骨", "近景叙事件：驼队残骸 / 倒毙驼队旁，侧卧半埋的骆驼骨架", "tripo_prop",
  3.2, 1.0, 1.6, 8000, "dressing", 0.85, BONE, "half-buried camel skeleton",
  "The skeleton of a dead camel lying on its side, half buried in a low smooth drift of sand. The backbone lies along the sand "
  "at the back as one chunky ridge of blocky vertebrae; from it a row of seven thick curved ribs arches up and over toward the "
  "front like big curved bars, each rib as thick as a forearm with wide gaps of sand between them. The long neck of thick "
  "vertebrae curves down and forward from the ribcage onto the sand, ending in one large chunky camel skull lying on its side "
  "with an empty eye socket and a long jaw. At the rear end a broad pelvis bone and one thick leg bone half sunk in the sand. "
  "The sand mound base is low, smooth and sand-yellow, spreading a little beyond the bones. FRONT view: the long side, skull at "
  "the image-LEFT end, pelvis at the image-RIGHT, about 3.2 times as wide as tall. BACK view: the other side, skull on the "
  "image-RIGHT. LEFT side view: from the pelvis end, the rib arches overlapping. RIGHT side view: from the skull end, the skull "
  "in front of the ribcage. No thin or tiny bones, no scattered loose bones."),
 ("SM_Tripo_DesertDeadPoplar", "胡杨枯木", "1-1 干河床两岸：河干了，胡杨死了也不倒", "tripo_prop",
  4.5, 5.5, 4.0, 12000, "dressing", 0.9, WOOD, "dead desert poplar tree",
  "A dead desert poplar tree (Populus euphratica) that died standing when the river dried up: a massive short trunk about 1m "
  "thick, twisted in a slow spiral, with a few deep chunky vertical cracks and one large split, the bark gone so the wood shows "
  "weathered silver-grey with warm grey-brown streaks. At about 2.5m the trunk forks into four thick crooked limbs that reach "
  "out in different directions, each ending in a blunt broken-off stump. NO leaves, NO small branches, NO twigs: only the trunk "
  "and four thick limbs. The thick roots grip a small rounded sand dune about 1m high at the base, two or three fat roots "
  "exposed on the dune surface. FRONT view: limbs spreading to both sides, about 0.8 times as wide as tall; the four views are "
  "clearly different and every limb keeps its direction in all four views. Bold chunky shapes."),
 # 2026-11-27 构成 / 特效那一步补的两件（用户：「改用tripo的地方就用tripo」）
 ("SM_Tripo_DesertWhiteStupa", "白色覆钵塔", "1-2 ③ 塔尖广场的地标：立在 10 m 塔座上的白色覆钵塔（替换暗色的半埋层塔）", "tripo_architecture",
  16.6, 19.8, 16.6, 16000, "landmark", 0.9, STUPA_COLORS, "whitewashed bell-shaped stupa",
  "A Silk Road Buddhist stupa of the inverted-bowl type: a square two-step plinth with chunky mouldings, on it a round drum, "
  "then one big plain bell-shaped dome swelling out wider than the drum, then a small square box on the dome top, then a tall "
  "tapering spire of thirteen thick stacked rings, a wide flat parasol disc and a short finial. The dome and plinth are "
  "whitewashed lime plaster, chalky warm white, with large worn patches where ochre mud brick shows through, especially low "
  "on the plinth; a drift of sand-yellow sand piled against two sides of the plinth. Spire rings dull bronze-gold, parasol "
  "disc dull bronze. One faded vermilion band around the drum. Overall proportion: about 0.85 times as wide as tall, the "
  "dome about 0.6 of the total width, the spire about 0.4 of the total height. Perfectly symmetric about the vertical axis, "
  "so all four views are the same shape; only the worn patches and the sand drift differ. Bold simple volumes, no tiny "
  "niches, no carved figures."),
 ("SM_Tripo_DesertTimberGate", "驿站木门框", "1-1 出生点的门框（照玩家视角构图概念图：褪色朱红的木门框，替换旧的黑石门和夯土残门）", "tripo_architecture",
  9.6, 6.8, 1.8, 14000, "gate", 0.9, GATE_COLORS, "ruined timber post-station gateway",
  "The free-standing timber gateway of a Han-dynasty Silk Road relay post station, standing alone over a desert road: two "
  "massive square timber posts about 0.9m thick and 6m tall, their faded vermilion lacquer worn through in long vertical "
  "streaks to grey-brown wood, each post standing on a squat dressed grey stone plinth 0.9m tall and 1.5m wide. Across the "
  "top a heavy double lintel 9.6m long: a thick upper beam, a thinner lower beam, and between them a row of five square "
  "wooden blocks. Under the lower beam, where it meets each post, one carved cloud-shaped corner bracket. The upper beam's "
  "left end sticks out 0.8m past the left post with a short round flagpole poking out sideways. A thick hemp cord with two "
  "golden tassels hangs from the lower beam down the inside of the right post. Clear opening between the posts 6.4m wide and "
  "5m tall. A little drifted sand around both plinths. FRONT and BACK views: the full gateway, about 1.4 times as wide as "
  "tall; LEFT and RIGHT side views: one post seen end-on, narrow, the lintel depth 1.8m. Chunky simple timber, no roof, "
  "no doors, no hanging banner, no signboard."),
 ("SM_Tripo_DesertCaravanTent", "驼队帐篷", "1-1 ④ 驼队残骸营地：被沙暴撕破、一角塌下的驼队毡帐（全身掩体）", "tripo_prop",
  4.6, 2.8, 3.8, 9000, "dressing", 0.95, TENT_COLORS, "torn caravan felt tent",
  "A Silk Road caravan camp tent left behind after a sandstorm: a ridge tent of thick patched felt and canvas stretched over "
  "a frame of rough grey-brown timber poles, one tall forked pole at each end and a ridge pole between them. The left half "
  "still stands; the right end pole has snapped so that corner of the roof sags down to the sand, and one big torn flap of "
  "felt hangs loose. The front entrance flap is tied open, showing a dark empty inside. Thick hemp guy ropes run from the "
  "roof edges to wooden stakes in the sand; a low drift of sand-yellow sand has piled against the back and the windward side. "
  "Cloth colours: khaki-brown felt with a few lighter beige canvas patches and one faded indigo-blue striped band near the "
  "ridge. FRONT view: the long side with the open entrance, about 1.6 times as wide as tall. BACK view: the other long side "
  "with the sand drift. LEFT and RIGHT views: the gable ends, the left end standing, the right end sagging. Thick simplified "
  "folds, no fine wrinkles, no tiny ropes or knots."),
]
BY_ID = {k[0]: k for k in KIT}


def prompt(k, extra: str = "") -> str:
    aid, _, _, _, w, h, d, *_rest = k
    palette, name, brief = k[10], k[11], k[12]
    head = (extra.strip() + "\n\n") if extra.strip() else ""
    return (f"{head}{ROW}\n\n{STYLE.format(palette=palette)}\n\n"
            f"OBJECT, {name} ({w:g}m wide x {h:g}m tall x {d:g}m deep): {brief}")


def registry_block() -> str:
    out = ["", "# ───────────── 第一章重建件（2026-11-22，1-1 / 1-2 场景重搭）：OpenAI 四视图 → Tripo Studio P2.0 智能网格 + 纹理（去光、4K） ─────────────",
           "# 定义与提示词：art/pipeline/tripo_studio/ch1_rebuild_kit.py；记录见 docs/art/ch1-rebuild-kit.md。", ""]
    for k in KIT:
        aid, cn, use, cls, w, h, d, faces, role, rough, *_ = k
        name = aid.replace("SM_Tripo_Desert", "")
        out += [f"[assets.{aid}]",
                f'display = "{cn}（{use}）"',
                'kind = "static"',
                f'class = "{cls}"',
                'source_provider = "tripo"',
                'style_theme = "silkroad"',
                f'blockout = {{ source = "scene", id = "desert.silkroad.{name[0].lower() + name[1:]}" }}',
                'reference_mode = "bounds_only"',
                f"reference_dimensions = [{w:g}, {h:g}, {d:g}]",
                f"lod_tris = [{faces}]",
                f'architecture_role = "{role}"',
                'keep_glow = "none"',
                f"material = {{ roughness = {rough}, metallic = 0.0 }}",
                f'brief = """{k[12]}"""', ""]
    return "\n".join(out)


def concept(aid: str, extra: str, rnd: int) -> None:
    sys.path.insert(0, str(ROOT / "art" / "pipeline"))
    for line in (ROOT / "art" / "pipeline" / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENAI_API_KEY="):
            os.environ["OPENAI_API_KEY"] = line.split("=", 1)[1].strip().strip('"')
    os.environ["ART_CONCEPT_PROVIDER"] = "openai"
    from lib import openai_image
    p = prompt(BY_ID[aid], extra)
    assert len(p) < 2500, len(p)
    out = HERE / "sheets_raw"; out.mkdir(exist_ok=True)
    (HERE / "prompts").mkdir(exist_ok=True)
    (HERE / "prompts" / f"{aid}_r{rnd}.txt").write_text(p, encoding="utf-8")
    png, info = openai_image.generate(p, model=MODEL, size=SIZE, quality="high")
    (out / f"{aid}_r{rnd}.png").write_bytes(png)
    (out / f"{aid}_r{rnd}.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(aid, rnd, len(p), "chars", info.get("seconds"), "s", info.get("request_id"))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1]
    if cmd == "prompts":
        (HERE / "prompts").mkdir(exist_ok=True)
        for k in KIT:
            p = prompt(k)
            (HERE / "prompts" / f"{k[0]}.txt").write_text(p, encoding="utf-8")
            print(k[0], len(p))
    elif cmd == "registry":
        print(registry_block())
    elif cmd == "concept":
        a = sys.argv[2:]
        extra = a[a.index("--extra") + 1] if "--extra" in a else ""
        rnd = int(a[a.index("--round") + 1]) if "--round" in a else 1
        concept(a[0], extra, rnd)
