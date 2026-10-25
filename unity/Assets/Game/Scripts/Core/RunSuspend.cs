using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// RunState 的 JSON 序列化（中途续玩 <see cref="RunSuspend"/> 与整局冒烟的接力档 RunRelay 共用）：
    /// 只写公有实例字段（属性不写、[NonSerialized] 不写——随机流缓存不进档），字典照常写；读的时候集合整个替换（不往默认值里追加）。
    /// 浮点数里的 NaN / 无穷写成 0（JSON 没有这几个值）。
    /// </summary>
    public static class RunStateJson
    {
        sealed class FieldsOnly : DefaultContractResolver
        {
            protected override List<MemberInfo> GetSerializableMembers(Type objectType) =>
                objectType.GetFields(BindingFlags.Instance | BindingFlags.Public).Where(f => !f.IsNotSerialized).Cast<MemberInfo>().ToList();

            protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization)
            {
                var p = base.CreateProperty(member, memberSerialization);
                p.Readable = p.Writable = true;
                return p;
            }
        }

        static readonly FieldsOnly resolver = new();

        /// <summary>序列化设置（缩进、只写字段、集合替换）</summary>
        public static JsonSerializerSettings Settings => new()
        {
            ContractResolver = resolver,
            Formatting = Formatting.Indented,
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            FloatFormatHandling = FloatFormatHandling.DefaultValue,
            ObjectCreationHandling = ObjectCreationHandling.Replace,
            DateParseHandling = DateParseHandling.None,
        };

        public static JsonSerializer Serializer => JsonSerializer.Create(Settings);

        public static string Serialize(RunState run) => JsonConvert.SerializeObject(run, Settings);

        public static RunState Deserialize(string json) => JsonConvert.DeserializeObject<RunState>(json, Settings);

        public static JObject ToJson(RunState run) => JObject.FromObject(run, Serializer);

        public static RunState FromJson(JToken token) => token?.ToObject<RunState>(Serializer);
    }

    /// <summary>读续玩档的结果</summary>
    public enum SuspendStatus
    {
        /// <summary>没有续玩档</summary>
        None,
        /// <summary>读到了，可以继续</summary>
        Ok,
        /// <summary>坏了（解析不了 / 字段不对 / 英雄或关卡不存在）：挪成 .corrupt，不再提供「继续征程」</summary>
        Corrupt,
        /// <summary>来自更新的版本：原样留着，这个版本不读也不删</summary>
        Newer,
    }

    /// <summary>一份续玩档（主菜单「继续征程」显示、读回）</summary>
    public sealed class SuspendedRun
    {
        public RunState run;
        /// <summary>写盘时间（UTC，ISO 8601）</summary>
        public string savedAt;
        /// <summary>属于调试档（run.dev.json）</summary>
        public bool dev;
        public StageSpec Stage => run != null ? RunPlan.Get(run.stageCode) : null;
    }

    /// <summary>
    /// 中途续玩（I5，比 Three.js 多做的部分；docs/unity-parity.md 3.1「中途续玩」）：每关开头把进关快照写进 run.json，主菜单「继续征程」从那一关开头接着打。
    ///
    /// 写：<see cref="GameEvents.StageLoaded"/>（SceneFlow 组装好玩家、读回局状态、记下进关快照之后发）时把 <see cref="SceneFlow.EntrySnapshot"/> 写盘——
    ///   和「重来本关」回到的是同一份快照：关卡序号、英雄、种子、武器（品质 / 强化 / 元素 / 弹药 / 词条与传说特性）、秘卷层数（按获得顺序）、
    ///   灵石、魂晶、灵宠（灵契等级 / 经验 / 灵技冷却）、生命护盾、用时 / 伤害 / 击杀 / 清关数、剧情标记。
    ///   随机流不用另存：<see cref="RunState.Stream"/> 只由「种子 + 关卡编号 + 流名」决定，进关时这一关的流都在起点，
    ///   读回来同样从起点开始（和重来本关一致）。秘卷的跨叠层计数（ScrollInventory 的 memory）跟重来本关一样回到零。
    ///   已经结算过的局（阵亡后按 R 练习）不写；调试局（直接打开关卡场景）只在调试档开着时（SaveService.ForceDev / -devprofile）写 run.dev.json。
    /// 删：一局结束（<see cref="GameEvents.RunEnded"/>：阵亡、放弃、胜利、开新局时放弃旧局）就删掉那个档的续玩档。
    /// 暂离（暂停菜单「返回主菜单」）不结算，续玩档留着。
    /// 防损坏：先写 .tmp 并刷盘，再原子替换（<see cref="SaveService.WriteAtomic"/>，不留 .bak——回滚到上一关不如直接说清楚）；
    ///   读的时候任何一步不对（空文件、不是 JSON、缺字段、英雄 / 关卡不存在、已经结算过）都当坏档：挪成 .corrupt 留作排查，
    ///   记下原因给主菜单提示一次（<see cref="TakeProblem"/>），不崩溃。版本比本程序新的档原样留着。
    /// <code>
    /// { "version": 1, "game": "spiritfire", "kind": "run", "build": "0.1", "savedAt": "2026-10-25T…Z",
    ///   "stage": "1-2", "label": "1-2 · …", "hero": "fox", "run": { RunState 的全部公有字段 } }
    /// </code>
    /// </summary>
    public static class RunSuspend
    {
        public const int Version = 1;
        public const string MainName = "run", DevName = "run.dev";

        static string problem;
        static (bool dev, int seed, string stage, string hero) last;
        static bool hasLast;

        /// <summary>写了一份续玩档（关卡编号；测试用）</summary>
        public static event Action<string> Written;

        /// <summary>写盘开关（测试关掉它模拟「旧版本没有续玩档」；缺省开）</summary>
        public static bool Enabled { get; set; } = true;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            problem = null;
            hasLast = false;
            Written = null;
            Enabled = true;
        }

        /// <summary>挂上关卡就绪 / 一局结束的钩子（加载第一个场景前自动调；幂等，EditMode 测试手动调）</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        public static void EnsureInstalled()
        {
            // GameEvents 在 SubsystemRegistration 时清空，这里在加载第一个场景前重新挂上
            GameEvents.StageLoaded -= OnStageLoaded;
            GameEvents.StageLoaded += OnStageLoaded;
            GameEvents.RunEnded -= OnRunEnded;
            GameEvents.RunEnded += OnRunEnded;
        }

        // ───────────── 文件 ─────────────

        /// <summary>续玩档路径（正式档 run.json / 调试档 run.dev.json，和 profile.json 同一个目录）</summary>
        public static string PathFor(bool dev) => Path.Combine(SaveService.Root, (dev ? DevName : MainName) + ".json");

        public static string CorruptPathFor(bool dev) => PathFor(dev) + ".corrupt";

        /// <summary>主菜单现在用的是调试档（ForceDev / -devprofile；主菜单里没有局）</summary>
        public static bool MenuDev => SaveService.ProfileFor(null) == SaveService.Dev;

        /// <summary>某一局的续玩档在哪个档里（同 <see cref="SaveService.ProfileFor"/>）</summary>
        public static bool DevFor(RunState run) => SaveService.ProfileFor(run) == SaveService.Dev;

        static bool DevFor(bool runDev) => runDev || MenuDev;

        /// <summary>有没有续玩档（不读内容）</summary>
        public static bool Exists(bool dev) => File.Exists(PathFor(dev));

        // ───────────── 写 ─────────────

        /// <summary>这一局要不要写续玩档：没结算过、在 RunPlan 里；调试局只在调试档开着时写</summary>
        public static bool ShouldWrite(RunState run) =>
            Enabled && run != null && run.Flag(MetaSave.BankedFlag) == 0 && RunPlan.Get(run.stageCode) != null && (!run.dev || MenuDev);

        static void OnStageLoaded(StageSpec stage)
        {
            var flow = SceneFlow.Instance;
            var run = RunState.Current;
            if (!flow || stage == null || run == null || !ShouldWrite(run)) return;
            var entry = flow.EntrySnapshot;
            if (entry == null || entry.stageCode != stage.code) return;
            Write(entry, DevFor(run));
        }

        static void OnRunEnded(RunSummary s)
        {
            if (s == null) return;
            Discard(DevFor(s.dev));
        }

        /// <summary>写一份续玩档（快照原样写，不改它）；失败打警告返回 false</summary>
        public static bool Write(RunState snapshot, bool dev)
        {
            if (snapshot == null) return false;
            string path = PathFor(dev);
            try
            {
                var stage = RunPlan.Get(snapshot.stageCode);
                var root = new JObject
                {
                    ["version"] = Version,
                    ["game"] = "spiritfire",
                    ["kind"] = "run",
                    ["build"] = Application.version,
                    ["savedAt"] = DateTime.UtcNow.ToString("o"),
                    ["stage"] = snapshot.stageCode,
                    ["label"] = stage?.Label ?? snapshot.stageCode,
                    ["hero"] = snapshot.heroId,
                    ["run"] = RunStateJson.ToJson(snapshot),
                };
                SaveService.WriteAtomic(path, path + ".bak", path + ".tmp", root.ToString(Formatting.Indented));
                TryDelete(path + ".bak");
                last = (dev, snapshot.seed, snapshot.stageCode, snapshot.heroId);
                hasLast = true;
                try { Written?.Invoke(snapshot.stageCode); }
                catch (Exception e) { Debug.LogException(e); }
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[RunSuspend] 写 {path} 失败：{e.Message}");
                return false;
            }
        }

        /// <summary>
        /// 这一局现在能不能「暂离」（回主菜单不结算、下次从本关开头继续）：盘上有它这一关的续玩档。
        /// 调试局（没写档）、已经结算过的局返回 false——那就只能按原来的「回主菜单 = 结算」走
        /// </summary>
        public static bool CanSuspend(RunState run)
        {
            if (run == null || !ShouldWrite(run)) return false;
            bool dev = DevFor(run);
            return hasLast && last.dev == dev && last.seed == run.seed && last.stage == run.stageCode && last.hero == run.heroId && File.Exists(PathFor(dev));
        }

        /// <summary>删掉续玩档（一局结束、开新局放弃旧局、测试）；顺带删掉写到一半的 .tmp / .bak</summary>
        public static void Discard(bool dev)
        {
            string path = PathFor(dev);
            TryDelete(path);
            TryDelete(path + ".tmp");
            TryDelete(path + ".bak");
            if (hasLast && last.dev == dev) hasLast = false;
        }

        // ───────────── 读 ─────────────

        /// <summary>
        /// 读续玩档（不改盘上的文件）：Ok 时 result 是读回来的局（每次都是新对象，可以直接设成当前局）；Corrupt / Newer 时 error 写原因
        /// </summary>
        public static SuspendStatus Read(bool dev, out SuspendedRun result, out string error)
        {
            result = null;
            error = null;
            string path = PathFor(dev);
            if (!File.Exists(path)) return SuspendStatus.None;
            try
            {
                var text = File.ReadAllText(path, Encoding.UTF8);
                if (string.IsNullOrWhiteSpace(text)) throw new InvalidDataException("空文件");
                if (SaveService.ParseToken(text) is not JObject o) throw new InvalidDataException("顶层不是对象");
                if (o["version"] is not JValue { Type: JTokenType.Integer } jv || (long)jv < 1) throw new InvalidDataException("缺少版本号");
                long version = (long)jv;
                if (version > Version)
                {
                    error = $"续玩档来自更新的版本（v{version} > v{Version}）";
                    return SuspendStatus.Newer;
                }
                if ((string)o["game"] != "spiritfire" || (string)o["kind"] != "run") throw new InvalidDataException("不是灵火破晓的续玩档");
                if (o["run"] is not JObject runJson) throw new InvalidDataException("缺少 run");
                var run = RunStateJson.FromJson(runJson) ?? throw new InvalidDataException("run 是空的");
                Validate(run);
                run.dev = run.dev || dev;
                result = new SuspendedRun { run = run, savedAt = (string)o["savedAt"], dev = dev };
                return SuspendStatus.Ok;
            }
            catch (Exception e)
            {
                error = e.Message;
                return SuspendStatus.Corrupt;
            }
        }

        /// <summary>
        /// 主菜单用：读续玩档；坏档挪成 .corrupt、记下原因（<see cref="TakeProblem"/> 提示一次）并返回 null；没有档 / 版本更新也返回 null
        /// </summary>
        public static SuspendedRun Peek(bool dev)
        {
            var status = Read(dev, out var result, out var error);
            switch (status)
            {
                case SuspendStatus.Ok:
                    return result;
                case SuspendStatus.Corrupt:
                    Debug.LogWarning($"[RunSuspend] {PathFor(dev)} 读不了（{error}），丢弃；坏文件留在 .corrupt");
                    MoveAside(dev);
                    problem = "上次的征程存档已损坏，无法继续，已丢弃";
                    return null;
                case SuspendStatus.Newer:
                    if (problem == null) problem = "上次的征程来自更新的版本，这个版本无法继续";
                    return null;
                default:
                    return null;
            }
        }

        /// <summary>上一次读档发现的问题（读一次就清掉；主菜单提示一次）</summary>
        public static string TakeProblem()
        {
            var p = problem;
            problem = null;
            return p;
        }

        /// <summary>读回来的局能不能用：英雄、关卡都还在；关卡在试玩路线里；还没结算过；数值不离谱。不对就抛异常（按坏档处理）</summary>
        static void Validate(RunState run)
        {
            if (string.IsNullOrEmpty(run.heroId) || HeroLibrary.Get(run.heroId) == null) throw new InvalidDataException($"英雄 {run.heroId ?? "（空）"} 不存在");
            var stage = RunPlan.Get(run.stageCode) ?? throw new InvalidDataException($"关卡 {run.stageCode ?? "（空）"} 不在 RunPlan 里");
            bool playable = false;
            foreach (var s in RunPlan.Playable)
                if (s == stage)
                {
                    playable = true;
                    break;
                }
            if (!playable) throw new InvalidDataException($"关卡 {stage.code} 不在这个版本的路线里");
            run.flags ??= new Dictionary<string, int>();
            run.scrolls ??= new Dictionary<string, int>();
            run.weapons ??= new List<WeaponSave>();
            if (run.Flag(MetaSave.BankedFlag) != 0) throw new InvalidDataException("这一局已经结算过");
            if (run.coins < 0 || run.essence < 0 || run.kills < 0 || run.stagesCleared < 0) throw new InvalidDataException("数值是负的");
            if (!float.IsFinite(run.time) || run.time < 0 || !float.IsFinite(run.damageDealt) || !float.IsFinite(run.hp) || !float.IsFinite(run.shield))
                throw new InvalidDataException("数值不合法");
            foreach (var w in run.weapons)
            {
                if (string.IsNullOrEmpty(w.id)) throw new InvalidDataException("有一把枪没有 id");
                if (w.rarity < 0 || w.rarity >= Rarity.Names.Length) throw new InvalidDataException($"{w.id} 的品质 {w.rarity} 不合法");
                if (w.level < 0 || w.level > WeaponLibrary.MaxUpgrade) throw new InvalidDataException($"{w.id} 的强化 +{w.level} 不合法");
                if (!Enum.IsDefined(typeof(Element), w.element)) throw new InvalidDataException($"{w.id} 的元素 {(int)w.element} 不合法");
                if (w.mag < 0 || w.reserve < 0) throw new InvalidDataException($"{w.id} 的弹药是负的");
            }
            if (run.pet != null && (run.pet.level < 0 || !float.IsFinite(run.pet.xp) || !float.IsFinite(run.pet.cooldownLeft)))
                throw new InvalidDataException("灵宠数值不合法");
            // 章 / 关序 / 难度以 RunPlan 为准（档里的只是冗余）
            run.EnterStage(stage);
        }

        static void MoveAside(bool dev)
        {
            string path = PathFor(dev), corrupt = CorruptPathFor(dev);
            try
            {
                if (File.Exists(corrupt)) File.Delete(corrupt);
                File.Move(path, corrupt);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[RunSuspend] 挪开坏档 {path} 失败（{e.Message}），直接删掉");
                TryDelete(path);
            }
            if (hasLast && last.dev == dev) hasLast = false;
        }

        static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[RunSuspend] 删不掉 {path}：{e.Message}");
            }
        }

        // ───────────── 放弃 ─────────────

        /// <summary>
        /// 放弃续玩档里的那一局（开新局前确认过）：按失败结算（魂晶照常入账、记一局败北）再删档。没有档 / 坏档只删档。返回结算（没有为 null）
        /// </summary>
        public static RunSummary Forfeit(bool dev)
        {
            var s = Peek(dev);
            RunSummary summary = null;
            if (s != null)
                try { summary = MetaSave.BankRun(s.run, false); }
                catch (Exception e) { Debug.LogException(e); }
            Discard(dev);
            return summary;
        }
    }
}
