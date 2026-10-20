using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 秘卷实现工具（Three.js 版 src/progression/scrolls/ScrollKit.ts 的触发类辅助）：
    ///   强度成长 <see cref="ProcScale()"/>、爆炸半径 <see cref="BlastRadius"/>、衍生深度 / 静默处决 / 直接命中判定、
    ///   状态强度、敌我耐久比例、附近敌人查询、概率（<see cref="Chance"/>，可选吃幸运的 <see cref="LuckyChance"/>）、
    ///   独立冷却（<see cref="Cooldown"/> / <see cref="TargetCooldown"/>）、衍生伤害请求（<see cref="ProcInfo"/>）。
    /// 都是纯函数或只读全局状态；作用域相关的（属性、订阅、内置冷却）在 <see cref="ScrollScope"/> 上。
    /// </summary>
    public static class ScrollKit
    {
        /// <summary>固定数值类秘卷伤害随关卡强度成长：每 1 点难度 +85%</summary>
        public const float ProcScalePerDifficulty = 0.85f;

        /// <summary>强度成长系数 = 1 + max(0, 难度 − 1) × 0.85（同 TS procScale）：第一章 1.00–1.41、第二章 1.68–2.09、第三章 2.36–2.77</summary>
        public static float ProcScale(float difficulty)
        {
            float d = float.IsNaN(difficulty) || float.IsInfinity(difficulty) ? 1 : difficulty;
            return 1 + Mathf.Max(0, d - 1) * ProcScalePerDifficulty;
        }

        /// <summary>按当前局的难度（没开局按 1）</summary>
        public static float ProcScale() => ProcScale(RunState.Current?.difficulty ?? 1);

        /// <summary>秘卷爆炸的半径同样吃「爆炸范围」加成（同 TS blastRadius）</summary>
        public static float BlastRadius(float baseRadius) => baseRadius * (Combat.playerStats?.Mult(Stat.ExplosionRadiusPct) ?? 1f);

        // ───────────── 判定 ─────────────

        /// <summary>衍生深度（直接命中 = 0）</summary>
        public static int DepthOf(in DamageInfo i) => i.depth;

        /// <summary>静默处决（清场）：不掉落、不触发击杀效果</summary>
        public static bool IsPurge(in DamageInfo i) => i.Has(DamageTag.Purge);

        public static bool IsPurgeKill(in KillEvent e) => e.info.Has(DamageTag.Purge);

        /// <summary>玩家武器的直接命中（非衍生、非秘卷触发、非处决；同 TS isDirectWeaponHit）</summary>
        public static bool IsDirectWeaponHit(in DamageInfo i) =>
            i.source == DamageSource.Weapon && i.depth == 0 && !i.Has(DamageTag.Proc) && !i.Has(DamageTag.Purge);

        /// <summary>
        /// 由一次命中推出状态强度，与 Combat 自己附着元素时的口径一致（同 TS statusPowerFrom）：
        /// 这一击的实际伤害（上限最大生命 × 0.5）除掉每一跳会重新乘上的元素 / 精英 / 首领倍率。只在未击杀的命中上用
        /// </summary>
        public static float StatusPowerFrom(in HitEvent e) => DamageCalc.StatusPowerFromDealt(e.enemy, e.info.element, e.result.total);

        /// <summary>敌人当前总耐久比例（生命 + 护盾 + 护甲）</summary>
        public static float EnemyHealthFrac(Damageable d)
        {
            if (!d) return 0;
            float max = d.maxHealth + d.maxShield + d.maxArmor;
            if (max <= 0) return 0;
            return (Mathf.Max(0, d.health) + Mathf.Max(0, d.shield) + Mathf.Max(0, d.armor)) / max;
        }

        /// <summary>玩家生命比例（没有玩家为 0）</summary>
        public static float PlayerHpFrac(PlayerVitals pv = null)
        {
            pv = pv ? pv : PlayerVitals.Instance;
            if (!pv) return 0;
            float max = pv.MaxHealth;
            return max > 0 ? Mathf.Max(0, pv.health) / max : 0;
        }

        /// <summary>玩家护盾比例（没有护盾上限为 0）</summary>
        public static float PlayerShieldFrac(PlayerVitals pv = null)
        {
            pv = pv ? pv : PlayerVitals.Instance;
            if (!pv) return 0;
            float max = pv.MaxShield;
            return max > 0 ? Mathf.Max(0, pv.shield) / max : 0;
        }

        /// <summary>敌人到玩家的水平距离（没有玩家为无穷大）</summary>
        public static float EnemyDistance(Damageable d, PlayerVitals pv = null)
        {
            pv = pv ? pv : PlayerVitals.Instance;
            if (!d || !pv) return float.PositiveInfinity;
            var a = d.transform.position;
            var b = pv.transform.position;
            return Mathf.Sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
        }

        /// <summary>敌人身体中心（命中特效、连锁、范围判定的中心）</summary>
        public static Vector3 BodyCenter(Damageable d) => ReactionSystem.CenterOf(d);

        // ───────────── 附近敌人 ─────────────

        static readonly List<Damageable> scratch = new();

        static bool Targetable(Damageable d) => d && !d.Dead && !d.untargetable && d.isActiveAndEnabled;

        /// <summary>center 半径内离 center 最近、且不是 exclude 的活着的敌人（按身体中心算；遁地等不可选中的跳过）</summary>
        public static Damageable NearestOther(Vector3 center, float radius, Damageable exclude)
        {
            Damageable best = null;
            float bestD = radius * radius;
            foreach (var ai in EnemyAI.All)
            {
                var d = ai ? ai.Health : null;
                if (d == exclude || !Targetable(d)) continue;
                float sq = (BodyCenter(d) - center).sqrMagnitude;
                if (sq > bestD) continue;
                bestD = sq;
                best = d;
            }
            return best;
        }

        /// <summary>对半径内所有活着的敌人（除 exclude）执行 fn；先拷一份名单（fn 里的伤害可能改动敌人表）。返回执行次数</summary>
        public static int ForEachNear(Vector3 center, float radius, Damageable exclude, Action<Damageable> fn)
        {
            if (fn == null) return 0;
            float r2 = radius * radius;
            scratch.Clear();
            foreach (var ai in EnemyAI.All)
            {
                var d = ai ? ai.Health : null;
                if (d == exclude || !Targetable(d)) continue;
                if ((BodyCenter(d) - center).sqrMagnitude <= r2) scratch.Add(d);
            }
            var copy = scratch.ToArray();
            scratch.Clear();
            int n = 0;
            foreach (var d in copy)
            {
                if (!Targetable(d)) continue;
                try
                {
                    fn(d);
                    n++;
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            return n;
        }

        // ───────────── 概率 ─────────────

        static RunRng fallbackRng;

        /// <summary>秘卷触发用的随机流（局种子 + 当前关 + "scroll-proc"；没开局时用一个按时钟播种的流）</summary>
        public static RunRng Rng => RunState.Current?.Stream("scroll-proc") ?? (fallbackRng ??= new RunRng(Environment.TickCount));

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            fallbackRng = null;
            scratch.Clear();
        }

        /// <summary>玩家幸运（≥ 0）</summary>
        public static float Luck => Mathf.Max(0, Combat.playerStats?.Get(Stat.Luck) ?? 0);

        /// <summary>按概率 p 掷一次（同 TS ctx.rng.chance：不吃幸运）</summary>
        public static bool Chance(float p) => p > 0 && (p >= 1 || Rng.Chance(p));

        /// <summary>
        /// 吃幸运的概率（Unity 新增，TS 的秘卷触发不吃幸运）：p × (1 + perLuck × 幸运)，封顶 1。
        /// 只给明确写了「幸运提高触发率」的新秘卷用，移植的 TS 秘卷一律用 <see cref="Chance"/>
        /// </summary>
        public static bool LuckyChance(float p, float perLuck = 0.05f) => Chance(Mathf.Min(1, p * (1 + perLuck * Luck)));

        // ───────────── 冷却 ─────────────

        /// <summary>一个独立的冷却（不挂在作用域上的：词条、灵宠也能用）</summary>
        public sealed class Cooldown
        {
            float next = float.NegativeInfinity;

            /// <summary>冷却好了就返回 true 并开始 seconds 秒的冷却</summary>
            public bool Ready(float seconds)
            {
                float now = ScrollTicker.Now;
                if (now < next) return false;
                next = now + seconds;
                return true;
            }

            public bool IsReady => ScrollTicker.Now >= next;
            public float Left => Mathf.Max(0, next - ScrollTicker.Now);
            public void Reset() => next = float.NegativeInfinity;
        }

        /// <summary>按目标的冷却（同 TS 的 WeakMap icd）：同一目标 seconds 秒内只返回一次 true。表大了会顺手清掉过期的项</summary>
        public sealed class TargetCooldown
        {
            readonly Dictionary<UnityEngine.Object, float> next = new();

            public bool Ready(UnityEngine.Object target, float seconds)
            {
                if (!target) return false;
                float now = ScrollTicker.Now;
                if (next.TryGetValue(target, out var t) && now < t) return false;
                if (next.Count > 256) Prune(now);
                next[target] = now + seconds;
                return true;
            }

            void Prune(float now)
            {
                var dead = new List<UnityEngine.Object>();
                foreach (var kv in next)
                    if (kv.Value <= now || !kv.Key) dead.Add(kv.Key);
                foreach (var k in dead) next.Remove(k);
            }

            public void Clear() => next.Clear();
        }

        // ───────────── 衍生伤害 ─────────────

        /// <summary>
        /// 秘卷触发的衍生伤害请求：带 <see cref="DamageTag.Proc"/> 和 procId，深度 = depth（缺省 1），不随机暴击；instigator 留空（同武器命中，算玩家的）。
        /// source 由调用方定：DamageSource 里没有「秘卷」（TS 的 'scroll' 来源不吃武器 / 技能 / 爆炸加成），
        /// 走爆炸的用 <see cref="Combat.Explode(in ExplosionOptions)"/>（自动吃爆炸伤害）。
        /// </summary>
        public static DamageInfo ProcInfo(string procId, DamageSource source, float amount, Element element = Element.None, int depth = 1,
            Vector3 point = default, Vector3 direction = default)
        {
            var i = DamageInfo.Simple(amount, source, point, direction);
            i.element = element;
            i.depth = Mathf.Max(1, depth);
            i.tags |= DamageTag.Proc;
            i.procId = procId;
            i.noCrit = true;
            return i;
        }
    }
}
