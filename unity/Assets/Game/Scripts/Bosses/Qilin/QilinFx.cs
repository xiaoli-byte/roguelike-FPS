using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 火麒麟的熔岩柱（Three.js QilinFx.eruption）：熔池圆心冲天的两层圆柱（外层橙红、内层黄白芯）+ 一盏跟着亮的点光。
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
        float k, want, poolRadius = 7f, age;

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
            outerR = PropBits.Cylinder(transform, "Column", Vector3.zero, Vector3.one, LavaField.Orange);
            outerR.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(outerR, LavaField.Orange * 1.3f);
            coreR = PropBits.Cylinder(transform, "Core", Vector3.zero, Vector3.one, LavaField.Gold);
            coreR.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(coreR, LavaField.Gold * 1.6f);
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
            age += Time.deltaTime;
            k = Mathf.MoveTowards(k, want, Time.deltaTime * (want > k ? 3f : 0.9f));
            Apply();
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
            // Unity 圆柱原始高 2 m、中心在原点：缩放 y = 高 / 2，往上挪半个高度
            outer.localScale = new Vector3(ro, h * 0.5f, ro);
            outer.localPosition = Vector3.up * h * 0.5f;
            core.localScale = new Vector3(rc, h * 0.55f, rc);
            core.localPosition = Vector3.up * h * 0.55f;
        }
    }
}
