"""熔心魔将 · 新模型（人形骨架）的手 K 构建器：Blender 无头脚本，一次生成全部片段（剑士化 v2，docs/art/vfx/warlord.md 第 13 章）。

    blender -b --factory-startup --python art/source/characters/SK_Boss_Warlord/anim/warlord_anims_humanoid.py -- [--out <目录>] [--dry]
        [--glb <本体 GLB>] [--sword <大剑 GLB>] [--review <目录> [--only a,b]]

状态：结构和关键姿势先写好（2026-11-01），**新网格还没生成**——骨骼坐标等 Tripo 网格出来、模型路发布 public/assets/characters/SK_Boss_Warlord.glb 后
按实测微调（REST_RELAX、L_GRIP、FIST、脚掌落点）。模型落地之前跑它会因为缺骨直接退出（不会拿旧部件骨架出一套错的片段）；
落地后它取代 warlord_anims.py（旧部件骨架的构建器），产出位置一样：
  unity/Assets/Art/Characters/SK_Boss_Warlord/Anim/Keyframed/<状态>.fbx   一个状态一个文件（文件名 = Animator 状态名，Unity 按本体 Avatar 导成人形肌肉曲线，
                                                                           socket_sword 的旋转是非人形骨的曲线，照样保留）
  unity/Assets/Art/Characters/SK_Boss_Warlord/Anim/SK_Boss_Warlord.events.json   事件叠加表（片段表里的事件，帧位置和旧版一样）
  --out <目录>  试跑时写到别处（不碰 Unity 工程）；--dry  只解算姿势、检查骨骼，不导出
  --glb / --sword  用还没发布的构建（默认 public/assets 里发布的本体 / 大剑）
  --review <目录>  不导出：每段的关键姿势带模型和大剑渲正面 + 俯视小图、每段一张拼图，并量每个关键姿势的拉伸 p99、脚底高度、
                   左拳到剑柄的距离、剑尖高度，写 review.json（看姿势、查穿模用，不入库）

2026-11-07 v006 重建（用户选定的方案 4 重甲剑士；骨骼名 / 人形层级不变，坐标按新网格实测，见 art/pipeline/tools/build_warlord_rig.py）。
这一轮只改「怎么握、怎么跟」，招式设计（warlord_poses.py 的姿势和帧位置）一个没动：
  · 握剑：剑柄穿过两只拳头。socket_sword 是右拳握心（不是手腕），相对右手的朝向固定（剑首方向 = 手掌的食指→小指方向，刃朝指节），
    每个姿势按 sword / edge 把整只右手转过去（两面刃取离当前手腕近的那面）；转动里绕小臂轴的那一份按 FOREARM_TWIST 分给小臂
    （护臂是整块，手腕不拧麻花）。左手同理：左拳握心放在剑柄上（右拳往剑首 L_GRIP 米），指节和右手同一侧，再反解左手腕给两骨 IK。
    以前（11-01）剑挂在手腕上、手只分担 40% 的转动，剑柄常常横穿拳头；
  · 五指：绕各自「指向 × 掌心法线」的轴往掌心收（以前绕世界 X 轴，A 字绑定下有一只手是往手背翻的）；
  · 肩甲：兽首肩甲骨的根在肩关节，跟上臂摆动的 PAULDRON_FOLLOW（不跟的话举手时上臂整个插进肩甲里）。

骨架约定（模型路 2026-11-01；照旱魃：语义人形命名，Unity 里 Humanoid；Blender 坐标 front = −Y，生物的左 = +X，up = +Z）：
  root（不变形）→ hips → spine → chest → neck → head；shoulder_L/R → arm_L/R → forearm_L/R → hand_L/R，五指各两节 {thumb,index,middle,ring,pinky}_{1,2}_{L,R}；
  thigh_L/R → shin_L/R → foot_L/R → toe_L/R；肩甲 pauldron_L/R（变形骨，挂在 shoulder 下，不 K 就跟着锁骨走）；
  弹簧链（不 K）：skirt_F1..3 / skirt_B1..3 / skirt_L1..2 / skirt_R1..2、tassel_*（运行时 CreatureRigBuilder 归到 cloth 族）。
  挂点（不变形、绑定矩阵单位阵）：socket_sword（右手掌心握点，挂在 hand_R 下；绑定姿势下大剑按单位变换挂上去就是剑尖朝下、剑面朝前，剑资产原点 = 右手握点、剑身朝 −Y）、
  socket_sword_tip（剑尖，socket_sword 下）、socket_core（胸口地火之心 = 弱点，chest 下）、socket_helm（角盔盔脊，head 下）、socket_pauldron_L/R（肩甲顶，狂怒火舌）。

姿势：和旧构建器共用 warlord_poses.py 的姿势库与片段表（角色坐标，骨架无关）。这里的解释：
  drop / fwd / yaw → hips 平移 / 绕竖轴转（脚掌落点跟着 yaw 转）；pitch / twist / roll → spine 40% + chest 60%；head (俯仰, 转头) → neck 30% + head 70%；
  grip → 右手 IK（hand_R 头到两肩中点的偏移处，肘朝外下）；arm_R / fore_R / arm_L / fore_L → 直接给方向；
  sword / edge → 剑身方向 / 刃朝向：整只右手按握法转过去，socket_sword 相对右手固定（v006 起，见下）；
  grip_L → 左手 IK 到剑柄上（握点往剑首方向 L_GRIP 米）；握剑时两手五指收拳；feet → 两骨 IK 踩回地面、脚掌放平；air / legs → 悬空腿；
  cape → 忽略（战裙是弹簧链）。
用户概念图（art/source/characters/_design/inferno/inferno_boss_warlord/user_concept_molten_warlord.webp）的三张 ACTION POSES 是招牌招式的关键姿势参考：
  ① 低身横抡、剑在身前拖出熔岩月牙（横扫 SWEEP_HIT / 收刀横斩 / 横剑气）；② 举剑过头、剑光大弧（下劈 C_COCK → C_HIT、回旋 spin）；
  ③ 大剑砸地、熔岩炸起（下劈入地 C_HIT、跃击落地 LAND_HIT、插剑 PLANT_HIT）。网格出来后按这三张修关键姿势的剪影。
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from warlord_poses import BASE, CLIPS, P  # noqa: E402

ROOT = Path(__file__).resolve().parents[5]
GLB = ROOT / "public/assets/characters/SK_Boss_Warlord.glb"
SWORD_GLB = ROOT / "public/assets/attachments/SM_BossWeapon_Greatsword.glb"
UNITY = ROOT / "unity/Assets/Art/Characters/SK_Boss_Warlord/Anim"
FPS = 30
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

FINGERS = ("thumb", "index", "middle", "ring", "pinky")
REQUIRED = (["root", "hips", "spine", "chest", "neck", "head", "socket_sword", "socket_sword_tip", "socket_core", "socket_helm"]
            + [f"{b}_{s}" for b in ("shoulder", "arm", "forearm", "hand", "thigh", "shin", "foot", "pauldron") for s in "LR"])
# 每一个关键帧都 K 的骨（弹簧链、肩甲、其余挂点不 K）
KEYED = (["hips", "spine", "chest", "neck", "head", "socket_sword"]
         + [f"{b}_{s}" for b in ("arm", "forearm", "hand", "thigh", "shin", "foot", "pauldron") for s in "LR"]
         + [f"{f}_{k}_{s}" for f in FINGERS for k in (1, 2) for s in "LR"])

# ── 网格出来后实测微调的量 ──
# 待机放松的手臂方向（角色坐标；静止姿势多半是 T / A 字，姿势没写到的那只手先垂下来）
REST_RELAX = {"arm_R": (0.28, 0.05, -0.96), "forearm_R": (0.2, 0.25, -0.95), "arm_L": (-0.28, 0.05, -0.96), "forearm_L": (-0.2, 0.25, -0.95)}
# 左拳握心：沿剑柄从右拳握心往剑首方向（米）。v006 大剑：右拳握心在剑格上沿往剑首 0.16 m，到环首还有 0.55 m，拳头宽约 0.26 m
L_GRIP = 0.27
# 手的转动里绕小臂轴的那一份分给小臂的比例（护臂是整块，跟着转；手腕只剩弯折）
FOREARM_TWIST = 0.6
# 肩甲跟上臂摆动的比例（肩甲骨的根在肩关节）
PAULDRON_FOLLOW = 0.45
# 握剑的五指弯曲（度：第 1 / 2 节；拇指另给）、放松的手。v006 剑柄直径约 0.14 m，拳头不攥死（攥死手指会插进剑柄）
FIST, FIST_THUMB, RELAXED = (42, 52), (25, 30), (16, 20)


def D(right: float, fwd: float, up: float) -> Vector:
    """角色坐标 → Blender 方向（角色朝 -Y、右手 = -X）"""
    return Vector((-right, -fwd, up)).normalized()


# ───────────── Blender ─────────────
def load_rig(glb: Path = GLB, keep_mesh: bool = False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    missing = [b for b in REQUIRED if not arm or b not in arm.pose.bones]
    if missing:
        print(f"WARLORD_HUMANOID 缺骨，退出（新模型还没发布？{glb} 仍是旧部件骨架时请用 warlord_anims.py）：{', '.join(missing[:12])}")
        sys.exit(2)
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if not (keep_mesh and o.name.endswith("_LOD0")):
            bpy.data.objects.remove(o)
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def reset(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def pb_(arm, name):
    return arm.pose.bones[name]


def rot_about_head(arm, bone: str, q: Quaternion):
    pb = pb_(arm, bone)
    m = pb.matrix.copy()
    head = m.translation.copy()
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ m
    if bone != "hips":
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def turn(arm, bone: str, axis: Vector, deg: float):
    if abs(deg) > 1e-4:
        rot_about_head(arm, bone, Quaternion(axis, math.radians(deg)))


def vec(arm, bone: str) -> Vector:
    pb = pb_(arm, bone)
    return pb.tail - pb.head


def aim(arm, bone: str, target: Vector, share: float = 1.0, limit: float = 180.0):
    v = vec(arm, bone)
    if v.length < 1e-6 or target.length < 1e-6:
        return
    q = v.normalized().rotation_difference(target.normalized())
    ang = min(q.angle * share, math.radians(limit))
    if ang > 1e-5:
        rot_about_head(arm, bone, Quaternion(q.axis, ang))


def blade(arm) -> Vector:
    """剑身方向（握点 → 剑尖）"""
    return pb_(arm, "socket_sword_tip").head - pb_(arm, "socket_sword").head


def frame(u: Vector, v: Vector) -> Matrix:
    """正交基（列）：u、v 去掉 u 分量、u × v"""
    a = u.normalized()
    b = v - a * v.dot(a)
    if b.length < 1e-6:
        b = a.orthogonal()
    b.normalize()
    return Matrix((a, b, a.cross(b))).transposed()


def set_world_rot(arm, bone: str, rot: Matrix):
    """骨头的朝向（骨架空间）设成 rot，根的位置不动"""
    pb = pb_(arm, bone)
    head = pb.matrix.translation.copy()
    pb.matrix = Matrix.Translation(head) @ rot.to_4x4()
    if bone != "hips":
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def rel(arm, bone: str, rest_m: Matrix) -> Matrix:
    """骨头此刻相对静止姿势的转动（骨架空间）"""
    return pb_(arm, bone).matrix.to_3x3() @ rest_m.inverted()


def place_hand(arm, rest, side: str, R: Matrix):
    """手转到「相对静止姿势转 R」：其中绕小臂轴的那一份先按 FOREARM_TWIST 分给小臂，再把手精确对上"""
    target = R @ rest.hand_m[side]
    delta = (target @ pb_(arm, f"hand_{side}").matrix.to_3x3().inverted()).to_quaternion()
    fa = pb_(arm, f"forearm_{side}")
    ax = (fa.tail - fa.head).normalized()
    pv = Vector((delta.x, delta.y, delta.z))
    tw = Quaternion((delta.w, *(ax * pv.dot(ax))))
    if tw.magnitude > 1e-6:
        tw.normalize()
        ang = tw.angle
        if ang > math.pi:
            ang -= 2 * math.pi
        if abs(ang) > 1e-4:
            rot_about_head(arm, f"forearm_{side}", Quaternion(tw.axis, ang * FOREARM_TWIST))
    set_world_rot(arm, f"hand_{side}", target)


def grip_rot(rest, side: str, b: Vector, knuckle: Vector) -> Matrix:
    """握剑的手相对静止姿势的转动：食指→小指方向 = 剑首方向（-b），指节朝 knuckle（去掉剑身分量）"""
    return frame(-b, knuckle) @ rest.grip_frame[side].transposed()


def hold_sword(arm, rest, b: Vector, e):
    """右手按剑身方向 b（和刃朝向 e，可无）整只转过去，socket_sword 相对右手是固定的握法；返回右手此刻的指节方向"""
    cur = rel(arm, "hand_R", rest.hand_m["R"]) @ rest.knuckle["R"]
    L = -b.normalized()
    want = e if e is not None else cur
    k = want - L * want.dot(L)
    if k.length < 1e-4:
        k = cur - L * cur.dot(L)
    k.normalize()
    if k.dot(cur) < 0:
        k = -k       # 两面刃：取离当前手腕近的那一面
    place_hand(arm, rest, "R", grip_rot(rest, "R", b, k))
    R = rel(arm, "hand_R", rest.hand_m["R"])
    set_world_rot(arm, "socket_sword", R @ rest.sock_S @ rest.sock_m)
    return R @ rest.knuckle["R"]


def follow_pauldrons(arm, rest):
    """肩甲跟上臂摆动的一部分（肩甲骨的根在肩关节，绕根转）"""
    for s in "LR":
        a0 = (rel(arm, f"shoulder_{s}", rest.shoulder_m[s]) @ rest.arm_dir[s]).normalized()
        a1 = vec(arm, f"arm_{s}").normalized()
        part = Quaternion().slerp(a0.rotation_difference(a1), PAULDRON_FOLLOW)
        if part.angle > 1e-4:
            rot_about_head(arm, f"pauldron_{s}", part)


def two_bone(arm, upper: str, lower: str, end: str, target: Vector, pole: Vector):
    """两骨 IK：end 的头（手腕 / 脚踝）放到 target，中间关节朝 pole"""
    a = pb_(arm, upper).head.copy()
    l1, l2 = pb_(arm, upper).bone.length, pb_(arm, lower).bone.length
    t = target - a
    d = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-3, t.length))
    u = t.normalized()
    w = pole - u * pole.dot(u)
    w = w.normalized() if w.length > 1e-6 else Vector((0, -1, 0))
    x = (d * d + l1 * l1 - l2 * l2) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    joint = a + u * x + w * h
    aim(arm, upper, joint - a)
    aim(arm, lower, (a + u * d) - pb_(arm, lower).head)


def fingers(arm, rest, side: str, curl: tuple, thumb: tuple):
    """五指往掌心收：绕各自静止姿势里「指向 × 掌心法线」的轴（跟着手转）；第 1 节带着第 2 节转，第 2 节再收"""
    R = rel(arm, f"hand_{side}", rest.hand_m[side])
    for f in FINGERS:
        a, b = thumb if f == "thumb" else curl
        ax = R @ rest.curl[side][f]
        for k, deg in ((1, a), (2, b)):
            name = f"{f}_{k}_{side}"
            if name in arm.pose.bones:
                turn(arm, name, ax, deg)


class Rest:
    """静止姿势里量出来的东西：脚掌落点、两肩中点；手的握法基（食指→小指、指节方向）、拳心、五指收拢轴；肩甲跟随要的锁骨 / 上臂"""

    def __init__(self, arm):
        reset(arm)
        self.sole = {s: pb_(arm, f"foot_{s}").head.copy() for s in "LR"}
        self.shoulders = (pb_(arm, "arm_L").head + pb_(arm, "arm_R").head) * 0.5
        self.foot_q = {s: pb_(arm, f"foot_{s}").matrix.to_quaternion() for s in "LR"}
        self.hand_m, self.grip_frame, self.knuckle, self.fist, self.curl = {}, {}, {}, {}, {}
        self.shoulder_m, self.arm_dir = {}, {}
        sock = pb_(arm, "socket_sword").head.copy()
        for s in "LR":
            hand = pb_(arm, f"hand_{s}")
            self.hand_m[s] = hand.matrix.to_3x3().copy()
            lat = pb_(arm, f"pinky_1_{s}").head - pb_(arm, f"index_1_{s}").head
            knk = pb_(arm, f"middle_1_{s}").head - hand.head
            self.grip_frame[s] = frame(lat, knk)
            self.knuckle[s] = self.grip_frame[s].col[1].copy()
            n = self.grip_frame[s].col[2].copy()
            if n.x * (1 if s == "L" else -1) > 0:
                n = -n     # 掌心朝身体内侧
            # 拳心（相对手腕）：右手 = socket_sword；左手按中线镜像
            c = sock if s == "R" else Vector((-sock.x, sock.y, sock.z))
            self.fist[s] = c - hand.head
            self.curl[s] = {}
            for f in FINGERS:
                v = vec(arm, f"{f}_1_{s}").normalized()
                if f == "thumb":
                    t = pb_(arm, f"middle_2_{s}").head - pb_(arm, f"thumb_2_{s}").head
                    to = (t - v * t.dot(v)).normalized()
                else:
                    to = n
                self.curl[s][f] = v.cross(to).normalized()
            self.shoulder_m[s] = pb_(arm, f"shoulder_{s}").matrix.to_3x3().copy()
            self.arm_dir[s] = vec(arm, f"arm_{s}").normalized()
        self.sock_m = pb_(arm, "socket_sword").matrix.to_3x3().copy()
        # 握法（常量）：静止姿势里剑身朝下（-Z）、刃朝 ±X；握住时剑首方向（+Z）= 右手食指→小指，刃（X）= 指节方向
        self.sock_S = frame(self.grip_frame["R"].col[0], self.knuckle["R"]) @ frame(Z, X).transposed()


def build(arm, rest: Rest, p: dict):
    """放松底姿 → 髋（平移 / 转身 / 前倾）→ 上身 → 头 → 右臂 / 剑 → 左臂 → 手指 → 腿（IK 踩回地面、脚掌放平）"""
    reset(arm)
    for k, v in REST_RELAX.items():
        aim(arm, k, D(*v))
    drop, fwd, yaw = p.get("drop", 0.0), p.get("fwd", 0.0), p.get("yaw", 0.0)
    hips = pb_(arm, "hips")
    hips.matrix = Matrix.Translation(Vector((0, -fwd, -drop))) @ hips.matrix
    bpy.context.view_layer.update()
    turn(arm, "hips", Z, yaw)
    turn(arm, "hips", X, p.get("hips", 0.0))
    if not p.get("air"):
        # 脚要踩得到地：v006 的腿在绑定姿势里几乎是直的，髋往上提（drop < 0）或脚往外放时两骨 IK 够不着，脚会离地。
        # 这时把髋往下放到正好够得着（只改髋高，招式姿势不变）
        lower = 0.0
        spin = Matrix.Rotation(math.radians(yaw), 3, "Z")
        for s in "LR":
            off = p.get("feet", {}).get(s, (0.0, 0.0))
            sole = spin @ (rest.sole[s] + Vector((-off[0], -off[1], off[2] if len(off) > 2 else 0.0)))
            d = sole - pb_(arm, f"thigh_{s}").head
            reach = pb_(arm, f"thigh_{s}").bone.length + pb_(arm, f"shin_{s}").bone.length - 0.012
            horiz = math.hypot(d.x, d.y)
            if d.length > reach and horiz < reach:
                lower = max(lower, -math.sqrt(reach * reach - horiz * horiz) - d.z)
        if lower > 1e-4:
            hips.matrix = Matrix.Translation(Vector((0, 0, -lower))) @ hips.matrix
            bpy.context.view_layer.update()
    for bone, share in (("spine", 0.4), ("chest", 0.6)):
        turn(arm, bone, Z, p.get("twist", 0.0) * share)
        turn(arm, bone, Y, p.get("roll", 0.0) * share)
        turn(arm, bone, X, p.get("pitch", 0.0) * share)
    hp, hy = p.get("head", (0, 0))
    for bone, share in (("neck", 0.3), ("head", 0.7)):
        turn(arm, bone, Z, hy * share)
        turn(arm, bone, X, hp * share)
    # 双手握剑时左手要够得着剑柄：v006 的手臂比 11-01 的 T 字模型短（上臂 0.55 + 小臂 0.56 m），几个过头 / 贴地的双手姿势左手伸不到。
    # 这时把整副握法（右拳 + 剑）沿「左手腕目标 → 左肩」挪过去，挪的距离 = 左臂差的长度，重解右臂（肩肘多弯一点），剑的方向、刃朝向不变
    snap = {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones}
    shift = Vector((0, 0, 0))
    b = D(*p["sword"]) if "sword" in p else -Z
    for attempt in range(6):
        if attempt:
            for pb in arm.pose.bones:
                pb.rotation_quaternion, pb.location = snap[pb.name][0].copy(), snap[pb.name][1].copy()
            bpy.context.view_layer.update()
        if "grip" in p:
            g = p["grip"]
            mid = (pb_(arm, "arm_L").head + pb_(arm, "arm_R").head) * 0.5
            two_bone(arm, "arm_R", "forearm_R", "hand_R", mid + Vector((-g[0], -g[1], g[2])) + shift, D(1, -0.2, -0.6))
        else:
            for key, bone in (("arm_R", "arm_R"), ("fore_R", "forearm_R")):
                if key in p:
                    aim(arm, bone, D(*p[key]))
            if shift.length > 1e-4:
                elbow = pb_(arm, "forearm_R").head - pb_(arm, "arm_R").head
                two_bone(arm, "arm_R", "forearm_R", "hand_R", pb_(arm, "hand_R").head + shift, elbow)
        knuckle = hold_sword(arm, rest, b, D(*p["edge"]) if "edge" in p else None)
        if not p.get("grip_L"):
            break
        # 左拳握心放到剑柄上（右拳往剑首 L_GRIP 米），指节和右手同一侧；反解左手腕
        RL = grip_rot(rest, "L", b, knuckle)
        fist = pb_(arm, "socket_sword").head - b.normalized() * L_GRIP
        wrist = fist - RL @ rest.fist["L"]
        sh = pb_(arm, "arm_L").head
        over = (wrist - sh).length - (pb_(arm, "arm_L").bone.length + pb_(arm, "forearm_L").bone.length - 0.01)
        if over <= 0.01:
            break
        shift += (sh - wrist).normalized() * over
    if p.get("grip_L"):
        two_bone(arm, "arm_L", "forearm_L", "hand_L", wrist, D(-0.8, -0.3, -0.5))
        place_hand(arm, rest, "L", RL)
    else:
        for key, bone in (("arm_L", "arm_L"), ("fore_L", "forearm_L")):
            if key in p:
                aim(arm, bone, D(*p[key]))
    follow_pauldrons(arm, rest)
    fingers(arm, rest, "R", FIST, FIST_THUMB)
    fingers(arm, rest, "L", FIST if p.get("grip_L") else RELAXED, FIST_THUMB if p.get("grip_L") else RELAXED)
    if p.get("air"):
        th, sh = p.get("legs", (0, 0))
        for s in "LR":
            turn(arm, f"thigh_{s}", X, -th)
            turn(arm, f"shin_{s}", X, sh)
    else:
        feet = p.get("feet", {})
        spin = Matrix.Rotation(math.radians(yaw), 3, "Z")
        for s in "LR":
            off = feet.get(s, (0.0, 0.0))
            sole = spin @ (rest.sole[s] + Vector((-off[0], -off[1], off[2] if len(off) > 2 else 0.0)))
            two_bone(arm, f"thigh_{s}", f"shin_{s}", f"foot_{s}", sole, spin @ Vector((0, -1, 0.15)))
            # 脚掌放平：脚的世界朝向回到静止姿势（跟着转身转）
            foot = pb_(arm, f"foot_{s}")
            m = foot.matrix.copy()
            q = (Quaternion(Z, math.radians(yaw)) @ rest.foot_q[s]).to_matrix().to_4x4()
            foot.matrix = Matrix.Translation(m.translation) @ q
            foot.location = (0, 0, 0)
            bpy.context.view_layer.update()


def fcurves(act) -> list:
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def bake_clip(arm, rest: Rest, name: str, clip: dict):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    prev = {}
    for frame, p in clip["keys"]:
        build(arm, rest, p)
        for b in KEYED:
            if b not in arm.pose.bones:
                continue
            pb = arm.pose.bones[b]
            q = pb.rotation_quaternion.copy()
            if b in prev and q.dot(prev[b]) < 0:
                q.negate()
                pb.rotation_quaternion = q
            prev[b] = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=b)
            if b == "hips":
                pb.keyframe_insert("location", frame=frame, group=b)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        if clip.get("loop"):
            fc.modifiers.new("CYCLES")
    return act


def export_fbx(arm, act, name: str, frames: int, out_dir: Path):
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 0, frames
    arm.animation_data.action = act
    out_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=str(out_dir / f"{name}.fbx"), use_selection=False, object_types={"ARMATURE", "EMPTY"},
        apply_unit_scale=True, apply_scale_options="FBX_SCALE_UNITS", axis_forward="-Z", axis_up="Y",
        bake_space_transform=False, add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X",
        use_armature_deform_only=False, armature_nodetype="NULL",
        bake_anim=True, bake_anim_use_all_bones=True, bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False,
        bake_anim_force_startend_keying=True, bake_anim_step=1.0, bake_anim_simplify_factor=0.0, path_mode="STRIP")


def write_events(path: Path):
    clips = {}
    for name, c in CLIPS.items():
        e = {"events": [{"at": round(f / c["frames"], 4), "name": n} for f, n in c["events"]], "loop": bool(c.get("loop"))}
        if c.get("next"):
            e["next"] = c["next"]
        if c.get("speed"):
            e["speed"] = c["speed"]
        clips[name] = e
    doc = {"schema": 1,
           "about": ("熔心魔将（人形骨架）的动画事件叠加表（NativeClipBuilder 写成 OnAnimEvent）。片段是手工关键帧，本文件和 FBX 都由 "
                     "art/source/characters/SK_Boss_Warlord/anim/warlord_anims_humanoid.py 生成（姿势 / 片段表在 warlord_poses.py），别手改；"
                     "at = 片段内归一化时刻。hit / impact = 释放帧（刀到 / 落地 / 插剑 / 收刀 / 竖劈 / 第二圈），smear / smearEnd = 大剑拖影起止，"
                     "dash = 居合拔刀突进，fx:windup = 起手，step = 踏步，brake = 刹停，takeoff = 起跳，cast = 号令天火，gather / roar = 咆哮，"
                     "kneel / collapse = 倒下，glare = 登场抬头；speed = 步态录制速度（混合树阈值）；fx:*Warning 只是标注预警从哪一帧画"),
           "clips": clips}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ───────────── 审核（--review）：带模型和大剑渲关键姿势，量拉伸 / 脚底 / 握剑 ─────────────
def attach_sword(arm, sword_glb: Path):
    """大剑挂到 socket_sword（同 Unity 的 WarlordBlade：静止姿势下剑的资产空间和本体对齐，原点 = 握心、剑尖朝下）"""
    reset(arm)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(sword_glb))
    pb = pb_(arm, "socket_sword")
    head = arm.matrix_world @ pb.bone.head_local
    tail_m = arm.matrix_world @ pb.bone.matrix_local @ Matrix.Translation((0, pb.bone.length, 0))
    for o in [o for o in bpy.data.objects if o not in before and o.type == "MESH"]:
        mw = o.matrix_world.copy()
        o.parent, o.parent_type, o.parent_bone = arm, "BONE", pb.name
        o.matrix_parent_inverse = tail_m.inverted()
        o.matrix_basis = Matrix.Translation(head) @ mw


def body_mesh():
    return next(o for o in bpy.data.objects if o.type == "MESH" and o.name.endswith("_LOD0") and o.find_armature())


def eval_coords(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    m = ev.to_mesh()
    co = [o.matrix_world @ v.co for v in m.vertices]
    ev.to_mesh_clear()
    return co


def render_reviews(arm, rest, out: Path, sword_glb: Path, only=None):
    import numpy as np
    out.mkdir(parents=True, exist_ok=True)
    attach_sword(arm, sword_glb)
    body = body_mesh()
    me = body.data
    edges = np.array([e.vertices[:] for e in me.edges])
    reset(arm)
    rest_co = np.array([v[:] for v in eval_coords(body)])
    rest_len = np.linalg.norm(rest_co[edges[:, 0]] - rest_co[edges[:, 1]], axis=1)
    groups = {g.index: g.name for g in body.vertex_groups}
    feet_v = np.array([any(groups[g.group].startswith(("foot_", "toe_")) and g.weight > 0.5 for g in v.groups) for v in me.vertices])
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = False
    scene.render.resolution_x, scene.render.resolution_y = 560, 640
    scene.world = bpy.data.worlds.new("w")
    cams = []
    for name, pos in (("front", Vector((0, -16, 3.0))), ("top", Vector((-8.5, -7.5, 11.5)))):
        cam = bpy.data.cameras.new(name)
        cam.type = "ORTHO"
        cam.ortho_scale = 7.0
        co = bpy.data.objects.new(name, cam)
        scene.collection.objects.link(co)
        co.location = pos
        co.rotation_euler = (Vector((0, 0, 2.0)) - pos).to_track_quat("-Z", "Y").to_euler()
        cams.append(co)
    bpy.ops.mesh.primitive_plane_add(size=9, location=(0, 0, 0))
    report = {}
    for name, clip in CLIPS.items():
        if only and name not in only:
            continue
        rows = []
        for frame_no, pose in clip["keys"]:
            if pose is BASE and frame_no and name != "Idle":
                continue
            build(arm, rest, pose)
            co = np.array([v[:] for v in eval_coords(body)])
            ln = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1)
            moved = np.linalg.norm(co - rest_co, axis=1)
            mv = (moved[edges[:, 0]] > 0.01) | (moved[edges[:, 1]] > 0.01)
            ratio = np.maximum(ln[mv], 1e-6) / np.maximum(rest_len[mv], 1e-6)
            stretch = float(np.percentile(np.maximum(ratio, 1 / ratio), 99)) if mv.any() else 1.0
            sock = pb_(arm, "socket_sword").head
            bl = blade(arm).normalized()
            fist_l = pb_(arm, "hand_L").head + rel(arm, "hand_L", rest.hand_m["L"]) @ rest.fist["L"]
            d = fist_l - sock
            fist_gap = (d - bl * d.dot(bl)).length if pose.get("grip_L") else None
            row = {"frame": frame_no, "stretch_p99": round(stretch, 2), "body_min_z": round(float(co[:, 2].min()), 3),
                   "feet_min_z": round(float(co[feet_v, 2].min()), 3) if not pose.get("air") else None,
                   "sword_tip_z": round(pb_(arm, "socket_sword_tip").head.z, 2),
                   "left_fist_to_grip": round(fist_gap, 3) if fist_gap is not None else None}
            for cam in cams:
                scene.camera = cam
                scene.render.filepath = str(out / f"{name}_{frame_no:03d}_{cam.name}.png")
                bpy.ops.render.render(write_still=True)
            rows.append(row)
        report[name] = rows
    (out / "review.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = Path(argv[argv.index("--out") + 1]) if "--out" in argv else UNITY
    glb = Path(argv[argv.index("--glb") + 1]) if "--glb" in argv else GLB
    sword = Path(argv[argv.index("--sword") + 1]) if "--sword" in argv else SWORD_GLB
    review = Path(argv[argv.index("--review") + 1]) if "--review" in argv else None
    only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else None
    dry = "--dry" in argv
    arm = load_rig(glb, keep_mesh=review is not None)
    rest = Rest(arm)
    if review:
        render_reviews(arm, rest, review, sword, only)
        print("WARLORD_REVIEW " + str(review))
        return
    if dry:
        for name, clip in CLIPS.items():
            for _, p in clip["keys"]:
                build(arm, rest, p)
        print(f"WARLORD_HUMANOID 试解算 {len(CLIPS)} 段，没有导出")
        return
    # 同 hanba_anims：导出前顶层物体绕 Z 转 180°（Unity 里角色朝 +Z），再放一个顶层空物体（单个顶层物体会被折叠，层级对不上 Avatar）
    arm.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    keep = bpy.data.objects.new("SK_Boss_Warlord_AnimRoot", None)
    bpy.context.scene.collection.objects.link(keep)
    report = {}
    for name, clip in CLIPS.items():
        act = bake_clip(arm, rest, name, clip)
        export_fbx(arm, act, name, clip["frames"], out / "Keyframed")
        report[name] = {"seconds": round(clip["frames"] / FPS, 2), "keys": [k[0] for k in clip["keys"]]}
    write_events(out / "SK_Boss_Warlord.events.json")
    print("WARLORD_HUMANOID " + json.dumps(report, ensure_ascii=False))


main()
