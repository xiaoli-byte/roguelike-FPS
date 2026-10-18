using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 奖励宝箱（Three.js 版 src/progression/loot/Chests.ts）：从空中落下 → 待机（宝石脉动、盖子偶尔轻颤、奖励色光柱）
    /// → 按 F 开启（开盖 0.5 s，0.32 s 时发放奖励）→ 光柱淡出，空箱留在原地。
    /// 奖励 reward："weapon:&lt;id&gt;[:稀有度]" / "scroll" / "coins" / "heal" / "pet[:…]"（灵兽封印）。模型先用程序化体块（漆木箱 + 铜边 + 宝石），之后换美术资产。
    /// </summary>
    public sealed class Chest : MonoBehaviour, IInteractable
    {
        const float DropTime = 0.42f, SettleTime = 0.62f, OpenTime = 0.5f, GrantAt = 0.32f;

        public string reward = "scroll";
        enum State { Spawn, Idle, Open, Done }
        State state;
        float t, phase;
        bool granted;
        Vector3 basePos;
        Transform root, lid, beam;
        Renderer gem;
        Color color;

        public static Chest Spawn(Vector3 pos, string reward, Vector3 face)
        {
            var go = new GameObject($"Chest · {reward}");
            if (Physics.Raycast(pos + Vector3.up * 4, Vector3.down, out var hit, 12, Layers.WorldMask, QueryTriggerInteraction.Ignore)) pos.y = hit.point.y;
            go.transform.position = pos;
            var to = face - pos;
            to.y = 0;
            if (to.sqrMagnitude > 0.01f) go.transform.rotation = Quaternion.LookRotation(to);
            var c = go.AddComponent<Chest>();
            c.reward = reward;
            c.basePos = pos;
            c.Build();
            return c;
        }

        public static Color RewardColor(string reward) => reward.Split(':')[0] switch
        {
            "weapon" => new Color(1f, 0.62f, 0.25f),
            "scroll" => new Color(0.55f, 0.75f, 1f),
            "coins" => new Color(1f, 0.85f, 0.35f),
            "heal" => new Color(0.4f, 1f, 0.55f),
            "pet" => new Color(1f, 0.55f, 0.85f),
            _ => Color.white,
        };

        void Build()
        {
            color = RewardColor(reward);
            phase = Random.value * 10;
            root = new GameObject("Model").transform;
            root.SetParent(transform, false);
            root.localPosition = Vector3.up * 1.6f;
            var lacquer = new Color(0.45f, 0.12f, 0.08f);
            var bronze = new Color(0.78f, 0.58f, 0.28f);
            Box(root, "Body", new Vector3(0, 0.3f, 0), new Vector3(1.1f, 0.6f, 0.7f), lacquer, true);
            Box(root, "Foot", new Vector3(0, 0.04f, 0), new Vector3(1.18f, 0.08f, 0.78f), bronze, false);
            Box(root, "BandL", new Vector3(-0.42f, 0.32f, 0), new Vector3(0.07f, 0.62f, 0.72f), bronze, false);
            Box(root, "BandR", new Vector3(0.42f, 0.32f, 0), new Vector3(0.07f, 0.62f, 0.72f), bronze, false);
            // 盖子绕后上沿转
            lid = new GameObject("Lid").transform;
            lid.SetParent(root, false);
            lid.localPosition = new Vector3(0, 0.6f, -0.35f);
            Box(lid, "LidTop", new Vector3(0, 0.1f, 0.35f), new Vector3(1.14f, 0.2f, 0.74f), lacquer, false);
            Box(lid, "LidBand", new Vector3(0, 0.1f, 0.35f), new Vector3(0.9f, 0.22f, 0.12f), bronze, false);
            gem = Box(root, "Gem", new Vector3(0, 0.42f, 0.37f), new Vector3(0.16f, 0.16f, 0.06f), color, false);
            gem.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.GlowSprite(MakeAnchor(root, new Vector3(0, 0.42f, 0.42f)), 0.9f, new Color(color.r, color.g, color.b, 0.7f));
            // 光柱（升起时纵向缩放）
            beam = FxMaterials.BeamSprite(transform, 0.9f, 6f, new Color(color.r, color.g, color.b, 0.35f));
            beam.localScale = new Vector3(1, 0.01f, 1);
            Interaction.Add(this);
            ShotFx.Instance?.Impact(basePos + Vector3.up, Vector3.up, false, 4f);
        }

        static Transform MakeAnchor(Transform parent, Vector3 local)
        {
            var a = new GameObject("GemGlow").transform;
            a.SetParent(parent, false);
            a.localPosition = local;
            return a;
        }

        static Renderer Box(Transform parent, string name, Vector3 pos, Vector3 size, Color c, bool collider)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            if (!collider) Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = size;
            var r = go.GetComponent<Renderer>();
            var block = new MaterialPropertyBlock();
            block.SetColor("_BaseColor", c);
            r.SetPropertyBlock(block);
            return r;
        }

        void OnDestroy() => Interaction.Remove(this);

        public bool Opened => state >= State.Open;

        // ── IInteractable ──
        public Vector3 Focus => basePos + Vector3.up * 0.6f;
        public float Radius => 2.6f;
        public bool CanInteract => state == State.Idle;
        public string Prompt => "打开宝箱 · " + reward.Split(':')[0] switch
        {
            "weapon" => "武器",
            "scroll" => "秘卷",
            "coins" => "灵石",
            "heal" => "生命",
            "pet" => "灵宠",
            _ => "奖励",
        };

        public void Interact()
        {
            if (state != State.Idle) return;
            state = State.Open;
            t = 0;
            ShotFx.Instance?.Impact(Focus, Vector3.up, true, 3f);
        }

        static float EaseOutBack(float k)
        {
            const float c1 = 1.70158f, c3 = c1 + 1;
            return 1 + c3 * Mathf.Pow(k - 1, 3) + c1 * Mathf.Pow(k - 1, 2);
        }

        void Update()
        {
            t += Time.deltaTime;
            switch (state)
            {
                case State.Spawn:
                {
                    if (t < DropTime)
                    {
                        float k = t / DropTime;
                        root.localPosition = Vector3.up * 1.6f * (1 - k * k);
                    }
                    else
                    {
                        if (root.localPosition.y > 0) ShotFx.Instance?.Impact(basePos, Vector3.up, false, 3f);
                        root.localPosition = Vector3.zero;
                        float k = Mathf.Clamp01((t - DropTime) / (SettleTime - DropTime));
                        float squash = Mathf.Sin(k * Mathf.PI) * 0.14f * (1 - k);
                        root.localScale = new Vector3(1 + squash, 1 - squash, 1 + squash);
                    }
                    beam.localScale = new Vector3(1, Mathf.Max(0.01f, Mathf.Clamp01(t / SettleTime)), 1);
                    if (t >= SettleTime)
                    {
                        root.localScale = Vector3.one;
                        state = State.Idle;
                        t = 0;
                    }
                    break;
                }
                case State.Idle:
                {
                    float pulse = Mathf.Sin((t + phase) * 4);
                    FxMaterials.Tint(gem, color * (1.2f + pulse * 0.35f));
                    float rattle = Mathf.Max(0, Mathf.Sin((t + phase) * 2.2f));
                    lid.localRotation = Quaternion.Euler(-3.4f * Mathf.Pow(rattle, 12), 0, 0);
                    break;
                }
                case State.Open:
                {
                    float k = Mathf.Clamp01(t / OpenTime);
                    lid.localRotation = Quaternion.Euler(-110f * EaseOutBack(k), 0, 0);
                    if (!granted && t >= GrantAt)
                    {
                        granted = true;
                        LootDirector.Instance?.Grant(reward, Focus + transform.forward * 0.8f);
                    }
                    if (t >= 2f)
                    {
                        state = State.Done;
                        t = 0;
                    }
                    break;
                }
                case State.Done:
                    beam.localScale = new Vector3(1, Mathf.Max(0.01f, 1 - t / 0.8f), 1);
                    if (t >= 0.8f)
                    {
                        beam.gameObject.SetActive(false);
                        enabled = false;
                    }
                    break;
            }
        }
    }
}
