using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 敌人身上的元素状态（Three.js 版 src/combat/Status.ts，切片只做灼烧）：
    ///   灼烧：每层独立计时 4 s，最多 3 层（满层替换剩余最短的一层），每 0.5 s 跳一次 = Σ层强度 × 0.16（一层烧满 = 强度 × 1.28）
    ///   强度 = 附着那一下的实际伤害，上限为敌人最大生命的一半。持续伤害走 Combat.DamageEnemy（source Status，不暴击）
    /// 第一次附着时才挂到敌人身上。
    /// </summary>
    public sealed class EnemyStatus : MonoBehaviour
    {
        public const float BurnDuration = 4f, BurnTick = 0.5f, BurnRatio = 0.16f;
        public const int BurnMaxStacks = 3;

        struct Stack
        {
            public float power, remaining;
        }

        readonly List<Stack> burn = new();
        Damageable hp;
        float tickTimer;
        Transform glow;

        public bool Burning => burn.Count > 0;
        public int BurnStacks => burn.Count;

        public static bool IsBurning(Damageable d)
        {
            var s = d ? d.GetComponent<EnemyStatus>() : null;
            return s && s.Burning;
        }

        public static void ApplyBurn(Damageable d, float power)
        {
            if (!d || d.Dead || d.untargetable) return;
            var s = d.GetComponent<EnemyStatus>();
            if (!s) s = d.gameObject.AddComponent<EnemyStatus>();
            s.AddBurn(Mathf.Min(power, d.maxHealth * 0.5f));
        }

        void Awake() => hp = GetComponent<Damageable>();

        void AddBurn(float power)
        {
            if (burn.Count == 0) tickTimer = BurnTick;
            if (burn.Count < BurnMaxStacks) burn.Add(new Stack { power = power, remaining = BurnDuration });
            else
            {
                int oldest = 0;
                for (int i = 1; i < burn.Count; i++)
                    if (burn[i].remaining < burn[oldest].remaining) oldest = i;
                burn[oldest] = new Stack { power = power, remaining = BurnDuration };
            }
            if (!glow)
            {
                var anchor = new GameObject("Burn Glow").transform;
                anchor.SetParent(transform, false);
                var col = GetComponent<Collider>();
                anchor.position = col ? col.bounds.center : transform.position + Vector3.up;
                glow = FxMaterials.GlowSprite(anchor, 2.2f, new Color(1f, 0.45f, 0.12f, 0.45f));
            }
            glow.gameObject.SetActive(true);
        }

        void Update()
        {
            if (burn.Count == 0) return;
            if (!hp || hp.Dead)
            {
                burn.Clear();
                if (glow) glow.gameObject.SetActive(false);
                return;
            }
            float dt = Time.deltaTime;
            tickTimer -= dt;
            if (tickTimer <= 0)
            {
                tickTimer += BurnTick;
                float sum = 0;
                foreach (var s in burn) sum += s.power * BurnRatio;
                var col = GetComponent<Collider>();
                var c = col ? col.bounds.center : transform.position + Vector3.up;
                var info = DamageInfo.Simple(sum, DamageSource.Status, c, Vector3.up);
                info.element = Element.Fire;
                ShotFx.Instance?.Impact(c + Random.insideUnitSphere * 0.3f, Vector3.up, true, 0.8f);
                Combat.DamageEnemy(hp, info);
            }
            for (int i = burn.Count - 1; i >= 0; i--)
            {
                var s = burn[i];
                s.remaining -= dt;
                if (s.remaining <= 0) burn.RemoveAt(i);
                else burn[i] = s;
            }
            if (burn.Count == 0 && glow) glow.gameObject.SetActive(false);
            if (glow) glow.localScale = Vector3.one * (1.6f + 0.3f * burn.Count + Mathf.Sin(Time.time * 13) * 0.15f);
        }
    }
}
