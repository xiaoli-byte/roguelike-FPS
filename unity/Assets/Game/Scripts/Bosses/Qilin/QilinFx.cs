using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟的熔岩柱（Three.js QilinFx.eruption）：熔池圆心冲天的两层柱（外层熔浆、内层火芯）+ 一盏跟着亮的点光。
    /// 特效打磨 C 路：原来是两根不透明的橙 / 黄 Unity 圆柱，改成 SF_FxSurge 的流动熔浆体积（暗壳 + 发光熔流纹往上涌、软轮廓、顶上被条纹啃出碎边），
    /// 芯是半加法的火舌条纹；冲着的时候柱顶往外甩熔滴、柱脚一圈圈溅熔浆。涌流材质缺失时退回原来的两根圆柱。
    /// 登场（麒麟从池心跃出）、饮熔（池面翻涌，小）、巨鼎坠池（冲一下）、化焚身（1.0 → 1.6 s 冲满，保持到 3.4 s，4.6 s 落下：盖住换模型）都用它。
    /// 独立物体（不挂在首领身上，首领会走），首领销毁时一起销毁。其余火星、蹄印、鳞刃走通用的 Fx / BossHazards / EnemyProjectile。
    /// </summary>
    public sealed class QilinFx : MonoBehaviour
    {
        /// <summary>冲满时的高度（米）、外层 / 芯的半径相对熔池半径的比例</summary>
        public const float ColumnHeight = 18f, OuterK = 0.22f, CoreK = 0.12f;

        Transform outer, core;
        Renderer outerR, coreR;
        Light flare;
        float k, want, poolRadius = 7f, age, dripAcc, baseAcc, seed;
        bool surge;
        MaterialPropertyBlock block;
        static readonly int ColorAId = Shader.PropertyToID("_ColorA");
        static readonly int ColorBId = Shader.PropertyToID("_ColorB");
        static readonly int ParamsId = Shader.PropertyToID("_Params");
        static readonly int Params2Id = Shader.PropertyToID("_Params2");
        static readonly int ShapeId = Shader.PropertyToID("_Shape");

        /// <summary>当前熔岩柱强度（0 = 没有，1 = 冲满）</summary>
        public float Level => k;

        /// <summary>在熔池圆心建一根熔岩柱（parent = 首领的父节点，随关卡场景卸载）</summary>
        public static QilinFx Create(Vector3 center, float poolRadius, Transform parent)
        {
            var go = new GameObject("Qilin Eruption");
            go.transform.SetParent(parent, false);
            go.transform.position = center;
            var fx = go.AddComponent<QilinFx>();
            fx.poolRadius = Mathf.Max(1f, poolRadius);
            fx.Build();
            return fx;
        }

        void Build()
        {
            var mat = FxMaterials.Get(FxMaterialKind.Surge);
            seed = Random.value * 10f;
            if (FxMaterials.Usable(mat) && mat.shader.name == FxMaterials.ShaderSurge)
            {
                surge = true;
                block = new MaterialPropertyBlock();
                outerR = SurgeRenderer("Column", mat);
                coreR = SurgeRenderer("Core", mat);
            }
            else BuildCylinders();
            outer = outerR.transform;
            core = coreR.transform;
            flare = new GameObject("Flare").AddComponent<Light>();
            flare.transform.SetParent(transform, false);
            flare.transform.localPosition = Vector3.up * 3f;
            flare.type = LightType.Point;
            flare.color = new Color(1f, 0.55f, 0.2f);
            flare.range = 30f;
            flare.shadows = LightShadows.None;
            Apply();
        }

        Renderer SurgeRenderer(string name, Material mat)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = Surge.MeshFor(SurgeShape.Column);
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            r.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
            return r;
        }

        /// <summary>涌流材质缺失时的退路：原来的两根不透明圆柱</summary>
        void BuildCylinders()
        {
            outerR = PropBits.Cylinder(transform, "Column", Vector3.zero, Vector3.one, LavaField.Orange);
            outerR.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(outerR, LavaField.Orange * 1.3f);
            coreR = PropBits.Cylinder(transform, "Core", Vector3.zero, Vector3.one, LavaField.Gold);
            coreR.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(coreR, LavaField.Gold * 1.6f);
        }

        /// <summary>熔岩柱目标强度（0–1）；snap = 立刻到位（化形演出逐帧给值时用）</summary>
        public void Eruption(float target, bool snap = false)
        {
            want = Mathf.Clamp01(float.IsFinite(target) ? target : 0);
            if (snap) k = want;
        }

        /// <summary>冲一下（坠鼎）：立刻冲满，然后按自己的速度落回去</summary>
        public void Burst(float strength = 1f)
        {
            k = Mathf.Max(k, Mathf.Clamp01(strength));
            want = 0;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            k = Mathf.MoveTowards(k, want, dt * (want > k ? 3f : 0.9f));
            Apply();
            if (k < 0.15f || dt <= 0) return;
            // 柱顶往外甩熔滴（落回熔池）、柱脚一圈圈溅熔浆
            float h = ColumnHeight * k;
            dripAcc += dt * (1.5f + 3f * k);
            while (dripAcc >= 1f)
            {
                dripAcc -= 1f;
                float a = Random.value * Mathf.PI * 2f, r = poolRadius * OuterK * Random.Range(0.6f, 1.1f);
                Fx.MoltenSplash(transform.position + new Vector3(Mathf.Cos(a) * r, h * Random.Range(0.75f, 0.98f), Mathf.Sin(a) * r), Mathf.Lerp(0.6f, 1.4f, k));
            }
            baseAcc += dt * (1f + 2f * k);
            while (baseAcc >= 1f)
            {
                baseAcc -= 1f;
                float a = Random.value * Mathf.PI * 2f, r = poolRadius * OuterK * Random.Range(1f, 1.8f);
                Fx.MoltenSplash(transform.position + new Vector3(Mathf.Cos(a) * r, 0.2f, Mathf.Sin(a) * r), Mathf.Lerp(0.7f, 1.6f, k));
            }
        }

        void Apply()
        {
            if (!outer) return;
            bool on = k > 0.005f;
            outer.gameObject.SetActive(on);
            core.gameObject.SetActive(on);
            if (flare) flare.intensity = 6f * k;
            if (!on) return;
            float h = ColumnHeight * k, wob = 1f + 0.06f * Mathf.Sin(age * 9f);
            float ro = poolRadius * OuterK * 2f * wob, rc = poolRadius * CoreK * 2f;
            if (surge)
            {
                // 涌流网格：底面半径 1、高 1、底在原点
                outer.localScale = new Vector3(ro * 0.5f, h, ro * 0.5f);
                outer.localPosition = Vector3.zero;
                core.localScale = new Vector3(rc * 0.5f, h * 1.04f, rc * 0.5f);
                core.localPosition = Vector3.zero;
                float alpha = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(k / 0.25f));
                Write(outerR, new Color(0.55f, 0.1f, 0.02f), new Color(2.1f, 0.7f, 0.12f), new Vector4(seed, alpha, 3.2f, 2), new Vector4(8, 2.6f, 0.4f, 0.15f));
                Write(coreR, new Color(1.2f, 0.32f, 0.04f), new Color(2.0f, 1.25f, 0.4f), new Vector4(seed + 3f, alpha * 0.9f, 4.4f, 3), new Vector4(6, 2.2f, 0.5f, 0.6f));
                return;
            }
            // Unity 圆柱原始高 2 m、中心在原点：缩放 y = 高 / 2，往上挪半个高度
            outer.localScale = new Vector3(ro, h * 0.5f, ro);
            outer.localPosition = Vector3.up * h * 0.5f;
            core.localScale = new Vector3(rc, h * 0.55f, rc);
            core.localPosition = Vector3.up * h * 0.55f;
        }

        void Write(Renderer r, Color a, Color b, Vector4 p, Vector4 p2)
        {
            block.Clear();
            block.SetColor(ColorAId, a);
            block.SetColor(ColorBId, b);
            block.SetVector(ParamsId, p);
            block.SetVector(Params2Id, p2);
            block.SetVector(ShapeId, new Vector4(0.8f, 0.04f, 0f, 0.2f));
            r.SetPropertyBlock(block);
        }
    }
}
