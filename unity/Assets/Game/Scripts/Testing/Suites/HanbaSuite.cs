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
    /// 旱魃冒烟（BS1 + BS2，bridge.sh playtest boss-hanba；场景 1-4 鸣沙山月牙泉。场地是露天还是旧的穴顶版都能跑：没有穴顶开口标记 = 露天）：
    ///   · 定义：自检、血条刻度 = 两道阶段阈值（60% / 30%）、1-4 难度下的定档、各阶段的第一招；击杀用时模拟（<see cref="HanbaBalance"/>：下沿 / 中位 / 上沿三种打法的平均都在 60–120 s）；
    ///   · 开战：玩家走到场地入场点 → BossEncounter 登场预警 → 旱魃登场（不可选中）→ 登场长啸（震屏 + 慢动作，结束后时间回到 1）→ 登场结束；
    ///     模型来源、日轮来源、悬浮高度、日晒组件；场景没重建（没有 BossEncounter）时在场地上直接刷一只；
    ///   · 一阶段 · 日晒与荫蔽（旱魃原地硬直）：日光里叠层掉血、泉水里减半、影子里清零、头顶压岩板挡住、日轮直射被岩石挡住（场地有岩岛锚点时）；
    ///     记下这时场地里被日光照到的比例（三阶段要比它大）；
    ///   · 一阶段三招各强制出一次（走到出手、正常收招、画过预警、霸体、收招段泉珠露出、动作走 act_ 触发器还是交叉淡入）；召唤物崩解后散沙；
    ///   · 二阶段（生命层降到 59%）：转换不可选中、阶段名卡 + 慢动作；月牙泉吸干（场景标出了泉水时：全部停用、原来的水面处日晒不再减半；没标就跳过）、
    ///     泉床龟裂、有裂口；转换后第一招飞天之殇自己出——邪飞天现身、旱魃披上琵琶护体（打她一下是「格挡」、只吃两成）→ 打碎琵琶 → 护体崩散、旱魃踉跄、邪飞天解脱；
    ///     焦裂强制出一次（裂缝爆开）；站到裂口上等一轮喷气（先有地面预警、喷到人）；二阶段日轮扫射前摇比一阶段短；
    ///   · 三阶段（降到 29%）：日轮升顶（露天：太阳推到约 85°、场地里被日光照到的比例比一阶段大——影子缩了；穴顶版：日轮嵌进开口、直射距离盖住碗底）；
    ///     转换后第一招日蚀自己出——窗口 3 s、泉珠露出、日轮熄灭（露天时天暗下来、日光不晒）、窗口里打泉珠的伤害是窗口外的 3 倍、窗口后强光（站在日光里被打中）；
    ///   · 90 s 浸泡（三阶段，首领不掉血）：不出场地、数值有限（护盾不超上限）、招式不卡死、召唤不超上限、至少出过三种招、日晒判定在跑、裂缝在喷；
    ///   · 击杀 → 溃散 → 结算：首领宝箱（首领档）、回满、出口升起（1-4 → 下一关）；倒下后日晒判定停、死亡演出开始、泉眼复涌、太阳回到午后、时间回到 1。
    /// 运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class HanbaSuite : PlaytestSuite
    {
        public override string Id => "boss-hanba";
        /// <summary>1-4 鸣沙山月牙泉（与编辑器里 Level_1_4.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L1_4_Crescent.unity";

        const float SoakSeconds = 90f, MoveTimeout = 14f;

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        BossEncounter enc;
        HanbaBrain boss;
        System.IDisposable bossGuard;
        int logErrors, spawnedEvents, defeatedEvents;
        /// <summary>玩家累计吃到的火伤（日晒跳伤是火元素）</summary>
        float fireTaken;
        /// <summary>一阶段时场地里被日光照到的格点比例（−1 = 没量）</summary>
        float litPhase1 = -1f;
        string lastError;
        readonly List<int> phaseEvents = new();
        readonly Dictionary<string, float> phase0Wind = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少玩家组件：weapons={weapons} motor={motor} vitals={vitals}（场景不是 1-4？先 bridge.sh level 1-4）");
                yield break;
            }
            eye = weapons.eye.transform;
            WeaponController.TestMode = true;
            // 首领登场演出（BossIntroDirector）的测试开关：本套件测战斗，不放演出（演出由 boss-intro 套件测）
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Application.logMessageReceived += OnLog;
            GameEvents.BossSpawned += OnSpawned;
            GameEvents.BossPhase += OnPhase;
            GameEvents.BossDefeated += OnDefeated;
            GameEvents.PlayerHit += OnPlayerHit;
            vitals.stats.Add("playtest_hanba", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            RunState.Ensure();

            CheckDef();
            yield return StartFight();
            if (boss && !boss.Dead)
            {
                Guard(true);
                yield return SunCase();
                yield return EachMove(0);
                yield return SummonCleanup();
                yield return Phase2Case();
                yield return Phase3Case();
                yield return Soak();
                yield return KillCase();
            }

            Guard(false);
            vitals.stats.Remove("playtest_hanba");
            GameEvents.BossSpawned -= OnSpawned;
            GameEvents.BossPhase -= OnPhase;
            GameEvents.BossDefeated -= OnDefeated;
            GameEvents.PlayerHit -= OnPlayerHit;
            Application.logMessageReceived -= OnLog;
            if (boss && !boss.Dead) Destroy(boss.gameObject);
            Line($"合计：敌人对玩家伤害 {Runner.playerDamage:F0}，运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        /// <summary>首领不掉血（Incoming → 0）开 / 关</summary>
        void Guard(bool on)
        {
            bossGuard?.Dispose();
            bossGuard = on && boss ? boss.Health.Incoming.Add((in IncomingHit h) => 0f) : null;
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnSpawned(BossBrain b) => spawnedEvents++;

        void OnPlayerHit(in PlayerHitEvent e)
        {
            if (e.element == Element.Fire) fireTaken += e.amount;
        }

        void OnPhase(BossBrain b, int p)
        {
            if (b == boss) phaseEvents.Add(p);
        }

        void OnDefeated(BossBrain b)
        {
            if (b == boss) defeatedEvents++;
        }

        // ───────────── 定义 ─────────────

        void CheckDef()
        {
            var def = Bosses.Get(HanbaDef.Id) as HanbaDef;
            if (def == null)
            {
                Fail($"没有登记首领 {HanbaDef.Id}（HanbaDef）");
                return;
            }
            var errs = def.Validate();
            if (errs.Count > 0) Fail($"旱魃定义自检：{string.Join("；", errs)}");
            var ticks = def.BarTicks;
            bool ticksOk = ticks.Count == 2 && Mathf.Approximately(ticks[0], HanbaDef.ScorchedAt) && Mathf.Approximately(ticks[1], HanbaDef.RedEarthAt);
            var v = def.VitalsAt(HanbaDef.StageDifficulty);
            var moves = def.moves.Select(m => m()).ToList();
            Line($"定义：{def.name}（{def.title}），血条刻度 {string.Join(" / ", ticks.Select(t => $"{t:P0}"))} {(ticksOk ? "✓" : "✗")}，难度 {HanbaDef.StageDifficulty} 下 {v}，" +
                 $"招式 {string.Join("、", moves.Select(m => $"{m.Id}（{m.minPhase + 1} 阶段起）"))}，阶段第一招 {string.Join(" / ", def.phases.Select(p => p.firstMove))}");
            if (!ticksOk) Fail("血条刻度不是 60% / 30% 两道阶段阈值");
            foreach (var id in new[] { Phase2CrackLine.MoveId, Phase2ApsaraCall.MoveId, Phase3Eclipse.MoveId })
                if (moves.All(m => m.Id != id))
                    Fail($"旱魃没有 BS2 的招式 {id}");
            if (def.phases.Count != 2 || def.phases[0].firstMove != Phase2ApsaraCall.MoveId || def.phases[1].firstMove != Phase3Eclipse.MoveId)
                Fail("二阶段的第一招应是飞天之殇、三阶段的第一招应是日蚀");
            // 击杀用时（docs/unity-parity.md 7.4）
            foreach (var p in HanbaBalance.Profiles)
            {
                var (mean, min, max, sample) = HanbaBalance.Average(def, p, 8);
                Line($"击杀用时模拟 · {p}：平均 {mean:F0} s（{min:F0}–{max:F0}），样例 {sample}");
                if (mean < HanbaBalance.TargetMin || mean > HanbaBalance.TargetMax)
                    Fail($"击杀用时模拟（{p.name}）平均 {mean:F0} s，不在 {HanbaBalance.TargetMin:F0}–{HanbaBalance.TargetMax:F0} s 内");
            }
        }

        // ───────────── 开战 ─────────────

        IEnumerator StartFight()
        {
            enc = FindObjectsByType<BossEncounter>(FindObjectsSortMode.None).FirstOrDefault(e => e && e.bossId == HanbaDef.Id);
            arena = enc && enc.arena ? enc.arena : BossArena.Find(HanbaDef.Id);
            if (!arena)
            {
                Line("场景里没有旱魃的 BossArena（1-4 还没重建？），在玩家前方临时建一个 18 m 的场地");
                var fwd = motor.transform.forward;
                fwd.y = 0;
                arena = BossArena.CreateRuntime(motor.transform.position + fwd.normalized * 20f, 18f, fwd, HanbaDef.Id);
            }
            int spawned0 = spawnedEvents;
            if (enc && enc.State == BossEncounter.Phase.Waiting)
            {
                Place(arena.PlayerEntryPoint);
                Aim(motor, eye, arena.BossSpawnPoint + Vector3.up * 3f);
                float t0 = Time.time;
                while (!enc.Boss && Time.time - t0 < enc.warnSeconds + 5f) yield return null;
                Line($"首领关流程：走进入场点 → {enc.State}（{Time.time - t0:F1} s 后首领登场）");
                boss = enc.Boss as HanbaBrain;
                if (!boss) Fail($"BossEncounter 没有刷出旱魃（State {enc.State}，Boss {enc.Boss}）");
            }
            else
            {
                Line(enc ? $"BossEncounter 状态 {enc.State}，直接刷旱魃" : "场景里没有旱魃的 BossEncounter（1-4 还没重建？），直接在场地上刷旱魃");
                Place(arena.PlayerEntryPoint);
                boss = Bosses.Spawn(HanbaDef.Id, arena, HanbaDef.StageDifficulty) as HanbaBrain;
                if (!boss) Fail("旱魃生成失败（行为不是 HanbaBrain？）");
            }
            if (!boss) yield break;
            var hp = boss.Health;
            string model = boss.Model == null ? "（没有模型）" : boss.Model.source switch
            {
                BossModelSource.Art => $"美术 {boss.Model.prefab} × {boss.Model.scale}",
                BossModelSource.Proxy => $"代理 {boss.Model.prefab} × {boss.Model.scale}",
                _ => $"占位胶囊 × {boss.Model.scale}",
            };
            var sky = HanbaSunDriver.Find();
            Line($"生成：{boss.Title}（{boss.Subtitle}），{hp.maxHealth:F0} 生命 + {hp.maxShield:F0} 护盾（难度 {boss.level:F2}），模型 {model}，日轮 {boss.Ring?.From}，" +
                 $"日晒组件 {(boss.Exposure ? "✓" : "✗")}，场地 {(SunExposure.OpenSky ? "露天" : "穴顶开口")}，太阳仰角 {(sky ? $"{sky.Elevation:F0}°" : "（没有主光）")}" +
                 $"{(boss.LoweredSun ? $" → 压成午后 {boss.HDef.lowSunElevation:F0}°" : "")}，BossSpawned +{spawnedEvents - spawned0}");
            if (spawnedEvents - spawned0 != 1) Fail($"BossSpawned 派发了 {spawnedEvents - spawned0} 次（应 1 次）");
            if (!boss.Ring || boss.Ring.From == SunRing.Source.None) Fail("旱魃没有日轮");
            if (!boss.Exposure) Fail("旱魃身上没有日晒判定（SunExposure）");
            if (!boss.Cinematics || !boss.Ward) Fail("旱魃身上没有演出层 / 琵琶护体组件");
            yield return null;
            if (!hp.untargetable) Fail("登场期间可以被选中");
            Aim(motor, eye, boss.BodyCenter);
            Shot(weapons.eye, "hanba_intro");
            float i0 = Time.time;
            bool slowSeen = false;
            while (!boss.IntroDone && Time.time - i0 < boss.Def.intro.seconds + 3f)
            {
                if (boss.Cinematics && boss.Cinematics.Slowing && TimeScaleArbiter.Current < 0.99f) slowSeen = true;
                yield return null;
            }
            yield return new WaitForSecondsRealtime(0.6f);
            Line($"登场：{(boss.IntroDone ? $"✓ {Time.time - i0:F1} s" : "✗ 没有结束")}，长啸 {(boss.IntroRoared ? "✓" : "✗")}（慢动作 {(slowSeen ? $"✓ × {boss.Cinematics.LastSlowScale:F2}" : "✗")}，" +
                 $"之后时间 × {TimeScaleArbiter.Current:F2}），悬浮 {boss.HoverNow:F2} m，之后可选中 {(!hp.untargetable ? "✓" : "✗")}，泉珠 {(boss.WeakExposed ? "露着" : "收着")}");
            if (!boss.IntroDone) Fail("登场演出没有结束");
            if (!boss.IntroRoared) Fail("登场没有长啸（震屏 / 日轮炸亮 / 慢动作）");
            if (!slowSeen) Fail("登场长啸没有放慢动作");
            if (TimeScaleArbiter.Current < 0.99f) Fail($"登场演出之后时间没回到 1（× {TimeScaleArbiter.Current:F2}）");
            if (hp.untargetable) Fail("登场结束后仍不可选中");
            if (!(boss.HoverNow > 0.2f)) Fail($"旱魃没有悬浮（{boss.HoverNow:F2} m）");
            if (boss.WeakExposed) Fail("招式间隙泉珠露着（弱点应只在施法后摇露出）");
        }

        // ───────────── 日晒与荫蔽 ─────────────

        IEnumerator SunCase()
        {
            var ex = boss.Exposure;
            if (!ex) yield break;
            yield return WaitIdle();
            boss.Stagger(14f, "Hit");
            var shaft = SunShaft.All.FirstOrDefault();
            Line($"日晒：{(shaft ? $"穴顶开口 {shaft.name}（穴顶 y = {shaft.CeilingY:F1}）" : "露天（没有穴顶开口标记）")}，太阳方向 {SunShaft.ToSun}，" +
                 $"日轮直射 {ex.ringRange:F0} / {ex.ringBlazeRange:F0} m，浅水 × {ex.waterFactor}");
            // 离日轮够远（平时直射距离 + 4 m）：这一段只看日光，不混进日轮直射
            float far = ex.ringRange + 4f;
            var lit = FindSpot(p => Lit(p) && FarFromRing(p, far));
            var shade = FindSpot(p => !Lit(p) && FarFromRing(p, far));
            litPhase1 = LitFraction();
            Line($"一阶段场地里被日光照到的比例 {litPhase1:P0}");

            // ── 日光里：叠层、掉血 ──
            int openStacks = 0;
            if (lit.HasValue)
            {
                Place(lit.Value);
                Aim(motor, eye, lit.Value + SunShaft.ToSun * 10f);
                PlayerStatus.Instance?.ClearAll();
                vitals.Heal(99999);
                float fire0 = fireTaken;
                yield return new WaitForSeconds(2f);
                openStacks = SunExposure.PlayerStacks;
                float lost = fireTaken - fire0;
                Line($"日光里站 2 s（{At(lit.Value)}）：{openStacks} 层，日光份额 {ex.LastShaft:F1}、日轮 {ex.LastRing:F1}、增益 {ex.LastGain:F2}，日晒火伤 {lost:F1}（每层每跳 {ex.DamagePerStack:F2}）");
                if (openStacks < 2) Fail($"站在日光里 2 s 只叠了 {openStacks} 层（应 ≥ 2）");
                if (!(ex.LastShaft > 0.9f)) Fail($"日光里的日光份额 {ex.LastShaft}（应 1）");
                if (!(lost > 0)) Fail("日晒叠了层却没有火伤跳出来");
                Shot(weapons.eye, "hanba_sun_shaft");
            }
            else Fail("场地里找不到日光照得到、又离日轮够远的落脚点（太阳方向 / 遮挡不对？）");

            // ── 浅水：增益减半 ──
            // 落脚点直接取泉床：每段水在水面上取几处往下打到床面，水深 > 0.15 m 才算（原来取水体中心再贴导航网格 2 m 内，
            // 泉床不在导航网格上时会贴到岸上——站在干地上测「浅水」）
            Vector3? wet = null, anyWet = null;
            float wetDepth = 0;
            foreach (var w in WaterVolume.All.Where(w => w))
            {
                foreach (var u in new[] { 0f, -0.3f, 0.3f })
                {
                    var top = w.transform.TransformPoint(0, 0.5f, u);
                    if (!Physics.Raycast(top + Vector3.up * 3f, Vector3.down, out var bed, 12f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                    if (!WaterVolume.At(bed.point + Vector3.up * 0.02f, out float d) || d < 0.15f || d > w.deep * 0.9f) continue;
                    anyWet ??= bed.point;
                    if (!Lit(bed.point) || !FarFromRing(bed.point, far)) continue;
                    wet = bed.point;
                    wetDepth = d;
                    break;
                }
                if (wet.HasValue) break;
            }
            wet ??= anyWet;
            if (wet.HasValue)
            {
                bool onNav = NavMesh.SamplePosition(wet.Value, out var navHit, 0.6f, NavMesh.AllAreas);
                Line($"浅水落脚点 {At(wet.Value)}：水深 {wetDepth:F2} m，泉床{(onNav ? "在导航网格上" : "不在导航网格上（敌人走不进水里）")}");
                Place(wet.Value);
                PlayerStatus.Instance?.ClearAll();
                yield return new WaitForSeconds(2f);
                int wetStacks = SunExposure.PlayerStacks;
                Line($"浅水里站 2 s（{At(wet.Value)}，水深 {WaterVolume.PlayerDepth:F2} m）：{wetStacks} 层（空地 {openStacks}），在水里 {ex.LastInWater}、倍率 {ex.LastWater}、增益 {ex.LastGain:F2} / 原 {ex.LastRaw:F2}");
                if (!ex.LastInWater) Fail("站在浅水里，日晒判定没认出水");
                else if (!Mathf.Approximately(ex.LastGain, ex.LastRaw * ex.waterFactor)) Fail($"浅水里的增益 {ex.LastGain} ≠ 原增益 {ex.LastRaw} × {ex.waterFactor}");
                if (ex.LastRaw > 0.9f && openStacks > 0 && wetStacks >= openStacks) Fail($"浅水里叠层（{wetStacks}）不比空地（{openStacks}）慢");
            }
            else Line("场景里没有浅水（不是 1-4？），跳过浅水");

            // ── 影子里：清零 ──
            if (shade.HasValue)
            {
                if (lit.HasValue)
                {
                    Place(lit.Value);
                    yield return new WaitForSeconds(1.2f);
                }
                int before = SunExposure.PlayerStacks;
                Place(shade.Value);
                yield return new WaitForSeconds(4f);
                int after = SunExposure.PlayerStacks;
                Line($"走进影子 4 s（{At(shade.Value)}）：{before} → {after} 层，增益 {ex.LastGain:F2}");
                if (after > 0) Fail($"躲进影子 4 s 日晒还剩 {after} 层（应清零）");
                if (ex.LastGain > 0) Fail($"影子里还在叠层（增益 {ex.LastGain}）");
                Shot(weapons.eye, "hanba_sun_shade");
            }
            else Fail("场地里找不到离日轮够远的影子落脚点（一阶段的低太阳应在沙丘 / 楼阁背后拖出影子）");

            // ── 真实遮挡：头顶压一块岩板 ──
            if (lit.HasValue)
            {
                Place(lit.Value);
                yield return new WaitForSeconds(0.3f);
                float shaftOpen = ex.LastShaft;
                SunExposure.Probes(out _, out _, out var head);
                var slab = GameObject.CreatePrimitive(PrimitiveType.Cube);
                slab.name = "Sun Blocker (test)";
                slab.transform.position = head + SunShaft.ToSun * 3f;
                slab.transform.rotation = Quaternion.FromToRotation(Vector3.up, SunShaft.ToSun);
                slab.transform.localScale = new Vector3(4f, 0.4f, 4f);
                Physics.SyncTransforms();
                yield return new WaitForSeconds(0.3f);
                float shaftBlocked = ex.LastShaft;
                Destroy(slab);
                Line($"头顶压一块岩板（沿日光方向 3 m）：日光份额 {shaftOpen:F1} → {shaftBlocked:F1}");
                if (shaftBlocked > 0) Fail("挡在日光方向上的岩板没挡住日光判定");
            }

            // ── 日轮直射与岩石荫蔽 ──
            yield return RingCover();
            PlayerStatus.Instance?.ClearAll();
            float s0 = Time.time;
            while (boss.Staggered && Time.time - s0 < 15f) yield return null;
        }

        /// <summary>首领挪到岩岛一侧（日轮—岩岛—掩体点一线），玩家先站空地（同距离、侧面）再站岩岛背后的掩体点：日轮份额由满变不满。场地没有岩岛锚点时跳过</summary>
        IEnumerator RingCover()
        {
            var ex = boss.Exposure;
            var island = arena.perchPoints?.FirstOrDefault(p => p && p.name.Contains("Island"));
            var cover = arena.coverPoints?.FirstOrDefault(p => p && p.name.Contains("Island"));
            if (!island || !cover)
            {
                Line("场地没有岩岛栖落点 / 掩体点，跳过日轮荫蔽");
                yield break;
            }
            var c = island.position;
            var away = cover.position - c;
            away.y = 0;
            if (away.sqrMagnitude < 0.01f) yield break;
            away.Normalize();
            var bossAt = c - away * 6.5f;
            if (NavMesh.SamplePosition(bossAt, out var bh, 3f, NavMesh.AllAreas)) bossAt = bh.position;
            // 测完挪回原处：后面的招式用例要在场地上（不然她站在沙丘背上，热浪、扫射全被沙丘挡住，测的是地形不是招式）
            var home = boss.transform.position;
            var homeFace = boss.transform.position + boss.transform.forward;
            boss.Stagger(6f, "Hit");
            WarpBoss(bossAt, cover.position);
            yield return null;
            float dist = Vector3.Distance(new Vector3(cover.position.x, 0, cover.position.z), new Vector3(bossAt.x, 0, bossAt.z));
            // 这一段只看遮挡：直射距离临时放宽到够得着掩体点，免得「太远」冒充「被挡住」
            float range0 = ex.ringRange;
            ex.ringRange = Mathf.Max(range0, dist + 6f);
            // 空地：同样距离、站到首领侧面或身后（中间没有岩岛；新月丘两侧是丘角，侧面可能还被迎风背挡着，所以也试身后的上风向）
            var side = Vector3.Cross(Vector3.up, away);
            Vector3? open = null;
            var tries = new List<string>();
            foreach (var dir in new[] { side, -side, -away, (-away + side).normalized, (-away - side).normalized })
            {
                var q = bossAt + dir * dist;
                // 她站在沙丘背上（离地几米），同距离的空地在丘外的盆底：先落到地面再贴导航网格
                if (Physics.Raycast(q + Vector3.up * 20f, Vector3.down, out var gh, 60f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) q = gh.point;
                if (!NavMesh.SamplePosition(q, out var oh, 2f, NavMesh.AllAreas) || !arena.Contains(oh.position, 1f)) continue;
                Place(oh.position);
                yield return new WaitForSeconds(0.3f);
                tries.Add($"{At(oh.position)} {ex.LastRing:F1}");
                if (ex.LastRing > 0.9f)
                {
                    open = oh.position;
                    break;
                }
            }
            float ringOpen = ex.LastRing;
            Place(cover.position);
            yield return new WaitForSeconds(0.3f);
            float ringCovered = ex.LastRing;
            Line($"日轮直射（首领挪到 {At(bossAt)}，离掩体点 {dist:F1} m，直射距离临时放宽到 {ex.RingRange:F1} m）：空地{(open.HasValue ? $" {At(open.Value)}" : "")} 日轮份额 {ringOpen:F1}，" +
                 $"岩岛背后 {At(cover.position)} {ringCovered:F1}");
            if (ringCovered >= 0.99f) Fail("躲在岩岛背后（日轮—岩岛—玩家一线）仍被日轮整份直射：岩岛没挡住");
            if (!open.HasValue)
                Line($"⚠ 同距离的空地也没被日轮整份照到（距离 / 地形问题），日轮荫蔽只能看岩岛那一侧：轮心 {At(boss.Ring ? boss.Ring.Center : bossAt)}、" +
                     $"日蚀 {(boss.Ring && boss.Ring.Eclipsed)}、直射 {ex.RingRange:F1} m，试过 {(tries.Count > 0 ? string.Join("；", tries) : "（没有场地内的空地）")}");
            Shot(weapons.eye, "hanba_ring_cover");
            ex.ringRange = range0;
            WarpBoss(home, homeFace);
        }

        void WarpBoss(Vector3 p, Vector3 face)
        {
            var agent = boss.GetComponent<NavMeshAgent>();
            boss.transform.position = p;
            if (agent && agent.enabled && agent.isOnNavMesh) agent.Warp(p);
            boss.FaceNow(face);
            var loco = boss.GetComponentInChildren<CreatureLocomotion>();
            if (loco) loco.Teleported();
        }

        /// <summary>站在这块地面上胸口和头顶都被日光照到</summary>
        static bool Lit(Vector3 ground)
        {
            var chest = ground + Vector3.up * 1.0f;
            var head = ground + Vector3.up * 1.62f;
            return SunExposure.ShaftLit(chest) && SunExposure.ShaftLit(head);
        }

        bool FarFromRing(Vector3 ground, float far) => !boss.Ring || (boss.Ring.Center - (ground + Vector3.up)).sqrMagnitude > far * far;

        /// <summary>场地里（3 m 一格、在导航网格上）被日光照到的格点比例</summary>
        float LitFraction()
        {
            int lit = 0, all = 0;
            foreach (var p in GridSpots(3f, 6f))
            {
                all++;
                if (Lit(p)) lit++;
            }
            return all > 0 ? lit / (float)all : 0;
        }

        /// <summary>场地里每 step 米一格、贴到导航网格上（高差不超过 maxRise）的点，从场地中心往外排</summary>
        List<Vector3> GridSpots(float step, float maxRise)
        {
            float r = arena.Extent - 2f;
            var pts = new List<Vector3>();
            for (float x = -r; x <= r; x += step)
            for (float z = -r; z <= r; z += step)
            {
                var q = arena.Center + new Vector3(x, 0, z);
                if (arena.Contains(q, 2f)) pts.Add(q);
            }
            var outp = new List<Vector3>();
            foreach (var q in pts.OrderBy(q => (q - arena.Center).sqrMagnitude))
            {
                if (!NavMesh.SamplePosition(q, out var hit, 1.5f, NavMesh.AllAreas)) continue;
                if (Mathf.Abs(hit.position.y - arena.FloorY) > maxRise) continue;
                outp.Add(hit.position);
            }
            return outp;
        }

        /// <summary>场地里（2 m 一格）第一个满足条件、在导航网格上、与场地地面大致同一层的点；从场地中心往外找</summary>
        Vector3? FindSpot(System.Func<Vector3, bool> ok)
        {
            foreach (var p in GridSpots(2f, 2.2f))
                if (ok(p))
                    return p;
            return null;
        }

        /// <summary>把玩家放到导航网格点上（不从上往下打射线：楼阁、沙丘檐下也能放进去）</summary>
        void Place(Vector3 p)
        {
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p + Vector3.up * 0.05f;
            if (cc) cc.enabled = true;
            Physics.SyncTransforms();
        }

        static string At(Vector3 p) => $"({p.x:F0}, {p.y:F1}, {p.z:F0})";

        // ───────────── 招式 ─────────────

        /// <summary>从 phase 阶段起才有的招式各出一次（强制）</summary>
        IEnumerator EachMove(int phase)
        {
            foreach (var move in boss.Moves.Where(m => m.minPhase == phase).ToList())
            {
                if (!boss || boss.Dead) yield break;
                yield return OneMove(move, phase == 0, true);
            }
        }

        /// <summary>
        /// 出一招并检查：force = 强制出（ForceMove）；false = 等它自己出（阶段的第一招，最多等 6 s，等不到再强制）
        /// </summary>
        IEnumerator OneMove(BossMove move, bool record, bool force)
        {
            float t0 = Time.time;
            var hm = move as HanbaMove;
            int warn0 = hm != null ? hm.Warned : move.TelegraphCount, act0 = move.TimesActive, sum0 = boss.Summons.TotalSpawned, acts0 = boss.ActsFired;
            bool natural = false;
            if (!force)
            {
                while (boss.Current != move && Time.time - t0 < 6f && boss && !boss.Dead)
                {
                    KeepPlayerAlive();
                    yield return null;
                }
                // 这一招此刻在出、又不是我们强制的：就是它自己出的（可能在进这里之前就开始了）
                natural = boss.Current == move;
                if (!natural) Line($"⚠ {move.Name} 6 s 内没有自己出（应是阶段的第一招），改为强制");
            }
            if (!natural)
            {
                yield return WaitIdle();
                ReadyPlayer(12f);
                PlayerStatus.Instance?.ClearAll();
                yield return null;
                warn0 = hm != null ? hm.Warned : move.TelegraphCount;
                act0 = move.TimesActive;
                acts0 = boss.ActsFired;
                t0 = Time.time;
                bool forced = false;
                while (!(forced = boss.ForceMove(move.Id)) && Time.time - t0 < 5f) yield return null;
                if (!forced)
                {
                    Fail($"招式 {move.Id}：强制出招失败（转换 / 硬直 / 登场中？）");
                    yield break;
                }
            }
            else
            {
                ReadyPlayer(12f);
                // 自己出的那一招：前摇已经开始了，预警 / 动作在开始那一帧就记过
                warn0 = 0;
                acts0 = boss.ActsFired - 1;
                act0 = move.TimesActive;
            }
            var stages = new List<MoveStage>();
            bool immune = true, shot = false, weakInRecover = false, weakInActive = false;
            var p0 = motor.transform.position;
            float pushed = 0;
            string actPath = null;
            int warnedSeen = hm != null ? hm.Warned : move.TelegraphCount;
            while (boss && !boss.Dead && boss.Current == move && Time.time - t0 < MoveTimeout)
            {
                if (stages.Count == 0 || stages[^1] != move.Stage) stages.Add(move.Stage);
                if (!move.stunnable && !boss.StunImmune) immune = false;
                if (move.Stage == MoveStage.Recover && boss.WeakExposed) weakInRecover = true;
                if (move.Stage == MoveStage.Active && boss.WeakExposed) weakInActive = true;
                if (boss.ActsFired > acts0) actPath ??= $"{boss.LastAct}（{boss.LastActPath}）";
                pushed = Mathf.Max(pushed, Vector3.Distance(Flat(motor.transform.position), Flat(p0)));
                KeepPlayerAlive();
                Aim(motor, eye, boss.BodyCenter);
                if (!shot && move.Stage == MoveStage.Active)
                {
                    shot = true;
                    yield return null;
                    Shot(weapons.eye, $"hanba_move_{move.Id}");
                }
                yield return null;
            }
            bool ended = boss.Current != move;
            if (move is Phase1SandWraiths)
            {
                float w0 = Time.time;
                while (boss.Summons.PendingCount > 0 && Time.time - w0 < 2.5f) yield return null;
                yield return null;
                yield return null;
            }
            int warned = natural ? warnedSeen : (hm != null ? hm.Warned : move.TelegraphCount) - warn0, summoned = boss.Summons.TotalSpawned - sum0;
            if (record && hm != null) phase0Wind[move.Id] = hm.WindNow;
            string extra = move switch
            {
                Phase1SunSweep s => $"，落点 {s.Range:F1} m、扫过 {s.Swept:F0}°、灼伤 {s.Hits} 次、被挡 {s.Blocked} 段",
                Phase1HotWind w => $"，热浪 {w.Waves} 道、打中 {(w.HitThisCast ? "✓" : "✗")}、玩家被推开 {pushed:F1} m",
                Phase1SandWraiths sw => $"，排进 {sw.LastQueued} 只、生成 {summoned} 只、染成沙魇 {boss.Summons.Live.Count(e => boss.IsWraith(e) && SandWraith.Is(e))} 只（{string.Join("、", boss.Summons.Live.Select(e => e.Health.displayName))}）",
                Phase2CrackLine c => $"，裂缝 {c.Lines} 条 × {c.Length:F0} m、爆开 {c.CastExplosions} 段、打中 {c.TotalHits} 次",
                Phase2ApsaraCall a => $"，召出 {(a.Last ? $"{a.Last.Health.displayName} @ {At(a.Spot)}" : "✗")}、护体 {(boss.WardUp ? "✓" : "✗")}",
                _ => "",
            };
            Line($"招式 {move.Name}（{move.Id}，{(natural ? "阶段第一招，自己出" : "强制")}）：{string.Join("→", stages)}，{(ended ? $"{Time.time - t0:F1} s 收招" : "✗ 超时")}{(move.Cancelled ? "（被打断）" : "")}，" +
                 $"前摇 {(hm != null ? hm.WindNow : move.WindupTime):F2} s，预警 {warned} 个，动作 {actPath ?? "（没触发）"}，出招中霸体 {(immune ? "✓" : "✗")}，" +
                 $"后摇泉珠露出 {(weakInRecover ? "✓" : "✗")}{extra}");
            if (!ended) Fail($"招式 {move.Id} {MoveTimeout:F0} s 没有结束（卡在 {move.Stage}）");
            if (move.TimesActive <= act0) Fail($"招式 {move.Id} 没有走到出手段");
            if (move.Cancelled) Fail($"招式 {move.Id} 被打断了（没有外力时应正常收招）");
            if (warned <= 0) Fail($"招式 {move.Id} 没有画预警");
            if (!immune) Fail($"招式 {move.Id} 出招中可以被眩晕（霸体）");
            if (!weakInRecover) Fail($"招式 {move.Id} 收招段泉珠没有露出");
            if (weakInActive && move is not Phase3Eclipse) Fail($"招式 {move.Id} 出手段泉珠就露着了");
            if (actPath == null && !natural) Fail($"招式 {move.Id} 没有播动作（HanbaBrain.Act 没被调用）");
            switch (move)
            {
                case Phase1SunSweep s when s.Swept < Phase1SunSweep.Arc - 1f:
                    Fail($"日轮扫射只扫了 {s.Swept:F0}°（应 {Phase1SunSweep.Arc}°）");
                    break;
                case Phase1HotWind w when w.Waves < 1:
                    Fail("旱风没有放出热浪");
                    break;
                // 一阶段强制出的那一次：玩家就站在她正前方 12 m 的扇区里，热浪应打中（她悬在泉床里时热浪要从岸坎上铺出去，不能埋在岸坡下面）
                case Phase1HotWind w when record && !w.HitThisCast:
                    Fail("一阶段旱风没打中正前方 12 m 的玩家（热浪被岸坡 / 地形挡住？）");
                    break;
                case Phase1SandWraiths sw:
                {
                    int want = sw.CountFor(boss);
                    int tinted = boss.Summons.Live.Count(e => boss.IsWraith(e) && SandWraith.Is(e));
                    if (sw.LastQueued < Mathf.Min(want, boss.Summons.Cap)) Fail($"召沙魇只排进 {sw.LastQueued} 只（应 {want}）");
                    if (summoned < sw.LastQueued) Fail($"召沙魇排进 {sw.LastQueued} 只，只生成了 {summoned} 只");
                    if (tinted < summoned) Fail($"生成的 {summoned} 只里只有 {tinted} 只染成了沙魇");
                    break;
                }
                case Phase2CrackLine c:
                    if (c.Lines != c.CountFor(boss)) Fail($"焦裂在阶段 {boss.Phase + 1} 应有 {c.CountFor(boss)} 条，实际 {c.Lines} 条");
                    if (c.CastExplosions < c.Lines * Mathf.CeilToInt(c.Length / Phase2CrackLine.Step)) Fail($"焦裂只爆开了 {c.CastExplosions} 段（{c.Lines} 条 × {c.Length:F0} m）");
                    break;
                case Phase2ApsaraCall a:
                    if (!a.Last || !boss.Apsara) Fail("飞天之殇没有召出邪飞天");
                    if (!boss.WardUp) Fail("飞天之殇之后旱魃没有琵琶护体");
                    break;
            }
            if (boss.Health.untargetable && !boss.Transitioning) Fail($"招式 {move.Id} 之后首领不可选中");
        }

        IEnumerator SummonCleanup()
        {
            int live = boss.Summons.Alive, crumbled0 = boss.WraithsCrumbled;
            int n = boss.Summons.DespawnAll();
            yield return null;
            yield return null;
            Line($"沙魇崩解：在场 {live} 只，处决 {n} 只，散沙 {boss.WraithsCrumbled - crumbled0} 只");
            if (boss.WraithsCrumbled - crumbled0 < n) Fail($"沙魇崩解 {n} 只，只散了 {boss.WraithsCrumbled - crumbled0} 团沙");
        }

        // ───────────── 阶段 ─────────────

        /// <summary>生命层降到 fraction，等阶段事件和转换演出结束；返回（事件到了、转换中不可选中、转换中看到的慢动作）</summary>
        IEnumerator CrossTo(float fraction, int phase, System.Action<bool, bool, bool, float> done)
        {
            yield return WaitIdle();
            var hp = boss.Health;
            int events0 = phaseEvents.Count, cards0 = boss.Cinematics ? boss.Cinematics.Cards : 0, slows0 = boss.Cinematics ? boss.Cinematics.SlowMos : 0;
            SetHealthFraction(fraction);
            float t0 = Time.time;
            while (phaseEvents.Count == events0 && Time.time - t0 < boss.Def.phaseWait + 3f) yield return null;
            bool fired = phaseEvents.Count > events0 && phaseEvents[^1] == phase;
            bool untargetable = boss.Transitioning && hp.untargetable;
            float tr0 = Time.time;
            while (boss.Transitioning && Time.time - tr0 < 6f)
            {
                KeepPlayerAlive();
                yield return null;
            }
            yield return null;
            bool presented = boss.Cinematics && boss.Cinematics.Cards > cards0 && boss.Cinematics.SlowMos > slows0;
            done(fired, untargetable, presented, Time.time - tr0);
            Line($"越过 {fraction + 0.01f:P0}：BossPhase {(fired ? $"✓ → 阶段 {boss.Phase + 1}" : "✗")}，转换中不可选中 {(untargetable ? "✓" : "✗")}，转换 {Time.time - tr0:F1} s，" +
                 $"名卡 + 慢动作 {(presented ? $"✓「{boss.Cinematics.LastCard}」" : "✗")}，之后可选中 {(!hp.untargetable ? "✓" : "✗")}，时间 × {TimeScaleArbiter.Current:F2}");
            if (!fired) Fail($"生命层降到 {fraction:P0} 没有进入阶段 {phase + 1}");
            if (!untargetable) Fail("阶段转换中可以被选中");
            if (boss.Transitioning) Fail("阶段转换没有结束");
            if (!presented) Fail("转阶段没有打名卡 / 放慢动作");
        }

        IEnumerator Phase2Case()
        {
            float pace0 = boss.Pace;
            var vents0 = boss.Scorch.Erupted;
            yield return CrossTo(HanbaDef.ScorchedAt - 0.01f, 1, (_, _, _, _) => { });
            if (!boss || boss.Dead || boss.Phase < 1) yield break;
            Shot(weapons.eye, "hanba_phase2");

            // ── 吸干泉水 ──
            var spring = boss.Spring;
            if (spring)
            {
                float d0 = Time.time;
                while (!spring.Drained && Time.time - d0 < 4f) yield return null;
                var ownedLeft = WaterVolume.All.Count(w => w && spring.Owns(w));
                var bed = spring.Beds.FirstOrDefault();
                float water = 1f;
                if (boss.Exposure && spring.Beds.Count > 0)
                    boss.Exposure.GainAt(bed + Vector3.up * 0.05f, bed + Vector3.up, bed + Vector3.up * 1.6f, out _, out _, out water);
                Line($"吸干泉水（{spring.Origin}，{spring.Count} 段）：水位 {spring.Level:F2}，还启用 {spring.ActiveWaters} 段，WaterVolume 里还剩 {ownedLeft} 段，原水面处日晒倍率 {water:F2}，" +
                     $"共用水面 {spring.Surfaces} 张、还显示 {spring.SurfacesShown} 张，龟裂贴花 {(spring.BedRevealed ? "露出" : "没露")}");
                if (!spring.Drained || spring.ActiveWaters > 0 || ownedLeft > 0) Fail("二阶段月牙泉没有吸干（还有启用的泉水段）");
                if (spring.SurfacesShown > 0) Fail("泉水吸干了，水面还画着（共用水面没跟着落下去 / 停用）");
                if (water < 0.999f) Fail($"吸干后原水面处日晒还在减半（倍率 {water}）");
            }
            else Line("场景里没有标出月牙泉的泉水（HanbaSpring / 标签 CrescentSpring / 名字 Crescent Spring），跳过吸干");
            var scorch = boss.Scorch;
            Line($"泉床龟裂：裂口 {scorch.Vents.Count} 个、发光裂缝 {scorch.Cracks} 条");
            if (scorch.Vents.Count == 0) Fail("二阶段没有喷气裂口");

            // ── 飞天之殇（第一招，自己出）→ 护体 → 打碎琵琶 ──
            if (boss.MoveById(Phase2ApsaraCall.MoveId) is Phase2ApsaraCall call)
            {
                yield return OneMove(call, false, false);
                yield return ApsaraCase();
            }

            // ── 焦裂 ──
            if (boss.MoveById(Phase2CrackLine.MoveId) is Phase2CrackLine crack) yield return OneMove(crack, false, true);

            // ── 喷气裂缝：站到裂口上等一轮 ──
            yield return VentCase(vents0);

            // ── 一阶段的招式在二阶段变快 ──
            Line($"出招节奏 {pace0:F2} → {boss.Pace:F2}");
            if (!(boss.Pace > pace0)) Fail("二阶段的出招节奏没有变快");
            if (boss.MoveById(Phase1SunSweep.MoveId) is Phase1SunSweep sweep)
            {
                yield return OneMove(sweep, false, true);
                float w0 = phase0Wind.TryGetValue(sweep.Id, out var w) ? w : 0;
                Line($"二阶段日轮扫射：前摇 {w0:F2} → {sweep.WindNow:F2} s");
                if (w0 > 0 && !(sweep.WindNow < w0 - 0.05f)) Fail("二阶段的日轮扫射前摇没有比一阶段短");
            }
            if (boss.MoveById(Phase1SandWraiths.MoveId) is Phase1SandWraiths wraithMove && wraithMove.CountFor(boss) != 4)
                Fail($"二阶段召沙魇应为 4 只（现在 {wraithMove.CountFor(boss)}）");
            boss.Summons.DespawnAll();
        }

        /// <summary>琵琶护体：打旱魃一下 → 格挡、只吃两成；打碎琵琶 → 护体崩散、踉跄、邪飞天解脱</summary>
        IEnumerator ApsaraCase()
        {
            var a = boss.Apsara;
            var ward = boss.Ward;
            if (!a || !ward || !ward.Up)
            {
                Fail("飞天之殇之后没有邪飞天 / 琵琶护体，跳过护体检查");
                yield break;
            }
            yield return new WaitForSeconds(0.8f);
            var hp = boss.Health;
            float h0 = hp.health, s0 = hp.shield;
            Guard(false);
            var info = DamageInfo.Simple(100f, DamageSource.Weapon, boss.BodyCenter, Vector3.forward);
            info.noCrit = true;
            var r = Combat.DamageEnemy(hp, info);
            Guard(true);
            hp.health = h0;
            hp.shield = s0;
            float wardTaken = boss.HDef.wardTaken;
            Line($"琵琶护体（{a.Health.displayName}，金丝 / 光环在场）：打 100 → 实际 {r.total:F1}，格挡 {(r.blocked ? "✓" : "✗")}，护体倍率 {ward.Taken:F2}");
            if (!r.blocked) Fail("护体着的旱魃挨打没有显示格挡");
            if (r.total > 100f * wardTaken + 0.5f) Fail($"护体着的旱魃吃了 {r.total:F1}（应 ≤ {100f * wardTaken:F0}）");
            Shot(weapons.eye, "hanba_apsara_ward");

            // 打碎琵琶：弱点伤害累计到邪飞天最大生命的 30%（弱点必暴 ×2，打 20% 就够）
            int broken0 = ward.Broken;
            var pipa = DamageInfo.Simple(a.Health.maxHealth * 0.2f, DamageSource.Weapon, a.transform.position + Vector3.up * 1.4f, Vector3.forward);
            pipa.weakpoint = true;
            Combat.DamageEnemy(a.Health, pipa);
            float b0 = Time.time;
            bool staggered = false;
            while (Time.time - b0 < 1.5f && (ward.Broken == broken0 || !staggered))
            {
                if (boss.Staggered) staggered = true;
                yield return null;
            }
            yield return null;
            Line($"打碎琵琶：邪飞天沉默 {(a && a.Silenced ? "✓" : a && a.Dead ? "（已解脱）" : "✗")}，护体崩散 {(ward.Broken > broken0 && !ward.Up ? $"✓（护体 {ward.LastSeconds:F1} s）" : "✗")}，" +
                 $"旱魃踉跄 {(staggered ? "✓" : "✗")}，邪飞天解脱 {(!a || a.Dead ? "✓" : "✗")}，剥掉和弦护盾 / 赐福 {ward.Stripped} 次");
            if (ward.Broken == broken0 || ward.Up) Fail("琵琶碎了，旱魃的护体没有解除");
            if (!staggered) Fail("护体崩散后旱魃没有踉跄");
            if (a && !a.Dead) Fail("琵琶碎后邪飞天没有解脱");
            float s1 = Time.time;
            while (boss.Staggered && Time.time - s1 < 4f) yield return null;
        }

        /// <summary>站到最近的裂口上（每帧拉回去），等一轮喷气：先有地面预警、喷到人</summary>
        IEnumerator VentCase(int erupted0)
        {
            var scorch = boss.Scorch;
            if (scorch.Vents.Count == 0) yield break;
            yield return WaitIdle();
            var near = scorch.Vents.OrderBy(v => (v - boss.transform.position).sqrMagnitude).Skip(Mathf.Min(1, scorch.Vents.Count - 1)).First();
            if (NavMesh.SamplePosition(near, out var nh, 2f, NavMesh.AllAreas)) near = nh.position;
            // 等一轮在站上裂口之后才开始的喷发：之前排好的那一轮（预警在站过来之前就画了，挑的也不是脚下这口）不算
            int bursts0 = scorch.Bursts, warnedPrev = scorch.Warned;
            float t0 = Time.time, every = boss.HDef.VentEveryAt(boss.Phase) + boss.HDef.ventWarn + 2f;
            while (Time.time - t0 < every && scorch.Bursts == bursts0)
            {
                warnedPrev = scorch.Warned;
                Place(near);
                KeepPlayerAlive();
                yield return null;
            }
            if (scorch.Bursts == bursts0)
            {
                Fail($"站在裂口上 {every:F0} s 都没轮到一次喷发");
                yield break;
            }
            // 这一轮的预警在开始那一帧就画了；喷发在预警之后 ventWarn 秒
            int warnedRound = scorch.Warned - warnedPrev, e0 = scorch.Erupted, hits0 = scorch.PlayerHits;
            float r0 = Time.time;
            while (Time.time - r0 < boss.HDef.ventWarn + 0.4f)
            {
                Place(near);
                KeepPlayerAlive();
                yield return null;
            }
            int eruptedRound = scorch.Erupted - e0;
            Line($"喷气裂缝（站在 {At(near)}）：等了 {r0 - t0:F1} s 轮到一次喷发——预警 {warnedRound} 个、{boss.HDef.ventWarn:F1} s 后喷了 {eruptedRound} 口，打中玩家 {scorch.PlayerHits - hits0} 次；" +
                 $"二阶段以来累计喷 {scorch.Erupted - erupted0} 口");
            if (eruptedRound == 0) Fail("这一轮画了预警却没喷气");
            else if (warnedRound < eruptedRound) Fail("喷气裂缝有没先画地面预警就喷的");
            else if (scorch.PlayerHits == hits0) Fail("站在最近的裂口上，喷气没打中玩家");
        }

        IEnumerator Phase3Case()
        {
            var sky = HanbaSunDriver.Find();
            float elev0 = sky ? sky.Elevation : HanbaSunDriver.ElevationOf(SunShaft.ToSun);
            // 日蚀是转阶段后的第一招：计数在越线之前取（进日蚀用例时它可能已经开窗了）
            var ecl0 = boss.MoveById(Phase3Eclipse.MoveId) as Phase3Eclipse;
            var counters = ecl0 != null ? (ecl0.Windows, ecl0.FlareHits, ecl0.FlareShaded, boss.EclipseWeakHits) : (0, 0, 0, 0);
            yield return CrossTo(HanbaDef.RedEarthAt - 0.01f, 2, (_, _, _, _) => { });
            if (!boss || boss.Dead || boss.Phase < 2) yield break;
            var d = boss.HDef;
            var rise = boss.SunRise;
            var ring = boss.Ring;
            // 等太阳推完（露天）
            float t0 = Time.time;
            while (rise.Driver && rise.Driver.Moving && Time.time - t0 < d.sunDriveSeconds + 1.5f) yield return null;
            float elev1 = sky ? sky.Elevation : HanbaSunDriver.ElevationOf(SunShaft.ToSun);
            var ex = boss.Exposure;
            Line($"日轮升顶（{(rise.FromShaft ? "穴顶开口" : "露天：升到头顶")}）：升起 {(ring && ring.Risen ? $"✓ {ring.RiseProgress:P0}" : "✗")}，轮心 {(ring ? At(ring.Center) : "—")} / 目标 {At(rise.Target)}，" +
                 $"太阳仰角 {elev0:F0}° → {elev1:F0}°，日晒：日光增益 {ex.shaftGain:F2}、日轮增益 {ex.ringGain:F2}、日轮直射 {ex.ringRange:F0} m");
            if (!ring || !ring.Risen) Fail("三阶段日轮没有升顶");
            else if (ring.RiseProgress < 0.99f || (ring.Center - rise.Target).magnitude > 1.5f) Fail($"日轮没升到目标（{ring.RiseProgress:P0}，离目标 {(ring.Center - rise.Target).magnitude:F1} m）");
            if (rise.FromShaft)
            {
                if (ex.ringRange < 60f) Fail($"穴顶版三阶段日轮直射距离只有 {ex.ringRange:F0} m（应盖住整个碗底）");
            }
            else
            {
                if (!rise.Driver) Fail("露天场地没有主光可推（场景里没有方向光？）");
                else if (elev1 < d.risenElevation - 1.5f) Fail($"三阶段太阳只推到 {elev1:F0}°（应约 {d.risenElevation:F0}°）");
                float litPhase3 = LitFraction();
                Line($"场地里被日光照到的比例：一阶段 {litPhase1:P0} → 三阶段 {litPhase3:P0}");
                if (litPhase1 >= 0 && litPhase3 < litPhase1 + 0.005f && litPhase1 < 0.995f) Fail("太阳推到头顶后影子没有缩小（被照到的比例没变大）");
                var pav = arena.coverPoints?.FirstOrDefault(p => p && p.name.Contains("Pavilion"));
                if (pav && NavMesh.SamplePosition(pav.position, out var ph, 2f, NavMesh.AllAreas))
                    Line($"楼阁掩体点 {At(ph.position)} 在三阶段 {(Lit(ph.position) ? "仍被照到" : "是影子")}");
            }
            Shot(weapons.eye, "hanba_phase3");
            yield return EclipseCase(counters);
        }

        /// <summary>日蚀（三阶段第一招，自己出）：窗口 3 s、泉珠露出、日轮熄灭、窗口里泉珠伤害 ×3、窗口后强光</summary>
        IEnumerator EclipseCase((int windows, int hits, int shaded, int weak) before)
        {
            if (boss.MoveById(Phase3Eclipse.MoveId) is not Phase3Eclipse ecl) yield break;
            var ex = boss.Exposure;
            var sky = boss.SunRise.Driver;
            // 站到日光里（强光要打得到）
            var spot = FindSpot(p => Lit(p) && (p - boss.transform.position).sqrMagnitude > 64f);
            float t0 = Time.time;
            while (boss.Current != ecl && Time.time - t0 < 6f)
            {
                if (spot.HasValue) Place(spot.Value);
                KeepPlayerAlive();
                yield return null;
            }
            bool natural = boss.Current == ecl;
            if (!natural)
            {
                Line("⚠ 日蚀 6 s 内没有自己出（应是三阶段的第一招），改为强制");
                yield return WaitIdle();
                float f0 = Time.time;
                while (!boss.ForceMove(ecl.Id) && Time.time - f0 < 5f) yield return null;
            }
            if (boss.Current != ecl)
            {
                Fail("日蚀没出成");
                yield break;
            }
            // 强制出的那一次从现在算；自己出的那一次从越线之前算
            int windows0 = natural ? before.windows : ecl.Windows, hits0 = natural ? before.hits : ecl.FlareHits,
                shaded0 = natural ? before.shaded : ecl.FlareShaded, weak0 = natural ? before.weak : boss.EclipseWeakHits;
            float w0 = Time.time;
            while (boss.Current == ecl && ecl.Stage != MoveStage.Active && Time.time - w0 < 3f)
            {
                if (spot.HasValue) Place(spot.Value);
                yield return null;
            }
            // ── 窗口里 ──
            yield return new WaitForSeconds(0.4f);
            if (spot.HasValue) Place(spot.Value);
            yield return new WaitForSeconds(0.25f);
            bool inWindow = boss.Current == ecl && ecl.Stage == MoveStage.Active;
            bool weakOpen = boss.WeakExposed && boss.EclipseOpen, ringDark = boss.Ring && boss.Ring.Eclipsed;
            float sunShare = ex.LastShaft, dim = sky ? sky.Dim : 1f, env = sky ? sky.Env : 1f;
            Aim(motor, eye, boss.BodyCenter);
            Shot(weapons.eye, "hanba_eclipse");
            var hp = boss.Health;
            float h0 = hp.health, s0 = hp.shield;
            Guard(false);
            var inWin = Combat.DamageEnemy(hp, WeakHit());
            Guard(true);
            hp.health = h0;
            hp.shield = s0;
            // ── 窗口后（收招段：泉珠照常露着，不再 ×3）──
            float r0 = Time.time;
            while (boss.Current == ecl && ecl.Stage != MoveStage.Recover && Time.time - r0 < 4f)
            {
                if (spot.HasValue) Place(spot.Value);
                yield return null;
            }
            bool closed = !boss.EclipseOpen;
            DamageResult after = default;
            if (boss.Current == ecl && boss.WeakExposed)
            {
                Guard(false);
                after = Combat.DamageEnemy(hp, WeakHit());
                Guard(true);
                hp.health = h0;
                hp.shield = s0;
            }
            float e0 = Time.time;
            while (boss.Current == ecl && Time.time - e0 < 3f)
            {
                if (spot.HasValue) Place(spot.Value);
                KeepPlayerAlive();
                yield return null;
            }
            yield return new WaitForSeconds(1.2f);
            float ratio = after.total > 0 ? inWin.total / after.total : 0;
            float mult = boss.HDef.eclipseWeakMult;
            Line($"日蚀（{(natural ? "三阶段第一招，自己出" : "强制")}）：窗口 {ecl.LastWindow:F2} s，窗口里 {(inWindow ? "✓" : "✗")}——泉珠露出 {(weakOpen ? "✓" : "✗")}、日轮熄灭 {(ringDark ? "✓" : "✗")}、" +
                 $"日光份额 {sunShare:F1}{(sky ? $"、主光 × {dim:F2}、环境 × {env:F2}" : "")}；泉珠一击 窗口里 {inWin.total:F0} / 窗口后 {after.total:F0} = × {ratio:F2}（应 × {mult:F0}），窗口里打中泉珠 {boss.EclipseWeakHits - weak0} 次；" +
                 $"窗口后关上 {(closed ? "✓" : "✗")}，强光 {(ecl.Flared ? "✓" : "✗")}：打中 {ecl.FlareHits - hits0}、影子里 {ecl.FlareShaded - shaded0}{(sky ? $"，主光回到 × {sky.Dim:F2}、环境 × {sky.Env:F2}" : "")}");
            if (ecl.Windows == windows0) Fail("日蚀没有开窗口");
            if (Mathf.Abs(ecl.LastWindow - boss.HDef.eclipseSeconds) > 0.2f) Fail($"日蚀窗口 {ecl.LastWindow:F2} s（应 {boss.HDef.eclipseSeconds:F0} s）");
            if (!inWindow || !weakOpen) Fail("日蚀窗口里泉珠没有露出");
            if (!ringDark) Fail("日蚀窗口里日轮没有熄灭");
            if (sky && SunExposure.OpenSky && (sunShare > 0 || dim > 0.3f || env > 0.6f)) Fail($"露天日蚀时天没暗（日光份额 {sunShare}，主光 × {dim:F2}，环境 × {env:F2}）");
            if (!closed) Fail("日蚀窗口结束后没有关上（泉珠倍率还在）");
            if (after.total <= 0) Fail("日蚀收招段泉珠没露着（没法比对 ×3）");
            else if (Mathf.Abs(ratio - mult) > mult * 0.05f) Fail($"日蚀窗口里的泉珠伤害是窗口外的 × {ratio:F2}（应 × {mult:F0}）");
            if (boss.EclipseWeakHits - weak0 < 1) Fail("日蚀窗口里打中泉珠没有计数");
            if (!ecl.Flared) Fail("日蚀之后没有强光");
            else if (ecl.FlareHits - hits0 + ecl.FlareShaded - shaded0 != 1) Fail("日蚀强光没有对玩家做判定");
            else if (spot.HasValue && ecl.FlareHits == hits0) Fail("站在日光里，日蚀的强光没打中");
            if (sky && sky.Dim < 0.9f) Fail($"强光之后主光没回到原亮度（× {sky.Dim:F2}）");
            if (sky && sky.Env < 0.99f) Fail($"强光之后环境光没回到原样（× {sky.Env:F2}）");

            DamageInfo WeakHit()
            {
                var i = DamageInfo.Simple(100f, DamageSource.Weapon, boss.BodyCenter, Vector3.forward);
                i.weakpoint = true;
                return i;
            }
        }

        // ───────────── 浸泡 ─────────────

        IEnumerator Soak()
        {
            var hp = boss.Health;
            var ex = boss.Exposure;
            var counts = new Dictionary<string, int>();
            void Count(BossBrain b, BossMove m) => counts[m.Id] = counts.TryGetValue(m.Id, out var n) ? n + 1 : 1;
            boss.MoveStarted += Count;
            int sum0 = boss.Summons.TotalSpawned, samples0 = ex ? ex.Samples : 0, exposed0 = ex ? ex.ExposedSamples : 0, vents0 = boss.Scorch.Erupted;
            int maxAlive = 0, badFrames = 0, revives = 0, maxStacks = 0, phase0 = boss.Phase;
            float maxOut = 0, stuck = 0, longest = 0, t0 = Time.time, nextMoveAt = 0;
            BossMove last = null;
            string badWhat = null;
            while (Time.time - t0 < SoakSeconds && boss && !boss.Dead)
            {
                if (vitals.Dead)
                {
                    vitals.Revive();
                    revives++;
                }
                KeepPlayerAlive();
                if (Time.time >= nextMoveAt)
                {
                    nextMoveAt = Time.time + 6f;
                    var q = arena.RandomPoint(3f);
                    if (NavMesh.SamplePosition(q, out var qh, 3f, NavMesh.AllAreas)) Place(qh.position);
                }
                Aim(motor, eye, boss.BodyCenter);
                var p = boss.transform.position;
                if (!Finite(p) || !Finite(hp.health) || !Finite(hp.shield) || hp.health < 0 || hp.health > hp.maxHealth + 0.01f || hp.shield < 0 || hp.shield > hp.maxShield + 0.01f)
                {
                    badFrames++;
                    badWhat ??= $"位置 {p}，生命 {hp.health}/{hp.maxHealth}，护盾 {hp.shield}/{hp.maxShield}";
                }
                if (Finite(p) && !arena.Contains(p, 0))
                {
                    var flat = p - arena.Center;
                    flat.y = 0;
                    maxOut = Mathf.Max(maxOut, flat.magnitude - arena.Extent);
                }
                maxAlive = Mathf.Max(maxAlive, boss.Summons.Alive + boss.Summons.PendingCount);
                maxStacks = Mathf.Max(maxStacks, SunExposure.PlayerStacks);
                if (boss.Current != null && boss.Current == last) stuck += Time.deltaTime;
                else stuck = 0;
                longest = Mathf.Max(longest, stuck);
                last = boss.Current;
                yield return null;
            }
            boss.MoveStarted -= Count;
            int samples = ex ? ex.Samples - samples0 : 0, exposed = ex ? ex.ExposedSamples - exposed0 : 0;
            Line($"浸泡 {Time.time - t0:F0} s（阶段 {phase0 + 1}）：出招 {string.Join("、", counts.Select(kv => $"{kv.Key}×{kv.Value}"))}，召唤 {boss.Summons.TotalSpawned - sum0} 只（同时最多 {maxAlive}），" +
                 $"邪飞天累计 {boss.ApsarasSummoned} 只、护体 {(boss.WardUp ? "着" : "没")}，裂缝喷 {boss.Scorch.Erupted - vents0} 口，" +
                 $"最远出界 {maxOut:F1} m，单招最长 {longest:F1} s，数值异常 {badFrames} 帧，玩家倒下 {revives} 次，日晒判定 {samples} 次（晒到 {exposed} 次，最高 {maxStacks} 层），泉珠露出累计 {boss.WeakWindows} 次");
            if (!boss || boss.Dead) Fail("浸泡期间首领死了 / 没了");
            if (badFrames > 0) Fail($"浸泡期间首领数值 / 位置非法 {badFrames} 帧（第一次：{badWhat}）");
            if (maxOut > 3f) Fail($"浸泡期间首领跑出场地 {maxOut:F1} m");
            if (longest > MoveTimeout) Fail($"浸泡期间有一招持续了 {longest:F1} s（卡住）");
            if (maxAlive > boss.Summons.Cap) Fail($"浸泡期间召唤物同时 {maxAlive} 只，超过上限 {boss.Summons.Cap}");
            if (counts.Count < 3) Fail($"浸泡 {SoakSeconds:F0} s 只出过 {counts.Count} 种招（{string.Join("、", counts.Keys)}）");
            if (samples < SoakSeconds / SunExposure.Interval * 0.5f) Fail($"浸泡期间日晒只判定了 {samples} 次（应约 {SoakSeconds / SunExposure.Interval:F0} 次）");
            if (maxStacks > SunburnStatus.MaxStacks) Fail($"日晒叠到 {maxStacks} 层，超过上限 {SunburnStatus.MaxStacks}");
            if (boss.Phase >= 1 && boss.Scorch.Vents.Count > 0 && boss.Scorch.Erupted == vents0) Fail($"浸泡 {SoakSeconds:F0} s 裂缝一口气都没喷");
        }

        // ───────────── 击杀 → 结算 ─────────────

        IEnumerator KillCase()
        {
            Guard(false);
            boss.Summons.DespawnAll();
            var hp = boss.Health;
            var ex = boss.Exposure;
            var ring = boss.Ring;
            var spring = boss.Spring;
            var sky = SunExposure.OpenSky ? HanbaSunDriver.Find() : null;
            bool risen = ring && ring.Risen;
            int defeated0 = defeatedEvents;
            vitals.health = vitals.MaxHealth * 0.3f;
            vitals.shield = 0;
            float k0 = Time.time;
            while (!hp.Dead && Time.time - k0 < 15f)
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
                Fail("旱魃没被打死");
                yield break;
            }
            float deadAt = Time.time;
            // 日轮坠落碎裂在倒下后约 1.1 s；之后首领物体会被回收（日轮跟着没了），所以边等边记
            bool shattered = false;
            void Watch() => shattered |= ring && ring.Shattered;
            yield return null;
            Watch();
            Line($"击杀：BossDefeated +{defeatedEvents - defeated0}，阶段 {boss.Phase + 1}，日晒判定停了 {(ex && !ex.Running ? "✓" : "✗")}，日轮炽度目标 {ring?.BlazeTarget:F2}，" +
                 $"死亡演出 {(boss.Cinematics && boss.Cinematics.DefeatStarted ? "✓" : "✗")}，邪飞天 {(boss.Apsara ? "✗ 还在" : "✓ 不在")}");
            if (defeatedEvents - defeated0 != 1) Fail($"BossDefeated 派发了 {defeatedEvents - defeated0} 次（应 1 次）");
            if (ex && ex.Running) Fail("旱魃倒下后日晒判定还在跑");
            if (!boss.Cinematics || !boss.Cinematics.DefeatStarted) Fail("旱魃倒下后没有死亡演出");
            if (boss.Apsara) Fail("旱魃倒下后邪飞天还活着");
            if (enc)
            {
                vitals.health = Mathf.Min(vitals.health, vitals.MaxHealth * 0.3f);
                float s0 = Time.time;
                while (enc.State != BossEncounter.Phase.Settled && Time.time - s0 < BossEncounter.SettleDelay + 3f)
                {
                    Watch();
                    yield return null;
                }
                yield return null;
                bool healed = vitals.health >= vitals.MaxHealth - 0.5f;
                var chest = enc.RewardChest;
                Line($"结算：{enc.State}（{Time.time - s0:F1} s），回满 {(healed ? "✓" : "✗")}，宝箱「{(chest ? chest.EffectiveReward : "（没有）")}」档位 {chest?.tier}，去向 {enc.Result}，溃散 {enc.Dispersed} 只");
                if (enc.State != BossEncounter.Phase.Settled) Fail("旱魃倒下后没有结算");
                if (!healed) Fail("结算没有回满生命");
                if (!chest) Fail("结算没有落首领宝箱");
                else if (chest.tier != ChestTier.Boss) Fail($"首领宝箱档位 {chest.tier}（应为 Boss）");
                if (enc.Result != BossEncounter.Outcome.NextStage) Fail($"1-4 打完的去向是 {enc.Result}（应为下一关）");
                float o0 = Time.time;
                while (!enc.OpenedExit && Time.time - o0 < BossEncounter.PortalDelay + 2f)
                {
                    Watch();
                    yield return null;
                }
                Line($"出口：{(enc.OpenedExit ? $"✓ {enc.OpenedExit.name} @ {At(enc.OpenedExit.transform.position)}" : "✗ 没有升起")}");
                if (!enc.OpenedExit) Fail("结算后出口没有升起");
                else Aim(motor, eye, enc.OpenedExit.Focus);
                yield return new WaitForSeconds(0.5f);
                Shot(weapons.eye, "hanba_settled");
            }
            else Line("没有 BossEncounter：不查结算");

            // ── 死亡演出的收尾：泉眼复涌、日轮碎、太阳回到午后、时间回到 1 ──
            float wait = HanbaCinematics.RefillAt + HanbaCinematics.RefillSeconds + 0.6f - (Time.time - deadAt);
            for (float w0 = Time.time; Time.time - w0 < wait;)
            {
                Watch();
                yield return null;
            }
            Watch();
            if (sky)
            {
                float r0 = Time.time;
                while (sky.Moving && Time.time - r0 < HanbaCinematics.SunRestoreSeconds + 1f) yield return null;
            }
            Line($"死亡演出：泉眼复涌 {(spring ? $"{(spring.Level >= 0.99f && spring.ActiveWaters == spring.Count ? "✓" : "✗")}（水位 {spring.Level:F2}，启用 {spring.ActiveWaters}/{spring.Count} 段）" : "（没有泉水）")}，" +
                 $"日轮 {(risen ? shattered ? "坠落碎裂 ✓" : "✗ 没碎" : "原地熄灭")}，太阳 {(sky ? $"{sky.Elevation:F0}°（原 {sky.OriginalElevation:F0}°），亮度 × {sky.Dim:F2}" : "（穴顶版 / 没有主光）")}，时间 × {TimeScaleArbiter.Current:F2}");
            if (spring && (spring.Level < 0.99f || spring.ActiveWaters < spring.Count)) Fail("旱魃倒下后泉眼没有复涌");
            if (spring && spring.SurfacesShown < spring.Surfaces) Fail("泉眼复涌了，水面没回来（共用水面还停用着）");
            if (risen && !shattered) Fail("升顶的日轮在旱魃倒下后没有坠落碎裂");
            if (sky && (Mathf.Abs(sky.Elevation - sky.OriginalElevation) > 1.5f || sky.Dim < 0.95f)) Fail("旱魃倒下后太阳没回到原来的高度 / 亮度");
            if (TimeScaleArbiter.Current < 0.99f) Fail($"死亡演出之后时间没回到 1（× {TimeScaleArbiter.Current:F2}）");
        }

        // ───────────── 工具 ─────────────

        /// <summary>等首领回到招式间隙（不在出招、转换、硬直里）</summary>
        IEnumerator WaitIdle()
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < MoveTimeout)
            {
                KeepPlayerAlive();
                yield return null;
            }
        }

        void SetHealthFraction(float fraction)
        {
            var hp = boss.Health;
            hp.health = Mathf.Clamp(hp.maxHealth * fraction, 1f, hp.maxHealth);
        }

        /// <summary>玩家站到首领正前方 distance 米（夹进场地、贴到导航网格），对着首领、回满</summary>
        void ReadyPlayer(float distance)
        {
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            var fwd = boss.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            var spot = arena.Clamp(boss.transform.position + fwd * distance, 2f);
            if (NavMesh.SamplePosition(spot, out var hit, 4f, NavMesh.AllAreas)) spot = hit.position;
            Place(spot);
            Aim(motor, eye, boss.BodyCenter);
        }

        void KeepPlayerAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);
        static bool Finite(float v) => float.IsFinite(v);
        static bool Finite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
