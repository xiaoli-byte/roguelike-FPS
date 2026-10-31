using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 破防条的配置（写在 <see cref="BossDef.breakBar"/>；null = 这只首领没有破防条，前三章不变）。数值见 combat 第 4 节各领主：
    /// 夔 900「破鼓」单膝跪 4 s、飞廉 800「珠碎」侧倒 4 s、化蛇 700「噎住」4 s、大鹗 1200「坠江」4.5 s、雷泽雷神 1500「神颓」5 s
    /// </summary>
    public sealed class BreakBarDef
    {
        /// <summary>第一次破防要填多少（伤害当量）</summary>
        public float max = 900f;
        /// <summary>每破一次，下一次多要这么多（0.25 = +25%）</summary>
        public float growth = 0.25f;
        /// <summary>破防倒地 / 跪下的秒数（3.5–5）</summary>
        public float seconds = 4f;
        /// <summary>破防期间受伤倍率（+30%）</summary>
        public float takenMult = 1.3f;
        /// <summary>破防姿势（Animator 状态名；没有这个状态时只打一次警告）与破防名（横幅 / 浮字：「破鼓」）</summary>
        public string pose = "down", label = "破防";
        /// <summary>打弱点按伤害 × weakFill 填；反应伤害按 × reactionFill 填（网页版 1.5）；别的伤害不填</summary>
        public float weakFill = 1f, reactionFill = 1.5f;
        /// <summary>只在出招中的某些段才填（null = 任何时候都填；化蛇只在张嘴时）</summary>
        public Func<BossBrain, bool> fillWhen;
    }

    /// <summary>
    /// 破防条（第四章领主通用，combat 第 4 节；docs/unity-ch4-port.md 第 2 节契约）：首领血条下的金条。
    ///   · 填：打弱点、反应伤害往里填（<see cref="FillFrom"/>）；场地机关、回劈直接 <see cref="Add"/>。
    ///   · 满了 = 破防：倒地 / 跪下 <see cref="BreakBarDef.seconds"/> 秒、受伤 × <see cref="BreakBarDef.takenMult"/>、弱点全露（首领自己在 <see cref="Broken"/> 里放开弱点）；
    ///     破防就算在霸体招里也照样发生（夔捶胸「破鼓」）。之后清空，下一次多要 <see cref="BreakBarDef.growth"/>。
    ///   · 破防期间不再填；登场、转阶段时不填（<see cref="Locked"/>）。
    /// 纯逻辑（不碰场景）：<see cref="BossBrain"/> 持有一份、按伤害事件喂它、到点调硬直；EditMode 可以直接 new 一个测。
    /// </summary>
    public sealed class BreakBar
    {
        public readonly BreakBarDef def;
        float value, brokenLeft;

        /// <summary>破防了（破防 Def, 这是第几次，从 1 起）</summary>
        public event Action<BreakBar, int> Broke;
        /// <summary>破防结束（站起来了）</summary>
        public event Action<BreakBar> Recovered;

        public BreakBar(BreakBarDef def) => this.def = def ?? new BreakBarDef();

        /// <summary>已经破过几次</summary>
        public int Breaks { get; private set; }
        /// <summary>当前累计</summary>
        public float Value => value;
        /// <summary>这一次要填满多少：max × (1 + growth × 已破次数)</summary>
        public float Threshold => Mathf.Max(1f, def.max * (1 + def.growth * Breaks));
        /// <summary>填充比例 0..1（破防中为 1，血条上金条满格闪）</summary>
        public float Fill => Broken ? 1f : Mathf.Clamp01(value / Threshold);
        /// <summary>破防中</summary>
        public bool Broken => brokenLeft > 0;
        /// <summary>破防剩余秒数</summary>
        public float BrokenLeft => brokenLeft;
        /// <summary>暂停填充（登场、转阶段、演出中）</summary>
        public bool Locked { get; set; }

        /// <summary>
        /// 加 amount；满了就破防并返回 true（破防中 / 锁着 / amount 非法时什么都不做）
        /// </summary>
        public bool Add(float amount)
        {
            if (Broken || Locked || !(amount > 0) || !float.IsFinite(amount)) return false;
            value += amount;
            if (value < Threshold) return false;
            Break();
            return true;
        }

        /// <summary>直接破防（试玩套件、调试；锁着时也破）</summary>
        public void Break()
        {
            value = 0;
            Breaks++;
            brokenLeft = Mathf.Max(0.01f, def.seconds);
            var n = Breaks;
            if (Broke != null)
                try
                {
                    Broke(this, n);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
        }

        /// <summary>推进破防计时（首领每帧调）</summary>
        public void Tick(float dt)
        {
            if (brokenLeft <= 0 || !(dt > 0)) return;
            brokenLeft -= dt;
            if (brokenLeft > 0) return;
            brokenLeft = 0;
            if (Recovered != null)
                try
                {
                    Recovered(this);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
        }

        /// <summary>提前结束破防（转阶段、倒下）：不发 Recovered</summary>
        public void Cancel() => brokenLeft = 0;

        /// <summary>重来（首领重置）：清空累计、次数、破防</summary>
        public void Reset()
        {
            value = 0;
            brokenLeft = 0;
            Breaks = 0;
        }

        /// <summary>
        /// 一次伤害该往条里填多少：反应伤害（带 Reaction 标签）× reactionFill，打中弱点 × weakFill，其余 0。dealt = 实际造成的伤害
        /// </summary>
        public float FillFrom(in DamageInfo info, float dealt)
        {
            if (!(dealt > 0)) return 0;
            if ((info.tags & DamageTag.Reaction) != 0) return dealt * def.reactionFill;
            if (info.weakpoint) return dealt * def.weakFill;
            return 0;
        }
    }

    /// <summary>首领血条的破防条数据源（<see cref="BossBar"/> 读；BossBrain 实现，没有破防条时返回 null）</summary>
    public interface IBreakBarSource
    {
        BreakBar BarBreak { get; }
    }
}
