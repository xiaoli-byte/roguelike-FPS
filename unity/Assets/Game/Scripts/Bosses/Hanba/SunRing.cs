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
    ///     平涂的日轮本身不发光（美术约定），发光全在这层。
    ///   · 日蚀（<see cref="SetEclipse"/>，三阶段「日蚀」招式）：炽度掐到 0，轮毂前立一块黑盘（月影），只剩一圈淡金色日冕；
    ///     <see cref="Eclipsed"/> 期间日轮不直射（<see cref="SunExposure.RingLit"/>）。
    ///   · 升顶（<see cref="Rise"/>，三阶段「赤地千里」）：日轮离开挂点（换挂到一个世界空间的支点，不再跟骨骼动画走），沿弧线升到穴顶裂缝口、
    ///     轮面朝下、放大，并点一盏投影的点光（整个泉床被它照亮，岩岛、月牙阁投下影子）；<see cref="Center"/> 随之落在裂缝口，日晒的日轮直射从那里算。
    ///   · 坠落（<see cref="Fall"/>）：首领倒下时，升起的日轮砸回地面、碎成金沙。
    /// 由 <see cref="HanbaBrain"/> 生成时挂到首领根节点上；首领倒下后熄灭、停转；物体销毁时连同升顶支点一起清掉。
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
        [Tooltip("升顶后的体型倍率")] public float risenScale = 1.5f;
        [Tooltip("升顶点光的照射距离（米）与满炽度时的强度")] public float lightRange = 75f, lightIntensity = 6f;
        public Color lightColor = new(1f, 0.84f, 0.55f);

        Transform ring, glow, anchor, disc;
        Renderer glowR, discR;
        Light sun;
        Quaternion baseRot = Quaternion.identity, riseRotFrom, riseRotTo;
        Vector3 riseFrom, riseTo, fallTo;
        float angle, blazeTarget, spinMult = 1f, spinNow = 1f, riseT, riseSeconds = 1f, scaleFrom = 1f, scaleTo = 1f, fallT, fallSeconds = 1f, glowBoost = 1f;
        bool dead, rising, falling;

        /// <summary>日轮这一层的来源：正式挂件 / 自己挂上的 Prefab / 白盒</summary>
        public enum Source { None, Attached, Spawned, Whitebox }

        public Source From { get; private set; }
        /// <summary>转动的那一层（挂件实例或白盒根）</summary>
        public Transform Ring => ring;
        /// <summary>日轮的支点（挂点、白盒的父节点；升顶后是世界空间的升顶支点）</summary>
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
        /// <summary>日蚀中（熄灭、不直射）</summary>
        public bool Eclipsed { get; private set; }
        /// <summary>已经升顶（升的途中也算）；<see cref="RiseProgress"/> 0 → 1</summary>
        public bool Risen { get; private set; }
        public float RiseProgress => !Risen ? 0 : rising ? Mathf.Clamp01(riseT / Mathf.Max(0.01f, riseSeconds)) : 1f;
        /// <summary>升顶的目标点（世界）</summary>
        public Vector3 RiseTarget => riseTo;
        /// <summary>升顶点光（没升顶为 null）</summary>
        public Light SunLight => sun;
        /// <summary>坠落砸地、碎掉了</summary>
        public bool Shattered { get; private set; }

        /// <summary>找 / 挂日轮（首领生成后、模型已就位时调一次；换形后可以再调）</summary>
        public void Bind(BossBrain b)
        {
            dead = false;
            Eclipsed = Risen = rising = falling = Shattered = false;
            glowBoost = 1f;
            if (anchor) Destroy(anchor.gameObject);
            anchor = null;
            disc = null;
            sun = null;
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

        /// <summary>炽度目标（0–1）与转速倍率；首领倒下后、日蚀中无效</summary>
        public void SetBlaze(float target, float spin = 1f)
        {
            if (dead || Eclipsed) return;
            blazeTarget = Mathf.Clamp01(target);
            spinMult = Mathf.Max(0, spin);
        }

        /// <summary>回到平时的炽度与转速</summary>
        public void Idle() => SetBlaze(idleBlaze, 1f);

        /// <summary>立刻亮到 value（招式出手的那一下闪）；日蚀中无效</summary>
        public void Flash(float value = 1f)
        {
            if (dead || Eclipsed) return;
            Blaze = Mathf.Max(Blaze, Mathf.Clamp01(value));
        }

        /// <summary>首领倒下：熄灭、慢慢停转（日蚀黑盘收起）</summary>
        public void Extinguish()
        {
            dead = true;
            blazeTarget = 0;
            spinMult = 0;
            Eclipsed = false;
            SetDisc(false);
        }

        // ───────────── 日蚀 ─────────────

        /// <summary>
        /// 日蚀开关：开 = 炽度立刻掐到 0、转速降到两成、轮毂前立起黑盘（月影）、点光压暗；关 = 黑盘收起，炽度回到平时（复燃的强光由招式另外 <see cref="Flash"/>）
        /// </summary>
        public void SetEclipse(bool on)
        {
            if (dead && on) return;
            Eclipsed = on;
            if (on)
            {
                blazeTarget = 0;
                Blaze = 0;
                spinMult = 0.2f;
            }
            else if (!dead)
            {
                blazeTarget = idleBlaze;
                spinMult = 1f;
            }
            SetDisc(on);
        }

        void SetDisc(bool on)
        {
            if (on && !disc && ring)
            {
                // 黑盘：不受光的扁圆柱，挂在支点上（不跟着转），每帧摆到轮心前方、轮面朝向
                var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                var col = go.GetComponent<Collider>();
                if (col)
                {
                    col.enabled = false;
                    Destroy(col);
                }
                go.name = "Sun Ring Eclipse Disc";
                go.layer = Layers.IgnoreRaycast;
                disc = go.transform;
                disc.SetParent(Pivot, false);
                discR = go.GetComponent<Renderer>();
                discR.sharedMaterial = FxMaterials.Unlit;
                FxMaterials.Tint(discR, new Color(0.03f, 0.02f, 0.015f));
            }
            if (disc) disc.gameObject.SetActive(on);
            if (on) PlaceDisc();
        }

        void PlaceDisc()
        {
            if (!disc || !ring) return;
            float world = WorldRadius * 1.25f * (Risen ? Mathf.Lerp(1f, risenScale, RiseProgress) : 1f);
            float s = Mathf.Max(1e-3f, disc.parent ? disc.parent.lossyScale.x : 1f);
            disc.position = Center + Facing * 0.15f;
            disc.rotation = Quaternion.FromToRotation(Vector3.up, Facing);
            disc.localScale = new Vector3(world * 2f / s, 0.05f / s, world * 2f / s);
        }

        // ───────────── 升顶 / 坠落 ─────────────

        /// <summary>
        /// 升顶：日轮（连光晕）换挂到一个世界空间支点上，seconds 秒内沿弧线升到 worldTarget、轮面转成朝下、放大到 <see cref="risenScale"/>，
        /// 并点一盏投影的点光。支点挂在首领的父节点下（跟关卡场景一起卸载），首领物体销毁时一起清掉。已升顶时只改目标
        /// </summary>
        public void Rise(Vector3 worldTarget, float seconds)
        {
            if (dead || !ring) return;
            if (!anchor)
            {
                anchor = new GameObject("Sun Ring Anchor (risen)").transform;
                anchor.SetParent(transform.parent, false);
                // 支点 = 日轮当前的世界位置 + 去掉自转的朝向；日轮挂上去以后，本地旋转只剩自转
                anchor.SetPositionAndRotation(ring.position, Pivot.rotation * baseRot);
                ring.SetParent(anchor, true);
                ring.localPosition = Vector3.zero;
                baseRot = Quaternion.identity;
                if (glow) glow.SetParent(anchor, true);
                if (disc) disc.SetParent(anchor, true);
                var lightGo = new GameObject("Sun Ring Light");
                lightGo.transform.SetParent(anchor, false);
                sun = lightGo.AddComponent<Light>();
                sun.type = LightType.Point;
                sun.range = lightRange;
                sun.color = lightColor;
                sun.intensity = 0;
                sun.shadows = LightShadows.Soft;
                sun.shadowStrength = 0.85f;
            }
            Risen = true;
            rising = true;
            riseT = 0;
            riseSeconds = Mathf.Max(0.05f, seconds);
            riseFrom = anchor.position;
            riseRotFrom = anchor.rotation;
            riseTo = worldTarget;
            // 轮面法线（本地 Z）朝下，轮的「上」朝北
            riseRotTo = Quaternion.LookRotation(Vector3.down, Vector3.forward);
            scaleFrom = anchor.localScale.x;
            scaleTo = Mathf.Max(0.1f, risenScale);
            glowBoost = 1.8f;
        }

        /// <summary>升起的日轮砸回 ground（首领倒下）：seconds 秒加速坠落，落地碎成金沙、熄灯、隐去；没升顶时什么都不做</summary>
        public void Fall(Vector3 ground, float seconds = 1.1f)
        {
            if (!Risen || !anchor || Shattered) return;
            rising = false;
            falling = true;
            fallT = 0;
            fallSeconds = Mathf.Max(0.05f, seconds);
            riseFrom = anchor.position;
            fallTo = ground + Vector3.up * WorldRadius * 0.6f;
        }

        void StepRise(float dt)
        {
            if (rising && anchor)
            {
                riseT += dt;
                float u = Mathf.Clamp01(riseT / riseSeconds);
                float e = u * u * (3 - 2 * u);
                anchor.position = Vector3.Lerp(riseFrom, riseTo, e) + Vector3.up * Mathf.Sin(u * Mathf.PI) * 2f;
                anchor.rotation = Quaternion.Slerp(riseRotFrom, riseRotTo, e);
                anchor.localScale = Vector3.one * Mathf.Lerp(scaleFrom, scaleTo, e);
                if (u >= 1f) rising = false;
            }
            if (falling && anchor)
            {
                fallT += dt;
                float u = Mathf.Clamp01(fallT / fallSeconds);
                anchor.position = Vector3.Lerp(riseFrom, fallTo, u * u);
                anchor.Rotate(Vector3.right, 140f * dt, Space.World);
                if (u >= 1f) Shatter();
            }
            if (sun)
            {
                float k = Eclipsed ? 0.04f : Blaze;
                sun.intensity = dead ? Mathf.MoveTowards(sun.intensity, 0, lightIntensity * dt) : lightIntensity * RiseProgress * (0.25f + 0.75f * k);
            }
        }

        void Shatter()
        {
            falling = false;
            Shattered = true;
            var at = anchor ? anchor.position : Center;
            Fx.Burst(at, new Color(0.95f, 0.78f, 0.38f), 40, 11f, 1.3f, 0.4f, 12f);
            Fx.Burst(at, HanbaDef.Sand, 30, 7f, 1.1f, 0.5f, 6f);
            Fx.Ring(new Vector3(at.x, Fx.GroundY(at), at.z) + Vector3.up * 0.1f, 9f, HanbaDef.Sun, 0.8f);
            CameraShake.Quake(at, 0.7f, 70f, 0.6f);
            GameAudio.PlayAt("boss_slam", at, 1f, 0.7f);
            GameAudio.PlayAt("explosion", at, 0.9f, 0.6f);
            if (anchor) anchor.gameObject.SetActive(false);
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (!(dt > 0) || !ring) return;
            StepRise(dt);
            Blaze = Mathf.MoveTowards(Blaze, blazeTarget, blazeRate * dt);
            spinNow = Mathf.MoveTowards(spinNow, spinMult, 2f * dt);
            angle += spinSpeed * spinNow * dt;
            ring.localRotation = baseRot * Quaternion.Euler(0, 0, angle);
            if (Eclipsed) PlaceDisc();
            if (glow)
            {
                glow.position = Center;
                if (glowR)
                {
                    var c = glowColor;
                    // 日蚀：只剩一圈淡淡的日冕
                    c.a = Eclipsed ? 0.1f : Mathf.Clamp01(0.08f + Blaze * 0.75f) * (0.9f + 0.1f * Mathf.Sin(Time.time * 6.3f));
                    FxMaterials.Tint(glowR, c);
                }
                float k = (0.55f + Blaze * 0.65f) * (Eclipsed ? 1.15f : glowBoost);
                float s = Mathf.Max(1e-3f, glow.parent ? glow.parent.lossyScale.x : 1f);
                glow.localScale = Vector3.one * (WorldRadius * 3.2f * k / s);
            }
        }

        void OnDestroy()
        {
            if (anchor) Destroy(anchor.gameObject);
        }
    }
}
