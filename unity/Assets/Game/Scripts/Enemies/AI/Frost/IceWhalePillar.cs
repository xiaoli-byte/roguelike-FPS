using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰鲸的冰柱雨（Three.js 版 FrostRangedFx.launchIcePillars / pillarImpact）：
    ///   <see cref="Launch"/>：喷气孔猛地冲起一道约 9 m 高的冰雾气柱，N 根冰柱冲上天（0.95 s 后消失在高处）；
    ///     每个落点立刻亮出电光蓝预警圈（浅色冰面上普通混合才读得出），到各自的落地时刻前 0.42 s 从 15 m 高空砸下（头顶来的，掩体挡不住）。
    ///   砸地：落点半径内（+ 玩家半径的一半）、脚底高差在 (−0.8, 3.2) 的玩家吃伤害（中心 100% → 边缘 60%），被推出落点（6.5 m/s + 向上 3.2）；
    ///     然后长出一簇冰棱阵（<see cref="SpikeField"/>：半径 1.3、5 s、高 1.9，均 × 体型系数），阻挡移动、不挡子弹和视线。
    ///   出手者被嘲讽（灵宠讙）期间砸不到玩家。伤害是最终值（调用方已乘等级 / 精英倍率）。
    /// 一个组件 = 一根在飞的冰柱（上升或下落），外观是程序化的六棱冰柱（中段粗、两头尖）+ 自发光。
    /// </summary>
    public sealed class IceWhalePillar : MonoBehaviour
    {
        /// <summary>下落段时长、下落起点高度、上升段时长 / 初速</summary>
        public const float FallTime = 0.42f, DropHeight = 15f, RiseTime = 0.95f, RiseSpeed = 15f;
        /// <summary>气柱高度、半宽、持续（米 / 秒，乘体型系数）</summary>
        public const float PlumeHeight = 9f, PlumeRadius = 0.8f, PlumeTime = 0.75f;
        /// <summary>冰棱阵：分布半径、持续、高度（米，乘体型系数）</summary>
        public const float FieldRadius = 1.3f, FieldTime = 5f, FieldHeight = 1.9f;
        /// <summary>落点预警色（饱和电光蓝）</summary>
        public static readonly Color WarnColor = Hex.Rgb(0x1a8cff);

        static readonly Color IceColor = Hex.Rgb(0xcff4ff), ShardColor = Hex.Rgb(0xdff6ff), MistColor = Hex.Rgb(0xe8f8ff), SparkColor = Hex.Rgb(0xc8f8ff), PlumeColor = Hex.Rgb(0x38c4ff);
        static Mesh pillarMesh;
        static Material pillarMaterial;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor"), EmissionId = Shader.PropertyToID("_EmissionColor");

        /// <summary>一轮冰柱雨的参数</summary>
        public struct Volley
        {
            /// <summary>喷出点（喷气孔）</summary>
            public Vector3 from;
            /// <summary>落点（地面点）与各自的落地时刻（从现在起，秒）</summary>
            public IReadOnlyList<Vector3> targets;
            public IReadOnlyList<float> times;
            /// <summary>砸中半径、伤害（最终值）、体型系数（精英 1.15）</summary>
            public float radius, damage, scale;
            public EnemyAI owner;
        }

        Vector3 target, velocity;
        float t, life, damage, radius, scale, spin;
        bool falling;
        EnemyAI owner;

        /// <summary>砸中的伤害衰减：落点中心 1 → 半径处 0.6</summary>
        public static float Falloff(float distance, float radius) => radius > 0 ? 1 - 0.4f * Mathf.Clamp01(distance / radius) : 1;

        /// <summary>喷出一轮冰柱雨：气柱 + 上升的冰柱 + 每个落点的预警圈，按时刻砸下</summary>
        public static void Launch(in Volley v)
        {
            float k = v.scale > 0 ? v.scale : 1;
            var from = v.from;
            // 气柱：一眼就看得出「它喷了」
            Fx.Beam(from, from + Vector3.up * PlumeHeight * k, PlumeColor, PlumeRadius * k, PlumeTime);
            Fx.Burst(from, MistColor, 18, 6, 0.9f, 0.35f * k, -2);
            Fx.Burst(from, ShardColor, 22, 9, 0.8f, 0.1f * k, 12);
            Fx.Burst(from + Vector3.up * PlumeHeight * 0.8f * k, MistColor, 10, 2.5f, 0.9f, 0.45f * k, -1);
            int n = Mathf.Min(v.targets.Count, v.times.Count);
            for (int i = 0; i < n; i++)
            {
                var tgt = v.targets[i];
                // 上升段：略微朝落点方向斜着喷出，逐根加快
                var flat = tgt - from;
                flat.y = 0;
                var side = flat.sqrMagnitude > 1e-4f ? flat.normalized * 2.2f : Vector3.zero;
                Create("Ice Pillar (rise)", from, false).Rise(new Vector3(side.x, RiseSpeed + i * 1.2f, side.z), 1.05f * k);
                float T = Mathf.Max(FallTime + 0.1f, v.times[i]);
                Telegraph.Circle(tgt, v.radius, T, WarnColor);
                float dmg = v.damage, r = v.radius;
                var owner = v.owner;
                HazardClock.Delay(T - FallTime, () => Create("Ice Pillar", tgt + Vector3.up * DropHeight, true).Fall(tgt, dmg, r, k, owner));
            }
        }

        static IceWhalePillar Create(string name, Vector3 at, bool shadow)
        {
            var go = new GameObject(name);
            go.transform.position = at;
            go.AddComponent<MeshFilter>().sharedMesh = Mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = Material;
            var block = new MaterialPropertyBlock();
            block.SetColor(BaseColorId, IceColor);
            block.SetColor(EmissionId, Hex.Rgb(0x2a8cc8) * 1.6f);
            r.SetPropertyBlock(block);
            r.shadowCastingMode = shadow ? ShadowCastingMode.On : ShadowCastingMode.Off;
            return go.AddComponent<IceWhalePillar>();
        }

        void Rise(Vector3 v, float size)
        {
            velocity = v;
            life = RiseTime;
            spin = (Random.value - 0.5f) * 6f;
            transform.localScale = Vector3.one * size;
        }

        void Fall(Vector3 at, float dmg, float r, float k, EnemyAI who)
        {
            falling = true;
            target = at;
            damage = dmg;
            radius = r;
            scale = k;
            owner = who;
            life = FallTime;
            transform.localScale = Vector3.one * 1.15f * k;
            transform.rotation = Quaternion.Euler(180, Random.value * 360f, 0);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            t += dt;
            if (!falling)
            {
                transform.position += velocity * dt;
                transform.Rotate(0, spin * Mathf.Rad2Deg * dt, 0, Space.World);
                if (Random.value < dt * 20f) Fx.Burst(transform.position, SparkColor, 1, 0.6f, 0.4f, 0.12f, -1);
                if (t >= life)
                {
                    Fx.Burst(transform.position, MistColor, 3, 1.5f, 0.5f, 0.3f, 0);
                    Destroy(gameObject);
                }
                return;
            }
            float u = Mathf.Clamp01(t / life);
            transform.position = target + Vector3.up * (DropHeight * (1 - u * u) + 1.1f * scale);
            if (Random.value < dt * 16f) Fx.Burst(transform.position, SparkColor, 1, 0.5f, 0.3f, 0.14f * scale, 2);
            if (u < 1) return;
            Impact();
            Destroy(gameObject);
        }

        void Impact()
        {
            var c = target;
            var pv = PlayerVitals.Instance;
            if (pv && !pv.Dead && !(owner && owner.Taunted))
            {
                var feet = pv.transform.position;
                var cc = pv.GetComponent<CharacterController>();
                float pr = cc ? cc.radius : 0.35f;
                var flat = new Vector3(feet.x - c.x, 0, feet.z - c.z);
                float d = flat.magnitude, dy = feet.y - c.y;
                if (d <= radius + pr * 0.5f && dy > -0.8f && dy < 3.2f)
                {
                    float dealt = Combat.DamagePlayer(damage * Falloff(d, radius), c + Vector3.up * 0.5f, Element.None, owner);
                    // 推出落点（冰棱阵随后封住这里）
                    var dir = d > 0.05f ? flat / d : Vector3.right;
                    var motor = pv.GetComponent<PlayerMotor>();
                    if (motor && !pv.Dead && (dealt > 0 || !pv.Invulnerable)) motor.AddImpulse(new Vector3(dir.x * 6.5f, 3.2f, dir.z * 6.5f));
                }
            }
            var at = c + Vector3.up * 0.4f;
            Fx.Burst(at, ShardColor, 20, 7, 0.8f, 0.13f * scale, 16);
            Fx.Burst(at, MistColor, 8, 2.5f, 0.9f, 0.45f * scale, -0.8f);
            Fx.Ring(c + Vector3.up * 0.05f, radius * 1.2f, IceColor, 0.45f);
            CameraShake.Quake(c, 0.3f, 22f, 0.25f);
            GameAudio.PlayAt("boss_slam", at, 0.55f, 1.35f);
            SpikeField.Spawn(new SpikeField.Spec(c, FieldRadius * scale, FieldTime, FieldHeight * scale));
        }

        /// <summary>六棱冰柱：中段粗、两头尖（全长约 2.2，中心在原点，尖头朝 +Y），全场共用</summary>
        static Mesh Mesh
        {
            get
            {
                if (pillarMesh) return pillarMesh;
                const int sides = 6;
                // 剖面：(y, 半径) 从上尖到下尖
                var rings = new[] { (1.25f, 0f), (0.55f, 0.32f), (-0.55f, 0.26f), (-0.95f, 0f) };
                var v = new List<Vector3>();
                var tri = new List<int>();
                for (int r = 0; r < rings.Length - 1; r++)
                for (int i = 0; i < sides; i++)
                {
                    float a0 = i / (float)sides * Mathf.PI * 2f, a1 = (i + 1) / (float)sides * Mathf.PI * 2f;
                    var (y0, r0) = rings[r];
                    var (y1, r1) = rings[r + 1];
                    int b = v.Count;
                    v.Add(new Vector3(Mathf.Sin(a0) * r0, y0, Mathf.Cos(a0) * r0));
                    v.Add(new Vector3(Mathf.Sin(a1) * r0, y0, Mathf.Cos(a1) * r0));
                    v.Add(new Vector3(Mathf.Sin(a0) * r1, y1, Mathf.Cos(a0) * r1));
                    v.Add(new Vector3(Mathf.Sin(a1) * r1, y1, Mathf.Cos(a1) * r1));
                    // 同 SpikeField 的六棱锥：下 a0 → 下 a1 → 上 为正面
                    tri.Add(b + 2);
                    tri.Add(b + 3);
                    tri.Add(b);
                    tri.Add(b + 3);
                    tri.Add(b + 1);
                    tri.Add(b);
                }
                pillarMesh = new Mesh { name = "Ice Pillar" };
                pillarMesh.SetVertices(v);
                pillarMesh.SetTriangles(tri, 0);
                pillarMesh.RecalculateNormals();
                pillarMesh.RecalculateBounds();
                return pillarMesh;
            }
        }

        static Material Material
        {
            get
            {
                if (pillarMaterial) return pillarMaterial;
                pillarMaterial = new Material(Shader.Find("Universal Render Pipeline/Lit")) { name = "Ice Pillar (runtime)" };
                pillarMaterial.SetFloat("_Smoothness", 0.8f);
                pillarMaterial.EnableKeyword("_EMISSION");
                return pillarMaterial;
            }
        }
    }
}
