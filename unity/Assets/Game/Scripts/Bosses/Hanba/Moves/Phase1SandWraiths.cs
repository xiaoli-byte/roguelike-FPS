using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃 · 召沙魇（一阶段「烈日」，unity-maps-v1 第 3 节：召唤 3–4 个沙魇——第一章杂兵的沙化版）。
    ///   前摇（1.6 s ÷ 阶段节奏）：双臂高举 → 掌心下压（ART2 summonWraiths，summon 事件落在前摇结束）；脚下亮一圈沙色预警。
    ///   出手：按 <see cref="HanbaDef.wraithRoster"/> 顺序取前 3 只（二阶段起 4 只）：跳鼠刀兵 ×2 + 蝎尾弩卫（+ 跳鼠刀兵），
    ///     先在场地召唤点亮落点预警，0.9 s 后破沙而出（<see cref="Summons"/>：受首领召唤上限约束，首领倒下时全部崩解）。
    ///   召唤物由 <see cref="HanbaBrain"/> 染成沙魇（<see cref="SandWraith"/>）。
    /// 场上沙魇（在场 + 预警中）加上这次要召的会超过上限时权重为 0。
    /// </summary>
    public sealed class Phase1SandWraiths : HanbaMove
    {
        public const string MoveId = "sand_wraiths";

        public override string Id => MoveId;
        public override string Name => "召沙魇";

        /// <summary>上一次实际排进预警的数量、累计排进</summary>
        public int LastQueued { get; private set; }
        public int TotalQueued { get; private set; }

        float wind;

        public Phase1SandWraiths()
        {
            cooldown = 18f;
            recovery = 1.2f;
            weight = 1.6f;
            firstDelay = 5f;
            windup = 1.6f;
            active = 0.3f;
            recover = 1f;
        }

        /// <summary>这一阶段召几只</summary>
        public int CountFor(BossBrain b) => b && b.Phase >= 1 ? 4 : 3;

        public override float Weight(BossBrain b) =>
            b.Summons.Alive + b.Summons.PendingCount + CountFor(b) > b.Summons.Cap ? 0 : weight;

        protected override void Prepare()
        {
            Brain.Halt();
            wind = Windup(windup);
            if (Ring) Ring.SetBlaze(0.6f, 0.6f);
        }

        protected override void OnTelegraph()
        {
            WarnCircle(OnGround(Brain.transform.position), Brain.BodyRadius + 2.5f, wind, HanbaDef.Sand);
            // 片段 2.8 s，summon 在 1.6 s（57%）：整段拉伸到 wind ÷ 0.5714
            Act("summonWraiths", wind * 1.75f);
            Sfx("telegraph", 1f, 0.7f);
        }

        protected override bool WindupDone => Cue("summon", wind);

        protected override void OnWindup(float dt)
        {
            Brain.Face(Brain.PlayerPosition, 120f, dt);
            Brain.Glow(0, Mathf.Clamp01(StageT / Mathf.Max(0.01f, wind)));
            if (Rng.Value < 0.4f)
            {
                var p = Brain.transform.position + Dir(Rng.Range(0, 360f)) * Rng.Range(1.5f, Brain.BodyRadius + 2.5f);
                Fx.Burst(OnGround(p) + Vector3.up * 0.2f, HanbaDef.Sand, 3, 1.2f, 0.7f, 0.22f, -1.2f);
            }
        }

        protected override void OnActiveBegin()
        {
            var def = HDef;
            var roster = def != null ? def.wraithRoster : new[] { "jerboa_blade", "jerboa_blade", "scorpion_archer", "jerboa_blade" };
            int want = Mathf.Min(CountFor(Brain), roster.Length);
            // 同种合并成一次召唤（召唤点轮流用）
            var groups = new Dictionary<string, int>();
            var order = new List<string>();
            for (int i = 0; i < want; i++)
            {
                if (!groups.ContainsKey(roster[i]))
                {
                    groups[roster[i]] = 0;
                    order.Add(roster[i]);
                }
                groups[roster[i]]++;
            }
            var o = SummonOptions.Default;
            o.warn = 0.9f;
            o.minRadius = 4f;
            o.maxRadius = 9f;
            o.warnColor = HanbaDef.Sand;
            LastQueued = 0;
            foreach (var id in order) LastQueued += Brain.Summons.Spawn(id, groups[id], o);
            TotalQueued += LastQueued;
            if (Ring) Ring.Flash(0.8f);
            SkillFx.Burst(Brain.BodyCenter, HanbaDef.Sand, 24, 6f, 0.9f, 0.35f, 3f);
            Fx.Ring(OnGround(Brain.transform.position) + Vector3.up * 0.1f, 6f, HanbaDef.Sand, 0.6f);
            Brain.Shake(0.35f, 0.35f);
            Sfx("boss_roar", 0.5f, 1.3f);
        }
    }

    /// <summary>
    /// 沙魇：旱魃召出的第一章杂兵的沙化版（EN1 的沙魇变体没做，先用材质变体顶上，docs/unity-parity.md 第 6 节「沙魇：材质变体（Shader 参数）」）。
    /// 身体渲染器走 EnemyBody 的着色通道（MaterialPropertyBlock：_Tint 乘色 + _FlashColor 覆盖色），名字前缀「沙魇·」；出现和崩解时扬一团沙。
    /// 等 EN1 的沙魇 Prefab / 着色器参数落地后只改这里。
    /// </summary>
    public static class SandWraith
    {
        public const string Channel = "sandWraith";
        public const string Prefix = "沙魇·";

        /// <summary>染成沙魇（可重复调用）；返回是否染上</summary>
        public static bool Apply(EnemyAI e, Color tint, Color overlay, float amount)
        {
            if (!e || e.Dead) return false;
            var body = e.GetComponent<EnemyBody>();
            if (body)
            {
                body.SetTint(Channel, tint);
                body.SetOverlay(Channel, overlay, Mathf.Clamp01(amount));
            }
            var hp = e.Health;
            if (hp && (string.IsNullOrEmpty(hp.displayName) || !hp.displayName.StartsWith(Prefix)))
            {
                var def = EnemyRoster.Get(e.enemyId);
                hp.displayName = Prefix + (def != null ? def.name : string.IsNullOrEmpty(hp.displayName) ? e.enemyId : hp.displayName);
            }
            Fx.Burst(e.transform.position + Vector3.up * 0.6f, HanbaDef.Sand, 14, 3.5f, 0.8f, 0.3f, 2f);
            return true;
        }

        /// <summary>是不是沙魇（染过色）</summary>
        public static bool Is(EnemyAI e) => e && e.Health && !string.IsNullOrEmpty(e.Health.displayName) && e.Health.displayName.StartsWith(Prefix);

        /// <summary>沙魇倒下：散成一团沙</summary>
        public static void Crumble(Vector3 at) => Fx.Burst(at + Vector3.up * 0.5f, HanbaDef.Sand, 22, 4.5f, 1.1f, 0.35f, 4f);
    }
}
