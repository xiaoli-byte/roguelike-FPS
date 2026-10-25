using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.SceneManagement;
using static UnityEngine.Object;
using Random = UnityEngine.Random;

namespace Spiritfire.Game.Testing
{
    /// <summary>整局冒烟里一关的成绩（<see cref="RunBot"/> 逐关记，<see cref="RunRelay"/> 跨分段带着走，最后汇总成整局报告）</summary>
    [Serializable]
    public sealed class StageRecord
    {
        public string code, title;
        /// <summary>从新关卡就绪到本关结算（真实秒 / 游戏秒）；首领战（开战到倒下，游戏秒）；换进这一关花的真实秒</summary>
        public float realSeconds, gameSeconds, bossSeconds, loadSeconds;
        /// <summary>帧时 P95（毫秒，不缩放时间）</summary>
        public float frameP95Ms;
        /// <summary>倒下（致命一击被测试拦下、回满继续）次数</summary>
        public int downs;
        /// <summary>本关灵石：进账、花掉、结算时余额；本关魂晶进账</summary>
        public int income, spent, coinsEnd, essence;
        public int kills, executed, chests, bought, scrolls, sitesCleared, sitesRequired, placeholders, bossPhases;
        public float pathMeters;
        public List<string> weapons = new();
        public List<string> notes = new();
        public bool completed;

        public string Weapons => weapons.Count > 0 ? string.Join(" / ", weapons) : "—";
    }

    /// <summary>
    /// 整局冒烟的机器人（I2，docs/unity-parity.md 7.5；套件 <see cref="FullRunSuite"/>）：一关从「新关卡就绪」打到「本关结算」——
    ///   开放图：按关卡目标（<see cref="LevelObjective"/>）挑「前置已满足、离得最近」的必清场地，沿 NavMesh 算好路径后直接传送到场地中心（走路的可达性由各张图的
    ///     map-* 套件验，这里只记路径是否完整、多长），等它开战；交战时瞄最近的敌人射击、隔 4 s 放技能，远了 / 被挡住就换到看得见的位置，
    ///     打不动（格挡 / 霸体）3 s 就绕背；肃清后等掉落吸过来、开场地宝箱（秘卷三选一选第一项，枪 / 灵宠封印比手上的好就捡）。
    ///     卡住的必清场地：先找能放开它的机关（3-3 风闸），再强制开战（记一条）。
    ///   首领：首领场（BossEncounter）走到入场点开战（登场演出关掉），盯着首领打（首领不可选中时清小怪），倒下 → 结算 → 开首领宝箱 → 出口 / 胜利。
    ///   补给营（RunPlan 标了的关）：在营地商店买一件（秘卷 → 强化 → 武器 → 药剂 → 弹药，买得起的第一样）。
    ///   出口：等升起、开清关宝箱、站到门前按 F → 本关结算。
    /// 测试加速（只在整局冒烟里装，<see cref="Install"/> / <see cref="Uninstall"/>）：
    ///   · 玩家伤害 × <see cref="DamageMult"/>（Combat.Outgoing 修饰器）；打首领不加速（× <see cref="BossDamageMult"/>）：阶段转换、不可选中窗口、招式都按真实血量走一遍，首领用时有参考价值；
    ///   · 游戏时间 × <see cref="TimeScale"/>（TimeScaleArbiter 低优先级请求，暂停 / 模态 / 换关 / 顿帧都压过它）；
    ///   · 登场演出关掉（BossIntroDirector.Policy = Never）；
    ///   · 打不死兜底：致命一击被拦下、回满并记一次「倒下」（真实生命值照常扣，倒下次数如实报告；不拦的话这一局就结算了，后面的关测不到）；
    ///   · 弹药不缺（每帧补满备弹）；一处场地 <see cref="FightLimit"/> / 首领 <see cref="BossLimit"/> 游戏秒没打完就补刀并记一条。
    /// </summary>
    public sealed class RunBot
    {
        public const float DamageMult = 6f, BossDamageMult = 1f, TimeScale = 4f, FightLimit = 60f, BossLimit = 150f;
        const int SpeedPriority = 50;
        const float EyeHeight = 1.62f;

        readonly Action<string> line, fail;
        readonly Action<Camera, string> shot;
        readonly MonoBehaviour host;

        PlayerRig rig;
        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        Interactor interactor;
        HeroSkills skills;
        Transform eye;

        IDisposable damageMod, downMod;
        TimeScaleArbiter.Handle speed;
        readonly object speedOwner = new();
        bool installed, sampling;
        readonly List<float> frames = new();
        readonly HashSet<string> placeholderEnemies = new();
        readonly HashSet<EncounterSite> failedSites = new();
        int maxPhase;
        float graceUntil;

        /// <summary>正在记的这一关</summary>
        public StageRecord Record { get; private set; }

        /// <summary>整局倒下合计</summary>
        public int TotalDowns { get; private set; }

        public RunBot(MonoBehaviour host, Action<string> line, Action<string> fail, Action<Camera, string> shot)
        {
            this.host = host;
            this.line = line;
            this.fail = fail;
            this.shot = shot;
        }

        // ───────────── 加速 / 兜底 ─────────────

        public void Install()
        {
            if (installed) return;
            installed = true;
            damageMod = Combat.Outgoing.Add((in HitContext c) => c.target && c.target.rank == Rank.Boss ? BossDamageMult : DamageMult);
            downMod = PlayerVitals.Incoming.Add(OnIncoming, 1000);
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            RunEnd.ShowDuringTests = true;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            GameEvents.CoinsChanged += OnCoins;
            GameEvents.EssenceChanged += OnEssence;
            EncounterSite.AnySpawned += OnSpawned;
            Application.logMessageReceived += OnLog;
            host.StartCoroutine(SampleFrames());
            EnsureSpeed();
        }

        public void Uninstall()
        {
            if (!installed) return;
            installed = false;
            damageMod?.Dispose();
            damageMod = null;
            downMod?.Dispose();
            downMod = null;
            BossIntroDirector.Policy = BossIntroPolicy.Auto;
            RunEnd.ShowDuringTests = false;
            GameEvents.CoinsChanged -= OnCoins;
            GameEvents.EssenceChanged -= OnEssence;
            EncounterSite.AnySpawned -= OnSpawned;
            Application.logMessageReceived -= OnLog;
            speed?.Dispose();
            speed = null;
            if (weapons) weapons.testFire = false;
            if (interactor) interactor.testInteract = false;
        }

        /// <summary>× TimeScale 的请求还在（Core 场景加载时 GameSession 会清空全部时间请求，这里补回来）</summary>
        public void EnsureSpeed()
        {
            if (!installed) return;
            if (speed == null || !speed.Live) speed = TimeScaleArbiter.Request(speedOwner, TimeScale, SpeedPriority);
        }

        /// <summary>致命一击：拦下、回满、记一次倒下（之后 2 s 无敌，免得同一串伤害连记几次）</summary>
        float OnIncoming(in IncomingHit h)
        {
            var pv = PlayerVitals.Instance;
            if (!installed || !pv || pv.Dead) return 1;
            if (Time.time < graceUntil) return 0;
            if (h.amount < pv.health + pv.shield - 0.01f) return 1;
            TotalDowns++;
            if (Record != null) Record.downs++;
            graceUntil = Time.time + 2f;
            pv.Heal(pv.MaxHealth);
            pv.AddShield(pv.MaxShield);
            return 0;
        }

        void OnCoins(int delta, int total)
        {
            if (Record == null) return;
            if (delta > 0) Record.income += delta;
            else Record.spent -= delta;
        }

        void OnEssence(int delta, int total)
        {
            if (Record != null && delta > 0) Record.essence += delta;
        }

        void OnSpawned(EncounterSite site, EncounterSite.SpawnRecord r)
        {
            if (r.ai && r.ai.GetComponentInChildren<PlaceholderBody>(true)) placeholderEnemies.Add(r.id);
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (Record != null && type is LogType.Exception or LogType.Error && Record.notes.Count < 40) Record.notes.Add($"运行时{type}：{msg}");
        }

        IEnumerator SampleFrames()
        {
            while (installed)
            {
                var flow = SceneFlow.Instance;
                if (sampling && flow && !flow.Busy && Time.timeScale > 0) frames.Add(Time.unscaledDeltaTime * 1000f);
                yield return null;
            }
        }

        static float P95(List<float> v)
        {
            if (v.Count == 0) return 0;
            var s = v.OrderBy(x => x).ToList();
            return s[Mathf.Clamp(Mathf.CeilToInt(s.Count * 0.95f) - 1, 0, s.Count - 1)];
        }

        void Note(string s)
        {
            line("  ⚠ " + s);
            Record?.notes.Add(s);
        }

        // ───────────── 一关 ─────────────

        /// <summary>
        /// 打一关：从新关卡就绪（SceneFlow 不忙、玩家已组装）到本关结算（会话 Completed）。最后一关停在胜利结算之前（结算由套件等）。
        /// 结果记在 <see cref="Record"/>（调用前由套件 <see cref="Begin"/>）
        /// </summary>
        public IEnumerator PlayStage(StageSpec stage)
        {
            var flow = SceneFlow.Instance;
            Bind(flow.Player);
            if (rig == null)
            {
                fail($"{stage.Label}：没有玩家");
                yield break;
            }
            EnsureSpeed();
            sampling = true;
            frames.Clear();
            failedSites.Clear();
            SetOrigin();
            float real0 = Time.realtimeSinceStartup, game0 = Time.time;
            int kills0 = RunState.Current?.kills ?? 0;
            var scene = flow.CurrentScene;
            CheckScene(stage, scene);

            var objective = LevelObjective.For(scene);
            var enc = FindInScene<BossEncounter>(scene);
            var camp = FindInScene<SupplyCamp>(scene);

            // 补给营在首领场门槛外（2-4 / 3-4）：开打前先逛店；在开放图里（1-3）：清完场地再逛
            if (camp && enc && !objective) yield return Shop(camp);
            if (objective) yield return ClearObjective(objective);
            if (camp && (objective || !enc)) yield return Shop(camp);
            if (enc) yield return FightBoss(enc, stage);

            if (!(GameSession.Instance && GameSession.Instance.Completed))
            {
                // 首领关的胜利链会自己结算（BossEncounter.FinishRun）；其余走出口
                bool victory = enc && enc.State == BossEncounter.Phase.Settled && enc.Result == BossEncounter.Outcome.Victory;
                if (victory) yield return WaitVictory();
                else yield return Exit(enc ? enc.OpenedExit : null, objective);
            }

            sampling = false;
            var r = Record;
            if (r != null)
            {
                r.realSeconds = Time.realtimeSinceStartup - real0;
                r.gameSeconds = Time.time - game0;
                r.frameP95Ms = P95(frames);
                r.kills = (RunState.Current?.kills ?? kills0) - kills0;
                r.coinsEnd = RunState.Current?.coins ?? 0;
                r.completed = GameSession.Instance && GameSession.Instance.Completed;
                var inv = LootDirector.Instance ? LootDirector.Instance.scrolls : null;
                r.scrolls = inv?.TotalStacks ?? 0;
                r.weapons.Clear();
                if (weapons)
                    foreach (var w in weapons.slots)
                        if (w != null)
                            r.weapons.Add($"{w.def.name}（{Rarity.Name(w.rarity)} +{w.level}）");
                if (placeholderEnemies.Count > 0) r.notes.Add($"占位体敌人：{string.Join("、", placeholderEnemies)}");
                placeholderEnemies.Clear();
            }
            if (weapons) weapons.testFire = false;
        }

        /// <summary>开始记一关</summary>
        public StageRecord Begin(StageSpec stage, float loadSeconds)
        {
            Record = new StageRecord { code = stage.code, title = stage.title, loadSeconds = loadSeconds };
            return Record;
        }

        void Bind(PlayerRig p)
        {
            rig = p;
            if (p == null) return;
            motor = p.motor;
            vitals = p.vitals;
            weapons = p.weapons;
            interactor = p.interactor;
            skills = p.skills;
            eye = weapons && weapons.eye ? weapons.eye.transform : p.eye;
        }

        static T FindInScene<T>(Scene scene) where T : Component
        {
            foreach (var c in FindObjectsByType<T>(FindObjectsInactive.Include))
                if (c && c.gameObject.scene == scene) return c;
            return null;
        }

        /// <summary>关卡静态检查：补给营与 RunPlan 一致、占位件清单</summary>
        void CheckScene(StageSpec stage, Scene scene)
        {
            bool hasCamp = FindInScene<SupplyCamp>(scene);
            if (hasCamp != stage.supplyCamp) fail($"{stage.Label}：场景里{(hasCamp ? "有" : "没有")}补给营，RunPlan 写的是{(stage.supplyCamp ? "有" : "没有")}");
            GameObject[] tagged;
            try { tagged = GameObject.FindGameObjectsWithTag("Placeholder"); }
            catch (UnityException) { tagged = Array.Empty<GameObject>(); }
            var mine = tagged.Where(g => g.scene == scene).ToList();
            if (Record != null) Record.placeholders = mine.Count;
            if (mine.Count > 0)
                Note($"占位件 {mine.Count} 个：{string.Join("、", mine.Take(6).Select(g => g.name))}{(mine.Count > 6 ? " …" : "")}");
        }

        // ───────────── 关卡目标 ─────────────

        IEnumerator ClearObjective(LevelObjective objective)
        {
            if (Record != null) Record.sitesRequired = objective.RequiredTotal;
            int guard = 0;
            while (!objective.Complete && guard++ < 24)
            {
                var pending = objective.required.Where(s => s && s.phase != EncounterSite.Phase.Cleared).ToList();
                if (pending.Count == 0)
                {
                    objective.Refresh(false);
                    yield return null;
                    break;
                }
                var active = pending.FirstOrDefault(s => s.phase == EncounterSite.Phase.Active);
                if (active && failedSites.Contains(active))
                {
                    fail($"「{active.title}」打了两轮都没肃清，这一关停在这里");
                    yield break;
                }
                if (active)
                {
                    yield return FightSite(active);
                    continue;
                }
                var ready = pending.Where(s => s.RequirementsMet() && s.autoTrigger).ToList();
                if (ready.Count == 0)
                {
                    var gate = FoundryWindGate.All.FirstOrDefault(g => g && g.Phase == FoundryWindGate.State.Ready && pending.Contains(g.secondVisit));
                    if (gate)
                    {
                        yield return UseGate(gate);
                        continue;
                    }
                    var stuck = pending.FirstOrDefault(s => s.RequirementsMet());
                    if (stuck)
                    {
                        Note($"「{stuck.title}」不会自动触发、也没找到放开它的机关：强制开战");
                        yield return Go(stuck.transform.position, stuck.title);
                        stuck.Activate();
                        yield return FightSite(stuck);
                        continue;
                    }
                    fail($"必清场地都卡着：{string.Join("、", pending.Select(s => $"{s.title}（{s.phase}，前置 {string.Join("/", s.requires.Where(q => q).Select(q => $"{q.title}:{q.phase}"))}）"))}");
                    yield break;
                }
                var here = motor.transform.position;
                var next = ready.OrderBy(s => Flat(s.transform.position - here).magnitude).First();
                yield return Engage(next);
            }
            // 灵火坛（N 选 M）：还差几座就点最近的
            if (objective.AltarsNeeded > objective.AltarsLit)
                foreach (var a in objective.altars.Where(a => a && !a.Lit).OrderBy(a => Flat(a.transform.position - motor.transform.position).magnitude).ToList())
                {
                    if (objective.AltarsLit >= objective.AltarsNeeded) break;
                    yield return Go(a.transform.position + a.transform.forward * 2f, a.title);
                    a.Light();
                    yield return new WaitForSeconds(0.3f);
                }
            float t0 = Time.time;
            while (!objective.Complete && Time.time - t0 < 3f) yield return null;
            if (Record != null) Record.sitesCleared = objective.RequiredCleared;
            line($"  目标：{(objective.Complete ? "完成" : objective.Describe())}（必清 {objective.RequiredCleared}/{objective.RequiredTotal}，可选 {objective.OptionalCleared}/{objective.optional.Length}）");
            if (!objective.Complete) fail($"关卡目标没有完成：{objective.Describe()}");
        }

        IEnumerator UseGate(FoundryWindGate gate)
        {
            line($"  机关：{gate.name}（{gate.Prompt}）");
            yield return Go(gate.transform.position - gate.transform.forward * 2.2f, gate.name);
            Aim(gate.Focus);
            yield return new WaitForSeconds(0.2f);
            if (interactor.Current as FoundryWindGate == gate) interactor.testInteract = true;
            else
            {
                Note($"站在 {gate.name} 前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）：直接拉");
                gate.Pull();
            }
            float t0 = Time.time;
            while (gate.Phase != FoundryWindGate.State.Pulled && Time.time - t0 < 2f) yield return null;
            if (gate.Phase != FoundryWindGate.State.Pulled)
            {
                gate.Pull(true);
                Note($"{gate.name} 按 F 没拉开，强制拉开");
            }
            yield return new WaitForSeconds(0.5f);
        }

        /// <summary>传送到场地中心等它开战（3 次：中心 → 中心旁看得见站位的地方 → 强制），打完开宝箱</summary>
        IEnumerator Engage(EncounterSite site)
        {
            line($"  ── {site.title} ──");
            for (int attempt = 0; attempt < 2 && site.phase == EncounterSite.Phase.Idle; attempt++)
            {
                var spot = site.transform.position;
                if (attempt == 1)
                {
                    var a = Random.value * Mathf.PI * 2;
                    spot += new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Mathf.Min(6f, site.triggerRadius * 0.4f);
                }
                yield return Go(spot, site.title);
                float t0 = Time.time;
                while (site.phase == EncounterSite.Phase.Idle && Time.time - t0 < 2.5f)
                {
                    // 别的场地先开战了（站位踩进了它的触发圈）：先打它
                    var other = EncounterSite.ActiveSites.FirstOrDefault(s => s && s != site);
                    if (other)
                    {
                        line($"  「{other.title}」先开战了，先打它");
                        yield return FightSite(other);
                        t0 = Time.time;
                    }
                    yield return null;
                }
            }
            if (site.phase == EncounterSite.Phase.Idle)
            {
                Note($"「{site.title}」站到中心也没开战（前置满足 {site.RequirementsMet()}，场上交战中 {EncounterSite.ActiveSites.Count} 处）：强制开战");
                site.Activate();
            }
            yield return FightSite(site);
        }

        IEnumerator FightSite(EncounterSite site)
        {
            float t0 = Time.time;
            int exec0 = Record?.executed ?? 0;
            yield return Fight(() => site.phase == EncounterSite.Phase.Cleared && EncounterSite.ActiveSites.Count == 0,
                site.transform.position, FightLimit, site.title, null, site);
            bool cleared = site.phase == EncounterSite.Phase.Cleared;
            line($"  「{site.title}」{(cleared ? "肃清" : "没打完")}：{Time.time - t0:F0} 游戏秒，{site.Total} 只" +
                 ((Record?.executed ?? 0) > exec0 ? $"（补刀 {(Record?.executed ?? 0) - exec0}）" : ""));
            if (!cleared)
            {
                failedSites.Add(site);
                fail($"「{site.title}」没有肃清（剩 {site.Remaining}，排队 {site.PendingCount}，卡出生 {site.Stalled}，玩家离中心 {Flat(motor.transform.position - site.transform.position).magnitude:F0} m）");
                yield break;
            }
            // 掉落 0.8–1.2 s 后吸向玩家：等一会儿再走
            yield return new WaitForSeconds(1.8f);
            foreach (var c in FindObjectsByType<Chest>().Where(c => c && !c.Opened && Flat(c.transform.position - site.transform.position).magnitude < site.arenaRadius + 6f).ToList())
                yield return OpenChest(c, $"{site.title}宝箱");
        }

        // ───────────── 交战 ─────────────

        /// <summary>
        /// 交战循环：瞄最近的敌人（boss 优先，它不可选中时打别的）射击；远了 / 被挡住换位置；3 s 打不掉血就绕背；隔 4 s 放技能。
        /// 超过 limit 游戏秒：把场上活着的敌人补刀（首领用 99999 一刀）并记一条
        /// </summary>
        IEnumerator Fight(Func<bool> done, Vector3 anchor, float limit, string label, BossBrain boss, EncounterSite site = null)
        {
            float t0 = Time.time, skillAt = t0 + 1f, moveAt = 0, leashAt = 0;
            float leash = site ? Mathf.Max(8f, site.arenaRadius * 0.6f) : 30f;
            Damageable last = null;
            float lastHp = 0, lastHpAt = t0;
            maxPhase = 0;
            bool shotTaken = false, overtime = false;
            while (!done())
            {
                EnsureSpeed();
                HandleModals();
                if (boss && !boss.Dead) maxPhase = Mathf.Max(maxPhase, boss.Phase);
                if (vitals.Dead)
                {
                    fail($"{label}：玩家阵亡了（倒下兜底没拦住）");
                    vitals.Revive();
                }
                var w = weapons.Active;
                if (w != null && w.reserve < w.def.reserve) w.reserve = w.def.reserve;
                // 场地还有没出生的（出生点按玩家位置挑：离场地太远就挑不出来，会一直卡着）：回场地中心
                if (site && site.phase == EncounterSite.Phase.Active && site.PendingCount > 0 && Time.time >= leashAt &&
                    (site.Stalled || PickTarget(boss) == null) && Flat(motor.transform.position - anchor).magnitude > leash)
                {
                    leashAt = Time.time + 2f;
                    moveAt = Time.time + 1f;
                    Place(anchor);
                }
                if (Time.time - t0 > limit)
                {
                    if (!overtime)
                    {
                        overtime = true;
                        var alive = EnemyAI.All.Where(e => e && !e.Dead).ToList();
                        Note($"{label}：{limit:F0} 游戏秒没打完，补刀（场上 {alive.Count} 只" +
                             (alive.Count > 0 ? $"：{string.Join("、", alive.Take(5).Select(e => $"{e.enemyId}{(e.Health && e.Health.untargetable ? "（不可选中）" : "")}@{Flat(e.transform.position - anchor).magnitude:F0}m"))}" : "") +
                             (site ? $"；场地剩 {site.Remaining}、排队 {site.PendingCount}、卡出生 {site.Stalled}" : "") +
                             $"；玩家离中心 {Flat(motor.transform.position - anchor).magnitude:F0} m）");
                    }
                    if (site && Time.time >= leashAt && Flat(motor.transform.position - anchor).magnitude > 4f)
                    {
                        leashAt = Time.time + 3f;
                        Place(anchor);
                    }
                    foreach (var e in EnemyAI.All.ToArray())
                        if (e && !e.Dead && e.Health)
                        {
                            if (e is BossBrain b) KillBoss(b);
                            else
                            {
                                Combat.Execute(e.Health, true);
                                if (Record != null) Record.executed++;
                            }
                        }
                    if (Time.time - t0 > limit + 15f)
                    {
                        fail($"{label}：补刀 15 s 后还没结束");
                        break;
                    }
                    yield return null;
                    continue;
                }
                var target = PickTarget(boss);
                if (!target)
                {
                    weapons.testFire = false;
                    // 场上没敌人（下一波还没到）：离场地远了就回去
                    if (Flat(motor.transform.position - anchor).magnitude > leash && Time.time >= moveAt)
                    {
                        moveAt = Time.time + 2f;
                        Place(anchor);
                    }
                    yield return null;
                    continue;
                }
                var aim = AimPoint(target);
                Aim(aim);
                if (target != last)
                {
                    last = target;
                    lastHp = target.health + target.armor + target.shield;
                    lastHpAt = Time.time;
                }
                else
                {
                    float hp = target.health + target.armor + target.shield;
                    if (hp < lastHp - 0.5f)
                    {
                        lastHp = hp;
                        lastHpAt = Time.time;
                    }
                }
                if (Time.time >= moveAt)
                {
                    float dist = Vector3.Distance(eye.position, aim);
                    bool blocked = Combat.Blocked(eye.position, aim, null);
                    if (dist > 24f || blocked)
                    {
                        moveAt = Time.time + 1.2f;
                        if (SightSpot(target, aim, 8f, 14f, out var spot, site ? anchor : (Vector3?)null, site ? site.arenaRadius : 0)) Place(spot);
                        else Place(Vector3.MoveTowards(motor.transform.position, target.transform.position, Mathf.Max(0, dist - 10f)));
                    }
                    else if (Time.time - lastHpAt > 3f)
                    {
                        // 正面格挡 / 甲壳 / 霸体：绕到背后
                        moveAt = Time.time + 2f;
                        lastHpAt = Time.time;
                        var back = target.transform.position - Flat(target.transform.forward).normalized * 8f;
                        if (!site || Flat(back - anchor).magnitude <= site.arenaRadius) Place(back);
                    }
                }
                weapons.testFire = w != null && (w.def.mode != FireMode.Semi || !weapons.testFire);
                if (skills && Time.time >= skillAt)
                {
                    skillAt = Time.time + 4f;
                    if (skills.secondary != null && skills.secondary.charges > 0) skills.testE = true;
                    else if (skills.primary != null && skills.primary.charges > 0) skills.testQ = true;
                }
                if (!shotTaken && Time.time - t0 > 3f)
                {
                    shotTaken = true;
                    shot(weapons.eye, $"fullrun_{Record?.code ?? "x"}_{Slug(label)}");
                }
                yield return null;
            }
            weapons.testFire = false;
        }

        Damageable PickTarget(BossBrain boss)
        {
            if (boss && !boss.Dead && boss.Health && !boss.Health.untargetable) return boss.Health;
            Damageable best = null;
            float bestD = float.MaxValue;
            var from = eye.position;
            foreach (var e in EnemyAI.All)
            {
                if (!e || e.Dead || !e.Health || e.Health.untargetable) continue;
                float d = Vector3.Distance(from, e.transform.position);
                if (d < bestD)
                {
                    bestD = d;
                    best = e.Health;
                }
            }
            return best;
        }

        static Vector3 AimPoint(Damageable d)
        {
            var b = d.GetComponent<BossBrain>();
            if (b) return b.BodyCenter;
            var col = d.GetComponent<Collider>();
            return col && col.enabled ? col.bounds.center : d.transform.position + Vector3.up;
        }

        static void KillBoss(BossBrain b)
        {
            var hp = b ? b.Health : null;
            if (!hp || hp.Dead || hp.untargetable) return;
            var info = DamageInfo.Simple(99999f, DamageSource.Weapon, b.BodyCenter, Vector3.forward);
            info.noCrit = true;
            Combat.DamageEnemy(hp, info);
        }

        /// <summary>秘卷三选一等模态：选第一项</summary>
        static void HandleModals()
        {
            if (ScrollChoice.Open) ScrollChoice.Pick(0);
        }

        // ───────────── 首领 ─────────────

        IEnumerator FightBoss(BossEncounter enc, StageSpec stage)
        {
            line($"  ── 首领 {enc.Def?.name ?? enc.bossId} ──");
            if (enc.State == BossEncounter.Phase.Settled)
            {
                line("  首领这一局已经打过，跳过");
                yield break;
            }
            // 3-3：领主战在关卡目标完成后才解锁（BossEncounter 之前是停用的）
            float t0 = Time.time;
            while (!enc.isActiveAndEnabled && Time.time - t0 < 4f) yield return null;
            if (!enc.isActiveAndEnabled)
            {
                fail($"首领场 {enc.name} 一直是停用的（关卡目标 / 解锁条件没满足？）");
                yield break;
            }
            var arena = enc.arena ? enc.arena : BossArena.Find(enc.bossId, enc.transform.position);
            if (!arena)
            {
                fail($"首领场 {enc.name} 没有 BossArena");
                yield break;
            }
            var entry = arena.PlayerEntryPoint;
            var toCenter = Flat(arena.Center - entry);
            for (int attempt = 0; attempt < 3 && enc.State == BossEncounter.Phase.Waiting; attempt++)
            {
                var p = entry + toCenter.normalized * Mathf.Min(toCenter.magnitude, enc.thresholdInset + 3f + attempt * 4f);
                yield return Go(p, "首领场入场点");
                Aim(arena.BossSpawnPoint + Vector3.up * 2f);
                float w0 = Time.time;
                while (enc.State == BossEncounter.Phase.Waiting && Time.time - w0 < 1.5f) yield return null;
            }
            if (enc.State == BossEncounter.Phase.Waiting)
            {
                Note($"走进首领场 {enc.thresholdInset + 11f:F0} m 还没开战（门槛 / 安全区？）：直接开战");
                enc.Begin();
            }
            t0 = Time.time;
            while (enc.State == BossEncounter.Phase.Warning && Time.time - t0 < 20f) yield return null;
            var boss = enc.Boss;
            if (!boss)
            {
                if (enc.State >= BossEncounter.Phase.Collapsing) Note("首领没生成，直接结算了");
                else
                {
                    fail($"首领 {enc.bossId} 20 s 内没生成（{enc.State}）");
                    yield break;
                }
            }
            else
            {
                var model = boss.Model;
                if (model != null && model.source != BossModelSource.Art) Note($"首领模型来源 {model.source}（{model.prefab}）");
                float f0 = Time.time;
                yield return Fight(() => !boss || boss.Dead || enc.State >= BossEncounter.Phase.Collapsing, arena.Center, BossLimit, enc.Def?.name ?? "首领", boss);
                if (Record != null) Record.bossSeconds = Time.time - f0;
                if (Record != null) Record.bossPhases = maxPhase + 1;
                int phases = boss && boss.Def != null ? boss.Def.PhaseCount : 0;
                line($"  首领倒下：{Time.time - f0:F0} 游戏秒，打到第 {maxPhase + 1}{(phases > 0 ? $"/{phases}" : "")} 阶段，拴回 {enc.Tethers} 次，倒下 {Record?.downs ?? 0} 次");
                if (phases > 0 && maxPhase + 1 < phases) Note($"首领 {boss.Def.name} 没走完全部阶段就倒下了（{maxPhase + 1}/{phases}）");
            }
            t0 = Time.time;
            while (enc.State != BossEncounter.Phase.Settled && Time.time - t0 < BossEncounter.SettleDelay + 4f)
            {
                HandleModals();
                yield return null;
            }
            if (enc.State != BossEncounter.Phase.Settled)
            {
                fail($"首领倒下后没有结算（{enc.State}）");
                yield break;
            }
            bool final = RunPlan.IsFinal(stage);
            line($"  结算：去向 {enc.Result}（应为 {(final ? "Victory" : "NextStage")}），首领宝箱「{(enc.RewardChest ? enc.RewardChest.EffectiveReward : "无")}」");
            if ((enc.Result == BossEncounter.Outcome.Victory) != final) fail($"{stage.Label} 首领打完的去向是 {enc.Result}");
            if (enc.RewardChest) yield return OpenChest(enc.RewardChest, "首领宝箱");
            // 3-3：领主战结算后神范前还有一个清关宝箱
            foreach (var g in FindObjectsByType<FoundryLordGate>())
                if (g && g.ClearChest && !g.ClearChest.Opened)
                    yield return OpenChest(g.ClearChest, "清关宝箱");
            if (enc.Result == BossEncounter.Outcome.NextStage)
            {
                t0 = Time.time;
                while (!enc.OpenedExit && Time.time - t0 < BossEncounter.PortalDelay + 3f) yield return null;
                if (!enc.OpenedExit) fail("首领结算后出口没有升起");
            }
        }

        IEnumerator WaitVictory()
        {
            float t0 = Time.time;
            while (!(GameSession.Instance && GameSession.Instance.Completed) && Time.time - t0 < BossEncounter.VictoryDelay + 4f)
            {
                HandleModals();
                yield return null;
            }
            if (!(GameSession.Instance && GameSession.Instance.Completed)) fail("最后一关首领结算后没有走到整局结算（CompleteStage）");
        }

        // ───────────── 商店 / 宝箱 / 出口 ─────────────

        IEnumerator Shop(SupplyCamp camp)
        {
            float t0 = Time.time;
            while (!camp.Shop && Time.time - t0 < 2f) yield return null;
            var shop = camp.Shop;
            if (!shop)
            {
                fail($"补给营 {camp.label} 没有开店");
                yield break;
            }
            var run = RunState.Current;
            foreach (var kind in new[] { "scroll", "upgrade", "weapon", "potion", "ammo" })
            {
                var stall = shop.Find(kind);
                if (!stall || stall.Offer == null || stall.Offer.SoldOut) continue;
                int price = stall.Offer.PriceFor(shop.Customer);
                if (run != null && run.coins < price) continue;
                motor.Teleport(stall.CustomerSpot + Vector3.up * 0.05f);
                Aim(stall.Focus);
                yield return new WaitForSeconds(0.2f);
                int coins0 = run?.coins ?? 0;
                var r = stall.BuyNow();
                yield return new WaitForSeconds(0.3f);
                HandleModals();
                if (r == TradeResult.Bought)
                {
                    if (Record != null) Record.bought++;
                    line($"  补给营「{camp.label}」：买了 {kind}（标价 {price}），灵石 {coins0} → {run?.coins}");
                    if (run != null && coins0 - run.coins != price) fail($"商店扣了 {coins0 - run.coins} 灵石，标价 {price}");
                    yield break;
                }
            }
            line($"  补给营「{camp.label}」：灵石 {run?.coins} 什么都买不起 / 都被拒绝");
        }

        IEnumerator OpenChest(Chest chest, string label)
        {
            if (!chest || chest.Opened) yield break;
            float t0 = Time.time;
            while (chest && !chest.CanInteract && !chest.Opened && Time.time - t0 < 3f) yield return null;
            if (!chest || chest.Opened) yield break;
            var p = chest.transform.position;
            var from = Flat(motor.transform.position - p);
            var stand = p + (from.sqrMagnitude > 0.01f ? from.normalized : -chest.transform.forward) * 1.8f;
            if (!Place(stand, 2.5f)) motor.Teleport(stand + Vector3.up * 0.1f);
            yield return new WaitForSeconds(0.15f);
            Aim(chest.Focus);
            yield return null;
            yield return null;
            if (interactor.Current as Chest == chest) interactor.testInteract = true;
            else
            {
                Note($"站在「{label}」前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}，离 {Flat(motor.transform.position - p).magnitude:F1} m）：直接打开");
                chest.Interact();
            }
            t0 = Time.time;
            while (chest && !chest.Opened && Time.time - t0 < 2f) yield return null;
            if (!chest || !chest.Opened)
            {
                fail($"「{label}」打不开");
                yield break;
            }
            if (Record != null) Record.chests++;
            // 奖励在开箱后约 0.6 s 发；秘卷三选一选第一项；地上的枪 / 灵宠封印按需捡
            t0 = Time.time;
            while (Time.time - t0 < 1.4f)
            {
                HandleModals();
                yield return null;
            }
            HandleModals();
            yield return PickUpLoot(p);
        }

        /// <summary>宝箱旁的枪（空槽或比手上的品质高就捡）和灵宠封印（还没有灵宠就捡）</summary>
        IEnumerator PickUpLoot(Vector3 around)
        {
            foreach (var wp in FindObjectsByType<WeaponPickup>().Where(x => x && Flat(x.transform.position - around).magnitude < 7f).ToList())
            {
                bool empty = weapons.slots[0] == null || weapons.slots[1] == null;
                var act = weapons.Active;
                // 碎刃（近战接管）机器人不会用：不捡
                if (wp.weapon == null || wp.weapon.def.kind == WeaponKind.Blade) continue;
                if (!empty && act != null && wp.weapon.rarity <= act.rarity) continue;
                float t0 = Time.time;
                while (wp && !wp.CanInteract && Time.time - t0 < 2f) yield return null;
                if (!wp) continue;
                line($"  捡枪：{wp.weapon.Title}（{Rarity.Name(wp.weapon.rarity)}）{(empty ? "" : $"替换 {act?.Title}")}");
                wp.Interact();
                yield return new WaitForSeconds(0.3f);
            }
            var owner = PetOwner.Instance;
            foreach (var seal in FindObjectsByType<PetSeal>().Where(x => x && Flat(x.transform.position - around).magnitude < 8f).ToList())
            {
                if (owner && owner.Current) break;
                float t0 = Time.time;
                while (seal && !seal.CanInteract && Time.time - t0 < 2f) yield return null;
                if (!seal) continue;
                line($"  结契灵宠：{seal.def?.name ?? "?"}");
                seal.Interact();
                yield return new WaitForSeconds(0.5f);
                HandleModals();
            }
        }

        /// <summary>出口：等开启 / 升起 → 开清关宝箱 → 站到门前按 F → 会话结算</summary>
        IEnumerator Exit(ExitPortal portal, LevelObjective objective)
        {
            var scene = SceneFlow.Instance.CurrentScene;
            if (!portal) portal = FindInScene<ExitPortal>(scene) ?? FindAnyObjectByType<ExitPortal>();
            if (!portal)
            {
                fail("关卡里没有出口");
                yield break;
            }
            float t0 = Time.time;
            while (!portal.IsOpen && Time.time - t0 < 3f) yield return null;
            if (!portal.IsOpen)
            {
                fail($"出口没有开启（目标 {(objective ? objective.Describe() : "无")}）");
                yield break;
            }
            var front = portal.transform.position - portal.transform.forward * 3.5f;
            yield return Go(front, "出口");
            t0 = Time.time;
            while (!portal.Risen && Time.time - t0 < portal.riseTime + 2f) yield return null;
            t0 = Time.time;
            while (!portal.ClearChest && Time.time - t0 < 1f && objective) yield return null;
            if (portal.ClearChest && !portal.ClearChest.Opened) yield return OpenChest(portal.ClearChest, "清关宝箱");
            // 清关后的掉落都吸过来
            t0 = Time.time;
            while (Pickup.Active.Any(x => x && x.kind == Pickup.Kind.Coin) && Time.time - t0 < 3f) yield return null;
            if (!Place(front, 2.5f)) motor.Teleport(front);
            yield return new WaitForSeconds(0.15f);
            Aim(portal.Focus);
            yield return null;
            yield return null;
            if (interactor.Current as ExitPortal == portal) interactor.testInteract = true;
            else
            {
                Note($"站在出口前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）：直接进门");
                portal.Interact();
            }
            float r0 = Time.realtimeSinceStartup;
            while (!(GameSession.Instance && GameSession.Instance.Completed) && Time.realtimeSinceStartup - r0 < 2f) yield return null;
            if (!(GameSession.Instance && GameSession.Instance.Completed)) fail("进入出口后没有本关结算");
        }

        // ───────────── 移动 ─────────────

        /// <summary>寻路用的区域：不走熔岩（3-x）、不走只给雪狌狌的攀爬连线（区域 29，2-1）</summary>
        static int WalkMask => LavaField.DryAreaMask & ~(1 << 29);

        /// <summary>算好 NavMesh 路径（记路程、不完整记一条），然后传送过去</summary>
        IEnumerator Go(Vector3 goal, string label)
        {
            var from = motor.transform.position;
            if (NavMesh.SamplePosition(from, out var a, 4f, WalkMask) && NavMesh.SamplePosition(goal, out var b, 8f, WalkMask))
            {
                var path = new NavMeshPath();
                NavMesh.CalculatePath(a.position, b.position, WalkMask, path);
                float len = 0;
                var c = path.corners;
                for (int i = 0; i + 1 < c.Length; i++) len += Vector3.Distance(c[i], c[i + 1]);
                if (Record != null) Record.pathMeters += len;
                if (path.status != NavMeshPathStatus.PathComplete && Flat(b.position - a.position).magnitude > 6f)
                    Note($"去「{label}」：{Fmt(a.position)} → {Fmt(b.position)} 没有完整的导航路径（{path.status}；落到连通的最近点）");
            }
            if (!Place(goal)) Note($"去「{label}」：目标 {Fmt(goal)} 附近没有导航网格");
            yield return null;
        }

        /// <summary>这一关的起点（出生点所在的导航网格）：传送只落在和它连通的地方，免得落到孤岛上（巨像台顶、屋顶）——敌人的出生点按玩家位置挑，孤岛上一个也挑不出来</summary>
        Vector3 origin;
        bool hasOrigin;
        readonly NavMeshPath probe = new();

        void SetOrigin()
        {
            hasOrigin = false;
            if (motor && NavMesh.SamplePosition(motor.transform.position, out var hit, 6f, WalkMask))
            {
                hasOrigin = true;
                origin = hit.position;
            }
        }

        bool Connected(Vector3 p)
        {
            if (!hasOrigin) return true;
            NavMesh.CalculatePath(origin, p, WalkMask, probe);
            return probe.status == NavMeshPathStatus.PathComplete;
        }

        /// <summary>goal 附近、和起点连通的导航网格点：goal 本身 → 由近到远的几圈（3–18 m）→ 起点到 goal 的路径能走到的最远处</summary>
        bool Reachable(Vector3 goal, float search, out Vector3 at)
        {
            at = default;
            NavMeshHit hit = default;
            bool sampled = NavMesh.SamplePosition(goal, out hit, search, WalkMask) || NavMesh.SamplePosition(goal, out hit, search * 3f, WalkMask);
            if (sampled && Connected(hit.position))
            {
                at = hit.position;
                return true;
            }
            foreach (float r in new[] { 3f, 6f, 10f, 14f, 18f })
                for (int i = 0; i < 12; i++)
                {
                    float ang = i * Mathf.PI * 2 / 12;
                    var p = goal + new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * r;
                    if (!NavMesh.SamplePosition(p, out var h, 3f, WalkMask) || !Connected(h.position)) continue;
                    at = h.position;
                    return true;
                }
            if (hasOrigin && sampled)
            {
                NavMesh.CalculatePath(origin, hit.position, WalkMask, probe);
                var c = probe.corners;
                if (c.Length > 0)
                {
                    at = c[c.Length - 1];
                    return true;
                }
            }
            if (!sampled) return false;
            at = hit.position;
            return true;
        }

        /// <summary>传送到 p 附近、和起点连通的导航网格上；没有返回 false</summary>
        bool Place(Vector3 p, float search = 8f)
        {
            if (!Reachable(p, search, out var at)) return false;
            var d = Flat(p - motor.transform.position);
            float? yaw = d.sqrMagnitude > 0.01f ? Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg : null;
            motor.Teleport(at + Vector3.up * 0.05f, yaw);
            Physics.SyncTransforms();
            return true;
        }

        /// <summary>目标周围 rMin–rMax 米、导航网格上、和起点连通、眼高能直接看到瞄准点的位置</summary>
        bool SightSpot(Damageable target, Vector3 aim, float rMin, float rMax, out Vector3 spot, Vector3? within = null, float radius = 0)
        {
            for (int i = 0; i < 16; i++)
            {
                float ang = i * Mathf.PI * 2 / 16 + Random.value * 0.3f;
                var p = target.transform.position + new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * Random.Range(rMin, rMax);
                if (!NavMesh.SamplePosition(p, out var hit, 3f, WalkMask)) continue;
                if (within.HasValue && Flat(hit.position - within.Value).magnitude > radius) continue;
                if (Combat.Blocked(hit.position + Vector3.up * EyeHeight, aim, null)) continue;
                if (!Connected(hit.position)) continue;
                spot = hit.position;
                return true;
            }
            spot = default;
            return false;
        }

        void Aim(Vector3 at)
        {
            var dir = at - eye.position;
            float yaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
            float pitch = -Mathf.Atan2(dir.y, new Vector2(dir.x, dir.z).magnitude) * Mathf.Rad2Deg;
            motor.SetLook(yaw, pitch);
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);
        static string Fmt(Vector3 p) => $"({p.x:F0}, {p.y:F0}, {p.z:F0})";

        static string Slug(string s)
        {
            if (string.IsNullOrEmpty(s)) return "x";
            var chars = s.Where(ch => ch < 128 && char.IsLetterOrDigit(ch)).ToArray();
            return chars.Length > 0 ? new string(chars) : Mathf.Abs(s.GetHashCode() % 10000).ToString();
        }
    }
}
