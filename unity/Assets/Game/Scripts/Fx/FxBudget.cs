using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 特效预算（FX1：同屏粒子要有上限、按画质可调）。三道闸：
    ///   1. 数量密度 <see cref="Fx.Density"/>（低 0.45 / 中 0.75 / 高 1）：每层发射的颗数先乘它；
    ///   2. 同屏总粒子上限 <see cref="ParticleCap"/>（低 1500 / 中 3000 / 高 5000）：所有共享发射器的存活粒子合计接近上限时，
    ///      新的发射按剩余空间等比缩减（剩 25% 以内开始缩，满了只留「只有一颗」的闪光核心），保证密集战斗时最重要的那一下还在；
    ///   3. 每种风格自己的上限（FxParticle.maxParticles × <see cref="StyleCapScale"/>）。
    /// 另外：贴花上限 <see cref="DecalCap"/>，状态粒子每帧的发射上限 <see cref="StatusEmitPerFrame"/>。
    /// 统计（<see cref="Live"/> / <see cref="Peak"/>）由 FxRuntime 每帧汇总，冒烟测试用来报同屏粒子数。
    /// </summary>
    public static class FxBudget
    {
        /// <summary>同屏粒子总上限（所有共享发射器的存活粒子之和）</summary>
        public static int ParticleCap => ArtQuality.Level switch
        {
            ArtQualityLevel.Low => 1500,
            ArtQualityLevel.Medium => 3000,
            _ => 5000,
        };

        /// <summary>每种粒子风格自己的上限倍率</summary>
        public static float StyleCapScale => ArtQuality.Level switch
        {
            ArtQualityLevel.Low => 0.5f,
            ArtQualityLevel.Medium => 0.75f,
            _ => 1f,
        };

        /// <summary>弹孔 / 焦痕同时存在的上限</summary>
        public static int DecalCap => ArtQuality.Level switch
        {
            ArtQualityLevel.Low => 40,
            ArtQualityLevel.Medium => 80,
            _ => 140,
        };

        /// <summary>状态外观（灼烧火舌、蚀液、电弧…）全场每帧最多发几颗</summary>
        public static int StatusEmitPerFrame => ArtQuality.Level switch
        {
            ArtQualityLevel.Low => 24,
            ArtQualityLevel.Medium => 48,
            _ => 80,
        };

        /// <summary>上一帧末尾所有共享发射器的存活粒子数</summary>
        public static int Live { get; internal set; }
        /// <summary>本次 Play 以来（或 <see cref="ResetPeak"/> 以来）的最大同屏粒子数</summary>
        public static int Peak { get; internal set; }
        /// <summary>因为预算被砍掉的粒子数（累计）</summary>
        public static int Dropped { get; internal set; }

        /// <summary>本帧已经发出的粒子（Live 是上一帧的，同一帧里的连续爆发也要算进去）</summary>
        static int emittedThisFrame, frame = -1;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Live = Peak = Dropped = 0;
            emittedThisFrame = 0;
            frame = -1;
        }

        public static void ResetPeak()
        {
            Peak = Live;
            Dropped = 0;
        }

        /// <summary>
        /// 预算允许的颗数：requested 是已经乘过密度的数量；essential（单颗闪光核心）总是放行。
        /// 存活数在上限的 75% 以下全放行，之后线性缩到 0。
        /// </summary>
        public static int Allow(int requested, bool essential)
        {
            if (requested <= 0) return 0;
            if (Time.frameCount != frame)
            {
                frame = Time.frameCount;
                emittedThisFrame = 0;
            }
            int allow = Scale(requested, essential, Live + emittedThisFrame, ParticleCap);
            if (allow < requested) Dropped += requested - allow;
            emittedThisFrame += allow;
            return allow;
        }

        /// <summary>砍量规则（纯函数）：已用 used、上限 cap；75% 以内全放行，之后线性缩到 0；essential 总是放行</summary>
        public static int Scale(int requested, bool essential, int used, int cap)
        {
            if (requested <= 0) return 0;
            if (essential || used <= cap * 3 / 4) return requested;
            float k = Mathf.Clamp01((cap - used) / (cap * 0.25f));
            return Mathf.RoundToInt(requested * k);
        }
    }
}
