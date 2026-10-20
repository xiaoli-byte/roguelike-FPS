using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Game
{
    /// <summary>
    /// 命中区的格挡配置（旋龟冰壳、巨蟹钳墙）：非弱点区的倍率与朝向门、弱点区的倍率。
    /// 正面格挡 = 非弱点区 ×mult、只在正面 cos ≥ facingCos 时生效（<see cref="HitZone.facing"/> = Front）；旋转中的全方位减伤 = Any。
    /// </summary>
    public readonly struct GuardProfile
    {
        public readonly float mult, weakMult, facingCos;
        public readonly ZoneFacing facing;

        public GuardProfile(float mult, ZoneFacing facing, float facingCos = 0.34f, float weakMult = 1f)
        {
            this.mult = mult;
            this.facing = facing;
            this.facingCos = facingCos;
            this.weakMult = weakMult;
        }

        /// <summary>不格挡：全部 ×1、没有朝向门</summary>
        public static GuardProfile Open => new(1f, ZoneFacing.Any);

        public bool Equals(in GuardProfile o) => mult == o.mult && weakMult == o.weakMult && facingCos == o.facingCos && facing == o.facing;

        public override string ToString() => $"×{mult:0.##} {facing} cos {facingCos:0.##}（弱点 ×{weakMult:0.##}）";
    }

    /// <summary>
    /// 第二章冰霜敌人共用的小工具（EN2a–c 起；EN2d / e 的冰霜敌人也可以用）：
    ///   配色（Three.js FrostPackFx / FrostTankFx / FrostSkirmishFx 的 FROST 色板）；
    ///   动作：AC_ 里没有这个状态时退回 Locomotion，并且每种敌人每个状态只警告一次（4.11 占位策略）；
    ///   骨骼：按名字找骨骼、把「模型空间的设计点」换算成骨骼局部偏移（弱点球、出手点挂在骨骼上跟着动画走）；
    ///   贴地小位移：沿导航网格推一步，碰到网格边缘（墙、台沿）返回边缘法线（突刺、旋壳反弹）；
    ///   格挡：把 <see cref="GuardProfile"/> 写到敌人的命中区上（HitZone 朝向门，E2）；
    ///   冰屑 / 霜气 / 冲击环这几样常用特效（走 F1 的 Fx 门面）；延时回调（挂在敌人身体上的协程，AI 组件死后停用也照样跑）。
    /// 冻雾见 <see cref="FrostFog"/>，滑冰带见 <see cref="IceFloor"/>。
    /// </summary>
    public static class FrostKit
    {
        // ───────────── 色板 ─────────────

        public static readonly Color Ice = Hex.Rgb(0x9fe0ff), IceDeep = Hex.Rgb(0x4fa8d8), IceHot = Hex.Rgb(0xe8fbff);
        public static readonly Color Snow = Hex.Rgb(0xeef7ff), Mist = Hex.Rgb(0xcfeaff), Bone = Hex.Rgb(0xe6dcc4);
        public static readonly Color Pearl = Hex.Rgb(0x6ff2ff), PearlHot = Hex.Rgb(0xeaffff);
        public static readonly Color TankIce = Hex.Rgb(0xbfe8ff), Violet = Hex.Rgb(0xb08cff), Cyan = Hex.Rgb(0x7ff6ff), Aqua = Hex.Rgb(0x5fe8e0);
        public static readonly Color Shell = Hex.Rgb(0x4f8a7a), Spike = Hex.Rgb(0xd8f2ff), Band = Hex.Rgb(0x9fe4ff), Fog = Hex.Rgb(0xbfeaff);
        /// <summary>地面预警用的饱和蓝（浅青色画在浅色冰面上几乎看不见；同 TS FROST.warnSolid）</summary>
        public static readonly Color Warn = Hex.Rgb(0x1a8cff);
        /// <summary>坦克组的实色电光蓝预警（TS FrostTankFx.warnSolid）</summary>
        public static readonly Color WarnTank = Hex.Rgb(0x0e86ff);

        // ───────────── 动作 ─────────────

        static readonly HashSet<string> warnedStates = new();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => warnedStates.Clear();

        /// <summary>Animator 第 0 层有这个状态（短名或 Base Layer. 全名）</summary>
        public static bool HasState(Animator anim, string state) =>
            anim && anim.runtimeAnimatorController && !string.IsNullOrEmpty(state)
            && (anim.HasState(0, Animator.StringToHash(state)) || anim.HasState(0, Animator.StringToHash("Base Layer." + state)));

        /// <summary>
        /// 能不能播这个动作状态：没有 Animator（占位体）→ false 且不警告；有 Animator 却缺这个状态 → false，每种敌人每个状态只警告一次。
        /// 调用方拿到 false 时退回 Locomotion（同 4.11「缺片段播 Idle」）
        /// </summary>
        public static bool CanPlay(Animator anim, string state, string enemyId)
        {
            if (!anim || !anim.isActiveAndEnabled || !anim.runtimeAnimatorController) return false;
            if (HasState(anim, state)) return true;
            if (warnedStates.Add(enemyId + "/" + state))
                Debug.LogWarning($"[Enemy] {enemyId} 的 {anim.runtimeAnimatorController.name} 没有动作状态 {state}：退回 Locomotion（招式照常）");
            return false;
        }

        /// <summary>第 0 层正在播（或正过渡到）这个状态：同一个招式不重复从头播</summary>
        public static bool InState(Animator anim, string state)
        {
            if (!anim || !anim.isActiveAndEnabled || !anim.runtimeAnimatorController) return false;
            if (anim.IsInTransition(0)) return anim.GetNextAnimatorStateInfo(0).IsName(state);
            return anim.GetCurrentAnimatorStateInfo(0).IsName(state);
        }

        // ───────────── 骨骼 ─────────────

        /// <summary>按名字精确找子骨骼（找不到返回 null）</summary>
        public static Transform FindBone(Transform root, string name)
        {
            if (!root || string.IsNullOrEmpty(name)) return null;
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t.name == name)
                    return t;
            return null;
        }

        /// <summary>
        /// 模型空间的设计点（Three.js 的 host 局部坐标，未缩放：X 左右对称的点才直接可用，Z = 前，Y = 上）换算成 bone 的局部偏移。
        /// 要在绑定姿势下调用（Awake 里动画还没求值）
        /// </summary>
        public static Vector3 ModelPointOnBone(Transform root, Transform bone, Vector3 modelPoint) =>
            bone ? bone.InverseTransformPoint(root.TransformPoint(modelPoint)) : modelPoint;

        // ───────────── 位移 ─────────────

        /// <summary>
        /// 贴着导航网格推一步 delta（水平）：前方 delta + skin 内碰到网格边缘（墙脚、台沿）就停在边缘前，返回 true 和边缘的水平法线。
        /// 没在导航网格上时什么都不做（返回 false）
        /// </summary>
        public static bool NavStep(NavMeshAgent agent, Vector3 delta, out Vector3 normal, float skin = 0.15f)
        {
            normal = Vector3.zero;
            if (!agent || !agent.enabled || !agent.isOnNavMesh) return false;
            delta.y = 0;
            float len = delta.magnitude;
            if (len < 1e-5f) return false;
            var from = agent.nextPosition;
            var dir = delta / len;
            if (NavMesh.Raycast(from, from + dir * (len + skin), out var hit, agent.areaMask))
            {
                normal = hit.normal;
                normal.y = 0;
                if (normal.sqrMagnitude > 1e-6f) normal.Normalize();
                else normal = -dir;
                float move = Mathf.Max(0, hit.distance - skin);
                if (move > 1e-4f) agent.Move(dir * move);
                return true;
            }
            agent.Move(delta);
            return false;
        }

        /// <summary>前方 distance 内导航网格就到头了（墙、台沿）</summary>
        public static bool NavBlocked(NavMeshAgent agent, Vector3 dir, float distance)
        {
            if (!agent || !agent.enabled || !agent.isOnNavMesh) return false;
            dir.y = 0;
            if (dir.sqrMagnitude < 1e-6f) return false;
            var from = agent.nextPosition;
            return NavMesh.Raycast(from, from + dir.normalized * distance, out _, agent.areaMask);
        }

        /// <summary>水平方向按法线反弹（法线退化或迎面而来的分量为正时直接掉头）</summary>
        public static Vector3 Reflect(Vector3 dir, Vector3 normal)
        {
            dir.y = 0;
            normal.y = 0;
            if (dir.sqrMagnitude < 1e-8f) return dir;
            dir.Normalize();
            if (normal.sqrMagnitude < 1e-6f) return -dir;
            normal.Normalize();
            float d = Vector3.Dot(dir, normal);
            return d < 0 ? (dir - 2 * d * normal).normalized : -dir;
        }

        /// <summary>xz 处的地面高度：从 fromY 上方 up 米往下打射线（地形 / 建筑）；没有地面时返回 NaN</summary>
        public static float GroundAt(Vector3 xz, float fromY, float up = 1.5f, float depth = 40f)
        {
            return Physics.Raycast(new Vector3(xz.x, fromY + up, xz.z), Vector3.down, out var hit, up + depth, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                ? hit.point.y
                : float.NaN;
        }

        /// <summary>水平朝向角（度，Unity yaw：+Z 为 0、顺时针）</summary>
        public static float Yaw(Vector3 dir) => Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;

        /// <summary>yaw（度）对应的水平单位向量</summary>
        public static Vector3 YawDir(float yawDeg)
        {
            float r = yawDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(r), 0, Mathf.Cos(r));
        }

        // ───────────── 格挡 ─────────────

        /// <summary>把格挡配置写到敌人身上的命中区：非弱点区 ×mult + 朝向门，弱点区 ×weakMult（不加门）</summary>
        public static void ApplyGuard(EnemyBody body, in GuardProfile g)
        {
            if (!body) return;
            foreach (var z in body.Zones) ApplyGuard(z, g);
        }

        /// <summary>单个命中区（测试用）</summary>
        public static void ApplyGuard(HitZone z, in GuardProfile g)
        {
            if (!z) return;
            if (z.weakpoint)
            {
                if (z.multiplier != g.weakMult) z.multiplier = g.weakMult;
                z.facing = ZoneFacing.Any;
                return;
            }
            z.facing = g.facing;
            z.facingCos = g.facingCos;
            if (z.multiplier != g.mult) z.multiplier = g.mult;
        }

        // ───────────── 特效 ─────────────

        /// <summary>冰屑四溅（TS iceShards / iceShatter）</summary>
        public static void Shatter(Vector3 at, float size, int count = 12, float speed = 5f)
        {
            Fx.Burst(at, Ice, count, speed, 0.5f, 0.08f * Mathf.Max(0.3f, size), 8f);
            Fx.Burst(at, Snow, Mathf.Max(3, count / 2), speed * 0.45f, 0.65f, 0.22f * Mathf.Max(0.3f, size), 0.5f);
        }

        /// <summary>一团霜气（TS frostVapour）</summary>
        public static void Vapour(Vector3 at, float size, int count, Color color) =>
            Fx.Burst(at, color, count, 1.2f, 0.7f, 0.25f * Mathf.Max(0.3f, size), -1.5f);

        /// <summary>落地扬雪（起跳、落地、刹车）</summary>
        public static void SnowPuff(Vector3 at, float size, int count = 6) => Fx.Burst(at + Vector3.up * 0.05f, Snow, count, 1.4f, 0.45f, 0.18f * Mathf.Max(0.3f, size), 1f);

        /// <summary>贴地冰环：冲击环 + 一圈冰屑（TS spawnIceRing；纯视觉）</summary>
        public static void IceRing(Vector3 ground, float radius)
        {
            Fx.Ring(ground + Vector3.up * 0.05f, radius, Ice, 0.35f);
            for (int i = 0; i < 12; i++)
            {
                float a = i / 12f * Mathf.PI * 2;
                Fx.Burst(ground + new Vector3(Mathf.Cos(a), 0.1f, Mathf.Sin(a)) * radius, Ice, 2, 2.2f, 0.45f, 0.1f, 6f);
            }
            Fx.Burst(ground + Vector3.up * 0.2f, Mist, 10, 2f, 0.7f, 0.3f, -0.5f);
        }

        /// <summary>以 at 为中心按距离衰减的震屏（TS 坦克 quake：离玩家越远越弱，range 外没有）</summary>
        public static void Quake(Vector3 at, float strength, float range, float duration = 0.3f) => CameraShake.Quake(at, strength, range, duration);

        // ───────────── 程序化小件 ─────────────

        /// <summary>挂在 parent 下的不受光发光小件（握在手里的骨矛、冰块…）：去掉碰撞体</summary>
        public static Renderer GlowPrimitive(PrimitiveType type, Transform parent, Vector3 localPos, Quaternion localRot, Vector3 localScale, Color color, string name)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            var c = go.GetComponent<Collider>();
            if (c)
            {
                if (Application.isPlaying) UnityEngine.Object.Destroy(c);
                else UnityEngine.Object.DestroyImmediate(c);
            }
            go.layer = parent ? parent.gameObject.layer : 0;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localRotation = localRot;
            go.transform.localScale = localScale;
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(r, color);
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return r;
        }

        // ───────────── 延时 ─────────────

        /// <summary>seconds 秒后在 host 上执行 action（host 销毁 / 停用物体时取消）。AI 组件死后被停用，协程挂在身体上照样跑</summary>
        public static void Delay(MonoBehaviour host, float seconds, Action action)
        {
            if (!host || action == null || !host.isActiveAndEnabled) return;
            host.StartCoroutine(DelayRoutine(seconds, action));
        }

        static IEnumerator DelayRoutine(float seconds, Action action)
        {
            yield return new WaitForSeconds(Mathf.Max(0, seconds));
            try
            {
                action();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
        }
    }

    /// <summary>
    /// 冻雾（Three.js FrostSkirmishFx.spawnFrostFog；冰河豚炸开后留下的减速雾）：贴地的雾团，站在里面（水平 ≤ 半径 + 0.175 m，
    /// 脚底相对雾心 −1.2..2.4 m）每 0.2 s 刷新一次寒意（<see cref="PlayerStatus.Chill"/>：多团雾 / 别的寒意取最强），离开后 0.35 s 内消退。
    /// 不伤人。落点离地面 3.2 m 以内贴到地面上，否则放在炸点下方 0.8 m。
    /// </summary>
    public sealed class FrostFog : HazardZone
    {
        public const float Tick = 0.2f, Linger = 0.35f, Pad = 0.175f, MinRise = -1.2f, MaxRise = 2.4f;

        float slow;

        /// <summary>减速比例（0.4 = −40%）</summary>
        public float Slow => slow;

        public static FrostFog Spawn(Vector3 center, float radius, float duration, float slow)
        {
            float gy = FrostKit.GroundAt(center, center.y, 0.5f, 6f);
            var ground = new Vector3(center.x, float.IsFinite(gy) && center.y - gy < 3.2f ? gy : center.y - 0.8f, center.z);
            var s = new Spec(ground, radius, duration, 0)
            {
                interval = Tick, firstTick = 0, minRise = MinRise, maxRise = MaxRise, pad = Pad, color = FrostKit.Fog, telegraph = false,
            };
            var f = Create<FrostFog>("Frost Fog", s);
            f.slow = Mathf.Clamp01(slow);
            // 雾团：几团贴地缓慢翻滚的冷雾
            for (int i = 0; i < 6; i++)
            {
                float a = i / 6f * Mathf.PI * 2;
                Fx.Burst(ground + new Vector3(Mathf.Cos(a), 0.3f, Mathf.Sin(a)) * radius * 0.55f, FrostKit.Mist, 3, 0.5f, Mathf.Min(5, duration * 0.6f), radius * 0.35f, -0.2f);
            }
            return f;
        }

        /// <summary>脚底 feet 在雾里</summary>
        public static bool Inside(Vector3 center, float radius, Vector3 feet) => Contains(center, radius, 0, Pad, MinRise, MaxRise, feet);

        protected override bool TickPlayer()
        {
            var pv = PlayerVitals.Instance;
            if (!pv || pv.Dead) return false;
            if (!Inside(spec.center, spec.radius, pv.transform.position)) return false;
            PlayerStatus.Chill(slow, Tick + Linger);
            if (UnityEngine.Random.value < 0.6f) Fx.Burst(pv.transform.position + new Vector3(UnityEngine.Random.Range(-0.3f, 0.3f), 0.15f, UnityEngine.Random.Range(-0.3f, 0.3f)), FrostKit.IceHot, 2, 0.8f, 0.5f, 0.06f, -1f);
            return true;
        }
    }

    /// <summary>
    /// 滑冰带（Three.js FrostTankFx.dropIcePatch：旋龟旋壳滑过留下的冰面，3 s）。现在只有外观（贴花淡入淡出）和登记：
    /// 玩家踩上去打滑属于地表系统（L8 冰面），由它读 <see cref="OnIce"/> / 订阅 <see cref="Dropped"/> 接上——这里不改玩家的移动。
    /// </summary>
    public sealed class IceFloor : HazardZone
    {
        static readonly List<IceFloor> live = new();

        /// <summary>新的滑冰带落下（L8 冰面的接入点）</summary>
        public static event Action<IceFloor> Dropped;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            live.Clear();
            Dropped = null;
        }

        /// <summary>场上生效中的滑冰带</summary>
        public static IReadOnlyList<IceFloor> Active
        {
            get
            {
                live.RemoveAll(z => !z || z.Ended);
                return live;
            }
        }

        /// <summary>落一块滑冰带（地面点、半径、持续）</summary>
        public static IceFloor Drop(Vector3 ground, float radius, float duration)
        {
            var s = new Spec(ground, radius, duration, 0)
            {
                interval = 1f, firstTick = 99f, color = FrostKit.Band, telegraph = false, minRise = -0.6f, maxRise = 0.6f, pad = 0.175f,
            };
            var z = Create<IceFloor>("Ice Floor", s);
            live.Add(z);
            Fx.Burst(ground + Vector3.up * 0.1f, FrostKit.Snow, 3, 2f, 0.45f, 0.14f * radius, 6f);
            try
            {
                Dropped?.Invoke(z);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
            }
            return z;
        }

        /// <summary>脚底 feet 站在某块生效中的滑冰带上（结束前 0.3 s 不算，同 TS）</summary>
        public static bool OnIce(Vector3 feet)
        {
            foreach (var z in Active)
                if (z.Live && z.clock.LiveTime < z.clock.duration - 0.3f && Contains(z.Center, z.Radius, 0, 0.175f, -0.6f, 0.6f, feet))
                    return true;
            return false;
        }

        protected override bool TickPlayer() => false;

        void OnDestroy() => live.Remove(this);
    }
}
