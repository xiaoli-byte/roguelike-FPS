using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>设置项的值类型：数值滑条 / 开关 / 多选一（值存档位下标）</summary>
    public enum SettingType
    {
        Float,
        Bool,
        Choice,
    }

    /// <summary>
    /// 一个设置项（docs/unity-parity.md 4.7）：键、类型、默认值、范围 / 步长、分组、显示名、选项名。
    /// 值统一按 float 存（开关 0 / 1，多选一 = 下标）；U4 的设置面板按这些元数据自动生成控件。
    /// </summary>
    public sealed class SettingDef
    {
        public readonly string key, label, group;
        public readonly SettingType type;
        public readonly float defaultValue, min, max, step;
        /// <summary>多选一的选项名</summary>
        public readonly string[] options;
        /// <summary>值存在别处（画质 → ArtQuality 自己的 PlayerPrefs 键），不进设置 JSON</summary>
        internal readonly Func<float> read;
        internal readonly Action<float> write;
        /// <summary>不自动生成控件（分辨率：设置页上有手写的步进器），也不在 <see cref="GameSettings.All"/> 里</summary>
        public readonly bool hidden;

        internal SettingDef(string key, string label, string group, SettingType type, float defaultValue, float min, float max, float step,
            string[] options = null, Func<float> read = null, Action<float> write = null, bool hidden = false)
        {
            this.hidden = hidden;
            this.key = key;
            this.label = label;
            this.group = group;
            this.type = type;
            this.defaultValue = defaultValue;
            this.min = min;
            this.max = max;
            this.step = step;
            this.options = options;
            this.read = read;
            this.write = write;
        }

        public float Value => GameSettings.Get(this);
        public bool Bool => Value >= 0.5f;
        public int Index => Mathf.RoundToInt(Value);
        public void Set(float v) => GameSettings.Set(this, v);
        public void Set(bool v) => GameSettings.Set(this, v ? 1 : 0);

        /// <summary>显示用的值文字（「80」「开」「高」「100%」）</summary>
        public string Display => type switch
        {
            SettingType.Bool => Bool ? "开" : "关",
            SettingType.Choice => options != null && Index >= 0 && Index < options.Length ? options[Index] : Index.ToString(),
            _ => max <= 1.5f && min >= 0 && step < 1 ? $"{Value * 100:0}%" : Value.ToString(step < 1 ? "0.00" : "0"),
        };

        public override string ToString() => key;
    }

    /// <summary>
    /// 玩家设置（同 Three.js src/core/settings.ts）：灵敏度、反转 Y、视野（默认 80°）、画质、震屏、伤害数字、主 / 音乐 / 音效音量；
    /// F4 加了显示模式 / 分辨率（隐藏项，设置页手写步进器）/ 垂直同步 / 帧率上限 / 屏幕特效强度，F5 加了环境音、界面音（由 <see cref="GraphicsQuality"/>、
    /// <see cref="GameplayVolumes"/>、<see cref="GameAudio"/> 执行）。
    /// 存在 <see cref="SaveService.Shared"/>（settings.json，正式档和调试档共用）的「settings」段；以前存在 PlayerPrefs 的键 spiritfire.settings，
    /// 第一次读时导入。改了立刻发 <see cref="Changed"/>，稍后写盘（拖滑条合并成一次）。
    /// 消费方自己订阅 Changed 或在用的时候读：WeaponController（视野、震屏）、GameAudio（音量）、Hud（伤害数字）；
    /// PlayerMotor 在美术运行时程序集里认识不到这张表，灵敏度 / 反转 Y 由这里写进它的静态字段。
    /// 音量默认 1：Three.js 的 0.8 / 0.9 / 0.5 是总线比例，Unity 已经烘进 audio-manifest 的 mix 里，这里是再乘的玩家音量。
    /// 画质沿用 <see cref="ArtQuality"/> 自己的存档（暂停菜单、冒烟测试都直接用它），这里只是转发。
    /// </summary>
    public static class GameSettings
    {
        public const string PrefsKey = "spiritfire.settings";
        public const string GroupControls = "操作", GroupVideo = "画面", GroupAudio = "声音";

        // 注意顺序：all / values 必须写在各设置项前面（静态字段按书写顺序初始化）
        static readonly List<SettingDef> all = new();
        static readonly List<SettingDef> hiddenDefs = new();
        static readonly Dictionary<string, float> values = new();
        static bool loaded;

        public static readonly SettingDef Sensitivity = Add(new SettingDef("sensitivity", "鼠标灵敏度", GroupControls, SettingType.Float, 1f, 0.2f, 3f, 0.05f));
        public static readonly SettingDef InvertY = Add(new SettingDef("invertY", "反转 Y 轴", GroupControls, SettingType.Bool, 0, 0, 1, 1));
        /// <summary>手柄瞄准辅助（只对右摇杆，见 AimAssist；默认开）</summary>
        public static readonly SettingDef AimAssist = Add(new SettingDef("aimAssist", "手柄瞄准辅助", GroupControls, SettingType.Bool, 1, 0, 1, 1));
        public static readonly SettingDef Fov = Add(new SettingDef("fov", "视野", GroupVideo, SettingType.Float, 80f, 60f, 110f, 1f));
        public static readonly SettingDef Quality = Add(new SettingDef("quality", "画质", GroupVideo, SettingType.Choice, (float)ArtQualityLevel.High, 0, 2, 1,
            new[] { ArtQuality.Label(ArtQualityLevel.Low), ArtQuality.Label(ArtQualityLevel.Medium), ArtQuality.Label(ArtQualityLevel.High) },
            () => (float)ArtQuality.Level, v => ArtQuality.Set((ArtQualityLevel)Mathf.Clamp(Mathf.RoundToInt(v), 0, 2))));
        /// <summary>显示模式：全屏 / 无边框 / 窗口（下标对应 <see cref="GraphicsQuality.DisplayModes"/>），默认无边框</summary>
        public static readonly SettingDef DisplayMode = Add(new SettingDef("displayMode", "显示模式", GroupVideo, SettingType.Choice, 1, 0, 2, 1,
            new[] { "全屏", "无边框", "窗口" }));
        /// <summary>分辨率宽 / 高（0 = 桌面分辨率）：隐藏项，设置页的分辨率步进器写它们</summary>
        public static readonly SettingDef ResolutionWidth = Add(new SettingDef("resolutionWidth", "分辨率宽", GroupVideo, SettingType.Float, 0, 0, 16384, 1, hidden: true));
        public static readonly SettingDef ResolutionHeight = Add(new SettingDef("resolutionHeight", "分辨率高", GroupVideo, SettingType.Float, 0, 0, 16384, 1, hidden: true));
        public static readonly SettingDef VSync = Add(new SettingDef("vsync", "垂直同步", GroupVideo, SettingType.Bool, 1, 0, 1, 1));
        /// <summary>帧率上限（下标对应 <see cref="GraphicsQuality.FrameCaps"/>；垂直同步开着时不生效），默认不限</summary>
        public static readonly SettingDef FrameCap = Add(new SettingDef("frameCap", "帧率上限", GroupVideo, SettingType.Choice, 7, 0, 7, 1,
            new[] { "30", "60", "90", "120", "144", "165", "240", "不限" }));
        public static readonly SettingDef ScreenShake = Add(new SettingDef("screenShake", "震屏强度", GroupVideo, SettingType.Float, 1f, 0f, 1.5f, 0.05f));
        /// <summary>玩法屏效强度（低血量 / 受击 / 冲刺 / 慢动作的暗角、色差、去饱和；<see cref="GameplayVolumes"/>）</summary>
        public static readonly SettingDef ScreenEffects = Add(new SettingDef("screenEffects", "屏幕特效", GroupVideo, SettingType.Float, 1f, 0f, 1f, 0.05f));
        public static readonly SettingDef DamageNumbers = Add(new SettingDef("damageNumbers", "伤害数字", GroupVideo, SettingType.Bool, 1, 0, 1, 1));
        public static readonly SettingDef MasterVolume = Add(new SettingDef("masterVolume", "主音量", GroupAudio, SettingType.Float, 1f, 0f, 1f, 0.05f));
        public static readonly SettingDef MusicVolume = Add(new SettingDef("musicVolume", "音乐", GroupAudio, SettingType.Float, 1f, 0f, 1f, 0.05f));
        public static readonly SettingDef SfxVolume = Add(new SettingDef("sfxVolume", "音效", GroupAudio, SettingType.Float, 1f, 0f, 1f, 0.05f));
        public static readonly SettingDef AmbienceVolume = Add(new SettingDef("ambienceVolume", "环境音", GroupAudio, SettingType.Float, 1f, 0f, 1f, 0.05f));
        public static readonly SettingDef UiVolume = Add(new SettingDef("uiVolume", "界面音", GroupAudio, SettingType.Float, 1f, 0f, 1f, 0.05f));

        /// <summary>某一项变了（设置面板、代码改的都发；画质被别处改了也发）</summary>
        public static event Action<SettingDef> Changed;

        /// <summary>全部可见设置项（按分组、显示顺序；设置页按它自动生成控件）。隐藏项（分辨率宽 / 高）不在里面</summary>
        public static IReadOnlyList<SettingDef> All => all;

        public static SettingDef Find(string key)
        {
            foreach (var d in all)
                if (d.key == key) return d;
            foreach (var d in hiddenDefs)
                if (d.key == key) return d;
            return null;
        }

        static SettingDef Add(SettingDef d)
        {
            (d.hidden ? hiddenDefs : all).Add(d);
            return d;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Changed = null;
            loaded = false;
            values.Clear();
        }

        /// <summary>进场景前读档，把美术运行时程序集里的消费方（PlayerMotor）对上，跟着画质变化转发 Changed</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Boot()
        {
            EnsureLoaded();
            ArtQuality.Changed -= OnQuality;
            ArtQuality.Changed += OnQuality;
            Changed -= ApplyToMotor;
            Changed += ApplyToMotor;
            ApplyToMotor(null);
        }

        static void OnQuality(ArtQualityLevel _) => Raise(Quality);

        static void ApplyToMotor(SettingDef d)
        {
            if (d != null && d != Sensitivity && d != InvertY) return;
            PlayerMotor.Sensitivity = Sensitivity.Value;
            PlayerMotor.InvertY = InvertY.Bool;
        }

        public static float Get(SettingDef d)
        {
            if (d == null) return 0;
            if (d.read != null) return d.read();
            EnsureLoaded();
            return values.TryGetValue(d.key, out var v) ? v : d.defaultValue;
        }

        /// <summary>改一项（夹到范围、按步长取整），变了就保存并发 Changed</summary>
        public static void Set(SettingDef d, float v)
        {
            if (d == null || float.IsNaN(v)) return;
            v = Clean(d, v);
            if (d.write != null)
            {
                // 外部存储（画质）：由它自己的 Changed 转发回来
                if (!Mathf.Approximately(d.read(), v)) d.write(v);
                return;
            }
            EnsureLoaded();
            if (Mathf.Approximately(Get(d), v)) return;
            values[d.key] = v;
            Save();
            Raise(d);
        }

        /// <summary>全部恢复默认</summary>
        public static void ResetAll()
        {
            foreach (var d in all) Set(d, d.defaultValue);
            foreach (var d in hiddenDefs) Set(d, d.defaultValue);
        }

        static float Clean(SettingDef d, float v)
        {
            v = Mathf.Clamp(v, d.min, d.max);
            if (d.type != SettingType.Float) return Mathf.Round(v);
            if (d.step > 0) v = d.min + Mathf.Round((v - d.min) / d.step) * d.step;
            return Mathf.Clamp(v, d.min, d.max);
        }

        static void Raise(SettingDef d)
        {
            var h = Changed;
            if (h == null) return;
            foreach (Action<SettingDef> fn in h.GetInvocationList())
                try { fn(d); }
                catch (Exception e) { Debug.LogException(e); }
        }

        // ───────────── 存档（SaveService 共享文件 settings.json 的「settings」段）─────────────

        [Serializable]
        struct Entry
        {
            public string key;
            public float value;
        }

        [Serializable]
        sealed class Saved
        {
            public int version = 1;
            public List<Entry> entries = new();
        }

        /// <summary>读进来的那个文件（测试换存档根目录后会换成新的，到时重新读）</summary>
        static SaveFile file;

        static void EnsureLoaded()
        {
            if (loaded && file == SaveService.Shared) return;
            loaded = true;
            file = SaveService.Shared;
            file.Section<SettingsSection>();
        }

        /// <summary>改了就稍后写盘（拖滑条时合并成一次）</summary>
        static void Save() => file?.SaveSoon();

        /// <summary>
        /// 设置在存档里的一段：数据就是以前 PlayerPrefs 里那段 JSON（{version, entries:[{key, value}]}）。
        /// 文件里还没有这一段时，从旧的 PlayerPrefs 键 <see cref="PrefsKey"/> 导入一次（PlayerPrefs 不删，装回旧版本还能用）。
        /// </summary>
        sealed class SettingsSection : ISaveSection
        {
            public string Key => "settings";
            public int Version => 1;

            public string Capture()
            {
                var s = new Saved();
                foreach (var (k, v) in values) s.entries.Add(new Entry { key = k, value = v });
                return JsonUtility.ToJson(s);
            }

            public void Restore(string json, int version)
            {
                values.Clear();
                bool imported = false;
                if (json == null)
                {
                    json = PlayerPrefs.GetString(PrefsKey, "");
                    imported = !string.IsNullOrEmpty(json);
                }
                if (string.IsNullOrEmpty(json)) return;
                try
                {
                    var s = JsonUtility.FromJson<Saved>(json);
                    if (s?.entries == null) return;
                    foreach (var e in s.entries)
                    {
                        var d = Find(e.key);
                        if (d != null && d.read == null && !float.IsNaN(e.value)) values[d.key] = Clean(d, e.value);
                    }
                    if (imported) file?.SaveSoon();
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[Settings] 设置存档读不了，用默认值：{e.Message}");
                }
            }
        }
    }
}
