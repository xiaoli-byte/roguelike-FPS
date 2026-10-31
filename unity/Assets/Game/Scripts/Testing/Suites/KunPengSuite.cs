using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.UIElements;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 鲲鹏冒烟（BS3，bridge.sh playtest boss-kunpeng；场景 2-4 北冥冰台；docs/unity-parity.md 7.4「每个首领」+ tests/frost-boss.test.mjs）：
    ///   · 定义：自检、血条刻度 75 / 50 / 25%、2.28 下的定档、模拟秒伤击杀用时 60–120 s（<see cref="KunPengBalance"/>）；
    ///   · 开战：玩家走到登台口 → BossEncounter 登场预警 → 鲲从冰窟里（刷新点那一侧）升起，登场中不可选中；冰窟找到的是场景标记、导航停用、水面遮罩在水面下；
    ///     从玩家眼睛瞄额头的鲛珠打得到弱点；
    ///   · 鲲的四招各强制出一次（首领不掉血）：走到出手、正常收招、画过预警、出招中霸体——
    ///       吞吸把扇形里的玩家一阵阵拉向冰窟；猛砸打中站在落点上的玩家、掀冰浪，头趴在环台上时鲛珠离地近；潜袭沉下去不可选中、从玩家那一侧破冰；
    ///       吐冰给远处的玩家三块带落点预警的冰弹；全程平切口压在水面下（<see cref="KunPengBrain.CutTop"/>）；
    ///   · 75%：鲲怒，猛砸连掀四道冰浪；
    ///   · 50%：转换（不可选中、冰雾爆闪），鲲在雾最浓时换成鹏：鹏的模型显示、鲲的收起，受伤体的 Animator 换到鹏上（EnemyBody.Rebind），
    ///     弱点挂在鹏的模型上，血条名「鲲鹏 · 鹏」，护盾 ≥ 六成，转换后在冰窟上空 10 m 以上，第一招扇翼狂风把玩家往外推；
    ///   · 血条标题单行（登场后、化鹏后），登记过的首领里最长的名字 / 副标题也放得下；
    ///   · 鹏的四招各强制出一次：狂风（上面）、俯冲掠台（玩家站在开阔处：贴地掠过、不撞柱；躲在冰柱正后方：算成引撞、撞柱硬直、不挨打）、
    ///     羽刃雨（每枚都有落点预警）、落台歇翼（落在环台上）；
    ///   · 25%：鹏狂怒，俯冲连掠两次、羽刃 14 枚；
    ///   · 90 s 浸泡（首领不掉血）：不出场地、数值有限、招式不卡死、至少出过两种招；
    ///   · 击杀 → 溃散 → 结算：首领宝箱（首领档）、回满、出口升起（2-4 不是最后一关 → 下一章）；
    ///   · 冰窟：掉进去扣血、托回安全落脚点（L8 深水）；
    ///   · 四种代理：美术缺失时的代理模型（冰鲸 / 三青鸟）、占位胶囊、没有冰窟标记（虚拟冰窟）、动作片段缺失（Animator 关掉：招式按时间兜底、鲲按状态表俯仰）——
    ///     每种都登场、出两招、强制化鹏、出两招、击杀，不出异常。
    /// 运行时报错由宿主记不合格（PlaytestRunner）。
    /// </summary>
    public sealed class KunPengSuite : PlaytestSuite
    {
        public override string Id => "boss-kunpeng";
        /// <summary>2-4 北冥冰台（与编辑器里 Level_2_4.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L2_4_Beiming.unity";

        const float SoakSeconds = 90f, MoveTimeout = 14f, CutTolerance = -0.15f;

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        Transform eye;
        BossArena arena;
        BossEncounter enc;
        KunPengBrain boss;
        IDisposable bossGuard;
        int logErrors, spawnedEvents, defeatedEvents, formEvents;
        string lastError;
        readonly List<int> phaseEvents = new();
        readonly HashSet<string> movesRun = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少玩家组件：weapons={weapons} motor={motor} vitals={vitals}（场景不是 2-4？先 bridge.sh level 2-4）");
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
            GameEvents.BossForm += OnForm;
            vitals.stats.Add("playtest_kunpeng", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            RunState.Ensure();

            CheckDef();
            yield return StartFight();
            if (boss && !boss.Dead)
            {
                bossGuard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
                yield return WeakSpotCase();
                yield return KunMoves();
                yield return FuryCase();
                yield return SwapCase();
                yield return PengMoves();
                yield return RageCase();
                yield return Soak();
                yield return KillCase();
            }
            yield return HoleFallCase();
            yield return ProxyCases();

            bossGuard?.Dispose();
            bossGuard = null;
            vitals.stats.Remove("playtest_kunpeng");
            GameEvents.BossSpawned -= OnSpawned;
            GameEvents.BossPhase -= OnPhase;
            GameEvents.BossDefeated -= OnDefeated;
            GameEvents.BossForm -= OnForm;
            Application.logMessageReceived -= OnLog;
            if (boss && !boss.Dead) Destroy(boss.gameObject);
            Line($"合计：出过的招 {string.Join("、", movesRun)}，敌人对玩家伤害 {Runner.playerDamage:F0}，运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnSpawned(BossBrain b) => spawnedEvents++;

        void OnPhase(BossBrain b, int p)
        {
            if (b == boss) phaseEvents.Add(p);
        }

        void OnDefeated(BossBrain b)
        {
            if (b == boss) defeatedEvents++;
        }

        void OnForm(BossBrain b, BossFormDef f)
        {
            if (b == boss) formEvents++;
        }

        // ───────────── 定义 ─────────────

        void CheckDef()
        {
            var def = Bosses.Get(KunPengDef.Id) as KunPengDef;
            if (def == null)
            {
                Fail($"没有登记首领 {KunPengDef.Id}（KunPengDef）");
                return;
            }
            var errs = def.Validate();
            if (errs.Count > 0) Fail($"鲲鹏定义自检：{string.Join("；", errs)}");
            var ticks = def.BarTicks;
            bool ticksOk = ticks.Count == 3 && Mathf.Approximately(ticks[0], 0.75f) && Mathf.Approximately(ticks[1], 0.5f) && Mathf.Approximately(ticks[2], 0.25f);
            var v = def.VitalsAt(KunPengDef.StageDifficulty);
            float dps = KunPengBalance.ReferenceDps, t = KunPengBalance.KillSeconds(def, KunPengDef.StageDifficulty, dps);
            Line($"定义：{def.name}（{def.title}），形态 {string.Join(" → ", def.forms.Select(f => $"{f.name}{(f.flying ? "（飞）" : "")}"))}，血条刻度 {string.Join(" / ", ticks.Select(x => $"{x:P0}"))} {(ticksOk ? "✓" : "✗")}，" +
                 $"难度 {KunPengDef.StageDifficulty} 下 {v}；招式 {string.Join("、", def.moves.Select(m => m().Id))}；模拟击杀用时 {t:F0} s（参考秒伤 {dps:F0}）");
            if (!ticksOk) Fail("血条刻度不是 75% / 50% / 25%");
            if (!(t >= 60f && t <= 120f)) Fail($"模拟击杀用时 {t:F0} s 不在 60–120 s");
        }

        // ───────────── 开战 ─────────────

        IEnumerator StartFight()
        {
            enc = FindObjectsByType<BossEncounter>(FindObjectsSortMode.None).FirstOrDefault(e => e && e.bossId == KunPengDef.Id);
            arena = enc && enc.arena ? enc.arena : BossArena.Find(KunPengDef.Id);
            if (!arena)
            {
                Line("场景里没有鲲鹏的 BossArena（2-4 还没生成？），在玩家前方临时建一个 30 m 的场地（虚拟冰窟）");
                var fwd = motor.transform.forward;
                fwd.y = 0;
                arena = BossArena.CreateRuntime(motor.transform.position + fwd.normalized * 32f, 30f, fwd, KunPengDef.Id);
            }
            int spawned0 = spawnedEvents;
            if (enc && enc.State == BossEncounter.Phase.Waiting)
            {
                Place(arena.PlayerEntryPoint);
                Aim(motor, eye, arena.Center + Vector3.up * 4f);
                float t0 = Time.time;
                while (!enc.Boss && Time.time - t0 < enc.warnSeconds + 5f) yield return null;
                Line($"首领关流程：走上登台口 → {enc.State}（{Time.time - t0:F1} s 后首领登场）");
                boss = enc.Boss as KunPengBrain;
                if (!boss) Fail($"BossEncounter 没有刷出鲲鹏（State {enc.State}，Boss {enc.Boss}）");
            }
            else
            {
                Line(enc ? $"BossEncounter 状态 {enc.State}，直接刷鲲鹏" : "场景里没有鲲鹏的 BossEncounter，直接在场地上刷");
                Place(arena.PlayerEntryPoint);
                boss = Bosses.Spawn(KunPengDef.Id, arena, KunPengDef.StageDifficulty) as KunPengBrain;
                if (!boss) Fail("鲲鹏生成失败（行为不是 KunPengBrain？）");
            }
            if (!boss) yield break;
            var hp = boss.Health;
            var h = boss.Hole;
            var agent = boss.GetComponent<NavMeshAgent>();
            float dist = h.Distance(boss.transform.position);
            float spawnSide = Mathf.Abs(Mathf.DeltaAngle(boss.Theta, h.Angle(arena.BossSpawnPoint)));
            Line($"生成：{boss.Title}（{boss.Subtitle}），{hp.maxHealth:F0} 生命 + {hp.maxShield:F0} 护盾（难度 {boss.level:F2}），模型 {Source(boss.Model)}；{h}；" +
                 $"导航 {(agent && agent.enabled ? "✗ 还开着" : "✓ 停用")}；鲲离圆心 {dist:F1} m、方位 {boss.Theta:F0}°（刷新点方位差 {spawnSide:F0}°）；BossSpawned +{spawnedEvents - spawned0}");
            if (spawnedEvents - spawned0 != 1) Fail($"BossSpawned 派发了 {spawnedEvents - spawned0} 次（应 1 次）");
            if (!h.found) Fail("鲲鹏没找到场景里的冰窟标记（IceHole），用的是虚拟冰窟");
            if (agent && agent.enabled) Fail("鲲鹏的 NavMeshAgent 还开着（鲲在冰窟里、鹏在空中，都不走导航）");
            if (!(dist < h.radius)) Fail($"鲲不在冰窟里（离圆心 {dist:F1} m，冰窟半径 {h.radius:F1}）");
            if (spawnSide > 30f) Fail($"鲲第一次探头不在刷新点那一侧（方位差 {spawnSide:F0}°）");
            var hm = boss.HoleMarker;
            if (!hm || !hm.Mask) Fail("冰窟没有水面遮罩");
            else if (!(hm.Mask.transform.position.y < h.waterY)) Fail("水面遮罩不在水面下");
            yield return null;
            if (!hp.untargetable) Fail("登场期间可以被选中");
            Aim(motor, eye, boss.BodyCenter);
            float i0 = Time.time;
            while (!boss.IntroDone && Time.time - i0 < boss.Def.intro.seconds + 3f) yield return null;
            yield return new WaitForSeconds(0.6f);
            Line($"登场：{(boss.IntroDone ? $"✓ {Time.time - i0:F1} s" : "✗ 没有结束")}，之后可选中 {(!hp.untargetable ? "✓" : "✗")}，沉浮 {boss.Sunk:F2}，" +
                 $"片段带宿主运动 {(boss.BakedHost ? "✓" : "否（代理 / 缺片段：按状态表俯仰）")}，平切口最高点 {boss.CutTop:F2} m（相对水面）");
            Aim(motor, eye, boss.BodyCenter);
            Shot(weapons.eye, "kunpeng_intro");
            CheckBarTitle("登场后");
            if (!boss.IntroDone) Fail("登场演出没有结束");
            if (hp.untargetable) Fail("登场结束后仍不可选中");
            if (!(boss.CutTop < CutTolerance)) Fail($"鲲的平切口露出水面（最高点 {boss.CutTop:F2} m）");
        }

        /// <summary>
        /// 血条标题单行（hud.uss 的 .sf-boss__name 不换行），并且登记过的首领里最长的名字（含形态，如「火麒麟 · 玄鳞」）、最长的副标题也放得下：
        /// 标题按自身字号 / 字距测宽，和标题区（面板宽 − 两侧祥云与边距）比
        /// </summary>
        void CheckBarTitle(string when)
        {
            var root = Hud.Instance ? Hud.Instance.Widget<BossBar>()?.Root : null;
            var name = root?.Q<Label>(className: "sf-boss__name");
            var sub = root?.Q<Label>(className: "sf-boss__sub");
            var head = root?.Q(className: "sf-boss__head");
            var panel = root?.Q(className: "sf-boss__panel");
            if (name == null || head == null || panel == null || !(name.layout.height > 0) || !(panel.layout.width > 0))
            {
                Line($"血条标题（{when}）：没有首领血条或还没排版，跳过");
                return;
            }
            float fs = name.resolvedStyle.fontSize;
            bool oneLine = name.layout.height < fs * 1.9f;
            float pad = name.resolvedStyle.paddingLeft + name.resolvedStyle.paddingRight;
            float room = panel.layout.width - (head.layout.width - name.layout.width);
            string longest = null, longestSub = null;
            float widest = 0, widestSub = 0;
            foreach (var d in Bosses.All)
            {
                if (d == null) continue;
                var titles = new List<string> { d.name };
                foreach (var f in d.forms)
                    if (f != null && !string.IsNullOrEmpty(f.name))
                        titles.Add($"{d.name} · {f.name}");
                foreach (var t in titles)
                {
                    float w = name.MeasureTextSize(t, 0, VisualElement.MeasureMode.Undefined, 0, VisualElement.MeasureMode.Undefined).x + pad;
                    if (w > widest) (widest, longest) = (w, t);
                }
                if (sub != null && !string.IsNullOrEmpty(d.title))
                {
                    float w = sub.MeasureTextSize(d.title, 0, VisualElement.MeasureMode.Undefined, 0, VisualElement.MeasureMode.Undefined).x;
                    if (w > widestSub) (widestSub, longestSub) = (w, d.title);
                }
            }
            bool fits = widest <= room + 0.5f, subFits = widestSub <= panel.layout.width + 0.5f;
            Line($"血条标题（{when}）：「{name.text}」{name.layout.width:F0} × {name.layout.height:F0}（字号 {fs:F0}）{(oneLine ? "✓ 单行" : "✗ 折行")}；" +
                 $"最长的首领名「{longest}」{widest:F0} / 标题区 {room:F0} {(fits ? "✓" : "✗")}，最长的副标题「{longestSub}」{widestSub:F0} / {panel.layout.width:F0} {(subFits ? "✓" : "✗")}");
            if (!oneLine) Fail($"血条标题「{name.text}」折成了 {name.layout.height / fs:F1} 行高");
            if (!fits) Fail($"最长的首领名「{longest}」放不下血条标题区（{widest:F0} > {room:F0}）");
            if (!subFits) Fail($"最长的副标题「{longestSub}」放不下血条（{widestSub:F0} > {panel.layout.width:F0}）");
            // 右上角信息角的关卡名 / 目标也单行（「2-4 · 北冥冰台 · 鲲鹏」「击败 鲲鹏」）
            var info = Hud.Instance.Widget<InfoWidget>()?.Root;
            foreach (var cls in new[] { "sf-info__stage", "sf-info__objective" })
            {
                var l = info?.Q<Label>(className: cls);
                if (l == null || !(l.layout.height > 0) || string.IsNullOrEmpty(l.text)) continue;
                float lfs = l.resolvedStyle.fontSize;
                bool single = l.layout.height < lfs * 1.9f;
                Line($"  信息角 {cls}：「{l.text}」{l.layout.width:F0} × {l.layout.height:F0}（字号 {lfs:F0}）{(single ? "✓ 单行" : "✗ 折行")}");
                if (!single) Fail($"信息角「{l.text}」折成了 {l.layout.height / lfs:F1} 行高");
            }
        }

        // ───────────── 弱点 ─────────────

        IEnumerator WeakSpotCase()
        {
            yield return WaitIdle();
            boss.Stagger(4f, "Hit");
            var h = boss.Hole;
            Place(Ring(boss.Theta, h.radius + 10f));
            yield return new WaitForSeconds(0.3f);
            var pearl = boss.Model?.FindBone("pearl");
            if (!pearl)
            {
                Line($"模型 {Source(boss.Model)} 没有 pearl 骨骼：跳过鲛珠瞄准");
                yield break;
            }
            Aim(motor, eye, pearl.position);
            yield return null;
            var dir = (pearl.position - eye.position).normalized;
            // 与武器的命中扫描同一条规则（Ballistics / WeakpointRule）：先打到的命中盒是弱点，或进身体之后 1.5 m 内穿过同一单位的弱点
            bool weak = false;
            string what = "（什么都没打到）";
            var hits = new RaycastHit[32];
            int n = Physics.RaycastNonAlloc(eye.position, dir, hits, 120f, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            WeakpointRule.SortByDistance(hits, n);
            for (int i = 0; i < n; i++)
            {
                var c = hits[i].collider;
                if (!c || c.transform.IsChildOf(motor.transform)) continue;
                var hb = c.GetComponent<Hitbox>();
                var z = c.GetComponent<HitZone>();
                if (!hb || hb.owner != boss.Health)
                {
                    what = $"{c.name}（挡在前面）";
                    break;
                }
                weak = hb.weakpoint || WeakpointRule.FindWeakpoint(hits, n, i, boss.Health) >= 0;
                what = $"{(z ? z.id : c.name)}{(hb.weakpoint ? "（弱点）" : weak ? " → 1.5 m 内穿过弱点" : "")}";
                break;
            }
            float height = pearl.position.y - h.FloorY;
            Line($"鲛珠：离环台 {height:F1} m，从玩家眼睛瞄过去打到 {what} {(weak ? "✓" : "✗")}");
            Shot(weapons.eye, "kunpeng_pearl");
            if (!weak) Fail($"瞄额头的鲛珠没打到弱点（打到 {what}）");
            if (!(height > 3f)) Fail($"鲛珠太低（{height:F1} m）：鲲没有探出水面？");
            float s0 = Time.time;
            while (boss.Staggered && Time.time - s0 < 5f) yield return null;
        }

        // ───────────── 鲲的四招 ─────────────

        IEnumerator KunMoves()
        {
            var h = boss.Hole;
            float worstCut = float.NegativeInfinity, pearlLow = float.PositiveInfinity;

            // 吞吸：玩家站在鲲正前方的环台上（离冰窟 9 m），一阵阵被拉向冰窟
            yield return WaitIdle();
            var front = Ring(boss.Theta, h.radius + 9f);
            Place(front);
            float d0 = h.Distance(front), dMin = d0;
            var inhale = boss.MoveById(KunInhale.MoveId) as KunInhale;
            yield return OneMove(inhale, m =>
            {
                worstCut = Mathf.Max(worstCut, boss.CutTop);
                if (m.Stage == MoveStage.Active) dMin = Mathf.Min(dMin, h.Distance(motor.transform.position));
            });
            if (inhale != null)
            {
                var toHole = (h.center - front);
                toHole.y = 0;
                float dot = Vector3.Dot(inhale.LastPull, toHole.normalized);
                Line($"  吞吸：拉了 {inhale.Pulses} 下（被掩体挡 {inhale.BlockedPulses} 下），离冰窟 {d0:F1} → 最近 {dMin:F1} m，拉的方向与指向冰窟的夹角余弦 {dot:F2}，扑咬打中 {(inhale.BiteHit ? "✓" : "✗")}");
                if (inhale.Pulses < 8) Fail($"吞吸只拉了 {inhale.Pulses} 下（3 s 里应约 20 下）");
                if (inhale.Pulses > 0 && dot < 0.5f) Fail("吞吸没有把玩家往冰窟拉");
                if (!(dMin < d0 - 0.8f)) Fail($"吞吸 3 s 玩家没被拉近（{d0:F1} → {dMin:F1} m）");
            }

            // 猛砸：玩家站在落点上
            yield return WaitIdle();
            Place(Ring(boss.Theta + 25f, h.radius + 12f));
            var slam = boss.MoveById(KunSlam.MoveId) as KunSlam;
            bool placed = false;
            yield return OneMove(slam, m =>
            {
                worstCut = Mathf.Max(worstCut, boss.CutTop);
                if (!placed && m.Stage == MoveStage.Windup && slam != null)
                {
                    placed = true;
                    Place(Snap(slam.Impact));
                }
                if (m.Stage == MoveStage.Active)
                {
                    var p = boss.Model?.FindBone("pearl");
                    if (p) pearlLow = Mathf.Min(pearlLow, p.position.y - h.FloorY);
                }
            });
            if (slam != null)
            {
                Line($"  猛砸：落点 {At(slam.Impact)}（离圆心 {h.Distance(slam.Impact):F1} m），重击打中 {(slam.BlastHit ? "✓" : "✗")}，冰浪 {slam.Waves} 道，趴台时鲛珠离地最低 {pearlLow:F1} m");
                if (!slam.BlastHit) Fail("猛砸没打中站在落点上的玩家");
                if (slam.Waves < 1) Fail("猛砸没有掀冰浪");
                if (boss.BakedHost && !(pearlLow > 0.3f && pearlLow < 4.5f)) Fail($"猛砸趴台时鲛珠离地 {pearlLow:F1} m（应在 0.3–4.5 m：离地近但不埋进环台）");
            }

            // 潜袭：玩家在鲲侧面 90°，沉下去不可选中，从玩家那一侧破冰
            yield return WaitIdle();
            float side = boss.Theta + 90f;
            Place(Ring(side, h.radius + 12f));
            var dive = boss.MoveById(KunDive.MoveId) as KunDive;
            bool hidden = false;
            yield return OneMove(dive, m =>
            {
                worstCut = Mathf.Max(worstCut, boss.CutTop);
                if (m.Stage == MoveStage.Windup && m.StageT > 0.8f && m.StageT < 1.9f && boss.Health.untargetable) hidden = true;
            });
            if (dive != null)
            {
                float off = Mathf.Abs(Mathf.DeltaAngle(boss.Theta, boss.PlayerAngle));
                Line($"  潜袭：水下不可选中 {(hidden ? "✓" : "✗")}，换位 {(dive.Relocated ? "✓" : "✗")}，破冰处离玩家方位 {off:F0}°，重击打中 {(dive.BlastHit ? "是" : "否")}");
                if (!hidden) Fail("潜袭沉在水下时可以被选中");
                if (!dive.Relocated) Fail("潜袭没有在水下换位");
                if (off > 35f) Fail($"潜袭没从玩家那一侧破冰（方位差 {off:F0}°）");
            }

            // 吐冰：玩家站远（外缘内 8 m）
            yield return WaitIdle();
            Place(Ring(boss.Theta, h.outer - 8f));
            var spit = boss.MoveById(KunSpit.MoveId) as KunSpit;
            int warned0 = spit != null ? spit.Warned : 0;
            yield return OneMove(spit, m => worstCut = Mathf.Max(worstCut, boss.CutTop));
            if (spit != null)
            {
                Line($"  吐冰：{spit.Lobs} 块冰弹，预警 {spit.Warned - warned0} 个");
                if (spit.Lobs < 3) Fail($"吐冰只吐了 {spit.Lobs} 块（应 ≥ 3）");
            }
            Line($"鲲的平切口：四招里最高点 {worstCut:F2} m（相对水面；片段带宿主运动 {boss.BakedHost}）");
            if (!(worstCut < CutTolerance)) Fail($"鲲的平切口露出水面（最高点 {worstCut:F2} m）");
        }

        // ───────────── 75%：鲲怒 ─────────────

        IEnumerator FuryCase()
        {
            yield return WaitIdle();
            SetHealthFraction(KunPengDef.FuryAt - 0.01f);
            yield return null;
            yield return null;
            Line($"越过 75%：鲲怒 {(boss.KunFury ? "✓" : "✗")}");
            if (!boss.KunFury) Fail("生命层降到 74% 鲲没有发怒");
            var slam = boss.MoveById(KunSlam.MoveId) as KunSlam;
            Place(Ring(boss.Theta + 40f, boss.Hole.radius + 14f));
            yield return OneMove(slam, null);
            if (slam != null)
            {
                Line($"  鲲怒的猛砸：冰浪 {slam.Waves} 道（正前 + 两侧 + 补一道）");
                if (slam.Waves < 4) Fail($"鲲怒的猛砸只有 {slam.Waves} 道冰浪（应 4 道）");
            }
        }

        // ───────────── 50%：化鹏 ─────────────

        IEnumerator SwapCase()
        {
            yield return WaitIdle();
            var h = boss.Hole;
            var hp = boss.Health;
            // 玩家站在两柱之间、离鲲远的一侧（狂风的推力不被柱子 / 矮墙挡）
            float az = Mathf.Abs(Mathf.DeltaAngle(boss.Theta, 20f)) > 90f ? 20f : 200f;
            Place(Ring(az, h.MidRing));
            int events0 = phaseEvents.Count, forms0 = formEvents;
            var kunModel = boss.Model;
            hp.shield = 0;
            SetHealthFraction(KunPengDef.SwapAt - 0.02f);
            float t0 = Time.time;
            while (phaseEvents.Count == events0 && Time.time - t0 < boss.Def.phaseWait + 3f) yield return null;
            bool fired = phaseEvents.Count > events0 && phaseEvents[^1] == 1;
            bool untargetable = boss.Transitioning && hp.untargetable;
            float tr0 = Time.time, fogPeak = 0;
            bool kunAtOne = false, fogShot = false;
            while (boss.Transitioning && Time.time - tr0 < 7f)
            {
                fogPeak = Mathf.Max(fogPeak, boss.HoleFx ? boss.HoleFx.FlashLevel : 0);
                if (boss.TransitionTime > 0.9f && boss.TransitionTime < 1.3f && boss.IsKun) kunAtOne = true;
                if (!fogShot && boss.TransitionTime > 2.2f)
                {
                    fogShot = true;
                    Shot(weapons.eye, "kunpeng_swap_fog");
                }
                Aim(motor, eye, boss.BodyCenter);
                yield return null;
            }
            yield return null;
            var body = boss.GetComponent<EnemyBody>();
            var model = boss.Model;
            bool modelSwapped = model != null && model != kunModel && model.root && model.root.activeSelf && (kunModel == null || !kunModel.root || !kunModel.root.activeSelf);
            bool rebound = body && model != null && body.Animator == model.animator;
            bool weakOnPeng = body && body.WeakPoint && model != null && model.root && body.WeakPoint.IsChildOf(model.root.transform);
            float alt = boss.transform.position.y - h.FloorY;
            float shield = hp.maxShield > 0 ? hp.shield / hp.maxShield : 1;
            Line($"越过 50%：BossPhase {(fired ? $"✓ → 阶段 {boss.Phase}" : "✗")}，转换中不可选中 {(untargetable ? "✓" : "✗")}，1 s 时还是鲲 {(kunAtOne ? "✓" : "✗")}，冰雾最浓 {fogPeak:F2}，" +
                 $"转换 {Time.time - tr0:F1} s → 形态 {boss.Form?.id}（BossForm +{formEvents - forms0}），模型 {Source(model)} {(modelSwapped ? "✓ 换了" : "✗")}，" +
                 $"受伤体的 Animator {(rebound ? "✓ 鹏的" : "✗ 还是旧的")}，弱点在鹏身上 {(weakOnPeng ? "✓" : "✗")}，血条「{boss.Title}」，护盾 {shield:P0}，离环台 {alt:F1} m，之后可选中 {(!hp.untargetable ? "✓" : "✗")}");
            if (!fired) Fail("生命层降到 48% 没有进入二阶段");
            if (!untargetable) Fail("转换中可以被选中");
            if (!kunAtOne) Fail("转换 1 s 时已经不是鲲了（应在冰雾最浓的 1.55 s 换）");
            if (!boss.IsPeng) Fail("转换后不是鹏");
            if (!modelSwapped) Fail("转换后模型没换成鹏（或鲲的模型没收起）");
            if (!rebound) Fail("换形后 EnemyBody.Animator 还指着鲲的模型（Rebind 没生效）");
            if (!weakOnPeng) Fail("换形后弱点不在鹏的模型上");
            if (boss.Title != "鲲鹏 · 鹏") Fail($"血条名「{boss.Title}」（应为「鲲鹏 · 鹏」）");
            if (shield < 0.59f) Fail($"化鹏后护盾只有 {shield:P0}（应重凝六成）");
            if (fogPeak < 0.9f) Fail($"冰雾爆闪最浓只有 {fogPeak:F2}");
            if (hp.untargetable) Fail("转换结束后仍不可选中");
            if (!(alt > 10f)) Fail($"鹏转换后只离环台 {alt:F1} m（应在冰窟上空 10 m 以上）");
            Shot(weapons.eye, "kunpeng_peng");
            CheckBarTitle("化鹏后");

            // 第一招：扇翼狂风，把环台上的玩家往外推
            float g0 = Time.time;
            while (!(boss.Current is PengGust) && Time.time - g0 < 4f) yield return null;
            var gust = boss.Current as PengGust;
            if (gust == null)
            {
                Fail($"化鹏后第一招不是扇翼狂风（{boss.Current?.Id ?? "没出招"}）");
                yield break;
            }
            movesRun.Add(gust.Id);
            var p0 = Flat(motor.transform.position);
            while (boss.Current == gust && Time.time - g0 < MoveTimeout)
            {
                KeepPlayerAlive();
                Aim(motor, eye, boss.BodyCenter);
                yield return null;
            }
            var outward = Flat(p0 - h.center).normalized;
            float dot = Vector3.Dot(gust.LastPush, outward);
            Line($"  扇翼狂风：推了 {gust.Pushes} 下（被掩体挡 {gust.BlockedPushes} 下），方向与向外的夹角余弦 {dot:F2}，冻风带 {(gust.Band ? "✓" : "✗")}，被推开 {Vector3.Distance(Flat(motor.transform.position), p0):F1} m，" +
                 $"下扇 {gust.Flaps} 下（K 路：每一下一圈风环，出手 3.4 s 里应 ≥ 5 下），首领顿帧累计 {boss.ImpactHolds} 次");
            if (gust.Pushes < 5) Fail($"扇翼狂风只推了 {gust.Pushes} 下");
            if (gust.Flaps < 5) Fail($"扇翼狂风只下扇了 {gust.Flaps} 下（flap 事件 / 周期兜底都没跟上）");
            else if (dot < 0.5f) Fail("扇翼狂风没把玩家往外缘推");
            if (!gust.Band) Fail("扇翼狂风没有放冻风带");
        }

        // ───────────── 鹏的招 ─────────────

        IEnumerator PengMoves()
        {
            var h = boss.Hole;
            // 俯冲掠台 · 开阔处：玩家站在两柱正中间（正北 / 正南，离圆心 24 m：切线离最近的冰柱、矮墙都在 4 m 以上），线上没有陡面——不撞柱、贴地掠过
            yield return WaitIdle();
            Place(Ring(Mathf.Abs(Mathf.DeltaAngle(h.Angle(boss.transform.position), 0f)) > 90f ? 0f : 180f, h.radius + 9f));
            var swoop = boss.MoveById(PengSwoop.MoveId) as PengSwoop;
            yield return OneMove(swoop, null, true);
            if (swoop != null)
            {
                Line($"  俯冲掠台 · 开阔处：{swoop.Dives} 趟，线长 {swoop.Length:F1} m{(swoop.Trimmed ? "（为玩家身后的陡面截短）" : "")}，线上陡面 {Meters(swoop.WallAt)}，" +
                     $"最低离地 {swoop.LowestAlt:F1} m，打中 {swoop.Hits} 下，撞柱 {(swoop.Crashed ? "✗ 是（硬直）" : "✓ 否")}");
                if (swoop.Dives < 1) Fail("俯冲掠台没有俯冲");
                if (swoop.Crashed) Fail("玩家站在开阔处，俯冲却撞柱硬直（撞柱只该在玩家躲到柱子后面时发生）");
                else if (!(swoop.LowestAlt < 2.5f)) Fail($"俯冲掠台没贴地（最低 {swoop.LowestAlt:F1} m）");
                if (swoop.Lured) Fail("玩家站在开阔处，瞄线时却算成了引撞（线上玩家之前有陡面）");
            }
            yield return PillarLureCase(h);
            yield return WaitIdle();

            var rain = boss.MoveById(PengFeatherRain.MoveId) as PengFeatherRain;
            int w0 = rain != null ? rain.Warned : 0;
            yield return OneMove(rain, null);
            if (rain != null)
            {
                Line($"  羽刃雨：{rain.Fired} / {rain.Count} 枚，落点预警 {rain.Warned - w0} 个");
                if (rain.Fired < rain.Count) Fail($"羽刃雨只洒了 {rain.Fired} 枚（应 {rain.Count}）");
                if (rain.Warned - w0 < rain.Count) Fail("羽刃雨不是每枚都有落点预警");
            }

            yield return WaitIdle();
            var perch = boss.MoveById(PengPerch.MoveId) as PengPerch;
            float restAlt = float.PositiveInfinity;
            yield return OneMove(perch, m =>
            {
                if (m.Stage == MoveStage.Active && m.StageT > 0.6f) restAlt = Mathf.Min(restAlt, boss.transform.position.y - (perch != null ? perch.Spot.y : h.FloorY));
            });
            if (perch != null)
            {
                float r = h.Distance(perch.Spot);
                Line($"  落台歇翼：落点 {At(perch.Spot)}（离圆心 {r:F1} m，平地 {(perch.SpotFlat ? "✓" : "否：落在台上")}），落地 {(perch.Landed ? "✓" : "✗")}，歇着时离落点 {restAlt:F2} m");
                if (!perch.Landed) Fail("落台歇翼没有落下");
                else if (!(restAlt < 0.6f)) Fail($"歇翼时没站在落点上（离落点 {restAlt:F2} m）");
                if (!(r > h.radius && r < h.outer)) Fail($"落点不在环台上（离圆心 {r:F1} m）");
                if (boss.MovesSincePerch != 0) Fail("落台歇翼后计数没清零");
            }
        }

        /// <summary>
        /// 俯冲掠台 · 柱后：玩家躲在离鹏最近的那根冰柱正后方（沿切线 5 m，柱子夹在玩家和鹏之间）——瞄线算成引撞，鹏照着玩家俯冲、先一头撞上柱子硬直，玩家不挨打。
        /// 鹏先摆到柱子那一侧的盘旋高度上（不然它此刻盘旋到哪一侧全凭运气）
        /// </summary>
        IEnumerator PillarLureCase(IceHoleInfo h)
        {
            yield return WaitIdle();
            var pillars = FindObjectsByType<Transform>(FindObjectsSortMode.None).Where(t => t && t.name.StartsWith("Ice Pillar", StringComparison.Ordinal)).ToList();
            if (pillars.Count == 0)
            {
                Line("场景里没有冰柱（Ice Pillar *）：跳过柱后引撞");
                yield break;
            }
            float birdAz = h.Angle(boss.transform.position);
            var pillar = pillars.OrderBy(t => Mathf.Abs(Mathf.DeltaAngle(h.Angle(t.position), birdAz))).First();
            float pAz = h.Angle(pillar.position), pR = h.Distance(pillar.position);
            float s = Mathf.DeltaAngle(pAz, birdAz) >= 0 ? 1f : -1f;
            const float behind = 10f;
            // 玩家方位 = 柱子背着鹏的一侧 10°，离圆心 pR·cos 10°：玩家的切线正好穿过柱心，柱子在玩家前方约 5 m
            Place(Ring(pAz - s * behind, pR * Mathf.Cos(behind * Mathf.Deg2Rad)));
            var bird = h.Point(pAz + s * 25f, h.MidRing);
            bird.y = h.FloorY + (boss.KDef != null ? boss.KDef.pengHover : 13.5f);
            boss.transform.position = bird;
            boss.SetFlyVelocity(Vector3.zero);
            var swoop = boss.MoveById(PengSwoop.MoveId) as PengSwoop;
            yield return OneMove(swoop, null, true);
            if (swoop == null) yield break;
            float gap = Vector3.Distance(Flat(pillar.position), Flat(motor.transform.position));
            Line($"  俯冲掠台 · 柱后（{pillar.name}，玩家离柱心 {gap:F1} m）：引撞 {(swoop.Lured ? "✓" : "✗")}，线上陡面 {Meters(swoop.WallAt)}，" +
                 $"撞柱 {(swoop.Crashed ? "✓ 硬直" : "✗ 没撞")}，打中 {swoop.Hits} 下");
            if (!swoop.Lured) Fail("玩家躲在冰柱正后方，瞄线时没算成引撞（俯冲线没穿过柱子）");
            if (!swoop.Crashed) Fail("玩家躲在冰柱正后方，鹏俯冲没有撞柱硬直");
            if (swoop.Hits > 0) Fail($"躲在柱后还被俯冲打中（{swoop.Hits} 下）");
        }

        static string Meters(float v) => float.IsFinite(v) ? $"{v:F1} m" : "无";

        // ───────────── 25%：鹏狂怒 ─────────────

        IEnumerator RageCase()
        {
            yield return WaitIdle();
            SetHealthFraction(KunPengDef.RageAt - 0.01f);
            float t0 = Time.time;
            while (!boss.Enraged && Time.time - t0 < 1f) yield return null;
            Line($"越过 25%：狂怒 {(boss.Enraged ? "✓" : "✗")}（{boss.EnrageReason}）");
            if (!boss.Enraged) Fail("生命层降到 24% 鹏没有狂怒");
            var swoop = boss.MoveById(PengSwoop.MoveId) as PengSwoop;
            Place(Ring(Mathf.Abs(Mathf.DeltaAngle(boss.Hole.Angle(boss.transform.position), 200f)) > 90f ? 200f : 20f, boss.Hole.MidRing));
            yield return OneMove(swoop, null, true);
            if (swoop != null)
            {
                Line($"  狂怒的俯冲：{swoop.Dives} 趟{(swoop.Crashed ? "（撞柱硬直，提前结束）" : "")}");
                if (!swoop.Crashed && swoop.Dives < 2) Fail($"狂怒的俯冲只掠了 {swoop.Dives} 趟（应 2 趟）");
            }
            var rain = boss.MoveById(PengFeatherRain.MoveId) as PengFeatherRain;
            yield return OneMove(rain, null);
            if (rain != null)
            {
                Line($"  狂怒的羽刃雨：{rain.Count} 枚");
                if (rain.Count != PengFeatherRain.RageFeathers) Fail($"狂怒的羽刃雨 {rain.Count} 枚（应 {PengFeatherRain.RageFeathers}）");
            }
        }

        // ───────────── 浸泡 ─────────────

        IEnumerator Soak()
        {
            var hp = boss.Health;
            SetHealthFraction(Mathf.Max(0.3f, hp.health / hp.maxHealth));
            var counts = new Dictionary<string, int>();
            void Count(BossBrain b, BossMove m) => counts[m.Id] = counts.TryGetValue(m.Id, out var n) ? n + 1 : 1;
            boss.MoveStarted += Count;
            int badFrames = 0, revives = 0;
            float maxOut = 0, stuck = 0, longest = 0, t0 = Time.time, nextMoveAt = 0, minAlt = float.PositiveInfinity, maxAlt = 0;
            BossMove last = null;
            string badWhat = null;
            var h = boss.Hole;
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
                    Place(Ring(UnityEngine.Random.Range(0f, 360f), UnityEngine.Random.Range(h.radius + 4f, h.outer - 4f)));
                }
                Aim(motor, eye, boss.BodyCenter);
                var p = boss.transform.position;
                if (!Finite(p) || !Finite(hp.health) || !Finite(hp.shield) || hp.health < 0 || hp.health > hp.maxHealth + 0.01f || hp.shield < 0 || hp.shield > hp.maxShield + 0.01f)
                {
                    badFrames++;
                    badWhat ??= $"位置 {p}，生命 {hp.health}/{hp.maxHealth}，护盾 {hp.shield}/{hp.maxShield}";
                }
                if (Finite(p) && !arena.Contains(p, 0)) maxOut = Mathf.Max(maxOut, h.Distance(p) - arena.Extent);
                minAlt = Mathf.Min(minAlt, p.y - h.FloorY);
                maxAlt = Mathf.Max(maxAlt, p.y - h.FloorY);
                if (boss.Current != null && boss.Current == last) stuck += Time.deltaTime;
                else stuck = 0;
                longest = Mathf.Max(longest, stuck);
                last = boss.Current;
                yield return null;
            }
            boss.MoveStarted -= Count;
            foreach (var id in counts.Keys) movesRun.Add(id);
            Line($"浸泡 {Time.time - t0:F0} s（阶段 {boss.Phase}，{boss.Form?.name}）：出招 {string.Join("、", counts.Select(kv => $"{kv.Key}×{kv.Value}"))}，最远出界 {maxOut:F1} m，" +
                 $"高度 {minAlt:F1}–{maxAlt:F1} m，单招最长 {longest:F1} s，数值异常 {badFrames} 帧，玩家倒下 {revives} 次");
            if (!boss || boss.Dead) Fail("浸泡期间首领死了 / 没了");
            if (badFrames > 0) Fail($"浸泡期间首领数值 / 位置非法 {badFrames} 帧（第一次：{badWhat}）");
            if (maxOut > 3f) Fail($"浸泡期间鹏飞出场地 {maxOut:F1} m");
            if (minAlt < -1f) Fail($"浸泡期间鹏钻到环台下面（{minAlt:F1} m）");
            if (longest > MoveTimeout) Fail($"浸泡期间有一招持续了 {longest:F1} s（卡住）");
            if (counts.Count < 2) Fail($"浸泡 {SoakSeconds:F0} s 只出过 {counts.Count} 种招（{string.Join("、", counts.Keys)}）");
        }

        // ───────────── 击杀 → 结算 ─────────────

        IEnumerator KillCase()
        {
            bossGuard?.Dispose();
            bossGuard = null;
            var hp = boss.Health;
            int defeated0 = defeatedEvents;
            vitals.health = vitals.MaxHealth * 0.3f;
            vitals.shield = 0;
            if (!Kill(boss)) yield return KillLoop(boss, 15f);
            if (!hp.Dead)
            {
                Fail("鲲鹏没被打死");
                yield break;
            }
            yield return null;
            var death = boss.GetComponent<KunPengDeath>();
            Line($"击杀：BossDefeated +{defeatedEvents - defeated0}，形态 {boss.Form?.name}，倒下演出 {(death ? "✓" : "✗")}");
            if (defeatedEvents - defeated0 != 1) Fail($"BossDefeated 派发了 {defeatedEvents - defeated0} 次（应 1 次）");
            if (!death) Fail("鲲鹏倒下没有倒下演出（KunPengDeath）");
            if (!enc)
            {
                Line("没有 BossEncounter：不查结算");
                yield break;
            }
            vitals.health = Mathf.Min(vitals.health, vitals.MaxHealth * 0.3f);
            float s0 = Time.time;
            while (enc.State != BossEncounter.Phase.Settled && Time.time - s0 < BossEncounter.SettleDelay + 3f) yield return null;
            yield return null;
            bool healed = vitals.health >= vitals.MaxHealth - 0.5f;
            var chest = enc.RewardChest;
            Line($"结算：{enc.State}（{Time.time - s0:F1} s），回满 {(healed ? "✓" : "✗")}，宝箱「{(chest ? chest.EffectiveReward : "（没有）")}」档位 {chest?.tier}，去向 {enc.Result}");
            if (enc.State != BossEncounter.Phase.Settled) Fail("鲲鹏倒下后没有结算");
            if (!healed) Fail("结算没有回满生命");
            if (!chest) Fail("结算没有落首领宝箱");
            else if (chest.tier != ChestTier.Boss) Fail($"首领宝箱档位 {chest.tier}（应为 Boss）");
            if (enc.Result != BossEncounter.Outcome.NextStage) Fail($"2-4 打完的去向是 {enc.Result}（应为下一关）");
            float o0 = Time.time;
            while (!enc.OpenedExit && Time.time - o0 < BossEncounter.PortalDelay + 2f) yield return null;
            Line($"出口：{(enc.OpenedExit ? $"✓ {enc.OpenedExit.name} @ {At(enc.OpenedExit.transform.position)}" : "✗ 没有升起")}");
            if (!enc.OpenedExit) Fail("结算后出口没有升起");
            else Aim(motor, eye, enc.OpenedExit.Focus);
            yield return new WaitForSeconds(0.5f);
            Shot(weapons.eye, "kunpeng_settled");
        }

        // ───────────── 冰窟：落水 ─────────────

        IEnumerator HoleFallCase()
        {
            var marker = IceHole.Find();
            var safe = SafeGround.Instance;
            if (!marker || !safe)
            {
                Line("场景里没有冰窟标记 / 玩家没有 SafeGround：跳过落水");
                yield break;
            }
            var h = marker.Info;
            var water = marker.water;
            if (vitals.Dead) vitals.Revive();
            vitals.Heal(99999);
            var stand = Ring(30f, h.MidRing);
            Place(stand);
            yield return new WaitForSeconds(0.8f);
            int drowned0 = WaterVolume.Drowned, rec0 = safe.Recoveries;
            float hp0 = vitals.health, sh0 = vitals.shield;
            // 扣血按受击事件记（护盾 + 生命一起算）；顺带记下落水前玩家身上的无敌 / 减伤 / 受伤修饰器，扣不到血时好查
            float taken = 0;
            int hitEvents = 0;
            void OnHit(in PlayerHitEvent e)
            {
                taken += e.toShield + e.toHp;
                hitEvents++;
            }
            string state = $"落水前：无敌 {(vitals.Invulnerable ? $"是（还剩 {vitals.invulnerableUntil - Time.time:F1} s）" : "否")}，减伤 {vitals.stats.Get(Stat.DamageReduction):P0}，受伤修饰器 {PlayerVitals.Incoming.Count} 个";
            GameEvents.PlayerHit += OnHit;
            var over = h.Point(30f, h.radius * 0.5f);
            over.y = h.waterY + 0.4f;
            Place(over);
            float t0 = Time.time;
            while (WaterVolume.Drowned == drowned0 && Time.time - t0 < 3f) yield return null;
            yield return new WaitForSeconds(0.3f);
            GameEvents.PlayerHit -= OnHit;
            var after = motor.transform.position;
            bool back = h.Distance(after) > h.radius;
            float lost = hp0 + sh0 - vitals.health - vitals.shield;
            Line($"冰窟落水：托回 {(WaterVolume.Drowned > drowned0 ? "✓" : "✗")}（SafeGround +{safe.Recoveries - rec0}），受击 {hitEvents} 次共 {taken:F0}（生命 + 护盾少了 {lost:F0}，" +
                 $"应为最大生命的 {(water ? water.drownBurst : 0):P0} = {vitals.MaxHealth * (water ? water.drownBurst : 0):F0}），回到 {At(after)}（{(back ? "环台上 ✓" : "还在冰窟上 ✗")}）；{state}");
            if (WaterVolume.Drowned == drowned0) Fail("掉进冰窟的深水没有托回");
            if (!(taken > 0) && !(lost > 0.5f)) Fail($"掉进冰窟没有扣血（{state}）");
            if (!back) Fail("托回点还在冰窟上空");
        }

        // ───────────── 四种代理 ─────────────

        IEnumerator ProxyCases()
        {
            if (!arena) yield break;
            yield return ProxyCase("代理模型（冰鲸 / 三青鸟）", () =>
            {
                var d = new KunPengDef();
                foreach (var f in d.forms) f.prefab = "";
                return d;
            }, null, false, BossModelSource.Proxy);
            yield return ProxyCase("占位胶囊", () =>
            {
                var d = new KunPengDef();
                foreach (var f in d.forms) f.prefab = f.proxyPrefab = "";
                return d;
            }, null, false, BossModelSource.Placeholder);
            yield return ProxyCase("没有冰窟标记（虚拟冰窟）", () => new KunPengDef(), null, true, null);
            yield return ProxyCase("动作片段缺失（Animator 关掉）", () => new KunPengDef(), b =>
            {
                foreach (var a in b.GetComponentsInChildren<Animator>(true)) a.enabled = false;
            }, false, null);
        }

        IEnumerator ProxyCase(string label, Func<KunPengDef> make, Action<KunPengBrain> after, bool hideMarker, BossModelSource? expect)
        {
            var marker = IceHole.Find();
            if (hideMarker && marker) marker.gameObject.SetActive(false);
            int err0 = logErrors;
            var def = make();
            var b = Bosses.Spawn(def, arena.BossSpawnPoint, arena.BossSpawnRotation, KunPengDef.StageDifficulty, arena) as KunPengBrain;
            if (!b)
            {
                Fail($"代理「{label}」：生成失败");
                if (hideMarker && marker) marker.gameObject.SetActive(true);
                yield break;
            }
            after?.Invoke(b);
            var guard = b.Health.Incoming.Add((in IncomingHit h) => 0f);
            var notes = new List<string> { $"鲲 {Source(b.Model)}", b.Hole.found ? "冰窟标记" : "虚拟冰窟" };
            Place(Ring(b.Theta, b.Hole.radius + 10f));
            float t0 = Time.time;
            while (!b.IntroDone && Time.time - t0 < def.intro.seconds + 3f) yield return null;
            if (!b.IntroDone) Fail($"代理「{label}」：登场没有结束");
            if (expect.HasValue && b.Model?.source != expect) Fail($"代理「{label}」：鲲的模型来源 {b.Model?.source}（应为 {expect}）");
            if (hideMarker && b.Hole.found) Fail($"代理「{label}」：藏起冰窟标记后仍说找到了冰窟");
            float worstCut = float.NegativeInfinity;
            int ended = 0, forced = 0;
            foreach (var id in new[] { KunSlam.MoveId, KunInhale.MoveId })
            {
                var r = new MoveRun();
                yield return Force(b, id, r, () => worstCut = Mathf.Max(worstCut, b.CutTop));
                forced++;
                if (r.ended) ended++;
            }
            notes.Add($"片段带宿主运动 {b.BakedHost}，切口最高 {worstCut:F2} m");
            if (!(worstCut < 0)) Fail($"代理「{label}」：鲲的平切口露出水面（{worstCut:F2} m）");
            b.Health.shield = 0;
            b.Health.health = b.Health.maxHealth * 0.48f;
            float s0 = Time.time;
            while ((!b.IsPeng || b.Transitioning) && Time.time - s0 < 9f && !b.Dead) yield return null;
            var body = b.GetComponent<EnemyBody>();
            bool rebound = body && b.Model != null && body.Animator == b.Model.animator;
            notes.Add($"鹏 {Source(b.Model)}，离环台 {b.transform.position.y - b.Hole.FloorY:F1} m，Animator 重绑 {rebound}");
            if (!b.IsPeng) Fail($"代理「{label}」：强制越过 50% 没有化鹏");
            foreach (var id in new[] { PengSwoop.MoveId, PengGust.MoveId })
            {
                var r = new MoveRun();
                yield return Force(b, id, r, null);
                forced++;
                if (r.ended) ended++;
            }
            guard.Dispose();
            if (!Kill(b)) yield return KillLoop(b, 8f);
            notes.Add($"招式 {ended}/{forced} 收招，倒下 {(b.Dead ? "✓" : "✗")}，新增报错 {logErrors - err0}");
            Line($"代理「{label}」：{string.Join("；", notes)}");
            if (ended < forced) Fail($"代理「{label}」：有招式没收招（{ended}/{forced}）");
            if (!b.Dead) Fail($"代理「{label}」：没被打死");
            yield return new WaitForSeconds(def.defeat.seconds + 0.5f);
            if (b) Destroy(b.gameObject);
            if (hideMarker && marker) marker.gameObject.SetActive(true);
            yield return null;
        }

        sealed class MoveRun
        {
            public bool started, ended;
        }

        /// <summary>代理测试用：等招式间隙、强制出招、跑到结束（被打断 / 撞柱硬直也算结束）</summary>
        IEnumerator Force(KunPengBrain b, string id, MoveRun r, Action tick)
        {
            float t0 = Time.time;
            while (b && !b.Dead && (b.Current != null || b.Transitioning || b.Staggered) && Time.time - t0 < MoveTimeout) yield return null;
            var m = b ? b.MoveById(id) : null;
            if (m == null) yield break;
            t0 = Time.time;
            while (!(r.started = b.ForceMove(id)) && Time.time - t0 < 5f) yield return null;
            if (!r.started) yield break;
            while (b && !b.Dead && b.Current == m && Time.time - t0 < MoveTimeout)
            {
                KeepPlayerAlive();
                tick?.Invoke();
                yield return null;
            }
            r.ended = b && b.Current != m;
        }

        // ───────────── 单招 ─────────────

        /// <summary>
        /// 强制出一招并跑到结束：走到出手、正常收招、画过预警、出招中霸体（每帧回调 tick）。
        /// mayCrash = 俯冲掠台：撞柱硬直会打断招式，算正常结束
        /// </summary>
        IEnumerator OneMove(BossMove move, Action<BossMove> tick, bool mayCrash = false)
        {
            if (move == null)
            {
                Fail("招式不存在");
                yield break;
            }
            yield return WaitIdle();
            KeepPlayerAlive();
            yield return null;
            var km = move as KunPengMove;
            int warn0 = km != null ? km.Warned : move.TelegraphCount, act0 = move.TimesActive, acts0 = boss.ActsFired;
            float t0 = Time.time;
            bool forced = false;
            while (!(forced = boss.ForceMove(move.Id)) && Time.time - t0 < 5f) yield return null;
            if (!forced)
            {
                Fail($"招式 {move.Id}：强制出招失败（转换 / 硬直 / 登场中？）");
                yield break;
            }
            movesRun.Add(move.Id);
            var stages = new List<MoveStage>();
            bool immune = true, shot = false;
            string act = null;
            while (boss && !boss.Dead && boss.Current == move && Time.time - t0 < MoveTimeout)
            {
                if (stages.Count == 0 || stages[^1] != move.Stage) stages.Add(move.Stage);
                if (!boss.StunImmune) immune = false;
                if (boss.ActsFired > acts0) act ??= $"{boss.LastAct}（{boss.LastActPath}）";
                tick?.Invoke(move);
                KeepPlayerAlive();
                Aim(motor, eye, boss.BodyCenter);
                if (!shot && move.Stage == MoveStage.Active)
                {
                    shot = true;
                    yield return null;
                    Shot(weapons.eye, $"kunpeng_move_{move.Id}");
                }
                yield return null;
            }
            bool ended = boss.Current != move;
            int warned = (km != null ? km.Warned : move.TelegraphCount) - warn0;
            bool crashed = mayCrash && move.Cancelled && boss.Staggered;
            Line($"招式 {move.Name}（{move.Id}）：{string.Join("→", stages)}，{(ended ? $"{Time.time - t0:F1} s 收招" : "✗ 超时")}{(move.Cancelled ? crashed ? "（撞柱硬直）" : "（被打断）" : "")}，" +
                 $"前摇 {move.WindupTime:F2} s，预警 {warned} 个，动作 {act ?? "（没触发）"}，出招中霸体 {(immune ? "✓" : "✗")}");
            if (!ended) Fail($"招式 {move.Id} {MoveTimeout:F0} s 没有结束（卡在 {move.Stage}）");
            if (move.TimesActive <= act0) Fail($"招式 {move.Id} 没有走到出手段");
            if (move.Cancelled && !crashed) Fail($"招式 {move.Id} 被打断了（没有外力时应正常收招）");
            if (warned <= 0) Fail($"招式 {move.Id} 没有画预警");
            if (!immune) Fail($"招式 {move.Id} 出招中可以被眩晕（霸体）");
            if (act == null) Fail($"招式 {move.Id} 没有播动作（KunPengBrain.Act 没被调用）");
            if (crashed)
            {
                float s0 = Time.time;
                while (boss.Staggered && Time.time - s0 < 3f) yield return null;
            }
        }

        // ───────────── 工具 ─────────────

        /// <summary>等首领回到招式间隙（不在出招、转换、硬直里）</summary>
        IEnumerator WaitIdle()
        {
            float t0 = Time.time;
            while (boss && !boss.Dead && (boss.Current != null || boss.Transitioning || boss.Staggered) && Time.time - t0 < MoveTimeout) yield return null;
        }

        void SetHealthFraction(float fraction)
        {
            var hp = boss.Health;
            hp.health = Mathf.Clamp(hp.maxHealth * fraction, 1f, hp.maxHealth);
        }

        /// <summary>环台上某方位、离冰窟圆心 r 米的点，贴到导航网格</summary>
        Vector3 Ring(float yawDeg, float r)
        {
            var h = boss ? boss.Hole : IceHole.Find() is { } m ? m.Info : IceHoleInfo.Fallback(arena, arena ? arena.Center : Vector3.zero);
            return Snap(h.Point(yawDeg, r) + Vector3.up * 0.5f);
        }

        static Vector3 Snap(Vector3 p) => NavMesh.SamplePosition(p, out var hit, 4f, NavMesh.AllAreas) ? hit.position : p;

        /// <summary>把玩家放到某点（不从上往下打射线）；脚下的速度清零</summary>
        void Place(Vector3 p)
        {
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p + Vector3.up * 0.05f;
            if (cc) cc.enabled = true;
            Physics.SyncTransforms();
        }

        /// <summary>一刀 99999（不暴击）；打不动（不可选中）返回 false</summary>
        static bool Kill(BossBrain b)
        {
            var hp = b.Health;
            if (!hp || hp.Dead || hp.untargetable) return hp && hp.Dead;
            var info = DamageInfo.Simple(99999f, DamageSource.Weapon, b.BodyCenter, Vector3.forward);
            info.noCrit = true;
            Combat.DamageEnemy(hp, info);
            return hp.Dead;
        }

        IEnumerator KillLoop(BossBrain b, float timeout)
        {
            float t0 = Time.time;
            while (b && !b.Health.Dead && Time.time - t0 < timeout)
            {
                Kill(b);
                if (vitals.Dead) vitals.Revive();
                yield return null;
            }
        }

        void KeepPlayerAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
        }

        static string Source(BossModel m) => m == null ? "（没有模型）" : m.source switch
        {
            BossModelSource.Art => $"美术 {m.prefab} × {m.scale}",
            BossModelSource.Proxy => $"代理 {m.prefab} × {m.scale}",
            _ => $"占位胶囊 × {m.scale}",
        };

        static string At(Vector3 p) => $"({p.x:F0}, {p.y:F1}, {p.z:F0})";
        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);
        static bool Finite(float v) => float.IsFinite(v);
        static bool Finite(Vector3 v) => float.IsFinite(v.x) && float.IsFinite(v.y) && float.IsFinite(v.z);
    }
}
