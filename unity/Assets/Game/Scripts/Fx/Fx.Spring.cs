using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 月牙泉的风格化水（特效打磨收尾一轮）：Fx 的分部文件。旱魃登场的破泉水柱 / 水幕 / 水包、二阶段泉床的间歇喷泉、倒下时泉心那一下都走这里——
    /// 涌流体积用 <see cref="SurgeKind.Spring"/>（深青水身 / 泉水主色 / 白沫块，几乎不透明，轮廓一圈白沫亮边），粒子见 Presets/Spring.cs。
    /// 北冥（鲲鹏）的海水仍走 <see cref="WaterSpout"/> / <see cref="Splash"/>。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>月牙泉的泉水主色（1-4 水面 SF_Water 的浅水色提一点饱和）、白沫（偏一点青，不是纯白）、白沫涟漪圈（发光环用：压一档，亮沙上不洗白）</summary>
        public static readonly Color SpringMain = new(0.22f, 0.66f, 0.8f), SpringFoam = new(0.9f, 0.97f, 1f), SpringFoamRing = new(0.62f, 0.88f, 0.96f);

        /// <summary>
        /// 泉水柱（喷泉 / 破泉）：泉水体积从 ground 冲到 height 米、停 hold 秒、塌回去；柱顶一蓬白沫团 + 水珠 + 水花，柱脚一圈水花团 + 白沫涟漪圈
        /// </summary>
        public static FxHandle SpringSpout(Vector3 ground, float radius, float height, float hold = 0.5f, float flow = 2.2f)
        {
            if (!Finite(ground) || !(radius > 0) || !(height > 0)) return FxHandle.None;
            var h = Surge.Column(ground, radius, height, SurgeKind.Spring, 0.26f, hold, 0.7f, null, null, flow, 1f);
            Play("SpringSplash", ground + Vector3.up * height * 0.85f, Vector3.up, SpringMain, Mathf.Clamp(radius * 0.9f, 0.6f, 6f));
            Play("SpringFoot", ground, Vector3.up, SpringMain, Mathf.Clamp(radius * 1.4f, 0.6f, 6f));
            return h;
        }

        /// <summary>破泉（从泉里冲出来那一下）：一圈往外翻的泉水冠 + 白沫团、水珠、水花 + 水花团涟漪。radius = 水冠口径（米）</summary>
        public static FxHandle SpringSplash(Vector3 waterPoint, float radius)
        {
            if (!Finite(waterPoint) || !(radius > 0)) return FxHandle.None;
            var h = Play("SpringSplash", waterPoint, Vector3.up, SpringMain, radius);
            Play("SpringFoot", waterPoint, Vector3.up, SpringMain, radius);
            Surge.Crown(waterPoint - Vector3.up * 0.2f, radius * 0.75f, radius * 1.1f, SurgeKind.Spring, 0.9f);
            return h;
        }
    }
}
