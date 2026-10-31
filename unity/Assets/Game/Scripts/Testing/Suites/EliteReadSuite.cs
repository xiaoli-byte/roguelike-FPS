using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 精英远读（第二批收尾 D 路；bridge.sh playtest elite-read [场景]，默认 1-1 亮沙）：
    /// 小体型精英（跳鼠刀兵）站一排——无词缀 / 迅捷 / 坚盾 / 爆裂 / 狂暴——AI 停住，玩家从 4 m 退到 30 m，每档拍一张带 HUD 的第一人称（屏幕抓取），
    /// 看头顶印章（<see cref="EliteSeal"/>）按距离淡入 / 缩放、近处不挡视线；再拍一张准星压在精英头上的（印章让开准星）。
    /// 飞行精英（神火飞鸦、三青鸟）飞起来后停住：拍第一人称 + 侧面第三人称，核对金环投在地面上（射线找地面）、飞行体只留一个小悬浮标识。
    /// 截图 playtest_elite_read_*.png（改前 / 改后各跑一次拼对比图：docs/art/review/batch2/D/）。
    /// </summary>
    public sealed class EliteReadSuite : PlaytestSuite
    {
        public override string Id => "elite-read";
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        const string Tag = "elite_read";
        const string Body = "jerboa_blade";
        static readonly string[] Affixes = { null, "swift", "shielded", "volatile", "frenzied" };
        static readonly float[] Distances = { 4f, 7f, 10f, 15f, 22f, 30f };

        readonly List<EnemyAI> spawned = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            var motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            var hud = Hud.Instance;
            if (!weapons || !motor || !vitals || !hud)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} hud={hud}");
                yield break;
            }
            WeaponController.TestMode = true;
            HeroSkills.TestMode = true;
            Interactor.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            vitals.stats.Remove(Tag);
            vitals.stats.Add(Tag, Stat.MaxHp, 5000);
            vitals.Heal(99999);
            vitals.invulnerableUntil = Time.time + 1e5f;
            var eye = weapons.eye.transform;
            var bars = hud.Widget<EnemyBars>();

            // 场地：玩家脚下往前找一块开阔地（沿玩家朝向 34 m 都在导航网格上）
            var p0 = motor.transform.position;
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            if (!OpenLane(p0, ref fwd))
                Line("没找到 34 m 全在导航网格上的直线，照原朝向排（可能有遮挡）");
            var side = Vector3.Cross(Vector3.up, fwd);
            var center = p0 + fwd * 34f;
            if (NavMesh.SamplePosition(center, out var ch, 6f, NavMesh.AllAreas)) center = ch.position;

            // 一排五只（玩家先背过身去：血条在出生那一刻就按当时的词缀建好）
            Teleport(motor, center - fwd * 10f);
            Aim(motor, eye, center - fwd * 30f + Vector3.up);
            yield return null;
            for (int i = 0; i < Affixes.Length; i++)
            {
                var at = center + side * ((i - 2f) * 2.4f);
                if (NavMesh.SamplePosition(at, out var hit, 3f, NavMesh.AllAreas)) at = hit.position;
                var ai = EnemyRoster.Spawn(Body, at, Quaternion.LookRotation(-fwd), 1f, true, new SpawnOptions { affix = Affixes[i] ?? "swift" });
                if (!ai)
                {
                    Fail($"刷不出精英 {Body}（{Affixes[i] ?? "无词缀"}）");
                    continue;
                }
                ai.Health.maxHealth *= 40f;
                ai.Health.ResetVitals();
                if (Affixes[i] == null) MakePlain(ai);
                spawned.Add(ai);
            }
            // 出生显形（不可选中、没有血条）走完那一帧就停住：停早了显形卡住，一直不可选中
            yield return FreezeWhenRevealed(spawned, 3f);
            yield return new WaitForSeconds(0.6f);
            Line($"一排精英：{string.Join(" / ", spawned.Select(a => $"{a.Health.displayName}（{EliteAffixes.AffixOf(a) ?? "无词缀"}）"))}");

            // ── 4 → 30 m ──
            var mid = center + Vector3.up * 0.7f;
            foreach (float d in Distances)
            {
                Teleport(motor, center - fwd * d);
                Aim(motor, eye, mid);
                yield return Settle(weapons.eye);
                Shot(weapons.eye, $"elite_read_{d:00}m");
                yield return Unsettle();
                Line($"{d:0} m：头顶血条 {bars?.Count} 条{SealReport(bars)}");
                foreach (var a in spawned)
                {
                    var seal = a && bars != null ? bars.SealOf(a) : null;
                    if (seal == null)
                    {
                        Fail($"{d:0} m：{a?.Health.displayName} 头顶没有印章");
                        continue;
                    }
                    if (d <= EliteSeal.NearHide && seal.Alpha > 0.05f) Fail($"{d:0} m：印章应该藏起来（近处不挡视线），不透明度 {seal.Alpha:0.00}");
                    if (d >= 10f && seal.Alpha < 0.3f) Fail($"{d:0} m：印章应该看得见，不透明度 {seal.Alpha:0.00}");
                    if (d >= 10f && seal.Pixels < 24f) Fail($"{d:0} m：印章只有 {seal.Pixels:0} 像素");
                }
            }

            // ── 准星压在精英头上（12 m）──
            var swift = spawned.FirstOrDefault(a => a && EliteAffixes.AffixOf(a) == "swift");
            if (swift)
            {
                Teleport(motor, swift.transform.position - fwd * 12f);
                var head = HeadOf(swift);
                Aim(motor, eye, head);
                yield return Settle(weapons.eye);
                Shot(weapons.eye, "elite_read_aim");
                yield return Unsettle();
                Line($"准星压在迅捷精英头顶（12 m）{SealReport(bars)}");
            }
            foreach (var a in spawned)
                if (a && !a.Dead)
                    Combat.Execute(a.Health, true);
            spawned.Clear();
            yield return new WaitForSeconds(0.5f);

            // ── 飞行精英：金环投到地面 ──
            string[] flyers = { "fire_crow", "qingniao" };
            string[] flyerAffix = { "volatile", "swift" };
            var fly = new List<EnemyAI>();
            for (int i = 0; i < flyers.Length; i++)
            {
                if (!ArenaSpawner.IsRegistered(flyers[i]) && EnemyRoster.Get(flyers[i]) == null) continue;
                var at = center + side * ((i - 0.5f) * 7f);
                if (NavMesh.SamplePosition(at, out var hit, 3f, NavMesh.AllAreas)) at = hit.position;
                var ai = EnemyRoster.Spawn(flyers[i], at, Quaternion.LookRotation(-fwd), 1f, true, new SpawnOptions { affix = flyerAffix[i] });
                if (!ai)
                {
                    Fail($"刷不出飞行精英 {flyers[i]}");
                    continue;
                }
                ai.Health.maxHealth *= 40f;
                ai.Health.ResetVitals();
                fly.Add(ai);
            }
            Teleport(motor, center - fwd * 12f);
            Aim(motor, eye, center + Vector3.up * 3f);
            // 让它们飞起来（出生显形 + 升空到 2.5 m 以上），再停住
            float f0 = Time.time;
            while (Time.time - f0 < 8f && fly.Any(a => a && (a.Health.untargetable || a is FlyingEnemyAI fa && fa.AltitudeAboveGround < 2.5f)))
            {
                vitals.invulnerableUntil = Time.time + 1e5f;
                yield return null;
            }
            foreach (var a in fly) Freeze(a);
            yield return new WaitForSeconds(0.4f);
            foreach (var a in fly)
            {
                if (!a) continue;
                var p = a.transform.position;
                bool g = Physics.Raycast(p + Vector3.up * 0.5f, Vector3.down, out var gh, 80f, Layers.WorldMask, QueryTriggerInteraction.Ignore);
                var aura = a.GetComponent<EliteAura>();
                Line($"{a.Health.displayName}：离地 {(g ? p.y - gh.point.y : float.NaN):F1} m{RingReport(aura, g ? gh.point.y : float.NaN)}");
                if (aura && g)
                {
                    if (!aura.Hovering) Fail($"{a.Health.displayName}：金环没认出是飞行精英");
                    else if (!aura.RingVisible || Mathf.Abs(aura.RingPosition.y - gh.point.y) > 0.3f) Fail($"{a.Health.displayName}：金环没投到地面（离地 {aura.RingPosition.y - gh.point.y:F2} m）");
                    if (p.y - gh.point.y > 2f && !aura.HoverMarkVisible) Fail($"{a.Health.displayName}：飞在半空，身上没有悬浮标识");
                }
            }
            var flyMid = fly.Count > 0 ? fly.Aggregate(Vector3.zero, (s, a) => s + (a ? a.transform.position : center)) / fly.Count : center + Vector3.up * 3f;
            var flyGround = new Vector3(flyMid.x, center.y, flyMid.z);
            Aim(motor, eye, Vector3.Lerp(flyGround, flyMid, 0.5f));
            yield return Settle(weapons.eye);
            Shot(weapons.eye, "elite_read_flyer_fp");
            yield return Unsettle();
            // 侧面第三人称：同时框住飞行体和地面
            var go = new GameObject("Elite Read Side Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 50;
            cam.nearClipPlane = 0.1f;
            cam.cullingMask = ~(1 << Layers.FirstPerson);
            float span = Mathf.Max(4f, flyMid.y - flyGround.y);
            var look = Vector3.Lerp(flyGround, flyMid, 0.5f);
            go.transform.position = look - fwd * span * 0.5f + side * span * 1.5f + Vector3.up * 1.5f;
            go.transform.LookAt(look);
            Shot(cam, "elite_read_flyer_tp");
            Destroy(go);
            foreach (var a in fly)
                if (a && !a.Dead)
                    Combat.Execute(a.Health, true);
            vitals.stats.Remove(Tag);
            yield return new WaitForSeconds(0.5f);
        }

        /// <summary>头顶印章的状态（一排精英各自的不透明度 / 像素 / 纹样）</summary>
        string SealReport(EnemyBars bars)
        {
            if (bars == null) return "";
            var parts = new List<string>();
            foreach (var a in spawned)
            {
                var seal = a ? bars.SealOf(a) : null;
                parts.Add(seal == null ? "无" : $"{seal.Sigil} {seal.Alpha:0.00}/{seal.Pixels:0}px");
            }
            return "；印章 " + string.Join("、", parts);
        }

        /// <summary>金环的位置（相对地面）、悬浮标识</summary>
        static string RingReport(EliteAura aura, float groundY) => aura == null
            ? "，没有金环"
            : $"，根节点离地 {aura.transform.position.y - groundY:F2} m，金环离地 {aura.RingPosition.y - groundY:F2} m（{(aura.RingVisible ? "画着" : "没画")}，悬浮 {aura.Hovering}），" +
              $"悬浮标识 {(aura.HoverMarkVisible ? "有" : "无")}";

        /// <summary>沿 fwd 34 m 都在导航网格上就用它；否则在 8 个方向里挑第一个满足的</summary>
        static bool OpenLane(Vector3 p0, ref Vector3 fwd)
        {
            for (int k = 0; k < 8; k++)
            {
                var dir = Quaternion.Euler(0, k * 45f, 0) * fwd;
                bool ok = true;
                for (float d = 4f; d <= 40f && ok; d += 3f)
                    ok = NavMesh.SamplePosition(p0 + dir * d, out var h, 1.2f, NavMesh.AllAreas) && Mathf.Abs(h.position.y - p0.y) < 6f;
                if (!ok) continue;
                fwd = dir;
                return true;
            }
            return false;
        }

        static Vector3 HeadOf(EnemyAI a)
        {
            var col = a.GetComponent<Collider>();
            return col && col.enabled ? new Vector3(col.bounds.center.x, col.bounds.max.y + 0.1f, col.bounds.center.z) : a.transform.position + Vector3.up * 1.2f;
        }

        /// <summary>去掉词缀：只剩金环的精英</summary>
        static void MakePlain(EnemyAI ai)
        {
            var rt = ai.GetComponent<EliteAffixRuntime>();
            if (rt) DestroyImmediate(rt);
            var aura = ai.GetComponent<EliteAura>();
            if (aura) aura.SetSigil(EliteSigil.None, null);
            var def = EnemyRoster.Get(ai.enemyId);
            ai.Health.displayName = EliteAffixes.DisplayName(def != null ? def.name : ai.Health.displayName, true, null);
        }

        static IEnumerator Unsettle()
        {
            yield return null;
            yield return null;
            if (feel) feel.enabled = true;
            feel = null;
        }

        /// <summary>出生显形走完（可选中）的那一帧停住；超时的也停</summary>
        static IEnumerator FreezeWhenRevealed(List<EnemyAI> list, float timeout)
        {
            float t0 = Time.time;
            var left = new List<EnemyAI>(list);
            while (left.Count > 0 && Time.time - t0 < timeout)
            {
                for (int i = left.Count - 1; i >= 0; i--)
                {
                    var a = left[i];
                    if (a && a.Health && a.Health.untargetable) continue;
                    Freeze(a);
                    left.RemoveAt(i);
                }
                yield return null;
            }
            foreach (var a in left) Freeze(a);
        }

        static CameraFeel feel;

        /// <summary>
        /// 等镜头停稳（连续 3 帧位姿不变，最多 1.5 s）：动着的镜头截屏只能退回相机渲染，拍不到 HUD。
        /// 镜头手感（呼吸、风沙震屏）在截图前停掉，截完 <see cref="Unsettle"/> 再开
        /// </summary>
        static IEnumerator Settle(Camera cam)
        {
            yield return new WaitForSeconds(0.5f);
            feel = cam ? cam.GetComponentInParent<CameraFeel>() : null;
            if (!feel) feel = FindAnyObjectByType<CameraFeel>();
            if (feel) feel.enabled = false;
            var t = cam.transform;
            Vector3 p = t.position;
            Quaternion r = t.rotation;
            int still = 0;
            float t0 = Time.time;
            while (still < 3 && Time.time - t0 < 1.5f)
            {
                yield return null;
                bool same = (t.position - p).sqrMagnitude < 1e-8f && Quaternion.Angle(t.rotation, r) < 0.01f;
                still = same ? still + 1 : 0;
                p = t.position;
                r = t.rotation;
            }
        }

        /// <summary>站住不动（不追玩家、不出招），金环照常转</summary>
        static void Freeze(EnemyAI a)
        {
            if (!a) return;
            a.enabled = false;
            var ag = a.GetComponent<NavMeshAgent>();
            if (ag && ag.enabled && ag.isOnNavMesh) ag.isStopped = true;
        }
    }
}
