using System;
using System.Runtime.CompilerServices;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 每把枪的运行时状态（同 TS WeaponRuntime + AffixEffects 的 RxState；不存进 WeaponInstance、不跨关）：
    /// 按实例弱引用挂着（<see cref="Of"/>），切走再切回还在，枪被换掉 / 丢掉后随 GC 回收。
    ///   开火框架（W1）：开火模式实例、切走时的 readyAt、累计发数；
    ///   触发词条（AF2）：爆头爆炸 / 破势 / 回元 / 化盾的内置冷却、疾化截止时间；
    ///   开火钩子：<see cref="BeginShot"/>（扣弹、累计发数、<see cref="IAffixEffect.OnFire"/>：天命、终焉、无尽）、
    ///   射速钩子：<see cref="RateMult"/>（<see cref="IAffixEffect.FireRate"/>：疾化、狂热），都由 <see cref="WeaponStateMachine"/> 调用。
    /// </summary>
    public sealed class WeaponRuntime
    {
        static ConditionalWeakTable<WeaponInstance, WeaponRuntime> table = new();
        static readonly ConditionalWeakTable<WeaponInstance, WeaponRuntime>.CreateValueCallback create = _ => new WeaponRuntime();

        /// <summary>开火类效果的随机数（[0, 1)；「无尽」）。测试可以替换，进入 Play 时复原</summary>
        public static Func<float> Random = DefaultRandom;

        static float DefaultRandom() => UnityEngine.Random.value;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            table = new ConditionalWeakTable<WeaponInstance, WeaponRuntime>();
            Random = DefaultRandom;
        }

        /// <summary>这把枪的运行时状态（第一次访问时建）；w 为 null 返回 null</summary>
        public static WeaponRuntime Of(WeaponInstance w) => w != null ? table.GetValue(w, create) : null;

        // ── 开火框架（W1）──
        /// <summary>开火模式（状态机第一次用到时按定义建）</summary>
        public IFireMode mode;
        /// <summary>切走时剩余冷却折算成的绝对时间：切回来 cooldown = readyAt − now（切枪不能刷掉冷却）</summary>
        public float readyAt = -99;
        /// <summary>这把枪打过的发数（「天命」第 N 发；光束每跳、齐射每轮算一发）</summary>
        public int shots;
        /// <summary>齐射：开始那一发（deferred）算好的修饰（终焉倍率、天命暴击），之后逐枚发射时沿用（同 TS volleyCrit / volleyMult）</summary>
        public ShotMods volley = ShotMods.Volley;

        // ── 触发词条（AF2）──
        /// <summary>最近一次爆头爆炸（一发霰弹的多颗弹丸同帧只炸一次）、「破势」引爆、「回元」回填、「化盾」的时刻</summary>
        public float lastHeadBlast = -99, lastDetonate = -99, lastRefill = -99, lastShield = -99;
        /// <summary>「疾化」射速加成的截止时刻</summary>
        public float rxnHasteUntil = -99;

        /// <summary>
        /// 一次射击的开火钩子（状态机在弹道之前调）：累计发数 → 派发 <see cref="IAffixEffect.OnFire"/>（天命、终焉、无尽）→ 不免耗就扣一发 →
        /// 返回带上强制暴击与伤害倍率的修饰。mods.deferred（齐射开始）时把结果记进 <see cref="volley"/>，逐枚发射时用。
        /// </summary>
        public ShotMods BeginShot(WeaponInstance w, ResolvedWeapon r, bool infinite, in ShotMods mods, float now)
        {
            var s = new FireShot { infinite = infinite, magBefore = w.mag, shots = ++shots, mult = 1 };
            var list = w.affixes;
            if (r != null)
                for (int i = 0; i < list.Count; i++)
                {
                    if (!AffixEffects.FirstOf(list, i)) continue;
                    var fx = AffixLibrary.Get(list[i].id)?.Effect;
                    if (fx == null) continue;
                    try { fx.OnFire(new AffixHook(w, r, AffixEffects.ValueOf(w, r, list[i].id), null, now), ref s); }
                    catch (Exception e) { Debug.LogException(e); }
                }
            if (s.Consumed) w.mag = Mathf.Max(0, w.mag - 1);
            var m = mods;
            m.mult = mods.mult * s.mult;
            m.forceCrit = mods.forceCrit || s.forceCrit;
            if (m.deferred) volley = new ShotMods { mult = m.mult, strength = 1, deferred = true, forceCrit = m.forceCrit };
            return m;
        }

        /// <summary>这把枪此刻的射速倍率：各词条 <see cref="IAffixEffect.FireRate"/> 之积（疾化、狂热；同 TS frenzyMult × haste）</summary>
        public static float RateMult(WeaponInstance w, ResolvedWeapon r, float now)
        {
            if (w == null || r == null) return 1;
            var list = w.affixes;
            float k = 1;
            for (int i = 0; i < list.Count; i++)
            {
                if (!AffixEffects.FirstOf(list, i)) continue;
                var fx = AffixLibrary.Get(list[i].id)?.Effect;
                if (fx == null) continue;
                try { k *= fx.FireRate(new AffixHook(w, r, AffixEffects.ValueOf(w, r, list[i].id), null, now)); }
                catch (Exception e) { Debug.LogException(e); }
            }
            return k > 0 && !float.IsInfinity(k) ? k : 1;
        }
    }
}
