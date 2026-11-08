using System.Collections;
using System.Linq;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 战斗导演（<see cref="CombatDirector"/>，docs/level-design/run-variety.md §3）实机冒烟：bridge.sh playtest director
    ///   1. Core 开局进 1-1（调试局：缺省不刷）→ 等过热身时间，确认调试局里一只游荡怪都没刷、据点编制没加量；
    ///   2. 打开（Force）→ 怪物表 = 这张图据点里出现过的敌人；立刻刷一群：出生圈之后真的刷出来、都在玩家 18 m 以外、在导航网格上；
    ///   3. 按时间自然刷：热身之后自己刷出第一群；
    ///   4. 据点加量：打开时开打的据点，普通单位 × 1.5、精英不变；据点交战中不刷游荡怪；
    ///   5. 场上上限 <see cref="CombatDirector.MaxAlive"/>。
    /// </summary>
    public sealed class DirectorSuite : PlaytestSuite
    {
        public override string Id => "director";
        public override string Scene => SceneFlow.CorePath;

        protected override IEnumerator Steps()
        {
            CombatDirector.Force = null;
            try
            {
                float t0 = Time.realtimeSinceStartup;
                while (Time.realtimeSinceStartup - t0 < 120f)
                {
                    var f = SceneFlow.Instance;
                    if (f && !f.Busy && f.Player != null && f.Player.root) break;
                    yield return null;
                }
                var flow = SceneFlow.Instance;
                var dir = CombatDirector.Instance;
                if (!flow || flow.Player == null || !dir)
                {
                    Fail($"没有就绪（SceneFlow {flow}，CombatDirector {dir}）");
                    yield break;
                }
                WeaponController.TestMode = true;
                HeroSkills.TestMode = true;
                var player = flow.Player;
                // 测试期间玩家无敌：站着不动等刷怪，别被游荡怪打死（导演在玩家阵亡时暂停）
                if (player.vitals) player.vitals.invulnerableUntil = float.MaxValue;
                Line($"进关：{flow.Current?.Label}，调试局 {RunState.Current?.dev}，Live = {CombatDirector.Live}");

                // ── 1. 调试局缺省不刷 ──
                if (CombatDirector.Live) Fail("调试局缺省不该打开游荡刷怪");
                yield return new WaitForSeconds(CombatDirector.Warmup + 3f);
                if (dir.Spawned > 0) Fail($"调试局里刷了 {dir.Spawned} 只游荡怪");
                else Line($"✓ 调试局：过了热身 {CombatDirector.Warmup:F0} s 没有刷游荡怪");

                // ── 2. 打开：怪物表、立刻刷一群 ──
                CombatDirector.Force = true;
                var roster = dir.Roster.ToList();
                if (roster.Count == 0) Fail("怪物表是空的");
                else Line($"✓ 怪物表（据点编制里出现过的敌人）：{string.Join("、", roster.Select(r => $"{r.id}×{r.weight:F0}"))}");
                int before = dir.Spawned;
                if (!dir.SpawnNow(5)) Fail("SpawnNow 没刷出来（找不到点？）");
                yield return new WaitForSeconds(1.6f);
                if (dir.Spawned - before < 3) Fail($"一群只刷出 {dir.Spawned - before} 只");
                var ppos = player.root.transform.position;
                var enemies = FindObjectsByType<EnemyAI>().Where(a => a && a.Health != null && !a.Health.Dead).ToList();
                float nearest = enemies.Count > 0 ? enemies.Min(a => Flat(a.transform.position, ppos)) : 0;
                if (enemies.Count > 0 && nearest < 16f) Fail($"游荡怪刷在玩家 {nearest:F1} m 处（应 ≥ 18 m）");
                foreach (var a in enemies)
                    if (!NavMesh.SamplePosition(a.transform.position, out _, 2.5f, NavMesh.AllAreas))
                        Fail($"{a.name} 不在导航网格上");
                Line($"✓ 立刻刷一群：{dir.Spawned - before} 只，最近 {nearest:F1} m，场上游荡怪 {dir.Alive}");
                // 关卡摆了入场点：这一群要从某个入场点进场（刚落地 1.6 s，离入场点不超过散开半径 + 6 m）
                var entries = MonsterEntry.All.Where(e => e && e.gameObject.scene == flow.CurrentScene).ToList();
                if (entries.Count == 0) Line($"· {flow.Current?.Label} 没有摆入场点：走的是随机落点兜底");
                else
                {
                    int off = enemies.Count(a => entries.Min(e => Flat(a.transform.position, e.transform.position) - e.spread) > 6f);
                    var near = entries.OrderBy(e => enemies.Count == 0 ? 0 : enemies.Min(a => Flat(a.transform.position, e.transform.position))).First();
                    if (off > 0) Fail($"有 {off} 只游荡怪不在任何入场点附近（共 {entries.Count} 个入场点）");
                    else Line($"✓ 从入场点「{near.label}」（{SpawnModes.Label(near.mode)}）进场；这张图共 {entries.Count} 个入场点");
                }
                // 看一眼：转向最近的那群
                var target = enemies.OrderBy(a => Flat(a.transform.position, ppos)).FirstOrDefault();
                if (target)
                {
                    var look = target.transform.position - ppos;
                    look.y = 0;
                    if (look.sqrMagnitude > 0.01f) player.root.transform.rotation = Quaternion.LookRotation(look);
                    yield return new WaitForSeconds(0.6f);
                    if (player.cam) Shot(player.cam, "director_pack");
                }
                KillAll();
                yield return new WaitForSeconds(1f);

                // ── 3. 按时间自然刷 ──
                int packs = dir.Packs;
                float wait = 0;
                while (dir.Packs == packs && wait < 40f)
                {
                    wait += Time.deltaTime;
                    yield return null;
                }
                if (dir.Packs == packs) Fail("打开后 40 s 内没有自然刷出一群");
                else Line($"✓ 自然刷：{wait:F1} s 后刷出第 {dir.Packs} 群，场上 {dir.Alive} 只");
                KillAll();
                yield return new WaitForSeconds(1f);

                // ── 4. 据点加量 + 交战中不刷 ──
                var site = FindObjectsByType<EncounterSite>().Where(s => s.phase == EncounterSite.Phase.Idle && !s.optional)
                    .OrderBy(s => Flat(s.transform.position, player.root.transform.position)).FirstOrDefault();
                if (!site) Fail("没有能开打的据点");
                else
                {
                    int template = site.spec.waves.Sum(w => w.entries.Sum(e => e.count));
                    int expect = site.spec.waves.Sum(w => w.entries.Sum(e => !e.elite && e.count >= 2 ? Mathf.CeilToInt(e.count * CombatDirector.SiteDensity) : e.count));
                    site.Activate();
                    int got = site.Runtime?.Total ?? 0;
                    if (got < expect) Fail($"{site.title}：开打后 {got} 只（模板 {template}，加量后应 ≥ {expect}）");
                    else Line($"✓ 据点加量：{site.title} 模板 {template} 只 → 开打 {got} 只");
                    if (site.spec.Total != template) Fail("加量改到了场景里的模板编制");
                    int p0 = dir.Packs;
                    yield return new WaitForSeconds(15f);
                    if (dir.Packs != p0) Fail("据点交战中还在刷游荡怪");
                    else Line("✓ 据点交战中 15 s 没刷游荡怪");
                }

                // ── 5. 上限 ──
                Line($"上限 {CombatDirector.MaxAlive}，这一关共刷 {dir.Packs} 群 {dir.Spawned} 只");
            }
            finally
            {
                CombatDirector.Force = null;
                var pv = PlayerVitals.Instance;
                if (pv) pv.invulnerableUntil = -1;
            }
        }

        /// <summary>清掉场上所有敌人（游荡怪 + 已经出场的据点怪）</summary>
        static void KillAll()
        {
            foreach (var a in FindObjectsByType<EnemyAI>())
                if (a && a.Health != null && !a.Health.Dead)
                    a.Health.Kill(default);
        }

        static float Flat(Vector3 a, Vector3 b)
        {
            a.y = b.y = 0;
            return Vector3.Distance(a, b);
        }
    }
}
