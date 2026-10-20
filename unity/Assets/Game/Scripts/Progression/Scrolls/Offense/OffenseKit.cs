using System;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 攻击 / 元素秘卷（S1 / S2）共用的小工具，补 <see cref="ScrollKit"/> 没有的几样：
    ///   · 命中判定 <see cref="IsDirectHit"/> / <see cref="IsWeaponSource"/>：Three.js 里碎刃斩击的来源也是 'weapon'（只多一个 slash 标签），
    ///     Unity 把它拆成了 <see cref="DamageSource.Melee"/>，这里两者都算「武器」，与 TS isDirectWeaponHit 的覆盖面一致；
    ///   · 同帧判定 <see cref="FrameGate"/>（同 TS ctx.time.frame：霰弹一轮弹丸只算一次）；
    ///   · 概率 <see cref="Chance"/>（同 TS ctx.rng.chance，不吃幸运）与当前弹匣 <see cref="ActiveMag"/>；
    ///   · 特效 / 音效的薄包装（只在 Play 模式下出，EditMode 测试不建物体）。
    /// 测试钩子（<see cref="TestChance"/> / <see cref="TestMag"/>）只给 EditMode 测试用：没有场景、没有武器时也能逐项断言；
    /// <see cref="ResetTestHooks"/> 还原，SubsystemRegistration 时也会清掉。
    /// </summary>
    public static class OffenseKit
    {
        /// <summary>测试用：设了就代替随机掷骰（参数是概率，返回是否掷中）</summary>
        public static Func<float, bool> TestChance;

        /// <summary>测试用：设了就代替「当前武器的弹匣余量 / 容量」（返回 null = 没有武器）</summary>
        public static Func<(int mag, int cap)?> TestMag;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        public static void ResetTestHooks()
        {
            TestChance = null;
            TestMag = null;
        }

        // ───────────── 判定 ─────────────

        /// <summary>武器类来源：枪械（Weapon）与碎刃斩击（Melee）——TS 里两者都是 source 'weapon'</summary>
        public static bool IsWeaponSource(DamageSource s) => s is DamageSource.Weapon or DamageSource.Melee;

        /// <summary>
        /// 玩家武器的直接命中（同 TS isDirectWeaponHit）：武器 / 近战、深度 0、不是秘卷 / 词条衍生（Proc）、不是静默处决
        /// </summary>
        public static bool IsDirectHit(in DamageInfo i) =>
            IsWeaponSource(i.source) && i.depth == 0 && !i.Has(DamageTag.Proc) && !i.Has(DamageTag.Purge);

        /// <summary>命中弱点（含被改判为弱点：白泽）。TS 的 req.headshot</summary>
        public static bool IsWeak(in DamageInfo i) => i.weakpoint || i.forcedWeakpoint;

        /// <summary>按概率 p 掷一次（同 TS ctx.rng.chance：秘卷触发不吃幸运）</summary>
        public static bool Chance(float p) => TestChance != null ? TestChance(p) : ScrollKit.Chance(p);

        /// <summary>
        /// 当前武器的弹匣余量与容量（容量已含弹匣加成，同 TS weapons.magCapacity）。没有武器控制器 / 没拿武器返回 false。
        /// wc / sheet 由调用方在安装时取好（<see cref="ScrollScope.Weapons"/>、<see cref="ScrollScope.stats"/>），命中时不再 GetComponent
        /// </summary>
        public static bool ActiveMag(WeaponController wc, StatSheet sheet, out int mag, out int cap)
        {
            mag = cap = 0;
            if (TestMag != null)
            {
                var v = TestMag();
                if (!v.HasValue) return false;
                (mag, cap) = v.Value;
                return true;
            }
            var w = wc ? wc.Active : null;
            if (w == null) return false;
            mag = w.mag;
            cap = WeaponStatsResolver.Resolve(w, sheet).magCap;
            return true;
        }

        /// <summary>爆心 / 命中点：请求里的命中点有效就用它，否则用敌人身体中心（TS：request.point ?? getBodyCenter）</summary>
        public static Vector3 HitPoint(in HitEvent e)
        {
            var p = e.info.point;
            bool valid = p != Vector3.zero && float.IsFinite(p.x) && float.IsFinite(p.y) && float.IsFinite(p.z);
            return valid || !e.enemy ? p : ScrollKit.BodyCenter(e.enemy);
        }

        // ───────────── 同帧判定 ─────────────

        /// <summary>
        /// 同帧判定（同 TS ctx.time.frame）：<see cref="First"/> 在每一帧第一次调用时返回 true。
        /// 「帧」= Time.frameCount 与秘卷时钟都相同——Play 模式下每帧 frameCount 都变；EditMode 测试里 frameCount 不动，按 <see cref="ScrollTicker.Step"/> 推进的时钟区分
        /// </summary>
        public sealed class FrameGate
        {
            int frame = int.MinValue;
            float time = float.NaN;

            public bool SameFrame => frame == Time.frameCount && time == ScrollTicker.Now;

            /// <summary>本帧第一次：记下并返回 true；同一帧再调返回 false</summary>
            public bool First()
            {
                if (SameFrame) return false;
                frame = Time.frameCount;
                time = ScrollTicker.Now;
                return true;
            }

            public void Clear()
            {
                frame = int.MinValue;
                time = float.NaN;
            }
        }

        // ───────────── 特效 / 音效（只在 Play 模式下）─────────────

        public static bool FxOn => Application.isPlaying;

        /// <summary>弹道光线（TS fx.tracer）</summary>
        public static void Tracer(Vector3 from, Vector3 to, Color color, float width)
        {
            if (FxOn) ShotFx.Instance?.Tracer(from, to, color, width);
        }

        /// <summary>粒子爆散（TS fx.burst；rise &gt; 0 往上飘）</summary>
        public static void Burst(Vector3 at, Color color, int count, float speed, float life, float size, float rise = 0)
        {
            if (FxOn) SkillFx.Burst(at, color, count, speed, life, size, rise);
        }

        /// <summary>贴地扩散环（TS fx.ring）</summary>
        public static void Ring(Vector3 feet, float radius, Color color, float seconds)
        {
            if (FxOn) SkillFx.Ring(feet, radius, color, seconds);
        }

        /// <summary>闪电弧（TS fx.lightning）</summary>
        public static void Lightning(Vector3 from, Vector3 to, Color color)
        {
            if (FxOn) Spiritfire.Game.Lightning.Spawn(from, to, color);
        }

        /// <summary>震屏（TS fx.shake）</summary>
        public static void Shake(float strength, float duration)
        {
            if (FxOn) CameraShake.Add(strength, duration);
        }

        /// <summary>世界里的声音</summary>
        public static void SoundAt(string id, Vector3 at, float volume = 1, float pitch = 1)
        {
            if (FxOn) GameAudio.PlayAt(id, at, volume, pitch);
        }

        /// <summary>玩家自己的声音</summary>
        public static void Sound(string id, float volume = 1, float pitch = 1)
        {
            if (FxOn) GameAudio.Play(id, volume, pitch);
        }
    }
}
