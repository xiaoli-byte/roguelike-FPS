using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 掉落物（Three.js 版 src/progression/loot/Pickups.ts）：灵石 / 弹药 / 生命。
    ///   抛出 → 落地弹两下 → 待机（自转、上下浮动、光晕）→ 进入拾取范围被吸过去，0.55 m 内拾取。
    ///   拾取范围 = Stat.PickupRadius（基础 3.5 m，「灵引」可加；三种一样，同 TS）。吸取速度从 3 m/s 起、每秒 +48，最高 32 m/s。
    ///   灵石总是吸；弹药 / 生命只在用得上时吸（满血不吸血包，吸到一半回满了就落回地面）。弹药 / 生命 60 s 没人要就消失（Unity 保留的旧行为）。
    ///   清场（<see cref="Vacuum"/>）：0.8–1.2 s 后场上的掉落物全部吸向玩家（弹药 / 生命仍只在需要时）；
    ///   奖励灵石（宝箱、满层转灵石）落地展示 1.1–1.5 s 后自动吸取（<see cref="LootDirector.DropCoins"/> 的 lateVacuum）。
    ///   对象池：每种一个池，上限 <see cref="EconomyConfig.MaxPickups"/>（240）个同时在场；满了 <see cref="Spawn"/> 返回 null，
    ///   灵石由调用方直接入账（<see cref="LootDirector.DropCoins"/>）。掉出世界的灵石直接入账，其余丢弃。
    ///   灵石入账走 <see cref="EconomyConfig.CreditCoins"/>：灵石获取加成只在这里乘一次。
    /// </summary>
    public sealed class Pickup : MonoBehaviour
    {
        public enum Kind { Coin, Ammo, Health }

        /// <summary>场上的掉落物</summary>
        public static readonly List<Pickup> Active = new();
        static readonly Stack<Pickup>[] pools = { new(), new(), new() };
        static Mesh gemMesh;

        const float CollectDist = 0.55f, MagnetStart = 3f, MagnetAccel = 48f, MagnetMax = 32f, MinRadius = 0.5f;
        const float MagnetAge = 0.3f, Despawn = 60f, FallOut = 60f;

        public Kind kind;
        /// <summary>灵石数 / 弹药比例 / 回复量（≤ 0 = 拾取时按最大生命 15%）</summary>
        public float amount;
        Vector3 velocity;
        float age, settleY, phase, speed, spawnY, vacuumAt = float.PositiveInfinity;
        bool grounded, attracted;
        Transform model, core;

        static readonly Color CoinColor = new(1f, 0.78f, 0.3f), AmmoColor = new(1f, 0.92f, 0.6f), HealthColor = new(0.35f, 1f, 0.5f);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Active.Clear();
            foreach (var p in pools) p.Clear();
            wantFrame = -1;
            lastCoin = -10;
            coinCombo = 0;
        }

        /// <summary>
        /// 生成一个掉落物（从池里取）；场上已满 240 个或位置无效时返回 null（灵石请走 <see cref="LootDirector.DropCoins"/>，满了会直接入账）
        /// </summary>
        public static Pickup Spawn(Kind kind, Vector3 pos, float amount, float toss = 1f)
        {
            if (Active.Count >= EconomyConfig.MaxPickups) return null;
            if (float.IsNaN(pos.x + pos.y + pos.z) || float.IsInfinity(pos.x + pos.y + pos.z)) return null;
            if (float.IsNaN(amount) || float.IsInfinity(amount)) amount = 0;
            var pool = pools[(int)kind];
            Pickup p = null;
            while (!p && pool.Count > 0) p = pool.Pop(); // 卸载场景时销毁掉的是假 null，跳过
            if (!p) p = Create(kind);
            p.Init(pos, amount, toss);
            return p;
        }

        static Pickup Create(Kind kind)
        {
            var go = new GameObject(kind switch { Kind.Coin => "Pickup 灵石", Kind.Ammo => "Pickup 弹药", _ => "Pickup 生命" });
            go.SetActive(false);
            var p = go.AddComponent<Pickup>();
            p.kind = kind;
            p.BuildModel();
            return p;
        }

        void Init(Vector3 pos, float value, float toss)
        {
            amount = value;
            transform.position = pos + Vector3.up * 0.4f;
            spawnY = pos.y;
            var dir = Random.insideUnitCircle.normalized * Random.Range(1.2f, 3f) * toss;
            velocity = new Vector3(dir.x, Random.Range(4.5f, 6.5f), dir.y);
            phase = Random.value * 10;
            age = speed = 0;
            grounded = attracted = false;
            vacuumAt = float.PositiveInfinity;
            if (kind == Kind.Coin && core) core.localScale = new Vector3(0.13f, 0.2f, 0.13f) * Mathf.Lerp(1f, 1.6f, Mathf.InverseLerp(1, 10, value));
            if (model) model.localRotation = Quaternion.Euler(0, Random.value * 360, 0);
            gameObject.SetActive(true);
        }

        void OnEnable() => Active.Add(this);
        void OnDisable() => Active.Remove(this);

        /// <summary>收回池里（拾取、消失、掉出世界）</summary>
        void Release()
        {
            attracted = false;
            gameObject.SetActive(false);
            pools[(int)kind].Push(this);
        }

        /// <summary>清掉场上全部掉落物（换关；灵石不入账）</summary>
        public static void ClearAll()
        {
            foreach (var p in Active.ToArray())
                if (p) p.Release();
        }

        void BuildModel()
        {
            model = new GameObject("Model").transform;
            model.SetParent(transform, false);
            Color c;
            GameObject coreGo;
            switch (kind)
            {
                case Kind.Coin:
                    c = CoinColor;
                    coreGo = new GameObject("Gem", typeof(MeshFilter), typeof(MeshRenderer));
                    coreGo.GetComponent<MeshFilter>().sharedMesh = GemMesh();
                    coreGo.transform.localScale = new Vector3(0.13f, 0.2f, 0.13f);
                    break;
                case Kind.Ammo:
                    c = AmmoColor;
                    coreGo = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    coreGo.transform.localScale = new Vector3(0.34f, 0.2f, 0.22f);
                    break;
                default:
                    c = HealthColor;
                    coreGo = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    coreGo.transform.localScale = Vector3.one * 0.26f;
                    break;
            }
            if (coreGo.TryGetComponent<Collider>(out var col)) Destroy(col);
            core = coreGo.transform;
            core.SetParent(model, false);
            var r = coreGo.GetComponent<Renderer>();
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

        // ───────────── 需要什么（每帧算一次）─────────────

        static int wantFrame = -1;
        static bool wantHealth, wantAmmo;

        static void UpdateWants(PlayerVitals pv)
        {
            if (wantFrame == Time.frameCount) return;
            wantFrame = Time.frameCount;
            bool alive = pv && !pv.Dead;
            wantHealth = alive && pv.health < pv.MaxHealth - 0.01f;
            wantAmmo = false;
            var wc = alive ? pv.GetComponent<WeaponController>() : null;
            if (!wc) return;
            foreach (var w in wc.slots)
                if (w != null && w.reserve < WeaponStatsResolver.Resolve(w, pv.stats).reserveCap)
                {
                    wantAmmo = true;
                    return;
                }
        }

        bool Wanted(PlayerVitals pv)
        {
            if (!pv || pv.Dead) return false;
            if (kind == Kind.Coin) return true;
            UpdateWants(pv);
            return kind == Kind.Health ? wantHealth : wantAmmo;
        }

        /// <summary>清场：delay 秒（另加 0–0.4 s 随机）后场上掉落物全部吸向玩家（弹药 / 生命仍只在需要时）</summary>
        public static void Vacuum(float delay = 0)
        {
            float now = Time.time;
            foreach (var p in Active)
                p.vacuumAt = Mathf.Min(p.vacuumAt, now + delay + (delay > 0 ? Random.value * 0.4f : 0));
        }

        /// <summary>这一颗 delay 秒后自动吸取（奖励灵石落地展示一下再吸）</summary>
        public void VacuumAfter(float delay) => vacuumAt = Time.time + delay + Random.value * 0.4f;

        /// <summary>把 center 周围 range 内的掉落物吸向玩家（神兽白泽觉醒）：灵石总是吸，弹药 / 生命只在用得上时吸</summary>
        public static void Attract(Vector3 center, float range)
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return;
            foreach (var p in Active)
                if (!p.attracted && p.age > MagnetAge && (p.transform.position - center).sqrMagnitude < range * range && p.Wanted(pv))
                    p.StartMagnet();
        }

        void StartMagnet()
        {
            attracted = true;
            speed = MagnetStart;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            age += dt;
            var pv = PlayerVitals.Instance;
            var target = pv ? pv.transform.position + Vector3.up * 0.9f : transform.position;
            bool wants = Wanted(pv);

            if (attracted && !wants)
            {
                // 吸到一半不需要了（回满血 / 人死了）：落回地面
                attracted = false;
                grounded = false;
                velocity = Vector3.zero;
            }
            if (!attracted && wants && age > MagnetAge)
            {
                float r = Mathf.Max(MinRadius, pv.stats.Get(Stat.PickupRadius));
                if ((target - transform.position).sqrMagnitude < r * r || Time.time >= vacuumAt) StartMagnet();
            }

            if (attracted)
            {
                speed = Mathf.Min(MagnetMax, speed + MagnetAccel * dt);
                var to = target - transform.position;
                float d = to.magnitude;
                float step = speed * dt;
                if (d <= CollectDist + step)
                {
                    Collect(pv);
                    return;
                }
                transform.position += to / d * step;
                if (model) model.Rotate(0, 600f * dt, 0, Space.World);
                return;
            }

            if (!grounded)
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
                if (transform.position.y < spawnY - FallOut)
                {
                    // 掉出世界：灵石直接入账，其余丢弃
                    if (kind == Kind.Coin) EconomyConfig.CreditCoins(Mathf.RoundToInt(amount), "lost");
                    Release();
                    return;
                }
            }
            else
            {
                var p = transform.position;
                p.y = settleY + 0.08f + Mathf.Sin((age + phase) * 2.6f) * 0.06f;
                transform.position = p;
            }

            if (model) model.Rotate(0, (kind == Kind.Coin ? 160f : 70f) * dt, 0, Space.World);
            if (kind != Kind.Coin && age > Despawn) Release();
        }

        static float lastCoin = -10;
        static int coinCombo;

        void Collect(PlayerVitals pv)
        {
            float got = amount;
            switch (kind)
            {
                case Kind.Coin:
                    got = EconomyConfig.CreditCoins(Mathf.RoundToInt(amount), "pickup");
                    // 连捡灵石音调一颗比一颗高（同 Three.js coinCombo）
                    if (Time.time - lastCoin > 0.05f)
                    {
                        coinCombo = Time.time - lastCoin < 0.45f ? Mathf.Min(coinCombo + 1, 12) : 0;
                        lastCoin = Time.time;
                        GameAudio.Play("pickup_coin", 0.5f, 1 + coinCombo * 0.04f);
                    }
                    break;
                case Kind.Ammo:
                    float frac = amount > 0 ? amount : EconomyConfig.AmmoPickupFrac;
                    got = frac;
                    pv.GetComponent<WeaponController>()?.RefillReserve(frac);
                    GameUI.Toast("弹药补充");
                    GameAudio.Play("pickup_ammo", 0.8f);
                    break;
                case Kind.Health:
                    float heal = amount > 0 ? amount : pv.MaxHealth * EconomyConfig.HealthPickupFrac;
                    got = pv.Heal(heal);
                    GameUI.Toast($"生命 +{got:F0}");
                    GameAudio.Play("pickup_health", 0.85f);
                    break;
            }
            ShotFx.Instance?.Impact(transform.position, Vector3.up, false, kind == Kind.Coin ? 0.3f : 1f);
            GameEvents.RaisePickedUp(kind, got);
            Release();
        }
    }
}
