using System;
using System.IO;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 地形：地貌函数 → Unity Terrain（高度图、分层图、洞、风格化地形材质），可多块拼接，分层按章节。归 L4。
    public static partial class LevelKit
    {
        /// <summary>地貌求值结果：高度（米）+ 分层规则要用的各个分量（都由同一个纯函数给出，高度图与分层图严格对齐）</summary>
        public struct Sample
        {
            public float h;
            /// <summary>
            /// 各层的原始倾向 0–1（分层规则在 <see cref="Splat"/> 里按章节合成）：
            /// sand = 软覆盖（沙 / 雪 / 灰），packed = 路面、台顶、河床（夯土 / 冻土 / 踩出的灰路），gravelBias 预留
            /// </summary>
            public float sand, packed, gravelBias;
            /// <summary>强制岩石（雅丹、台地侧壁之外的岩体，如远景岩丘）</summary>
            public float rock;
            /// <summary>流体面：湖、河、熔岩床（戈壁 → 龟裂夯土，冰原 → 冰，火狱 → 结壳熔岩）</summary>
            public float fluid;
            /// <summary>岸带（湖岸、熔岩岸）</summary>
            public float shore;
            /// <summary>&gt; 0.5 = 挖洞（洞口、熔岩井）：写进 TerrainData 的 holes，碰撞与渲染都开口，洞下面放模型 / 熔岩</summary>
            public float hole;
        }

        /// <summary>分层规则的上下文：都从高度场算，跨地块连续</summary>
        public struct SplatContext
        {
            /// <summary>坡度（度）</summary>
            public float slope;
            /// <summary>高度场值（米，含 baseHeight）与它在整张地形里的相对高度（0 最低 – 1 最高）</summary>
            public float height, relHeight;
            /// <summary>凹度（米）：正 = 凹（谷底、坡脚），负 = 凸（脊、台沿），半径见 <see cref="TerrainSpec.curvatureRadius"/></summary>
            public float concavity;
        }

        /// <summary>分层规则：样本 + 上下文 → 四层权重（和为 1），层序见 TerrainTextureGen 的章节层说明</summary>
        public delegate Vector4 SplatRule(in Sample s, in SplatContext c);

        /// <summary>章节地表：四层贴图 + 分层规则 + 暗部色。新地图用 <c>TerrainSpec.ground = Ground.For(theme)</c></summary>
        public sealed class Ground
        {
            public string key;
            public Func<TerrainLayer[]> layers;
            public SplatRule rule;
            public Color shadowTint;
            public float macroStrength = 0.2f;
            /// <summary>第 4 层（岩）侧面三平面投影的尺寸（米 / 张）</summary>
            public float rockScale = 8f;
            /// <summary>
            /// 四层与宏观色斑都按法线三平面投影 + 崖面岩层去重复（着色器的 _STEEP_TRIPLANAR）。不开 = 只有第 4 层三平面（戈壁、火狱原样）。
            /// rockWarp = 扭曲噪声推岩层 UV 的幅度（单位：一张岩层贴图），rockDetile = 第二个尺度的岩块调明暗的强度
            /// </summary>
            public bool steepTriplanar;
            public float rockWarp, rockDetile;
            /// <summary>
            /// 崖面光照用平滑法线（米，0 = 不用）：整张高度场按这个半径模糊后求法线，烘成每块地形一张法线图，陡坡上光照改用它。
            /// 近乎竖直的崖壁上，地图给崖线加的水平扰动（几米一个波）在高度场里是一道道上下贯通的竖褶，
            /// 卡通光照一照就成了一根根亮 / 暗竖条；平滑法线把几米的竖褶从光照里抹掉，几十米的大起伏留着（轮廓不变）。
            /// lightNormalBlend = 陡坡上换成平滑法线的比例
            /// </summary>
            public float lightNormalRadius, lightNormalBlend;

            public static readonly Ground Desert = new()
            {
                key = "Desert", layers = TerrainTextureGen.Desert, rule = Splat.Desert, shadowTint = ShowcaseTheme.Desert.groundShadowTint,
            };

            public static readonly Ground Frost = new()
            {
                key = "Frost", layers = TerrainTextureGen.Frost, rule = Splat.Frost, shadowTint = ShowcaseTheme.Frost.groundShadowTint, macroStrength = 0.14f,
                // 冰原的崖面又高又连成圈：岩层一张 16 m（与 FrostRock 的 tileSize 一致），四层三平面投影（雪 / 冻土挂在陡坡上不拉成竖条），岩层去重复
                rockScale = 16f, steepTriplanar = true, rockWarp = 0.3f, rockDetile = 0.45f,
                lightNormalRadius = 3f, lightNormalBlend = 0.75f,
            };

            public static readonly Ground Inferno = new()
            {
                key = "Inferno", layers = TerrainTextureGen.Inferno, rule = Splat.Inferno, shadowTint = ShowcaseTheme.Inferno.groundShadowTint, macroStrength = 0.24f,
            };

            public static Ground For(ShowcaseTheme t) => For(t?.key);

            public static Ground For(string key) => key switch { "Frost" => Frost, "Inferno" => Inferno, _ => Desert };
        }

        public sealed class TerrainSpec
        {
            public string dir, name;
            public Vector2 size;
            /// <summary>地形左下角的世界 XZ（关卡坐标 = 世界坐标）</summary>
            public Vector2 origin;
            /// <summary>高度场里的 0 对应世界 y = -baseHeight（让挖下去的河床、盆地也在 0 以上）</summary>
            public float baseHeight, heightRange = 48;
            /// <summary>每块地形的高度图分辨率（2ⁿ + 1）与分层图分辨率</summary>
            public int heightRes = 1025, splatRes = 1024;
            /// <summary>四层贴图；不给时取 <see cref="ground"/> 的</summary>
            public TerrainLayer[] layers;
            public Func<Vector2, Sample> eval;
            /// <summary>暗部色；不给时取 <see cref="ground"/> 的，再没有用戈壁默认</summary>
            public Color? shadowTint;
            /// <summary>章节地表（层 + 规则 + 暗部色）；不给 = 戈壁（1-1、测试场的老写法）</summary>
            public Ground ground;
            /// <summary>分层规则（覆盖 ground 的）；不给时取 ground 的，再没有用 <see cref="Splat.Desert"/></summary>
            public SplatRule splat;
            /// <summary>
            /// 地块数（X × Z）：size 平分成这么多块 Terrain，每块 heightRes / splatRes，互为邻居（LOD 接缝对齐）。
            /// 新地图用正方形地块（size.x / tiles.x = size.y / tiles.y），坡度才是精确值（见 <see cref="HeightField.Slope"/>）
            /// </summary>
            public Vector2Int tiles = Vector2Int.one;
            /// <summary>凹度的取样半径（米）</summary>
            public float curvatureRadius = 4f;
        }

        /// <summary>一张关卡地形：所有地块 + 整张高度场（跨地块连续）+ 规格；按世界 XZ 取地块、地面高、法线、坡度</summary>
        public sealed class TerrainSet
        {
            public TerrainSpec spec;
            public Terrain[] tiles;
            public int tilesX, tilesZ;
            public HeightField hf;

            public Terrain First => tiles[0];
            public Vector2 TileSize => new(spec.size.x / tilesX, spec.size.y / tilesZ);
            public Rect Area => new(spec.origin, spec.size);

            public Terrain At(float x, float z)
            {
                var ts = TileSize;
                int i = Mathf.Clamp(Mathf.FloorToInt((x - spec.origin.x) / ts.x), 0, tilesX - 1);
                int j = Mathf.Clamp(Mathf.FloorToInt((z - spec.origin.y) / ts.y), 0, tilesZ - 1);
                return tiles[j * tilesX + i];
            }

            public float GroundY(float x, float z) => LevelKit.GroundY(At(x, z), x, z);
            public Vector3 OnGround(float x, float z, float dy = 0) => new(x, GroundY(x, z) + dy, z);

            /// <summary>世界 XZ 处的地面法线</summary>
            public Vector3 Normal(float x, float z)
            {
                var t = At(x, z);
                var size = t.terrainData.size;
                var o = t.transform.position;
                return t.terrainData.GetInterpolatedNormal((x - o.x) / size.x, (z - o.z) / size.z);
            }

            /// <summary>高度场坡度（度，世界 XZ）</summary>
            public float Slope(Vector2 p)
            {
                var i = hf.Index(p - spec.origin);
                return hf.Slope(i.x, i.y);
            }

            /// <summary>高度场凹度（米，世界 XZ）</summary>
            public float Concavity(Vector2 p, float radius = 4f)
            {
                var i = hf.Index(p - spec.origin);
                return hf.Concavity(i.x, i.y, Mathf.Max(1, Mathf.RoundToInt(radius / hf.Cell.x)));
            }

            /// <summary>世界 XZ 处是不是地形洞</summary>
            public bool IsHole(float x, float z)
            {
                var t = At(x, z);
                var td = t.terrainData;
                var o = t.transform.position;
                int n = td.holesResolution;
                int hx = Mathf.Clamp(Mathf.FloorToInt((x - o.x) / td.size.x * n), 0, n - 1);
                int hz = Mathf.Clamp(Mathf.FloorToInt((z - o.z) / td.size.z * n), 0, n - 1);
                return td.IsHole(hx, hz);
            }
        }

        /// <summary>单块地形（老接口，1-1 / 测试场用）：多块时返回左下角那块，hf 是整张高度场</summary>
        public static Terrain BuildTerrain(TerrainSpec s, Transform parent, out HeightField hf)
        {
            var set = BuildTerrainSet(s, parent);
            hf = set.hf;
            return set.First;
        }

        /// <summary>
        /// 生成地形：整张高度场一次求值（地块接缝处的坡度、凹度连续），再切成 tiles.x × tiles.y 块 Terrain，
        /// 各自写高度、分层图（按章节规则）、洞，配一份风格化地形材质，最后互设邻居。
        /// 单块时资产 / 物体名与以前完全相同（TD_名、M_Terrain_名、Terrain_名），1-1 原样重建；多块时加 _i_j 后缀。
        /// </summary>
        public static TerrainSet BuildTerrainSet(TerrainSpec s, Transform parent)
        {
            int tx = Mathf.Max(1, s.tiles.x), tz = Mathf.Max(1, s.tiles.y);
            bool single = tx == 1 && tz == 1;
            int res = s.heightRes;
            int gx = tx * (res - 1) + 1, gz = tz * (res - 1) + 1;
            var layers = s.layers ?? s.ground?.layers?.Invoke() ?? TerrainTextureGen.Desert();
            var rule = s.splat ?? s.ground?.rule ?? Splat.Desert;
            var tint = s.shadowTint ?? s.ground?.shadowTint ?? new Color(0.7f, 0.64f, 0.82f);

            var hf = new HeightField(s.size, gx, gz);
            var samples = new Sample[gz, gx];
            Parallel.For(0, gz, z =>
            {
                for (int x = 0; x < gx; x++)
                {
                    var smp = s.eval(hf.Pos(x, z) + s.origin);
                    samples[z, x] = smp;
                    hf.h[z, x] = smp.h;
                }
            });
            var (lo, hi) = hf.Range();
            float span = Mathf.Max(0.01f, hi - lo);
            int kc = Mathf.Max(1, Mathf.RoundToInt(s.curvatureRadius / hf.Cell.x));
            var tileSize = new Vector2(s.size.x / tx, s.size.y / tz);
            float lightR = s.ground?.lightNormalRadius ?? 0;
            var smoothH = lightR > 0 ? BlurHeights(hf.h, Mathf.Max(1, Mathf.RoundToInt(lightR / hf.Cell.x))) : null;

            Directory.CreateDirectory(s.dir);
            var tiles = new Terrain[tx * tz];
            int holes = 0;
            for (int j = 0; j < tz; j++)
            for (int i = 0; i < tx; i++)
            {
                string suffix = single ? "" : $"_{i}_{j}";
                int ox = i * (res - 1), oz = j * (res - 1);
                var heights = new float[res, res];
                for (int z = 0; z < res; z++)
                for (int x = 0; x < res; x++)
                    heights[z, x] = Mathf.Clamp01(hf.h[oz + z, ox + x] / s.heightRange);

                // 先建资产再写数据：分层图纹理是 TerrainData 的子资产，在资产创建之前写进去的像素不会落盘
                string tdPath = $"{s.dir}/TD_{s.name}{suffix}.asset";
                AssetDatabase.DeleteAsset(tdPath);
                var td = new TerrainData();
                AssetDatabase.CreateAsset(td, tdPath);
                td.heightmapResolution = res;
                td.size = new Vector3(tileSize.x, s.heightRange, tileSize.y);
                td.SetHeights(0, 0, heights);
                td.terrainLayers = layers;
                td.alphamapResolution = s.splatRes;
                td.baseMapResolution = 1024;

                // 分层图：每个分层像素取最近的高度采样的分量，坡度 / 凹度用整张高度场差分
                int n = s.splatRes;
                var alpha = new float[n, n, layers.Length];
                Parallel.For(0, n, z =>
                {
                    for (int x = 0; x < n; x++)
                    {
                        int hx = ox + Mathf.Clamp(Mathf.RoundToInt((x + 0.5f) / n * (res - 1)), 0, res - 1);
                        int hz = oz + Mathf.Clamp(Mathf.RoundToInt((z + 0.5f) / n * (res - 1)), 0, res - 1);
                        float hv = hf.h[hz, hx];
                        var ctx = new SplatContext
                        {
                            slope = hf.Slope(hx, hz), height = hv, relHeight = (hv - lo) / span, concavity = hf.Concavity(hx, hz, kc),
                        };
                        var w = rule(samples[hz, hx], ctx);
                        for (int l = 0; l < layers.Length && l < 4; l++) alpha[z, x, l] = w[l];
                    }
                });
                td.SetAlphamaps(0, 0, alpha);
                holes += ApplyHoles(td, samples, ox, oz, res);
                EditorUtility.SetDirty(td);
                AssetDatabase.SaveAssets();

                var lightNormals = smoothH != null ? LightNormalTexture($"{s.dir}/TN_{s.name}{suffix}.png", smoothH, hf.Cell, ox, oz, res) : null;
                var material = TerrainMaterial(s.dir, s.name + suffix, tint, td, layers, s.ground, lightNormals);
                var go = Terrain.CreateTerrainGameObject(td);
                go.name = $"Terrain_{s.name}{suffix}";
                go.transform.SetParent(parent, false);
                go.transform.position = new Vector3(s.origin.x + i * tileSize.x, -s.baseHeight, s.origin.y + j * tileSize.y);
                go.isStatic = true;
                var t = go.GetComponent<Terrain>();
                t.materialTemplate = material;
                t.drawInstanced = false;       // 风格化地形着色器直接读顶点法线
                t.basemapDistance = 2000;      // 始终走本着色器，不切到远处的 basemap
                t.heightmapPixelError = 3;
                t.shadowCastingMode = ShadowCastingMode.On;
                t.reflectionProbeUsage = ReflectionProbeUsage.Off;
                tiles[j * tx + i] = t;
            }

            if (!single)
            {
                for (int j = 0; j < tz; j++)
                for (int i = 0; i < tx; i++)
                {
                    var t = tiles[j * tx + i];
                    t.allowAutoConnect = true;
                    t.SetNeighbors(i > 0 ? tiles[j * tx + i - 1] : null, j + 1 < tz ? tiles[(j + 1) * tx + i] : null,
                        i + 1 < tx ? tiles[j * tx + i + 1] : null, j > 0 ? tiles[(j - 1) * tx + i] : null);
                }
                Debug.Log($"[Level] 地形 {s.name}：{tx} × {tz} 块，每块 {tileSize.x:F0} × {tileSize.y:F0} m");
            }
            if (holes > 0) Debug.Log($"[Level] 地形 {s.name}：{holes} 格地形洞");
            return new TerrainSet { spec = s, tiles = tiles, tilesX = tx, tilesZ = tz, hf = hf };
        }

        /// <summary>
        /// 地形洞：每个洞格取四角样本 hole 的平均，&gt; 0.5 挖开。Unity holes 数组里 true = 实地、false = 洞；
        /// 写完按 IsHole 回读校验一格，含义反了就翻转重写（文档没把真假写死，不赌）。返回洞格数。
        /// </summary>
        static int ApplyHoles(TerrainData td, Sample[,] samples, int ox, int oz, int res)
        {
            int n = res - 1, count = 0, hx0 = -1, hz0 = -1;
            var solid = new bool[n, n];
            for (int z = 0; z < n; z++)
            for (int x = 0; x < n; x++)
            {
                float v = (samples[oz + z, ox + x].hole + samples[oz + z, ox + x + 1].hole + samples[oz + z + 1, ox + x].hole + samples[oz + z + 1, ox + x + 1].hole) * 0.25f;
                bool hole = v > 0.5f;
                solid[z, x] = !hole;
                if (!hole) continue;
                count++;
                if (hx0 < 0)
                {
                    hx0 = x;
                    hz0 = z;
                }
            }
            if (count == 0) return 0;
            td.SetHoles(0, 0, solid);
            if (!td.IsHole(hx0, hz0))
            {
                for (int z = 0; z < n; z++)
                for (int x = 0; x < n; x++)
                    solid[z, x] = !solid[z, x];
                td.SetHoles(0, 0, solid);
                if (!td.IsHole(hx0, hz0)) Debug.LogWarning($"[Level] {td.name}：地形洞写不进去（IsHole 回读仍为 false）");
            }
            return count;
        }

        /// <summary>
        /// 分层规则，每章一条。层序三章一致：0 软覆盖（沙 / 雪 / 灰）· 1 底面（砾石 / 冻土 / 冷熔岩）· 2 路面或流体边（夯土 / 冰 / 结壳熔岩）· 3 岩。
        /// 都按优先级逐层「占掉剩余份额」：岩 → 流体 / 路 → 软覆盖 → 剩下的是底面。
        /// </summary>
        public static class Splat
        {
            /// <summary>
            /// 第一章戈壁（0 沙 / 1 黑戈壁砾石 / 2 夯土·干河床 / 3 赭红层理岩）：陡坡与岩体 → 岩；路、河床、台顶、干涸的湖床 → 夯土；
            /// 沙丘、沙坡、盆地 → 沙；剩下的是砾石戈壁。1-1 一直是这条规则（流体 / 岸带两项是新加的，1-1 不用，结果不变）。
            /// </summary>
            public static Vector4 Desert(in Sample s, in SplatContext c)
            {
                // 陡坡变岩石，但沙丘（沙的倾向强）再陡也还是沙——沙丘背风坡本来就在 30° 上下
                float rock = Mathf.Max(Landform.Smooth(30, 42, c.slope) * (1 - Landform.Smooth(0.35f, 0.7f, s.sand)), s.rock);
                float left = 1 - rock;
                float packed = Mathf.Clamp01(Mathf.Max(s.packed, Mathf.Max(s.fluid, s.shore * 0.6f))) * left;
                left -= packed;
                // 沙丘背风坡（30° 上下）仍是沙，不被坡度规则吃成岩石：沙的倾向强时把岩石份额让回来
                float sand = Mathf.Clamp01(s.sand) * left;
                left -= sand;
                float gravel = left;
                return new Vector4(sand, gravel, packed, rock);
            }

            /// <summary>
            /// 第二章冰原（0 雪 / 1 冻土碎石 / 2 冰 / 3 暗色岩）：陡于 33° 挂不住雪、被风刮秃的凸脊 → 岩；冻住的湖与河 → 冰；
            /// 路、栈道落脚处、岸带、20–33° 的中坡 → 冻土；平缓处与凹处积雪，越高越厚；剩下的是冻土。
            /// </summary>
            public static Vector4 Frost(in Sample s, in SplatContext c)
            {
                float rock = Landform.Smooth(33, 46, c.slope) * (1 - Landform.Smooth(0.5f, 0.85f, s.sand));
                rock = Mathf.Max(rock, Landform.Smooth(0.12f, 0.5f, -c.concavity) * Landform.Smooth(16, 30, c.slope) * 0.85f);
                rock = Mathf.Max(rock, s.rock);
                float left = 1 - rock;
                float ice = Mathf.Clamp01(s.fluid) * left;
                left -= ice;
                float soil = Mathf.Clamp01(Mathf.Max(Mathf.Max(s.packed, s.shore * 0.75f), Landform.Smooth(20, 32, c.slope) * 0.7f)) * left;
                left -= soil;
                float snowBias = Mathf.Max(s.sand, Landform.Smooth(24, 10, c.slope) * (0.62f + 0.25f * c.relHeight + Landform.Smooth(0, 0.6f, c.concavity) * 0.3f));
                float snow = Mathf.Clamp01(snowBias) * left;
                left -= snow;
                return new Vector4(snow, soil + left, ice, rock);
            }

            /// <summary>
            /// 第三章火狱（0 火山灰 / 1 冷却熔岩 / 2 结壳熔岩 / 3 柱状玄武岩）：陡坡、凸脊 → 玄武岩；熔岩床与岸带 → 结壳（缝里透红）；
            /// 路面（踩出的浅色灰路，读路用）、软覆盖、凹处与高处落灰 → 火山灰；剩下的是冷却熔岩。
            /// </summary>
            public static Vector4 Inferno(in Sample s, in SplatContext c)
            {
                float rock = Landform.Smooth(32, 44, c.slope) * (1 - Landform.Smooth(0.55f, 0.9f, s.sand));
                rock = Mathf.Max(rock, Landform.Smooth(0.15f, 0.6f, -c.concavity) * Landform.Smooth(18, 30, c.slope) * 0.8f);
                rock = Mathf.Max(rock, s.rock);
                float left = 1 - rock;
                float ember = Mathf.Clamp01(Mathf.Max(s.fluid, s.shore * 0.9f)) * left;
                left -= ember;
                float ashBias = Mathf.Max(Mathf.Max(s.packed, s.sand),
                    Landform.Smooth(0.05f, 0.5f, c.concavity) * Landform.Smooth(22, 8, c.slope) * 0.7f + c.relHeight * 0.25f);
                float ash = Mathf.Clamp01(ashBias) * left;
                left -= ash;
                return new Vector4(ash, left, ember, rock);
            }
        }

        /// <summary>高度场的两遍可分离盒式模糊（≈ 高斯，σ ≈ 0.8 r 格），边缘夹取</summary>
        static float[,] BlurHeights(float[,] src, int r)
        {
            int nz = src.GetLength(0), nx = src.GetLength(1);
            var a = (float[,])src.Clone();
            var b = new float[nz, nx];
            for (int pass = 0; pass < 2; pass++)
            {
                Parallel.For(0, nz, z =>
                {
                    float sum = 0;
                    for (int k = -r; k <= r; k++) sum += a[z, Mathf.Clamp(k, 0, nx - 1)];
                    for (int x = 0; x < nx; x++)
                    {
                        b[z, x] = sum / (2 * r + 1);
                        sum += a[z, Mathf.Min(x + r + 1, nx - 1)] - a[z, Mathf.Max(x - r, 0)];
                    }
                });
                Parallel.For(0, nx, x =>
                {
                    float sum = 0;
                    for (int k = -r; k <= r; k++) sum += b[Mathf.Clamp(k, 0, nz - 1), x];
                    for (int z = 0; z < nz; z++)
                    {
                        a[z, x] = sum / (2 * r + 1);
                        sum += b[Mathf.Min(z + r + 1, nz - 1), x] - b[Mathf.Max(z - r, 0), x];
                    }
                });
            }
            return a;
        }

        /// <summary>
        /// 一块地形的光照法线图（res × res，与高度格点一一对应，xyz × 0.5 + 0.5）：从模糊过的整张高度场中心差分，跨地块连续。
        /// 存 PNG（平滑数据压得小），线性、夹取、带 mip
        /// </summary>
        static Texture2D LightNormalTexture(string path, float[,] sh, Vector2 cell, int ox, int oz, int res)
        {
            int nz = sh.GetLength(0), nx = sh.GetLength(1);
            var px = new Color[res * res];
            Parallel.For(0, res, z =>
            {
                int gz = oz + z;
                for (int x = 0; x < res; x++)
                {
                    int gx = ox + x;
                    float dx = (sh[gz, Mathf.Min(gx + 1, nx - 1)] - sh[gz, Mathf.Max(gx - 1, 0)]) / (2 * cell.x);
                    float dz = (sh[Mathf.Min(gz + 1, nz - 1), gx] - sh[Mathf.Max(gz - 1, 0), gx]) / (2 * cell.y);
                    var n = new Vector3(-dx, 1, -dz).normalized;
                    px[z * res + x] = new Color(n.x * 0.5f + 0.5f, n.y * 0.5f + 0.5f, n.z * 0.5f + 0.5f, 1);
                }
            });
            var tex = new Texture2D(res, res, TextureFormat.RGBA32, true, true);
            tex.SetPixels(px);
            File.WriteAllBytes(path, tex.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path);
            var ti = (TextureImporter)AssetImporter.GetAtPath(path);
            ti.sRGBTexture = false;
            ti.alphaSource = TextureImporterAlphaSource.None;
            ti.wrapMode = TextureWrapMode.Clamp;
            ti.mipmapEnabled = true;
            ti.filterMode = FilterMode.Bilinear;
            ti.npotScale = TextureImporterNPOTScale.None;
            ti.textureCompression = TextureImporterCompression.CompressedHQ;
            ti.SaveAndReimport();
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        static Texture2D macroTex, warpTex;

        /// <summary>地形材质：显式绑定 TerrainData 的分层图（alphamap 纹理）与各层贴图、平铺尺寸</summary>
        static Material TerrainMaterial(string dir, string name, Color shadowTint, TerrainData td, TerrainLayer[] layers, Ground ground, Texture2D lightNormals = null)
        {
            var m = new Material(Shader.Find("Spiritfire/StylizedTerrain")) { name = $"M_Terrain_{name}" };
            m.SetTexture("_ControlMap", td.alphamapTextures[0]);
            var tile = Vector4.one * 8;
            for (int i = 0; i < 4 && i < layers.Length; i++)
            {
                m.SetTexture($"_Layer{i}", layers[i].diffuseTexture);
                tile[i] = layers[i].tileSize.x;
            }
            m.SetVector("_LayerTile", tile);
            // 宏观色斑贴图是确定性的：一次构建里只生成一回（多块地形、画廊十几块地形不重复写盘导入）
            if (!macroTex) macroTex = TerrainTextureGen.Macro(5);
            m.SetTexture("_MacroTex", macroTex);
            m.SetFloat("_MacroScale", 70);
            m.SetFloat("_MacroStrength", ground?.macroStrength ?? 0.2f);
            m.SetFloat("_RockScale", ground?.rockScale ?? 8f);
            if (ground is { steepTriplanar: true })
            {
                if (!warpTex) warpTex = TerrainTextureGen.Warp(9);
                m.EnableKeyword("_STEEP_TRIPLANAR");
                m.SetFloat("_SteepTriplanar", 1);
                m.SetTexture("_WarpTex", warpTex);
                m.SetFloat("_WarpScale", 17);
                m.SetFloat("_RockWarp", ground.rockWarp);
                m.SetFloat("_RockDetile", ground.rockDetile);
                if (lightNormals)
                {
                    m.SetTexture("_LightNormalTex", lightNormals);
                    m.SetFloat("_LightNormalBlend", ground.lightNormalBlend);
                }
            }
            m.SetColor("_ShadowTint", shadowTint);
            SaveAsset(m, $"{dir}/M_Terrain_{name}.mat");
            return m;
        }
    }
}
