using System.Collections;
using System.Linq;
using System.Reflection;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// L6 场景件冒烟（bridge.sh playtest scene-pieces；场景 TestArena 东北角的场景件区，见 Pipeline/Editor/Levels/TestArenaPieces.cs）：
    ///   1. 可破坏物：木箱——完整时导航网格在它脚下挖着洞；对着它开枪打碎：碰撞体撤掉、挖洞撤掉（那块地回到导航网格上）、掉了灵石；
    ///      石碑（只吃爆炸）——开枪 1.5 s 一点血不掉、全是「格挡」；在它脚边炸一下就碎，碎它的那一下是爆炸。
    ///   2. 机关 + 平台：开局平台没通电、停在地面那一站、等 2.5 s 不动；对着铜锣开一枪——触发（射击）、平台通电。
    ///      载人上下 / 平移：站上台面跟着升 3.75 m、拐弯往北平移 12 m 停到东台东沿——全程脚底贴着台面（不低于台面、不高出 0.5 m）、
    ///      水平相对台面不滑；走下台面上东台；再站上去跟着回到地面——同样贴着台面；全程 PlayerMotor 的防穿地一次都没救（下降不误救）。
    ///      不压人：平台下行时玩家站在地面那一站底下——台面停在头顶上方等（挡住原因 = 下面有人），玩家走开后接着落到站。
    ///      按 F 敲锣（交互）：拨杆切到关、平台断电，走完这一趟停下、过了停站时间也不再开。
    ///   3. 断桥：桥完整时西台 → 东台的导航路径走桥（≤ 25 m）、桥面中央在导航网格上；玩家站在桥上、桥东头放一只跳鼠刀兵，
    ///      对着桥板开枪打空血——整座断（8 段都塌）、玩家掉到桥下地面（落地、没被防穿地救）、跳鼠也掉下去（不悬在半空）；
    ///      桥面中央不再在导航网格上、桥下的地面还在、西台 → 东台的路径改走两条坡道（变长或走不通）。
    ///      断桥冲刺：复原后打开「踩塌」，从西台冲过桥（11 m/s）——人到东台、身后的桥板一段段塌下去。
    /// 玩家全程无敌、无限弹药；截图：木箱碎、石碑、铜锣、平台升降 / 平移 / 停在头顶、断桥前 / 中 / 后、冲刺断桥。
    /// </summary>
    public sealed class ScenePiecesSuite : PlaytestSuite
    {
        public override string Id => "scene-pieces";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        CharacterController cc;
        Transform eye;
        Camera cam;
        PropertyInfo rescuesProp;

        /// <summary>PlayerMotor 防穿地托回的次数（另一个单元在做；没有这个属性时为 -1）</summary>
        int Rescues => rescuesProp != null ? (int)rescuesProp.GetValue(motor) : -1;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            weapons = FindAnyObjectByType<WeaponController>();
            interactor = FindAnyObjectByType<Interactor>();
            if (!motor || !vitals || !weapons || !interactor)
            {
                Fail($"缺少玩家组件：motor={motor} vitals={vitals} weapons={weapons} interactor={interactor}");
                yield break;
            }
            cc = motor.GetComponent<CharacterController>();
            eye = weapons.eye ? weapons.eye.transform : motor.eye;
            cam = weapons.eye ? weapons.eye : Camera.main;
            rescuesProp = typeof(PlayerMotor).GetProperty("GroundRescues", BindingFlags.Public | BindingFlags.Instance);
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            vitals.invulnerableUntil = Time.time + 9999;
            weapons.AddInfiniteAmmo();
            // 用一把命中扫描、不爆炸的枪（石碑要验「子弹打不动」）
            if (weapons.Active != null && !(weapons.Active.def.IsHitscan && !weapons.Active.def.IsExplosive))
                for (int i = 0; i < weapons.slots.Length; i++)
                    if (weapons.slots[i] != null && weapons.slots[i].def.IsHitscan && !weapons.slots[i].def.IsExplosive)
                    {
                        weapons.testSwitch = i;
                        yield return new WaitForSeconds(0.6f);
                        break;
                    }
            Line($"武器 {weapons.Active?.def.name}（{(weapons.Active != null && weapons.Active.def.IsHitscan ? "命中扫描" : "投射物")}），" +
                 $"防穿地计数 {(rescuesProp != null ? "可读" : "没有（PlayerMotor 还没有 GroundRescues）")}");

            var crate = Destructible.All.FirstOrDefault(d => (d.accepts & Destructible.DamageKind.Shot) != 0);
            var stele = Destructible.All.FirstOrDefault(d => d.accepts == Destructible.DamageKind.Explosion);
            var gong = SceneActivator.All.FirstOrDefault();
            var platform = MovingPlatform.All.FirstOrDefault();
            var span = BreakableSpan.All.FirstOrDefault();
            Line($"场景件：可破坏物 {Destructible.All.Count}（木箱 {(crate ? "✓" : "✗")}、石碑 {(stele ? "✓" : "✗")}）、机关 {SceneActivator.All.Count}、" +
                 $"移动平台 {MovingPlatform.All.Count}、断桥 {BreakableSpan.All.Count}");
            if (!crate || !stele || !gong || !platform || !span)
            {
                Fail("TestArena 里缺场景件（先跑 bridge.sh level arena）");
                yield break;
            }
            try
            {
                yield return CrateCase(crate);
                yield return SteleCase(stele);
                yield return PlatformCase(gong, platform);
                yield return SpanCase(span);
                yield return DashCase(span);
            }
            finally
            {
                weapons.testFire = false;
                weapons.RemoveInfiniteAmmo();
                EnemyRegistry.PurgeAll();
            }
        }

        // ───────────── 1. 可破坏物 ─────────────

        IEnumerator CrateCase(Destructible crate)
        {
            var c = crate.Center;
            var foot = new Vector3(c.x, crate.transform.position.y, c.z);
            yield return new WaitForSeconds(0.3f);
            bool holeBefore = !NavMesh.SamplePosition(foot, out _, 0.3f, NavMesh.AllAreas);
            int coins0 = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Coin);
            Place(foot + Vector3.back * 7f);
            yield return null;
            Aim(motor, eye, c);
            yield return null;
            Shot(cam, "pieces_crate_before");
            float t0 = Time.time;
            weapons.testFire = true;
            while (!crate.IsBroken && Time.time - t0 < 6f)
            {
                Aim(motor, eye, c);
                yield return null;
            }
            weapons.testFire = false;
            yield return new WaitForSeconds(0.12f);
            Shot(cam, "pieces_crate_break");
            yield return new WaitForSeconds(0.6f);
            bool colliders = crate.GetComponentsInChildren<Collider>().Any(x => x.enabled);
            bool holeAfter = !NavMesh.SamplePosition(foot, out _, 0.3f, NavMesh.AllAreas);
            int coins = Pickup.Active.Count(p => p && p.kind == Pickup.Kind.Coin) - coins0;
            Line($"木箱：{(crate.IsBroken ? $"{Time.time - t0:F1} s 打碎" : "6 s 没打碎")}（吃到 {crate.Taken} 下、血 {crate.Health.maxHealth:F0}），碰撞体{(colliders ? "还在" : "已撤")}，" +
                 $"导航挖洞 {(holeBefore ? "完整时有" : "完整时没有")} → {(holeAfter ? "碎后还在" : "碎后撤了")}，掉灵石 {coins} 颗");
            if (!crate.IsBroken) Fail("开枪 6 s 没打碎木箱");
            if (colliders) Fail("木箱碎了碰撞体还在");
            if (!holeBefore) Fail("完整的木箱脚下没在导航网格上挖洞（NavMeshModifier / 挖洞障碍没起作用）");
            if (holeAfter) Fail("木箱碎了，脚下那块地还不在导航网格上");
            if (coins <= 0) Fail("木箱碎了没掉灵石");
        }

        IEnumerator SteleCase(Destructible stele)
        {
            var c = stele.Center;
            Place(new Vector3(c.x, stele.transform.position.y, c.z) + Vector3.back * 7f);
            yield return null;
            float hp0 = stele.Health.health;
            int blocked0 = stele.Blocked;
            float t0 = Time.time;
            weapons.testFire = true;
            while (Time.time - t0 < 1.5f)
            {
                Aim(motor, eye, c);
                yield return null;
            }
            weapons.testFire = false;
            yield return new WaitForSeconds(0.2f);
            Shot(cam, "pieces_stele_shot");
            float hp1 = stele.Health.health;
            int blocked = stele.Blocked - blocked0;
            Line($"石碑（只吃爆炸）：开枪 1.5 s，血 {hp0:F0} → {hp1:F0}，格挡 {blocked} 下，{(stele.IsBroken ? "碎了" : "没碎")}");
            if (stele.IsBroken || hp1 < hp0 - 0.01f) Fail("子弹打掉了只吃爆炸的石碑的血");
            if (blocked == 0) Fail("子弹打石碑没有记成格挡（没打中？）");
            var at = new Vector3(c.x, stele.transform.position.y + 0.3f, c.z) + Vector3.back * 0.8f;
            Combat.Explode(at, 3f, DamageInfo.Simple(500f, DamageSource.Explosion, at, Vector3.up));
            yield return new WaitForSeconds(0.15f);
            Shot(cam, "pieces_stele_blast");
            Line($"石碑：脚边一记爆炸 → {(stele.IsBroken ? $"碎了（{stele.BrokenBy}）" : $"没碎（血 {stele.Health.health:F0}）")}");
            if (!stele.IsBroken) Fail("爆炸没炸碎石碑");
            else if ((stele.BrokenBy & Destructible.DamageKind.Explosion) == 0) Fail($"石碑碎的那一下不是爆炸（{stele.BrokenBy}）");
            yield return new WaitForSeconds(0.5f);
        }

        // ───────────── 2. 机关 + 移动平台 ─────────────

        IEnumerator PlatformCase(SceneActivator gong, MovingPlatform mp)
        {
            int last = mp.LastIndex;
            Line($"── 机关 + 平台 ── 路线 {mp.path.Length} 点（{string.Join(" → ", mp.path.Select(p => $"({p.x:F1}, {p.y:F2}, {p.z:F1})"))}），模式 {mp.mode}，停站 {mp.dwell} s");
            Place(new Vector3(gong.transform.position.x, 0, gong.transform.position.z) + gong.transform.forward * 8f);
            yield return null;
            bool idle0 = !mp.Powered && !mp.Moving && mp.At == 0;
            yield return new WaitForSeconds(2.5f);
            bool idle1 = !mp.Powered && !mp.Moving && mp.At == 0;
            Line($"开局：平台{(mp.Powered ? "已通电" : "没通电")}、{(mp.Moving ? "在走" : $"停在第 {mp.At} 站")}，2.5 s 后{(idle1 ? "还停着" : "动了")}");
            if (!idle0 || !idle1) Fail("开局平台应没通电、停在第 0 站不动");

            // 对着铜锣开一枪
            var target = gong.swing ? gong.swing.position + gong.swing.up * -0.8f : gong.Focus;
            Aim(motor, eye, target);
            yield return null;
            Shot(cam, "pieces_gong");
            float t0 = Time.time;
            weapons.testFire = true;
            while (gong.Count == 0 && Time.time - t0 < 3f)
            {
                Aim(motor, eye, target);
                yield return null;
            }
            weapons.testFire = false;
            yield return null;
            Line($"铜锣：{(gong.Count > 0 ? $"触发（{gong.LastCause}），拨杆 {(gong.On ? "开" : "关")}" : "3 s 没响")}，平台{(mp.Powered ? "通电了" : "没通电")}");
            if (gong.Count == 0) Fail("对着铜锣开枪 3 s 没触发");
            else if (gong.LastCause != SceneActivator.Cause.Shot) Fail($"铜锣触发方式是 {gong.LastCause}（应为射击）");
            if (!mp.Powered) Fail("铜锣触发后平台没通电");
            if (mp.Moving)
            {
                Fail("平台通电后没在第 0 站停 dwell 秒就走了");
                yield break;
            }

            // 载人：上去 + 平移
            mp.dwell = 4f; // 测试要走下台面再站回去，留够时间
            Place(mp.path[0] + Vector3.up * 0.3f + Vector3.left * 0.6f);
            yield return new WaitForSeconds(0.25f);
            if (!mp.Carrying(cc)) Fail("站在平台中央，平台没认出乘客");
            int rescue0 = Rescues;
            yield return Ride(mp, last, "上去 + 平移", "pieces_ride_up", "pieces_ride_across");
            // 走下台面上东台（往西 = 台面 −X）
            var west = -mp.deck.right;
            yield return Lunge(west, 6f, 0.7f);
            yield return new WaitForSeconds(0.3f);
            var p = motor.transform.position;
            bool onTower = !mp.Carrying(cc) && Mathf.Abs(p.y - mp.path[last].y) < 0.3f && p.x < mp.path[last].x - mp.deckSize.x * 0.5f;
            Line($"走下台面：{(onTower ? "上了东台" : "没下去")}（{p}）");
            if (!onTower) Fail("从平台走不上东台");
            Shot(cam, "pieces_platform_dock");
            // 站回去，跟着回地面（平移 + 下降）
            if (mp.Moving || mp.At != last) Fail("平台没在东台边上等（停站时间不够？）");
            else
            {
                Place(mp.path[last] + Vector3.up * 0.3f + Vector3.left * 0.6f);
                yield return new WaitForSeconds(0.25f);
                yield return Ride(mp, 0, "平移 + 下来", "pieces_ride_back", "pieces_ride_down");
            }
            int rescues = Rescues - rescue0;
            if (rescue0 >= 0)
            {
                Line($"防穿地：载人往返期间托回 {rescues} 次");
                if (rescues > 0) Fail($"平台载人期间触发了 {rescues} 次防穿地托回（误救）");
            }

            // 不压人：先下台面站远，等平台开到东台边上，再站到地面那一站正下方等它回来
            Place(new Vector3(mp.path[0].x, 0, mp.path[0].z) + Vector3.back * 5f);
            yield return WaitFor(() => mp.At == last && !mp.Moving, 25f);
            Place(new Vector3(mp.path[0].x, 0, mp.path[0].z) + Vector3.left * 1.2f);
            float w0 = Time.time;
            yield return WaitFor(() => mp.Blocked && mp.BlockReason == PlatformCarrier.Result.BlockedBelow, 20f);
            float head = cc.bounds.max.y;
            float bottom = mp.deck.position.y - mp.deckThickness;
            Line($"不压人：{(mp.Blocked ? $"{Time.time - w0:F1} s 后台面停在头顶上方（台底 y {bottom:F2}、头顶 {head:F2}）" : "台面没停下来等")}");
            Shot(cam, "pieces_platform_blocked");
            if (!mp.Blocked) Fail("平台下行时玩家站在底下，台面没停住等");
            else if (bottom < head - 0.05f) Fail($"台面压进了玩家（台底 {bottom:F2} < 头顶 {head:F2}）");
            yield return new WaitForSeconds(0.6f);
            Place(new Vector3(mp.path[0].x, 0, mp.path[0].z) + Vector3.back * 5f);
            yield return WaitFor(() => mp.At == 0 && !mp.Moving, 6f);
            Line($"站开以后：平台{(mp.At == 0 && !mp.Moving ? "落到了地面那一站" : "还没落到站")}");
            if (!(mp.At == 0 && !mp.Moving)) Fail("玩家站开后平台没接着落到站");

            // 按 F 敲锣：断电
            Place(new Vector3(gong.transform.position.x, 0, gong.transform.position.z) + gong.transform.forward * 2f);
            yield return WaitFor(() => gong.Ready, 2f);
            Aim(motor, eye, gong.Focus);
            yield return new WaitForSeconds(0.15f);
            if (!ReferenceEquals(interactor.Current, gong)) Fail($"站在铜锣前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
            int n0 = gong.Count;
            interactor.testInteract = true;
            yield return new WaitForSeconds(0.2f);
            Line($"按 F：铜锣 {(gong.Count > n0 ? $"触发（{gong.LastCause}），拨杆 {(gong.On ? "开" : "关")}" : "没触发")}，平台{(mp.Powered ? "还通着电" : "断电了")}");
            if (gong.Count == n0) Fail("按 F 没敲响铜锣");
            else if (gong.LastCause != SceneActivator.Cause.Interact) Fail($"铜锣触发方式是 {gong.LastCause}（应为交互）");
            if (mp.Powered) Fail("拨杆切到关以后平台还通着电");
            yield return WaitFor(() => !mp.Moving, 15f);
            int trips = mp.Trips;
            yield return new WaitForSeconds(mp.dwell + 1f);
            Line($"断电后：平台停在第 {mp.At} 站，过了停站时间 {(mp.Moving || mp.Trips != trips ? "又开了" : "没再开")}");
            if (mp.Moving || mp.Trips != trips) Fail("断电后平台还在往返");
        }

        /// <summary>坐一趟到 goal：全程脚底贴着台面、水平相对台面不滑；一半截图一张</summary>
        IEnumerator Ride(MovingPlatform mp, int goal, string what, string shotA, string shotB)
        {
            var deck = mp.deck;
            var offset0 = deck.InverseTransformPoint(motor.transform.position);
            float t0 = Time.time, worstBelow = 0, worstAbove = 0, worstSlide = 0;
            bool shotA_ = false, shotB_ = false, left = false;
            int trips0 = mp.Trips;
            while (!(mp.Trips > trips0 && mp.At == goal && !mp.Moving) && Time.time - t0 < 30f)
            {
                yield return null;
                var p = motor.transform.position;
                float gap = p.y - deck.position.y;
                worstBelow = Mathf.Max(worstBelow, -gap);
                worstAbove = Mathf.Max(worstAbove, gap);
                var rel = deck.InverseTransformPoint(p);
                worstSlide = Mathf.Max(worstSlide, new Vector2(rel.x - offset0.x, rel.z - offset0.z).magnitude);
                if (!mp.Carrying(cc)) left = true;
                if (mp.Moving)
                {
                    var v = mp.Velocity;
                    bool vertical = Mathf.Abs(v.y) > 0.5f && new Vector2(v.x, v.z).magnitude < 0.2f;
                    bool flat = Mathf.Abs(v.y) < 0.05f && new Vector2(v.x, v.z).magnitude > 1f;
                    if (!shotA_ && (goal == mp.LastIndex ? vertical : flat))
                    {
                        shotA_ = true;
                        ThirdPerson(mp, shotA);
                    }
                    else if (shotA_ && !shotB_ && (goal == mp.LastIndex ? flat : vertical))
                    {
                        shotB_ = true;
                        ThirdPerson(mp, shotB);
                    }
                }
            }
            yield return new WaitForSeconds(0.3f);
            var end = motor.transform.position;
            bool arrived = mp.At == goal && !mp.Moving && mp.Trips > trips0;
            Line($"平台 {what}：{(arrived ? $"{Time.time - t0:F1} s 到站" : "30 s 没到站")}，玩家 y {end.y:F2}（站 {mp.path[goal].y:F2}），" +
                 $"途中脚底最多低于台面 {worstBelow:F2} m、高出 {worstAbove:F2} m，相对台面水平滑了 {worstSlide:F2} m{(left ? "，中途离开过台面" : "")}");
            if (!arrived) Fail($"平台 {what}：30 s 没到站");
            if (worstBelow > 0.1f) Fail($"平台 {what}：玩家脚底低于台面 {worstBelow:F2} m（陷进台面 / 掉下去）");
            if (worstAbove > 0.5f || left) Fail($"平台 {what}：玩家没贴着台面（最高高出 {worstAbove:F2} m）");
            if (worstSlide > 0.3f) Fail($"平台 {what}：玩家相对台面滑了 {worstSlide:F2} m");
            if (Mathf.Abs(end.y - mp.path[goal].y) > 0.3f) Fail($"平台 {what}：到站后玩家 y {end.y:F2}，台面 {mp.path[goal].y:F2}");
        }

        /// <summary>斜后方第三人称看玩家和平台（临时相机）</summary>
        void ThirdPerson(MovingPlatform mp, string name)
        {
            var go = new GameObject("Pieces Camera");
            var c = go.AddComponent<Camera>();
            c.fieldOfView = 55;
            c.nearClipPlane = 0.1f;
            var focus = mp.deck.position + Vector3.up * 1f;
            go.transform.position = focus + new Vector3(-9f, 4.5f, -10f);
            go.transform.LookAt(focus);
            Shot(c, name);
            Destroy(go);
        }

        // ───────────── 3. 断桥 ─────────────

        IEnumerator SpanCase(BreakableSpan span)
        {
            int n = span.Count;
            var west = span.segments[0].position - span.segments[0].forward * 3.2f;
            var east = span.segments[n - 1].position + span.segments[n - 1].forward * 3.2f;
            var mid = (span.segments[n / 2 - 1].position + span.segments[n / 2].position) * 0.5f;
            yield return new WaitForSeconds(0.3f);
            float before = PathLength(west, east, out bool completeBefore);
            bool midBefore = NavMesh.SamplePosition(mid, out var mh, 0.6f, NavMesh.AllAreas) && Mathf.Abs(mh.position.y - mid.y) < 0.4f;
            Line($"── 断桥 ── {n} 段，桥面 y {mid.y:F2}；完整时 西台 → 东台 路径 {(completeBefore ? $"{before:F1} m" : "不完整")}，桥面中央{(midBefore ? "在" : "不在")}导航网格上");
            if (!completeBefore || before > 25f) Fail($"桥完整时西台到东台的路径没走桥（{(completeBefore ? $"{before:F1} m" : "不完整")}）");
            if (!midBefore) Fail("桥完整时桥面中央不在导航网格上");

            // 玩家站在西头第 2 段、跳鼠站在东段（等它出生完：出生中掀不起来）；玩家朝西往脚下第 1 段开枪（跳鼠在身后，挡不住子弹）
            Place(span.segments[1].position + Vector3.up * 0.1f);
            var enemy = EnemyRoster.Spawn("jerboa_blade", span.segments[n - 2].position + Vector3.up * 0.1f, Quaternion.LookRotation(-span.segments[0].forward), 1, false);
            if (enemy)
            {
                enemy.Health.maxHealth = 99999;
                enemy.Health.ResetVitals();
            }
            yield return new WaitForSeconds(1.6f);
            Place(span.segments[1].position + Vector3.up * 0.1f);
            yield return null;
            float y0 = motor.transform.position.y;
            int rescue0 = Rescues;
            var aimAt = span.segments[0].position + Vector3.down * 0.1f;
            Aim(motor, eye, aimAt);
            yield return null;
            Shot(cam, "pieces_span_before");
            float t0 = Time.time;
            weapons.testFire = true;
            while (span.FallenCount == 0 && Time.time - t0 < 10f)
            {
                Aim(motor, eye, aimAt);
                yield return null;
            }
            weapons.testFire = false;
            Line($"开枪打桥：{(span.FallenCount > 0 ? $"{Time.time - t0:F1} s 开始塌" : "10 s 没断")}（血 {(span.Health ? span.Health.maxHealth : 0):F0}）");
            if (span.FallenCount == 0)
            {
                Fail("对着桥板开枪 10 s 桥没断");
                yield break;
            }
            yield return new WaitForSeconds(0.25f);
            ThirdPersonAt(mid + Vector3.down * 1.5f, new Vector3(-6f, 2.5f, -14f), "pieces_span_collapse");
            yield return WaitFor(() => span.Collapsed && motor.transform.position.y < y0 - 3f && motor.Grounded, 4f);
            yield return new WaitForSeconds(0.6f);
            var p = motor.transform.position;
            float ground = GroundBelow(p);
            Line($"桥塌了 {span.FallenCount}/{n} 段；玩家 y {y0:F2} → {p.y:F2}（地面 {ground:F2}），{(motor.Grounded ? "落地了" : "还在空中")}" +
                 (rescue0 >= 0 ? $"，防穿地托回 {Rescues - rescue0} 次" : ""));
            if (!span.Collapsed) Fail($"整座断：只塌了 {span.FallenCount}/{n} 段");
            if (p.y > ground + 0.3f || !motor.Grounded) Fail("桥断了玩家没掉到桥下地面");
            if (rescue0 >= 0 && Rescues > rescue0) Fail("断桥掉落触发了防穿地托回（误救）");
            if (enemy)
            {
                yield return new WaitForSeconds(1.5f);
                var e = enemy.transform.position;
                bool overGap = e.x > span.segments[0].position.x - 1f && e.x < span.segments[n - 1].position.x + 1f && Mathf.Abs(e.z - mid.z) < 2f;
                Line($"桥上的跳鼠：y {e.y:F2}（{(overGap && e.y > 2f ? "悬在断桥半空" : e.y < 1f ? "掉到地面" : "在台上")}）");
                if (overGap && e.y > 2f) Fail("桥断了，桥上的跳鼠悬在半空没掉下去");
            }
            Shot(cam, "pieces_span_after");

            // 导航更新
            yield return new WaitForSeconds(0.3f);
            float after = PathLength(west, east, out bool completeAfter);
            bool midAfter = NavMesh.SamplePosition(mid, out var ma, 0.6f, NavMesh.AllAreas) && Mathf.Abs(ma.position.y - mid.y) < 0.4f;
            var under = new Vector3(mid.x, GroundBelow(mid), mid.z);
            bool groundOk = NavMesh.SamplePosition(under, out var ga, 0.5f, NavMesh.AllAreas) && Mathf.Abs(ga.position.y - under.y) < 0.4f;
            int carved = Enumerable.Range(0, n).Count(span.Carved);
            Line($"导航：桥面中央{(midAfter ? "还在" : "不在")}导航网格上（挖洞 {carved}/{n} 段），桥下地面{(groundOk ? "还在" : "被挖掉了")}，" +
                 $"西台 → 东台 {(completeAfter ? $"{after:F1} m（原 {before:F1} m）" : "走不通")}");
            if (midAfter) Fail("桥断了，桥面中央还在导航网格上");
            if (!groundOk) Fail("桥的挖洞把桥下的地面也挖掉了");
            if (completeAfter && after < before + 8f) Fail($"桥断了西台到东台的路径没变长（{after:F1} m），还在走桥");
        }

        /// <summary>断桥冲刺：复原、打开踩塌，从西台冲过去——人到东台，身后的桥板一段段塌</summary>
        IEnumerator DashCase(BreakableSpan span)
        {
            EnemyRegistry.PurgeAll();
            span.Rebuild();
            span.triggers |= BreakableSpan.Trigger.Step;
            yield return new WaitForSeconds(0.5f);
            int n = span.Count;
            var dir = span.segments[0].forward;
            var first = span.segments[0].position;
            var lastTop = span.segments[n - 1].position;
            var middle = span.segments[n / 2].position;
            var start = first - dir * 2.2f;
            Place(start);
            yield return new WaitForSeconds(0.3f);
            motor.SetLook(Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg, 8f);
            float len = Vector3.Distance(first, lastTop) + 5f;
            yield return Lunge(dir, 11f, len / 11f, () => span.FallenCount > 0 && Vector3.Dot(motor.transform.position - lastTop, dir) < 0);
            Shot(cam, "pieces_dash");
            yield return new WaitForSeconds(2f);
            var p = motor.transform.position;
            // 桥板塌了以后物体在地上：比的是冲刺前记下的东头桥面
            bool across = Vector3.Dot(p - lastTop, dir) > 0.5f && Mathf.Abs(p.y - lastTop.y) < 0.4f;
            Line($"断桥冲刺：{(across ? $"冲到了东台（{p}）" : $"没冲过去（{p}）")}，身后塌了 {span.FallenCount}/{n} 段");
            ThirdPersonAt(middle, new Vector3(-7f, 3f, -12f), "pieces_dash_after");
            if (!across) Fail("打开踩塌后冲刺过桥，没冲到东台（桥塌得太快？）");
            if (span.FallenCount < n - 1) Fail($"冲过去以后身后只塌了 {span.FallenCount}/{n} 段");
        }

        void ThirdPersonAt(Vector3 focus, Vector3 offset, string name)
        {
            var go = new GameObject("Pieces Camera");
            var c = go.AddComponent<Camera>();
            c.fieldOfView = 55;
            c.nearClipPlane = 0.1f;
            go.transform.position = focus + offset;
            go.transform.LookAt(focus);
            Shot(c, name);
            Destroy(go);
        }

        // ───────────── 工具 ─────────────

        /// <summary>用 PlayerMotor 的软突进走 / 冲（走自己的角色控制器、重力、防穿地，不是直接改位置）；until 成立时截一张图</summary>
        IEnumerator Lunge(Vector3 dir, float speed, float time, System.Func<bool> snap = null)
        {
            dir.y = 0;
            dir.Normalize();
            motor.SetLook(Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg, 0);
            motor.Lunge(dir, speed, time, 0, 0);
            float t0 = Time.time;
            bool shot = false;
            while (Time.time - t0 < time + 0.1f)
            {
                if (!shot && snap != null && snap())
                {
                    shot = true;
                    Shot(cam, "pieces_dash_mid");
                }
                yield return null;
            }
        }

        static IEnumerator WaitFor(System.Func<bool> cond, float timeout)
        {
            float t0 = Time.time;
            while (!cond() && Time.time - t0 < timeout) yield return null;
        }

        void Place(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var hit, 8f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            motor.Teleport(p);
        }

        static float GroundBelow(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 0.2f, Vector3.down, out var h, 50f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : p.y;

        static float PathLength(Vector3 a, Vector3 b, out bool complete)
        {
            complete = false;
            if (!NavMesh.SamplePosition(a, out var ha, 1.5f, NavMesh.AllAreas) || !NavMesh.SamplePosition(b, out var hb, 1.5f, NavMesh.AllAreas)) return float.PositiveInfinity;
            var path = new NavMeshPath();
            if (!NavMesh.CalculatePath(ha.position, hb.position, NavMesh.AllAreas, path)) return float.PositiveInfinity;
            complete = path.status == NavMeshPathStatus.PathComplete;
            float len = 0;
            for (int i = 1; i < path.corners.Length; i++) len += Vector3.Distance(path.corners[i - 1], path.corners[i]);
            return len;
        }
    }
}
