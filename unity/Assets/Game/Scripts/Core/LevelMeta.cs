using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>行旅图上的地点种类（罗盘条 / 全图的图标）</summary>
    public enum MapPoiKind
    {
        /// <summary>战斗场地（<see cref="EncounterSite"/>）</summary>
        Site,
        /// <summary>支路藏宝（<see cref="CachePOI"/>）</summary>
        Cache,
        /// <summary>补给营（<see cref="SupplyCamp"/>）</summary>
        Camp,
        /// <summary>出口传送门（<see cref="ExitPortal"/>）</summary>
        Exit,
        /// <summary>首领场地（<see cref="BossEncounter"/> / <see cref="BossArena"/>）</summary>
        Boss,
        /// <summary>灵火坛（<see cref="SpiritAltar"/>）</summary>
        Altar,
    }

    /// <summary>构建器记下的一个地点：种类、名字、位置（地面）、可选（不算进关卡目标），source = 场景里的那个组件（读实时状态：肃清 / 已调查 / 点亮 / 开启）</summary>
    [Serializable]
    public struct LevelPoi
    {
        public MapPoiKind kind;
        public string name;
        public Vector3 position;
        public bool optional;
        public Component source;
    }

    /// <summary>
    /// 关卡元数据（docs/unity-parity.md U7；L5 验收规则集跑完、截好俯视图后由编辑器的 LevelMetaWriter 写进关卡场景，名为「Level Meta」的物体）：
    ///   · <see cref="map"/>：运行时用的俯视图（Assets/Levels/&lt;场景&gt;/LevelMap_&lt;id&gt;.jpg，入库；审核用的 2048 px PNG 仍在 _Review、不入库），北（+Z）朝上；
    ///   · <see cref="mapArea"/>：俯视图覆盖的世界 XZ（x = xMin、y = zMin），u = (x − xMin) / width，v = (z − zMin) / height（v = 0 在图的下边）；
    ///   · <see cref="pois"/>：构建时场景里的地点（场地、藏宝、补给营、出口、首领、灵火坛），source 指回组件——罗盘条（<see cref="CompassStrip"/>）
    ///     和 M 键全图（<see cref="MapScreen"/>）从这里读，运行时才生成的（首领打完才立的出口）由 <see cref="MapMarkers"/> 补扫。
    /// 当前关卡：<see cref="Current"/> = 活动场景里的那一份（关卡叠加加载后会设成活动场景）；没有时（测试场、旧场景）罗盘只按场景扫描。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LevelMeta : MonoBehaviour
    {
        /// <summary>场景里的物体名（构建器按这个名字找 / 建）</summary>
        public const string ObjectName = "Level Meta";

        [Tooltip("关卡 id（与 [LevelBuilder] 一致：1-1、arena…）")] public string levelId;
        [Tooltip("关卡名（行旅图标题）")] public string title;
        [Tooltip("运行时俯视图（北朝上）")] public Texture2D map;
        [Tooltip("俯视图覆盖的世界 XZ：x = xMin，y = zMin")] public Rect mapArea;
        [Tooltip("构建时的地点")] public LevelPoi[] pois = Array.Empty<LevelPoi>();

        static readonly List<LevelMeta> live = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => live.Clear();

        void OnEnable()
        {
            if (!live.Contains(this)) live.Add(this);
        }

        void OnDisable() => live.Remove(this);

        /// <summary>当前关卡的元数据：活动场景里的那一份；活动场景没有就取最后加载的；都没有为 null</summary>
        public static LevelMeta Current
        {
            get
            {
                var active = SceneManager.GetActiveScene();
                LevelMeta last = null;
                for (int i = live.Count - 1; i >= 0; i--)
                {
                    var m = live[i];
                    if (!m)
                    {
                        live.RemoveAt(i);
                        continue;
                    }
                    if (m.gameObject.scene == active) return m;
                    last ??= m;
                }
                return last;
            }
        }

        /// <summary>有可用的俯视图</summary>
        public bool HasMap => map && mapArea.width > 0 && mapArea.height > 0;

        /// <summary>世界坐标 → 俯视图 UV（0..1，v 向北增大；图外会超出 0..1）</summary>
        public Vector2 WorldToUV(Vector3 world) => WorldToUV(mapArea, world);

        public static Vector2 WorldToUV(Rect area, Vector3 world) =>
            new((world.x - area.xMin) / Mathf.Max(0.01f, area.width), (world.z - area.yMin) / Mathf.Max(0.01f, area.height));

        /// <summary>UV → 世界 XZ（y = 0）</summary>
        public Vector3 UVToWorld(Vector2 uv) => new(mapArea.xMin + uv.x * mapArea.width, 0, mapArea.yMin + uv.y * mapArea.height);

        /// <summary>地点种类的中文名</summary>
        public static string KindName(MapPoiKind k) => k switch
        {
            MapPoiKind.Site => "场地",
            MapPoiKind.Cache => "藏宝",
            MapPoiKind.Camp => "补给营",
            MapPoiKind.Exit => "出口",
            MapPoiKind.Boss => "首领",
            MapPoiKind.Altar => "灵火坛",
            _ => k.ToString(),
        };

        /// <summary>
        /// 扫一个场景里的地点（编辑器写 LevelMeta、运行时没有 LevelMeta 时罗盘自己扫，共用这一份）：
        /// 场地、藏宝、灵火坛、补给营、首领（位置取首领场地中心）、出口；守军场地并进它守的藏宝点 / 灵火坛，不单列。按种类、物体名排序
        /// </summary>
        public static List<LevelPoi> Collect(Scene scene)
        {
            List<T> In<T>() where T : Component
            {
                var l = new List<T>();
                foreach (var c in FindObjectsByType<T>(FindObjectsInactive.Exclude))
                    if (c.gameObject.scene == scene) l.Add(c);
                l.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
                return l;
            }
            var list = new List<LevelPoi>();
            var caches = In<CachePOI>();
            var altars = In<SpiritAltar>();
            var guards = new HashSet<EncounterSite>();
            foreach (var c in caches)
                if (c.guard) guards.Add(c.guard);
            foreach (var a in altars)
                if (a.guard) guards.Add(a.guard);
            foreach (var s in In<EncounterSite>())
                if (!guards.Contains(s))
                    list.Add(new LevelPoi { kind = MapPoiKind.Site, name = s.title, position = s.transform.position, optional = s.optional, source = s });
            foreach (var c in caches)
                list.Add(new LevelPoi { kind = MapPoiKind.Cache, name = c.title, position = c.transform.position, optional = true, source = c });
            foreach (var a in altars)
                list.Add(new LevelPoi { kind = MapPoiKind.Altar, name = a.title, position = a.transform.position, source = a });
            foreach (var c in In<SupplyCamp>())
                list.Add(new LevelPoi { kind = MapPoiKind.Camp, name = string.IsNullOrEmpty(c.label) ? "补给营" : c.label, position = c.transform.position, optional = true, source = c });
            var arenas = In<BossArena>();
            foreach (var b in In<BossEncounter>())
            {
                BossArena arena = b.arena;
                if (!arena)
                    foreach (var a in arenas)
                        if (string.IsNullOrEmpty(a.bossId) || a.bossId == b.bossId)
                        {
                            arena = a;
                            break;
                        }
                if (!arena && arenas.Count > 0) arena = arenas[0];
                var def = Bosses.Get(b.bossId);
                list.Add(new LevelPoi
                {
                    kind = MapPoiKind.Boss, name = def != null && !string.IsNullOrEmpty(def.name) ? def.name : "首领",
                    position = arena ? arena.Center : b.transform.position, source = b,
                });
            }
            foreach (var e in In<ExitPortal>())
                list.Add(new LevelPoi { kind = MapPoiKind.Exit, name = "出口", position = e.transform.position, source = e });
            return list;
        }
    }
}
