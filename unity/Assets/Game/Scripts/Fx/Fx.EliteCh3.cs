using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第三章精英的熔铜点缀（首领与精英动作 · 特效调优 W 路；设计单 docs/art/vfx/elites-ch3.md）：
    /// 叠在三章共用的出手分量层 <see cref="EliteStrike"/>（squash / stretch、局部顿帧、精英金光）和通用金色点缀（H 路 Fx.EliteCh1.cs：
    /// 起手金芒 <see cref="EliteCue"/>、释放帧金色爆闪 <see cref="EliteRelease"/>、落地金环 <see cref="EliteSlam"/>）之上，只在精英身上放，招式数值和时机不变。
    /// 分工：闪光、「啪」环、金丝由金色那一套出，这里不再重复，只放第三章才有的形状。
    /// 第三章的母题跟熔心魔将同一套：熔铜（铜橙）、方块铜渣 / 铁片、紫褐烟、暗月牙托亮刃（<see cref="WarlordPalette"/>），
    /// 和精英的金色（全局精英词缀、金环，Q 路 / EliteStrike）分开：金 = 「这是精英」，铜 = 「这是第三章的力道」。
    /// 每个点缀都是一两个大形 + 少量方块碎屑，0.3–0.5 s 内交代完；粒子走 <see cref="Fx.Burst"/> / 预设（<see cref="FxBudget"/>）。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>蓄力顶点的一点铜芒（前摇到 85% 时调一次）：挂点一闪 + 几颗往上窜的铜火星——「要来了」</summary>
        public static void EliteCh3Glint(Vector3 at, float size = 1f)
        {
            if (!Finite(at)) return;
            Flash(at, WarlordPalette.Copper, 3.5f * size, 3.5f * size, 0.14f);
            Burst(at, WarlordPalette.Hot, Mathf.RoundToInt(5 * size), 2.5f, 0.3f, 0.06f * size, -3f);
        }

        /// <summary>
        /// 抡圈 / 横扫的释放帧：暗月牙托亮刃的铜色刀光（arc = 弧长，弧度；1.9π 约等于抡一整圈）+ 刀光外缘四块方铜渣 + 脚下紫褐尘
        /// </summary>
        public static void EliteCh3Crescent(Vector3 center, float yawDeg, float radius, float arc, int dir, float height = 1.1f)
        {
            if (!Finite(center)) return;
            // 月牙厚 1.3 m、活 0.36 s：亮沙地上要压得出来（第一次实拍 0.8 m 在侧面几乎只剩一条线）
            WarlordCrescent(center + Vector3.up * height, yawDeg, radius, arc, dir, 0f, 1.3f, 0f, 0.36f);
            for (int i = 0; i < 4; i++)
            {
                float a = (yawDeg + (i - 1.5f) / 4f * arc * Mathf.Rad2Deg) * Mathf.Deg2Rad;
                var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                WarlordShards(center + d * radius + Vector3.up * (height * 0.7f), d + Vector3.up * 0.4f, 0.6f, 0f, i == 0);
            }
            WarlordSmoke(center, radius * 0.35f, 2);
        }

        /// <summary>出手的那一喷（甩钩、齐射、喷吐；和 EliteRelease 同一帧）：顺着 dir 喷出的铜色拉丝火星 + 一团紫褐烟；paper = 再撒一把红纸屑（炮仗傀儡）</summary>
        public static void EliteCh3Burst(Vector3 at, Vector3 dir, float size = 1f, bool paper = false)
        {
            if (!Finite(at)) return;
            var d = dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.up;
            Burst(at + d * 0.3f, WarlordPalette.Copper, Mathf.RoundToInt(10 * size), 9f, 0.3f, 0.06f, 4f);
            WarlordSmoke(at + d * 0.5f, 0.5f * size, 2);
            if (paper) Burst(at + Vector3.up * 0.3f, Hex.Rgb(0xd8241c), Mathf.RoundToInt(12 * size), 4.5f, 1.1f, 0.12f, 3.5f);
        }

        /// <summary>
        /// 砸地 / 掀地的释放帧（和 EliteSlam 同一帧）：一圈方铜渣往外崩 + 紫褐尘团 + 一块小号的方形裂纹（WarlordImpact 的小号；金环由 EliteSlam 出）。
        /// 裂纹（第二批收尾 C 路）比魔将的短命、余热低一档：精英砸得多，地上不留一片
        /// </summary>
        public static void EliteCh3Impact(Vector3 ground, float radius)
        {
            if (!Finite(ground)) return;
            Ch3Crack(ground, radius * 1.25f, 0f, 4f, 0.8f, false);
            WarlordSmoke(ground + Vector3.up * 0.3f, radius * 0.6f, 3);
            int n = Mathf.Clamp(Mathf.RoundToInt(radius * 2f), 3, 6);
            float a0 = Random.value * Mathf.PI * 2f;
            for (int i = 0; i < n; i++)
            {
                float a = a0 + i / (float)n * Mathf.PI * 2f;
                var d = new Vector3(Mathf.Sin(a), 0.7f, Mathf.Cos(a));
                WarlordShards(ground + new Vector3(d.x, 0, d.z) * radius * 0.5f + Vector3.up * 0.15f, d, 0.7f, 0f, i == 0);
            }
        }
    }
}
