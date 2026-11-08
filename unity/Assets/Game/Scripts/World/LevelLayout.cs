using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 图内布局变体（docs/level-design/run-variety.md §2）：同一张开放大图在不同的局里从不同的地方进、从不同的地方出、按不同的先后打据点。
    /// 地形 / 套件 / 光照烘在场景里不变；变的是「这一局怎么走这张图」——
    ///   · 出生点（<see cref="Variant.spawn"/>）和出口（<see cref="Variant.exit"/>）：场景里每个变体的出生标记 / 出口祭坛都摆好，只留这一局抽中的那套；
    ///   · 据点先后（<see cref="Variant.requires"/>）：反着走时把「② ③ 要求 ①」反过来；
    ///   · 只在某个变体里有的物体（<see cref="Variant.only"/>：出口祭坛、藏宝点、可选场地、装饰）和要藏起来的物体（<see cref="Variant.hide"/>）；
    ///   · 场地的编制 / 奖励（<see cref="Variant.sites"/>）：难度曲线跟着走法走——先打的场地用开场编制、给第二把枪，最后打的用终局编制。
    /// 关卡构建器（Level_x_y）摆好每个变体的物体、填好这张表；第一个变体 = 设计稿的走法（主变体）。
    ///
    /// 抽哪个：这一局有路线（<see cref="RunState.Route"/>，正式开局）时按随机流 <see cref="StreamName"/> 掷（只由种子 + 关卡编号决定 → 同一局里重来本关 / 续玩还是同一个变体）；
    /// 没有路线的局（调试局、直接打开场景、生涯第一局）用主变体，冒烟测试照旧走设计稿路线。<see cref="Force"/> 可以指定（测试 / 调试命令）。
    /// 在所有关卡物体的 Awake 之前生效（<see cref="DefaultExecutionOrder"/>）：被停用的出生点 / 出口 / 场地从一开始就不在场，
    /// <see cref="PlayerSpawn.In"/> 只认在场的出生标记，<see cref="LevelObjective"/> 只收在场的场地，行旅图不标停用的地点。
    /// </summary>
    [DefaultExecutionOrder(-10000)]
    [DisallowMultipleComponent]
    public sealed class LevelLayout : MonoBehaviour
    {
        /// <summary>抽变体用的随机流名（<see cref="RunState.Stream"/>）</summary>
        public const string StreamName = "layout";

        /// <summary>某个场地在这个变体里的前置场地（替换构建时写的 <see cref="EncounterSite.requires"/>）</summary>
        [Serializable]
        public sealed class SiteRequires
        {
            public EncounterSite site;
            public EncounterSite[] requires = Array.Empty<EncounterSite>();
        }

        /// <summary>
        /// 某个场地在这个变体里换编制 / 奖励：反着走时第一个打的场地要换成开场的强度、拿开场的奖励（第二把枪），原来的开场场地换成终局编制
        /// </summary>
        [Serializable]
        public sealed class SiteOverride
        {
            public EncounterSite site;
            [Tooltip("换编制（关 = 用构建时写的）")]
            public bool replaceSpec;
            public EncounterSpec spec = new();
            [Tooltip("换肃清奖励（关 = 用构建时写的）")]
            public bool replaceReward;
            public string reward = "";
        }

        /// <summary>一种走法</summary>
        [Serializable]
        public sealed class Variant
        {
            [Tooltip("变体 id（测试 / 调试命令 / 日志用，如 main、reverse）")]
            public string id = "main";
            [Tooltip("变体名（进关提示 / 日志用，如「自驼队营地入」）")]
            public string title = "";
            [Tooltip("抽中的权重（≤ 0 = 不参与随机，只能 Force）")]
            public float weight = 1f;
            [Tooltip("这一走法的出生点")]
            public PlayerSpawn spawn;
            [Tooltip("这一走法的出口")]
            public ExitPortal exit;
            [Tooltip("只在这个走法里出现的物体（别的走法里停用）")]
            public GameObject[] only = Array.Empty<GameObject>();
            [Tooltip("这个走法里停用的物体")]
            public GameObject[] hide = Array.Empty<GameObject>();
            [Tooltip("这个走法里改写的场地先后")]
            public SiteRequires[] requires = Array.Empty<SiteRequires>();
            [Tooltip("这个走法里换编制 / 奖励的场地")]
            public SiteOverride[] sites = Array.Empty<SiteOverride>();

            public override string ToString() => string.IsNullOrEmpty(title) ? id : $"{id}（{title}）";
        }

        public Variant[] variants = Array.Empty<Variant>();

        /// <summary>指定变体 id（null = 正常抽）：冒烟测试 / 调试命令在加载关卡之前设，用完设回 null</summary>
        public static string Force;

        /// <summary>这一局抽中的变体（<see cref="Awake"/> 之后才有）</summary>
        public Variant Chosen { get; private set; }
        public int ChosenIndex { get; private set; } = -1;

        /// <summary>任一关卡布局生效（关卡场景、抽中的变体）</summary>
        public static event Action<LevelLayout> Applied;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Force = null;
            Applied = null;
        }

        /// <summary>这个场景的布局（没有返回 null，包括停用的）</summary>
        public static LevelLayout In(Scene scene)
        {
            if (!scene.IsValid() || !scene.isLoaded) return null;
            foreach (var root in scene.GetRootGameObjects())
            {
                var l = root.GetComponentInChildren<LevelLayout>(true);
                if (l) return l;
            }
            return null;
        }

        void Awake()
        {
            if (variants == null || variants.Length == 0) return;
            int i = Pick(variants, Force, RunState.Current);
            Apply(i);
        }

        /// <summary>
        /// 抽变体（纯函数，EditMode 可测）：<paramref name="force"/> 命中某个 id → 它；这一局有路线 → 按 <see cref="StreamName"/> 流按权重掷；否则 0（主变体）
        /// </summary>
        public static int Pick(IReadOnlyList<Variant> list, string force, RunState run)
        {
            if (list == null || list.Count == 0) return -1;
            if (!string.IsNullOrEmpty(force))
            {
                for (int i = 0; i < list.Count; i++)
                    if (list[i] != null && string.Equals(list[i].id, force, StringComparison.OrdinalIgnoreCase))
                        return i;
                Debug.LogWarning($"[LevelLayout] 没有变体 {force}，按正常规则抽");
            }
            if (run?.Route == null) return 0;
            // 每次现算一条新流（不用 RunState.Stream 的缓存）：同一局第几次进这一关、之前掷过几次都不影响，只看种子 + 槽位编号
            var rng = RunRng.Stream(run.seed, run.stageCode + "/" + StreamName);
            double total = 0;
            foreach (var v in list)
                if (v != null && v.weight > 0)
                    total += v.weight;
            if (total <= 0) return 0;
            double r = rng.NextDouble() * total;
            for (int i = 0; i < list.Count; i++)
            {
                var v = list[i];
                if (v == null || v.weight <= 0) continue;
                r -= v.weight;
                if (r <= 0) return i;
            }
            for (int i = list.Count - 1; i >= 0; i--)
                if (list[i] != null && list[i].weight > 0)
                    return i;
            return 0;
        }

        /// <summary>按变体 <paramref name="index"/> 摆场景：停用别的变体的出生点 / 出口 / 专属物体，藏起本变体要藏的，改写场地先后，从关卡目标里去掉停用的场地 / 灵火坛</summary>
        public void Apply(int index)
        {
            if (variants == null || index < 0 || index >= variants.Length || variants[index] == null) return;
            var v = variants[index];
            Chosen = v;
            ChosenIndex = index;

            var keep = new HashSet<GameObject>();
            void Keep(GameObject go)
            {
                if (go) keep.Add(go);
            }
            Keep(v.spawn ? v.spawn.gameObject : null);
            Keep(v.exit ? v.exit.gameObject : null);
            if (v.only != null)
                foreach (var go in v.only)
                    Keep(go);

            // 别的变体专属的物体：不在本变体里就停用
            foreach (var other in variants)
            {
                if (other == null || other == v) continue;
                Off(other.spawn ? other.spawn.gameObject : null, keep);
                Off(other.exit ? other.exit.gameObject : null, keep);
                if (other.only != null)
                    foreach (var go in other.only)
                        Off(go, keep);
            }
            foreach (var go in keep) go.SetActive(true);
            if (v.hide != null)
                foreach (var go in v.hide)
                    if (go && !keep.Contains(go))
                        go.SetActive(false);

            if (v.requires != null)
                foreach (var r in v.requires)
                    if (r != null && r.site)
                        r.site.requires = Live(r.requires);
            if (v.sites != null)
                foreach (var o in v.sites)
                {
                    if (o == null || !o.site) continue;
                    if (o.replaceSpec && o.spec != null) o.site.spec = o.spec;
                    if (o.replaceReward) o.site.reward = o.reward ?? "";
                }
            // 前置场地被停用了：从各场地的 requires 里去掉（不然那个场地永远等不到前置）
            foreach (var site in SceneComponents<EncounterSite>())
                if (site.requires != null && site.requires.Length > 0)
                    site.requires = Live(site.requires);

            var objective = SceneObjective();
            if (objective)
            {
                objective.required = Live(objective.required);
                objective.optional = Live(objective.optional);
                objective.altars = Live(objective.altars);
            }
            Debug.Log($"[LevelLayout] {gameObject.scene.name}：变体 {v}（共 {variants.Length} 种）");
            Applied?.Invoke(this);
        }

        static void Off(GameObject go, HashSet<GameObject> keep)
        {
            if (go && !keep.Contains(go)) go.SetActive(false);
        }

        /// <summary>去掉空的和停用的</summary>
        static T[] Live<T>(T[] list) where T : Component
        {
            if (list == null || list.Length == 0) return Array.Empty<T>();
            var keep = new List<T>(list.Length);
            foreach (var c in list)
                if (c && c.gameObject.activeInHierarchy)
                    keep.Add(c);
            return keep.Count == list.Length ? list : keep.ToArray();
        }

        IEnumerable<T> SceneComponents<T>() where T : Component
        {
            var scene = gameObject.scene;
            if (!scene.IsValid()) yield break;
            // 停用的根物体调 GetComponentsInChildren(false) 仍会返回它自己身上的组件：按 activeInHierarchy 筛
            foreach (var root in scene.GetRootGameObjects())
                foreach (var c in root.GetComponentsInChildren<T>(true))
                    if (c.gameObject.activeInHierarchy)
                        yield return c;
        }

        LevelObjective SceneObjective()
        {
            foreach (var o in SceneComponents<LevelObjective>())
                return o;
            return null;
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>调试：换这张图的下一种走法（布局变体）并重来本关；路线和种子不变</summary>
    [Defs]
    public sealed class NextLayoutCommand : DevCommand
    {
        public override string Id => "next_layout";
        public override string Label => "换一种走法（布局变体）";

        public override void Execute()
        {
            var flow = SceneFlow.Instance;
            var layout = flow ? LevelLayout.In(flow.CurrentScene) : null;
            if (!layout || layout.variants == null || layout.variants.Length < 2)
            {
                DevCommands.Say("这张图只有一种走法");
                return;
            }
            int next = (Mathf.Max(0, layout.ChosenIndex) + 1) % layout.variants.Length;
            LevelLayout.Force = layout.variants[next].id;
            // 只管下一次进关：生效后清掉，之后的关照常按随机流抽
            void Once(LevelLayout _)
            {
                LevelLayout.Force = null;
                LevelLayout.Applied -= Once;
            }
            LevelLayout.Applied += Once;
            DevCommands.Say($"下一种走法：{layout.variants[next]}");
            flow.RestartStage();
        }
    }
#endif
}
