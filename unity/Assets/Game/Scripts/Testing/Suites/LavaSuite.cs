using System.Collections;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 熔岩冒烟（bridge.sh playtest lava；场景 TestArena，L7 验收「熔岩扣血、托回、敌人被打进去烧死」）：
    ///   · 场地：北侧熔岩条带是 <see cref="LavaVolume"/>，熔岩系统起来了；条带上的导航网格是 Lava 区（NavMeshAreas.asset 生效时）；
    ///     条带边 1 m 内登记成了 SafeGround 的危险区；祸斗的熔岩边（FireFeed.LavaEdge）接上了，岸边找得到熔岩边；
    ///   · 玩家掉进去：先在岸上站 0.8 s（记成安全点），再从熔岩上方 1.5 m 掉下去 → 下沉，扣血 ≈ 最大生命 15%（12% + 两跳 1.5%），
    ///     0.5 s 后托回岸上（不在熔岩里、离岸上的安全点不远），有 1 s 无敌；
    ///   · 敌人自己走进去：一只跳鼠刀客（眩晕住，不乱跑）被直接挪进熔岩 → 下一帧拉回岸上、还活着；
    ///   · 敌人被打进去：贴着熔岩边站的一只吃一发带击退的伤害（推力沿导航网格推进 Lava 区）→ 烧死，算一次正常击杀（不是静默处决）；
    ///   · 涨潮：在空地上临时加一片 8 × 8 m 的熔岩（基准面在地下 0.6 m，地面原本是干的），玩家和一只眩晕的敌人站在里面，
    ///     RiseTo 地面 + 0.25 m → 玩家下沉托回到熔岩外、敌人被挪到岸上还活着、盖住的地面算熔岩；Recede 后地面又是干的。
    /// 运行时报错由宿主记不合格。
    /// </summary>
    public sealed class LavaSuite : PlaytestSuite
    {
        public override string Id => "lava";
        /// <summary>测试场（与编辑器里 Level_TestArena.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string DummyId = "jerboa_blade";

        ArenaSpawner arena;
        PlayerVitals vitals;
        PlayerMotor motor;
        SafeGround safe;
        Camera cam;
        LavaVolume strip;
        Damageable lastKilled;
        DamageInfo lastKillInfo;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            vitals = PlayerVitals.Instance ? PlayerVitals.Instance : FindAnyObjectByType<PlayerVitals>();
            motor = vitals ? vitals.GetComponent<PlayerMotor>() : null;
            safe = vitals ? vitals.GetComponent<SafeGround>() : null;
            var weapons = vitals ? vitals.GetComponent<WeaponController>() : null;
            cam = weapons && weapons.eye ? weapons.eye : Camera.main;
            if (!arena || !vitals || !motor || !safe)
            {
                Fail($"缺少组件：arena={arena} vitals={vitals} motor={motor} safeGround={safe}（场景不是 TestArena？先 bridge.sh level arena）");
                yield break;
            }
            strip = arena.lavaStrip ? arena.lavaStrip.GetComponent<LavaVolume>() : null;
            if (!strip)
            {
                Fail("测试场的熔岩条带不是 LavaVolume（L7 之前的占位色块）：先 bridge.sh level arena 重建测试场");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            InAction<KillEvent> onKill = OnKilled;
            GameEvents.EnemyKilled += onKill;
            try
            {
                yield return null;
                CheckSetup();
                yield return PlayerCase();
                yield return WalkInCase();
                yield return KnockCase();
                yield return RisingCase();
            }
            finally
            {
                GameEvents.EnemyKilled -= onKill;
                if (arena) arena.Clear();
            }
        }

        void OnKilled(in KillEvent e)
        {
            lastKilled = e.enemy;
            lastKillInfo = e.info;
        }

        Vector3 StripCenter => strip.transform.position;
        float StripHalfZ => strip.size.y * 0.5f;
        /// <summary>条带南岸、离熔岩边 d 米的地面点（x 偏移 dx）</summary>
        Vector3 Bank(float dx, float d) => StripCenter + new Vector3(dx, 0, -StripHalfZ - d);

        // ───────────── 场地 ─────────────

        void CheckSetup()
        {
            var field = LavaField.Instance;
            var c = StripCenter;
            Line($"熔岩条带：{strip.name}，{strip.size.x:0.#} × {strip.size.y:0.#} m，熔岩面 y {strip.Level:F2}；场上熔岩 {LavaField.Bodies.Count} 片");
            if (!field) Fail("熔岩系统（LavaField）没有起来");
            if (!LavaField.IsLava(c)) Fail("条带中心（地面）不算熔岩");
            if (LavaField.IsLava(Bank(0, 2.5f))) Fail("岸上 2.5 m 算成了熔岩");
            if (!LavaField.IsLavaAt(c.x, c.z)) Fail("只给 XZ 的查询（打射线找地面）说条带中心不是熔岩");
            if (!SafeGround.IsHazard(Bank(0, 0.5f))) Fail("离熔岩 0.5 m 的岸边没有登记成 SafeGround 危险区");
            if (SafeGround.IsHazard(Bank(0, 2.5f))) Fail("离熔岩 2.5 m 的岸上被当成了危险区");

            int area = LavaField.LavaArea;
            if (area < 0) Fail("NavMesh 没有 Lava 区域：ProjectSettings/NavMeshAreas.asset 改动后要重启编辑器，再 bridge.sh level arena");
            else if (!NavMesh.SamplePosition(c, out var hit, 1.5f, NavMesh.AllAreas)) Fail("条带上采不到导航网格");
            else if ((hit.mask & LavaField.LavaAreaMask) == 0) Fail($"条带上的导航网格不是 Lava 区（区域掩码 {hit.mask}）：重建测试场");
            else Line($"✓ 导航：条带上是 Lava 区（第 {area} 号），代价 {NavMesh.GetAreaCost(area)}");
            var swim = LavaField.SwimmerAgentType;
            if (!swim.HasValue) Fail($"NavMesh 没有代理类型 {LavaField.SwimmerAgentName}");
            else if (!NavMesh.SamplePosition(c, out _, 2f, LavaField.SwimmerFilter)) Fail("熔岩生物（LavaSwimmer）的导航网格在条带上采不到：重建测试场（BakeLavaNavMesh）");
            else Line("✓ 熔岩生物导航：LavaSwimmer 网格覆盖条带");

            var edge = FireFeed.FindLavaEdge(Bank(0, 3f), 6f);
            if (edge == null || edge.Kind != FireKind.Lava) Fail("岸上 3 m 找不到熔岩边（FireFeed.LavaEdge 没接上？）");
            else
            {
                Line($"✓ 熔岩边：岸边点 {edge.Position}，可吃 {edge.Edible}");
                if (LavaField.IsLava(edge.Position)) Fail("熔岩边的落脚点在熔岩里");
            }
            OverviewShot("lava_strip", c + new Vector3(0, 7, -12), c);
        }

        // ───────────── 玩家 ─────────────

        void Refill()
        {
            vitals.invulnerableUntil = -1;
            motor.ClearInvulnerability();
            vitals.health = vitals.MaxHealth;
            vitals.shield = vitals.MaxShield;
        }

        float Pool => vitals.health + vitals.shield;

        IEnumerator PlayerCase()
        {
            var field = LavaField.Instance;
            var bank = Bank(0, 2.5f);
            Refill();
            motor.Teleport(bank + Vector3.up * 0.05f, 0);
            yield return new WaitForSeconds(0.8f);
            if ((safe.LastSafe - bank).magnitude > 1.5f) Fail($"在岸上站了 0.8 s，安全点却是 {safe.LastSafe}（应在 {bank} 附近）");
            Refill();
            float pool0 = Pool;
            int entries0 = field ? field.Entries : 0, rec0 = safe.Recoveries;
            // 从熔岩上方 1.5 m 掉进去
            motor.Teleport(StripCenter + Vector3.up * 1.5f, 0);
            float t = 0;
            while (!safe.Sinking && t < 1.5f)
            {
                t += Time.deltaTime;
                yield return null;
            }
            if (!safe.Sinking)
            {
                Fail($"从熔岩上方掉下去 1.5 s 都没有下沉（脚底 {motor.transform.position}，着地 {motor.Grounded}）");
                yield break;
            }
            float burst = pool0 - Pool;
            Shot(cam, "lava_sink");
            t = 0;
            while (safe.Sinking && t < 2f)
            {
                t += Time.deltaTime;
                yield return null;
            }
            yield return null;
            var feet = motor.transform.position;
            float lost = pool0 - Pool, expected = vitals.MaxHealth * (HazardSpec.Lava.burst + HazardSpec.Lava.tick * HazardSpec.Lava.tickTimes.Length);
            Line($"玩家掉进熔岩：首跳 {burst:F1}，合计扣 {lost:F1}（期望 ≈ {expected:F1}，最大生命 {vitals.MaxHealth}），托回到 {feet}，无敌 {motor.InvulnerableTime:F2} s，" +
                 $"踩入 {(field ? field.Entries - entries0 : 0)} 次，托回 {safe.Recoveries - rec0} 次");
            if (field && field.Entries - entries0 != 1) Fail($"一次掉落记了 {field.Entries - entries0} 次踩入（应为 1）");
            if (safe.Sinking) Fail("2 s 后还在下沉");
            if (!(lost >= expected * 0.6f && lost <= expected * 1.25f)) Fail($"扣血 {lost:F1}，期望 ≈ {expected:F1}（12% + 两跳 1.5%）");
            if (!(burst >= vitals.MaxHealth * HazardSpec.Lava.burst * 0.6f)) Fail($"踩进去的瞬间只扣了 {burst:F1}（应 ≈ 最大生命 12%）");
            if (LavaField.IsLava(feet)) Fail("托回之后还在熔岩里");
            if (Vector3.Distance(feet, bank) > 3f) Fail($"托回到 {feet}，离岸上的安全点 {bank} 太远");
            if (!(motor.InvulnerableTime > 0.3f)) Fail($"托回后的无敌只剩 {motor.InvulnerableTime:F2} s（应有 1 s）");
            Refill();
            yield return new WaitForSeconds(1.1f);
        }

        // ───────────── 敌人 ─────────────

        EnemyAI SpawnAt(Vector3 at)
        {
            var e = arena.Spawn(DummyId, false, at - arena.Center);
            if (!e)
            {
                Fail($"刷不出 {DummyId}");
                return null;
            }
            return e;
        }

        /// <summary>出生显形完、眩晕住、挪到 at（导航点）</summary>
        IEnumerator Prepare(EnemyAI e, Vector3 at, float stun)
        {
            yield return new WaitForSeconds(1f);
            if (!e || e.Dead) yield break;
            EnemyStatus.Stun(e.Health, stun);
            yield return null;
            var agent = e.GetComponent<NavMeshAgent>();
            if (agent && agent.enabled && NavMesh.SamplePosition(at, out var hit, 1f, NavMesh.AllAreas)) agent.Warp(hit.position);
            else e.transform.position = at;
            yield return null;
            yield return null;
        }

        IEnumerator WalkInCase()
        {
            var field = LavaField.Instance;
            // 玩家站远一点（南边 8 m），无敌，敌人不会追进熔岩
            motor.Teleport(Bank(0, 8f) + Vector3.up * 0.05f, 0);
            vitals.invulnerableUntil = Time.time + 9999;
            var bank = Bank(6, 2f);
            var e = SpawnAt(bank);
            if (!e) yield break;
            yield return Prepare(e, bank, 4f);
            if (!e || e.Dead)
            {
                Fail("走进熔岩：敌人还没开始就死了");
                yield break;
            }
            int pushed0 = field ? field.PushedBack : 0;
            var agent = e.GetComponent<NavMeshAgent>();
            var inLava = StripCenter + new Vector3(6, 0, 0);
            if (agent && agent.enabled) agent.Warp(inLava);
            else e.transform.position = inLava;
            yield return null;
            yield return null;
            var p = e ? e.transform.position : Vector3.zero;
            Line($"敌人自己走进熔岩：拉回到 {p}，活着 {e && !e.Dead}，拉回 {(field ? field.PushedBack - pushed0 : 0)} 次");
            if (!e || e.Dead) Fail("自己走进熔岩的敌人死了（应被拉回岸上）");
            else if (LavaField.IsLava(p)) Fail("自己走进熔岩的敌人两帧后还在熔岩里");
            else if (Vector3.Distance(p, bank) > 2.5f) Fail($"拉回到 {p}，不是它之前站的岸边 {bank}");
            arena.Clear();
            yield return null;
        }

        IEnumerator KnockCase()
        {
            var field = LavaField.Instance;
            var edgeSpot = Bank(-6, 0.45f);
            var e = SpawnAt(edgeSpot);
            if (!e) yield break;
            yield return Prepare(e, edgeSpot, 4f);
            if (!e || e.Dead)
            {
                Fail("打进熔岩：敌人还没开始就死了");
                yield break;
            }
            int burned0 = field ? field.Burned : 0;
            lastKilled = null;
            var d = e.Health;
            var info = DamageInfo.Simple(1, DamageSource.Weapon, e.transform.position + Vector3.up, Vector3.forward);
            info.knockback = 9;
            info.noCrit = true;
            Combat.DamageEnemy(d, info);
            float t = 0;
            while (e && !e.Dead && t < 2f)
            {
                t += Time.deltaTime;
                yield return null;
            }
            bool dead = !e || e.Dead;
            Line($"打进熔岩：{(dead ? "烧死了" : $"还活着（在 {e.transform.position}）")}，烧死计数 +{(field ? field.Burned - burned0 : 0)}，" +
                 $"击杀事件 {(lastKilled == d ? $"有（来源 {lastKillInfo.source}，元素 {lastKillInfo.element}）" : "没有")}");
            if (!dead) Fail("被击退推向熔岩的敌人 2 s 内没烧死（推力没把它推进 Lava 区？）");
            else
            {
                if (field && field.Burned - burned0 != 1) Fail($"烧死计数 +{field.Burned - burned0}（应为 1）");
                if (lastKilled != d) Fail("烧死没有走伤害管线的击杀事件（不计击杀、不掉落）");
                else if ((lastKillInfo.tags & DamageTag.Purge) != 0) Fail("烧死被当成了静默处决");
            }
            arena.Clear();
            yield return new WaitForSeconds(0.5f);
        }

        // ───────────── 涨潮 ─────────────

        IEnumerator RisingCase()
        {
            var field = LavaField.Instance;
            var spot = new Vector3(22, 0, 40);
            if (Physics.Raycast(spot + Vector3.up * 20, Vector3.down, out var gh, 60, Layers.WorldMask, QueryTriggerInteraction.Ignore)) spot.y = gh.point.y;
            var vol = LavaVolume.Create("Suite Rising Lava", spot + Vector3.down * 0.6f, LavaShape.Box, new Vector2(8, 8), 0, 2f);
            yield return null;
            if (LavaField.IsLava(spot)) Fail("涨潮前地面就算熔岩了（基准面在地下 0.6 m）");
            var enemySpot = spot + new Vector3(2, 0, 0);
            var e = SpawnAt(enemySpot);
            if (e) yield return Prepare(e, enemySpot, 8f);
            // 玩家先在场外岸上站一会儿（安全点），再走进将要被淹的地方
            var outside = spot + new Vector3(0, 0, -7);
            Refill();
            motor.Teleport(outside + Vector3.up * 0.05f, 0);
            yield return new WaitForSeconds(0.8f);
            motor.Teleport(spot + new Vector3(-1, 0.05f, 0), 0);
            yield return new WaitForSeconds(0.3f);
            int entries0 = field ? field.Entries : 0;
            var phases = new List<LavaTidePhase>();
            vol.PhaseChanged += (_, ph) => phases.Add(ph);
            vol.RiseTo(spot.y + 0.25f, 0.6f, 0.4f);
            if (!vol.Flooding) Fail("RiseTo 之后没有进入涨潮（导航网格不会挖掉）");
            float t = 0;
            while (vol.Phase != LavaTidePhase.High && t < 3f)
            {
                t += Time.deltaTime;
                yield return null;
            }
            OverviewShot("lava_rising", spot + new Vector3(0, 6, -10), spot);
            // 下沉 0.5 s + 托回
            t = 0;
            while ((safe.Sinking || (field && field.Entries == entries0)) && t < 1.5f)
            {
                t += Time.deltaTime;
                yield return null;
            }
            yield return null;
            var feet = motor.transform.position;
            bool covered = LavaField.IsLava(spot);
            Line($"涨潮：阶段 {string.Join(" → ", phases)}，熔岩面 {vol.Level:F2}（地面 {spot.y:F2}），地面算熔岩 {covered}；" +
                 $"玩家踩入 {(field ? field.Entries - entries0 : 0)} 次、托回到 {feet}；敌人 {(e ? (e.Dead ? "死了" : $"在 {e.transform.position}") : "没有")}");
            if (!phases.Contains(LavaTidePhase.Warning) || !phases.Contains(LavaTidePhase.Rising) || vol.Phase != LavaTidePhase.High)
                Fail($"涨潮阶段不对：{string.Join(" → ", phases)}，现在 {vol.Phase}（应 预警 → 涨 → 高位）");
            if (!covered) Fail("涨到地面 + 0.25 m 后地面不算熔岩");
            if (field && field.Entries == entries0) Fail("站在被淹的地方，玩家没有下沉");
            if (LavaField.IsLava(feet)) Fail("涨潮后玩家托回的位置还在熔岩里");
            if (e)
            {
                if (e.Dead) Fail("被涨潮淹到的敌人死了（应被挪到岸上）");
                else if (LavaField.IsLava(e.transform.position)) Fail($"被涨潮淹到的敌人还在熔岩里（{e.transform.position}）");
            }
            vol.Recede(0.5f);
            yield return new WaitForSeconds(1f);
            if (LavaField.IsLava(spot)) Fail("退潮后地面还算熔岩");
            if (vol.Flooding) Fail("退潮后还在涨潮状态（导航网格的洞没撤）");
            Destroy(vol.gameObject);
            arena.Clear();
            Refill();
            yield return null;
        }

        void OverviewShot(string name, Vector3 from, Vector3 at)
        {
            var go = new GameObject("Lava Suite Camera");
            var c = go.AddComponent<Camera>();
            c.fieldOfView = 60;
            c.nearClipPlane = 0.05f;
            go.transform.position = from;
            go.transform.LookAt(at);
            Shot(c, name);
            Destroy(go);
        }
    }
}
