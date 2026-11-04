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
