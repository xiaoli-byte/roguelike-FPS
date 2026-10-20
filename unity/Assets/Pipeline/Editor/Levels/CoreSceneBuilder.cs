using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 常驻 Core 场景 + 运行时 Prefab 目录（docs/unity-parity.md 4.6 / D17，L1）：
    ///   · <see cref="BuildDatabase"/>：Assets/Game/Resources/GameDatabase.asset——武器模型、英雄手臂、敌人本体与挂件（运行时没有 AssetDatabase，
    ///     <see cref="PlayerFactory"/>、<see cref="EnemyCatalog"/>、<see cref="LootCatalog"/> 从这里取）；新武器 / 英雄 / 敌人登记后重新生成即可；
    ///   · <see cref="Build"/>：Assets/Scenes/Core.unity——只有 Game Systems（射击特效、HUD、会话、掉落、<see cref="SceneFlow"/>），
    ///     内容由运行时代码 <see cref="PlayerFactory.CreateSystems"/> 搭（没生成 Core.unity 时运行时兜底搭的是同一份）。
    ///     玩家由 SceneFlow 在每关的 PlayerSpawn 运行时组装，[GameSystem] 组件运行时自动补挂，所以这个场景几乎不用重建。
    ///     Core 没有灯光：关卡叠加进来后设为活动场景，光照、雾、天空都跟着关卡走；换关途中（黑幕下）Core 是活动场景，关雾、暗环境光。
    ///   最后整理构建设置：Core 排第 0（打包后从它启动），关卡按 RunPlan 顺序排在后面（<see cref="LevelBuilders.SyncBuildSettings"/>）。
    /// 生成：Spiritfire ▸ Levels ▸ Build Core Scene，或 bridge.sh core（levels 也会先跑它）。
    /// </summary>
    public static class CoreSceneBuilder
    {
        public const string ScenePath = SceneFlow.CorePath;
        const string AttachmentsDir = "Assets/Art/Prefabs/Attachments";

        [MenuItem("Spiritfire/Levels/Build Core Scene（常驻场景 + GameDatabase）", priority = 59)]
        static void BuildMenu() => Build();

        [MenuItem("Spiritfire/Levels/Rebuild GameDatabase", priority = 59)]
        static void DatabaseMenu() => BuildDatabase();

        /// <summary>生成 GameDatabase → Core.unity → 整理构建设置；报告写 Assets/Art/_Review/core_report.txt，返回不合格项数</summary>
        public static int Build()
        {
            ShowcaseSceneBuilder.ConfigureProject();
            var rep = new LevelKit.Report();
            rep.Line("Core 常驻场景 · 生成报告");
            BuildDatabase(rep);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            // Core 只在换关的黑幕下是活动场景：不要雾、不要天空，环境光压暗
            RenderSettings.fog = false;
            RenderSettings.skybox = null;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.05f, 0.05f, 0.05f);
            var systems = PlayerFactory.CreateSystems(true);
            EditorSceneManager.SaveScene(scene, ScenePath);

            LevelBuilders.SyncBuildSettings();
            var order = EditorBuildSettings.scenes.Select(s => s.path).ToList();
            rep.Line($"Game Systems：{string.Join("、", systems.GetComponents<MonoBehaviour>().Select(c => c.GetType().Name))}（[GameSystem] 组件运行时补挂）");
            if (order.Count == 0 || order[0] != ScenePath) rep.Fail($"构建设置第 0 个场景不是 {ScenePath}（现在是 {(order.Count > 0 ? order[0] : "空")}）");
            else rep.Line($"✓ 构建设置：{string.Join(" → ", order.Select(Path.GetFileNameWithoutExtension))}");
            foreach (var st in RunPlan.Stages)
                if (File.Exists(st.scene) && !order.Contains(st.scene)) rep.Fail($"{st.Label} 的场景 {st.scene} 不在构建设置里");
            rep.Line(rep.failures == 0 ? "全部通过" : $"不合格 {rep.failures} 项");
            rep.Save($"{LevelKit.ReviewDir}/core_report.txt");
            return rep.failures;
        }

        /// <summary>
        /// 重新生成 GameDatabase（幂等：内容没变时资产文件也不变）：武器表里每把枪的模型、每位英雄的手臂（另收 Art/Prefabs 下全部 SM_Arms_*）、
        /// 名册里每种敌人的本体、Attachments 下带 bindAttachment 的挂件。缺的 Prefab 记进报告（运行时：枪没有第一人称画面 / 敌人用占位体）
        /// </summary>
        public static GameDatabase BuildDatabase(LevelKit.Report rep = null)
        {
            var db = AssetDatabase.LoadAssetAtPath<GameDatabase>(GameDatabase.AssetPath);
            if (!db)
            {
                db = ScriptableObject.CreateInstance<GameDatabase>();
                Directory.CreateDirectory(Path.GetDirectoryName(GameDatabase.AssetPath)!);
                AssetDatabase.CreateAsset(db, GameDatabase.AssetPath);
            }
            var missing = new List<string>();
            GameObject[] Collect(IEnumerable<string> ids, string what)
            {
                var list = new List<GameObject>();
                foreach (var id in ids.Where(i => !string.IsNullOrEmpty(i)).Distinct())
                {
                    var prefab = ShowcaseSceneBuilder.Prefab(id);
                    if (!prefab) missing.Add($"{what} {id}");
                    else if (!list.Contains(prefab)) list.Add(prefab);
                }
                return list.ToArray();
            }

            db.weapons = Collect(WeaponLibrary.All.Select(d => d.prefab), "武器");
            var armIds = HeroLibrary.All.SelectMany(h => new[] { h.armR, h.armL })
                .Concat(AssetDatabase.FindAssets("SM_Arms_ t:Prefab", new[] { "Assets/Art/Prefabs" })
                    .Select(g => Path.GetFileNameWithoutExtension(AssetDatabase.GUIDToAssetPath(g)))
                    .Where(n => n.StartsWith("SM_Arms_"))
                    .OrderBy(n => n, System.StringComparer.Ordinal));
            db.arms = Collect(armIds, "手臂");
            // 名册敌人 + 首领（首领不进名册：各形态的正式模型与代理模型，外加美术库里所有 SK_Boss_* 本体，换上正式美术不用改代码）
            var bossIds = Bosses.All.SelectMany(b => b.forms).SelectMany(f => new[] { f.prefab, f.proxyPrefab })
                .Concat(AssetDatabase.FindAssets("t:Prefab SK_Boss_")
                    .Select(g => Path.GetFileNameWithoutExtension(AssetDatabase.GUIDToAssetPath(g)))
                    .Where(n => n.StartsWith("SK_Boss_")));
            db.enemies = Collect(EnemyRoster.All.Select(d => d.prefab).Concat(bossIds)
                .Where(n => !string.IsNullOrEmpty(n)).Distinct(), "敌人 / 首领");
            db.attachments = AssetDatabase.IsValidFolder(AttachmentsDir)
                ? AssetDatabase.FindAssets("t:Prefab", new[] { AttachmentsDir })
                    .Select(g => AssetDatabase.LoadAssetAtPath<GameObject>(AssetDatabase.GUIDToAssetPath(g)))
                    .Where(g => g && g.GetComponent<ArtAssetInfo>() && !string.IsNullOrEmpty(g.GetComponent<ArtAssetInfo>().bindAttachment))
                    .OrderBy(g => g.name, System.StringComparer.Ordinal)
                    .ToArray()
                : System.Array.Empty<GameObject>();
            db.Invalidate();
            EditorUtility.SetDirty(db);
            AssetDatabase.SaveAssets();
            GameDatabase.Override(null);

            var line = $"GameDatabase：武器 {db.weapons.Length}/{WeaponLibrary.All.Count}、手臂 {db.arms.Length}、敌人 {db.enemies.Length}/{EnemyRoster.All.Count}、挂件 {db.attachments.Length}";
            if (rep != null)
            {
                rep.Line(line);
                if (missing.Count > 0) rep.Line($"  缺 Prefab（运行时：枪没有第一人称画面 / 敌人用占位体）：{string.Join("、", missing)}");
            }
            else
            {
                Debug.Log($"[Core] {line}");
                if (missing.Count > 0) Debug.LogWarning($"[Core] GameDatabase 缺 Prefab：{string.Join("、", missing)}");
            }
            return db;
        }
    }
}
