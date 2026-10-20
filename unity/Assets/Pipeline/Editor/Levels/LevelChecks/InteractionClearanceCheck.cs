using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;
using UnityEngine.AI;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 交互净空（宝箱、传送门、商店摊位、灵兽封印…）：
    ///   自身：还没摆出来的物体（场地肃清后的宝箱）落点上放得下它的体积；
    ///   接近：交互半径内（同 Interaction.Pick：眼睛到焦点的距离 ≤ 半径）至少有一处玩家站得下、从出生点 NavMesh 走得到的位置；
    ///   只有一个方向能接近时提醒（被墙角夹住），所有接近位都看不见焦点时提醒。
    /// </summary>
    public sealed class InteractionClearanceCheck : ILevelCheck
    {
        public string Id => "interact";
        public string Title => "交互净空（宝箱 / 传送门 / 摊位）";
        public int Order => 60;

        public void Run(LevelContext ctx, LevelKit.Report rep)
        {
            var items = ctx.Interactables;
            if (items.Count == 0)
            {
                rep.Line("没有交互点，跳过");
                return;
            }
            var spawn = ctx.SpawnNav;
            var s = ctx.Scale;
            foreach (var it in items)
            {
                string label = $"{it.name}（{it.kind}）";
                var owned = it.owner ? new HashSet<Collider>(it.owner.GetComponentsInChildren<Collider>()) : new HashSet<Collider>();
                // 从焦点往下找地面（焦点上方可能有门楣、摊棚顶）
                float ground = LevelContext.GroundY(it.focus, 0.05f);
                var groundPt = new Vector3(it.focus.x, ground, it.focus.z);

                // ── 自身体积 ──
                if (it.footprint != Vector3.zero)
                {
                    var c = groundPt + Vector3.up * (it.footprint.y + 0.15f);
                    // 地形不算占位：坡地上箱子会贴地摆（Chest.Spawn 吸附地面），只查摆件、墙
                    var blockers = Physics.OverlapBox(c, it.footprint, Quaternion.identity, LevelContext.BlockMask, QueryTriggerInteraction.Ignore)
                        .Where(h => !owned.Contains(h) && h is not TerrainCollider).Select(h => h.name).Distinct().Take(3).ToList();
                    if (blockers.Count > 0)
                    {
                        rep.Fail($"{label} {LevelContext.At(groundPt)}：落点放不下（被 {string.Join("、", blockers)} 占着）");
                        continue;
                    }
                }

                // ── 接近位：8 个方向 × 3 个距离 ──
                float dy = Mathf.Abs(it.focus.y - (ground + s.eye));
                float rMax = Mathf.Sqrt(Mathf.Max(0, it.radius * it.radius - dy * dy)) * 0.92f;
                float rMin = Mathf.Max(0.8f, Mathf.Max(it.footprint.x, it.footprint.z) + s.radius + 0.1f);
                if (rMax < rMin)
                {
                    rep.Fail($"{label}：焦点离地 {it.focus.y - ground:F1} m，交互半径 {it.radius:F1} m 内站不到人");
                    continue;
                }
                int dirsOk = 0, seen = 0;
                float bestPath = float.MaxValue;
                for (int k = 0; k < 8; k++)
                {
                    var dir = Quaternion.Euler(0, k * 45, 0) * Vector3.forward;
                    bool dirOk = false;
                    foreach (float rr in new[] { rMin, (rMin + rMax) * 0.5f, rMax })
                    {
                        var c = groundPt + dir * rr;
                        if (!LevelContext.NavPoint(c, 1f, out var q)) continue;
                        if (Vector3.Distance(q + Vector3.up * s.eye, it.focus) > it.radius) continue;
                        var lo = q + Vector3.up * (s.radius + 0.3f);
                        var hi = q + Vector3.up * (s.height - s.radius);
                        if (Physics.OverlapCapsule(lo, hi, s.radius, LevelContext.BlockMask, QueryTriggerInteraction.Ignore).Any(h => !owned.Contains(h))) continue;
                        if (spawn != null)
                        {
                            if (LevelContext.NavPath(spawn.Value, q, out float len) != NavMeshPathStatus.PathComplete) continue;
                            bestPath = Mathf.Min(bestPath, len);
                        }
                        dirOk = true;
                        if (Visible(q + Vector3.up * s.eye, it.focus, owned, Mathf.Max(0.6f, it.radius * 0.3f))) seen++;
                        break;
                    }
                    if (dirOk) dirsOk++;
                }
                if (dirsOk == 0)
                {
                    rep.Fail($"{label} {LevelContext.At(groundPt)}：交互半径 {it.radius:F1} m 内没有站得下、走得到的位置" +
                             (spawn == null ? "（出生点不在 NavMesh 上）" : ""));
                    continue;
                }
                string path = bestPath < float.MaxValue ? $"，离出生点路径 {bestPath:F0} m" : "";
                if (dirsOk == 1) rep.Warn($"{label}：只有 1/8 个方向能接近（被夹在角落里？）{path}");
                else rep.Line($"✓ {label}：{dirsOk}/8 个方向可接近{path}");
                if (seen == 0) rep.Warn($"{label}：接近位都看不见交互焦点（被遮住，提示会让人找不到）");
            }
        }

        static bool Visible(Vector3 eye, Vector3 focus, HashSet<Collider> owned, float tolerance)
        {
            if (!Physics.Linecast(eye, focus, out var hit, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return true;
            return owned.Contains(hit.collider) || Vector3.Distance(hit.point, focus) <= tolerance;
        }
    }
}
