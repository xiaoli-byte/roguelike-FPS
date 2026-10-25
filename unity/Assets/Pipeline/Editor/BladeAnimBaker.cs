using System.Collections.Generic;
using Spiritfire.Game;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 碎刃第一人称的三段斩剪辑（WC7；bridge.sh blade 的第 6 步，也可单独走菜单）：用运行时同一份 <see cref="BladeSwingClip"/>（代码生成）存成
    /// Assets/Art/Weapons/SK_Weapon_DemonBlade/Anim/AN_DemonBlade_Slash{1,2,3}.anim——刀姿曲线（Sway/Unflip/Hold 的局部位置 / 旋转）、伸刃倍率（BladeView.clipStretch）
    /// 与三个动画事件（OnBladeWindup / OnBladeStrike / OnBladeRecover，判定帧在武器表的 windup 秒）。
    /// 运行时 <see cref="BladeView"/> 自己按武器表现场生成同样的剪辑（武器表改了不用重烘也对得上），这里的资产给审阅、预览和以后接 Animator 用。
    /// 幂等：已有资产原地覆盖内容（GUID 不变）。返回错误数。
    /// </summary>
    public static class BladeAnimBaker
    {
        public const string AnimDir = BladeMeshBaker.Dir + "/Anim";

        [MenuItem("Spiritfire/Weapons/Bake Demon Blade Slash Clips（碎刃三段斩剪辑）", priority = 121)]
        static void Menu()
        {
            int errors = Bake(out var log);
            foreach (var l in log) Debug.Log("[Blade] " + l);
            EditorUtility.DisplayDialog("碎刃三段斩剪辑", errors == 0 ? "已生成" : $"完成，但有 {errors} 个问题（见 Console）", "好");
        }

        /// <summary>按武器表的三段斩生成剪辑资产；返回错误数</summary>
        public static int Bake(out List<string> log)
        {
            log = new List<string>();
            int errors = 0;
            if (!AssetDatabase.IsValidFolder(AnimDir)) AssetDatabase.CreateFolder(BladeMeshBaker.Dir, "Anim");
            var combo = (WeaponLibrary.Get(DemonBladeDef.WeaponId)?.blade ?? DemonBladeDef.CreateSpec()).combo;
            for (int i = 0; i < combo.Length; i++)
            {
                var c = new BladeSwingClip(i, combo[i], false);
                string path = $"{AnimDir}/{c.clip.name}.anim";
                var existing = AssetDatabase.LoadAssetAtPath<AnimationClip>(path);
                AnimationClip target;
                if (existing)
                {
                    EditorUtility.CopySerialized(c.clip, existing);
                    Object.DestroyImmediate(c.clip);
                    target = existing;
                }
                else
                {
                    AssetDatabase.CreateAsset(c.clip, path);
                    target = c.clip;
                }
                AnimationUtility.SetAnimationEvents(target, c.Events);
                var settings = AnimationUtility.GetAnimationClipSettings(target);
                settings.loopTime = false;
                AnimationUtility.SetAnimationClipSettings(target, settings);
                EditorUtility.SetDirty(target);
                if (!Mathf.Approximately(AnimationUtility.GetAnimationEvents(target)[1].time, combo[i].windup))
                {
                    errors++;
                    Debug.LogError($"[Blade] {path} 的判定帧事件不在 windup（{combo[i].windup} s）");
                }
                log.Add($"剪辑 → {path}（{c.duration:F2} s，判定帧 {c.strikeTime:F3} s，伸刃 ×{c.slashStretch:F1}）");
            }
            AssetDatabase.SaveAssets();
            return errors;
        }
    }
}
