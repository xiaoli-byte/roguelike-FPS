using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;
using UnityEngine.Scripting;

namespace Spiritfire.Game
{
    /// <summary>一条内容定义（武器、敌人、秘卷、英雄、奖励…）：用 id 唯一标识</summary>
    public interface IDef
    {
        string Id { get; }
    }

    /// <summary>
    /// 内容注册标记（docs/unity-parity.md 4.3，代码优先 D16）：带这个属性的类在第一次访问 <see cref="Registry{T}"/> 时被发现。
    ///   是 T 的非抽象子类 → new 一个登记进去（有行为的定义：英雄、带钩子的秘卷）；
    ///   实现了 <see cref="IDefSource{T}"/> → 调 Create()，返回的每条都登记（纯数据定义：武器、敌人、成组的属性秘卷）。
    /// 继承 PreserveAttribute：IL2CPP 裁剪时保留（另有 Assets/Game/link.xml 保留整个程序集，双保险）。
    /// Order 决定 <see cref="Registry{T}.All"/> 里的先后（小的在前，相同按类型全名；同一个 IDefSource 内按 Create() 的顺序）。
    /// </summary>
    [AttributeUsage(AttributeTargets.Class, Inherited = false)]
    public sealed class DefsAttribute : PreserveAttribute
    {
        public int Order { get; set; }

        public DefsAttribute() { }
        public DefsAttribute(int order) => Order = order;
    }

    /// <summary>一组定义的来源：一个文件可以产出一条或多条（组文件）</summary>
    public interface IDefSource<out T> where T : class, IDef
    {
        IEnumerable<T> Create();
    }

    /// <summary>
    /// 某类内容的注册表：第一次访问时扫描 Spiritfire.Game 程序集里所有带 <see cref="DefsAttribute"/> 的类，按 Order 排好缓存。
    /// id 重复、为空直接抛异常（带两边的类型名）。进入 Play（SubsystemRegistration）时清空，关掉 Domain Reload 也安全。
    /// 编辑器构建器（PlayerRigBuilder、关卡生成器）在 Play 之外也可以直接读。
    /// </summary>
    public static class Registry<T> where T : class, IDef
    {
        static List<T> list;
        static Dictionary<string, T> byId;

        /// <summary>全部定义（按 Order 排序）</summary>
        public static IReadOnlyList<T> All
        {
            get
            {
                Ensure();
                return list;
            }
        }

        /// <summary>按 id 取；没有则返回 null</summary>
        public static T Get(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            Ensure();
            return byId.TryGetValue(id, out var d) ? d : null;
        }

        public static bool TryGet(string id, out T def)
        {
            def = Get(id);
            return def != null;
        }

        public static bool Contains(string id) => Get(id) != null;

        static void Ensure()
        {
            if (list != null) return;
            var found = new List<(int order, string type, int index, T def)>();
            var owners = new Dictionary<string, string>();
            foreach (var (type, order) in DefsScanner.Types)
            {
                IEnumerable<T> made;
                try
                {
                    if (typeof(IDefSource<T>).IsAssignableFrom(type)) made = ((IDefSource<T>)Activator.CreateInstance(type, true)).Create();
                    else if (typeof(T).IsAssignableFrom(type) && !type.IsAbstract && !type.IsInterface) made = new[] { (T)Activator.CreateInstance(type, true) };
                    else continue;
                }
                catch (Exception e)
                {
                    throw new InvalidOperationException($"[Defs] 创建 {typeof(T).Name} 定义失败：{type.FullName}：{e.Message}", e);
                }
                if (made == null) continue;
                int index = 0;
                foreach (var def in made)
                {
                    if (def == null) continue;
                    var id = def.Id;
                    if (string.IsNullOrEmpty(id)) throw new InvalidOperationException($"[Defs] {type.FullName} 产出的 {typeof(T).Name} 没有 id");
                    if (owners.TryGetValue(id, out var other))
                        throw new InvalidOperationException($"[Defs] {typeof(T).Name} 的 id「{id}」重复：{other} 与 {type.FullName}");
                    owners[id] = type.FullName;
                    found.Add((order, type.FullName, index++, def));
                }
            }
            found.Sort((a, b) =>
            {
                int c = a.order.CompareTo(b.order);
                if (c == 0) c = string.CompareOrdinal(a.type, b.type);
                return c != 0 ? c : a.index.CompareTo(b.index);
            });
            var l = new List<T>(found.Count);
            var map = new Dictionary<string, T>(found.Count);
            foreach (var f in found)
            {
                l.Add(f.def);
                map[f.def.Id] = f.def;
            }
            byId = map;
            list = l;
            DefsScanner.OnReset(Clear);
        }

        static void Clear()
        {
            list = null;
            byId = null;
        }
    }

    /// <summary>十六进制颜色（同 Three.js 定义里的 0xRRGGBB 写法），定义文件照抄 TS 颜色用</summary>
    public static class Hex
    {
        public static Color Rgb(int hex) => new(((hex >> 16) & 0xff) / 255f, ((hex >> 8) & 0xff) / 255f, (hex & 0xff) / 255f);
    }

    /// <summary>[Defs] 类型的扫描缓存（所有 Registry 共用一次反射），以及进入 Play 时的统一清空</summary>
    public static class DefsScanner
    {
        static List<(Type type, int order)> types;
        static readonly List<Action> resets = new();

        /// <summary>Spiritfire.Game 程序集里带 [Defs] 的类（含 Order）</summary>
        public static IReadOnlyList<(Type type, int order)> Types
        {
            get
            {
                if (types != null) return types;
                Type[] all;
                try { all = typeof(DefsAttribute).Assembly.GetTypes(); }
                catch (ReflectionTypeLoadException e) { all = Array.FindAll(e.Types, t => t != null); }
                var l = new List<(Type, int)>();
                foreach (var t in all)
                {
                    if (!t.IsClass || t.ContainsGenericParameters) continue;
                    var attr = t.GetCustomAttribute<DefsAttribute>(false);
                    if (attr != null) l.Add((t, attr.Order));
                }
                types = l;
                return types;
            }
        }

        internal static void OnReset(Action clear)
        {
            if (!resets.Contains(clear)) resets.Add(clear);
        }

        /// <summary>清空全部注册表与扫描缓存（下次访问重新扫描）</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        public static void ResetAll()
        {
            foreach (var r in resets) r();
            resets.Clear();
            types = null;
        }
    }
}
