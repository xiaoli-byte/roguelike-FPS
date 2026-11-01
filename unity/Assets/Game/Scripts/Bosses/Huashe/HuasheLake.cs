using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 圣湖（化蛇的擂台；chuanzang-combat-v1.md 4.3「水」）：水位、游线、涨水面、湖面漩涡。
    ///   · 湖：M1 在 4-1 摆的 WaterVolume（名为 <see cref="LakeName"/>，或包住擂台中心的那片水）——水面高度 = 基础水位，水平范围（含朝向）= 湖的椭圆；
    ///     湖心岛 = 场地下名为 Island 的锚点（化蛇绕岛游）。场景里没有湖时（测试场）按擂台中心、地面高度当一片「虚拟湖」（基础水位 = 地面）。
    ///   · 游线：沿湖椭圆的 0.62 倍（网页版 swimPos），湖心岛占着中间。
    ///   · 水位 = 基础 + 常驻涨水（二阶段 +1.2 m）+ 吼叫涨水（+0.8 m，6 s 后 0.3 m/s 退）。涨上来的水是另建的一片不致命的浅水体（覆盖整个擂台，
    ///     底固定、顶跟着水位；地形高于水面的地方自然不在水里），水面片跟着升；边缘冒白沫（涨水线）。
    ///   · 泡在涨水里每秒 2（网页值）；三阶段湖水打漩，泡在水里的人往湖心拉。
    /// </summary>
    public sealed class HuasheLake
    {
        public const string LakeName = "Water_HolyLake", IslandName = "Island";

        public Vector3 Center { get; private set; }
        public float BaseLevel { get; private set; }
        /// <summary>湖的椭圆半轴（米）与朝向（度）</summary>
        public float Rx { get; private set; } = 30f;
        public float Rz { get; private set; } = 22f;
        public float Yaw { get; private set; }
        /// <summary>场景里摆了湖（false = 测试场的虚拟湖）</summary>
        public bool Real { get; private set; }
        /// <summary>常驻涨水 / 吼叫涨水（米）</summary>
        public float Flood { get; set; }
        public float Surge { get; set; }
        public float Level => BaseLevel + Flood + Surge;

        readonly BossArena arena;
        WaterVolume floodVol;
        float floodBottom, edgeAcc;

        public WaterVolume FloodVolume => floodVol;

        public HuasheLake(BossArena arena, Vector3 fallback)
        {
            this.arena = arena;
            var c = arena ? arena.Center : fallback;
            WaterVolume lake = null;
            foreach (var w in WaterVolume.All)
                if (w && w.name.StartsWith(LakeName, System.StringComparison.OrdinalIgnoreCase))
                {
                    lake = w;
                    break;
                }
            if (!lake)
                foreach (var w in WaterVolume.All)
                    if (w && w.DepthAt(new Vector3(c.x, w.Surface - 0.2f, c.z)) > 0)
                    {
                        lake = w;
                        break;
                    }
            if (lake)
            {
                Real = true;
                var t = lake.transform;
                Center = new Vector3(t.position.x, lake.Surface, t.position.z);
                BaseLevel = lake.Surface;
                Rx = Mathf.Abs(t.lossyScale.x) * 0.5f;
                Rz = Mathf.Abs(t.lossyScale.z) * 0.5f;
                Yaw = t.eulerAngles.y;
            }
            else
            {
                float r = arena ? arena.Extent : 40f;
                Center = c;
                BaseLevel = c.y;
                Rx = r * 0.62f;
                Rz = r * 0.48f;
                Yaw = arena ? arena.transform.eulerAngles.y : 0;
            }
            if (arena)
                foreach (var t in arena.GetComponentsInChildren<Transform>(true))
                    if (t != arena.transform && t.name.StartsWith(IslandName, System.StringComparison.OrdinalIgnoreCase))
                    {
                        Center = new Vector3(t.position.x, Center.y, t.position.z);
                        break;
                    }
        }

        /// <summary>游线上第 a（弧度）处的点（水面下 depth 米）与切线朝向（度）</summary>
        public Vector3 SwimPoint(float a, float depth, out float yawDeg)
        {
            var p = Local(Mathf.Cos(a) * Rx * 0.62f, Mathf.Sin(a) * Rz * 0.62f);
            var q = Local(Mathf.Cos(a + 0.05f) * Rx * 0.62f, Mathf.Sin(a + 0.05f) * Rz * 0.62f);
            var d = q - p;
            yawDeg = Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;
            p.y = Level + depth;
            return p;
        }

        Vector3 Local(float x, float z)
        {
            var r = Quaternion.Euler(0, Yaw, 0) * new Vector3(x, 0, z);
            return new Vector3(Center.x + r.x, Center.y, Center.z + r.z);
        }

        /// <summary>某点在游线上的参数（弧度，最近的那个方向）</summary>
        public float AngleOf(Vector3 p)
        {
            var l = Quaternion.Euler(0, -Yaw, 0) * new Vector3(p.x - Center.x, 0, p.z - Center.z);
            return Mathf.Atan2(l.z / Mathf.Max(1f, Rz), l.x / Mathf.Max(1f, Rx));
        }

        /// <summary>在湖的椭圆 × k 以内（水平）</summary>
        public bool InLake(Vector3 p, float k = 1f)
        {
            var l = Quaternion.Euler(0, -Yaw, 0) * new Vector3(p.x - Center.x, 0, p.z - Center.z);
            float a = l.x / (Rx * k), b = l.z / (Rz * k);
            return a * a + b * b < 1f;
        }

        /// <summary>玩家泡在水里（湖里或涨上来的水里，脚低于水面 5 cm 以上）</summary>
        public bool PlayerInWater(Vector3 feet) => WaterVolume.PlayerDepth > 0.05f || (InLake(feet, 1.05f) && feet.y < Level - 0.05f);

        /// <summary>每帧：涨水面跟着水位（Flood + Surge &gt; 0.05 时才有）、边缘冒白沫</summary>
        public void Tick(float dt, Transform parent)
        {
            float f = Flood + Surge;
            if (f > 0.05f && !floodVol)
            {
                float span = (arena ? arena.Extent : 40f) * 2f + 8f;
                floodBottom = BaseLevel - 2f;
                floodVol = WaterVolume.Create(new Vector3(Center.x, floodBottom, Center.z), new Vector3(span, 2f + f, span), Yaw, parent);
                floodVol.name = "Huashe Flood";
                floodVol.deepIsHazard = false;
                floodVol.deep = 3f;
            }
            if (!floodVol) return;
            float h = Mathf.Max(0.05f, Level - floodBottom);
            var t = floodVol.transform;
            var s = t.localScale;
            t.localScale = new Vector3(s.x, h, s.z);
            t.position = new Vector3(t.position.x, floodBottom + h * 0.5f, t.position.z);
            if (f <= 0.02f)
            {
                Object.Destroy(floodVol.gameObject);
                floodVol = null;
                return;
            }
            // 涨水线：在玩家附近的岸上冒白沫（地面和水位差不多高的地方）
            edgeAcc += dt;
            if (edgeAcc < 0.5f || !LordBrain.PlayerFeet(out var feet)) return;
            edgeAcc = 0;
            for (int i = 0; i < 4; i++)
            {
                var p = feet + new Vector3(Random.Range(-14f, 14f), 0, Random.Range(-14f, 14f));
                if (!Physics.Raycast(p + Vector3.up * 8f, Vector3.down, out var hit, 30f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                if (Mathf.Abs(hit.point.y - Level) < 0.35f) Fx.HuasheFloodEdge(new Vector3(hit.point.x, Level, hit.point.z));
            }
        }

        /// <summary>收掉涨水面（化蛇倒下、测试清场）</summary>
        public void Dispose()
        {
            if (floodVol) Object.Destroy(floodVol.gameObject);
            floodVol = null;
        }
    }
}
