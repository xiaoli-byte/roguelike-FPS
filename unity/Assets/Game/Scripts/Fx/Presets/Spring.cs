using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 月牙泉的风格化水（特效打磨收尾一轮，旱魃：登场破泉、二阶段泉床喷泉、倒下时泉心喷水）。docs/art/fx-style.md §三「水」：风格化的涟漪圈、白沫块和水花团，
    /// 不追求写实流体，也不能是灰白（原来的汽柱是灰白半透明的圆筒，叠在亮沙上读成一根灰柱子）。颜色取 1-4 水面（SF_Water）的泉水色 + 白沫：
    ///   SpringSplash（水柱顶 / 破水）：白沫团（实心卡通团块，暗面蓝灰）+ 泉水色水珠 + 浅青的拉丝水花；
    ///   SpringFoot（水柱脚 / 泉床上）：一圈泉水色的水花团（贴地）+ 一道白沫涟漪圈 + 几颗水珠。
    /// 规模 s = 半径（米）。入口 <see cref="Fx.SpringSpout"/>、<see cref="Fx.SpringSplash"/>（Fx.Spring.cs）。
    /// </summary>
    [Defs(-97)]
    public sealed class FxSpringPresets : IDefSource<FxPreset>
    {
        public IEnumerable<FxPreset> Create()
        {
            yield return new BossFxPreset("SpringSplash", Fx.SpringMain, 0.3f, 8f)
            {
                layers = new[]
                {
                    // 白沫团：几团实心的卡通白沫（往上翻、很快散）
                    new FxLayer
                    {
                        style = "ToonSmoke", count = FxScale.Lin(2, 0.8f, 5), maxCount = 5, shape = FxShape.UpperSphere, spread = FxScale.Lin(0, 0.4f), spreadY = 0.5f,
                        speed = new Vector2(0.8f, 2f), speedScale = FxScale.Pow(0.5f), up = 1.2f, size = new Vector2(0.5f, 0.75f), sizeScale = FxScale.Pow(0.7f),
                        life = new Vector2(0.4f, 0.6f), color = FxColor.Fixed, fixedColor = Fx.SpringFoam, mix = 0, shade = new Vector2(0.95f, 1.03f),
                    },
                    // 泉水色水珠（普通混合）
                    new FxLayer
                    {
                        style = "Drop", count = FxScale.Lin(5, 3, 16), maxCount = 16, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.4f), spreadY = 0.3f,
                        speed = new Vector2(3, 7), speedScale = FxScale.Pow(0.5f), up = 2.5f, size = new Vector2(0.18f, 0.3f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.55f, 0.85f), color = FxColor.Fixed, fixedColor = Fx.SpringMain, mix = 0, shade = new Vector2(0.9f, 1.08f),
                    },
                    // 浅青的拉丝水花（普通混合，亮沙上不洗白）
                    new FxLayer
                    {
                        style = "Spray", count = FxScale.Lin(6, 3, 18), maxCount = 18, shape = FxShape.Cone, coneAngle = 35, spread = FxScale.Lin(0, 0.35f), spreadY = 0.2f,
                        speed = new Vector2(6, 11), speedScale = FxScale.Pow(0.5f), size = new Vector2(0.12f, 0.2f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.5f, 0.8f), color = FxColor.Fixed, fixedColor = Fx.SpringFoam, mix = 0.35f,
                    },
                },
            };
            yield return new BossFxPreset("SpringFoot", Fx.SpringMain, 0.3f, 8f)
            {
                layers = new[]
                {
                    // 一圈泉水色的水花团（贴地外扩）
                    new FxLayer
                    {
                        style = "ToonDust", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.05f,
                        size = new Vector2(1.5f, 1.5f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.6f, 0.6f), color = FxColor.Fixed, fixedColor = Fx.SpringMain, mix = 0,
                    },
                    // 白沫涟漪圈
                    new FxLayer
                    {
                        style = "ToonRing", count = FxScale.Const(1), density = false, shape = FxShape.Point, offset = 0.08f, delay = 0.05f,
                        size = new Vector2(1.4f, 1.4f), sizeScale = FxScale.Lin(0, 1), life = new Vector2(0.45f, 0.45f), color = FxColor.Fixed, fixedColor = Fx.SpringFoamRing, mix = 0,
                    },
                    new FxLayer
                    {
                        style = "Drop", count = FxScale.Lin(3, 1.5f, 10), maxCount = 10, shape = FxShape.MostlyUp, spread = FxScale.Lin(0, 0.5f), spreadY = 0.2f,
                        speed = new Vector2(2, 5), speedScale = FxScale.Pow(0.5f), up = 2f, size = new Vector2(0.16f, 0.26f), sizeScale = FxScale.Pow(0.5f),
                        life = new Vector2(0.45f, 0.7f), color = FxColor.Fixed, fixedColor = Fx.SpringMain, mix = 0, shade = new Vector2(0.9f, 1.08f),
                    },
                },
            };
        }
    }
}
