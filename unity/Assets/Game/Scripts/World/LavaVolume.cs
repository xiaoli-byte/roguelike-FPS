using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 一片熔岩（湖、渠、井、条带）：关卡构建器（P/Editor/Levels/LevelKit.Lava.cs）按关卡数据摆，脚本也可以运行时 <see cref="Create"/>。
    /// 物体位置 = 形状中心、高度 = 基准熔岩面（低位），朝向 = 盒的朝向；子物体 Surface 是熔岩面网格（Spiritfire/Lava 着色器），随熔岩面上下。
    ///
    ///   判定：持有一份 <see cref="LavaBody"/>，启用时登记到 <see cref="LavaField"/>（玩家下沉托回、敌人烧死 / 拉回、各种查询都在那边）；
    ///   涨落：<see cref="tide"/> 自动涨落（3-3 熔铜渠），或脚本 <see cref="RiseTo"/> / <see cref="Recede"/>（首领的熔流）——
    ///         预警期熔岩翻涌发亮（着色器 _Agitation）、咕嘟声；涨过基准面 <see cref="LavaTuning.CarveRise"/> 时一块 NavMeshObstacle
    ///         把盖住的地面从导航网格上挖掉（地面敌人提前绕开），退回低位后撤掉；被淹到的敌人由 LavaField 挪到最近的岸上；
    ///   导航：基准面以下的地面在烘焙时由构建器的 NavMeshModifierVolume 标成 Lava 区（高代价，地面敌人绕开，但击退能把它们推进去）。
    /// 没有渲染器也能工作（纯判定体，例如首领脚本临时加的熔流区）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LavaVolume : MonoBehaviour
    {
        [Tooltip("平面形状：盒（宽 × 长，随物体朝向转）/ 圆（size.x = 半径）")]
        public LavaShape shape = LavaShape.Box;
        [Tooltip("盒：局部 X 宽 × 局部 Z 长（米）；圆：x = 半径")]
        public Vector2 size = new(10, 10);
        [Tooltip("熔岩面以下多深仍算熔岩（湖床、渠底）")]
        public float depth = 3f;
        [Tooltip("自动涨落（3-3 熔铜渠）")]
        public LavaTide tide;
        [Tooltip("熔岩面网格的渲染器（子物体 Surface）；为空 = 纯判定体")]
        public MeshRenderer surface;
        [Tooltip("熔岩流动（形状局部 XZ，米 / 秒；渠沿局部 +Z 流就是 (0, 速度)）：渠里的熔岩顺渠流；湖为 0，只翻涌。烘进网格，改了要重建网格")]
        public Vector2 flow;
        [Tooltip("岸边硬壳按场景深度算（湖、渠：熔岩下面有床）；平地上的熔岩条带只按形状边缘")]
        public bool depthShore = true;

        static readonly int AgitationId = Shader.PropertyToID("_Agitation");

        LavaBody body;
        LavaLevelDriver driver;
        NavMeshObstacle carve;
        MaterialPropertyBlock block;
        // 没涨落过的熔岩不设 MaterialPropertyBlock（保住 SRP Batcher）
        float agitation, shownAgitation;
        LavaTidePhase lastPhase;
        bool registered;

        /// <summary>判定体（形状、当前熔岩面）</summary>
        public LavaBody Body => body ??= MakeBody();
        /// <summary>基准熔岩面（低位，关卡里摆的高度）</summary>
        public float BaseLevel => Driver.BaseLevel;
        /// <summary>当前熔岩面高度</summary>
        public float Level => Driver.Level;
        /// <summary>正在去的高度</summary>
        public float TargetLevel => Driver.Target;
        public LavaTidePhase Phase => Driver.Phase;
        /// <summary>涨着或将要涨过基准面（盖住的地面已从导航网格挖掉）</summary>
        public bool Flooding => Driver.Flooding;
        LavaLevelDriver Driver => driver ??= new LavaLevelDriver(transform.position.y, tide);

        /// <summary>阶段变化（预警、开始涨、到顶、开始退、回到低位）：关卡 / 首领脚本据此放提示、改战斗节奏</summary>
        public event Action<LavaVolume, LavaTidePhase> PhaseChanged;

        static readonly List<LavaVolume> live = new();
        /// <summary>场上启用着的熔岩</summary>
        public static IReadOnlyList<LavaVolume> Live => live;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => live.Clear();

        LavaBody MakeBody() => new()
        {
            shape = shape, size = size, depth = Mathf.Max(0.1f, depth), center = transform.position, yaw = transform.eulerAngles.y,
            level = driver?.Level ?? transform.position.y, owner = this,
        };

        void Awake()
        {
            body ??= MakeBody();
            driver ??= new LavaLevelDriver(transform.position.y, tide);
            if (surface)
            {
                var mf = surface.GetComponent<MeshFilter>();
                if (mf && !mf.sharedMesh) mf.sharedMesh = BuildMesh(shape, size, depthShore, flow);
            }
            lastPhase = driver.Phase;
        }

        void OnEnable()
        {
            if (!live.Contains(this)) live.Add(this);
            LavaField.Register(Body);
            registered = true;
            LavaField.Ensure();
            ApplyLevel();
        }

        void OnDisable()
        {
            live.Remove(this);
            if (registered) LavaField.Unregister(body);
            registered = false;
            if (carve) carve.enabled = false;
        }

        /// <summary>改了形状 / 位置之后（编辑器、脚本挪动）同步到判定体</summary>
        public void SyncShape()
        {
            var b = Body;
            b.shape = shape;
            b.size = size;
            b.depth = Mathf.Max(0.1f, depth);
            b.center = transform.position;
            b.yaw = transform.eulerAngles.y;
        }

        /// <summary>
        /// 涨到 / 退到 level（世界 y）：先预警 warn 秒（翻涌发亮、咕嘟声，导航网格这时就挖掉），再 seconds 秒缓入缓出过去。
        /// 停掉自动涨落，直到 <see cref="ReleaseToTide"/>
        /// </summary>
        public void RiseTo(float level, float seconds = 1.5f, float warn = 0.8f)
        {
            Driver.MoveTo(level, seconds, warn);
            UpdateCarve();
        }

        /// <summary>退回基准面（不预警）</summary>
        public void Recede(float seconds = 1.5f) => RiseTo(BaseLevel, seconds, 0);

        /// <summary>交还给自动涨落</summary>
        public void ReleaseToTide() => Driver.ReleaseToTide();

        void Update()
        {
            var d = Driver;
            d.tide = tide;
            bool changed = d.Step(Time.deltaTime);
            if (changed) ApplyLevel();
            if (d.Phase != lastPhase)
            {
                var ph = d.Phase;
                lastPhase = ph;
                UpdateCarve();
                if (ph == LavaTidePhase.Warning) GameAudio.PlayAt("burn_tick", transform.position, 0.8f, 0.45f);
                else if (ph == LavaTidePhase.Rising) GameAudio.PlayAt("skill_fire", transform.position, 0.7f, 0.5f);
                try
                {
                    PhaseChanged?.Invoke(this, ph);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            // 翻涌：预警 / 涨潮时熔岩更亮、流得更快
            float want = d.Phase switch { LavaTidePhase.Warning => 1f, LavaTidePhase.Rising => 0.75f, LavaTidePhase.High => 0.25f, _ => 0f };
            agitation = Mathf.MoveTowards(agitation, want, Time.deltaTime * 2.5f);
            if (surface && Mathf.Abs(agitation - shownAgitation) > 0.01f)
            {
                block ??= new MaterialPropertyBlock();
                surface.GetPropertyBlock(block);
                block.SetFloat(AgitationId, agitation);
                surface.SetPropertyBlock(block);
                shownAgitation = agitation;
            }
        }

        /// <summary>熔岩面高度写进判定体、熔岩面网格</summary>
        void ApplyLevel()
        {
            var b = Body;
            b.level = Driver.Level;
            if (!surface) return;
            var t = surface.transform;
            var p = t.position;
            p.y = b.level + LavaTuning.SurfaceLift;
            t.position = p;
        }

        /// <summary>涨过基准面时用一块挖洞的 NavMeshObstacle 盖住整片形状（地面敌人绕开），退回低位后撤掉</summary>
        void UpdateCarve()
        {
            var d = Driver;
            bool want = d.Flooding;
            if (!want)
            {
                if (carve) carve.enabled = false;
                return;
            }
            if (!carve)
            {
                var go = new GameObject("Flood Carve");
                go.transform.SetParent(transform, false);
                carve = go.AddComponent<NavMeshObstacle>();
                carve.carving = true;
                carve.carveOnlyStationary = false;
            }
            float top = Mathf.Max(d.Level, d.Target) + LavaTuning.StandRise, bottom = d.BaseLevel - 0.5f;
            float h = Mathf.Max(0.5f, top - bottom);
            carve.transform.localPosition = new Vector3(0, (top + bottom) * 0.5f - transform.position.y, 0);
            if (shape == LavaShape.Disc)
            {
                carve.shape = NavMeshObstacleShape.Capsule;
                carve.radius = Mathf.Max(0.1f, size.x);
                carve.height = h;
                carve.center = Vector3.zero;
            }
            else
            {
                carve.shape = NavMeshObstacleShape.Box;
                carve.size = new Vector3(Mathf.Max(0.1f, size.x), h, Mathf.Max(0.1f, size.y));
                carve.center = Vector3.zero;
            }
            carve.enabled = true;
        }

        // ───────────── 熔岩面网格 ─────────────

        /// <summary>网格一格最大边长（米）：顶点雾、附加光逐顶点时大平面也不失真</summary>
        public const float MeshCell = 4f;

        /// <summary>
        /// 熔岩面网格（局部空间、y = 0、法线朝上）：盒是 size 大小的网格，圆是同心环。着色器要的数据都烘在顶点里，材质全场共用（SRP Batcher）：
        /// uv0 = 局部 XZ（米）；uv1 = (半宽, 半长, 形状 0 盒 / 1 圆, 岸边按场景深度 0 / 1)；uv2 = (流动 x, 流动 z, 相位种子, 0)
        /// </summary>
        public static Mesh BuildMesh(LavaShape shape, Vector2 size, bool depthShore, Vector2 flow = default)
        {
            var verts = new List<Vector3>();
            var tris = new List<int>();
            var half = shape == LavaShape.Disc ? new Vector2(size.x, size.x) : size * 0.5f;
            if (shape == LavaShape.Disc)
            {
                float r = Mathf.Max(0.1f, size.x);
                int rings = Mathf.Max(1, Mathf.CeilToInt(r / MeshCell));
                int segs = Mathf.Clamp(Mathf.CeilToInt(r * Mathf.PI * 2 / MeshCell), 24, 256);
                verts.Add(Vector3.zero);
                for (int i = 1; i <= rings; i++)
                {
                    float rr = r * i / rings;
                    for (int k = 0; k < segs; k++)
                    {
                        float a = k * Mathf.PI * 2 / segs;
                        verts.Add(new Vector3(Mathf.Sin(a) * rr, 0, Mathf.Cos(a) * rr));
                    }
                }
                for (int k = 0; k < segs; k++)
                {
                    int a = 1 + k, b = 1 + (k + 1) % segs;
                    tris.Add(0); tris.Add(a); tris.Add(b);
                }
                for (int i = 1; i < rings; i++)
                {
                    int inner = 1 + (i - 1) * segs, outer = 1 + i * segs;
                    for (int k = 0; k < segs; k++)
                    {
                        int k1 = (k + 1) % segs;
                        int a = inner + k, b = inner + k1, c = outer + k, d = outer + k1;
                        tris.Add(a); tris.Add(c); tris.Add(d);
                        tris.Add(a); tris.Add(d); tris.Add(b);
                    }
                }
            }
            else
            {
                float w = Mathf.Max(0.1f, size.x), l = Mathf.Max(0.1f, size.y);
                int nx = Mathf.Clamp(Mathf.CeilToInt(w / MeshCell), 1, 128), nz = Mathf.Clamp(Mathf.CeilToInt(l / MeshCell), 1, 128);
                for (int j = 0; j <= nz; j++)
                for (int i = 0; i <= nx; i++)
                    verts.Add(new Vector3(-w * 0.5f + w * i / nx, 0, -l * 0.5f + l * j / nz));
                for (int j = 0; j < nz; j++)
                for (int i = 0; i < nx; i++)
                {
                    int a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
                    tris.Add(a); tris.Add(c); tris.Add(d);
                    tris.Add(a); tris.Add(d); tris.Add(b);
                }
            }
            var uv0 = new List<Vector2>(verts.Count);
            var uv1 = new List<Vector4>(verts.Count);
            var uv2 = new List<Vector4>(verts.Count);
            var info = new Vector4(half.x, half.y, shape == LavaShape.Disc ? 1 : 0, depthShore ? 1 : 0);
            float seed = Mathf.Repeat(half.x * 0.731f + half.y * 0.377f, 1f) * 10f;
            foreach (var v in verts)
            {
                uv0.Add(new Vector2(v.x, v.z));
                uv1.Add(info);
                uv2.Add(new Vector4(flow.x, flow.y, seed, 0));
            }
            var mesh = new Mesh { name = shape == LavaShape.Disc ? $"Lava Disc r{size.x:0.#}" : $"Lava Box {size.x:0.#}x{size.y:0.#}" };
            if (verts.Count > 65000) mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.SetUVs(0, uv0);
            mesh.SetUVs(1, uv1);
            mesh.SetUVs(2, uv2);
            var normals = new Vector3[verts.Count];
            for (int i = 0; i < normals.Length; i++) normals[i] = Vector3.up;
            mesh.normals = normals;
            mesh.RecalculateBounds();
            // 熔岩面会上下移动（涨落）：包围盒往上放一点，不被视锥误剔
            var bounds = mesh.bounds;
            bounds.Expand(new Vector3(0, 1f, 0));
            mesh.bounds = bounds;
            return mesh;
        }

        /// <summary>着色器名（材质没有时运行时找）</summary>
        public const string ShaderName = "Spiritfire/Lava";

        /// <summary>
        /// 运行时加一片熔岩（首领脚本的熔流、冒烟测试）：center = 形状中心、y = 基准熔岩面。material 为空时借场上已有熔岩的材质，
        /// 再没有就按着色器现建（编辑器里一定有；打包后着色器没被场景引用时只有判定、不画）
        /// </summary>
        public static LavaVolume Create(string name, Vector3 center, LavaShape shape, Vector2 size, float yaw = 0, float depth = 3f,
            bool depthShore = true, Material material = null, Transform parent = null)
        {
            var go = new GameObject(string.IsNullOrEmpty(name) ? "Lava" : name);
            go.SetActive(false);
            if (parent) go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(center, Quaternion.Euler(0, yaw, 0));
            var v = go.AddComponent<LavaVolume>();
            v.shape = shape;
            v.size = size;
            v.depth = depth;
            v.depthShore = depthShore;
            if (!material)
                foreach (var other in live)
                    if (other && other.surface && other.surface.sharedMaterial)
                    {
                        material = other.surface.sharedMaterial;
                        break;
                    }
            if (!material)
            {
                var sh = Shader.Find(ShaderName);
                if (sh) material = new Material(sh) { name = "M_Lava (runtime)" };
            }
            if (material)
            {
                var s = new GameObject("Surface");
                s.transform.SetParent(go.transform, false);
                s.transform.localPosition = new Vector3(0, LavaTuning.SurfaceLift, 0);
                s.AddComponent<MeshFilter>().sharedMesh = BuildMesh(shape, size, depthShore);
                var r = s.AddComponent<MeshRenderer>();
                r.sharedMaterial = material;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = false;
                v.surface = r;
            }
            go.SetActive(true);
            return v;
        }

        void OnValidate()
        {
            size = new Vector2(Mathf.Max(0.1f, size.x), Mathf.Max(0.1f, size.y));
            depth = Mathf.Max(0.1f, depth);
            if (body != null) SyncShape();
        }

        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(1f, 0.4f, 0.1f, 0.8f);
            var m = Gizmos.matrix;
            Gizmos.matrix = transform.localToWorldMatrix;
            if (shape == LavaShape.Disc)
            {
                const int n = 48;
                for (int i = 0; i < n; i++)
                {
                    float a = i * Mathf.PI * 2 / n, b = (i + 1) * Mathf.PI * 2 / n;
                    Gizmos.DrawLine(new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a)) * size.x, new Vector3(Mathf.Sin(b), 0, Mathf.Cos(b)) * size.x);
                }
            }
            else Gizmos.DrawWireCube(new Vector3(0, -depth * 0.5f, 0), new Vector3(size.x, depth, size.y));
            Gizmos.matrix = m;
        }
    }
}
