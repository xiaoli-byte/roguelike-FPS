using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 冒烟测试套件（bridge.sh playtest &lt;id&gt; [场景]）。实现放 Testing/Suites/&lt;Name&gt;Suite.cs，有公开的无参构造函数就自动登记
    /// （<see cref="PlaytestSuites"/>），每次运行新建一个实例。一般继承 <see cref="PlaytestSuite"/>，直接用它的记录 / 截图 / 操控工具。
    /// </summary>
    public interface IPlaytestSuite
    {
        /// <summary>命令行里的套件名（如 slice11），不区分大小写</summary>
        string Id { get; }
        /// <summary>默认场景（Assets/… .unity）；命令行给了场景就用命令行的</summary>
        string Scene { get; }
        /// <summary>测试步骤：Play 模式里由 <see cref="PlaytestRunner"/> 当协程跑，跑完（或抛异常）由宿主写结论、退出 Play</summary>
        IEnumerator Run(PlaytestRunner runner);
    }

    /// <summary>套件登记表：扫描本程序集里实现了 <see cref="IPlaytestSuite"/> 的非抽象类（只在编辑器的 Play 模式里用）</summary>
    public static class PlaytestSuites
    {
        /// <summary>bridge.sh playtest 不带套件名时跑的套件：1-1 切片冒烟</summary>
        public const string Default = "slice11";

        static Dictionary<string, (Type type, string scene)> map;

        static Dictionary<string, (Type type, string scene)> Map
        {
            get
            {
                if (map != null) return map;
                map = new Dictionary<string, (Type, string)>(StringComparer.OrdinalIgnoreCase);
                foreach (var t in typeof(IPlaytestSuite).Assembly.GetTypes())
                {
                    if (t.IsAbstract || t.IsInterface || !typeof(IPlaytestSuite).IsAssignableFrom(t) || t.GetConstructor(Type.EmptyTypes) == null) continue;
                    var s = (IPlaytestSuite)Activator.CreateInstance(t);
                    if (string.IsNullOrWhiteSpace(s.Id))
                        Debug.LogError($"[playtest] 套件 {t.FullName} 没有 Id");
                    else if (map.TryGetValue(s.Id, out var other))
                        Debug.LogError($"[playtest] 套件 id「{s.Id}」重复：{other.type.FullName} 和 {t.FullName}，后一个忽略");
                    else map[s.Id] = (t, s.Scene);
                }
                return map;
            }
        }

        /// <summary>已登记的套件 id（按字母序）</summary>
        public static IEnumerable<string> Ids => Map.Keys.OrderBy(k => k, StringComparer.Ordinal);

        public static bool Exists(string id) => !string.IsNullOrEmpty(id) && Map.ContainsKey(id);

        /// <summary>套件的默认场景；没有这个套件时为 null</summary>
        public static string SceneOf(string id) => Exists(id) ? Map[id].scene : null;

        /// <summary>新建一个套件实例；没有这个套件时为 null</summary>
        public static IPlaytestSuite Create(string id) => Exists(id) ? (IPlaytestSuite)Activator.CreateInstance(Map[id].type) : null;
    }
}
