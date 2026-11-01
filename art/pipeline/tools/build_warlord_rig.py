"""Generate the semantic humanoid rig for the 2026-11-01 Tripo Molten Warlord."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "art/pipeline/creature_rigs/SK_Boss_Warlord.json"
bones = {}


def bone(name, head, tail, parent, deform=True):
    bones[name] = {"head": list(head), "tail": list(tail), "parent": parent}
    if not deform:
        bones[name]["deform"] = False


bone("root", (0, 0, 0), (0, 0, 0.3), None, False)
bone("hips", (0, 0, 1.95), (0, 0, 2.18), "root")
bone("spine", (0, 0, 2.18), (0, 0, 2.5), "hips")
bone("chest", (0, 0, 2.5), (0, 0, 2.9), "spine")
bone("neck", (0, 0, 2.95), (0, 0, 3.15), "chest")
bone("head", (0, 0, 3.15), (0, 0, 3.72), "neck")

for side, sign in (("L", 1), ("R", -1)):
    def p(x, y, z):
        return (sign * x, y, z)

    bone(f"shoulder_{side}", p(0.38, 0, 2.9), p(0.72, 0, 3.05), "chest")
    bone(f"arm_{side}", p(0.72, 0, 3.05), p(1.42, 0, 3.08), f"shoulder_{side}")
    bone(f"forearm_{side}", p(1.42, 0, 3.08), p(2.12, 0, 3.08), f"arm_{side}")
    bone(f"hand_{side}", p(2.12, 0, 3.08), p(2.43, 0, 3.08), f"forearm_{side}")
    bone(f"pauldron_{side}", p(0.65, 0, 3.12), p(1.08, 0, 3.35), f"shoulder_{side}")
    bone(f"socket_pauldron_{side}", p(0.85, 0, 3.35), p(0.85, -0.2, 3.35), f"pauldron_{side}", False)

    finger_data = {
        "thumb": (2.28, -0.16, 3.0),
        "index": (2.42, -0.1, 3.08),
        "middle": (2.43, 0, 3.08),
        "ring": (2.42, 0.08, 3.08),
        "pinky": (2.38, 0.16, 3.03),
    }
    for finger, (x, y, z) in finger_data.items():
        h = p(x, y, z)
        mid = p(x + 0.18, y, z)
        tip = p(x + 0.34, y, z)
        bone(f"{finger}_1_{side}", h, mid, f"hand_{side}")
        bone(f"{finger}_2_{side}", mid, tip, f"{finger}_1_{side}")

    bone(f"thigh_{side}", p(0.34, 0, 1.95), p(0.38, 0, 1.05), "hips")
    bone(f"shin_{side}", p(0.38, 0, 1.05), p(0.38, 0, 0.3), f"thigh_{side}")
    bone(f"foot_{side}", p(0.38, 0, 0.3), p(0.38, -0.18, 0.1), f"shin_{side}")
    bone(f"toe_{side}", p(0.38, -0.18, 0.1), p(0.38, -0.36, 0.05), f"foot_{side}")

    for cloth, x, y in (("skirt", 0.48, 0.02), ("tassel", 0.52, -0.12)):
        count = 2 if cloth == "tassel" else 2
        for i in range(1, count + 1):
            z0 = 2.05 - (i - 1) * 0.34
            bone(f"{cloth}_{side}{i}", p(x, y, z0), p(x, y, z0 - 0.34),
                 "hips" if i == 1 else f"{cloth}_{side}{i - 1}")

for name, y in (("skirt_F", -0.18), ("skirt_B", 0.18)):
    for i in range(1, 4):
        z0 = 2.05 - (i - 1) * 0.34
        bone(f"{name}{i}", (0, y, z0), (0, y, z0 - 0.34), "hips" if i == 1 else f"{name}{i - 1}")

bone("socket_core", (0, -0.16, 2.65), (0, -0.36, 2.65), "chest", False)
bone("socket_helm", (0, 0, 3.65), (0, -0.2, 3.65), "head", False)
bone("socket_sword", (-2.12, 0, 3.08), (-2.12, -0.2, 3.08), "hand_R", False)
bone("socket_sword_tip", (-2.12, 0, 0.53), (-2.12, 0, 0.33), "socket_sword", False)

config = {
    "doc": "熔心魔将（3-3 领主）2026-11-01 用户在 Tripo 生成的本体：52,860 三角面、T 字姿势、1 张 4K 底色。语义人形骨架 + 五指 + 肩甲 + 战裙 / 缨穗弹簧链；坐标按发布到 4.2 m 后的米制（front = -Y，生物左 = +X，up = +Z）。大剑独立挂件，socket_sword 是右手握点，socket_core 是胸口弱点。",
    "source": "art/source/_tripo_inbox/20261101T130739_SK_Boss_Warlord.glb",
    "height_m": 4.2,
    "weights": "segments",
    "bones": bones,
}
OUT.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{OUT}: {len(bones)} bones")
