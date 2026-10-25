using System.Collections;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 罗盘条 / M 键全图 / 拾取对比卡冒烟（docs/unity-parity.md U7 + WC8；bridge.sh playtest map [场景]，默认 1-1；任何 [LevelBuilder] 关卡都能跑）：
    ///   · LevelMeta：关卡场景里有构建器写的「Level Meta」，俯视图贴图在（入库的 LevelMap_&lt;id&gt;.jpg），映射与 _Review 的 level_&lt;id&gt;_map.json 一致，地点的组件引用都在；
    ///   · 罗盘条：HUD 部件在、看得见；有目标；朝目标看时目标徽记落在带子正中、带子下面写「前往 · 名字」、显示距离；朝东看时朝向 ≈ 90°（「东」在正中）；
    ///   · 发现：瞬移到一处还没发现的地点旁边（有藏宝点就去藏宝点），它变成「已发现」并出现在罗盘上；
    ///   · 全图：UIRouter.Open("map") → 停时间、有底图、玩家在图上的 UV 等于 LevelMeta 的世界 → UV 映射、玩家箭头在图框里对应的像素上、目标和发现的地点都画出来；
    ///     按 M（路由 Back 同效）关掉后时间恢复；
    ///   · 拾取对比：脚边丢一把同款的传说枪 → 交互提示卡逐项对比手上那把，有 ▲ 行、写「（当前 …）」、末行写替换 / 放入空槽；
    ///   · 截图：map_compass（罗盘条 + 目标）、map_full（全图）、map_pickup（拾取对比卡）。
    /// </summary>
    public sealed class MapSuite : PlaytestSuite
    {
        public override string Id => "map";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Transform eye;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(2f);
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            weapons = FindAnyObjectByType<WeaponController>();
            var hud = Hud.Instance;
            if (!motor || !vitals || !weapons || !hud)
            {
                Fail($"缺少组件：motor={motor} vitals={vitals} weapons={weapons} hud={hud}");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            vitals.invulnerableUntil = Time.time + 99999;
            eye = weapons.Aim;

            // ── LevelMeta ──
            var meta = LevelMeta.Current;
            if (!meta)
            {
                Fail("当前关卡没有 LevelMeta（先 bridge.sh level <id> 重新生成）");
                yield break;
            }
            var kinds = meta.pois.GroupBy(p => p.kind).Select(g => $"{LevelMeta.KindName(g.Key)} {g.Count()}");
            Line($"LevelMeta：{meta.levelId}「{meta.title}」，贴图 {(meta.map ? $"{meta.map.name} {meta.map.width}×{meta.map.height}" : "无")}，" +
                 $"范围 X {meta.mapArea.xMin:F0}…{meta.mapArea.xMax:F0} × Z {meta.mapArea.yMin:F0}…{meta.mapArea.yMax:F0}，地点 {meta.pois.Length}（{string.Join("、", kinds)}）");
            if (!meta.HasMap) Fail("LevelMeta 没有俯视图贴图 / 范围");
            if (meta.pois.Length == 0) Fail("LevelMeta 没有地点");
            int missing = meta.pois.Count(p => !p.source);
            if (missing > 0) Fail($"LevelMeta 有 {missing} 个地点的组件引用丢了");
            if (meta.map && Mathf.Abs(meta.map.width / (float)meta.map.height - meta.mapArea.width / meta.mapArea.height) > 0.02f)
                Fail($"俯视图长宽比 {meta.map.width}×{meta.map.height} 和范围 {meta.mapArea.width:F0}×{meta.mapArea.height:F0} 对不上");
            CheckReviewJson(meta);

            // ── 罗盘条 ──
            var compass = hud.Widget<CompassStrip>();
            if (compass == null)
            {
                Fail("没有 HUD 部件「compass」");
                yield break;
            }
            yield return null;
            var target = MapMarkers.Target;
            Line($"罗盘：{(compass.Visible ? "显示" : "没显示")}，地点 {MapMarkers.All.Count}，目标 {(target != null ? $"{MapMarkers.TargetVerb} · {target.name}（{target.distance:F0} m）" : "无")}");
            if (!compass.Visible) Fail("罗盘条没显示");
            if (target == null) Fail("开局没有目标");
            else
            {
                Look(target.position);
                yield return Frames(3);
                var mark = compass.Shown.FirstOrDefault(s => s.target);
                Line($"朝目标看：徽记 x = {mark.x:F1}（应≈0），距离「{mark.distance}」，说明「{compass.Caption}」，朝向 {compass.Heading:F1}°");
                if (mark.name == null) Fail("罗盘条上没有目标徽记");
                else if (Mathf.Abs(mark.x) > 6) Fail($"正对目标时徽记偏离中心 {mark.x:F1} px");
                if (mark.name != null && !Regex.IsMatch(mark.distance ?? "", @"^\d+ 米$")) Fail($"目标距离文字不对：「{mark.distance}」");
                if (!compass.Caption.Contains(target.name)) Fail($"正对目标时带子下面没写目标名（「{compass.Caption}」）");
                yield return new WaitForSecondsRealtime(0.3f);
                Shot(weapons.eye, "map_compass");
            }
            motor.SetLook(90, 0);
            yield return Frames(3);
            Line($"朝东看：朝向 {compass.Heading:F1}°");
            if (Mathf.Abs(Mathf.DeltaAngle(compass.Heading, 90)) > 2) Fail($"朝东看时罗盘朝向 {compass.Heading:F1}°（应 90°）");

            // ── 发现 ──
            var probe = MapMarkers.All.FirstOrDefault(k => !k.discovered && k.kind == MapPoiKind.Cache && k != MapMarkers.Target)
                        ?? MapMarkers.All.FirstOrDefault(k => !k.discovered && k.kind is MapPoiKind.Site or MapPoiKind.Camp or MapPoiKind.Altar && k != MapMarkers.Target);
            if (probe == null) Line("发现：所有地点开局都已发现 / 是目标，跳过");
            else
            {
                var (f0, n0) = MapMarkers.Discovery();
                var near = probe.position + (vitals.transform.position - probe.position).WithY(0).normalized * 5f;
                Teleport(motor, near);
                Look(probe.position + Vector3.up * 0.6f);
                for (float t = 0; t < 2.5f && !probe.discovered; t += Time.deltaTime) yield return null;
                yield return Frames(2);
                var (f1, _) = MapMarkers.Discovery();
                bool onCompass = compass.Shown.Any(s => s.name == probe.name);
                Line($"发现「{probe.name}」（{LevelMeta.KindName(probe.kind)}）：{(probe.discovered ? "已发现" : "没发现")}，已发现 {f0} → {f1} / {n0}，罗盘上 {(onCompass ? "有" : "没有")}");
                if (!probe.discovered) Fail($"走到「{probe.name}」旁边 5 m 没有变成已发现");
                else if (!onCompass) Fail($"「{probe.name}」发现后没出现在罗盘上");
            }

            // ── 全图 ──
            float scale0 = Time.timeScale;
            UIRouter.Open(MapScreen.ScreenId);
            yield return new WaitForSecondsRealtime(0.5f);
            var map = UIRouter.Find(MapScreen.ScreenId) as MapScreen;
            if (map == null)
            {
                Fail("全图没打开");
                yield break;
            }
            var pos = vitals.transform.position;
            var want = meta.WorldToUV(pos);
            Line($"全图：「{map.TitleText}」，底图 {(map.HasImage ? "有" : "无")}，图框 {map.BoxSize.x:F0}×{map.BoxSize.y:F0}，玩家 UV {map.PlayerUV.x:F3},{map.PlayerUV.y:F3}（应 {want.x:F3},{want.y:F3}），" +
                 $"地点 {map.Marks.Count()}，{map.TargetText}，时间 ×{Time.timeScale:F1}");
            if (!map.HasImage) Fail("全图没有底图");
            if (Vector2.Distance(map.PlayerUV, want) > 0.002f) Fail("全图上玩家的 UV 和 LevelMeta 映射不一致");
            if (want.x < 0 || want.x > 1 || want.y < 0 || want.y > 1) Fail($"玩家在俯视图范围外（UV {want}）");
            if (Time.timeScale > 0.001f) Fail("全图打开时时间没停");
            if (MapMarkers.Target != null && !map.Marks.Any(m => m.target)) Fail("全图上没画目标");
            if (probe != null && probe.discovered && !map.Marks.Any(m => m.name == probe.name)) Fail($"全图上没画已发现的「{probe.name}」");
            // 玩家箭头在图框里的像素位置（UI 实际排版）
            var root = map.Root;
            var box = root.Q(className: "sf-map__box");
            var arrow = root.Q(className: "sf-map__player");
            if (box != null && arrow != null)
            {
                var b = box.worldBound;
                var a = arrow.worldBound.center;
                var expect = new Vector2(b.xMin + want.x * b.width, b.yMin + (1 - want.y) * b.height);
                float err = Vector2.Distance(a, expect);
                Line($"玩家箭头：排版位置 {a.x:F0},{a.y:F0}，按映射应在 {expect.x:F0},{expect.y:F0}（差 {err:F1} px，图框 {b.width:F0}×{b.height:F0}）");
                if (err > 4) Fail($"玩家箭头没落在映射位置（差 {err:F1} px）");
            }
            Shot(weapons.eye, "map_full");
            yield return new WaitForSecondsRealtime(0.25f); // 屏幕抓取在帧末：等它拍完再关
            UIRouter.Back();
            yield return new WaitForSecondsRealtime(0.3f);
            Line($"关掉全图：{(UIRouter.IsOpen(MapScreen.ScreenId) ? "还开着" : "已关")}，时间 ×{Time.timeScale:F1}");
            if (UIRouter.IsOpen(MapScreen.ScreenId)) Fail("返回键没关掉全图");
            if (Mathf.Abs(Time.timeScale - scale0) > 0.01f) Fail($"关掉全图后时间没恢复（×{Time.timeScale:F2}，打开前 ×{scale0:F2}）");

            // ── 拾取对比 ──
            yield return PickupCompare(hud);
        }

        IEnumerator PickupCompare(Hud hud)
        {
            var held = weapons.Active;
            if (held == null)
            {
                Fail("手上没有枪，测不了拾取对比");
                yield break;
            }
            var fwd = motor.transform.forward.WithY(0).normalized;
            var inst = new WeaponInstance(held.def, Rarity.Count - 1);
            var drop = WeaponPickup.Drop(inst, vitals.transform.position + fwd * 1.6f + Vector3.up * 0.4f, Vector3.zero);
            for (float t = 0; t < 1.5f; t += Time.deltaTime)
            {
                if (drop) Look(drop.Focus);
                yield return null;
            }
            var prompt = hud.Widget<PromptWidget>()?.Current;
            if (prompt == null)
            {
                Fail("面对脚边的枪没有出现交互提示卡");
                yield break;
            }
            var p = prompt.Value;
            var lines = p.lines ?? new string[0];
            Line($"拾取对比：「{p.title}」/「{p.subtitle}」，{lines.Length} 行：{string.Join(" | ", lines.Take(6))}{(lines.Length > 6 ? " …" : "")}；末行「{lines.LastOrDefault()}」");
            if (!lines.Any(l => l.Contains("▲"))) Fail("传说品质对普通品质没有 ▲ 行");
            if (!lines.Any(l => l.Contains("（当前 "))) Fail("对比行没有写「（当前 …）」");
            string last = lines.LastOrDefault() ?? "";
            if (!last.StartsWith("将替换当前武器") && !last.StartsWith("放入空槽位")) Fail($"末行没写替换 / 放入空槽（「{last}」）");
            if (string.IsNullOrEmpty(p.subtitle) || !p.subtitle.StartsWith("拾取")) Fail($"副标题不对：「{p.subtitle}」");
            yield return new WaitForSecondsRealtime(0.3f);
            Shot(weapons.eye, "map_pickup");
            yield return new WaitForSecondsRealtime(0.25f);
            if (drop) Destroy(drop.gameObject);
        }

        /// <summary>LevelMeta 的范围应等于 L5 写的 _Review/level_&lt;id&gt;_map.json（同一次截图）</summary>
        void CheckReviewJson(LevelMeta meta)
        {
            var path = Path.Combine(Application.dataPath, "Art", "_Review", $"level_{meta.levelId}_map.json");
            if (!File.Exists(path))
            {
                Line($"（没有 {Path.GetFileName(path)}，跳过映射对照）");
                return;
            }
            var text = File.ReadAllText(path);
            float Get(string key)
            {
                var m = Regex.Match(text, $"\"{key}\"\\s*:\\s*(-?[0-9.eE+-]+)");
                return m.Success ? float.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : float.NaN;
            }
            var json = new Rect(Get("xMin"), Get("zMin"), Get("width"), Get("height"));
            var a = meta.mapArea;
            bool same = Mathf.Abs(json.x - a.x) < 0.05f && Mathf.Abs(json.y - a.y) < 0.05f && Mathf.Abs(json.width - a.width) < 0.05f && Mathf.Abs(json.height - a.height) < 0.05f;
            Line($"映射对照 {Path.GetFileName(path)}：{json.x:F2},{json.y:F2} {json.width:F2}×{json.height:F2} {(same ? "一致" : "不一致")}");
            if (!same) Fail("LevelMeta 的范围和 _Review 的 map.json 不一致（场景和审核图不是同一次生成？）");
        }

        void Look(Vector3 at) => Aim(motor, eye, at.y < eye.position.y - 30 ? at.WithY(eye.position.y) : at);

        static IEnumerator Frames(int n)
        {
            for (int i = 0; i < n; i++) yield return null;
        }
    }

    static class MapSuiteVec
    {
        public static Vector3 WithY(this Vector3 v, float y) => new(v.x, y, v.z);
    }
}
