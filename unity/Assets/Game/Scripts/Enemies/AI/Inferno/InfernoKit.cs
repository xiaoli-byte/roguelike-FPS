using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using Random = UnityEngine.Random;

namespace Spiritfire.Game
{
    /// <summary>
    /// 熔岩查询（第三章敌人用到的最小接口；熔岩系统 L7 实现它并在启用时赋给 <see cref="InfernoKit.Lava"/>，停用时清回 null）：
    ///   炭童：死在熔岩上不留余烬炭堆；祸斗：没别的火时去熔岩边吃火；火鼍：在熔岩里潜游、找岸、扑上岸、甩尾把人扫向熔岩；
    ///   马面：拖拽路线上有熔岩就停在岸边 1.2 m。
    /// 没有熔岩的关卡用 <see cref="NoLava"/>（全部返回「没有」：火鼍当陆上坦克打、祸斗只吃地火）。
    /// 坐标都是世界坐标，只看水平位置（xz）；熔岩面高度用 <see cref="SurfaceY"/> 取。
    /// </summary>
    public interface ILavaQuery
    {
        /// <summary>p 的水平位置在熔岩上</summary>
        bool IsLava(Vector3 p);
        /// <summary>p 处熔岩面的高度（不是熔岩时返回 NaN）</summary>
        float SurfaceY(Vector3 p);
        /// <summary>水平半径 radius 内离 from 最近的熔岩点（y = 熔岩面高度）；没有返回 false</summary>
        bool NearestLava(Vector3 from, float radius, out Vector3 lava);
        /// <summary>从熔岩点 from 朝 toward 水平前进，maxDist 内第一个不是熔岩的点（岸边，y 取 from.y）；找不到返回 false（同 TS bankPoint）</summary>
        bool ShoreToward(Vector3 from, Vector3 toward, float maxDist, out Vector3 bank);
    }

    /// <summary>
    /// 熔岩生物（火鼍）：熔岩系统不烧它、不把它托回岸上、不按「掉进熔岩」处决——它自己在熔岩里游。
    /// L7 的熔岩伤害 / 托回在处理敌人前先判断 <c>ai is ILavaDweller d &amp;&amp; d.SwimsInLava</c>。
    /// </summary>
    public interface ILavaDweller
    {
        bool SwimsInLava { get; }
    }

    /// <summary>没有熔岩（兜底）：什么都不是熔岩</summary>
    public sealed class NoLava : ILavaQuery
    {
        public static readonly NoLava Instance = new();

        public bool IsLava(Vector3 p) => false;
        public float SurfaceY(Vector3 p) => float.NaN;

        public bool NearestLava(Vector3 from, float radius, out Vector3 lava)
        {
            lava = from;
            return false;
        }

        public bool ShoreToward(Vector3 from, Vector3 toward, float maxDist, out Vector3 bank)
        {
            bank = from;
            return false;
        }
    }

    /// <summary>
    /// 网格熔岩掩码（同 Three.js WhiteboxLava：minX / minZ 起、每格 cell 米、cols × rows 格，熔岩面统一高度）：
    /// EditMode 测试直接用；熔岩系统也可以把烘焙好的掩码装进它再赋给 <see cref="InfernoKit.Lava"/>。
    /// </summary>
    public sealed class LavaGrid : ILavaQuery
    {
        public readonly float minX, minZ, cell, surfaceY;
        public readonly int cols, rows;
        readonly bool[] mask;

        public LavaGrid(float minX, float minZ, float cell, int cols, int rows, float surfaceY = 0)
        {
            this.minX = minX;
            this.minZ = minZ;
            this.cell = Mathf.Max(0.05f, cell);
            this.cols = Mathf.Max(1, cols);
            this.rows = Mathf.Max(1, rows);
            this.surfaceY = surfaceY;
            mask = new bool[this.cols * this.rows];
        }

        /// <summary>把世界矩形 [x0, x1] × [z0, z1] 里（格中心落在里面的）格子设成熔岩 / 非熔岩</summary>
        public LavaGrid Fill(float x0, float z0, float x1, float z1, bool lava = true)
        {
            for (int iz = 0; iz < rows; iz++)
                for (int ix = 0; ix < cols; ix++)
                {
                    float cx = minX + (ix + 0.5f) * cell, cz = minZ + (iz + 0.5f) * cell;
                    if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) mask[iz * cols + ix] = lava;
                }
            return this;
        }

        bool Cell(float x, float z, out int index)
        {
            int ix = Mathf.FloorToInt((x - minX) / cell), iz = Mathf.FloorToInt((z - minZ) / cell);
            index = iz * cols + ix;
            return ix >= 0 && iz >= 0 && ix < cols && iz < rows;
        }

        public bool IsLava(Vector3 p) => float.IsFinite(p.x) && float.IsFinite(p.z) && Cell(p.x, p.z, out int i) && mask[i];

        public float SurfaceY(Vector3 p) => IsLava(p) ? surfaceY : float.NaN;

        public bool NearestLava(Vector3 from, float radius, out Vector3 lava)
        {
            lava = from;
            if (!(radius > 0) || !float.IsFinite(from.x) || !float.IsFinite(from.z)) return false;
            int x0 = Mathf.Max(0, Mathf.FloorToInt((from.x - radius - minX) / cell)), x1 = Mathf.Min(cols - 1, Mathf.FloorToInt((from.x + radius - minX) / cell));
            int z0 = Mathf.Max(0, Mathf.FloorToInt((from.z - radius - minZ) / cell)), z1 = Mathf.Min(rows - 1, Mathf.FloorToInt((from.z + radius - minZ) / cell));
            float best = radius * radius;
            bool found = false;
            for (int iz = z0; iz <= z1; iz++)
                for (int ix = x0; ix <= x1; ix++)
                {
                    if (!mask[iz * cols + ix]) continue;
                    float cx = minX + (ix + 0.5f) * cell, cz = minZ + (iz + 0.5f) * cell;
                    float d = (cx - from.x) * (cx - from.x) + (cz - from.z) * (cz - from.z);
                    if (d >= best) continue;
                    best = d;
                    lava = new Vector3(cx, surfaceY, cz);
                    found = true;
                }
            return found;
        }

        public bool ShoreToward(Vector3 from, Vector3 toward, float maxDist, out Vector3 bank) =>
            InfernoKit.MarchToShore(this, from, toward, maxDist, cell / 3f, out bank);
    }

    /// <summary>
    /// 第三章敌人（EN3a–c：炭童、祸斗、熔炉铁牛、火鼍、毕方、马面狱卒）的公共件：
    ///   熔岩查询入口 <see cref="Lava"/>（熔岩系统接上之前是 <see cref="NoLava"/>）与基于它的线段 / 熔岩边 / 岸边查询；
    ///   美术网格坐标 → 世界坐标（Three.js 各敌人按网格实测的 MOUTH / LOCK / EMBER… 点：TS 的 +X 是生物左侧，Unity 是 -X）与骨骼锚点；
    ///   火狱配色；玩家胶囊、线段与线段的最近距离、角度工具。
    /// </summary>
    public static class InfernoKit
    {
        static ILavaQuery lava;
        /// <summary>没有显式设 <see cref="Lava"/> 时的来源（L7：<see cref="LavaFieldQuery"/>，场景里有熔岩体才返回非空）</summary>
        public static System.Func<ILavaQuery> LavaProvider;

        /// <summary>当前关卡的熔岩（熔岩系统启用时赋值、停用时赋 null；永远不为 null）</summary>
        public static ILavaQuery Lava
        {
            get => lava ?? LavaProvider?.Invoke() ?? NoLava.Instance;
            set => lava = value;
        }

        /// <summary>接上了真正的熔岩（不是兜底）</summary>
        public static bool HasLava => !(Lava is NoLava);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => lava = null;

        // ───────────── 火狱配色（同 TS fx/InfernoPackFx、InfernoTankFx、InfernoRangedFx 的 INFERNO） ─────────────

        public static readonly Color Coal = Hex.Rgb(0x2a211e), CoalHi = Hex.Rgb(0x4a3a32), Crack = Hex.Rgb(0xff5a14), CrackHot = Hex.Rgb(0xffd27a);
        public static readonly Color Ember = Hex.Rgb(0xff7a2a), Spark = Hex.Rgb(0xffb040), Smoke = Hex.Rgb(0x3a302c), Ash = Hex.Rgb(0x6a5c54);
        /// <summary>群怪的地面预警（饱和朱红）</summary>
        public static readonly Color Warn = Hex.Rgb(0xff2a12);
        /// <summary>坦克的地面预警（电光品红：熔岩、玄武岩上都读得出来）</summary>
        public static readonly Color WarnTank = Hex.Rgb(0xff2bd6);
        public static readonly Color LavaColor = Hex.Rgb(0xff6a1a), Hot = Hex.Rgb(0xffe08a), White = Hex.Rgb(0xfff4d8);
        public static readonly Color Basalt = Hex.Rgb(0x2a2220), Iron = Hex.Rgb(0x35302c), Slag = Hex.Rgb(0x3a2a22);
        /// <summary>远程组的预警 / 毕方瞄准细线（浅金白：玄武岩与熔岩上都读得出来）/ 锁定后（白热）</summary>
        public static readonly Color AimGold = Hex.Rgb(0xffe9a0), AimHot = Hex.Rgb(0xfff8e8);
        /// <summary>马面的铁链：冷铁 / 烧红</summary>
        public static readonly Color ChainIron = Hex.Rgb(0x34302e), ChainHot = Hex.Rgb(0xff5a14);

        // ───────────── 熔岩 ─────────────

        /// <summary>线段 a → b（水平）全程在熔岩上（每 step 米采样一次，含两端）</summary>
        public static bool AllLava(Vector3 a, Vector3 b, float step = 0.25f) => AllLava(Lava, a, b, step);

        public static bool AllLava(ILavaQuery q, Vector3 a, Vector3 b, float step = 0.25f)
        {
            if (q == null) return false;
            var d = b - a;
            d.y = 0;
            int n = Mathf.Max(1, Mathf.CeilToInt(d.magnitude / Mathf.Max(0.05f, step)));
            for (int k = 0; k <= n; k++)
                if (!q.IsLava(a + d * ((float)k / n)))
                    return false;
            return true;
        }

        /// <summary>线段 a → b（水平，终点再往前延 margin）有一处碰到熔岩（同 TS nav.crossesLava）；两侧也各探 margin</summary>
        public static bool CrossesLava(Vector3 a, Vector3 b, float margin = 0.3f) => CrossesLava(Lava, a, b, margin);

        public static bool CrossesLava(ILavaQuery q, Vector3 a, Vector3 b, float margin = 0.3f)
        {
            if (q == null || q is NoLava) return false;
            var d = b - a;
            d.y = 0;
            float len = d.magnitude;
            if (len < 1e-4f) return q.IsLava(a);
            var dir = d / len;
            var side = new Vector3(-dir.z, 0, dir.x) * Mathf.Max(0, margin);
            float total = len + Mathf.Max(0, margin);
            int n = Mathf.Max(1, Mathf.CeilToInt(total / 0.2f));
            for (int k = 0; k <= n; k++)
            {
                var p = a + dir * (total * k / n);
                if (q.IsLava(p) || (margin > 0 && (q.IsLava(p + side) || q.IsLava(p - side)))) return true;
            }
            return false;
        }

        /// <summary>从熔岩点 from 朝 toward 每 step 米前进，第一个不是熔岩的点（最远 min(maxDist, 距离 + 2 步)）；LavaGrid / 熔岩系统共用</summary>
        public static bool MarchToShore(ILavaQuery q, Vector3 from, Vector3 toward, float maxDist, float step, out Vector3 bank)
        {
            bank = from;
            var d = toward - from;
            d.y = 0;
            float len = d.magnitude;
            if (q == null || len < 1e-3f) return false;
            d /= len;
            step = Mathf.Max(0.05f, step);
            int n = Mathf.CeilToInt(Mathf.Min(maxDist, len + step * 2) / step);
            for (int k = 1; k <= n; k++)
            {
                var p = from + d * (step * k);
                if (q.IsLava(p)) continue;
                bank = new Vector3(p.x, from.y, p.z);
                return true;
            }
            return false;
        }

        /// <summary>
        /// 熔岩边当作「地上的火」（祸斗吃火）：先问 <see cref="FireFeed.FindLavaEdge"/>（熔岩系统自己登记了就用它的），
        /// 没有就按 <see cref="Lava"/> 找 maxDist 内最近的熔岩点。吃不完、不占用。没有熔岩返回 null
        /// </summary>
        public static IFireSource LavaEdge(Vector3 from, float maxDist)
        {
            var src = FireFeed.FindLavaEdge(from, maxDist);
            if (src != null) return src;
            return Lava.NearestLava(from, maxDist, out var p) ? new LavaEdgeFire(new Vector3(p.x, from.y, p.z), 0.5f) : null;
        }

        /// <summary>熔岩边的火：吃不完（Consume 什么也不做），不占用</summary>
        public sealed class LavaEdgeFire : IFireSource
        {
            public LavaEdgeFire(Vector3 at, float radius)
            {
                Position = at;
                Radius = radius;
            }

            public FireKind Kind => FireKind.Lava;
            public Vector3 Position { get; }
            public float Radius { get; }
            public bool Edible => true;
            public void Consume() { }

            public object ClaimedBy
            {
                get => null;
                set { }
            }
        }

        // ───────────── 美术网格坐标与骨骼锚点 ─────────────

        /// <summary>
        /// Three.js 网格坐标（模型空间、未缩放：X = 生物左侧、Y = 上、Z = 前）→ 世界坐标：Unity 里生物左侧是 -X，
        /// 根节点的缩放（名册 scale × 精英）一起算进去
        /// </summary>
        public static Vector3 ModelToWorld(Transform root, Vector3 ts) => root.TransformPoint(new Vector3(-ts.x, ts.y, ts.z));

        /// <summary>按名字找骨骼：先找同名，再找包含这个名字的；都没有返回 null</summary>
        public static Transform FindBone(Transform root, string name)
        {
            if (!root || string.IsNullOrEmpty(name)) return null;
            Transform contains = null;
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
            {
                if (t.name == name) return t;
                if (!contains && t.name.Contains(name)) contains = t;
            }
            return contains;
        }

        /// <summary>在骨骼（找不到就是根节点）下建一个锚点，放在网格坐标 ts 对应的位置（静止姿势下调用：Awake 里骨骼还在绑定姿势）</summary>
        public static Transform Anchor(Transform root, string bone, Vector3 ts, string name)
        {
            var parent = FindBone(root, bone) ?? root;
            var a = new GameObject(name).transform;
            a.SetParent(parent, false);
            a.position = ModelToWorld(root, ts);
            a.localRotation = Quaternion.identity;
            return a;
        }

        /// <summary>把敌人的弱点球挪到骨骼上网格坐标 ts 处，半径 radius（设计尺寸，随体型放大）</summary>
        public static void PlaceWeak(EnemyBody body, string bone, Vector3 ts, float radius)
        {
            if (!body) return;
            var root = body.transform;
            var b = FindBone(root, bone) ?? root;
            body.SetWeakPoint(b, b.InverseTransformPoint(ModelToWorld(root, ts)), radius);
        }

        /// <summary>
        /// 在骨骼（或根节点）上网格坐标 ts 处加一个球形命中区（设计半径 radius，随体型放大），返回它。
        /// shootable：放在角色层（子弹打得到，腿、第二个火腹）；否则做成忽略射线层的触发器，只用来按命中点分区（岩甲）
        /// </summary>
        public static HitZone AddSphereZone(EnemyBody body, string bone, Vector3 ts, float radius, string id, bool weak, int priority, bool shootable)
        {
            if (!body) return null;
            var root = body.transform;
            var parent = FindBone(root, bone) ?? root;
            var go = new GameObject("Zone_" + id);
            go.layer = shootable ? Layers.Character : Layers.IgnoreRaycast;
            go.transform.SetParent(parent, false);
            go.transform.position = ModelToWorld(root, ts);
            var sphere = go.AddComponent<SphereCollider>();
            sphere.isTrigger = !shootable;
            sphere.radius = radius * Mathf.Abs(root.lossyScale.x) / Mathf.Max(1e-3f, Mathf.Abs(parent.lossyScale.x));
            var rb = go.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;
            return HitZone.Create(sphere, body.Health, body, id, 1f, weak, priority);
        }

        /// <summary>不带碰撞体的程序化小件（炭块、钩头、炉心）：不受光的纯色材质</summary>
        public static Renderer Primitive(PrimitiveType type, string name, Transform parent, Vector3 localPos, Vector3 localScale, Color color, bool additive = false)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            var c = go.GetComponent<Collider>();
            if (Application.isPlaying) UnityEngine.Object.Destroy(c);
            else UnityEngine.Object.DestroyImmediate(c);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = localScale;
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = additive ? FxMaterials.Additive : FxMaterials.Unlit;
            FxMaterials.Tint(r, color);
            return r;
        }

        // ───────────── 玩家与几何 ─────────────

        /// <summary>玩家胶囊（脚底上方 0.35 → 1.45 m 的线段，半径 0.35；同 EnemyProjectile）</summary>
        public const float PlayerLow = 0.35f, PlayerHigh = 1.45f, PlayerRadius = 0.35f;

        /// <summary>玩家胸口（脚底 + 1.1 m）</summary>
        public static Vector3 PlayerChest(Vector3 feet) => feet + Vector3.up * 1.1f;

        /// <summary>线段 a → b 碰到玩家胶囊（外扩 radius）</summary>
        public static bool SegmentHitsCapsule(Vector3 a, Vector3 b, Vector3 feet, float radius)
        {
            var c0 = feet + Vector3.up * PlayerLow;
            var c1 = feet + Vector3.up * PlayerHigh;
            float r = PlayerRadius + Mathf.Max(0, radius);
            return SegmentSegmentSq(a, b, c0, c1, out _, out _) <= r * r;
        }

        /// <summary>两条线段 p0p1、q0q1 的最近距离平方；s / t 是最近点在各自线段上的参数（0..1）</summary>
        public static float SegmentSegmentSq(Vector3 p0, Vector3 p1, Vector3 q0, Vector3 q1, out float s, out float t)
        {
            var d1 = p1 - p0;
            var d2 = q1 - q0;
            var r = p0 - q0;
            float a = Vector3.Dot(d1, d1), e = Vector3.Dot(d2, d2), f = Vector3.Dot(d2, r);
            if (a <= 1e-8f && e <= 1e-8f)
            {
                s = t = 0;
                return r.sqrMagnitude;
            }
            if (a <= 1e-8f)
            {
                s = 0;
                t = Mathf.Clamp01(f / e);
            }
            else
            {
                float c = Vector3.Dot(d1, r);
                if (e <= 1e-8f)
                {
                    t = 0;
                    s = Mathf.Clamp01(-c / a);
                }
                else
                {
                    float b = Vector3.Dot(d1, d2), denom = a * e - b * b;
                    s = denom > 1e-8f ? Mathf.Clamp01((b * f - c * e) / denom) : 0;
                    t = (b * s + f) / e;
                    if (t < 0)
                    {
                        t = 0;
                        s = Mathf.Clamp01(-c / a);
                    }
                    else if (t > 1)
                    {
                        t = 1;
                        s = Mathf.Clamp01((b - c) / a);
                    }
                }
            }
            return (p0 + d1 * s - (q0 + d2 * t)).sqrMagnitude;
        }

        /// <summary>角度差（弧度）规整到 (-π, π]</summary>
        public static float WrapRad(float a) => Mathf.Atan2(Mathf.Sin(a), Mathf.Cos(a));

        /// <summary>水平方向的朝向角（弧度，0 = +Z、正 = 朝 +X，同 TS Math.atan2(dx, dz)）</summary>
        public static float Yaw(Vector3 dir) => Mathf.Atan2(dir.x, dir.z);

        /// <summary>朝向角（弧度）→ 水平单位向量</summary>
        public static Vector3 YawDir(float yaw) => new(Mathf.Sin(yaw), 0, Mathf.Cos(yaw));

        /// <summary>smoothstep(0, 1, x)</summary>
        public static float Smooth(float x)
        {
            float t = Mathf.Clamp01(x);
            return t * t * (3 - 2 * t);
        }

        /// <summary>xz 处的地面（从 fromY 上方 1.5 m 往下 maxDrop 米打射线）；没有返回 NaN</summary>
        public static float GroundAt(Vector3 xz, float fromY, float maxDrop = 30f) =>
            Physics.Raycast(new Vector3(xz.x, fromY + 1.5f, xz.z), Vector3.down, out var hit, maxDrop + 1.5f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                ? hit.point.y
                : float.NaN;
    }

    /// <summary>
    /// 第三章敌人 AI 的公共基类：在 <see cref="EnemyAI"/> 之上补几样 TS StandardEnemy 有、Unity 基类没有的小工具——
    /// 有这个动画状态才播（缺片段时不刷警告，CreatureRig 照常待机）、看不见玩家累计了多久、对玩家的朝向点积、竖直够不够得着、
    /// 带元素的命中（嘲讽时打在诱饵上无效）、玩家运动器的速度 / 落地 / 冲刺。
    /// </summary>
    public abstract class InfernoEnemyAI : EnemyAI
    {
        protected PlayerMotor motor;
        /// <summary>连续看不到玩家的时长（秒）</summary>
        protected float blindTime;
        readonly Dictionary<string, bool> animStates = new();
        string lastAct;

        protected override void Start()
        {
            base.Start();
            motor = player ? player.GetComponent<PlayerMotor>() : null;
        }

        protected override void Update()
        {
            if (!Dead && player && state != "spawn") blindTime = sees ? 0 : blindTime + Time.deltaTime;
            base.Update();
        }

        /// <summary>Animator 里有这个状态（结果按名字缓存）</summary>
        protected bool HasAnim(string s)
        {
            if (!anim || !anim.runtimeAnimatorController || string.IsNullOrEmpty(s)) return false;
            if (!animStates.TryGetValue(s, out bool has)) animStates[s] = has = anim.HasState(0, Animator.StringToHash(s));
            return has;
        }

        /// <summary>播一个动作状态（没有这个状态就不播）</summary>
        protected void Act(string s, float fade = 0.08f)
        {
            lastAct = s;
            if (HasAnim(s)) Play(s, fade);
        }

        /// <summary>播一个动作状态并拉伸到 seconds 正好播完（没有这个状态就不播）</summary>
        protected void ActTimed(string s, float seconds, float fade = 0.08f)
        {
            lastAct = s;
            if (HasAnim(s)) PlayTimed(s, seconds, fade);
        }

        /// <summary>同一个动作已经请求过就不重播</summary>
        protected void ActOnce(string s, float fade = 0.12f)
        {
            if (lastAct == s) return;
            Act(s, fade);
        }

        /// <summary>
        /// 持续型循环片段（潜游、缴械追击：E5 烘焙时没有自动退出）：Animator 当前不在这个状态（被受击触发器带走了、刚切进来）就切回去
        /// </summary>
        protected void ActLoop(string s, float fade = 0.15f)
        {
            lastAct = s;
            if (!HasAnim(s) || !anim.isActiveAndEnabled || anim.IsInTransition(0)) return;
            if (!anim.GetCurrentAnimatorStateInfo(0).IsName(s)) Play(s, fade);
        }

        /// <summary>回到移动步态</summary>
        protected void Loco(float fade = 0.15f)
        {
            if (lastAct == "Locomotion") return;
            lastAct = "Locomotion";
            PlayLocomotion();
        }

        /// <summary>当前（最近一次请求的）动作状态名（测试 / 冒烟套件用）</summary>
        public string CurrentAct => lastAct;

        /// <summary>有 Animator 控制器（占位体没有）</summary>
        public bool Animated => anim && anim.runtimeAnimatorController;

        /// <summary>Animator 里有这个动作状态（冒烟套件查片段用）</summary>
        public bool HasAnimState(string s) => HasAnim(s);

        /// <summary>网格坐标点（TS localPoint）的世界坐标：随位置、朝向、体型</summary>
        protected Vector3 Local(float x, float y, float z) => InfernoKit.ModelToWorld(transform, new Vector3(x, y, z));

        /// <summary>水平朝向与「指向目标」的点积（TS facingDot）</summary>
        protected float FacingDot
        {
            get
            {
                var to = PlayerPos - transform.position;
                to.y = 0;
                if (to.sqrMagnitude < 1e-4f) return 1;
                var f = transform.forward;
                f.y = 0;
                return Vector3.Dot(f.normalized, to.normalized);
            }
        }

        /// <summary>目标和自己的高差在 h 以内（TS verticalReach）</summary>
        protected bool VerticalReach(float h) => Mathf.Abs(PlayerPos.y - transform.position.y) <= h;

        /// <summary>玩家速度（运动器；被嘲讽时为 0）</summary>
        protected Vector3 PlayerVelocity => !Taunted && motor ? motor.Velocity : Vector3.zero;

        /// <summary>目标胸口</summary>
        protected Vector3 TargetChest => Taunted ? PlayerEye : InfernoKit.PlayerChest(PlayerPos);

        /// <summary>朝向角（弧度）</summary>
        protected float Facing
        {
            get => InfernoKit.Yaw(transform.forward);
            set => transform.rotation = Quaternion.Euler(0, value * Mathf.Rad2Deg, 0);
        }

        /// <summary>朝目标的水平角（弧度）</summary>
        protected float YawToTarget => InfernoKit.Yaw(PlayerPos - transform.position);

        /// <summary>按角速度（弧度/秒）转向某个朝向角</summary>
        protected void TurnTo(float yaw, float rateRad, float dt)
        {
            float cur = Facing;
            float d = InfernoKit.WrapRad(yaw - cur);
            float step = rateRad * dt;
            Facing = cur + Mathf.Clamp(d, -step, step);
        }

        /// <summary>带元素的打玩家（被嘲讽时打在诱饵上无效）；返回是否造成了伤害</summary>
        protected bool HitPlayer(float dmg, Vector3 from, Element element)
        {
            if (Taunted)
            {
                DecoyBlocked(Target);
                return false;
            }
            return Combat.DamagePlayer(dmg, from, element, this) > 0;
        }

        /// <summary>把玩家推开（击退 / 挑飞；被嘲讽时不推）</summary>
        protected void PushPlayer(Vector3 v)
        {
            if (Taunted || !motor || !vitals || vitals.Dead) return;
            motor.AddImpulse(v);
        }

        /// <summary>以自己为中心按距离衰减的震屏</summary>
        protected void Quake(float strength, float range, float duration = 0.3f) => CameraShake.Quake(transform.position, strength, range, duration);

        protected static float Rand(float a, float b) => Random.Range(a, b);

        /// <summary>导航网格上离 p 最近的点（3 m 内；找不到原样返回）</summary>
        protected static Vector3 OnNav(Vector3 p, float within = 3f) => NavMesh.SamplePosition(p, out var hit, within, NavMesh.AllAreas) ? hit.position : p;
    }
}
