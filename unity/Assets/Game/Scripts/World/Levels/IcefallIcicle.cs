using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 2-1 冰瀑栈道 ③ 冰拱下的冰棱（docs/level-design/maps/2-1.md §2；unity-maps-v1 第 2 节「冰棱可被射落形成掩体 / 砸伤」）。
    /// 通用的可破坏件（L6 Destructible）还没做，先在这里写一个关卡专用的：
    ///   挂着：根节点在冰拱底面的挂点上，带 <see cref="Damageable"/>（不给奖励、不计击杀，同狐巫冰壁），子物体 <see cref="hanging"/> 是冰棱外观 + 胶囊碰撞（子弹打得中、挡视线）；
    ///   射落：血打空就松脱，按重力 26 往下掉（不受任何东西托住），掉到构建时量好的落点高度 <see cref="groundY"/>；
    ///   砸地：落点 <see cref="radius"/> 米内的敌人吃一记范围伤害（环境伤害 × 本局难度，墙后不受伤），玩家站在正下方也会被砸一下（很轻），镜头一震、冰屑四溅；
    ///   变掩体：冰棱外观收掉，换成构建时就摆在落点、平时隐藏的碎冰堆 <see cref="fallen"/>（带碰撞的 1.6 m 掩体 + 挖洞的导航障碍，敌人绕着走）。
    /// 只此一次：落地后组件停住，碎冰堆一直留在桥上。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class IcefallIcicle : MonoBehaviour
    {
        public const float Gravity = 26f;

        [Tooltip("冰棱外观 + 碰撞（射落时整体往下掉）")]
        public Transform hanging;
        [Tooltip("落地后换上的碎冰堆（构建时摆在落点，平时隐藏）")]
        public GameObject fallen;
        [Tooltip("落点的世界 y（构建时从冰棱尖往下打射线量好）")]
        public float groundY;
        [Tooltip("冰棱尖离挂点多深（米，往下为正）：尖碰到落点高度就算砸地")]
        public float tipDepth = 4.5f;
        [Tooltip("血量（× 本局难度）")]
        public float baseHp = 45f;
        [Tooltip("砸地的范围伤害（× 本局难度）与半径；玩家吃到的是固定的小伤害")]
        public float dropDamage = 150f, radius = 2.8f, playerDamage = 8f;

        static readonly List<IcefallIcicle> all = new();
        static readonly Color IceColor = Hex.Rgb(0xbfe8ff), FrostColor = Hex.Rgb(0x9fdcff);

        /// <summary>场上全部冰棱（测试用）</summary>
        public static IReadOnlyList<IcefallIcicle> All => all;

        public Damageable Health { get; private set; }
        /// <summary>已经松脱、正在往下掉</summary>
        public bool Falling { get; private set; }
        /// <summary>已经砸地、换成碎冰堆了</summary>
        public bool Landed { get; private set; }
        /// <summary>砸地时伤到的敌人数（测试用）</summary>
        public int LastHits { get; private set; }

        float speed;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void Awake()
        {
            Health = GetComponent<Damageable>();
            if (!Health) Health = gameObject.AddComponent<Damageable>();
            float level = RunState.Current != null && RunState.Current.difficulty > 0 ? RunState.Current.difficulty : 1f;
            Health.maxHealth = Mathf.Max(1, Mathf.Round(baseHp * level));
            Health.displayName = "冰棱";
            Health.noReward = true;
            Health.ResetVitals();
            Health.Died += OnDied;
            if (fallen) fallen.SetActive(false);
        }

        void OnEnable() => all.Add(this);

        void OnDisable() => all.Remove(this);

        void OnDestroy()
        {
            if (Health) Health.Died -= OnDied;
        }

        void OnDied(DamageInfo _) => Drop();

        /// <summary>松脱（被打掉、或测试直接调）：开始往下掉</summary>
        public void Drop()
        {
            if (Falling || Landed) return;
            Falling = true;
            speed = 0;
            if (hanging) Fx.Burst(hanging.position, FrostColor, 10, 2.5f, 0.4f, 0.08f, 8);
        }

        void Update()
        {
            if (!Falling || Landed) return;
            float dt = Time.deltaTime;
            speed += Gravity * dt;
            if (!hanging)
            {
                Land();
                return;
            }
            var p = hanging.position;
            float step = speed * dt;
            float tip = p.y - tipDepth;
            if (tip - step <= groundY)
            {
                hanging.position = new Vector3(p.x, groundY + tipDepth, p.z);
                Land();
                return;
            }
            hanging.position = p + Vector3.down * step;
        }

        void Land()
        {
            Falling = false;
            Landed = true;
            var at = hanging ? new Vector3(hanging.position.x, groundY, hanging.position.z) : new Vector3(transform.position.x, groundY, transform.position.z);
            if (hanging) hanging.gameObject.SetActive(false);
            if (fallen) fallen.SetActive(true);
            float level = RunState.Current != null && RunState.Current.difficulty > 0 ? RunState.Current.difficulty : 1f;
            var center = at + Vector3.up * 0.6f;
            var hits = new List<Damageable>();
            Combat.Explode(center, radius, DamageInfo.Simple(dropDamage * level, DamageSource.Environment, center, Vector3.down), true, playerDamage,
                Health, 0.4f, hits);
            LastHits = hits.Count;
            Fx.Ring(at + Vector3.up * 0.05f, radius, FrostColor, 0.45f);
            Fx.Burst(center, IceColor, 26, 5, 0.7f, 0.1f, 9);
            CameraShake.Quake(at, 0.35f, 22f, 0.3f);
            GameAudio.PlayAt("explosion", at, 0.7f, 1.35f);
            enabled = false;
        }

        // ───────────── 构建器用 ─────────────

        /// <summary>
        /// 碎冰堆的导航障碍（关卡构建器调用：fallen 平时隐藏，烘焙时不在导航网格里；落地后靠这个挖洞让敌人绕开）。size = 障碍盒（米）
        /// </summary>
        public static void AddObstacle(GameObject pile, Vector3 size)
        {
            if (!pile) return;
            var ob = pile.GetComponent<NavMeshObstacle>();
            if (!ob) ob = pile.AddComponent<NavMeshObstacle>();
            ob.shape = NavMeshObstacleShape.Box;
            ob.center = new Vector3(0, size.y * 0.5f, 0);
            ob.size = size;
            ob.carving = true;
            ob.carveOnlyStationary = true;
        }
    }
}
