using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 存档的一段（docs/unity-parity.md D22 / R2）：各系统自己出一段，SaveService 只管信封、落盘、备份和迁移。
    /// 现有的段：meta（魂晶 / 天赋 / 英雄）、career（生涯统计）、settings（玩家设置，共享文件）；以后 run（I5 中途续玩）、keybinds…
    /// 段的数据是任意 JSON（对象 / 数组 / 值都行）；接口里不出现 Newtonsoft 类型，测试程序集不引用它也能实现。
    /// </summary>
    public interface ISaveSection
    {
        /// <summary>段名（同一个文件里唯一，写进 JSON 当键）</summary>
        string Key { get; }

        /// <summary>这一段现在的结构版本：写盘时记下，读回来时原样交给 <see cref="Restore"/>，段自己按版本升级（段级迁移钩子）</summary>
        int Version { get; }

        /// <summary>当前数据 → JSON 文本（返回 null = 这次不写这一段，保留盘上原来的）</summary>
        string Capture();

        /// <summary>
        /// 从盘上的数据恢复。json 为 null：文件里没有这一段（新档、或这一段是后加的），恢复成默认值（可以在这里做旧存储的一次性导入）。
        /// version 是写盘时的 <see cref="Version"/>，比现在小就在这里升级。
        /// </summary>
        void Restore(string json, int version);
    }

    /// <summary>想知道自己属于哪个文件的段（自己调 Save、区分正式档 / 调试档）：登记时、Restore 之前收到所属文件</summary>
    public interface ISaveFileBound
    {
        void Bind(SaveFile file);
    }

    /// <summary>一个存档文件读盘的结果</summary>
    public enum SaveLoadStatus
    {
        /// <summary>还没读</summary>
        NotLoaded,
        /// <summary>没有存档（新玩家）：全部默认值</summary>
        Fresh,
        /// <summary>正常读到主文件</summary>
        Loaded,
        /// <summary>主文件坏了（或丢了），从 .bak 恢复；坏文件挪成 .corrupt 留作排查</summary>
        RecoveredFromBackup,
        /// <summary>主文件和 .bak 都读不了：回到默认值，坏文件挪成 .corrupt，不会被下一次保存覆盖</summary>
        Corrupt,
    }

    /// <summary>
    /// 一个存档文件：版本化 JSON 信封 + 若干段（<see cref="ISaveSection"/>）。
    /// <code>
    /// { "version": 2, "game": "spiritfire", "build": "0.1", "savedAt": "2026-10-20T…Z",
    ///   "sections": { "meta": { "v": 1, "data": {…} }, "career": { "v": 1, "data": {…} } } }
    /// </code>
    /// 读：主文件 → 解析 / 迁移失败就读 .bak → 再不行回到默认值；坏的主文件挪成 .corrupt。
    /// 写：先写 .tmp 并刷到磁盘，再用 File.Replace 原子替换主文件，旧主文件同时变成 .bak（断电只会坏掉 .tmp）。
    /// 盘上有、这次没人认领的段原样写回（老版本读新段、某个系统这次没加载，都不丢数据）。
    /// 文件版本比本程序新（玩家装回了旧版本）时只读不写，免得把新档写坏。
    /// </summary>
    public sealed class SaveFile
    {
        public readonly string name;

        /// <summary>读盘结果（第一次用到时读）</summary>
        public SaveLoadStatus Status
        {
            get
            {
                EnsureLoaded();
                return status;
            }
        }

        /// <summary>盘上文件的信封版本（迁移之前；新档为 0）</summary>
        public int FileVersion
        {
            get
            {
                EnsureLoaded();
                return fileVersion;
            }
        }

        /// <summary>读盘时做过文件级迁移</summary>
        public bool Migrated
        {
            get
            {
                EnsureLoaded();
                return migrated;
            }
        }

        /// <summary>文件来自更新的版本：只读，<see cref="Save"/> 不写</summary>
        public bool ReadOnly
        {
            get
            {
                EnsureLoaded();
                return readOnly;
            }
        }

        /// <summary>有改动还没写盘（<see cref="SaveSoon"/> 之后、刷盘之前）</summary>
        public bool Dirty { get; private set; }

        public string FilePath => Path.Combine(SaveService.Root, name + ".json");
        public string BackupPath => FilePath + ".bak";
        public string CorruptPath => FilePath + ".corrupt";
        string TempPath => FilePath + ".tmp";

        /// <summary>盘上的段（含已认领的：保存时用认领者的最新数据覆盖）：段名 → (版本, 数据)</summary>
        readonly Dictionary<string, (int v, JToken data)> raw = new();
        readonly Dictionary<string, ISaveSection> attached = new();
        readonly Dictionary<Type, ISaveSection> byType = new();
        SaveLoadStatus status;
        int fileVersion;
        bool loaded, migrated, readOnly, warnedReadOnly;

        internal SaveFile(string name) => this.name = name;

        public override string ToString() => name;

        // ───────────── 段 ─────────────

        /// <summary>
        /// 取这个文件里的某一段（没有就 new 一个、用盘上的数据 Restore 后登记）。同一类型每个文件只有一个实例。
        /// 例：SaveService.Profile.Section&lt;MetaSave&gt;()
        /// </summary>
        public T Section<T>() where T : class, ISaveSection, new()
        {
            EnsureLoaded();
            if (byType.TryGetValue(typeof(T), out var s)) return (T)s;
            var made = new T();
            Attach(made);
            return made;
        }

        /// <summary>登记一个现成的段实例（静态系统的适配对象等），立即用盘上的数据 Restore。段名重复抛异常</summary>
        public void Attach(ISaveSection section)
        {
            if (section == null) throw new ArgumentNullException(nameof(section));
            EnsureLoaded();
            var key = section.Key;
            if (string.IsNullOrEmpty(key)) throw new ArgumentException($"[Save] {section.GetType().Name} 没有段名");
            if (attached.TryGetValue(key, out var other))
            {
                if (ReferenceEquals(other, section)) return;
                throw new InvalidOperationException($"[Save] {name} 的段「{key}」重复：{other.GetType().Name} 与 {section.GetType().Name}");
            }
            attached[key] = section;
            byType[section.GetType()] = section;
            if (section is ISaveFileBound bound) bound.Bind(this);
            RestoreSection(section);
        }

        /// <summary>这个文件里有没有某一段（盘上的或已登记的）</summary>
        public bool Has(string key)
        {
            EnsureLoaded();
            return attached.ContainsKey(key) || raw.ContainsKey(key);
        }

        void RestoreSection(ISaveSection section)
        {
            if (!raw.TryGetValue(section.Key, out var r))
            {
                section.Restore(null, 0);
                return;
            }
            try
            {
                section.Restore(r.data.ToString(Formatting.None), r.v);
            }
            catch (Exception e)
            {
                // 段坏了：留一份整文件给排查，这一段回到默认值（其他段不受影响）
                Debug.LogWarning($"[Save] {name} 的段「{section.Key}」读不了，回到默认值：{e.Message}");
                SaveService.TryCopy(FilePath, CorruptPath);
                raw.Remove(section.Key);
                section.Restore(null, 0);
            }
        }

        // ───────────── 写 ─────────────

        /// <summary>马上写盘（各段 Capture → 信封 → 原子替换）；只读或失败返回 false</summary>
        public bool Save()
        {
            EnsureLoaded();
            if (readOnly)
            {
                if (!warnedReadOnly) Debug.LogWarning($"[Save] {name} 来自更新的版本（v{fileVersion} > v{SaveService.CurrentVersion}），不写盘");
                warnedReadOnly = true;
                return false;
            }
            foreach (var (key, s) in attached)
            {
                try
                {
                    var json = s.Capture();
                    if (json != null) raw[key] = (s.Version, SaveService.ParseToken(json));
                }
                catch (Exception e)
                {
                    // 这一段这次写不出来：沿用盘上上一次的数据
                    Debug.LogException(e);
                }
            }
            var sections = new JObject();
            foreach (var (key, r) in raw) sections[key] = new JObject { ["v"] = r.v, ["data"] = r.data };
            var root = new JObject
            {
                ["version"] = SaveService.CurrentVersion,
                ["game"] = "spiritfire",
                ["build"] = Application.version,
                ["savedAt"] = DateTime.UtcNow.ToString("o"),
                ["sections"] = sections,
            };
            try
            {
                SaveService.WriteAtomic(FilePath, BackupPath, TempPath, root.ToString(Formatting.Indented));
                Dirty = false;
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Save] 写 {FilePath} 失败：{e.Message}");
                return false;
            }
        }

        /// <summary>
        /// 稍后写盘（设置面板拖滑条时一秒内会改很多次）：Play 模式里合并到约 0.75 秒后、失焦 / 退出时一起写；编辑模式里立即写
        /// </summary>
        public void SaveSoon()
        {
            Dirty = true;
            if (!Application.isPlaying)
            {
                Save();
                return;
            }
            SaveFlusher.Schedule();
        }

        // ───────────── 读 ─────────────

        void EnsureLoaded()
        {
            if (loaded) return;
            loaded = true;
            raw.Clear();
            migrated = readOnly = false;
            fileVersion = 0;

            bool mainExists = File.Exists(FilePath);
            JObject root = null;
            int version = 0;
            bool mig = false;
            string error = null;
            if (mainExists && TryRead(FilePath, out root, out version, out mig, out error))
            {
                Accept(root, version, mig);
                status = SaveLoadStatus.Loaded;
                return;
            }
            string mainError = error;
            if (File.Exists(BackupPath) && TryRead(BackupPath, out root, out version, out mig, out error))
            {
                Accept(root, version, mig);
                status = SaveLoadStatus.RecoveredFromBackup;
                Debug.LogWarning(mainExists
                    ? $"[Save] {FilePath} 损坏（{mainError}），已从 .bak 恢复"
                    : $"[Save] {FilePath} 不见了，已从 .bak 恢复");
                if (mainExists) MoveAside();
                return;
            }
            if (!mainExists && !File.Exists(BackupPath))
            {
                status = SaveLoadStatus.Fresh;
                return;
            }
            status = SaveLoadStatus.Corrupt;
            Debug.LogWarning($"[Save] {FilePath} 和 .bak 都读不了（{mainError ?? error}），回到默认值；坏文件留在 .corrupt");
            if (mainExists) MoveAside();
        }

        void Accept(JObject root, int version, bool mig)
        {
            fileVersion = version;
            migrated = mig;
            readOnly = version > SaveService.CurrentVersion;
            if (root["sections"] is not JObject sections) return;
            foreach (var p in sections.Properties())
            {
                // 每段是 { "v": 版本, "data": 数据 }；不认识的形状整段跳过（不让一段的问题拖垮整个文件）
                if (p.Value is not JObject s || s["data"] is not { } data) continue;
                int v = 0;
                try { v = s["v"] is JValue { Type: JTokenType.Integer } jv ? (int)jv : 0; }
                catch (OverflowException) { /* 版本号离谱：按 0 交给段自己处理 */ }
                raw[p.Name] = (v, data);
            }
        }

        /// <summary>坏的主文件挪成 .corrupt（覆盖上一次的），之后的保存写新主文件、不会把它轮换进 .bak</summary>
        void MoveAside()
        {
            try
            {
                if (File.Exists(CorruptPath)) File.Delete(CorruptPath);
                File.Move(FilePath, CorruptPath);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Save] 挪开坏档 {FilePath} 失败：{e.Message}");
            }
        }

        static bool TryRead(string path, out JObject root, out int version, out bool migrated, out string error)
        {
            root = null;
            version = 0;
            migrated = false;
            error = null;
            try
            {
                var text = File.ReadAllText(path, Encoding.UTF8);
                if (string.IsNullOrWhiteSpace(text)) throw new InvalidDataException("空文件");
                if (SaveService.ParseToken(text) is not JObject o) throw new InvalidDataException("顶层不是对象");
                if (o["version"] is not JValue { Type: JTokenType.Integer } jv || (int)jv < 1) throw new InvalidDataException("缺少版本号");
                version = (int)jv;
                root = SaveService.Migrate(o, version, out migrated);
                return true;
            }
            catch (Exception e)
            {
                error = e.Message;
                return false;
            }
        }
    }

    /// <summary>
    /// 存档服务（docs/unity-parity.md D22 / R2）：<c>Application.persistentDataPath/save/</c> 下的几个版本化 JSON 文件。
    ///   <see cref="Main"/>（profile.json）：正式档——魂晶、天赋、英雄、生涯…（按档区分的段）；
    ///   <see cref="Dev"/>（profile.dev.json）：调试档——调试局（<see cref="RunState.dev"/>，直接打开关卡场景时自动建的）、冒烟测试、作弊都只碰它，
    ///     永远不碰正式档（同 Three.js 白盒模式的 gunflame.whitebox.meta.v1）；
    ///   <see cref="Shared"/>（settings.json）：两个档共用的玩家偏好——设置、以后的改键。
    /// <see cref="Profile"/> 是当前该用的档：<see cref="ForceDev"/>（测试 / 命令行 -devprofile）或当前局是调试局时为 Dev，否则 Main。
    /// 测试用 <see cref="UseRoot"/> 把根目录指到临时目录。
    /// 文件级迁移在 <see cref="Migrate"/> 的表里（改信封结构时加一步、把 <see cref="CurrentVersion"/> 加一）；段级迁移由各段在 Restore 里按版本处理。
    /// </summary>
    public static class SaveService
    {
        /// <summary>
        /// 信封版本。v1 = Three.js 网页版 localStorage「gunflame.meta.v1」的原样（{version:1, essence, talents, unlockedHeroes, stats}），
        /// 读到时迁成 v2 的 meta / career 两段（也就是说网页版的存档 JSON 直接放进来就能导入）。
        /// </summary>
        public const int CurrentVersion = 2;

        public const string MainName = "profile", DevName = "profile.dev", SharedName = "settings";

        static string rootOverride;
        static SaveFile main, dev, shared;
        static bool? commandLineDev;

        /// <summary>存档目录（测试里是 <see cref="UseRoot"/> 指定的临时目录）</summary>
        public static string Root => rootOverride ?? Path.Combine(Application.persistentDataPath, "save");

        /// <summary>正式档</summary>
        public static SaveFile Main => main ??= new SaveFile(MainName);
        /// <summary>调试档（调试局、测试、作弊）</summary>
        public static SaveFile Dev => dev ??= new SaveFile(DevName);
        /// <summary>两个档共用的文件（设置）</summary>
        public static SaveFile Shared => shared ??= new SaveFile(SharedName);

        /// <summary>强制用调试档（EditMode 测试、调试工具；命令行带 -devprofile 的包体不看这个开关，始终用调试档）</summary>
        public static bool ForceDev { get; set; }

        /// <summary>现在用的是调试档：<see cref="ForceDev"/>、命令行 -devprofile，或当前局是调试局</summary>
        public static bool DevActive => UsesDev(RunState.Current);

        /// <summary>当前该用的档（主菜单 / 天赋面板 / 开局读天赋都用它）</summary>
        public static SaveFile Profile => ProfileFor(RunState.Current);

        /// <summary>某一局该用的档：调试局 → <see cref="Dev"/>；其余看 <see cref="ForceDev"/></summary>
        public static SaveFile ProfileFor(RunState run) => UsesDev(run) ? Dev : Main;

        static bool UsesDev(RunState run) => ForceDev || CommandLineDev || (run != null && run.dev);

        static bool CommandLineDev
        {
            get
            {
                if (commandLineDev.HasValue) return commandLineDev.Value;
                bool on = false;
                try { on = Array.IndexOf(Environment.GetCommandLineArgs(), "-devprofile") >= 0; }
                catch (Exception) { /* 某些平台拿不到命令行 */ }
                commandLineDev = on;
                return on;
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            // 关掉 Domain Reload 时也重新读盘：进 Play 前编辑模式下的改动已经即时写过盘
            rootOverride = null;
            main = dev = shared = null;
            ForceDev = false;
            commandLineDev = null;
            Application.quitting -= Flush;
            Application.quitting += Flush;
        }

        /// <summary>
        /// 换存档根目录（测试用临时目录；null = 恢复 persistentDataPath）。丢掉已经读进来的文件（不写盘），下次访问重新读。
        /// 已经拿到手的段实例属于旧文件，换根之后要重新取。
        /// </summary>
        public static void UseRoot(string directory)
        {
            rootOverride = string.IsNullOrEmpty(directory) ? null : directory;
            main = dev = shared = null;
        }

        /// <summary>把所有有改动的文件写盘（退出、失焦、<see cref="SaveFile.SaveSoon"/> 的延时到了）</summary>
        public static void Flush()
        {
            if (main is { Dirty: true }) main.Save();
            if (dev is { Dirty: true }) dev.Save();
            if (shared is { Dirty: true }) shared.Save();
        }

        // ───────────── 文件级迁移 ─────────────

        /// <summary>信封迁移表：从某个版本升一级（每步必须把 "version" 写成更大的数）</summary>
        static readonly Dictionary<int, Func<JObject, JObject>> migrations = new()
        {
            [1] = FromWebV1,
        };

        internal static JObject Migrate(JObject root, int version, out bool migrated)
        {
            migrated = false;
            while (version < CurrentVersion)
            {
                if (!migrations.TryGetValue(version, out var step)) throw new InvalidDataException($"没有从 v{version} 升级的迁移");
                root = step(root);
                int next = root["version"] is JValue { Type: JTokenType.Integer } jv ? (int)jv : 0;
                if (next <= version) throw new InvalidDataException($"v{version} 的迁移没有升版本");
                version = next;
                migrated = true;
            }
            return root;
        }

        /// <summary>
        /// v1 → v2：Three.js 网页版的 MetaSave（src/progression/Meta.ts）拆成 meta 段（魂晶、天赋、英雄）和 career 段（stats 原样，字段同名）。
        /// 字段的合法性（负数、超上限、类型不对）由各段的 Restore 按网页版 sanitize 的规则处理，这里只搬家。
        /// </summary>
        static JObject FromWebV1(JObject v1)
        {
            var meta = new JObject
            {
                ["essence"] = v1["essence"]?.DeepClone() ?? 0,
                ["talents"] = v1["talents"]?.DeepClone() ?? new JObject(),
                ["unlockedHeroes"] = v1["unlockedHeroes"]?.DeepClone() ?? new JArray(),
            };
            var sections = new JObject { ["meta"] = new JObject { ["v"] = 1, ["data"] = meta } };
            if (v1["stats"] is JObject stats) sections["career"] = new JObject { ["v"] = 1, ["data"] = stats.DeepClone() };
            return new JObject { ["version"] = 2, ["game"] = "spiritfire", ["sections"] = sections };
        }

        // ───────────── 底层 ─────────────

        /// <summary>解析 JSON（不把日期样的字符串改成 DateTime，原样保留；尾部多余内容算错）</summary>
        internal static JToken ParseToken(string text)
        {
            using var sr = new StringReader(text);
            using var reader = new JsonTextReader(sr) { DateParseHandling = DateParseHandling.None, FloatParseHandling = FloatParseHandling.Double };
            var token = JToken.ReadFrom(reader);
            while (reader.Read())
                if (reader.TokenType != JsonToken.Comment)
                    throw new JsonReaderException("JSON 后面还有多余内容");
            return token;
        }

        /// <summary>原子写：.tmp 写完刷盘 → File.Replace 换掉主文件（旧主文件变 .bak）；平台不支持 Replace 时退回「复制成 .bak → 删 → 挪」</summary>
        internal static void WriteAtomic(string path, string backup, string temp, string text)
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var bytes = new UTF8Encoding(false).GetBytes(text);
            using (var fs = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                fs.Write(bytes, 0, bytes.Length);
                fs.Flush(true);
            }
            if (!File.Exists(path))
            {
                File.Move(temp, path);
                return;
            }
            try
            {
                File.Replace(temp, path, backup, true);
            }
            catch (Exception e) when (e is PlatformNotSupportedException || e is IOException || e is UnauthorizedAccessException)
            {
                // Replace 半途失败时主文件可能已经被挪成了 .bak：还在才复制
                if (File.Exists(path))
                {
                    File.Copy(path, backup, true);
                    File.Delete(path);
                }
                File.Move(temp, path);
            }
        }

        internal static void TryCopy(string from, string to)
        {
            try
            {
                if (File.Exists(from)) File.Copy(from, to, true);
            }
            catch (Exception) { /* 只是留给排查的副本 */ }
        }
    }

    /// <summary><see cref="SaveFile.SaveSoon"/> 的延时刷盘：隐藏的常驻物体，到点、失焦、退到后台、退出时调 <see cref="SaveService.Flush"/></summary>
    sealed class SaveFlusher : MonoBehaviour
    {
        const float Delay = 0.75f;
        static SaveFlusher instance;
        float due = float.PositiveInfinity;

        internal static void Schedule()
        {
            if (!instance)
            {
                // 只隐藏、不加 DontSave：退出 Play 模式时随 DontDestroyOnLoad 场景一起销毁，不泄漏到编辑模式
                var go = new GameObject("[SaveFlusher]") { hideFlags = HideFlags.HideInHierarchy };
                DontDestroyOnLoad(go);
                instance = go.AddComponent<SaveFlusher>();
            }
            instance.due = Time.unscaledTime + Delay;
        }

        void Update()
        {
            if (Time.unscaledTime < due) return;
            due = float.PositiveInfinity;
            SaveService.Flush();
        }

        void OnApplicationPause(bool paused)
        {
            if (paused) SaveService.Flush();
        }

        void OnApplicationFocus(bool focus)
        {
            if (!focus) SaveService.Flush();
        }

        void OnApplicationQuit() => SaveService.Flush();

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }
    }
}
