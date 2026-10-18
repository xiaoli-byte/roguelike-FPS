using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 邪飞天的加成提示（Three.js 版 Apsara.ts 的 TetherStrips / allyFx）：玩家一眼要看出「谁在被她加成、该先打谁」。
    ///   金丝：琵琶到光环内每个同伴牵一根微垂的金色光丝，一串亮点从琵琶沿丝流向同伴
    ///   光环：受加成的同伴脚下一圈淡金色光圈（缓慢呼吸）
    ///   赐福：被赐福的同伴脚下开出金莲（缓慢旋转）、头顶浮起光环
    /// 琴碎（沉默）或她死了，金丝和光圈当帧消失。全部由这一个组件每帧按 ApsaraAI.Active 重建，敌人自己不用管。
    /// </summary>
    public sealed class SupportFx : MonoBehaviour
    {
        const int SagPoints = 12;
        static SupportFx instance;

        sealed class Marker
        {
            public Transform ring, lotus, halo;
            public Renderer ringR, lotusR, haloR;
            public bool seen, blessed;
        }

        Material threadMat, ringMat, lotusMat, haloMat;
        readonly List<LineRenderer> threads = new();
        readonly Dictionary<EnemyAI, Marker> markers = new();
        readonly List<EnemyAI> stale = new();
        MaterialPropertyBlock block;

        public static void Ensure()
        {
            if (instance) return;
            instance = new GameObject("Support Fx").AddComponent<SupportFx>();
        }

        void Awake()
        {
            block = new MaterialPropertyBlock();
            threadMat = MakeMat(ThreadTexture(), true);
            threadMat.SetTextureScale("_BaseMap", new Vector2(1f / 0.7f, 1));
            ringMat = MakeMat(RingTexture(0.93f, 0.07f, 0.12f), true);
            lotusMat = MakeMat(LotusTexture(), true);
            haloMat = MakeMat(RingTexture(0.8f, 0.16f, 0f), true);
        }

        void OnDestroy()
        {
            if (instance == this) instance = null;
        }

        static Material MakeMat(Texture2D tex, bool additive)
        {
            var m = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit"));
            m.SetTexture("_BaseMap", tex);
            m.SetFloat("_Surface", 1);
            m.SetFloat("_Blend", additive ? 2 : 0);
            m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            m.SetFloat("_DstBlend", (float)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
            m.SetFloat("_ZWrite", 0);
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.renderQueue = (int)RenderQueue.Transparent;
            return m;
        }

        void LateUpdate()
        {
            int used = 0;
            foreach (var m in markers.Values) m.seen = m.blessed = false;
            float t = Time.time;
            foreach (var a in ApsaraAI.Active)
            {
                if (!a || a.Dead || a.Silenced) continue;
                var from = a.TetherOrigin;
                foreach (var hp in a.AuraAllies)
                {
                    if (!hp || hp.Dead) continue;
                    var ai = hp.GetComponent<EnemyAI>();
                    if (!ai) continue;
                    var col = ai.GetComponent<CapsuleCollider>();
                    var to = col ? col.bounds.center + Vector3.up * col.bounds.extents.y * 0.25f : ai.transform.position + Vector3.up;
                    PlaceThread(Thread(used++), from, to, t);
                    Mark(ai).seen = true;
                }
            }
            // 被赐福的同伴走出光环范围也照样亮着金莲
            foreach (var e in EnemyAI.All)
                if (e && !e.Dead && e.Blessed)
                {
                    var m = Mark(e);
                    m.seen = m.blessed = true;
                }
            for (int i = used; i < threads.Count; i++)
                if (threads[i].enabled) threads[i].enabled = false;
            threadMat.SetTextureOffset("_BaseMap", new Vector2(-t * 1.6f, 0));

            stale.Clear();
            foreach (var (ai, m) in markers)
            {
                if (!ai || !m.seen)
                {
                    stale.Add(ai);
                    continue;
                }
                PlaceMarker(ai, m, t);
            }
            foreach (var ai in stale)
            {
                var m = markers[ai];
                if (m.ring) Destroy(m.ring.gameObject);
                if (m.lotus) Destroy(m.lotus.gameObject);
                if (m.halo) Destroy(m.halo.gameObject);
                markers.Remove(ai);
            }
        }

        LineRenderer Thread(int i)
        {
            while (threads.Count <= i)
            {
                var go = new GameObject("Apsara Thread");
                go.transform.SetParent(transform, false);
                var lr = go.AddComponent<LineRenderer>();
                lr.sharedMaterial = threadMat;
                lr.positionCount = SagPoints;
                lr.textureMode = LineTextureMode.Tile;
                lr.shadowCastingMode = ShadowCastingMode.Off;
                lr.receiveShadows = false;
                lr.numCapVertices = 2;
                lr.alignment = LineAlignment.View;
                threads.Add(lr);
            }
            var l = threads[i];
            l.enabled = true;
            return l;
        }

        static void PlaceThread(LineRenderer lr, Vector3 from, Vector3 to, float t)
        {
            float len = Vector3.Distance(from, to);
            // 中段微垂（像丝线），离得越远垂得越多
            var sag = Vector3.down * Mathf.Min(1.2f, len * 0.06f);
            for (int k = 0; k < SagPoints; k++)
            {
                float u = k / (SagPoints - 1f);
                lr.SetPosition(k, Vector3.Lerp(from, to, u) + sag * (4 * u * (1 - u)));
            }
            // 十几米外也要看得清（Three.js：不是 1 像素的线）
            float w = 0.08f + 0.015f * Mathf.Sin(t * 5.1f + len);
            lr.startWidth = w * 0.8f;
            lr.endWidth = w;
            var c = new Color(1f, 0.82f, 0.45f, 1f);
            lr.startColor = c;
            lr.endColor = c;
        }

        Marker Mark(EnemyAI ai)
        {
            if (markers.TryGetValue(ai, out var m)) return m;
            m = new Marker();
            (m.ring, m.ringR) = Quad("Aura Ring", ringMat);
            (m.lotus, m.lotusR) = Quad("Bless Lotus", lotusMat);
            (m.halo, m.haloR) = Quad("Bless Halo", haloMat);
            markers[ai] = m;
            return m;
        }

        (Transform, Renderer) Quad(string name, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            go.name = name;
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(transform, false);
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            return (go.transform, r);
        }

        void PlaceMarker(EnemyAI ai, Marker m, float t)
        {
            var col = ai.GetComponent<CapsuleCollider>();
            float size = ai.transform.lossyScale.x;
            float radius = col ? col.radius * size : 0.5f * size;
            var feet = ai.transform.position;
            float top = col ? col.bounds.max.y : feet.y + 1.8f * size;
            // 光圈：脚下淡金，缓慢呼吸
            float d = Mathf.Max(1.2f, radius * 4.4f);
            m.ring.SetPositionAndRotation(feet + Vector3.up * 0.04f, Quaternion.Euler(90, 0, 0));
            m.ring.localScale = Vector3.one * d * (1 + 0.04f * Mathf.Sin(t * 2.6f));
            SetColor(m.ringR, new Color(1f, 0.82f, 0.45f, 0.42f + 0.12f * Mathf.Sin(t * 2.6f)));
            // 赐福：金莲（比光圈大一圈、慢慢转）+ 头顶光环（上下浮动）
            m.lotus.gameObject.SetActive(m.blessed);
            m.halo.gameObject.SetActive(m.blessed);
            if (!m.blessed) return;
            m.lotus.SetPositionAndRotation(feet + Vector3.up * 0.05f, Quaternion.Euler(90, t * 20f, 0));
            m.lotus.localScale = Vector3.one * d * 1.35f;
            SetColor(m.lotusR, new Color(1f, 0.78f, 0.5f, 0.75f));
            float hd = Mathf.Max(0.45f, radius * 1.6f);
            m.halo.SetPositionAndRotation(new Vector3(feet.x, top + 0.25f * size + 0.05f * Mathf.Sin(t * 2.2f), feet.z), Quaternion.Euler(90, 0, 0));
            m.halo.localScale = Vector3.one * hd;
            SetColor(m.haloR, new Color(1f, 0.88f, 0.5f, 0.95f));
        }

        void SetColor(Renderer r, Color c)
        {
            r.GetPropertyBlock(block);
            block.SetColor("_BaseColor", c);
            r.SetPropertyBlock(block);
        }

        // ───────────── 程序贴图 ─────────────

        /// <summary>丝线：横向（v）是一道细亮芯，纵向（u，沿丝）每一节中间有一颗亮点</summary>
        static Texture2D ThreadTexture()
        {
            const int w = 64, h = 16;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Repeat };
            for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                float v = Mathf.Abs((y + 0.5f) / h * 2 - 1);
                float u = (x + 0.5f) / w;
                float core = Mathf.Exp(-v * v * 9f);
                float bead = Mathf.Exp(-Mathf.Pow((u - 0.5f) * 7f, 2));
                tex.SetPixel(x, y, new Color(1, 1, 1, core * (0.35f + 0.65f * bead)));
            }
            tex.Apply();
            return tex;
        }

        static Texture2D RingTexture(float at, float width, float fill)
        {
            const int n = 128;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f)) / (n / 2f);
                float rim = Mathf.Clamp01(1 - Mathf.Abs(d - at) / width);
                float inner = d < at ? fill * d / at : 0;
                tex.SetPixel(x, y, new Color(1, 1, 1, Mathf.Max(rim * rim * (3 - 2 * rim), inner)));
            }
            tex.Apply();
            return tex;
        }

        /// <summary>八瓣莲：花瓣轮廓 r(θ) = 0.55 + 0.4·|cos 4θ|^0.7，瓣缘亮、瓣心淡，中心一圈花蕊</summary>
        static Texture2D LotusTexture()
        {
            const int n = 128;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float px = (x + 0.5f) / n * 2 - 1, py = (y + 0.5f) / n * 2 - 1;
                float d = Mathf.Sqrt(px * px + py * py);
                float a = Mathf.Atan2(py, px);
                float edge = 0.55f + 0.4f * Mathf.Pow(Mathf.Abs(Mathf.Cos(4 * a)), 0.7f);
                float inside = Mathf.Clamp01((edge - d) / 0.05f);
                float rim = Mathf.Exp(-Mathf.Pow((d - edge) / 0.035f, 2));
                float heart = Mathf.Exp(-Mathf.Pow((d - 0.18f) / 0.05f, 2));
                tex.SetPixel(x, y, new Color(1, 1, 1, Mathf.Clamp01(inside * 0.22f + rim * 0.9f + heart * 0.8f)));
            }
            tex.Apply();
            return tex;
        }
    }
}
