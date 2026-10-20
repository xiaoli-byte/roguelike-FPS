using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// ScrollKit 的玩家 / 经济辅助（功能、传说、英雄专属秘卷用，S3 / S3b / S4）：
    ///   玩家：运动组件、滞空判定（同 TS !player.onGround）、视线原点、技能冷却回复、无敌、受伤来源 → 敌人；
    ///   经济：本局灵石、直接入账 / 扣除（不吃灵石获取，同 TS 直接改 run.coins）、额外掉落灵石（捡起时才乘灵石获取）；
    ///   限时增益触发：新开启时才弹触发字（刷新持续时间不弹，免得每次受击都弹一个）。
    /// 表现（特效 / 音效 / 震屏 / 提示）在 <see cref="Show"/>：只在 Play 模式下出，EditMode 测试里什么都不生成。
    /// 全部容忍 null 玩家（沙盒、测试里的作用域可能没有玩家）。
    /// </summary>
    public static partial class ScrollKit
    {
        // ───────────── 玩家 ─────────────

        /// <summary>玩家的运动组件（没有玩家为 null）</summary>
        public static PlayerMotor MotorOf(PlayerVitals pv) => pv ? pv.GetComponent<PlayerMotor>() : null;

        /// <summary>玩家的技能槽（没有玩家 / 没有技能组件为 null）</summary>
        public static HeroSkills HeroSkillsOf(PlayerVitals pv) => pv ? pv.GetComponent<HeroSkills>() : null;

        /// <summary>滞空：脚下没碰到地面（同 TS !player.onGround）。没有运动组件按「在地上」算</summary>
        public static bool IsAirborne(PlayerMotor motor) => motor && !motor.Grounded;

        public static bool IsAirborne(PlayerVitals pv) => IsAirborne(MotorOf(pv));

        /// <summary>玩家视线原点（武器相机 → 运动组件的眼睛 → 脚下 + 1.6 m）；没有玩家为原点</summary>
        public static Vector3 EyeOf(PlayerVitals pv)
        {
            if (!pv) return Vector3.zero;
            var wc = pv.GetComponent<WeaponController>();
            if (wc && wc.eye) return wc.eye.transform.position;
            var motor = pv.GetComponent<PlayerMotor>();
            if (motor && motor.eye) return motor.eye.position;
            return pv.transform.position + Vector3.up * 1.6f;
        }

        /// <summary>立即回复技能冷却（同 TS player.reduceCooldowns：which = null 两个槽都回）。玩家没有技能槽时返回 false</summary>
        public static bool ReduceSkillCooldowns(PlayerVitals pv, float seconds, SkillSlot? which = null)
        {
            var hero = HeroSkillsOf(pv);
            if (!hero || !(seconds > 0)) return false;
            hero.ReduceCooldowns(seconds, which);
            return true;
        }

        /// <summary>
        /// 玩家无敌 seconds 秒（与已有的取较长者，同 TS invulnerableTime = max(…)）：走运动组件的无敌（H1 GrantInvulnerability，受击判定读取）；
        /// 没有运动组件时退到 PlayerVitals.invulnerableUntil
        /// </summary>
        public static void GrantPlayerInvulnerability(PlayerVitals pv, float seconds)
        {
            if (!pv || !(seconds > 0)) return;
            var motor = pv.GetComponent<PlayerMotor>();
            if (motor) motor.GrantInvulnerability(seconds);
            else pv.invulnerableUntil = Mathf.Max(pv.invulnerableUntil, Time.time + seconds);
        }

        /// <summary>
        /// 受伤事件里的出手者 → 敌人（PlayerHitEvent.source 可能是 EnemyAI、Damageable、投射物来源的组件或物体）；认不出来为 null
        /// </summary>
        public static Damageable DamageableOf(Object source)
        {
            switch (source)
            {
                case null:
                    return null;
                case Damageable d:
                    return d ? d : null;
                case EnemyAI ai:
                    return ai ? ai.Health : null;
                case Component c:
                    if (!c) return null;
                    var own = c.GetComponent<Damageable>();
                    return own ? own : c.GetComponentInParent<Damageable>();
                case GameObject go:
                    return go ? go.GetComponentInParent<Damageable>() : null;
                default:
                    return null;
            }
        }

        /// <summary>敌人活着且可以被选中（同 TS alive &amp;&amp; !untargetable；不看组件启用状态）</summary>
        public static bool IsHittable(Damageable d) => d && !d.Dead && !d.untargetable;

        // ───────────── 经济 ─────────────

        /// <summary>本局持有的灵石（没开局为 0）</summary>
        public static int RunCoins => RunState.Current?.coins ?? 0;

        /// <summary>直接入账（不乘灵石获取：利息、本金这类「给定数额」）；没开局返回 0</summary>
        public static int CreditRunCoins(int amount, string source)
        {
            var run = RunState.Current;
            if (run == null || amount <= 0) return 0;
            run.Credit(amount, source);
            return amount;
        }

        /// <summary>扣除最多 amount 灵石（不够就扣光，发 CoinsChanged）；返回实际扣了多少</summary>
        public static int TakeRunCoins(int amount)
        {
            var run = RunState.Current;
            if (run == null || amount <= 0) return 0;
            int loss = Mathf.Min(amount, run.coins);
            return loss > 0 && run.TrySpend(loss) ? loss : 0;
        }

        /// <summary>
        /// 在 pos 掉一笔额外的灵石（同 TS loot.dropCoins：≥ 60 抛得更远）；捡起时照常乘灵石获取。
        /// Play 模式之外（EditMode 测试、编辑器工具）没有掉落物：直接入账（同样乘灵石获取，等于马上捡起）
        /// </summary>
        public static void DropBonusCoins(Vector3 pos, int amount)
        {
            if (amount <= 0) return;
            if (Application.isPlaying) LootDirector.DropCoins(pos, amount, amount >= 60 ? 1.8f : 1f);
            else if (RunState.Current != null) EconomyConfig.CreditCoins(amount, "bonus");
        }

        // ───────────── 限时增益 ─────────────

        /// <summary>触发 / 刷新一个限时增益；之前没在生效时弹一次触发字。返回这次是不是新开启</summary>
        public static bool ProcBuff(ScrollScope s, TimedBuff buff, float seconds)
        {
            if (s == null || buff == null) return false;
            bool fresh = !buff.IsActive;
            buff.Trigger(seconds);
            if (fresh && buff.IsActive) s.Proc();
            return fresh;
        }

        // ───────────── 表现 ─────────────

        /// <summary>
        /// 秘卷触发的表现：特效、音效、震屏、提示。只在 Play 模式下执行（EditMode 测试、编辑器工具里不生成物体、不碰 UI）
        /// </summary>
        public static class Show
        {
            static bool On => Application.isPlaying;

            public static void Sound(string id, float volume = 1, float pitch = 1)
            {
                if (On) GameAudio.Play(id, volume, pitch);
            }

            public static void Toast(string text, Color color)
            {
                if (On) GameUI.Toast(text, color);
            }

            public static void Shake(float strength, float duration)
            {
                if (On) CameraShake.Add(strength, duration);
            }

            /// <summary>贴地扩散环（同 TS fx.ring）</summary>
            public static void Ring(Vector3 feet, float radius, Color color, float seconds)
            {
                if (On) SkillFx.Ring(feet, radius, color, seconds);
            }

            /// <summary>粒子爆散（同 TS fx.burst）</summary>
            public static void Burst(Vector3 at, Color color, int count, float speed, float life, float size, float rise = 0)
            {
                if (On) SkillFx.Burst(at, color, count, speed, life, size, rise);
            }

            /// <summary>直线光束（同 TS fx.beam）</summary>
            public static void Beam(Vector3 from, Vector3 to, Color color, float width, float life)
            {
                if (On) PetFx.Beam(from, to, color, width, life);
            }
        }
    }
}
