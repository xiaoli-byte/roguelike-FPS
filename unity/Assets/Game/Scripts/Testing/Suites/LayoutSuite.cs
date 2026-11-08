using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 每局不同的地图（docs/level-design/run-variety.md）实机冒烟：bridge.sh playtest layout
    ///   1. Core 开局后按正式流程「新的一局」（SceneFlow.NewRun）：这一局有洗过的路线，进的是路线的第一个槽位（编号 1-1、难度 1.00，场景 = 抽到的图）；
    ///   2. 进下一关：按路线走到第二个槽位；
    ///   3. 每张有变体的开放图（主图 + 备选图，场景建好的；不在这一局路线上的按规划表的图去）逐个走法（LevelLayout.Force）进一遍：出生在这个走法的出生点、只有这个走法的出口在场、
    ///      场地先后 / 编制 / 奖励按变体改写、关卡目标只收在场的场地、行旅图只标一个出口；
    ///   4. 不指定时同一局同一关重来两次抽到同一个变体（随机流只由种子 + 关卡编号决定）。
    /// </summary>
    public sealed class LayoutSuite : PlaytestSuite
    {
        public override string Id => "layout";
        public override string Scene => SceneFlow.CorePath;

        const float LoadTimeout = 120f;

        protected override IEnumerator Steps()
        {
            LevelLayout.Force = null;
            try
            {
                yield return WaitReady("Core 开局");
                var flow = SceneFlow.Instance;
                if (!flow)
                {
                    Fail("没有 SceneFlow");
                    yield break;
                }

                // ── 1. 新的一局：洗过的路线 ──
                int before = flow.Transitions;
                flow.NewRun();
                yield return WaitTransition(before, "新的一局");
                var run = RunState.Current;
                var route = run?.Route;
                if (route == null)
                {
                    Fail("新的一局没有路线（RunState.route 为空）");
                    yield break;
                }
                Line($"新的一局（种子 {run.seed}）：{route.Describe()}");
                var cur = flow.Current;
                if (cur == null || cur.route != route) Fail($"当前关不是这条路线上的槽位（{cur?.Label}）");
                else if (cur.code != "1-1" || Mathf.Abs(cur.difficulty - 1f) > 1e-4f) Fail($"第一个槽位应是 1-1、难度 1.00（{cur.code} {cur.difficulty:F2}）");
                if (cur != null && flow.CurrentScene.path != cur.scene) Fail($"加载的场景 {flow.CurrentScene.path} 不是槽位的地图 {cur.scene}");
                if (cur != null) Line($"✓ 进第一关：{cur.Label}（地图 {cur.map.code}，场景 {flow.CurrentScene.name}，难度 {run.difficulty:F2}）");
                if (route.Get("1-3")?.map.code != "1-3") Fail("沉沙古城（补给营）没有钉在 1-3");

                // ── 2. 进下一关：按路线 ──
                before = flow.Transitions;
                flow.Advance();
                yield return WaitTransition(before, "进下一关");
                var second = route.Slots[1];
                if (flow.Current != second) Fail($"下一关应是路线的第二个槽位 {second.Label}，实际 {flow.Current?.Label}");
                else if (flow.CurrentScene.path != second.scene) Fail($"第二关加载的场景 {flow.CurrentScene.path} 不对（应为 {second.scene}）");
                else Line($"✓ 下一关按路线：{second.Label}（难度 {run.difficulty:F2}）");

                // ── 3. 每张有变体的开放图（主图 + 图池）：每种走法进一遍 ──
                foreach (var map in RunPlan.AllMaps.Where(m => !m.IsBoss && RunPlan.Ready(m)).ToList())
                {
                    var slot = route.ForMap(map) ?? map;
                    LevelLayout.Force = null;
                    before = flow.Transitions;
                    if (!flow.GoTo(slot))
                    {
                        Fail($"去不了 {slot.Label}");
                        continue;
                    }
                    yield return WaitTransition(before, slot.Label);
                    var layout = LevelLayout.In(flow.CurrentScene);
                    if (!layout || layout.variants == null || layout.variants.Length < 2)
                    {
                        Line($"· {slot.Label}：没有布局变体");
                        continue;
                    }
                    var ids = layout.variants.Select(v => v.id).ToArray();
                    // 不指定：抽到的变体 = 按随机流算出来的那个，重来本关还是它（重来本关换的是进关快照的新 RunState，按当前局算）
                    int expect = LevelLayout.Pick(layout.variants, null, RunState.Current);
                    if (layout.ChosenIndex != expect) Fail($"{slot.Label}：抽到第 {layout.ChosenIndex} 种走法，按随机流应是第 {expect} 种");
                    int first = layout.ChosenIndex;
                    before = flow.Transitions;
                    flow.RestartStage();
                    yield return WaitTransition(before, $"{slot.Label} 重来");
                    layout = LevelLayout.In(flow.CurrentScene);
                    if (!layout || layout.ChosenIndex != first) Fail($"{slot.Label}：重来本关换了走法（{first} → {layout?.ChosenIndex}）");
                    else Line($"✓ {slot.Label}：这一局抽到「{layout.Chosen}」，重来本关不变（共 {ids.Length} 种：{string.Join("、", ids)}）");

                    foreach (var id in ids)
                    {
                        LevelLayout.Force = id;
                        before = flow.Transitions;
                        flow.RestartStage();
                        yield return WaitTransition(before, $"{slot.Label} · {id}");
                        Check(slot, flow, id);
                    }
                }
            }
            finally
            {
                LevelLayout.Force = null;
            }
        }

        void Check(StageSpec slot, SceneFlow flow, string id)
        {
            var scene = flow.CurrentScene;
            var layout = LevelLayout.In(scene);
            var v = layout ? layout.Chosen : null;
            string tag = $"{slot.Label} · {id}";
            if (v == null || v.id != id)
            {
                Fail($"{tag}：没有按指定的走法摆（{v?.id}）");
                return;
            }
            var player = flow.Player?.root ? flow.Player.root.transform.position : Vector3.zero;
            if (!v.spawn) Fail($"{tag}：变体没有出生点");
            else
            {
                float d = Flat(player, v.spawn.transform.position);
                if (d > 3f) Fail($"{tag}：玩家离这个走法的出生点 {d:F1} m");
                if (PlayerSpawn.In(scene) != v.spawn) Fail($"{tag}：PlayerSpawn.In 找到的不是这个走法的出生点");
            }
            var spawns = Components<PlayerSpawn>(scene, false);
            var exits = Components<ExitPortal>(scene, false);
            if (spawns.Count != 1) Fail($"{tag}：在场的出生点 {spawns.Count} 个（应为 1）");
            if (exits.Count != 1 || (v.exit && exits[0] != v.exit))
                Fail($"{tag}：在场的出口 {exits.Count} 个（应只有这个走法的出口）：{string.Join("、", exits.Select(e => $"{e.name} {Fmt(e.transform.position)}"))}");
            foreach (var other in layout.variants)
                if (other != v && other.only != null)
                    foreach (var go in other.only)
                        if (go && go.activeInHierarchy && !(v.only?.Contains(go) ?? false)) Fail($"{tag}：别的走法的 {go.name} 还在场");
            if (v.hide != null)
                foreach (var go in v.hide)
                    if (go && go.activeInHierarchy) Fail($"{tag}：该藏起来的 {go.name} 还在场");
            if (v.requires != null)
                foreach (var r in v.requires)
                    if (r?.site && !r.site.requires.SequenceEqual(r.requires.Where(x => x && x.gameObject.activeInHierarchy)))
                        Fail($"{tag}：{r.site.title} 的前置没有按变体改写");
            if (v.sites != null)
                foreach (var o in v.sites)
                {
                    if (o?.site == null) continue;
                    if (o.replaceReward && o.site.reward != o.reward) Fail($"{tag}：{o.site.title} 的奖励是 {o.site.reward}（应为 {o.reward}）");
                    if (o.replaceSpec && o.site.spec != o.spec) Fail($"{tag}：{o.site.title} 的编制没有换");
                }
            var objective = LevelObjective.For(scene);
            if (objective && objective.required.Any(s => !s || !s.gameObject.activeInHierarchy)) Fail($"{tag}：关卡目标里有停用的场地");
            var markers = MapMarkers.All.Count(m => m.kind == MapPoiKind.Exit);
            if (markers > 1) Fail($"{tag}：行旅图标了 {markers} 个出口");
            var order = objective
                ? string.Join("；", objective.required.Select(s => $"{s.title}{(s.requires.Length > 0 ? " ← " + string.Join("+", s.requires.Select(x => x.title)) : "")}"))
                : "（没有目标）";
            Line($"✓ {tag}「{v.title}」：出生 {Fmt(v.spawn ? v.spawn.transform.position : player)} → 出口 {Fmt(v.exit ? v.exit.transform.position : Vector3.zero)}；{order}");
            if (flow.Player?.cam) Shot(flow.Player.cam, $"layout_{slot.map.code}_{id}");
        }

        static List<T> Components<T>(Scene scene, bool includeInactive) where T : Component
        {
            var list = new List<T>();
            // 停用的根物体调 GetComponentsInChildren(false) 仍会返回它自己身上的组件：按 activeInHierarchy 再筛一遍
            foreach (var root in scene.GetRootGameObjects())
                foreach (var c in root.GetComponentsInChildren<T>(true))
                    if (includeInactive || c.gameObject.activeInHierarchy)
                        list.Add(c);
            return list;
        }

        static float Flat(Vector3 a, Vector3 b)
        {
            a.y = b.y = 0;
            return Vector3.Distance(a, b);
        }

        static string Fmt(Vector3 p) => $"({p.x:F0}, {p.z:F0})";

        IEnumerator WaitReady(string what)
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root) yield break;
                yield return null;
            }
            Fail($"{what}：{LoadTimeout} 秒内没有就绪");
        }

        IEnumerator WaitTransition(int before, string what)
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < LoadTimeout)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Transitions > before && f.Player != null && f.Player.root)
                {
                    // 行旅图按需重建：先刷一次再查
                    MapMarkers.Reset();
                    MapMarkers.Tick(f.Player.root.transform.position);
                    yield return new WaitForSeconds(0.5f);
                    yield break;
                }
                yield return null;
            }
            Fail($"{what}：{LoadTimeout} 秒内没有换完关");
        }
    }
}
