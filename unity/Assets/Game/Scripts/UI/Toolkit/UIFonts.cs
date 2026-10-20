using System.Collections.Generic;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;
using UnityEngine.TextCore.Text;

namespace Spiritfire.Game
{
    /// <summary>字体角色（D18）：正文 Noto Sans SC、标题霞鹜文楷（子集改名 WenKai SF）、数字 Barlow Condensed</summary>
    public enum UIFontRole
    {
        Body,
        Title,
        Number,
    }

    /// <summary>
    /// 打包字体（docs/unity-parity.md D18；子集由 scripts/unity/subset_fonts.py 生成，放在 Resources/UI/Fonts）。
    /// 系统字体在 Steam Deck / Linux 上是豆腐块，所以界面一律用这里的字体：
    ///   UI Toolkit 用 SDF 的 <see cref="FontAsset"/>（<see cref="Body"/> / <see cref="Title"/> / <see cref="Number"/>），
    ///   由编辑器 UIBuilder（bridge.sh ui）生成到 Resources/UI/Fonts/SDF，动态填充图集；
    ///   回退链 标题 / 数字 → 正文子集 → 正文余量（NotoSansSC-Regular-Ext*：原字体里子集之外的全部字），子集漏掉的字照样显示。
    ///   uGUI / TextMesh 用 <see cref="Legacy"/>（正文子集的 Font 资产，导入设置里同样带余量做回退）。
    /// 资产还没生成（新合入、没跑 bridge.sh ui）时运行时从 Font 现建 FontAsset 兜底，功能一样，只是每次进 Play 现建。
    /// USS 里按类名选字体：.sf-title / .sf-num（theme.uss 用 resource("UI/Fonts/SDF/Title") 引用）；正文是各层根元素的默认字体。
    /// </summary>
    public static class UIFonts
    {
        /// <summary>Resources 下的 TTF / OTF（Font 资产）目录与 SDF 字体资产目录</summary>
        public const string FontsFolder = "UI/Fonts", SdfFolder = "UI/Fonts/SDF";
        /// <summary>子集文件名（不带扩展名，= Resources 里的 Font 资产名）</summary>
        public const string BodyFile = "NotoSansSC-Regular", BodyExtPrefix = "NotoSansSC-Regular-Ext", TitleFile = "WenKaiSF-Medium", NumberFile = "BarlowCondensed-SemiBold";
        /// <summary>SDF 字体资产名：Body / BodyExt（余量切成几份时 BodyExt、BodyExt2…）/ Title / Number</summary>
        public const string BodyAsset = "Body", BodyExtAsset = "BodyExt", TitleAsset = "Title", NumberAsset = "Number";

        /// <summary>一种字体的 SDF 参数：采样字号、边距、图集尺寸、行高（× 字号；中文正文 1.5，与 Three.js 的 line-height 一致）</summary>
        public readonly struct Spec
        {
            public readonly int samplingPointSize, padding, atlasSize;
            public readonly float lineHeight;

            public Spec(int samplingPointSize, int padding, int atlasSize, float lineHeight)
            {
                this.samplingPointSize = samplingPointSize;
                this.padding = padding;
                this.atlasSize = atlasSize;
                this.lineHeight = lineHeight;
            }
        }

        /// <summary>
        /// 采样 64 / 边距 8（≈12%，够描边和投影用）；中文字多，图集 2048 + 多图集（一张约 600 字）；数字字体字少，1024。
        /// 行高：正文 1.5、标题 1.3、数字 1.15
        /// </summary>
        public static Spec SpecOf(UIFontRole role) => role switch
        {
            UIFontRole.Title => new Spec(64, 8, 2048, 1.3f),
            UIFontRole.Number => new Spec(64, 8, 1024, 1.15f),
            _ => new Spec(64, 8, 2048, 1.5f),
        };

        static bool loaded, runtimeBuilt;
        static FontAsset body, title, number;
        static readonly List<FontAsset> bodyExt = new();
        static readonly List<FontAsset> created = new();
        static Font legacy;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            foreach (var fa in created)
                if (fa) Object.Destroy(fa);
            created.Clear();
            bodyExt.Clear();
            body = title = number = null;
            legacy = null;
            loaded = runtimeBuilt = false;
        }

        /// <summary>正文（SDF）。拿不到（字体文件都不在）时为 null，界面用 PanelTextSettings 的默认字体</summary>
        public static FontAsset Body
        {
            get
            {
                Ensure();
                return body;
            }
        }

        /// <summary>标题（霞鹜文楷子集）；缺失时退回正文</summary>
        public static FontAsset Title
        {
            get
            {
                Ensure();
                return title ? title : body;
            }
        }

        /// <summary>数字（Barlow Condensed）；缺失时退回正文</summary>
        public static FontAsset Number
        {
            get
            {
                Ensure();
                return number ? number : body;
            }
        }

        /// <summary>正文余量（动态回退）</summary>
        public static IReadOnlyList<FontAsset> BodyExt
        {
            get
            {
                Ensure();
                return bodyExt;
            }
        }

        public static FontAsset Get(UIFontRole role) => role switch
        {
            UIFontRole.Title => Title,
            UIFontRole.Number => Number,
            _ => Body,
        };

        /// <summary>SDF 字体是运行时现建的（UIBuilder 还没生成资产）</summary>
        public static bool RuntimeFallback
        {
            get
            {
                Ensure();
                return runtimeBuilt;
            }
        }

        /// <summary>uGUI Text / TextMesh 用的正文字体（Font 资产，动态）；没有打包字体时为 null（调用方自己退回系统字体）</summary>
        public static Font Legacy
        {
            get
            {
                if (!legacy) legacy = Resources.Load<Font>(FontsFolder + "/" + BodyFile);
                return legacy;
            }
        }

        /// <summary>预先生成一批字形（打开字多的界面前调用，避免第一次显示时现生成卡一下）</summary>
        public static void Warmup(string characters, UIFontRole role = UIFontRole.Body)
        {
            var fa = Get(role);
            if (fa && !string.IsNullOrEmpty(characters)) fa.TryAddCharacters(characters);
        }

        static void Ensure()
        {
            if (loaded) return;
            loaded = true;
            body = Resources.Load<FontAsset>(SdfFolder + "/" + BodyAsset);
            if (body)
            {
                title = Resources.Load<FontAsset>(SdfFolder + "/" + TitleAsset);
                number = Resources.Load<FontAsset>(SdfFolder + "/" + NumberAsset);
                for (int i = 1; i < 16; i++)
                {
                    var ext = Resources.Load<FontAsset>(SdfFolder + "/" + BodyExtAsset + (i == 1 ? "" : i.ToString()));
                    if (!ext) break;
                    bodyExt.Add(ext);
                }
                return;
            }
            // 兜底：UIBuilder 还没跑，从 Font 现建（回退链也现连）
            var bodyFont = Resources.Load<Font>(FontsFolder + "/" + BodyFile);
            if (!bodyFont)
            {
                Debug.LogWarning("[UI] Resources/UI/Fonts 里没有打包字体（先跑 scripts/unity/subset_fonts.py），中文可能显示成方块");
                return;
            }
            runtimeBuilt = true;
            body = Track(Create(bodyFont, UIFontRole.Body));
            foreach (var f in ExtFonts()) bodyExt.Add(Track(Create(f, UIFontRole.Body)));
            var titleFont = Resources.Load<Font>(FontsFolder + "/" + TitleFile);
            if (titleFont) title = Track(Create(titleFont, UIFontRole.Title));
            var numberFont = Resources.Load<Font>(FontsFolder + "/" + NumberFile);
            if (numberFont) number = Track(Create(numberFont, UIFontRole.Number));
            Link(body, bodyExt, title, number);
            Debug.Log("[UI] SDF 字体资产还没生成（bash scripts/unity/bridge.sh ui），本次运行时现建");
        }

        static FontAsset Track(FontAsset fa)
        {
            if (fa) created.Add(fa);
            return fa;
        }

        /// <summary>Resources/UI/Fonts 里的余量字体，按名字排（NotoSansSC-Regular-Ext、-Ext2…；切成几份时 -Ext1、-Ext2…）</summary>
        public static List<Font> ExtFonts()
        {
            var list = new List<Font>();
            foreach (var f in Resources.LoadAll<Font>(FontsFolder))
                if (f && f.name.StartsWith(BodyExtPrefix)) list.Add(f);
            list.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
            return list;
        }

        /// <summary>从 Font 建一个动态 SDF 字体资产，按角色设采样参数和行高（UIBuilder 也用它）</summary>
        public static FontAsset Create(Font font, UIFontRole role)
        {
            if (!font) return null;
            var s = SpecOf(role);
            var fa = FontAsset.CreateFontAsset(font, s.samplingPointSize, s.padding, GlyphRenderMode.SDFAA, s.atlasSize, s.atlasSize, AtlasPopulationMode.Dynamic, true);
            if (!fa) return null;
            fa.name = font.name + " SDF";
            ApplyLineHeight(fa, s.lineHeight);
            return fa;
        }

        /// <summary>行高 = 系数 × 字号（字体自带的行距：Noto 约 1.45，Barlow 约 1.2）</summary>
        public static void ApplyLineHeight(FontAsset fa, float factor)
        {
            if (!fa || factor <= 0) return;
            var fi = fa.faceInfo;
            if (fi.pointSize <= 0) return;
            fi.lineHeight = fi.pointSize * factor;
            fa.faceInfo = fi;
        }

        /// <summary>回退链：正文 → 余量；标题 / 数字 → 正文 → 余量</summary>
        public static void Link(FontAsset bodyAsset, IReadOnlyList<FontAsset> ext, FontAsset titleAsset, FontAsset numberAsset)
        {
            if (!bodyAsset) return;
            bodyAsset.fallbackFontAssetTable = new List<FontAsset>(ext);
            foreach (var fa in new[] { titleAsset, numberAsset })
            {
                if (!fa) continue;
                var chain = new List<FontAsset> { bodyAsset };
                chain.AddRange(ext);
                fa.fallbackFontAssetTable = chain;
            }
        }
    }
}
