using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 焚身 · 熔流轮转的熔流（Three.js Qilin startFloodCycle / tickFlood + QilinArena.floodShapes；BS5，docs/level-design/maps/3-4.md）：
    /// 倒鼎压满熔池，熔岩溢进四条渠。从玩家所在的象限起、俯视顺时针轮流，把夹着那个象限的两条渠的外段（窄桥以外到殿墙）朝象限一侧涨宽到 4 m：
    ///   预警 1.5 s（地上两条预警条带；导航网格这时就挖掉，地面敌人先躲开）→ 涨 6 s（狂怒 4 s）→ 退 → 隔 0.6 s（狂怒 0.3 s）→ 下一个象限，四个象限轮完结束。
    /// 熔流是运行时的 <see cref="LavaVolume"/>（每个象限两片盒子，第一次用时建好）：平时沉在地面以下 1.6 m、组件停用（不登记，不影响安全落脚点）；
    /// 涨到地面以上 = 真的熔岩（玩家踩进去照常下沉托回、地面敌人被挪到岸上，<see cref="LavaField"/>）；涨过基准面 0.35 m 起，
    /// LavaVolume 用挖洞的 NavMeshObstacle 把那片地面从导航网格上挖掉（运行时改导航，地面敌人绕开；首领自己找落脚点用 <see cref="LavaField.WalkerFilter"/>）。
    /// 首领倒下 / 销毁时全部退回、销毁。
    /// </summary>
    public sealed class QilinFlood
    {
        /// <summary>预警、涨着（狂怒）、象限之间的间隔（狂怒）（秒，TS FLOOD_WARN / FLOOD_ON / FLOOD_ON_RAGE / gap）</summary>
        public const float WarnSeconds = 1.5f, OnSeconds = 6f, OnSecondsRage = 4f, GapSeconds = 0.6f, GapSecondsRage = 0.3f;
        /// <summary>涨宽后的熔岩带总宽（米，含渠本身；TS FLOOD_WIDTH）、平时沉在地面下多深、涨到地面以上多高、涨 / 退用时</summary>
        public const float FloodWidth = 4f, SunkDepth = 1.6f, Rise = 0.03f, RiseSeconds = 0.5f, RecedeSeconds = 0.6f;
        /// <summary>熔流带内侧压进渠里多少（米，接缝不露地面）、外端伸进殿墙多少</summary>
        public const float Overlap = 0.1f, WallTuck = 0.8f;

        /// <summary>一条熔流带（世界坐标）：盒中心（殿内地面高度）、朝向（= 渠的方位）、宽 × 长；预警条带的起点、长、半宽</summary>
        public struct Strip
        {
            public Vector3 center;
            public float yaw;
            public Vector2 size;
            public Vector3 from;
            public float length, halfWidth;
            /// <summary>贴着的渠（channelYaws 的下标）</summary>
            public int channel;
        }

        enum Stage { Warn, On, Gap }

        readonly QilinBrain boss;
        readonly List<LavaVolume>[] volumes;
        readonly List<(LavaVolume v, float at)> sleeping = new();
        readonly List<Strip> scratch = new();
        int[] order;
        int index;
        Stage stage;
        float t;

        /// <summary>轮转进行中（四个象限还没轮完）</summary>
        public bool Active => order != null;
        /// <summary>正涨着的象限（没有为 −1）</summary>
        public int FloodingQuadrant => Active && stage == Stage.On ? order[index] : -1;
        /// <summary>正在预警的象限（没有为 −1）</summary>
        public int WarningQuadrant => Active && stage == Stage.Warn ? order[index] : -1;
        /// <summary>这一轮的顺序（测试用；没有轮转时为空）</summary>
        public IReadOnlyList<int> Order => order ?? System.Array.Empty<int>();
        /// <summary>这一轮轮到第几个</summary>
        public int Index => Active ? index : -1;
        /// <summary>累计：开始过几轮、涨过几次（一次 = 一个象限）、本轮这一次涨着用的时长</summary>
        public int Cycles { get; private set; }
        public int Floods { get; private set; }
        public float CurrentOnSeconds { get; private set; }
        /// <summary>建好的熔流片数</summary>
        public int VolumeCount
        {
            get
            {
                int n = 0;
                if (volumes != null)
                    foreach (var l in volumes)
                        if (l != null)
                            n += l.Count;
                return n;
            }
        }

        public QilinFlood(QilinBrain boss)
        {
            this.boss = boss;
            var f = boss ? boss.Furnace : null;
            volumes = new List<LavaVolume>[f ? Mathf.Max(1, f.QuadrantCount) : 4];
        }

        // ───────────── 几何（纯计算，EditMode 测试守着）─────────────

        /// <summary>
        /// 象限 q 的两条熔流带（TS floodShapes）：夹着它的两条渠（channelYaws[q] 与 channelYaws[q + 1]）各一条，朝象限一侧，
        /// 横向从渠中线外 (渠半宽 − 0.1) 到 (4 − 渠半宽)，纵向从窄桥外端 + 0.15 到殿墙外 0.8（只淹外段，窄桥以内不动）
        /// </summary>
        public static void Strips(QilinFurnace f, int q, List<Strip> into)
        {
            into.Clear();
            if (!f || f.QuadrantCount == 0) return;
            int n = f.QuadrantCount;
            q = ((q % n) + n) % n;
            float r0 = f.bridgeOuter + 0.15f, r1 = f.wallRadius + WallTuck;
            float near = Mathf.Max(0, f.channelHalfWidth - Overlap), far = Mathf.Max(near + 0.5f, FloodWidth - f.channelHalfWidth);
            for (int k = 0; k < 2; k++)
            {
                int ch = (q + k) % n;
                float a = f.channelYaws[ch];
                // 渠在象限的低方位一侧（k = 0）→ 往方位增大的方向涨；高方位一侧（k = 1）→ 往方位减小的方向涨
                float s = k == 0 ? 1f : -1f;
                float rad = a * Mathf.Deg2Rad;
                var d = new Vector3(Mathf.Sin(rad), 0, Mathf.Cos(rad));
                var tan = new Vector3(Mathf.Cos(rad), 0, -Mathf.Sin(rad)) * s;
                float mid = (near + far) * 0.5f;
                var c = f.Center;
                into.Add(new Strip
                {
                    center = c + d * ((r0 + r1) * 0.5f) + tan * mid,
                    yaw = a,
                    size = new Vector2(far - near, r1 - r0),
                    from = c + d * r0 + tan * mid,
                    length = Mathf.Max(0.5f, f.wallRadius - r0),
                    halfWidth = (far - near) * 0.5f,
                    channel = ch,
                });
            }
        }

        // ───────────── 轮转 ─────────────

        /// <summary>
        /// 开始一轮（从 firstQuadrant 起、俯视顺时针）；restart = 正在轮也重新开始（狂怒：已经涨着的立刻退掉）。没有炉心殿几何时什么都不做。返回是否开始了
        /// </summary>
        public bool Start(int firstQuadrant, bool restart = false)
        {
            var f = boss ? boss.Furnace : null;
            if (!f || f.QuadrantCount == 0) return false;
            if (Active)
            {
                if (!restart) return false;
                Stop();
            }
            int n = f.QuadrantCount;
            order = new int[n];
            order[0] = ((firstQuadrant % n) + n) % n;
            for (int i = 1; i < n; i++) order[i] = f.ClockwiseNext(order[i - 1]);
            index = 0;
            Cycles++;
            BeginWarn();
            return true;
        }

        /// <summary>停掉这一轮：涨着 / 预警中的熔流退回地下（首领倒下、狂怒重开）</summary>
        public void Stop()
        {
            order = null;
            foreach (var list in volumes)
            {
                if (list == null) continue;
                foreach (var v in list)
                    if (v && v.enabled)
                        Sink(v, 0.4f);
            }
        }

        /// <summary>销毁全部熔流（首领销毁时）</summary>
        public void Dispose()
        {
            order = null;
            sleeping.Clear();
            foreach (var list in volumes)
            {
                if (list == null) continue;
                foreach (var v in list)
                    if (v)
                        Object.Destroy(v.gameObject);
                list.Clear();
            }
        }

        /// <summary>推进（首领每帧调，招式中、间隙都调）</summary>
        public void Tick(float dt)
        {
            for (int i = sleeping.Count - 1; i >= 0; i--)
            {
                var (v, at) = sleeping[i];
                if (!v)
                {
                    sleeping.RemoveAt(i);
                    continue;
                }
                if (Time.time < at) continue;
                sleeping.RemoveAt(i);
                // 退到底了：停用（不登记进熔岩系统，平时不影响安全落脚点、出生点）
                if (!v.Flooding && v.TargetLevel <= v.BaseLevel + 0.01f) v.enabled = false;
            }
            if (!Active || !(dt > 0)) return;
            t += dt;
            bool rage = boss && boss.Enraged;
            int q = order[index];
            switch (stage)
            {
                case Stage.Warn:
                    if (t < WarnSeconds) return;
                    stage = Stage.On;
                    t = 0;
                    CurrentOnSeconds = rage ? OnSecondsRage : OnSeconds;
                    Floods++;
                    var f = boss.Furnace;
                    if (f)
                    {
                        // 熔岩涌进渠：窄桥外端冒火
                        var at = f.Point(f.QuadrantYaw(q), f.bridgeOuter + 3f) + Vector3.up * 0.3f;
                        Fx.Burst(at, QilinDef.Ember, 30, 7f, 0.9f, 0.3f, 6f);
                        GameAudio.PlayAt("skill_fire", at, 0.9f, 0.5f);
                    }
                    return;
                case Stage.On:
                    // 狂怒中途开始：剩下的时间按狂怒的算
                    if (rage) CurrentOnSeconds = Mathf.Min(CurrentOnSeconds, OnSecondsRage);
                    if (t < CurrentOnSeconds) return;
                    foreach (var v in Volumes(q))
                        if (v)
                            Sink(v, RecedeSeconds);
                    stage = Stage.Gap;
                    t = 0;
                    return;
                case Stage.Gap:
                    if (t < (rage ? GapSecondsRage : GapSeconds)) return;
                    index++;
                    if (index >= order.Length)
                    {
                        order = null;
                        return;
                    }
                    BeginWarn();
                    return;
            }
        }

        void BeginWarn()
        {
            stage = Stage.Warn;
            t = 0;
            var f = boss.Furnace;
            int q = order[index];
            Strips(f, q, scratch);
            var hz = boss.Hazards;
            foreach (var s in scratch)
                if (hz)
                    hz.LineWarning(new Vector3(s.from.x, f.FloorY, s.from.z), s.yaw, s.length, s.halfWidth, WarnSeconds, QilinDef.Warn, 0, WarnKind.Hazard);
            float top = boss.FloorY + Rise;
            // 预警一开始就让熔流「将要涨」：LavaVolume 立刻把盖住的地面从导航网格上挖掉，预警完再涨上来
            foreach (var v in Volumes(q))
            {
                if (!v) continue;
                v.enabled = true;
                v.RiseTo(top, RiseSeconds, WarnSeconds);
            }
            GameAudio.PlayAt("telegraph", f.Center, 1f, 0.6f);
        }

        void Sink(LavaVolume v, float seconds)
        {
            v.Recede(seconds);
            sleeping.Add((v, Time.time + seconds + 0.1f));
        }

        /// <summary>象限 q 的两片熔流（第一次用时建：沉在地面以下、停用）</summary>
        public List<LavaVolume> Volumes(int q)
        {
            var f = boss ? boss.Furnace : null;
            if (!f || volumes.Length == 0) return new List<LavaVolume>();
            q = ((q % volumes.Length) + volumes.Length) % volumes.Length;
            var list = volumes[q];
            if (list != null && list.TrueForAll(v => v)) return list;
            list ??= new List<LavaVolume>();
            foreach (var v in list)
                if (v)
                    Object.Destroy(v.gameObject);
            list.Clear();
            Strips(f, q, scratch);
            var mat = ChannelMaterial();
            foreach (var s in scratch)
            {
                var c = new Vector3(s.center.x, boss.FloorY - SunkDepth, s.center.z);
                var v = LavaVolume.Create($"Qilin Flood q{q} c{s.channel}", c, LavaShape.Box, s.size, s.yaw, 1f, false, mat, boss.transform.parent);
                if (!v) continue;
                v.enabled = false;
                list.Add(v);
            }
            volumes[q] = list;
            return list;
        }

        /// <summary>借熔岩渠的材质（最窄的那片盒形熔岩：渠的岸边硬壳收窄过，窄条熔流用它不会整条结壳）；没有就让 LavaVolume 自己找</summary>
        static Material ChannelMaterial()
        {
            Material best = null;
            float w = float.PositiveInfinity;
            foreach (var v in LavaVolume.Live)
            {
                if (!v || !v.surface || !v.surface.sharedMaterial || v.shape != LavaShape.Box || v.name.StartsWith("Qilin Flood")) continue;
                if (v.size.x >= w) continue;
                w = v.size.x;
                best = v.surface.sharedMaterial;
            }
            return best;
        }

        /// <summary>某一点（XZ）此刻在不在涨着的熔流里（测试 / 首领找落脚点用）</summary>
        public bool Flooded(Vector3 p)
        {
            foreach (var list in volumes)
            {
                if (list == null) continue;
                foreach (var v in list)
                    if (v && v.enabled && v.Level > boss.FloorY - 0.2f && v.Body.Contains(p.x, p.z))
                        return true;
            }
            return false;
        }
    }
}
