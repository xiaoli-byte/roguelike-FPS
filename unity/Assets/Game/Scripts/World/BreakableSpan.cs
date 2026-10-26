using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 可断裂桥段（L6 场景件）：一座由若干段桥板（<see cref="segments"/>，各自带碰撞）拼成的桥 / 栈道 / 冰桥，可以一段一段塌，也可以整座断。
    ///   · 怎么断（<see cref="triggers"/>，可叠）：
    ///     Step —— 玩家站上某一段（<see cref="stepByEnemies"/> 打开时敌人也算），那段抖 <see cref="stepDelay"/> 秒后塌（2-1「断桥冲刺」：跑过去，身后一段段掉）；
    ///     Damage —— 根节点的 <see cref="Damageable"/>（不给奖励、不计击杀，血 <see cref="baseHp"/> × 难度，桥板都挂命中盒）打空就整座断，从被打的那段开始往两头塌；
    ///              没开 Damage 的桥不挂血量，子弹打上去就是普通的世界几何（弹着点、弹孔），不弹「格挡」；
    ///     Signal —— 被 <see cref="SceneActivator"/> 触发就整座断（从 <see cref="signalOrigin"/> 那段开始）。
    ///   · 一段怎么塌：先抖 <see cref="warnTime"/> 秒（还站得住），然后碰撞体当帧撤掉（上面的人往下掉——玩家走 PlayerMotor 的重力，没有地面可穿，
    ///     不会触发防穿地；站在上面的地面敌人被掀起 <see cref="EnemyAI.LaunchUp"/> 一下交给脚本重力，落到下面的地面再交还导航），
    ///     桥板带着重力翻滚掉下去，碰到地面（或掉了 <see cref="fallLimit"/> 米）就碎成一蓬碎片（PropShatter，木色；冰桥走 FrostShatter）消失。
    ///     整座断的时候每段比前一段晚 <see cref="chainDelay"/> 秒，从起点往两头传。
    ///   · 导航：桥板在烘焙时就在导航网格上（敌人走桥）；每段在原位放一个平时关着的挖洞 <see cref="NavMeshObstacle"/>（挂在桥的根节点下、不跟着桥板掉，
    ///     盒子只罩住桥板上下各 0.6 m），塌了就打开——桥上那一段从导航网格上挖掉，下面的地面不受影响，敌人改走别的路。
    ///   · <see cref="Rebuild"/>：全部复原（测试 / 剧情用；关卡默认不复原）。
    /// 事件：<see cref="SegmentFell"/>（段下标）、<see cref="Collapsed"/>（全部塌完）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BreakableSpan : MonoBehaviour, IActivatable
    {
        [Flags]
        public enum Trigger
        {
            None = 0,
            Step = 1 << 0,
            Damage = 1 << 1,
            Signal = 1 << 2,
        }

        [Tooltip("桥板（从一头排到另一头）：每段带碰撞体，物体位置 = 桥板顶面中心")]
        public Transform[] segments = Array.Empty<Transform>();
        [Tooltip("桥板尺寸（米，局部 X 宽 × Z 长）与厚度：站人检测、导航挖洞按它")]
        public Vector2 segmentSize = new(3f, 1.5f);
        public float segmentThickness = 0.3f;
        public Trigger triggers = Trigger.Damage | Trigger.Signal;
        [Tooltip("Step：站上去多久开始塌（秒）；敌人站上去也算")]
        public float stepDelay = 0.35f;
        public bool stepByEnemies;
        [Tooltip("每段塌之前抖多久（秒，这段时间还站得住）、整座断时相邻两段的间隔（秒）")]
        public float warnTime = 0.45f, chainDelay = 0.12f;
        [Tooltip("Damage：血量（× 本局难度）")]
        public float baseHp = 120f;
        [Tooltip("Signal：从第几段开始塌（-1 = 正中）")]
        public int signalOrigin = -1;
        [Tooltip("桥板最多掉多深就碎掉消失（米）")]
        public float fallLimit = 30f;
        [Tooltip("木桥 / 冰桥：碎片颜色与特效")]
        public Destructible.Kind kind = Destructible.Kind.Wood;
        public string displayName = "朽桥";

        static readonly List<BreakableSpan> all = new();
        /// <summary>场上的桥（测试用）</summary>
        public static IReadOnlyList<BreakableSpan> All => all;

        public enum SegState { Intact, Warning, Falling, Gone }

        sealed class Seg
        {
            public Transform t;
            public Vector3 home;
            public Quaternion homeRot;
            public Collider[] colliders;
            public NavMeshObstacle carve;
            public SegState state;
            public float timer, standTime, vy, groundY;
            public Vector3 spin, drift;
        }

        public const float Gravity = 26f;

        readonly List<Seg> segs = new();
        static readonly Collider[] hits = new Collider[16];

        public Damageable Health { get; private set; }
        /// <summary>塌了的段数 / 总段数</summary>
        public int FallenCount { get; private set; }
        public int Count => segs.Count;
        public bool Collapsed => segs.Count > 0 && FallenCount >= segs.Count;
        public SegState StateOf(int i) => i >= 0 && i < segs.Count ? segs[i].state : SegState.Gone;
        /// <summary>某段的挖洞障碍开着（测试用）</summary>
        public bool Carved(int i) => i >= 0 && i < segs.Count && segs[i].carve && segs[i].carve.enabled;

        public event Action<BreakableSpan, int> SegmentFell;
        public event Action<BreakableSpan> CollapsedAll;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void Awake()
        {
            // 只有能被打断的桥才挂血量（没有 Damageable 的桥板就是普通的世界几何）
            Health = GetComponent<Damageable>();
            if (!Health && (triggers & Trigger.Damage) != 0) Health = gameObject.AddComponent<Damageable>();
            if (Health)
            {
                float level = RunState.Current != null && RunState.Current.difficulty > 0 ? RunState.Current.difficulty : 1f;
                Health.maxHealth = Mathf.Max(1, Mathf.Round(baseHp * level));
                Health.displayName = displayName;
                Health.noReward = true;
                Health.ResetVitals();
                Health.Died += OnDied;
            }
            for (int i = 0; i < segments.Length; i++)
            {
                var t = segments[i];
                if (!t) continue;
                var s = new Seg { t = t, home = t.position, homeRot = t.rotation, colliders = t.GetComponentsInChildren<Collider>(true) };
                if (Health)
                    foreach (var c in s.colliders)
                    {
                        if (c.isTrigger) continue;
                        var hb = c.GetComponent<Hitbox>();
                        if (!hb) hb = c.gameObject.AddComponent<Hitbox>();
                        if (!hb.owner) hb.owner = Health;
                        hb.blocksSight = true;
                    }
                s.carve = AddCarve(transform, $"Nav Carve {i}", s.home, s.homeRot, segmentSize, segmentThickness);
                segs.Add(s);
            }
        }

        void OnEnable() => all.Add(this);

        void OnDisable() => all.Remove(this);

        void OnDestroy()
        {
            if (Health) Health.Died -= OnDied;
        }

        void OnDied(DamageInfo info)
        {
            int from = segs.Count / 2;
            float best = float.MaxValue;
            if (info.point != Vector3.zero)
                for (int i = 0; i < segs.Count; i++)
                {
                    float d = (segs[i].home - info.point).sqrMagnitude;
                    if (d < best)
                    {
                        best = d;
                        from = i;
                    }
                }
            BreakAll(from);
        }

        public void OnActivated(SceneActivator source, bool on)
        {
            if (on && (triggers & Trigger.Signal) != 0) BreakAll(signalOrigin);
        }

        /// <summary>整座断：从 origin 那段（-1 = 正中）开始往两头塌，每段晚 chainDelay 秒</summary>
        public void BreakAll(int origin = -1)
        {
            if (segs.Count == 0) return;
            if (origin < 0 || origin >= segs.Count) origin = segs.Count / 2;
            for (int i = 0; i < segs.Count; i++) Warn(i, Mathf.Abs(i - origin) * Mathf.Max(0, chainDelay));
            if (Health && !Health.Dead) Health.Kill(DamageInfo.Simple(0, DamageSource.Environment, segs[origin].home, Vector3.down));
            GameAudio.PlayAt("skill_earth", segs[origin].home, 0.9f, 0.7f);
        }

        /// <summary>让第 i 段开始塌：先抖 delay + warnTime 秒</summary>
        public void Warn(int i, float delay = 0)
        {
            if (i < 0 || i >= segs.Count) return;
            var s = segs[i];
            if (s.state != SegState.Intact) return;
            s.state = SegState.Warning;
            s.timer = -Mathf.Max(0, delay);
            GameAudio.PlayAt("enemy_melee", s.home, 0.35f, 0.5f + 0.1f * (i % 3));
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (!(dt > 0)) return;
            for (int i = 0; i < segs.Count; i++)
            {
                var s = segs[i];
                switch (s.state)
                {
                    case SegState.Intact:
                        if ((triggers & Trigger.Step) != 0 && SomeoneOn(s))
                        {
                            s.standTime += dt;
                            if (s.standTime >= stepDelay) Warn(i);
                        }
                        else s.standTime = 0;
                        break;
                    case SegState.Warning:
                        s.timer += dt;
                        if (s.timer < 0) break;
                        // 抖：越抖越狠，往下沉一点
                        float k = Mathf.Clamp01(s.timer / Mathf.Max(0.05f, warnTime));
                        float j = 0.03f + 0.06f * k;
                        s.t.SetPositionAndRotation(s.home + new Vector3(Mathf.Sin(s.timer * 61f) * j, -0.05f * k, Mathf.Cos(s.timer * 47f) * j),
                            s.homeRot * Quaternion.Euler(Mathf.Sin(s.timer * 53f) * 3f * k, 0, Mathf.Sin(s.timer * 41f) * 3f * k));
                        if (s.timer >= warnTime) Fall(i);
                        break;
                    case SegState.Falling:
                        s.vy -= Gravity * dt;
                        var p = s.t.position + (Vector3.up * s.vy + s.drift) * dt;
                        s.t.SetPositionAndRotation(p, s.t.rotation * Quaternion.Euler(s.spin * dt));
                        if (p.y <= s.groundY + segmentThickness * 0.5f || p.y < s.home.y - fallLimit) Land(i);
                        break;
                }
            }
        }

        /// <summary>这段桥板上方站着玩家（角色控制器）；stepByEnemies 时敌人的胶囊也算</summary>
        bool SomeoneOn(Seg s)
        {
            var half = new Vector3(segmentSize.x * 0.5f, 0.35f, segmentSize.y * 0.5f);
            int n = Physics.OverlapBoxNonAlloc(s.home + Vector3.up * 0.3f, half, hits, s.homeRot, 1 << Layers.Character, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < n; i++)
                if (hits[i] is CharacterController || (stepByEnemies && hits[i] && hits[i].GetComponentInParent<EnemyAI>()))
                    return true;
            return false;
        }

        void Fall(int i)
        {
            var s = segs[i];
            s.state = SegState.Falling;
            s.t.SetPositionAndRotation(s.home, s.homeRot);
            // 碰撞体当帧撤掉：上面的人这一帧开始往下掉
            foreach (var c in s.colliders)
                if (c)
                    c.enabled = false;
            Physics.SyncTransforms();
            // 导航：这一段从网格上挖掉
            if (s.carve) s.carve.enabled = true;
            // 站在上面的地面敌人：掀起一下交给脚本重力（落到下面的地面再交还导航）
            DropEnemiesOn(s);
            s.groundY = GroundBelow(s.home);
            s.vy = -0.5f;
            var r = new System.Random(i * 7919 + 17);
            float R() => (float)r.NextDouble() * 2 - 1;
            s.spin = new Vector3(R() * 90f, R() * 40f, R() * 120f);
            s.drift = new Vector3(R(), 0, R()) * 0.6f;
            FallenCount++;
            var col = Destructible.KindColor(kind);
            Fx.Burst(s.home, col, 8, 2.5f, 0.5f, 0.07f, 9f);
            GameAudio.PlayAt("skill_earth", s.home, 0.5f, kind == Destructible.Kind.Ice ? 1.5f : 1.25f);
            try
            {
                SegmentFell?.Invoke(this, i);
                if (Collapsed) CollapsedAll?.Invoke(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        void Land(int i)
        {
            var s = segs[i];
            s.state = SegState.Gone;
            var at = s.t.position;
            if (kind == Destructible.Kind.Ice) Fx.Play("FrostShatter", at, Vector3.up, Destructible.KindColor(kind), Mathf.Max(segmentSize.x, segmentSize.y));
            else Fx.Play("PropShatter", at, Vector3.up, Destructible.KindColor(kind), Mathf.Max(segmentSize.x, segmentSize.y));
            if (s.t.position.y > s.home.y - fallLimit) GameAudio.PlayAt("skill_earth", at, 0.45f, 1.1f);
            s.t.gameObject.SetActive(false);
        }

        void DropEnemiesOn(Seg s)
        {
            var half = new Vector3(segmentSize.x * 0.5f + 0.2f, 1f, segmentSize.y * 0.5f + 0.2f);
            int n = Physics.OverlapBoxNonAlloc(s.home + Vector3.up * 1f, half, hits, s.homeRot, 1 << Layers.Character, QueryTriggerInteraction.Ignore);
            for (int k = 0; k < n; k++)
            {
                var ai = hits[k] ? hits[k].GetComponentInParent<EnemyAI>() : null;
                if (ai && !ai.Dead) ai.LaunchUp(2.5f);
            }
        }

        static float GroundBelow(Vector3 p) =>
            Physics.Raycast(p + Vector3.down * 0.5f, Vector3.down, out var h, 200f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : p.y - 200f;

        /// <summary>全部复原（测试 / 剧情）：桥板回原位、碰撞体打开、挖洞关掉、血回满</summary>
        public void Rebuild()
        {
            foreach (var s in segs)
            {
                s.state = SegState.Intact;
                s.timer = s.standTime = s.vy = 0;
                s.t.gameObject.SetActive(true);
                s.t.SetPositionAndRotation(s.home, s.homeRot);
                foreach (var c in s.colliders)
                    if (c)
                        c.enabled = true;
                if (s.carve) s.carve.enabled = false;
            }
            Physics.SyncTransforms();
            FallenCount = 0;
            if (Health) Health.ResetVitals();
        }

        /// <summary>
        /// 一段桥板的导航挖洞（平时关着，塌了才开）：放在桥板原位（顶面中心 at、朝向 rot），挂在桥的根节点下（不跟着桥板掉）；
        /// 盒子只罩住桥板上下各 0.6 m——挖掉桥面那一层网格，不碰下面的地面
        /// </summary>
        static NavMeshObstacle AddCarve(Transform root, string name, Vector3 at, Quaternion rot, Vector2 size, float thickness)
        {
            var go = new GameObject(name);
            go.transform.SetParent(root, false);
            go.transform.SetPositionAndRotation(at, rot);
            var ob = go.AddComponent<NavMeshObstacle>();
            ob.shape = NavMeshObstacleShape.Box;
            ob.center = new Vector3(0, -thickness * 0.5f, 0);
            // 沿桥长方向多盖 0.1 m：相邻两段的洞连成一片，不留一条窄缝
            ob.size = new Vector3(size.x + 0.4f, thickness + 1.2f, size.y + 0.1f);
            ob.carving = true;
            ob.carveOnlyStationary = false;
            ob.enabled = false;
            return ob;
        }
    }
}
