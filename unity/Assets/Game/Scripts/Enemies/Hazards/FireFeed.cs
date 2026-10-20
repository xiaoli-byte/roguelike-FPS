using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>地上的火的种类：炭童的余烬炭堆 / 地火（各种敌人留在地上的火）/ 熔岩边（吃不完）</summary>
    public enum FireKind { Ember, Floor, Lava }

    /// <summary>一处能被祸斗吃掉的火（Three.js 版 inferno/FireFeed.ts 的 FireSource）</summary>
    public interface IFireSource
    {
        FireKind Kind { get; }
        /// <summary>火的地面中心（世界坐标）</summary>
        Vector3 Position { get; }
        /// <summary>火区半径（米）</summary>
        float Radius { get; }
        /// <summary>还能吃（炭堆还在、地火没灭）</summary>
        bool Edible { get; }
        /// <summary>被吃掉：炭堆消失、地火熄灭（熔岩边吃不完，什么也不做）</summary>
        void Consume();
        /// <summary>正被谁占着去吃（祸斗的 EnemyAI；测试里可以是任意对象），没有为 null</summary>
        object ClaimedBy { get; set; }
    }

    /// <summary>
    /// 「地上的火」登记表（docs/unity-parity.md 3.7「地上的火（可吃）」；Three.js 版 src/enemies/inferno/FireFeed.ts）——第三章祸斗食火用：
    ///   各处的火登记成 <see cref="IFireSource"/>（地火 <see cref="FloorFire"/> 默认自动登记；炭童的炭堆等自己实现接口再 <see cref="Register"/>）；
    ///   祸斗用 <see cref="Find"/> 找离自己最近、没被别的祸斗占着、高差够得着的一处，<see cref="Claim"/> 占住（同一处只让一只去吃），吃完调 Consume()。
    ///   熔岩边不登记：<see cref="LavaEdge"/> 由熔岩系统（L7 LavaField）提供「离某点最近的熔岩边」，吃不完、不占用。
    /// 吃不了的（烧完 / 被吃掉）在查询时清掉；占用者是已死 / 已销毁的敌人时自动放开。
    /// </summary>
    public static class FireFeed
    {
        static readonly List<IFireSource> sources = new();

        /// <summary>熔岩边查询（from, maxDist → 最近的熔岩边，没有返回 null）：熔岩系统接上之前为 null</summary>
        public static Func<Vector3, float, IFireSource> LavaEdge;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            sources.Clear();
            LavaEdge = null;
        }

        /// <summary>测试用：清空登记</summary>
        public static void ResetForTests() => ResetStatics();

        /// <summary>登记一处火（重复登记忽略）</summary>
        public static void Register(IFireSource src)
        {
            if (src != null && !sources.Contains(src)) sources.Add(src);
        }

        public static void Unregister(IFireSource src)
        {
            if (src != null) sources.Remove(src);
        }

        /// <summary>还能吃的火的个数</summary>
        public static int Count
        {
            get
            {
                Prune();
                return sources.Count;
            }
        }

        /// <summary>还能吃的火写进 into（先清空），返回个数（测试与调试用）</summary>
        public static int List(List<IFireSource> into)
        {
            into.Clear();
            Prune();
            into.AddRange(sources);
            return into.Count;
        }

        /// <summary>
        /// 离 from 最近（水平距离 − 火的半径）、maxDist 以内、没被别人占着、还能吃的火；高差超过 maxRise 的不算（高台上的火够不着）。没有返回 null
        /// </summary>
        public static IFireSource Find(Vector3 from, float maxDist, object eater, float maxRise = 1.2f)
        {
            Prune();
            IFireSource best = null;
            float bestD = maxDist;
            foreach (var s in sources)
            {
                var owner = s.ClaimedBy;
                if (owner != null && !ReferenceEquals(owner, eater)) continue;
                var p = s.Position;
                if (Mathf.Abs(p.y - from.y) > maxRise) continue;
                float d = new Vector2(p.x - from.x, p.z - from.z).magnitude - s.Radius;
                if (d < bestD)
                {
                    bestD = d;
                    best = s;
                }
            }
            return best;
        }

        /// <summary>熔岩边：交给 <see cref="LavaEdge"/>（没有熔岩系统 / 太远返回 null）</summary>
        public static IFireSource FindLavaEdge(Vector3 from, float maxDist) => LavaEdge?.Invoke(from, maxDist);

        /// <summary>占住一处火去吃：别人占着返回 false</summary>
        public static bool Claim(IFireSource src, object eater)
        {
            if (src == null || eater == null || !src.Edible) return false;
            var owner = src.ClaimedBy;
            if (owner != null && !ReferenceEquals(owner, eater) && Alive(owner)) return false;
            src.ClaimedBy = eater;
            return true;
        }

        /// <summary>放开 eater 占着的所有火（祸斗被打断、死亡）</summary>
        public static void Release(object eater)
        {
            if (eater == null) return;
            foreach (var s in sources)
                if (ReferenceEquals(s.ClaimedBy, eater))
                    s.ClaimedBy = null;
        }

        /// <summary>清掉吃不了的；放开已死 / 已销毁的占用者</summary>
        static void Prune()
        {
            for (int i = sources.Count - 1; i >= 0; i--)
            {
                var s = sources[i];
                if (s == null || (s is UnityEngine.Object o && !o) || !s.Edible)
                {
                    sources.RemoveAt(i);
                    continue;
                }
                if (s.ClaimedBy != null && !Alive(s.ClaimedBy)) s.ClaimedBy = null;
            }
        }

        /// <summary>占用者还在：敌人要活着，其他 Unity 对象要没销毁，普通对象一律算在</summary>
        static bool Alive(object owner) => owner switch
        {
            EnemyAI e => e && !e.Dead,
            UnityEngine.Object o => o,
            _ => true,
        };
    }
}
