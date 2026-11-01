using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 圣湖（化蛇的擂台；chuanzang-combat-v1.md 4.3「水」）：水位、游线、涨水面、湖面漩涡。
    ///   · 湖：M1 在 4-1 摆的 WaterVolume（名为 <see cref="LakeName"/>，或包住擂台中心的那片水）——水面高度 = 基础水位，水平范围（含朝向）= 湖的椭圆；
    ///     场景里没有湖时（测试场）按擂台中心、地面高度当一片「虚拟湖」（基础水位 = 地面）。
    ///   · 游线：绕湖心游（网页 swimPos 的中心是湖心，不是岛）。中心 = 场地下的 <see cref="SwimCenterName"/> 锚点，没有就是湖心；
    ///     贴着湖岸游：真湖沿每条射线实测湖岸（地面高出水面 0.6 m），游线取 岸 − <see cref="ShoreGap"/>（5.5 m，前后平滑；夹在网页 0.62 倍椭圆和 岸 − 3 m 之间），
    ///     4-1 圣湖（48 × 32 m）东西南北的岸都在扑岸 10 m 内；量不到岸（测试场的虚拟湖）用椭圆 max(湖半轴 × 0.62, 湖半轴 − 5.5 m)，小湖就是网页的 0.62 倍。
    ///     湖心岛（<see cref="IslandName"/> 锚点，半径按地形量）不在游线上：游线上离岛不到 岛半径 + 3 m 的点往外推开。
    ///     游速按网页的线速度（0.62 倍椭圆上的角速度 × 半径）折算，大椭圆上不会游得更快。
    ///   · 水位 = 基础 + 常驻涨水（二阶段 +1.2 m）+ 吼叫涨水（+0.8 m，6 s 后 0.3 m/s 退）。涨上来的水是另建的一片不致命的浅水体（覆盖整个擂台，
    ///     底固定、顶跟着水位；地形高于水面的地方自然不在水里），水面片跟着升；边缘冒白沫（涨水线）。
    ///   · 泡在涨水里每秒 2（网页值）；三阶段湖水打漩，泡在水里的人往湖心拉。
    /// </summary>
    public sealed class HuasheLake
    {
        public const string LakeName = "Water_HolyLake", IslandName = "Island", SwimCenterName = "SwimCenter";
        /// <summary>游线离湖岸（湖椭圆）的距离（米）；网页 0.62 倍更贴岸时取 0.62 倍</summary>
        public const float ShoreGap = 5.5f, MinShoreGap = 3f, IslandClear = 3f;
        const int Samples = 180;

        /// <summary>湖心（湖椭圆的中心，水面高度）</summary>
        public Vector3 Center { get; private set; }
        /// <summary>游线中心（SwimCenter 锚点；没有 = 湖心）与半轴</summary>
        public Vector3 SwimCenter { get; private set; }
        public float SwimRx { get; private set; }
        public float SwimRz { get; private set; }
        /// <summary>湖心岛（没有岛为 null）与半径（地形高出水面 −0.5 m 的范围）</summary>
        public Vector3? Island { get; private set; }
        public float IslandRadius { get; private set; }
        /// <summary>游速折算：大椭圆上把角速度按网页 0.62 倍椭圆的线速度缩回来</summary>
        public float SwimRateScale { get; private set; } = 1f;
        /// <summary>被湖心岛推开的游线采样点数（测试）</summary>
        public int IslandPushed { get; private set; }

        readonly Vector3[] swim = new Vector3[Samples];
        readonly float[] bottom = new float[Samples];
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
            SwimCenter = Center;
            Transform swimAnchor = null, islandAnchor = null;
            if (arena)
                foreach (var t in arena.GetComponentsInChildren<Transform>(true))
                {
                    if (t == arena.transform) continue;
                    if (!swimAnchor && t.name.StartsWith(SwimCenterName, System.StringComparison.OrdinalIgnoreCase)) swimAnchor = t;
                    else if (!islandAnchor && t.name.StartsWith(IslandName, System.StringComparison.OrdinalIgnoreCase)) islandAnchor = t;
                }
            if (swimAnchor) SwimCenter = new Vector3(swimAnchor.position.x, Center.y, swimAnchor.position.z);
            if (islandAnchor)
            {
                Island = new Vector3(islandAnchor.position.x, Center.y, islandAnchor.position.z);
                IslandRadius = MeasureIsland(Island.Value);
            }
            SwimRx = Mathf.Max(Rx * 0.62f, Rx - ShoreGap);
            SwimRz = Mathf.Max(Rz * 0.62f, Rz - ShoreGap);
            SwimRateScale = (Rx + Rz) * 0.62f / Mathf.Max(1f, SwimRx + SwimRz);
            BuildSwimLine();
        }

        /// <summary>岛的半径：从岛心往 16 个方向走，地面低于基础水位 0.5 m 的地方为岸（最多 30 m）</summary>
        float MeasureIsland(Vector3 c)
        {
            float sum = 0;
            for (int i = 0; i < 16; i++)
            {
                var dir = Quaternion.Euler(0, i * 22.5f, 0) * Vector3.forward;
                float r = 0.5f;
                for (; r < 30f; r += 0.5f)
                {
                    var p = c + dir * r;
                    if (!Physics.Raycast(new Vector3(p.x, BaseLevel + 20f, p.z), Vector3.down, out var hit, 60f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) break;
                    if (hit.point.y < BaseLevel - 0.5f) break;
                }
                sum += r;
            }
            return sum / 16f;
        }

        /// <summary>
        /// 游线采样：椭圆（游线半轴）→ 真湖按实测湖岸贴过去（沿射线量到岸，取 岸 − ShoreGap，夹在网页 0.62 倍椭圆和 岸 − MinShoreGap 之间，再前后各 4 个采样平滑）
        /// → 不出湖 → 离岛 ≥ 岛半径 + IslandClear（沿离岛方向推开）；顺带记下湖底高度
        /// </summary>
        void BuildSwimLine()
        {
            IslandPushed = 0;
            ShoreMeasured = 0;
            float keep = Mathf.Min(IslandRadius + IslandClear, Mathf.Min(Rx, Rz) * 0.5f);
            var rot = Quaternion.Euler(0, Yaw, 0);
            var dirs = new Vector3[Samples];
            var rad = new float[Samples];
            var cap = new float[Samples];
            for (int i = 0; i < Samples; i++)
            {
                float a = i * Mathf.PI * 2f / Samples;
                var off = rot * new Vector3(Mathf.Cos(a) * SwimRx, 0, Mathf.Sin(a) * SwimRz);
                rad[i] = off.magnitude;
                cap[i] = float.MaxValue;
                dirs[i] = rad[i] > 1e-3f ? off / rad[i] : Vector3.forward;
                if (!Real) continue;
                // 网页 0.62 倍椭圆在这条射线上的半径（游线最多收到这里）
                float web = (rot * new Vector3(Mathf.Cos(a) * Rx * 0.62f, 0, Mathf.Sin(a) * Rz * 0.62f)).magnitude;
                float shore = ShoreAlong(SwimCenter, dirs[i], web * 0.5f, Mathf.Max(Rx, Rz) * 1.6f);
                if (shore < 0) continue;
                ShoreMeasured++;
                cap[i] = shore - MinShoreGap;
                rad[i] = Mathf.Clamp(shore - ShoreGap, Mathf.Min(web, shore - MinShoreGap), shore - MinShoreGap);
            }
            if (ShoreMeasured > 0)
            {
                var sm = new float[Samples];
                for (int i = 0; i < Samples; i++)
                {
                    float s = 0;
                    for (int k = -4; k <= 4; k++) s += rad[(i + k + Samples) % Samples];
                    // 平滑之后再按本条射线的岸收一次：岸边有凸出来的地方（4-1 东岸进场处）不能被两边拉出去
                    sm[i] = Mathf.Min(s / 9f, cap[i]);
                }
                rad = sm;
            }
            for (int i = 0; i < Samples; i++)
            {
                var off = dirs[i] * rad[i];
                var p = SwimCenter + off;
                p = InsideLake(p, MinShoreGap);
                if (Island.HasValue)
                {
                    var d = p - Island.Value;
                    d.y = 0;
                    if (d.magnitude < keep)
                    {
                        var dir = d.sqrMagnitude > 1e-4f ? d.normalized : off.normalized;
                        p = InsideLake(Island.Value + dir * keep, MinShoreGap);
                        IslandPushed++;
                    }
                }
                p.y = Center.y;
                swim[i] = p;
                bottom[i] = Physics.Raycast(new Vector3(p.x, BaseLevel + 20f, p.z), Vector3.down, out var hit, 80f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                    ? hit.point.y : BaseLevel - 10f;
            }
        }

        /// <summary>真湖：游线按实测湖岸贴过去的采样数（0 = 量不到岸，用椭圆）</summary>
        public int ShoreMeasured { get; private set; }

        /// <summary>从 c 沿 dir 往外，第一处地面高出基础水位 0.6 m 的距离（湖心岛那一圈跳过）；找不到为 −1</summary>
        float ShoreAlong(Vector3 c, Vector3 dir, float from, float to)
        {
            float prev = -1;
            for (float r = from; r <= to; r += 1f)
            {
                var p = c + dir * r;
                if (Island.HasValue && Vector2.Distance(new Vector2(p.x, p.z), new Vector2(Island.Value.x, Island.Value.z)) < IslandRadius + 1.5f)
                {
                    prev = -1;
                    continue;
                }
                if (!Land(p))
                {
                    prev = r;
                    continue;
                }
                if (prev < 0) return r;   // 一开始就在岸上（射线起点在岛边 / 浅滩上）：当作岸
                // 二分到 0.25 m
                float lo = prev, hi = r;
                for (int k = 0; k < 2; k++)
                {
                    float mid = (lo + hi) * 0.5f;
                    if (Land(c + dir * mid)) hi = mid;
                    else lo = mid;
                }
                return hi;
            }
            return -1;
        }

        bool Land(Vector3 p) => Physics.Raycast(new Vector3(p.x, BaseLevel + 30f, p.z), Vector3.down, out var hit, 80f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                                && hit.point.y > BaseLevel + 0.6f;

        /// <summary>把一点收回湖椭圆里（离岸至少 gap 米，按较短半轴折算）</summary>
        Vector3 InsideLake(Vector3 p, float gap)
        {
            var l = Quaternion.Euler(0, -Yaw, 0) * new Vector3(p.x - Center.x, 0, p.z - Center.z);
            float k = 1f - gap / Mathf.Max(1f, Mathf.Min(Rx, Rz));
            float r = Mathf.Sqrt(Sq(l.x / Rx) + Sq(l.z / Rz));
            if (r <= k || r < 1e-4f) return p;
            l *= k / r;
            var w = Quaternion.Euler(0, Yaw, 0) * l;
            return new Vector3(Center.x + w.x, p.y, Center.z + w.z);
        }

        static float Sq(float x) => x * x;

        /// <summary>游线上第 a（弧度）处的点（水面下 depth 米，潜下去时不穿湖底）与切线朝向（度）</summary>
        public Vector3 SwimPoint(float a, float depth, out float yawDeg)
        {
            float u = Mathf.Repeat(a / (Mathf.PI * 2f), 1f) * Samples;
            int i = Mathf.FloorToInt(u) % Samples, j = (i + 1) % Samples;
            float f = u - Mathf.Floor(u);
            var p = Vector3.Lerp(swim[i], swim[j], f);
            var d = swim[(i + 2) % Samples] - swim[(i + Samples - 1) % Samples];
            yawDeg = Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;
            float y = Level + depth;
            // 真湖里贴岸那一圈湖底只有 1.5–2 m：潜下去不穿湖底（虚拟湖没有水，照旧藏到地面下）
            if (Real && depth < -0.5f) y = Mathf.Max(y, Mathf.Min(Mathf.Lerp(bottom[i], bottom[j], f) + 0.5f, Level - 0.5f));
            p.y = y;
            return p;
        }

        /// <summary>某点在游线上的参数（弧度，绕游线中心的那个方向）</summary>
        public float AngleOf(Vector3 p)
        {
            var l = Quaternion.Euler(0, -Yaw, 0) * new Vector3(p.x - SwimCenter.x, 0, p.z - SwimCenter.z);
            return Mathf.Atan2(l.z / Mathf.Max(1f, SwimRz), l.x / Mathf.Max(1f, SwimRx));
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
