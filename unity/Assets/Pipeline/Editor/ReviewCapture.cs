using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 审核截图：逐个打开章节样板场景，按 Viewpoints 逐个机位渲染 1920×1080（含后处理与枪模叠加相机），
    /// 写到 Assets/Art/_Review/showcase_&lt;章节&gt;_&lt;序号&gt;_&lt;机位&gt;.png（不入库）。人形角色有 Idle 片段时先采样到 Idle 姿势。
    ///   批处理：-executeMethod Spiritfire.Art.Editor.ReviewCapture.BatchAll（Sync → 建三章场景 → 截图）
    /// </summary>
    public static class ReviewCapture
    {
        public const string OutDir = "Assets/Art/_Review";

        [MenuItem("Spiritfire/Showcase/Capture Review Shots (All Scenes)", priority = 40)]
        public static void CaptureAll()
        {
            foreach (var t in ShowcaseTheme.All.Where(t => File.Exists(t.ScenePath))) Capture(t);
        }

        public static void Capture(ShowcaseTheme theme)
        {
            EditorSceneManager.OpenScene(theme.ScenePath);
            var camCtl = Object.FindFirstObjectByType<ShowcaseCamera>();
            var cam = camCtl.GetComponent<Camera>();
            Directory.CreateDirectory(OutDir);

            // 截图前把每个角色摆到它控制器默认状态（Idle）的姿势；没有专属片段的人形用 Mixamo Idle
            var mixamo = MixamoLibrary.FindClips();
            var poses = new List<(GameObject go, AnimationClip clip)>();
            foreach (var a in Object.FindObjectsByType<Animator>(FindObjectsSortMode.None))
            {
                var ctl = a.runtimeAnimatorController as UnityEditor.Animations.AnimatorController;
                var clip = ctl ? ctl.layers[0].stateMachine.defaultState?.motion as AnimationClip : null;
                if (!clip && a.isHuman) mixamo.TryGetValue("Idle", out clip);
                if (clip) poses.Add((a.gameObject, clip));
            }
            bool sampling = poses.Count > 0;
            if (sampling)
            {
                AnimationMode.StartAnimationMode();
                AnimationMode.BeginSampling();
                foreach (var (go, clip) in poses) AnimationMode.SampleAnimationClip(go, clip, clip.length * 0.3f);
                AnimationMode.EndSampling();
            }

            var rt = new RenderTexture(1920, 1080, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
            var shot = new Texture2D(1920, 1080, TextureFormat.RGB24, false);
            var start = (cam.transform.position, cam.transform.rotation);
            bool wasAsync = ShaderUtil.allowAsyncCompilation;
            try
            {
                // 预热：第一帧会触发着色器变体编译与 LOD / 阴影初始化，先每个机位渲染一遍再截图
                ShaderUtil.allowAsyncCompilation = false;
                cam.targetTexture = rt;
                for (int pass = 0; pass < 2; pass++)
                for (int i = 0; i < camCtl.viewpoints.childCount; i++)
                {
                    var vp = camCtl.viewpoints.GetChild(i);
                    camCtl.firstPersonRig.SetActive(vp.name == "First Person");
                    cam.transform.SetPositionAndRotation(vp.position, vp.rotation);
                    cam.Render();
                    if (pass == 0) continue;
                    RenderTexture.active = rt;
                    shot.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
                    shot.Apply();
                    RenderTexture.active = null;
                    string path = $"{OutDir}/showcase_{theme.key}_{i + 1}_{vp.name.Replace(' ', '_')}.png";
                    File.WriteAllBytes(path, shot.EncodeToPNG());
                    Debug.Log($"[Review] {path}");
                }
            }
            finally
            {
                ShaderUtil.allowAsyncCompilation = wasAsync;
                cam.targetTexture = null;
                camCtl.firstPersonRig.SetActive(camCtl.firstPerson);
                cam.transform.SetPositionAndRotation(start.position, start.rotation);
                if (sampling) AnimationMode.StopAnimationMode();
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(shot);
            }
        }

        public static void BatchCapture()
        {
            CaptureAll();
            EditorApplication.Exit(0);
        }

        /// <summary>只改了场景 / 主题时：重建三章场景 → 截图（不重新 Sync 资产）。</summary>
        public static void BatchScenes()
        {
            ShowcaseSceneBuilder.BuildAll();
            CaptureAll();
            EditorApplication.Exit(0);
        }

        /// <summary>一条命令跑完：Sync → 建三章场景 → 截图（QA 有错误时仍然出图，退出码 1）。</summary>
        public static void BatchAll()
        {
            ArtSync.Sync(out int errors);
            ShowcaseSceneBuilder.BuildAll();
            CaptureAll();
            EditorApplication.Exit(errors > 0 ? 1 : 0);
        }
    }
}
