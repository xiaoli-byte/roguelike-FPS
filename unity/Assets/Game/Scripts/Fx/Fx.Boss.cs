using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 首领与怪物专属特效入口（特效打磨 C 路）：破水 / 破沙 / 砸地 / 熔铜四溅 / 水柱 / 熔浆柱 / 日轮炸亮 / 身上流泻 / 熔铜贴花 / 湿痕。
    /// 粒子预设在 G/Fx/Presets/Boss.cs，整块的体积（水柱、水墙、漩涡、熔浆柱、火尾）见 <see cref="Surge"/>，贴花见 <see cref="SigilDecals"/>，
    /// 身上淌下来的水 / 沙 / 熔浆见 <see cref="BodyStreams"/>。只管外观，不碰判定。
    /// </summary>
    public static partial class Fx
    {
        /// <summary>水色（月牙泉 / 北冥的水花）</summary>
        public static readonly Color SpringWater = Hex.Rgb(0xbfe6e0), NorthSea = Hex.Rgb(0xbfe8f5);

        /// <summary>
        /// 破水（首领从水下冲出来那一下）：一圈往外翻的水冠（体积）、冲天水线、大水珠、白沫水雾、水面白沫圈。radius = 水冠口径（米）
        /// </summary>
        public static FxHandle Splash(Vector3 waterPoint, float radius, Color? water = null)
        {
            var c = water ?? SpringWater;
            var h = Play("BossSplash", waterPoint, Vector3.up, c, radius);
            Surge.Crown(waterPoint - Vector3.up * 0.2f, radius * 0.75f, radius * 1.1f, SurgeKind.Water, 0.9f, WaterBody(c), Color.white, 0.9f);
            return h;
        }

        /// <summary>破沙（从沙里钻出来 / 沙地炸开）：沙流、沙粒、沙尘团、碎石。radius = 规模（米）</summary>
        public static FxHandle SandBlast(Vector3 at, float radius, Color? sand = null) => Play("BossSandBlast", at, Vector3.up, sand ?? HanbaDef.Sand, radius);

        /// <summary>砸地（看得清的落地冲击，不盖住身体）：贴地尘浪、碎石、火星、裂痕贴花、按距离震屏。radius = 冲击半径（米）</summary>
        public static FxHandle Slam(Vector3 ground, float radius, Color? dust = null) => Play("BossSlam", ground, Vector3.up, dust ?? Hex.Rgb(0x8a7a6c), radius);

        /// <summary>
        /// 熔铜 / 熔浆四溅：熔滴、炭渣、火星、黑烟 + 一圈熔铜冠（体积）。radius = 规模（米）；decal = 地上留一滩熔铜（白热 → 冷却成壳）
        /// </summary>
        public static FxHandle MoltenBurst(Vector3 at, float radius, bool decal = true, Color? color = null)
        {
            var h = Play("BossMoltenBurst", at, Vector3.up, color ?? InfernoPalette.Molten, radius);
            float gy = GroundY(at + Vector3.up * 0.5f, 3f);
            if (!float.IsNegativeInfinity(gy))
            {
                var g = new Vector3(at.x, gy, at.z);
                Surge.Crown(g, radius * 0.6f, radius * 0.75f, SurgeKind.Molten, 0.75f);
                if (decal) MoltenSplat(g, radius * 1.1f, 1f, 9f);
            }
            return h;
        }

        /// <summary>
        /// 水柱（体积 + 顶上的水花和水雾）：从 ground 冲到 height 米、停一会儿、塌回去。flow 正 = 往上冲
        /// </summary>
        public static FxHandle WaterSpout(Vector3 ground, float radius, float height, float hold = 0.5f, Color? water = null)
        {
            var c = water ?? SpringWater;
            var h = Surge.Column(ground, radius, height, SurgeKind.Water, 0.28f, hold, 0.7f, WaterBody(c), Color.white, 2.2f, 0.92f);
            Play("BossSplash", ground + Vector3.up * height * 0.85f, Vector3.up, c, Mathf.Clamp(radius * 0.9f, 0.6f, 6f));
            return h;
        }

        /// <summary>熔浆柱（体积 + 熔滴）：从 ground 喷到 height 米</summary>
        public static FxHandle LavaSpout(Vector3 ground, float radius, float height, float hold = 0.5f)
        {
            var h = Surge.Column(ground, radius, height, SurgeKind.Molten, 0.22f, hold, 0.6f, null, null, 2.6f);
            Play("BossMoltenBurst", ground + Vector3.up * height * 0.8f, Vector3.up, InfernoPalette.Molten, Mathf.Clamp(radius, 0.6f, 5f));
            return h;
        }

        /// <summary>日轮炸亮：十字星芒、金色拉丝、金屑、暖光。size = 规模</summary>
        public static FxHandle SunFlare(Vector3 at, float size, Color? color = null) => Play("BossSunFlare", at, Vector3.up, color ?? Hex.Rgb(0xffd27a), size);

        /// <summary>地上一滩熔铜（白热 → 橙 → 暗壳 + 发光裂缝），radius 米、life 秒，heat = 初始余热 0..1</summary>
        public static FxHandle MoltenSplat(Vector3 ground, float radius, float heat = 1f, float life = 9f) =>
            SigilDecals.Place(SigilMode.Molten, ground + Vector3.up * 0.05f, radius, life, heat);

        /// <summary>出水后脚下的湿痕（压暗的湿沙，慢慢干掉）</summary>
        public static FxHandle WetPatch(Vector3 ground, float radius, float life = 8f) => SigilDecals.Place(SigilMode.Wet, ground + Vector3.up * 0.05f, radius, life);

        /// <summary>身上流泻：model 上挂 duration 秒的水 / 沙 / 熔浆往下淌（刚出来哗哗地淌，慢慢只剩几滴）</summary>
        public static BodyStreams BodyStream(GameObject model, StreamKind kind, float duration, float rate = 60f, Color? color = null) =>
            BodyStreams.Attach(model, kind, duration, rate, color);

        /// <summary>水体体积的本体色：水花色压暗、偏青一点（体积是一整片，原色铺满会发白）</summary>
        static Color WaterBody(Color c) => new(c.r * 0.6f, c.g * 0.82f, c.b * 0.88f, 1);
    }
}
