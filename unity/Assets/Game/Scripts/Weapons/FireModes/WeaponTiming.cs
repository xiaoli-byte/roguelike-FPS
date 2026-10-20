using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 武器状态机的时间常数（同 TS WeaponSystem 顶部的常量）与几个纯函数（EditMode 可测）。
    /// </summary>
    public static class WeaponTiming
    {
        /// <summary>切枪总时长（收枪 + 掏枪），期间不能开火</summary>
        public const float SwitchTime = 0.35f;
        /// <summary>其中收枪所占比例：前 40% 显示旧枪下沉，后 60% 新枪抬起</summary>
        public const float HolsterFrac = 0.4f;
        /// <summary>开火缓冲：提前按下也能在冷却结束时打出</summary>
        public const float FireBuffer = 0.14f;
        /// <summary>打空后（没按扳机时）自动换弹的延迟</summary>
        public const float AutoReloadDelay = 0.25f;
        /// <summary>
        /// 逐发装填结束（装满或被开火打断）后的上膛时间，期间不能开火。
        /// 没有它「装一发打一发」几乎不花额外时间，霰弹枪等于无限弹匣（TS 实测持续秒伤从约 85 涨到 140）
        /// </summary>
        public const float ShellRack = 0.3f;
        /// <summary>全自动 / 光束 / 机炮同一帧最多补发几发（高射速或掉帧时保证射速准确）</summary>
        public const int MaxCatchUp = 4;
        /// <summary>空仓音的最小间隔</summary>
        public const float DryInterval = 0.3f;
        /// <summary>应急补给：所有武器弹匣与备弹全空持续多久（只在有活着的敌人时）</summary>
        public const float StarveTime = 2.5f;
        /// <summary>机炮松手后转速归零的时间；蓄力线圈松手后转停的时间</summary>
        public const float SpinDown = 0.9f, CoilDown = 0.6f;
        /// <summary>整匣换弹的最短时间</summary>
        public const float MinReload = 0.2f;
        /// <summary>逐发装填被开火打断后，缓冲至少保留到上膛结束再多这么久（上膛完马上打出这一枪）</summary>
        public const float RackBufferPad = 0.05f;

        /// <summary>
        /// 切枪姿态（同 TS updateViewmodel）：先收后出。返回要显示旧枪（holster）还是新枪，以及下沉量 0..1。
        /// 没有旧枪（开局、拾取替换当前槽）时只有新枪从底下抬起。
        /// </summary>
        public static bool SwitchPose(float switchTimer, bool hasHolster, out float lower)
        {
            if (switchTimer <= 0)
            {
                lower = 0;
                return false;
            }
            float t = 1 - Mathf.Clamp01(switchTimer / SwitchTime);
            if (!hasHolster)
            {
                lower = 1 - t;
                return false;
            }
            if (t < HolsterFrac)
            {
                lower = t / HolsterFrac;
                return true;
            }
            lower = 1 - (t - HolsterFrac) / (1 - HolsterFrac);
            return false;
        }

        /// <summary>蓄力倍率（同 TS）：min + (1 − min) × t²（t = 蓄力 0..1；贯虹灵炮 min = 0.2）</summary>
        public static float ChargeMult(float minMult, float t)
        {
            t = Mathf.Clamp01(t);
            return minMult + (1 - minMult) * t * t;
        }
    }

    /// <summary>
    /// 扳机：开火缓冲 + 「按住只算一次」的闩（Unity 原有手感：冷却中按住不放，冷却一好就打出这一发）。
    /// 缓冲同 TS：按下时置为 <see cref="WeaponTiming.FireBuffer"/>，之后每帧递减。
    /// </summary>
    public sealed class TriggerState
    {
        public float buffer;
        /// <summary>这次按压已经打出过（松开后复位）</summary>
        public bool held;

        public bool Buffered => buffer > 0;

        public void Update(bool pressed, bool down, float dt)
        {
            if (!down) held = false;
            buffer = pressed ? WeaponTiming.FireBuffer : Mathf.Max(0, buffer - dt);
        }

        public bool Pulled(bool down) => buffer > 0 || (down && !held);

        public void Consume()
        {
            buffer = 0;
            held = true;
        }

        public void Reset()
        {
            buffer = 0;
            held = false;
        }
    }
}
