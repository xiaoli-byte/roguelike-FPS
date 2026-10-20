using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰棱阵 / 石笋阵（Three.js 版 FrostRangedFx.spawnSpikeField：冰鲸的冰柱落地后留下的一簇冰棱）：
    ///   外观：中间一根主刺 + 一圈外斜的小刺，0.22 s 破土（略冲过头），到时碎裂、0.4 s 沉下去消失。
    ///   阻挡：破土 0.12 s 后、阵内没有玩家 / 敌人时（不把人卡在里面）立起一个方形挡块：边长 = 1.5 × 半径、高 max(2.4, 刺高 + 0.3)，
    ///         放在只挡移动的层（<see cref="BlockerLayer"/> = Ignore Raycast：玩家胶囊、敌人的物理照样挡，子弹、视线、地面检测都穿过去，
    ///         同 TS noRaycast），并在导航网格上挖洞（NavMeshObstacle carve）让地面敌人绕开。到时撤掉挡块和洞。
    ///   登记：<see cref="Active"/> 列出场上还在的阵（AI 判断路线被封用）。
    /// </summary>
    public sealed class SpikeField : MonoBehaviour
    {
        /// <summary>挡块所在的层：只挡移动（边界墙、布娃娃模式的角色胶囊也在这一层）</summary>
        public const int BlockerLayer = Layers.IgnoreRaycast;
        /// <summary>破土多久后开始尝试立挡块、破土动画时长、碎裂下沉时长（秒）</summary>
        public const float BlockDelay = 0.12f, RiseTime = 0.22f, SinkTime = 0.4f;

        public struct Spec
        {
            /// <summary>阵心（地面点）、分布半径、持续时间、主刺高度（米）</summary>
            public Vector3 center;
            public float radius, duration, height;
            /// <summary>刺的数量（含主刺）与颜色</summary>
            public int count;
            public Color color;
            /// <summary>立挡块（false = 只是外观）</summary>
            public bool block;

            /// <summary>缺省：9 根冰棱、立挡块（TS 冰鲸：半径 1.3、5 s、高 1.9）</summary>
            public Spec(Vector3 center, float radius, float duration, float height)
            {
                this.center = center;
                this.radius = radius;
                this.duration = duration;
                this.height = height;
                count = 9;
                color = new Color(0.8f, 0.93f, 1f);
                block = true;
            }
        }

        static readonly List<SpikeField> active = new();
        static Mesh coneMesh;
        static Material spikeMaterial;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor"), EmissionId = Shader.PropertyToID("_EmissionColor");

        Spec spec;
        Transform group;
        GameObject blocker;
        float t;
        bool shattered;

        /// <summary>场上还在的阵</summary>
        public static IReadOnlyList<SpikeField> Active => active;
        public Vector3 Center => spec.center;
        /// <summary>挡块半边长（米）</summary>
        public float HalfSize => spec.radius * 0.75f;
        /// <summary>挡块立着</summary>
        public bool Blocking => blocker;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => active.Clear();

        public static SpikeField Spawn(in Spec s)
        {
            var go = new GameObject("Spike Field");
            go.transform.position = s.center;
            var f = go.AddComponent<SpikeField>();
            f.spec = s;
            f.Build();
            return f;
        }

        void OnEnable() => active.Add(this);
        void OnDisable() => active.Remove(this);

        void Build()
        {
            group = new GameObject("Spikes").transform;
            group.SetParent(transform, false);
            group.localScale = new Vector3(1, 0.01f, 1);
            int n = Mathf.Max(1, spec.count);
            var block = new MaterialPropertyBlock();
            block.SetColor(BaseColorId, spec.color);
            block.SetColor(EmissionId, spec.color * 0.35f);
            for (int i = 0; i < n; i++)
            {
                bool main = i == 0;
                float a = i / (float)Mathf.Max(1, n - 1) * Mathf.PI * 2f + Random.value * 0.5f;
                float rr = main ? 0 : spec.radius * (0.35f + 0.55f * Random.value);
                float h = spec.height * (main ? 1f : 0.5f + Random.value * 0.4f);
                float w = h * (main ? 0.38f : 0.32f);
                var go = new GameObject(main ? "Spike (main)" : "Spike");
                go.transform.SetParent(group, false);
                go.transform.localPosition = new Vector3(Mathf.Sin(a) * rr, -0.05f, Mathf.Cos(a) * rr);
                // 外圈的刺朝外斜
                go.transform.localRotation = main ? Quaternion.Euler(0, Random.value * 360f, 0)
                    : Quaternion.Euler(Mathf.Cos(a) * 0.35f * Mathf.Rad2Deg, Random.value * 360f, -Mathf.Sin(a) * 0.35f * Mathf.Rad2Deg);
                go.transform.localScale = new Vector3(w, h, w);
                go.AddComponent<MeshFilter>().sharedMesh = Cone;
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterial = Material;
                r.SetPropertyBlock(block);
                r.shadowCastingMode = main ? ShadowCastingMode.On : ShadowCastingMode.Off;
            }
        }

        void Update()
        {
            float dt = Time.deltaTime;
            t += dt;
            if (t < RiseTime)
            {
                float u = t / RiseTime;
                group.localScale = new Vector3(1, Mathf.Max(0.01f, u * (1.15f - 0.15f * u)), 1);
            }
            else if (t < spec.duration) group.localScale = Vector3.one;
            bool live = t >= BlockDelay && t < spec.duration;
            if (live && spec.block && !blocker && FieldClear(spec.center, HalfSize)) AddBlocker();
            if (t < spec.duration) return;
            if (!shattered)
            {
                shattered = true;
                RemoveBlocker();
                var at = spec.center + Vector3.up * 0.6f;
                ShotFx.Instance?.Impact(at, Vector3.up, false, 3f);
                GameAudio.PlayAt("shield_break", at, 0.45f, 1.6f);
            }
            float k = Mathf.Clamp01((t - spec.duration) / SinkTime);
            group.localPosition = Vector3.down * (k * spec.height);
            if (k >= 1) Destroy(gameObject);
        }

        /// <summary>挡块：Ignore Raycast 层的方形碰撞体 + 导航网格挖洞</summary>
        void AddBlocker()
        {
            float half = HalfSize, h = Mathf.Max(2.4f, spec.height + 0.3f);
            blocker = new GameObject("Spike Blocker") { layer = BlockerLayer };
            blocker.transform.SetParent(transform, false);
            var size = new Vector3(half * 2, h, half * 2);
            var center = new Vector3(0, h * 0.5f - 0.1f, 0);
            var box = blocker.AddComponent<BoxCollider>();
            box.size = size;
            box.center = center;
            var ob = blocker.AddComponent<NavMeshObstacle>();
            ob.shape = NavMeshObstacleShape.Box;
            ob.size = size;
            ob.center = center;
            ob.carving = true;
            ob.carveOnlyStationary = false;
        }

        void RemoveBlocker()
        {
            if (!blocker) return;
            Destroy(blocker);
            blocker = null;
        }

        /// <summary>方形区域里没有玩家 / 活着的敌人（含身体半径余量；阵心 2.6 m 以上的不算）</summary>
        public static bool FieldClear(Vector3 c, float half)
        {
            var pv = PlayerVitals.Instance;
            if (pv && !pv.Dead)
            {
                var p = pv.transform.position;
                var cc = pv.GetComponent<CharacterController>();
                float pr = (cc ? cc.radius : 0.35f) + 0.05f;
                if (Mathf.Abs(p.x - c.x) < half + pr && Mathf.Abs(p.z - c.z) < half + pr && p.y < c.y + 2.6f) return false;
            }
            var live = EnemyRegistry.Live;
            for (int i = 0; i < live.Count; i++)
            {
                var e = live[i];
                if (!e || e.Dead) continue;
                var p = e.transform.position;
                float r = EnemyRegistry.BodyRadius(e) * 0.85f + 0.05f;
                if (Mathf.Abs(p.x - c.x) < half + r && Mathf.Abs(p.z - c.z) < half + r && p.y < c.y + 2.6f) return false;
            }
            return true;
        }

        /// <summary>p 在某个立着挡块的阵里（水平方形内，阵心 2.6 m 以下）</summary>
        public static bool Blocks(Vector3 p)
        {
            foreach (var f in active)
            {
                if (!f || !f.Blocking) continue;
                var c = f.spec.center;
                float h = f.HalfSize;
                if (Mathf.Abs(p.x - c.x) < h && Mathf.Abs(p.z - c.z) < h && p.y < c.y + 2.6f) return true;
            }
            return false;
        }

        /// <summary>六棱锥（底面半径 1 在 y = 0，尖在 y = 1），全场共用</summary>
        static Mesh Cone
        {
            get
            {
                if (coneMesh) return coneMesh;
                const int sides = 6;
                var v = new List<Vector3>();
                var tri = new List<int>();
                for (int i = 0; i < sides; i++)
                {
                    float a0 = i / (float)sides * Mathf.PI * 2f, a1 = (i + 1) / (float)sides * Mathf.PI * 2f;
                    int b = v.Count;
                    v.Add(new Vector3(Mathf.Sin(a0), 0, Mathf.Cos(a0)));
                    v.Add(new Vector3(0, 1, 0));
                    v.Add(new Vector3(Mathf.Sin(a1), 0, Mathf.Cos(a1)));
                    // Unity 正面 = 从外面看顺时针：底边 a0 → 底边 a1 → 尖
                    tri.Add(b);
                    tri.Add(b + 2);
                    tri.Add(b + 1);
                }
                coneMesh = new Mesh { name = "Spike Cone" };
                coneMesh.SetVertices(v);
                coneMesh.SetTriangles(tri, 0);
                coneMesh.RecalculateNormals();
                coneMesh.RecalculateBounds();
                return coneMesh;
            }
        }

        static Material Material
        {
            get
            {
                if (spikeMaterial) return spikeMaterial;
                spikeMaterial = new Material(Shader.Find("Universal Render Pipeline/Lit")) { name = "Spike (runtime)" };
                spikeMaterial.SetFloat("_Smoothness", 0.75f);
                spikeMaterial.EnableKeyword("_EMISSION");
                return spikeMaterial;
            }
        }
    }
}
