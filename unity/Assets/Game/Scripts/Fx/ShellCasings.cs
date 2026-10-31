using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 抛壳（特效打磨 A 路）：开火事件里，按 <see cref="Fx.ShellOf"/> 从枪模的 eject 挂点（W3，+Z 指向抛出方向）抛一枚弹壳。
    ///   一个共享的世界空间 Shuriken（网格粒子：手枪弹 / 步枪弹 / 大口径 / 红色霰弹壳四种程序网格，URP Particles/Lit 受光，顶点色上铜黄 / 壳红）；
    ///   出生点 = eject 挂点在枪模相机里的屏幕位置换算到主相机（<see cref="Fx.ViewmodelToMain"/>），刚抛出时被第一人称枪模挡住，从枪身右侧蹦出来；
    ///   初速度 = 抛出方向 2.2–3.4 m/s + 往上一点 + 玩家自己的速度（跑动时不会往后飞）；1.5 倍重力，和地形碰撞弹跳（反弹 0.28–0.42），
    ///   头 0.55 s 翻滚、之后停转躺在地上，2.6 s 后缩没。碰撞时按落地速度叮一声（GameAudio 的 pickup_coin 升调，0.05 s 内只响一次）。
    ///   限量：同屏上限 48 × 画质系数（低档 24），满了新抛的丢掉；机炮隔一发抛一枚。能量类、弓弩、发射器、喷火、转轮 / 折开换弹的不抛。
    ///   顶点色按线性写（第二批收尾 D 路）：M_Fx_Shell 是 URP Particles/Lit，网格粒子实例化时按 unity_ParticleUseMeshColors 直接读网格顶点色、当线性值用。
    ///   原来按 sRGB 写的铜黄（1, 0.74, 0.26）实际显示成发白的奶油色，在亮沙上只靠一点明度差；现在按屏幕上想要的颜色重新取色、过 <see cref="FxVertexColor.Linear"/>：
    ///   亮金 #ffd95e + 深铜底缘 #8a5a16 + 近黑口部（饱和度和明暗都和沙地拉开），霰弹壳朱红 #e03a22（色样对比：docs/art/review/batch2/D/shell-*.jpg，playtest shell-swatch）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ShellCasings : MonoBehaviour
    {
        const float Life = 2.6f, MaxShells = 48;
        /// <summary>各种弹壳的长度（米，已按卡通比例放大 1.3 倍）与半径 / 长度比</summary>
        static readonly float[] Length = { 0, 0.032f * 1.3f, 0.05f * 1.3f, 0.075f * 1.3f, 0.062f * 1.3f };
        static readonly float[] Ratio = { 0, 0.28f, 0.2f, 0.19f, 0.23f };

        static ShellCasings instance;
        ParticleSystem ps;
        ParticleSystem.EmitParams ep;
        readonly List<ParticleCollisionEvent> events = new();
        WeaponController weapons;
        PlayerMotor motor;
        float lastClink;
        int skip;

        /// <summary>累计：抛出的弹壳 / 叮当声（测试用）</summary>
        public static int Ejected { get; private set; }
        public static int Clinks { get; private set; }
        /// <summary>此刻在场的弹壳</summary>
        public static int Live => instance && instance.ps ? instance.ps.particleCount : 0;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            instance = null;
            Ejected = Clinks = 0;
        }

        void Awake()
        {
            instance = this;
            Build();
        }

        void OnEnable() => GameEvents.WeaponFired += OnFired;

        void OnDisable() => GameEvents.WeaponFired -= OnFired;

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        void Build()
        {
            var mat = FxShotAssets.Shell;
            if (!mat) return;
            transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            ps = gameObject.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.playOnAwake = false;
            main.loop = true;
            main.duration = 1;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.startLifetime = Life;
            main.startSpeed = 0;
            main.startSize = 0.05f;
            main.startRotation3D = true;
            main.gravityModifier = 1.5f;
            main.maxParticles = (int)MaxShells;
            main.scalingMode = ParticleSystemScalingMode.Hierarchy;
            main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
            var em = ps.emission;
            em.enabled = false;
            var shape = ps.shape;
            shape.enabled = false;
            // 碰撞半径 = 粒子尺寸（弹壳长度）× radiusScale / 2：网格按长度 1 建，尺寸就是长度
            var col = ps.collision;
            col.enabled = true;
            col.type = ParticleSystemCollisionType.World;
            col.mode = ParticleSystemCollisionMode.Collision3D;
            col.collidesWith = Layers.WorldMask;
            col.bounce = new ParticleSystem.MinMaxCurve(0.28f, 0.42f);
            col.dampen = new ParticleSystem.MinMaxCurve(0.25f, 0.4f);
            col.lifetimeLoss = 0;
            col.radiusScale = 0.45f;
            col.quality = ParticleSystemCollisionQuality.High;
            col.enableDynamicColliders = false;
            col.sendCollisionMessages = true;
            // 头 21% 寿命（≈ 0.55 s）翻滚，之后停转
            var rot = ps.rotationOverLifetime;
            rot.enabled = true;
            rot.separateAxes = true;
            var spinMax = new AnimationCurve(new Keyframe(0, 1), new Keyframe(0.21f, 0), new Keyframe(1, 0));
            var spinMin = new AnimationCurve(new Keyframe(0, -1), new Keyframe(0.21f, 0), new Keyframe(1, 0));
            rot.x = new ParticleSystem.MinMaxCurve(22f, spinMin, spinMax);
            rot.y = new ParticleSystem.MinMaxCurve(14f, spinMin, spinMax);
            rot.z = new ParticleSystem.MinMaxCurve(22f, spinMin, spinMax);
            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1, new AnimationCurve(new Keyframe(0, 1), new Keyframe(0.86f, 1), new Keyframe(1, 0)));
            var r = GetComponent<ParticleSystemRenderer>();
            r.renderMode = ParticleSystemRenderMode.Mesh;
            r.SetMeshes(new[] { ShellMesh(ShellKind.Pistol), ShellMesh(ShellKind.Rifle), ShellMesh(ShellKind.Sniper), ShellMesh(ShellKind.Hull) });
            r.sharedMaterial = mat;
            r.alignment = ParticleSystemRenderSpace.World;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = true;
            r.enableGPUInstancing = true;
            ps.Play();
        }

        WeaponController Weapons()
        {
            if (!weapons)
            {
                var pv = PlayerVitals.Instance;
                if (pv)
                {
                    weapons = pv.GetComponent<WeaponController>();
                    motor = pv.GetComponent<PlayerMotor>();
                }
            }
            return weapons;
        }

        void OnFired(WeaponInstance w)
        {
            var kind = Fx.ShellOf(w?.def);
            if (kind == ShellKind.None || !ps) return;
            var wc = Weapons();
            if (!wc || wc.Active != w) return;
            if (w.def.id == "minigun" && (skip++ & 1) == 1) return;
            if (ps.particleCount >= Mathf.Max(8, Mathf.RoundToInt(MaxShells * FxBudget.StyleCapScale))) return;
            var cam = Camera.main;
            if (!cam) return;
            var muzzle = wc.MuzzleSocket;
            var sockets = muzzle ? muzzle.GetComponentInParent<WeaponSockets>() : null;
            var eject = sockets ? sockets.eject : null;
            Vector3 pos, dir;
            var ct = cam.transform;
            if (eject && eject.gameObject.activeInHierarchy)
            {
                float z = Mathf.Max(0.3f, ct.InverseTransformPoint(eject.position).z);
                pos = Fx.ViewmodelToMain(cam, eject.position, z);
                dir = eject.forward;
            }
            else
            {
                pos = ct.TransformPoint(new Vector3(0.16f, -0.1f, 0.5f));
                dir = (ct.right + ct.up * 0.5f - ct.forward * 0.1f).normalized;
            }
            var vel = dir * Random.Range(2.2f, 3.4f) + ct.up * Random.Range(0.6f, 1.2f) + Random.insideUnitSphere * 0.35f;
            if (motor) vel += motor.Velocity;
            int k = (int)kind;
            ep = default;
            ep.applyShapeToPosition = false;
            ep.position = pos;
            ep.velocity = vel;
            ep.startSize = Length[k];
            ep.startLifetime = Life * Random.Range(0.9f, 1.1f);
            ep.rotation3D = new Vector3(Random.value * 360f, Random.value * 360f, Random.value * 360f);
            ep.startColor = Color.white;
            ep.meshIndex = k - 1;
            ps.Emit(ep, 1);
            Ejected++;
        }

        void OnParticleCollision(GameObject other)
        {
            if (!ps) return;
            int n = ps.GetCollisionEvents(other, events);
            float now = Time.time;
            for (int i = 0; i < n; i++)
            {
                float speed = events[i].velocity.magnitude;
                if (speed < 0.9f || now - lastClink < 0.05f) continue;
                lastClink = now;
                Clinks++;
                GameAudio.PlayAt("pickup_coin", events[i].intersection, Mathf.Lerp(0.05f, 0.16f, Mathf.InverseLerp(0.9f, 5f, speed)), Random.Range(1.9f, 2.4f));
            }
        }

        /// <summary>全部收起（换关清场）</summary>
        internal static void ClearAll()
        {
            if (instance && instance.ps) instance.ps.Clear();
        }

        // ───────────── 网格 ─────────────

        /// <summary>弹壳网格：沿 +z、长度 1（-0.5 .. 0.5），8 边圆柱 + 底缘 + 封口；顶点色 = 底色（铜黄 / 壳红 + 铜底），口部压暗当开口</summary>
        static Mesh ShellMesh(ShellKind kind)
        {
            const int sides = 8;
            float r = Ratio[(int)kind];
            bool hull = kind == ShellKind.Hull;
            var brass = FxVertexColor.Linear(Hex.Rgb(0xffd95e));
            var brassDark = FxVertexColor.Linear(Hex.Rgb(0x8a5a16));
            var red = FxVertexColor.Linear(Hex.Rgb(0xe03a22));
            // 截面环：z、半径、颜色
            var rings = new List<(float z, float rad, Color c)>
            {
                (-0.5f, r * 1.08f, brassDark),
                (-0.43f, r * 1.08f, brassDark),
                (-0.42f, r * 0.9f, brassDark),
                (-0.36f, r, hull ? brass : brass),
            };
            if (hull)
            {
                rings.Add((-0.18f, r, brass));
                rings.Add((-0.17f, r, red));
                rings.Add((0.5f, r * 0.96f, red));
            }
            else
            {
                rings.Add((kind == ShellKind.Pistol ? 0.5f : 0.22f, r, brass));
                if (kind != ShellKind.Pistol)
                {
                    rings.Add((0.34f, r * 0.72f, brass));
                    rings.Add((0.5f, r * 0.7f, brass));
                }
            }
            var verts = new List<Vector3>();
            var norms = new List<Vector3>();
            var cols = new List<Color>();
            var tris = new List<int>();
            for (int k = 0; k + 1 < rings.Count; k++)
            {
                var (z0, r0, c0) = rings[k];
                var (z1, r1, _) = rings[k + 1];
                int b = verts.Count;
                float slope = (r0 - r1) / Mathf.Max(1e-4f, z1 - z0);
                for (int i = 0; i <= sides; i++)
                {
                    float a = i * Mathf.PI * 2 / sides;
                    var radial = new Vector3(Mathf.Cos(a), Mathf.Sin(a), 0);
                    var n = (radial + Vector3.forward * slope).normalized;
                    verts.Add(radial * r0 + Vector3.forward * z0);
                    verts.Add(radial * r1 + Vector3.forward * z1);
                    norms.Add(n);
                    norms.Add(n);
                    cols.Add(c0);
                    cols.Add(c0);
                }
                for (int i = 0; i < sides; i++)
                {
                    int a0 = b + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
                    tris.AddRange(new[] { a0, b0, a1, a1, b0, b1 });
                }
            }
            // 底面（实心）与口部（暗：读作开口；霰弹壳是压褶封口）
            Cap(rings[0].z, rings[0].rad, -1, brassDark);
            var top = rings[rings.Count - 1];
            Cap(top.z, top.rad, 1, FxVertexColor.Linear(hull ? Hex.Rgb(0x8c1e12) : Hex.Rgb(0x2a1a0c)));
            var m = new Mesh { name = $"Shell {kind}", hideFlags = HideFlags.DontSave };
            m.SetVertices(verts);
            m.SetNormals(norms);
            m.SetColors(cols);
            m.SetTriangles(tris, 0);
            m.RecalculateBounds();
            return m;

            void Cap(float z, float rad, int side, Color c)
            {
                int center = verts.Count;
                verts.Add(new Vector3(0, 0, z));
                norms.Add(Vector3.forward * side);
                cols.Add(c);
                for (int i = 0; i <= sides; i++)
                {
                    float a = i * Mathf.PI * 2 / sides;
                    verts.Add(new Vector3(Mathf.Cos(a) * rad, Mathf.Sin(a) * rad, z));
                    norms.Add(Vector3.forward * side);
                    cols.Add(c);
                }
                for (int i = 0; i < sides; i++)
                {
                    if (side > 0) tris.AddRange(new[] { center, center + 1 + i, center + 2 + i });
                    else tris.AddRange(new[] { center, center + 2 + i, center + 1 + i });
                }
            }
        }
    }
}
