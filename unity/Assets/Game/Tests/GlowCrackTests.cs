using NUnit.Framework;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 第二批收尾 C 路的资产与配色（docs/art/vfx/glow-masks-crack-ch3.md）：
    ///   · 发光遮罩：旱魃本体 / 日轮 / 魔将大剑的 _E 都在 Resources/Fx/GlowMasks、按线性导入；旱魃两张登记了配色，强度公式在平时 / 日蚀 / 复燃下的走向对；
    ///   · 方形裂纹：材质在 Resources/Fx/Materials/M_Fx_CrackCh3，着色器是 Spiritfire/FxCrack、能用，贴图挂上、按线性导入。
    /// </summary>
    public sealed class GlowCrackTests
    {
        [TestCase("T_Boss_Hanba", 2048)]
        [TestCase("T_BossPart_HanbaSunRing", 1024)]
        [TestCase("T_BossWeapon_Greatsword", 1024)]
        public void BossGlowMasks_Exist(string key, int size)
        {
            var t = GlowMask.LoadMask(key);
            Assert.IsTrue(t, $"缺 {GlowMask.ResourcesDir}/{key}_E（art/pipeline/tools/emission_mask.py）");
            Assert.AreEqual(size, t.width, $"{key}_E 的尺寸");
            Assert.IsTrue(t.isDataSRGB == false, $"{key}_E 要按线性导入（遮罩是数据）");
        }

        [Test]
        public void HanbaGlowProfiles_Registered()
        {
            Assert.IsTrue(GlowMask.Profiles.ContainsKey("T_Boss_Hanba"), "旱魃本体没有登记配色");
            Assert.IsTrue(GlowMask.Profiles.ContainsKey("T_BossPart_HanbaSunRing"), "日轮没有登记配色");
            // 大剑由 WarlordBlade 自己写，不进 GlowMask 的表（否则挂到魔将身上会两边抢同一组属性）
            Assert.IsFalse(GlowMask.Profiles.ContainsKey(WarlordBlade.MaskKey), "魔将大剑不该登记在 GlowMask 里");
        }

        [Test]
        public void CrackCh3Material_IsUsable()
        {
            var m = Resources.Load<Material>($"{FxMaterials.ResourcesDir}/{CrackDecals.MaterialName}");
            Assert.IsTrue(m, $"缺材质 {FxMaterials.ResourcesDir}/{CrackDecals.MaterialName}");
            Assert.AreEqual("Spiritfire/FxCrack", m.shader.name);
            Assert.IsTrue(FxMaterials.Usable(m), "着色器不可用（编译错误？）");
            var tex = m.GetTexture("_CrackMap") as Texture2D;
            Assert.IsTrue(tex, "裂纹贴图没挂上（T_Fx_CrackCh3，scripts/unity/fx_crack_ch3.py）");
            Assert.IsFalse(tex.isDataSRGB, "裂纹贴图要按线性导入");
            Assert.AreEqual(1024, tex.width);
        }
    }
}
