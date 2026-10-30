using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第一章精英的出手点缀（首领与精英动作 · 特效调优 H 路；设计单 docs/art/vfx/elites-ch1.md）：只在精英身上出，叠在普通版的特效之上，
    /// 读作「这一下更重」——金色（fx-style §2.1 圣 / 金：亮芯暖白 <see cref="EliteStrike.Core"/>、主色金 <see cref="EliteStrike.Gold"/>、暗边赭金 <see cref="EliteStrike.Ochre"/>），
    /// 不改招式的颜色语义（火还是火、沙还是暖砂），预警配色照旧走 TelegraphTone。
    /// 节奏：起手一颗金芒「叮」（<see cref="EliteCue"/>，告诉玩家「精英要出重手了」）→ 蓄力时金点往出手的部位收 → 释放帧金色爆闪 + 「啪」环 + 顺着出手方向的金丝 → 重击落地多一圈金环、崩起石块。
    /// 每一层过 <see cref="FxBudget"/>；亮芯是 essential，点缀按密度缩。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>起手金芒：出手部位一颗四芒星 + 一团柔光（精英要出重手的信号），size ≈ 体型</summary>
        public static void EliteCue(Vector3 at, float size)
        {
            if (!Finite(at)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaOne(rt, "Flare", at, Vector3.zero, 1.6f * size, 0.2f, EliteStrike.Core);
            HanbaOne(rt, "Glow", at, Vector3.zero, 1.1f * size, 0.25f, EliteStrike.Gold);
        }

        /// <summary>蓄力金点（每帧调）：金色光点从 radius 外往 at 收，k = 蓄力进度（越到顶点越密）</summary>
        public static void EliteCharge(Vector3 at, float radius, float k, float dt)
        {
            if (!Finite(at) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            int n = HanbaCount(Mathf.Lerp(8f, 30f, Mathf.Clamp01(k)), dt);
            var e = rt.GetEmitter("Mote");
            for (int i = 0; e != null && i < n; i++)
            {
                var d = Random.onUnitSphere;
                float r = radius * Random.Range(0.8f, 1.1f), life = Random.Range(0.22f, 0.3f);
                rt.EmitOne(e, at + d * r, -d * r / life, Random.Range(0.09f, 0.15f) * Mathf.Max(1f, radius), life, EliteStrike.Gold, 0);
            }
        }

        /// <summary>
        /// 释放帧：金色爆闪星 + 「啪」环 + 顺着出手方向喷出的一束金丝 + 金色闪光灯。size ≈ 体型；dir = 出手方向（零向量 = 四散）
        /// </summary>
        public static void EliteRelease(Vector3 at, Vector3 dir, float size)
        {
            if (!Finite(at)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            // 爆闪不能盖住出手的身体（第一人称里轮廓要读得出）：星和环都比身体小一号，靠亮度和「啪」的形状读
            HanbaOne(rt, "ToonBurst", at, Vector3.zero, 0.95f * size, 0.1f, EliteStrike.Core);
            HanbaOne(rt, "ToonPop", at, Vector3.zero, 1.2f * size, 0.2f, EliteStrike.Gold);
            Flash(at, EliteStrike.Gold, 5f, 6f * size, 0.14f);
            bool aimed = dir.sqrMagnitude > 1e-4f;
            var f = aimed ? dir.normalized : Vector3.up;
            HanbaMany(rt, "StreakLight", 10, i =>
            {
                var d = aimed ? (f + Random.insideUnitSphere * 0.35f).normalized : Random.onUnitSphere;
                return (at, d * Random.Range(8f, 14f), Random.Range(0.06f, 0.09f) * Mathf.Max(1f, size * 0.7f), Random.Range(0.16f, 0.28f));
            }, EliteStrike.Gold);
        }

        /// <summary>弩口金星（精英齐射的每一发）：一颗小爆闪 + 两三根顺着弩矢方向的金丝</summary>
        public static void EliteMuzzle(Vector3 at, Vector3 dir)
        {
            if (!Finite(at)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            HanbaOne(rt, "ToonBurst", at, Vector3.zero, 0.9f, 0.08f, EliteStrike.Core, false);
            var f = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            HanbaMany(rt, "StreakLight", 3, i => (at, (f + Random.insideUnitSphere * 0.15f).normalized * Random.Range(14f, 20f), 0.06f, 0.12f), EliteStrike.Gold);
        }

        /// <summary>
        /// 齐射的五道弦光（精英蝎尾弩卫上弦的后半段，每帧调）：弩口沿扇形的 count 个方向往外甩金色细光，k 越大越密——
        /// 读得出「五支、扇形、从哪来」；fanStep = 相邻两支的夹角（弧度），和出手时的扇形一致
        /// </summary>
        public static void EliteVolleyRays(Vector3 muzzle, Vector3 forward, float fanStep, int count, float k, float dt)
        {
            if (!Finite(muzzle) || !(dt > 0) || count < 1) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            forward.y = 0;
            forward = forward.sqrMagnitude > 1e-4f ? forward.normalized : Vector3.forward;
            var e = rt.GetEmitter("StreakLight");
            if (e == null) return;
            int n = HanbaCount(Mathf.Lerp(20f, 60f, Mathf.Clamp01(k)), dt);
            for (int i = 0; i < n; i++)
            {
                int j = Random.Range(0, count);
                float a = (j - (count - 1) / 2f) * fanStep * Mathf.Rad2Deg;
                var d = Quaternion.AngleAxis(a, Vector3.up) * forward;
                rt.EmitOne(e, muzzle + d * Random.Range(0.1f, 0.4f), d * Random.Range(16f, 22f), 0.05f, Random.Range(0.1f, 0.16f), EliteStrike.Gold, 0);
            }
        }

        /// <summary>冲锋的金色尾迹（每帧调）：蹄下往后甩的金屑 + 暖砂（精英镇墓兽）</summary>
        public static void EliteTrail(Vector3 feet, Vector3 dir, float size, float dt)
        {
            if (!Finite(feet) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            dir.y = 0;
            dir = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward;
            int n = HanbaCount(36f, dt);
            var e = rt.GetEmitter("StreakLight");
            for (int i = 0; e != null && i < n; i++)
            {
                var side = Vector3.Cross(Vector3.up, dir) * Random.Range(-0.7f, 0.7f) * size;
                var v = (-dir * Random.Range(0.5f, 1f) + Vector3.up * Random.Range(0.4f, 1.1f)) * Random.Range(5f, 9f);
                rt.EmitOne(e, feet + side + Vector3.up * 0.2f, v, 0.07f, Random.Range(0.2f, 0.35f), EliteStrike.Gold, 0);
            }
        }

        /// <summary>
        /// 重击落地（精英镇墓兽踏地、精英蜃楼蟾火珠落地）：一圈贴地金环往外扩 + 金色爆闪 + 崩起的石块（方块）+ 往上溅的金丝。radius = 冲击半径（米）
        /// </summary>
        public static void EliteSlam(Vector3 ground, float radius)
        {
            if (!Finite(ground)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float r = Mathf.Max(0.5f, radius);
            HanbaOne(rt, "ToonRing", ground + Vector3.up * 0.07f, Vector3.zero, r * 0.65f, 0.34f, EliteStrike.Gold);
            HanbaOne(rt, "ToonBurst", ground + Vector3.up * 0.4f, Vector3.zero, r * 0.8f, 0.1f, EliteStrike.Core);
            HanbaMany(rt, "Chunk", 8, i =>
            {
                var d = Random.insideUnitCircle.normalized;
                return (ground + new Vector3(d.x, 0.2f, d.y) * r * 0.3f, new Vector3(d.x, 0, d.y) * Random.Range(2f, 4f) + Vector3.up * Random.Range(4.5f, 7f),
                    Random.Range(0.14f, 0.26f), Random.Range(0.6f, 0.9f));
            }, Hex.Rgb(0xa7804f));
            HanbaMany(rt, "StreakLight", 10, i =>
            {
                var d = Random.insideUnitSphere;
                d.y = Mathf.Abs(d.y) + 0.5f;
                return (ground + Vector3.up * 0.2f, d.normalized * Random.Range(7f, 11f), 0.08f, Random.Range(0.2f, 0.32f));
            }, EliteStrike.Gold);
        }
    }
}
