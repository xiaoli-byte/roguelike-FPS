using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 3-3 铸范大坊 · 神范台的熔铜渠（docs/level-design/maps/3-3.md 第 6 节；D5「魔将原本的方场熔岩涌动改成 3-3 的熔铜渠涨落」）：
    /// 关卡构建器挂在熔心魔将的首领场地（<see cref="BossArena"/>）上，列出领主战里会漫出来的熔岩（<see cref="surge"/>）——
    /// 十字两条浅渠（7 m 宽、比床面低 0.25 m）被四座桥切成八段，外加中央熔池；每段的熔岩盒比渠宽出两侧各 3 m 的渠岸。
    ///   平时：熔岩面在渠里，渠岸是干的床面；
    ///   <see cref="Flood"/>：先翻涌发亮预警（<see cref="warn"/> 秒，导航网格这时就挖掉），再涨过渠岸（<see cref="rise"/> 米，渠岸上的玩家下沉托回、敌人挪岸），
    ///     停 hold 秒后自己退回；桥面下面那一小段是静止的熔岩，不在这里——桥永远是干的，是走位线。
    /// 熔心魔将的「熔铜渠涨落」招式调它；首领倒下、领主战结算时 <see cref="Recede"/>。涨落本身走 L7 的 <see cref="LavaVolume.RiseTo"/> / <see cref="LavaVolume.Recede"/>。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class FoundryChannels : MonoBehaviour
    {
        [Tooltip("领主战里会漫出来的熔岩段（渠 + 两侧渠岸）")]
        public LavaVolume[] surge = Array.Empty<LavaVolume>();
        [Tooltip("涨潮时比基准熔岩面高多少（米）：要高过渠岸床面 + 站立判定")]
        public float rise = 0.6f;
        [Tooltip("翻涌预警 / 涨上来 / 退下去的秒数")]
        public float warn = 2.4f, riseTime = 1.2f, fallTime = 2.2f;

        float holdUntil = -1;

        static readonly List<FoundryChannels> all = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        /// <summary>开始涨（预警起算）的次数</summary>
        public int Floods { get; private set; }
        /// <summary>正在涨 / 高位 / 预警中（任一段）</summary>
        public bool Flooding
        {
            get
            {
                foreach (var v in surge)
                    if (v && v.Flooding)
                        return true;
                return false;
            }
        }

        /// <summary>至少一段熔岩面已经漫过渠岸（基准面 + rise × 0.8）</summary>
        public bool Overflowing
        {
            get
            {
                foreach (var v in surge)
                    if (v && v.Level >= v.BaseLevel + rise * 0.8f)
                        return true;
                return false;
            }
        }

        /// <summary>高位还要停多久（秒；没在涨为 0）</summary>
        public float HoldLeft => holdUntil > 0 ? Mathf.Max(0, holdUntil - Time.time) : 0;

        /// <summary>熔岩段数（有效的）</summary>
        public int Count
        {
            get
            {
                int n = 0;
                foreach (var v in surge)
                    if (v)
                        n++;
                return n;
            }
        }

        /// <summary>开始涨（预警开始时）/ 退回低位</summary>
        public event Action<FoundryChannels> FloodBegan, Receded;

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        /// <summary>某个首领场地的熔铜渠：挂在场地上（或子物体上）的那份；没有就找场上离场地中心最近的一份（离中心 60 m 以内）。都没有返回 null</summary>
        public static FoundryChannels For(BossArena arena)
        {
            if (!arena) return null;
            var c = arena.GetComponent<FoundryChannels>();
            if (!c) c = arena.GetComponentInChildren<FoundryChannels>();
            if (c) return c;
            FoundryChannels best = null;
            float bestD = 60f * 60f;
            foreach (var f in all)
            {
                if (!f) continue;
                float d = (f.transform.position - arena.Center).sqrMagnitude;
                if (d >= bestD) continue;
                best = f;
                bestD = d;
            }
            return best;
        }

        /// <summary>
        /// 涨：每段先预警 <see cref="warn"/> 秒、再 <see cref="riseTime"/> 秒涨到 基准面 + <see cref="rise"/>，高位停 hold 秒后自己退回。
        /// 已经在涨时只把高位延长到这次的结束时刻，返回 false
        /// </summary>
        public bool Flood(float hold, float warnSeconds = -1)
        {
            float w = warnSeconds >= 0 ? warnSeconds : warn;
            float until = Time.time + w + riseTime + Mathf.Max(0, hold);
            if (holdUntil > 0 && Flooding)
            {
                holdUntil = Mathf.Max(holdUntil, until);
                return false;
            }
            foreach (var v in surge)
                if (v)
                    v.RiseTo(v.BaseLevel + rise, riseTime, w);
            holdUntil = until;
            Floods++;
            Raise(FloodBegan);
            return true;
        }

        /// <summary>退回基准面（不预警）</summary>
        public void Recede()
        {
            bool was = holdUntil > 0 || Flooding;
            holdUntil = -1;
            foreach (var v in surge)
                if (v)
                    v.Recede(fallTime);
            if (was) Raise(Receded);
        }

        void Update()
        {
            if (holdUntil > 0 && Time.time >= holdUntil) Recede();
        }

        void Raise(Action<FoundryChannels> ev)
        {
            if (ev == null) return;
            try
            {
                ev(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(1f, 0.55f, 0.15f, 0.9f);
            foreach (var v in surge)
                if (v)
                    Gizmos.DrawLine(transform.position + Vector3.up, v.transform.position + Vector3.up);
        }
    }
}
