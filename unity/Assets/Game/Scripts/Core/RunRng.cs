using System;
using System.Collections.Generic;

namespace Spiritfire.Game
{
    /// <summary>
    /// 可种子化随机数（Three.js 版 src/core/Rng.ts 的 mulberry32，同种子同序列，便于和 TS 对拍）。
    /// 玩法随机按「流」分开：<see cref="Stream"/>(局种子, "loot") 只由种子和流名决定，各流互不扰动——
    /// 掉落多掷一次不会改变下一关的地图或刷怪。<see cref="Fork(int)"/> 同 TS fork：从当前状态派生一个子序列。
    /// 现有代码仍在用 UnityEngine.Random，之后各单元逐步迁过来（<see cref="RunState.Stream"/>）。
    /// </summary>
    public sealed class RunRng
    {
        uint s;

        public RunRng(int seed) => s = (uint)seed == 0 ? 1u : (uint)seed;
        RunRng(uint state) => s = state == 0 ? 1u : state;

        /// <summary>当前内部状态（存档 / 调试）</summary>
        public uint State => s;

        /// <summary>局种子 + 流名 → 独立的随机流（同样的参数总是得到同样的序列）</summary>
        public static RunRng Stream(int seed, string stream) => new RunRng(seed).Fork(Hash(stream));

        /// <summary>按当前状态派生子随机数（同 TS fork）</summary>
        public RunRng Fork(int salt)
        {
            unchecked
            {
                return new RunRng(((s ^ (uint)salt) * 2654435761u) ^ (uint)(salt * 97));
            }
        }

        public RunRng Fork(string stream) => Fork(Hash(stream));

        /// <summary>32 位无符号随机数（mulberry32 一步）</summary>
        public uint NextUInt()
        {
            unchecked
            {
                uint t = s += 0x6D2B79F5u;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return t ^ (t >> 14);
            }
        }

        /// <summary>[0, 1)</summary>
        public float Value => (float)(NextUInt() / 4294967296.0);

        /// <summary>[0, 1)（双精度，和 TS next() 逐位相同）</summary>
        public double NextDouble() => NextUInt() / 4294967296.0;

        /// <summary>[min, max)</summary>
        public float Range(float min, float max) => min + (max - min) * (float)NextDouble();

        /// <summary>[min, max] 闭区间整数（同 TS int）</summary>
        public int Int(int min, int max) => (int)Math.Floor(min + (max - min + 1) * NextDouble());

        public bool Chance(float p) => NextDouble() < p;

        public int Sign() => NextDouble() < 0.5 ? -1 : 1;

        public T Pick<T>(IReadOnlyList<T> list) => list == null || list.Count == 0 ? default : list[(int)(NextDouble() * list.Count)];

        /// <summary>按权重挑选；权重全 ≤ 0 时退化为均匀挑选（同 TS weighted）</summary>
        public T Weighted<T>(IReadOnlyList<T> list, Func<T, float> weight)
        {
            if (list == null || list.Count == 0) return default;
            double total = 0;
            foreach (var it in list) total += Math.Max(0, weight(it));
            if (total <= 0) return Pick(list);
            double r = NextDouble() * total;
            foreach (var it in list)
            {
                r -= Math.Max(0, weight(it));
                if (r <= 0) return it;
            }
            return list[list.Count - 1];
        }

        /// <summary>原地洗牌（Fisher–Yates，同 TS shuffle）</summary>
        public void Shuffle<T>(IList<T> list)
        {
            for (int i = list.Count - 1; i > 0; i--)
            {
                int j = (int)(NextDouble() * (i + 1));
                (list[i], list[j]) = (list[j], list[i]);
            }
        }

        /// <summary>流名的稳定哈希（FNV-1a，跨平台、跨运行一致；string.GetHashCode 不保证）</summary>
        public static int Hash(string text)
        {
            unchecked
            {
                uint h = 2166136261u;
                if (text != null)
                    foreach (char c in text)
                    {
                        h ^= c;
                        h *= 16777619u;
                    }
                return (int)h;
            }
        }
    }
}
