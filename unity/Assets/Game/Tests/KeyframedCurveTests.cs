using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Spiritfire.Game.Tests
{
    /// <summary>
    /// 人形手 K 片段里非人形骨（长发 / 残衣 / 袖垂片，运行时是 CreatureRig 的弹簧骨）的关键帧留没留下、播不播得动
    /// （docs/art/boss-hanba.md §8「长发回垂与 Unity 的缺口」）：
    ///   · 资产：旱魃（人形，Copy From Other Avatar）每段手 K 片段都带三条发链、残衣、袖垂片的变换曲线（NativeClipBuilder.KeepNonHumanCurves 的 Transform 遮罩），
    ///     本体 Avatar 的骨架里有这些骨（人形 Animator 才会写它们）；
    ///   · 播放：按 Prefab 实例化，在编辑器里按人形 Animator 采样死亡 / 焦裂片段（hanba_anims.py 只在前倾姿势里给发链根节加回垂）——发链根节点的局部朝向跟片段里的关键帧走（≤ 1.5°），
    ///     而且确实离开了绑定姿势（回垂补偿是有幅度的，不是「没曲线所以停在绑定姿势」碰巧对上）。
    ///   · 弹簧骨以这个动画姿势为目标（CreatureRig.Springs 每帧读 Tip），所以关键帧一播得动，补偿就在弹簧之下生效。
    /// </summary>
    public sealed class KeyframedCurveTests
    {
        const string HanbaPrefab = "Assets/Art/Prefabs/Characters/SK_Boss_Hanba.prefab";
        const string HanbaAnimDir = "Assets/Art/Characters/SK_Boss_Hanba/Anim";
        const string HanbaFbx = "Assets/Art/Characters/SK_Boss_Hanba/SK_Boss_Hanba.fbx";
        static readonly string[] SpringRoots = { "hair_C1", "hair_L1", "hair_R1", "skirt_F1", "skirt_B1", "sleeve_L1", "sleeve_R1" };
        static readonly string[] HanbaStates = { "Idle", "intro", "sunSweep", "droughtGale", "summonWraiths", "crackPalm", "apsaraCall", "eclipse", "Hit", "death" };

        static AnimationClip Clip(string state) => AssetDatabase.LoadAssetAtPath<AnimationClip>($"{HanbaAnimDir}/SK_Boss_Hanba_{state}.anim");

        static IEnumerable<EditorCurveBinding> RotationBindings(AnimationClip clip, string bone) =>
            AnimationUtility.GetCurveBindings(clip).Where(b => b.type == typeof(Transform) && (b.path == bone || b.path.EndsWith("/" + bone)) &&
                                                               b.propertyName.StartsWith("m_LocalRotation."));

        [Test]
        public void HanbaKeyframedClips_KeepSpringBoneCurves()
        {
            var avatar = AssetDatabase.LoadAllAssetsAtPath(HanbaFbx).OfType<Avatar>().FirstOrDefault(a => a.isHuman);
            Assert.IsTrue(avatar, "旱魃本体没有人形 Avatar");
            var skeleton = avatar.humanDescription.skeleton.Select(s => s.name).ToHashSet();
            foreach (var bone in SpringRoots)
                Assert.IsTrue(skeleton.Contains(bone), $"本体 Avatar 的骨架里没有 {bone}：人形 Animator 不会写它");
            foreach (var state in HanbaStates)
            {
                var clip = Clip(state);
                Assert.IsTrue(clip, $"缺片段 SK_Boss_Hanba_{state}.anim（先 bridge.sh sync）");
                Assert.IsTrue(clip.humanMotion, $"{state} 不是人形片段");
                foreach (var bone in SpringRoots)
                    Assert.AreEqual(4, RotationBindings(clip, bone).Count(), $"{state}：{bone} 的旋转曲线被丢了（人形片段没配 Transform 遮罩？）");
            }
        }

        [TestCase("death", "hair_C1")]
        [TestCase("death", "hair_L1")]
        [TestCase("crackPalm", "hair_C1")]
        public void HanbaKeyframedHair_DrivesBoneAtRuntime(string state, string bone)
        {
            var clip = Clip(state);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HanbaPrefab);
            Assert.IsTrue(clip && prefab, "缺片段 / Prefab");
            var curves = RotationBindings(clip, bone).OrderBy(b => b.propertyName).ToArray();
            Assert.AreEqual(4, curves.Length, $"{state} 里没有 {bone} 的旋转曲线");
            // 按 w / x / y / z 排好
            AnimationCurve C(string axis) => AnimationUtility.GetEditorCurve(clip, curves.First(b => b.propertyName.EndsWith("." + axis)));
            AnimationCurve cx = C("x"), cy = C("y"), cz = C("z"), cw = C("w");
            Quaternion Want(float t) => new Quaternion(cx.Evaluate(t), cy.Evaluate(t), cz.Evaluate(t), cw.Evaluate(t)).normalized;

            var go = Object.Instantiate(prefab);
            try
            {
                var anim = go.GetComponentInChildren<Animator>();
                Assert.IsTrue(anim && anim.avatar && anim.avatar.isHuman, "Prefab 上没有人形 Animator");
                var t = anim.GetComponentsInChildren<Transform>(true).FirstOrDefault(x => x.name == bone);
                Assert.IsTrue(t, $"Prefab 里没有 {bone}");
                var bind = t.localRotation;
                // 对照：人形骨（右上臂 / 脊柱）在同样的时刻确实动了——说明确实在按人形片段求值，不是整只停在绑定姿势
                var arm = anim.GetBoneTransform(HumanBodyBones.RightUpperArm);
                var spine = anim.GetBoneTransform(HumanBodyBones.Spine);
                Assert.IsTrue(arm && spine, "人形 Avatar 没映射右上臂 / 脊柱");
                var armBind = arm.localRotation;
                var spineBind = spine.localRotation;
                // 取片段里离绑定姿势最远的几个关键帧时刻来比
                var times = cw.keys.Select(k => k.time).Concat(cx.keys.Select(k => k.time)).Distinct()
                    .OrderByDescending(x => Quaternion.Angle(Want(x), bind)).Take(3).ToArray();
                // 编辑器里按人形 Animator 采样（动画窗口预览那条路：肌肉曲线经 Avatar 重定向，非人形骨的变换曲线照写）。
                // EditMode 下 PlayableGraph.Evaluate 不写骨骼（人形骨也不动），所以这里用 AnimationMode；Play 模式下真实 Animator 的核对在 review-glow 套件里
                AnimationMode.StartAnimationMode();
                float maxDev = 0, maxErr = 0, humanDev = 0, wantDev = 0;
                foreach (float time in times)
                {
                    AnimationMode.BeginSampling();
                    AnimationMode.SampleAnimationClip(anim.gameObject, clip, time);
                    AnimationMode.EndSampling();
                    var got = t.localRotation;
                    maxErr = Mathf.Max(maxErr, Quaternion.Angle(got, Want(time)));
                    maxDev = Mathf.Max(maxDev, Quaternion.Angle(got, bind));
                    wantDev = Mathf.Max(wantDev, Quaternion.Angle(Want(time), bind));
                    humanDev = Mathf.Max(humanDev, Mathf.Max(Quaternion.Angle(arm.localRotation, armBind), Quaternion.Angle(spine.localRotation, spineBind)));
                }
                Assert.Greater(humanDev, 5f, $"{state}：人形骨也没动（{humanDev:F1}°），采样没生效");
                Assert.Greater(maxDev, 5f, $"{state} 播到关键帧时 {bone} 几乎没离开绑定姿势（{maxDev:F1}°，关键帧要求 {wantDev:F1}°）：曲线没在播");
                Assert.Less(maxErr, 1.5f, $"{state} 里 {bone} 没跟关键帧走（最大差 {maxErr:F1}°）");
            }
            finally
            {
                if (AnimationMode.InAnimationMode()) AnimationMode.StopAnimationMode();
                Object.DestroyImmediate(go);
            }
        }
    }
}
