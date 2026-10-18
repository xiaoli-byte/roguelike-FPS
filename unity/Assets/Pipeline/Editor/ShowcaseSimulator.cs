using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 不进 Play 模式、在编辑器里逐帧模拟样板场景（30 fps）：ShowcaseActor.Tick → Animator.Update → CreatureRig.Tick → 物理，
    /// 在指定时刻渲染成一张多格动作图，用来验证运行时动画层：坡上脚步贴地、骨盆升降、看向镜头、方向性受击、布娃娃倒地与复活。
    /// 写到 Assets/Art/_Review/motion_&lt;章节&gt;_&lt;机位&gt;.png。批处理：-executeMethod Spiritfire.Art.Editor.ShowcaseSimulator.BatchMotion
    /// </summary>
    public static class ShowcaseSimulator
    {
        const float Dt = 1f / 30f;
        const int TileW = 640, TileH = 360, Cols = 4;

        /// <summary>演示周期 10 秒：0.18–0.5 走圈（大半圈在坡上）、0.56 出招、0.86 受击；第 3 个周期（20–30 秒）在 28.6 秒倒下</summary>
        static readonly float[] Times = { 1.0f, 2.4f, 3.2f, 4.0f, 4.8f, 6.0f, 8.7f, 8.9f, 18.7f, 28.75f, 29.2f, 29.9f };

        public static void BatchMotion()
        {
            foreach (var t in ShowcaseTheme.All.Where(t => File.Exists(t.ScenePath)))
                foreach (bool ik in new[] { false, true }) Simulate(t, ik);
            EditorApplication.Exit(0);
        }

        /// <summary>
        /// 近景机位：英雄与腿最多的那只怪，各一个低机位侧面（看脚与坡面）。ik = false 时关掉脚步 IK 跑一遍做对照，
        /// 两次都统计支撑相脚掌离地面的误差（射线测真实地面），写进日志与 motion_&lt;章节&gt;_metrics.txt。
        /// </summary>
        public static void Simulate(ShowcaseTheme theme, bool ik)
        {
            EditorSceneManager.OpenScene(theme.ScenePath);
            var all = Object.FindObjectsByType<ShowcaseActor>(FindObjectsSortMode.None);
            var subjects = all.Where(a => a.GetComponent<ArtAssetInfo>()?.bindSource == "hero").Take(1)
                .Concat(all.Where(a => a.GetComponentInChildren<CreatureRig>()).OrderByDescending(a => a.GetComponentInChildren<CreatureRig>().legs.Length).Take(1))
                .Distinct().ToList();
            // 机位：斜前方、低机位，从角色排的外侧拍（角色排里左右都有别的角色，侧面正对会被挡住）；对准走圈的中点（坡上）
            var views = subjects.Select(a =>
            {
                var info = a.GetComponent<ArtAssetInfo>();
                float h = info ? Mathf.Max(0.8f, info.designBounds.size.y) : 1.5f;
                float w = info ? Mathf.Max(info.designBounds.size.x, info.designBounds.size.z) : 1f;
                float r = Mathf.Clamp(w * 0.55f, 0.5f, 2f);
                float side = a.transform.position.x >= 0 ? 1f : -1f;
                var focus = a.transform.position + a.transform.forward * r + Vector3.up * (h * 0.3f);
                float d = Mathf.Max(h, w) * 2.2f + 1f;
                var pos = focus + new Vector3(side * d * 0.55f, h * 0.25f + 0.2f, -d * 0.85f);
                return (name: (ik ? "" : "noik_") + a.name.Replace("SK_", ""), pos, target: focus);
            }).ToArray();
            foreach (var r in Object.FindObjectsByType<CreatureRig>(FindObjectsSortMode.None)) r.feetIK = ik;
            var cam = Object.FindFirstObjectByType<ShowcaseCamera>().GetComponent<Camera>();
            var fp = Object.FindFirstObjectByType<ShowcaseCamera>().firstPersonRig;
            if (fp) fp.SetActive(false);
            var actors = Object.FindObjectsByType<ShowcaseActor>(FindObjectsSortMode.None);
            foreach (var a in actors)
            {
                a.Init();
                var an = a.GetComponentInChildren<Animator>();
                if (an) { an.Rebind(); an.Update(0); }
            }
            if (!ik) File.Delete($"{ReviewCapture.OutDir}/motion_{theme.key}_metrics.txt"); // 每章先跑「IK 关」，重新开始记录
            Physics.simulationMode = SimulationMode.Script;
            bool wasAsync = ShaderUtil.allowAsyncCompilation;
            ShaderUtil.allowAsyncCompilation = false;

            var rt = new RenderTexture(TileW, TileH, 24, RenderTextureFormat.ARGB32);
            var tile = new Texture2D(TileW, TileH, TextureFormat.RGB24, false);
            int rows = (Times.Length + Cols - 1) / Cols;
            var sheets = views.ToDictionary(v => v.name, _ => new Texture2D(TileW * Cols, TileH * rows, TextureFormat.RGB24, false));
            var events = new List<string>();
            var errors = new List<float>();
            var perActor = new Dictionary<string, List<float>>();
            foreach (var a in actors)
            {
                var rig = a.GetComponentInChildren<CreatureRig>();
                if (rig) rig.AnimEvent += n => events.Add($"{a.name}:{n}");
            }
            try
            {
                cam.targetTexture = rt;
                cam.Render(); // 预热
                float time = 0;
                int next = 0;
                while (next < Times.Length)
                {
                    foreach (var a in actors)
                    {
                        a.Tick(Dt);
                        var loco = a.GetComponent<CreatureLocomotion>();
                        if (loco) loco.Tick(Dt);
                        var an = a.GetComponentInChildren<Animator>();
                        if (an && an.enabled) an.Update(Dt);
                        var rig = a.GetComponentInChildren<CreatureRig>();
                        if (rig && rig.enabled) rig.Tick(Dt);
                    }
                    Physics.SyncTransforms();
                    Physics.Simulate(Dt);
                    time += Dt;
                    foreach (var rig in Object.FindObjectsByType<CreatureRig>(FindObjectsSortMode.None))
                    {
                        if (!rig.enabled) continue;
                        foreach (var leg in rig.legs)
                        {
                            if (!leg.end || !leg.locked && ik) continue;
                            var f = leg.end.position;
                            if (f.y - rig.characterRoot.position.y - leg.restLift > rig.legLength * 0.08f && !ik) continue; // 无 IK 时按动画的贴地帧算
                            if (!Physics.Raycast(f + Vector3.up * rig.legLength, Vector3.down, out var hit, rig.legLength * 3f, rig.groundMask)) continue;
                            float err = f.y - hit.point.y - leg.restLift; // 踝骨本来就在脚底以上 restLift
                            errors.Add(err);
                            string who = rig.characterRoot ? rig.characterRoot.name : rig.name;
                            if (!perActor.TryGetValue(who, out var pl)) perActor[who] = pl = new List<float>();
                            pl.Add(err);

                        }
                    }
                    if (time + 1e-4f < Times[next]) continue;
                    var proxies = actors.SelectMany(a => AnimReviewSheet.BakeProxies(a.gameObject)).ToList();
                    foreach (var (name, pos, target) in views)
                    {
                        cam.transform.SetPositionAndRotation(pos, Quaternion.LookRotation(target - pos));
                        cam.Render();
                        RenderTexture.active = rt;
                        tile.ReadPixels(new Rect(0, 0, TileW, TileH), 0, 0);
                        RenderTexture.active = null;
                        int c = next % Cols, r = next / Cols;
                        sheets[name].SetPixels(c * TileW, (rows - 1 - r) * TileH, TileW, TileH, tile.GetPixels());
                    }
                    foreach (var p in proxies) { Object.DestroyImmediate(p.GetComponent<MeshFilter>().sharedMesh); Object.DestroyImmediate(p); }
                    foreach (var smr in actors.SelectMany(a => a.GetComponentsInChildren<SkinnedMeshRenderer>(true))) smr.forceRenderingOff = false;
                    next++;
                }
                Directory.CreateDirectory(ReviewCapture.OutDir);
                foreach (var (name, tex) in sheets)
                {
                    tex.Apply();
                    string path = $"{ReviewCapture.OutDir}/motion_{theme.key}_{name}.png";
                    File.WriteAllBytes(path, tex.EncodeToPNG());
                    Debug.Log($"[Motion] {path}");
                }
                if (ik) File.WriteAllText($"{ReviewCapture.OutDir}/motion_{theme.key}_events.txt", string.Join("\n", events));
                // 支撑相脚掌到地面的距离（米）：正 = 悬空、负 = 插进地里
                var abs = errors.Select(Mathf.Abs).OrderBy(x => x).ToList();
                string metric = abs.Count == 0 ? "无样本" :
                    $"样本 {abs.Count}：平均 {abs.Average() * 100:F1} cm，P95 {abs[(int)(abs.Count * 0.95f)] * 100:F1} cm，最大 {abs[^1] * 100:F1} cm，" +
                    $"悬空 >3cm {errors.Count(e => e > 0.03f) * 100f / errors.Count:F0}%，穿地 >3cm {errors.Count(e => e < -0.03f) * 100f / errors.Count:F0}%";
                Debug.Log($"[Motion] {theme.key} {(ik ? "IK 开" : "IK 关")} 支撑脚离地误差 {metric}");
                var detail = string.Join("\n", perActor.OrderByDescending(kv => kv.Value.Average(Mathf.Abs)).Select(kv =>
                    $"    {kv.Key}: 平均 {kv.Value.Average(Mathf.Abs) * 100:F1} cm，最大 {kv.Value.Max(Mathf.Abs) * 100:F1} cm（{kv.Value.Count}）"));
                File.AppendAllText($"{ReviewCapture.OutDir}/motion_{theme.key}_metrics.txt", $"{(ik ? "IK 开" : "IK 关")}: {metric}\n{detail}\n");
                Debug.Log($"[Motion] {theme.key}: 动画事件 {events.Count} 个：{string.Join(", ", events.GroupBy(e => e.Split(':', 2)[1]).Select(g => $"{g.Key}×{g.Count()}"))}");
            }
            finally
            {
                cam.targetTexture = null;
                ShaderUtil.allowAsyncCompilation = wasAsync;
                // 一律还原成 FixedUpdate：还原「开始时的值」会把一次中断留下的 Script 永远传下去（见 PhysicsSettingsGuard）
                Physics.simulationMode = SimulationMode.FixedUpdate;
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(tile);
                foreach (var t in sheets.Values) Object.DestroyImmediate(t);
            }
        }
    }
}
