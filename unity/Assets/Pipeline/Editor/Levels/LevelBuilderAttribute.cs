using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 关卡构建器登记：标在 Level_&lt;c&gt;_&lt;n&gt; 这类静态类上，例如 [LevelBuilder("1-2", "Assets/Scenes/L1_2_Yardang.unity")]。
    /// 类里要有入口 <c>public static int Build(bool review)</c>：生成场景 → 烘焙 → 验收检查（报告写 Assets/Art/_Review）→ review 时截图，返回不合格项数。
    /// bridge.sh level &lt;id&gt; / levels 通过 <see cref="LevelBuilders"/> 找构建器（TypeCache 扫描，新关卡不用改 Bridge）。
    /// </summary>
    [AttributeUsage(AttributeTargets.Class, AllowMultiple = false, Inherited = false)]
    public sealed class LevelBuilderAttribute : Attribute
    {
        /// <summary>关卡 id（命令行里用，如 1-1、4-2、testarena）</summary>
        public string Id { get; }
        /// <summary>构建器生成的场景</summary>
        public string ScenePath { get; }

        public LevelBuilderAttribute(string id, string scenePath)
        {
            Id = id;
            ScenePath = scenePath;
        }
    }

    /// <summary>已登记的关卡构建器（按 id 排序：章-关按数字，其它名字排在后面）</summary>
    public static class LevelBuilders
    {
        public sealed class Entry
        {
            public string Id, ScenePath;
            public Type Type;
            /// <summary>构建入口：参数 review = 截审核图；返回不合格项数</summary>
            public Func<bool, int> Build;
        }

        public static IReadOnlyList<Entry> All
        {
            get
            {
                var list = new List<Entry>();
                foreach (var type in TypeCache.GetTypesWithAttribute<LevelBuilderAttribute>())
                {
                    var attr = type.GetCustomAttribute<LevelBuilderAttribute>();
                    var build = type.GetMethod("Build", BindingFlags.Public | BindingFlags.Static, null, new[] { typeof(bool) }, null);
                    if (attr == null) continue;
                    if (build == null || build.ReturnType != typeof(int))
                    {
                        Debug.LogError($"[Level] {type.FullName} 标了 [LevelBuilder(\"{attr.Id}\")]，但没有 public static int Build(bool review)");
                        continue;
                    }
                    if (list.Exists(e => string.Equals(e.Id, attr.Id, StringComparison.OrdinalIgnoreCase)))
                    {
                        Debug.LogError($"[Level] 关卡 id「{attr.Id}」登记了两次（{type.FullName}），后一个忽略");
                        continue;
                    }
                    list.Add(new Entry
                    {
                        Id = attr.Id, ScenePath = attr.ScenePath, Type = type,
                        Build = (Func<bool, int>)Delegate.CreateDelegate(typeof(Func<bool, int>), build),
                    });
                }
                list.Sort((a, b) => Compare(a.Id, b.Id));
                return list;
            }
        }

        public static IEnumerable<string> Ids => All.Select(e => e.Id);

        public static Entry Find(string id) =>
            All.FirstOrDefault(e => string.Equals(e.Id, id?.Trim(), StringComparison.OrdinalIgnoreCase));

        /// <summary>构建设置的场景顺序：交给 <see cref="BuildOrder"/>（Core → 主菜单 → RunPlan 的关卡 → 其余登记的关卡 → 其它场景）。顺序没变就不写</summary>
        public static void SyncBuildSettings()
        {
            BuildOrder.Apply();
            BuildOrder.Save();
        }

        /// <summary>"1-2" &lt; "1-10" &lt; "2-1" &lt; 其它名字（按字母）</summary>
        static int Compare(string a, string b)
        {
            bool na = TryChapter(a, out var ca, out var la), nb = TryChapter(b, out var cb, out var lb);
            if (na && nb) return ca != cb ? ca.CompareTo(cb) : la.CompareTo(lb);
            if (na != nb) return na ? -1 : 1;
            return string.CompareOrdinal(a, b);
        }

        static bool TryChapter(string id, out int chapter, out int level)
        {
            chapter = level = 0;
            var parts = id.Split('-');
            return parts.Length == 2 && int.TryParse(parts[0], out chapter) && int.TryParse(parts[1], out level);
        }
    }
}
