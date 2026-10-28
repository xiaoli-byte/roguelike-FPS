using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 射击核心特效的资产（特效打磨 A 路，Resources/Fx/Shot，贴图由 scripts/unity/fx_shot_textures.py 生成）：
    ///   M_Fx_Hole（SF_FxHole：手绘弹孔 / 焦痕 + 法线）、T_Fx_MuzzleSet（枪口火焰形状集，套在第一人称火焰材质上）、M_Fx_Shell（弹壳：URP Particles/Lit 不透明，读顶点色）。
    /// 缺资产或着色器不可用时返回 null，调用方退回旧画法（贴花 SF_FxDecal 模式 0、单张枪口贴图、不抛壳）。
    /// </summary>
    public static class FxShotAssets
    {
        public const string Dir = "Fx/Shot";

        static Material hole, muzzle, shell;
        static bool holeTried, muzzleTried, shellTried;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            hole = muzzle = shell = null;
            holeTried = muzzleTried = shellTried = false;
        }

        /// <summary>弹孔 / 焦痕贴花材质（SF_FxHole）</summary>
        public static Material Hole
        {
            get
            {
                if (holeTried) return hole;
                holeTried = true;
                var m = Resources.Load<Material>($"{Dir}/M_Fx_Hole");
                hole = FxMaterials.Usable(m) && m.shader.name == "Spiritfire/FxHole" ? m : null;
                return hole;
            }
        }

        /// <summary>
        /// 第一人称枪口火焰材质（M_Fx_Muzzle 的副本，贴图换成形状集）；形状集缺失时为 null。
        /// 风格审查：混合从纯加法改成预乘（One / OneMinusSrcAlpha；形状集的 RGB 已经乘过覆盖，颜色的 RGB 由 MuzzleFlashes 再乘一次透明度）——
        /// 纯加法叠在亮沙、雪地上只剩一团白，预乘以后亮芯 / 主色 / 暗边三段色阶在任何地面上都看得出来。
        /// </summary>
        public static Material Muzzle
        {
            get
            {
                if (muzzleTried) return muzzle;
                muzzleTried = true;
                var tex = Resources.Load<Texture2D>($"{Dir}/T_Fx_MuzzleSet");
                var baseMat = FxMaterials.Muzzle;
                if (!tex || !baseMat) return null;
                muzzle = new Material(baseMat) { name = "M_Fx_MuzzleSet (runtime)", hideFlags = HideFlags.DontSave };
                if (muzzle.HasProperty("_BaseMap")) muzzle.SetTexture("_BaseMap", tex);
                if (muzzle.HasProperty("_MainTex")) muzzle.SetTexture("_MainTex", tex);
                muzzle.SetFloat("_Blend", 1);
                muzzle.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.One);
                muzzle.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                muzzle.SetFloat("_SrcBlendAlpha", (float)UnityEngine.Rendering.BlendMode.One);
                muzzle.SetFloat("_DstBlendAlpha", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                return muzzle;
            }
        }

        /// <summary>枪口火焰用的是预乘的形状集材质（<see cref="Muzzle"/>）：颜色要按预乘写（RGB × 透明度）</summary>
        public static bool MuzzlePremultiplied => Muzzle;

        /// <summary>弹壳材质</summary>
        public static Material Shell
        {
            get
            {
                if (shellTried) return shell;
                shellTried = true;
                var m = Resources.Load<Material>($"{Dir}/M_Fx_Shell");
                shell = FxMaterials.Usable(m) ? m : null;
                return shell;
            }
        }
    }
}
