using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>3-3 火神王座的可替换视觉与熔铜渠联动，不包含任何玩法判定。</summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class FireGodThrone : MonoBehaviour
    {
        static readonly int EmissionId = Shader.PropertyToID("_Emission");
        static readonly int AgitationId = Shader.PropertyToID("_Agitation");

        [Tooltip("王座与圆环锚点：其下名为 Model 的子物体是正式美术模型，Procedural 是程序化回退")]
        public Transform throne, ring;
        [Tooltip("各自锚点下的程序化回退")]
        public Transform throneProcedural, ringProcedural;
        [Tooltip("一道熔岩柱的根；涨落只缩放水平方向")]
        public Transform fallRoot;
        public Renderer[] fallRenderers = new Renderer[0];
        public Light ringLight, fallLight;
        public FoundryChannels channels;

        public float Surge { get; private set; }

        MaterialPropertyBlock block;
        float shown = -1f;

        void OnEnable() => ApplyModelVisibility();

        void OnValidate() => ApplyModelVisibility();

        void ApplyModelVisibility()
        {
            Apply(throne, throneProcedural);
            Apply(ring, ringProcedural);
        }

        static void Apply(Transform anchor, Transform procedural)
        {
            if (!anchor) return;
            bool art = PropBits.HasModel(anchor);
            if (procedural) procedural.gameObject.SetActive(!art);
        }

        void Update()
        {
            if (!Application.isPlaying) return;
            float target = 0f;
            if (channels)
            {
                if (channels.Flooding) target = 0.45f;
                float rise = Mathf.Max(0.05f, channels.rise);
                foreach (var v in channels.surge)
                    if (v) target = Mathf.Max(target, Mathf.Clamp01((v.Level - v.BaseLevel) / rise));
            }
            Surge = Mathf.MoveTowards(Surge, target, Time.deltaTime * 1.4f);
            if (Mathf.Abs(Surge - shown) < 0.005f) return;
            shown = Surge;
            if (fallRoot) fallRoot.localScale = new Vector3(1f + Surge * 0.45f, 1f, 1f + Surge * 0.45f);
            foreach (var r in fallRenderers)
            {
                if (!r) continue;
                block ??= new MaterialPropertyBlock();
                r.GetPropertyBlock(block);
                block.SetFloat(EmissionId, Mathf.Lerp(2.35f, 3.5f, Surge));
                block.SetFloat(AgitationId, Surge);
                r.SetPropertyBlock(block);
            }
            if (fallLight) fallLight.intensity = Mathf.Lerp(3.2f, 5.4f, Surge);
            if (ringLight) ringLight.intensity = Mathf.Lerp(1.6f, 2.2f, Surge);
        }
    }

    /// <summary>王座上空的少量大烟团与熔池余烬；全部走共享粒子与 FxBudget。</summary>
    [DisallowMultipleComponent]
    public sealed class FireGodAtmosphere : MonoBehaviour
    {
        public Vector3 smokeAt = new(152, 53, 216);
        public Vector3 embersAt = new(152, 0, 164);
        public float smokeRate = 0.45f, emberRate = 3f;

        float smokeDebt, emberDebt;

        void Update()
        {
            float dt = Time.deltaTime;
            if (dt <= 0) return;
            var cam = Camera.main;
            if (!cam) return;
            float k = Fx.Density * EnvParticles.Headroom * dt;
            if (cam.transform.position.y < 100f)
            {
                int n = Take(ref smokeDebt, smokeRate * k, 2f);
                for (int i = 0; i < n; i++)
                {
                    var p = smokeAt + new Vector3(Random.Range(-14f, 14f), Random.Range(-5f, 8f), Random.Range(-5f, 8f));
                    var v = new Vector3(Random.Range(-0.35f, 0.15f), Random.Range(0.35f, 0.65f), Random.Range(-0.35f, 0.05f));
                    var c = Color.Lerp(new Color(0.18f, 0.1f, 0.18f, 0.7f), new Color(0.3f, 0.13f, 0.12f, 0.65f), Random.value);
                    EnvParticles.Emit("Soot", p, v, Random.Range(16f, 25f), Random.Range(18f, 26f), c);
                }
            }
            if ((cam.transform.position - embersAt).sqrMagnitude > 150f * 150f) return;
            int embers = Take(ref emberDebt, emberRate * k, 5f);
            for (int i = 0; i < embers; i++)
            {
                var d = Random.insideUnitCircle * Random.Range(4f, 22f);
                var p = embersAt + new Vector3(d.x, Random.Range(0.3f, 3f), d.y);
                var v = new Vector3(Random.Range(-0.2f, 0.2f), Random.Range(0.5f, 1.1f), Random.Range(-0.35f, 0.05f));
                EnvParticles.Emit("EnvEmber", p, v, Random.Range(0.1f, 0.17f), Random.Range(5f, 8f), FxEnvStyles.Ember);
            }
        }

        static int Take(ref float debt, float add, float cap)
        {
            debt = Mathf.Min(debt + add, cap);
            int n = (int)debt;
            if (n <= 0) return 0;
            debt -= n;
            return FxBudget.Allow(n, false);
        }
    }
}
