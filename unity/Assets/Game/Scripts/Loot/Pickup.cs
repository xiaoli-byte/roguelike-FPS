using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 掉落物（Three.js 版 src/progression/loot/Pickups.ts）：灵石 / 弹药 / 生命。
    ///   抛出 → 落地弹两下 → 待机（自转、上下浮动、光晕）→ 进入拾取范围被吸过去，0.7 m 内拾取
    ///   灵石：拾取范围 = PickupRadius（3.5 m，秘卷可加）；清场后全场吸取（vacuum）
    ///   弹药 / 生命：2 m，只在需要时才吸（满血不吸血包），60 s 后消失
    /// </summary>
    public sealed class Pickup : MonoBehaviour
    {
        public enum Kind { Coin, Ammo, Health }

        public static readonly List<Pickup> Active = new();
        static Mesh gemMesh;

        public Kind kind;
        public float amount;
        Vector3 velocity;
        float age, settleY, phase, speed;
        bool grounded, attracted;
        Transform model;

        static readonly Color CoinColor = new(1f, 0.78f, 0.3f), AmmoColor = new(1f, 0.92f, 0.6f), HealthColor = new(0.35f, 1f, 0.5f);

        public static Pickup Spawn(Kind kind, Vector3 pos, float amount, float toss = 1f)
        {
            var go = new GameObject(kind switch { Kind.Coin => "Pickup 灵石", Kind.Ammo => "Pickup 弹药", _ => "Pickup 生命" });
            go.transform.position = pos + Vector3.up * 0.4f;
            var p = go.AddComponent<Pickup>();
            p.kind = kind;
            p.amount = amount;
            var dir = Random.insideUnitCircle.normalized * Random.Range(1.2f, 3f) * toss;
            p.velocity = new Vector3(dir.x, Random.Range(4.5f, 6.5f), dir.y);
            p.phase = Random.value * 10;
            p.BuildModel();
            return p;
        }

        void OnEnable() => Active.Add(this);
        void OnDisable() => Active.Remove(this);

        void BuildModel()
        {
            model = new GameObject("Model").transform;
            model.SetParent(transform, false);
            Color c;
            GameObject core;
            switch (kind)
            {
                case Kind.Coin:
                    c = CoinColor;
                    core = new GameObject("Gem", typeof(MeshFilter), typeof(MeshRenderer));
                    core.GetComponent<MeshFilter>().sharedMesh = GemMesh();
                    core.transform.localScale = new Vector3(0.13f, 0.2f, 0.13f) * Mathf.Lerp(1f, 1.6f, Mathf.InverseLerp(1, 10, amount));
                    break;
                case Kind.Ammo:
                    c = AmmoColor;
                    core = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    core.transform.localScale = new Vector3(0.34f, 0.2f, 0.22f);
                    break;
                default:
                    c = HealthColor;
                    core = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    core.transform.localScale = Vector3.one * 0.26f;
                    break;
            }
            Destroy(core.GetComponent<Collider>());
            core.transform.SetParent(model, false);
            var r = core.GetComponent<Renderer>();
            r.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(r, kind == Kind.Ammo ? new Color(0.55f, 0.45f, 0.2f) : c * 1.15f);
            if (kind == Kind.Ammo)
            {
                // 弹药盒：上面一条亮色弹头
                var strip = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(strip.GetComponent<Collider>());
                strip.transform.SetParent(model, false);
                strip.transform.localPosition = new Vector3(0, 0.11f, 0);
                strip.transform.localScale = new Vector3(0.28f, 0.04f, 0.14f);
                var sr = strip.GetComponent<Renderer>();
                sr.sharedMaterial = FxMaterials.Unlit;
                FxMaterials.Tint(sr, c);
            }
            FxMaterials.GlowSprite(model, kind == Kind.Coin ? 0.7f : 1.1f, new Color(c.r, c.g, c.b, 0.55f));
        }

        static Mesh GemMesh()
        {
            if (gemMesh) return gemMesh;
            // 八面体（灵石）
            var v = new[] { Vector3.up, Vector3.down, Vector3.left, Vector3.right, Vector3.forward, Vector3.back };
            int[] t = { 0, 4, 3, 0, 3, 5, 0, 5, 2, 0, 2, 4, 1, 3, 4, 1, 5, 3, 1, 2, 5, 1, 4, 2 };
            var verts = new List<Vector3>();
            var tris = new List<int>();
            for (int i = 0; i < t.Length; i++)
            {
                verts.Add(v[t[i]] * 0.5f);
                tris.Add(i);
            }
            gemMesh = new Mesh { name = "Gem" };
            gemMesh.SetVertices(verts);
            gemMesh.SetTriangles(tris, 0);
            gemMesh.RecalculateNormals();
            return gemMesh;
        }

        bool Wanted(PlayerVitals pv, WeaponController wc)
        {
            switch (kind)
            {
                case Kind.Health: return pv.health < pv.MaxHealth - 0.5f;
                case Kind.Ammo:
                    foreach (var w in wc ? wc.slots : System.Array.Empty<WeaponInstance>())
                        if (w != null && w.reserve < w.def.reserve) return true;
                    return false;
                default: return true;
            }
        }

        /// <summary>清场：所有灵石飞向玩家</summary>
        public static void Vacuum()
        {
            foreach (var p in Active)
                if (p.kind == Kind.Coin) p.attracted = true;
        }

        /// <summary>把 center 周围 range 内的掉落物吸向玩家（神兽白泽觉醒）：灵石总是吸，弹药 / 生命只在用得上时吸</summary>
        public static void Attract(Vector3 center, float range)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            var wc = pv.GetComponent<WeaponController>();
            foreach (var p in Active)
                if (!p.attracted && p.age > 0.45f && (p.transform.position - center).sqrMagnitude < range * range && p.Wanted(pv, wc))
                    p.attracted = true;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            var pv = PlayerVitals.Instance;
            var target = pv ? pv.transform.position + Vector3.up * 0.9f : transform.position;

            if (!attracted && pv && !pv.Dead && age > 0.45f)
            {
                var wc = pv.GetComponent<WeaponController>();
                float range = kind == Kind.Coin ? pv.stats.Get(Stat.PickupRadius) : 2f;
                if ((target - transform.position).sqrMagnitude < range * range && Wanted(pv, wc)) attracted = true;
            }

            if (attracted && pv && !pv.Dead)
            {
                speed = Mathf.Min(22f, speed + 34f * dt);
                var to = target - transform.position;
                float d = to.magnitude;
                if (d < 0.7f || d < speed * dt)
                {
                    Collect(pv);
                    return;
                }
                transform.position += to / d * speed * dt;
            }
            else if (!grounded)
            {
                velocity.y -= 18f * dt;
                var next = transform.position + velocity * dt;
                if (velocity.y < 0 && Physics.Raycast(transform.position + Vector3.up * 0.3f, Vector3.down, out var hit, 0.3f + Mathf.Max(0.05f, -velocity.y * dt) + 0.2f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                {
                    next.y = hit.point.y + 0.2f;
                    if (velocity.y < -2.5f) velocity = new Vector3(velocity.x * 0.5f, -velocity.y * 0.32f, velocity.z * 0.5f);
                    else
                    {
                        grounded = true;
                        settleY = next.y;
                    }
                }
                transform.position = next;
            }
            else
            {
                var p = transform.position;
                p.y = settleY + 0.08f + Mathf.Sin((age + phase) * 2.6f) * 0.06f;
                transform.position = p;
            }

            if (model) model.Rotate(0, (kind == Kind.Coin ? 160f : 70f) * dt, 0, Space.World);
            if (kind != Kind.Coin && !attracted && age > 60f) Destroy(gameObject);
        }

        static float lastCoin = -10;
        static int coinCombo;

        void Collect(PlayerVitals pv)
        {
            float got = amount;
            switch (kind)
            {
                case Kind.Coin:
                    Hud.Instance?.AddCoins(Mathf.RoundToInt(amount));
                    // 连捡灵石音调一颗比一颗高（同 Three.js coinCombo）
                    coinCombo = Time.time - lastCoin < 0.6f ? Mathf.Min(coinCombo + 1, 12) : 0;
                    lastCoin = Time.time;
                    GameAudio.Play("pickup_coin", 0.5f, 1 + coinCombo * 0.04f);
                    break;
                case Kind.Ammo:
                    pv.GetComponent<WeaponController>()?.RefillReserve(amount);
                    Hud.Instance?.Toast("弹药补充");
                    GameAudio.Play("pickup_ammo", 0.8f);
                    break;
                case Kind.Health:
                    float heal = amount > 0 ? amount : pv.MaxHealth * 0.15f;
                    got = heal;
                    pv.Heal(heal);
                    Hud.Instance?.Toast($"生命 +{heal:F0}");
                    GameAudio.Play("pickup_health", 0.85f);
                    break;
            }
            ShotFx.Instance?.Impact(transform.position, Vector3.up, false, kind == Kind.Coin ? 0.3f : 1f);
            GameEvents.RaisePickedUp(kind, got);
            Destroy(gameObject);
        }
    }
}
