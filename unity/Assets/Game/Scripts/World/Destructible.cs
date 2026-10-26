using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 可破坏物（L6 场景件）：木箱、陶瓮、石碑、封门的朽木 / 碎石墙、火药罐……按伤害类型吃伤害，血打空就碎。
    ///   · 血：根节点的 <see cref="Damageable"/>（不给奖励、不计击杀、没有头顶血条），<see cref="baseHp"/> × 本局难度（<see cref="scaleWithDifficulty"/>）；
    ///     碰撞体在世界层（挡人、挡子弹），挂 <see cref="Hitbox"/>（<see cref="blocksSight"/> = 实心的挡视线）。
    ///   · 伤害类型（<see cref="accepts"/>）：一下伤害按「怎么打的」（射击 / 近战 / 爆炸 / 技能 / 敌人 / 环境 / 灵宠）和「什么元素」（火 / 雷 / 蚀）归类，
    ///     有一项在 accepts 里才吃——石碑只认爆炸，荆棘只认火；不吃的弹「格挡」。<see cref="weakTo"/> 里的类型伤害 × <see cref="weakMult"/>（木头怕火）。
    ///   · 受击：碎屑一小蓬、越伤越暗；碎：碰撞体当帧撤掉（站在上面的人掉下来），<see cref="intact"/> 外观收掉、<see cref="rubble"/>（可选，构建时摆好、平时隐藏）换上，
    ///     FX「PropShatter」按材质色（木 / 陶 / 石；冰走 FrostShatter、金属走 ArmorChip）+ 声音 + 大件震屏。
    ///   · 掉落（可选）：灵石 <see cref="coins"/>（区间，0 = 不掉）、弹药 / 生命按概率。
    ///   · 爆炸（可选，火药罐）：<see cref="blastRadius"/> &gt; 0 时碎的同时炸一圈（伤敌人 × 难度、轻伤玩家，连锁会引爆旁边的罐子）。
    ///   · 导航：完整时一个挖洞的 <see cref="NavMeshObstacle"/>（只在静止时挖）让敌人绕开，碎了就撤——构建器用 NavMeshModifier 把它排除出烘焙
    ///     （LevelKit.Destructible），碎了之后那块地马上能走。
    ///   · 信号：被 <see cref="SceneActivator"/> 触发就直接碎（机关炸开封门）；碎时通知 <see cref="targets"/>（打碎封印 → 开机关）并发 <see cref="Broken"/>。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class Destructible : MonoBehaviour, IActivatable
    {
        public enum Kind { Wood, Clay, Stone, Ice, Metal }

        /// <summary>伤害类型（按位）：怎么打的 + 什么元素</summary>
        [Flags]
        public enum DamageKind
        {
            None = 0,
            Shot = 1 << 0,
            Melee = 1 << 1,
            Explosion = 1 << 2,
            Skill = 1 << 3,
            Fire = 1 << 4,
            Shock = 1 << 5,
            Corrode = 1 << 6,
            Enemy = 1 << 7,
            Environment = 1 << 8,
            Pet = 1 << 9,
            /// <summary>玩家这边的一切（不含敌人 / 环境）</summary>
            Player = Shot | Melee | Explosion | Skill | Fire | Shock | Corrode | Pet,
            All = ~0,
        }

        [Header("血 / 伤害类型")]
        public Kind kind = Kind.Wood;
        [Tooltip("血量（× 本局难度，见 scaleWithDifficulty）")]
        public float baseHp = 40f;
        public bool scaleWithDifficulty = true;
        [Tooltip("吃哪些伤害（一下伤害的类型有一项在里面就吃；不吃的弹「格挡」）")]
        public DamageKind accepts = DamageKind.Player;
        [Tooltip("怕哪些伤害、倍率（木头怕火）")]
        public DamageKind weakTo = DamageKind.None;
        public float weakMult = 2f;
        public string displayName = "木箱";
        [Tooltip("碰撞体挡视线（实心件）")]
        public bool blocksSight = true;

        [Header("外观")]
        [Tooltip("完整时的外观 + 碰撞（碎时整块收掉；空 = 本物体下除 rubble 外的全部渲染器 / 碰撞体）")]
        public GameObject intact;
        [Tooltip("碎了之后换上的残骸（构建时摆好、平时隐藏；可空）")]
        public GameObject rubble;
        [Tooltip("件的大小（米）：碎片特效的规模、震屏")]
        public float size = 1f;

        [Header("掉落 / 爆炸")]
        [Tooltip("灵石区间（0 = 不掉）")]
        public Vector2Int coins;
        [Range(0, 1)] public float ammoChance, healthChance;
        [Tooltip("碎时爆炸的半径（0 = 不炸）、伤害（× 难度）、玩家吃到的伤害")]
        public float blastRadius, blastDamage = 60f, blastPlayerDamage = 10f;

        [Header("信号")]
        [Tooltip("碎时通知的件（IActivatable）")]
        public MonoBehaviour[] targets = Array.Empty<MonoBehaviour>();

        static readonly List<Destructible> all = new();
        /// <summary>场上的可破坏物（测试用）</summary>
        public static IReadOnlyList<Destructible> All => all;
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        public Damageable Health { get; private set; }
        public bool IsBroken { get; private set; }
        /// <summary>被挡掉（类型不对）的次数、吃到的次数（测试用）</summary>
        public int Blocked { get; private set; }
        public int Taken { get; private set; }
        /// <summary>碎的那一下的类型</summary>
        public DamageKind BrokenBy { get; private set; }
        public NavMeshObstacle Obstacle { get; private set; }

        /// <summary>碎了（这个件、碎它的那一下）</summary>
        public event Action<Destructible, DamageInfo> Broken;

        IDisposable incoming;
        readonly List<Renderer> renderers = new();
        readonly List<Color> baseColors = new();
        MaterialPropertyBlock block;
        float chipAt;
        DamageKind lastKind;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        /// <summary>材质的本色（碎片特效、受击碎屑）</summary>
        public static Color KindColor(Kind k) => k switch
        {
            Kind.Wood => Hex.Rgb(0x8a6440),
            Kind.Clay => Hex.Rgb(0xb0704a),
            Kind.Stone => Hex.Rgb(0x8f8a80),
            Kind.Ice => Hex.Rgb(0xbfe8ff),
            _ => Hex.Rgb(0x7d7f86),
        };

        /// <summary>一下伤害的类型：怎么打的 + 什么元素（持续伤害只算元素）</summary>
        public static DamageKind Classify(in DamageInfo info)
        {
            var k = DamageKind.None;
            bool dot = DamageCalc.IsDot(info);
            if (!dot)
            {
                if (info.Has(DamageTag.Explosion) || info.source == DamageSource.Explosion) k |= DamageKind.Explosion;
                else
                    k |= info.source switch
                    {
                        DamageSource.Weapon or DamageSource.Scroll => info.Has(DamageTag.Melee) ? DamageKind.Melee : DamageKind.Shot,
                        DamageSource.Melee => DamageKind.Melee,
                        DamageSource.Skill => DamageKind.Skill,
                        DamageSource.Enemy => DamageKind.Enemy,
                        DamageSource.Environment => DamageKind.Environment,
                        DamageSource.Pet => DamageKind.Pet,
                        _ => DamageKind.None,
                    };
            }
            k |= info.element switch
            {
                Element.Fire => DamageKind.Fire,
                Element.Shock => DamageKind.Shock,
                Element.Corrode => DamageKind.Corrode,
                _ => DamageKind.None,
            };
            return k;
        }

        void Awake()
        {
            Health = GetComponent<Damageable>();
            if (!Health) Health = gameObject.AddComponent<Damageable>();
            float level = scaleWithDifficulty && RunState.Current != null && RunState.Current.difficulty > 0 ? RunState.Current.difficulty : 1f;
            Health.maxHealth = Mathf.Max(1, Mathf.Round(baseHp * level));
            Health.displayName = displayName;
            Health.noReward = true;
            Health.ResetVitals();
            Health.Damaged += OnDamaged;
            Health.Died += OnDied;
            incoming = Health.Incoming.Add(Filter);
            if (rubble) rubble.SetActive(false);
            var root = intact ? intact.transform : transform;
            foreach (var c in root.GetComponentsInChildren<Collider>(true))
            {
                if (c.isTrigger || (rubble && c.transform.IsChildOf(rubble.transform))) continue;
                var hb = c.GetComponent<Hitbox>();
                if (!hb) hb = c.gameObject.AddComponent<Hitbox>();
                if (!hb.owner) hb.owner = Health;
                hb.blocksSight = blocksSight;
            }
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
            {
                if (rubble && r.transform.IsChildOf(rubble.transform)) continue;
                renderers.Add(r);
                baseColors.Add(r.sharedMaterial && r.sharedMaterial.HasProperty(BaseColorId) ? r.sharedMaterial.GetColor(BaseColorId) : Color.white);
            }
            block = new MaterialPropertyBlock();
            Obstacle = GetComponent<NavMeshObstacle>();
        }

        void OnEnable() => all.Add(this);

        void OnDisable() => all.Remove(this);

        void OnDestroy()
        {
            incoming?.Dispose();
            if (Health)
            {
                Health.Damaged -= OnDamaged;
                Health.Died -= OnDied;
            }
        }

        float Filter(in IncomingHit h)
        {
            var k = Classify(in h.info);
            lastKind = k;
            if ((k & accepts) == 0) return 0;
            return (k & weakTo) != 0 ? Mathf.Max(0, weakMult) : 1f;
        }

        void OnDamaged(DamageInfo info, DamageResult r)
        {
            if (IsBroken) return;
            if (r.total <= 0)
            {
                if (r.blocked) Blocked++;
                return;
            }
            Taken++;
            // 受击：碎屑一小蓬（节流）、越伤越暗
            if (Time.time >= chipAt)
            {
                chipAt = Time.time + 0.08f;
                var at = info.point != Vector3.zero ? info.point : Center;
                PlayShatter(at, -info.direction, Mathf.Clamp(size * 0.3f, 0.3f, 0.8f));
            }
            float hurt = Health.maxHealth > 0 ? 1 - Health.health / Health.maxHealth : 0;
            for (int i = 0; i < renderers.Count; i++)
            {
                var rd = renderers[i];
                if (!rd) continue;
                rd.GetPropertyBlock(block);
                block.SetColor(BaseColorId, Color.Lerp(baseColors[i], baseColors[i] * 0.55f, hurt));
                rd.SetPropertyBlock(block);
            }
        }

        void OnDied(DamageInfo info) => Shatter(info, lastKind);

        /// <summary>直接碎（机关信号、测试、剧情）：不经过伤害结算，没有击杀事件</summary>
        public void Break()
        {
            if (IsBroken) return;
            if (Health && !Health.Dead) Health.Kill(DamageInfo.Simple(0, DamageSource.Environment, Center, Vector3.up));
            else Shatter(DamageInfo.Simple(0, DamageSource.Environment, Center, Vector3.up), DamageKind.None);
        }

        public void OnActivated(SceneActivator source, bool on)
        {
            if (on) Break();
        }

        /// <summary>件的中心（碰撞体包围盒中心）</summary>
        public Vector3 Center
        {
            get
            {
                var root = intact ? intact : gameObject;
                var c = root.GetComponentInChildren<Collider>();
                return c && c.enabled ? c.bounds.center : transform.position + Vector3.up * size * 0.5f;
            }
        }

        void Shatter(DamageInfo info, DamageKind by)
        {
            if (IsBroken) return;
            var center = Center;
            IsBroken = true;
            BrokenBy = by;
            // 碰撞体当帧撤掉：站在上面的人这一帧就往下掉，子弹不再被挡
            if (intact) intact.SetActive(false);
            else
            {
                foreach (var c in GetComponentsInChildren<Collider>()) c.enabled = false;
                foreach (var r in renderers)
                    if (r)
                        r.enabled = false;
            }
            if (rubble) rubble.SetActive(true);
            if (Obstacle) Obstacle.enabled = false;
            if (EnemyRegistry.Purging) return;

            PlayShatter(center, Vector3.up, size);
            GameAudio.PlayAt(kind switch { Kind.Ice => "shield_break", Kind.Metal => "hit_armor", _ => "skill_earth" }, center, Mathf.Clamp(0.45f + size * 0.2f, 0.5f, 1f),
                kind switch { Kind.Wood => 1.35f, Kind.Clay => 1.5f, Kind.Stone => 0.85f, _ => 1f });
            if (size >= 1.5f) CameraShake.Quake(center, 0.12f * Mathf.Min(3f, size), 6f + size * 4f, 0.25f);
            DropLoot(center);
            if (blastRadius > 0)
            {
                float level = RunState.Current != null && RunState.Current.difficulty > 0 ? RunState.Current.difficulty : 1f;
                Combat.Explode(center, blastRadius, DamageInfo.Simple(blastDamage * level, DamageSource.Explosion, center, Vector3.up), true, blastPlayerDamage, Health);
                CameraShake.Quake(center, 0.35f, blastRadius * 4f, 0.35f);
            }
            foreach (var t in targets)
            {
                if (!t || t == this || t is not IActivatable a) continue;
                try
                {
                    a.OnActivated(null, true);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
            }
            if (Broken != null)
                try
                {
                    Broken(this, info);
                }
                catch (Exception e)
                {
                    Debug.LogException(e);
                }
        }

        void PlayShatter(Vector3 at, Vector3 normal, float scale)
        {
            var col = KindColor(kind);
            switch (kind)
            {
                case Kind.Ice:
                    Fx.Play("FrostShatter", at, normal, col, scale);
                    break;
                case Kind.Metal:
                    Fx.ArmorBreak(at, scale);
                    break;
                default:
                    Fx.Play("PropShatter", at, normal.sqrMagnitude > 1e-4f ? normal.normalized : Vector3.up, col, scale);
                    break;
            }
        }

        void DropLoot(Vector3 at)
        {
            var rng = RunState.Current?.Stream("props");
            float Roll() => rng != null ? rng.Value : UnityEngine.Random.value;
            if (coins.y > 0)
            {
                int lo = Mathf.Max(0, Mathf.Min(coins.x, coins.y)), hi = Mathf.Max(coins.x, coins.y);
                int n = rng != null ? rng.Int(lo, hi) : UnityEngine.Random.Range(lo, hi + 1);
                if (n > 0) LootDirector.DropCoins(at, n, 0.8f);
            }
            if (ammoChance > 0 && Roll() < ammoChance) Pickup.Spawn(Pickup.Kind.Ammo, at, EconomyConfig.AmmoPickupFrac, 0.8f);
            if (healthChance > 0 && Roll() < healthChance) Pickup.Spawn(Pickup.Kind.Health, at, 0, 0.8f);
        }

        // ───────────── 构建器用 ─────────────

        /// <summary>完整时的导航障碍（构建器调用；件本身已用 NavMeshModifier 排除出烘焙）：size = 障碍盒（米），中心在 center（本地）</summary>
        public static NavMeshObstacle AddObstacle(GameObject go, Vector3 center, Vector3 size)
        {
            var ob = go.GetComponent<NavMeshObstacle>();
            if (!ob) ob = go.AddComponent<NavMeshObstacle>();
            ob.shape = NavMeshObstacleShape.Box;
            ob.center = center;
            ob.size = size;
            ob.carving = true;
            ob.carveOnlyStationary = true;
            return ob;
        }
    }
}
