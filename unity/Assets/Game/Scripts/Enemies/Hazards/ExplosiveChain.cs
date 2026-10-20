using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>会被同伴的爆炸连锁引爆的火药怪（炮仗傀儡、神火飞鸦；Three.js ExplosiveKin）</summary>
    public interface IExplosiveKin
    {
        /// <summary>还能被引爆：活着、还没被安排引爆</summary>
        bool ChainArmed { get; }
        /// <summary>身体中心与身体半径：中心离爆心 ≤ 爆炸半径 + 身体半径算在范围内，按中心距离排先后</summary>
        Vector3 ChainCenter { get; }
        float ChainRadius { get; }
        /// <summary>
        /// 被同伴的爆炸引爆：delay 秒后当场炸死（每只只会被安排一次）。敌人实现：置 primed、点亮引信，
        /// 再 <c>HazardClock.Delay(delay, () => ExplosiveChain.Detonate(this))</c>；它自己的死亡回调负责爆炸（再调 <see cref="ExplosiveChain.Explode"/>）
        /// </summary>
        void ChainDetonate(float delay);
    }

    /// <summary>
    /// 第三章「连环爆」（Three.js 版 src/enemies/inferno/ExplosiveChain.ts）：炮仗傀儡和神火飞鸦共用的爆炸连锁。
    /// 火药怪的死亡爆炸都走 <see cref="Explode"/>，区别只在同类怎么处理（<see cref="Mode"/>）：
    ///   Detonate（炮仗傀儡死时火箭箱炸开）：半径内的其他火药怪不论血量直接被引爆，按离爆心由近到远一只接一只
    ///     （第一只 <see cref="Hop"/> 秒后，之后每只多 <see cref="HopStep"/> 秒，读得出是连锁）；其余敌人吃一次火药伤害 + 击退（能把地面怪推进熔岩）。
    ///   Damage（神火飞鸦在空中被打爆）：半径内所有敌人（含同类）吃一次伤害；旁边的飞鸦被炸死就自己再炸，连锁自然往下传。
    /// 对敌人的伤害走玩家方伤害管线（<see cref="Blast.Enemies"/>：算玩家战果、带爆炸标签、边缘 50%），并且延后 <see cref="Settle"/> 秒结算，
    /// 不在触发它的那次伤害结算里递归（延时任务走 <see cref="HazardClock"/>）。被引爆的火药怪吃处决级伤害（<see cref="Detonate(EnemyAI)"/>：
    /// 不弹数字，照常算击杀、掉落）。清场（<see cref="EnemyRegistry.Purging"/>）时整条连锁都不发动。外观与对玩家的伤害由调用方负责（<see cref="Blast.Player"/>）。
    /// </summary>
    public static class ExplosiveChain
    {
        /// <summary>爆炸对敌人的结算延后、连锁引爆第一只的延迟、之后每只追加的间隔（秒，同 TS CHAIN）</summary>
        public const float Settle = 0.06f, Hop = 0.14f, HopStep = 0.07f;

        public enum Mode { Detonate, Damage }

        public struct Spec
        {
            public Vector3 center;
            public float radius;
            /// <summary>对其他敌人的基础伤害（已含等级 / 精英倍率）与击退（米/秒，随距离衰减）</summary>
            public float baseDamage, knockback;
            public Mode mode;
            /// <summary>爆炸的主人（自己不吃自己的爆炸；是火药怪的话不会被自己引爆）</summary>
            public object source;

            public Spec(Vector3 center, float radius, float baseDamage, float knockback, Mode mode, object source)
            {
                this.center = center;
                this.radius = radius;
                this.baseDamage = baseDamage;
                this.knockback = knockback;
                this.mode = mode;
                this.source = source;
            }
        }

        static readonly List<IExplosiveKin> livePool = new();
        static readonly List<float> sortDist = new();

        /// <summary>按离爆心排第 i 个（0 起）的同类在结算后多久被引爆</summary>
        public static float HopDelay(int i) => Hop + Mathf.Max(0, i) * HopStep;

        /// <summary>
        /// 半径内还能引爆的同类（不含 source），按中心离爆心由近到远（同距离保持池里的先后），写进 results（先清空），返回个数
        /// </summary>
        public static int KinInRadius(Vector3 center, float radius, object source, IReadOnlyList<IExplosiveKin> pool, List<IExplosiveKin> results)
        {
            results.Clear();
            sortDist.Clear();
            if (pool == null || !(radius > 0)) return 0;
            for (int i = 0; i < pool.Count; i++)
            {
                var k = pool[i];
                if (k == null || ReferenceEquals(k, source) || (k is Object o && !o) || !k.ChainArmed) continue;
                float d = Vector3.Distance(k.ChainCenter, center);
                if (!(d <= radius + Mathf.Max(0, k.ChainRadius))) continue;
                // 插入排序：同距离排在已有的后面（稳定）
                int at = results.Count;
                while (at > 0 && sortDist[at - 1] > d) at--;
                results.Insert(at, k);
                sortDist.Insert(at, d);
            }
            sortDist.Clear();
            return results.Count;
        }

        /// <summary>火药怪的死亡爆炸对其他敌人的结算：Settle 秒后执行 <see cref="Resolve"/>。pool = 候选同类（null = 场上所有活着的火药怪敌人）</summary>
        public static void Explode(in Spec s, IReadOnlyList<IExplosiveKin> pool = null)
        {
            if (EnemyRegistry.Purging) return;
            var copy = s;
            HazardClock.Delay(Settle, () => Resolve(copy, pool));
        }

        /// <summary>
        /// 结算（Explode 延后执行的那一步，测试也直接调）：Detonate 模式先挑出半径内的同类并把它们排除在伤害之外，
        /// 对其余敌人炸一次（baseDamage &gt; 0 时），再按由近到远安排同类引爆。返回安排引爆的同类数
        /// </summary>
        public static int Resolve(in Spec s, IReadOnlyList<IExplosiveKin> pool = null)
        {
            if (EnemyRegistry.Purging) return 0;
            var kin = new List<IExplosiveKin>();
            if (s.mode == Mode.Detonate) KinInRadius(s.center, s.radius, s.source, pool ?? LivePool(), kin);
            if (s.baseDamage > 0)
            {
                var exclude = new HashSet<Damageable>();
                AddHealth(exclude, s.source);
                foreach (var k in kin) AddHealth(exclude, k);
                Blast.Enemies(s.center, s.radius, s.baseDamage, s.knockback, 0.5f, exclude, s.source as Object);
            }
            for (int i = 0; i < kin.Count; i++) kin[i].ChainDetonate(HopDelay(i));
            return kin.Count;
        }

        /// <summary>
        /// 把一只火药怪当场炸死：处决级伤害（不弹数字、不暴击、无视护盾，照常算玩家击杀、掉落）；它自己的死亡回调负责爆炸。
        /// 正处于不可选中（出生中）而免疫的，直接处决
        /// </summary>
        public static void Detonate(EnemyAI e)
        {
            if (!e || e.Dead || EnemyRegistry.Purging || !e.Health) return;
            var info = DamageInfo.Simple(DamageCalc.ExecuteBase, DamageSource.Explosion, EnemyRegistry.Center(e), Vector3.up);
            info.noCrit = true;
            info.bypassShield = true;
            info.depth = 1;
            info.tags = DamageTag.Explosion;
            Combat.DamageEnemy(e.Health, info);
            if (!e.Dead) Combat.Execute(e.Health, false);
        }

        /// <summary>同上：火药怪是敌人时炸死它（测试里的假同类什么也不做）</summary>
        public static void Detonate(IExplosiveKin k)
        {
            if (k is EnemyAI e) Detonate(e);
        }

        /// <summary>延时 delay 秒后 <see cref="Detonate(EnemyAI)"/>（ChainDetonate 的常用实现）</summary>
        public static void DetonateLater(EnemyAI e, float delay) => HazardClock.Delay(delay, () => Detonate(e));

        static IReadOnlyList<IExplosiveKin> LivePool()
        {
            livePool.Clear();
            var live = EnemyRegistry.Live;
            for (int i = 0; i < live.Count; i++)
                if (live[i] is IExplosiveKin k && live[i] && !live[i].Dead)
                    livePool.Add(k);
            return livePool;
        }

        static void AddHealth(HashSet<Damageable> set, object who)
        {
            Damageable d = who switch
            {
                EnemyAI e => e ? e.Health : null,
                Component c => c ? c.GetComponent<Damageable>() : null,
                _ => null,
            };
            if (d) set.Add(d);
        }
    }
}
