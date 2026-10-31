using System;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using Object = UnityEngine.Object;

namespace Spiritfire.Game
{
    /// <summary>
    /// 按美术 id 实例化一个 Prefab 挂到 parent 下（本地坐标由调用方再设）；没有这个 Prefab 时返回 null。
    /// 运行时用 <see cref="GameDatabase.Place"/>；编辑器（PlayerRigBuilder）换成 PrefabUtility 版本，烘进场景的物体保留 Prefab 连接。
    /// </summary>
    public delegate GameObject PrefabPlacer(string prefabId, Transform parent);

    /// <summary><see cref="PlayerFactory.Create"/> 组装好的玩家：根物体与常用组件</summary>
    public sealed class PlayerRig
    {
        public GameObject root;
        /// <summary>渲染相机（Head，CameraFeel 写它的姿态与 FOV）</summary>
        public Camera cam;
        /// <summary>眼睛（= motor.eye，瞄准 / 射线用，不抖）</summary>
        public Transform eye;
        public CameraFeel feel;
        public PlayerMotor motor;
        public PlayerVitals vitals;
        public WeaponController weapons;
        public HeroSkills skills;
        public Interactor interactor;
        public HeroDef hero;
    }

    /// <summary>
    /// 玩家组装（docs/unity-parity.md 4.6，L1）：按 <see cref="HeroDef"/> 搭出可玩的第一人称玩家——角色控制器 + PlayerMotor + 英雄属性 + 生命护盾 +
    /// 武器（每把枪一套第一人称 rig：枪模 + 英雄手臂，握点按 Three.js 版 WeaponHandling）+ 交互 + 技能 + 跨关状态（<see cref="PlayerCarry"/>）。
    /// 运行时（<see cref="SceneFlow"/> 每进一关组装一次）和编辑器（PlayerRigBuilder 给测试场烘玩家、给关卡审核截图搭预览机位）共用这一份实现，
    /// 区别只在 Prefab 从哪来（<see cref="PrefabPlacer"/>）。
    /// 组件先在停用的物体上挂好、字段填好再激活：Awake 读得到 startWeapon / rigs / eye；HeroStats 挂在 PlayerVitals 前面（它要先建属性表）。
    /// 镜头层级（F3）：Player → Eye（motor.eye，眼高处，PlayerMotor 写俯仰；瞄准 / 射线用，不抖）→ Main Camera（Head：<see cref="CameraFeel"/> 写晃动、震屏、冲击、FOV）
    /// → 枪模相机 + 各把枪的第一人称 rig。
    /// 灵宠（PetOwner / PetHud）由 <see cref="PetBootstrap.Setup"/> 补挂，[GameSystem] 系统由 <see cref="SystemsBootstrap"/> 补挂。
    /// 运行时组装完立刻按当前局（开局锁定的快照）套天赋（<see cref="MetaSave.ApplyTalents(StatSheet, RunState)"/>），所以调用方随后读回的生命 / 护盾不会被上限天赋「补满」。
    /// </summary>
    public static class PlayerFactory
    {
        /// <summary>眼高（相机离脚底）</summary>
        public const float EyeHeight = 1.62f;
        /// <summary>Three.js 版 VM_SCALE：第一人称枪模（连同手臂）的缩放</summary>
        public const float ViewmodelScale = 0.76f;

        /// <summary>
        /// 组装玩家：position = 脚底，rotation 只取水平朝向。place 缺省 = <see cref="GameDatabase.Place"/>。
        /// 返回时玩家已激活（运行时各组件的 Awake 已经跑完，Start 在下一帧）。
        /// </summary>
        public static PlayerRig Create(HeroDef hero, Vector3 position, Quaternion rotation, PrefabPlacer place = null)
        {
            if (hero == null) throw new ArgumentNullException(nameof(hero));
            place ??= GameDatabase.Place;
            var player = new GameObject("Player");
            player.SetActive(false);
            player.transform.SetPositionAndRotation(position, Quaternion.Euler(0, rotation.eulerAngles.y, 0));

            var eye = new GameObject("Eye").transform;
            eye.SetParent(player.transform, false);
            eye.localPosition = new Vector3(0, EyeHeight, 0);
            var cam = CreateCamera(eye, 0);
            var cc = player.AddComponent<CharacterController>();
            cc.height = 1.8f;
            cc.radius = 0.35f;
            cc.center = new Vector3(0, 0.9f, 0);
            cc.stepOffset = 0.45f;
            cc.slopeLimit = 45;
            cc.skinWidth = 0.04f;
            var motor = player.AddComponent<PlayerMotor>();
            motor.eye = eye;
            SetLayer(player, Layers.Character);
            eye.gameObject.layer = 0;
            cam.gameObject.layer = 0;
            foreach (Transform c in cam.transform) c.gameObject.layer = 0;

            // HeroStats 先挂：它在 Awake 里建属性表交给 PlayerVitals（执行顺序 −50，组件顺序也排在前面，两种激活顺序下都对）
            player.AddComponent<HeroStats>().Configure(hero.id, hero.maxHp, hero.maxShield, hero.moveSpeed);
            var vitals = player.AddComponent<PlayerVitals>();
            var weapons = player.AddComponent<WeaponController>();
            weapons.eye = cam;
            weapons.baseFov = cam.fieldOfView;
            weapons.startWeapon = hero.startWeapon;
            weapons.rigs = BuildWeaponRigs(hero, cam.transform, place);
            var feel = player.AddComponent<CameraFeel>();
            feel.cam = cam;
            var interactor = player.AddComponent<Interactor>();
            var skills = player.AddComponent<HeroSkills>();
            skills.heroId = hero.id;
            player.AddComponent<PlayerCarry>();
            player.SetActive(true);
            // 天赋（R2）在读回生命 / 护盾之前套上：之后才套的话，生命上限的天赋每进一关都会把差值当治疗补满一次。
            // 之后 StageLoaded / TalentSystem 再套一次是幂等的（属性表里已经一样就不动）。按开局锁定的快照（RunState.talents）；调试局用调试档（没有天赋）
            if (Application.isPlaying && RunState.Current != null)
                try { MetaSave.ApplyTalents(vitals.stats, RunState.Current); }
                catch (Exception e) { Debug.LogException(e); }

            return new PlayerRig
            {
                root = player, cam = cam, eye = eye, feel = feel, motor = motor, vitals = vitals, weapons = weapons, skills = skills, interactor = interactor, hero = hero,
            };
        }

        /// <summary>
        /// 主相机（竖直视角 70°、SMAA、后处理、音频监听）+ 叠加的枪模相机（60°，只渲染 FirstPerson 层，与 Three.js 版 viewCamera 一致），
        /// 挂在 parent 下 height 米处（缺省眼高；玩家的相机挂在 Eye 节点下，height = 0）。
        /// parent 是停用的玩家时，音频监听不会先在场景根上启用一下、和别的监听撞车。玩家的 FOV 运行时由 CameraFeel 按设置覆盖。
        /// </summary>
        public static Camera CreateCamera(Transform parent, float height = EyeHeight)
        {
            int fpLayer = Layers.FirstPerson;
            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            camGo.transform.SetParent(parent, false);
            camGo.transform.SetLocalPositionAndRotation(new Vector3(0, height, 0), Quaternion.identity);
            var cam = camGo.AddComponent<Camera>();
            cam.fieldOfView = 70f;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 1500f;
            cam.cullingMask = ~(1 << fpLayer);
            camGo.AddComponent<AudioListener>();
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;

            var vmGo = new GameObject("Viewmodel Camera");
            vmGo.transform.SetParent(camGo.transform, false);
            var vm = vmGo.AddComponent<Camera>();
            vm.fieldOfView = 60f;
            vm.nearClipPlane = 0.01f;
            vm.farClipPlane = 20f;
            vm.cullingMask = 1 << fpLayer;
            var vmData = vm.GetUniversalAdditionalCameraData();
            vmData.renderType = CameraRenderType.Overlay;
            vmData.renderShadows = false;
            vmData.renderPostProcessing = true;
            // 第一人称层没有采样深度图的着色器；渲染它时 SSAO / 贴花也不跑（ViewmodelCameraTrim）
            vmData.requiresDepthOption = CameraOverrideOption.Off;
            vmData.requiresColorOption = CameraOverrideOption.Off;
            data.cameraStack.Add(vm);
            return cam;
        }

        /// <summary>每把已登记武器一套第一人称 rig（初始武器在前，其余按武器表顺序；关卡截图取第一个 rig 当第一人称画面）</summary>
        public static WeaponController.Rig[] BuildWeaponRigs(HeroDef hero, Transform cam, PrefabPlacer place = null)
        {
            place ??= GameDatabase.Place;
            var rigs = new List<WeaponController.Rig>();
            foreach (var def in WeaponOrder(hero))
            {
                var view = BuildWeaponRig(def, hero, cam, place);
                if (view) rigs.Add(new WeaponController.Rig { weaponId = def.id, view = view });
            }
            return rigs.ToArray();
        }

        /// <summary>初始武器在前，其余按武器表顺序</summary>
        public static List<WeaponDef> WeaponOrder(HeroDef hero)
        {
            var list = new List<WeaponDef>();
            var start = WeaponLibrary.Get(hero.startWeapon);
            if (start != null) list.Add(start);
            foreach (var def in WeaponLibrary.All)
                if (def != start) list.Add(def);
            return list;
        }

        /// <summary>
        /// 一把枪的第一人称 rig（W4 起由 <see cref="WeaponRigFactory.Build"/> 搭：枪模 + 英雄手臂 + 持握与换弹动画）。
        /// 没有枪模 Prefab 时返回 null（这把枪没有第一人称画面）。
        /// </summary>
        public static FirstPersonViewmodel BuildWeaponRig(WeaponDef def, HeroDef hero, Transform cam, PrefabPlacer place = null) =>
            WeaponRigFactory.Build(def, hero, cam, place);

        public static void SetLayer(GameObject go, int layer)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
        }

        /// <summary>运行时 Destroy，编辑模式（构建器）DestroyImmediate</summary>
        public static void Kill(Object o)
        {
            if (!o) return;
            if (Application.isPlaying) Object.Destroy(o);
            else Object.DestroyImmediate(o);
        }

        // ───────────── Game Systems ─────────────

        /// <summary>
        /// 「Game Systems」物体：射击特效、HUD、会话、掉落；core = 常驻 Core 场景用（再挂 <see cref="SceneFlow"/>，会话由它驱动），
        /// 否则是旧式「玩家烘进关卡」的场景（测试场）用。[GameSystem] 组件运行时由 <see cref="SystemsBootstrap"/> 补挂，这里不挂。
        /// 先停用再挂组件：运行时搭 Core（没生成 Core.unity 时的兜底）也能让 GameSession.Awake 看到同物体上的 SceneFlow。
        /// 物体在当前活动场景里（调用方按需移到别的场景）；activate = false 时返回停用的物体，由调用方挪好场景再激活。
        /// </summary>
        public static GameObject CreateSystems(bool core, bool activate = true)
        {
            var systems = new GameObject(SystemsBootstrap.ObjectName);
            systems.SetActive(false);
            systems.AddComponent<ShotFx>();
            var hud = systems.AddComponent<Hud>();
            var session = systems.AddComponent<GameSession>();
            session.hud = hud;
            systems.AddComponent<LootDirector>();
            if (core) systems.AddComponent<SceneFlow>();
            if (activate) systems.SetActive(true);
            return systems;
        }

        /// <summary>
        /// 把玩家接到 Game Systems 上：HUD 的相机 / 生命 / 武器 / 移动（含 Canvas 的渲染相机）、会话的玩家引用、技能栏
        /// （技能栏绑的是具体技能对象，每个玩家重建一份：旧的组件和它在 HUD 上的「Skills」面板一起删掉）。
        /// </summary>
        public static void Bind(GameObject systems, PlayerRig p)
        {
            if (!systems || p == null) return;
            var hud = systems.GetComponent<Hud>();
            if (hud)
            {
                hud.cam = p.cam;
                hud.vitals = p.vitals;
                hud.weapons = p.weapons;
                hud.motor = p.motor;
                if (hud.Root && hud.Root.TryGetComponent<Canvas>(out var canvas)) canvas.worldCamera = p.cam;
            }
            var session = systems.GetComponent<GameSession>();
            if (session)
            {
                session.player = p.vitals;
                session.motor = p.motor;
                if (hud) session.hud = hud;
            }
            foreach (var old in systems.GetComponents<SkillHud>()) Kill(old);
            if (hud && hud.Root)
            {
                var panel = hud.Root.Find("Skills");
                if (panel) Kill(panel.gameObject);
            }
            systems.AddComponent<SkillHud>().skills = p.skills;
        }
    }

    /// <summary>
    /// 玩家身上其余要跨关的状态（<see cref="IRunPersistent"/>，D15 / 4.6）：秘卷层数 + 生命 / 护盾。武器、灵宠各自实现 IRunPersistent。
    /// 秘卷清单在 <see cref="LootDirector"/> 的 <see cref="ScrollInventory"/>（Core 场景常驻），效果装在玩家的属性表上，每关换了新玩家要重新装：
    /// 清单和 RunState.scrolls 一样（同一局换关）→ <see cref="ScrollInventory.Rebind"/>（保留各卷跨叠层的状态）；
    /// 不一样（重来本关回到快照、新开一局）→ <see cref="ScrollInventory.Restore(RunState, PlayerVitals)"/>（先清空再按层数装，不发获得事件）。
    /// 生命 / 护盾在秘卷之后恢复（上限可能来自秘卷；天赋在 <see cref="PlayerFactory.Create"/> 里已经先套好），夹到 [1, 上限]；RunState.hp &lt; 0 表示满。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PlayerCarry : MonoBehaviour, IRunPersistent
    {
        PlayerVitals vitals;

        void Awake() => vitals = GetComponent<PlayerVitals>();
        void OnEnable() => RunPersistence.Register(this);
        void OnDisable() => RunPersistence.Unregister(this);

        static ScrollInventory Scrolls => LootDirector.Instance ? LootDirector.Instance.scrolls : null;

        public void Capture(RunState s)
        {
            if (vitals)
            {
                s.hp = vitals.Dead ? -1 : vitals.health;
                s.shield = vitals.Dead ? -1 : vitals.shield;
            }
            Scrolls?.Capture(s);
        }

        public void Restore(RunState s)
        {
            var inv = Scrolls;
            if (inv != null && vitals)
            {
                if (Same(inv, s.scrolls)) inv.Rebind(vitals);
                else inv.Restore(s, vitals);
            }
            if (!vitals) return;
            if (s.hp >= 0) vitals.health = Mathf.Clamp(s.hp, 1, vitals.MaxHealth);
            if (s.shield >= 0) vitals.shield = Mathf.Clamp(s.shield, 0, vitals.MaxShield);
        }

        static bool Same(ScrollInventory inv, Dictionary<string, int> saved)
        {
            int n = saved?.Count ?? 0;
            if (inv.Count != n) return false;
            if (n == 0) return true;
            foreach (var kv in saved)
                if (inv.Stacks(kv.Key) != kv.Value) return false;
            return true;
        }
    }
}
