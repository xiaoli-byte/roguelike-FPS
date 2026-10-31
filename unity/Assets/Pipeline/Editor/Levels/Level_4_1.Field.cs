using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using N = Spiritfire.Art.Editor.Levels.LevelKit.PlateauNoise;
using Path = Spiritfire.Art.Editor.Levels.LevelKit.PlateauPath;

namespace Spiritfire.Art.Editor.Levels
{
    // 4-1 的数据（网页 src/world/plateau/spec.ts，网页坐标：x 向东、z 向南）与高度场（terrain.ts 的逐式移植）。构建流程在 Level_4_1.cs
    public static partial class Level_4_1
    {
        // ───────────────────────────── 网页 spec（网页坐标）─────────────────────────────

        /// <summary>盆地轮廓：轮廓以内都能走（除了陡崖和深水），轮廓以外是环山</summary>
        static readonly (double x, double z)[] BasinPoly =
        {
            (-305, 165), (-255, 240), (-120, 258), (40, 252), (185, 238), (282, 172), (308, 40), (292, -92),
            (262, -168), (165, -238), (40, -252), (-92, -246), (-212, -212), (-292, -122), (-312, 20),
        };

        /// <summary>环山缺口：垭口与河流出口</summary>
        static readonly (double x, double z, double r, double k)[] RingNotches = { (262, -185, 48, 0.8), (-312, 152, 34, 0.65) };

        const double TiltAx = 0.028, TiltAz = -0.032, TiltX0 = -300, TiltZ0 = 250, TiltC = -3;

        sealed class Hill
        {
            public string id;
            public double x, z, rx, rz, rot, h, top = 0.5, ramp;
            public bool mesa, rocky;
            public double? rampDir;
        }

        static readonly Hill[] Hills =
        {
            new() { id = "spur", x = -185, z = -35, rx = 62, rz = 46, rot = 0.45, h = 20, mesa = true, top = 0.55, rampDir = Math.PI / 4, ramp = 1.6, rocky = true },
            new() { id = "flagHill", x = 90, z = -70, rx = 74, rz = 66, rot = 0.2, h = 32 },
            new() { id = "hillA", x = -60, z = -95, rx = 42, rz = 32, rot = 0.6, h = 13 },
            new() { id = "hillB", x = 178, z = 172, rx = 48, rz = 36, rot = -0.3, h = 12 },
            new() { id = "hillC", x = 20, z = 160, rx = 40, rz = 30, rot = 0.2, h = 9 },
            new() { id = "hillD", x = -172, z = 148, rx = 34, rz = 24, rot = 0.5, h = 9 },
            new() { id = "hillE", x = -248, z = 40, rx = 34, rz = 52, rot = 0, h = 12 },
            new() { id = "hillF", x = 228, z = 82, rx = 40, rz = 34, rot = 0.3, h = 10 },
            new() { id = "moraineW", x = 6, z = -212, rx = 10, rz = 34, rot = 0.15, h = 7, rocky = true },
            new() { id = "moraineE", x = 76, z = -212, rx = 10, rz = 34, rot = -0.15, h = 7, rocky = true },
        };

        static readonly (string id, double ax, double az, double bx, double bz, double hA, double hB, double halfWidth, double core)[] Ridges =
        {
            ("passRamp", 216, -40, 256, -182, 0, 24, 80, 0.35),
            ("northRidge", 92, -216, 236, -192, 12, 25, 24, 0.35),
        };

        /// <summary>冰川：沿 snout → top 的 U 形谷，冰面向北抬升；冰舌末端是一道冰崖</summary>
        const double GlSx = 40, GlSz = -203, GlTx = 58, GlTz = -330, GlHalf = 34, GlCliff = 11;
        /// <summary>
        /// 冰面抬升（Unity 改，maps/4-1.md 3.1）：网页每米 0.33（≈ 18°）；冰舌末端往里 55 m 内只抬 0.12（飞廉擂台在这一段，冲撞 / 风推在缓坡上读得清），之后再按 0.33 抬
        /// </summary>
        static double GlacierRise(double along)
        {
            if (along <= 0) return 0;
            double u = along - 55, k = 6;
            return 0.12 * along + 0.21 * ((u + Math.Sqrt(u * u + k * k)) * 0.5);
        }

        sealed class Lake
        {
            public string id;
            public double x, z, rx, rz, rot, depth;
            public (double x, double z, double r, double h)? island;
        }

        static readonly Lake[] Lakes =
        {
            new() { id = "holy", x = -140, z = -150, rx = 48, rz = 32, rot = 0.25, depth = 4, island = (-152, -153, 7, 1.6) },
            new() { id = "glacial", x = 40, z = -186, rx = 18, rz = 12, rot = 0, depth = 2.5 },
        };

        static readonly (double x, double z)[] RiverPoints =
        {
            (40, -172), (34, -150), (22, -128), (14, -104), (-2, -84), (-6, -62), (-20, -44), (-24, -22), (-38, -2),
            (-36, 20), (-48, 40), (-52, 58), (-66, 72), (-78, 88), (-98, 96), (-118, 110), (-138, 112), (-160, 124),
            (-182, 120), (-204, 132), (-228, 134), (-250, 146), (-272, 144), (-296, 154), (-318, 152), (-350, 158),
        };

        const double ChannelHalf = 2.6, ChannelDepth = 1.3, ValleyFloorHalf = 7, ValleyDepth = 4.5, ValleySide = 0.55;
        const double RoadHalf = 3, TrailHalf = 1.2, SnowLine = 78;

        static readonly (double x, double z, bool terrace)[] RoadNodes =
        {
            (-262, 214, false), (-232, 200, false), (-195, 186, false), (-160, 174, false), (-122, 156, false),
            (-86, 134, false), (-50, 112, false), (-20, 94, false), (10, 90, false), (45, 98, false),
            (80, 106, false), (112, 110, false), (140, 108, false), (172, 98, false), (198, 72, false),
            (213, 34, false), (219, -4, false), (222, -38, true),
            (268, -54, false), (277, -63, false), (270, -73, true),
            (214, -86, false), (205, -95, false), (213, -105, true),
            (266, -116, false), (275, -125, false), (267, -135, true),
            (224, -146, false), (219, -156, false), (232, -167, false), (252, -178, false), (282, -192, false), (314, -205, false),
        };

        static readonly (string id, (double x, double z)[] points)[] Trails =
        {
            ("白塔—碉楼寨", new (double, double)[] { (-34, 70), (-60, 54), (-95, 36), (-128, 16), (-150, 2), (-166, -16), (-182, -30) }),
            ("碉楼寨—圣湖", new (double, double)[] { (-192, -52), (-182, -84), (-162, -108), (-128, -116) }),
            ("圣湖—冰川口", new (double, double)[] { (-96, -152), (-52, -170), (-12, -180), (18, -188) }),
            ("白塔—经幡山头", new (double, double)[] { (-22, 62), (10, 32), (40, -4), (62, -36), (84, -62) }),
            ("经幡山头—冰川口", new (double, double)[] { (88, -84), (76, -120), (64, -150), (60, -172) }),
            ("营地—经幡山头", new (double, double)[] { (136, 104), (130, 62), (118, 20), (104, -20), (94, -56) }),
            ("山脊高路", new (double, double)[] { (72, -194), (100, -212), (150, -208), (200, -198), (238, -184) }),
        };

        sealed class Site
        {
            public string id, name, title;
            public double x, z, r;
            public (double x, double z)? altar;
            public (double x, double y, double z) mark;
            public bool exit, spawn;
        }

        static readonly Site[] Sites =
        {
            new() { id = "spawn", name = "出生 · 道班", title = "道班", x = -262, z = 214, r = 18, mark = (-272, 4, 224), spawn = true },
            new() { id = "s1", name = "① 碉楼寨", title = "碉楼寨", x = -185, z = -32, r = 45, altar = (-188, -38), mark = (-200, 24, -52) },
            new() { id = "s2", name = "② 白塔溪谷", title = "白塔溪谷", x = -30, z = 64, r = 40, altar = (-18, 60), mark = (-28, 12, 58) },
            new() { id = "s3", name = "③ 牧民营地", title = "牧民营地", x = 140, z = 125, r = 45, altar = (140, 132), mark = (152, 3, 140) },
            new() { id = "s4", name = "④ 圣湖海子", title = "圣湖海子", x = -135, z = -148, r = 62, altar = (-96, -144), mark = (-152, 5, -153) },
            new() { id = "s5", name = "⑤ 冰川口", title = "冰川口", x = 42, z = -186, r = 40, altar = (64, -178), mark = (40, 10, -203) },
            new() { id = "s6", name = "⑥ 经幡山头", title = "经幡山头", x = 90, z = -70, r = 35, altar = (82, -62), mark = (90, 9, -70) },
            new() { id = "pass", name = "⑦ 垭口（出口）", title = "垭口", x = 252, z = -178, r = 30, mark = (272, 7, -186), exit = true },
        };

        static Site SiteById(string id) => Sites.First(s => s.id == id);

        /// <summary>点亮几处灵火开出口</summary>
        const int FiresToUnlock = 3;

        static readonly (string name, double x, double z, double r)[] Pois =
        {
            ("温泉", 12, -122, 16), ("残碉", 20, 158, 22), ("塔林", -96, -168, 14), ("修行洞", -150, -203, 14), ("盘山天路", 242, -95, 45), ("山脊高路", 160, -208, 40),
        };

        static readonly (double x, double z, double r)[] Fields = { (-142, 12, 24) };
        static readonly (double x, double z, double r)[] DirtSpots = { (-268, 220, 12), (140, 124, 26), (-186, -34, 18), (250, -178, 12) };

        /// <summary>贡嘎（地形里压低环山的视窗按它的原位置算，和网页一致；远景网格搬进远裁面，见 Level_4_1.BuildBackdrop）</summary>
        const double GonggaX = 430, GonggaZ = -1550, GonggaH = 950, GonggaR = 1100;
        /// <summary>风场：基础风向（网页 (1, 0.35)）+ 飞廉巢穴（网页 (40, −228)）的吸引，300 m 外 0、30 m 内 1</summary>
        const double WindBx = 1, WindBz = 0.35, WindLx = 40, WindLz = -228, WindRadius = 300;

        // ───────────────────────────── 地貌：网页 terrain.ts ─────────────────────────────

        static double Smooth(double a, double b, double x) => N.Smooth(a, b, x);

        static (double dx, double dz, double strength) WindAt(double x, double z)
        {
            double bl = Math.Sqrt(WindBx * WindBx + WindBz * WindBz), bx = WindBx / bl, bz = WindBz / bl;
            double tx = WindLx - x, tz = WindLz - z;
            double d = Math.Sqrt(tx * tx + tz * tz);
            if (d <= 0) d = 1;
            double strength = Smooth(WindRadius, 30, d);
            double k = Math.Min(1, strength * 1.6);
            double dx = bx + (tx / d - bx) * k, dz = bz + (tz / d - bz) * k;
            double l = Math.Sqrt(dx * dx + dz * dz);
            if (l <= 0) l = 1;
            return (dx / l, dz / l, strength);
        }

        static double GonggaWindow(double x, double z, double ox = 0, double oz = 0, double near = 200, double width = 60, double spread = 0.28, double ramp = 250)
        {
            double L = Math.Sqrt((GonggaX - ox) * (GonggaX - ox) + (GonggaZ - oz) * (GonggaZ - oz));
            double ux = (GonggaX - ox) / L, uz = (GonggaZ - oz) / L;
            double vx = x - ox, vz = z - oz;
            double along = vx * ux + vz * uz;
            if (along <= near) return 0;
            double perp = Math.Abs(vx * uz - vz * ux);
            double q = perp / (width + along * spread);
            return Math.Exp(-(q * q)) * Smooth(near, near + ramp, along);
        }

        const double PassViewX = 252, PassViewZ = -178;
        static double PassWindow(double x, double z) => GonggaWindow(x, z, PassViewX, PassViewZ, -6, 24, 0.32, 30);

        static double RingAmp(double x, double z)
        {
            double a = Math.Atan2(z, x);
            double north = Math.Max(0, -Math.Sin(a)), south = Math.Max(0, Math.Sin(a)), west = Math.Max(0, -Math.Cos(a));
            double A = 0.85 + 0.85 * Math.Pow(north, 1.5) + 0.25 * west - 0.15 * south;
            foreach (var n in RingNotches) A *= 1 - n.k * Math.Exp(-((x - n.x) * (x - n.x) + (z - n.z) * (z - n.z)) / (n.r * n.r));
            A *= 1 - 0.75 * PassWindow(x, z);
            return A * (1 + 0.3 * (N.Fbm(x * 0.01, z * 0.01, 3, 9) - 0.5));
        }

        static double RingFoot(double d)
        {
            double s = d * d / (d + 6);
            return 16 * (1 - Math.Exp(-s / 18));
        }

        static double RingMain(double d) => 78 * (1 - Math.Exp(-Math.Max(0, d - 26) / 45)) + 0.15 * Math.Max(0, d - 50);

        static double Tilt(double x, double z) => TiltAx * (x - TiltX0) + TiltAz * (z - TiltZ0) + TiltC;

        static double HillsAt(double x, double z)
        {
            double h = 0;
            foreach (var hl in Hills)
            {
                double dx = x - hl.x, dz = z - hl.z;
                double c = Math.Cos(hl.rot), s = Math.Sin(hl.rot);
                double lx = (dx * c + dz * s) / hl.rx, lz = (-dx * s + dz * c) / hl.rz;
                double r = Math.Sqrt(lx * lx + lz * lz);
                if (hl.ramp != 0 && hl.rampDir.HasValue)
                {
                    double f = Math.Max(0, Math.Cos(Math.Atan2(dz, dx) - hl.rampDir.Value));
                    r /= 1 + (hl.ramp - 1) * f * f;
                }
                if (r >= 1) continue;
                h += !hl.mesa ? hl.h * Math.Pow(1 - r * r, 1.6) : hl.h * (1 - Smooth(hl.top, 1, r));
            }
            return h;
        }

        static double RidgesAt(double x, double z)
        {
            double h = 0;
            foreach (var rg in Ridges)
            {
                double d = Path.SegDist(x, z, rg.ax, rg.az, rg.bx, rg.bz, out double t);
                if (d >= rg.halfWidth) continue;
                h = Math.Max(h, (rg.hA + (rg.hB - rg.hA) * t) * (1 - Smooth(rg.halfWidth * rg.core, rg.halfWidth, d)));
            }
            return h * (1 - 0.85 * PassWindow(x, z));
        }

        /// <summary>宏观地貌（没有湖、河、路）；ice = 冰川冰面权重，dOut = 到盆地轮廓的有符号距离</summary>
        static double MacroHeight(double x, double z, out double ice, out double dOut)
        {
            double b = Tilt(x, z) + (N.Fbm(x * 0.007, z * 0.007, 3, 3) - 0.5) * 18 + (N.Fbm(x * 0.016, z * 0.016, 3, 6) - 0.5) * 7
                       + (N.Fbm(x * 0.03, z * 0.03, 2, 4) - 0.5) * 2.5;
            double h = b + HillsAt(x, z) + RidgesAt(x, z);
            dOut = Path.PolygonDistance(x, z, BasinPoly);
            double ring = 0;
            if (dOut > 0)
            {
                double A = RingAmp(x, z);
                double pw = PassWindow(x, z);
                double footK = (0.8 + 0.3 * N.Fbm(x * 0.02, z * 0.02, 2, 8)) * (1 - 0.6 * pw);
                double spur = 0.65 + 0.7 * N.Ridged(x * 0.009 + 13, z * 0.009 - 7, 3, 41);
                double g0 = 1 - N.Ridged(x * 0.03 + 5, z * 0.03 - 9, 2, 42);
                double gully = g0 * g0 * 9 * Smooth(28, 60, dOut);
                ring = footK * RingFoot(dOut) + A * (RingMain(dOut) * spur - gully) + A * (N.Ridged(x * 0.018, z * 0.018, 4, 5) - 0.45) * 22 * Smooth(20, 60, dOut);
            }
            double L = Math.Sqrt((GlTx - GlSx) * (GlTx - GlSx) + (GlTz - GlSz) * (GlTz - GlSz));
            double ux = (GlTx - GlSx) / L, uz = (GlTz - GlSz) / L;
            double along = (x - GlSx) * ux + (z - GlSz) * uz;
            double dg = Math.Abs((x - GlSx) * uz - (z - GlSz) * ux);
            ice = 0;
            if (along > -4 && dg < GlHalf + 24)
            {
                double w = 1 - Smooth(GlHalf * 0.7, GlHalf + 24, dg);
                double iceH = b + GlCliff * Smooth(0, 3, along) + GlacierRise(along);
                double withRing = h + ring;
                h = withRing + (Math.Max(iceH, h) - withRing) * w * Smooth(-4, 0, along);
                ice = w * Smooth(0, 2.5, along) * (1 - Smooth(GlHalf * 0.75, GlHalf, dg));
                return h;
            }
            return h + ring;
        }

        /// <summary>
        /// 4-1 的高度场（网页 Terrain 的移植，网页坐标）：宏观地貌 → 湖盆 → 河谷与河床 → 天路（限坡、盘山挡土墙台地）→ 牧道 → 挡土墙段 / 木桥 → 上色（四层权重）。
        /// 网格比网页细一倍（0.5 m），工序和参数照搬
        /// </summary>
        sealed class Basin : LevelKit.PlateauGrid
        {
            public readonly float[] ice, wGrass, wSoil, wSnow, wRock, fluid, shore, grassDensity;
            public readonly List<LevelKit.PlateauPathSample> road, river;
            public readonly List<List<LevelKit.PlateauPathSample>> trails;
            public readonly double[] riverBed, riverWater, valleyFloor;
            public readonly List<double> lakeLevel = new();
            public readonly List<(double x, double z, double yaw, double len, double bottom, double top, double thick, bool cut)> walls = new();
            public readonly List<(double x, double z, double yaw, double deckY, double len, double width, bool road)> bridges = new();
            readonly float[] roadDist, roadT, riverDist, trailDist, trailE;
            readonly int[] roadIdx, riverIdx;
            sbyte[] upSide;
            double[] shelf;

            public Basin(double min, double max, double step) : base(min, max, min, max, step)
            {
                int n = nx * nz;
                ice = new float[n];
                wGrass = new float[n];
                wSoil = new float[n];
                wSnow = new float[n];
                wRock = new float[n];
                fluid = new float[n];
                shore = new float[n];
                grassDensity = new float[n];
                road = Path.SmoothRoad(RoadNodes);
                trails = Trails.Select(t => Path.SmoothLine(t.points, 1.5)).ToList();
                river = Path.SmoothLine(RiverPoints, 2);
                riverBed = new double[river.Count];
                riverWater = new double[river.Count];
                valleyFloor = new double[river.Count];
                roadDist = Fill(n, float.PositiveInfinity);
                roadT = new float[n];
                roadIdx = new int[n];
                riverDist = Fill(n, float.PositiveInfinity);
                riverIdx = new int[n];
                trailDist = Fill(n, float.PositiveInfinity);
                trailE = new float[n];
                Array.Fill(roadIdx, -1);
                Array.Fill(riverIdx, -1);
            }

            static float[] Fill(int n, float v)
            {
                var a = new float[n];
                Array.Fill(a, v);
                return a;
            }

            public void Generate()
            {
                StampPaths();
                GenerateMacro();
                CarveLakes();
                CarveRiver();
                ProfileRoad();
                TerraceInfo();
                CarveRoad();
                CarveTrails();
                ComputeWalls();
                FindBridges();
                Paint();
            }

            void Stamp(List<LevelKit.PlateauPathSample> path, double R, Action<int, double, int, double> onHit)
            {
                for (int s = 0; s < path.Count - 1; s++)
                {
                    var a = path[s];
                    var b = path[s + 1];
                    int i0 = Math.Max(0, (int)Math.Floor((Math.Min(a.x, b.x) - R - minX) / step)), i1 = Math.Min(nx - 1, (int)Math.Ceiling((Math.Max(a.x, b.x) + R - minX) / step));
                    int j0 = Math.Max(0, (int)Math.Floor((Math.Min(a.z, b.z) - R - minZ) / step)), j1 = Math.Min(nz - 1, (int)Math.Ceiling((Math.Max(a.z, b.z) + R - minZ) / step));
                    for (int j = j0; j <= j1; j++)
                    for (int i = i0; i <= i1; i++)
                    {
                        double d = Path.SegDist(X(i), Z(j), a.x, a.z, b.x, b.z, out double t);
                        if (d <= R) onHit(Idx(i, j), d, s, t);
                    }
                }
            }

            void StampPaths()
            {
                Stamp(road, 16, (k, d, s, t) =>
                {
                    if (!(d < roadDist[k])) return;
                    roadDist[k] = (float)d;
                    roadIdx[k] = s;
                    roadT[k] = (float)t;
                });
                Stamp(river, 60, (k, d, s, t) =>
                {
                    if (!(d < riverDist[k])) return;
                    riverDist[k] = (float)d;
                    riverIdx[k] = s + (t > 0.5 ? 1 : 0);
                });
            }

            void GenerateMacro()
            {
                Parallel.For(0, nz, j =>
                {
                    for (int i = 0; i < nx; i++)
                    {
                        int k = Idx(i, j);
                        h[k] = (float)MacroHeight(X(i), Z(j), out double ic, out double dOut);
                        ice[k] = (float)ic;
                        basin[k] = (float)dOut;
                    }
                });
            }

            /// <summary>湖面 = 湖岸一圈最低点再低 0.6 m；碗形湖底，湖心岛另外抬起</summary>
            void CarveLakes()
            {
                foreach (var L in Lakes)
                {
                    double c = Math.Cos(L.rot), s = Math.Sin(L.rot);
                    double level = double.MaxValue;
                    for (int a = 0; a < 40; a++)
                    {
                        double ang = a / 40.0 * Math.PI * 2;
                        double lx = Math.Cos(ang) * L.rx * 1.12, lz = Math.Sin(ang) * L.rz * 1.12;
                        level = Math.Min(level, HeightAt(L.x + lx * c - lz * s, L.z + lx * s + lz * c));
                    }
                    level -= 0.6;
                    lakeLevel.Add(level);
                    double R = Math.Max(L.rx, L.rz) * 1.35;
                    int i0 = Math.Max(0, (int)Math.Floor((L.x - R - minX) / step)), i1 = Math.Min(nx - 1, (int)Math.Ceiling((L.x + R - minX) / step));
                    int j0 = Math.Max(0, (int)Math.Floor((L.z - R - minZ) / step)), j1 = Math.Min(nz - 1, (int)Math.Ceiling((L.z + R - minZ) / step));
                    for (int j = j0; j <= j1; j++)
                    for (int i = i0; i <= i1; i++)
                    {
                        double dx = X(i) - L.x, dz = Z(j) - L.z;
                        double r = Math.Sqrt(Math.Pow((dx * c + dz * s) / L.rx, 2) + Math.Pow((-dx * s + dz * c) / L.rz, 2));
                        if (r > 1.3) continue;
                        int k = Idx(i, j);
                        double target = r < 1 ? level - L.depth * Math.Pow(1 - r * r, 0.7) : level + (r - 1) / 0.3 * 2.5;
                        h[k] = (float)Math.Min(h[k], target);
                        if (L.island is { } isl)
                        {
                            double d = Math.Sqrt((X(i) - isl.x) * (X(i) - isl.x) + (Z(j) - isl.z) * (Z(j) - isl.z));
                            if (d < isl.r) h[k] = (float)Math.Max(h[k], level + isl.h * (1 - (d / isl.r) * (d / isl.r)) - 0.2);
                        }
                    }
                }
            }

            /// <summary>河谷：谷底沿程单调下降，两侧 0.55 坡度接回草甸；河床再下沉 1.3 m</summary>
            void CarveRiver()
            {
                var S = river;
                var vf = new double[S.Count];
                for (int i = 0; i < S.Count; i++)
                {
                    var p = S[i];
                    double nX = -p.tz, nZ = p.tx;
                    vf[i] = Math.Min(HeightAt(p.x, p.z), Math.Min(HeightAt(p.x + nX * 10, p.z + nZ * 10), HeightAt(p.x - nX * 10, p.z - nZ * 10))) - ValleyDepth;
                }
                vf[0] = Math.Min(vf[0], lakeLevel[1] - 0.2);
                for (int i = 1; i < vf.Length; i++) vf[i] = Math.Min(vf[i], vf[i - 1] - 0.006);
                var sm = (double[])vf.Clone();
                for (int i = 2; i < vf.Length - 2; i++) sm[i] = (vf[i - 2] + vf[i - 1] + vf[i] + vf[i + 1] + vf[i + 2]) / 5;
                for (int i = 1; i < sm.Length; i++) sm[i] = Math.Min(sm[i], sm[i - 1] - 0.004);
                Array.Copy(sm, valleyFloor, sm.Length);
                for (int i = 0; i < S.Count; i++)
                {
                    riverBed[i] = sm[i] - ChannelDepth;
                    riverWater[i] = riverBed[i] + 0.85;
                }
                Parallel.For(0, h.Length, k =>
                {
                    double d = riverDist[k];
                    if (float.IsInfinity(riverDist[k]) || riverIdx[k] < 0) return;
                    int i = Math.Min(S.Count - 1, riverIdx[k]);
                    double valley = sm[i] + Math.Max(0, d - ValleyFloorHalf) * ValleySide;
                    double channel = riverBed[i] + Math.Max(0, d - ChannelHalf) * 0.5;
                    h[k] = (float)Math.Min(h[k], Math.Min(valley, channel));
                });
            }

            /// <summary>天路高程：沿线地形做滑动平均，再双向限坡 10%</summary>
            void ProfileRoad()
            {
                var R = road;
                var raw = R.Select(p => HeightAt(p.x, p.z)).ToArray();
                var avg = new double[raw.Length];
                for (int i = 0; i < raw.Length; i++)
                {
                    double s = 0;
                    int n = 0;
                    for (int k = Math.Max(0, i - 8); k <= Math.Min(raw.Length - 1, i + 8); k++)
                    {
                        s += raw[k];
                        n++;
                    }
                    avg[i] = s / n;
                }
                const double g = 0.1;
                for (int i = 1; i < avg.Length; i++)
                {
                    double ds = R[i].s - R[i - 1].s;
                    avg[i] = Math.Min(Math.Max(avg[i], avg[i - 1] - g * ds), avg[i - 1] + g * ds);
                }
                for (int i = avg.Length - 2; i >= 0; i--)
                {
                    double ds = R[i + 1].s - R[i].s;
                    avg[i] = Math.Min(Math.Max(avg[i], avg[i + 1] - g * ds), avg[i + 1] + g * ds);
                }
                for (int i = 0; i < R.Count; i++) R[i].e = avg[i];
            }

            /// <summary>盘山路：靠山一侧台地抬高「两折高差的一半」（最多 2.4 m），路边就是一道挡土墙</summary>
            void TerraceInfo()
            {
                var R = road;
                upSide = new sbyte[R.Count];
                shelf = new double[R.Count];
                for (int i = 0; i < R.Count; i++)
                {
                    var p = R[i];
                    if (!p.terrace) continue;
                    double nX = -p.tz, nZ = p.tx;
                    int side = HeightAt(p.x + nX * 7, p.z + nZ * 7) > HeightAt(p.x - nX * 7, p.z - nZ * 7) ? 1 : -1;
                    double qx = p.x + nX * side * 16, qz = p.z + nZ * side * 16;
                    double best = double.MaxValue, upE = p.e;
                    foreach (var r in R)
                    {
                        if (Math.Abs(r.s - p.s) < 25) continue;
                        double d = Math.Sqrt((r.x - qx) * (r.x - qx) + (r.z - qz) * (r.z - qz));
                        if (d < best)
                        {
                            best = d;
                            upE = r.e;
                        }
                    }
                    if (best > 9) continue;
                    upSide[i] = (sbyte)side;
                    shelf[i] = Math.Min(2.4, Math.Max(0, (upE - p.e) * 0.5));
                }
            }

            double RoadEAt(int k)
            {
                int s = roadIdx[k];
                var a = road[s];
                var b = road[Math.Min(road.Count - 1, s + 1)];
                return a.e + (b.e - a.e) * roadT[k];
            }

            void CarveRoad()
            {
                const double hw = RoadHalf;
                Parallel.For(0, nz, j =>
                {
                    for (int i = 0; i < nx; i++)
                    {
                        int k = Idx(i, j);
                        double rd = roadDist[k];
                        if (!(rd < hw + 7.5)) continue;
                        int si = roadIdx[k];
                        var p = road[si];
                        double e = RoadEAt(k) - 0.06;
                        bool terrace = p.terrace;
                        double flat = hw + (terrace ? 0.8 : 0), end = terrace ? hw + 1.6 : hw + 3.5;
                        double hh = h[k];
                        if (rd <= flat) hh = e;
                        else if (rd < end) hh = e + (hh - e) * Smooth(flat, end, rd);
                        if (terrace && rd > flat)
                        {
                            double wh = shelf[si];
                            int side = (X(i) - p.x) * -p.tz + (Z(j) - p.z) * p.tx >= 0 ? 1 : -1;
                            if (wh > 0.3 && side == upSide[si]) hh = Math.Max(hh, e + wh * (1 - Smooth(hw + 3.5, hw + 7, rd)));
                        }
                        h[k] = (float)hh;
                    }
                });
            }

            /// <summary>牧道：沿线地形滑动平均后轻压（只削掉横坡），河槽和湖里不压</summary>
            void CarveTrails()
            {
                const double hw = TrailHalf;
                foreach (var T in trails)
                {
                    var raw = T.Select(p => HeightAt(p.x, p.z)).ToArray();
                    for (int i = 0; i < T.Count; i++)
                    {
                        double s = 0;
                        int n = 0;
                        for (int k = Math.Max(0, i - 5); k <= Math.Min(raw.Length - 1, i + 5); k++)
                        {
                            s += raw[k];
                            n++;
                        }
                        T[i].e = s / n;
                    }
                    // Unity 改（maps/4-1.md 3.1）：牧道纵坡双向限到 0.62（≈ 32°）。网页的牧道只削横坡，碉楼寨台地北缘那一段顺着 50° 的崖下去，
                    // 人走不了；限坡后这几处在崖边削出一道坡道（其余路段本来就缓，不变）
                    const double tg = 0.62;
                    for (int i = 1; i < T.Count; i++)
                    {
                        double ds = T[i].s - T[i - 1].s;
                        T[i].e = Math.Min(Math.Max(T[i].e, T[i - 1].e - tg * ds), T[i - 1].e + tg * ds);
                    }
                    for (int i = T.Count - 2; i >= 0; i--)
                    {
                        double ds = T[i + 1].s - T[i].s;
                        T[i].e = Math.Min(Math.Max(T[i].e, T[i + 1].e - tg * ds), T[i + 1].e + tg * ds);
                    }
                    var TT = T;
                    Stamp(T, hw + 2.6, (k, d, s, t) =>
                    {
                        if (!(d < trailDist[k])) return;
                        trailDist[k] = (float)d;
                        trailE[k] = (float)(TT[s].e + (TT[Math.Min(TT.Count - 1, s + 1)].e - TT[s].e) * t);
                    });
                }
                Parallel.For(0, nz, j =>
                {
                    for (int i = 0; i < nx; i++)
                    {
                        int k = Idx(i, j);
                        double d = trailDist[k];
                        if (!(d < hw + 2.6) || riverDist[k] < 7 || roadDist[k] < RoadHalf + 1) continue;
                        if (WaterLevelAt(X(i), Z(j)) > h[k]) continue;
                        double w = d <= hw ? 0.85 : 0.85 * (1 - Smooth(hw, hw + 2.6, d));
                        h[k] = (float)(h[k] + (trailE[k] - 0.04 - h[k]) * w);
                    }
                });
            }

            void ComputeWalls()
            {
                const double hw = RoadHalf;
                var R = road;
                for (int i = 0; i < R.Count - 1; i++)
                {
                    var a = R[i];
                    var b = R[i + 1];
                    if (!a.terrace) continue;
                    double mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, e = (a.e + b.e) / 2;
                    double len = Math.Sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z)) + 0.04;
                    double nX = -a.tz, nZ = a.tx;
                    double yaw = Math.Atan2(a.tx, a.tz);
                    foreach (int side in new[] { 1, -1 })
                    {
                        double hp = HeightAt(mx + nX * side * (hw + 1.7), mz + nZ * side * (hw + 1.7));
                        double diff = hp - e;
                        if (diff > 0.7)
                            walls.Add((mx + nX * side * (hw + 0.35), mz + nZ * side * (hw + 0.35), yaw, len, e - 0.4, Math.Min(hp + 0.15, e + 4.5), 1.9, true));
                        else if (diff < -0.8)
                            walls.Add((mx + nX * side * (hw + 0.2), mz + nZ * side * (hw + 0.2), yaw, len, hp - 0.6, e + 0.6, 0.6, false));
                    }
                }
            }

            /// <summary>天路 / 牧道与河的交点：木桥，桥面在河谷底上 0.3 m</summary>
            void FindBridges()
            {
                var S = river;
                var paths = new List<(List<LevelKit.PlateauPathSample> P, bool road)> { (road, true) };
                paths.AddRange(trails.Select(t => (t, false)));
                foreach (var (P, isRoad) in paths)
                    for (int i = 0; i < P.Count - 1; i++)
                    for (int j = 0; j < S.Count - 1; j++)
                    {
                        var a = P[i];
                        var b = P[i + 1];
                        var c = S[j];
                        var d = S[j + 1];
                        double den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
                        if (Math.Abs(den) < 1e-9) continue;
                        double t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den;
                        double u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
                        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
                        bridges.Add((a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, Math.Atan2(a.tx, a.tz), valleyFloor[j] + 0.3, 13, isRoad ? 6.5 : 3.2, isRoad));
                    }
            }

            /// <summary>水面高度（湖或河）；没有水返回 −∞</summary>
            public double WaterLevelAt(double x, double z)
            {
                for (int n = 0; n < Lakes.Length; n++)
                {
                    var L = Lakes[n];
                    double dx = x - L.x, dz = z - L.z, c = Math.Cos(L.rot), s = Math.Sin(L.rot);
                    if (Math.Sqrt(Math.Pow((dx * c + dz * s) / L.rx, 2) + Math.Pow((-dx * s + dz * c) / L.rz, 2)) < 1.15) return lakeLevel[n];
                }
                int gi = I(x), gj = J(z);
                if (!Inside(gi, gj)) return double.NegativeInfinity;
                int k = Idx(gi, gj);
                if (riverDist[k] < ChannelHalf + 2.2 && riverIdx[k] >= 0) return riverWater[Math.Min(river.Count - 1, riverIdx[k])];
                return double.NegativeInfinity;
            }

            public double WaterDepthAt(double x, double z) => Math.Max(0, WaterLevelAt(x, z) - HeightAt(x, z));

            /// <summary>到天路中线的距离（米；16 m 外为 ∞）</summary>
            public double RoadDistance(double x, double z)
            {
                int i = I(x), j = J(z);
                return Inside(i, j) ? roadDist[Idx(i, j)] : double.PositiveInfinity;
            }

            public double TrailDistance(double x, double z)
            {
                int i = I(x), j = J(z);
                return Inside(i, j) ? trailDist[Idx(i, j)] : double.PositiveInfinity;
            }

            public (double d, double e, int i) RoadNearest(double x, double z)
            {
                (double d, double e, int i) best = (double.MaxValue, 0, 0);
                for (int i = 0; i < road.Count - 1; i++)
                {
                    var a = road[i];
                    var b = road[i + 1];
                    double d = Path.SegDist(x, z, a.x, a.z, b.x, b.z, out double t);
                    if (d < best.d) best = (d, a.e + (b.e - a.e) * t, i);
                }
                return best;
            }

            /// <summary>
            /// 上色 → 四层权重：按网页 paint() 的顺序叠（每一步 = 往目标层 lerp），草甸 → 梯田 → 裸土 → 岩 → 雪 → 冰川 → 风刮条纹 → 天路 → 牧道 → 河床 → 湖岸。
            /// 另记水（fluid）、岸带（shore）、长草程度（grassDensity：草甸权重 × 陡坡淡出）
            /// </summary>
            void Paint()
            {
                Parallel.For(0, nz, j =>
                {
                    for (int i = 0; i < nx; i++)
                    {
                        int k = Idx(i, j);
                        double x = X(i), z = Z(j), hh = h[k];
                        double gx = (h[Idx(Math.Min(nx - 1, i + 1), j)] - h[Idx(Math.Max(0, i - 1), j)]) / (2 * step);
                        double gz = (h[Idx(i, Math.Min(nz - 1, j + 1))] - h[Idx(i, Math.Max(0, j - 1))]) / (2 * step);
                        double slope = Math.Atan(Math.Sqrt(gx * gx + gz * gz));
                        double dOut = basin[k];
                        double n1 = N.Fbm(x * 0.02, z * 0.02, 3, 11), n2 = N.Fbm(x * 0.09, z * 0.09, 2, 12);
                        double g = 1, so = 0, sn = 0, ro = 0;
                        void Lerp(int layer, double t)
                        {
                            if (t <= 0) return;
                            t = Math.Min(1, t);
                            g *= 1 - t;
                            so *= 1 - t;
                            sn *= 1 - t;
                            ro *= 1 - t;
                            switch (layer)
                            {
                                case 0: g += t; break;
                                case 1: so += t; break;
                                case 2: sn += t; break;
                                default: ro += t; break;
                            }
                        }
                        // 草甸的黄绿斑（网页 grassYellow，低频 n1）：四层里没有黄草，掺一点土石层压成黄绿
                        if (dOut < 20) Lerp(1, Smooth(0.45, 0.75, n1) * 0.22);
                        foreach (var f in Fields)
                        {
                            double d = Math.Sqrt((x - f.x) * (x - f.x) + (z - f.z) * (z - f.z));
                            if (d < f.r) Lerp(1, (1 - Smooth(f.r * 0.7, f.r, d)) * 0.45);
                        }
                        foreach (var s in DirtSpots)
                        {
                            double d = Math.Sqrt((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z));
                            if (d < s.r) Lerp(1, (1 - Smooth(s.r * 0.35, s.r, d)) * (0.55 + 0.45 * n2) * 0.8);
                        }
                        double rock = Smooth(0.72, 0.95, slope);
                        if (slope > 0.5) rock = Math.Max(rock, Smooth(0.6, 0.74, N.Fbm(x * 0.05 + 3, z * 0.05, 3, 18)) * Smooth(0.5, 0.75, slope));
                        if (dOut > 12) rock = Math.Max(rock, Smooth(0.64, 0.8, N.Fbm(x * 0.04, z * 0.04, 3, 15)) * Smooth(12, 35, dOut) * 0.85);
                        Lerp(3, rock);
                        double north = N.Clamp01(-gz * 0.5);
                        double line = SnowLine + (N.Fbm(x * 0.012, z * 0.012, 3, 16) - 0.5) * 22 - north * 10;
                        double snow = Smooth(line - 3, line + 5, hh) * (1 - Smooth(0.9, 1.2, slope));
                        Lerp(2, snow);
                        double ic = ice[k];
                        Lerp(2, ic);
                        var ws = WindAt(x, z);
                        if (ws.strength > 0.25)
                        {
                            double across = x * -ws.dz + z * ws.dx;
                            double streak = Smooth(0.55, 0.95, Math.Sin(across * 1.1 + N.Fbm(x * 0.08, z * 0.08, 2, 23) * 5) * 0.5 + 0.5);
                            double kk = streak * Smooth(0.25, 0.9, ws.strength) * 0.55;
                            Lerp(snow > 0.3 || ic > 0.3 ? 2 : 1, kk);
                        }
                        double rd = roadDist[k];
                        if (rd < RoadHalf + 1.4) Lerp(1, Smooth(RoadHalf + 1.4, RoadHalf - 0.4, rd));
                        double td = trailDist[k];
                        if (td < TrailHalf + 0.8) Lerp(1, Smooth(TrailHalf + 0.8, TrailHalf - 0.5, td + (n2 - 0.5) * 0.8) * 0.85);
                        double rvd = riverDist[k];
                        if (rvd < ChannelHalf + 2.2) Lerp(1, Smooth(ChannelHalf + 2.2, ChannelHalf - 0.5, rvd));
                        double water = WaterLevelAt(x, z);
                        double depth = double.IsNegativeInfinity(water) ? double.NegativeInfinity : water - hh;
                        if (!double.IsNegativeInfinity(water) && rvd >= ChannelHalf + 2.2 && depth > -0.6) Lerp(1, Smooth(-0.6, 0.2, depth));
                        wGrass[k] = (float)g;
                        wSoil[k] = (float)so;
                        wSnow[k] = (float)sn;
                        wRock[k] = (float)ro;
                        fluid[k] = depth > 0.05 ? 1 : 0;
                        shore[k] = depth > -0.8 && depth <= 0.05 ? 1 : 0;
                        grassDensity[k] = (float)(g * (1 - Smooth(0.6, 0.85, slope)));
                    }
                });
            }

            /// <summary>放掉只在生成时用的大数组之外没什么可放的：路 / 牧道距离在散布时还要用</summary>
            public (float lo, float hi) Range()
            {
                float lo = float.MaxValue, hi = float.MinValue;
                foreach (float v in h)
                {
                    lo = Mathf.Min(lo, v);
                    hi = Mathf.Max(hi, v);
                }
                return (lo, hi);
            }
        }
    }
}
