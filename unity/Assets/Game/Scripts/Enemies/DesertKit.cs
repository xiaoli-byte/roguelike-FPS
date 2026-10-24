using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 第一章（赤沙古道）敌人共用的小工具与特效（同 Three.js 各沙漠敌人里散落的 sandSpray / spawnFlamePillar / spawnScorch / spawnFireRing）：
    ///   沙：<see cref="SandSpray"/>（钻沙、钻出的扬沙）、<see cref="Furrow"/>（潜行留下的沙痕，几秒后抹平）；
    ///   火：<see cref="FlamePillar"/>（上冲的火柱 + 闪光）、<see cref="FireRing"/>（贴地火环）、<see cref="Scorch"/>（爆炸 / 砸地留下的焦痕，比余火久）；
    ///   陶：<see cref="Shards"/>（三彩陶片：釉白 / 绿 / 琥珀）。
    /// 痕迹（沙痕、焦痕）是贴地的半透明软斑（程序贴图 + alpha 混合），不挡射线，到时淡出自毁；同屏上限 <see cref="MaxMarks"/>，超了先撤最旧的。
    /// </summary>
    public static class DesertKit
    {
        public static readonly Color Sand = Hex.Rgb(0xc9a46a), SandLight = Hex.Rgb(0xe8c27a), Dust = Hex.Rgb(0xc8a06a);
        public static readonly Color Ember = Hex.Rgb(0xff7a2a), Spark = Hex.Rgb(0xffc860), Sunfire = Hex.Rgb(0xfff2b8), FireOrange = Hex.Rgb(0xff9a30);
        public static readonly Color ShardCream = Hex.Rgb(0xd8c8a0), ShardGreen = Hex.Rgb(0x4f9a70), ShardAmber = Hex.Rgb(0xc07a30);
        public static readonly Color ScorchColor = new(0.11f, 0.075f, 0.05f, 0.72f), FurrowColor = new(0.52f, 0.4f, 0.24f, 0.55f);

        /// <summary>同时存在的地面痕迹上限</summary>
        public const int MaxMarks = 48;

        /// <summary>地面高度（往下打射线；打不到返回 p.y）</summary>
        public static float GroundY(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var h, 12f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : p.y;

        public static Vector3 OnGround(Vector3 p) => new(p.x, GroundY(p), p.z);

        /// <summary>钻沙 / 钻出时脚下扬起的沙（size = 体型）</summary>
        public static void SandSpray(Vector3 at, int count, float size) =>
            Fx.Burst(at + Vector3.up * 0.2f, Sand, count, 2.4f, 0.6f, 0.38f * size, -4f);

        /// <summary>上冲的火柱（火团往上浮 + 白热芯 + 闪光）</summary>
        public static void FlamePillar(Vector3 ground, float radius, float height)
        {
            float h = Mathf.Max(0.5f, height);
            Fx.Burst(ground + Vector3.up * 0.3f, FireOrange, 14, 1.2f + radius, 0.55f, 0.45f * Mathf.Max(0.5f, radius), -h * 3.2f);
            Fx.Burst(ground + Vector3.up * 0.2f, Sunfire, 8, 0.8f, 0.4f, 0.3f * Mathf.Max(0.5f, radius), -h * 4f);
            Fx.Burst(ground + Vector3.up * h * 0.6f, Ember, 12, 3f, 0.9f, 0.06f, 3f);
            Fx.Flash(ground + Vector3.up * h * 0.5f, FireOrange, 5f, Mathf.Max(4f, h * 2.5f), 0.25f);
        }

        /// <summary>贴地火环（冲击波的外观）</summary>
        public static void FireRing(Vector3 ground, float radius) => Fx.Ring(ground + Vector3.up * 0.08f, radius, Spark, 0.45f);

        /// <summary>三彩陶片四溅（count = 每种颜色的片数）</summary>
        public static void Shards(Vector3 at, float size, int count = 10)
        {
            Fx.Burst(at, ShardCream, count, 5f, 0.9f, 0.11f * size, 16f);
            Fx.Burst(at, ShardGreen, Mathf.Max(1, count / 2), 5f, 0.9f, 0.1f * size, 16f);
            Fx.Burst(at, ShardAmber, Mathf.Max(1, count / 2), 5f, 0.9f, 0.1f * size, 16f);
        }

        /// <summary>焦痕：地上一块深色软斑，seconds 秒后淡出（爆炸、砸地、死亡）</summary>
        public static void Scorch(Vector3 at, float radius, float seconds) => GroundMark.Spawn(OnGround(at), radius, seconds, ScorchColor);

        /// <summary>沙痕：潜行拖出的一道犁沟（一段一段地落），seconds 秒后抹平</summary>
        public static void Furrow(Vector3 at, float radius, float seconds) => GroundMark.Spawn(OnGround(at), radius, seconds, FurrowColor);

        public static float Smooth(float t)
        {
            t = Mathf.Clamp01(t);
            return t * t * (3 - 2 * t);
        }
    }

    /// <summary>贴地软斑（<see cref="DesertKit.Scorch"/> / <see cref="DesertKit.Furrow"/>）：淡入 0.15 s，最后 30% 淡出，到时自毁</summary>
    public sealed class GroundMark : MonoBehaviour
    {
        static Texture2D blotch;
        static Material material;
        static readonly System.Collections.Generic.List<GroundMark> live = new();

        Renderer r;
        Color color;
        float age, life;

        /// <summary>累计落下的痕迹数（测试用）</summary>
        public static int Spawned { get; private set; }

        /// <summary>场上的痕迹数（测试用）</summary>
        public static int Count
        {
            get
            {
                live.RemoveAll(m => !m);
                return live.Count;
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => live.Clear();

        public static GroundMark Spawn(Vector3 ground, float radius, float seconds, Color color)
        {
            if (!Fx.Finite(ground) || !(radius > 0) || !(seconds > 0)) return null;
            live.RemoveAll(m => !m);
            if (live.Count >= DesertKit.MaxMarks && live[0]) Destroy(live[0].gameObject);
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            var col = q.GetComponent<Collider>();
            col.enabled = false;
            Destroy(col);
            q.name = "Ground Mark";
            q.transform.SetPositionAndRotation(ground + Vector3.up * 0.04f, Quaternion.Euler(90, Random.Range(0f, 360f), 0));
            q.transform.localScale = new Vector3(radius * 2, radius * 2, 1);
            var m = q.AddComponent<GroundMark>();
            m.r = q.GetComponent<Renderer>();
            m.r.sharedMaterial = Material;
            m.r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            m.r.receiveShadows = false;
            m.color = color;
            m.life = seconds;
            m.Apply(0);
            live.Add(m);
            Spawned++;
            return m;
        }

        void Update()
        {
            age += Time.deltaTime;
            if (age >= life)
            {
                Destroy(gameObject);
                return;
            }
            float a = Mathf.Min(1, age / 0.15f) * Mathf.Clamp01((life - age) / (life * 0.3f));
            Apply(a);
        }

        void Apply(float a)
        {
            if (r) FxMaterials.Tint(r, new Color(color.r, color.g, color.b, color.a * a));
        }

        static Material Material
        {
            get
            {
                if (material) return material;
                material = FxMaterials.MakeAlpha(Blotch());
                material.name = "Ground Mark (runtime)";
                material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent - 13;
                return material;
            }
        }

        /// <summary>边缘不规则的软斑：径向衰减 × 低频噪声边</summary>
        static Texture2D Blotch()
        {
            if (blotch) return blotch;
            const int n = 64;
            blotch = new Texture2D(n, n, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp, name = "Ground Mark Blotch" };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float u = (x + 0.5f) / n * 2 - 1, v = (y + 0.5f) / n * 2 - 1;
                float ang = Mathf.Atan2(v, u);
                float edge = 0.78f + 0.12f * Mathf.Sin(ang * 3 + 1.3f) + 0.07f * Mathf.Sin(ang * 7 + 0.4f);
                float d = Mathf.Sqrt(u * u + v * v) / edge;
                float a = Mathf.Clamp01(1 - d);
                a = a * a * (3 - 2 * a) * (0.82f + 0.18f * Mathf.PerlinNoise(x * 0.21f, y * 0.21f));
                px[y * n + x] = new Color(1, 1, 1, a);
            }
            blotch.SetPixels32(px);
            blotch.Apply();
            return blotch;
        }
    }
}
