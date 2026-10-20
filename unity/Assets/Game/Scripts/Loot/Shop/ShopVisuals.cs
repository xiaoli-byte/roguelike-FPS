using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 商店的占位体块（4.11：美术缺失时程序方块，换正式资产不改代码）：漆木摊桌（顶棚按商品色）、铁砧 + 符文环、药瓶、弹药箱、卷轴，以及头顶的价格牌（TextMesh，朝相机）。
    /// 摊位有美术 Prefab（MarketStall / ForgeStall / PrayerTent，由关卡构建器填进 <see cref="Shop.stallArt"/> / <see cref="Shop.benchArt"/>）时只摆展示物，桌子用美术
    /// </summary>
    static class ShopVisuals
    {
        static readonly Color Wood = Hex.Rgb(0x6b4128), Cloth = Hex.Rgb(0xd9c39a), Iron = Hex.Rgb(0x3d4148), Bronze = Hex.Rgb(0xc79a4a);
        static Font font;

        /// <summary>摊桌：桌面 1.24 × 0.86 × 1.24 m、四根立柱、商品色顶棚</summary>
        public static void Stall(Transform root, Color accent)
        {
            PropBits.Box(root, "Counter", new Vector3(0, 0.43f, 0), new Vector3(1.24f, 0.86f, 1.0f), Wood);
            PropBits.Box(root, "CounterTop", new Vector3(0, 0.88f, 0), new Vector3(1.34f, 0.06f, 1.1f), Cloth);
            PropBits.Box(root, "Trim", new Vector3(0, 0.6f, 0.51f), new Vector3(1.26f, 0.12f, 0.02f), accent);
            foreach (float x in new[] { -0.62f, 0.62f })
                PropBits.Box(root, "Post", new Vector3(x, 1.25f, -0.45f), new Vector3(0.08f, 2.5f, 0.08f), Wood);
            PropBits.Box(root, "Canopy", new Vector3(0, 2.45f, -0.05f), new Vector3(1.6f, 0.08f, 1.3f), Color.Lerp(accent, Cloth, 0.35f)).transform.localRotation =
                Quaternion.Euler(-12f, 0, 0);
        }

        /// <summary>强化台：石座 + 铁砧 + 悬浮的符文环（返回符文环，供转动）</summary>
        public static Transform Anvil(Transform root)
        {
            PropBits.Box(root, "Plinth", new Vector3(0, 0.25f, 0), new Vector3(1.0f, 0.5f, 0.8f), Hex.Rgb(0x6f6a64));
            PropBits.Box(root, "Anvil", new Vector3(0, 0.68f, 0), new Vector3(0.9f, 0.36f, 0.42f), Iron);
            PropBits.Box(root, "Horn", new Vector3(0.55f, 0.74f, 0), new Vector3(0.3f, 0.18f, 0.22f), Iron);
            return Rune(root);
        }

        /// <summary>强化台的符文环 + 光晕 + 光柱（美术铁砧上也叠这一层，返回符文环供转动）</summary>
        public static Transform Rune(Transform root)
        {
            var rune = new GameObject("Rune").transform;
            rune.SetParent(root, false);
            rune.localPosition = new Vector3(0, 1.45f, 0);
            for (int i = 0; i < 8; i++)
            {
                float a = i * Mathf.PI / 4;
                var r = PropBits.Box(rune, "Glyph", new Vector3(Mathf.Sin(a) * 0.45f, Mathf.Cos(a) * 0.45f, 0), new Vector3(0.12f, 0.05f, 0.02f), UpgradeOffer.Blue);
                r.transform.localRotation = Quaternion.Euler(0, 0, -a * Mathf.Rad2Deg);
                r.sharedMaterial = FxMaterials.Unlit;
                FxMaterials.Tint(r, UpgradeOffer.Blue * 1.5f);
            }
            FxMaterials.GlowSprite(rune, 1.4f, new Color(0.43f, 0.72f, 1f, 0.45f));
            FxMaterials.BeamSprite(root, 0.9f, 3.2f, new Color(0.43f, 0.72f, 1f, 0.25f));
            return rune;
        }

        public static void Potion(Transform display)
        {
            PropBits.Cylinder(display, "Flask", Vector3.zero, new Vector3(0.24f, 0.3f, 0.24f), PotionOffer.Pink);
            PropBits.Cylinder(display, "Neck", new Vector3(0, 0.2f, 0), new Vector3(0.09f, 0.12f, 0.09f), Hex.Rgb(0xffd0d6));
            PropBits.Cylinder(display, "Cork", new Vector3(0, 0.28f, 0), new Vector3(0.1f, 0.05f, 0.1f), Wood);
            FxMaterials.GlowSprite(display, 0.8f, new Color(1f, 0.4f, 0.45f, 0.4f));
        }

        public static void AmmoCrate(Transform display)
        {
            PropBits.Box(display, "Crate", Vector3.zero, new Vector3(0.5f, 0.28f, 0.34f), Hex.Rgb(0x5d5a3a));
            PropBits.Box(display, "Band", new Vector3(0, 0, 0.175f), new Vector3(0.52f, 0.06f, 0.01f), AmmoOffer.Gold);
            for (int i = 0; i < 4; i++)
                PropBits.Cylinder(display, "Round", new Vector3(-0.15f + i * 0.1f, 0.2f, 0), new Vector3(0.04f, 0.14f, 0.04f), Bronze);
        }

        public static void Scroll(Transform display, Color rarity)
        {
            var body = PropBits.Cylinder(display, "Scroll", Vector3.zero, new Vector3(0.14f, 0.46f, 0.14f), Hex.Rgb(0xe8d9b0));
            body.transform.localRotation = Quaternion.Euler(0, 0, 90);
            foreach (float x in new[] { -0.26f, 0.26f })
                PropBits.Cylinder(display, "Cap", new Vector3(x, 0, 0), new Vector3(0.18f, 0.06f, 0.18f), rarity).transform.localRotation = Quaternion.Euler(0, 0, 90);
            PropBits.Box(display, "Seal", new Vector3(0, 0, 0.08f), new Vector3(0.1f, 0.1f, 0.02f), rarity);
            FxMaterials.GlowSprite(display, 0.9f, new Color(rarity.r, rarity.g, rarity.b, 0.45f));
        }

        /// <summary>武器：枪模（掉落同款缩放、元素纹路、居中）+ 稀有度光晕；没有枪模时一根方条</summary>
        public static void Weapon(Transform display, WeaponInstance w)
        {
            var prefab = w?.def != null ? LootCatalog.WeaponModel(w.def.prefab) : null;
            if (prefab)
            {
                var inst = Object.Instantiate(prefab, display, false);
                inst.transform.localScale *= w.def.worldScale;
                foreach (var c in inst.GetComponentsInChildren<Collider>(true)) Object.Destroy(c);
                foreach (var a in inst.GetComponentsInChildren<Animator>(true)) a.enabled = false;
                WeaponTint.Apply(inst, w.element, w.rarity);
                var rs = inst.GetComponentsInChildren<Renderer>();
                if (rs.Length > 0)
                {
                    var b = rs[0].bounds;
                    foreach (var r in rs) b.Encapsulate(r.bounds);
                    inst.transform.position -= b.center - display.position;
                }
            }
            else PropBits.Box(display, "Weapon", Vector3.zero, new Vector3(0.12f, 0.2f, 0.6f), Iron);
            var col = w != null ? Rarity.Color(w.rarity) : Color.white;
            FxMaterials.GlowSprite(display, 1.3f, new Color(col.r, col.g, col.b, 0.35f));
        }

        /// <summary>美术摊位：实例化后去掉碰撞体，按渲染包围盒缩放到宽 ≈ width 米、脚底贴地</summary>
        public static GameObject Art(GameObject prefab, Transform parent, float width)
        {
            if (!prefab) return null;
            var inst = Object.Instantiate(prefab, parent, false);
            inst.name = "Model";
            foreach (var c in inst.GetComponentsInChildren<Collider>(true)) Object.Destroy(c);
            var rs = inst.GetComponentsInChildren<Renderer>();
            if (rs.Length == 0) return inst;
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            float w = Mathf.Max(b.size.x, b.size.z);
            if (w > 0.05f) inst.transform.localScale *= width / w;
            b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            inst.transform.position += Vector3.up * (parent.position.y - b.min.y);
            return inst;
        }

        /// <summary>价格牌：两行（标题 / 价格或说明），朝相机。字体用打包的正文字体（没有时退回系统字体）</summary>
        public static TextMesh Tag(Transform parent, Vector3 local, float height)
        {
            if (!font) font = UIFonts.Legacy;
            if (!font) font = Font.CreateDynamicFontFromOSFont(new[] { "Microsoft YaHei UI", "Microsoft YaHei", "SimHei", "Noto Sans CJK SC", "Arial" }, 64);
            var go = new GameObject("Price Tag");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = local;
            var tm = go.AddComponent<TextMesh>();
            tm.font = font;
            tm.fontSize = 64;
            tm.characterSize = height / 6.4f;
            tm.anchor = TextAnchor.LowerCenter;
            tm.alignment = TextAlignment.Center;
            tm.richText = true;
            var mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = font.material;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
            go.AddComponent<Billboard>();
            return tm;
        }

        public static string Hex6(Color c) => ColorUtility.ToHtmlStringRGB(c);
    }
}
