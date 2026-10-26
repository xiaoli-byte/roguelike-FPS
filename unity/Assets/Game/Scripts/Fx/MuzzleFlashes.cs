using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 枪口火焰（FX1 起步，特效打磨 A 路按枪种分形状）。每把枪按 <see cref="Fx.MuzzleStyleOf"/> 取一套「样式」（<see cref="MuzzleStyle"/>），
    /// 一套 = 几片面片（贴图 T_Fx_MuzzleSet 的格，见 scripts/unity/fx_shot_textures.py）+ 世界里的火星 / 余烬 / 烟 / 光点 + 一盏闪光灯：
    ///   冲锋枪：短促六芒 + 两片短火舌；步枪 / 点射：十字星芒 + 两片中火舌；机炮：十字星芒 + 一道长火舌；
    ///   霰弹：宽散射喷口 + 两片扇形火舌 + 一把往前喷的火星 + 余烬 + 一小团烟；
    ///   狙击：扩散的冲击环 + 十字星芒 + 两道长火舌（带激波菱）+ 烟；灵炮：冲击环 + 符环 + 长火舌 + 能量流，偏虹紫，带光点；
    ///   左轮：粗短火团 + 两片粗火舌 + 余烬；能量类（光束 / 雷蛊 / 蛊灯）：扩散的能量波纹 + 符环 + 能量流，没有火；
    ///   喷火：引火的一小团；榴弹：八角爆星 + 火团 + 粗火舌 + 烟和余烬；飞弹：火团 + 尾焰；弩：弦响的一圈气浪（不打灯，由开火事件触发——弩的 flash 是 0）。
    /// 每片都有白热芯 / 主色两种着色，正面片朝枪管方向（第一人称里正对镜头），侧面片沿枪管放、两片十字交叉（第三人称看得见长短）。
    ///   第一人称：挂在枪模的 muzzle 挂点下（FirstPerson 层，跟着枪模走）；没有挂点用常数枪口换算到枪模相机里同一个屏幕位置。
    ///     不挡准星：按火焰在屏幕上离准星多远，限制正面片的半径（留出 28% 的空）、火舌的长度（火舌沿枪管指向准星，尖不越过一半）；开镜时自然收小。
    ///   第三人称：同一套面片另放一份在世界里的枪口（主相机前 0.9 m 的换算点），只给主相机 / 枪模相机以外的相机画（截图、侧面相机），主视角看不到它。
    /// 合并：同一帧里的请求（挂点回调 + ShotFx 的旧调用）在渲染前合成一次：挂点优先、显式颜色优先、强度取大，只出一次火焰一盏灯。
    /// </summary>
    public sealed class MuzzleFlashes : MonoBehaviour
    {
        const int PoolSize = 6, MaxParts = 5;
        /// <summary>WeaponController 的常数枪口（相机局部坐标，腰射 → 开镜）：ShotFx 用它认出哪次 MuzzleFlash 调用是开枪</summary>
        static readonly Vector3 MuzzleHip = new(0.2f, -0.13f, 0.75f), MuzzleAim = new(0, -0.08f, 0.7f);
        static readonly Color DefaultColor = new(1f, 0.75f, 0.4f);
        static readonly Color RailTint = new(0.79f, 0.66f, 1f);
        static readonly Color BowTint = new(0.86f, 0.92f, 1f);
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        struct Req
        {
            public bool any, hasColor, light;
            public Transform socket;
            public Vector3 fallback, dir;
            public Color color;
            public float strength;
        }

        /// <summary>一片：形状集的格、正面 / 侧面、尺寸（× 单位）、侧面的宽、白热芯、扩散（冲击环 / 波纹）、寿命倍率、透明度</summary>
        struct Part
        {
            public int cell;
            public bool side, hot, expand;
            public float size, width, life, alpha;

            public static Part Front(int cell, float size, bool hot = false, bool expand = false, float life = 1, float alpha = 1) =>
                new() { cell = cell, size = size, hot = hot, expand = expand, life = life, alpha = alpha };

            public static Part Side(int cell, float length, float width, float life = 1, float alpha = 1) =>
                new() { cell = cell, side = true, size = length, width = width, life = life, alpha = alpha };
        }

        sealed class Look
        {
            public Part[] parts;
            public float life = 0.055f, light = 1f;
            /// <summary>世界里的火星（拉丝）/ 余烬 / 烟 / 光点颗数，火星喷的锥角（度）和速度</summary>
            public int sparks, embers, smoke, motes;
            public float cone = 12f, sparkSpeed = 18f;
            /// <summary>颜色往这个色混（灵炮虹紫、弩的气浪）</summary>
            public Color? tint;
            public float tintMix;
        }

        // 形状集格号（T_Fx_MuzzleSet）
        const int Cross = 0, Spray = 1, Fireball = 2, Ring = 3, Ripple = 4, Core = 5, Star6 = 6, Rune = 7;
        const int LongTongue = 8, FatTongue = 9, Fan = 10, MidTongue = 11, EnergyFlow = 12, Burst8 = 13;

        static readonly Dictionary<MuzzleStyle, Look> Looks = new()
        {
            [MuzzleStyle.Smg] = new Look
            {
                life = 0.045f, sparks = 1,
                parts = new[] { Part.Front(Star6, 1.3f), Part.Front(Core, 0.55f, true), Part.Side(MidTongue, 1.9f, 0.6f), Part.Side(MidTongue, 1.7f, 0.5f) },
            },
            [MuzzleStyle.Rifle] = new Look
            {
                life = 0.055f, sparks = 1,
                parts = new[] { Part.Front(Cross, 1.5f), Part.Front(Core, 0.6f, true), Part.Side(MidTongue, 2.6f, 0.75f), Part.Side(MidTongue, 2.3f, 0.6f) },
            },
            [MuzzleStyle.Minigun] = new Look
            {
                life = 0.04f, sparks = 1,
                parts = new[] { Part.Front(Cross, 1.35f), Part.Front(Core, 0.55f, true), Part.Side(LongTongue, 3f, 0.65f) },
            },
            [MuzzleStyle.Shotgun] = new Look
            {
                life = 0.08f, light = 1.3f, sparks = 9, embers = 4, smoke = 2, cone = 13f, sparkSpeed = 20f,
                parts = new[] { Part.Front(Spray, 1.9f), Part.Front(Core, 0.75f, true), Part.Side(Fan, 2.6f, 1.9f), Part.Side(Fan, 2.3f, 1.7f) },
            },
            [MuzzleStyle.Sniper] = new Look
            {
                life = 0.09f, light = 1.3f, smoke = 2, sparks = 2,
                parts = new[]
                {
                    Part.Front(Ring, 1.4f, expand: true, life: 1.3f), Part.Front(Cross, 1f), Part.Front(Core, 0.6f, true), Part.Side(LongTongue, 4.4f, 0.8f),
                    Part.Side(LongTongue, 4f, 0.7f),
                },
            },
            [MuzzleStyle.Railgun] = new Look
            {
                life = 0.1f, light = 1.2f, motes = 5, tint = RailTint, tintMix = 0.55f,
                parts = new[]
                {
                    Part.Front(Ring, 1.6f, expand: true, life: 1.3f), Part.Front(Rune, 1.1f), Part.Front(Core, 0.6f, true), Part.Side(LongTongue, 4.6f, 0.8f),
                    Part.Side(EnergyFlow, 3f, 0.9f),
                },
            },
            [MuzzleStyle.Revolver] = new Look
            {
                life = 0.07f, light = 1.1f, embers = 3, smoke = 1,
                parts = new[] { Part.Front(Fireball, 1.45f), Part.Front(Core, 0.7f, true), Part.Side(FatTongue, 1.8f, 1.3f), Part.Side(FatTongue, 1.6f, 1.2f) },
            },
            [MuzzleStyle.Energy] = new Look
            {
                life = 0.1f, light = 0.7f, motes = 4,
                parts = new[]
                {
                    Part.Front(Ripple, 1.3f, expand: true, life: 1.2f), Part.Front(Rune, 0.95f, alpha: 0.85f), Part.Front(Core, 0.45f), Part.Side(EnergyFlow, 2f, 0.9f),
                },
            },
            [MuzzleStyle.Flamer] = new Look
            {
                life = 0.05f, light = 0.6f,
                parts = new[] { Part.Front(Fireball, 0.8f), Part.Front(Core, 0.45f, true), Part.Side(FatTongue, 1.2f, 0.9f) },
            },
            [MuzzleStyle.Launcher] = new Look
            {
                life = 0.085f, light = 1.4f, smoke = 4, embers = 4,
                parts = new[]
                {
                    Part.Front(Burst8, 1.5f), Part.Front(Fireball, 1.1f), Part.Front(Core, 0.7f, true), Part.Side(FatTongue, 1.7f, 1.4f), Part.Side(FatTongue, 1.5f, 1.2f),
                },
            },
            [MuzzleStyle.Rocket] = new Look
            {
                life = 0.06f, light = 1f, smoke = 2, sparks = 3, cone = 18f, sparkSpeed = 12f,
                parts = new[] { Part.Front(Fireball, 0.9f), Part.Front(Core, 0.5f, true), Part.Side(LongTongue, 2f, 0.8f) },
            },
            [MuzzleStyle.Crossbow] = new Look
            {
                life = 0.09f, light = 0f, tint = BowTint, tintMix = 0.8f,
                parts = new[] { Part.Front(Ripple, 1f, expand: true, alpha: 0.85f), Part.Side(EnergyFlow, 1.5f, 0.55f, alpha: 0.7f) },
            },
        };

        /// <summary>一份面片（第一人称一份、第三人称一份）</summary>
        sealed class Copy
        {
            public Transform root;
            public readonly Transform[] t = new Transform[MaxParts];
            public readonly MeshFilter[] f = new MeshFilter[MaxParts];
            public readonly MeshRenderer[] r = new MeshRenderer[MaxParts];
        }

        sealed class View
        {
            public Copy fp, world;
            public Look look;
            public int count;
            public readonly float[] roll = new float[MaxParts];
            public float age, life, unit, fpScale, fpTongue, aimFade;
            public Color color;
            public bool active, worldOn;
        }

        static MuzzleFlashes instance;
        Req pending;
        int pendingFrame = -1;
        readonly View[] views = new View[PoolSize];
        int next;
        readonly Mesh[] frontMesh = new Mesh[16], sideMesh = new Mesh[16];
        Mesh legacyStar, legacyPetal;
        MaterialPropertyBlock block;
        Camera vmCam, mainCam;
        WeaponController weapons;

        /// <summary>最近一次真正画出来的枪口火焰（测试用）：时间、是否挂在挂点上、世界位置、样式</summary>
        public static float LastFlashTime { get; private set; } = -1;
        public static bool LastFlashOnSocket { get; private set; }
        public static Vector3 LastFlashPosition { get; private set; }
        public static MuzzleStyle LastStyle { get; private set; }
        /// <summary>最近一次第一人称火焰的缩放（&lt; 1 = 为了不挡准星收小了）</summary>
        public static float LastFpScale { get; private set; } = 1;

        static MuzzleFlashes Get()
        {
            if (instance) return instance;
            var rt = FxRuntime.Ensure();
            if (!rt) return null;
            if (!rt.TryGetComponent(out instance)) instance = rt.gameObject.AddComponent<MuzzleFlashes>();
            return instance;
        }

        void OnEnable()
        {
            RenderPipelineManager.beginContextRendering += OnBeginRendering;
            RenderPipelineManager.beginCameraRendering += OnBeginCamera;
            GameEvents.WeaponFired += OnWeaponFired;
            // 抛壳：自己一个子物体（碰撞消息只发给粒子系统所在的物体）
            if (!GetComponentInChildren<ShellCasings>())
            {
                var go = new GameObject("Shell Casings");
                go.transform.SetParent(transform, false);
                go.AddComponent<ShellCasings>();
            }
        }

        void OnDisable()
        {
            RenderPipelineManager.beginContextRendering -= OnBeginRendering;
            RenderPipelineManager.beginCameraRendering -= OnBeginCamera;
            GameEvents.WeaponFired -= OnWeaponFired;
        }

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
            if (socket)
            {
                p.socket = socket;
                p.fallback = fallback;
            }
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

        /// <summary>弩（flash = 0，控制器不调枪口火焰）：开火事件里补一圈弦响的气浪</summary>
        void OnWeaponFired(WeaponInstance w)
        {
            if (w?.def == null || Fx.MuzzleStyleOf(w.def) != MuzzleStyle.Crossbow) return;
            var wc = Weapons();
            if (!wc || wc.Active != w) return;
            var cam = Camera.main;
            if (!cam) return;
            var socket = wc.MuzzleSocket;
            bool ok = socket && socket.gameObject.activeInHierarchy;
            var at = ok ? Fx.ViewmodelToMain(cam, socket.position, 0.9f) : cam.transform.TransformPoint(MuzzleHip);
            var sockets = ok ? socket.GetComponentInParent<WeaponSockets>() : null;
            Request(ok ? socket : null, at, sockets ? sockets.Forward : cam.transform.forward, BowTint, 1f, true, false);
        }

        void OnBeginRendering(ScriptableRenderContext _, List<Camera> __) => Resolve();

        /// <summary>第三人称那份只给别的相机画：主相机 / 枪模相机看第一人称那份</summary>
        void OnBeginCamera(ScriptableRenderContext _, Camera cam)
        {
            bool show = cam && cam != mainCam && cam != vmCam && cam.cameraType != CameraType.Preview;
            foreach (var v in views)
            {
                if (v == null || !v.active || v.world == null) continue;
                bool on = show && v.worldOn;
                for (int i = 0; i < v.count; i++)
                    if (v.world.r[i] && v.world.r[i].enabled != on)
                        v.world.r[i].enabled = on;
            }
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            foreach (var v in views)
            {
                if (v == null || !v.active) continue;
                v.age += dt;
                if (v.age >= v.life || !v.fp.root)
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

        WeaponController Weapons()
        {
            if (!weapons)
            {
                var pv = PlayerVitals.Instance;
                if (pv) weapons = pv.GetComponent<WeaponController>();
            }
            return weapons;
        }

        MuzzleStyle StyleFor(Transform socket)
        {
            var sockets = socket ? socket.GetComponentInParent<WeaponSockets>() : null;
            var def = sockets && !string.IsNullOrEmpty(sockets.weaponId) ? WeaponLibrary.Get(sockets.weaponId) : null;
            if (def == null)
            {
                var w = Weapons() ? Weapons().Active : null;
                def = w?.def;
            }
            return def != null ? Fx.MuzzleStyleOf(def) : MuzzleStyle.Rifle;
        }

        void Spawn(Req p)
        {
            mainCam = Camera.main;
            if (!mainCam) return;
            FindViewmodelCamera();
            bool onSocket = p.socket && p.socket.gameObject.activeInHierarchy;
            var style = StyleFor(onSocket ? p.socket : null);
            if (style == MuzzleStyle.None) return;
            if (!Looks.TryGetValue(style, out var look)) look = Looks[MuzzleStyle.Rifle];
            var color = p.hasColor ? p.color : WeaponColor();
            if (look.tint.HasValue) color = Color.Lerp(color, look.tint.Value, look.tintMix);
            float s = Mathf.Clamp(p.strength, 0.2f, 6f);
            var v = Take();
            if (v == null) return;
            var dir = p.dir.sqrMagnitude > 0.5f ? p.dir : mainCam.transform.forward;
            var up = mainCam.transform.up;
            Vector3 pos;
            var fp = v.fp;
            if (onSocket)
            {
                fp.root.SetParent(p.socket, false);
                fp.root.localPosition = Vector3.zero;
                pos = p.socket.position;
                // 枪模整体缩放过（第一人称 rig 的 ViewmodelScale）：火焰按世界尺寸画
                fp.root.localScale = Vector3.one / Mathf.Max(1e-3f, p.socket.lossyScale.x);
                var barrel = p.dir.sqrMagnitude > 0.5f ? p.dir : p.socket.forward;
                fp.root.rotation = Quaternion.LookRotation(barrel, up);
                SetLayer(fp, p.socket.gameObject.layer);
            }
            else
            {
                // 常数枪口按主相机算：换到第一人称相机里同一个屏幕位置、同样的深度
                var target = vmCam ? vmCam : mainCam;
                var vp = mainCam.WorldToViewportPoint(p.fallback);
                pos = target.ViewportToWorldPoint(vp);
                fp.root.SetParent(target.transform, true);
                fp.root.position = pos;
                fp.root.rotation = Quaternion.LookRotation(dir, up);
                fp.root.localScale = Vector3.one;
                SetLayer(fp, vmCam ? Layers.FirstPerson : 0);
            }
            v.look = look;
            v.count = Mathf.Min(MaxParts, look.parts.Length);
            v.color = color;
            v.unit = 0.14f * Mathf.Sqrt(Mathf.Clamp(s, 0.3f, 4f)) * Random.Range(0.9f, 1.1f);
            v.life = look.life * Mathf.Lerp(0.9f, 1.15f, Mathf.InverseLerp(0.5f, 3f, s));
            v.age = 0;
            v.active = true;
            FitToCrosshair(v, pos);
            float roll = Random.value * 360f;
            for (int i = 0; i < v.count; i++)
            {
                var part = look.parts[i];
                // 侧面片两两十字交叉；正面片各自随机转
                v.roll[i] = part.side ? roll + (i % 2) * 90f : Random.value * 360f;
                Assign(fp, i, part);
                fp.r[i].enabled = true;
            }
            for (int i = v.count; i < MaxParts; i++) fp.r[i].enabled = false;

            // 第三人称那份：世界里的枪口（主相机前 0.9 m 的换算点），只给别的相机画
            var world = v.world;
            world.root.SetParent(transform, false);
            world.root.SetPositionAndRotation(p.fallback, Quaternion.LookRotation(dir, up));
            world.root.localScale = Vector3.one;
            v.worldOn = true;
            for (int i = 0; i < v.count; i++)
            {
                Assign(world, i, look.parts[i]);
                world.r[i].enabled = false;
            }
            for (int i = v.count; i < MaxParts; i++) world.r[i].enabled = false;
            Draw(v);

            LastFlashTime = Time.time;
            LastFlashOnSocket = onSocket;
            LastFlashPosition = pos;
            LastStyle = style;
            if (p.light && look.light > 0)
            {
                var lightPos = onSocket ? pos : p.fallback;
                FxLightPool.Flash(lightPos, Color.Lerp(color, Color.white, 0.2f), Mathf.Min(30f, 6f * s * look.light), 6f * Mathf.Clamp(Mathf.Sqrt(s), 1f, 2.5f), 0.07f);
            }
            EmitWorld(look, p.fallback, dir, color, s);
        }

        /// <summary>
        /// 不挡准星：火焰在枪模相机里离屏幕中心 r（以半个屏高为 1），正面片半径不超过 0.72 r（留空），
        /// 火舌沿枪管指向准星、透视下尖端会往中心收——长度不超过深度（尖端停在一半处），开镜（r 小）时侧面片再淡一些
        /// </summary>
        void FitToCrosshair(View v, Vector3 pos)
        {
            v.fpScale = 1;
            v.fpTongue = 1;
            v.aimFade = 1;
            var cam = vmCam ? vmCam : mainCam;
            if (!cam) return;
            var local = cam.transform.InverseTransformPoint(pos);
            if (local.z < 0.05f) return;
            float tanV = Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad);
            float r = new Vector2(local.x, local.y).magnitude / (local.z * tanV);
            float maxR = 0.72f * r * local.z * tanV;
            float frontR = 0, tongue = 0;
            foreach (var part in v.look.parts)
            {
                if (part.side) tongue = Mathf.Max(tongue, part.size * v.unit);
                else frontR = Mathf.Max(frontR, part.size * v.unit * 0.5f * (part.expand ? 1.45f : 1.15f));
            }
            if (frontR > maxR) v.fpScale = Mathf.Max(0.15f, maxR / frontR);
            if (tongue > local.z) v.fpTongue = Mathf.Max(0.15f, local.z / tongue);
            v.aimFade = Mathf.Lerp(0.4f, 1f, Mathf.InverseLerp(0.12f, 0.45f, r));
            LastFpScale = v.fpScale;
        }

        void Draw(View v)
        {
            float k0 = v.age / Mathf.Max(0.001f, v.life);
            block ??= new MaterialPropertyBlock();
            for (int i = 0; i < v.count; i++)
            {
                var part = v.look.parts[i];
                float k = Mathf.Clamp01(k0 / Mathf.Max(0.2f, part.life));
                float alpha = (part.expand ? Mathf.Pow(1 - k, 1.2f) : 1 - k * k) * part.alpha;
                var c = part.hot ? Color.Lerp(v.color, Color.white, 0.65f) * 2.2f : v.color * 1.6f;
                for (int copy = 0; copy < 2; copy++)
                {
                    bool fpCopy = copy == 0;
                    var cp = fpCopy ? v.fp : v.world;
                    if (!cp.t[i]) continue;
                    float a = alpha * (fpCopy && part.side ? v.aimFade : 1f);
                    if (part.side)
                    {
                        float len = part.size * v.unit * (1f - 0.3f * k) * (fpCopy ? v.fpTongue * v.fpScale : 1.1f);
                        float wid = part.width * v.unit * (1.15f - 0.45f * k) * (fpCopy ? v.fpScale : 1.1f);
                        cp.t[i].localScale = new Vector3(len, wid, 1);
                        cp.t[i].localRotation = Quaternion.AngleAxis(v.roll[i], Vector3.forward) * Quaternion.Euler(0, -90, 0);
                    }
                    else
                    {
                        float grow = part.expand ? 0.55f + 0.9f * Mathf.Sqrt(k) : 1.15f - 0.45f * k;
                        float sz = part.size * v.unit * grow * (fpCopy ? v.fpScale : 1.15f);
                        cp.t[i].localScale = new Vector3(sz, sz, sz);
                        cp.t[i].localRotation = Quaternion.Euler(0, 0, v.roll[i]);
                    }
                    block.Clear();
                    block.SetColor(BaseColorId, new Color(c.r, c.g, c.b, a));
                    cp.r[i].SetPropertyBlock(block);
                }
            }
        }

        /// <summary>世界里的火星 / 余烬 / 烟 / 光点（从换算后的枪口沿枪管方向出去：第一人称、第三人称都看得到）</summary>
        static void EmitWorld(Look look, Vector3 at, Vector3 dir, Color color, float s)
        {
            if (look.sparks + look.embers + look.smoke + look.motes <= 0) return;
            var rt = FxRuntime.Ensure();
            if (!rt) return;
            var basis = Quaternion.LookRotation(dir);
            void Emit(string style, int n, float speedMin, float speedMax, float cone, Vector2 size, Vector2 life, Color c, float up)
            {
                if (n <= 0) return;
                int count = FxBudget.Allow(Mathf.Max(1, Mathf.RoundToInt(n * Fx.Density)), false);
                if (count <= 0) return;
                var e = rt.GetEmitter(style);
                if (e == null) return;
                float cosA = Mathf.Cos(cone * Mathf.Deg2Rad);
                for (int i = 0; i < count; i++)
                {
                    float z = Random.Range(cosA, 1f);
                    float phi = Random.value * Mathf.PI * 2;
                    float r = Mathf.Sqrt(Mathf.Max(0, 1 - z * z));
                    var d = basis * new Vector3(r * Mathf.Cos(phi), r * Mathf.Sin(phi), z);
                    var vel = d * Random.Range(speedMin, speedMax) + Vector3.up * up;
                    rt.EmitOne(e, at + d * 0.04f, vel, Random.Range(size.x, size.y), Random.Range(life.x, life.y), c, 0);
                }
            }
            var hot = Color.Lerp(color, Color.white, 0.4f);
            Emit("StreakLight", look.sparks, look.sparkSpeed * 0.75f, look.sparkSpeed * 1.25f, look.cone, new Vector2(0.025f, 0.035f), new Vector2(0.08f, 0.15f), hot, 0);
            Emit("Ember", look.embers, 2.5f, 5f, look.cone * 2.5f, new Vector2(0.04f, 0.07f), new Vector2(0.25f, 0.45f), color, 0.6f);
            Emit("Smoke", look.smoke, 0.6f, 1.6f, 25f, new Vector2(0.14f, 0.24f) * Mathf.Sqrt(Mathf.Clamp(s, 0.5f, 3f)), new Vector2(0.35f, 0.6f),
                new Color(0.62f, 0.6f, 0.58f, 0.55f), 0.5f);
            Emit("Mote", look.motes, 1.2f, 2.6f, 40f, new Vector2(0.04f, 0.07f), new Vector2(0.25f, 0.4f), Color.Lerp(color, Color.white, 0.3f), 0.3f);
        }

        Color WeaponColor()
        {
            var w = Weapons() ? Weapons().Active : null;
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
            if (v != null && v.fp.root && v.world.root) return v;
            v = Make();
            views[(next + PoolSize - 1) % PoolSize] = v;
            return v;
        }

        View Make()
        {
            var v = new View { fp = MakeCopy("Muzzle Flash"), world = MakeCopy("Muzzle Flash (3P)") };
            Hide(v);
            return v;
        }

        Copy MakeCopy(string name)
        {
            var root = new GameObject(name).transform;
            root.SetParent(transform, false);
            var c = new Copy { root = root };
            var mat = FxShotAssets.Muzzle ? FxShotAssets.Muzzle : FxMaterials.Muzzle;
            for (int i = 0; i < MaxParts; i++)
            {
                var go = new GameObject($"Part {i}");
                go.transform.SetParent(root, false);
                c.t[i] = go.transform;
                c.f[i] = go.AddComponent<MeshFilter>();
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterial = mat;
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = false;
                r.lightProbeUsage = LightProbeUsage.Off;
                r.reflectionProbeUsage = ReflectionProbeUsage.Off;
                r.enabled = false;
                c.r[i] = r;
            }
            return c;
        }

        /// <summary>这一片的网格（形状集的格；形状集缺失时退回旧贴图的星芒 / 火舌两格）</summary>
        void Assign(Copy c, int i, Part part)
        {
            Mesh m;
            if (FxShotAssets.Muzzle)
            {
                var arr = part.side ? sideMesh : frontMesh;
                m = arr[part.cell];
                if (!m)
                {
                    int col = part.cell % 4, row = part.cell / 4;
                    var uv0 = new Vector2(col * 0.25f, 1f - (row + 1) * 0.25f);
                    var uv1 = uv0 + new Vector2(0.25f, 0.25f);
                    m = arr[part.cell] = part.side ? Quad($"Muzzle Side {part.cell}", uv0, uv1, 0f, 1f) : Quad($"Muzzle Front {part.cell}", uv0, uv1, -0.5f, 0.5f);
                }
            }
            else
            {
                if (!legacyStar) legacyStar = Quad("Muzzle Star", new Vector2(0, 0), new Vector2(0.5f, 1), -0.5f, 0.5f);
                if (!legacyPetal) legacyPetal = Quad("Muzzle Petal", new Vector2(0.5f, 0), new Vector2(1, 1), 0f, 1f);
                m = part.side ? legacyPetal : legacyStar;
            }
            if (c.f[i].sharedMesh != m) c.f[i].sharedMesh = m;
        }

        /// <summary>单位面片：x 从 x0 到 x1（火舌从根部 0 伸到 1），y ±0.5，uv 取图集的一格</summary>
        static Mesh Quad(string name, Vector2 uv0, Vector2 uv1, float x0, float x1)
        {
            var m = new Mesh { name = name, hideFlags = HideFlags.DontSave };
            m.vertices = new[] { new Vector3(x0, -0.5f, 0), new Vector3(x1, -0.5f, 0), new Vector3(x0, 0.5f, 0), new Vector3(x1, 0.5f, 0) };
            m.uv = new[] { uv0, new Vector2(uv1.x, uv0.y), new Vector2(uv0.x, uv1.y), uv1 };
            m.triangles = new[] { 0, 2, 1, 1, 2, 3 };
            m.RecalculateBounds();
            m.bounds = new Bounds(Vector3.zero, Vector3.one * 2);
            return m;
        }

        static void SetLayer(Copy c, int layer)
        {
            c.root.gameObject.layer = layer;
            foreach (var t in c.t)
                if (t)
                    t.gameObject.layer = layer;
        }

        void Hide(View v)
        {
            v.active = false;
            v.worldOn = false;
            HideCopy(v.fp);
            HideCopy(v.world);
        }

        void HideCopy(Copy cp)
        {
            if (cp == null || !cp.root) return;
            foreach (var r in cp.r)
                if (r)
                    r.enabled = false;
            // 挂点会随武器切换被停用 / 销毁：收回到 Fx 根下
            if (cp.root.parent != transform) cp.root.SetParent(transform, false);
        }

        /// <summary>全部收起（换关清场）</summary>
        internal static void ClearAll()
        {
            if (!instance) return;
            instance.pending.any = false;
            foreach (var v in instance.views)
                if (v != null)
                    instance.Hide(v);
            ShellCasings.ClearAll();
        }
    }
}
