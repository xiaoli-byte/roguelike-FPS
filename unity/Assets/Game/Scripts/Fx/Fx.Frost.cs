using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰霜特效入口（FX3，docs/unity-parity.md）：碎冰、冰爆、霜气、星芒、冰环、冻雾、霜甲壳。第二章敌人经 <see cref="FrostKit"/> 调这里。
    /// 预设在 G/Fx/Presets/Frost*.cs，冰刺 / 霜甲壳 / 骨骼星芒是 SF_FxIce 与粒子图集上的程序化件（<see cref="IceSpikes"/>、<see cref="FrostShell"/>、
    /// <see cref="Spiritfire.Game.FrostGlint"/>），冻雾外观见 <see cref="FrostFogFx"/>。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>碎冰：冰块 + 冰碴 + 粉雾 + 闪粒 + 星芒（Presets/FrostShatter.cs）。size 0.3–4；color = 冰色（缺省 <see cref="FrostPalette.Ice"/>）</summary>
        public static FxHandle FrostShatter(Vector3 at, float size, Color color) => Play("FrostShatter", at, Vector3.up, color, size);

        public static FxHandle FrostShatter(Vector3 at, float size = 1f) => FrostShatter(at, size, FrostPalette.Ice);

        /// <summary>
        /// 冰爆（冷的爆炸）：主形是一簇低多边形冰晶从爆心长出来再崩开（<see cref="Spiritfire.Game.FrostBurst"/>），陪衬冰晶星芒、冰蓝粗环 + 冰蓝实心底、
        /// 两三团冷白雾团、几片冰碴、冷光、震屏（Presets/FrostNova.cs）。蓄 → 爆 → 余韵 0.6 s 内交代完。radius 0.6–8 m
        /// </summary>
        public static FxHandle FrostNova(Vector3 center, float radius, Color color)
        {
            var h = Play("FrostNova", center, Vector3.up, color, radius);
            if (h.Alive) Spiritfire.Game.FrostBurst.Spawn(center, radius);
            // 收尾一轮：不再铺霜纹贴花——白色的羽状霜在亮沙上是一片白噪点，冰爆炸完 0.6 s 就该退场（要留冻地的招式自己铺 FrostPatch）
            return h;
        }

        public static FxHandle FrostNova(Vector3 center, float radius) => FrostNova(center, radius, FrostPalette.Ice);

        /// <summary>霜气：几团往上飘的冷雾 + 闪粒（Presets/FrostVapour.cs）。size 0.3–3；color 按 55% 混进白雾</summary>
        public static FxHandle FrostVapour(Vector3 at, float size, Color color) => Play("FrostVapour", at, Vector3.up, color, size);

        /// <summary>星芒（一次性的「叮」：六芒冰晶星芒 + 小光核 + 闪粒；Presets/FrostGlint.cs）。size 0.2–3</summary>
        public static FxHandle FrostGlint(Vector3 at, float size, Color color) => Play("FrostGlint", at, Vector3.up, color, size);

        public static FxHandle FrostGlint(Vector3 at, float size = 1f) => FrostGlint(at, size, FrostPalette.IceHot);

        /// <summary>
        /// 冰环（Three.js spawnIceRing：雪狌狌跳砸落地、冰棘豪彘蓄刺爆开）：一圈向外斜的冰刺冒出 → 停留 → 缩回（<see cref="IceSpikes.Ring"/>），
        /// 两道贴地冲击环（雾白大环 + 冰白小环）、圈上翻起雪雾 / 雪花 / 冰碴、中心一记星芒、霜斑贴花（Presets/FrostRingBurst.cs）。纯视觉
        /// </summary>
        public static FxHandle IceRing(Vector3 ground, float radius, int spikes = 12)
        {
            if (!Finite(ground) || !(radius > 0)) return FxHandle.None;
            var at = ground + Vector3.up * 0.06f;
            Ring(at, radius, FrostPalette.Mist, 0.4f);
            Ring(at, radius * 0.55f, FrostPalette.IceHot, 0.25f, false);
            if (spikes > 0) IceSpikes.Ring(ground, radius, spikes);
            FxDecals.Frost(ground + Vector3.up * 0.02f, radius * 1.05f, 6f, 1.2f);
            return Play("FrostRingBurst", ground, Vector3.up, FrostPalette.Ice, radius);
        }

        /// <summary>冻雾外观（流动霜纹 + 续着的冷雾 + 闪粒 + 雪花）挂到 host 上；减速判定归 <see cref="FrostFog"/></summary>
        public static FrostFogFx FrostFogLook(GameObject host, Vector3 ground, float radius, float duration) => FrostFogFx.Attach(host, ground, radius, duration);

        /// <summary>地上一块流动霜纹（滑冰带、冻地）：半径 radius、duration 秒；句柄 Cancel 提前化掉</summary>
        public static FxHandle FrostPatch(Vector3 ground, float radius, float duration, float density = 1f) => FxDecals.Frost(ground, radius, duration, density);
    }
}
