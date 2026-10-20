using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 选英雄的石质祭台（U6；Three.js src/ui/heroPreview/altar.ts）：八边形多层台座（玄武岩 + 鎏金描边 + 英雄色嵌线、菱钉、护角）、
    /// 顶面英雄色符文环（缓慢旋转 + 呼吸）、脚下柔光、环绕英雄的光柱（平时只有背后半圈，很淡，衬出剪影、不盖住英雄正面）。
    /// <see cref="Surge"/>：切换英雄时闪亮一下——光柱前后两半一起亮、符文环增亮偏白并略放大、自环心向外扩散一圈光环（「从光中升起」）。
    /// 坐标：物体原点在地面，台顶在 <see cref="Top"/>（英雄站的高度）；+Z 朝镜头（光柱的「背后半圈」是 −Z 那一半）。
    /// 石材 / 鎏金用 URP Lit（<see cref="litTemplate"/>，MenuSceneBuilder 指定；缺失时编辑器里按名字找着色器），发光件用特效材质（<see cref="FxMaterials"/>）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HeroAltar : MonoBehaviour
    {
        /// <summary>台顶高度（米）</summary>
        public const float Top = 0.6f;
        public const float PillarHeight = 3f;
        const float SurgeAttack = 0.09f, SurgeDecay = 0.42f, BurstTime = 0.8f, BurstFrom = 0.35f, BurstTo = 1.2f;

        [Tooltip("石材 / 鎏金的 URP Lit 模板材质（复制后改色）")] public Material litTemplate;

        Transform rune;
        Renderer runeR, glowR, burstR, backR, frontR, bandR;
        float surgeT = 999f, surgeAmp, surgeFrom, flare;
        bool built;

        /// <summary>当前闪光强度 0..1（灯光跟着调）</summary>
        public float Flare => flare;

        // HeroStage 先配好模板材质再调 Build；单独放在场景里时 Start 兜底
        void Start() => Build();

        /// <summary>建台座与发光件（幂等）</summary>
        public void Build()
        {
            if (built) return;
            built = true;
            var stone = Lit(new Color(0.165f, 0.17f, 0.21f), 0.06f, 0.08f);
            var stoneTop = Lit(new Color(0.21f, 0.212f, 0.263f), 0.08f, 0.14f);
            var gold = Lit(new Color(0.83f, 0.66f, 0.31f), 0.6f, 0.62f);

            var root = new GameObject("Altar Mesh").transform;
            root.SetParent(transform, false);
            root.localPosition = new Vector3(0, Top, 0);
            float phase = Mathf.PI / 8;
            Tier(root, 0.82f, 0.88f, 0.14f, 0f, stoneTop, phase);
            Tier(root, 0.905f, 0.905f, 0.034f, -0.012f, gold, phase);
            Tier(root, 0.66f, 0.72f, 0.2f, -0.14f, stone, phase);
            bandR = Tier(root, 0.705f, 0.705f, 0.034f, -0.222f, FxMaterials.Unlit, phase, true);
            Tier(root, 0.95f, 1.02f, 0.12f, -0.34f, stone, phase);
            Tier(root, 1.045f, 1.045f, 0.03f, -0.352f, gold, phase);
            Tier(root, 1.1f, 1.2f, 0.14f, -0.46f, stone, phase);

            // 顶层侧面的鎏金菱钉、底座的鎏金护角
            var oct = StageMeshes.Octahedron("Altar Stud");
            for (int i = 0; i < 8; i++)
            {
                float a = (i + 0.5f) * Mathf.PI * 2 / 8 + phase;
                float r = 0.85f * Mathf.Cos(Mathf.PI / 8) + 0.004f;
                var s = Part(root, "Stud", oct, gold);
                s.localPosition = new Vector3(Mathf.Sin(a) * r, -0.075f, Mathf.Cos(a) * r);
                s.localRotation = Quaternion.Euler(0, a * Mathf.Rad2Deg, 0);
                s.localScale = new Vector3(0.034f * 0.55f, 0.034f * 1.35f, 0.034f);
            }
            for (int i = 0; i < 8; i += 2)
            {
                float a = i / 8f * Mathf.PI * 2 + phase;
                var c = GameObject.CreatePrimitive(PrimitiveType.Cube);
                DestroyCollider(c);
                c.name = "Cap";
                c.transform.SetParent(root, false);
                c.transform.localPosition = new Vector3(Mathf.Sin(a) * 0.86f, -0.315f, Mathf.Cos(a) * 0.86f);
                c.transform.localRotation = Quaternion.Euler(0, a * Mathf.Rad2Deg + 45, 0);
                c.transform.localScale = new Vector3(0.09f, 0.05f, 0.09f);
                c.GetComponent<Renderer>().sharedMaterial = gold;
            }

            // 顶面符文环 + 柔光 + 扩散光环
            var runeMat = FxMaterials.MakeAdditive(StageMeshes.Rune);
            runeMat.name = "Altar Rune";
            rune = Part(root, "Rune Ring", StageMeshes.FlatQuad(1.56f, "Altar Rune Quad"), runeMat);
            rune.localPosition = new Vector3(0, 0.004f, 0);
            runeR = rune.GetComponent<Renderer>();
            var glow = Part(root, "Foot Glow", StageMeshes.FlatQuad(1.6f, "Altar Glow Quad"), FxMaterials.Glow);
            glow.localPosition = new Vector3(0, 0.008f, 0);
            glowR = glow.GetComponent<Renderer>();
            var burst = Part(root, "Burst Ring", StageMeshes.Annulus(0.88f, 1f, 64, "Altar Burst"), FxMaterials.Additive);
            burst.localPosition = new Vector3(0, 0.012f, 0);
            burstR = burst.GetComponent<Renderer>();
            burstR.enabled = false;

            // 光柱：背后半圈常亮（很淡），前半圈只在闪光时出现
            var back = Part(root, "Pillar Back", StageMeshes.Wall(0.78f, 0.66f, PillarHeight, Mathf.PI * 0.5f, Mathf.PI * 1.5f, 18, "Altar Pillar Back"), FxMaterials.Band);
            backR = back.GetComponent<Renderer>();
            var front = Part(root, "Pillar Front", StageMeshes.Wall(0.78f, 0.66f, PillarHeight, -Mathf.PI * 0.5f, Mathf.PI * 0.5f, 18, "Altar Pillar Front"), FxMaterials.Band);
            frontR = front.GetComponent<Renderer>();
            frontR.enabled = false;
            // 台顶的碰撞面：英雄脚步 IK 往下打射线踩在台顶上，不会被拉到地面
            var top = root.gameObject.AddComponent<BoxCollider>();
            top.center = new Vector3(0, -0.05f, 0);
            top.size = new Vector3(1.5f, 0.1f, 1.5f);
            Tick(0, 0, UITheme.Gold);
        }

        Renderer Tier(Transform root, float rTop, float rBot, float h, float yTop, Material m, float phase, bool open = false)
        {
            var t = Part(root, "Tier", StageMeshes.Frustum(rTop, rBot, h, 8, phase, open, "Altar Tier"), m);
            t.localPosition = new Vector3(0, yTop, 0);
            var r = t.GetComponent<Renderer>();
            r.shadowCastingMode = open ? ShadowCastingMode.Off : ShadowCastingMode.On;
            return r;
        }

        static Transform Part(Transform parent, string name, Mesh mesh, Material m)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = m;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.lightProbeUsage = LightProbeUsage.BlendProbes;
            return go.transform;
        }

        static void DestroyCollider(GameObject go)
        {
            var c = go.GetComponent<Collider>();
            if (!c) return;
            if (Application.isPlaying) Destroy(c);
            else DestroyImmediate(c);
        }

        /// <summary>复制一份 Lit 材质改色（模板缺失：编辑器里按名字找 URP Lit，打包后退回特效的不透明纯色）</summary>
        Material Lit(Color c, float metallic, float smoothness)
        {
            Material m = null;
            if (litTemplate) m = new Material(litTemplate);
#if UNITY_EDITOR
            if (!m && Shader.Find("Universal Render Pipeline/Lit") is { } sh) m = new Material(sh);
#endif
            if (!m) m = new Material(FxMaterials.Unlit);
            m.name = "Altar Lit";
            m.hideFlags = HideFlags.DontSave;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metallic);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothness);
            return m;
        }

        /// <summary>闪亮一下（strength 0..1；闪光中再触发从当前亮度重新起跳）</summary>
        public void Surge(float strength = 1f)
        {
            surgeFrom = flare;
            surgeAmp = Mathf.Clamp01(strength);
            surgeT = 0;
        }

        /// <summary>每帧（HeroStage 调）：t = 累计时间（呼吸），theme = 当前英雄色</summary>
        public void Tick(float dt, float t, Color theme)
        {
            if (!built) return;
            if (rune) rune.localRotation = Quaternion.Euler(0, t * 0.16f * Mathf.Rad2Deg, 0);
            surgeT += dt;
            flare = surgeT < SurgeAttack ? Mathf.Lerp(surgeFrom, surgeAmp, surgeT / SurgeAttack) : surgeAmp * Mathf.Exp(-(surgeT - SurgeAttack) / SurgeDecay);
            if (flare < 0.002f) flare = 0;
            float breath = 0.5f + 0.5f * Mathf.Sin(t * 1.6f);
            var hot = Color.Lerp(theme, Color.white, 0.45f * flare);
            FxMaterials.Tint(runeR, Alpha(hot, Mathf.Min(1, 0.5f + 0.24f * breath + 0.5f * flare)));
            FxMaterials.Tint(glowR, Alpha(hot, Mathf.Min(1, 0.22f + 0.12f * breath + 0.55f * flare)));
            FxMaterials.Tint(backR, Alpha(theme, 0.08f + 0.04f * breath + 0.42f * flare));
            frontR.enabled = flare > 0.004f;
            if (frontR.enabled) FxMaterials.Tint(frontR, Alpha(theme, 0.34f * flare));
            FxMaterials.Tint(bandR, theme * (0.85f + 0.6f * flare));
            if (rune) rune.localScale = Vector3.one * (1 + 0.05f * flare);
            float k = surgeT / BurstTime;
            if (k < 1 && surgeAmp > 0)
            {
                float e = 1 - (1 - k) * (1 - k) * (1 - k);
                burstR.enabled = true;
                burstR.transform.localScale = Vector3.one * Mathf.Lerp(BurstFrom, BurstTo, e);
                FxMaterials.Tint(burstR, Alpha(hot, 0.85f * surgeAmp * (1 - k) * (1 - k)));
            }
            else burstR.enabled = false;
        }

        static Color Alpha(Color c, float a) => new(c.r, c.g, c.b, Mathf.Clamp01(a));
    }
}
