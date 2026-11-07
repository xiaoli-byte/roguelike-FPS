using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 第三章（熔火 · 祝融火狱）共用的视觉定义：调色板、程序材质、点光色。归 L4。
    // 2026-11-04 美术清理（docs/art/review/ch3-v2/art-pass/）的色彩脚本：三块主色——暗紫玄武岩（岩、地，约七成）/ 铜褐（路面、铸铁件，约两成）/
    // 熔岩橙（只做强调：熔岩、火盆、焦点，约一成）。暖光只来自熔岩、铜器、火盆、引导灯；青金只给引导灯 / 灵火这类玩法提示。
    // 各关构建器的程序材质（铁、木、玄武岩、铜、白盒退路、熔岩光带）都从这里取，不在构建器里写死颜色——改这里，四张图重建时一起生效。
    // 资产名默认是 M_WB_Ch3*（3-1 以前就叫这个）；name 参数让已有的关沿用自己的资产名（3-2 的 ForgeIron、DeckPlate…），不留下没人引用的旧材质。
    public static partial class LevelKit
    {
        public static class InfernoPalette
        {
            // ── 暗紫玄武岩 ──
            /// <summary>程序石阶、井壁、喷口壳这类玄武岩件：和崖面同一种偏靛的暗紫灰</summary>
            public static readonly Color Basalt = new(0.23f, 0.21f, 0.28f);
            /// <summary>更暗的玄武岩（结壳、井底衬里、压在暗部的件）</summary>
            public static readonly Color BasaltDeep = new(0.15f, 0.13f, 0.19f);
            // ── 铜褐 ──
            /// <summary>铸铁：吊桥桥面、铁栏、坩埚、锻台铁件（暗，偏一点暖，和玄武岩分得开）</summary>
            public static readonly Color Iron = new(0.22f, 0.19f, 0.2f);
            /// <summary>铁甲板 / 桥板：人走的面，和地上的铜灰路面一样比岩亮一档</summary>
            public static readonly Color DeckPlate = new(0.33f, 0.27f, 0.24f);
            /// <summary>铜器（锣、铜饰）</summary>
            public static readonly Color Bronze = new(0.58f, 0.39f, 0.2f);
            /// <summary>焦木（吊台木件、锣架）</summary>
            public static readonly Color Wood = new(0.25f, 0.19f, 0.16f);
            /// <summary>可破坏木箱 / 货箱：比地面亮、偏暖，一眼看得出能打</summary>
            public static readonly Color Crate = new(0.45f, 0.3f, 0.19f);
            /// <summary>白盒退路（缺正式件时）：中性的暗紫灰，不刺眼</summary>
            public static readonly Color Placeholder = new(0.32f, 0.29f, 0.34f);
            // ── 熔岩橙（强调）──
            public static readonly Color GlowBase = new(1f, 0.5f, 0.2f);
            /// <summary>熔岩光带 / 锻台火口的自发光（HDR，过 Bloom 阈值）</summary>
            public static readonly Color GlowEmission = new(4f, 1.4f, 0.35f);
            /// <summary>灯笼 / 升降台灯这类小光源的自发光（比熔岩暗一档）</summary>
            public static readonly Color LampEmission = new(3f, 1.3f, 0.3f);
            /// <summary>熔岩、火口的点光色</summary>
            public static readonly Color FireLight = new(1f, 0.48f, 0.18f);
            /// <summary>灯、门洞的点光色（比熔岩偏黄一点）</summary>
            public static readonly Color LampLight = new(1f, 0.6f, 0.28f);
            // ── 光照 ──
            /// <summary>程序材质的暗部色（StylizedLit _ShadowTint）：暗部偏紫，不发黑</summary>
            public static readonly Color ShadowTint = new(0.56f, 0.5f, 0.8f);
        }

        /// <summary>
        /// 第三章各关构建器原来写死的光照 / 天气 / 熔岩渠参数（2026-11-07 3-4 美术收尾收进这里）：主光的颜色、强度、方位一律照
        /// <see cref="ShowcaseTheme.Inferno"/>，四面高壁的图只抬仰角（<see cref="Ch3RaiseSun"/>）；落灰风力按场地挡不挡风取一档
        /// </summary>
        public static class InfernoLight
        {
            /// <summary>火口里（3-4 祝融炉心）的主光仰角：主题的 38° 下殿内地面大半压在火口壁的影子里，抬到 55° 才照得到；暗部靠环境光和熔岩辉光</summary>
            public const float CraterSunPitch = 55f;
            /// <summary>落灰的基础风力（LevelKit.Weather）：开阔的图 0.25、风道 / 盆地 0.2、火口里 0.15（四面高壁挡风）</summary>
            public const float AshWindOpen = 0.25f, AshWindSheltered = 0.2f, AshWindCrater = 0.15f;
            /// <summary>窄熔岩渠（1–2 m 宽）岸边硬壳的宽度：共用 M_Lava 的硬壳从形状边缘往里 1.5 m，会把整条渠盖成黑壳</summary>
            public const float ChannelShoreWidth = 0.3f;
        }

        /// <summary>第三章点光的一档：射程（m）和强度；颜色是 <see cref="InfernoPalette.FireLight"/>（熔岩、火口）或 LampLight（灯、营地）</summary>
        public readonly struct Ch3PointGlow
        {
            public readonly float range, intensity;
            public Ch3PointGlow(float range, float intensity) { this.range = range; this.intensity = intensity; }
        }

        /// <summary>
        /// 第三章点光的几档（都不投影）。强度按「去色后不比怪亮」定（ch3-look.md 第三节「交战场地的光源」、composition.md 第 6 节）：
        /// 炉口、闸楼这种本身就发光的件，点光只补一圈地面上的暖色，不再把炉口照成白热
        /// </summary>
        public static class InfernoGlows
        {
            /// <summary>熔池 / 大片熔岩上方：照亮鼎底和柱脚</summary>
            public static readonly Ch3PointGlow Pool = new(22f, 4f);
            /// <summary>墙上的炉口（圆殿炉口墙段）：只补炉口前的地面</summary>
            public static readonly Ch3PointGlow Mouth = new(10f, 2f);
            /// <summary>独立的炉楼 / 闸楼炉口（② 熔流闸口）</summary>
            public static readonly Ch3PointGlow Furnace = new(16f, 2.5f);
            /// <summary>门洞里的炉火（山门）</summary>
            public static readonly Ch3PointGlow Gate = new(14f, 3f);
            /// <summary>一两座火坛（眺台）</summary>
            public static readonly Ch3PointGlow Altar = new(12f, 2.5f);
            /// <summary>洞里的金色灯（熔岩洞宝藏）</summary>
            public static readonly Ch3PointGlow Cave = new(10f, 2.5f);
            /// <summary>补给营的暖光（安静、范围大）</summary>
            public static readonly Ch3PointGlow Camp = new(18f, 2.2f);
        }

        /// <summary>四面高壁的图把主光抬到 pitch 度：颜色、强度、方位照主题（<see cref="ShowcaseSceneBuilder.BuildLighting"/> 之后调）</summary>
        public static void Ch3RaiseSun(ShowcaseTheme theme, float pitch)
        {
            if (RenderSettings.sun)
                RenderSettings.sun.transform.rotation = Quaternion.Euler(pitch, theme.sunEuler.y, theme.sunEuler.z);
        }

        /// <summary>摆一盏第三章点光（不投影）；color 缺省 = 熔岩火光</summary>
        public static Light Ch3PointLight(Transform parent, string name, Vector3 at, Ch3PointGlow glow, Color? color = null)
        {
            var l = new GameObject(name).AddComponent<Light>();
            l.transform.SetParent(parent, false);
            l.transform.position = at;
            l.type = LightType.Point;
            l.color = color ?? InfernoPalette.FireLight;
            l.range = glow.range;
            l.intensity = glow.intensity;
            l.shadows = LightShadows.None;
            return l;
        }

        /// <summary>
        /// 窄熔岩渠的熔岩面材质：共用 M_Lava 的副本（每次构建同步一遍），只把岸边硬壳收窄到 <see cref="InfernoLight.ChannelShoreWidth"/>。
        /// 存成 {dir}/M_{name}.mat（3-4 沿用原来的 M_Lava_Channel.mat）
        /// </summary>
        public static Material Ch3LavaChannel(string dir, string name = "Lava_Channel")
        {
            var src = LavaMaterial();
            if (!src) return null;
            string path = $"{dir}/M_{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (!mat)
            {
                mat = new Material(src) { name = $"M_{name}" };
                AssetDatabase.CreateAsset(mat, path);
            }
            else
            {
                mat.shader = src.shader;
                mat.CopyPropertiesFromMaterial(src);
            }
            if (mat.HasProperty("_ShoreWidth")) mat.SetFloat("_ShoreWidth", InfernoLight.ChannelShoreWidth);
            EditorUtility.SetDirty(mat);
            return mat;
        }

        /// <summary>
        /// 个别正式件的自发光再单独收（<see cref="ArtPrefabBuilder"/> 的 ApplyInfernoEnvLook 统一 ×0.6 之后）：炉口画成近白的黄白，
        /// 去色后比怪、比吊鼎还亮。scale 乘在 _EmissionColor 上，tint 把近白的遮罩染回熔岩橙。只动材质，底色 BC 和遮罩 T_*_E 都不重画，
        /// 之后底色调色清洗（texture_clean.py）重建件也照样生效
        /// </summary>
        public static readonly Dictionary<string, (float scale, Color tint)> InfernoGlowTrim = new()
        {
            // 3-4 圆殿 ±72° 两段炉口墙：炉口是一整块亮黄，比殿心的吊鼎还抢眼（×0.45 时去色后炉口均值 123、吊鼎 95，再收到 ×0.3）
            ["SM_Tripo_InfernoRoundHallFurnace"] = (0.3f, new Color(1f, 0.5f, 0.22f)),
            // 炉楼（3-4 ② 闸楼、展示广场角楼）：炉口遮罩是一片近白，读成白热
            ["SM_Tripo_InfernoFurnaceTower"] = (0.32f, new Color(1f, 0.42f, 0.16f)),
        };

        /// <summary>按 <see cref="InfernoGlowTrim"/> 收一件的自发光色（不在表里的件原样返回）</summary>
        public static Color InfernoGlowFor(string id, Color emission) =>
            !string.IsNullOrEmpty(id) && InfernoGlowTrim.TryGetValue(id, out var t) ? emission * t.tint * t.scale : emission;

        /// <summary>铸铁（吊桥桥面、铁栏、补给坩埚、锻台铁件）</summary>
        public static Material Ch3Iron(string dir, string name = "Ch3Iron") => Ch3Mat(dir, name, InfernoPalette.Iron, 0.6f);
        /// <summary>铁甲板 / 桥板（人走的面）</summary>
        public static Material Ch3Deck(string dir, string name = "Ch3Deck") => Ch3Mat(dir, name, InfernoPalette.DeckPlate, 0.8f);
        /// <summary>焦木</summary>
        public static Material Ch3Wood(string dir, string name = "Ch3Wood") => Ch3Mat(dir, name, InfernoPalette.Wood, 0.9f);
        /// <summary>可破坏木箱 / 货箱</summary>
        public static Material Ch3Crate(string dir, string name = "Ch3Crate") => Ch3Mat(dir, name, InfernoPalette.Crate, 0.9f);
        /// <summary>程序玄武岩件（石阶、井壁）</summary>
        public static Material Ch3Basalt(string dir, string name = "Ch3Basalt") => Ch3Mat(dir, name, InfernoPalette.Basalt, 0.9f);
        /// <summary>暗玄武岩（井底衬里、结壳）</summary>
        public static Material Ch3BasaltDeep(string dir, string name = "Ch3BasaltDeep") => Ch3Mat(dir, name, InfernoPalette.BasaltDeep, 0.95f);
        /// <summary>铜器</summary>
        public static Material Ch3Bronze(string dir, string name = "Ch3Bronze") => Ch3Mat(dir, name, InfernoPalette.Bronze, 0.4f);
        /// <summary>缺正式件时的白盒退路</summary>
        public static Material Ch3Placeholder(string dir, string name = "Ch3Placeholder") => Ch3Mat(dir, name, InfernoPalette.Placeholder, 0.85f);

        /// <summary>熔岩光带 / 火口（自发光，熔岩橙）；name 区分各关的用途（M_WB_&lt;name&gt;.mat）</summary>
        public static Material Ch3Glow(string dir, string name) => Ch3GlowMat(dir, name, InfernoPalette.GlowEmission);
        /// <summary>灯（自发光，比熔岩暗一档）</summary>
        public static Material Ch3Lamp(string dir, string name) => Ch3GlowMat(dir, name, InfernoPalette.LampEmission);

        /// <summary>第三章的程序材质：颜色、粗糙度、偏紫的暗部每次都写一遍（同名材质先被别处按旧颜色建过也会改回来）</summary>
        static Material Ch3Mat(string dir, string name, Color c, float roughness)
        {
            var m = Mat(dir, name, c, roughness);
            m.SetColor("_BaseColor", c);
            m.SetFloat("_Roughness", roughness);
            m.SetColor("_ShadowTint", InfernoPalette.ShadowTint);
            EditorUtility.SetDirty(m);
            return m;
        }

        /// <summary>
        /// 大片熔岩湖的暗壳材质：共用 M_Lava 的副本，开口熔流、缝宽、自发光再收一档——湖面读成暗色结壳加少量亮缝，
        /// 不和怪抢明度（composition.md 第 6、7 节：黑底亮缝的龟裂熔岩不铺在交战视线上、大面积熔岩用暗色结壳）。
        /// 岸边的接触亮边、涨潮预警照旧（着色器按深度 / _Agitation 画），危险还读得出。存成 {dir}/M_WB_{name}.mat
        /// </summary>
        public static Material Ch3LavaCrust(string dir, string name, float molten = 0.06f, float crack = 0.05f, float emission = 1.25f, float plateScale = 0.08f)
        {
            var src = LavaMaterial();
            if (!src) return null;
            var m = new Material(src) { name = $"M_WB_{name}" };
            m.SetFloat("_MoltenAmount", molten);
            m.SetFloat("_CrackWidth", crack);
            m.SetFloat("_Emission", emission);
            // 板块放大到十来米一块：开口少了以后壳面更多，板块小的话亮缝就织成一张网（龟裂熔岩），放大后视野里只剩几道缝；壳下透出的暗红再压一档
            m.SetFloat("_PlateScale", plateScale);
            m.SetColor("_DeepColor", new Color(0.22f, 0.025f, 0.008f));
            SaveAsset(m, $"{dir}/M_WB_{name}.mat");
            return m;
        }

        /// <summary>
        /// 交战场地里的青金引导灯压暗一档（灯球不比怪亮：composition.md 第 6 节「最高明度留给怪」）：灵火 / 焰心换成暗一档的材质，点光 ×0.4。
        /// 灯的名字、结构、位置不变（引导灯自查照旧数得到），远处看仍是青金色
        /// </summary>
        public static void DimGuideLamp(string dir, GameObject lamp)
        {
            if (!lamp) return;
            // 灯球离镜头几米时会占一大块画面：固有色和自发光都压到原来的三成上下，去色后是中间调，青色还在
            var flame = GlowMat(dir, "GuideLampFlameDim", new Color(0.08f, 0.24f, 0.22f), GuideCyan * 0.3f);
            var core = GlowMat(dir, "GuideLampCoreDim", new Color(0.3f, 0.25f, 0.13f), GuideGold * 0.35f);
            foreach (var r in lamp.GetComponentsInChildren<MeshRenderer>(true))
            {
                if (r.name == "Flame") r.sharedMaterial = flame;
                else if (r.name == "Flame Core") r.sharedMaterial = core;
            }
            foreach (var l in lamp.GetComponentsInChildren<Light>(true)) l.intensity *= 0.4f;
        }

        static Material Ch3GlowMat(string dir, string name, Color emission)
        {
            var m = Ch3Mat(dir, name, InfernoPalette.GlowBase, 0.92f);
            m.SetColor("_EmissionColor", emission);
            m.EnableKeyword("_EMISSION");
            EditorUtility.SetDirty(m);
            return m;
        }
    }
}
