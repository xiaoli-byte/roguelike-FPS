using System.Collections.Generic;
using Spiritfire.Game;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 关卡里的可玩玩家：角色控制器 + PlayerMotor + PlayerVitals + WeaponController + HUD + 会话，
    /// 第一人称每把枪一套 rig（枪模 + 英雄手臂，握点按 Three.js 版 WeaponHandling），切枪时只切换显示。
    /// 英雄与武器都从注册表读（<see cref="Registry{T}"/>：Skills/Heroes/Hero_*.cs、Weapons/Defs/Weapon_*.cs）。
    /// rig 与掉落模型的顺序：初始武器在前，其余按武器表顺序（关卡截图取第一个 rig 当第一人称画面）。
    /// </summary>
    public static class PlayerRigBuilder
    {
        /// <summary>燎（爆竹游侠）：Three.js 版 heroes fox，红熊猫美术</summary>
        public static HeroDef Liao => Hero("fox");

        /// <summary>按 id 取英雄；没有则报错</summary>
        public static HeroDef Hero(string id) =>
            Registry<HeroDef>.Get(id) ?? throw new System.ArgumentException($"[PlayerRig] 没有英雄 {id}（Skills/Heroes/Hero_*.cs）");

        public static GameObject Build(ShowcaseTheme theme, string heroId, Vector3 position, Quaternion rotation, string stageTitle, out Camera cam) =>
            Build(theme, Hero(heroId), position, rotation, stageTitle, out cam);

        public static GameObject Build(ShowcaseTheme theme, HeroDef hero, Vector3 position, Quaternion rotation, string stageTitle, out Camera cam)
        {
            cam = ShowcaseSceneBuilder.BuildCameras(theme, out var showcaseRig);
            Object.DestroyImmediate(showcaseRig);
            cam.farClipPlane = 1500;

            var player = new GameObject("Player");
            player.transform.SetPositionAndRotation(position, rotation);
            var cc = player.AddComponent<CharacterController>();
            cc.height = 1.8f;
            cc.radius = 0.35f;
            cc.center = new Vector3(0, 0.9f, 0);
            cc.stepOffset = 0.45f;
            cc.slopeLimit = 45;
            cc.skinWidth = 0.04f;
            var motor = player.AddComponent<PlayerMotor>();
            cam.transform.SetParent(player.transform, false);
            cam.transform.localPosition = new Vector3(0, 1.62f, 0);
            cam.transform.localRotation = Quaternion.identity;
            motor.eye = cam.transform;
            ShowcaseSceneBuilder.SetLayer(player, Layers.Character);
            cam.gameObject.layer = 0;
            foreach (Transform c in cam.transform) c.gameObject.layer = 0;

            var vitals = player.AddComponent<PlayerVitals>();
            var weapons = player.AddComponent<WeaponController>();
            weapons.eye = cam;
            weapons.baseFov = cam.fieldOfView;
            weapons.startWeapon = hero.startWeapon;
            var weaponDefs = WeaponOrder(hero);
            var rigs = new List<WeaponController.Rig>();
            foreach (var def in weaponDefs)
            {
                var view = BuildWeaponRig(def, hero, cam.transform);
                if (view) rigs.Add(new WeaponController.Rig { weaponId = def.id, view = view });
            }
            weapons.rigs = rigs.ToArray();
            player.AddComponent<HeroStats>().Configure(hero.id, hero.maxHp, hero.maxShield, hero.moveSpeed);
            player.AddComponent<Interactor>();
            var skills = player.AddComponent<HeroSkills>();
            skills.heroId = hero.id;

            var systems = new GameObject("Game Systems");
            systems.AddComponent<ShotFx>();
            var hud = systems.AddComponent<Hud>();
            hud.cam = cam;
            hud.vitals = vitals;
            hud.weapons = weapons;
            hud.motor = motor;
            var session = systems.AddComponent<GameSession>();
            session.player = vitals;
            session.motor = motor;
            session.hud = hud;
            session.stageTitle = stageTitle;
            systems.AddComponent<SkillHud>().skills = skills;
            systems.AddComponent<LootDirector>();
            // 地上的枪的世界模型（运行时拿不到 AssetDatabase）
            var models = new List<GameObject>();
            foreach (var def in weaponDefs)
            {
                var prefab = ShowcaseSceneBuilder.Prefab(def.prefab);
                if (prefab) models.Add(prefab);
            }
            systems.AddComponent<LootCatalog>().weaponModels = models.ToArray();
            return player;
        }

        /// <summary>初始武器在前，其余按武器表顺序</summary>
        static List<WeaponDef> WeaponOrder(HeroDef hero)
        {
            var list = new List<WeaponDef>();
            var start = WeaponLibrary.Get(hero.startWeapon);
            if (start != null) list.Add(start);
            foreach (var def in WeaponLibrary.All)
                if (def != start) list.Add(def);
            return list;
        }

        static FirstPersonViewmodel BuildWeaponRig(WeaponDef def, HeroDef hero, Transform cam)
        {
            if (!ShowcaseSceneBuilder.Prefab(def.prefab)) return null;
            var rig = new GameObject($"FP Rig {def.id}");
            rig.transform.SetParent(cam, false);
            var vm = rig.AddComponent<FirstPersonViewmodel>();
            // Three.js：腰射 = viewOffset + HIP_SHIFT(0.024, −0.02)，开镜 = aimOffset × VM_SCALE
            vm.hipOffset = def.viewHip + new Vector3(0.024f, -0.02f, 0);
            vm.aimOffset = def.viewAim * 0.76f;
            rig.transform.localPosition = vm.hipOffset;
            rig.transform.localRotation = Quaternion.Euler(0, 180, 0);

            var gun = ShowcaseSceneBuilder.Place(def.prefab, rig.transform, Vector3.zero, 0, 0.76f);
            if (gun)
            {
                var r = ShowcaseSceneBuilder.Place(hero.armR, gun.transform, def.rightHand);
                if (r) r.transform.localRotation = Quaternion.Euler(def.rightPitch * Mathf.Rad2Deg, 0, 0);
                var l = ShowcaseSceneBuilder.Place(hero.armL, gun.transform, def.leftHand);
                if (l) l.transform.localRotation = Quaternion.Euler(0, 0, -def.leftRoll * Mathf.Rad2Deg);
            }
            foreach (var lg in rig.GetComponentsInChildren<LODGroup>(true))
            {
                var lods = lg.GetLODs();
                for (int i = 1; i < lods.Length; i++)
                    foreach (var rr in lods[i].renderers) if (rr) rr.enabled = false;
                Object.DestroyImmediate(lg);
            }
            foreach (var c in rig.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(c);
            foreach (var rr in rig.GetComponentsInChildren<Renderer>(true)) rr.shadowCastingMode = ShadowCastingMode.Off;
            ShowcaseSceneBuilder.SetLayer(rig, Layers.FirstPerson);
            rig.SetActive(def.id == hero.startWeapon);
            return vm;
        }
    }
}
