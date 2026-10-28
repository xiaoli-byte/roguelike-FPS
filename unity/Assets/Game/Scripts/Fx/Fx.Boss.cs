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
                // 冠要矮而宽：落在身体外圈，不盖住砸下来的身体
                Surge.Crown(g, radius * 0.75f, radius * 0.42f, SurgeKind.Molten, 0.75f);
                if (decal) MoltenSplat(g, radius * 1.1f, 1f, 5f);
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
        public static FxHandle MoltenSplat(Vector3 ground, float radius, float heat = 1f, float life = 6f) =>
            SigilDecals.Place(SigilMode.Molten, ground + Vector3.up * 0.05f, radius, life, heat);

        /// <summary>出水后脚下的湿痕（压暗的湿沙，慢慢干掉）</summary>
        public static FxHandle WetPatch(Vector3 ground, float radius, float life = 8f) => SigilDecals.Place(SigilMode.Wet, ground + Vector3.up * 0.05f, radius, life);

        /// <summary>身上流泻：model 上挂 duration 秒的水 / 沙 / 熔浆往下淌（刚出来哗哗地淌，慢慢只剩几滴）</summary>
        public static BodyStreams BodyStream(GameObject model, StreamKind kind, float duration, float rate = 60f, Color? color = null) =>
            BodyStreams.Attach(model, kind, duration, rate, color);

        /// <summary>
        /// 一阵风（镜头转场的风声的视觉部分）：在 eye 前方 2.5–10 m 的一片里，淡色风线沿 sweep 方向横扫过去 + 几缕尘 / 雪 / 火星。
        /// tint = 场地色（沙黄 / 冰白 / 余烬橙），strength 0..1.5 管数量
        /// </summary>
        public static void WindGust(Vector3 eye, Vector3 forward, Vector3 sweep, Color tint, float strength = 1f)
        {
            if (!Finite(eye) || !Finite(forward) || !Finite(sweep) || sweep.sqrMagnitude < 1e-4f) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            forward = forward.normalized;
            sweep = sweep.normalized;
            var right = Vector3.Cross(Vector3.up, forward).normalized;
            if (right.sqrMagnitude < 0.5f) right = Vector3.right;
            int n = FxBudget.Allow(Mathf.RoundToInt(16 * strength * Density), false);
            var streak = rt.GetEmitter("Spray");
            var line = new Color(Mathf.Lerp(tint.r, 1, 0.55f), Mathf.Lerp(tint.g, 1, 0.55f), Mathf.Lerp(tint.b, 1, 0.55f), 0.32f);
            for (int i = 0; streak != null && i < n; i++)
            {
                var p = eye + forward * Random.Range(2.5f, 10f) + right * Random.Range(-5f, 5f) + Vector3.up * Random.Range(-1.6f, 2.2f) - sweep * Random.Range(1f, 4f);
                var v = sweep * Random.Range(18f, 30f) + Vector3.up * Random.Range(-0.5f, 1.5f);
                rt.EmitOne(streak, p, v, Random.Range(0.04f, 0.07f), Random.Range(0.22f, 0.36f), line, 0);
            }
            // 几缕尘 / 雪团跟着风滚过去
            int m = FxBudget.Allow(Mathf.RoundToInt(3 * strength * Density), false);
            var dust = rt.GetEmitter("ToonSmoke");
            var dc = tint;
            dc.a = 0.55f;
            for (int i = 0; dust != null && i < m; i++)
            {
                var p = eye + forward * Random.Range(4f, 11f) + right * Random.Range(-5f, 5f) + Vector3.up * Random.Range(-2f, 0.5f) - sweep * 3f;
                rt.EmitOne(dust, p, sweep * Random.Range(6f, 11f), Random.Range(0.8f, 1.3f), Random.Range(0.45f, 0.7f), dc, 0);
            }
        }

        /// <summary>
        /// 旱风的沙线：从 origin 朝 yaw ± halfAngle 的扇区里，一片拉丝沙流以 speed 往外飞（射程 range），后面跟几团贴地沙尘
        /// </summary>
        public static void SandGust(Vector3 origin, float yaw, float halfAngle, float range, float speed, Color? sand = null)
        {
            if (!Finite(origin)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var c = sand ?? HanbaDef.Sand;
            c.a = 0.9f;
            int n = FxBudget.Allow(Mathf.RoundToInt(20 * Density), false);
            var e = rt.GetEmitter("Spray");
            float life = Mathf.Clamp(range / Mathf.Max(1f, speed), 0.3f, 1.2f);
            for (int i = 0; e != null && i < n; i++)
            {
                float a = (yaw + Random.Range(-halfAngle, halfAngle)) * Mathf.Deg2Rad;
                var dir = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                var p = origin + dir * Random.Range(0.5f, 2.5f) + Vector3.up * Random.Range(-0.4f, 2.2f);
                rt.EmitOne(e, p, dir * speed * Random.Range(0.75f, 1.05f) + Vector3.up * Random.Range(0.5f, 2.5f), Random.Range(0.1f, 0.16f), life * Random.Range(0.7f, 1f), c, 0);
            }
            int m = FxBudget.Allow(Mathf.RoundToInt(4 * Density), false);
            var dust = rt.GetEmitter("ToonSmoke");
            for (int i = 0; dust != null && i < m; i++)
            {
                float a = (yaw + Random.Range(-halfAngle, halfAngle)) * Mathf.Deg2Rad;
                var dir = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                rt.EmitOne(dust, origin + dir * Random.Range(1f, 3f) + Vector3.up * 0.4f, dir * speed * Random.Range(0.4f, 0.7f) + Vector3.up * 0.5f,
                    Random.Range(1.0f, 1.6f), Random.Range(0.5f, 0.8f), c, 0);
            }
        }

        /// <summary>
        /// 吞吸：扇区里（mouth 朝 yaw ± halfAngle、range 米内）的雪粒和白色气流线被往 mouth 吸过去（每帧调，dt 控制数量）
        /// </summary>
        public static void SuckIn(Vector3 mouth, float yaw, float halfAngle, float range, float dt)
        {
            if (!Finite(mouth) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float expected = 34f * dt * Density;
            int n = Mathf.FloorToInt(expected);
            if (Random.value < expected - n) n++;
            n = FxBudget.Allow(n, false);
            var snow = rt.GetEmitter("Snow");
            var line = rt.GetEmitter("Spray");
            var lc = new Color(0.9f, 0.97f, 1f, 0.55f);
            for (int i = 0; i < n; i++)
            {
                float a = (yaw + Random.Range(-halfAngle, halfAngle)) * Mathf.Deg2Rad;
                float d = Random.Range(4f, range);
                var p = mouth + new Vector3(Mathf.Sin(a) * d, 0, Mathf.Cos(a) * d);
                p.y = mouth.y + Random.Range(-3.5f, 1.5f);
                var to = mouth - p;
                float speed = Random.Range(12f, 20f);
                var v = to.normalized * speed;
                float life = Mathf.Min(1.2f, to.magnitude / speed);
                if ((i & 1) == 0 && snow != null) rt.EmitOne(snow, p, v, Random.Range(0.14f, 0.22f), life, FrostPalette.Snow, 0);
                else if (line != null) rt.EmitOne(line, p, v, Random.Range(0.05f, 0.08f), life * 0.8f, lc, 0);
            }
        }

        /// <summary>
        /// 吐息火流（每帧调）：从 mouth 往 end 喷的一股火舌团（FlameBurst，加法、往上卷），dt 控制数量；scorch = 落点一路留焦黑的余烬地火
        /// </summary>
        public static void FireStream(Vector3 mouth, Vector3 end, float size, float dt, Color? color = null)
        {
            if (!Finite(mouth) || !Finite(end) || !(dt > 0)) return;
            var seg = end - mouth;
            float len = seg.magnitude;
            if (len < 0.5f) return;
            var dir = seg / len;
            // 卡通火苗（B 路的 ToonFlame 序列帧：S 形往上翻、顶端分舌、断出小火团），少而大
            float expected = 36f * dt * Mathf.Lerp(0.6f, 1f, Density);
            int n = Mathf.FloorToInt(expected);
            if (Random.value < expected - n) n++;
            n = FxBudget.Allow(n, false);
            var rt = FxRuntime.Ensure();
            var e = rt ? rt.GetEmitter("ToonFlame") : null;
            var c = color ?? InfernoPalette.Fire;
            for (int i = 0; e != null && i < n; i++)
            {
                // 速度按射程换算：阻尼 2.5、0.5 s 里飞出 ≈ speed × 0.286 米
                float speed = len / 0.286f * Random.Range(0.75f, 1.05f);
                var jitter = Random.insideUnitSphere * 0.12f;
                rt.EmitOne(e, mouth + dir * Random.Range(0.2f, 1.2f), (dir + jitter).normalized * speed + Vector3.up * 0.6f, size * Random.Range(1.1f, 1.6f), 0.5f, c, 0);
            }
        }

        /// <summary>前摇时手上 / 尾尖蓄着的一团火（每帧调）：往上窜的火舌 + 几颗光点，size ≈ 火团大小（米）</summary>
        public static void Wisp(Vector3 at, Color color, float size, float dt)
        {
            if (!Finite(at) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float expected = 18f * dt * Mathf.Lerp(0.6f, 1f, Density);
            int n = Mathf.FloorToInt(expected);
            if (Random.value < expected - n) n++;
            n = FxBudget.Allow(n, false);
            var flame = rt.GetEmitter("ToonFlame");
            var mote = rt.GetEmitter("Mote");
            for (int i = 0; i < n; i++)
            {
                var p = at + Random.insideUnitSphere * size * 0.25f;
                if ((i & 3) != 3 && flame != null) rt.EmitOne(flame, p, Vector3.up * Random.Range(0.4f, 1.2f), size * Random.Range(1.0f, 1.4f), Random.Range(0.3f, 0.45f), color, 0);
                else if (mote != null) rt.EmitOne(mote, p, Random.insideUnitSphere * 1.2f + Vector3.up, size * 0.25f, Random.Range(0.4f, 0.7f), color, 0);
            }
        }

        /// <summary>日冕：center 周围半径 radius 的一圈往外飘的金红光点（每帧调，dt 控制数量）</summary>
        public static void Corona(Vector3 center, float radius, float dt, Color? color = null)
        {
            if (!Finite(center) || !(dt > 0)) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            float expected = 26f * dt * Density;
            int n = Mathf.FloorToInt(expected);
            if (Random.value < expected - n) n++;
            n = FxBudget.Allow(n, false);
            var e = rt.GetEmitter("Mote");
            var c = color ?? new Color(1f, 0.62f, 0.25f);
            for (int i = 0; e != null && i < n; i++)
            {
                var d = Random.onUnitSphere;
                rt.EmitOne(e, center + d * radius * Random.Range(0.95f, 1.1f), d * Random.Range(1f, 3f), Random.Range(0.3f, 0.45f), Random.Range(0.5f, 0.8f), c, 0);
            }
        }

        /// <summary>水体体积的本体色：水花色压暗、偏青一点（体积是一整片，原色铺满会发白）</summary>
        static Color WaterBody(Color c) => new(c.r * 0.6f, c.g * 0.82f, c.b * 0.88f, 1);
    }
}
