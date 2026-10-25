using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>弹着点的地表材质：决定火花 / 尘土 / 碎屑的样子和弹孔贴花</summary>
    public enum SurfaceKind
    {
        /// <summary>石头、砖、夯土、木头（默认）：火花 + 灰尘 + 石屑，焦黑弹坑</summary>
        Stone,
        /// <summary>沙、松土、灰烬：一蓬沙土、几乎没有火花，浅坑</summary>
        Sand,
        /// <summary>冰、雪：冰碴 + 白色粉雾 + 亮晶晶的碎光，星状白裂纹</summary>
        Ice,
        /// <summary>金属（铜、铁、炉具）：大量明亮火花、没有尘土，亮擦痕 + 烧红的坑</summary>
        Metal,
    }

    /// <summary>手工指定碰撞体的地表材质（关卡构建器 / 测试场挂；优先于按名字猜）</summary>
    [DisallowMultipleComponent]
    public sealed class FxSurface : MonoBehaviour
    {
        public SurfaceKind kind = SurfaceKind.Stone;
    }

    /// <summary>
    /// 地表材质判定（FX1 弹着点按材质区分）：
    ///   1. 碰撞体或父物体上有 <see cref="FxSurface"/> → 用它；
    ///   2. 地形（TerrainCollider）→ 命中点处权重最大的地形层，按层名关键字（Sand / Packed / Ash / Soil → 沙，Ice / Snow → 冰，其余 → 石）；
    ///   3. 标签 Ice → 冰；
    ///   4. 物体名、材质名按关键字猜（Metal / Bronze / Iron / Anvil / Cauldron / Bell… → 金属；Ice / Frost / Snow / Glacier → 冰；Sand / Dune → 沙）；
    ///   5. 都没有 → 石。
    /// 非地形的结果按碰撞体缓存（同一个碰撞体只猜一次）。
    /// </summary>
    public static class Surfaces
    {
        static readonly Dictionary<Collider, SurfaceKind> cache = new();
        static readonly Dictionary<TerrainData, SurfaceKind[]> terrainLayers = new();

        static readonly string[] MetalWords =
        {
            "metal", "bronze", "iron", "steel", "copper", "brass", "anvil", "cauldron", "gong", "chain", "gear", "cannon",
            "slagcart", "hoist", "furnace", "crucible",
        };

        static readonly string[] IceWords = { "ice", "frost", "snow", "glacier", "frozen", "icicle", "crystal" };
        /// <summary>砂岩、碎石这类名字里带沙但其实是石头的，先按石头认</summary>
        static readonly string[] StoneWords = { "stone", "rock", "brick", "cliff", "wall", "basalt", "gravel" };
        static readonly string[] SandWords = { "sand", "dune", "ash", "soil", "packed", "dirt", "mud" };

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            cache.Clear();
            terrainLayers.Clear();
        }

        /// <summary>换关时清缓存（碰撞体的实例 id 不会复用，但缓存会一直长）</summary>
        public static void ClearCache()
        {
            cache.Clear();
            terrainLayers.Clear();
        }

        public static SurfaceKind Classify(in RaycastHit hit) => Classify(hit.collider, hit.point);

        public static SurfaceKind Classify(Collider c, Vector3 point)
        {
            if (!c) return SurfaceKind.Stone;
            if (c is TerrainCollider tc) return TerrainKind(tc, point);
            if (cache.TryGetValue(c, out var k)) return k;
            k = Guess(c);
            if (cache.Count > 4096) cache.Clear();
            cache[c] = k;
            return k;
        }

        static SurfaceKind Guess(Collider c)
        {
            var explicitKind = c.GetComponentInParent<FxSurface>();
            if (explicitKind) return explicitKind.kind;
            if (c.CompareTag("Ice")) return SurfaceKind.Ice;
            // 名字：碰撞体所在物体往上找三层（Prefab 根的名字最有用）
            var t = c.transform;
            for (int i = 0; i < 4 && t; i++, t = t.parent)
            {
                var byName = FromWords(t.name);
                if (byName.HasValue) return byName.Value;
            }
            if (!c.TryGetComponent<Renderer>(out var r)) r = c.GetComponentInParent<Renderer>();
            if (r)
                foreach (var m in r.sharedMaterials)
                {
                    if (!m) continue;
                    var byMat = FromWords(m.name);
                    if (byMat.HasValue) return byMat.Value;
                }
            return SurfaceKind.Stone;
        }

        static SurfaceKind? FromWords(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            var s = name.ToLowerInvariant();
            if (Contains(s, MetalWords)) return SurfaceKind.Metal;
            if (Contains(s, IceWords)) return SurfaceKind.Ice;
            if (Contains(s, StoneWords)) return SurfaceKind.Stone;
            if (Contains(s, SandWords)) return SurfaceKind.Sand;
            return null;
        }

        static bool Contains(string s, string[] words)
        {
            foreach (var w in words)
                if (s.IndexOf(w, StringComparison.Ordinal) >= 0) return true;
            return false;
        }

        /// <summary>地形层名 → 地表（Desert Sand / Packed → 沙，Gravel / Rock → 石；Frost Ice / Snow → 冰；Inferno Ash → 沙）</summary>
        public static SurfaceKind LayerKind(string layerName)
        {
            // 层名是「主题 + 材质」（TL_FrostSoil、TL_DesertRock）：先去掉章节主题词，只看材质（冻土是土不是冰）
            var s = (layerName ?? "").ToLowerInvariant().Replace("desert", "").Replace("frost", "").Replace("inferno", "");
            if (Contains(s, IceWords)) return SurfaceKind.Ice;
            if (Contains(s, StoneWords)) return SurfaceKind.Stone;
            if (Contains(s, SandWords)) return SurfaceKind.Sand;
            if (Contains(s, MetalWords)) return SurfaceKind.Metal;
            return SurfaceKind.Stone;
        }

        static SurfaceKind TerrainKind(TerrainCollider tc, Vector3 point)
        {
            var data = tc.terrainData;
            if (!data || data.alphamapLayers == 0) return SurfaceKind.Sand;
            if (!terrainLayers.TryGetValue(data, out var kinds))
            {
                var layers = data.terrainLayers;
                kinds = new SurfaceKind[layers.Length];
                for (int i = 0; i < layers.Length; i++) kinds[i] = layers[i] ? LayerKind(layers[i].name) : SurfaceKind.Stone;
                terrainLayers[data] = kinds;
            }
            if (kinds.Length == 1) return kinds[0];
            var terrain = tc.GetComponent<Terrain>();
            var origin = terrain ? terrain.transform.position : tc.transform.position;
            var size = data.size;
            float u = Mathf.Clamp01((point.x - origin.x) / Mathf.Max(0.01f, size.x));
            float v = Mathf.Clamp01((point.z - origin.z) / Mathf.Max(0.01f, size.z));
            int res = data.alphamapResolution;
            int x = Mathf.Clamp(Mathf.FloorToInt(u * res), 0, res - 1), y = Mathf.Clamp(Mathf.FloorToInt(v * res), 0, res - 1);
            var w = data.GetAlphamaps(x, y, 1, 1);
            int best = 0;
            for (int i = 1; i < kinds.Length && i < w.GetLength(2); i++)
                if (w[0, 0, i] > w[0, 0, best]) best = i;
            return kinds[Mathf.Min(best, kinds.Length - 1)];
        }
    }
}
