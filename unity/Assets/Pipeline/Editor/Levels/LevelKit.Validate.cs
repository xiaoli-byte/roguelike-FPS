using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.AI;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 验收：检查报告（主线连通、地标可见、坡度）与审核截图。归 L5。
    public static partial class LevelKit
    {
        public sealed class Report
        {
            readonly StringBuilder sb = new();
            public int failures;

            public void Line(string s)
            {
                sb.AppendLine(s);
                Debug.Log($"[Level] {s}");
            }

            public void Fail(string s)
            {
                failures++;
                Line($"✗ {s}");
            }

            public void Save(string path)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllText(path, sb.ToString());
            }
        }

        /// <summary>主线连通：相邻路点两两求 NavMesh 路径，必须完整（PathComplete），并报告路径长度与「绕路系数」</summary>
        public static void CheckPath(Report rep, (string name, Vector3 pos)[] waypoints)
        {
            float total = 0;
            for (int i = 0; i + 1 < waypoints.Length; i++)
            {
                var (an, a) = waypoints[i];
                var (bn, b) = waypoints[i + 1];
                if (!NavMesh.SamplePosition(a, out var ha, 4, NavMesh.AllAreas) || !NavMesh.SamplePosition(b, out var hb, 4, NavMesh.AllAreas))
                {
                    rep.Fail($"路点不在 NavMesh 上：{an} 或 {bn}");
                    continue;
                }
                var path = new NavMeshPath();
                NavMesh.CalculatePath(ha.position, hb.position, NavMesh.AllAreas, path);
                float len = 0;
                for (int k = 0; k + 1 < path.corners.Length; k++) len += Vector3.Distance(path.corners[k], path.corners[k + 1]);
                float straight = Vector3.Distance(ha.position, hb.position);
                if (path.status != NavMeshPathStatus.PathComplete) rep.Fail($"{an} → {bn} 不连通（{path.status}）");
                else rep.Line($"✓ {an} → {bn}：路径 {len:F0} m（直线 {straight:F0} m，绕路 ×{len / Mathf.Max(1, straight):F2}），约 {len / 7.5f:F0} 秒");
                total += len;
            }
            rep.Line($"主线总长 {total:F0} m，约 {total / 7.5f:F0} 秒（不含战斗）");
        }

        /// <summary>地标可见：从入口眼高向地标连线，中途没有被地形 / 体块挡住（终点附近 tolerance 米内的命中算看到了地标本身）</summary>
        /// <param name="landmark">地标资产 ID：视线先打到它（任一实例）也算看到了地标</param>
        public static void CheckSight(Report rep, string what, Vector3 eye, Vector3 target, float tolerance = 4f, string landmark = null)
        {
            int mask = ~(1 << 2);
            int fp = LayerMask.NameToLayer(ShowcaseSceneBuilder.FirstPersonLayer);
            if (fp >= 0) mask &= ~(1 << fp);
            Physics.SyncTransforms();
            bool blocked = Physics.Linecast(eye, target, out var hit, mask, QueryTriggerInteraction.Ignore) && Vector3.Distance(hit.point, target) > tolerance;
            if (blocked && landmark != null && hit.collider.name.StartsWith(landmark))
                rep.Line($"✓ {what}：可见（视线落在 {landmark} 上，{hit.distance:F0} m）");
            else if (blocked)
                rep.Fail($"{what}：看不到（被 {hit.collider.name} 挡住，距起点 {hit.distance:F0} m，地标 {Vector3.Distance(eye, target):F0} m）");
            else rep.Line($"✓ {what}：可见（{Vector3.Distance(eye, target):F0} m）");
        }

        /// <summary>沿主线采样坡度：超过 maxSlope 的路段算不合格（玩家走不上去、NavMesh 也会断）</summary>
        public static void CheckRoadSlope(Report rep, Terrain t, IReadOnlyList<Vector2> road, float maxSlope = 24f)
        {
            int bad = 0, n = 0;
            float worst = 0;
            Vector2 worstAt = default;
            for (int i = 0; i + 1 < road.Count; i++)
            {
                var a = road[i];
                var b = road[i + 1];
                float len = Vector2.Distance(a, b);
                for (float s = 0; s < len; s += 1f)
                {
                    var p = Vector2.Lerp(a, b, s / len);
                    var q = Vector2.Lerp(a, b, Mathf.Min(1, (s + 1f) / len));
                    float dh = GroundY(t, q.x, q.y) - GroundY(t, p.x, p.y);
                    float run = Vector2.Distance(p, q);
                    if (run < 0.3f) continue;
                    float slope = Mathf.Atan(Mathf.Abs(dh) / run) * Mathf.Rad2Deg;
                    n++;
                    if (slope > maxSlope) bad++;
                    if (slope > worst) { worst = slope; worstAt = p; }
                }
            }
            if (bad > 0) rep.Fail($"古道有 {bad}/{n} m 坡度超过 {maxSlope}°（最陡 {worst:F0}° @ ({worstAt.x:F0}, {worstAt.y:F0})）");
            else rep.Line($"✓ 古道坡度：最陡 {worst:F0}° @ ({worstAt.x:F0}, {worstAt.y:F0})，全程 ≤ {maxSlope}°");
        }

        // ───────────── 审核截图 ─────────────
        /// <summary>按机位截图；名字以 "Map" / "Aerial" 开头的高空机位临时关雾（否则几百米外全被雾吞掉）</summary>
        public static void Capture(Camera cam, GameObject fpRig, string prefix, (string name, Vector3 pos, Vector3 target, bool firstPerson)[] views)
        {
            Directory.CreateDirectory(ReviewDir);
            var rt = new RenderTexture(1920, 1080, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
            var shot = new Texture2D(1920, 1080, TextureFormat.RGB24, false);
            var parent = cam.transform.parent;
            var local = (cam.transform.localPosition, cam.transform.localRotation);
            bool fpWas = fpRig && fpRig.activeSelf, fogWas = RenderSettings.fog;
            bool wasAsync = ShaderUtil.allowAsyncCompilation;
            foreach (var ps in Object.FindObjectsByType<ParticleSystem>()) ps.Simulate(14f, true, true);
            try
            {
                ShaderUtil.allowAsyncCompilation = false;
                cam.transform.SetParent(null, true);
                cam.targetTexture = rt;
                for (int pass = 0; pass < 2; pass++)
                for (int i = 0; i < views.Length; i++)
                {
                    var (name, pos, target, fp) = views[i];
                    if (fpRig) fpRig.SetActive(fp);
                    RenderSettings.fog = fogWas && !(name.StartsWith("Map") || name.StartsWith("Aerial"));
                    cam.transform.SetPositionAndRotation(pos, Quaternion.LookRotation(target - pos));
                    cam.Render();
                    if (pass == 0) continue;
                    RenderTexture.active = rt;
                    shot.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
                    shot.Apply();
                    RenderTexture.active = null;
                    string path = $"{ReviewDir}/{prefix}_{i + 1}_{name}.png";
                    File.WriteAllBytes(path, shot.EncodeToPNG());
                    Debug.Log($"[Review] {path}");
                }
            }
            finally
            {
                ShaderUtil.allowAsyncCompilation = wasAsync;
                RenderSettings.fog = fogWas;
                cam.targetTexture = null;
                cam.transform.SetParent(parent, false);
                cam.transform.SetLocalPositionAndRotation(local.localPosition, local.localRotation);
                if (fpRig) fpRig.SetActive(fpWas);
                Object.DestroyImmediate(rt);
                Object.DestroyImmediate(shot);
            }
        }
    }
}
