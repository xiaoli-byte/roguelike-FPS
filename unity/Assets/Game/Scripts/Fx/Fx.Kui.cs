using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>夔的色板（docs/art/vfx/kui.md 第 0 节：一足之雷 / 鼓 / 雷暴，三阶色）</summary>
    public static class KuiPalette
    {
        /// <summary>夔的雷（落雷、鼓心、雷掌、回劈）：近白芯 / 紫红 / 靛紫暗边</summary>
        public static readonly Color ThunderCore = Hex.Rgb(0xfff4fd), Thunder = Hex.Rgb(0xe05ad8), ThunderEdge = Hex.Rgb(0x4a2a7a);
        /// <summary>鼓皮冲击环：暖白 / 鼓皮赭 / 暗赭</summary>
        public static readonly Color SkinCore = Hex.Rgb(0xfff0e0), Skin = Hex.Rgb(0xc89a6a), SkinEdge = Hex.Rgb(0x5a3a2a);
        /// <summary>雷云：亮缝 / 灰紫 / 暗云</summary>
        public static readonly Color CloudSeam = Hex.Rgb(0xc8b8ff), Cloud = Hex.Rgb(0x6a6080), CloudDark = Hex.Rgb(0x3a3448);
        /// <summary>山头尘：草甸灰褐 / 冷灰</summary>
        public static readonly Color Dust = Hex.Rgb(0x8a7a60), DustCold = Hex.Rgb(0x5a5a62);
    }

    /// <summary>
    /// 夔的招式特效（第四章移植 B1 路，设计单 docs/art/vfx/kui.md）。母题：一足之雷（竖直折线）、鼓（同心圆 + 鼓钉方块）、雷暴（团块雷云）。
    /// 大形一颗一个形（ToonBurst / ToonRing，essential）；点缀乘画质密度、过 <see cref="FxBudget"/>。只管外观，不碰判定；释放帧由招式在 Cue 那一帧调。
    /// 预警不在这里（危险填充统一 TelegraphTone 正红）。
    /// </summary>
    public static partial class Fx
    {
        // ───────────── 工具（B1 三领主共用）─────────────

        /// <summary>一颗大形（essential：预算满了也留着）</summary>
        internal static void LdOne(string style, Vector3 p, Vector3 v, float size, float life, Color c, bool essential = true)
        {
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var e = rt.GetEmitter(style);
            if (e == null || FxBudget.Allow(1, essential) < 1) return;
            rt.EmitOne(e, p, v, size, life, c, 0);
        }

        /// <summary>一次发 n 颗点缀（乘画质密度、过预算）；make(i) 给位置、速度、大小、寿命</summary>
        internal static void LdMany(string style, int n, System.Func<int, (Vector3 p, Vector3 v, float size, float life)> make, Color c)
        {
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var e = rt.GetEmitter(style);
            if (e == null) return;
            n = FxBudget.Allow(Mathf.RoundToInt(n * Mathf.Lerp(0.55f, 1f, Density)), false);
            for (int i = 0; i < n; i++)
            {
                var (p, v, size, life) = make(i);
                rt.EmitOne(e, p, v, size, life, c, 0);
            }
        }

        /// <summary>按每秒速率算这一帧发几颗（小数部分按概率进位），乘画质密度、过预算</summary>
        internal static int LdRate(float perSecond, float dt)
        {
            if (!(dt > 0) || !(perSecond > 0)) return 0;
            float expected = perSecond * dt * Mathf.Lerp(0.5f, 1f, Density);
            int n = Mathf.FloorToInt(expected);
            if (Random.value < expected - n) n++;
            return FxBudget.Allow(n, false);
        }

        internal static Color LdAlpha(Color c, float a) => new(c.r, c.g, c.b, a);

        internal static Vector3 LdDir(float yawDeg)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
        }

        // ───────────── 夔 · 落地 / 冲击环 ─────────────

        /// <summary>
        /// 落地 / 砸地的尘（高原草甸）：贴地一圈团块尘（祥云状，灰褐）+ 碎草皮块往外崩；size ≈ 冲击半径 / 4
        /// </summary>
        public static void KuiDust(Vector3 at, float size, int puffs = 6)
        {
            if (!Finite(at)) return;
            LdMany("ToonSmoke", puffs, i =>
            {
                float a = (i + Random.value * 0.5f) / Mathf.Max(1, puffs) * Mathf.PI * 2;
                var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                return (at + d * size * 0.8f + Vector3.up * 0.3f, d * Random.Range(2.5f, 4f) * size + Vector3.up * 0.6f, Random.Range(1.1f, 1.6f) * size, Random.Range(0.5f, 0.75f));
            }, LdAlpha(KuiPalette.Dust, 0.8f));
            LdMany("Chunk", Mathf.RoundToInt(puffs * 1.3f), i =>
            {
                var d = Random.insideUnitCircle.normalized;
                return (at + new Vector3(d.x, 0.2f, d.y) * size * 0.5f, new Vector3(d.x * Random.Range(3f, 6f), Random.Range(4f, 7f), d.y * Random.Range(3f, 6f)) * Mathf.Sqrt(size),
                    Random.Range(0.12f, 0.22f) * Mathf.Sqrt(size), Random.Range(0.6f, 0.9f));
            }, KuiPalette.Dust);
        }

        /// <summary>
        /// 鼓皮冲击环的点缀：环本体（赭色环带）是 BossHazards.Wave 自己画的；这里在环的前沿放一圈「鼓钉」（等距的方块，跟着前沿往外走）、
        /// 砸点暖白一闪（第一帧峰值）+ 一圈放射短刺。radius / seconds = 环扩到多大、用多久；last = 连环大跳最后一跳（鼓钉加紫红亮边）
        /// </summary>
        public static void KuiDrumRing(Vector3 center, float radius, float seconds, bool last = false)
        {
            if (!Finite(center)) return;
            float speed = radius / Mathf.Max(0.1f, seconds);
            const int studs = 16;
            LdMany("Plate", studs, i =>
            {
                float a = (i + 0.5f) / studs * Mathf.PI * 2;
                var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                return (center + d * 0.8f + Vector3.up * 0.35f, d * speed, 0.42f, seconds);
            }, last ? KuiPalette.Thunder : KuiPalette.Skin);
            LdOne("ToonBurst", center + Vector3.up * 0.7f, Vector3.zero, Mathf.Min(6f, radius * 0.38f), 0.12f, KuiPalette.SkinCore);
            LdOne("ToonRing", center + Vector3.up * 0.06f, Vector3.zero, Mathf.Min(8f, radius * 0.45f), 0.3f, KuiPalette.SkinCore);
            // 放射短刺：一圈贴地的短拉丝，读作「鼓皮被砸响」
            LdMany("Spray", 12, i =>
            {
                float a = (i + Random.value * 0.4f) / 12f * Mathf.PI * 2;
                var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                return (center + d * 0.6f + Vector3.up * 0.25f, d * Random.Range(14f, 18f) + Vector3.up * 1.5f, Random.Range(0.35f, 0.5f), 0.22f);
            }, KuiPalette.SkinCore);
            Flash(center + Vector3.up * 1.2f, KuiPalette.SkinCore, 5f, Mathf.Min(14f, radius), 0.12f);
        }

        /// <summary>单足蓄力的蹄下压痕：一小圈尘往外挤（k = 蓄力进度）</summary>
        public static void KuiCrouch(Vector3 hoof, float k)
        {
            if (!Finite(hoof)) return;
            LdMany("ToonSmoke", 2, i =>
            {
                var d = Random.insideUnitCircle.normalized;
                return (hoof + new Vector3(d.x, 0.15f, d.y) * 0.8f, new Vector3(d.x, 0.2f, d.y) * (1.2f + k), Random.Range(0.6f, 0.9f), 0.45f);
            }, LdAlpha(KuiPalette.Dust, 0.7f));
        }

        /// <summary>蹬地起跳：蹄下一圈尘冠（Surge 冠，草甸灰褐）+ 两团尘往后甩</summary>
        public static void KuiTakeoff(Vector3 hoof, Vector3 back, float size = 1f)
        {
            if (!Finite(hoof)) return;
            Surge.Crown(hoof, 1.2f * size, 1.6f * size, SurgeKind.Sand, 0.55f, KuiPalette.Dust, KuiPalette.DustCold, 0.85f);
            back.y = 0;
            back = back.sqrMagnitude > 1e-4f ? back.normalized : Vector3.back;
            LdMany("ToonSmoke", 3, i => (hoof + back * (0.6f + i * 0.4f) + Vector3.up * 0.4f, back * Random.Range(2f, 3.5f) + Vector3.up, Random.Range(1f, 1.4f) * size, 0.6f),
                LdAlpha(KuiPalette.Dust, 0.8f));
        }

        /// <summary>空中拖的一小截雷云尾（团块，0.4 s 消）</summary>
        public static void KuiCloudTrail(Vector3 at, Vector3 vel)
        {
            if (!Finite(at)) return;
            LdMany("ToonSmoke", 1, i => (at + Random.insideUnitSphere * 0.6f, -vel * 0.15f + Vector3.up * 0.3f, Random.Range(0.9f, 1.3f), 0.4f), LdAlpha(KuiPalette.Cloud, 0.75f));
        }

        // ───────────── 夔 · 雷掌 ─────────────

        /// <summary>雷掌前摇：两掌心各一颗紫红电球、掌间断续电弧（k = 前摇进度；前摇里每帧调）</summary>
        public static void KuiPalmCharge(Vector3 palmL, Vector3 palmR, float k, float dt)
        {
            if (!Finite(palmL) || !Finite(palmR)) return;
            int n = LdRate(Mathf.Lerp(10f, 40f, k), dt);
            for (int i = 0; i < n; i++)
            {
                var p = (i & 1) == 0 ? palmL : palmR;
                LdOne("Spark", p + Random.insideUnitSphere * 0.4f, Random.insideUnitSphere * 2f, Random.Range(0.08f, 0.14f), 0.2f, KuiPalette.Thunder, false);
            }
            if (Random.value < dt * Mathf.Lerp(2f, 9f, k)) Lightning(palmL, palmR, KuiPalette.Thunder, 0.05f + 0.05f * k);
        }

        /// <summary>
        /// 雷掌释放帧：两掌之间一道竖直雷缝（高 4 m，近白芯 + 紫红）+ 掌前闪光；扇面里六道紫红电弧往外射（读出 60° / range 的扇形）
        /// </summary>
        public static void KuiClap(Vector3 palms, float yawDeg, float range)
        {
            if (!Finite(palms)) return;
            Lightning(palms + Vector3.up * 2.2f, palms - Vector3.up * 1.8f, KuiPalette.ThunderCore, 0.22f);
            Lightning(palms + Vector3.up * 1.8f, palms - Vector3.up * 2.2f, KuiPalette.Thunder, 0.12f);
            LdOne("ToonBurst", palms, Vector3.zero, 3.2f, 0.12f, KuiPalette.ThunderCore);
            Flash(palms, KuiPalette.Thunder, 7f, 12f, 0.14f);
            var g = new Vector3(palms.x, palms.y, palms.z);
            for (int i = 0; i < 6; i++)
            {
                float a = yawDeg + Mathf.Lerp(-28f, 28f, (i + 0.5f) / 6f) + Random.Range(-4f, 4f);
                var end = palms + LdDir(a) * range * Random.Range(0.7f, 1f);
                end.y = GroundY(end) + 0.3f;
                Lightning(g, end, KuiPalette.Thunder, 0.06f);
            }
            LdMany("Spark", 14, i =>
            {
                var d = LdDir(yawDeg + Random.Range(-30f, 30f));
                return (palms, d * Random.Range(8f, 14f) + Vector3.up * Random.Range(-1f, 2f), Random.Range(0.1f, 0.16f), 0.3f);
            }, KuiPalette.ThunderCore);
        }

        // ───────────── 夔 · 捶胸引雷 / 回劈 / 破鼓 ─────────────

        /// <summary>捶胸的一捶：鼓心爆闪 + 一圈电火星 + 头顶云里亮一下（落雷由 LightningStrike 在 1.2 s 后兑现）</summary>
        public static void KuiDrumBeat(Vector3 core, bool big = false)
        {
            if (!Finite(core)) return;
            LdOne("ToonBurst", core, Vector3.zero, big ? 3.4f : 2.4f, 0.1f, KuiPalette.ThunderCore);
            Flash(core, KuiPalette.Thunder, big ? 8f : 5.5f, 10f, 0.12f);
            LdMany("Crackle", big ? 10 : 6, i => (core + Random.insideUnitSphere * 0.6f, Random.onUnitSphere * Random.Range(3f, 6f), Random.Range(0.12f, 0.2f), 0.25f), KuiPalette.Thunder);
            // 头顶云里的亮缝：一团亮紫的云块一闪
            LdOne("ToonSmoke", core + Vector3.up * 7f, Vector3.up * 0.5f, big ? 4.5f : 3.4f, 0.35f, LdAlpha(KuiPalette.CloudSeam, 0.7f), false);
        }

        /// <summary>鼓心常亮（捶胸 / 大跳落地后的窗口）：鼓心附近每帧零星的紫红电火星，提示「打这里」</summary>
        public static void KuiCoreGlow(Vector3 core, float dt, float k = 1f)
        {
            if (!Finite(core)) return;
            int n = LdRate(14f * k, dt);
            for (int i = 0; i < n; i++)
                LdOne("Spark", core + Random.insideUnitSphere * 0.45f, Random.onUnitSphere * 1.2f, Random.Range(0.07f, 0.12f), 0.22f, KuiPalette.Thunder, false);
        }

        /// <summary>经幡杆回劈：三道粗白雷从杆顶劈向胸口（比落雷粗一号、0.25 s）+ 胸口紫红爆 + 鼓心炸一下</summary>
        public static void KuiBacklash(Vector3 top, Vector3 chest)
        {
            if (!Finite(top) || !Finite(chest)) return;
            for (int i = 0; i < 3; i++)
                Lightning(top + Random.insideUnitSphere * 0.3f, chest + Random.insideUnitSphere * 0.6f, i == 0 ? KuiPalette.ThunderCore : KuiPalette.Thunder, 0.2f - i * 0.04f);
            LdOne("ToonBurst", chest, Vector3.zero, 4f, 0.14f, KuiPalette.ThunderCore);
            Flash(chest, KuiPalette.Thunder, 9f, 16f, 0.2f);
            LdMany("Crackle", 14, i => (chest + Random.insideUnitSphere, Random.onUnitSphere * Random.Range(4f, 8f), Random.Range(0.14f, 0.22f), 0.35f), KuiPalette.Thunder);
        }

        /// <summary>
        /// 破鼓：鼓面裂开一道竖直的光缝（近白芯 → 紫红，0.3 s 爆开）+ 鼓皮碎片崩飞（暗赭方块）+ 一圈紫红火星
        /// </summary>
        public static void KuiBreakDrum(Vector3 core, Vector3 forward)
        {
            if (!Finite(core)) return;
            Beam(core + Vector3.up * 1.1f, core - Vector3.up * 1.1f, KuiPalette.ThunderCore, 0.32f, 0.3f);
            LdOne("ToonBurst", core + forward * 0.3f, Vector3.zero, 4.2f, 0.14f, KuiPalette.ThunderCore);
            Flash(core, KuiPalette.Thunder, 10f, 14f, 0.2f);
            LdMany("Plate", 10, i =>
            {
                var d = (forward + Random.insideUnitSphere * 0.8f).normalized;
                return (core + d * 0.4f, d * Random.Range(5f, 9f) + Vector3.up * 2f, Random.Range(0.25f, 0.4f), Random.Range(0.8f, 1.1f));
            }, KuiPalette.SkinEdge);
            LdMany("Crackle", 16, i => (core, Random.onUnitSphere * Random.Range(4f, 9f), Random.Range(0.12f, 0.2f), 0.4f), KuiPalette.Thunder);
        }

        /// <summary>破鼓后留着的细光缝（破防期间每帧调）：鼓面一道细竖缝时亮时暗</summary>
        public static void KuiDrumSeam(Vector3 core, float dt)
        {
            if (!Finite(core) || Random.value > dt * 6f) return;
            Beam(core + Vector3.up * 0.8f, core - Vector3.up * 0.8f, KuiPalette.Thunder, 0.08f, 0.16f);
        }

        // ───────────── 夔 · 雷云（登场 / 死亡 / 背上云团）─────────────

        /// <summary>一团团雷云（暗云 / 灰紫）往上飘、偶尔闪一下亮缝：现身时从鼓里冒、死时身体化成的云</summary>
        public static void KuiCloud(Vector3 at, float spread, int n, bool seam = false)
        {
            if (!Finite(at)) return;
            LdMany("ToonSmoke", n, i => (at + Random.insideUnitSphere * spread, Vector3.up * Random.Range(1f, 2.4f) + Random.insideUnitSphere * 0.6f, Random.Range(1.2f, 2f), Random.Range(0.9f, 1.4f)),
                LdAlpha(i0(n) ? KuiPalette.CloudDark : KuiPalette.Cloud, 0.85f));
            if (seam && Random.value < 0.5f) LdOne("ToonSmoke", at + Random.insideUnitSphere * spread, Vector3.up, 1.6f, 0.3f, LdAlpha(KuiPalette.CloudSeam, 0.8f), false);
        }

        static bool i0(int n) => Random.value < 0.5f;

        /// <summary>残鼓被雷劈中：裂口紫红一亮 + 一圈电火星 + 鼓皮微尘</summary>
        public static void KuiDrumStruck(Vector3 drum)
        {
            if (!Finite(drum)) return;
            Flash(drum + Vector3.up, KuiPalette.Thunder, 8f, 14f, 0.18f);
            LdOne("ToonBurst", drum + Vector3.up * 0.8f, Vector3.zero, 3f, 0.12f, KuiPalette.ThunderCore);
            LdMany("Crackle", 10, i => (drum + Vector3.up * 0.8f, Random.onUnitSphere * Random.Range(3f, 7f), Random.Range(0.12f, 0.2f), 0.35f), KuiPalette.Thunder);
        }
    }
}
