using System;
using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔流闸（S4，docs/level-design/ch3-v2.md 2.7 / 7.2；第三章「熔岩是玩家能用的武器」）：一股熔流沿关卡预设的折线（浇铸槽、闸渠）冲过去，
    /// 烧死槽里和槽岸上的地面敌人；玩家自己站在里面照 L7 下沉托回、扣血。
    ///   · 触发：<see cref="Trigger.Hook"/> 射断吊钩（<see cref="hook"/> 是一件 <see cref="Destructible"/>，碎了就放）——浇包倾倒，只有一次；
    ///          <see cref="Trigger.Lever"/> 按 F 拉闸——有冷却（<see cref="cooldown"/>）、次数（<see cref="uses"/>）；<see cref="Trigger.Both"/> 两样都行。
    ///   · 预警 <see cref="warn"/> 秒：整条熔流道铺一遍危险色长条（火狱里是品红），浇包开始倾倒，咕嘟声；
    ///   · 熔流：浇口起按 <see cref="frontSpeed"/> 往下游推进，熔流头到哪一段，那一段就用 L7 的 <see cref="LavaVolume.RiseTo"/> 从槽底下涨到槽岸以上
    ///     <see cref="floodRise"/>（不预警，涨的那一帧把这段里的地面敌人烧掉——导航挖洞会把站在里面的敌人挤到岸上，所以不能先挖再烧）；
    ///     之后整 <see cref="duration"/> 秒里走进 / 被打进这几段的地面敌人照样烧掉（首领、飞行、熔岩生物不受，同 <see cref="LavaField.IsImmune"/>）；
    ///   · 退：<see cref="Recede"/> 秒退回槽底下，熔岩段停用（不留判定、不留绘制）；还有次数就冷却，否则 <see cref="State.Spent"/>。
    /// 熔岩段在第一次放的时候运行时建（<see cref="LavaVolume.Create"/>，材质用 <see cref="lavaMaterial"/>）：平时场景里没有这几片熔岩，也就没有 Lava 区、不挖导航、不画。
    /// 关卡构建器用 LevelKit.PlaceLavaSluice 摆（P/Editor/Levels/LevelKit.LavaSluice.cs）；3-3 ③ 浇包吊坊两口浇包、3-4 ② 闸口的拉闸。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LavaSluice : MonoBehaviour, IInteractable
    {
        public enum Trigger { Hook, Lever, Both }
        public enum State { Ready, Warning, Flowing, Receding, Cooldown, Spent }

        [Header("触发")]
        public Trigger trigger = Trigger.Hook;
        [Tooltip("吊钩（射断就放；Hook / Both）")] public Destructible hook;
        [Tooltip("拉杆转轴（按 F 拉闸，绕本地 X 从 −35° 拉到 +55°；空 = 运行时在本物体上拼一根）")] public Transform lever;
        public string title = "熔流闸";

        [Header("熔流道")]
        [Tooltip("熔流沿的折线（世界坐标，y = 槽岸地面）：第一个点是浇口")] public Vector3[] path = Array.Empty<Vector3>();
        [Tooltip("熔岩宽（米）：槽 + 两侧槽岸")] public float width = 8f;
        [Tooltip("涨到槽岸地面以上多少（米）：要高过站立判定，岸上的敌人才在熔岩里")] public float floodRise = 0.45f;
        [Tooltip("从槽岸地面以下多深开始涨（米，藏在槽底下）")] public float restDrop = 1.4f;
        [Tooltip("熔岩分段长度（米）")] public float segmentLength = 6f;
        [Tooltip("熔流头推进速度（米 / 秒）")] public float frontSpeed = 16f;
        [Tooltip("预警 / 熔流持续 / 每段涨上来 / 退下去的秒数")] public float warn = 1f, duration = 6f, riseTime = 0.35f, fallTime = 1.6f;
        [Tooltip("两次之间的冷却（秒）")] public float cooldown = 18f;
        [Tooltip("最多放几次（吊钩只有一次）")] public int uses = 1;
        [Tooltip("熔岩面材质（空 = 借场上已有熔岩的）")] public Material lavaMaterial;

        [Header("浇包")]
        [Tooltip("浇包的转轴（倾倒时绕本地 tiltAxis 转 tiltAngle 度）")] public Transform ladle;
        public Vector3 tiltAxis = Vector3.right;
        public float tiltAngle = 100f, tiltSeconds = 0.8f;
        [Tooltip("倾倒时的熔流柱（浇包口 → 浇口），平时关着")] public GameObject pour;

        public static readonly Color Tint = new(1f, 0.5f, 0.12f);

        public State Phase { get; private set; } = State.Ready;
        /// <summary>放过几次</summary>
        public int Fired { get; private set; }
        /// <summary>熔流烧死的敌人（本组件自己烧的，不含 LavaField 烧的击退落岩）</summary>
        public int Kills { get; private set; }
        /// <summary>上一次熔流头出发的时刻（没放过为 −1）</summary>
        public float FlowStartedAt { get; private set; } = -1;
        /// <summary>冷却还剩几秒</summary>
        public float CooldownLeft => Phase == State.Cooldown ? Mathf.Max(0, readyAt - Time.time) : 0;
        public int UsesLeft => Mathf.Max(0, MaxUses - Fired);
        int MaxUses => trigger == Trigger.Hook ? 1 : Mathf.Max(1, uses);
        /// <summary>熔流道总长（米）</summary>
        public float Length { get; private set; }
        /// <summary>熔岩段（第一次放之前为空）</summary>
        public IReadOnlyList<LavaVolume> Volumes => volumes;

        /// <summary>开始放（预警开始时）/ 烧死一只敌人 / 熔流退完</summary>
        public event Action<LavaSluice> Released, Finished;
        public event Action<LavaSluice, EnemyAI> Burned;

        static readonly List<LavaSluice> all = new();
        public static IReadOnlyList<LavaSluice> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        struct Segment
        {
            public Vector3 center;
            public Quaternion rot;
            public float length, start, ground;
        }

        readonly List<Segment> segments = new();
        readonly List<LavaVolume> volumes = new();
        readonly List<bool> started = new();
        readonly List<EnemyAI> scratch = new();
        float phaseAt, readyAt, leverAngle = -35f, tilt, emberAcc;
        Quaternion ladleRest;
        bool hookBound;

        void Awake()
        {
            BuildSegments();
            if (ladle) ladleRest = ladle.localRotation;
            if (pour) pour.SetActive(false);
        }

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
            if (trigger != Trigger.Hook) Interaction.Add(this);
            BindHook(true);
        }

        void OnDisable()
        {
            all.Remove(this);
            Interaction.Remove(this);
            BindHook(false);
        }

        void Start()
        {
            if (trigger != Trigger.Hook) BuildLeverIfMissing();
            if (trigger != Trigger.Lever && !hook) Debug.LogWarning($"[LavaSluice] {name}：触发方式 {trigger} 但没有吊钩");
        }

        void BindHook(bool on)
        {
            if (!hook || trigger == Trigger.Lever || hookBound == on) return;
            hookBound = on;
            if (on) hook.Broken += OnHookBroken;
            else hook.Broken -= OnHookBroken;
        }

        void OnHookBroken(Destructible d, DamageInfo info)
        {
            if (!Release()) return;
            GameUI.Toast($"{title} · 吊钩断了，浇包倾倒！", Tint);
        }

        /// <summary>沿折线切段（每段 ≤ segmentLength，段与段首尾相接；拐角处各往外多盖半个宽度，免得拐角漏一块）</summary>
        void BuildSegments()
        {
            segments.Clear();
            Length = 0;
            if (path == null || path.Length < 2) return;
            float acc = 0;
            for (int i = 0; i + 1 < path.Length; i++)
            {
                var a = path[i];
                var b = path[i + 1];
                var flat = new Vector3(b.x - a.x, 0, b.z - a.z);
                float len = flat.magnitude;
                if (len < 0.05f) continue;
                var dir = flat / len;
                int n = Mathf.Max(1, Mathf.CeilToInt(len / Mathf.Max(1f, segmentLength)));
                for (int k = 0; k < n; k++)
                {
                    float s0 = len * k / n, s1 = len * (k + 1) / n;
                    float pad0 = k == 0 && i > 0 ? width * 0.35f : 0, pad1 = k == n - 1 && i + 2 < path.Length ? width * 0.35f : 0;
                    var p0 = a + dir * (s0 - pad0);
                    var p1 = a + dir * (s1 + pad1);
                    var mid = (p0 + p1) * 0.5f;
                    float ground = Mathf.Lerp(a.y, b.y, (s0 + s1) * 0.5f / len);
                    segments.Add(new Segment
                    {
                        center = new Vector3(mid.x, ground, mid.z), rot = Quaternion.LookRotation(dir, Vector3.up),
                        length = (s1 + pad1) - (s0 - pad0), start = acc + s0, ground = ground,
                    });
                }
                acc += len;
            }
            Length = acc;
        }

        // ───────────── 放 ─────────────

        /// <summary>现在能不能放（就绪、还有次数）</summary>
        public bool CanRelease => Phase == State.Ready && Fired < MaxUses && segments.Count > 0;

        /// <summary>放熔流（吊钩断了、拉闸、测试、调试）。force = 不管冷却 / 次数（测试用）</summary>
        public bool Release(bool force = false)
        {
            if (segments.Count == 0) BuildSegments();
            if (segments.Count == 0) return false;
            if (!force && !CanRelease) return false;
            if (Phase is State.Warning or State.Flowing) return false;
            Fired++;
            Phase = State.Warning;
            phaseAt = Time.time;
            for (int i = 0; i < started.Count; i++) started[i] = false;
            // 预警：整条熔流道铺危险色长条（熔流头走完全程的时间也算进去）
            float total = warn + Length / Mathf.Max(1f, frontSpeed);
            var color = TelegraphPalette.Danger;
            for (int i = 0; i + 1 < path.Length; i++)
                Telegraph.Lane(path[i] + Vector3.up * 0.05f, path[i + 1] + Vector3.up * 0.05f, width, Mathf.Max(0.2f, total), color);
            GameAudio.PlayAt("telegraph", path[0], 0.8f, 0.7f);
            GameAudio.PlayAt("burn_tick", path[0], 0.9f, 0.5f);
            Raise(Released);
            return true;
        }

        void Update()
        {
            float now = Time.time;
            StepLever();
            StepLadle();
            switch (Phase)
            {
                case State.Warning:
                    if (now - phaseAt >= warn) BeginFlow(now);
                    break;
                case State.Flowing:
                    StepFlow(now);
                    if (now - phaseAt >= duration) BeginRecede(now);
                    break;
                case State.Receding:
                    if (now - phaseAt >= fallTime + 0.1f) EndFlow(now);
                    break;
                case State.Cooldown:
                    if (now >= readyAt) Phase = State.Ready;
                    break;
            }
        }

        void BeginFlow(float now)
        {
            Phase = State.Flowing;
            phaseAt = now;
            FlowStartedAt = now;
            if (pour) pour.SetActive(true);
            CameraShake.Quake(path[0], 0.25f, 40f, 0.5f);
            GameAudio.PlayAt("skill_fire", path[0], 1f, 0.55f);
            Fx.Burst(path[0] + Vector3.up * 0.8f, Tint, 26, 7f, 0.8f, 0.18f, -3f);
        }

        void StepFlow(float now)
        {
            float front = (now - phaseAt) * Mathf.Max(1f, frontSpeed);
            for (int i = 0; i < segments.Count; i++)
            {
                if (Started(i) || segments[i].start > front) continue;
                StartSegment(i);
            }
            // 熔流里的地面敌人：涨到的段一律烧（被打进来 / 走进来的也算）
            ScorchAll(false);
            emberAcc += Time.deltaTime;
            if (emberAcc >= 0.25f && front < Length + width)
            {
                emberAcc = 0;
                var head = PointAt(Mathf.Min(front, Length));
                Fx.Burst(head + Vector3.up * 0.4f, Tint, 10, 5f, 0.6f, 0.15f, -3f);
            }
        }

        bool Started(int i) => i < started.Count && started[i];

        void StartSegment(int i)
        {
            while (started.Count <= i) started.Add(false);
            started[i] = true;
            var s = segments[i];
            var v = VolumeFor(i);
            v.gameObject.SetActive(true);
            v.RiseTo(s.ground + floodRise, Mathf.Max(0.05f, riseTime), 0);
            ScorchSegment(i, true);
            Fx.Burst(s.center + Vector3.up * 0.3f, Tint, 8, 4f, 0.5f, 0.14f, -2f);
        }

        LavaVolume VolumeFor(int i)
        {
            while (volumes.Count <= i) volumes.Add(null);
            if (volumes[i]) return volumes[i];
            var s = segments[i];
            var v = LavaVolume.Create($"{name} · 熔流 {i + 1}", s.center + Vector3.down * restDrop, LavaShape.Box, new Vector2(width, s.length),
                s.rot.eulerAngles.y, restDrop + 1f, true, lavaMaterial, transform);
            // 熔流顺槽往下游流
            v.flow = new Vector2(0, 1.4f);
            if (v.surface && v.surface.TryGetComponent<MeshFilter>(out var mf)) mf.sharedMesh = LavaVolume.BuildMesh(LavaShape.Box, v.size, true, v.flow);
            volumes[i] = v;
            return v;
        }

        void BeginRecede(float now)
        {
            Phase = State.Receding;
            phaseAt = now;
            foreach (var v in volumes)
                if (v && v.gameObject.activeSelf)
                    v.Recede(fallTime);
            if (pour) pour.SetActive(false);
        }

        void EndFlow(float now)
        {
            foreach (var v in volumes)
                if (v)
                    v.gameObject.SetActive(false);
            for (int i = 0; i < started.Count; i++) started[i] = false;
            if (Fired < MaxUses)
            {
                Phase = State.Cooldown;
                readyAt = now + Mathf.Max(0, cooldown);
            }
            else Phase = State.Spent;
            Raise(Finished);
        }

        // ───────────── 烧 ─────────────

        void ScorchAll(bool fresh)
        {
            for (int i = 0; i < segments.Count; i++)
                if (Started(i))
                    ScorchSegment(i, fresh);
        }

        /// <summary>
        /// 烧这一段里的地面敌人：刚涨（fresh）时整段一律烧；之后要熔岩面已经涨到槽岸以上才烧（还在涨的段只烧脚底低于熔岩面的）
        /// </summary>
        void ScorchSegment(int i, bool fresh)
        {
            var s = segments[i];
            var v = i < volumes.Count ? volumes[i] : null;
            float level = v ? v.Level : s.ground + floodRise;
            if (!fresh && level < s.ground - 0.2f) return;
            scratch.Clear();
            var live = EnemyRegistry.Live;
            for (int k = 0; k < live.Count; k++) scratch.Add(live[k]);
            var inv = Quaternion.Inverse(s.rot);
            float hx = width * 0.5f + 0.4f, hz = s.length * 0.5f + 0.2f;
            float top = (fresh ? s.ground + floodRise : level) + LavaTuning.StandRise + 0.3f;
            foreach (var ai in scratch)
            {
                if (!ai || ai.Dead || LavaField.IsImmune(ai)) continue;
                var feet = ai.transform.position;
                if (feet.y > top || feet.y < s.ground - restDrop - 1f) continue;
                var local = inv * (feet - s.center);
                if (Mathf.Abs(local.x) > hx || Mathf.Abs(local.z) > hz) continue;
                Scorch(ai);
            }
        }

        /// <summary>烧死（同 LavaField 的熔岩烧死：一击处决级的环境伤害，计击杀、正常掉落；火免疫的换无属性再来一次）</summary>
        void Scorch(EnemyAI ai)
        {
            var d = ai.Health;
            if (!d || d.Dead) return;
            LavaField.NoteKnocked(ai);
            var pos = ai.transform.position;
            var at = pos + Vector3.up * 0.3f;
            Fx.Burst(at, LavaField.Orange, 30, 6, 1f, 0.13f, -3);
            Fx.Burst(at, LavaField.Gold, 14, 4, 0.7f, 0.08f, -5);
            GameAudio.PlayAt("skill_fire", at, 0.9f, 0.65f);
            var info = DamageInfo.Simple(DamageCalc.ExecuteBase + Mathf.Max(0, d.health + d.armor + d.shield) * 4, DamageSource.Environment, at, Vector3.up);
            info.element = Element.Fire;
            info.noCrit = true;
            info.depth = 2;
            info.statusChance = 0;
            info.instigator = this;
            Combat.DamageEnemy(d, info);
            if (!d.Dead)
            {
                info.element = Element.None;
                Combat.DamageEnemy(d, info);
            }
            if (!d.Dead) d.Kill(info);
            Kills++;
            if (Burned == null) return;
            try
            {
                Burned(this, ai);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        // ───────────── 查询 ─────────────

        /// <summary>熔流道上沿程 s 米处的点（世界，y = 槽岸地面）</summary>
        public Vector3 PointAt(float s)
        {
            if (path == null || path.Length == 0) return transform.position;
            float acc = 0;
            for (int i = 0; i + 1 < path.Length; i++)
            {
                float len = Vector3.Distance(Flat(path[i]), Flat(path[i + 1]));
                if (acc + len >= s || i + 2 == path.Length) return Vector3.Lerp(path[i], path[i + 1], len > 0 ? Mathf.Clamp01((s - acc) / len) : 0);
                acc += len;
            }
            return path[^1];
        }

        /// <summary>这个脚底位置在不在熔流道的范围里（不管有没有在放；测试 / AI 用）</summary>
        public bool Covers(Vector3 feet, float margin = 0)
        {
            if (segments.Count == 0) BuildSegments();
            foreach (var s in segments)
            {
                if (feet.y > s.ground + floodRise + 2f || feet.y < s.ground - restDrop - 1f) continue;
                var local = Quaternion.Inverse(s.rot) * (feet - s.center);
                if (Mathf.Abs(local.x) <= width * 0.5f + margin && Mathf.Abs(local.z) <= s.length * 0.5f + margin) return true;
            }
            return false;
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);

        /// <summary>测试：熔岩收掉、浇包摆正、次数清零（吊钩碎了不复原）</summary>
        public void ResetForTests()
        {
            foreach (var v in volumes)
                if (v)
                    v.gameObject.SetActive(false);
            for (int i = 0; i < started.Count; i++) started[i] = false;
            if (pour) pour.SetActive(false);
            Phase = State.Ready;
            Fired = 0;
            Kills = 0;
            FlowStartedAt = -1;
            tilt = 0;
            if (ladle) ladle.localRotation = ladleRest;
        }

        // ───────────── 浇包 / 拉杆 ─────────────

        void StepLadle()
        {
            if (!ladle) return;
            // 倾倒：预警起转到 tiltAngle，熔流退完后（还有次数时）转回来；只有一次的就一直倒着
            bool tipped = Phase is State.Warning or State.Flowing or State.Receding || Phase == State.Spent && Fired > 0;
            float want = tipped ? tiltAngle : 0;
            if (Mathf.Approximately(tilt, want)) return;
            tilt = Mathf.MoveTowards(tilt, want, Time.deltaTime * Mathf.Abs(tiltAngle) / Mathf.Max(0.1f, tipped ? tiltSeconds : tiltSeconds * 2f));
            float k = Mathf.Abs(tiltAngle) > 0.01f ? tilt / tiltAngle : 0;
            float eased = k * k * (3 - 2 * k);
            ladle.localRotation = ladleRest * Quaternion.AngleAxis(tiltAngle * eased, tiltAxis);
        }

        void StepLever()
        {
            if (!lever || trigger == Trigger.Hook) return;
            bool down = Phase is State.Warning or State.Flowing or State.Receding or State.Spent;
            leverAngle = Mathf.MoveTowards(leverAngle, down ? 55f : -35f, Time.deltaTime * 180f);
            lever.localRotation = Quaternion.Euler(leverAngle, 0, 0);
        }

        void BuildLeverIfMissing()
        {
            if (!lever)
            {
                lever = new GameObject("Lever Pivot").transform;
                lever.SetParent(transform, false);
                lever.localPosition = new Vector3(0, 1.3f, 0.7f);
            }
            if (lever.childCount > 0) return;
            PropBits.Cylinder(lever, "Lever Bar", new Vector3(0, 0.9f, 0), new Vector3(0.14f, 1.8f, 0.14f), new Color(0.16f, 0.14f, 0.13f));
            PropBits.Box(lever, "Lever Grip", new Vector3(0, 1.85f, 0), new Vector3(0.6f, 0.22f, 0.22f), Tint);
            lever.localRotation = Quaternion.Euler(leverAngle, 0, 0);
        }

        // ───────────── 交互（拉闸）─────────────

        public Vector3 Focus => (lever ? lever.position : transform.position) + Vector3.up * 0.2f;
        public float Radius => 3.2f;
        public bool CanInteract => trigger != Trigger.Hook && Phase != State.Spent;

        public string Prompt => Phase switch
        {
            State.Ready => $"拉开{title}",
            State.Cooldown => $"{title}冷却中 · {CooldownLeft:F0} s",
            State.Spent => $"{title}已经放空",
            _ => $"{title}正在放熔流",
        };

        public InteractPrompt PromptCard => new()
        {
            title = title,
            subtitle = Phase == State.Ready ? $"拉闸（还能放 {UsesLeft} 次）" : Prompt,
            lines = new[] { "熔流顺槽冲下去 6 秒：槽里和槽岸上的地面敌人一律烧死", "站在槽里的自己也会被烫——拉完离开熔流道" },
            color = Tint,
        };

        public void Interact()
        {
            if (Phase == State.Cooldown || Phase == State.Spent || !Release()) return;
            GameAudio.PlayAt("boss_slam", Focus, 0.6f, 0.7f);
        }

        void Raise(Action<LavaSluice> ev)
        {
            if (ev == null) return;
            try
            {
                ev(this);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }

        void OnDrawGizmos()
        {
            if (path == null) return;
            Gizmos.color = Tint;
            for (int i = 0; i + 1 < path.Length; i++) Gizmos.DrawLine(path[i] + Vector3.up * 0.3f, path[i + 1] + Vector3.up * 0.3f);
        }
    }
}
