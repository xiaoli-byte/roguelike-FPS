using System.Collections.Generic;
using UnityEngine;
using M = Spiritfire.Game.CombatTuning.Meltdown;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔金（灼烧 ⇄ 蚀化）：中心蚀伤 B（有护甲 ×2）；脚下 2.5 m 熔池 3 s——每 0.5 s 对站在池里的敌人 0.12B 火伤（带 Dot 标签），
    /// 每个敌人第一次被这个池子跳到时附蚀 0.25B（深度 +1）。全场同时最多 4 个池子，第 5 个生成时结束最旧的。
    /// 池子对象复用，跳伤时把敌人列表拷进自有缓冲（伤害可能击杀 / 生成敌人）。
    /// </summary>
    [Defs]
    public sealed class MeltdownHandler : ReactionHandler
    {
        public override string Id => "meltdown";
        public override DetonateOutcome Kind => DetonateOutcome.Meltdown;

        sealed class Pool
        {
            /// <summary>熔池贴花（FX2）：池子提前结束（被挤掉、清场）时一起收掉</summary>
            public FxHandle fx;
            public Vector3 center;
            public float radius, b, age, next;
            public int ticks, depth, weaponUid;
            public readonly HashSet<Damageable> touched = new();
        }

        readonly List<Pool> pools = new();
        readonly Stack<Pool> spare = new();
        readonly List<EnemyAI> snapshot = new();

        /// <summary>此刻的熔池数</summary>
        public int PoolCount => pools.Count;

        public override void Execute(ReactionJob j)
        {
            var e = j.enemy;
            bool alive = e && !e.Dead;
            var c = j.center;
            float b = j.B;
            if (j.centerAlive && ReactionSystem.Hit(e, b * (e.armor > 0 ? M.ArmorMult : 1), Element.Corrode, j.depth, c, Reaction.Meltdown, j.weaponUid))
                j.hits++;
            var foot = alive ? e.transform.position : ReactionSystem.Ground(c);
            Spawn(foot + Vector3.up * 0.05f, ReactionSystem.Radius(M.PoolRadius), b, j.depth, j.weaponUid);
            // 表现（同 Three.js runMeltdown）：熔金橙的下坠爆发 + 蚀绿爆发；脚下的熔池贴花在 Spawn 里
            Fx.Burst(c, CombatTuning.ReactionColors[(int)Reaction.Meltdown], 14, 4f, 0.6f, 0.14f, 12f);
            Fx.Burst(c, Fx.ElementColor(Element.Corrode), 8, 2.5f, 0.7f, 0.1f, 8f);
            GameAudio.PlayAt("skill_fire", c, 0.55f, 0.75f);
            GameAudio.PlayAt("corrode_tick", c, 0.7f);
        }

        void Spawn(Vector3 center, float radius, float b, int depth, int weaponUid)
        {
            while (pools.Count >= M.MaxPools)
            {
                Recycle(pools[0]);
                pools.RemoveAt(0);
            }
            var pool = spare.Count > 0 ? spare.Pop() : new Pool();
            pool.center = center;
            pool.radius = radius;
            pool.b = b;
            pool.depth = depth;
            pool.weaponUid = weaponUid;
            pool.age = 0;
            pool.next = M.PoolTick;
            pool.ticks = 0;
            pool.touched.Clear();
            pools.Add(pool);
            ReactionSystem.Stats.pools = pools.Count;
            pool.fx = Fx.MeltdownPool(center, radius, M.PoolTick * M.PoolTicks);
        }

        public override void Tick(float dt)
        {
            for (int i = pools.Count - 1; i >= 0; i--)
            {
                if (i >= pools.Count) continue; // 跳伤期间被 Clear 了
                var pool = pools[i];
                pool.age += dt;
                if (pool.age < pool.next) continue;
                pool.next += M.PoolTick;
                pool.ticks++;
                TickPool(pool);
                if (pool.ticks >= M.PoolTicks && i < pools.Count && pools[i] == pool)
                {
                    pools.RemoveAt(i);
                    Recycle(pool);
                }
            }
            ReactionSystem.Stats.pools = pools.Count;
        }

        void TickPool(Pool pool)
        {
            snapshot.Clear();
            var all = EnemyAI.All;
            for (int k = 0; k < all.Count; k++) snapshot.Add(all[k]);
            float dmg = pool.b * M.PoolDamage;
            for (int k = 0; k < snapshot.Count; k++)
            {
                var ai = snapshot[k];
                if (!ai || ai.Dead) continue;
                var d = ai.Health;
                if (!d) continue;
                var flat = ai.transform.position - pool.center;
                float dy = flat.y;
                flat.y = 0;
                if (flat.magnitude > pool.radius || dy > M.PoolHeight || dy < -M.PoolBelow) continue;
                ReactionSystem.Hit(d, dmg, Element.Fire, pool.depth, ReactionSystem.CenterOf(d), Reaction.Meltdown, pool.weaponUid, DamageTag.Dot);
                if (pool.touched.Add(d)) Combat.AttachFromReaction(d, Element.Corrode, pool.b * M.PoolCorrode, pool.depth + 1, pool.weaponUid);
            }
            snapshot.Clear();
            // 每跳（同 Three.js tickPool）：熔池光环 + 两团上升的火星（熔池贴花自己也一直冒余烬）
            Fx.Ring(pool.center, pool.radius, CombatTuning.ReactionColors[(int)Reaction.Meltdown], 0.5f, false);
            for (int k = 0; k < 2; k++)
            {
                var off = Random.insideUnitCircle * pool.radius * 0.85f;
                Fx.Burst(pool.center + new Vector3(off.x, 0.1f, off.y), PoolEmber, 4, 1.5f, 0.6f, 0.1f, -3f);
            }
        }

        static readonly Color PoolEmber = Hex.Rgb(0xffa040);

        void Recycle(Pool pool)
        {
            pool.fx.Cancel();
            pool.fx = FxHandle.None;
            pool.touched.Clear();
            spare.Push(pool);
        }

        public override void Clear()
        {
            foreach (var p in pools) Recycle(p);
            pools.Clear();
            snapshot.Clear();
            ReactionSystem.Stats.pools = 0;
        }
    }
}
