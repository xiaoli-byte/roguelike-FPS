using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 地面预警（Three.js 版 fx.groundWarning）：贴地的圆环 / 直线，从淡到亮，持续到攻击落下。
    /// 圆用于落点（跳鼠扑斩、蟾蜍火球、出生点），线用于冲锋路径（镇墓兽）。
    /// </summary>
    public sealed class Telegraph : MonoBehaviour
    {
        static Telegraph instance;
        Material circleMat, lineMat, waveMat;

        internal sealed class Item
        {
            public Transform t;
            public Renderer r;
            public float life, max;
            public Color color;
            public bool line, wave;
            public float waveSpeed, waveMax;
            /// <summary>对象池复用计数：句柄只控制自己拿到的那一次</summary>
            public int gen;
        }

        /// <summary>预警线句柄：蓄力期间跟着朝向更新（镇墓兽冲锋方向在前 60% 还能调整）</summary>
        public sealed class LineHandle
        {
            internal Item it;
            internal int gen;
            public bool Alive => it != null && it.gen == gen && it.life > 0;

            public void Move(Vector3 from, Vector3 to, float width)
            {
                if (Alive) Place(it, from, to, width);
            }

            public void End()
            {
                if (!Alive) return;
                it.life = 0;
                it.t.gameObject.SetActive(false);
            }
        }

        readonly List<Item> items = new();
        MaterialPropertyBlock block;

        static Telegraph Get()
        {
            if (instance) return instance;
            instance = new GameObject("Telegraphs").AddComponent<Telegraph>();
            return instance;
        }

        void Awake()
        {
            block = new MaterialPropertyBlock();
            circleMat = MakeMat(RingTexture(0.22f));
            lineMat = MakeMat(LineTexture());
            waveMat = MakeMat(RingTexture(0f));
        }

        static Material MakeMat(Texture2D tex)
        {
            var m = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit"));
            m.SetTexture("_BaseMap", tex);
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", 0);
            m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            m.SetFloat("_ZWrite", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.renderQueue = (int)RenderQueue.Transparent - 10;
            return m;
        }

        static Texture2D RingTexture(float fillAlpha)
        {
            const int n = 128;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f)) / (n / 2f);
                float rim = Mathf.Clamp01(1 - Mathf.Abs(d - 0.93f) / 0.07f);
                float fill = d < 0.93f ? fillAlpha : 0;
                tex.SetPixel(x, y, new Color(1, 1, 1, Mathf.Max(rim, fill)));
            }
            tex.Apply();
            return tex;
        }

        static Texture2D LineTexture()
        {
            const int n = 64;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float u = Mathf.Abs((x + 0.5f) / n * 2 - 1);
                float edge = Mathf.Clamp01(1 - Mathf.Abs(u - 0.9f) / 0.1f);
                tex.SetPixel(x, y, new Color(1, 1, 1, Mathf.Max(edge, u < 0.9f ? 0.25f : 0)));
            }
            tex.Apply();
            return tex;
        }

        public static void Circle(Vector3 center, float radius, float duration, Color color)
        {
            var g = Get();
            var it = g.Take(false);
            float y = GroundY(center) + 0.06f;
            it.t.SetPositionAndRotation(new Vector3(center.x, y, center.z), Quaternion.Euler(90, 0, 0));
            it.t.localScale = new Vector3(radius * 2, radius * 2, 1);
            it.life = it.max = duration;
            it.color = color;
        }

        /// <summary>向外扩散的冲击波环（镇墓兽踏地）：半径以 speed 增长到 maxRadius</summary>
        public static void Wave(Vector3 center, float maxRadius, float speed, Color color)
        {
            var g = Get();
            var it = g.Take(false, true);
            float y = GroundY(center) + 0.08f;
            it.t.SetPositionAndRotation(new Vector3(center.x, y, center.z), Quaternion.Euler(90, 0, 0));
            it.t.localScale = Vector3.one * 0.2f;
            it.waveSpeed = speed;
            it.waveMax = maxRadius;
            it.life = it.max = maxRadius / speed;
            it.color = color;
        }

        public static LineHandle Line(Vector3 from, Vector3 to, float width, float duration, Color color)
        {
            var g = Get();
            var it = g.Take(true);
            Place(it, from, to, width);
            it.life = it.max = duration;
            it.color = color;
            return new LineHandle { it = it, gen = it.gen };
        }

        static void Place(Item it, Vector3 from, Vector3 to, float width)
        {
            var d = to - from;
            d.y = 0;
            var mid = (from + to) * 0.5f;
            float y = Mathf.Max(GroundY(from), GroundY(mid)) + 0.06f;
            it.t.SetPositionAndRotation(new Vector3(mid.x, y, mid.z), Quaternion.LookRotation(d.sqrMagnitude > 1e-4f ? d : Vector3.forward) * Quaternion.Euler(90, 0, 0));
            it.t.localScale = new Vector3(width, d.magnitude, 1);
        }

        static float GroundY(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 3, Vector3.down, out var h, 20, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : p.y;

        Item Take(bool line, bool wave = false)
        {
            foreach (var x in items)
                if (x.life <= 0 && x.line == line && x.wave == wave)
                {
                    x.t.gameObject.SetActive(true);
                    x.gen++;
                    return x;
                }
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(go.GetComponent<Collider>());
            go.name = line ? "Telegraph Line" : "Telegraph Circle";
            go.transform.SetParent(transform, false);
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = line ? lineMat : wave ? waveMat : circleMat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            var it = new Item { t = go.transform, r = r, line = line, wave = wave };
            items.Add(it);
            return it;
        }

        void Update()
        {
            foreach (var it in items)
            {
                if (it.life <= 0) continue;
                it.life -= Time.deltaTime;
                if (it.life <= 0)
                {
                    it.t.gameObject.SetActive(false);
                    continue;
                }
                float k = 1 - it.life / it.max;
                if (it.wave)
                {
                    float rad = Mathf.Max(0.2f, it.waveSpeed * (it.max - it.life));
                    it.t.localScale = new Vector3(rad * 2, rad * 2, 1);
                    block.SetColor("_BaseColor", new Color(it.color.r, it.color.g, it.color.b, 1 - k * 0.7f));
                    it.r.SetPropertyBlock(block);
                    continue;
                }
                float pulse = 0.75f + 0.25f * Mathf.Sin(Time.time * 18f);
                block.SetColor("_BaseColor", new Color(it.color.r, it.color.g, it.color.b, Mathf.Lerp(0.35f, 1f, k) * pulse));
                it.r.SetPropertyBlock(block);
            }
        }
    }
}
