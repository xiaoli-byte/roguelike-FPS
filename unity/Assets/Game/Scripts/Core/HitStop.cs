using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 顿帧（docs/unity-parity.md 3.2 / 3.13，F3；Three.js 只有碎刃枪模自己的视觉顿帧，这里是全局的超越项）：
    /// 命中的一瞬间把时间压到 ×0.05 几十毫秒，让暴击、击杀、反应「咬」一下。
    /// 只走 <see cref="TimeScaleArbiter"/>（优先级最低的 HitStop：暂停、模态、过渡、阵亡慢动作都压得过它）；计时用不受缩放的真实时间。
    /// 频率上限（不能把战斗打成幻灯片）：
    ///   · 不叠加：进行中再来一个只把结束时刻延到两者中较晚的那个，单次最长 0.2 s，缩放取较低的；
    ///   · 两次开始至少隔 0.12 s（明显更重的——长度至少是上一次的两倍，如精英 / 首领击杀——可以插队）；
    ///   · 预算桶：最多攒 0.15 s，每秒回 0.075 s——连续作战时顿帧最多占真实时间的 7.5%；预算不够 12 ms 就不顿（太短的只像卡了一下）。
    ///   · 只在 <see cref="GameStateMachine.IsPlaying"/>、时间没被别人压着、玩家活着的时候开始。
    /// 内置来源（玩家造成的：武器、技能、近战、爆炸、秘卷；不含持续伤害、灵宠、环境、敌人互伤）：
    ///   击杀 普通 0.035 s / 精英 0.07 s / 首领 0.18 s；重暴击（这一下打掉目标护盾 + 护甲 + 生命总量的 18% 以上，冲锋枪的暴击不算）0.025 s；
    ///   元素反应（直接命中引发的）0.045 s。别的单元（斩击命中、技能落地）直接调 <see cref="Request"/>。
    /// [GameSystem]：自动挂在 Game Systems 上；没有它的场景（展示场景）请求直接忽略，不会把时间卡住。
    /// </summary>
    [GameSystem(120)]
    [DisallowMultipleComponent]
    public sealed class HitStop : MonoBehaviour
    {
        /// <summary>顿帧时的时间缩放（不用 0：deltaTime 为 0 时一些系统会跳过这一帧的结算）</summary>
        public const float DefaultScale = 0.05f;
        public const float MaxStop = 0.2f, MinGap = 0.12f, BudgetMax = 0.15f, BudgetRate = 0.075f, MinUseful = 0.012f;
        /// <summary>内置来源的时长（秒，真实时间）</summary>
        public const float KillStop = 0.035f, EliteKillStop = 0.07f, BossKillStop = 0.18f, CritStop = 0.025f, ReactionStop = 0.045f;
        /// <summary>重暴击：这一下打掉目标总量（护盾 + 护甲 + 生命上限）的比例</summary>
        const float HeavyCritFraction = 0.18f;

        /// <summary>总开关（测试、以后的设置项）；关掉时进行中的顿帧立刻结束</summary>
        public static bool Enabled
        {
            get => enabled_;
            set
            {
                enabled_ = value;
                if (!value) Release();
            }
        }

        /// <summary>正在顿帧</summary>
        public static bool Active => handle != null && handle.Live;
        /// <summary>剩余预算（秒）</summary>
        public static float Budget => budget;

        static HitStop driver;
        static TimeScaleArbiter.Handle handle;
        static bool enabled_ = true;
        static float stopStart, stopUntil, lastStart = -10, lastLength, budget = BudgetMax, budgetAt;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            driver = null;
            handle = null;
            enabled_ = true;
            stopStart = stopUntil = lastLength = budgetAt = 0;
            lastStart = -10;
            budget = BudgetMax;
        }

        /// <summary>
        /// 申请一次顿帧：seconds 秒（真实时间，≤ 0.2），期间时间缩放 = scale。按上面的规则可能被延长合并、截短或忽略；返回是否生效
        /// </summary>
        public static bool Request(float seconds, float scale = DefaultScale)
        {
            if (!enabled_ || !driver || !driver.isActiveAndEnabled || !(seconds > 0)) return false;
            seconds = Mathf.Min(seconds, MaxStop);
            scale = float.IsFinite(scale) ? Mathf.Clamp01(scale) : DefaultScale;
            float now = Time.unscaledTime;
            Refill(now);

            // 进行中：不叠加，只延长到较晚的结束（受单次上限与预算限制）
            if (Active)
            {
                float end = Mathf.Min(stopStart + MaxStop, now + seconds);
                float extra = Mathf.Min(end - stopUntil, budget);
                if (scale < handle.Scale) handle.Scale = scale;
                if (extra <= 0.002f) return false;
                budget -= extra;
                stopUntil += extra;
                return true;
            }

            if (!GameStateMachine.IsPlaying || TimeScaleArbiter.Current < 0.999f) return false;
            var p = PlayerVitals.Instance;
            if (p && p.Dead) return false;
            if (now - lastStart < MinGap && seconds < lastLength * 2) return false;
            seconds = Mathf.Min(seconds, budget);
            if (seconds < MinUseful) return false;
            budget -= seconds;
            stopStart = lastStart = now;
            stopUntil = now + seconds;
            lastLength = seconds;
            handle = TimeScaleArbiter.Request(driver, scale, TimeScaleArbiter.Priority.HitStop);
            return true;
        }

        static void Refill(float now)
        {
            if (now > budgetAt) budget = Mathf.Min(BudgetMax, budget + (now - budgetAt) * BudgetRate);
            budgetAt = now;
        }

        static void Release()
        {
            handle?.Dispose();
            handle = null;
        }

        void OnEnable()
        {
            if (driver && driver != this) return;
            driver = this;
            GameEvents.EnemyKilled += OnKilled;
            GameEvents.EnemyDamaged += OnDamaged;
            GameEvents.Reacted += OnReacted;
        }

        void OnDisable()
        {
            if (driver != this) return;
            GameEvents.EnemyKilled -= OnKilled;
            GameEvents.EnemyDamaged -= OnDamaged;
            GameEvents.Reacted -= OnReacted;
            Release();
            driver = null;
        }

        void Update()
        {
            if (driver != this || handle == null) return;
            // 被仲裁器整体清掉（换关 / 重开）或到点：撤销
            if (!handle.Live || Time.unscaledTime >= stopUntil) Release();
        }

        static bool ByPlayer(DamageSource s) =>
            s is DamageSource.Weapon or DamageSource.Skill or DamageSource.Melee or DamageSource.Explosion or DamageSource.Scroll;

        // 内置来源的时长 / 缩放读 FeelProfile（I7 定稿；上面的常数是它的默认值）
        void OnKilled(in KillEvent e)
        {
            if (!e.enemy || !ByPlayer(e.info.source)) return;
            var f = FeelProfile.Active;
            Request(e.enemy.rank switch
            {
                Rank.Boss => f.bossKillStop,
                Rank.Elite => f.eliteKillStop,
                _ => f.killStop,
            }, f.hitStopScale);
        }

        void OnDamaged(in HitEvent e)
        {
            if (!e.result.crit || e.result.killed || !e.enemy) return;
            if (e.info.source != DamageSource.Weapon && e.info.source != DamageSource.Melee) return;
            var d = e.enemy;
            float pool = Mathf.Max(1, d.maxHealth + d.maxArmor + d.maxShield);
            if (e.result.total >= pool * HeavyCritFraction) Request(FeelProfile.Active.critStop, FeelProfile.Active.hitStopScale);
        }

        void OnReacted(in ReactionEvent e)
        {
            if (e.depth == 0 && e.hits > 0) Request(FeelProfile.Active.reactionStop, FeelProfile.Active.hitStopScale);
        }
    }
}
