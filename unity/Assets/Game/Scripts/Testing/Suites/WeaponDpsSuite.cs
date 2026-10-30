using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 武器秒伤基准（docs/unity-parity.md WC8；bridge.sh playtest weapon-dps；场景 TestArena），只测秒伤、不拍图，结果写 CSV（结果文件同目录的 weapon_dps.csv）：
    ///   · 遍历武器注册表，每把「定义原样」（普通品质、只带固有词条）发到手上，打 weapons 套件同款的中性木桩（三彩镇墓兽：无甲无盾、生命 ×400、AI 停掉、
    ///     撤掉承伤修饰、关掉弱点球；8 m，近战 2.2 m），每帧瞄身体中心（完美压枪）、备弹无限；按住扳机（半自动隔帧点按）、换弹中不扣；狙击开镜打；
    ///   · 计时从扣扳机起到第 k 次换弹完成（凑够约 6 s 的整轮，最多 2 轮）= 整轮持续秒伤；伤害只算这把枪打在木桩上的直接 / 爆炸伤害（不含跳伤、反应）；
    ///   · 两个口径（I3，docs/balance.md 第 2 节）：
    ///       裸秒伤 = 命中请求的基础伤害（DamageInfo.amount：已含距离衰减 / 爆炸衰减 / 蓄力倍率，不含暴击、元素克制层、蚀化易伤、雷殛标记、英雄被动）÷ 窗口
    ///         —— 和 Three.js 的「普通、无加成、身体、含换弹、不含暴击」同一口径，秒伤带只判它；
    ///       实战秒伤 = 木桩实际掉的血（对生命层：火 ×1.25、蚀化易伤 ×1.2、雷殛标记 ×1.15、燎的余烬 ×1.2 都算进去），另按暴击倍率折算「不含暴击」，倍率 = 实战不含暴击 ÷ 裸秒伤；
    ///   · 每行同时给出三个对照：描述器的「秒伤 约 N」（<see cref="WeaponDescriber"/>，不含换弹）、按解析数值算的整轮理论秒伤（弹匣 × 每发伤害 ÷（打空 + 换弹）；碎刃 = 斩击理论秒伤）、
    ///     Three.js 秒伤带（±20%；原 11 把是 TS 无头实测、榴弹去掉火对生命的 ×1.25，扩充的 6 把是 arsenal-expansion 8.1 的设计值）。
    /// 判定：一点伤害都没打出来、木桩格挡了、期间有运行时报错 → 不合格；裸秒伤不在 Three.js 带内、或裸秒伤 / 整轮理论偏出 0.6–1.5 → ⚠（平衡复核，不算不合格）。
    /// 测量期间时间 ×2（秒伤按游戏时间算）。
    /// </summary>
    public sealed class WeaponDpsSuite : PlaytestSuite
    {
        public override string Id => "weapon-dps";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string DummyId = "tomb_beast";
        const float DummyHpMult = 400f, Distance = 8f, MeleeDistance = 2.2f;
        const float MinWindow = 6f, MaxWindow = 18f, TimeScale = 2f, BandTolerance = 0.2f;
        public const string CsvName = "weapon_dps.csv";

        /// <summary>
        /// Three.js 秒伤基准，裸秒伤口径（普通、无加成、身体、含换弹、不含暴击、不含元素克制；同 WeaponsSuite.TsDps 的出处）：
        /// 榴弹的 TS 实测 111 含火对生命 ×1.25，这里折成 88.8；雷弧对生命 ×1，原样
        /// </summary>
        public static readonly Dictionary<string, float> TsDps = new()
        {
            ["revolver"] = 82, ["smg"] = 91, ["rifle"] = 90, ["burst"] = 86, ["shotgun"] = 90, ["sniper"] = 107, ["launcher"] = 88.8f,
            ["crossbow"] = 82, ["beam"] = 74, ["minigun"] = 90, ["swarm"] = 82, ["flamer"] = 69.1f, ["stormpod"] = 71.3f,
            ["magmashot"] = 80, ["trinity"] = 66.3f, ["railgun"] = 86.1f, ["lantern"] = 62.9f, ["demon_blade"] = 105,
        };

        ArenaSpawner arena;
        PlayerRig rig;
        Vector3 spawnPos;
        int logErrors;
        string lastError;
        readonly List<string> csv = new();
        readonly List<string> outOfBand = new(), offTheory = new();

        WeaponInstance current;
        float dealt, dealtNoCrit, dealtRaw;
        int hits, crits, fired, reloads, wantReloads, blocked, weakHits;
        float windowEnd = -1;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            var systems = SystemsBootstrap.Find();
            if (!arena || !systems)
            {
                Fail($"缺少刷怪台或 Game Systems：arena={arena} systems={systems}（场景不是 TestArena？先 bridge.sh level arena）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Application.logMessageReceived += OnLog;
            InAction<HitEvent> onHit = OnEnemyHit;
            GameEvents.EnemyDamaged += onHit;
            GameEvents.WeaponFired += OnFired;
            GameEvents.Reloaded += OnReloaded;
            TimeScaleArbiter.Handle speed = null;
            try
            {
                var baked = FindAnyObjectByType<PlayerVitals>();
                spawnPos = arena.playerSpawn ? arena.playerSpawn.position : baked ? baked.transform.position : arena.Center + Vector3.back * 12;
                var look = arena.Center - spawnPos;
                look.y = 0;
                var spawnRot = look.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(look) : Quaternion.identity;
                if (baked)
                {
                    baked.gameObject.SetActive(false);
                    Destroy(baked.gameObject);
                }
                yield return null;
                var hero = HeroLibrary.Get(RunState.Current?.heroId) ?? HeroLibrary.Get(HeroLibrary.DefaultHero) ?? HeroLibrary.All.FirstOrDefault();
                if (hero == null)
                {
                    Fail("没有登记任何英雄");
                    yield break;
                }
                rig = PlayerFactory.Create(hero, spawnPos, spawnRot);
                PlayerFactory.Bind(systems, rig);
                SystemsBootstrap.Setup();
                yield return null;
                yield return null;
                rig.vitals.invulnerableUntil = Time.time + 99999;

                var defs = WeaponLibrary.All.ToList();
                Line($"秒伤基准：{defs.Count} 把（注册表顺序），英雄 {hero.name}，中性木桩 {DummyId}（无甲、生命 ×{DummyHpMult}），{Distance} m（近战 {MeleeDistance} m），时间 ×{TimeScale}");
                csv.Add("id,name,category,mode,rarity,describer_dps,theory_sustained,raw_dps,measured_dps,measured_nocrit,field_mult,ratio_theory,ts_dps,ratio_ts,in_band," +
                        "window_s,hits,crits,shots,reloads,errors,blocked,weak");
                speed = TimeScaleArbiter.Request(this, 1, TimeScaleArbiter.Priority.HitStop - 50);
                foreach (var def in defs) yield return Case(def, speed);

                Line(outOfBand.Count == 0 ? "Three.js 秒伤带（裸秒伤）：全部在 ±20% 内" : $"Three.js 秒伤带（裸秒伤）：{outOfBand.Count} 把在带外（⚠ 平衡复核）：{string.Join("、", outOfBand)}");
                Line(offTheory.Count == 0 ? "裸秒伤 / 整轮理论：全部在 0.6–1.5" : $"裸秒伤 / 整轮理论偏离：{string.Join("、", offTheory)}（⚠）");
                WriteCsv();
            }
            finally
            {
                speed?.Dispose();
                if (rig != null && rig.weapons)
                {
                    rig.weapons.testFire = false;
                    rig.weapons.testAim = false;
                }
                GameEvents.EnemyDamaged -= onHit;
                GameEvents.WeaponFired -= OnFired;
                GameEvents.Reloaded -= OnReloaded;
                Application.logMessageReceived -= OnLog;
            }
        }

        // ───────────── 事件 ─────────────

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnEnemyHit(in HitEvent e)
        {
            var w = current;
            if (w == null || !e.enemy || e.info.weaponUid != w.uid || e.info.source != DamageSource.Weapon || e.info.reaction || !(e.result.total > 0)) return;
            if (e.result.blocked) blocked++;
            if (e.info.weakpoint) weakHits++;
            float t = e.result.total;
            dealt += t;
            dealtRaw += Mathf.Max(0, e.info.amount);
            hits++;
            if (e.result.crit)
            {
                crits++;
                dealtNoCrit += t / Mathf.Max(1, e.info.critMult);
            }
            else dealtNoCrit += t;
        }

        void OnFired(WeaponInstance w)
        {
            if (w != null && w == current) fired++;
        }

        void OnReloaded(WeaponInstance w)
        {
            if (w == null || w != current) return;
            reloads++;
            if (wantReloads > 0 && reloads >= wantReloads && windowEnd < 0) windowEnd = Time.time;
        }

        void ResetCounts(WeaponInstance w)
        {
            current = w;
            dealt = dealtNoCrit = dealtRaw = 0;
            hits = crits = fired = reloads = blocked = weakHits = 0;
            windowEnd = -1;
        }

        // ───────────── 每把枪 ─────────────

        IEnumerator Case(WeaponDef def, TimeScaleArbiter.Handle speed)
        {
            int err0 = logErrors;
            var wc = rig.weapons;
            arena.Clear();
            speed.Scale = 1;
            wc.testFire = wc.testAim = false;
            var inst = new WeaponInstance(def);
            ResetCounts(null);
            wc.Give(inst);
            yield return new WaitForSeconds(0.6f);
            if (wc.Active != inst)
            {
                Fail($"{def.name}：发到手上后当前武器是 {wc.Active?.def.id ?? "空"}");
                yield break;
            }
            bool melee = def.IsBlade || WeaponTakeovers.Find(inst) != null;
            var dummy = SpawnDummy();
            yield return new WaitForSeconds(1f); // 出生 0.7 s 内不可选中
            if (!dummy)
            {
                Fail($"{def.name}：刷不出木桩 {DummyId}");
                yield break;
            }
            Freeze(dummy);
            Stand(dummy, melee ? MeleeDistance : Distance);
            yield return null;

            var R = WeaponStatsResolver.Resolve(inst, rig.vitals.stats);
            var desc = WeaponDescriber.Describe(inst, rig.vitals.stats);
            inst.mag = R.magCap;
            float magTime = MagTime(def, R), reload = ReloadTime(def, R);
            float cycle = melee || R.magCap <= 0 ? MinWindow : def.spinup + magTime + reload;
            float theory = SustainedTheory(def, R, melee);
            wantReloads = melee || R.magCap <= 0 ? 0 : Mathf.Clamp(Mathf.CeilToInt(MinWindow / Mathf.Max(0.5f, cycle)), 1, 2);
            float limit = wantReloads > 0 ? Mathf.Min(MaxWindow, wantReloads * cycle * 1.5f + 2f) : MinWindow;
            bool hold = !(FireModes.Create(def) is SemiMode);
            bool aim = def.kind == WeaponKind.Sniper;
            ResetCounts(inst);
            speed.Scale = TimeScale;
            float t0 = Time.time;
            bool toggle = false;
            while (true)
            {
                inst.reserve = Mathf.Max(inst.reserve, R.reserveCap);
                if (dummy) AimAt(dummy);
                toggle = !toggle;
                wc.testFire = !wc.Reloading && (hold || toggle);
                wc.testAim = aim;
                if (windowEnd >= 0) break;
                if (Time.time - t0 > limit)
                {
                    windowEnd = Time.time;
                    break;
                }
                yield return null;
            }
            wc.testFire = wc.testAim = false;
            float window = Mathf.Max(0.1f, windowEnd - t0);
            yield return new WaitForSeconds(1.2f); // 在飞的投射物 / 爆炸落地
            speed.Scale = 1;

            float dps = dealt / window, noCrit = dealtNoCrit / window, raw = dealtRaw / window;
            float field = raw > 0 ? noCrit / raw : 0;
            bool known = TsDps.TryGetValue(def.id, out float ts);
            float lo = known ? ts * (1 - BandTolerance) : 60, hi = known ? ts * (1 + BandTolerance) : 90;
            bool inBand = raw >= lo && raw <= hi;
            float ratio = theory > 0 ? raw / theory : 0;
            int errs = logErrors - err0;
            string describer = desc?.Stat("秒伤") ?? "—";
            Line($"{def.name}（{def.id} · {FireModes.Create(def).Id}）：裸秒伤 {raw:F1}；实战 {dps:F1}（不含暴击 {noCrit:F1}，×{field:F2}）；描述器「{describer}」，整轮理论 {theory:F1}（裸 ×{ratio:F2}）；" +
                 $"{(known ? $"TS {ts:0.#}（{lo:0}–{hi:0}）" : $"通用带 {lo:0}–{hi:0}")} {(inBand ? "✓" : "⚠ 带外")}；窗口 {window:F1} s、换弹 {reloads}、命中 {hits}（暴击 {crits}）、开火 {fired}" +
                 (blocked > 0 || weakHits > 0 ? $"；⚠ 格挡 {blocked}、弱点 {weakHits}" : "") + (errs > 0 ? $"；报错 {errs}（{lastError}）" : ""));
            if (!inBand) outOfBand.Add($"{def.id} {raw:F0}");
            if (theory > 0 && (ratio < 0.6f || ratio > 1.5f)) offTheory.Add($"{def.id} ×{ratio:F2}");
            if (!(dealt > 0)) Fail($"{def.name}：{window:F1} s 里一点伤害都没打到木桩上（开火 {fired} 次）");
            if (blocked > 0) Fail($"{def.name}：木桩格挡了 {blocked} / {hits} 下（承伤修饰没撤干净），秒伤不可信");
            if (errs > 0) Fail($"{def.name}：期间有 {errs} 条运行时报错（最后一条：{lastError}）");
            if (desc == null || desc.Stat("秒伤") == null) Fail($"{def.name}：描述器没有「秒伤」行");
            csv.Add(string.Join(",", def.id, Csv(def.name), Csv(def.category), FireModes.Create(def).Id, inst.rarity, Csv(describer), F(theory), F(raw), F(dps), F(noCrit), F(field), F(ratio),
                known ? F(ts) : "", known ? F(raw / ts) : "", inBand ? 1 : 0, F(window), hits, crits, fired, reloads, errs, blocked, weakHits));
            current = null;
            arena.Clear();
            yield return new WaitForSeconds(0.2f);
        }

        /// <summary>
        /// 整轮理论秒伤（普通、身体、不含暴击）：弹匣 × 每发伤害 ÷（打空 + 换弹）；碎刃 = 斩击理论秒伤；近战接管 / 没有弹匣的按描述器秒伤。
        /// EditMode 的 BalanceModelTests 用它离线核对武器秒伤带（I3）
        /// </summary>
        public static float SustainedTheory(WeaponDef def, ResolvedWeapon R, bool melee)
        {
            if (def.IsBlade) return R.meleeDps;
            float magTime = MagTime(def, R), reload = ReloadTime(def, R);
            return melee || R.magCap <= 0 || magTime + reload <= 0 ? R.dps : R.magCap * R.perShot / Mathf.Max(0.01f, magTime + reload);
        }

        /// <summary>打空一匣的时间（游戏秒）：弹匣 × 每发间隔（点射按每轮、蓄力按蓄满 + 冷却）</summary>
        static float MagTime(WeaponDef def, ResolvedWeapon R)
        {
            float rate = Mathf.Max(0.1f, R.fireRate);
            float perAmmo = def.mode switch
            {
                FireMode.Burst => 1f / (rate * Mathf.Max(1, def.burstCount)),
                FireMode.Charge => 1f / rate + def.chargeTime / Mathf.Max(0.01f, R.fireRateMult),
                _ => 1f / rate,
            };
            return R.magCap * perAmmo;
        }

        /// <summary>换弹时间（逐发 = 准备 + 每发 + 上膛）</summary>
        static float ReloadTime(WeaponDef def, ResolvedWeapon R) =>
            WeaponStateMachine.IsShell(def) ? R.reloadStart + R.magCap * R.shellTime + WeaponTiming.ShellRack : R.reloadTime;

        EnemyAI SpawnDummy()
        {
            var e = arena.Spawn(DummyId, false, Vector3.zero);
            if (!e) return null;
            var h = e.Health;
            h.maxArmor = 0;
            h.maxShield = 0;
            h.maxHealth *= DummyHpMult;
            h.ResetVitals();
            return e;
        }

        /// <summary>中性靶：停导航、停 AI、撤掉承伤修饰、关掉弱点球（同 WeaponsSuite.Freeze）</summary>
        static void Freeze(EnemyAI ai)
        {
            if (!ai) return;
            var agent = ai.GetComponent<UnityEngine.AI.NavMeshAgent>();
            if (agent && agent.isOnNavMesh) agent.isStopped = true;
            ai.enabled = false;
            var h = ai.Health;
            if (h) h.Incoming.Clear();
            var body = ai.GetComponent<EnemyBody>();
            if (body) body.SetWeakPointActive(false);
        }

        void Stand(EnemyAI a, float distance)
        {
            var away = spawnPos - a.transform.position;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            var p = a.transform.position + away * distance;
            if (Physics.Raycast(p + Vector3.up * 20, Vector3.down, out var hit, 60, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            rig.motor.Teleport(p);
            AimAt(a);
        }

        void AimAt(EnemyAI a)
        {
            if (a && a.Health) Aim(rig.motor, rig.eye ? rig.eye : rig.cam.transform, BodyCenter(a.Health));
        }

        static string F(float v) => v.ToString("0.###", CultureInfo.InvariantCulture);
        static string Csv(string s) => string.IsNullOrEmpty(s) ? "" : s.Contains(",") || s.Contains("\"") ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;

        void WriteCsv()
        {
            if (string.IsNullOrEmpty(ResultPath)) return;
            try
            {
                var path = Path.Combine(Path.GetDirectoryName(ResultPath) ?? "", CsvName);
                File.WriteAllText(path, string.Join("\n", csv) + "\n", new UTF8Encoding(true));
                Line($"CSV：{path}（{csv.Count - 1} 行）");
            }
            catch (IOException e)
            {
                Fail($"CSV 写不出来：{e.Message}");
            }
        }
    }
}
