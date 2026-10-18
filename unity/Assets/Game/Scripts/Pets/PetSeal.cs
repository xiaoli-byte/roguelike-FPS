using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 灵兽封印（docs/pet-system.md 第 2 节）：地上一团带品阶光柱的封印，灵宠的身影缩小浮在里面慢慢转，两道符环交错旋转。
    /// 神兽：更高更粗的金红光柱冲天、环绕金色火星、金色点光。按 F 结契；已有灵宠时 = 换宠（旧的变回封印留在原地，灵契等级保留）。
    /// </summary>
    public sealed class PetSeal : MonoBehaviour, IInteractable
    {
        public PetDef def;
        public int level = 1;
        public float xp;
        /// <summary>灵兽台上的（测试）：标签常亮</summary>
        public bool fromAltar;
        /// <summary>换下来的灵宠：灵技冷却结束时刻（Time.time），换回来接着算</summary>
        public float cooldownEndsAt;
        /// <summary>结契过（换下来的）：再结契不重放神兽出场演出</summary>
        public bool bound;

        Vector3 velocity;
        bool grounded;
        float age, phase;
        Transform holder, spirit, ringA, ringB;
        readonly List<Transform> sparks = new();
        Light glowLight;
        float spiritBase;

        public static readonly List<PetSeal> Active = new();

        /// <summary>落一个封印：抛出 toss 后落地；announce = 掉落提示（神兽：「神兽现世」横幅 + 金色光柱冲天）</summary>
        public static PetSeal Drop(PetDef def, Vector3 pos, Vector3 toss = default, int level = 1, float xp = 0, bool announce = false)
        {
            if (def == null) return null;
            var go = new GameObject($"灵兽封印 · {def.name}");
            go.transform.position = pos;
            var s = go.AddComponent<PetSeal>();
            s.def = def;
            s.level = Mathf.Max(1, level);
            s.xp = xp;
            s.velocity = toss == default ? Vector3.up * 4f : toss;
            s.phase = Random.value * 10;
            s.Build();
            if (announce) s.Announce();
            return s;
        }

        /// <summary>按品阶权重抽一只（forced = 固定品阶）</summary>
        public static PetSeal DropRandom(Vector3 pos, PetRarity? forced = null, bool announce = false, Vector3 toss = default) =>
            Drop(PetLibrary.Roll(forced), pos, toss, 1, 0, announce);

        void OnEnable() => Active.Add(this);
        void OnDisable() => Active.Remove(this);
        void OnDestroy() => Interaction.Remove(this);

        void Build()
        {
            var c = def.RarityColor;
            bool mythic = def.rarity == PetRarity.Mythic;
            holder = new GameObject("Seal").transform;
            holder.SetParent(transform, false);

            // 灵宠身影：缩到约 0.9 m 见方，包围盒中心对准封印中心
            spirit = new GameObject("Spirit").transform;
            spirit.SetParent(holder, false);
            var visual = new GameObject("Model").transform;
            visual.SetParent(spirit, false);
            var model = PetVisuals.Build(def, visual);
            float s = Mathf.Min(1f, 0.9f / Mathf.Max(0.3f, model.size));
            visual.localScale = Vector3.one * s;
            var b = PetVisuals.LocalBounds(spirit, visual.gameObject);
            visual.localPosition = -b.center;
            spiritBase = 1.15f;
            spirit.localPosition = Vector3.up * spiritBase;
            foreach (var r in visual.GetComponentsInChildren<Renderer>()) r.shadowCastingMode = ShadowCastingMode.Off;

            // 封印：淡淡的光球 + 两道交错旋转的符环 + 地面光圈
            var shell = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            DestroyImmediate(shell.GetComponent<Collider>());
            shell.name = "Shell";
            shell.transform.SetParent(spirit, false);
            shell.transform.localScale = Vector3.one * 1.45f;
            var sr = shell.GetComponent<Renderer>();
            sr.sharedMaterial = FxMaterials.Additive;
            FxMaterials.Tint(sr, new Color(c.r, c.g, c.b, mythic ? 0.12f : 0.07f));
            ringA = Ring(spirit, 0.82f, c, mythic ? 0.035f : 0.025f);
            ringB = Ring(spirit, 0.74f, mythic ? PetRarities.Gold : Color.Lerp(c, Color.white, 0.4f), 0.02f);
            ringB.localRotation = Quaternion.Euler(70, 0, 0);
            FxMaterials.GlowSprite(spirit, mythic ? 2.6f : 1.8f, new Color(c.r, c.g, c.b, mythic ? 0.45f : 0.3f));
            var floor = GameObject.CreatePrimitive(PrimitiveType.Quad);
            DestroyImmediate(floor.GetComponent<Collider>());
            floor.name = "Floor Glow";
            floor.transform.SetParent(holder, false);
            floor.transform.localPosition = Vector3.up * 0.04f;
            floor.transform.localRotation = Quaternion.Euler(90, 0, 0);
            floor.transform.localScale = Vector3.one * (mythic ? 3.4f : 2.2f);
            var fr = floor.GetComponent<Renderer>();
            fr.sharedMaterial = FxMaterials.Glow;
            FxMaterials.Tint(fr, new Color(c.r, c.g, c.b, 0.55f));

            // 品阶光柱；神兽额外一根金色冲天柱 + 环绕火星 + 点光
            FxMaterials.BeamSprite(holder, mythic ? 1f : 0.7f, mythic ? 7f : 3.4f, new Color(c.r, c.g, c.b, mythic ? 0.45f : 0.3f));
            if (mythic)
            {
                var gold = PetRarities.Gold;
                FxMaterials.BeamSprite(holder, 2.2f, 26f, new Color(gold.r, gold.g, gold.b, 0.35f));
                for (int i = 0; i < 8; i++)
                {
                    var spark = new GameObject("Spark").transform;
                    spark.SetParent(holder, false);
                    FxMaterials.GlowSprite(spark, 0.35f, new Color(1f, 0.85f, 0.45f, 0.95f));
                    sparks.Add(spark);
                }
                glowLight = new GameObject("Glow Light").AddComponent<Light>();
                glowLight.transform.SetParent(holder, false);
                glowLight.transform.localPosition = Vector3.up * 1.2f;
                glowLight.type = LightType.Point;
                glowLight.color = new Color(1f, 0.75f, 0.4f);
                glowLight.range = 8;
                glowLight.intensity = 3;
                glowLight.shadows = LightShadows.None;
            }

            // 名牌：品阶 · 名字 / 称号
            var hex = PetRarities.Hex(def.rarity);
            PetFx.Label(holder, Vector3.up * 2.25f, $"<color=#{hex}>{def.Label}</color>\n<size=40>{def.title}{(level > 1 ? $" · 灵契 Lv.{level}" : "")}</size>",
                Color.white, mythic ? 0.3f : 0.24f);
            Interaction.Add(this);
        }

        static Transform Ring(Transform parent, float radius, Color c, float width)
        {
            var go = new GameObject("Ring");
            go.transform.SetParent(parent, false);
            var lr = go.AddComponent<LineRenderer>();
            lr.useWorldSpace = false;
            lr.loop = true;
            const int n = 40;
            lr.positionCount = n;
            for (int i = 0; i < n; i++)
            {
                float a = i / (float)n * Mathf.PI * 2;
                lr.SetPosition(i, new Vector3(Mathf.Cos(a) * radius, 0, Mathf.Sin(a) * radius));
            }
            lr.widthMultiplier = width;
            lr.sharedMaterial = FxMaterials.Additive;
            lr.startColor = lr.endColor = new Color(c.r, c.g, c.b, 0.85f);
            lr.shadowCastingMode = ShadowCastingMode.Off;
            lr.receiveShadows = false;
            return go.transform;
        }

        /// <summary>掉落提示：神兽全屏横幅「神兽现世」+ 金色光柱冲天；其他品阶只提示一句</summary>
        void Announce()
        {
            if (def.rarity == PetRarity.Mythic)
            {
                Hud.Instance?.Banner("<size=96>神兽现世</size>", 3f);
                Hud.Instance?.Toast($"灵兽封印 · {def.Label}", 3f);
                PetHud.Instance?.Flash(new Color(1f, 0.82f, 0.4f, 0.4f), 0.9f);
                PetFx.Pillar(transform.position, PetRarities.Gold, 3f, 40f, 3f);
            }
            else Hud.Instance?.Toast($"灵兽封印 · {def.Label}", 2.5f);
        }

        // ── IInteractable ──
        public Vector3 Focus => spirit ? spirit.position : transform.position + Vector3.up;
        public float Radius => 2.6f;
        public bool CanInteract => grounded || age > 0.6f;

        public string Prompt
        {
            get
            {
                var hex = PetRarities.Hex(def.rarity);
                var cur = PetOwner.Instance ? PetOwner.Instance.Current : null;
                return $"结契 <color=#{hex}>{def.Label}</color>" + (level > 1 ? $" · 灵契 Lv.{level}" : "") + (cur ? $"（换下 {cur.def.name}）" : "");
            }
        }

        public void Interact()
        {
            var owner = PetOwner.Instance;
            if (!owner || def == null) return;
            var at = transform.position;
            Destroy(gameObject);
            Interaction.Remove(this);
            owner.Bind(def, level, xp, at, cooldownEndsAt, bound);
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
                    velocity = Vector3.zero;
                    ShotFx.Instance?.Impact(next, Vector3.up, false, 1.5f);
                }
                transform.position = next;
                if (age > 6f && !grounded)
                {
                    // 掉出地图：直接贴到地面
                    transform.position = new Vector3(next.x, Pet.GroundY(next + Vector3.up * 10f), next.z);
                    grounded = true;
                }
            }
            if (!spirit) return;
            float t = age + phase;
            spirit.localPosition = Vector3.up * (spiritBase + Mathf.Sin(t * 1.8f) * 0.08f);
            spirit.GetChild(0).Rotate(0, 40f * dt, 0, Space.Self);
            if (ringA) ringA.localRotation = Quaternion.Euler(20 + Mathf.Sin(t) * 10, t * 70f, 0);
            if (ringB) ringB.localRotation = Quaternion.Euler(70, -t * 55f, Mathf.Sin(t * 0.7f) * 15);
            for (int i = 0; i < sparks.Count; i++)
            {
                float a = t * 1.6f + i * Mathf.PI * 2 / sparks.Count;
                sparks[i].localPosition = new Vector3(Mathf.Cos(a) * 1.15f, 0.5f + (i % 4) * 0.45f + Mathf.Sin(t * 2.4f + i) * 0.15f, Mathf.Sin(a) * 1.15f);
            }
            if (glowLight) glowLight.intensity = 2.6f + Mathf.Sin(t * 3f) * 0.6f;
        }
    }

    /// <summary>
    /// 灵兽台（测试便利，和武器架同理）：开局把八只灵宠的封印摆成一个朝玩家敞开的半圆，按 F 结契随便试。
    /// 半圆从本物体位置开始向右展开（本物体的 forward 朝向玩家）。
    /// </summary>
    public sealed class PetAltar : MonoBehaviour
    {
        public float radius = 7f;  // 八个封印沿半圆排开，间距约 3 米：神兽的大模型和名牌不互相压

        void Start()
        {
            var right = transform.right;
            var away = -transform.forward;
            var center = transform.position + right * radius;
            var all = PetLibrary.All;
            for (int i = 0; i < all.Length; i++)
            {
                // 从左端（本物体位置）经过最深处到右端
                float a = Mathf.PI * i / (all.Length - 1);
                var p = center - right * Mathf.Cos(a) * radius + away * Mathf.Sin(a) * radius;
                p.y = Pet.GroundY(p + Vector3.up * 5f) + 0.05f;
                var seal = PetSeal.Drop(all[i], p, Vector3.down * 0.1f);
                seal.fromAltar = true;
            }
            var title = transform.position + right * radius + away * (radius + 1.2f);
            title.y = Pet.GroundY(title + Vector3.up * 5f);
            var anchor = new GameObject("Altar Title").transform;
            anchor.SetParent(transform, true);
            anchor.position = title;
            PetFx.Label(anchor, Vector3.up * 3.6f, "<color=#ffd27a>灵兽台</color>\n<size=36>（测试）凡灵 · 灵兽 · 神兽</size>", Color.white, 0.42f);
        }
    }
}
