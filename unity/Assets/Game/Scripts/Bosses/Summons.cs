using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>一次召唤的选项</summary>
    public struct SummonOptions
    {
        /// <summary>落点预警时长（秒）：预警圈亮够了才生成（敌人自己还有 0.7 s 出生无敌）</summary>
        public float warn;
        /// <summary>没有召唤点时，绕首领一圈的半径范围（米）</summary>
        public float minRadius, maxRadius;
        /// <summary>这种召唤物（同 enemyId）同时在场的上限（0 = 只受首领总上限约束）</summary>
        public int cap;
        public bool elite;
        /// <summary>不给奖励、不计击杀（分身、碎片）</summary>
        public bool noReward;
        /// <summary>首领转阶段时崩解（每阶段一批的爪牙）</summary>
        public bool despawnOnPhase;
        /// <summary>优先用场地的召唤点（<see cref="BossArena.summonPoints"/>）；false = 绕首领一圈</summary>
        public bool usePoints;
        /// <summary>预警色（null = 敌人主题色）</summary>
        public Color? warnColor;

        /// <summary>默认：预警 0.8 s、绕首领 4–8 m、优先召唤点</summary>
        public static SummonOptions Default => new() { warn = 0.8f, minRadius = 4f, maxRadius = 8f, usePoints = true };
    }

    /// <summary>
    /// 首领的召唤物（Three.js BossBase.summon / pruneMinions / killMinions）：
    ///   <see cref="Spawn"/>：先在落点画预警，<see cref="SummonOptions.warn"/> 秒后经 <see cref="EnemyRoster.Spawn(string, Vector3, Quaternion, float, bool, SpawnOptions)"/> 生成（同首领的难度）；
    ///     上限：首领定义的 <see cref="BossDef.summonCap"/>（在场 + 预警中合计），以及每次召唤可选的同种上限；落点优先用场地的召唤点，没有就绕首领一圈，都夹进场地。
    ///   崩解：首领倒下时全部（含还在预警的）静默处决——<see cref="Combat.Execute"/> purge：不掉落、不给魂晶、不计击杀（同 TS killMinions 的 purge 约定）；
    ///     标了 despawnOnPhase 的那批在转阶段时崩解。
    /// 生成的敌人和首领挂在同一个父节点下（关卡场景里），随关卡场景一起卸载。
    /// </summary>
    public sealed class Summons
    {
        struct Pending
        {
            public string id;
            public Vector3 pos;
            public float at;
            public SummonOptions o;
        }

        readonly BossBrain owner;
        readonly List<EnemyAI> live = new();
        readonly List<Pending> pending = new();
        readonly HashSet<EnemyAI> phaseBound = new();
        static readonly List<EnemyAI> scratch = new();

        public Summons(BossBrain owner) => this.owner = owner;

        /// <summary>同时在场 + 预警中的上限（首领定义）</summary>
        public int Cap => owner && owner.Def != null ? Mathf.Max(0, owner.Def.summonCap) : 0;
        /// <summary>在场（活着）的召唤物</summary>
        public IReadOnlyList<EnemyAI> Live
        {
            get
            {
                Prune();
                return live;
            }
        }

        public int Alive
        {
            get
            {
                Prune();
                return live.Count;
            }
        }

        /// <summary>预警中、还没生成的</summary>
        public int PendingCount => pending.Count;
        /// <summary>累计生成过几只</summary>
        public int TotalSpawned { get; private set; }

        /// <summary>某种召唤物在场 + 预警中的数量</summary>
        public int Count(string enemyId)
        {
            Prune();
            int n = 0;
            foreach (var e in live)
                if (e.enemyId == enemyId)
                    n++;
            foreach (var p in pending)
                if (p.id == enemyId)
                    n++;
            return n;
        }

        /// <summary>
        /// 召唤 count 只 enemyId（受上限约束，可能少召或不召）；返回实际排进预警的数量。名册里没有这个 id 时返回 0 并警告
        /// </summary>
        public int Spawn(string enemyId, int count, SummonOptions o)
        {
            if (!owner || owner.Dead || count <= 0) return 0;
            if (EnemyRoster.Get(enemyId) == null)
            {
                Debug.LogWarning($"[Boss] {owner.name} 召唤的 {enemyId} 不在敌人名册里");
                return 0;
            }
            Prune();
            int room = Cap - live.Count - pending.Count;
            if (o.cap > 0) room = Mathf.Min(room, o.cap - Count(enemyId));
            count = Mathf.Min(count, room);
            if (count <= 0) return 0;
            if (!(o.maxRadius > 0)) o.maxRadius = 8f;
            o.minRadius = Mathf.Clamp(o.minRadius, 0, o.maxRadius);
            var arena = owner.Arena;
            var points = o.usePoints && arena && arena.summonPoints != null && arena.summonPoints.Length > 0 ? arena.summonPoints : null;
            int start = UnityEngine.Random.Range(0, 1024);
            var def = EnemyRoster.Get(enemyId);
            var color = o.warnColor ?? (def != null ? def.GlowColor : owner.Def.WarnColor);
            float now = Time.time;
            for (int i = 0; i < count; i++)
            {
                Vector3 pos;
                if (points != null)
                {
                    var t = points[(start + i) % points.Length];
                    pos = t ? t.position : owner.transform.position;
                    // 同一个召唤点轮到第二次时错开一点
                    if (i >= points.Length)
                    {
                        var jitter = UnityEngine.Random.insideUnitCircle * 1.5f;
                        pos += new Vector3(jitter.x, 0, jitter.y);
                    }
                }
                else
                {
                    float a = (i / (float)count) * Mathf.PI * 2 + UnityEngine.Random.Range(-0.4f, 0.4f) + owner.transform.eulerAngles.y * Mathf.Deg2Rad;
                    float r = UnityEngine.Random.Range(o.minRadius, o.maxRadius);
                    pos = owner.transform.position + new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * r;
                }
                if (arena) pos = arena.Clamp(pos, 2.5f);
                if (UnityEngine.AI.NavMesh.SamplePosition(pos, out var hit, 4f, UnityEngine.AI.NavMesh.AllAreas)) pos = hit.position;
                float warn = Mathf.Max(0, o.warn);
                if (warn > 0) Telegraph.Circle(pos, Mathf.Max(1f, (def?.radius ?? 0.5f) * (def?.scale ?? 1f) * 2.2f), warn, color, TelegraphTone.Own);
                pending.Add(new Pending { id = enemyId, pos = pos, at = now + warn, o = o });
            }
            if (!(o.warn > 0)) Tick(0);
            return count;
        }

        /// <summary>预警到点的生成出来（首领每帧调）</summary>
        public void Tick(float dt)
        {
            if (pending.Count == 0) return;
            if (!owner || owner.Dead)
            {
                pending.Clear();
                return;
            }
            float now = Time.time;
            for (int i = 0; i < pending.Count; i++)
            {
                var p = pending[i];
                if (now < p.at) continue;
                pending.RemoveAt(i--);
                SpawnNow(p);
            }
        }

        void SpawnNow(Pending p)
        {
            var face = owner.PlayerPosition - p.pos;
            face.y = 0;
            var rot = face.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(face) : owner.transform.rotation;
            var parent = owner.transform.parent;
            EnemyAI ai;
            try
            {
                ai = EnemyRoster.Spawn(p.id, p.pos, rot, owner.level, p.o.elite, new SpawnOptions { parent = parent });
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                return;
            }
            if (!ai) return;
            if (p.o.noReward && ai.Health) ai.Health.noReward = true;
            live.Add(ai);
            if (p.o.despawnOnPhase) phaseBound.Add(ai);
            TotalSpawned++;
        }

        /// <summary>转阶段：标了 despawnOnPhase 的那批崩解（还在预警的也取消）</summary>
        public int DespawnPhaseBound()
        {
            pending.RemoveAll(p => p.o.despawnOnPhase);
            scratch.Clear();
            foreach (var e in phaseBound)
                if (e && !e.Dead)
                    scratch.Add(e);
            phaseBound.Clear();
            int n = Purge(scratch);
            scratch.Clear();
            return n;
        }

        /// <summary>全部崩解（首领倒下 / 被移除）：静默处决在场的，取消预警中的。返回处决的个数</summary>
        public int DespawnAll()
        {
            pending.Clear();
            Prune();
            scratch.Clear();
            scratch.AddRange(live);
            live.Clear();
            phaseBound.Clear();
            int n = Purge(scratch);
            scratch.Clear();
            return n;
        }

        static int Purge(List<EnemyAI> list)
        {
            int n = 0;
            foreach (var e in list)
            {
                if (!e || e.Dead || !e.Health) continue;
                try
                {
                    Combat.Execute(e.Health, true);
                    n++;
                }
                catch (Exception ex)
                {
                    Debug.LogException(ex);
                }
            }
            return n;
        }

        void Prune()
        {
            live.RemoveAll(e => !e || e.Dead);
            if (phaseBound.Count > 0) phaseBound.RemoveWhere(e => !e || e.Dead);
        }
    }
}
