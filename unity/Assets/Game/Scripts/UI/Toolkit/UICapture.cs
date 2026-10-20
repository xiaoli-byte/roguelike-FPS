using System;
using System.Collections;
using System.IO;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 截图拍到 UI Toolkit（docs/unity-parity.md 3.12「截图只拍到相机，拍不到 UI Toolkit」/ 7.3 UI 验收）。
    /// UI Toolkit 的叠层面板在相机之后直接画到屏幕上，URP 只在「相机画到屏幕」时叠 UI——冒烟测试的截图是把相机渲染到 RenderTexture，
    /// 所以拍不到提示 / 横幅 / 黑幕 / 界面（uGUI HUD 是 Screen Space - Camera，跟着相机画，拍得到）。
    /// 做法：照旧先用相机拍一张（同步，镜头被临时挪开拍特写也对），有看得见的 UI Toolkit 内容、而且这台相机就是画到屏幕上的那台时，
    /// 再在本帧末尾（WaitForEndOfFrame，此时屏幕上是完整的一帧）抓屏覆盖同一个文件——前提是镜头这一帧里没被挪过
    /// （特写拍完马上还原镜头的那种，抓屏会拍成还原后的画面，就保留相机那张）。抓到全黑（编辑器 Game 视图被挡住 / 没刷新）也保留相机那张。
    /// 能 yield 的地方直接用 <see cref="CaptureScreen"/>。
    /// </summary>
    public static class UICapture
    {
        struct CamPose
        {
            public Vector3 position;
            public Quaternion rotation;
            public float fov;
            public int mask;

            public bool Same(CamPose o) =>
                (position - o.position).sqrMagnitude < 1e-8f && Quaternion.Angle(rotation, o.rotation) < 0.01f && Mathf.Approximately(fov, o.fov) && mask == o.mask;
        }

        static CamPose PoseOf(Camera cam) => new()
        {
            position = cam.transform.position, rotation = cam.transform.rotation, fov = cam.fieldOfView, mask = cam.cullingMask,
        };

        /// <summary>这台相机的截图要不要再抓一次屏：相机画在屏幕上，且有看得见的 UI Toolkit 内容</summary>
        public static bool WantsScreen(Camera cam) =>
            cam && cam.isActiveAndEnabled && cam.targetTexture == null && UIRoot.Instance && UIRoot.Instance.HasVisibleContent;

        /// <summary>
        /// 帧末抓屏覆盖 path（镜头这一帧没动、抓到的不是全黑才覆盖）；log 收一行结果。
        /// 由调用方 StartCoroutine（冒烟测试的 Shot 在同步代码里调用，不能 yield）
        /// </summary>
        public static IEnumerator UpgradeAtEndOfFrame(Camera cam, string path, Action<string> log)
        {
            var pose = PoseOf(cam);
            int frame = Time.frameCount;
            yield return new WaitForEndOfFrame();
            string name = Path.GetFileName(path);
            if (!cam || Time.frameCount != frame || !pose.Same(PoseOf(cam)))
            {
                log?.Invoke($"  {name}：镜头在本帧被挪动过，保留相机渲染（不含 UI Toolkit 叠层）");
                yield break;
            }
            var tex = ScreenCapture.CaptureScreenshotAsTexture();
            try
            {
                if (!tex || tex.width < 16)
                {
                    log?.Invoke($"  {name}：抓屏失败，保留相机渲染");
                    yield break;
                }
                bool curtain = UIRoot.Instance && UIRoot.Instance.Curtain.Value > 0.98f;
                if (!curtain && IsBlack(tex))
                {
                    log?.Invoke($"  {name}：抓屏是全黑（Game 视图没在画？），保留相机渲染");
                    yield break;
                }
                File.WriteAllBytes(path, tex.EncodeToPNG());
                log?.Invoke($"  {name}：改为屏幕抓取 {tex.width}×{tex.height}（含 UI Toolkit 叠层）");
            }
            finally
            {
                if (tex) UnityEngine.Object.Destroy(tex);
            }
        }

        /// <summary>帧末抓整个屏幕存到 path（能 yield 的测试步骤里用：yield return UICapture.CaptureScreen(…)）</summary>
        public static IEnumerator CaptureScreen(string path, Action<string> log = null)
        {
            yield return new WaitForEndOfFrame();
            var tex = ScreenCapture.CaptureScreenshotAsTexture();
            if (!tex)
            {
                log?.Invoke($"  {Path.GetFileName(path)}：抓屏失败");
                yield break;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
            File.WriteAllBytes(path, tex.EncodeToPNG());
            log?.Invoke($"截图 {Path.GetFileName(path)}（屏幕 {tex.width}×{tex.height}，含 UI Toolkit 叠层）");
            UnityEngine.Object.Destroy(tex);
        }

        /// <summary>抽 32×18 个点，最亮的通道都不到 3/255 就算全黑</summary>
        static bool IsBlack(Texture2D tex)
        {
            for (int y = 0; y < 18; y++)
            for (int x = 0; x < 32; x++)
            {
                var c = tex.GetPixel((int)((x + 0.5f) / 32 * tex.width), (int)((y + 0.5f) / 18 * tex.height));
                if (c.r > 0.012f || c.g > 0.012f || c.b > 0.012f) return false;
            }
            return true;
        }
    }
}
