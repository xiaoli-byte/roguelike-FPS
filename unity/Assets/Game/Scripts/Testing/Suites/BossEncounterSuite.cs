using System.Collections;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 首领关流程冒烟（B2，bridge.sh playtest boss-encounter；场景 TestArena）：东南 SupplyCamp 标记上开补给营（商店 + 安全区），中央首领场地挂一个 <see cref="BossEncounter"/>（代理首领、封一扇门）——
    ///   · 补给营：在营地里逛 3 s 不会开打；刷在营地里的敌人被挪到圈外；到达营地不白给回复；
    ///   · 门槛：走进场地 → 封门、出生点亮预警、预警期首领还没出来，之后首领登场（名字卡 = 首领自己的登场横幅），目标栏「击败 …」；
    ///   · 战斗中补给营的商店拒绝交易（「战斗中无法交易」）；
    ///   · 拴绳：把首领扔到场地外 40 m → 1 s 内拉回出生点；
    ///   · 击杀：溃散 → 结算：生命 / 护盾回满、魂晶（击杀 60 + 本关 10）、首领宝箱保底史诗（第一章），开箱掉出 ≥ 史诗的枪；门落下；出口升起；
    ///   · 再回营地、再进场地不会再开一场。
    /// </summary>
    public sealed class BossEncounterSuite : PlaytestSuite
    {
        public override string Id => "boss-encounter";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        SupplyCamp camp;
        BossEncounter enc;
        GameObject gate;
        int logErrors;
        string lastError;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals}（场景不是 TestArena？）");
                yield break;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Application.logMessageReceived += OnLog;
            vitals.stats.Add("playtest_boss_encounter", Stat.MaxHp, 3000);
            vitals.Heal(99999);
            EnemyRegistry.PurgeAll();
            RunState.Ensure();

            Setup();
            yield return null;
            yield return null;
            yield return CampCase();
            yield return ThresholdCase();
            if (enc && enc.Boss)
            {
                yield return ShopRefusesInFight();
                yield return TetherCase();
                yield return KillAndSettle();
                yield return NoRepeat();
            }

            Application.logMessageReceived -= OnLog;
            vitals.stats.Remove("playtest_boss_encounter");
            if (enc && enc.Boss && !enc.Boss.Dead) Destroy(enc.Boss.gameObject);
            if (enc && enc.OpenedExit && enc.OpenedExit.name.Contains("(boss)")) Destroy(enc.OpenedExit.gameObject);
            if (enc && enc.RewardChest) Destroy(enc.RewardChest.gameObject);
            if (enc) Destroy(enc.gameObject);
            if (gate) Destroy(gate);
            if (camp) Destroy(camp);
            Line($"合计：运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void Setup()
        {
            arena = BossArena.Find(ProxyBossDef.Id);
            if (!arena)
            {
                Line("场景里没有 BossArena 锚点，临时在 (0, 0) 建一个半径 16 m 的场地");
                arena = BossArena.CreateRuntime(Vector3.zero, 16f, Vector3.forward);
            }
            var marker = GameObject.Find("SupplyCamp");
            if (!marker)
            {
                Line($"场景里没有 SupplyCamp 标记（TestArena 还没重建），在 {ShopSuite.FallbackCenter} 立营地");
                marker = new GameObject("SupplyCamp");
                marker.transform.position = ShopSuite.FallbackCenter;
                var toSpawn = new Vector3(0, 0, -44) - ShopSuite.FallbackCenter;
                marker.transform.rotation = Quaternion.LookRotation(new Vector3(toSpawn.x, 0, toSpawn.z));
            }
            camp = marker.GetComponent<SupplyCamp>();
            if (!camp) camp = marker.AddComponent<SupplyCamp>();
            camp.label = "测试营地";
            camp.Build();

            // 场地朝营地那一侧的边上一扇门（开战升起）
            var toCamp = marker.transform.position - arena.Center;
            toCamp.y = 0;
            toCamp.Normalize();
            gate = GameObject.CreatePrimitive(PrimitiveType.Cube);
            gate.name = "Boss Gate (test)";
            gate.transform.position = arena.Center + toCamp * (arena.Extent + 1f) + Vector3.up * 2.5f;
            gate.transform.rotation = Quaternion.LookRotation(toCamp);
            gate.transform.localScale = new Vector3(6f, 5f, 0.6f);

            var go = new GameObject("Boss Encounter (test)");
            go.transform.position = arena.Center;
            enc = go.AddComponent<BossEncounter>();
            enc.bossId = ProxyBossDef.Id;
            enc.arena = arena;
            enc.difficulty = 1f;
            enc.gates = new[] { gate };
            enc.warnSeconds = 1.5f;
            Line($"补给营：{camp.Shop?.Stalls.Count ?? 0} 个摊位、安全区半径 {camp.Zone?.radius:F0} m；首领场 {arena.name} 半径 {arena.Extent:F0} m；门在 {gate.transform.position}");
        }

        IEnumerator CampCase()
        {
            Teleport(motor, camp.transform.position + camp.transform.forward * 2f);
            vitals.health = vitals.MaxHealth * 0.5f;
            float hp0 = vitals.health;
            // 一只刷在营地正中的敌人：应被挪出去
            var e = EnemyRoster.Spawn("jerboa_blade", camp.transform.position, Quaternion.identity, 1, false);
            float t0 = Time.time;
            while (Time.time - t0 < 3f) yield return null;
            bool idle = enc.State == BossEncounter.Phase.Waiting && BossBrain.Primary == null;
            bool ejected = !e || e.Dead || !camp.Zone.Inside(e.transform.position);
            bool notRestored = vitals.health <= hp0 + 0.5f;
            Line($"营地里逛 3 s：首领关 {enc.State}（应 Waiting）{(idle ? "✓" : "✗")}，营地里的敌人被挪出去 {(ejected ? "✓" : "✗")}（挪了 {camp.Zone.Ejected} 次），" +
                 $"到达不白给回复 {(notRestored ? "✓" : "✗")}（生命 {hp0:F0} → {vitals.health:F0}）");
            if (!idle) Fail("在补给营里就开打了");
            if (!ejected) Fail("敌人待在安全区里没被挪出去");
            if (!notRestored) Fail("到达补给营白给了回复");
            if (e) Destroy(e.gameObject);
            EnemyRegistry.PurgeAll();
            Shot(weapons.eye, "boss_encounter_camp");
        }

        IEnumerator ThresholdCase()
        {
            Teleport(motor, arena.PlayerEntryPoint);
            Aim(motor, eye, arena.BossSpawnPoint + Vector3.up * 3f);
            float t0 = Time.time;
            while (enc.State == BossEncounter.Phase.Waiting && Time.time - t0 < 2f) yield return null;
            bool warned = enc.State == BossEncounter.Phase.Warning;
            bool sealedNow = enc.GatesSealed && gate.activeSelf;
            bool noBossYet = !enc.Boss;
            Line($"进场地：{enc.State}（{Time.time - t0:F1} s），封门 {(sealedNow ? "✓" : "✗")}，预警期首领未出 {(noBossYet ? "✓" : "✗")}");
            if (!warned) Fail("走进首领场没有开始登场预警");
            if (!sealedNow) Fail("开战没有封门");
            if (!noBossYet) Fail("预警期首领就出来了");
            float w0 = Time.time;
            while (!enc.Boss && Time.time - w0 < enc.warnSeconds + 2f) yield return null;
            if (!enc.Boss)
            {
                Fail("预警结束后首领没有生成");
                yield break;
            }
            yield return new WaitForSeconds(0.6f);
            bool objective = GameUI.ObjectiveText.Contains(enc.Def.name);
            float gateY = gate.transform.position.y;
            Line($"首领登场：{enc.Boss.Title}（预警 {Time.time - w0:F1} s 后），目标栏「{GameUI.ObjectiveText}」{(objective ? "✓" : "✗")}，门高 {gateY:F1} m");
            if (!objective) Fail("目标栏没写「击败 首领名」");
            Shot(weapons.eye, "boss_encounter_intro");
            float i0 = Time.time;
            while (!enc.Boss.IntroDone && Time.time - i0 < 5f) yield return null;
        }

        IEnumerator ShopRefusesInFight()
        {
            var shop = camp.Shop;
            var potion = shop ? shop.Find("potion") : null;
            if (!potion) yield break;
            vitals.health = vitals.MaxHealth * 0.5f;
            RunState.Current.Credit(500, "playtest");
            int c0 = RunState.Current.coins;
            var r = potion.BuyNow();
            Line($"首领战中买药：{r}「{shop.Counter.LastRefusal}」");
            if (r != TradeResult.Denied || shop.Counter.LastRefusal != ShopCounter.InCombat || RunState.Current.coins != c0) Fail("首领战中补给营的商店没有拒绝交易");
            yield return null;
        }

        IEnumerator TetherCase()
        {
            var boss = enc.Boss;
            int t0n = enc.Tethers;
            var far = arena.Center + Vector3.right * (arena.Extent + 40f);
            boss.AbortMove();
            boss.transform.position = far;
            float t0 = Time.time;
            while (enc.Tethers == t0n && Time.time - t0 < 1.5f) yield return null;
            yield return null;
            bool back = arena.Contains(boss.transform.position, -2f);
            Line($"拴绳：扔到场外 40 m → {(enc.Tethers > t0n ? $"✓ {Time.time - t0:F2} s 拉回" : "✗ 没拉回")}，现在在场地里 {(back ? "✓" : "✗")}");
            if (enc.Tethers == t0n || !back) Fail("首领出了场地没被拉回");
        }

        IEnumerator KillAndSettle()
        {
            var boss = enc.Boss;
            var hp = boss.Health;
            var run = RunState.Current;
            int essence0 = run.essence;
            vitals.health = vitals.MaxHealth * 0.3f;
            vitals.shield = 0;
            float k0 = Time.time;
            while (!hp.Dead && Time.time - k0 < 8f)
            {
                if (!hp.untargetable)
                {
                    var info = DamageInfo.Simple(99999f, DamageSource.Weapon, boss.BodyCenter, Vector3.forward);
                    info.noCrit = true;
                    Combat.DamageEnemy(hp, info);
                }
                if (vitals.Dead) vitals.Revive();
                yield return null;
            }
            if (!hp.Dead)
            {
                Fail("首领没被打死");
                yield break;
            }
            vitals.health = Mathf.Min(vitals.health, vitals.MaxHealth * 0.3f);
            bool collapsing = enc.State == BossEncounter.Phase.Collapsing;
            float s0 = Time.time;
            while (enc.State != BossEncounter.Phase.Settled && Time.time - s0 < BossEncounter.SettleDelay + 2f) yield return null;
            float settleAt = Time.time - s0;
            yield return null;
            bool healed = vitals.health >= vitals.MaxHealth - 0.5f && vitals.shield >= vitals.MaxShield - 0.5f;
            int essence = run.essence - essence0;
            var chest = enc.RewardChest;
            string reward = chest ? chest.EffectiveReward : "（没有宝箱）";
            Line($"击杀：溃散 {(collapsing ? "✓" : "✗")}，{settleAt:F1} s 后结算（应约 {BossEncounter.SettleDelay} s），回满 {(healed ? "✓" : "✗")}，魂晶 +{essence}，" +
                 $"宝箱「{reward}」档位 {chest?.tier}，溃散敌人 {enc.Dispersed}，去向 {enc.Result}");
            if (!collapsing) Fail("首领倒下没有进入溃散");
            if (enc.State != BossEncounter.Phase.Settled) Fail("溃散后没有结算");
            if (!healed) Fail("结算没有回满生命与护盾");
            int want = (enc.Def?.rewards.essence ?? KillResolver.BossEssence) + EconomyConfig.EssencePerStage;
            if (essence < want) Fail($"魂晶 +{essence}，应至少 +{want}（击杀 + 本关）");
            int min = EconomyConfig.WeaponMinRarity(ChestTier.Boss, EconomyConfig.Chapter);
            if (!chest) Fail("结算没有落首领宝箱");
            else if (chest.tier != ChestTier.Boss || reward != $"weapon:min={min}") Fail($"首领宝箱奖励「{reward}」/ 档位 {chest.tier}，应为 weapon:min={min} / Boss");
            Shot(weapons.eye, "boss_encounter_settled");

            // 开箱：掉一把 ≥ 保底品质的枪
            if (chest)
            {
                Teleport(motor, chest.transform.position + chest.transform.forward * 2f);
                var before = new System.Collections.Generic.HashSet<WeaponPickup>(FindObjectsByType<WeaponPickup>(FindObjectsSortMode.None));
                float c0 = Time.time;
                while (!chest.CanInteract && Time.time - c0 < 2f) yield return null;
                chest.Interact();
                float o0 = Time.time;
                WeaponPickup drop = null;
                while (!drop && Time.time - o0 < 3f)
                {
                    drop = FindObjectsByType<WeaponPickup>(FindObjectsSortMode.None).FirstOrDefault(p => !before.Contains(p));
                    yield return null;
                }
                int rarity = drop && drop.weapon != null ? drop.weapon.rarity : -1;
                Line($"开首领宝箱：掉出 {(drop ? $"{Rarity.Name(rarity)} · {drop.weapon.Title}" : "（没有）")}，保底 {Rarity.Name(min)} {(rarity >= min ? "✓" : "✗")}");
                if (rarity < min) Fail($"首领宝箱掉的枪品质 {rarity} 低于保底 {min}");
                if (drop) Destroy(drop.gameObject);
            }

            // 门落下、出口升起
            float g0 = Time.time;
            while ((gate.activeSelf || !enc.OpenedExit) && Time.time - g0 < BossEncounter.PortalDelay + enc.gateRise + 2f) yield return null;
            bool gateDown = !gate.activeSelf && !enc.GatesSealed;
            bool exitOpen = enc.OpenedExit && enc.OpenedExit.IsOpen;
            Line($"结算后：门落下 {(gateDown ? "✓" : "✗")}，出口 {(enc.OpenedExit ? enc.OpenedExit.name : "（没有）")} 开启 {(exitOpen ? "✓" : "✗")}");
            if (!gateDown) Fail("结算后门没有落下");
            if (enc.Result == BossEncounter.Outcome.NextStage && !exitOpen) Fail("结算后出口没有开启");
            if (enc.OpenedExit) Aim(motor, eye, enc.OpenedExit.Focus);
            yield return new WaitForSeconds(0.5f);
            Shot(weapons.eye, "boss_encounter_exit");
        }

        IEnumerator NoRepeat()
        {
            Teleport(motor, camp.transform.position + camp.transform.forward * 2f);
            yield return new WaitForSeconds(1f);
            Teleport(motor, arena.PlayerEntryPoint);
            float t0 = Time.time;
            while (Time.time - t0 < 3f) yield return null;
            bool again = enc.State != BossEncounter.Phase.Settled || BossBrain.Primary != null;
            Line($"回营地再进场：{(again ? "✗ 又开了一场" : "✓ 没有再开")}，标记 {RunState.Current.Flag(enc.ClearedFlag)}");
            if (again) Fail("打完首领回营地再进场又开了一场");
        }
    }
}
