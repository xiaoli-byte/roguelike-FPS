using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第一人称枪口火焰（FX1，docs/unity-parity.md「枪口火焰：挂到 muzzle socket」）。
    ///   画法：一片朝镜头的星芒（8 道长短尖刺 + 白热芯）+ 两片沿枪管十字交叉的火舌，FirstPerson 层（第一人称相机画，和枪模同一个视野），
    ///   加色、没有贴脸淡出（M_Fx_Muzzle），每发随机转角和长短，0.05–0.08 s；外加一盏池化闪光灯照亮周围。
    ///   位置：有挂点（W3/W4 给每把枪的 muzzle socket）就挂在挂点下跟着枪模走；没有挂点就用 WeaponController 现在的常数枪口位置——
    ///   那个点是按主相机算的，换算成第一人称相机里同一个屏幕位置（两台相机视野不同），保证火焰和曳光的起点重合。
    ///   合并：同一帧里的请求（挂点回调 + ShotFx.MuzzleFlash 的旧调用）在渲染前合成一次：挂点优先、显式颜色优先、强度取大，只出一次火焰一盏灯。
    ///   颜色：调用方没给就按当前武器的元素（火 / 雷 / 蚀用 Three.js 元素色，无元素暖黄）。
    /// </summary>
    public sealed class MuzzleFlashes : MonoBehaviour
    {
        const int PoolSize = 6;
        /// <summary>WeaponController 的常数枪口（相机局部坐标，腰射 → 开镜）：ShotFx 用它认出哪次 MuzzleFlash 调用是开枪</summary>
        static readonly Vector3 MuzzleHip = new(0.2f, -0.13f, 0.75f), MuzzleAim = new(0, -0.08f, 0.7f);
        static readonly Color DefaultColor = new(1f, 0.75f, 0.4f);
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        struct Req
        {
            public bool any, hasColor, light;
            public Transform socket;
            public Vector3 fallback, dir;
            public Color color;
            public float strength;
        }

        sealed class View
        {
            public Transform root, star, petalA, petalB;
            public MeshRenderer rs, ra, rb;
            public float age, life, size;
            public Color color;
            public bool active;
        }

        static MuzzleFlashes instance;
        Req pending;
        int pendingFrame = -1;
        readonly View[] views = new View[PoolSize];
        int next;
        Mesh starMesh, petalMesh;
        MaterialPropertyBlock block;
        Camera vmCam, mainCam;
        WeaponController weapons;

        /// <summary>最近一次真正画出来的枪口火焰（测试用）：时间、是否挂在挂点上、世界位置</summary>
        public static float LastFlashTime { get; private set; } = -1;
        public static bool LastFlashOnSocket { get; private set; }
        public static Vector3 LastFlashPosition { get; private set; }

        static MuzzleFlashes Get()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<MuzzleFlashes>();
            return instance;
        }

        void OnEnable() => RenderPipelineManager.beginContextRendering += OnBeginRendering;

        void OnDisable() => RenderPipelineManager.beginContextRendering -= OnBeginRendering;

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        /// <summary>登记一次枪口火焰（本帧渲染前合并处理）。explicitColor = false 时颜色按当前武器元素</summary>
        public static void Request(Transform socket, Vector3 fallback, Vector3 dir, Color color, float strength, bool explicitColor, bool light = true)
        {
            if (!(strength > 0) || !Fx.Finite(fallback)) return;
            var self = Get();
            if (!self) return;
            if (self.pendingFrame != Time.frameCount)
            {
                self.pending = default;
                self.pendingFrame = Time.frameCount;
            }
            ref var p = ref self.pending;
            if (!p.any) p.fallback = fallback;
            p.any = true;
            if (socket) p.socket = socket;
            if (dir.sqrMagnitude > 1e-6f && Fx.Finite(dir)) p.dir = dir.normalized;
            // 无元素的武器传进来的是 Fx.ElementColor(None)（近白）：枪口火焰按暖黄画
            if (explicitColor && !IsNoneColor(color))
            {
                p.color = color;
                p.hasColor = true;
            }
            p.strength = Mathf.Max(p.strength, strength);
            p.light |= light;
        }

        static bool IsNoneColor(Color c)
        {
            var n = Fx.ElementColor(Element.None);
            return Mathf.Abs(c.r - n.r) + Mathf.Abs(c.g - n.g) + Mathf.Abs(c.b - n.b) < 0.03f;
        }

        /// <summary>这个世界坐标是不是 WeaponController 的常数枪口（相机局部坐标落在腰射—开镜那条线段上，误差 6 cm）</summary>
        public static bool IsMuzzlePoint(Vector3 at)
        {
            var cam = Camera.main;
            if (!cam) return false;
            var local = cam.transform.InverseTransformPoint(at);
            var ab = MuzzleAim - MuzzleHip;
            float t = Mathf.Clamp01(Vector3.Dot(local - MuzzleHip, ab) / ab.sqrMagnitude);
            return (local - (MuzzleHip + ab * t)).sqrMagnitude < 0.06f * 0.06f;
        }

        void OnBeginRendering(ScriptableRenderContext _, System.Collections.Generic.List<Camera> __) => Resolve();

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            foreach (var v in views)
            {
                if (v == null || !v.active) continue;
                v.age += dt;
                if (v.age >= v.life || !v.root)
                {
                    Hide(v);
                    continue;
                }
                Draw(v);
            }
        }

        void Resolve()
        {
            if (pendingFrame != Time.frameCount || !pending.any) return;
            var p = pending;
            pending.any = false;
            if (Time.deltaTime <= 0) return; // 暂停中不出火焰
            Spawn(p);
        }

        void Spawn(Req p)
        {
            mainCam = Camera.main;
            if (!mainCam) return;
            FindViewmodelCamera();
            var color = p.hasColor ? p.color : WeaponColor();
            float s = Mathf.Clamp(p.strength, 0.2f, 6f);
            var v = Take();
            if (v == null) return;
            var dir = p.dir.sqrMagnitude > 0.5f ? p.dir : mainCam.transform.forward;
            Vector3 pos;
            bool onSocket = p.socket && p.socket.gameObject.activeInHierarchy;
            if (onSocket)
            {
                v.root.SetParent(p.socket, false);
                v.root.localPosition = Vector3.zero;
                pos = p.socket.position;
                // 枪模整体缩放过（第一人称 rig 的 ViewmodelScale）：火焰按世界尺寸画
                v.root.localScale = Vector3.one / Mathf.Max(1e-3f, p.socket.lossyScale.x);
                // 枪管方向：调用方给的（W3 的 WeaponSockets.Forward）优先，否则用挂点的 +Z
                var barrel = p.dir.sqrMagnitude > 0.5f ? p.dir : p.socket.forward;
                v.root.rotation = Quaternion.LookRotation(barrel, mainCam.transform.up);
                SetLayer(v, p.socket.gameObject.layer);
            }
            else
            {
                // 常数枪口按主相机算：换到第一人称相机里同一个屏幕位置、同样的深度
                var target = vmCam ? vmCam : mainCam;
                var vp = mainCam.WorldToViewportPoint(p.fallback);
                pos = target.ViewportToWorldPoint(vp);
                v.root.SetParent(target.transform, true);
                v.root.position = pos;
                v.root.rotation = Quaternion.LookRotation(dir, mainCam.transform.up);
                v.root.localScale = Vector3.one;
                SetLayer(v, vmCam ? Layers.FirstPerson : 0);
            }
            v.color = color;
            v.size = Mathf.Clamp(0.15f * Mathf.Sqrt(s), 0.1f, 0.34f) * Random.Range(0.85f, 1.15f);
            v.life = Mathf.Min(0.08f, 0.045f + 0.008f * s);
            v.age = 0;
            v.active = true;
            v.star.localRotation = Quaternion.Euler(0, 0, Random.value * 360f);
            // 火舌面片的 +x 转到枪管方向（+z），再绕枪管随机转一个角，两片互成 90°
            float roll = Random.value * 90f;
            var along = Quaternion.Euler(0, -90, 0);
            v.petalA.localRotation = Quaternion.AngleAxis(roll, Vector3.forward) * along;
            v.petalB.localRotation = Quaternion.AngleAxis(roll + 90, Vector3.forward) * along;
            v.rs.enabled = v.ra.enabled = v.rb.enabled = true;
            Draw(v);
            LastFlashTime = Time.time;
            LastFlashOnSocket = onSocket;
            LastFlashPosition = pos;
            if (p.light)
            {
                var lightPos = onSocket ? pos : p.fallback;
                FxLightPool.Flash(lightPos, Color.Lerp(color, Color.white, 0.2f), Mathf.Min(30f, 6f * s), 6f * Mathf.Clamp(Mathf.Sqrt(s), 1f, 2.5f), 0.07f);
            }
        }

        void Draw(View v)
        {
            float k = v.age / Mathf.Max(0.001f, v.life);
            // 第一帧最大，之后缩小变淡（快进快出，读作「砰」一下）
            float scale = v.size * (1.15f - 0.45f * k);
            float alpha = 1 - k * k;
            v.star.localScale = new Vector3(scale, scale, scale);
            float len = v.size * 3.2f * (1f - 0.3f * k);
            v.petalA.localScale = v.petalB.localScale = new Vector3(len, scale * 0.7f, 1);
            block ??= new MaterialPropertyBlock();
            var c = new Color(v.color.r, v.color.g, v.color.b, alpha);
            var hot = Color.Lerp(c, new Color(1, 1, 1, alpha), 0.35f);
            block.Clear();
            block.SetColor(BaseColorId, hot);
            v.rs.SetPropertyBlock(block);
            block.SetColor(BaseColorId, c);
            v.ra.SetPropertyBlock(block);
            v.rb.SetPropertyBlock(block);
        }

        Color WeaponColor()
        {
            if (!weapons)
            {
                var pv = PlayerVitals.Instance;
                if (pv) weapons = pv.GetComponent<WeaponController>();
            }
            var w = weapons ? weapons.Active : null;
            return w != null && w.element != Element.None ? Fx.ElementColor(w.element) : DefaultColor;
        }

        void FindViewmodelCamera()
        {
            if (vmCam && vmCam.transform.IsChildOf(mainCam.transform)) return;
            vmCam = null;
            foreach (var c in mainCam.GetComponentsInChildren<Camera>())
                if (c != mainCam && c.cullingMask == 1 << Layers.FirstPerson)
                {
                    vmCam = c;
                    break;
                }
        }

        View Take()
        {
            var v = views[next];
            next = (next + 1) % PoolSize;
            if (v != null && v.root) return v;
            v = Make();
            views[(next + PoolSize - 1) % PoolSize] = v;
            return v;
        }

        View Make()
        {
            if (!starMesh) starMesh = Quad("Muzzle Star", new Vector2(0, 0), new Vector2(0.5f, 1), -0.5f, 0.5f);
            if (!petalMesh) petalMesh = Quad("Muzzle Petal", new Vector2(0.5f, 0), new Vector2(1, 1), 0f, 1f);
            var root = new GameObject("Muzzle Flash").transform;
            root.SetParent(transform, false);
            var v = new View { root = root };
            v.star = Part("Star", root, starMesh, out v.rs);
            v.petalA = Part("Petal A", root, petalMesh, out v.ra);
            v.petalB = Part("Petal B", root, petalMesh, out v.rb);
            Hide(v);
            return v;
        }

        Transform Part(string name, Transform root, Mesh mesh, out MeshRenderer r)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = FxMaterials.Muzzle;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            r.enabled = false;
            return go.transform;
        }

        /// <summary>单位面片：x 从 x0 到 x1（火舌从根部 0 伸到 1），y ±0.5，uv 取图集的一格</summary>
        static Mesh Quad(string name, Vector2 uv0, Vector2 uv1, float x0, float x1)
        {
            var m = new Mesh { name = name };
            m.vertices = new[] { new Vector3(x0, -0.5f, 0), new Vector3(x1, -0.5f, 0), new Vector3(x0, 0.5f, 0), new Vector3(x1, 0.5f, 0) };
            m.uv = new[] { uv0, new Vector2(uv1.x, uv0.y), new Vector2(uv0.x, uv1.y), uv1 };
            m.triangles = new[] { 0, 2, 1, 1, 2, 3 };
            m.RecalculateBounds();
            m.bounds = new Bounds(Vector3.zero, Vector3.one * 2);
            return m;
        }

        static void SetLayer(View v, int layer)
        {
            v.root.gameObject.layer = layer;
            v.star.gameObject.layer = v.petalA.gameObject.layer = v.petalB.gameObject.layer = layer;
        }

        void Hide(View v)
        {
            v.active = false;
            if (!v.root) return;
            v.rs.enabled = v.ra.enabled = v.rb.enabled = false;
            // 挂点会随武器切换被停用 / 销毁：收回到 Fx 根下
            if (v.root.parent != transform) v.root.SetParent(transform, false);
        }

        /// <summary>全部收起（换关清场）</summary>
        internal static void ClearAll()
        {
            if (!instance) return;
            instance.pending.any = false;
            foreach (var v in instance.views)
                if (v != null) instance.Hide(v);
        }
    }
}
