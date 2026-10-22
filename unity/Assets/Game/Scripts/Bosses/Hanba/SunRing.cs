using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 旱魃背后的日轮（docs/level-design/unity-maps-v1.md 第 3 节「巨大的白金日轮」；docs/art/boss-hanba.md 第 4、7 节）：
    ///   · 模型：正式美术 SK_Boss_Hanba 上由 <see cref="Bosses"/> 按 ArtAssetInfo.bind 挂到 socket_sunring 的 SM_BossPart_HanbaSunRing；
    ///     场景目录里没有这个挂件时，自己从 GameDatabase 取 Prefab 挂到 socket_sunring；代理模型（SK_Enemy_Apsara × 3.5）/ 占位体没有挂点，
    ///     就在身后上方立一个白盒日轮（十六块金色轮齿 + 轮毂，4.11 占位策略），世界尺寸与正式日轮一致（直径约 6 m）。
    ///   · 旋转：绕轮面法线（挂件本地 Z）慢转；<see cref="SetBlaze"/> 的 spin 倍率让扫射、狂怒时转得更快。
    ///   · 炽度 <see cref="Blaze"/>（0–1，平滑追目标）：轮心一团加色光晕跟着亮；<see cref="SunExposure"/> 按它放大日轮直射的距离。
    ///     平涂的日轮本身不发光（美术约定），发光全在这层；BS2 的日蚀（熄灭 3 s）、升入穴顶也走这里（<see cref="SetBlaze"/>、移动 <see cref="Pivot"/>）。
    /// 由 <see cref="HanbaBrain"/> 生成时挂到首领根节点上；首领倒下后熄灭、停转。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SunRing : MonoBehaviour
    {
        public const string PrefabId = "SM_BossPart_HanbaSunRing", SocketName = "socket_sunring";
        /// <summary>正式日轮的世界半径（米，直径 6 m）</summary>
        public const float WorldRadius = 3f;

        [Tooltip("平时的转速（度 / 秒）")] public float spinSpeed = 20f;
        [Tooltip("平时的炽度（0–1）")] public float idleBlaze = 0.35f;
        [Tooltip("炽度追目标的速度（每秒）")] public float blazeRate = 3f;
        public Color glowColor = new(1f, 0.86f, 0.52f);

        Transform ring, glow;
        Renderer glowR;
        Quaternion baseRot = Quaternion.identity;
        float angle, blazeTarget, spinMult = 1f, spinNow = 1f;
        bool dead;

        /// <summary>日轮这一层的来源：正式挂件 / 自己挂上的 Prefab / 白盒</summary>
        public enum Source { None, Attached, Spawned, Whitebox }

        public Source From { get; private set; }
        /// <summary>转动的那一层（挂件实例或白盒根）</summary>
        public Transform Ring => ring;
        /// <summary>日轮的支点（挂点或白盒的父节点）：BS2 升顶 / 挡在身前时移动它</summary>
        public Transform Pivot => ring ? ring.parent : transform;
        /// <summary>轮心（世界坐标）</summary>
        public Vector3 Center => ring ? ring.position : transform.position + Vector3.up * 4f;
        /// <summary>轮面朝向（世界，轮面法线）</summary>
        public Vector3 Facing => ring ? ring.forward : transform.forward;
        /// <summary>当前炽度 0–1</summary>
        public float Blaze { get; private set; }
        public float BlazeTarget => blazeTarget;
        /// <summary>累计转过的角度（度，测试看它在不在转）</summary>
        public float Angle => angle;

        /// <summary>找 / 挂日轮（首领生成后、模型已就位时调一次；换形后可以再调）</summary>
        public void Bind(BossBrain b)
        {
            dead = false;
            blazeTarget = Blaze = idleBlaze;
            var model = b ? b.Model : null;
            var root = model?.root ? model.root.transform : transform;
            ring = null;
            From = Source.None;
            // 1. 正式挂件（Bosses.AttachParts 按 bind 挂好的）
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t.name == PrefabId || t.name.StartsWith(PrefabId + " "))
                {
                    ring = t;
                    From = Source.Attached;
                    break;
                }
            // 2. 有挂点、没挂件：自己挂
            if (!ring)
            {
                var socket = FindChild(root, SocketName);
                var prefab = socket ? Bosses.FindPrefab(PrefabId) : null;
                if (socket && prefab)
                {
                    var inst = Instantiate(prefab, socket, false);
                    inst.name = PrefabId;
                    foreach (var c in inst.GetComponentsInChildren<Collider>(true))
                    {
                        c.enabled = false;
                        Destroy(c);
                    }
                    ring = inst.transform;
                    From = Source.Spawned;
                }
            }
            // 3. 代理 / 占位：身后上方立一个白盒日轮
            if (!ring) ring = BuildWhitebox(b);
            baseRot = ring.localRotation;
            BuildGlow();
        }

        static Transform FindChild(Transform root, string name)
        {
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t.name == name)
                    return t;
            return null;
        }

        /// <summary>白盒日轮：支点挂在首领根节点上（世界尺寸，不随代理体型缩放），在身体中心之上、身后 1.4 m；十六块轮齿 + 一圈轮毂</summary>
        Transform BuildWhitebox(BossBrain b)
        {
            From = Source.Whitebox;
            var pivot = new GameObject("Sun Ring Pivot (whitebox)").transform;
            var cap = b ? b.GetComponent<CapsuleCollider>() : null;
            float h = cap ? cap.height * Mathf.Abs(transform.lossyScale.y) : 4.5f;
            var basePos = transform.position + Vector3.up * (cap ? cap.center.y * Mathf.Abs(transform.lossyScale.y) : 0f);
            pivot.position = basePos + Vector3.up * h * 0.3f - transform.forward * 1.4f;
            pivot.rotation = transform.rotation;
            pivot.SetParent(transform, true);
            var r = new GameObject("Sun Ring (whitebox)").transform;
            r.SetParent(pivot, false);
            var gold = new Color(0.95f, 0.78f, 0.38f);
            const int teeth = 16;
            for (int i = 0; i < teeth; i++)
            {
                float a = i * Mathf.PI * 2 / teeth;
                var piece = PropBits.Box(r, $"Tooth {i + 1}", new Vector3(Mathf.Sin(a), Mathf.Cos(a), 0) * WorldRadius * 0.9f, new Vector3(0.55f, 1.1f, 0.35f), gold);
                piece.transform.localRotation = Quaternion.Euler(0, 0, -a * Mathf.Rad2Deg);
                piece.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }
            var hub = PropBits.Cylinder(r, "Hub", Vector3.zero, new Vector3(1.4f, 0.4f, 1.4f), new Color(0.7f, 0.5f, 0.25f));
            hub.transform.localRotation = Quaternion.Euler(90, 0, 0);
            hub.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return r;
        }

        void BuildGlow()
        {
            if (glow) Destroy(glow.gameObject);
            if (!ring) return;
            // 光晕挂在支点上（不跟着转），尺寸按世界米：支点的缩放除回去
            var parent = Pivot;
            float s = Mathf.Max(1e-3f, parent.lossyScale.x);
            glow = FxMaterials.GlowSprite(parent, WorldRadius * 3.2f / s, glowColor);
            glow.name = "Sun Ring Glow";
            glow.position = Center;
            glowR = glow.GetComponent<Renderer>();
        }

        /// <summary>炽度目标（0–1）与转速倍率；首领倒下后无效</summary>
        public void SetBlaze(float target, float spin = 1f)
        {
            if (dead) return;
            blazeTarget = Mathf.Clamp01(target);
            spinMult = Mathf.Max(0, spin);
        }

        /// <summary>回到平时的炽度与转速</summary>
        public void Idle() => SetBlaze(idleBlaze, 1f);

        /// <summary>立刻亮到 value（招式出手的那一下闪）</summary>
        public void Flash(float value = 1f)
        {
            if (dead) return;
            Blaze = Mathf.Max(Blaze, Mathf.Clamp01(value));
        }

        /// <summary>首领倒下：熄灭、慢慢停转</summary>
        public void Extinguish()
        {
            dead = true;
            blazeTarget = 0;
            spinMult = 0;
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (!(dt > 0) || !ring) return;
            Blaze = Mathf.MoveTowards(Blaze, blazeTarget, blazeRate * dt);
            spinNow = Mathf.MoveTowards(spinNow, spinMult, 2f * dt);
            angle += spinSpeed * spinNow * dt;
            ring.localRotation = baseRot * Quaternion.Euler(0, 0, angle);
            if (glow)
            {
                glow.position = Center;
                if (glowR)
                {
                    var c = glowColor;
                    c.a = Mathf.Clamp01(0.08f + Blaze * 0.75f) * (0.9f + 0.1f * Mathf.Sin(Time.time * 6.3f));
                    FxMaterials.Tint(glowR, c);
                }
                float k = 0.55f + Blaze * 0.65f;
                float s = Mathf.Max(1e-3f, Pivot.lossyScale.x);
                glow.localScale = Vector3.one * (WorldRadius * 3.2f * k / s);
            }
        }
    }
}
