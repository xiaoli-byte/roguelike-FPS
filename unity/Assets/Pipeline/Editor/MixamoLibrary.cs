using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 人形动画库：作者从 Mixamo 下载的 FBX（Without Skin、30 fps、In Place）放进 Assets/Art/Animations/Mixamo，
    /// 文件名以状态名开头（Idle / Walk / Run / Attack / Hit / Death，如 Attack_Slash.fbx）。
    /// 导入为 Humanoid（Mixamo 骨架自动映射），循环与根运动锁定按状态名设置；
    /// <see cref="BuildController"/> 生成所有人形资产共用的 AC_Humanoid（缺哪个片段，该状态就空着，补上后重新 Sync 即可）。
    /// </summary>
    public static class MixamoLibrary
    {
        public const string Folder = "Assets/Art/Animations/Mixamo";
        public const string ControllerPath = "Assets/Art/Animations/AC_Humanoid.controller";

        /// <summary>状态名 → 是否循环。顺序即 Animator 里的状态。</summary>
        public static readonly (string state, bool loop)[] States =
        {
            ("Idle", true), ("Walk", true), ("Run", true), ("Attack", false), ("Hit", false), ("Death", false),
        };

        static string StateOf(string assetPath)
        {
            string n = Path.GetFileNameWithoutExtension(assetPath).ToLowerInvariant();
            foreach (var (state, _) in States)
                if (n.StartsWith(state.ToLowerInvariant())) return state;
            return null;
        }

        public static void Preprocess(ModelImporter mi)
        {
            mi.animationType = ModelImporterAnimationType.Human;
            mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
            mi.autoGenerateAvatarMappingIfUnspecified = true;
            mi.importAnimation = true;
            mi.materialImportMode = ModelImporterMaterialImportMode.None;
            mi.importCameras = false;
            mi.importLights = false;
            mi.importBlendShapes = false;
            mi.bakeAxisConversion = false;
            mi.animationCompression = ModelImporterAnimationCompression.Optimal;
            mi.resampleCurves = true;
        }

        /// <summary>在 OnPreprocessAnimation 里调用：此时 defaultClipAnimations 才有内容。</summary>
        public static void PreprocessClips(ModelImporter mi)
        {
            string state = StateOf(mi.assetPath);
            bool loop = States.FirstOrDefault(s => s.state == state).loop;
            var clips = mi.defaultClipAnimations;
            if (clips == null || clips.Length == 0) return;
            foreach (var c in clips)
            {
                c.name = state ?? Path.GetFileNameWithoutExtension(mi.assetPath);
                c.loopTime = loop;
                c.loopPose = loop;
                // 原地动画：根旋转 / 高度 / 水平位移都烘进姿势，位移交给玩法代码
                c.lockRootRotation = true;
                c.keepOriginalOrientation = true;
                c.lockRootHeightY = true;
                c.keepOriginalPositionY = true;
                c.heightFromFeet = false;
                c.lockRootPositionXZ = true;
                c.keepOriginalPositionXZ = true;
            }
            mi.clipAnimations = clips;
        }

        public static Dictionary<string, AnimationClip> FindClips()
        {
            var result = new Dictionary<string, AnimationClip>();
            if (!AssetDatabase.IsValidFolder(Folder)) return result;
            foreach (var guid in AssetDatabase.FindAssets("t:Model", new[] { Folder }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                string state = StateOf(path);
                if (state == null || result.ContainsKey(state)) continue;
                var clip = AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>()
                    .FirstOrDefault(c => !c.name.StartsWith("__preview__"));
                if (clip) result[state] = clip;
            }
            return result;
        }

        /// <summary>重建 AC_Humanoid：Locomotion 混合树（Speed 0 / 1.6 / 4.5 米每秒）+ 攻击 / 受击 / 死亡。</summary>
        public static AnimatorController BuildController()
        {
            EnsureFolder(Path.GetDirectoryName(ControllerPath)!.Replace('\\', '/'));
            EnsureFolder(Folder);
            var clips = FindClips();
            AssetDatabase.DeleteAsset(ControllerPath);
            var ac = AnimatorController.CreateAnimatorControllerAtPath(ControllerPath);
            ac.AddParameter("Speed", AnimatorControllerParameterType.Float);
            ac.AddParameter("Attack", AnimatorControllerParameterType.Trigger);
            ac.AddParameter("Hit", AnimatorControllerParameterType.Trigger);
            ac.AddParameter("Dead", AnimatorControllerParameterType.Bool);
            var sm = ac.layers[0].stateMachine;

            var loco = ac.CreateBlendTreeInController("Locomotion", out var tree, 0);
            tree.blendType = BlendTreeType.Simple1D;
            tree.blendParameter = "Speed";
            tree.useAutomaticThresholds = false;
            foreach (var (state, speed) in new[] { ("Idle", 0f), ("Walk", 1.6f), ("Run", 4.5f) })
                if (clips.TryGetValue(state, out var c)) tree.AddChild(c, speed);
            sm.defaultState = loco;

            AnimatorState Make(string name, Vector3 pos)
            {
                var s = sm.AddState(name, pos);
                if (clips.TryGetValue(name, out var c)) s.motion = c;
                return s;
            }

            var attack = Make("Attack", new Vector3(300, 0, 0));
            var hit = Make("Hit", new Vector3(300, 100, 0));
            var death = Make("Death", new Vector3(300, 200, 0));

            var toAttack = loco.AddTransition(attack);
            toAttack.AddCondition(AnimatorConditionMode.If, 0, "Attack");
            toAttack.hasExitTime = false;
            toAttack.duration = 0.1f;
            var back = attack.AddTransition(loco);
            back.hasExitTime = true;
            back.exitTime = 0.9f;
            back.duration = 0.15f;

            var anyHit = sm.AddAnyStateTransition(hit);
            anyHit.AddCondition(AnimatorConditionMode.If, 0, "Hit");
            anyHit.AddCondition(AnimatorConditionMode.IfNot, 0, "Dead");
            anyHit.hasExitTime = false;
            anyHit.duration = 0.05f;
            var hitBack = hit.AddTransition(loco);
            hitBack.hasExitTime = true;
            hitBack.exitTime = 0.85f;
            hitBack.duration = 0.15f;

            var anyDeath = sm.AddAnyStateTransition(death);
            anyDeath.AddCondition(AnimatorConditionMode.If, 0, "Dead");
            anyDeath.hasExitTime = false;
            anyDeath.canTransitionToSelf = false;
            anyDeath.duration = 0.1f;

            EditorUtility.SetDirty(ac);
            AssetDatabase.SaveAssets();
            var missing = States.Select(s => s.state).Where(s => !clips.ContainsKey(s)).ToList();
            if (missing.Count > 0)
                Debug.LogWarning($"[Art] AC_Humanoid 缺少动画片段：{string.Join(", ", missing)}（把 Mixamo FBX 放进 {Folder} 后重新 Sync）");
            return ac;
        }

        public static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            string parent = Path.GetDirectoryName(path)!.Replace('\\', '/');
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }
    }
}
