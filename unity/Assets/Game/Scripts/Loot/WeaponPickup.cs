using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 地上的枪（Three.js 版 src/progression/loot/WeaponDrops.ts）：抛到地上 → 离地 0.9 m 悬浮自转，稀有度色光柱 + 光晕。
    /// 按 F 拾取：有空槽放空槽，否则替换手里的枪，被换下的枪落在原地（可以再换回来）。
    /// </summary>
    public sealed class WeaponPickup : MonoBehaviour, IInteractable
    {
        public WeaponInstance weapon;
        Vector3 velocity, basePos;
        bool grounded;
        float age, phase;
        Transform model, beam;

        public static WeaponPickup Drop(WeaponInstance w, Vector3 pos, Vector3 toss)
        {
            var go = new GameObject($"Weapon · {w.def.name}");
            go.transform.position = pos;
            var p = go.AddComponent<WeaponPickup>();
            p.weapon = w;
            p.velocity = toss;
            p.phase = Random.value * 10;
            p.Build();
            return p;
        }

        void Build()
        {
            var color = WeaponLibrary.RarityColor[Mathf.Clamp(weapon.rarity, 0, 4)];
            model = new GameObject("Model").transform;
            model.SetParent(transform, false);
            var prefab = LootCatalog.WeaponModel(weapon.def.prefab);
            float glow = 1.4f;
            if (prefab)
            {
                var inst = Instantiate(prefab, model, false);
                // 掉落模型缩放（TS worldScale：枪模按建模尺寸，地上放大到看得清）
                inst.transform.localScale *= weapon.def.worldScale;
                foreach (var c in inst.GetComponentsInChildren<Collider>(true)) Destroy(c);
                foreach (var a in inst.GetComponentsInChildren<Animator>(true)) a.enabled = false;
                // 元素：枪身纹路发元素色（MPB）
                WeaponTint.Apply(inst, weapon.element, weapon.rarity);
                // 居中：按包围盒把枪身中心挪到原点
                var rs = inst.GetComponentsInChildren<Renderer>();
                if (rs.Length > 0)
                {
                    var b = rs[0].bounds;
                    foreach (var r in rs) b.Encapsulate(r.bounds);
                    inst.transform.position -= b.center - model.position;
                    // 光晕随枪身长度与稀有度放大（同 TS buildWorldModel）
                    glow = Mathf.Max(1f, Mathf.Max(b.size.x, b.size.z) * 1.3f * (0.95f + weapon.rarity * 0.12f));
                }
            }
            else
            {
                var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(box.GetComponent<Collider>());
                box.transform.SetParent(model, false);
                box.transform.localScale = new Vector3(0.12f, 0.2f, 0.6f);
            }
            FxMaterials.GlowSprite(model, glow, new Color(color.r, color.g, color.b, 0.35f));
            // 元素光：带元素的枪再叠一层元素色小光晕
            if (weapon.element != Element.None)
            {
                var ec = WeaponTint.ElementColor(weapon.element);
                FxMaterials.GlowSprite(model, glow * 0.6f, new Color(ec.r, ec.g, ec.b, 0.3f));
            }
            beam = FxMaterials.BeamSprite(transform, 0.6f, 3.2f, new Color(color.r, color.g, color.b, 0.3f));
            Interaction.Add(this);
        }

        void OnDestroy() => Interaction.Remove(this);

        // ── IInteractable ──
        public Vector3 Focus => model ? model.position : transform.position;
        public float Radius => 2.6f;
        public bool CanInteract => grounded || age > 0.6f;

        public string Prompt
        {
            get
            {
                var rarity = WeaponLibrary.RarityName[Mathf.Clamp(weapon.rarity, 0, 4)];
                var hex = ColorUtility.ToHtmlStringRGB(WeaponLibrary.RarityColor[Mathf.Clamp(weapon.rarity, 0, 4)]);
                var wc = PlayerVitals.Instance ? PlayerVitals.Instance.GetComponent<WeaponController>() : null;
                bool full = wc && wc.slots[0] != null && wc.slots[1] != null;
                return $"拾取 <color=#{hex}>{rarity} · {weapon.Title}</color>" + (full ? $"（替换 {wc.Active.Title}）" : "");
            }
        }

        /// <summary>提示卡（WC8）：名称 / 品质 / 类别 / 元素 + 逐项对比手上那把（▲ 更好 / ▼ 更差）+ 特性，见 <see cref="WeaponDescriber.Prompt"/></summary>
        public InteractPrompt PromptCard => WeaponDescriber.Prompt(weapon, "拾取");

        public void Interact()
        {
            var wc = PlayerVitals.Instance ? PlayerVitals.Instance.GetComponent<WeaponController>() : null;
            if (!wc) return;
            var old = wc.Give(weapon);
            GameAudio.Play("pickup_weapon");
            GameUI.Toast($"获得 {WeaponLibrary.RarityName[Mathf.Clamp(weapon.rarity, 0, 4)]} · {weapon.Title}");
            if (old != null) Drop(old, Focus, Vector3.up * 3f);
            Destroy(gameObject);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            if (!grounded)
            {
                velocity.y -= 18f * dt;
                var next = transform.position + velocity * dt;
                if (velocity.y < 0 && Physics.Raycast(transform.position + Vector3.up * 0.3f, Vector3.down, out var hit, 0.5f - velocity.y * dt, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                {
                    next = hit.point;
                    grounded = true;
                    basePos = next;
                    ShotFx.Instance?.Impact(next, Vector3.up, false, 1.5f);
                }
                transform.position = next;
            }
            if (model)
            {
                float lift = grounded ? 0.9f + Mathf.Sin((age + phase) * 2f) * 0.08f : 0.3f;
                model.localPosition = Vector3.up * lift;
                model.Rotate(0, 60f * dt, 0, Space.World);
            }
        }
    }
}
