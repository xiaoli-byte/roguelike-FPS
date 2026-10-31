using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟的色板（Q 路，设计单 docs/art/vfx/qilin.md §1）：
    ///   玄鳞 = 玄（冷墨）+ 暗金鳞光（重、稳、鳞甲块面）；焚身 = 白热芯 / 橙 / 赭红的火 + 紫褐云身、橙红亮边的火云（轻、狂、S 形翻卷）；
    ///   倒下 = 净火：暖白、淡金、祥云（瑞兽归正）。
    /// 和熔心魔将（W 路：铜、铁、斩——铜橙熔铜、铁灰、月牙刀光）拉开：麒麟不用铜色和刀光弧，用鳞（圆底尖顶的块面）、云（团块）、金。
    /// </summary>
    public static class QilinPalette
    {
        public static readonly Color Ink = Hex.Rgb(0x1c1822), ScaleDark = Hex.Rgb(0x3a3036), Gold = Hex.Rgb(0xd9a441), GoldHot = Hex.Rgb(0xffe6a8), Ochre = Hex.Rgb(0x8a5a1c);
        /// <summary>鳞刃弹丸的颜色：比鳞光再深一档的赭金（弹丸的光晕会把芯提亮，36 片叠在一起用金黄就刷成白花）</summary>
        public static readonly Color Blade = Hex.Rgb(0xc07a26);
        public static readonly Color FireCore = Hex.Rgb(0xfff0c0), Fire = Hex.Rgb(0xff7a1f), FireEdge = Hex.Rgb(0xb8361a);
        public static readonly Color Cloud = Hex.Rgb(0x6a2a3a), CloudLit = Hex.Rgb(0xff9a4a), BasaltDust = Hex.Rgb(0x5a4652);
        public static readonly Color Pure = Hex.Rgb(0xfff4dc), PureGold = Hex.Rgb(0xffd98a), Auspicious = Hex.Rgb(0xefe2c8);
    }

    /// <summary>
    /// 火麒麟专属特效入口（Q 路，2026-10-31；设计单 docs/art/vfx/qilin.md）。只管外观，不碰判定；释放帧的特效由招式在出手那一帧调（和伤害、震屏、音效同一帧），
    /// 姿势节拍（人立顶点、刨蹄、蜷身）由动画事件 fx:q* 经 <see cref="QilinBrain"/> 转来。粒子都过 FxBudget（数量先乘画质密度），
    /// 只有每招的主形（释放闪、冲击环）标成 essential。
    /// </summary>
    public static partial class Fx
    {
        // ───────────── 小工具 ─────────────

        static int QCount(int n, float lowKeep = 0.6f) => FxBudget.Allow(Mathf.RoundToInt(n * Mathf.Lerp(lowKeep, 1f, Density)), false);

        static void QOne(FxRuntime rt, string style, Vector3 at, Vector3 vel, float size, float life, Color c, bool essential = false)
        {
            var e = rt.GetEmitter(style);
            if (e != null && FxBudget.Allow(1, essential) > 0) rt.EmitOne(e, at, vel, size, life, c, 0);
        }

        // ───────────── 玄鳞 ─────────────

        /// <summary>人立顶点（动画事件 fx:qRearPeak）：鳞缝一齐迸出暗金鳞光、角根火珠一闪</summary>
        public static void QilinRearPeak(Vector3 chest, Vector3 pearl)
        {
            if (!Finite(chest)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var e = rt.GetEmitter("Ember");
            int n = QCount(14);
            for (int i = 0; e != null && i < n; i++)
            {
                var d = Random.onUnitSphere;
                d.y = Mathf.Abs(d.y) * 0.6f + 0.2f;
                rt.EmitOne(e, chest + d * Random.Range(0.8f, 1.6f), d * Random.Range(2f, 4f), Random.Range(0.12f, 0.2f), Random.Range(0.35f, 0.55f), QilinPalette.Gold * 1.4f, 0);
            }
            if (Finite(pearl)) QOne(rt, "Flare", pearl, Vector3.zero, 1.6f, 0.22f, QilinPalette.GoldHot * 1.6f, true);
        }

        /// <summary>
        /// 张鳞出手（释放帧）：脚下一圈暗金冲击环（鳞刃飞出去的范围读感）+ 一团暖白金闪（第一帧就到峰值）+ 玄铁鳞屑崩飞 + 砸地尘环（前蹄落地）
        /// </summary>
        public static void QilinScaleRelease(Vector3 feet, float radius)
        {
            if (!Finite(feet)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var mid = feet + Vector3.up * 1.2f;
            // 一闪只罩住身子（3.6 m），范围交给冲击环——不要一大团白
            QOne(rt, "ToonBurst", mid, Vector3.zero, 3.6f, 0.1f, QilinPalette.Gold * 1.5f, true);
            QOne(rt, "ToonRing", feet + Vector3.up * 0.15f, Vector3.zero, radius * 2.2f, 0.32f, QilinPalette.Gold * 1.5f, true);
            QOne(rt, "ToonDust", feet + Vector3.up * 0.05f, Vector3.zero, radius * 1.4f, 0.55f, QilinPalette.BasaltDust, false);
            var plate = rt.GetEmitter("Plate");
            int n = QCount(16, 0.5f);
            for (int i = 0; plate != null && i < n; i++)
            {
                float a = Random.value * Mathf.PI * 2f;
                var d = new Vector3(Mathf.Cos(a), Random.Range(0.3f, 0.9f), Mathf.Sin(a));
                rt.EmitOne(plate, mid + d * 0.6f, d * Random.Range(5f, 9f), Random.Range(0.16f, 0.26f), Random.Range(0.7f, 1f), QilinPalette.ScaleDark, 0);
            }
            Flash(mid, QilinPalette.GoldHot, 7f, radius * 3f, 0.16f);
        }

        /// <summary>刨蹄（动画事件 fx:qPaw）：蹄下往后甩一把暗金火星 + 一团玄武岩尘</summary>
        public static void QilinPaw(Vector3 hoof, Vector3 back)
        {
            if (!Finite(hoof)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            back.y = 0;
            back = back.sqrMagnitude > 1e-4f ? back.normalized : Vector3.back;
            var spark = rt.GetEmitter("Spark");
            int n = QCount(8);
            for (int i = 0; spark != null && i < n; i++)
                rt.EmitOne(spark, hoof + Vector3.up * 0.1f, (back + Random.insideUnitSphere * 0.5f + Vector3.up * 0.6f) * Random.Range(5f, 8f), Random.Range(0.08f, 0.13f),
                    Random.Range(0.25f, 0.4f), QilinPalette.Gold * 1.5f, 0);
            QOne(rt, "ToonSmoke", hoof + back * 0.4f + Vector3.up * 0.3f, back * 2.5f + Vector3.up * 0.6f, 1.1f, 0.6f, QilinPalette.BasaltDust);
        }

        /// <summary>冲撞起步（释放帧）：后蹄一蹬，身后炸开一圈尘环、两团尘云往后甩</summary>
        public static void QilinChargeLaunch(Vector3 feet, Vector3 dir)
        {
            if (!Finite(feet)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            QOne(rt, "ToonDust", feet + Vector3.up * 0.05f, Vector3.zero, 4.2f, 0.5f, QilinPalette.BasaltDust, true);
            for (int i = -1; i <= 1; i += 2)
            {
                var side = Vector3.Cross(Vector3.up, dir) * i;
                QOne(rt, "ToonSmoke", feet - dir * 1.5f + side * 1.1f + Vector3.up * 0.5f, (-dir * 4f + side * 2f) + Vector3.up, 1.8f, 0.7f, QilinPalette.BasaltDust);
            }
        }

        /// <summary>冲撞撞柱：玄铁鳞屑崩飞、金色眩晕星、砸地尘</summary>
        public static void QilinCrash(Vector3 head)
        {
            if (!Finite(head)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            QOne(rt, "ToonBurst", head, Vector3.zero, 2.2f, 0.1f, QilinPalette.GoldHot, true);
            var plate = rt.GetEmitter("Plate");
            int n = QCount(12, 0.5f);
            for (int i = 0; plate != null && i < n; i++)
                rt.EmitOne(plate, head, Random.onUnitSphere * Random.Range(4f, 7f) + Vector3.up * 3f, Random.Range(0.14f, 0.24f), Random.Range(0.7f, 1f), QilinPalette.ScaleDark, 0);
            var star = rt.GetEmitter("Star");
            int m = QCount(6);
            for (int i = 0; star != null && i < m; i++)
            {
                float a = i * Mathf.PI * 2f / Mathf.Max(1, m);
                rt.EmitOne(star, head + Vector3.up * 0.8f + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 0.9f, new Vector3(-Mathf.Sin(a), 0.2f, Mathf.Cos(a)) * 2.5f,
                    0.38f, 1.2f, QilinPalette.GoldHot, 0);
            }
        }

        /// <summary>
        /// 鳞甲崩裂（鼎角砸中 / 化焚身时鳞甲炸飞）：一大团玄铁鳞片四散翻滚、暗金鳞光、金色裂光一闪 + 贴地金环。size = 规模（1 = 鼎角砸中）
        /// </summary>
        public static void QilinScaleShatter(Vector3 center, float size)
        {
            if (!Finite(center)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            size = Mathf.Clamp(size, 0.5f, 2f);
            QOne(rt, "ToonBurst", center, Vector3.zero, 3.2f * size, 0.12f, QilinPalette.GoldHot * 1.4f, true);
            QOne(rt, "Flare", center, Vector3.zero, 3f * size, 0.25f, QilinPalette.Gold * 1.6f, true);
            var plate = rt.GetEmitter("Plate");
            int n = QCount(Mathf.RoundToInt(28 * size), 0.5f);
            for (int i = 0; plate != null && i < n; i++)
                rt.EmitOne(plate, center + Random.insideUnitSphere * 1.2f, Random.onUnitSphere * Random.Range(5f, 11f) + Vector3.up * 4f, Random.Range(0.2f, 0.36f),
                    Random.Range(0.8f, 1.2f), i % 4 == 0 ? QilinPalette.Ochre : QilinPalette.ScaleDark, 0);
            var e = rt.GetEmitter("Ember");
            int m = QCount(Mathf.RoundToInt(16 * size));
            for (int i = 0; e != null && i < m; i++)
                rt.EmitOne(e, center, Random.onUnitSphere * Random.Range(3f, 7f), Random.Range(0.12f, 0.2f), Random.Range(0.4f, 0.7f), QilinPalette.Gold * 1.5f, 0);
            Flash(center, QilinPalette.GoldHot, 8f, 10f * size, 0.2f);
        }

        /// <summary>鳞甲崩裂期间身上一闪一闪的金色裂光（每次一颗，<see cref="QilinBrain"/> 按节奏在受击球骨骼上调）：读作「全身都是弱点」</summary>
        public static void QilinCrackGlint(Vector3 at)
        {
            if (!Finite(at)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            QOne(rt, "Twinkle", at, Vector3.up * 0.3f, Random.Range(0.6f, 0.9f), 0.35f, QilinPalette.GoldHot * 1.6f);
        }

        /// <summary>前蹄砸地（人立落下 / 登场落地）：贴地尘环 + 几块碎岩</summary>
        public static void QilinStamp(Vector3 feet, float radius)
        {
            if (!Finite(feet)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            QOne(rt, "ToonDust", feet + Vector3.up * 0.05f, Vector3.zero, radius * 1.6f, 0.5f, QilinPalette.BasaltDust, true);
            var chunk = rt.GetEmitter("Chunk");
            int n = QCount(8, 0.5f);
            for (int i = 0; chunk != null && i < n; i++)
            {
                float a = Random.value * Mathf.PI * 2f;
                rt.EmitOne(chunk, feet + Vector3.up * 0.2f, new Vector3(Mathf.Cos(a) * 3f, Random.Range(3f, 6f), Mathf.Sin(a) * 3f), Random.Range(0.12f, 0.2f), 0.8f,
                    QilinPalette.ScaleDark, 0);
            }
        }

        // ───────────── 焚身 ─────────────

        /// <summary>
        /// 俯冲蓄势 / 吐息蓄火（每帧调）：火星从四周往 core 吸、core 处一团越来越大的卡通火苗。k = 蓄力进度 0..1（越到后面越密、越大），radius = 吸火的范围
        /// </summary>
        public static void QilinGather(Vector3 core, float radius, float k, float dt)
        {
            if (!Finite(core) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float expected = Mathf.Lerp(10f, 30f, k) * dt * Mathf.Lerp(0.6f, 1f, Density);
            int n = Mathf.FloorToInt(expected);
            if (Random.value < expected - n) n++;
            n = FxBudget.Allow(n, false);
            var mote = rt.GetEmitter("Ember");
            for (int i = 0; mote != null && i < n; i++)
            {
                var d = Random.onUnitSphere;
                const float life = 0.35f;
                var from = core + d * radius * Random.Range(0.7f, 1f);
                rt.EmitOne(mote, from, -d * (radius * 0.85f / life), Random.Range(0.12f, 0.2f), life, Color.Lerp(QilinPalette.Fire, QilinPalette.FireCore, k) * 1.3f, 0);
            }
            if (Random.value < dt * 14f)
            {
                var flame = rt.GetEmitter("ToonFlame");
                if (flame != null && FxBudget.Allow(1, false) > 0)
                    rt.EmitOne(flame, core, Vector3.up * 0.8f, Mathf.Lerp(0.6f, 1.6f, k), 0.3f, Color.Lerp(QilinPalette.Fire, QilinPalette.FireCore, k * 0.6f) * 1.2f, 0);
            }
        }

        /// <summary>蜷身顶点（动画事件 fx:qCoil）：胸前一团火「收拢」的一闪（往里缩的环）</summary>
        public static void QilinCoil(Vector3 chest)
        {
            if (!Finite(chest)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            QOne(rt, "ToonPop", chest, Vector3.zero, 2.4f, 0.16f, QilinPalette.Fire * 1.4f, true);
        }

        /// <summary>
        /// 踏云俯冲砸地（释放帧，火环之外的部分）：白热芯一闪（第一帧峰值）+ 一圈火云团（紫褐云身、橙红亮边的祥云团块）贴地往外滚，跟着火环前沿走一段再散；
        /// ringRadius / ringTime = 火环的最大半径 / 用时（云团走到火环一半的地方就散，不抢火环的读感）
        /// </summary>
        public static void QilinCloudImpact(Vector3 ground, float radius, float ringRadius, float ringTime)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            QOne(rt, "ToonBurst", ground + Vector3.up * 0.8f, Vector3.zero, radius * 1.5f, 0.1f, QilinPalette.FireCore * 1.4f, true);
            var smoke = rt.GetEmitter("ToonSmoke");
            int n = QCount(10, 0.6f);
            float speed = ringRadius * 0.5f / Mathf.Max(0.3f, ringTime * 0.6f);
            for (int i = 0; smoke != null && i < n; i++)
            {
                float a = (i + Random.value * 0.4f) * Mathf.PI * 2f / Mathf.Max(1, n);
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                var c = i % 2 == 0 ? QilinPalette.Cloud : Color.Lerp(QilinPalette.Cloud, QilinPalette.CloudLit, 0.45f);
                rt.EmitOne(smoke, ground + d * radius * 0.6f + Vector3.up * 0.5f, d * speed + Vector3.up * 0.3f, Random.Range(1.8f, 2.4f), Random.Range(0.7f, 0.9f), c, 0);
            }
            var flame = rt.GetEmitter("ToonFlame");
            int m = QCount(6);
            for (int i = 0; flame != null && i < m; i++)
            {
                float a = Random.value * Mathf.PI * 2f;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                rt.EmitOne(flame, ground + d * radius * 0.4f, d * 3f + Vector3.up * 5f, Random.Range(1.1f, 1.6f), 0.45f, QilinPalette.Fire * 1.3f, 0);
            }
        }

        /// <summary>焚身蹄下的一小团火云（踏云奔跑时按节奏调）：紫褐云团 + 一缕火苗，往下坠一点再散</summary>
        public static void QilinHoofCloud(Vector3 hoof)
        {
            if (!Finite(hoof)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            QOne(rt, "ToonSmoke", hoof, Vector3.down * 0.8f + Random.insideUnitSphere * 0.4f, Random.Range(0.8f, 1.1f), Random.Range(0.45f, 0.6f),
                Random.value < 0.5f ? QilinPalette.Cloud : Color.Lerp(QilinPalette.Cloud, QilinPalette.CloudLit, 0.4f));
            if (Random.value < 0.6f) QOne(rt, "ToonFlame", hoof, Vector3.up * 0.4f, Random.Range(0.5f, 0.75f), 0.3f, QilinPalette.Fire * 1.2f);
        }

        /// <summary>
        /// 踏云步态的一踏（第二批 B 路，动画事件 fx:qCloudH / fx:qCloudF）：蹄子往下一蹬，脚下一团紫褐火云被踩扁、往后拖开（云身 + 橙红亮边两团），
        /// 每对蹄子只有领头那只带一缕往上窜的火苗。back = 奔跑的反方向（云往身后拖）。一对蹄子 ≤ 5 颗粒子，0.4 s 踏一次
        /// </summary>
        public static void QilinCloudStep(Vector3 hoof, Vector3 back, bool lead)
        {
            if (!Finite(hoof)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            back.y = 0;
            back = back.sqrMagnitude > 1e-4f ? back.normalized : Vector3.back;
            QOne(rt, "ToonSmoke", hoof + Vector3.down * 0.2f, back * 3.2f + Vector3.down * 1.4f, Random.Range(1.2f, 1.5f), Random.Range(0.5f, 0.62f), QilinPalette.Cloud);
            QOne(rt, "ToonSmoke", hoof + Vector3.down * 0.35f + back * 0.3f, back * 4.5f + Vector3.down * 0.6f, Random.Range(0.8f, 1.05f), 0.42f,
                Color.Lerp(QilinPalette.Cloud, QilinPalette.CloudLit, 0.5f));
            if (lead) QOne(rt, "ToonFlame", hoof, Vector3.up * 1.2f - back * 0.6f, Random.Range(0.6f, 0.8f), 0.28f, QilinPalette.Fire * 1.25f);
        }

        /// <summary>吐息开口（breathStart / 吐息第一帧）：口前白热一闪 + 往前喷的一团火</summary>
        public static void QilinBreathIgnite(Vector3 mouth, Vector3 dir)
        {
            if (!Finite(mouth)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            QOne(rt, "ToonBurst", mouth, Vector3.zero, 2.2f, 0.1f, QilinPalette.FireCore * 1.3f, true);
            FlameJet(mouth, dir, 22f, 2.4f, QilinPalette.Fire, 0.5f);
            Flash(mouth, QilinPalette.Fire, 6f, 9f, 0.18f);
        }

        /// <summary>
        /// 火云雨的火云（取代原来顶上那张整片旋转的火盘：第一人称一抬头整屏都是橙色）：殿顶一圈环形的暗紫褐火云带（中间空着，抬头看得见落下来的火球），
        /// 下沿一圈橙红亮边；云带下面挂一圈大火云团。center = 殿心（地面），radius = 殿半径
        /// </summary>
        public static void QilinFireClouds(Vector3 center, float radius, float seconds)
        {
            if (!Finite(center)) return;
            var top = center + Vector3.up * 20f;
            float outer = radius * 0.95f, inner = radius * 0.42f;
            Surge.Annulus(top, inner, outer, SurgeKind.Molten, seconds, 12f, 0.3f, new Color(0.14f, 0.05f, 0.07f), new Color(1.4f, 0.42f, 0.1f), 0.92f);
            Surge.Annulus(top - Vector3.up * 0.8f, inner * 1.05f, inner * 1.35f, SurgeKind.Fire, seconds, -30f, -0.5f, null, null, 0.55f);
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var smoke = rt.GetEmitter("ToonSmoke");
            int n = QCount(12, 0.5f);
            float life = Mathf.Min(5f, seconds);
            for (int i = 0; smoke != null && i < n; i++)
            {
                float a = (i + Random.value * 0.5f) * Mathf.PI * 2f / Mathf.Max(1, n);
                float r = Mathf.Lerp(inner, outer, Random.Range(0.25f, 0.85f));
                var p = top + new Vector3(Mathf.Cos(a) * r, -1.5f - Random.value * 1.5f, Mathf.Sin(a) * r);
                var c = i % 3 == 0 ? Color.Lerp(QilinPalette.Cloud, QilinPalette.CloudLit, 0.5f) : QilinPalette.Cloud;
                rt.EmitOne(smoke, p, Vector3.down * 0.6f, Random.Range(5f, 7f), life, c, 0);
            }
        }

        // ───────────── 倒下 ─────────────

        /// <summary>净火归瑞（倒下的余韵）：身上的火熄掉之后，淡金光点和几团暖白祥云从身上升起、一圈淡金环——瑞兽归正，不是又一次爆炸</summary>
        public static void QilinPurify(Vector3 center, float size)
        {
            if (!Finite(center)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            QOne(rt, "ToonRing", new Vector3(center.x, center.y - size * 0.45f, center.z), Vector3.zero, size * 3.2f, 0.6f, QilinPalette.PureGold, true);
            var rise = rt.GetEmitter("GlowRise");
            int n = QCount(26);
            for (int i = 0; rise != null && i < n; i++)
                rt.EmitOne(rise, center + Random.insideUnitSphere * size * 0.7f, Vector3.up * Random.Range(1.5f, 3.5f) + Random.insideUnitSphere * 0.6f, Random.Range(0.18f, 0.3f),
                    Random.Range(1.2f, 1.8f), QilinPalette.PureGold * 1.2f, 0);
            var smoke = rt.GetEmitter("ToonSmoke");
            int m = QCount(6, 0.5f);
            for (int i = 0; smoke != null && i < m; i++)
            {
                float a = i * Mathf.PI * 2f / Mathf.Max(1, m);
                rt.EmitOne(smoke, center + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * size * 0.6f, Vector3.up * 1.2f, size * Random.Range(0.6f, 0.8f), 1.6f, QilinPalette.Auspicious, 0);
            }
            Flash(center, QilinPalette.Pure, 6f, size * 6f, 0.4f);
        }
    }
}
