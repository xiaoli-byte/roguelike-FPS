using UnityEngine;

namespace Spiritfire.Game
{
    public enum AuthoredTornadoTheme { Frost, Fire, Water }

    /// <summary>播放正式 FBX、UV 贴图与 120 帧骨骼循环，不再由程序网格替代。</summary>
    public sealed class AuthoredTornadoVisual : TornadoVisualBase
    {
        static readonly int AlphaId = Shader.PropertyToID("_Alpha");
        static readonly int ColorId = Shader.PropertyToID("_Color");
        MaterialPropertyBlock block;
        float alpha = 1f, fade = 1f, fadeTarget = 1f, fadeSpeed = 3f;

        public static AuthoredTornadoVisual Create(Vector3 ground, float height, float topRadius, Transform parent = null,
            AuthoredTornadoTheme theme = AuthoredTornadoTheme.Frost)
        {
            var prefab = Resources.Load<GameObject>("Fx/Authored/Tornado");
            if (!prefab) return null;
            var go = Object.Instantiate(prefab);
            go.name = $"Authored Tornado {theme}";
            go.transform.SetParent(parent, true);
            go.transform.position = ground;
            float scale = height / 8f;
            go.transform.localScale = new Vector3(topRadius / 2.2f * scale, scale, topRadius / 2.2f * scale);
            var v = go.AddComponent<AuthoredTornadoVisual>();
            v.block = new MaterialPropertyBlock();
            v.ApplyTheme(theme);
            var animator = go.GetComponent<Animator>();
            if (animator)
            {
                animator.applyRootMotion = false;
                animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                animator.Play("TornadoLoop", 0, 0f);
            }
            return v;
        }

        void ApplyTheme(AuthoredTornadoTheme theme)
        {
            string name = theme == AuthoredTornadoTheme.Fire ? "Fire" : theme == AuthoredTornadoTheme.Water ? "Water" : "Frost";
            var body = Resources.Load<Material>($"Fx/Authored/M_{name}");
            var cloud = Resources.Load<Material>("Fx/Authored/M_Cloud");
            var ring = Resources.Load<Material>("Fx/Authored/M_Ring");
            foreach (var renderer in GetComponentsInChildren<Renderer>(true))
                renderer.sharedMaterial = renderer.name.Contains("Cloud") ? cloud : renderer.name.Contains("Ground") ? ring : body;
        }

        void Update()
        {
            fade = Mathf.MoveTowards(fade, fadeTarget, Time.deltaTime * fadeSpeed);
            block.SetFloat(AlphaId, alpha * fade);
            foreach (var renderer in GetComponentsInChildren<Renderer>()) renderer.SetPropertyBlock(block);
            if (fadeTarget <= 0 && fade <= 0.005f) Destroy(gameObject);
        }

        public override void SetAlpha(float value) => alpha = Mathf.Clamp01(value);

        public override void FadeOut(float seconds)
        {
            fadeTarget = 0;
            fadeSpeed = 1f / Mathf.Max(0.05f, seconds);
        }
    }
}
