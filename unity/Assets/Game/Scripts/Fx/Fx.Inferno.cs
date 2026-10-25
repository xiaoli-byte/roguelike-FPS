using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火狱特效入口（FX4，docs/unity-parity.md）：火药爆、熔铜 / 熔岩飞溅、碎岩甲、断链、火舌火柱、地上的火苗、地火贴花、熔铜流。
    /// 第三章敌人和第一章的火浣鼠 / 镇墓兽调这里。预设在 G/Fx/Presets/Inferno*.cs；火舌是 SF_FxFlame 面片（<see cref="FlameTongues"/>），
    /// 熔铜流见 <see cref="MoltenStream"/>，铁链见 <see cref="FxChain"/>，地火外观见 <see cref="FloorFireFx"/>，火苗毛着色见 <see cref="FlameKey"/>。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>
        /// 火药爆（Three.js gunpowderBlast：火团、金色火星、红纸屑、黑烟、金环、焦痕；Presets/InfernoGunpowder.cs）；
        /// 爆心离地不到 2.5 m 时地上再蹿一圈火舌火柱（radius × 0.35 散布、radius × 0.8 高）。radius 0.6–6 m
        /// </summary>
        public static FxHandle Gunpowder(Vector3 center, float radius, Color color)
        {
            var h = Play("InfernoGunpowder", center, Vector3.up, color, radius);
            float gy = GroundY(center + Vector3.up * 0.5f, 3.5f);
            if (!float.IsNegativeInfinity(gy) && center.y - gy < 2.5f)
                FlameTongues.Pillar(new Vector3(center.x, gy, center.z), radius * 0.35f, radius * 0.8f);
            return h;
        }

        public static FxHandle Gunpowder(Vector3 center, float radius) => Gunpowder(center, radius, InfernoPalette.Fire);

        /// <summary>熔铜 / 熔岩飞溅（熔滴、炭渣、火星、黑烟；Presets/InfernoMoltenSplash.cs）。size 0.3–3</summary>
        public static FxHandle MoltenSplash(Vector3 at, float size, Color color) => Play("InfernoMoltenSplash", at, Vector3.up, color, size);

        public static FxHandle MoltenSplash(Vector3 at, float size = 1f) => MoltenSplash(at, size, InfernoPalette.Molten);

        /// <summary>碎岩甲 / 渣墙崩碎（玄武岩块、红炭渣、熔滴、灰；Presets/InfernoBasalt.cs）。size 0.3–3</summary>
        public static FxHandle Basalt(Vector3 at, float size, Color color) => Play("InfernoBasalt", at, Vector3.up, color, size);

        public static FxHandle Basalt(Vector3 at, float size = 1f) => Basalt(at, size, InfernoPalette.Basalt);

        /// <summary>断链的崩断一瞬（铁环崩飞、断口火花、烧红的铁渣；Presets/InfernoChainBreak.cs）。散落的那截见 <see cref="FxChain.Drop"/></summary>
        public static FxHandle ChainBreak(Vector3 at, float size, Color color) => Play("InfernoChainBreak", at, Vector3.up, color, size);

        /// <summary>
        /// 火柱（Three.js spawnFlamePillar：一圈火舌从 ground 猛地蹿起再收回，约 0.7 s）+ 上冲的火星 + 一盏火光。
        /// radius = 火舌散布、height = 中间那片的高度；颜色缺省白热 → 橙 → 暗红
        /// </summary>
        public static FxHandle FlamePillar(Vector3 ground, float radius, float height, Color? hot = null, Color? mid = null, Color? tip = null)
        {
            if (!Finite(ground) || !(height > 0)) return FxHandle.None;
            var h = FlameTongues.Pillar(ground, radius, height, hot, mid, tip);
            var c = mid ?? FlameTongue.DefaultMid;
            Play("Ember", ground + Vector3.up * height * 0.5f, Vector3.up, c, Mathf.Clamp(height * 0.6f, 0.5f, 3f));
            Flash(ground + Vector3.up * height * 0.5f, c, 5f, Mathf.Max(4f, height * 2.5f), 0.25f);
            return h;
        }

        /// <summary>地上一簇跳动的火苗（Three.js spawnGroundFlames：余火、残焰）：count 片撒在 radius 内，duration 秒，size ≈ 火苗高（米）</summary>
        public static FxHandle GroundFlames(Vector3 center, float radius, int count, float duration, float size = 0.5f, Color? hot = null, Color? mid = null, Color? tip = null) =>
            FlameTongues.Ground(center, radius, count, duration, size, hot, mid, tip);

        /// <summary>
        /// 喷火的一团（祸斗 / 傩巫 / 铁牛吐火：沿喷射方向冲出去、边飞边往上卷的火舌团，加法 FlameBurst 风格）：
        /// from = 嘴，dir = 方向，speed = 初速（有阻尼：0.45 s 大约飞出 speed × 0.29 米），size = 直径
        /// </summary>
        public static void FlameJet(Vector3 from, Vector3 dir, float speed, float size, Color color, float life = 0.45f)
        {
            if (!Finite(from) || !Finite(dir)) return;
            var rt = FxRuntime.Ensure();
            if (!rt || FxBudget.Allow(1, false) <= 0) return;
            var e = rt.GetEmitter("FlameBurst");
            if (e == null) return;
            var v = dir.sqrMagnitude > 1e-6f ? dir.normalized * speed : Vector3.zero;
            rt.EmitOne(e, from, v + Vector3.up * 0.6f, Mathf.Max(0.05f, size), Mathf.Max(0.05f, life), color, 0);
        }

        /// <summary>只要外观、不伤人的一块地火（贴花 + 火舌）；会伤人、能被祸斗吃的地火用 <see cref="FloorFire.Spawn"/> 的 look 参数</summary>
        public static void FirePatch(Vector3 center, float radius, float duration, FireBed bed)
        {
            FxDecals.Fire(center + Vector3.up * 0.02f, radius, duration, bed);
            int n = Mathf.Clamp(Mathf.RoundToInt(2 + radius * 2), 2, 8);
            FlameTongues.Ground(center, radius * 0.75f, n, duration, Mathf.Clamp(0.35f + radius * 0.25f, 0.35f, 0.9f));
        }
    }
}
