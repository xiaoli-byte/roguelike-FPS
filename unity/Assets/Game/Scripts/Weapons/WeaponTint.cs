using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 武器元素着色（同 TS WeaponModels.buildGunModel 的「雕刻纹路发光：元素色，亮度随稀有度」）：
    /// 用 MaterialPropertyBlock 改枪模材质的 _EmissionColor，不复制材质。只改开了 _EMISSION 的材质（武器 M_Weapon_*），手臂等不受影响。
    /// 实例无元素时清掉属性块，恢复美术原样（TS 无元素时用稀有度色；这里保留美术的白色纹路，不改普通枪的观感）。
    /// 第一人称：<see cref="WeaponTintSystem"/> 在切枪时给当前 rig 着色。
    /// </summary>
    public static class WeaponTint
    {
        static readonly int EmissionColor = Shader.PropertyToID("_EmissionColor");
        static MaterialPropertyBlock block;

        /// <summary>元素色（同 TS ELEMENT_COLORS：#ff6a1f #6fd8ff #9dff4a）</summary>
        public static Color ElementColor(Element e) => e switch
        {
            Element.Fire => Hex.Rgb(0xff6a1f),
            Element.Shock => Hex.Rgb(0x6fd8ff),
            Element.Corrode => Hex.Rgb(0x9dff4a),
            _ => Hex.Rgb(0xfff1d6),
        };

        /// <summary>纹路发光强度（同 TS ART_GLOW：普通 0.5 → 传说 2.0），再乘美术材质的基准 1.6</summary>
        static readonly float[] Glow = { 0.5f, 0.8f, 1.1f, 1.5f, 2.0f };
        const float MaterialBase = 1.6f;

        /// <summary>HDR 发光色：元素色 × 稀有度亮度</summary>
        public static Color Emission(Element e, int rarity)
        {
            var c = ElementColor(e) * (Glow[Rarity.Clamp(rarity)] * MaterialBase);
            c.a = 1;
            return c;
        }

        /// <summary>给 root 下所有武器渲染器着色（element = None 时清除）</summary>
        public static void Apply(GameObject root, Element element, int rarity)
        {
            if (!root) return;
            block ??= new MaterialPropertyBlock();
            var color = Emission(element, rarity);
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
            {
                if (!IsWeaponRenderer(r)) continue;
                if (element == Element.None)
                {
                    r.SetPropertyBlock(null);
                    continue;
                }
                r.GetPropertyBlock(block);
                block.SetColor(EmissionColor, color);
                r.SetPropertyBlock(block);
            }
        }

        static bool IsWeaponRenderer(Renderer r)
        {
            if (r is ParticleSystemRenderer || r is TrailRenderer || r is LineRenderer) return false;
            var m = r.sharedMaterial;
            return m && m.HasProperty(EmissionColor) && m.IsKeywordEnabled("_EMISSION");
        }
    }
}
