using System.Collections.Generic;
using System.Linq;
using UnityEditorInternal;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 占位清单（docs/unity-parity.md 4.11）：LevelKit.PlaceOrBox 找不到 Prefab 时放的白盒（Placeholder 标签），
    /// 以及名字里带 Placeholder / 占位的物体（手搭的占位条带等），只列最外层。
    /// 正式图（PlaceholderPolicy.Fail，默认）有占位就不合格；白盒阶段、测试场声明 Warn 只列清单。
    /// </summary>
    public sealed class PlaceholderCheck : ILevelCheck
    {
        public string Id => "placeholders";
        public string Title => "占位清单";
        public int Order => 120;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            bool tagDefined = InternalEditorUtility.tags.Contains(LevelKit.PlaceholderTag);
            var found = new List<GameObject>();
            var stack = new Stack<Transform>();
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.isLoaded) continue;
                foreach (var root in scene.GetRootGameObjects()) stack.Push(root.transform);
            }
            while (stack.Count > 0)
            {
                var t = stack.Pop();
                if (IsPlaceholder(t.gameObject, tagDefined))
                {
                    found.Add(t.gameObject);
                    continue; // 子物体不再单列
                }
                foreach (Transform c in t) stack.Push(c);
            }
            if (found.Count == 0)
            {
                rep.Line("✓ 没有占位件");
                return;
            }
            var lines = found.OrderBy(go => Path(go.transform)).Select(go =>
            {
                var p = go.transform.position;
                return $"    · {Path(go.transform)} @ ({p.x:F0}, {p.y:F0}, {p.z:F0})";
            }).ToList();
            string head = $"{found.Count} 个占位件（PlaceOrBox 白盒 / 名字带 Placeholder、占位）";
            if (ctx.spec.placeholders == PlaceholderPolicy.Fail) rep.Fail($"{head}：正式图不能有占位");
            else rep.Warn($"{head}：白盒阶段允许，正式验收前要换掉");
            foreach (var l in lines.Take(40)) rep.Line(l);
            if (lines.Count > 40) rep.Line($"    ……另有 {lines.Count - 40} 个");
        }

        static bool IsPlaceholder(GameObject go, bool tagDefined)
        {
            if (tagDefined && go.CompareTag(LevelKit.PlaceholderTag)) return true;
            var n = go.name;
            return n.IndexOf("placeholder", System.StringComparison.OrdinalIgnoreCase) >= 0 || n.Contains("占位");
        }

        static string Path(Transform t)
        {
            var parts = new List<string>();
            for (var x = t; x; x = x.parent) parts.Add(x.name);
            parts.Reverse();
            return string.Join("/", parts);
        }
    }
}
