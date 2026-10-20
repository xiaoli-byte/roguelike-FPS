using System.Collections;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 飞行基类冒烟（bridge.sh playtest flyer；场景 TestArena）：用一只不进名册的试飞占位体（<see cref="TestFlyerAI"/>，占位胶囊 + 弱点球）验证 E3：
    ///   · 起飞：站在刷怪台上出生 → 起飞升到巡航高度；导航代理是停用的；
    ///   · 空中出生：在 12 m 高处出生，出生显形期间停在原高度，之后降到巡航高度（不掉到地上）；
    ///   · 避障：贴着 2.5 m 高度穿过 11 m 栖落柱，身体从不嵌进柱子、最后到达柱子另一侧；
    ///   · 栖落：玩家站在三根柱子南边，飞鸟找落脚点 → 落到柱顶的 PerchPoint 标记上并认领；第二只不抢同一根柱子；起飞后认领释放；
    ///   · 兜底搜索：不用标记，在东侧高台附近按射线搜出一处高处（站得下、看得见玩家）；
    ///   · 寻视线：玩家躲在 6 m 高台背后，飞鸟从看不见的一侧出发，12 s 内飞到看得见玩家的悬停点；
    ///   · 降落到地面、击退、死亡下坠（占位体没有布娃娃：尸体掉到地上）。
    /// 运行时报错由宿主记不合格。
    /// </summary>
    public sealed class FlyerSuite : PlaytestSuite
    {
        public override string Id => "flyer";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        /// <summary>试飞占位的定义（不登记进名册：名册数量有契约测试）</summary>
        static readonly EnemyDef FlyerDef = new()
        {
            id = "test_flyer", prefab = "", name = "试飞占位", hp = 200, speed = 7, damage = 0, scale = 1,
            radius = 0.35f, height = 0.9f, weakHeight = 0.6f, weakRadius = 0.16f, ai = typeof(TestFlyerAI),
            role = AttackTokens.Kind.Ranged, flying = true, color = Hex.Rgb(0x5fc8ff),
        };

        const float Cruise = 3f;

        readonly List<TestFlyerAI> spawned = new();
        Transform root;
        Camera cam;
        PlayerMotor motor;
        Transform eye;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            var arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} arena={arena}（场景不是 TestArena？先 bridge.sh level arena）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            cam = weapons.eye;
            eye = weapons.eye.transform;
            root = new GameObject("Flyer Suite").transform;
            int perches = 0;
            foreach (var p in arena.perches)
                if (p)
                    perches++;
            Line($"栖落柱 {perches} 根，PerchPoint 标记 {PerchPoint.All.Count} 个；刷怪台 {arena.Center}");
            if (perches < 3) Fail("测试场的栖落柱不到 3 根（先 bridge.sh level arena）");

            yield return TakeoffCase(arena);
            yield return AirSpawnCase(arena);
            yield return AvoidCase(arena);
            yield return PerchCase(arena);
            FallbackSearchCase(arena);
            yield return SightCase(arena);
            yield return LandAndKnockbackCase(arena);
            yield return DeathFallCase(arena);
            Clear();
            Destroy(root.gameObject);
        }

        // ───────────── 用例 ─────────────

        IEnumerator TakeoffCase(ArenaSpawner arena)
        {
            Teleport(motor, arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 14);
            var f = SpawnFlyer(arena.Center, false, true);
            yield return null;
            var agent = f.GetComponent<NavMeshAgent>();
            bool agentOff = !agent || !agent.enabled;
            bool startedLanded = f.Landed;
            float t0 = Time.time, maxAlt = 0;
            while (Time.time - t0 < 5f && !(f.FlightPhase == FlyingEnemyAI.Flight.Airborne && f.AltitudeAboveGround >= Cruise * 0.8f))
            {
                maxAlt = Mathf.Max(maxAlt, f.AltitudeAboveGround);
                Aim(motor, eye, f.transform.position);
                yield return null;
            }
            float alt = f.AltitudeAboveGround;
            bool ok = f.FlightPhase == FlyingEnemyAI.Flight.Airborne && alt >= Cruise * 0.8f;
            Line($"起飞：出生{(startedLanded ? "站地" : "不在地上")}，导航代理{(agentOff ? "已停用" : "仍启用")}，{Time.time - t0:F1} s 后离地 {alt:F1} m（巡航 {Cruise} m）{(ok ? " ✓" : " ✗")}");
            if (!agentOff) Fail("飞行敌人的 NavMeshAgent 没有停用");
            if (!startedLanded) Fail("站地出生的飞行敌人没有站在地上");
            if (!ok) Fail($"5 s 内没有起飞到巡航高度（阶段 {f.FlightPhase}，离地 {alt:F1} m，状态 {f.State}）");
            Clear();
        }

        IEnumerator AirSpawnCase(ArenaSpawner arena)
        {
            var at = arena.Center + Vector3.up * 12f;
            var f = SpawnFlyer(at, true);
            yield return null;
            float alt0 = f.AltitudeAboveGround;
            yield return new WaitForSeconds(0.5f);
            float altHold = f.AltitudeAboveGround;
            float t0 = Time.time, minAlt = float.PositiveInfinity;
            while (Time.time - t0 < 4f)
            {
                minAlt = Mathf.Min(minAlt, f.AltitudeAboveGround);
                yield return null;
            }
            float altEnd = f.AltitudeAboveGround;
            bool ok = alt0 >= 11f && altHold >= 11f && minAlt >= Cruise * 0.7f && altEnd <= Cruise + 1.5f;
            Line($"空中出生：出生离地 {alt0:F1} m，0.5 s 后 {altHold:F1} m（出生期间悬停），4 s 后 {altEnd:F1} m（最低 {minAlt:F1} m）{(ok ? " ✓" : " ✗")}");
            if (alt0 < 11f) Fail($"空中出生被拉到了地面附近（离地 {alt0:F1} m）");
            if (altHold < 11f) Fail($"出生显形期间没有停在出生高度（{altHold:F1} m）");
            if (minAlt < Cruise * 0.7f || altEnd > Cruise + 1.5f) Fail($"空中出生后没有回到巡航高度（最低 {minAlt:F1} m，最后 {altEnd:F1} m）");
            Clear();
        }

        IEnumerator AvoidCase(ArenaSpawner arena)
        {
            // 最高的那根柱子：从南边 7 m 贴着 2.5 m 高度飞到北边 7 m
            Transform top = null;
            foreach (var p in arena.perches)
                if (p && (!top || p.position.y > top.position.y))
                    top = p;
            if (!top)
            {
                Fail("避障：没有栖落柱");
                yield break;
            }
            var c = new Vector3(top.position.x, 0, top.position.z);
            var from = c + Vector3.back * 7f;
            var to = c + Vector3.forward * 7f;
            from.y = Ground(from) + 2.5f;
            to.y = Ground(to);
            Teleport(motor, c + Vector3.back * 16f + Vector3.right * 6f);
            var f = SpawnFlyer(from, true);
            yield return new WaitForSeconds(0.8f);
            f.Command(TestFlyerAI.Order.Goto, to, 2.5f);
            float t0 = Time.time, maxAlt = 0;
            int inside = 0;
            bool reached = false;
            while (Time.time - t0 < 12f)
            {
                if (Embedded(f)) inside++;
                maxAlt = Mathf.Max(maxAlt, f.AltitudeAboveGround);
                var d = f.transform.position - to;
                d.y = 0;
                if (d.magnitude < 1f)
                {
                    reached = true;
                    break;
                }
                Aim(motor, eye, f.transform.position);
                yield return null;
            }
            Line($"避障：绕过 {top.position.y:F0} m 柱子{(reached ? $"，{Time.time - t0:F1} s 到达" : "，没到达")}，嵌进柱子 {inside} 帧，最高离地 {maxAlt:F1} m{(reached && inside == 0 ? " ✓" : " ✗")}");
            if (!reached) Fail($"避障：12 s 内没有绕过柱子到达另一侧（现在在 {f.transform.position}）");
            if (inside > 0) Fail($"避障：身体嵌进地形 / 建筑 {inside} 帧");
            Clear();
        }

        IEnumerator PerchCase(ArenaSpawner arena)
        {
            // 玩家站在三根柱子南边；两只鸟先后找落脚点
            var stand = new Vector3(-30f, 0, 6f);
            Teleport(motor, stand);
            var a = SpawnFlyer(new Vector3(-24f, Ground(new Vector3(-24f, 0, -2f)) + 4f, -2f), true);
            yield return new WaitForSeconds(0.8f);
            a.Command(TestFlyerAI.Order.Perch);
            yield return WaitLanded(a, 15f);
            bool aOk = CheckPerch(a, arena, "第一只");
            if (aOk)
            {
                Aim(motor, eye, a.transform.position + Vector3.up * 0.5f);
                yield return null;
                Shot(cam, "flyer_perch");
                PoseShot(a, Vector3.right, "flyer_perch_pose");
            }

            var b = SpawnFlyer(new Vector3(-36f, Ground(new Vector3(-36f, 0, 0f)) + 4f, 0f), true);
            yield return new WaitForSeconds(0.8f);
            b.Command(TestFlyerAI.Order.Perch);
            yield return WaitLanded(b, 15f);
            bool bOk = CheckPerch(b, arena, "第二只");
            if (aOk && bOk)
            {
                var gap = a.LandingSpot - b.LandingSpot;
                gap.y = 0;
                Line($"两只的落脚点相距 {gap.magnitude:F1} m（认领半径 {PerchPoint.ClaimRadius} m）{(gap.magnitude >= PerchPoint.ClaimRadius ? " ✓" : " ✗")}");
                if (gap.magnitude < PerchPoint.ClaimRadius) Fail("第二只落到了第一只认领的落脚点上");
            }

            // 第一只起飞：认领释放
            var point = a.lastPerch.point;
            a.Command(TestFlyerAI.Order.Hover);
            float t0 = Time.time;
            while (Time.time - t0 < 3f && a.FlightPhase != FlyingEnemyAI.Flight.Airborne) yield return null;
            bool released = !point || point.ClaimedBy != a;
            Line($"起飞：{Time.time - t0:F1} s 后阶段 {a.FlightPhase}，认领{(released ? "已释放 ✓" : "没释放 ✗")}");
            if (a.FlightPhase != FlyingEnemyAI.Flight.Airborne) Fail("栖落后 3 s 内没有飞起来");
            if (!released) Fail("起飞后落脚点还被认领着");
            Clear();
            yield return null;
            if (PerchPoint.ClaimCount != 0) Fail($"飞鸟销毁后还剩 {PerchPoint.ClaimCount} 个认领");
        }

        IEnumerator WaitLanded(TestFlyerAI f, float timeout)
        {
            float t0 = Time.time;
            while (Time.time - t0 < timeout && f && !f.Landed)
            {
                Aim(motor, eye, f.transform.position);
                yield return null;
            }
        }

        bool CheckPerch(TestFlyerAI f, ArenaSpawner arena, string who)
        {
            if (!f.Landed)
            {
                Fail($"栖落（{who}）：没落下来（找点结果 {f.lastPerchKind}，阶段 {f.FlightPhase}，状态 {f.State}，在 {f.transform.position}）");
                return false;
            }
            Transform pillar = null;
            float best = float.PositiveInfinity;
            foreach (var p in arena.perches)
            {
                if (!p) continue;
                var d = p.position - f.transform.position;
                d.y = 0;
                if (d.magnitude < best)
                {
                    best = d.magnitude;
                    pillar = p;
                }
            }
            float dy = pillar ? f.transform.position.y - pillar.position.y : float.NaN;
            bool onTop = pillar && best < 1.0f && Mathf.Abs(dy) < 0.2f;
            bool claimed = f.lastPerch.point && f.lastPerch.point.ClaimedBy == f;
            Line($"栖落（{who}）：{f.lastPerchKind}，落在 {(pillar ? pillar.name : "?")} 上（水平偏 {best:F2} m，高差 {dy:F2} m），认领{(claimed ? "✓" : "✗")}");
            if (f.lastPerchKind != PerchKind.Marker) Fail($"栖落（{who}）：附近有栖落柱标记却选了 {f.lastPerchKind}");
            if (!onTop) Fail($"栖落（{who}）：没有站在柱顶标记上");
            if (!claimed) Fail($"栖落（{who}）：落脚点没有认领");
            return onTop;
        }

        void FallbackSearchCase(ArenaSpawner arena)
        {
            // 东侧三座高台（2.5 / 4 / 6 m）南边 14 m：不用标记，只靠射线兜底
            var around = new Vector3(34f, 0, -20f);
            around.y = Ground(around);
            var q = new PerchQuery(around, around + Vector3.up * Sight.PlayerEye, around + new Vector3(0, 6, -6), 6f, 26f, 1.5f, 8f, null)
            {
                useMarkers = false, allowGround = false, highRise = 3f, samples = 48,
            };
            var kind = PerchPoint.Find(q, out var s);
            bool standable = kind != PerchKind.None
                && Physics.Raycast(s.position + Vector3.up * 0.5f, Vector3.down, out var hit, 1f, Layers.WorldMask, QueryTriggerInteraction.Ignore)
                && Mathf.Abs(hit.point.y - s.position.y) < 0.1f;
            bool sees = kind != PerchKind.None && Sight.Clear(s.position + Vector3.up * q.eyeHeight, q.targetEye);
            Line($"兜底搜索：{kind}，{(kind != PerchKind.None ? $"{s.position}（比玩家高 {s.rise:F1} m）" : "")}，站得住 {(standable ? "✓" : "✗")}，看得见 {(sees ? "✓" : "✗")}");
            if (kind is PerchKind.None or PerchKind.Ground or PerchKind.Marker) Fail($"兜底搜索没在高台附近找到高处（{kind}）");
            else if (!standable || !sees || s.rise < q.minRise) Fail("兜底搜索找到的点站不住 / 看不见玩家 / 不够高");
        }

        IEnumerator SightCase(ArenaSpawner arena)
        {
            // 玩家躲在 6 m 高台北面；飞鸟从高台南面一圈里挑一个被挡住的位置出发
            Transform deck = null;
            for (int i = 0; i < arena.platforms.Length && i < arena.platformHeights.Length; i++)
                if (arena.platforms[i] && arena.platformHeights[i] >= 6f)
                    deck = arena.platforms[i];
            if (!deck)
            {
                Fail("寻视线：测试场没有 6 m 高台");
                yield break;
            }
            var c = deck.position;
            var stand = new Vector3(c.x, 0, c.z + 5.5f);
            Teleport(motor, stand);
            yield return null;
            var playerEye = Sight.PlayerEyeOr(motor.transform.position + Vector3.up * Sight.PlayerEye);
            Vector3? start = null;
            foreach (var o in new[] { new Vector2(-6, -9), new Vector2(6, -9), new Vector2(-8, -6), new Vector2(8, -6), new Vector2(0, -14), new Vector2(-4, -12) })
            {
                var p = new Vector3(c.x + o.x, 0, c.z + o.y);
                p.y = Ground(p) + Cruise;
                if (Physics.CheckSphere(p + Vector3.up * 0.45f, 0.5f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                if (!Combat.Blocked(p + Vector3.up * 0.45f, playerEye, null)) continue;
                start = p;
                break;
            }
            if (start == null)
            {
                Fail("寻视线：高台南面找不到被挡住的出发点");
                yield break;
            }
            var f = SpawnFlyer(start.Value, true);
            yield return new WaitForSeconds(0.8f);
            f.Command(TestFlyerAI.Order.Seek);
            float t0 = Time.time, clearSince = -1;
            bool ok = false;
            while (Time.time - t0 < 12f)
            {
                playerEye = Sight.PlayerEyeOr(playerEye);
                bool clear = Sight.Clear(f.BodyCenterPublic, playerEye);
                if (clear && clearSince < 0) clearSince = Time.time;
                if (!clear) clearSince = -1;
                if (clearSince >= 0 && Time.time - clearSince >= 0.3f)
                {
                    ok = true;
                    break;
                }
                yield return null;
            }
            Line($"寻视线：从 {start.Value} 出发（看不见），{(ok ? $"{Time.time - t0:F1} s 后在 {f.transform.position} 看见玩家 ✓" : "12 s 内没找到视线 ✗")}");
            if (!ok) Fail($"寻视线：12 s 内没有飞到看得见玩家的位置（在 {f.transform.position}，状态 {f.State}）");
            else
            {
                Aim(motor, eye, f.transform.position);
                yield return null;
                Shot(cam, "flyer_sight");
            }
            Clear();
        }

        IEnumerator LandAndKnockbackCase(ArenaSpawner arena)
        {
            Teleport(motor, arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 14);
            var f = SpawnFlyer(arena.Center + new Vector3(4, 5, 0), true);
            yield return new WaitForSeconds(0.9f);

            // 击退：向 +X 推 8 m/s（抗性 0），0.5 s 后至少挪开 1 m
            var p0 = f.transform.position;
            var info = DamageInfo.Simple(1, DamageSource.Explosion, BodyCenter(f.Health), Vector3.right);
            info.knockback = 8f;
            Combat.DamageEnemy(f.Health, info);
            yield return new WaitForSeconds(0.5f);
            float moved = f.transform.position.x - p0.x;
            Line($"击退：0.5 s 内沿 +X 挪了 {moved:F2} m{(moved >= 1f ? " ✓" : " ✗")}");
            if (moved < 1f) Fail($"空中击退无效（0.5 s 只挪了 {moved:F2} m）");

            var spot = arena.Center + new Vector3(-3, 0, 2);
            if (NavMesh.SamplePosition(spot, out var nh, 3f, NavMesh.AllAreas)) spot = nh.position;
            spot.y = Ground(spot);
            f.Command(TestFlyerAI.Order.Land, spot);
            yield return WaitLanded(f, 10f);
            float dy = f.transform.position.y - spot.y;
            var dxz = f.transform.position - spot;
            dxz.y = 0;
            bool ok = f.Landed && Mathf.Abs(dy) < 0.15f && dxz.magnitude < 0.5f;
            Line($"降落到地面：{(f.Landed ? "站定" : "没落下")}，水平偏 {dxz.magnitude:F2} m、高差 {dy:F2} m{(ok ? " ✓" : " ✗")}");
            if (!ok) Fail($"降落到地面失败（阶段 {f.FlightPhase}，在 {f.transform.position}，目标 {spot}）");
            Clear();
        }

        IEnumerator DeathFallCase(ArenaSpawner arena)
        {
            var f = SpawnFlyer(arena.Center + new Vector3(-4, 8, 0), true);
            yield return new WaitForSeconds(0.9f);
            float alt0 = f.AltitudeAboveGround;
            Combat.Execute(f.Health, true);
            yield return null;
            var fall = f ? f.GetComponent<FlyerCorpseFall>() : null;
            float t0 = Time.time;
            while (Time.time - t0 < 4f && fall && !fall.Grounded) yield return null;
            float alt = f ? f.transform.position.y - Ground(f.transform.position) : float.NaN;
            bool ok = fall && fall.Grounded && alt < 0.2f;
            Line($"死亡下坠：死时离地 {alt0:F1} m，{(ok ? $"{Time.time - t0:F1} s 后落地 ✓" : $"没落地（离地 {alt:F1} m）✗")}");
            if (!ok) Fail("没有布娃娃的飞行敌人死后没掉到地上");
            Clear();
        }

        // ───────────── 工具 ─────────────

        /// <summary>
        /// 搭一只试飞占位体（同 EnemyRoster.Spawn 的组件顺序：受伤体 → 身体 → 导航代理（停用）→ AI），空中出生的放回 at 的高度
        /// </summary>
        TestFlyerAI SpawnFlyer(Vector3 at, bool air, bool landed = false)
        {
            var go = PlaceholderBody.Create(FlyerDef, at, Quaternion.identity, root);
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = Layers.Character;
            var dmg = go.AddComponent<Damageable>();
            dmg.maxHealth = FlyerDef.hp;
            dmg.displayName = FlyerDef.name;
            var body = go.AddComponent<EnemyBody>();
            body.weakBone = PlaceholderBody.WeakBoneName(FlyerDef);
            body.weakRadius = FlyerDef.weakRadius;
            body.hitboxMode = FlyerDef.hitboxes;
            // 半空中先停用：激活时不去找导航网格（否则「离导航网格太远」警告）；飞行基类本来也会停用它
            go.AddComponent<NavMeshAgent>().enabled = false;
            var ai = go.AddComponent<TestFlyerAI>();
            ai.enemyId = FlyerDef.id;
            ai.moveSpeed = FlyerDef.speed;
            ai.damage = 0;
            ai.cruiseHeight = Cruise;
            ai.accel = 20f;
            ai.startLanded = landed;
            go.SetActive(true);
            ai.Spawn(1, false);
            if (air) ai.PlaceInAir(at);
            spawned.Add(ai);
            return ai;
        }

        void Clear()
        {
            foreach (var f in spawned)
                if (f)
                    Destroy(f.gameObject);
            spawned.Clear();
        }

        static float Ground(Vector3 p) =>
            Physics.Raycast(new Vector3(p.x, 60f, p.z), Vector3.down, out var hit, 120f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point.y : 0f;

        /// <summary>身体（略小于扫掠半径）和地形 / 建筑重叠</summary>
        static bool Embedded(TestFlyerAI f)
        {
            var cap = f.GetComponent<CapsuleCollider>();
            if (!cap) return false;
            float s = f.transform.lossyScale.x, r = cap.radius * s * 0.7f, h = cap.height * s;
            var p = f.transform.position;
            return Physics.CheckCapsule(p + Vector3.up * (r + 0.05f), p + Vector3.up * Mathf.Max(r + 0.05f, h - r), r, Layers.WorldMask, QueryTriggerInteraction.Ignore);
        }
    }

    /// <summary>
    /// 试飞占位的 AI（只在 <see cref="FlyerSuite"/> 里生成，不进名册）：不出招，按套件的命令盘旋 / 寻视线 / 栖落 / 飞到某点 / 降落，验证飞行基类。
    /// 状态：hover（按命令飞）→ toPerch / land（降落中）→ perch（站着）→ takeoff → hover
    /// </summary>
    [AddComponentMenu("")]
    public sealed class TestFlyerAI : FlyingEnemyAI
    {
        public enum Order { Hover, Seek, Perch, Goto, Land }

        public Order order = Order.Hover;
        public Vector3 target;
        public float gotoAltitude = 2.5f;
        public bool startLanded;
        /// <summary>最近一次找落脚点的结果</summary>
        public PerchKind lastPerchKind;
        public PerchSpot lastPerch;
        public int landings, takeoffs, landingFails;

        protected override bool SpawnLanded => startLanded;
        protected override string InitialState => "hover";

        /// <summary>身体中心（套件判视线用）</summary>
        public Vector3 BodyCenterPublic => BodyCenter(transform.position);

        /// <summary>换命令：降落中的先放弃，回到 hover 重新按命令飞（站着的由 perch 状态起飞）</summary>
        public void Command(Order o, Vector3 at = default, float altitude = 2.5f)
        {
            order = o;
            target = at;
            gotoAltitude = altitude;
            if (state is "toPerch" or "land") CancelLanding();
            if (state != "perch" && state != "spawn") SetState("hover");
        }

        protected override void Think(float dt)
        {
            switch (state)
            {
                case "hover":
                    if (Landed)
                    {
                        TakeOff();
                        SetState("takeoff");
                        break;
                    }
                    switch (order)
                    {
                        case Order.Seek:
                            if (!SeekSight(6f, 18f, moveSpeed, cruiseHeight))
                            {
                                SetAltitude(cruiseHeight);
                                Hover();
                            }
                            FaceVelocity(360f, dt);
                            break;
                        case Order.Perch:
                            SetAltitude(cruiseHeight);
                            if (TryPerch()) SetState("toPerch");
                            break;
                        case Order.Goto:
                            SetAltitude(gotoAltitude);
                            FlyTo(target, moveSpeed, 0.5f);
                            FaceVelocity(360f, dt);
                            break;
                        case Order.Land:
                            if (BeginLanding(target)) SetState("land");
                            break;
                        default:
                            SetAltitude(cruiseHeight);
                            KeepRangeAir(8f, 16f, moveSpeed, 0.6f);
                            FacePlayer(180f, dt);
                            break;
                    }
                    break;
                case "toPerch":
                case "land":
                    FaceVelocity(240f, dt);
                    if (Landed) SetState("perch");
                    else if (FlightPhase == Flight.Airborne) SetState("hover");
                    break;
                case "perch":
                    FacePlayer(90f, dt);
                    if (order is not (Order.Perch or Order.Land))
                    {
                        TakeOff();
                        SetState("takeoff");
                    }
                    break;
                case "takeoff":
                    if (FlightPhase == Flight.Airborne) SetState("hover");
                    break;
                default:
                    SetState("hover");
                    break;
            }
        }

        /// <summary>玩家 4–30 m、高 1.4–12 m 的落脚点（3 m 以上算高处），不退到地面</summary>
        bool TryPerch()
        {
            var q = PerchAroundTarget(4f, 30f, 1.4f, 12f);
            q.highRise = 3f;
            q.allowGround = false;
            lastPerchKind = FindPerch(q, out lastPerch);
            return lastPerchKind != PerchKind.None && BeginLanding(lastPerch);
        }

        protected override void OnLanded() => landings++;
        protected override void OnTookOff() => takeoffs++;
        protected override void OnLandingFailed() => landingFails++;
    }
}
