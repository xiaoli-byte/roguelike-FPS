using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>外观每帧的动作（同 TS ProjectileView.animate 的分支，另加 Unity 新造型）</summary>
    public enum ProjectileMotion { Orb, Bolt, Shard, Flame, Arrow, Rocket, Grenade, Lantern, Feather, Spear, Chunk }

    /// <summary>点缀光的取色：原色 / 向暖白混（尾焰、火苗）/ 向白混（榴弹闪灯）</summary>
    public enum AccentTint { Plain, Warm, White }

    /// <summary>
    /// 一种投射物外观的配方：怎么搭（build）、怎么动（motion）、多大（尺寸规则）、拖尾挂哪儿。
    /// 尺寸（同 TS viewSize）：refRadius &gt; 0 = 以米建模（箭、火箭、榴弹…），size = scale × clamp(半径 / refRadius, minK, maxK)，碰撞半径大时模型不至于夸张；
    /// refRadius = 0 = 以「投射物半径」为单位建模（光球、弩矢、火苗…），size = max(0.04, 半径) × scale。
    /// </summary>
    public sealed class ProjectileVisualRecipe
    {
        public string id;
        public ProjectileMotion motion;
        public float refRadius, minK = 1, maxK = 1;
        /// <summary>拖尾挂点在中心后方多远（× size）</summary>
        public float tailOffset;
        /// <summary>根节点朝飞行方向（光球、榴弹、灯、岩块不转，靠 spin 层翻滚）</summary>
        public bool orient = true;
        /// <summary>内核向白色混的比例、光层不透明度、光晕大小（× size）、点缀光长度系数</summary>
        public float coreWhiten = 0.45f, glowOpacity = 0.5f, haloScale = 3f, accentLen = 1f;
        public AccentTint accentTint;
        /// <summary>搭部件：调 <see cref="ProjectileView.AddCore"/> / AddGlow / AddAccent / AddSolid / AddShaft / AddHalo（部件挂在 Spin 下）</summary>
        public Action<ProjectileView> build;

        public float ViewSize(float radius, float scale)
        {
            scale = Mathf.Max(0.05f, float.IsFinite(scale) ? scale : 1f);
            return refRadius > 0 ? scale * Mathf.Clamp(radius / refRadius, minK, maxK) : Mathf.Max(0.04f, radius) * scale;
        }
    }

    /// <summary>
    /// 投射物外观注册表（按 <see cref="ProjectileSpec.visual"/> 的 id 取）：内置 11 种程序造型
    /// grenade / orb / rocket / arrow / flame / lantern / bolt / feather / quill / spear / chunk（另有 TS 的 shard），
    /// 正式美术接入时用 <see cref="Register"/> 覆盖同名配方即可，发射方不用改。每种外观各一个对象池。
    /// 未知 id 回退到 orb。
    /// </summary>
    public static class ProjectileVisuals
    {
        public const string Fallback = "orb";

        static readonly Dictionary<string, ProjectileVisualRecipe> recipes = new();
        static readonly Dictionary<string, Stack<ProjectileView>> pools = new();
        static readonly List<ProjectileView> all = new();

        static readonly Color Metal = new(0.173f, 0.184f, 0.212f);
        static readonly Color Lacquer = new(0.32f, 0.12f, 0.08f);
        static readonly Color RockDark = new(0.3f, 0.26f, 0.21f), RockLight = new(0.42f, 0.35f, 0.27f);

        static ProjectileVisuals()
        {
            RegisterBuiltins();
            ProjectilePools.OnClear(ClearPools);
        }

        /// <summary>已注册的外观 id</summary>
        public static IEnumerable<string> Ids => recipes.Keys;

        public static bool Has(string id) => id != null && recipes.ContainsKey(id);

        /// <summary>登记 / 覆盖一种外观（覆盖时旧外观的池作废，正在飞的照常用完）</summary>
        public static void Register(ProjectileVisualRecipe recipe)
        {
            if (recipe == null || string.IsNullOrEmpty(recipe.id)) throw new ArgumentException("投射物外观缺少 id");
            recipes[recipe.id] = recipe;
            pools.Remove(recipe.id);
        }

        /// <summary>取配方；未知 id 回退到 orb</summary>
        public static ProjectileVisualRecipe Get(string id) =>
            id != null && recipes.TryGetValue(id, out var r) ? r : recipes[Fallback];

        /// <summary>外观整体缩放（见 <see cref="ProjectileVisualRecipe"/> 的尺寸规则）</summary>
        public static float ViewSize(string id, float radius, float scale) => Get(id).ViewSize(radius, scale);

        /// <summary>拖尾挂点在中心后方的距离（× size）</summary>
        public static float TailOffset(string id) => Get(id).tailOffset;

        /// <summary>从对象池取一个外观（池空时新建）；用完调 <see cref="ProjectileView.Release"/></summary>
        public static ProjectileView Acquire(string id)
        {
            var recipe = Get(id);
            if (!pools.TryGetValue(recipe.id, out var pool)) pools[recipe.id] = pool = new Stack<ProjectileView>();
            while (pool.Count > 0)
            {
                var v = pool.Pop();
                if (!v || v.Recipe != recipe) continue;
                v.gameObject.SetActive(true);
                return v;
            }
            var go = new GameObject("PV_" + recipe.id);
            go.transform.SetParent(ProjectilePools.Root, false);
            var view = go.AddComponent<ProjectileView>();
            view.Build(recipe, pool);
            if (all.Count >= 256) all.RemoveAll(x => !x); // 换场景后留下的空引用
            all.Add(view);
            return view;
        }

        /// <summary>预热：每种外观先建 perKind 个放进池里（换关黑幕中调用，避免第一次开火时搭部件）</summary>
        public static void WarmUp(int perKind = 1)
        {
            var tmp = new List<ProjectileView>();
            foreach (var id in recipes.Keys)
                for (int i = 0; i < perKind; i++)
                    tmp.Add(Acquire(id));
            foreach (var v in tmp) v.ForceRecycle();
        }

        static void ClearPools()
        {
            for (int i = 0; i < all.Count; i++)
                if (all[i] && all[i].InUse)
                    all[i].ForceRecycle();
            all.Clear();
            pools.Clear();
        }

        // ───────────── 内置造型（数值照抄 TS ProjectileVisuals.build，Unity 新增的几种另注）─────────────

        static void RegisterBuiltins()
        {
            Vector3 S(float k) => Vector3.one * k;
            Vector3 V(float x, float y, float z) => new(x, y, z);

            Register(new ProjectileVisualRecipe
            {
                id = "orb", motion = ProjectileMotion.Orb, orient = false, coreWhiten = 0.55f, glowOpacity = 0.5f, haloScale = 4.2f,
                build = v =>
                {
                    v.AddCore(ProjectileMeshes.Sphere, S(0.55f));
                    v.AddGlow(ProjectileMeshes.SphereLow, S(1f));
                    v.AddHalo();
                },
            });
            Register(new ProjectileVisualRecipe
            {
                id = "bolt", motion = ProjectileMotion.Bolt, glowOpacity = 0.55f, haloScale = 3.4f,
                build = v =>
                {
                    v.AddCore(ProjectileMeshes.Sphere, V(0.5f, 0.5f, 1.9f));
                    v.AddGlow(ProjectileMeshes.Octa, V(0.95f, 0.95f, 4.2f), V(0, 0, -1.1f));
                    v.AddHalo();
                },
            });
            Register(new ProjectileVisualRecipe
            {
                // TS 的 shard（弹幕类）：只用内核 + 光晕两次绘制
                id = "shard", motion = ProjectileMotion.Shard, coreWhiten = 0.5f, haloScale = 3.2f,
                build = v =>
                {
                    v.AddCore(ProjectileMeshes.Octa, V(0.55f, 0.55f, 2.2f));
                    v.AddHalo();
                },
            });
            Register(new ProjectileVisualRecipe
            {
                // Unity 新增：冰刺（狰 / 冰刺新星），比 shard 更细长、带一层冷光，自转
                id = "quill", motion = ProjectileMotion.Shard, coreWhiten = 0.55f, glowOpacity = 0.4f, haloScale = 2.6f,
                build = v =>
                {
                    v.AddCore(ProjectileMeshes.Octa, V(0.4f, 0.4f, 2.6f));
                    v.AddGlow(ProjectileMeshes.Octa, V(0.7f, 0.7f, 3.2f));
                    v.AddHalo();
                },
            });
            Register(new ProjectileVisualRecipe
            {
                id = "flame", motion = ProjectileMotion.Flame, coreWhiten = 0.35f, glowOpacity = 0.6f, haloScale = 3.2f, accentTint = AccentTint.Warm,
                build = v =>
                {
                    v.AddGlow(ProjectileMeshes.SphereLow, S(1f));
                    v.AddCore(ProjectileMeshes.SphereLow, S(0.5f));
                    v.AddAccent(ProjectileMeshes.SphereLow, V(0.7f, 0.7f, 1.1f), V(0, 0, -0.65f));
                    v.AddHalo();
                },
            });
            Register(new ProjectileVisualRecipe
            {
                id = "arrow", motion = ProjectileMotion.Arrow, refRadius = 0.1f, minK = 0.8f, maxK = 1.6f, tailOffset = 0.45f,
                coreWhiten = 0.35f, glowOpacity = 0.75f, haloScale = 0.55f, accentLen = 0.55f,
                build = v =>
                {
                    v.AddShaft(ProjectileMeshes.CylZThin, V(0.022f, 0.022f, 0.72f), V(0, 0, -0.1f));
                    v.AddCore(ProjectileMeshes.ConeZ, V(0.05f, 0.05f, 0.16f), V(0, 0, 0.33f));
                    v.AddGlow(ProjectileMeshes.Cross, V(0.12f, 0.12f, 0.16f), V(0, 0, -0.4f));
                    v.AddAccent(ProjectileMeshes.Octa, V(0.05f, 0.05f, 1f), V(0, 0, -0.3f));
                    v.AddHalo(0.3f);
                },
            });
            Register(new ProjectileVisualRecipe
            {
                id = "rocket", motion = ProjectileMotion.Rocket, refRadius = 0.14f, minK = 0.6f, maxK = 2f, tailOffset = 0.42f,
                coreWhiten = 0.3f, glowOpacity = 0.9f, haloScale = 0.8f, accentLen = 0.32f, accentTint = AccentTint.Warm,
                build = v =>
                {
                    v.AddSolid(ProjectileMeshes.CylZ, Metal, V(0.075f, 0.075f, 0.5f));
                    v.AddCore(ProjectileMeshes.ConeZ, V(0.075f, 0.075f, 0.16f), V(0, 0, 0.33f));
                    v.AddCore(ProjectileMeshes.CylZ, V(0.082f, 0.082f, 0.05f), V(0, 0, 0.12f));
                    for (int i = 0; i < 4; i++)
                    {
                        float a = i / 4f * Mathf.PI * 2;
                        v.AddSolid(ProjectileMeshes.Box, Metal, V(0.012f, 0.085f, 0.12f), V(Mathf.Sin(a) * -0.09f, Mathf.Cos(a) * 0.09f, -0.19f),
                            V(0, 0, a * Mathf.Rad2Deg));
                    }
                    v.AddGlow(ProjectileMeshes.SphereLow, S(0.1f), V(0, 0, -0.28f));
                    // 尾焰：尖端朝后的锥
                    v.AddAccent(ProjectileMeshes.ConeZ, V(0.065f, 0.065f, 1f), V(0, 0, -0.42f), V(0, 180, 0));
                    v.AddHalo(-0.3f);
                },
            });
            Register(new ProjectileVisualRecipe
            {
                id = "grenade", motion = ProjectileMotion.Grenade, orient = false, refRadius = 0.12f, minK = 0.7f, maxK = 2.2f,
                coreWhiten = 0.25f, haloScale = 0.55f, accentTint = AccentTint.White,
                build = v =>
                {
                    v.AddSolid(ProjectileMeshes.SphereLow, Metal, S(0.11f));
                    v.AddCore(ProjectileMeshes.Torus, S(0.112f));
                    v.AddSolid(ProjectileMeshes.CylZ, Metal, V(0.03f, 0.03f, 0.06f), V(0, 0.115f, 0), V(90, 0, 0));
                    v.AddAccent(ProjectileMeshes.SphereLow, S(0.035f), V(0, 0.155f, 0));
                    v.AddHalo();
                },
            });
            Register(new ProjectileVisualRecipe
            {
                // Unity 新增：蚀蛊灯的蛊灯（以半径为单位）：发光灯身 + 上下漆边，慢转、摇摆、上下浮动
                id = "lantern", motion = ProjectileMotion.Lantern, orient = false, coreWhiten = 0.45f, glowOpacity = 0.45f, haloScale = 4f,
                build = v =>
                {
                    v.AddCore(ProjectileMeshes.Sphere, V(0.55f, 0.68f, 0.55f));
                    v.AddSolid(ProjectileMeshes.Torus, Lacquer, S(0.42f), V(0, 0.6f, 0), V(90, 0, 0));
                    v.AddSolid(ProjectileMeshes.Torus, Lacquer, S(0.42f), V(0, -0.6f, 0), V(90, 0, 0));
                    v.AddGlow(ProjectileMeshes.SphereLow, V(0.9f, 1.05f, 0.9f));
                    v.AddHalo();
                },
            });
            Register(new ProjectileVisualRecipe
            {
                // Unity 新增：冰羽（青鸟）：羽杆 + 两片带夹角的羽面（不再是一张压扁的白片，侧面看也有厚度）+ 羽尖冰晶亮点 + 一层冷光，
                // 羽面保留发射方的冰蓝（不往白里混，白片在亮沙 / 雪地上像纸），沿飞行轴摆动
                id = "feather", motion = ProjectileMotion.Feather, refRadius = 0.12f, minK = 0.6f, maxK = 2.5f, tailOffset = 0.3f,
                coreWhiten = 0f, glowOpacity = 0.55f, haloScale = 0.8f, accentTint = AccentTint.White,
                build = v =>
                {
                    v.AddShaft(ProjectileMeshes.CylZThin, V(0.012f, 0.012f, 0.62f));
                    v.AddCore(ProjectileMeshes.Octa, V(0.06f, 0.022f, 0.3f), V(-0.03f, 0.008f, 0.04f), V(0, 0, -22));
                    v.AddCore(ProjectileMeshes.Octa, V(0.06f, 0.022f, 0.3f), V(0.03f, 0.008f, 0.04f), V(0, 0, 22));
                    v.AddAccent(ProjectileMeshes.Octa, V(0.035f, 0.035f, 0.11f), V(0, 0, 0.27f));
                    v.AddGlow(ProjectileMeshes.Octa, V(0.17f, 0.06f, 0.4f), V(0, 0, 0.05f));
                    v.AddHalo(0.25f);
                },
            });
            Register(new ProjectileVisualRecipe
            {
                // Unity 新增：投矛（鲛人骨矛）：长杆 + 扁矛头 + 矛头冷光
                id = "spear", motion = ProjectileMotion.Spear, refRadius = 0.14f, minK = 0.7f, maxK = 1.8f, tailOffset = 0.6f,
                coreWhiten = 0.5f, haloScale = 0.6f, accentLen = 0.5f,
                build = v =>
                {
                    v.AddShaft(ProjectileMeshes.CylZThin, V(0.028f, 0.028f, 1.3f), V(0, 0, -0.25f));
                    v.AddCore(ProjectileMeshes.Octa, V(0.06f, 0.03f, 0.24f), V(0, 0, 0.58f));
                    v.AddAccent(ProjectileMeshes.Octa, V(0.04f, 0.04f, 1f), V(0, 0, 0.4f));
                    v.AddHalo(0.55f);
                },
            });
            Register(new ProjectileVisualRecipe
            {
                // Unity 新增：岩块（首领 / 镇墓兽抛石）：两块错开的受光岩体 + 一层炽热光，翻滚
                id = "chunk", motion = ProjectileMotion.Chunk, orient = false, coreWhiten = 0.2f, glowOpacity = 0.25f, haloScale = 2.4f,
                build = v =>
                {
                    v.AddSolid(ProjectileMeshes.Box, RockDark, V(1.5f, 1.25f, 1.4f), default, V(12, 30, 8));
                    v.AddSolid(ProjectileMeshes.Box, RockLight, S(1f), V(0.35f, 0.3f, -0.2f), V(40, 10, 25));
                    v.AddGlow(ProjectileMeshes.SphereLow, S(1.6f));
                    v.AddHalo();
                },
            });
        }
    }
}
