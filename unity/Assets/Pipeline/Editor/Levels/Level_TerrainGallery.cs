using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using static Spiritfire.Art.Editor.Levels.Landform;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 地貌画廊（L4，docs/unity-parity.md 第 5 节）：地貌库里每种地貌一块样例地形，配所属章节的地表分层、散布、远景环——截图验收用，也给地图单元当参考写法。
    /// 不是关卡：没有玩家、遭遇、NavMesh。三章各一组，组间相距 5 km（各自的远景环互不可见）；样例边长 256 m，边缘 26 m 内落回地面（像一块块标本）：
    ///   第一章（组心 (0, 0)）：雅丹场（1-2）· 城墙压沙 + 穿城古道（1-3，样条压平 + 限坡）· 洞穴碗 + 下行坡道 + 落水洞（1-4，地形洞）· 沙丘古道（1-1 的古道做法）
    ///   第二章（组心 (5000, 0)）：V 形谷 + 阶地 + 级间坡道（2-1，2 × 1 块地形）· 平湖 + 湖岸 + 岛（2-3）· 阶梯坡 + 挡土墙 + 坡道车道（2-2）
    ///   第三章（组心 (10000, 0)）：火山口 + 螺旋岩台 + 熔岩井（3-2，地形洞）· 熔岩湖 + 岛 + 多条堤道（3-1）
    /// 每块样例都有自动检查（雅丹侧壁坡度、积沙坡、阶地宽、湖面平、螺旋岩台坡度、堤道高出熔岩、坡道坡度、多块接缝、地形洞…），
    /// 报告 Assets/Art/_Review/level_terrain_report.txt；截图 Assets/Art/_Review/terrain_&lt;章&gt;_*（每块一张俯瞰、一张平视，每章一张总图、一张地平线）。
    /// 熔岩面、挡土墙、城墙是白盒占位（L7 LavaField、正式墙模型落地后由各地图替换）。
    /// 生成：Spiritfire ▸ Levels ▸ Build Terrain Gallery，或 bridge.sh level terrain。
    /// </summary>
    [LevelBuilder("terrain", ScenePath)]
    public static class Level_TerrainGallery
    {
        public const string Dir = "Assets/Levels/TerrainGallery";
        public const string ScenePath = "Assets/Scenes/TerrainGallery.unity";

        /// <summary>样例边长、高度场基准（Base 米 = 世界 y 0）、高度范围、边缘回落宽度</summary>
        const float Tile = 256f, Base = 40f, HeightRange = 150f, EdgeFade = 26f;
        const int Res = 513;
        /// <summary>主风向（与 1-1 相同：东北吹向西南）</summary>
        static readonly Vector2 Wind = new Vector2(-0.82f, -0.57f).normalized;

        /// <summary>一块样例：局部坐标（相对样例中心，米）里定义地貌，构建时平移到世界</summary>
        sealed class Specimen
        {
            public string key, title;
            public ShowcaseTheme theme;
            public Vector2 center;
            public Vector2Int tiles = Vector2Int.one;
            public bool fadeEdges = true;
            public Func<Vector2, LevelKit.Sample> eval;
            /// <summary>局部坐标的路距（散布避让），可空</summary>
            public Func<Vector2, float> road;
            public Action<Specimen, Transform> dress;
            public Action<Specimen, Log> check;
            /// <summary>平视机位：眼位、眼高、看向、看向点离地高（局部坐标）</summary>
            public (Vector2 eye, float eyeH, Vector2 look, float lookH) view;
            public LevelKit.TerrainSet set;

            public Vector2 Size => new(Tile * tiles.x, Tile * tiles.y);
            public Vector2 Origin => center - Size * 0.5f;
            public Vector2 W(Vector2 local) => center + local;
            public float Y(Vector2 local) => set.GroundY(center.x + local.x, center.y + local.y);
            public Vector3 G(Vector2 local, float dy = 0) => set.OnGround(center.x + local.x, center.y + local.y, dy);
            public float Slope(Vector2 local) => set.Slope(center + local);
        }

        /// <summary>验收记录（画廊自带，不依赖关卡验收单元的报告格式）</summary>
        sealed class Log
        {
            readonly StringBuilder sb = new();
            public int failures;

            public void Line(string s)
            {
                sb.AppendLine(s);
                Debug.Log($"[Terrain] {s}");
            }

            public void Check(bool ok, string s)
            {
                if (!ok) failures++;
                Line(ok ? $"  ✓ {s}" : $"  ✗ {s}");
            }

            public void Save(string path)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllText(path, sb.ToString());
            }
        }

        /// <summary>一章的光照组（Sun + Global Volume + 天空 / 环境光 / 雾），截图时切换</summary>
        sealed class Look
        {
            public ShowcaseTheme theme;
            public Light sun;
            public GameObject volume;
            public Material sky;
            public Color ambSky, ambEquator, ambGround, fog;
            public float fogStart, fogEnd;
        }

        // ═════════════ 第一章 ═════════════

        static Specimen Yardang()
        {
            // unity-maps-v1 1-2：岩墙 12–25 m 高、走廊 8–12 m——脊距 30、脊宽 18（走廊约 12 m），平均高 17（单条 10–20 m），排得密（0.88）
            var y = new YardangSpec { wind = Wind, spacing = 30, length = 82, width = 18, height = 17, edge = 3.4f, density = 0.88f, meander = 6, seed = 3 };
            return new Specimen
            {
                key = "yardang", title = "雅丹场（1-2 雅丹迷城）", theme = ShowcaseTheme.Desert, center = new Vector2(-160, 160),
                eval = q =>
                {
                    float ground = Base + Fbm(q, 60, 3, 1) * 1.2f;
                    float ry = Yardangs(q, y, out float body, out float top);
                    float corridor = 1 - Smooth(0.02f, 0.25f, body);
                    float ripples = Dunes(q, Wind, 15, 0.9f, 4) * corridor;
                    return new LevelKit.Sample
                    {
                        h = ground + ry + ripples,
                        sand = Mathf.Max(Smooth(0.2f, 0.8f, ripples), 0.55f * Smooth(0.35f, 0.7f, Fbm(q, 26, 2, 9) * 0.5f + 0.5f)) * corridor,
                        packed = top * 0.75f,
                        rock = Smooth(0.05f, 0.35f, body) * (1 - top),
                    };
                },
                view = (new Vector2(-96, -96), 1.62f, new Vector2(10, 4), 7f),
                check = (sp, log) =>
                {
                    // 顶平侧陡：撒点，按岩体遮罩分侧壁 / 顶面统计地形坡度
                    float side = 0, topS = 0;
                    int sideN = 0, topN = 0, cells = 0, ridge = 0;
                    for (float x = -112; x <= 112; x += 2)
                    for (float z = -112; z <= 112; z += 2)
                    {
                        var q = new Vector2(x, z);
                        Yardangs(q, y, out float body, out float top);
                        float slope = sp.Slope(q);
                        cells++;
                        if (body > 0.5f) ridge++;
                        if (top > 0.95f && body > 0.97f)
                        {
                            topS += slope;
                            topN++;
                        }
                        else if (body > 0.25f && body < 0.75f)
                        {
                            side += slope;
                            sideN++;
                        }
                    }
                    side = sideN > 0 ? side / sideN : 0;
                    topS = topN > 0 ? topS / topN : 90;
                    log.Check(sideN > 0 && side >= 40, $"雅丹侧壁平均坡度 {side:F0}°（≥ 40°）");
                    log.Check(topN > 0 && topS <= 14, $"雅丹顶面平均坡度 {topS:F0}°（≤ 14°，顶平）");
                    float share = ridge / (float)cells;
                    log.Check(share > 0.12f && share < 0.6f, $"岩脊占地 {share:P0}（12–60%：留得出走廊）");
                },
            };
        }

        static Specimen BuriedWall()
        {
            var wall = new List<Vector2> { new(-100, 40), new(30, 40), new(30, -100) };
            const float wallH = 7f, half = 3f;
            // 北墙西段只埋墙脚，往东到转角埋到垛口（贴墙沙面高出墙顶 0.8 m，沙坡能走上墙头），东墙往南又退回墙脚
            float Crest(float t) => t < 0.48f ? Mathf.Lerp(1.5f, wallH + 0.8f, t / 0.48f) : Mathf.Lerp(wallH + 0.8f, 2f, (t - 0.48f) / 0.52f);
            float Ground(Vector2 q) => Base + Fbm(q, 55, 3, 2);
            float Drift(Vector2 q) => SandDrift(q, wall, Wind, Crest, 34, 12, half, 12, out _);
            var gate = new Vector2(-40, 40);
            // 穿城古道：城外 → 北墙城门 → 城内，沿积沙后的地面取纵断面、限坡 14°，在积沙上切出一道路堑
            var road = new PathSpline(new[] { new Vector2(-46, 125), new Vector2(-42, 80), gate, new Vector2(-30, 0), new Vector2(-5, -60), new Vector2(10, -125) })
                .FollowGround(q => Ground(q) + Drift(q), 10, 14);
            return new Specimen
            {
                key = "buriedwall", title = "城墙压沙 + 穿城古道（1-3 沉沙古城）", theme = ShowcaseTheme.Desert, center = new Vector2(160, 160),
                road = q => road.Nearest(q, 40).dist,
                eval = q =>
                {
                    float drift = Drift(q);
                    float h = road.Flatten(q, Ground(q) + drift, 3.2f, 4.5f, PathSpline.Mode.Both, out float roadMask);
                    return new LevelKit.Sample
                    {
                        h = h,
                        sand = Mathf.Max(Smooth(0.3f, 1.5f, drift), 0.4f * Smooth(0.4f, 0.75f, Fbm(q, 24, 2, 5) * 0.5f + 0.5f)) * (1 - roadMask),
                        packed = roadMask,
                    };
                },
                dress = (sp, root) =>
                {
                    // 白盒城墙（M13 换正式城墙套件）：放在原地面上，积沙自然埋住墙脚；城门处留 9 m 缺口，两侧门墩
                    var m = LevelKit.Mat(Dir, "RammedEarth", new Color(0.74f, 0.58f, 0.42f));
                    for (int i = 0; i + 1 < wall.Count; i++)
                    {
                        var a = wall[i];
                        var b = wall[i + 1];
                        float len = Vector2.Distance(a, b);
                        var dir = (b - a) / len;
                        for (float s = 0; s < len - 0.5f; s += 10)
                        {
                            float e = Mathf.Min(len, s + 10);
                            var mid = a + dir * ((s + e) / 2);
                            if (Vector2.Distance(mid, gate) < 4.5f + (e - s) / 2) continue;
                            var w = sp.W(mid);
                            LevelKit.Box("City Wall", root, new Vector3(w.x, Ground(mid) - Base, w.y), new Vector3(half * 2, wallH, e - s + 0.02f),
                                Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg, m, 0.8f);
                        }
                    }
                    foreach (int side in new[] { -1, 1 })
                    {
                        var p = sp.W(gate + new Vector2(side * 8.5f, 0));
                        LevelKit.Box("Gate Pier", root, new Vector3(p.x, Ground(gate) - Base, p.y), new Vector3(8, wallH + 2.5f, 8), 0, m, 0.8f);
                    }
                },
                view = (new Vector2(-30, 112), 1.62f, new Vector2(18, 44), 6f),
                check = (sp, log) =>
                {
                    // 转角迎风面的积沙坡：坡顶接近墙高（能走上墙头），坡面不陡于沙的休止角
                    var foot = new Vector2(20, 44);
                    float buried = sp.Y(foot) - (Ground(foot) - Base);
                    log.Check(buried >= wallH - 1f, $"转角迎风面积沙高 {buried:F1} m（墙高 {wallH} m，≥ 墙高 − 1：沙坡能走上墙头）");
                    float worst = SlopeAlong(sp, new[] { foot + Vector2.up * 2, foot + Vector2.up * 34 });
                    log.Check(worst <= 33, $"迎风积沙坡最陡 {worst:F0}°（≤ 33°，沙的休止角附近）");
                    float rs = SlopeAlong(sp, road.points);
                    log.Check(rs <= 24, $"穿城古道最陡 {rs:F0}°（≤ 24°），纵断面限坡 {road.MaxGrade():F0}°");
                },
            };
        }

        static Specimen CaveBowlSpecimen()
        {
            var radius = new Vector2(44, 38);
            const float depth = 18, wallW = 14;
            var sink = new Vector2(-22, -14);
            const float sinkR = 5.5f;
            float Ground(Vector2 q) => Base + Fbm(q, 50, 3, 3);
            // 「转一次弯的下行坡」：从东南口沿外贴着碗壁往下绕约 155°，坡度约 9°，压平（又挖又填）成一条贴壁的坡道
            var ctrl = new List<Vector2>();
            var heights = new List<float>();
            for (int i = 0; i <= 6; i++)
            {
                float s = i / 6f, a = Mathf.Lerp(-70, 85, s) * Mathf.Deg2Rad, rf = Mathf.Lerp(1.42f, 0.93f, s);
                ctrl.Add(new Vector2(Mathf.Cos(a) * radius.x * rf, Mathf.Sin(a) * radius.y * rf));
                heights.Add(Base + Mathf.Lerp(2.5f, -depth + 0.3f, s));
            }
            var ramp = new PathSpline(ctrl, 6).WithHeights(heights.ToArray(), 6);
            float Islands(Vector2 q, out float body)
            {
                float a = Mesa(q, new Vector2(-14, 14), 6, 4.5f, 20, 4, 1.4f, 21), b = Mesa(q, new Vector2(18, -12), 4.5f, 3.5f, 70, 3, 1.2f, 22);
                body = Mathf.Max(Smooth(0.3f, 1.2f, a), Smooth(0.3f, 1.2f, b));
                return a + b;
            }
            return new Specimen
            {
                key = "cavebowl", title = "洞穴碗 + 下行坡道 + 落水洞（1-4 干涸月牙泉）", theme = ShowcaseTheme.Desert, center = new Vector2(-160, -160),
                road = q => ramp.Nearest(q, 40).dist,
                eval = q =>
                {
                    float bowl = CaveBowl(q, Vector2.zero, radius, depth, wallW, 7, 34, 5, out float floor, out float wallMask);
                    float spring = Crescent(q, new Vector2(6, 4), 15, 7, 50, 2) * floor;
                    float isl = Islands(q, out float islBody);
                    float h = Ground(q) + bowl - spring * 1.4f + isl * floor;
                    h = ramp.Flatten(q, h, 3.5f, 3.5f, PathSpline.Mode.Both, out float rampMask);
                    return new LevelKit.Sample
                    {
                        h = h,
                        sand = Mathf.Max(Smooth(0.5f, 4f, bowl), 0.35f * floor * (1 - spring)) * (1 - rampMask),
                        packed = rampMask,
                        fluid = spring,
                        rock = Mathf.Max(wallMask * 0.5f, islBody * floor) * (1 - rampMask),
                        hole = Vector2.Distance(q, sink) < sinkR ? 1 : 0,
                    };
                },
                dress = (sp, root) =>
                {
                    // 落水洞口一圈碎石（洞下面是 1-4 的下层，地图单元接模型）
                    for (int i = 0; i < 6; i++)
                    {
                        float a = i * 60 * Mathf.Deg2Rad;
                        var p = sp.W(sink + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * (sinkR + 1.6f));
                        LevelKit.Prop("SM_Env_DesertSandstone", root, sp.set.At(p.x, p.y), p.x, p.y, i * 47, 0.9f + 0.25f * (i % 3), 0.3f);
                    }
                },
                view = (new Vector2(50, -36), 1.62f, new Vector2(-10, 6), -8f),
                check = (sp, log) =>
                {
                    var hole = sp.W(sink);
                    log.Check(sp.set.IsHole(hole.x, hole.y), "落水洞中心是地形洞（碰撞与渲染都开口）");
                    float worst = SlopeAlong(sp, ramp.points);
                    log.Check(worst <= 24 && ramp.MaxGrade() <= 14, $"下行坡道最陡 {worst:F0}°（地形，≤ 24°），纵断面 {ramp.MaxGrade():F0}°，落差 {heights[0] - heights[^1]:F0} m");
                    float rim = 0;
                    for (int i = 0; i < 36; i++)
                    {
                        float a = i * 10 * Mathf.Deg2Rad;
                        var q = new Vector2(Mathf.Cos(a) * (radius.x + wallW + 3), Mathf.Sin(a) * (radius.y + wallW + 3));
                        rim += sp.Y(q) - (Ground(q) - Base);
                    }
                    rim /= 36;
                    float bottom = sp.Y(new Vector2(0, -20)) - (Ground(new Vector2(0, -20)) - Base);
                    log.Check(rim >= 3 && bottom <= -depth + 1.5f, $"口沿平均高出四周 {rim:F1} m，碗底 {bottom:F1} m（碗深 {depth} m）");
                },
            };
        }

        static Specimen DuneRoad()
        {
            float Ground(Vector2 q) => Base + Dunes(q, Wind, 46, 7, 6, 0.72f) + Fbm(q, 70, 3, 8) * 1.5f;
            // 1-1 古道的做法（PathSpline.FollowGround）：沿线取原地面、±10 m 滑动平均，再限坡 12°；路面 3.2 m 内贴合、6 m 路肩渐变
            var road = new PathSpline(new[] { new Vector2(-118, -70), new Vector2(-60, -30), new Vector2(-10, -8), new Vector2(40, 26), new Vector2(86, 50), new Vector2(120, 78) })
                .FollowGround(Ground, 10, 12);
            return new Specimen
            {
                key = "duneroad", title = "沙丘 + 样条古道（1-1 做法通用化）", theme = ShowcaseTheme.Desert, center = new Vector2(160, -160),
                road = q => road.Nearest(q, 40).dist,
                eval = q =>
                {
                    float dunes = Dunes(q, Wind, 46, 7, 6, 0.72f);
                    float h = road.Flatten(q, Ground(q), 3.2f, 6f, PathSpline.Mode.Both, out float roadMask);
                    float d = road.Nearest(q, 8).dist;
                    float ruts = (1 - Smooth(2.2f, 3.4f, d)) * (1 - (1 - Smooth(0.25f, 0.6f, d)) * 0.45f);
                    return new LevelKit.Sample
                    {
                        h = h,
                        sand = Mathf.Max(Smooth(0.6f, 3.5f, dunes), 0.5f * Smooth(0.4f, 0.7f, Fbm(q, 30, 2, 7) * 0.5f + 0.5f)) * (1 - roadMask * 0.8f),
                        packed = ruts,
                    };
                },
                view = (new Vector2(-70, -40), 1.62f, new Vector2(40, 26), 1.5f),
                check = (sp, log) =>
                {
                    float worst = SlopeAlong(sp, road.points);
                    log.Check(worst <= 24, $"古道穿沙丘最陡 {worst:F0}°（≤ 24°），纵断面限坡 {road.MaxGrade():F0}°，全长 {road.length:F0} m");
                },
            };
        }

        // ═════════════ 第二章 ═════════════

        static Specimen Valley()
        {
            var v = new ValleySpec
            {
                floorHalfWidth = 14, benchWidth = 24, benchWidthRight = 28, stepHeight = 9, riser = 5, benches = 3, wallHeight = 26, wallWidth = 12,
                wobble = 4, seed = 7,
            };
            // 谷轴自西向东爬升 45 m（冰瀑栈道「累计爬升约 45 m」）
            var axis = new PathSpline(new[] { new Vector2(-250, -6), new Vector2(-120, 8), new Vector2(0, -4), new Vector2(120, 6), new Vector2(250, 0) })
                .WithHeights(new[] { 0f, 8, 18, 30, 45 }, 12);
            float Period(bool right) => v.riser + (right ? v.benchWidthRight : v.benchWidth);
            // 第 k 级台面中线的横距（左岸正、右岸负）；k = 0 是谷底
            float Mid(int k, bool right) => k == 0 ? 7 : v.floorHalfWidth + (k - 1) * Period(right) + v.riser + (right ? v.benchWidthRight : v.benchWidth) * 0.5f;
            // 级间坡道（栈道 / 冰坡的地形部分）：每条从 k − 1 级斜爬到 k 级，沿谷向走 70 m，坡度约 12°；左右岸交错，每级至少两条接近路线
            PathSpline Ramp(float x0, float x1, int k, bool right)
            {
                float sgn = right ? -1 : 1;
                Vector2 At(float x, float d) => axis.At((x + 250) / 500) + new Vector2(0, sgn * d);
                float H(float x, int level) => Base + axis.HeightAt((x + 250) / 500) + level * v.stepHeight;
                float d0 = Mid(k - 1, right) + (k == 1 ? 1 : 5), d1 = Mid(k, right) - 5;
                return new PathSpline(new[] { At(x0, d0), At((x0 + x1) / 2, (d0 + d1) / 2), At(x1, d1) }, 6)
                    .WithHeights(new[] { H(x0, k - 1), (H(x0, k - 1) + H(x1, k)) / 2, H(x1, k) });
            }
            var ramps = new[]
            {
                Ramp(-220, -150, 1, false), Ramp(-130, -60, 2, false), Ramp(-30, 40, 1, true), Ramp(60, 130, 2, true), Ramp(140, 210, 3, false),
            };
            return new Specimen
            {
                key = "valley", title = "V 形谷 + 阶地 + 级间坡道（2-1 冰瀑栈道，2 × 1 块地形）", theme = ShowcaseTheme.Frost,
                center = new Vector2(5000, 160), tiles = new Vector2Int(2, 1), fadeEdges = false,
                road = q => ramps.Min(r => r.Nearest(q, 30).dist),
                eval = q =>
                {
                    float rel = TerracedValley(q, axis, v, out float t, out float floor, out float cliff, out float bench);
                    float h = Base + axis.HeightAt(t) + rel;
                    float rampMask = 0;
                    foreach (var r in ramps)
                    {
                        h = r.Flatten(q, h, 3f, 3.5f, PathSpline.Mode.Both, out float m);
                        rampMask = Mathf.Max(rampMask, m);
                    }
                    return new LevelKit.Sample
                    {
                        h = h,
                        fluid = floor * (1 - rampMask),
                        packed = rampMask,
                        rock = cliff * 0.4f * (1 - rampMask),
                        sand = bench * 0.6f * (1 - rampMask),
                    };
                },
                view = (new Vector2(-232, -2), 1.62f, new Vector2(40, 10), 34f),
                check = (sp, log) =>
                {
                    // 横断面（x = −45，离两头的坡道都有 15 m）：找出平台面（坡度 < 7°、高出谷底 4 m 以上的连续段），量宽；
                    // 碰到断面两端的段是绝壁顶上的山体，不算阶地
                    const float tx = -45;
                    var widths = new List<float>();
                    float floorY = sp.Y(axis.At((tx + 250) / 500f));
                    float run = 0;
                    bool fromEnd = true;
                    for (float z = -126; z < 126; z += 0.5f)
                    {
                        float h0 = sp.Y(new Vector2(tx, z)), h1 = sp.Y(new Vector2(tx, z + 0.5f));
                        bool flat = Mathf.Abs(h1 - h0) / 0.5f < Mathf.Tan(7 * Mathf.Deg2Rad) && h0 > floorY + 4;
                        if (flat) run += 0.5f;
                        else
                        {
                            if (run >= 6 && !fromEnd) widths.Add(run);
                            run = 0;
                            fromEnd = false;
                        }
                    }
                    bool ok = widths.Count >= 4 && widths.All(w => w >= 16 && w <= 44);
                    log.Check(ok, $"横断面量到 {widths.Count} 级台面：{string.Join(" / ", widths.Select(w => $"{w:F0}"))} m（20–40 m，阶地边缘有摆动，容差 ±4）");
                    float worst = ramps.Max(r => SlopeAlong(sp, r.points));
                    log.Check(worst <= 24, $"级间坡道 {ramps.Length} 条，地形最陡 {worst:F0}°（≤ 24°），纵断面最陡 {ramps.Max(r => r.MaxGrade()):F0}°");
                    log.Check(Seam(sp.set) < 0.001f, $"两块地形接缝高差 {Seam(sp.set):F4} m");
                },
            };
        }

        static Specimen Lake()
        {
            var radius = new Vector2(80, 62);
            const float level = Base + 1.2f;
            float Islands(Vector2 q) => Mesa(q, new Vector2(22, 12), 10, 7, 20, 2.6f, 2.5f, 31) + Mesa(q, new Vector2(-30, -18), 6, 5, -30, 2.0f, 2, 32);
            return new Specimen
            {
                key = "lake", title = "平湖 + 湖岸 + 岛（2-3 瑶池冰湖）", theme = ShowcaseTheme.Frost, center = new Vector2(4840, -160),
                eval = q =>
                {
                    float ground = Base + 3.5f + Fbm(q, 45, 3, 18) * 4 + Smooth(70, 125, q.magnitude) * 9;
                    float k = LakeShore(q, Vector2.zero, radius, 14, 0.18f, 8, out float lake, out float shore);
                    float h = Mathf.Lerp(level, ground, k);
                    float isl = Islands(q);
                    if (isl > 0) h = Mathf.Max(h, level + isl);
                    float islMask = Smooth(0.05f, 0.5f, isl);
                    return new LevelKit.Sample { h = h, fluid = lake * (1 - islMask), shore = shore * (1 - islMask), sand = 0.7f * (1 - lake) + islMask * 0.8f };
                },
                view = (new Vector2(-96, -44), 1.62f, new Vector2(30, 14), 1f),
                check = (sp, log) =>
                {
                    float worst = 0;
                    int n = 0;
                    for (float x = -100; x <= 100; x += 3)
                    for (float z = -80; z <= 80; z += 3)
                    {
                        var q = new Vector2(x, z);
                        LakeShore(q, Vector2.zero, radius, 14, 0.18f, 8, out float lake, out _);
                        if (lake < 0.999f || Islands(q) > 0.001f) continue;
                        worst = Mathf.Max(worst, Mathf.Abs(sp.Y(q) - (level - Base)));
                        n++;
                    }
                    log.Check(n > 500 && worst < 0.03f, $"湖面 {n * 9} m² 内最大起伏 {worst * 100:F1} cm（< 3 cm，冰面绝对平）");
                },
            };
        }

        static Specimen Stepped()
        {
            var spec = new SteppedSlopeSpec
            {
                origin = new Vector2(0, -96), angle = 90, shelfDepth = 22, stepHeight = 3.6f, wallRun = 1.0f, steps = 7, bend = 6,
                ramps = new[] { (-56f, 5f), (50f, 5f) }, seed = 9,
            };
            float run = spec.steps * (spec.shelfDepth + spec.wallRun), total = spec.steps * spec.stepHeight;
            const float halfWidth = 82;
            return new Specimen
            {
                key = "stepped", title = "阶梯坡 + 挡土墙 + 坡道车道（2-2 昆仑天阙）", theme = ShowcaseTheme.Frost, center = new Vector2(5160, -160),
                road = q =>
                {
                    float best = float.MaxValue;
                    foreach (var (ac, hw) in spec.ramps) best = Mathf.Min(best, Mathf.Abs(-q.x - ac) - hw);
                    return Mathf.Max(0, best);
                },
                eval = q =>
                {
                    float st = SteppedSlope(q, spec, out float across, out float wall, out float shelf, out float ramp);
                    float x = q.y - spec.origin.y;
                    float back = Smooth(run + 8, run + 60, x) * 16;
                    // 两侧山体：顺着同一坡势、比台阶坡高 5–11 m，台阶坡像是切进山里
                    float nat = Mathf.Clamp01(x / run) * total + 5 + Ridged(q, 40, 3, 4) * 6 + back;
                    float lateral = 1 - Smooth(halfWidth, halfWidth + 18, Mathf.Abs(across));
                    return new LevelKit.Sample
                    {
                        h = Base + Mathf.Lerp(nat, st + back, lateral),
                        sand = Mathf.Max(shelf * 0.8f, (1 - lateral) * 0.7f),
                        rock = wall * lateral,
                        packed = ramp * lateral,
                    };
                },
                dress = (sp, root) =>
                {
                    // 白盒挡土墙（M22 换正式墙模型）：盖住每道陡坎，墙顶高出上一级台面 0.9 m 当女墙；坡道车道处断开
                    var m = LevelKit.Mat(Dir, "FrostStone", new Color(0.52f, 0.56f, 0.62f));
                    foreach (var (k, line) in SteppedSlopeWalls(spec, halfWidth - 2, 2))
                    {
                        for (int i = 0; i + 3 < line.Count; i += 3)
                        {
                            var a = line[i];
                            var b = line[i + 3];
                            var mid = sp.W((a + b) / 2);
                            var d = b - a;
                            LevelKit.Box("Retaining Wall", root, new Vector3(mid.x, k * spec.stepHeight, mid.y), new Vector3(1.4f, spec.stepHeight + 0.9f, d.magnitude + 0.05f),
                                Mathf.Atan2(d.x, d.y) * Mathf.Rad2Deg, m, 0.3f);
                        }
                    }
                },
                view = (new Vector2(-20, -112), 1.62f, new Vector2(20, 20), 12f),
                check = (sp, log) =>
                {
                    float lane = 0;
                    foreach (var (ac, _) in spec.ramps)
                        lane = Mathf.Max(lane, SlopeAlong(sp, new[] { new Vector2(-ac, spec.origin.y - 6), new Vector2(-ac, spec.origin.y + run + 6) }));
                    log.Check(lane <= 15, $"坡道车道最陡 {lane:F0}°（≤ 15°，不靠跳能一路上到顶，总高 {total:F1} m）");
                    float steep = 0;
                    int n = 0;
                    foreach (var (_, line) in SteppedSlopeWalls(spec, 60, 6))
                    foreach (var p in line)
                    {
                        float dh = sp.Y(p + Vector2.up * 0.6f) - sp.Y(p - Vector2.up * 0.6f);
                        steep += Mathf.Atan(dh / 1.2f) * Mathf.Rad2Deg;
                        n++;
                    }
                    steep = n > 0 ? steep / n : 0;
                    log.Check(steep >= 55, $"挡土墙处地形平均坡度 {steep:F0}°（≥ 55°：是墙不是坡，玩家上不去，只能走车道）");
                },
            };
        }

        // ═════════════ 第三章 ═════════════

        static Specimen Crater()
        {
            var c = new CraterSpec
            {
                center = Vector2.zero, floorRadius = 20, rimRadius = 78, depth = 36, step = 12, riser = 4, starts = 1, entryAngle = -90,
                rimHeight = 7, rimWidth = 26, seed = 10,
            };
            const float wellR = 8.5f;
            float Ground(Vector2 q) => Base + Fbm(q, 50, 3, 10) * 1.2f;
            return new Specimen
            {
                key = "crater", title = "火山口 + 螺旋岩台 + 熔岩井（3-2 铸神井）", theme = ShowcaseTheme.Inferno, center = new Vector2(9840, 0),
                eval = q =>
                {
                    float cr = SpiralCrater(q, c, out float ledge, out float cliff, out float floor);
                    float d = q.magnitude;
                    return new LevelKit.Sample
                    {
                        h = Ground(q) + cr,
                        packed = ledge * 0.85f,
                        rock = cliff * 0.5f,
                        fluid = floor * (1 - Smooth(wellR + 1, wellR + 7, d)),
                        shore = floor * Smooth(wellR + 1, wellR + 7, d) * (1 - Smooth(wellR + 7, wellR + 12, d)),
                        sand = Smooth(c.rimRadius, c.rimRadius + 8, d) * 0.6f,
                        hole = d < wellR ? 1 : 0,
                    };
                },
                dress = (sp, root) =>
                {
                    // 熔岩井：洞下 5 m 一片发光的熔岩面（白盒，L7 换 LavaField）
                    var lava = LavaMaterial();
                    var w = sp.W(Vector2.zero);
                    var disc = LevelKit.Cylinder("Lava Well (placeholder)", root, new Vector3(w.x, Ground(Vector2.zero) - Base - c.depth - 5, w.y), wellR + 3, 0.2f,
                        Quaternion.identity, lava);
                    Object.DestroyImmediate(disc.GetComponent<Collider>());
                },
                view = (new Vector2(0, -84), 1.62f, new Vector2(0, 10), -30f),
                check = (sp, log) =>
                {
                    var path = SpiralLedgePath(c, out var heights);
                    int onLedge = 0;
                    for (int i = 0; i < path.Count; i++)
                        if (Mathf.Abs(sp.Y(path[i]) - (Ground(path[i]) - Base + heights[i])) < 1.5f) onLedge++;
                    float share = onLedge / (float)path.Count;
                    float worst = SlopeAlong(sp, path.Skip(path.Count / 20).ToList());
                    float len = 0;
                    for (int i = 0; i + 1 < path.Count; i++) len += Vector2.Distance(path[i], path[i + 1]);
                    log.Check(share >= 0.85f, $"螺旋岩台中线 {share:P0} 落在岩台面上（≥ 85%），全长 {len:F0} m，绕 {c.depth / c.step:F0} 圈到坑底");
                    log.Check(worst <= 24, $"螺旋岩台沿线最陡 {worst:F0}°（≤ 24°）");
                    var well = sp.W(Vector2.zero);
                    log.Check(sp.set.IsHole(well.x, well.y), "熔岩井是地形洞");
                },
            };
        }

        static Specimen LavaLakeSpecimen()
        {
            var bowlR = new Vector2(100, 92);
            var spec = new LavaLakeSpec
            {
                center = Vector2.zero, radius = new Vector2(74, 64), level = Base - 11.5f, bedDepth = 1.5f, shore = 9, irregular = 0.15f,
                islands = new[] { (new Vector2(-28, 16), 11f, 4f), (new Vector2(26, -8), 9f, 3.5f), (new Vector2(6, 36), 7f, 5f) },
                causewayHalfWidth = 3.5f, causewayHeight = 1.4f, causewayEdge = 1.8f, seed = 11,
            };
            // 堤道：西岸 → 西岛 → 东岛 → 东南岸；西岛 → 北岛 → 北岸——多条路线，可以被打进熔岩
            spec.causeways = new[]
            {
                new PathSpline(new[] { new Vector2(-86, 4), new Vector2(-56, 10), new Vector2(-36, 14) }, 6),
                new PathSpline(new[] { new Vector2(-20, 12), new Vector2(0, 6), new Vector2(18, -4) }, 6),
                new PathSpline(new[] { new Vector2(34, -14), new Vector2(52, -30), new Vector2(78, -46) }, 6),
                new PathSpline(new[] { new Vector2(-24, 26), new Vector2(-8, 33), new Vector2(2, 34) }, 6),
                new PathSpline(new[] { new Vector2(8, 44), new Vector2(10, 60), new Vector2(12, 80) }, 6),
            };
            float Ground(Vector2 q) => Base + Fbm(q, 45, 3, 11) * 1.2f + CaveBowl(q, Vector2.zero, bowlR, 10, 18, 10, 22, 12, out _, out _);
            return new Specimen
            {
                key = "lavalake", title = "熔岩湖 + 岛 + 堤道（3-1 熔湖堤道）", theme = ShowcaseTheme.Inferno, center = new Vector2(10160, 0),
                road = q => spec.causeways.Min(cw => cw.Nearest(q, 30).dist),
                eval = q =>
                {
                    CaveBowl(q, Vector2.zero, bowlR, 10, 18, 10, 22, 12, out float floor, out _);
                    float h = LavaLake(q, Ground(q), spec, out float lava, out float shore, out float cw, out float isl);
                    return new LevelKit.Sample
                    {
                        h = h,
                        fluid = lava,
                        shore = shore * (1 - cw),
                        packed = cw * Smooth(0.6f, 0.95f, cw),
                        rock = Mathf.Max(isl * 0.3f, cw * (1 - Smooth(0.6f, 0.95f, cw))),
                        sand = (1 - floor) * 0.5f,
                    };
                },
                dress = (sp, root) =>
                {
                    var w = sp.W(Vector2.zero);
                    var disc = LevelKit.Cylinder("Lava Lake (placeholder)", root, new Vector3(w.x, spec.level - Base, w.y), 92, 0.2f, Quaternion.identity, LavaMaterial());
                    Object.DestroyImmediate(disc.GetComponent<Collider>());
                },
                view = (new Vector2(-86, 4), 1.62f, new Vector2(20, -4), 0f),
                check = (sp, log) =>
                {
                    float lowest = float.MaxValue, worst = 0;
                    foreach (var cw in spec.causeways)
                    {
                        worst = Mathf.Max(worst, SlopeAlong(sp, cw.points));
                        for (float t = 0; t <= 1; t += 0.02f) lowest = Mathf.Min(lowest, sp.Y(cw.At(t)) - (spec.level - Base));
                    }
                    log.Check(lowest >= 1.0f, $"堤道 {spec.causeways.Length} 条，最低处高出熔岩面 {lowest:F2} m（≥ 1 m）");
                    log.Check(worst <= 14, $"堤道沿线最陡 {worst:F0}°（≤ 14°）");
                    int under = 0, n = 0;
                    for (float x = -80; x <= 80; x += 3)
                    for (float z = -70; z <= 70; z += 3)
                    {
                        var q = new Vector2(x, z);
                        LavaLake(q, Ground(q), spec, out float lava, out _, out _, out _);
                        if (lava < 0.99f) continue;
                        n++;
                        if (sp.Y(q) < spec.level - Base - 0.5f) under++;
                    }
                    log.Check(n > 0 && under >= n * 0.98f, $"熔岩面下的湖床 {under}/{n} 点低于熔岩面 0.5 m 以上（地形不露出熔岩）");
                    foreach (var (ic, _, ih) in spec.islands)
                        log.Check(sp.Y(ic) - (spec.level - Base) >= ih * 0.8f, $"岛 ({ic.x:F0}, {ic.y:F0}) 顶高出熔岩面 {sp.Y(ic) - (spec.level - Base):F1} m");
                },
            };
        }

        // ═════════════ 构建 ═════════════

        [MenuItem("Spiritfire/Levels/Build Terrain Gallery", priority = 81)]
        public static void BuildMenu() => Build(true);

        /// <summary>生成画廊场景 → 检查 → 截图；返回不合格项数</summary>
        public static int Build(bool review)
        {
            ShowcaseSceneBuilder.ConfigureProject();
            Directory.CreateDirectory(Dir);
            LevelKit.ResetCache();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var log = new Log();
            log.Line("地貌画廊 · L4 地形库 / 地表 / 散布 / 远景");

            var chapters = new (ShowcaseTheme theme, Vector2 center, Specimen[] specimens)[]
            {
                (ShowcaseTheme.Desert, new Vector2(0, 0), new[] { Yardang(), BuriedWall(), CaveBowlSpecimen(), DuneRoad() }),
                (ShowcaseTheme.Frost, new Vector2(5000, 0), new[] { Valley(), Lake(), Stepped() }),
                (ShowcaseTheme.Inferno, new Vector2(10000, 0), new[] { Crater(), LavaLakeSpecimen() }),
            };

            // 每章一组光照（BuildLighting 各建一套 Sun / Global Volume / 天空，截图时只开当前章的）
            var looks = chapters.Select(c => MakeLook(c.theme)).ToList();
            var cam = BuildCamera();
            var layers = new Dictionary<string, TerrainLayer[]>();

            foreach (var (theme, groupCenter, specimens) in chapters)
            {
                var group = new GameObject($"Chapter {theme.key}").transform;
                if (!layers.ContainsKey(theme.key)) layers[theme.key] = TerrainTextureGen.ForChapter(theme.key);
                log.Line("");
                log.Line($"══ {theme.title} ══");
                foreach (var sp in specimens)
                {
                    var root = new GameObject($"Specimen {sp.key}").transform;
                    root.SetParent(group, false);
                    sp.set = LevelKit.BuildTerrainSet(new LevelKit.TerrainSpec
                    {
                        dir = Dir, name = $"Gallery_{sp.key}", size = sp.Size, origin = sp.Origin, baseHeight = Base, heightRange = HeightRange,
                        heightRes = Res, splatRes = 512, tiles = sp.tiles, ground = LevelKit.Ground.For(theme), layers = layers[theme.key],
                        eval = WorldEval(sp),
                    }, root);
                    sp.dress?.Invoke(sp, root);
                    Func<Vector2, float> road = sp.road == null ? null : p => sp.road(p - sp.center);
                    var counts = LevelKit.ScatterDetails(sp.set, LevelKit.ScatterPresets.Details(theme.key), road, 1f, 200f);
                    var props = LevelKit.ScatterProps(sp.set, root, LevelKit.ScatterPresets.Boulders(theme.key), new Rect(sp.Origin + Vector2.one * 20, sp.Size - Vector2.one * 40), 9f, road);
                    Report(sp, log, counts, props.Count);
                }
                // 远景：地平线色 = 本章雾色；远景地面在雾里接上远景环的环脚
                var env = new GameObject($"Environment {theme.key}").transform;
                env.SetParent(group, false);
                var backdrop = LevelKit.BackdropFor(theme, Dir, $"Gallery_{theme.key}", groupCenter, 0, 1000, 3);
                LevelKit.Backdrop(backdrop, env);
                var first = specimens[0];
                LevelKit.FarGround(Dir, $"Gallery_{theme.key}", env, new Rect(first.Origin + Vector2.one * 40, first.Size - Vector2.one * 80), -0.3f, theme.groundA, 2400);
                log.Line($"远景环 {backdrop.rings.Length} 圈（{backdrop.rings[0].radius:F0} – {backdrop.rings[^1].radius:F0} m），地平线色 = 雾色 {ColorUtility.ToHtmlStringRGB(theme.fogColor)}");
            }

            Activate(looks[0], looks);
            EditorSceneManager.SaveScene(scene, ScenePath);
            ShowcaseSceneBuilder.BakeEnvironmentLighting(ShowcaseTheme.Desert, Dir);
            EditorSceneManager.SaveScene(scene, ScenePath);

            log.Line("");
            log.Line(log.failures == 0 ? "全部通过" : $"不合格 {log.failures} 项");
            log.Save($"{LevelKit.ReviewDir}/level_terrain_report.txt");

            if (review)
            {
                for (int i = 0; i < chapters.Length; i++)
                {
                    var (theme, gc, specimens) = chapters[i];
                    Activate(looks[i], looks);
                    var shots = new List<(string name, Vector3 pos, Vector3 target, bool fog)>
                    {
                        ("Map", new Vector3(gc.x, 820, gc.y - 1), new Vector3(gc.x, 0, gc.y), false),
                        ("Horizon", new Vector3(gc.x - 40, 26, gc.y - 360), new Vector3(gc.x + 60, 60, gc.y + 1100), true),
                    };
                    foreach (var sp in specimens)
                    {
                        var c3 = sp.G(Vector2.zero);
                        float span = Mathf.Max(sp.Size.x, sp.Size.y);
                        shots.Add(($"Aerial_{sp.key}", c3 + new Vector3(-0.45f * span, 0.55f * span, -0.62f * span), c3, false));
                        var (eye, eyeH, look, lookH) = sp.view;
                        shots.Add(($"Eye_{sp.key}", sp.G(eye, eyeH), sp.G(look, lookH), true));
                    }
                    Capture(cam, $"terrain_{theme.key.ToLowerInvariant()}", shots);
                }
                Activate(looks[0], looks);
            }
            EditorSceneManager.SaveScene(scene, ScenePath);
            return log.failures;
        }

        /// <summary>局部 eval → 世界 eval；样例边缘 EdgeFade 米内落回 Base（世界 y 0，接远景地面）</summary>
        static Func<Vector2, LevelKit.Sample> WorldEval(Specimen sp)
        {
            var half = sp.Size * 0.5f;
            return p =>
            {
                var q = p - sp.center;
                var s = sp.eval(q);
                if (!sp.fadeEdges) return s;
                float f = Smooth(0, EdgeFade, Mathf.Min(half.x - Mathf.Abs(q.x), half.y - Mathf.Abs(q.y)));
                s.h = Mathf.Lerp(Base, s.h, f);
                return s;
            };
        }

        /// <summary>沿折线每米取地形高，最陡的一米（度）</summary>
        static float SlopeAlong(Specimen sp, IReadOnlyList<Vector2> pts)
        {
            float worst = 0;
            for (int i = 0; i + 1 < pts.Count; i++)
            {
                var a = pts[i];
                var b = pts[i + 1];
                float len = Vector2.Distance(a, b);
                for (float s = 0; s < len; s += 1f)
                {
                    var p = Vector2.Lerp(a, b, s / len);
                    var q = Vector2.Lerp(a, b, Mathf.Min(1, (s + 1f) / len));
                    float run = Vector2.Distance(p, q);
                    if (run < 0.3f) continue;
                    worst = Mathf.Max(worst, Mathf.Atan(Mathf.Abs(sp.Y(q) - sp.Y(p)) / run) * Mathf.Rad2Deg);
                }
            }
            return worst;
        }

        /// <summary>多块地形相邻边的高度图最大差（应为 0：整张高度场一次求值，边上的格点是同一个样本）</summary>
        static float Seam(LevelKit.TerrainSet set)
        {
            float worst = 0;
            for (int j = 0; j < set.tilesZ; j++)
            for (int i = 0; i + 1 < set.tilesX; i++)
            {
                var a = set.tiles[j * set.tilesX + i].terrainData;
                var b = set.tiles[j * set.tilesX + i + 1].terrainData;
                int res = a.heightmapResolution;
                for (int z = 0; z < res; z++) worst = Mathf.Max(worst, Mathf.Abs(a.GetHeight(res - 1, z) - b.GetHeight(0, z)));
            }
            return worst;
        }

        /// <summary>一块样例的概况：尺寸、高差、各层占比、散布个数，再跑它自己的检查</summary>
        static void Report(Specimen sp, Log log, Dictionary<string, int> details, int props)
        {
            var (lo, hi) = sp.set.hf.Range();
            var share = new float[4];
            string[] names = null;
            foreach (var t in sp.set.tiles)
            {
                var td = t.terrainData;
                names ??= td.terrainLayers.Select(l => l ? l.name.Replace("TL_", "") : "?").ToArray();
                int n = td.alphamapResolution;
                var a = td.GetAlphamaps(0, 0, n, n);
                for (int z = 0; z < n; z += 2)
                for (int x = 0; x < n; x += 2)
                for (int l = 0; l < Mathf.Min(4, td.alphamapLayers); l++)
                    share[l] += a[z, x, l];
            }
            float total = share.Sum();
            log.Line($"【{sp.title}】{sp.tiles.x} × {sp.tiles.y} 块，{sp.Size.x:F0} × {sp.Size.y:F0} m，高度 {lo - Base:F1} … {hi - Base:F1} m");
            log.Line($"  地表：{string.Join("、", names.Select((nm, l) => $"{nm} {share[l] / Mathf.Max(1e-4f, total):P0}"))}");
            log.Line($"  散布：{string.Join("、", details.Select(kv => $"{kv.Key} {kv.Value}"))}，大件 {props}");
            sp.check?.Invoke(sp, log);
        }

        static Material lavaMat;

        /// <summary>熔岩占位材质（StylizedLit 自发光橙）：L7 的 LavaField 落地前，截图里看得出熔岩在哪</summary>
        static Material LavaMaterial()
        {
            if (lavaMat) return lavaMat;
            var m = new Material(Shader.Find("Spiritfire/StylizedLit")) { name = "M_WB_LavaPlaceholder" };
            m.SetColor("_BaseColor", new Color(0.9f, 0.32f, 0.08f));
            m.SetFloat("_Metallic", 0);
            m.SetFloat("_Roughness", 0.55f);
            m.EnableKeyword("_EMISSION");
            m.SetColor("_EmissionColor", new Color(1f, 0.36f, 0.08f) * 2.2f);
            LevelKit.SaveAsset(m, $"{Dir}/M_WB_LavaPlaceholder.mat");
            return lavaMat = m;
        }

        // ───────────── 光照组、相机、截图 ─────────────

        static Look MakeLook(ShowcaseTheme t)
        {
            ShowcaseSceneBuilder.BuildLighting(t, Dir);
            var sun = RenderSettings.sun;
            sun.gameObject.name = $"Sun ({t.key})";
            var volume = Object.FindObjectsByType<Volume>(FindObjectsInactive.Exclude).First(v => !v.name.Contains("("));
            volume.gameObject.name = $"Global Volume ({t.key})";
            return new Look
            {
                theme = t, sun = sun, volume = volume.gameObject, sky = RenderSettings.skybox,
                ambSky = RenderSettings.ambientSkyColor, ambEquator = RenderSettings.ambientEquatorColor, ambGround = RenderSettings.ambientGroundColor,
                fog = RenderSettings.fogColor, fogStart = RenderSettings.fogStartDistance, fogEnd = RenderSettings.fogEndDistance,
            };
        }

        static void Activate(Look look, IEnumerable<Look> all)
        {
            foreach (var l in all)
            {
                l.sun.gameObject.SetActive(l == look);
                l.volume.SetActive(l == look);
            }
            RenderSettings.sun = look.sun;
            RenderSettings.skybox = look.sky;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = look.ambSky;
            RenderSettings.ambientEquatorColor = look.ambEquator;
            RenderSettings.ambientGroundColor = look.ambGround;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = look.fog;
            RenderSettings.fogStartDistance = look.fogStart;
            RenderSettings.fogEndDistance = look.fogEnd;
        }

        static Camera BuildCamera()
        {
            var go = new GameObject("Gallery Camera") { tag = "MainCamera" };
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 55;
            cam.nearClipPlane = 0.3f;
            cam.farClipPlane = 2600;
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;
            return cam;
        }

        /// <summary>按机位截 1920 × 1080；fog = false 的高空机位临时关雾（几百米外全被雾吞掉）。每张渲两遍，第一遍让着色器编完</summary>
        static void Capture(Camera cam, string prefix, List<(string name, Vector3 pos, Vector3 target, bool fog)> shots)
        {
            Directory.CreateDirectory(LevelKit.ReviewDir);
            var rt = new RenderTexture(1920, 1080, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
            var shot = new Texture2D(1920, 1080, TextureFormat.RGB24, false);
            bool fogWas = RenderSettings.fog, asyncWas = ShaderUtil.allowAsyncCompilation;
            foreach (var ps in Object.FindObjectsByType<ParticleSystem>()) ps.Simulate(14f, true, true);
            try
            {
                ShaderUtil.allowAsyncCompilation = false;
                cam.targetTexture = rt;
                for (int pass = 0; pass < 2; pass++)
                for (int i = 0; i < shots.Count; i++)
                {
                    var (name, pos, target, fog) = shots[i];
                    RenderSettings.fog = fogWas && fog;
                    cam.transform.SetPositionAndRotation(pos, Quaternion.LookRotation(target - pos));
                    cam.Render();
                    if (pass == 0) continue;
                    RenderTexture.active = rt;
                    shot.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
                    shot.Apply();
                    RenderTexture.active = null;
                    string path = $"{LevelKit.ReviewDir}/{prefix}_{i + 1:00}_{name}.png";
                    File.WriteAllBytes(path, shot.EncodeToPNG());
                    Debug.Log($"[Review] {path}");
                }
            }
            finally
            {
                ShaderUtil.allowAsyncCompilation = asyncWas;
                RenderSettings.fog = fogWas;
                cam.targetTexture = null;
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(shot);
            }
        }
    }
}
