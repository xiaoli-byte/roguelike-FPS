using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 寻视线（Three.js 版 StandardEnemy.findVantage / seekSight）：远程敌人看不到玩家时，在玩家周围的一圈距离带里找一个看得见玩家的站位。
    ///   <see cref="Seek"/>：一次查询——环带 [minRange, maxRange] 里随机取 tries 个点，站位眼高处到目标眼睛不被地形 / 建筑挡住的，取离自己最近的一个。
    ///     地面单位（<see cref="SightMode.Ground"/>）：站位贴在导航网格上，眼高 = 头高；
    ///     飞行单位（<see cref="SightMode.Air"/>）：站位 = 地面点上方 eyeHeight（悬停高度），还要求那里有 clearance 半径的空位（不塞进柱子 / 屋檐里）。
    ///   <see cref="SightSeeker"/>：seekSight 的计时——连续看不到 0.4 s 才开始找，1.2–2 s 重选一次，到站位 0.8 m 内清空；找不到时由调用方朝目标逼近。
    /// 遮挡判定统一走 <see cref="Combat.Blocked"/>（地形 / 建筑挡，角色不挡；标了 blocksSight 的命中盒如冰壁也挡）。
    /// </summary>
    public static class Sight
    {
        /// <summary>玩家眼高（米，脚底以上；同 PlayerMotor 的 eye）</summary>
        public const float PlayerEye = 1.62f;

        /// <summary>两点之间看得见（地形 / 建筑不挡）</summary>
        public static bool Clear(Vector3 from, Vector3 to) => !Combat.Blocked(from, to, null);

        /// <summary>玩家眼睛的位置（没有玩家时返回 fallback）</summary>
        public static Vector3 PlayerEyeOr(Vector3 fallback)
        {
            var v = PlayerVitals.Instance;
            if (!v) return fallback;
            var m = v.GetComponent<Spiritfire.Art.PlayerMotor>();
            return m && m.eye ? m.eye.position : v.transform.position + Vector3.up * PlayerEye;
        }

        /// <summary>
        /// 找一个看得见 q.targetEye 的站位（离 q.from 最近的那个），找到返回 true。
        /// 地面：spot 是导航网格上的脚底，眼睛在 spot + eyeHeight；飞行：spot 是悬停点本身（地面 + eyeHeight），视线从 spot 起算。
        /// </summary>
        public static bool Seek(in SightQuery q, out Vector3 spot)
        {
            spot = default;
            float min = Mathf.Max(0, q.minRange), max = Mathf.Max(min + 0.5f, q.maxRange);
            int tries = q.tries > 0 ? q.tries : 6;
            float best = float.PositiveInfinity;
            bool found = false;
            for (int i = 0; i < tries; i++)
            {
                if (!RandomGround(q.target, min, max, out var ground)) continue;
                Vector3 eye, stand;
                if (q.mode == SightMode.Air)
                {
                    stand = ground + Vector3.up * q.eyeHeight;
                    eye = stand;
                    float r = Mathf.Max(0.1f, q.clearance);
                    if (Physics.CheckSphere(stand, r, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                }
                else
                {
                    stand = ground;
                    eye = ground + Vector3.up * q.eyeHeight;
                }
                if (!Clear(eye, q.targetEye)) continue;
                float d = (stand - q.from).sqrMagnitude;
                if (d >= best) continue;
                best = d;
                spot = stand;
                found = true;
            }
            return found;
        }

        /// <summary>
        /// 环带里的一个随机地面点：先找导航网格（2.5 m 内），没有导航网格时往下打射线找地面。
        /// 角度均匀、半径在 [min, max] 均匀（同 TS nav.randomWalkable）。
        /// </summary>
        public static bool RandomGround(Vector3 center, float min, float max, out Vector3 ground)
        {
            float a = Random.value * Mathf.PI * 2f, r = Random.Range(min, max);
            var p = center + new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r);
            if (NavMesh.SamplePosition(p, out var hit, 2.5f, NavMesh.AllAreas))
            {
                ground = hit.position;
                return true;
            }
            if (Physics.Raycast(p + Vector3.up * 6f, Vector3.down, out var g, 30f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
            {
                ground = g.point;
                return true;
            }
            ground = default;
            return false;
        }
    }

    /// <summary>寻视线的站位类型：贴地（导航网格）/ 悬停（地面点上方）</summary>
    public enum SightMode { Ground, Air }

    /// <summary><see cref="Sight.Seek"/> 的查询参数</summary>
    public struct SightQuery
    {
        /// <summary>目标脚底（环带圆心）与目标眼睛（视线终点）</summary>
        public Vector3 target, targetEye;
        /// <summary>自己的位置：多个候选里取离它最近的</summary>
        public Vector3 from;
        /// <summary>离目标的水平距离带（米）</summary>
        public float minRange, maxRange;
        /// <summary>站位的视线高度：地面单位 = 头高；飞行单位 = 悬停高度（离地）</summary>
        public float eyeHeight;
        /// <summary>飞行站位要求的空位半径（米）</summary>
        public float clearance;
        /// <summary>随机候选数（缺省 6，同 TS）</summary>
        public int tries;
        public SightMode mode;

        public SightQuery(Vector3 target, Vector3 targetEye, Vector3 from, float minRange, float maxRange, float eyeHeight, SightMode mode = SightMode.Ground)
        {
            this.target = target;
            this.targetEye = targetEye;
            this.from = from;
            this.minRange = minRange;
            this.maxRange = maxRange;
            this.eyeHeight = eyeHeight;
            this.mode = mode;
            clearance = 0.5f;
            tries = 6;
        }
    }

    /// <summary>
    /// Three.js seekSight 的计时与站位缓存（每个敌人一份）：
    ///   看得见 → 清空站位，不寻位；看不见不到 <see cref="blindDelay"/>（0.4 s）→ 先不动；
    ///   之后每 1.2–2 s 重新 <see cref="Sight.Seek"/> 一次；到站位 <see cref="arrive"/>（0.8 m）内清空、下一帧立刻重选。
    /// 用法：<c>if (seeker.Tick(sees, dt, query)) { if (seeker.HasSpot) 走到 seeker.Spot; else 朝玩家逼近; return; }</c>，到达后调 <see cref="Reached"/>。
    /// </summary>
    public sealed class SightSeeker
    {
        public float blindDelay = 0.4f, arrive = 0.8f;
        public Vector2 repick = new(1.2f, 2f);

        /// <summary>连续看不到目标的秒数</summary>
        public float BlindTime { get; private set; }
        public bool HasSpot { get; private set; }
        public Vector3 Spot { get; private set; }
        float timer;

        /// <summary>每帧调一次；返回 true 表示这一帧在寻位（调用方负责移动）</summary>
        public bool Tick(bool sees, float dt, in SightQuery q)
        {
            if (sees)
            {
                BlindTime = 0;
                HasSpot = false;
                return false;
            }
            BlindTime += dt;
            if (BlindTime < blindDelay) return false;
            timer -= dt;
            if (!HasSpot || timer <= 0)
            {
                timer = Random.Range(repick.x, repick.y);
                HasSpot = Sight.Seek(q, out var s);
                Spot = s;
            }
            return true;
        }

        /// <summary>到了：清空站位，下一帧重选（还看不见的话）</summary>
        public void Reached()
        {
            HasSpot = false;
            timer = 0;
        }

        /// <summary>水平距离到站位 arrive 以内（飞行单位只看水平，高度由飞行控制追）</summary>
        public bool Arrived(Vector3 at)
        {
            if (!HasSpot) return false;
            var d = Spot - at;
            d.y = 0;
            return d.sqrMagnitude <= arrive * arrive;
        }

        public void Reset()
        {
            BlindTime = 0;
            HasSpot = false;
            timer = 0;
        }
    }
}
