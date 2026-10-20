using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 场景流转（docs/unity-parity.md 4.6 / D17，L1）：常驻的 Core 场景（玩家、HUD、各系统、音频）+ 叠加加载的关卡场景（只有环境和标记）。
    /// 挂在 Core 的 Game Systems 上，和 <see cref="GameSession"/> 同一个物体。
    ///
    /// 换关（<see cref="Advance"/> / <see cref="GoTo"/> / <see cref="RestartStage"/> / <see cref="NewRun"/>）：
    ///   时间停住（TimeScaleArbiter 过渡优先级）→ 黑幕淡入 → 局状态：换关 = 各 <see cref="IRunPersistent"/> 把当前状态写进 RunState，
    ///   重来 = RunState 换回进关时的快照，新局 = 新的 RunState → 会话收尾、拆掉玩家、清投射物池 → 异步卸载旧关卡、回收资源
    ///   → 异步叠加加载新关卡，设为活动场景（光照、雾、天空、探针跟着关卡走；之后生成的物体都落在关卡场景里，卸载时一起清掉；
    ///   加载期间落进 Core 的散件也挪过去）→ 在 <see cref="PlayerSpawn"/> 由 <see cref="PlayerFactory"/> 按英雄重新组装玩家，接上 HUD，
    ///   补挂灵宠与 [GameSystem] → 各 IRunPersistent 读回 RunState（武器、秘卷、灵宠、生命护盾）→ 记下进关快照 → 会话开新关（换章时是章节卡）
    ///   → 黑幕下空跑几帧预热（着色器编译、贴图上传、第一帧的尖峰都藏在黑幕里）→ 放开时间、黑幕淡出。
    /// 下一关的场景还没生成（只有 1-1）时，<see cref="Advance"/> 带着本局进度再走一遍本关——整局流程现在就能跑通、能测。
    ///
    /// 直接在编辑器里打开关卡场景：关卡里的 <see cref="LevelBootstrap"/> 把 Core 叠加进来（<see cref="EnsureCore"/>），这里认领已经在场的关卡
    /// （调试局，同步组装玩家，不淡入淡出）。直接打开 Core（或打包后从 Core 启动）：开一局，从 RunPlan 第一关开始。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SceneFlow : MonoBehaviour
    {
        public const string CorePath = "Assets/Scenes/Core.unity", CoreName = "Core";

        public static SceneFlow Instance { get; private set; }

        [Tooltip("换关：黑幕淡入 / 淡出秒数（不受时间缩放影响）")]
        public float fadeOut = 0.35f, fadeIn = 0.5f;
        [Tooltip("新关卡组装好之后，黑幕下空跑几帧再放开")]
        public int warmupFrames = 3;
        [Tooltip("直接打开 Core / 关卡场景开调试局时的英雄 id")]
        public string heroId = HeroLibrary.DefaultHero;

        /// <summary>当前关（不在 RunPlan 里的关卡为 null）</summary>
        public StageSpec Current { get; private set; }
        /// <summary>当前关卡场景</summary>
        public Scene CurrentScene { get; private set; }
        /// <summary>当前玩家（换关途中为 null）</summary>
        public PlayerRig Player { get; private set; }
        /// <summary>正在换关（淡入淡出、加载、组装）</summary>
        public bool Busy { get; private set; }
        /// <summary>完成的换关次数（冒烟测试用）</summary>
        public int Transitions { get; private set; }
        /// <summary>进关时的局状态快照（重来本关时换回它）</summary>
        public RunState EntrySnapshot => entry;
        /// <summary>新的一关就绪（玩家已组装、状态已恢复，黑幕还没淡出）</summary>
        public event Action<StageSpec> Arrived;

        enum Kind
        {
            /// <summary>开局进第一关：RunState 已经有了（或新建），不带旧玩家</summary>
            Enter,
            /// <summary>换关：带着当前状态走</summary>
            Advance,
            /// <summary>重来本关：回到进关快照</summary>
            Restart,
            /// <summary>新开一局</summary>
            NewRun,
        }

        RunState entry;
        string currentPath, currentTitle;
        int shownChapter = -1;
        AudioListener fallbackListener;
        TimeScaleArbiter.Handle hold;
        string pendingPath;
        HashSet<GameObject> coreRootsBefore;
        static bool coreRequested;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Instance = null;
            coreRequested = false;
        }

        void Awake()
        {
            Instance = this;
            // 换关途中没有玩家相机：Core 自己留一个音频监听，玩家在的时候关掉（同时有两个会刷警告）
            fallbackListener = GetComponent<AudioListener>();
            if (!fallbackListener) fallbackListener = gameObject.AddComponent<AudioListener>();
            fallbackListener.enabled = true;
        }

        void OnEnable() => SceneManager.sceneLoaded += OnSceneLoaded;

        void OnDisable() => SceneManager.sceneLoaded -= OnSceneLoaded;

        void OnDestroy()
        {
            hold?.Dispose();
            hold = null;
            if (Instance == this) Instance = null;
        }

        void Start()
        {
            var level = FindLoadedLevel();
            if (level.IsValid()) Adopt(level);
            else
            {
                var run = RunState.Current;
                var first = run?.Stage ?? RunPlan.First;
                Go(first, first.scene, Kind.Enter);
            }
        }

        // ───────────── 对外 ─────────────

        /// <summary>
        /// 进下一关（结算面板上的「继续」、F8）：带着本局进度。下一关场景还没生成时再走一遍本关；不在 RunPlan 里的关卡也是再走一遍
        /// </summary>
        public void Advance()
        {
            if (Busy) return;
            var next = Current != null ? RunPlan.Next(Current) : null;
            if (next != null && CanLoad(next))
            {
                Go(next, next.scene, Kind.Advance);
                return;
            }
            if (next != null) Debug.Log($"[SceneFlow] 下一关 {next.Label} 的场景（{next.scene}）还没生成：带着本局进度再走一遍 {Current?.Label ?? currentPath}");
            Go(Current, currentPath, Kind.Advance);
        }

        /// <summary>带着本局进度去指定的一关（场景不存在时什么都不做，返回 false）</summary>
        public bool GoTo(StageSpec stage)
        {
            if (Busy || stage == null) return false;
            if (!CanLoad(stage))
            {
                Debug.LogWarning($"[SceneFlow] {stage.Label} 的场景 {stage.scene} 不在构建设置里，也不在磁盘上（先跑 bridge.sh levels）");
                return false;
            }
            Go(stage, stage.scene, Kind.Advance);
            return true;
        }

        /// <summary>重来本关（阵亡 / 结算面板上按 R、F5）：RunState 回到进关时的快照，重新加载关卡、重新组装玩家</summary>
        public void RestartStage()
        {
            if (Busy) return;
            Go(Current, currentPath, Kind.Restart);
        }

        /// <summary>新开一局（全部通关 / 阵亡后的 F）：旧局没结算过的按放弃结算（<see cref="MetaSave.BankRun"/>），新的 RunState 从 RunPlan 第一关开始</summary>
        public void NewRun()
        {
            if (Busy) return;
            Go(RunPlan.First, RunPlan.First.scene, Kind.NewRun);
        }

        /// <summary>这一关的场景能不能加载：在构建设置里，或者（编辑器里）磁盘上有这个场景文件</summary>
        public static bool CanLoad(StageSpec s) => s != null && CanLoad(s.scene);

        public static bool CanLoad(string scenePath)
        {
            if (string.IsNullOrEmpty(scenePath)) return false;
            if (SceneUtility.GetBuildIndexByScenePath(scenePath) >= 0) return true;
#if UNITY_EDITOR
            return System.IO.File.Exists(scenePath);
#else
            return false;
#endif
        }

        /// <summary>
        /// 保证 Core 场景在场（<see cref="LevelBootstrap"/> 在关卡场景被直接打开时调）：已有 SceneFlow / Core 正在加载 → 什么都不做；
        /// 构建设置里有 Core → 叠加加载；编辑器里有 Core.unity 但不在构建设置里 → 按路径加载；都没有 → 运行时临时搭一个（打警告）
        /// </summary>
        public static void EnsureCore()
        {
            if (Instance || coreRequested) return;
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                var s = SceneManager.GetSceneAt(i);
                if (s.path == CorePath || s.name == CoreName) return;
            }
            coreRequested = true;
            if (SceneUtility.GetBuildIndexByScenePath(CorePath) >= 0)
            {
                SceneManager.LoadScene(CorePath, LoadSceneMode.Additive);
                return;
            }
#if UNITY_EDITOR
            if (System.IO.File.Exists(CorePath))
            {
                UnityEditor.SceneManagement.EditorSceneManager.LoadSceneInPlayMode(CorePath, new LoadSceneParameters(LoadSceneMode.Additive));
                return;
            }
#endif
            Debug.LogWarning($"[SceneFlow] 没有 {CorePath}（先跑 bridge.sh core 生成）：运行时临时搭一个 Core 场景");
            CreateRuntimeCore();
        }

        /// <summary>运行时搭一个 Core 场景（和 CoreSceneBuilder 生成的 Core.unity 同一份内容：<see cref="PlayerFactory.CreateSystems"/>）</summary>
        public static Scene CreateRuntimeCore()
        {
            var scene = SceneManager.CreateScene(CoreName);
            var systems = PlayerFactory.CreateSystems(true, false);
            SceneManager.MoveGameObjectToScene(systems, scene);
            systems.SetActive(true);
            return scene;
        }

        // ───────────── 认领直接打开的关卡 ─────────────

        Scene FindLoadedLevel()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                var s = SceneManager.GetSceneAt(i);
                if (!s.isLoaded || s == gameObject.scene) continue;
                if (LevelBootstrap.In(s) || PlayerSpawn.In(s)) return s;
            }
            return default;
        }

        /// <summary>关卡场景是被直接打开的（编辑器 / 冒烟测试）：开调试局，同步组装玩家（不淡入淡出，第一帧之后就能操控）</summary>
        void Adopt(Scene level)
        {
            CurrentScene = level;
            currentPath = level.path;
            Current = RunPlan.ForScene(level.path);
            SceneManager.SetActiveScene(level);
            var boot = LevelBootstrap.In(level);
            currentTitle = boot ? boot.stageTitle : null;
            var run = RunState.Ensure(Current, boot && !string.IsNullOrEmpty(boot.heroId) ? boot.heroId : heroId);
            run.EnterStage(Current);
            WarnLegacy(level);
            if (Arrive(run)) Transitions++;
        }

        /// <summary>旧版关卡场景（玩家 / 会话烘在场景里）进了 Core 流程：会有两个玩家，提示重建</summary>
        static void WarnLegacy(Scene level)
        {
            foreach (var root in level.GetRootGameObjects())
                if (root.GetComponentInChildren<PlayerVitals>(true) || root.GetComponentInChildren<GameSession>(true))
                {
                    Debug.LogWarning($"[SceneFlow] {level.path} 是旧版关卡场景（玩家 / 会话烘在场景里），重建这一关（bridge.sh level …）后才只有 Core 的玩家");
                    return;
                }
        }

        // ───────────── 换关 ─────────────

        void Go(StageSpec stage, string path, Kind kind)
        {
            if (Busy) return;
            if (string.IsNullOrEmpty(path))
            {
                stage = RunPlan.First;
                path = stage.scene;
            }
            StartCoroutine(Transition(stage, path, kind));
        }

        IEnumerator Transition(StageSpec stage, string path, Kind kind)
        {
            Busy = true;
            hold = TimeScaleArbiter.Request(this, 0, TimeScaleArbiter.Priority.Transition);
            try
            {
                if (Player?.motor) Player.motor.inputEnabled = false;
                bool hadLevel = CurrentScene.IsValid() && CurrentScene.isLoaded;
                if (hadLevel)
                {
                    _ = GameUI.Fade(1, fadeOut);
                    yield return new WaitForSecondsRealtime(fadeOut);
                }
                else _ = GameUI.Fade(1, 0);

                // ── 局状态 ──
                var prev = RunState.Current;
                RunState run;
                switch (kind)
                {
                    case Kind.Restart:
                        run = CloneRun(entry) ?? prev ?? RunState.Ensure(stage, heroId);
                        // 阵亡时这一局已经结算过：重来本关只是练习，带上「已结算」标记，免得再死一次又结一遍（刷魂晶）
                        if (prev != null && prev.Flag(MetaSave.BankedFlag) != 0) run.SetFlag(MetaSave.BankedFlag, 1);
                        RunState.Current = run;
                        break;
                    case Kind.NewRun:
                        // 旧局没结算过（中途重新开局 = 放弃）：先按失败结算
                        if (prev != null)
                            try { MetaSave.BankRun(prev, false); }
                            catch (Exception e) { Debug.LogException(e); }
                        run = RunState.Begin(prev?.heroId ?? heroId, Environment.TickCount, stage, prev?.dev ?? Debug.isDebugBuild);
                        break;
                    case Kind.Enter:
                        run = prev ?? RunState.Begin(heroId, Environment.TickCount, stage, Debug.isDebugBuild);
                        run.EnterStage(stage);
                        break;
                    default:
                        run = RunState.Ensure(stage, heroId);
                        if (Player != null) RunPersistence.CaptureAll(run);
                        run.EnterStage(stage);
                        break;
                }

                // ── 拆旧 ──
                // 从这里起落进 Core 的新根物体（旧关卡卸载时 OnDestroy 里生成的、新关卡 Awake 里生成的）都算关卡的，加载完挪进新关卡
                coreRootsBefore = new HashSet<GameObject>(gameObject.scene.GetRootGameObjects());
                GameSession.Instance?.EndStage();
                GameStateMachine.SetBase(GameState.Transition);
                DestroyPlayer();
                ProjectilePools.Clear();
                if (hadLevel)
                {
                    SceneManager.SetActiveScene(gameObject.scene);
                    var unload = SceneManager.UnloadSceneAsync(CurrentScene);
                    while (unload != null && !unload.isDone) yield return null;
                }
                CurrentScene = default;
                ProjectilePools.Clear();
                var unused = Resources.UnloadUnusedAssets();
                while (!unused.isDone) yield return null;
                GC.Collect();

                // ── 装新 ──
                pendingPath = path;
                var load = LoadLevelAsync(path);
                if (load == null)
                {
                    pendingPath = null;
                    Debug.LogError($"[SceneFlow] 加载不了关卡场景 {path}（不在构建设置里；先跑 bridge.sh levels）");
                    GameUI.SetCenterText($"关卡场景 {path} 还没生成");
                    yield break;
                }
                while (!load.isDone) yield return null;
                var scene = SceneManager.GetSceneByPath(path);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    Debug.LogError($"[SceneFlow] 关卡场景 {path} 加载后找不到");
                    yield break;
                }
                // sceneLoaded 里已经设好活动场景、挪好散件；没收到回调（不该发生）时这里补上
                if (SceneManager.GetActiveScene() != scene) Activate(scene);
                pendingPath = null;
                LightProbes.TetrahedralizeAsync();
                CurrentScene = scene;
                currentPath = path;
                Current = stage;
                var boot = LevelBootstrap.In(scene);
                currentTitle = boot ? boot.stageTitle : null;
                WarnLegacy(scene);
                if (!Arrive(run)) yield break;

                // ── 预热：黑幕下空跑几帧 ──
                for (int i = 0; i < warmupFrames; i++) yield return null;
                hold?.Dispose();
                hold = null;
                Transitions++;
                _ = GameUI.Fade(0, fadeIn);
                yield return new WaitForSecondsRealtime(fadeIn);
            }
            finally
            {
                hold?.Dispose();
                hold = null;
                pendingPath = null;
                coreRootsBefore = null;
                Busy = false;
            }
        }

        /// <summary>
        /// 在当前关卡的出生点组装玩家、接上 HUD 与系统、读回局状态、记下进关快照、会话开新关。失败时打日志、黑幕上显示原因并返回 false
        /// </summary>
        bool Arrive(RunState run)
        {
            try
            {
                var (pos, rot) = PlayerSpawn.Resolve(CurrentScene);
                var hero = HeroLibrary.Get(run.heroId) ?? HeroLibrary.Get(HeroLibrary.DefaultHero);
                if (hero == null && HeroLibrary.All.Count > 0) hero = HeroLibrary.All[0];
                if (hero == null) throw new InvalidOperationException("英雄表是空的（Skills/Heroes/Hero_*.cs）");
                fallbackListener.enabled = false;
                Player = PlayerFactory.Create(hero, pos, rot);
                SceneManager.MoveGameObjectToScene(Player.root, gameObject.scene);
                PlayerFactory.Bind(gameObject, Player);
                SystemsBootstrap.Setup();
                PetBootstrap.Setup();

                RunPersistence.RestoreAll(run);
                // 读回的枪没有切枪事件：补发一次，着色（WeaponTintSystem）与持握词条（AffixRuntime）按手上那把重新挂
                if (Player.weapons.Active != null) GameEvents.RaiseWeaponSwitched(null, Player.weapons.Active);
                RunPersistence.CaptureAll(run);
                entry = CloneRun(run);

                bool chapterCard = Current != null && Current.chapter != shownChapter;
                if (Current != null) shownChapter = Current.chapter;
                GameSession.Instance?.BeginStage(Current, currentTitle, Player.vitals, Player.motor, chapterCard);
                Arrived?.Invoke(Current);
                return true;
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                GameUI.SetCenterText($"进关失败：{e.Message}");
                return false;
            }
        }

        void DestroyPlayer()
        {
            if (Player != null && Player.root)
            {
                // 先停用：OnDisable 立刻注销 IRunPersistent、各单例，不等帧末的 Destroy
                Player.root.SetActive(false);
                Destroy(Player.root);
            }
            Player = null;
            if (fallbackListener) fallbackListener.enabled = true;
        }

        static AsyncOperation LoadLevelAsync(string path)
        {
            if (SceneUtility.GetBuildIndexByScenePath(path) >= 0) return SceneManager.LoadSceneAsync(path, LoadSceneMode.Additive);
#if UNITY_EDITOR
            if (System.IO.File.Exists(path))
                return UnityEditor.SceneManagement.EditorSceneManager.LoadSceneAsyncInPlayMode(path, new LoadSceneParameters(LoadSceneMode.Additive));
#endif
            return null;
        }

        /// <summary>新关卡加载完（Awake / OnEnable 已跑，Start 还没跑）：马上设为活动场景，之后各物体 Start 里生成的东西都落在关卡里</summary>
        void OnSceneLoaded(Scene scene, LoadSceneMode mode)
        {
            if (pendingPath == null || !string.Equals(scene.path, pendingPath, StringComparison.OrdinalIgnoreCase)) return;
            Activate(scene);
        }

        /// <summary>设为活动场景，并把换关期间（旧关卡卸载、新关卡 Awake / OnEnable）落进 Core 的新根物体挪进关卡，卸载关卡时一起清掉</summary>
        void Activate(Scene level)
        {
            SceneManager.SetActiveScene(level);
            if (coreRootsBefore == null) return;
            foreach (var go in gameObject.scene.GetRootGameObjects())
                if (!coreRootsBefore.Contains(go)) SceneManager.MoveGameObjectToScene(go, level);
            coreRootsBefore = null;
        }

        // ───────────── 局状态快照 ─────────────

        /// <summary>
        /// RunState 的深拷贝（进关快照 / 重来本关）：按字段反射复制，集合新建一份、可序列化的类按 JSON 复制，[NonSerialized]（随机流缓存）不复制。
        /// 别的单元往 RunState 里加字段也不用改这里
        /// </summary>
        public static RunState CloneRun(RunState s)
        {
            if (s == null) return null;
            var c = new RunState();
            foreach (var f in typeof(RunState).GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            {
                if (f.IsNotSerialized || f.IsInitOnly) continue;
                f.SetValue(c, CopyValue(f.GetValue(s)));
            }
            return c;
        }

        static object CopyValue(object v)
        {
            if (v == null || v is string || v.GetType().IsValueType) return v;
            var t = v.GetType();
            if (v is IDictionary dict && t.GetConstructor(Type.EmptyTypes) != null)
            {
                var copy = (IDictionary)Activator.CreateInstance(t);
                foreach (DictionaryEntry e in dict) copy[e.Key] = CopyValue(e.Value);
                return copy;
            }
            if (v is IList list && !t.IsArray && t.GetConstructor(Type.EmptyTypes) != null)
            {
                var copy = (IList)Activator.CreateInstance(t);
                foreach (var e in list) copy.Add(CopyValue(e));
                return copy;
            }
            if (v is Array arr) return arr.Clone();
            if (t.IsSerializable) return JsonUtility.FromJson(JsonUtility.ToJson(v), t);
            return v;
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    /// <summary>F8 进下一关（带着本局进度；下一关场景还没生成时再走一遍本关）。旧式关卡（没有 Core）里用 F7 结算</summary>
    [Defs]
    public sealed class NextStageCommand : DevCommand
    {
        public override string Id => "next_stage";
        public override string Label => "下一关";
        public override Key Hotkey => Key.F8;

        public override void Execute()
        {
            var flow = SceneFlow.Instance;
            if (flow) flow.Advance();
            else DevCommands.Say("没有 Core 场景（旧式关卡），用 F7 结算");
        }
    }

    /// <summary>F5 重来本关（回到进关时的状态）</summary>
    [Defs]
    public sealed class RestartStageCommand : DevCommand
    {
        public override string Id => "restart_stage";
        public override string Label => "重来本关";
        public override Key Hotkey => Key.F5;
        public override bool PlayingOnly => false;

        public override void Execute()
        {
            var flow = SceneFlow.Instance;
            if (flow) flow.RestartStage();
            else GameSession.Instance?.Restart();
        }
    }
#endif
}
