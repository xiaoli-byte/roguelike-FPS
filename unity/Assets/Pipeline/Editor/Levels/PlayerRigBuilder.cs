using System.Collections.Generic;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 编辑器里的玩家搭建：组装逻辑本身在运行时代码 <see cref="PlayerFactory"/>（Core 场景每进一关运行时组装一次，与这里同一份实现），
    /// 这里只把 Prefab 来源换成 AssetDatabase（<see cref="EditorPlace"/>：烘进场景的物体保留 Prefab 连接）。两种用法：
    ///   · <see cref="Build"/>：旧式「玩家 + Game Systems 烘进关卡场景」（测试场还在用）；
    ///   · <see cref="BuildPreview"/>：关卡审核截图用的机位（相机 + 初始武器的第一人称 rig），截完删掉——
    ///     L1 起关卡场景只放环境和标记（PlayerSpawn…），玩家、HUD、各系统在常驻的 Core 场景（<see cref="CoreSceneBuilder"/>）。
    /// 英雄与武器都从注册表读（<see cref="Registry{T}"/>：Skills/Heroes/Hero_*.cs、Weapons/Defs/Weapon_*.cs）。
    /// </summary>
    public static class PlayerRigBuilder
    {
        /// <summary>燎（爆竹游侠）：Three.js 版 heroes fox，红熊猫美术</summary>
        public static HeroDef Liao => Hero(HeroLibrary.DefaultHero);

        /// <summary>按 id 取英雄；没有则报错</summary>
        public static HeroDef Hero(string id) =>
            Registry<HeroDef>.Get(id) ?? throw new System.ArgumentException($"[PlayerRig] 没有英雄 {id}（Skills/Heroes/Hero_*.cs）");

        /// <summary>编辑器的 <see cref="PrefabPlacer"/>：按美术 id 找 Assets/Art/Prefabs 下的 Prefab，实例化时保留 Prefab 连接；没有则警告并返回 null</summary>
        public static GameObject EditorPlace(string id, Transform parent)
        {
            var prefab = ShowcaseSceneBuilder.Prefab(id);
            if (!prefab)
            {
                Debug.LogWarning($"[PlayerRig] 缺少 Prefab {id}（先 unity_export.py 导出，再 Spiritfire ▸ Art ▸ Sync All）");
                return null;
            }
            return (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
        }

        public static GameObject Build(ShowcaseTheme theme, string heroId, Vector3 position, Quaternion rotation, string stageTitle, out Camera cam) =>
            Build(theme, Hero(heroId), position, rotation, stageTitle, out cam);

        /// <summary>
        /// 旧式：可玩玩家 + Game Systems（HUD、会话、掉落、射击特效、技能栏）烘进当前场景，另带一份掉落用的武器模型目录。
        /// theme 保留给旧调用方（相机不再随主题变化）。
        /// </summary>
        public static GameObject Build(ShowcaseTheme theme, HeroDef hero, Vector3 position, Quaternion rotation, string stageTitle, out Camera cam)
        {
            var rig = PlayerFactory.Create(hero, position, rotation, EditorPlace);
            cam = rig.cam;
            var systems = PlayerFactory.CreateSystems(false);
            systems.GetComponent<GameSession>().stageTitle = stageTitle;
            PlayerFactory.Bind(systems, rig);
            // 地上的枪的世界模型：旧式场景自带目录（Core 流程用 GameDatabase）
            var models = new List<GameObject>();
            foreach (var def in PlayerFactory.WeaponOrder(hero))
            {
                var prefab = ShowcaseSceneBuilder.Prefab(def.prefab);
                if (prefab && !models.Contains(prefab)) models.Add(prefab);
            }
            systems.AddComponent<LootCatalog>().weaponModels = models.ToArray();
            return rig.root;
        }

        /// <summary>
        /// 审核截图机位：脚底在 position、朝 rotation 的相机（与玩家同一套主相机 + 枪模相机）+ 初始武器的第一人称 rig，没有任何玩法组件。
        /// 返回根物体，截完由调用方 DestroyImmediate，不留在关卡场景里。
        /// </summary>
        public static GameObject BuildPreview(HeroDef hero, Vector3 position, Quaternion rotation, out Camera cam, out GameObject fpRig)
        {
            var root = new GameObject("Review Camera (temp)");
            root.transform.SetPositionAndRotation(position, Quaternion.Euler(0, rotation.eulerAngles.y, 0));
            cam = PlayerFactory.CreateCamera(root.transform);
            var start = WeaponLibrary.Get(hero.startWeapon);
            var vm = start != null ? PlayerFactory.BuildWeaponRig(start, hero, cam.transform, EditorPlace) : null;
            fpRig = vm ? vm.gameObject : null;
            return root;
        }
    }
}
