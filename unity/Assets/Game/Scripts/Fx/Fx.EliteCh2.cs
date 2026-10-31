using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第二章精英的出手点缀（首领与精英动作 · 特效调优 K 路；设计单 docs/art/vfx/elites-ch2.md）：只在精英身上出，
    /// 叠在普通版的冰霜特效和 H 路的通用金色点缀（<see cref="EliteCue"/> / <see cref="EliteCharge"/> / <see cref="EliteRelease"/>）之上。
    /// 配色按第二章冷色调：主形仍是冰（亮芯 <see cref="KunCore"/> / 冰蓝 <see cref="KunIce"/>），金（<see cref="EliteStrike.Gold"/>）只做外圈描边和亮芯里的一线——
    /// 读作「同一招，但这一下更重」，不改招式的元素语义；预警配色照旧走 TelegraphTone。
    /// 形状：冰的块面（崩起的冰块）+ 金的圆环（精英的「印」）；钳击是一对合拢的月牙（尖角 = 切割）。每一层过 <see cref="FxBudget"/>，亮芯 essential。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>起手的「精英印」：脚下一圈金环套一圈冰环（贴地平放），radius = 身体半径量级（米）</summary>
        public static void Ch2EliteSeal(Vector3 ground, float radius)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float r = Mathf.Max(0.5f, radius);
            KpOne(rt, "ToonRing", ground + Vector3.up * 0.07f, Vector3.zero, r * 1.4f, 0.42f, EliteStrike.Gold);
            KpOne(rt, "ToonRing", ground + Vector3.up * 0.08f, Vector3.zero, r * 0.9f, 0.3f, KunCore);
        }

        /// <summary>
        /// 重击落地的冰崩（精英冰喙猛啄、巨钳夹击）：贴地金环 + 冰白爆闪 + 一圈崩起的冰块（块面）+ 冰屑。radius = 冲击半径（米）
        /// </summary>
        public static void Ch2EliteIceSlam(Vector3 ground, float radius)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float r = Mathf.Max(0.5f, radius);
            KpOne(rt, "ToonRing", ground + Vector3.up * 0.07f, Vector3.zero, r * 1.3f, 0.36f, EliteStrike.Gold);
            KpOne(rt, "ToonBurst", ground + Vector3.up * 0.5f, Vector3.zero, r * 1.1f, 0.11f, KunCore);
            KpMany(rt, "IceChunk", 8, i =>
            {
                var d = Random.insideUnitCircle.normalized;
                return (ground + new Vector3(d.x, 0.2f, d.y) * r * 0.35f, new Vector3(d.x, 0, d.y) * Random.Range(2f, 4.5f) + Vector3.up * Random.Range(4.5f, 7.5f),
                    Random.Range(0.28f, 0.45f), Random.Range(0.6f, 0.85f));
            }, KunCore);
            KpMany(rt, "ShardIce", 10, i =>
            {
                var d = Random.onUnitSphere;
                d.y = Mathf.Abs(d.y) + 0.4f;
                return (ground + Vector3.up * 0.3f, d.normalized * Random.Range(5f, 9f), Random.Range(0.1f, 0.16f), Random.Range(0.3f, 0.5f));
            }, KunIce);
        }

        /// <summary>精英冰光的金芯：冰光里再穿一线金（细光束），终点一颗金星、沿线几颗金点（余韵）</summary>
        public static void Ch2EliteBeamCore(Vector3 from, Vector3 end)
        {
            if (!Finite(from) || !Finite(end)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            Beam(from, end, EliteStrike.Gold, 0.09f, 0.3f);
            KpOne(rt, "IceStar", end, Vector3.zero, 1.8f, 0.2f, EliteStrike.Gold);
            KpMany(rt, "Mote", 6, i => (Vector3.Lerp(from, end, (i + Random.value) / 6f), Random.insideUnitSphere * 0.4f + Vector3.up * 0.5f,
                Random.Range(0.12f, 0.18f), Random.Range(0.35f, 0.55f)), EliteStrike.Gold);
        }

        /// <summary>
        /// 精英巨钳夹击：一对敌方月牙像剪刀一样合拢（一道冰白从上往下、一道描金从下往上，竖着各倾 60°）+ 钳尖一记金星
        /// </summary>
        public static void Ch2EliteScissor(Vector3 at, float yaw, float size)
        {
            if (!Finite(at)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float r = 1.6f * Mathf.Max(0.5f, size);
            Slash(at + Vector3.up * 0.3f, yaw, r, 1.6f, 1, 1.05f, 0.4f * size, 0.2f, KunCore, true);
            Slash(at - Vector3.up * 0.1f, yaw, r, 1.6f, -1, -1.05f, 0.35f * size, 0.2f, EliteStrike.Gold, true);
            KpOne(rt, "IceStar", at, Vector3.zero, 1.6f * size, 0.18f, EliteStrike.Core);
        }

        /// <summary>
        /// 精英缩壳旋转的起转：贴地一圈大金环 + 冰刺环 + 冰白爆闪 + 冷光（「这一转更狠」）。radius = 旋壳半径（米）
        /// </summary>
        public static void Ch2EliteSpinBurst(Vector3 ground, float radius)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float r = Mathf.Max(0.5f, radius);
            KpOne(rt, "ToonRing", ground + Vector3.up * 0.07f, Vector3.zero, r * 2.6f, 0.4f, EliteStrike.Gold);
            KpOne(rt, "ToonBurst", ground + Vector3.up * 0.8f, Vector3.zero, r * 1.6f, 0.12f, KunCore);
            IceRing(ground, r * 1.4f, 10);
            Flash(ground + Vector3.up, KunIce, 5f, 8f * r, 0.14f);
        }

        /// <summary>精英横扫的冲击环：地波起点外面多一圈金环往外扩 + 一圈贴地冰环</summary>
        public static void Ch2EliteSweepRing(Vector3 ground, float radius)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            KpOne(rt, "ToonRing", ground + Vector3.up * 0.07f, Vector3.zero, radius * 1.1f, 0.4f, EliteStrike.Gold);
            KpOne(rt, "ToonRing", ground + Vector3.up * 0.09f, Vector3.zero, radius * 0.6f, 0.3f, KunCore);
        }
    }
}
