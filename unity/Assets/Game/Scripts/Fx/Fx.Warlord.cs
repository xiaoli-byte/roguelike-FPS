using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔心魔将的色阶（docs/art/vfx/warlord.md §1；fx-style §2.1 火 + §2.2 第三章熔火）：母题是熔铜铠甲、地火之心、战阵号令、陨火，
    /// 形状语言「重、方、斩」——刀光是暗月牙托亮刃，熔铜是铜橙色，烟是紫褐色，碎屑是方块（铜渣、铁片）。
    /// 每层只用三阶：亮芯 / 主色 / 暗边（或烟）。狂怒（20%）整体换挡成白热铜：亮芯更白、主色更亮更黄、暗边转赤。
    /// 和火麒麟（玄鳞 + 圣火：青黑鳞光、金白圣焰、圆 / 环的宝鼎母题）分开：魔将只用铜和铁、方和月牙。
    /// </summary>
    public static class WarlordPalette
    {
        /// <summary>常态：亮芯（白热铜）/ 主色（熔铜橙）/ 暗边（赭红）</summary>
        public static readonly Color Hot = Hex.Rgb(0xffe6a6), Copper = Hex.Rgb(0xff8a2e), Deep = Hex.Rgb(0xb8461a);
        /// <summary>狂怒：亮芯 / 主色 / 暗边</summary>
        public static readonly Color FuryHot = Hex.Rgb(0xfff6dc), FuryCopper = Hex.Rgb(0xffb24a), FuryDeep = Hex.Rgb(0xff4a14);
        /// <summary>紫褐烟（第三章烟色）、暗月牙（刀光底下的暗衬，偏紫不发黑）、铁渣（方块碎屑）</summary>
        public static readonly Color Smoke = Hex.Rgb(0x4e3442), Under = new(0.13f, 0.045f, 0.06f), Slag = Hex.Rgb(0x3a2a26);

        /// <summary>
        /// 写进网格顶点色的颜色要先转成线性：工程是线性色彩空间，粒子着色器把顶点色当线性值用——直接写 sRGB 的铜橙（0.54 的绿）会显示成 0.76，
        /// 整弯月牙冲成奶白（第一次实拍就是这样；通用刀光 SlashArc 也有同样的问题）
        /// </summary>
        public static Color Vertex(Color c) => FxVertexColor.Linear(c);

        public static Color HotAt(float fury) => Color.Lerp(Hot, FuryHot, fury);
        public static Color CopperAt(float fury) => Color.Lerp(Copper, FuryCopper, fury);
        public static Color DeepAt(float fury) => Color.Lerp(Deep, FuryDeep, fury);
    }

    /// <summary>
    /// 熔心魔将的招式特效入口（首领与精英动作 · 特效调优 W 路；设计单 docs/art/vfx/warlord.md）。只管外观，不碰判定：
    /// 判定、危险物、预警都在招式里（Reference/WarlordMoves.cs、Warlord/Moves），这里由 <see cref="WarlordBrain"/> 在释放帧那一刻调。
    /// 粒子走 <see cref="Burst"/> / 预设（都过 <see cref="FxBudget"/>），刀光是自己的墨笔月牙 <see cref="WarlordArc"/>（池化），大剑拖影 / 熔铜长刃见 <see cref="WarlordBlade"/>，
    /// 飞行剑气见 <see cref="WarlordWaveFx"/>（剑士化 v2，设计单第 13 章）。
    /// fury = 0..1 狂怒换挡程度（色阶从熔铜转白热铜）。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>
        /// 主形 · 暗月牙托亮刃（<see cref="WarlordArc"/>）：一弯两头尖、中间厚的月牙——底下垫一层更大的暗紫褐月牙（普通混合，亮沙 / 熔岩上都压得出来），
        /// 中间是实色的熔铜色块（普通混合，不靠加法叠白），外缘一道白热刃口（加法）。arc = 弧长（弧度），dir = 1 从右往左扫（俯视逆时针）/ -1 反向，
        /// tilt = 绕前方轴倾斜（弧度：斜劈 / 竖劈），width = 月牙最厚处（米），pitchDeg = 整弯往前低头的角度（度：水平的横扫月牙朝玩家那一侧压低一点，
        /// 第一人称里不再是一条贴着视线的细线）
        /// </summary>
        public static FxHandle WarlordCrescent(Vector3 center, float yawDeg, float radius, float arc, int dir, float tilt, float width, float fury, float life = 0.32f,
            float pitchDeg = 0f) =>
            WarlordArc.Spawn(center, yawDeg, radius, arc, dir, tilt, width, life, fury, pitchDeg);

        /// <summary>
        /// 点缀 · 方块铜渣：沿 dir 甩出去的几块方铜渣（铁片预设，铜色）+ 一小撮拉丝火星。chunk = false 只放火星（一圈里只让一处放铁片预设，省粒子系统）
        /// </summary>
        public static void WarlordShards(Vector3 at, Vector3 dir, float size, float fury, bool chunk = true)
        {
            if (!Finite(at)) return;
            if (chunk) Basalt(at, 0.55f * size, Color.Lerp(WarlordPalette.Slag, WarlordPalette.Deep, 0.35f));
            var d = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.up;
            Burst(at + d * 0.3f, WarlordPalette.CopperAt(fury), Mathf.RoundToInt(7 * size), 7f * Mathf.Sqrt(size), 0.35f, 0.08f, 10f);
        }

        /// <summary>
        /// 第三章的地裂（第二批收尾 C 路）：方形裂纹贴花（<see cref="CrackDecals"/>：方坑 + 方折主裂纹 + 一圈方石板缝，铜橙裂光、紫褐焦边，
        /// 从坑心往外蔓延、慢慢冷成暗铜缝）。radius = 裂纹最远处的半径（米）；fallback = 贴不上（关了 / 材质缺失）时退回一滩熔铜贴花（以前的样子）
        /// </summary>
        public static FxHandle Ch3Crack(Vector3 ground, float radius, float fury = 0f, float life = 6f, float heat = 1f, bool fallback = true)
        {
            if (!Finite(ground)) return FxHandle.None;
            var h = CrackDecals.Place(ground, radius / 0.9f, life, heat, fury);
            return h.Alive || !fallback ? h : MoltenSplat(ground, radius * 0.77f, heat, life);
        }

        /// <summary>
        /// 重击落地（跃击落点 / 竖劈入地）：主形 = 贴地卡通粗环（压暗的铜色）+ 熔铜冠；次级 = 方形裂纹贴花（<see cref="Ch3Crack"/>）+ 一圈紫褐尘团；
        /// 点缀 = 一圈方铜渣往外崩、火星。
        /// 不用通用砸地预设（它的裂纹贴花是一圈白色放射纹，读成旱魃的日轮）；第三章的地裂以前借熔铜贴花，现在是自己的方形裂纹（坑里那一汪就是熔铜）。
        /// 闪光压低贴地，不盖住砸下来的身体
        /// </summary>
        public static void WarlordImpact(Vector3 ground, float radius, float fury)
        {
            if (!Finite(ground)) return;
            Burst(ground + Vector3.up * 0.3f, WarlordPalette.Smoke, Mathf.RoundToInt(3 + radius), 3.5f + radius, 0.7f, 0.6f, -0.8f);
            MoltenBurst(ground + Vector3.up * 0.3f, radius * 0.5f, false, WarlordPalette.CopperAt(fury));
            Ch3Crack(ground, radius * 1.1f, fury);
            Ring(ground + Vector3.up * 0.08f, radius * 1.15f, WarlordPalette.DeepAt(fury), 0.42f);
            // 方铜渣：中心一蓬铁片预设（一个粒子系统），外圈每个方向只甩火星
            Basalt(ground + Vector3.up * 0.2f, 0.35f * radius, Color.Lerp(WarlordPalette.Slag, WarlordPalette.Deep, 0.35f));
            int n = Mathf.Clamp(Mathf.RoundToInt(radius), 4, 6);
            float a0 = Random.value * Mathf.PI * 2f;
            for (int i = 0; i < n; i++)
            {
                float a = a0 + i / (float)n * Mathf.PI * 2f;
                var d = new Vector3(Mathf.Sin(a), 0.6f, Mathf.Cos(a));
                WarlordShards(ground + new Vector3(d.x, 0, d.z) * radius * 0.45f + Vector3.up * 0.2f, d, 0.6f, fury, false);
            }
            Flash(ground + Vector3.up * 0.5f, WarlordPalette.CopperAt(fury), 6f, radius * 2.4f, 0.22f);
            // 用户概念图 ACTION POSES ③「大剑砸地，地面炸起熔岩火焰」：落点一圈往上窜的熔岩火舌
            FlameTongues.Ground(ground, radius * 0.35f, Mathf.Clamp(Mathf.RoundToInt(radius * 1.6f), 4, 7), 0.6f, 0.4f + 0.12f * radius,
                WarlordPalette.HotAt(fury), WarlordPalette.CopperAt(fury), WarlordPalette.DeepAt(fury));
        }

        /// <summary>
        /// 竖劈入地的裂地线：从 from 沿 dir 一节一节往前崩开的熔铜裂口（每 0.04 s 一节：熔铜小冠 + 方铜渣 + 贴地火舌），读作「这一刀劈到哪」。
        /// 计时挂在特效根下的一次性序列上（<see cref="WarlordFxSequence"/>），不占首领身上的倒下时间轴
        /// </summary>
        public static void WarlordCleave(Vector3 from, Vector3 dir, float length, float fury)
        {
            if (!Finite(from)) return;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return;
            dir.Normalize();
            int n = Mathf.Clamp(Mathf.RoundToInt(length / 1.5f), 2, 4);
            var seq = WarlordFxSequence.Start();
            if (!seq) return;
            for (int i = 0; i < n; i++)
            {
                float k = (i + 1) / (float)n;
                var p = from + dir * (length * k);
                float gy = GroundY(p + Vector3.up * 2f, 4f);
                if (!float.IsNegativeInfinity(gy)) p.y = gy;
                float s = Mathf.Lerp(1f, 0.6f, k);
                seq.At(i * 0.04f, () =>
                {
                    MoltenSplat(p, 0.9f * s, 1f, 4f);
                    WarlordShards(p + Vector3.up * 0.15f, Vector3.up + dir * 0.4f, s, fury, k >= 0.99f);
                    if (k >= 0.99f) FlameTongues.Ground(p, 0.6f, 3, 0.7f, 0.45f, WarlordPalette.HotAt(fury), WarlordPalette.CopperAt(fury), WarlordPalette.DeepAt(fury));
                });
            }
        }

        /// <summary>
        /// 号令天火（陨石雨举剑那一刻）：剑尖一道冲天的熔铜光柱（主形，0.45 s 收掉）、剑尖一闪、头顶天上一团火光（陨火从那里来）
        /// </summary>
        public static void WarlordBeacon(Vector3 tip, float fury)
        {
            if (!Finite(tip)) return;
            var sky = tip + Vector3.up * 26f;
            Beam(tip, sky, WarlordPalette.CopperAt(fury), 0.55f, 0.45f);
            Beam(tip, sky, WarlordPalette.HotAt(fury), 0.18f, 0.32f);
            Flash(tip, WarlordPalette.CopperAt(fury), 8f, 9f, 0.25f);
            Burst(tip, WarlordPalette.HotAt(fury), 10, 6f, 0.35f, 0.1f, -4f);
            Burst(sky, WarlordPalette.CopperAt(fury), 16, 5f, 0.7f, 0.5f, 0f);
        }

        /// <summary>
        /// 狂怒换挡的那一下（20%，转阶段咆哮炸开的那一帧）：白热冲击粗环 + 紫褐烟环 + 全身往外喷的熔铜火星 + 一闪；之后的常驻样子见 <see cref="WarlordBlade"/> 与 WarlordBrain
        /// </summary>
        public static void WarlordFuryShift(Vector3 feet, Vector3 chest)
        {
            if (!Finite(feet)) return;
            Ring(feet + Vector3.up * 0.1f, 9f, WarlordPalette.FuryDeep, 0.55f);
            Ring(feet + Vector3.up * 0.12f, 5f, WarlordPalette.FuryHot, 0.35f, false);
            WarlordSmoke(feet + Vector3.up * 0.4f, 2.6f, 6);
            MoltenBurst(chest, 1.6f, false, WarlordPalette.FuryCopper);
            Burst(chest, WarlordPalette.FuryHot, 26, 11f, 0.5f, 0.12f, 2f);
            Flash(chest, WarlordPalette.FuryCopper, 10f, 14f, 0.35f);
        }

        /// <summary>
        /// 登场落地 · 熔铜落地（第二批 B 路，设计单 §12.3；取代通用砸地 <see cref="Slam"/>：它的白色放射裂纹读成旱魃的日轮、尘浪是第一章的沙色）。
        /// 主形 = 重击落地（贴地粗环 + 熔铜冠 + 熔铜贴花 + 方铜渣，<see cref="WarlordImpact"/>）+ 从落点往四向一节一节崩开的「十」字熔铜裂口
        /// （神范台十字浅渠的母题，每 0.04 s 一节，<see cref="WarlordCleave"/>）；次级 = 外圈一道紫褐尘浪粗环、一圈紫褐烟团；点缀 = 方铜渣、火星（裂口里带）。
        /// fwd = 魔将朝向（十字的一条臂对着他面朝的方向，也就是对着玩家）
        /// </summary>
        public static void WarlordLanding(Vector3 ground, float radius, Vector3 fwd, float fury)
        {
            if (!Finite(ground)) return;
            WarlordImpact(ground, radius, fury);
            Ring(ground + Vector3.up * 0.06f, radius * 1.6f, WarlordPalette.Smoke, 0.6f);
            WarlordSmoke(ground + Vector3.up * 0.3f, radius * 0.7f, 6);
            fwd.y = 0;
            if (fwd.sqrMagnitude < 1e-4f) fwd = Vector3.forward;
            fwd.Normalize();
            var right = Vector3.Cross(Vector3.up, fwd);
            foreach (var d in new[] { fwd, right, -fwd, -right })
                WarlordCleave(ground + d * (radius * 0.25f), d, radius * 0.85f, fury);
        }

        /// <summary>登场抬头怒视（动画事件 glare）：角盔（弱点）一亮——白热铜的一闪 + 一撮往上飘的铜火星，读作「看这里」</summary>
        public static void WarlordGlare(Vector3 helm, float fury)
        {
            if (!Finite(helm)) return;
            Flash(helm, WarlordPalette.HotAt(fury), 5f, 4f, 0.2f);
            Burst(helm, WarlordPalette.CopperAt(fury), 10, 3f, 0.5f, 0.1f, -3f);
        }

        /// <summary>紫褐烟团（收招、刹停、落地后的余韵）：几团慢慢往上飘、很快淡掉的烟</summary>
        public static void WarlordSmoke(Vector3 at, float radius, int count = 4)
        {
            if (!Finite(at)) return;
            for (int i = 0; i < count; i++)
            {
                var o = Random.insideUnitSphere * radius;
                o.y = Mathf.Abs(o.y) * 0.3f;
                Burst(at + o, WarlordPalette.Smoke, 1, 0.6f, 0.8f, 0.42f * Mathf.Clamp(radius, 0.6f, 1.6f), -1.2f);
            }
        }

        // ───────────── 剑士化 v2（设计单第 13 章）：剑光 ─────────────

        /// <summary>
        /// 飞行剑气（<see cref="WarlordWaveFx"/>）：竖剑气是一弯竖着的月牙（侧移躲）、横剑气是一弯平放的月牙（跳过）；前沿 = 月牙顶点 = 判定前沿。
        /// 主月牙 + 身后两道淡下去的残月（拖影），飞行中从顶点甩铜火星；句柄 MoveTo 跟着判定走、Cancel 收掉（命中 / 撞墙 / 飞完的爆点另调 <see cref="WarlordWaveBurst"/>）。
        /// lord = null（样机）时退回通用刀光（不跟随）
        /// </summary>
        public static FxHandle WarlordWave(Vector3 origin, Vector3 dir, bool vertical, float halfWidth, float height, bool fury, Object lord)
        {
            if (!Finite(origin)) return FxHandle.None;
            if (!lord)
                return Slash(origin + Vector3.up * (vertical ? 1.6f : 0.6f), Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg, halfWidth * 1.2f, 1.9f, 1,
                    vertical ? -Mathf.PI * 0.5f : 0f, 0.7f, 0.35f, WarlordRef.Fire, true);
            return WarlordWaveFx.Spawn(origin, dir, vertical, halfWidth, height, fury);
        }

        /// <summary>
        /// 剑气的爆点（打中玩家 / 撞上掩体 / 飞到尽头）：亮芯爆闪星 + 「啪」环 + 一个由两弯短月牙交成的「X」斩痕（读作「斩」到了）+ 方铜渣 + 一闪；
        /// 散在空处（飞完）时只放小一号的碎月牙和火星，不抢画面
        /// </summary>
        public static void WarlordWaveBurst(Vector3 at, Vector3 dir, bool vertical, bool fury, bool wall)
        {
            if (!Finite(at)) return;
            float f = fury ? 1f : 0f;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) dir = Vector3.forward;
            dir.Normalize();
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float s = wall ? 1.25f : 1f;
            HanbaOne(rt, "ToonBurst", at, Vector3.zero, 1.5f * s, 0.1f, WarlordPalette.HotAt(f));
            HanbaOne(rt, "ToonPop", at, Vector3.zero, 2.2f * s, 0.2f, WarlordPalette.CopperAt(f), false);
            // X 斩痕：两笔短刀光交成「X」，画在正对剑气来向的面上（迎面看是满的，不是一条线）
            var side = Vector3.Cross(Vector3.up, dir);
            foreach (var along in new[] { (side + Vector3.up).normalized, (side - Vector3.up).normalized })
                WarlordStroke(at, along, Vector3.Cross(dir, along), (vertical ? 2.4f : 2f) * s, 0.42f, f, 0.24f);
            WarlordShards(at, -dir + Vector3.up * 0.4f, wall ? 0.9f : 0.6f, f, wall);
            Flash(at, WarlordPalette.CopperAt(f), wall ? 6f : 4f, wall ? 7f : 5f, 0.14f);
        }

        /// <summary>狂怒十字剑气：竖剑气从横剑气中间穿过的那一刻，交点亮一个「十」字（两道近乎笔直的刀光 + 亮芯星 + 一闪）</summary>
        public static void WarlordCrossFlare(Vector3 at, Vector3 dir, float halfWidth, bool fury)
        {
            if (!Finite(at)) return;
            float f = fury ? 1f : 0f;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            var side = Vector3.Cross(Vector3.up, dir);
            float len = Mathf.Clamp(halfWidth * 1.4f, 2.4f, 5f);
            // 一横一竖两笔，都画在正对来向的面上
            WarlordStroke(at, side, Vector3.up, len, 0.45f, f, 0.32f);
            WarlordStroke(at + Vector3.up * 0.3f, Vector3.up, -side, len * 0.8f, 0.4f, f, 0.32f);
            HanbaOne(rt, "ToonBurst", at, Vector3.zero, 2.4f, 0.12f, WarlordPalette.HotAt(f));
            Flash(at, WarlordPalette.HotAt(f), 7f, 9f, 0.18f);
        }

        /// <summary>
        /// 一笔近乎笔直的墨笔刀光（<see cref="WarlordArc"/> 取大半径、小弧：12 m 长的一笔拱起不到 1 m）：中点在 mid，沿 along 方向长 length，
        /// 往 bow 方向微微拱起（bow 和 along 垂直；月牙的面 = along、bow 张成的面）。刀头从起笔（−along 端）往收笔扫，reveal = 第一帧刀头扫到哪（1.12 = 一下现满）
        /// </summary>
        public static FxHandle WarlordStroke(Vector3 mid, Vector3 along, Vector3 bow, float length, float width, float fury, float life, float reveal = 1.12f)
        {
            if (!Finite(mid) || !(length > 0.1f) || along.sqrMagnitude < 1e-6f) return FxHandle.None;
            along.Normalize();
            bow -= along * Vector3.Dot(bow, along);
            if (bow.sqrMagnitude < 1e-6f) bow = Vector3.Cross(along, Vector3.right).sqrMagnitude > 1e-4f ? Vector3.Cross(along, Vector3.right) : Vector3.up;
            bow.Normalize();
            float r = length * 1.6f, arc = length / r;
            // 月牙在局部 XZ 面、拱向局部 +Z：局部 Z = bow、局部 X = along（Y = Z × X）
            var rot = Quaternion.LookRotation(bow, Vector3.Cross(bow, along));
            return WarlordArc.SpawnRotated(mid - bow * r, rot, r, arc, -1, width, life, fury, reveal);
        }

        /// <summary>
        /// 居合拔刀的「一闪」：腰高一道白热细线（突进的路线，0.12 s）+ 一道铜色的宽线（0.2 s）、起步紫褐尘、线尾一撮火星。快得只剩一道线
        /// </summary>
        public static void WarlordIaiDraw(Vector3 from, Vector3 dir, float dash, float fury)
        {
            if (!Finite(from)) return;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return;
            dir.Normalize();
            var a = from + Vector3.up * 1.35f;
            var b = a + dir * dash;
            Beam(a, b, WarlordPalette.HotAt(fury), 0.09f, 0.12f);
            Beam(a + Vector3.up * 0.05f, b, WarlordPalette.CopperAt(fury), 0.32f, 0.2f);
            WarlordSmoke(from + Vector3.up * 0.3f, 1f, 3);
            Burst(b, WarlordPalette.CopperAt(fury), 8, 6f, 0.3f, 0.08f, 4f);
        }

        /// <summary>
        /// 居合收刀「咔」：整条线上的刀光现形——腰高一笔长长的墨笔刀光（一下现满、0.45 s 从起笔往收笔收掉），中线一道白热细线一闪，
        /// 沿线隔 2 m 一撮火星、线头线尾两蓬方铜渣，线中间一闪。halfWidth 只决定刀光粗细（判定在招式里）
        /// </summary>
        public static void WarlordIaiCut(Vector3 from, Vector3 dir, float length, float halfWidth, float fury)
        {
            if (!Finite(from)) return;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return;
            dir.Normalize();
            var mid = from + dir * (length * 0.5f) + Vector3.up * 1.25f;
            // 竖着的面里微微往上拱（从侧面看是一整笔，不是贴着视线的细线）
            WarlordStroke(mid, dir, Vector3.up + Vector3.Cross(Vector3.up, dir) * 0.15f, length, Mathf.Clamp(halfWidth * 0.62f, 0.7f, 1.2f), fury, 0.45f);
            Beam(from + Vector3.up * 1.25f, from + dir * length + Vector3.up * 1.25f, WarlordPalette.HotAt(fury), 0.07f, 0.1f);
            int n = Mathf.Clamp(Mathf.RoundToInt(length / 2f), 3, 8);
            for (int i = 0; i <= n; i++)
            {
                var p = from + dir * (length * i / n) + Vector3.up * (1.1f + 0.3f * Random.value);
                Burst(p, WarlordPalette.CopperAt(fury), 4, 5f, 0.3f, 0.08f, 6f);
            }
            WarlordShards(from + Vector3.up * 1f, -dir + Vector3.up * 0.3f, 0.7f, fury, false);
            WarlordShards(from + dir * length + Vector3.up * 1f, dir + Vector3.up * 0.3f, 0.8f, fury, true);
            Flash(mid, WarlordPalette.HotAt(fury), 7f, length * 0.6f, 0.16f);
        }

        /// <summary>
        /// 突刺起跑：剑尖往前一圈「啪」环（正对着冲过来的方向，第一人称迎面就是一个亮圈）+ 亮芯星 + 一束往前喷的铜丝；拖影由大剑自己画
        /// </summary>
        public static void WarlordThrustFlare(Vector3 tip, Vector3 dir, float fury)
        {
            if (!Finite(tip)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            HanbaOne(rt, "ToonBurst", tip, Vector3.zero, 1.2f, 0.09f, WarlordPalette.HotAt(fury));
            HanbaOne(rt, "ToonPop", tip + dir * 0.4f, Vector3.zero, 2f, 0.18f, WarlordPalette.CopperAt(fury), false);
            HanbaMany(rt, "StreakLight", 10, _ =>
            {
                var d = (dir + Random.insideUnitSphere * 0.25f).normalized;
                return (tip, d * Random.Range(12f, 18f), Random.Range(0.07f, 0.1f), Random.Range(0.12f, 0.22f));
            }, WarlordPalette.CopperAt(fury));
            Flash(tip, WarlordPalette.CopperAt(fury), 5f, 6f, 0.14f);
        }

        /// <summary>
        /// 回旋斩：一整圈的墨笔月牙（腰高，刀头 0.12 s 绕满一圈，刃口白热）+ 贴地赭红粗环到判定半径 + 一圈四向甩出的方铜渣 + 紫褐尘。
        /// second（狂怒二连的第二圈）= 外环：月牙更大更低、内圈 inner 以内留空（粗环画外沿）
        /// </summary>
        public static void WarlordSpinRing(Vector3 feet, float radius, float inner, float yawDeg, float fury, bool second)
        {
            if (!Finite(feet)) return;
            float r = second ? Mathf.Lerp(inner, radius, 0.6f) : radius * 0.62f;
            float h = second ? 0.8f : 1.25f;
            WarlordArc.Spawn(feet + Vector3.up * h, yawDeg + 180f, r, Mathf.PI * 2f, second ? -1 : 1, 0f, second ? 1.6f : 1.5f, 0.34f, fury, 0f, 0.55f, -1);
            Ring(feet + Vector3.up * 0.08f, radius, WarlordPalette.DeepAt(fury), 0.32f, false);
            if (second) Ring(feet + Vector3.up * 0.1f, inner, WarlordPalette.Smoke, 0.25f, false);
            for (int i = 0; i < 4; i++)
            {
                float a = (yawDeg + 45f + i * 90f) * Mathf.Deg2Rad;
                var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                WarlordShards(feet + d * r + Vector3.up * h, d + Vector3.up * 0.3f, 0.6f, fury, i == 0);
            }
            WarlordSmoke(feet + Vector3.up * 0.2f, radius * 0.4f, 3);
        }

        /// <summary>
        /// 下劈的裂地线（沿下劈的长条预警）：从 from 沿 dir 每 1.6 m 一节往前崩开（每 0.035 s 一节：一小块方形裂纹 + 火星，最后一节方铜渣 + 贴地火舌），
        /// 读作「这一刀劈到哪」——和预警长条一样长
        /// </summary>
        public static void WarlordCleaveLine(Vector3 from, Vector3 dir, float length, float fury)
        {
            if (!Finite(from)) return;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-4f) return;
            dir.Normalize();
            int n = Mathf.Clamp(Mathf.RoundToInt(length / 1.6f), 2, 7);
            var seq = WarlordFxSequence.Start();
            if (!seq) return;
            for (int i = 0; i < n; i++)
            {
                float k = (i + 1) / (float)n;
                var p = from + dir * (length * k);
                float gy = GroundY(p + Vector3.up * 2f, 4f);
                if (!float.IsNegativeInfinity(gy)) p.y = gy;
                float s = Mathf.Lerp(1f, 0.65f, k);
                bool last = i == n - 1;
                seq.At(i * 0.035f, () =>
                {
                    Ch3Crack(p, 0.8f * s, fury, 4f, 1f, false);
                    Burst(p + Vector3.up * 0.2f, WarlordPalette.CopperAt(fury), 5, 4f, 0.3f, 0.08f, 6f);
                    if (!last) return;
                    WarlordShards(p + Vector3.up * 0.15f, Vector3.up + dir * 0.4f, s, fury, true);
                    FlameTongues.Ground(p, 0.6f, 3, 0.7f, 0.45f, WarlordPalette.HotAt(fury), WarlordPalette.CopperAt(fury), WarlordPalette.DeepAt(fury));
                });
            }
        }
    }

    /// <summary>一次性的特效时间轴：挂在特效根下，按 at 秒放一串动作，放完自己销毁（换关清场时随特效根一起没了）</summary>
    public sealed class WarlordFxSequence : MonoBehaviour
    {
        readonly List<(float at, System.Action run)> steps = new();
        float t;

        public static WarlordFxSequence Start()
        {
            var rt = FxRuntime.Ensure();
            if (!rt || !Application.isPlaying) return null;
            var go = new GameObject("Warlord Fx Sequence");
            go.transform.SetParent(rt.transform, false);
            return go.AddComponent<WarlordFxSequence>();
        }

        public WarlordFxSequence At(float at, System.Action run)
        {
            if (run != null) steps.Add((Mathf.Max(0, at), run));
            return this;
        }

        void Update()
        {
            t += Time.deltaTime;
            for (int i = steps.Count - 1; i >= 0; i--)
            {
                if (t < steps[i].at) continue;
                var run = steps[i].run;
                steps.RemoveAt(i);
                try
                {
                    run();
                }
                catch (System.Exception e)
                {
                    Debug.LogException(e);
                }
            }
            if (steps.Count == 0) Destroy(gameObject);
        }
    }

    /// <summary>
    /// 一弯墨笔月牙的网格（<see cref="WarlordArc"/>、<see cref="WarlordWaveFx"/> 共用；设计单 §1.3 + §13.2）：三层——
    ///   暗衬（普通混合，紫褐，比本体大一圈、略往外偏：亮的熔岩上压得出轮廓）→ 本体（普通混合的熔铜实色块：内缘赭红、外缘熔铜）→ 刃口（加法，外缘一道白热线，刀头最亮）。
    /// 笔形（剑士化 v2 的「墨笔起收锋」，<see cref="Brush"/>）：u = 0 起笔（挥刀的起点）→ 1 收笔（刀头）——露锋细入、一路渐粗、收笔前一顿、出锋尖收；
    /// 起笔那一段（u &lt; 0.38）两条「飞白」：厚度方向第 2、4 圈的不透明度按干笔程度往下压（中尺度的两道丝，不是噪点）；内缘带两三个手绘的起伏。
    /// 顶点色一律过 <see cref="FxVertexColor"/>（线性空间）。纯视觉，不做判定。
    /// </summary>
    public sealed class WarlordCrescentMesh
    {
        public const int Segments = 40, Rows = 6;
        /// <summary>每一圈在厚度方向的位置（0 = 内缘、1 = 外缘）与三层各圈的不透明度</summary>
        static readonly float[] RowAt = { 0f, 0.22f, 0.45f, 0.68f, 0.86f, 1f };
        static readonly float[] UnderA = { 0.3f, 0.72f, 0.86f, 0.88f, 0.86f, 0.74f };
        static readonly float[] BodyA = { 0f, 0.72f, 0.9f, 0.95f, 0.92f, 0.55f };
        static readonly float[] EdgeA = { 0f, 0f, 0f, 0.04f, 0.16f, 0.85f };
        static int[] tris;
        static Vector2[] uvs;

        readonly Mesh under, body, edge;
        readonly MeshRenderer underR, bodyR, edgeR;
        readonly Vector3[] pu, pb;
        readonly Color[] cu, cb, ce;

        /// <summary>一次绘制的参数：半径、弧长（弧度）、最厚处、方向（1 = 俯视逆时针扫）、刀头 / 刀尾（0..1.15）、外扩、狂怒、整体不透明度、干笔、起伏相位、局部偏移、要不要刃口</summary>
        public struct Look
        {
            public float radius, arc, width, head, tail, grow, fury, alpha, dry, seed;
            public int dir;
            public Vector3 offset;
            public bool edge;
            /// <summary>只用狂怒的暗边色（残月）</summary>
            public bool ember;
        }

        public WarlordCrescentMesh(Transform parent, string name)
        {
            int n = (Segments + 1) * Rows;
            pu = new Vector3[n];
            pb = new Vector3[n];
            cu = new Color[n];
            cb = new Color[n];
            ce = new Color[n];
            if (tris == null)
            {
                uvs = new Vector2[n];
                for (int i = 0; i <= Segments; i++)
                    for (int k = 0; k < Rows; k++)
                        uvs[i * Rows + k] = new Vector2(i / (float)Segments, RowAt[k]);
                tris = new int[Segments * (Rows - 1) * 6];
                int w = 0;
                for (int i = 0; i < Segments; i++)
                    for (int k = 0; k < Rows - 1; k++)
                    {
                        int a = i * Rows + k, b = a + Rows;
                        tris[w++] = a; tris[w++] = a + 1; tris[w++] = b;
                        tris[w++] = a + 1; tris[w++] = b + 1; tris[w++] = b;
                    }
            }
            under = Make(name + " Under", pu, cu);
            body = Make(name + " Body", pb, cb);
            edge = Make(name + " Edge", pb, ce);
            underR = AddRenderer(parent, "Under", under, FxMaterials.AlphaBlend, -2);
            bodyR = AddRenderer(parent, "Body", body, FxMaterials.AlphaBlend, -1);
            edgeR = AddRenderer(parent, "Edge", edge, FxMaterials.Additive, 0);
        }

        static Mesh Make(string name, Vector3[] pos, Color[] col)
        {
            var m = new Mesh { name = "Warlord Arc " + name };
            m.MarkDynamic();
            m.vertices = pos;
            m.uv = uvs;
            m.colors = col;
            m.triangles = tris;
            return m;
        }

        static MeshRenderer AddRenderer(Transform parent, string name, Mesh m, Material mat, int order)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = m;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.sortingOrder = order;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return r;
        }

        public void SetVisible(bool on)
        {
            underR.enabled = on;
            bodyR.enabled = on;
            edgeR.enabled = on;
        }

        /// <summary>
        /// 笔形（相对最厚处）：0 = 起笔 → 1 = 收笔。露锋：起笔只有 0.15 的厚度；行笔很快渐粗、到一半就是满的（释放帧刀头扫到一半时已经是一弯厚刃）；
        /// 0.8 附近顿一下（+10%）；之后出锋尖收到 0
        /// </summary>
        public static float Brush(float u)
        {
            u = Mathf.Clamp01(u);
            float swell = Mathf.Pow(Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(u / 0.5f)), 0.7f);
            float entry = 0.15f + 0.85f * swell;
            float x = Mathf.Clamp01((u - 0.82f) / 0.18f);
            float exit = 1f - Mathf.Pow(x, 1.6f);
            float d = (u - 0.8f) / 0.06f;
            float press = 1f + 0.1f * Mathf.Exp(-d * d);
            return entry * exit * press;
        }

        /// <summary>u 处（0..1）的干笔程度（0..1）：起笔那一段最干</summary>
        public static float Dryness(float u) => Mathf.Clamp01(1f - u / 0.38f);

        public void Paint(in Look p)
        {
            var hot = WarlordPalette.Vertex(p.ember ? WarlordPalette.FuryHot : WarlordPalette.HotAt(p.fury));
            var copper = WarlordPalette.Vertex(p.ember ? WarlordPalette.FuryDeep : WarlordPalette.CopperAt(p.fury));
            var deep = WarlordPalette.Vertex(p.ember ? WarlordPalette.FuryDeep * 0.75f : WarlordPalette.DeepAt(p.fury));
            var underC = WarlordPalette.Vertex(WarlordPalette.Under);
            float alpha = Mathf.Clamp01(p.alpha);
            for (int i = 0; i <= Segments; i++)
            {
                float u = i / (float)Segments;
                float a = (u - 0.5f) * p.arc * -p.dir;
                float sn = Mathf.Sin(a), cs = Mathf.Cos(a);
                float thick = p.width * Brush(u);
                // 内缘手绘的起伏（两三个中尺度的波，不是噪点）
                float wob = 1f + 0.04f * Mathf.Sin(u * 9.4f + p.seed);
                bool on = u <= p.head && u >= p.tail;
                float lead = on ? Mathf.Clamp01(1f - (p.head - u) * 3.5f) : 0f;
                float soft = on ? Mathf.Clamp01((p.head - u) * 12f) * Mathf.Clamp01((u - p.tail) * 6f) * alpha : 0f;
                float dry = p.dry * Dryness(u);
                for (int k = 0; k < Rows; k++)
                {
                    int v = i * Rows + k;
                    float inner = thick * (1f - RowAt[k]) * (k <= 2 ? wob : 1f);
                    float r = (p.radius - inner) * p.grow;
                    pb[v] = new Vector3(sn * r, 0, cs * r) + p.offset;
                    float ru = (p.radius + p.width * 0.12f - inner * 1.18f) * p.grow;
                    pu[v] = new Vector3(sn * ru, 0, cs * ru) + p.offset;
                    // 飞白：第 2、4 圈在干笔处压掉（暗衬一起压：露出底下的场景，读作笔锋里的丝）
                    float gap = k is 2 or 4 ? 1f - 0.85f * dry : 1f;
                    var cU = underC;
                    cU.a = soft * UnderA[k] * gap;
                    cu[v] = cU;
                    var cB = k <= 2 ? deep : copper;
                    cB = Color.Lerp(cB, copper, lead * 0.4f * (k / (float)(Rows - 1)));
                    cB.a = soft * BodyA[k] * gap;
                    cb[v] = cB;
                    var cE = hot;
                    cE.a = p.edge ? soft * (EdgeA[k] + (k == Rows - 2 ? 0.3f * lead : 0f)) : 0f;
                    ce[v] = cE;
                }
            }
            under.vertices = pu;
            under.colors = cu;
            under.RecalculateBounds();
            body.vertices = pb;
            body.colors = cb;
            body.RecalculateBounds();
            edge.vertices = pb;
            edge.colors = ce;
            edge.RecalculateBounds();
        }

        public void Destroy()
        {
            if (under) Object.Destroy(under);
            if (body) Object.Destroy(body);
            if (edge) Object.Destroy(edge);
        }
    }

    /// <summary>
    /// 熔心魔将的月牙刀光（主形 · 暗月牙托亮刃，设计单 §1.3；剑士化 v2 起是墨笔笔形 <see cref="WarlordCrescentMesh"/>）：
    /// 通用刀光 <see cref="SlashArc"/> 是等宽的加法光带，在 3-3 的暗红打光里容易叠成一片发白的浅带，所以魔将用自己的月牙。
    /// 时间：第一帧刀头就已经扫到 reveal（缺省一半：释放帧亮芯第一帧到峰值，露出来的已经是笔形渐粗之后的厚刃），前 40% 寿命刀头缓出扫到尽头，之后刀尾从起点往刀头收掉、整体略往外扩。
    /// 狂怒（fury &gt; 0.5）多一层残月：晚 0.05 s、大 7%、只用赤色暗边、没有刃口——换挡后每一刀都是「双影」。
    /// 池化（最多 16 道，低画质 10 道、不画残月，满了复用最老的），网格顶点数固定，复用时只重写顶点位置 / 颜色。纯视觉，不做判定。
    /// </summary>
    public sealed class WarlordArc : MonoBehaviour, IFxSlot
    {
        const int MaxArcs = 16, MaxArcsLow = 10;
        /// <summary>残月比主月牙晚多久（秒）</summary>
        const float EchoDelay = 0.05f;
        static readonly List<WarlordArc> pool = new();

        WarlordCrescentMesh main, echo;
        Transform echoRoot;
        float age, life, radius, arc, width, fury, reveal, seed;
        int dir, gen;
        bool active, withEcho;

        /// <summary>此刻在播的月牙数（测试 / 预算读）</summary>
        public static int Live
        {
            get
            {
                int n = 0;
                foreach (var a in pool)
                    if (a && a.active)
                        n++;
                return n;
            }
        }

        int IFxSlot.Generation => gen;
        bool IFxSlot.IsActive => active;
        void IFxSlot.CancelFx() => life = Mathf.Min(life, age + 0.06f);
        void IFxSlot.RetargetFx(Vector3 from, Vector3 to) { }
        void IFxSlot.MoveFx(Vector3 position) => transform.position = position;

        /// <summary>
        /// 生成一弯月牙：yaw / tilt（绕前方轴倾斜，弧度）/ pitchDeg（整弯往前低头）定朝向；echo = −1 按狂怒自动、0 不要、1 要
        /// </summary>
        public static FxHandle Spawn(Vector3 center, float yawDeg, float radius, float arc, int dir, float tilt, float width, float life, float fury, float pitchDeg = 0f,
            float reveal = 0.5f, int echo = -1) =>
            SpawnRotated(center,
                Quaternion.Euler(0, yawDeg, 0) * Quaternion.AngleAxis(pitchDeg, Vector3.right) * Quaternion.AngleAxis(-tilt * Mathf.Rad2Deg, Vector3.forward),
                radius, arc, dir, width, life, fury, reveal, echo);

        /// <summary>同上，直接给朝向（月牙在局部 XZ 面、拱向局部 +Z）</summary>
        public static FxHandle SpawnRotated(Vector3 center, Quaternion rotation, float radius, float arc, int dir, float width, float life, float fury, float reveal = 0.5f,
            int echo = -1)
        {
            if (!Fx.Finite(center) || !(radius > 0.1f)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            var s = Take(rt.transform);
            s.gen++;
            s.active = true;
            s.age = 0;
            s.life = Mathf.Max(0.08f, life);
            s.radius = radius;
            s.arc = Mathf.Clamp(arc, 0.1f, Mathf.PI * 2f);
            s.width = Mathf.Clamp(width, 0.1f, radius * 0.8f);
            s.dir = dir >= 0 ? 1 : -1;
            s.fury = Mathf.Clamp01(fury);
            s.reveal = Mathf.Clamp(reveal, 0f, 1.15f);
            s.seed = Random.value * 6.28f;
            bool fine = QualityProfile.Current.particleDensity > 0.5f;
            s.withEcho = fine && (echo > 0 || echo < 0 && s.fury > 0.5f);
            s.transform.SetPositionAndRotation(center, rotation);
            s.transform.localScale = Vector3.one;
            s.gameObject.SetActive(true);
            s.Paint();
            return new FxHandle(s);
        }

        static WarlordArc Take(Transform parent)
        {
            WarlordArc oldest = null;
            int cap = QualityProfile.Current.particleDensity > 0.5f ? MaxArcs : MaxArcsLow;
            for (int i = pool.Count - 1; i >= 0; i--)
            {
                var x = pool[i];
                if (!x)
                {
                    pool.RemoveAt(i);
                    continue;
                }
                if (!x.active) return x;
                if (!oldest || x.age / x.life > oldest.age / oldest.life) oldest = x;
            }
            if (pool.Count >= cap && oldest) return oldest;
            var go = new GameObject("Warlord Arc");
            go.transform.SetParent(parent, false);
            go.SetActive(false);
            var a = go.AddComponent<WarlordArc>();
            a.main = new WarlordCrescentMesh(go.transform, "Main");
            a.echoRoot = new GameObject("Echo").transform;
            a.echoRoot.SetParent(go.transform, false);
            a.echo = new WarlordCrescentMesh(a.echoRoot, "Echo");
            pool.Add(a);
            return a;
        }

        WarlordCrescentMesh.Look LookAt(float t, float alpha, float scale, bool edge, bool ember)
        {
            // 刀头：第一帧已在 reveal，前 40% 寿命缓出扫到尽头；刀尾：35% 寿命起从起点往刀头收
            float head = Mathf.Lerp(reveal, 1.12f, 1f - Mathf.Pow(1f - Mathf.Clamp01(t / 0.4f), 2.4f));
            float tail = Mathf.Clamp01((t - 0.35f) / 0.65f) * 1.15f;
            return new WarlordCrescentMesh.Look
            {
                radius = radius * scale, arc = arc, width = width * (fury > 0.5f ? 1.1f : 1f), head = head, tail = tail, grow = 1f + 0.08f * t, fury = fury,
                alpha = alpha, dry = 1f, seed = seed, dir = dir, offset = Vector3.zero, edge = edge, ember = ember,
            };
        }

        void Paint()
        {
            main.Paint(LookAt(age / life, 1f, 1f, true, false));
            float te = (age - EchoDelay) / life;
            bool showEcho = withEcho && te >= 0f && te < 1f;
            echo.SetVisible(showEcho);
            if (showEcho) echo.Paint(LookAt(te, 0.5f, 1.07f, false, true));
        }

        void Update()
        {
            if (!active) return;
            age += Time.deltaTime;
            if (age >= life + (withEcho ? EchoDelay : 0f))
            {
                active = false;
                gameObject.SetActive(false);
                return;
            }
            Paint();
        }

        void OnDestroy()
        {
            pool.Remove(this);
            main?.Destroy();
            echo?.Destroy();
        }
    }

    /// <summary>
    /// 飞行剑气的外观（剑士化 v2，设计单 §13.5；判定在 <see cref="WarlordWaveRunner"/>）：一弯墨笔月牙（顶点 = 判定前沿）+ 身后两道淡下去的残月（拖影），
    /// 竖剑气竖着立在地上（下尖贴地）、横剑气平放在 0.55 m 高；飞行中月牙微微呼吸（缩放，不重画网格），从顶点往后甩铜火星（走 <see cref="Fx.Burst"/>，过预算），
    /// 竖剑气的下尖犁地再带一撮。出生 0.06 s 从 60% 撑满，Cancel 后 0.1 s 淡掉。网格只在出生 / 淡出时重画，中间只挪位置。
    /// 池化（最多 10 道，低画质不画残月）
    /// </summary>
    public sealed class WarlordWaveFx : MonoBehaviour, IFxSlot
    {
        const int MaxWaves = 10;
        const float Arc = 110f * Mathf.Deg2Rad, FadeIn = 0.06f, FadeOut = 0.1f, MaxLife = 4f;
        static readonly List<WarlordWaveFx> pool = new();
        /// <summary>残月：沿飞行方向往后的距离（米）、不透明度、半径倍率</summary>
        static readonly float[] EchoBack = { 0.8f, 1.6f }, EchoAlpha = { 0.42f, 0.2f }, EchoScale = { 0.95f, 0.9f };

        WarlordCrescentMesh main;
        readonly WarlordCrescentMesh[] echoes = new WarlordCrescentMesh[2];
        Transform pivot;
        float age, fadeT = -1f, radius, width, sparkAcc, painted = -1f, seed;
        int gen;
        bool active, vertical, fury, fine;

        public static int Live
        {
            get
            {
                int n = 0;
                foreach (var w in pool)
                    if (w && w.active)
                        n++;
                return n;
            }
        }

        int IFxSlot.Generation => gen;
        bool IFxSlot.IsActive => active;
        void IFxSlot.CancelFx()
        {
            if (fadeT < 0) fadeT = 0;
        }

        void IFxSlot.RetargetFx(Vector3 from, Vector3 to) { }
        void IFxSlot.MoveFx(Vector3 position) => transform.position = position;

        /// <summary>origin = 前沿起点（地面高度）；halfWidth / height = 横剑气半宽 / 竖剑气高度（米）</summary>
        public static FxHandle Spawn(Vector3 origin, Vector3 dir, bool vertical, float halfWidth, float height, bool fury)
        {
            if (!Fx.Finite(origin)) return FxHandle.None;
            var rt = FxRuntime.Ensure();
            if (!rt) return FxHandle.None;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            var s = Take(rt.transform);
            s.gen++;
            s.active = true;
            s.age = 0;
            s.fadeT = -1f;
            s.painted = -1f;
            s.sparkAcc = 0;
            s.vertical = vertical;
            s.fury = fury;
            s.fine = QualityProfile.Current.particleDensity > 0.5f;
            s.seed = Random.value * 6.28f;
            float half = vertical ? Mathf.Max(0.8f, height * 0.5f) : Mathf.Max(0.8f, halfWidth);
            s.radius = half / Mathf.Sin(Arc * 0.5f);
            s.width = vertical ? 0.75f : fury ? 1f : 0.85f;
            s.transform.SetPositionAndRotation(origin, Quaternion.LookRotation(dir, Vector3.up));
            // 竖剑气：绕前方轴转 90°（月牙立起来，下尖贴地）；横剑气：平放在 0.55 m 高
            s.pivot.localPosition = vertical ? Vector3.up * half : Vector3.up * 0.55f;
            s.pivot.localRotation = vertical ? Quaternion.AngleAxis(90f, Vector3.forward) : Quaternion.identity;
            s.pivot.localScale = Vector3.one * 0.6f;
            s.gameObject.SetActive(true);
            s.Paint(0f);
            return new FxHandle(s);
        }

        static WarlordWaveFx Take(Transform parent)
        {
            WarlordWaveFx oldest = null;
            for (int i = pool.Count - 1; i >= 0; i--)
            {
                var x = pool[i];
                if (!x)
                {
                    pool.RemoveAt(i);
                    continue;
                }
                if (!x.active) return x;
                if (!oldest || x.age > oldest.age) oldest = x;
            }
            if (pool.Count >= MaxWaves && oldest) return oldest;
            var go = new GameObject("Warlord Sword Wave");
            go.transform.SetParent(parent, false);
            go.SetActive(false);
            var w = go.AddComponent<WarlordWaveFx>();
            w.pivot = new GameObject("Pivot").transform;
            w.pivot.SetParent(go.transform, false);
            w.main = new WarlordCrescentMesh(w.pivot, "Wave");
            for (int i = 0; i < w.echoes.Length; i++) w.echoes[i] = new WarlordCrescentMesh(w.pivot, "Wave Echo " + i);
            pool.Add(w);
            return w;
        }

        void Paint(float alpha)
        {
            painted = alpha;
            var look = new WarlordCrescentMesh.Look
            {
                radius = radius, arc = Arc, width = width, head = 1.12f, tail = 0f, grow = 1f, fury = fury ? 1f : 0f, alpha = alpha, dry = 1f, seed = seed, dir = 1,
                // 月牙顶点放在原点（= 判定前沿）
                offset = new Vector3(0, 0, -radius), edge = true,
            };
            main.Paint(look);
            for (int i = 0; i < echoes.Length; i++)
            {
                bool on = fine;
                echoes[i].SetVisible(on);
                if (!on) continue;
                var e = look;
                e.radius = radius * EchoScale[i];
                e.offset = new Vector3(0, 0, -e.radius - EchoBack[i] / Mathf.Max(0.3f, pivot.localScale.z));
                e.alpha = alpha * EchoAlpha[i];
                e.edge = false;
                e.ember = fury;
                echoes[i].Paint(e);
            }
        }

        void Update()
        {
            if (!active) return;
            float dt = Time.deltaTime;
            age += dt;
            float alpha;
            if (fadeT >= 0f)
            {
                fadeT += dt;
                alpha = 1f - fadeT / FadeOut;
                if (alpha <= 0f || age > MaxLife + FadeOut)
                {
                    active = false;
                    gameObject.SetActive(false);
                    return;
                }
            }
            else
            {
                alpha = Mathf.Clamp01(age / FadeIn);
                if (age > MaxLife) fadeT = 0f;
            }
            // 出生撑满、飞行中呼吸（只改缩放）
            float k = Mathf.Clamp01(age / FadeIn);
            float breathe = 1f + 0.04f * Mathf.Sin(age * 22f + seed);
            pivot.localScale = Vector3.one * (Mathf.Lerp(0.6f, 1f, k) * breathe);
            if (Mathf.Abs(alpha - painted) > 0.04f) Paint(alpha);
            // 火星：从顶点往后甩（过预算）
            sparkAcc += dt;
            if (sparkAcc < 0.05f || fadeT >= 0f) return;
            sparkAcc = 0;
            var c = fury ? WarlordPalette.FuryCopper : WarlordPalette.Copper;
            var back = -transform.forward;
            var top = pivot.position + (vertical ? Vector3.up * Random.Range(-0.6f, 0.9f) : transform.right * Random.Range(-1f, 1f) * radius * 0.6f);
            Fx.Burst(top, c, 2, 3f, 0.3f, 0.08f, vertical ? 3f : 6f);
            if (vertical) Fx.Burst(transform.position + Vector3.up * 0.1f + back * 0.3f, WarlordPalette.HotAt(fury ? 1f : 0f), 2, 4f, 0.25f, 0.07f, 9f);
        }

        void OnDestroy()
        {
            pool.Remove(this);
            main?.Destroy();
            foreach (var e in echoes) e?.Destroy();
        }
    }

    /// <summary>
    /// 熔心大剑（SM_BossWeapon_Greatsword，Unity 侧原来没挂上：部件骨架没有 socket_greatsword）+ 焰刃的常驻特效（设计单 §2）：
    ///   · 挂件：按蒙皮的绑定姿势（bindpose）把大剑对到握点骨 j_0_1_21_1_5 上（两份资产同一套导出，资产空间一致）；再按剑尖骨校一次朝向；
    ///   · 焰刃：剑身自发光走正式的 _E 发光遮罩（第二批收尾 C 路：art/pipeline/tools/emission_mask.py 的 warlord_sword，
    ///     R = 剑脊熔铜纹、G = 刃口；剑格 / 剑柄 / 配重不亮），写 SF_StylizedLit 的发光遮罩段（_GlowMask / _GlowMaskColor0..1，默认全黑跳过）。
    ///     平时剑脊留一点余烬、刃口几乎不亮；前摇（<see cref="Heat"/>）烧亮，狂怒（<see cref="Fury"/>）剑脊转亮铜、刃口白热。
    ///     （原来借底色贴图当 _EmissionMap，但大剑材质没开 _EMISSION 关键字，属性块开不了关键字——那层自发光其实一直没画出来。）
    ///     边光同步转白热；剑尖滴铜火星；狂怒时剑身两片火舌；
    ///   · 拖影（次级 · 暗月牙托亮刃，跟着真实的刀走）：<see cref="Smear"/> 起到 <see cref="EndSmear"/> 止，每帧记下剑身，
    ///     相邻两帧之间按握点插 3 份弧线（转角 slerp），画成两层带子：普通混合的暗衬（整条刀带压暗）+ 加法的亮刃（靠剑尖那一半最亮），0.2 s 内淡掉。
    ///   · 熔铜长刃（剑士化 v2 狂怒换挡，设计单 §13.8）：<see cref="Fury"/> 升起来以后，剑身外面裹一层熔铜火刃，一直烧出剑尖 40%（呼吸着伸缩），
    ///     两层带子：普通混合的赤色暗衬 + 加法的亮铜 / 白热芯；带子永远侧对着镜头（以剑身为轴的公告板），第一人称迎面也看得到一把更长的刃。
    /// 预算：拖影是一个对象两张固定顶点数的网格；熔铜长刃两张 3 × 10 顶点的网格；火星走 <see cref="Fx.Burst"/>（<see cref="FxBudget"/>）；低画质拖影段数减半、不插值。
    /// </summary>
    public sealed class WarlordBlade : MonoBehaviour
    {
        static readonly int GlowMaskId = Shader.PropertyToID("_GlowMask"), Glow0Id = Shader.PropertyToID("_GlowMaskColor0"),
            Glow1Id = Shader.PropertyToID("_GlowMaskColor1"), GlowShimmerId = Shader.PropertyToID("_GlowMaskShimmer"),
            RimColorId = Shader.PropertyToID("_RimColor"), RimStrengthId = Shader.PropertyToID("_RimStrength");

        /// <summary>剑身发光遮罩的贴图名（BC 去掉 _BC；Resources/Fx/GlowMasks/&lt;名&gt;_E.png）</summary>
        public const string MaskKey = "T_BossWeapon_Greatsword";

        const int MaxSamples = 40, Rows = 4;
        /// <summary>带子的四圈：沿剑身的位置（握点 → 剑尖 = 0..1）、亮刃亮度、白热程度、暗衬浓度</summary>
        static readonly float[] RowAt = { 0.3f, 0.72f, 0.96f, 1.06f };
        static readonly float[] RowEdge = { 0f, 0.55f, 1f, 0f };
        static readonly float[] RowHot = { 0f, 0.15f, 1f, 0.5f };
        static readonly float[] RowUnder = { 0.25f, 0.8f, 1f, 0.6f };

        public Transform grip, tip;
        /// <summary>前摇烧亮程度（0..1，WarlordBrain 每帧写）与狂怒换挡（0..1）</summary>
        public float Heat, Fury;
        [Tooltip("剑身走 _E 发光遮罩（关掉 = 只有边光；审阅截图切改前 / 改后用）")] public bool maskGlow = true;
        /// <summary>此刻写出去的剑脊 / 刃口发光强度（线性倍率，测试用）</summary>
        public float SpineGlow { get; private set; }
        public float EdgeGlow { get; private set; }
        /// <summary>剑身拿到了正式的发光遮罩</summary>
        public bool HasMask => emissionMask;
        /// <summary>剑长（米，握点 → 剑尖）</summary>
        public float Length { get; private set; } = 2.7f;
        /// <summary>熔铜长刃此刻伸出剑尖多少（相对剑长，0 = 没有；测试读）</summary>
        public float LongBlade { get; private set; }
        /// <summary>熔铜长刃伸出剑尖的比例（呼吸前）</summary>
        public const float LongBladeReach = 0.4f;
        /// <summary>拖影正在记录 / 还有没淡完的段</summary>
        public bool Smearing => smearing;
        public int SmearCount { get; private set; }

        Renderer[] renderers;
        MaterialPropertyBlock block;
        Texture2D emissionMask;
        Color rimBase = new(1f, 0.95f, 0.85f);
        float rimStrengthBase = 0.3f, emberAcc;
        readonly FlameTongue[] flames = new FlameTongue[2];

        // 拖影
        struct Sample
        {
            public Vector3 g, d;
            public float t;
        }

        readonly List<Sample> samples = new();
        bool smearing;
        float smearUntil;
        Mesh mesh, underMesh;
        MeshRenderer addR, underR;
        Vector3[] pos;
        Color[] colAdd, colUnder;
        GameObject trailGo;
        // 熔铜长刃
        const int EdgeSamples = 10;
        Mesh edgeMesh, edgeUnderMesh;
        MeshRenderer edgeAddR, edgeUnderR;
        Vector3[] edgePos, edgeUnderPos;
        Color[] edgeAdd, edgeUnder;

        public Vector3 Tip => tip ? tip.position : transform.position;
        public Vector3 Grip => grip ? grip.position : transform.position;
        public Vector3 Dir => (Tip - Grip).sqrMagnitude > 1e-6f ? (Tip - Grip).normalized : -transform.up;

        /// <summary>
        /// 把熔心大剑挂到握点骨上：prefab = 挂件预制体（EnemyCatalog.Attachments 里 bind = boss_warlord / greatsword 的那个），
        /// body = 本体的蒙皮渲染器（取握点骨的绑定姿势），tipBone = 剑尖骨（校朝向）。失败返回 null
        /// </summary>
        public static WarlordBlade Attach(GameObject prefab, Transform gripBone, Transform tipBone, SkinnedMeshRenderer body)
        {
            if (!prefab || !gripBone) return null;
            var inst = Instantiate(prefab, gripBone, false);
            inst.name = prefab.name;
            foreach (var c in inst.GetComponentsInChildren<Collider>(true))
            {
                c.enabled = false;
                Destroy(c);
            }
            // 绑定姿势：握点骨在蒙皮空间里的样子 = bindpose⁻¹；大剑网格的「资产空间」= 本体网格的资产空间，原点放在握点（剑柄），剑尖朝下
            var meshNode = inst.GetComponentInChildren<MeshRenderer>(true);
            int bi = body && body.bones != null ? System.Array.IndexOf(body.bones, gripBone) : -1;
            if (bi >= 0 && bi < body.sharedMesh.bindposes.Length && meshNode)
            {
                var bind = body.sharedMesh.bindposes[bi];
                var gripInSmr = bind.inverse.GetColumn(3);
                var swordMeshToRoot = inst.transform.worldToLocalMatrix * meshNode.transform.localToWorldMatrix;
                var rootLocal = bind * Matrix4x4.Translate(gripInSmr) * swordMeshToRoot.inverse;
                inst.transform.localPosition = rootLocal.GetColumn(3);
                inst.transform.localRotation = rootLocal.rotation;
                inst.transform.localScale = rootLocal.lossyScale;
            }
            var blade = inst.AddComponent<WarlordBlade>();
            blade.grip = gripBone;
            blade.tip = tipBone;
            blade.Init(meshNode);
            return blade;
        }

        void Init(Renderer meshNode)
        {
            // 校朝向：剑身（挂件资产空间的 -Y = 根节点的 -Y；网格节点带导入的轴向换算，不能用它的轴）对准握点 → 剑尖骨
            if (tip && grip && meshNode)
            {
                var want = tip.position - grip.position;
                var have = -transform.up;
                if (want.sqrMagnitude > 1e-4f)
                {
                    float off = Vector3.Angle(have, want);
                    if (off > 4f) transform.rotation = Quaternion.FromToRotation(have, want.normalized) * transform.rotation;
                    Length = want.magnitude;
                    if (off > 4f) Debug.Log($"[WarlordBlade] 绑定姿势对出来的剑身和剑尖骨差 {off:F1}°，已校正");
                }
            }
            // 只有大剑自己的网格（拖影挂在特效根下、火舌挂在握点骨上，都不在这里）
            var list = new List<Renderer>();
            foreach (var r in GetComponentsInChildren<Renderer>(true))
                if (r is MeshRenderer or SkinnedMeshRenderer && !r.GetComponent<FlameTongue>())
                    list.Add(r);
            renderers = list.ToArray();
            block = new MaterialPropertyBlock();
            var mat = meshNode ? meshNode.sharedMaterial : null;
            if (mat)
            {
                // 正式遮罩只配正式大剑的贴图（白盒 / 别的贴图没有遮罩：只走边光）
                var bc = mat.HasProperty("_BaseMap") ? mat.GetTexture("_BaseMap") : mat.mainTexture;
                if (bc && bc.name.StartsWith(MaskKey, System.StringComparison.Ordinal) && mat.HasProperty(GlowMaskId)) emissionMask = GlowMask.LoadMask(MaskKey);
                if (mat.HasProperty(RimColorId)) rimBase = mat.GetColor(RimColorId);
                if (mat.HasProperty(RimStrengthId)) rimStrengthBase = mat.GetFloat(RimStrengthId);
            }
            BuildTrail();
        }

        void Update()
        {
            float dt = Time.deltaTime;
            float glow = Mathf.Clamp01(Mathf.Max(Heat, Fury * 0.75f));
            var hot = WarlordPalette.HotAt(Fury);
            var copper = WarlordPalette.CopperAt(Fury);
            // 剑身发光遮罩：剑脊熔铜纹平时留一点余烬（熔铜橙），前摇烧亮、狂怒转亮铜带一点白；刃口平时几乎不亮，前摇烧成白热铜、狂怒常亮白热。
            // 层色转线性再乘强度、按向量写（同 GlowMask：SetColor 会把 > 1 的强度也做一遍伽马换算）
            bool lit = maskGlow && emissionMask;
            SpineGlow = lit ? 0.3f + 1.7f * glow + 0.5f * Fury : 0;
            EdgeGlow = lit ? 0.1f + 1.5f * glow + 1.2f * Fury : 0;
            var spine = (Vector4)(Color.Lerp(copper, hot, 0.3f * Fury).linear * SpineGlow);
            var edge = (Vector4)(Color.Lerp(copper, hot, 0.45f + 0.55f * Fury).linear * EdgeGlow);
            foreach (var r in renderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                if (emissionMask) block.SetTexture(GlowMaskId, emissionMask);
                block.SetVector(Glow0Id, spine);
                block.SetVector(Glow1Id, edge);
                // 剑脊的熔铜沿剑身流动闪烁，刃口稳一点
                block.SetVector(GlowShimmerId, new Vector4(0.4f, 0.15f, 0f, 7f));
                block.SetColor(RimColorId, Color.Lerp(rimBase, hot, glow));
                block.SetFloat(RimStrengthId, Mathf.Lerp(rimStrengthBase, 1.6f, glow));
                r.SetPropertyBlock(block);
            }
            // 剑尖滴铜火星（烧亮时更密）
            emberAcc += dt * (0.8f + 5f * glow);
            if (emberAcc >= 1f)
            {
                emberAcc = 0;
                Fx.Burst(Vector3.Lerp(Grip, Tip, Random.Range(0.55f, 1f)), copper, 2, 1.2f, 0.45f, 0.07f, 6f);
            }
            // 狂怒：剑身两片火舌（火苗永远往上窜）
            for (int i = 0; i < flames.Length; i++)
            {
                if (Fury < 0.01f && !flames[i]) continue;
                if (!flames[i] && grip)
                {
                    flames[i] = FlameTongue.Attach(grip, Vector3.zero, Vector3.one, WarlordPalette.FuryHot, WarlordPalette.FuryCopper, WarlordPalette.FuryDeep);
                    if (!flames[i]) continue;
                }
                float at = i == 0 ? 0.42f : 0.8f;
                flames[i].transform.position = Vector3.Lerp(Grip, Tip, at);
                float s = (i == 0 ? 1.15f : 0.9f) * (0.85f + 0.15f * Mathf.Sin(Time.time * 9f + i));
                flames[i].Set(Fury * 0.9f, new Vector3(s, s * 1.6f, s));
            }
        }

        // ───────────── 拖影 ─────────────

        /// <summary>开始记拖影（片段的 smear 事件），最长 seconds 秒后自己停</summary>
        public void Smear(float seconds = 0.35f)
        {
            if (!smearing) samples.Clear();
            smearing = true;
            smearUntil = Time.time + Mathf.Max(0.05f, seconds);
            SmearCount++;
            Record();
        }

        /// <summary>停止记录（片段的 smearEnd 事件 / 释放帧之后）：已有的段 0.2 s 内淡掉</summary>
        public void EndSmear() => smearing = false;

        void Record()
        {
            if (!grip || !tip) return;
            var s = new Sample { g = Grip, d = Dir, t = Time.time };
            bool fine = QualityProfile.Current.particleDensity > 0.5f;
            if (samples.Count > 0 && fine)
            {
                // 相邻两帧之间插 3 份：握点线性、剑身方向 slerp（大剑挥过的是弧，不是弦）
                var p = samples[^1];
                for (int k = 1; k <= 3; k++)
                {
                    float u = k / 4f;
                    samples.Add(new Sample { g = Vector3.Lerp(p.g, s.g, u), d = Vector3.Slerp(p.d, s.d, u), t = Mathf.Lerp(p.t, s.t, u) });
                }
            }
            samples.Add(s);
            while (samples.Count > MaxSamples) samples.RemoveAt(0);
        }

        void LateUpdate()
        {
            PaintLongBlade();
            if (smearing)
            {
                if (Time.time > smearUntil) smearing = false;
                else Record();
            }
            const float Fade = 0.2f;
            samples.RemoveAll(x => Time.time - x.t > Fade + 0.12f);
            bool show = samples.Count >= 2;
            if (addR) addR.enabled = show;
            if (underR) underR.enabled = show;
            if (!show) return;
            PaintTrail(Fade);
        }

        void BuildTrail()
        {
            trailGo = new GameObject("Blade Smear");
            trailGo.transform.SetParent(FxRuntime.Ensure() ? FxRuntime.Ensure().transform : null, false);
            int n = MaxSamples * Rows;
            pos = new Vector3[n];
            colAdd = new Color[n];
            colUnder = new Color[n];
            var uv = new Vector2[n];
            for (int i = 0; i < MaxSamples; i++)
                for (int k = 0; k < Rows; k++)
                    uv[i * Rows + k] = new Vector2(i / (float)(MaxSamples - 1), RowEdge[k] > 0 ? 0.6f + 0.4f * RowEdge[k] : k == 0 ? 0f : 1f);
            var idx = new int[(MaxSamples - 1) * (Rows - 1) * 6];
            int w = 0;
            for (int i = 0; i < MaxSamples - 1; i++)
                for (int k = 0; k < Rows - 1; k++)
                {
                    int a = i * Rows + k, b = a + Rows;
                    idx[w++] = a; idx[w++] = a + 1; idx[w++] = b;
                    idx[w++] = a + 1; idx[w++] = b + 1; idx[w++] = b;
                }
            mesh = NewMesh("Blade Smear", uv, idx, colAdd);
            underMesh = NewMesh("Blade Smear Underlay", uv, idx, colUnder);
            underR = AddRenderer(trailGo, "Under", underMesh, FxMaterials.AlphaBlend, -1);
            addR = AddRenderer(trailGo, "Edge", mesh, FxMaterials.Additive, 0);
            BuildLongBlade();
        }

        // ───────────── 熔铜长刃（狂怒） ─────────────

        void BuildLongBlade()
        {
            int n = EdgeSamples * 3;
            edgePos = new Vector3[n];
            edgeUnderPos = new Vector3[n];
            edgeAdd = new Color[n];
            edgeUnder = new Color[n];
            var uv = new Vector2[n];
            for (int i = 0; i < EdgeSamples; i++)
                for (int k = 0; k < 3; k++)
                    uv[i * 3 + k] = new Vector2(i / (float)(EdgeSamples - 1), k * 0.5f);
            var idx = new int[(EdgeSamples - 1) * 2 * 6];
            int w = 0;
            for (int i = 0; i < EdgeSamples - 1; i++)
                for (int k = 0; k < 2; k++)
                {
                    int a = i * 3 + k, b = a + 3;
                    idx[w++] = a; idx[w++] = a + 1; idx[w++] = b;
                    idx[w++] = a + 1; idx[w++] = b + 1; idx[w++] = b;
                }
            edgeMesh = new Mesh { name = "Molten Long Blade" };
            edgeMesh.MarkDynamic();
            edgeMesh.vertices = edgePos;
            edgeMesh.uv = uv;
            edgeMesh.colors = edgeAdd;
            edgeMesh.triangles = idx;
            edgeUnderMesh = new Mesh { name = "Molten Long Blade Underlay" };
            edgeUnderMesh.MarkDynamic();
            edgeUnderMesh.vertices = edgeUnderPos;
            edgeUnderMesh.uv = uv;
            edgeUnderMesh.colors = edgeUnder;
            edgeUnderMesh.triangles = idx;
            edgeUnderR = AddRenderer(trailGo, "Long Blade Under", edgeUnderMesh, FxMaterials.AlphaBlend, -1);
            edgeAddR = AddRenderer(trailGo, "Long Blade", edgeMesh, FxMaterials.Additive, 1);
        }

        /// <summary>
        /// 熔铜长刃：沿剑身从 0.28 处一直到剑尖外 40%（呼吸 ±4%），宽度中段最宽、出剑尖后收成一个尖；带子以剑身为轴转到侧对镜头。
        /// 芯（中间那一列）白热、两边亮铜；暗衬宽一圈、赤色、普通混合
        /// </summary>
        void PaintLongBlade()
        {
            float k = Mathf.Clamp01((Fury - 0.05f) / 0.6f);
            bool show = k > 0.01f && grip && tip && edgeMesh;
            if (edgeAddR) edgeAddR.enabled = show;
            if (edgeUnderR) edgeUnderR.enabled = show;
            LongBlade = show ? LongBladeReach * k : 0f;
            if (!show) return;
            var g = Grip;
            var d = Dir;
            float len = Length;
            var cam = Camera.main;
            var mid = g + d * (len * 0.7f);
            var toCam = cam ? cam.transform.position - mid : Vector3.up;
            var side = Vector3.Cross(d, toCam);
            if (side.sqrMagnitude < 1e-6f) side = Vector3.Cross(d, Vector3.up);
            if (side.sqrMagnitude < 1e-6f) side = Vector3.right;
            side.Normalize();
            float t = Time.time;
            float reach = 1f + LongBlade * (0.92f + 0.08f * Mathf.Sin(t * 11f));
            var hot = WarlordPalette.Vertex(WarlordPalette.FuryHot);
            var copper = WarlordPalette.Vertex(WarlordPalette.FuryCopper);
            var deep = WarlordPalette.Vertex(WarlordPalette.FuryDeep);
            for (int i = 0; i < EdgeSamples; i++)
            {
                float u = i / (float)(EdgeSamples - 1);
                float along = Mathf.Lerp(0.28f, reach, u);
                // 宽度：剑身段 0.16–0.24 m（中段最宽），出剑尖后收尖；火苗一样沿剑身流动起伏
                float beyond = Mathf.Clamp01((along - 1f) / Mathf.Max(0.01f, reach - 1f));
                float wdt = (0.16f + 0.08f * Mathf.Sin(Mathf.PI * Mathf.Clamp01(u * 1.3f))) * (1f - beyond * beyond) * (0.9f + 0.1f * Mathf.Sin(t * 17f - u * 9f));
                var c = g + d * (len * along);
                for (int j = 0; j < 3; j++)
                {
                    int v = i * 3 + j;
                    float o = j - 1;
                    edgePos[v] = c + side * (wdt * o);
                    edgeUnderPos[v] = c + side * (wdt * 1.6f * o);
                    var ca = j == 1 ? Color.Lerp(copper, hot, 0.7f) : copper;
                    ca.a = k * (j == 1 ? 0.9f : 0.35f) * (1f - 0.6f * beyond);
                    edgeAdd[v] = ca;
                    var cu = deep;
                    cu.a = k * (j == 1 ? 0.55f : 0.2f) * (1f - 0.5f * beyond);
                    edgeUnder[v] = cu;
                }
            }
            edgeMesh.vertices = edgePos;
            edgeMesh.colors = edgeAdd;
            edgeMesh.RecalculateBounds();
            edgeUnderMesh.vertices = edgeUnderPos;
            edgeUnderMesh.colors = edgeUnder;
            edgeUnderMesh.RecalculateBounds();
        }

        Mesh NewMesh(string name, Vector2[] uv, int[] idx, Color[] col)
        {
            var m = new Mesh { name = name };
            m.MarkDynamic();
            m.vertices = pos;
            m.uv = uv;
            m.colors = col;
            m.triangles = idx;
            return m;
        }

        static MeshRenderer AddRenderer(GameObject parent, string name, Mesh m, Material mat, int order)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = m;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.sortingOrder = order;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            r.enabled = false;
            return r;
        }

        void PaintTrail(float fade)
        {
            float now = Time.time, len = Length;
            var hot = WarlordPalette.Vertex(WarlordPalette.HotAt(Fury));
            var tint = WarlordPalette.Vertex(WarlordPalette.CopperAt(Fury));
            var under = WarlordPalette.Vertex(WarlordPalette.Under);
            int count = samples.Count;
            for (int i = 0; i < MaxSamples; i++)
            {
                // 最旧的在前；不足 MaxSamples 时多出来的点叠在最新一段上（零面积）
                var s = samples[Mathf.Clamp(i - (MaxSamples - count), 0, count - 1)];
                float age = now - s.t;
                float life = Mathf.Clamp01(1f - age / fade);
                float head = i >= MaxSamples - 6 ? 1f : 0.6f;
                for (int k = 0; k < Rows; k++)
                {
                    int v = i * Rows + k;
                    pos[v] = s.g + s.d * (len * RowAt[k]);
                    float a = life * life * RowEdge[k];
                    var c = Color.Lerp(tint, hot, RowHot[k] * head);
                    c.a = Mathf.Clamp01(a * 1.2f);
                    colAdd[v] = c;
                    var u = under;
                    u.a = Mathf.Clamp01(life * RowUnder[k] * 0.7f);
                    colUnder[v] = u;
                }
            }
            mesh.vertices = pos;
            mesh.colors = colAdd;
            mesh.RecalculateBounds();
            underMesh.vertices = pos;
            underMesh.colors = colUnder;
            underMesh.RecalculateBounds();
        }

        void OnDestroy()
        {
            if (trailGo) Destroy(trailGo);
            if (mesh) Destroy(mesh);
            if (underMesh) Destroy(underMesh);
            if (edgeMesh) Destroy(edgeMesh);
            if (edgeUnderMesh) Destroy(edgeUnderMesh);
            foreach (var f in flames)
                if (f)
                    Destroy(f.gameObject);
        }
    }
}
