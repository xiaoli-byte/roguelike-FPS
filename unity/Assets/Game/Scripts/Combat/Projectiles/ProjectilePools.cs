using System;
using System.Collections.Generic;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Spiritfire.Game
{
    /// <summary>
    /// 投射物与外观的对象池：所有池化对象挂在当前场景的「[Projectiles]」根下（换场景时随场景销毁，池里留下的空引用取用时跳过）。
    /// 发射 / 命中不再 Instantiate / Destroy：取出时 SetActive(true)，回收时 SetActive(false) 压回栈里。
    /// </summary>
    public static class ProjectilePools
    {
        static Transform root;
        static readonly List<Action> clearers = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => root = null;

        /// <summary>池化对象的父节点（懒创建；场景卸载后自动重建）</summary>
        public static Transform Root
        {
            get
            {
                if (!root) root = new GameObject("[Projectiles]").transform;
                return root;
            }
        }

        /// <summary>从空闲栈取一个（跳过已被场景销毁的），没有就新建一个挂着 T 的 GameObject</summary>
        public static T Take<T>(Stack<T> free, string name) where T : Component
        {
            while (free.Count > 0)
            {
                var c = free.Pop();
                if (!c) continue;
                c.gameObject.SetActive(true);
                return c;
            }
            var go = new GameObject(name);
            go.transform.SetParent(Root, false);
            return go.AddComponent<T>();
        }

        /// <summary>回收：停用并压回空闲栈</summary>
        public static void Give<T>(Stack<T> free, T c) where T : Component
        {
            if (!c) return;
            c.gameObject.SetActive(false);
            free.Push(c);
        }

        /// <summary>登记一个「全部回收」的回调（各类投射物、外观池各自登记）</summary>
        internal static void OnClear(Action clear)
        {
            if (clear != null && !clearers.Contains(clear)) clearers.Add(clear);
        }

        /// <summary>
        /// 换关 / 新开一局 / 测试收尾：回收全部在飞的投射物（不触发命中、不爆炸），并销毁池根与所有池化对象。
        /// 编辑模式下用 DestroyImmediate。
        /// </summary>
        public static void Clear()
        {
            for (int i = 0; i < clearers.Count; i++)
                try
                {
                    clearers[i]();
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            if (root) SafeDestroy(root.gameObject);
            root = null;
        }

        /// <summary>运行时 Destroy，编辑模式（EditMode 测试）DestroyImmediate</summary>
        public static void SafeDestroy(Object o)
        {
            if (!o) return;
            if (Application.isPlaying) Object.Destroy(o);
            else Object.DestroyImmediate(o);
        }
    }
}
