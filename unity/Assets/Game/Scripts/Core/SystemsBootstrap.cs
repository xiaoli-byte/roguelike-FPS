using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.Scripting;

namespace Spiritfire.Game
{
    /// <summary>
    /// 系统组件标记（docs/unity-parity.md 4.3）：带这个属性的 MonoBehaviour 在场景开始时自动挂到「Game Systems」物体上，
    /// 新系统不必再去改 PlayerRigBuilder / 重建场景。Order 决定挂载先后（小的先挂，相同按类型全名）。
    /// 继承 PreserveAttribute：IL2CPP 裁剪时保留。
    /// </summary>
    [AttributeUsage(AttributeTargets.Class, Inherited = false)]
    public sealed class GameSystemAttribute : PreserveAttribute
    {
        public int Order { get; set; }

        public GameSystemAttribute() { }
        public GameSystemAttribute(int order) => Order = order;
    }

    /// <summary>
    /// 场景加载后把所有 [GameSystem] 组件挂到「Game Systems」物体上（有 GameSession 的那个；没有就按名字找）。
    /// 幂等：已经挂着的不重复挂。没有 Game Systems 的场景（展示场景）什么都不做。
    /// 挂载时机：AfterSceneLoad / sceneLoaded——场景物体的 Awake 已经跑完、Start 还没跑，新挂的组件照常 Awake → OnEnable → Start。
    /// </summary>
    public static class SystemsBootstrap
    {
        public const string ObjectName = "Game Systems";
        static List<Type> types;

        /// <summary>程序集里全部 [GameSystem] 组件类型（按 Order 排序）</summary>
        public static IReadOnlyList<Type> Types
        {
            get
            {
                if (types != null) return types;
                Type[] all;
                try { all = typeof(GameSystemAttribute).Assembly.GetTypes(); }
                catch (ReflectionTypeLoadException e) { all = Array.FindAll(e.Types, t => t != null); }
                var found = new List<(Type type, int order)>();
                foreach (var t in all)
                {
                    if (!t.IsClass || t.IsAbstract || t.ContainsGenericParameters || !typeof(MonoBehaviour).IsAssignableFrom(t)) continue;
                    var attr = t.GetCustomAttribute<GameSystemAttribute>(false);
                    if (attr != null) found.Add((t, attr.Order));
                }
                found.Sort((a, b) =>
                {
                    int c = a.order.CompareTo(b.order);
                    return c != 0 ? c : string.CompareOrdinal(a.type.FullName, b.type.FullName);
                });
                types = found.ConvertAll(f => f.type);
                return types;
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            SceneManager.sceneLoaded -= OnSceneLoaded;
            types = null;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Init()
        {
            SceneManager.sceneLoaded -= OnSceneLoaded;
            SceneManager.sceneLoaded += OnSceneLoaded;
            Setup();
        }

        static void OnSceneLoaded(Scene scene, LoadSceneMode mode) => Setup();

        /// <summary>找到 Game Systems 物体并补挂缺的系统组件；返回该物体（没有则 null）</summary>
        public static GameObject Setup()
        {
            var host = Find();
            if (!host) return null;
            foreach (var t in Types)
                if (!host.GetComponent(t)) host.AddComponent(t);
            return host;
        }

        /// <summary>Game Systems 物体：有 GameSession 的那个，否则按名字找</summary>
        public static GameObject Find()
        {
            var session = GameSession.Instance ? GameSession.Instance : UnityEngine.Object.FindAnyObjectByType<GameSession>();
            if (session) return session.gameObject;
            return GameObject.Find(ObjectName);
        }
    }
}
