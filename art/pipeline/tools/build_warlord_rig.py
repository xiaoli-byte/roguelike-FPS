"""熔心魔将的语义人形骨架（creature_rigs/SK_Boss_Warlord.json）。

    python art/pipeline/tools/build_warlord_rig.py        # 写 JSON
    python art/pipeline/build_tripo_creature.py SK_Boss_Warlord [--publish]

2026-11-07 v006 重建：用户选定的 v006 方案 4（重甲剑士）在 Tripo 新账号生成的本体
art/source/_tripo_inbox/20261106T171133_SK_Boss_Warlord.glb（48,694 三角面，A 字空手、手掌张开，4K 底色 / 法线 / 金属粗糙度）。
骨骼名和人形层级沿用 11-01 版（warlord_anims_humanoid.py 的 33 段动作、Unity 侧招式 / 事件直接复用），坐标全部按新网格实测
（米制、发布到 4.2 m 之后：front = -Y，生物的左 = +X，up = +Z；左右对称，只量左侧再镜像）：
  · 躯干中线在 y ≈ -0.10 ~ -0.15（不是 0）：胸甲前凸、背后挂战旗；
  · 手臂是小幅 A 字：肩 (±0.70, 3.17) → 肘 (±0.93, 2.67) → 腕 (±1.175, 2.17)，手掌朝内、四指朝外下，四指被 Tripo 熔成一块（按指缝 y 位置分骨），拇指独立；
  · 腿外撇：髋 (±0.29, 1.90) → 膝 (±0.59, 1.08) → 踝 (±0.72, 0.38)，脚尖外撇约 17°；
  · 布料四块：前战旗（腰扣下，z 2.35 → 0.82）、后战旗（z 2.36 → 0.76）、两侧红披（从肩后的缨穗结垂到 z 0.8，往外后方张开）、
    胸前两条缨穗（肩甲内侧，z 3.1 → 2.6）。
弹簧链：skirt_F1..3 前战旗、skirt_B1..3 后战旗、skirt_L/R1..2 侧披、tassel_L/R1..2 胸前缨穗（Unity CreatureRigBuilder 按名字归 cloth 族）。
  侧披和缨穗是从肩上垂下来的，链根改挂 chest（11-01 版挂 hips：上身一前倾，挂在肩上的布就和身体脱开）；名字不变，不 K 帧，人形骨和 K 帧骨层级不变。
权重：骨段距离 + 限制盒 + 颜色偏置（红布 vs 甲：布链只拿红布，腿 / 髋只拿甲）+ 甲裙从腰带往下渐入大腿 + 靴底归脚 + 角盔整块归头 + 肩甲整块归肩甲骨。
挂点：socket_sword = 右拳握心（五指收拳后剑柄穿过的位置，大剑资产原点就是右拳握心），socket_sword_tip = 剑尖（握心正下方 SWORD_REACH），
socket_core = 胸口裂开的铜护心镜中心（弱点），socket_helm = 角盔盔脊，socket_pauldron_L/R = 兽首肩甲顶。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "art/pipeline/creature_rigs/SK_Boss_Warlord.json"
SOURCE = "art/source/_tripo_inbox/20261106T171133_SK_Boss_Warlord.glb"
# 大剑：握心（右拳中心，剑格上沿往剑首 0.14 m）到剑尖的距离 = registry 的 -reference_floor
SWORD_REACH = 2.65
# 右拳握心（A 字绑定姿势下，手掌朝内、四指朝外下；五指按 warlord_anims_humanoid 的 FIST 收拳后剑柄穿过的点），按收拳审核图实测
GRIP_R = (-1.178, -0.208, 1.94)

bones = {}


def bone(name, head, tail, parent, deform=True):
    bones[name] = {"head": [round(v, 4) for v in head], "tail": [round(v, 4) for v in tail], "parent": parent}
    if not deform:
        bones[name]["deform"] = False


bone("root", (0, 0, 0), (0, 0, 0.3), None, False)
bone("hips", (0, -0.06, 1.92), (0, -0.09, 2.25), "root")
bone("spine", (0, -0.09, 2.25), (0, -0.13, 2.62), "hips")
bone("chest", (0, -0.13, 2.62), (0, -0.11, 3.32), "spine")
bone("neck", (0, -0.11, 3.32), (0, -0.11, 3.47), "chest")
bone("head", (0, -0.11, 3.47), (0, -0.13, 3.98), "neck")

FINGERS = {
    #          指根（掌指关节）           中节                    指尖
    "thumb": ((1.170, -0.250, 2.120), (1.125, -0.360, 2.020), (1.115, -0.392, 1.900)),
    "index": ((1.272, -0.310, 2.005), (1.330, -0.306, 1.893), (1.392, -0.302, 1.785)),
    "middle": ((1.285, -0.248, 1.995), (1.347, -0.244, 1.886), (1.410, -0.240, 1.778)),
    "ring": ((1.280, -0.183, 2.000), (1.338, -0.177, 1.898), (1.400, -0.171, 1.797)),
    "pinky": ((1.268, -0.106, 2.012), (1.315, -0.106, 1.920), (1.362, -0.107, 1.828)),
}

for side, sign in (("L", 1), ("R", -1)):
    def p(x, y, z):
        return (sign * x, y, z)

    bone(f"shoulder_{side}", p(0.16, -0.10, 3.22), p(0.70, -0.03, 3.17), "chest")
    bone(f"arm_{side}", p(0.70, -0.03, 3.17), p(0.93, -0.04, 2.67), f"shoulder_{side}")
    bone(f"forearm_{side}", p(0.93, -0.04, 2.67), p(1.175, -0.155, 2.17), f"arm_{side}")
    bone(f"hand_{side}", p(1.175, -0.155, 2.17), p(1.285, -0.245, 1.995), f"forearm_{side}")
    # 肩甲骨的根在肩关节（动作脚本让它跟上臂摆一部分，绕关节转）
    bone(f"pauldron_{side}", p(0.70, -0.03, 3.17), p(0.88, -0.05, 3.48), f"shoulder_{side}")
    bone(f"socket_pauldron_{side}", p(0.82, -0.05, 3.58), p(0.82, -0.25, 3.58), f"pauldron_{side}", False)
    for finger, (h, m, t) in FINGERS.items():
        bone(f"{finger}_1_{side}", p(*h), p(*m), f"hand_{side}")
        bone(f"{finger}_2_{side}", p(*m), p(*t), f"{finger}_1_{side}")

    bone(f"thigh_{side}", p(0.29, -0.05, 1.90), p(0.59, -0.08, 1.08), "hips")
    bone(f"shin_{side}", p(0.59, -0.08, 1.08), p(0.72, -0.04, 0.38), f"thigh_{side}")
    bone(f"foot_{side}", p(0.72, -0.04, 0.38), p(0.83, -0.40, 0.10), f"shin_{side}")
    bone(f"toe_{side}", p(0.83, -0.40, 0.10), p(0.90, -0.64, 0.06), f"foot_{side}")

    # 侧披：肩后缨穗结 → 往外后方张开垂到小腿
    bone(f"skirt_{side}1", p(0.47, 0.20, 3.05), p(0.60, 0.28, 2.00), "chest")
    bone(f"skirt_{side}2", p(0.60, 0.28, 2.00), p(0.97, 0.38, 0.82), f"skirt_{side}1")
    # 胸前缨穗：肩甲内侧的铜环垂下
    bone(f"tassel_{side}1", p(0.475, -0.36, 3.08), p(0.47, -0.355, 2.86), "chest")
    bone(f"tassel_{side}2", p(0.47, -0.355, 2.86), p(0.47, -0.35, 2.62), f"tassel_{side}1")

for name, pts in (("skirt_F", [(0, -0.45, 2.33), (0, -0.50, 1.85), (0, -0.54, 1.35), (0, -0.58, 0.82)]),
                  ("skirt_B", [(0, 0.18, 2.33), (0, 0.34, 1.85), (0, 0.49, 1.35), (0, 0.50, 0.78)])):
    for i in range(1, 4):
        bone(f"{name}{i}", pts[i - 1], pts[i], "hips" if i == 1 else f"{name}{i - 1}")

# 角根红缨（设定图 HEAD CLOSE-UP：双角根部各垂一条红缨；Tripo 件里没有）：复制左肩胸前那条缨穗，缩到 2/3 挂在角根下面（长 0.32 m），
# 一条两节的短链挂 head（tassel_ 开头，Unity 归 cloth 族）
HELM_TASSEL = {"L": (0.34, -0.21, 3.67), "R": (-0.34, -0.21, 3.67)}
HELM_TASSEL_LEN = 0.32
for side, (x, y, z) in HELM_TASSEL.items():
    bone(f"tassel_H{side}1", (x, y, z - 0.02), (x, y, z - 0.02 - HELM_TASSEL_LEN / 2), "head")
    bone(f"tassel_H{side}2", (x, y, z - 0.02 - HELM_TASSEL_LEN / 2), (x, y, z - HELM_TASSEL_LEN), f"tassel_H{side}1")

bone("socket_core", (0, -0.52, 3.0), (0, -0.72, 3.0), "chest", False)
bone("socket_helm", (0, -0.16, 3.92), (0, -0.36, 3.92), "head", False)
gx, gy, gz = GRIP_R
bone("socket_sword", (gx, gy, gz), (gx, gy - 0.2, gz), "hand_R", False)
bone("socket_sword_tip", (gx, gy, gz - SWORD_REACH), (gx, gy, gz - SWORD_REACH - 0.2), "socket_sword", False)


def mirror_box(box):
    (x0, y0, z0), (x1, y1, z1) = box
    return [[-x1, y0, z0], [-x0, y1, z1]]


def lr(names):
    return [n.replace("{s}", s) for n in names for s in "LR"]


limits = [
    # 头：角盔从 3.42 起（护颈圈归颈 / 胸）
    {"bones": ["head"], "box": [[-0.7, -0.7, 3.42], [0.7, 0.7, 4.5]]},
    {"bones": ["neck"], "box": [[-0.45, -0.6, 3.2], [0.45, 0.5, 3.75]]},
]
for side, sign in (("L", 1), ("R", -1)):
    def box(lo, hi):
        return [list(lo), list(hi)] if sign > 0 else mirror_box((lo, hi))
    limits += [
        {"bones": [f"shoulder_{side}"], "box": box((0.05, -0.7, 2.75), (1.2, 0.6, 3.75))},
        {"bones": [f"pauldron_{side}"], "box": box((0.42, -0.6, 2.98), (1.2, 0.6, 3.8))},
        {"bones": [f"arm_{side}"], "box": box((0.52, -0.5, 2.45), (1.2, 0.45, 3.4))},
        {"bones": [f"forearm_{side}"], "box": box((0.7, -0.5, 1.95), (1.4, 0.45, 2.95))},
        {"bones": [f"hand_{side}"], "box": box((1.0, -0.55, 1.7), (1.55, 0.2, 2.35))},
        {"bones": [f"{f}_{k}_{side}" for f in FINGERS for k in (1, 2)], "box": box((1.04, -0.5, 1.7), (1.55, 0.05, 2.16))},
        # 腿不过中线（两腿内侧不互相拿权重）
        {"bones": [f"thigh_{side}"], "box": box((-0.02, -0.75, 0.75), (1.1, 0.7, 2.3))},
        {"bones": [f"shin_{side}", f"foot_{side}", f"toe_{side}"], "box": box((0.15, -0.9, -0.1), (1.2, 0.5, 1.4))},
        {"bones": [f"skirt_{side}1", f"skirt_{side}2"], "box": box((0.36, 0.06, 0.6), (1.25, 0.8, 3.15))},
        {"bones": [f"tassel_{side}1", f"tassel_{side}2"], "box": box((0.36, -0.46, 2.56), (0.59, -0.25, 3.11))},
    ]
limits += [
    {"bones": ["skirt_F1", "skirt_F2", "skirt_F3"], "box": [[-0.45, -0.8, 0.5], [0.45, -0.28, 2.40]]},
    {"bones": ["skirt_B1", "skirt_B2", "skirt_B3"], "box": [[-0.5, 0.08, 0.4], [0.5, 0.85, 2.42]]},
]

config = {
    "doc": ("熔心魔将（3-3 领主）2026-11-07 v006 重建：用户选定的 v006 方案 4 在 Tripo（H3.1）生成的本体，48,694 三角面、A 字空手。"
            "语义人形骨架 + 五指两节 + 肩甲 + 战旗 / 侧披 / 缨穗弹簧链；坐标按发布到 4.2 m 后的米制（front = -Y，生物左 = +X，up = +Z）。"
            "由 art/pipeline/tools/build_warlord_rig.py 生成，别手改。大剑独立挂件，socket_sword 是右拳握心，socket_core 是胸口护心镜（弱点）。"),
    "source": SOURCE,
    "height_m": 4.2,
    "weights": "segments",
    "bones": bones,
    "limits": limits,
    # 甲裙：腰带一圈跟髋，往下 0.35 m 渐入大腿（抬腿时甲裙跟腿走、不穿腿，腰带不被扯开）
    "soft_limits": [
        {"bones": ["thigh_L", "thigh_R"], "box": [[-2, -2, -1], [2, 2, 2.2]], "soft": [0, 0, 0.35], "to": "hips"},
    ],
    # 红布 vs 甲：Tripo 把布和甲熔成一张网格，单靠距离，贴着战旗的甲裙会被战旗链拿走、侧披下摆会被大腿拿走
    "color_bias": {"k": 24, "sat_split": 0.62, "ramp": [0.2, 0.8], "floor": 0.02,
                   "bones": [{"bones": ["hips", "spine"] + lr(["thigh_{s}", "shin_{s}"]), "class": "dark"},
                             {"bones": ["skirt_F1", "skirt_F2", "skirt_F3", "skirt_B1", "skirt_B2", "skirt_B3"]
                              + lr(["skirt_{s}1", "skirt_{s}2", "tassel_{s}1", "tassel_{s}2"]), "class": "cloth"}]},
    # 底色调色（2026-11-07，照设定图）：Tripo 把铜件画成了发白的米黄 / 浅褐（色相 0.05、饱和度 0.38、亮度 0.56），
    # 设定图是暖的古铜（色板第 4 格 #714C3F；画上的铜件色相 0.04–0.056、饱和度 0.62–0.74、亮度 0.3–0.68）：铜件饱和度 ×1.7、亮度 ×0.72
    # （中位 0.38 / 0.56 → 0.65 / 0.40）；甲身往色板第 1 格（#553D47）靠、压暗一点。只做逐像素的颜色映射，不模糊、不平滑。
    # 绯红（饱和度 0.7+）、熔岩橙（0.72+）、双角（0.63+）都在带外，不动。铜件调完饱和度 ≤ 0.70、亮度 ≤ 0.72，碰不到发光遮罩的认色
    # （熔岩缝 ≥ 0.78、最亮的芯亮度 ≥ 0.86），所以 T_Boss_Warlord_E 重烘也一样
    "recolor": [
        {"name": "铜件 → 古铜", "hue": [0.048, 0.03], "sat": [0.2, 0.58], "val": [0.12, 1.0], "soft": 0.025,
         "to_hue": 0.043, "hue_keep": 0.6, "sat_mul": 1.7, "sat_max": 0.7, "val_mul": 0.72},
        # 甲身在 CIE LCh 里调：明度 ×0.85、彩度 ×0.9，都软封顶在色板第 1 格自己的 L* 28.7 / C* 12.5（不比它亮、不比它艳），
        # 色相往它的 351° 拉一半（原来 337° 偏紫）——宁可偏暗铁色，也不更紫（用户 11-07 否过第三章「泛紫色、灰色」的贴图）
        {"name": "甲身 → 色板第 1 格暗紫灰", "hue": [0.87, 0.11], "sat": [0.0, 0.4], "val": [0.0, 0.62], "soft": 0.03,
         "lch": {"L_mul": 0.85, "L_max": 28.7, "C_mul": 0.9, "C_max": 12.5, "h_to": 351.0, "h_keep": 0.5}},
    ],
    # 角根红缨：复制左肩胸前缨穗（红色那部分）到两个角根下，右边镜像
    "copy_parts": [
        {"name": "helm_tassel", "box": [[0.36, -0.46, 2.6], [0.6, -0.25, 3.12]], "colour": "red",
         "scale": round(HELM_TASSEL_LEN / 0.48, 3), "to": [list(HELM_TASSEL["L"]), list(HELM_TASSEL["R"])], "mirror": [False, True],
         "weights": {"bones": [["tassel_HL1", "tassel_HL2"], ["tassel_HR1", "tassel_HR2"]], "root": "head", "root_fade": 0.04}},
    ],
    # 靴底贴地：0.15 m 以下整块归最近的脚骨
    "ground": [{"fade_z": [0.15, 0.32], "bones": ["foot_L", "foot_R", "toe_L", "toe_R"]}],
    "rigid": [
        # 角盔（含双角）整块跟头
        {"box": [[-0.36, -0.6, 3.56], [0.36, 0.6, 3.86]], "bone": "head"},
        {"box": [[-0.62, -0.6, 3.86], [0.62, 0.6, 4.4]], "bone": "head"},
        # 兽首肩甲整块跟肩甲骨（不随上臂扭）
        {"box": [[0.46, -0.48, 3.12], [1.12, 0.42, 3.75]], "bone": "pauldron_L"},
        {"box": [[-1.12, -0.48, 3.12], [-0.46, 0.42, 3.75]], "bone": "pauldron_R"},
    ],
}
OUT.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{OUT}: {len(bones)} bones")
