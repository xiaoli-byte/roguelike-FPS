using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 选英雄的 3D 祭台（U6；Three.js src/ui/HeroPreview.ts 的舞台部分，Unity 里直接放在主菜单场景的广场中央，由主相机拍——不渲染到贴图）：
    ///   · 英雄：三位英雄的展示模型（SK_Hero_*，MenuSceneBuilder 摆在 Models 下、停用），<see cref="Show"/> 换人时从台里升起（0.6 s），
    ///     动画控制器触发 act_Show 亮相、播完回到待机（Show → Idle），头看向镜头（CreatureRig）；没有模型时用英雄色的胶囊占位；
    ///   · 祭台 <see cref="HeroAltar"/>：台座、符文环、光柱，换人时闪亮一下；氛围粒子 <see cref="StageAmbience"/>：英雄色灵火飘升，换人时喷一把；
    ///   · 灯光：暖白主光（聚光、带阴影）、背后英雄色轮廓光、脚下英雄色补光，跟着闪光调亮；英雄色 0.4 s 过渡；
    ///   · 朝向：拖拽跟手并估算角速度（<see cref="BeginDrag"/> / <see cref="Drag"/> / <see cref="EndDrag"/>，手柄右摇杆 <see cref="Spin"/>），
    ///     松手后惯性衰减，1.6 s 后临界阻尼弹簧就近转回默认朝向（叠加很慢的 ±4° 轻摆），不会一直自转（数值同 Three.js）；
    ///   · 机位：<see cref="CameraAnchor"/>（按台顶算：英雄放在画面偏左，给右侧信息栏让位），交给 <see cref="MenuCamera"/>。
    /// 坐标：物体原点在地面中心，+Z 朝镜头。全部用不缩放时间。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HeroStage : MonoBehaviour
    {
        [Serializable]
        public struct HeroModel
        {
            public string heroId;
            public GameObject model;
        }

        public static HeroStage Instance { get; private set; }

        /// <summary>亮相动作的触发器（英雄动画控制器的参数名）</summary>
        public const string ShowTrigger = "act_Show";

        [Tooltip("三位英雄的展示模型（MenuSceneBuilder 摆好、停用）")] public HeroModel[] models = Array.Empty<HeroModel>();
        public HeroAltar altar;
        public StageAmbience ambience;
        [Tooltip("石材 / 鎏金 / 占位体用的 URP Lit 模板材质")] public Material litTemplate;
        [Header("灯光（缺了运行时补）")] public Light keyLight;
        public Light rimLight, footLight;
        [Header("机位")]
        [Tooltip("镜头到英雄中心的距离（米）")] public float camDistance = 4.6f;
        [Tooltip("镜头比英雄中心高多少（米）")] public float camLift = 0.22f;
        [Tooltip("英雄中心离台顶的高度（米）")] public float aimHeight = 0.86f;
        [Tooltip("英雄在画面上的横向位置（NDC，−1 左 … 1 右）：偏左给右侧信息栏让位")] public float screenX = -0.13f;
        [Tooltip("祭台机位的竖直视角")] public float fov = 30f;

        // 朝向（度；Three.js 的弧度值换算过来）
        const float BaseYaw = -27f, DragYawPerPixel = 0.63f, SpinMax = 460f, InertiaDecay = 4f, ReturnOmega = 4.2f, ReturnDelay = 1.6f;
        const float SwayAmp = 4f, SwayRate = 0.5f, StickSpeed = 240f;
        const float RiseTime = 0.6f, RiseDepth = 0.35f, ThemeTime = 0.4f;

        readonly Dictionary<string, GameObject> byId = new();
        Transform modelRoot, cameraAnchor;
        string current;
        GameObject shown;
        float yaw = BaseYaw, spinVel, idle = ReturnDelay, dragAcc, enterAt = -100f, clock;
        bool dragging, ensured;
        Color theme = UITheme.Gold, themeFrom = UITheme.Gold, themeTo = UITheme.Gold;
        float themeAt = -100f;

        /// <summary>正在展示的英雄 id</summary>
        public string Current => current;
        /// <summary>正在展示的模型（占位体也算）</summary>
        public GameObject Shown => shown;
        /// <summary>当前朝向（度，相对正对镜头）</summary>
        public float Yaw => yaw;
        public float DefaultYaw => BaseYaw;
        public bool Dragging => dragging;
        /// <summary>换人次数（测试用）</summary>
        public int ShowCount { get; private set; }
        /// <summary>展示的是占位体（没有这位英雄的模型）</summary>
        public bool Placeholder { get; private set; }
        /// <summary>英雄中心（世界坐标）</summary>
        public Vector3 Focus => (modelRoot ? modelRoot.position : transform.position) + Vector3.up * aimHeight;

        /// <summary>祭台机位（没有就现算一个，挂在祭台下）</summary>
        public Transform CameraAnchor
        {
            get
            {
                Ensure();
                return cameraAnchor;
            }
        }

        void Awake()
        {
            Instance = this;
            Ensure();
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        /// <summary>补齐祭台、模型挂点、灯光、粒子、机位（幂等；场景生成器和运行时都调）</summary>
        public void Ensure()
        {
            if (ensured && modelRoot) return;
            ensured = true;
            if (!altar) altar = GetComponent<HeroAltar>();
            if (!altar) altar = gameObject.AddComponent<HeroAltar>();
            if (!altar.litTemplate) altar.litTemplate = litTemplate;
            if (Application.isPlaying) altar.Build();
            if (!ambience) ambience = GetComponent<StageAmbience>();
            if (!ambience && Application.isPlaying) ambience = gameObject.AddComponent<StageAmbience>();

            modelRoot = transform.Find("Models");
            if (!modelRoot)
            {
                modelRoot = new GameObject("Models").transform;
                modelRoot.SetParent(transform, false);
            }
            modelRoot.localPosition = new Vector3(0, HeroAltar.Top, 0);
            modelRoot.localRotation = Quaternion.identity;
            byId.Clear();
            foreach (var m in models)
            {
                if (string.IsNullOrEmpty(m.heroId) || !m.model) continue;
                byId[m.heroId] = m.model;
                if (Application.isPlaying) m.model.SetActive(false);
            }

            keyLight = keyLight ? keyLight : MakeLight("Key Light", LightType.Spot, new Vector3(1.4f, HeroAltar.Top + 2.6f, 2.4f), new Color(1f, 0.93f, 0.82f), 14f, 9f);
            keyLight.spotAngle = 42f;
            keyLight.shadows = LightShadows.Soft;
            keyLight.transform.rotation = Quaternion.LookRotation(Focus - keyLight.transform.position);
            rimLight = rimLight ? rimLight : MakeLight("Rim Light", LightType.Point, new Vector3(0, HeroAltar.Top + 2.0f, -1.3f), theme, 5f, 4.5f);
            footLight = footLight ? footLight : MakeLight("Foot Light", LightType.Point, new Vector3(0, HeroAltar.Top + 0.25f, 0.65f), theme, 2f, 3f);
            UpdateAnchor();
        }

        Light MakeLight(string name, LightType type, Vector3 local, Color c, float intensity, float range)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = local;
            var l = go.AddComponent<Light>();
            l.type = type;
            l.color = c;
            l.intensity = intensity;
            l.range = range;
            l.shadows = LightShadows.None;
            return l;
        }

        /// <summary>按台顶重算祭台机位：英雄中心前方 camDistance、略高；朝向往右偏一点，让英雄落在画面 screenX 处</summary>
        public void UpdateAnchor()
        {
            if (!cameraAnchor)
            {
                cameraAnchor = transform.Find("Camera Heroes");
                if (!cameraAnchor)
                {
                    cameraAnchor = new GameObject("Camera Heroes").transform;
                    cameraAnchor.SetParent(transform, false);
                }
            }
            var center = Focus;
            var pos = center + transform.forward * camDistance + Vector3.up * camLift;
            var rot = Quaternion.LookRotation(center - pos, Vector3.up);
            float tanH = Mathf.Tan(fov * 0.5f * Mathf.Deg2Rad) * (16f / 9f);
            var aim = center - rot * Vector3.right * (camDistance * tanH * screenX);
            cameraAnchor.SetPositionAndRotation(pos, Quaternion.LookRotation(aim - pos, Vector3.up));
            var mc = MenuCamera.Instance;
            if (mc)
            {
                mc.heroesAnchor = cameraAnchor;
                mc.heroesFov = fov;
            }
        }

        // ───────────── 换人 ─────────────

        /// <summary>展示一位英雄（surge = 闪光 + 喷粒子 + 亮相；同一位再调时 surge 会重播亮相）。返回是否展示出来</summary>
        public bool Show(string heroId, bool surge = true)
        {
            Ensure();
            var hero = HeroLibrary.Get(heroId);
            if (hero == null) return false;
            if (heroId == current && shown)
            {
                if (surge) Flourish();
                return true;
            }
            if (shown) shown.SetActive(false);
            current = heroId;
            shown = ModelFor(hero);
            shown.transform.SetParent(modelRoot, false);
            shown.transform.localPosition = Vector3.zero;
            shown.SetActive(true);
            yaw = BaseYaw;
            spinVel = 0;
            idle = ReturnDelay;
            enterAt = clock;
            themeFrom = theme;
            themeTo = hero.color;
            themeAt = clock;
            if (ambience) ambience.SetColor(hero.color);
            LookAtCamera();
            ShowCount++;
            if (surge) Flourish();
            Apply();
            return true;
        }

        /// <summary>闪光 + 喷一把粒子 + 亮相动作</summary>
        void Flourish()
        {
            if (altar) altar.Surge(1f);
            if (ambience) ambience.Burst();
            enterAt = clock;
            var anim = shown ? shown.GetComponentInChildren<Animator>() : null;
            if (anim && anim.runtimeAnimatorController && anim.isActiveAndEnabled)
                foreach (var p in anim.parameters)
                    if (p.name == ShowTrigger && p.type == AnimatorControllerParameterType.Trigger)
                    {
                        anim.SetTrigger(ShowTrigger);
                        break;
                    }
        }

        GameObject ModelFor(HeroDef hero)
        {
            Placeholder = false;
            if (byId.TryGetValue(hero.id, out var m) && m) return m;
            Placeholder = true;
            var key = "placeholder:" + hero.id;
            if (byId.TryGetValue(key, out m) && m) return m;
            // 没有展示模型（美术还没导入）：英雄色胶囊 + 头上一颗光球
            m = new GameObject("Placeholder " + hero.id);
            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            Destroy(body.GetComponent<Collider>());
            body.transform.SetParent(m.transform, false);
            body.transform.localPosition = new Vector3(0, 0.8f, 0);
            body.transform.localScale = new Vector3(0.55f, 0.8f, 0.45f);
            var mat = litTemplate ? new Material(litTemplate) : new Material(FxMaterials.Unlit);
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", Color.Lerp(hero.color, Color.gray, 0.35f));
            body.GetComponent<Renderer>().sharedMaterial = mat;
            FxMaterials.GlowSprite(m.transform, 0.5f, hero.color).localPosition = new Vector3(0, 1.75f, 0);
            byId[key] = m;
            return m;
        }

        void LookAtCamera()
        {
            if (!shown) return;
            var rig = shown.GetComponentInChildren<CreatureRig>();
            var cam = MenuCamera.Instance ? MenuCamera.Instance.transform : Camera.main ? Camera.main.transform : null;
            if (rig && cam) rig.lookTarget = cam;
        }

        // ───────────── 拖拽 / 摇杆 ─────────────

        public void BeginDrag()
        {
            dragging = true;
            dragAcc = 0;
        }

        /// <summary>拖了 dx 像素（界面坐标，右为正）：英雄正面跟着手往右转</summary>
        public void Drag(float dxPixels)
        {
            if (!dragging) BeginDrag();
            float d = -dxPixels * DragYawPerPixel;
            yaw += d;
            dragAcc += d;
            idle = 0;
        }

        public void EndDrag() => dragging = false;

        /// <summary>手柄右摇杆（−1..1）：按住时持续转，松开后和拖拽一样惯性 + 回正</summary>
        public void Spin(float axis, float dt)
        {
            if (Mathf.Abs(axis) < 0.2f) return;
            float d = -axis * StickSpeed * dt;
            yaw += d;
            spinVel = d / Mathf.Max(dt, 1e-4f);
            idle = 0;
        }

        // ───────────── 每帧 ─────────────

        void Update()
        {
            float dt = Mathf.Min(Time.unscaledDeltaTime, 0.05f);
            clock += dt;
            UpdateYaw(dt);
            float tk = Mathf.Clamp01((clock - themeAt) / ThemeTime);
            theme = Color.Lerp(themeFrom, themeTo, tk * tk * (3 - 2 * tk));
            Apply();
            float flare = altar ? altar.Flare : 0;
            if (altar) altar.Tick(dt, clock, theme);
            float breath = 0.85f + 0.15f * Mathf.Sin(clock * 1.6f);
            if (rimLight)
            {
                rimLight.color = theme;
                rimLight.intensity = 5f * breath + 4f * flare;
            }
            if (footLight)
            {
                footLight.color = theme;
                footLight.intensity = 2f * breath + 3f * flare;
            }
        }

        void Apply()
        {
            if (!shown) return;
            float k = Mathf.Clamp01((clock - enterAt) / RiseTime);
            float e = 1 - (1 - k) * (1 - k) * (1 - k);
            shown.transform.localPosition = new Vector3(0, -RiseDepth * (1 - e), 0);
            shown.transform.localRotation = Quaternion.Euler(0, yaw, 0);
        }

        /// <summary>同 Three.js HeroPreview.updateYaw：拖拽时跟手并估角速度；松手后惯性衰减，ReturnDelay 秒后临界阻尼弹簧就近回到默认朝向（叠加轻摆）</summary>
        void UpdateYaw(float dt)
        {
            if (dragging)
            {
                if (dt > 0) spinVel = Mathf.Lerp(Mathf.Clamp(dragAcc / dt, -SpinMax, SpinMax), spinVel, Mathf.Exp(-18f * dt));
                dragAcc = 0;
            }
            else
            {
                idle += dt;
                if (idle < ReturnDelay)
                {
                    spinVel *= Mathf.Exp(-InertiaDecay * dt);
                    yaw += spinVel * dt;
                }
                else
                {
                    float sway = Mathf.Sin(clock * SwayRate) * SwayAmp;
                    float target = yaw + Mathf.DeltaAngle(yaw, BaseYaw + sway);
                    float w = ReturnOmega;
                    spinVel += (w * w * (target - yaw) - 2 * w * spinVel) * dt;
                    yaw += spinVel * dt;
                }
            }
            // 规约到默认朝向附近（旋转是周期的，不跳变）
            yaw = BaseYaw + Mathf.DeltaAngle(BaseYaw, yaw);
        }
    }
}
