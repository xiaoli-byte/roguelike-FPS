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
    /// 4-1 三领主在真实场景里打一遍（bridge.sh playtest map-4-1-lords；场景 L4_1_Zheduo，docs/level-design/maps/4-1.md §10）。
    /// 按「夔 → 飞廉 →（点一处普通灵火）→ 化蛇」的顺序打，每一场：
    ///   · 接线：BossEncounter 开着、据点模式、灵火坛是本据点的那座（不挂守卫）；ZheduoLevel 接上门槛；领主没平前站在灵火坛前点不着（只有提示卡）；
    ///   · 门槛：圈外 4 m 站着不开战，圈里 4 m 开战（夔 = 残鼓 22 m、飞廉 = 冰舌顶 32 m、化蛇 = 湖岸擂台 50 m）；
    ///   · 登场演出完整放一遍，交还第一人称误差 &lt; 1 cm / 0.5° / 0.1°（同 B1 冒烟）；
    ///   · 领主梯度：第 n 个打的（0 起）血 × (1 + 0.15 n)、收招 × (1 − 0.1 n)、n = 2 加变体——按本局真实的打败记录算，不手动设；
    ///   · 场地机制用 4-1 的场地件：夔大跳落在充了电的经幡杆（Conductor_Pole_*）旁被回劈；飞廉的狂风被冰脊挡住（玩家站在 Cover_IceRidge_* 背风面）、
    ///     低头冲撞撞上冰脊撞晕；化蛇在圣湖里湿身导电、扑岸搁浅（头胸在岸上）、二阶段涨水淹到岸边、吼叫再涨；
    ///   · 倒下：死亡演出交还误差、据点结算点亮本据点灵火坛、出「X · 平息」横幅、不立出口（场景里的出口不开、不多出出口）；
    ///   · 打败两个领主后出口还关着；再点一处普通灵火（① 碉楼寨）出口开。
    /// 领主在机制段不掉血（Incoming → 0），玩家无敌；场地的自动触发关掉（岸上 / 坡上兽群不刷）。运行时报错由宿主记不合格。
    /// </summary>
    public sealed class Map41LordsSuite : PlaytestSuite
    {
        public override string Id => "map-4-1-lords";
        /// <summary>4-1 折多垭口（与编辑器里 Level_4_1.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L4_1_Zheduo.unity";

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        Transform eye;
        ZheduoLevel level;
        LevelObjective objective;
        ExitPortal portal;
        SpiritAltar[] altars;
        LordBrain boss;
        System.IDisposable guard;

        sealed class Fight
        {
            public string id, name, site;
            public BossEncounter enc;
            public ZheduoLevel.Stronghold sh;
            public SpiritAltar altar;
        }

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
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            vitals.invulnerableUntil = Time.time + 99999;
            vitals.Heal(99999);
            RunState.Ensure();
            ClearFlags();

            level = FindAnyObjectByType<ZheduoLevel>();
            portal = FindAnyObjectByType<ExitPortal>();
            objective = portal ? LevelObjective.For(portal.gameObject.scene) : FindAnyObjectByType<LevelObjective>();
            altars = FindObjectsByType<SpiritAltar>().OrderBy(a => a.name).ToArray();
            if (!level || !portal || !objective || altars.Length == 0)
            {
                Fail($"场景不是 4-1（先 bridge.sh level 4-1）：ZheduoLevel {(bool)level}，出口 {(bool)portal}，目标 {(bool)objective}，灵火坛 {altars.Length}");
                yield break;
            }
            // 穷奇开局刷：等它刷出来再清掉；场地的自动触发关掉（只测领主）
            float w0 = Time.time;
            while (!level.RoamerSpawned && Time.time - w0 < 8f) yield return null;
            yield return null;
            EnemyRegistry.PurgeAll();
            var sites = FindObjectsByType<EncounterSite>().ToArray();
            var auto = sites.ToDictionary(s => s, s => s.autoTrigger);
            foreach (var s in sites) s.autoTrigger = false;

            var fights = Wiring();
            if (fights != null)
            {
                yield return Sealed(fights);
                int order = 0;
                foreach (var id in new[] { KuiDef.Id, FeilianDef.Id })
                    yield return FightOne(fights[id], order++);
                yield return OpenWithNormalAltar();
                yield return FightOne(fights[HuasheDef.Id], order);
            }

            Guard(false);
            foreach (var kv in auto) kv.Key.autoTrigger = kv.Value;
            BossIntroDirector.Policy = BossIntroPolicy.Auto;
            LightningStrike.ClearAll();
            PlateauStorm.StopAll();
            GameUI.SetBoss(null);
            Line($"合计：灵火 {objective.AltarsLit}/{objective.AltarsNeeded}，出口{(portal.IsOpen ? "开着" : "关着")}，本局打败领主 {LordScaling.Defeated(LordDef.Level)} 个");
        }

        static void ClearFlags()
        {
            var run = RunState.Current;
            if (run?.flags == null) return;
            foreach (var k in run.flags.Keys.Where(k => k.StartsWith("lord.") || k.StartsWith("boss_cleared:")).ToList()) run.flags.Remove(k);
        }

        // ───────────── 接线 ─────────────

        Dictionary<string, Fight> Wiring()
        {
            Line("── 接线 ──");
            var map = new Dictionary<string, Fight>();
            var encs = FindObjectsByType<BossEncounter>(FindObjectsInactive.Include);
            foreach (var (id, site) in new[] { (KuiDef.Id, "s6"), (FeilianDef.Id, "s5"), (HuasheDef.Id, "s4") })
            {
                var enc = encs.FirstOrDefault(e => e.bossId == id);
                var altar = altars.FirstOrDefault(a => a.name.EndsWith("_" + site));
                var sh = level.strongholds.FirstOrDefault(s => s != null && s.encounter == enc);
                string name = Bosses.Get(id)?.name ?? id;
                if (!enc || !altar || sh == null || !sh.center)
                {
                    Fail($"{name}：首流程 {(bool)enc}，灵火坛 {(bool)altar}，ZheduoLevel 门槛 {(sh != null && sh.center)}");
                    continue;
                }
                var bad = new List<string>();
                if (!enc.enabled) bad.Add("BossEncounter 关着");
                if (!enc.stronghold) bad.Add("不是据点模式");
                if (enc.altar != altar) bad.Add($"点亮的灵火坛是 {(enc.altar ? enc.altar.name : "空")}，不是 {altar.name}");
                if (altar.guard) bad.Add($"灵火坛挂着守卫 {altar.guard.title}");
                if (enc.State != BossEncounter.Phase.Waiting) bad.Add($"开局状态 {enc.State}（应 Waiting）");
                Line($"{(bad.Count == 0 ? "✓" : "✗")} {name}：据点模式 {enc.stronghold}，灵火坛 {altar.name}，门槛 {sh.center.name} {sh.radius:F0} m（脚 y {sh.minY:F1}…{sh.maxY:F1}）" +
                     (bad.Count > 0 ? $"——{string.Join("；", bad)}" : ""));
                foreach (var b in bad) Fail($"{name}：{b}");
                map[id] = new Fight { id = id, name = name, site = site, enc = enc, sh = sh, altar = altar };
            }
            if (map.Count != 3)
            {
                Fail("三个领主据点没有全部接上，后面不打了");
                return null;
            }
            Line($"目标：灵火 {objective.AltarsLit}/{objective.AltarsNeeded}（共 {objective.altars.Length} 座），出口{(portal.IsOpen ? "开着 ✗" : "关着")}");
            if (portal.IsOpen) Fail("开局出口就开着");
            return map;
        }

        /// <summary>领主没平：站在据点灵火坛前只有提示卡，按住也点不着</summary>
        IEnumerator Sealed(Dictionary<string, Fight> fights)
        {
            Line("── 领主据点的灵火坛：领主没平前点不着 ──");
            foreach (var f in fights.Values) f.enc.enabled = false;
            foreach (var f in fights.Values)
            {
                var a = f.altar;
                Teleport(motor, a.transform.position + a.transform.forward * 2f);
                yield return new WaitForSeconds(0.3f);
                Aim(motor, eye, a.Focus);
                yield return new WaitForSeconds(0.2f);
                var cur = interactor.Current;
                bool sealedCard = cur is ZheduoLevel.LordAltarSeal seal && seal.Altar == a;
                interactor.testInteract = true;
                float t0 = Time.time;
                while (Time.time - t0 < a.kindleTime + 1f) yield return null;
                interactor.testInteract = false;
                Line($"{(sealedCard && !a.Lit ? "✓" : "✗")} {a.title}：提示「{cur?.Prompt ?? "无"}」，按住 {a.kindleTime + 1f:F1} s {(a.Lit ? "点亮了 ✗" : "没点亮")}");
                if (!sealedCard) Fail($"{a.title}：领主没平时交互的不是封印提示卡（{cur?.GetType().Name ?? "无"}）");
                if (a.Lit) Fail($"{a.title}：领主没平就被手动点亮了");
            }
            // 化蛇的灵火坛在湖岸擂台的门槛里：先回出生点再把首领流程打开
            var spawn = FindAnyObjectByType<PlayerSpawn>();
            if (spawn) Teleport(motor, spawn.transform.position);
            yield return new WaitForSeconds(0.3f);
            foreach (var f in fights.Values) f.enc.enabled = true;
        }

        // ───────────── 一场领主战 ─────────────

        IEnumerator FightOne(Fight f, int order)
        {
            Line($"── 第 {order + 1} 个：{f.name} ──");
            EnemyRegistry.PurgeAll();
            yield return Threshold(f);
            if (!boss)
            {
                Fail($"{f.name}：没有开打，后面跳过");
                yield break;
            }
            Tier(f, order);
            Guard(true);
            if (f.id == KuiDef.Id) yield return KuiMechanics(f, order);
            else if (f.id == FeilianDef.Id) yield return FeilianMechanics(f, order);
            else yield return HuasheMechanics(f, order);
            yield return Kill(f, order);
            Guard(false);
            boss = null;
        }

        /// <summary>门槛：圈外站着不开战、走进圈里开战；登场演出放完、量交还误差</summary>
        IEnumerator Threshold(Fight f)
        {
            boss = null;
            var c = f.sh.center.position;
            // 从圆心朝灵火坛的方向（玩家通常从坛那边过来）起，左右找圈外 / 圈里都站得住的一对点
            var toAltar = f.altar.transform.position - c;
            toAltar.y = 0;
            float baseYaw = Mathf.Atan2(toAltar.x, toAltar.z) * Mathf.Rad2Deg;
            Vector3 outside = default, inside = default;
            bool found = false;
            for (int k = 0; k < 24 && !found; k++)
            {
                float yaw = baseYaw + (k % 2 == 0 ? 1 : -1) * (k + 1) / 2 * 15f;
                var d = Quaternion.Euler(0, yaw, 0) * Vector3.forward;
                if (!Stand(c + d * (f.sh.radius + 4f), out outside) || !Stand(c + d * (f.sh.radius - 4f), out inside)) continue;
                if (Flat(outside - c) < f.sh.radius + 1f || Flat(inside - c) > f.sh.radius - 1f) continue;
                found = true;
            }
            if (!found)
            {
                Fail($"{f.name}：门槛圈外 / 圈里找不到站得住的点");
                yield break;
            }
            var spawn = f.enc.arena ? f.enc.arena.BossSpawnPoint : c;
            Teleport(motor, outside);
            Aim(motor, eye, spawn + Vector3.up * 3f);
            yield return new WaitForSeconds(0.8f);
            bool quietOutside = f.enc.State == BossEncounter.Phase.Waiting;
            BossIntroLog.Current.Forget(f.id);
            BossIntroDirector.Policy = BossIntroPolicy.Always;
            Teleport(motor, inside);
            Aim(motor, eye, spawn + Vector3.up * 3f);
            float t0 = Time.time;
            while (f.enc.State == BossEncounter.Phase.Waiting && Time.time - t0 < 1.5f) yield return null;
            bool began = f.enc.State != BossEncounter.Phase.Waiting;
            Line($"门槛：圈外 {Flat(outside - c):F1} m 站 0.8 s {(quietOutside ? "没开战 ✓" : "开战了 ✗")}，圈里 {Flat(inside - c):F1} m {(began ? $"{Time.time - t0:F2} s 后开战 ✓" : "没开战 ✗")}");
            if (!quietOutside) Fail($"{f.name}：门槛外 {Flat(outside - c):F1} m 就开战了（门槛 {f.sh.radius:F0} m）");
            if (!began)
            {
                Fail($"{f.name}：走进门槛 {Flat(inside - c):F1} m 没开战");
                BossIntroDirector.Policy = BossIntroPolicy.Never;
                yield break;
            }
            var dir = f.enc.Intro;
            if (!dir)
            {
                Fail($"{f.name}：登场演出没有接管（BossIntroDirector.Play 返回 null）");
                BossIntroDirector.Policy = BossIntroPolicy.Never;
            }
            else
            {
                var script = dir.Script;
                var taken = new HashSet<int>();
                t0 = Time.time;
                while (dir && !dir.Released && Time.time - t0 < script.Seconds + 6f)
                {
                    int i = dir.ShotIndex;
                    if (i >= 0 && i < script.shots.Count && !taken.Contains(i) && dir.Elapsed - script.ShotStart(i) > script.shots[i].seconds * 0.6f)
                    {
                        taken.Add(i);
                        if (dir.Camera) Shot(dir.Camera, $"map41_lord_intro_{Short(f.id)}_{i}_{script.shots[i].name}");
                    }
                    yield return null;
                }
                if (!dir) Fail($"{f.name}：登场演出没了");
                else
                {
                    Line($"登场：{script.Seconds:F1} s，{script.shots.Count} 镜，交还误差 {dir.HandoffMeters * 100f:F2} cm / {dir.HandoffDegrees:F2}° / 视角 {dir.HandoffFov:F2}°，" +
                         $"名字卡 {(dir.NameCardShown ? "✓" : "✗")}，结束 {dir.EndReason}");
                    if (!(dir.HandoffMeters < 0.01f && dir.HandoffDegrees < 0.5f && dir.HandoffFov < 0.1f)) Fail($"{f.name}：登场交还第一人称有误差");
                    if (!dir.NameCardShown) Fail($"{f.name}：登场没有打名字卡");
                }
                BossIntroDirector.Policy = BossIntroPolicy.Never;
            }
            t0 = Time.time;
            while (!(f.enc.Boss is LordBrain) && Time.time - t0 < 6f) yield return null;
            boss = f.enc.Boss as LordBrain;
            if (!boss) yield break;
            t0 = Time.time;
            while (!boss.IntroDone && Time.time - t0 < 6f) yield return null;
            if (!boss.IntroDone) Fail($"{f.name}：交还之后没有开打");
            yield return new WaitForSeconds(0.3f);
        }

        /// <summary>领主梯度：按本局已经打败的领主数，第 n 个打的血 × (1 + 0.15 n)、收招 × (1 − 0.1 n)、n ≥ 2 加变体</summary>
        void Tier(Fight f, int order)
        {
            var def = boss.Def;
            float lvl = Mathf.Max(0.5f, EnemyRoster.ResolveDifficulty(f.enc.difficulty));
            float baseHp = def.VitalsAt(lvl).hp;
            float hpK = baseHp > 0 ? boss.Health.maxHealth / baseHp : 0;
            var t = boss.Lord;
            float wantHp = 1f + 0.15f * order, wantRec = 1f - 0.1f * order;
            bool ok = t.index == order && Mathf.Abs(hpK - wantHp) < 0.01f && Mathf.Abs(boss.RecoverScale - wantRec) < 0.001f && boss.Variant == (order >= 2);
            Line($"{(ok ? "✓" : "✗")} 领主梯度：第 {t.index + 1} 个打（应第 {order + 1} 个），生命 {boss.Health.maxHealth:F0} = 难度 {lvl:F2} 定档 {baseHp:F0} × {hpK:F3}（应 ×{wantHp:F2}），" +
                 $"收招倍率 {boss.RecoverScale:F3}（应 ×{wantRec:F2}），变体 {(boss.Variant ? "有" : "无")}（应{(order >= 2 ? "有" : "无")}）");
            if (t.index != order) Fail($"{f.name}：领主梯度档位 {t.index}，应为 {order}（第 {order + 1} 个打）");
            if (Mathf.Abs(hpK - wantHp) >= 0.01f) Fail($"{f.name}：第 {order + 1} 个打的血量倍率 {hpK:F3}，应 {wantHp:F2}");
            if (Mathf.Abs(boss.RecoverScale - wantRec) >= 0.001f) Fail($"{f.name}：收招倍率 {boss.RecoverScale:F3}，应 {wantRec:F2}");
            if (boss.Variant != order >= 2) Fail($"{f.name}：变体开关 {boss.Variant}，第 {order + 1} 个打应 {order >= 2}");
        }

        /// <summary>强制出一招，量这一招实际的收招段 / 设计值（同类型新实例的构造值）</summary>
        bool Force(string id, int order, out LordMove move)
        {
            move = boss.MoveById(id) as LordMove;
            if (move == null)
            {
                Fail($"{boss.Def.name}：没有招式 {id}");
                return false;
            }
            float design = ((BossMove)System.Activator.CreateInstance(move.GetType())).recover;
            if (!boss.ForceMove(id))
            {
                Fail($"{move.Name}：强制出招失败");
                return false;
            }
            float k = design > 0 ? move.recover / design : 0, want = (1f - 0.1f * order) * boss.PhaseTempo;
            Line($"{(Mathf.Abs(k - want) < 0.005f ? "✓" : "✗")} {move.Name} 收招 {move.recover:F2} s = 设计 {design:F2} s × {k:F3}（应 ×{want:F2}：梯度 × 阶段节奏 {boss.PhaseTempo:F2}）");
            if (Mathf.Abs(k - want) >= 0.005f) Fail($"{move.Name}：第 {order + 1} 个打的收招倍率 {k:F3}，应 {want:F2}");
            return true;
        }

        // ───────────── 夔：经幡杆回劈 ─────────────

        IEnumerator KuiMechanics(Fight f, int order)
        {
            var kui = boss as KuiBrain;
            var arena = f.enc.arena;
            Line($"夔：残鼓 {(kui.Drum ? (kui.Drum.Placeholder ? "占位 ✗" : $"场景里的 {kui.Drum.name} ✓") : "没有 ✗")}，现身后{(kui.Drum && kui.Drum.Visible ? "露着" : "藏起")}，" +
                 $"雷暴 {(PlateauStorm.Active ? "✓" : "✗")}，栖点 {(arena.perchPoints.Length > 0 && arena.perchPoints[0] ? arena.perchPoints[0].name : "无")}");
            if (!kui.Drum || kui.Drum.Placeholder) Fail("夔没用上场景里的残鼓（KuiDrum）");
            var poles = Conductor.All.Where(p => p && p.name.StartsWith("Conductor_Pole") && arena.Contains(p.Base)).ToList();
            if (poles.Count == 0)
            {
                Fail("夔的擂台里没有经幡杆导体（Conductor_Pole_*）");
                yield break;
            }
            yield return WaitIdle();
            var pole = poles.OrderBy(p => Flat(p.Base - boss.transform.position)).First();
            var spot = pole.Base + Flatten(arena.Center - pole.Base).normalized * 2.5f;
            Line($"擂台里经幡杆 {poles.Count} 根，挑离夔最近的 {pole.name}（{Flat(pole.Base - boss.transform.position):F1} m），玩家站在杆旁 2.5 m");
            int b0 = kui.Backlashes;
            bool measured = false;
            for (int leap = 0; leap < 3 && kui.Backlashes == b0; leap++)
            {
                yield return WaitIdle();
                Place(spot, boss.BodyCenter);
                pole.AddCharge(1f);
                yield return null;
                if (!measured)
                {
                    measured = true;
                    if (!Force(KuiLeap.MoveId, order, out _)) yield break;
                }
                else if (!boss.ForceMove(KuiLeap.MoveId)) continue;
                float t0 = Time.time;
                while (kui.Backlashes == b0 && boss.Current is KuiLeap && Time.time - t0 < 5f)
                {
                    pole.AddCharge(1f);
                    yield return null;
                }
            }
            yield return new WaitForSeconds(0.3f);
            Shot(weapons.eye, "map41_lord_kui_backlash");
            Line($"{(kui.Backlashes > b0 ? "✓" : "✗")} 经幡杆回劈：夔落在 {pole.name} 旁 {Flat(pole.Base - boss.transform.position):F1} m，回劈 {kui.Backlashes - b0} 次，硬直 {boss.Staggered}");
            if (kui.Backlashes == b0) Fail("夔大跳落在充了电的经幡杆旁没有被回劈");
            yield return WaitIdle();
        }

        // ───────────── 飞廉：冰脊背风掩体 + 撞冰脊 ─────────────

        IEnumerator FeilianMechanics(Fight f, int order)
        {
            var fei = boss as FeilianBrain;
            var arena = f.enc.arena;
            Line($"飞廉：风涡柱 {(fei.Vortex ? "✓" : "✗")}，擂台风 {(fei.Wind != null ? $"strength {fei.Wind.strength:+0.0;-0.0}" : "✗")}，风雷珠 {(fei.Orb ? "✓" : "✗")}，" +
                 $"掩体点 {arena.coverPoints.Count(c => c)} 个");
            if (!fei.Vortex) Fail("飞廉没找到风涡柱");
            if (fei.Wind == null || !(fei.Wind.strength < 0)) Fail("飞廉一阶段的擂台风应往外推");
            yield return WaitIdle();
            // 背风掩体：挑一个从风雷珠看过去被冰脊挡住的冰脊背风点（没有就退到巨石）
            Transform cover = null;
            for (int pass = 0; pass < 2 && !cover; pass++)
            {
                var orb = fei.BonePos(FeilianDef.WeakBone);
                string prefix = pass == 0 ? "Cover_IceRidge" : "Cover_Boulder";
                cover = arena.coverPoints.Where(c => c && c.name.StartsWith(prefix) && Flat(c.position - boss.transform.position) < FeilianGust.Range - 4f)
                    .Where(c => !Combat.LineClear(orb, c.position + Vector3.up * 1.1f))
                    .OrderBy(c => Flat(c.position - boss.transform.position)).FirstOrDefault();
            }
            if (!cover)
            {
                Fail("飞廉的掩体点从风雷珠看过去都没被挡住（冰脊 / 巨石摆的方向不对？）");
                yield break;
            }
            var at = cover.position;
            Place(at, boss.BodyCenter);
            yield return null;
            if (!Force(FeilianGust.MoveId, order, out var gm)) yield break;
            var gust = gm as FeilianGust;
            float t0 = Time.time;
            while (boss.Current == gust && Time.time - t0 < 4f)
            {
                Teleport(motor, at);
                Aim(motor, eye, boss.BodyCenter);
                yield return null;
            }
            Shot(weapons.eye, "map41_lord_feilian_cover");
            Line($"{(gust.LastCovered && !gust.LastHit ? "✓" : "✗")} 背风掩体：玩家在 {cover.name}（离飞廉 {Flat(at - boss.transform.position):F1} m），狂风被挡 {(gust.LastCovered ? "✓" : "✗")}、吹到 {(gust.LastHit ? "✗" : "没有 ✓")}");
            if (!gust.LastCovered || gust.LastHit) Fail($"躲在 {cover.name} 还是被狂风吹到");
            // 撞冰脊：玩家还在背风点，飞廉朝玩家低头冲撞，路上是冰脊
            yield return WaitIdle();
            Place(at, boss.BodyCenter);
            boss.FaceNow(at);
            yield return null;
            int c0 = fei.Crashes;
            if (!boss.ForceMove(FeilianCharge.MoveId))
            {
                Fail("低头冲撞强制出招失败");
                yield break;
            }
            var charge = boss.MoveById(FeilianCharge.MoveId) as FeilianCharge;
            t0 = Time.time;
            while (fei.Crashes == c0 && boss.Current == charge && Time.time - t0 < 4f) yield return null;
            yield return new WaitForSeconds(0.4f);
            Shot(weapons.eye, "map41_lord_feilian_crash");
            Line($"{(fei.Crashes > c0 ? "✓" : "✗")} 低头冲撞撞冰脊：撞晕 {(fei.Crashes > c0 ? "✓" : "✗")}（冲了 {charge.Travelled:F1} m，停在离 {cover.name} {Flat(boss.transform.position - at):F1} m，硬直 {boss.Staggered}）");
            if (fei.Crashes == c0) Fail("飞廉朝冰脊后的玩家冲撞，没有撞上冰脊撞晕");
            yield return WaitIdle();
        }

        // ───────────── 化蛇：湿身、搁浅、涨水 ─────────────

        IEnumerator HuasheMechanics(Fight f, int order)
        {
            var hua = boss as HuasheBrain;
            var lake = hua.Lake;
            Line($"化蛇：湖 {(lake.Real ? "场景里的 Water_HolyLake ✓" : "测试场虚拟湖 ✗")}，中心（湖心岛）{Fmt(lake.Center)}，半轴 {lake.Rx:F1} × {lake.Rz:F1} m、朝向 {lake.Yaw:F1}°，水位 {lake.Level:F2}");
            if (!lake.Real) Fail("化蛇没读到场景里的圣湖");
            // 湿身导电
            Guard(false);
            boss.Health.health = boss.Health.maxHealth;
            float h0 = boss.Health.health;
            int w0 = hua.WetShocks;
            bool wet = hua.Wet;
            Combat.DamageEnemy(boss.Health, new DamageInfo { amount = 100f, element = Element.Shock, source = DamageSource.Weapon, noCrit = true, point = boss.BodyCenter, direction = Vector3.forward });
            float shock = h0 - boss.Health.health;
            h0 = boss.Health.health;
            Combat.DamageEnemy(boss.Health, new DamageInfo { amount = 100f, element = Element.None, source = DamageSource.Weapon, noCrit = true, point = boss.BodyCenter, direction = Vector3.forward });
            float plain = h0 - boss.Health.health;
            boss.Health.health = boss.Health.maxHealth;
            Guard(true);
            bool shockOk = wet && hua.WetShocks > w0 && shock > plain * 1.3f;
            Line($"{(shockOk ? "✓" : "✗")} 湿身：在湖里 {(wet ? "✓" : "✗")}，雷殛 100 → {shock:F0}、无属性 100 → {plain:F0}（{(plain > 0 ? shock / plain : 0):F2} 倍）");
            if (!shockOk) Fail("化蛇在圣湖里没有湿身导电（雷殛 × 1.5）");

            // 搁浅：找游线上离岸最近的一处，玩家站到那段岸上，化蛇游过来扑岸
            yield return WaitIdle();
            float bestGap = float.MaxValue, bestA = 0;
            Vector3 bestShore = default, bestOut = default;
            for (int i = 0; i < 72; i++)
            {
                float a = i * Mathf.PI * 2 / 72;
                var p = lake.SwimPoint(a, 0, out _);
                var o = Flatten(p - lake.Center).normalized;
                for (float r = 0.5f; r < 40f; r += 0.5f)
                {
                    var q = p + o * r;
                    if (hua.GroundAt(q) < lake.Level + 0.6f) continue;
                    if (r < bestGap)
                    {
                        bestGap = r;
                        bestA = a;
                        bestShore = q;
                        bestOut = o;
                    }
                    break;
                }
            }
            var stand = bestShore + bestOut * 1.5f;
            hua.SwimAngle = bestA;
            Place(stand, boss.BodyCenter);
            float t0 = Time.time;
            while (Time.time - t0 < 1.5f) yield return null;
            yield return WaitIdle();
            Place(stand, boss.BodyCenter);
            Line($"游线离岸最近 {bestGap:F1} m（游线角 {bestA * Mathf.Rad2Deg:F0}°），玩家站在岸上 {Fmt(stand)}，化蛇头离玩家 {Flat(boss.BonePos("head") - stand):F1} m");
            yield return null;
            if (!Force(HuasheLunge.MoveId, order, out var lm)) yield break;
            var lunge = lm as HuasheLunge;
            bool sawRecover = false, headLand = false, chestLand = false, rootDry = false;
            float landedGround = float.NaN;
            t0 = Time.time;
            while (boss.Current == lunge && Time.time - t0 < 6f)
            {
                if (lunge.Stage == MoveStage.Recover && lunge.StageT < lunge.recover * 0.6f)
                {
                    if (!sawRecover) Shot(weapons.eye, "map41_lord_huashe_stranded");
                    sawRecover = true;
                    headLand |= hua.GroundAt(boss.BonePos("head")) > lake.Level;
                    chestLand |= hua.GroundAt(boss.BodyCenter) > lake.Level;
                    rootDry |= !hua.Wet;
                    landedGround = hua.GroundAt(boss.transform.position) - lake.Level;
                }
                yield return null;
            }
            bool stranded = sawRecover && headLand && chestLand;
            Line($"{(stranded ? "✓" : "✗")} 扑岸搁浅：扑到 {Fmt(lunge.Landed)}（落点地面比水面 {landedGround:+0.00;-0.00} m），头在岸上 {(headLand ? "✓" : "✗")}、胸在岸上 {(chestLand ? "✓" : "✗")}、" +
                 $"根节点出水（不湿身）{(rootDry ? "✓" : "✗")}，咬到 {lunge.Bit}");
            if (!stranded) Fail("化蛇扑岸没有搁浅（头胸应在岸上）");
            // 第三个打：扑岸接翼拍浪（变体）
            if (order >= 2)
            {
                t0 = Time.time;
                bool slap = false;
                while (Time.time - t0 < 4f && !slap)
                {
                    slap = boss.Current is HuasheWingSlap;
                    yield return null;
                }
                Line($"{(slap ? "✓" : "✗")} 变体：扑岸之后接翼拍浪 {(slap ? "✓" : "✗")}");
                if (!slap) Fail("第三个打的化蛇扑岸后没有接翼拍浪（变体）");
            }
            float back = Time.time;
            while (!hua.Wet && Time.time - back < 4f) yield return null;
            if (!hua.Wet) Fail("化蛇搁浅后没有滑回水里");

            // 涨水：转二阶段常驻 +1.2 m，淹到岸边；吼叫再涨
            yield return WaitIdle();
            var pd = boss.Def.phases[0];
            Guard(false);
            boss.Health.health = boss.Health.maxHealth * (pd.at - 0.01f);
            Guard(true);
            t0 = Time.time;
            while ((boss.Phase < 1 || boss.Transitioning) && Time.time - t0 < 10f) yield return null;
            if (boss.Phase < 1)
            {
                Fail("化蛇没有进二阶段");
                yield break;
            }
            // 找一处湖岸：地面比原水位高 0.3–0.9 m（不涨水时是干的）
            Vector3 beach = default;
            bool hasBeach = false;
            for (float r = 0; r < 12f && !hasBeach; r += 0.25f)
            {
                var q = bestShore + bestOut * r;
                float g = hua.GroundAt(q) - lake.BaseLevel;
                if (g > 0.3f && g < 0.9f)
                {
                    beach = q;
                    hasBeach = true;
                }
            }
            if (hasBeach)
            {
                Place(beach, boss.BodyCenter);
                yield return new WaitForSeconds(0.6f);
            }
            float depth = WaterVolume.PlayerDepth;
            Line($"{(lake.Flood > 1.1f && lake.FloodVolume ? "✓" : "✗")} 涨水：常驻 +{lake.Flood:F2} m，涨水面 {(lake.FloodVolume ? "✓" : "✗")}，" +
                 (hasBeach ? $"岸边（原来比水面高 {hua.GroundAt(beach) - lake.BaseLevel:F2} m）淹到 {depth:F2} m {(depth > 0.05f ? "✓" : "✗")}" : "没找到比水面高 0.3–0.9 m 的岸"));
            if (lake.Flood < 1.1f || !lake.FloodVolume) Fail("二阶段湖水没有常驻涨 1.2 m");
            if (hasBeach && depth <= 0.05f) Fail("涨水没有淹到岸边");
            Shot(weapons.eye, "map41_lord_huashe_flood");
            yield return WaitIdle();
            if (Force(HuasheRoar.MoveId, order, out var rm))
            {
                t0 = Time.time;
                while (boss.Current == rm && Time.time - t0 < 8f) yield return null;
                Line($"{(lake.Surge >= 0.6f ? "✓" : "✗")} 吼叫涨水：再涨 {lake.Surge:F2} m（水位 {lake.Level:F2}）");
                if (lake.Surge < 0.6f) Fail("吼叫没有再涨水");
            }
            yield return WaitIdle();
        }

        // ───────────── 倒下 ─────────────

        IEnumerator Kill(Fight f, int order)
        {
            yield return WaitIdle();
            var at = boss.transform.position + Flatten(boss.transform.forward).normalized * 12f;
            if (f.enc.arena) at = f.enc.arena.Clamp(at, 2f);
            if (boss is HuasheBrain hb) at = hb.Lake.Center + Flatten(boss.transform.position - hb.Lake.Center).normalized * (Mathf.Max(hb.Lake.Rx, hb.Lake.Rz) + 4f);
            Place(at, boss.BodyCenter);
            Guard(false);
            boss.Break?.Cancel();
            int exits = FindObjectsByType<ExitPortal>(FindObjectsInactive.Include).Length;
            bool open0 = portal.IsOpen;
            int lit0 = objective.AltarsLit;
            boss.Health.health = 1f;
            boss.Health.healthFloor = 0;
            Combat.DamageEnemy(boss.Health, new DamageInfo { amount = 999999f, source = DamageSource.Weapon, point = boss.BodyCenter, direction = Vector3.forward });
            yield return null;
            if (!boss.Dead)
            {
                Fail($"{f.name} 没死");
                yield break;
            }
            var cin = boss.DeathCinema;
            float t0 = Time.time;
            bool shot = false;
            var spec = (boss.Def as LordDef)?.death;
            while (cin && !cin.Released && cin.Phase != LordCinema.Stage.Done && Time.time - t0 < (spec?.seconds ?? 6f) + 6f)
            {
                if (!shot && spec != null && cin.Elapsed > spec.cardAt + 0.4f)
                {
                    shot = true;
                    Shot(weapons.eye, $"map41_lord_death_{Short(f.id)}");
                }
                yield return null;
            }
            if (!cin) Fail($"{f.name}：没有死亡演出（LordCinema）");
            else
            {
                Line($"死亡演出：{Time.time - t0:F1} s，交还误差 {cin.HandoffMeters * 100f:F2} cm / {cin.HandoffDegrees:F2}° / 视角 {cin.HandoffFov:F2}°，名字卡 {(cin.NameCardShown ? "✓" : "✗")}");
                if (!cin.Released) Fail($"{f.name}：死亡演出没有交还镜头");
                else if (!(cin.HandoffMeters < 0.01f && cin.HandoffDegrees < 0.5f && cin.HandoffFov < 0.1f)) Fail($"{f.name}：死亡演出交还第一人称有误差");
            }
            string banner = null;
            t0 = Time.time;
            while (f.enc.State != BossEncounter.Phase.Settled && Time.time - t0 < BossEncounter.StrongholdSettleDelay + 4f) yield return null;
            for (int i = 0; i < 10 && banner == null; i++)
            {
                var title = UIRoot.Instance ? UIRoot.Instance.Banner?.Title : null;
                if (title != null && title.Contains("平息")) banner = title;
                else yield return null;
            }
            yield return new WaitForSeconds(0.6f);
            int exits2 = FindObjectsByType<ExitPortal>(FindObjectsInactive.Include).Length;
            bool recorded = LordScaling.IsDefeated(LordDef.Level, f.id);
            Line($"据点结算：{f.enc.State}，{f.altar.title} {(f.altar.Lit ? "点亮 ✓" : "没亮 ✗")}，横幅「{banner ?? "没看到"}」，出口 {exits} → {exits2} 个、" +
                 $"{(open0 ? "开着" : "关着")} → {(portal.IsOpen ? "开着" : "关着")}，灵火 {lit0} → {objective.AltarsLit}，领主梯度记账 {(recorded ? "✓" : "✗")}（本局已打败 {LordScaling.Defeated(LordDef.Level)} 个）");
            Shot(weapons.eye, $"map41_lord_settled_{Short(f.id)}");
            if (f.enc.State != BossEncounter.Phase.Settled) Fail($"{f.name}：据点没有结算");
            if (!f.altar.Lit) Fail($"{f.name}：打败后没有点亮 {f.altar.title}");
            if (banner == null) Fail($"{f.name}：打败后没有出「平息」横幅");
            if (exits2 > exits || f.enc.OpenedExit) Fail($"{f.name}：据点模式立了出口");
            if (!open0 && portal.IsOpen && objective.AltarsLit < objective.AltarsNeeded) Fail($"{f.name}：灵火没点够出口就开了");
            if (objective.AltarsLit != lit0 + 1) Fail($"{f.name}：灵火计数 {lit0} → {objective.AltarsLit}（应 +1）");
            if (!recorded) Fail($"{f.name}：领主梯度没有记账");
            if (LordScaling.Defeated(LordDef.Level) != order + 1) Fail($"打完第 {order + 1} 个领主，本局记了 {LordScaling.Defeated(LordDef.Level)} 个");
        }

        // ───────────── 两个领主 + 一处普通灵火 → 出口 ─────────────

        IEnumerator OpenWithNormalAltar()
        {
            Line("── 打败两个领主后再点一处普通灵火 ──");
            Line($"打败两个领主：灵火 {objective.AltarsLit}/{objective.AltarsNeeded}，出口{(portal.IsOpen ? "开了 ✗" : "还关着 ✓")}");
            if (portal.IsOpen) Fail("只打败两个领主（两处灵火）出口就开了");
            var altar = altars.FirstOrDefault(a => a.name.EndsWith("_s1"));
            if (!altar)
            {
                Fail("找不到 ① 碉楼寨的灵火坛");
                yield break;
            }
            var site = altar.guard;
            if (site)
            {
                Teleport(motor, altar.transform.position + altar.transform.forward * 4f);
                yield return new WaitForSeconds(0.3f);
                if (site.phase == EncounterSite.Phase.Idle) site.Activate();
                float t0 = Time.time;
                while (site.phase != EncounterSite.Phase.Cleared && Time.time - t0 < 45f)
                {
                    EnemyRegistry.PurgeAll();
                    yield return new WaitForSeconds(0.5f);
                }
                if (site.phase != EncounterSite.Phase.Cleared) Fail($"{site.title} 45 s 没清完");
            }
            Teleport(motor, altar.transform.position + altar.transform.forward * 2f);
            yield return new WaitForSeconds(0.3f);
            Aim(motor, eye, altar.Focus);
            yield return new WaitForSeconds(0.2f);
            interactor.testInteract = true;
            float k0 = Time.time;
            while (!altar.Lit && Time.time - k0 < altar.kindleTime + 1.5f) yield return null;
            interactor.testInteract = false;
            yield return new WaitForSeconds(1f);
            Line($"{(altar.Lit && objective.Complete && portal.IsOpen ? "✓" : "✗")} {altar.title}：{(altar.Lit ? "点亮" : "没点亮")}，灵火 {objective.AltarsLit}/{objective.AltarsNeeded}，" +
                 $"目标{(objective.Complete ? "完成" : "没完成")}，出口{(portal.IsOpen ? "开了" : "没开")}");
            if (!altar.Lit) Fail($"{altar.title} 没点亮");
            if (!objective.Complete || !portal.IsOpen) Fail("两处领主灵火 + 一处普通灵火，出口应开");
        }

        // ───────────── 工具 ─────────────

        void Guard(bool on)
        {
            guard?.Dispose();
            guard = null;
            if (on && boss && boss.Health) guard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
        }

        IEnumerator WaitIdle(float timeout = 16f)
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < timeout)
            {
                vitals.Heal(99999);
                yield return null;
            }
        }

        void Place(Vector3 spot, Vector3 look)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            if (NavMesh.SamplePosition(spot, out var hit, 4f, NavMesh.AllAreas)) spot = hit.position;
            Teleport(motor, spot);
            Aim(motor, eye, look);
        }

        /// <summary>p 附近 2 m 内站得住的地面（导航网格）</summary>
        static bool Stand(Vector3 p, out Vector3 at)
        {
            at = p;
            if (!Physics.Raycast(p + Vector3.up * 60f, Vector3.down, out var g, 200f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return false;
            if (!NavMesh.SamplePosition(g.point, out var hit, 2f, NavMesh.AllAreas)) return false;
            at = hit.position;
            return true;
        }

        static Vector3 Flatten(Vector3 v) => new(v.x, 0, v.z);
        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;
        static string Fmt(Vector3 p) => $"({p.x:F0}, {p.y:F1}, {p.z:F0})";
        static string Short(string id) => id.StartsWith("boss_") ? id.Substring(5) : id;
    }
}
