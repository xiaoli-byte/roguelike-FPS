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
    /// 武器冒烟 + 秒伤（bridge.sh playtest weapons；场景 TestArena）。场景里烘好的玩家撤掉，按默认英雄走 <see cref="PlayerFactory"/> 重新组装
    /// （第一人称 rig 按当前武器表生成），然后<b>遍历武器注册表</b>（以后加的武器自动纳入），每把：
    ///   · 发到 2 号槽并切上（<see cref="WeaponController.Give"/>），拍一张腰射第一人称图；有登记占位瞄具的（红点 / 筒式）要挂上，再拍一张开镜图；
    ///   · 8 m 外一只定住的木桩（三彩镇墓兽：去掉护甲 / 护盾、生命 ×400、AI 停掉、不受击退；近战武器站 2.2 m），每帧瞄身体中心（等于完美压枪）、备弹无限；
    ///     全自动 / 光束 / 预热 / 点射 / 齐射 / 蓄力按住扳机，半自动隔帧点按，换弹中不扣（逐发装填不被打断）；狙击开镜打（TS 实测口径：必须开镜）；
    ///   · 计时从扣扳机起、到第 k 次换弹完成止（k 按一轮「打空一匣 + 换弹」的估算凑够约 6 s，最多 2 轮），即整轮持续秒伤；
    ///     伤害只算这把枪（weaponUid）打在木桩上的直接 / 爆炸伤害（不含灼烧 / 蚀化跳伤与反应），按暴击倍率另算「不含暴击」；
    ///     与 Three.js 秒伤带比较（TS 实测 / arsenal-expansion 设计值，不含暴击；考虑 D11 散布 ×0.4，Unity 打得更准、应略高）：
    ///     ±20% 内记 ✓，带外记 ⚠（不算不合格，平衡单元复核）；一点伤害都没打出来算不合格；
    ///   · 专项：点射一扣 = burstCount 发；狙击开镜后零散布、遮罩亮、准星收、枪模隐藏，换弹即退镜、枪模复原；
    ///     预热武器开火时移速 −moveSlow、停火后复原、枪管骨骼在转；齐射武器同时在飞 ≥ 2 枚；火焰锥不生成投射物、能穿透烧到后排第二只木桩；
    ///   · 期间没有运行时报错（宿主另外记不合格，这里按武器归账）。
    /// 测量期间时间 ×2（<see cref="TimeScaleArbiter"/>，秒伤按游戏时间算），整套约 3 分钟（18 把时），在编辑器 600 s 上限内。
    /// 结果另写 CSV：结果文件同目录的 weapons_dps.csv（WC8 的 WeaponDpsSuite 落地后可以合并）。
    /// </summary>
    public sealed class WeaponsSuite : PlaytestSuite
    {
        public override string Id => "weapons";
        /// <summary>测试场（与编辑器里 Level_TestArena.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string DummyId = "tomb_beast";
        const float DummyHpMult = 400f;
        const float Distance = 8f, MeleeDistance = 2.2f;
        /// <summary>测量窗口：至少约这么久（凑整轮），最多这么久（游戏时间，秒）</summary>
        const float MinWindow = 6f, MaxWindow = 18f;
        const float TimeScale = 2f;
        /// <summary>落在 Three.js 秒伤带内的容差（±）</summary>
        const float BandTolerance = 0.2f;

        /// <summary>
        /// Three.js 秒伤基准（普通稀有度、无加成、身体、含换弹、不含暴击）：src/weapons/WeaponDefs.ts 头注释的 120 s 实测
        /// （左轮 82、冲锋枪 91、步枪 90、点射 86、霰弹 90、弩 82、光束 74、机炮 90、蜂群 82、榴弹 111（火对生命 ×1.25）、狙击 107），
        /// 武器库扩充的 docs/arsenal-expansion.md 8.1 设计值（喷火 69.1 / 目标、雷蛊 71.3、霰铳 80、三才 66.3、贯虹满蓄 86.1、蛊灯 62.9），
        /// 碎刃按 D11 的近战约 105。没有登记的武器按通用带 60–90
        /// </summary>
        static readonly Dictionary<string, float> TsDps = new()
        {
            ["revolver"] = 82, ["smg"] = 91, ["rifle"] = 90, ["burst"] = 86, ["shotgun"] = 90, ["sniper"] = 107, ["launcher"] = 111,
            ["crossbow"] = 82, ["beam"] = 74, ["minigun"] = 90, ["swarm"] = 82, ["flamer"] = 69.1f, ["stormpod"] = 71.3f,
            ["magmashot"] = 80, ["trinity"] = 66.3f, ["railgun"] = 86.1f, ["lantern"] = 62.9f, ["demon_blade"] = 105,
        };

        ArenaSpawner arena;
        GameObject systems;
        PlayerRig rig;
        Vector3 spawnPos;
        Quaternion spawnRot;
        int logErrors;
        string lastError;
        readonly List<string> csv = new();
        readonly List<string> outOfBand = new();

        // ── 当前这把枪的计数（事件回调写）──
        WeaponInstance current;
        readonly Dictionary<Damageable, float> dealtBy = new();
        float dealt, dealtNoCrit;
        int hits, crits, fired, reloads, wantReloads;
        float windowEnd = -1;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            systems = SystemsBootstrap.Find();
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
                spawnRot = look.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(look) : Quaternion.identity;
                if (baked)
                {
                    baked.gameObject.SetActive(false);
                    Destroy(baked.gameObject);
                }
                yield return null;

                var hero = HeroLibrary.Get(RunState.Current?.heroId) ?? HeroLibrary.Get(HeroLibrary.DefaultHero) ?? HeroLibrary.All.FirstOrDefault();
                if (hero == null)
                {
                    Fail("没有登记任何英雄（Skills/Heroes/Hero_*.cs）");
                    yield break;
                }
                rig = PlayerFactory.Create(hero, spawnPos, spawnRot);
                PlayerFactory.Bind(systems, rig);
                SystemsBootstrap.Setup();
                yield return null;
                yield return null;
                rig.vitals.invulnerableUntil = Time.time + 99999;

                var defs = WeaponLibrary.All.ToList();
                Line($"武器 {defs.Count} 把（注册表顺序）：{string.Join("、", defs.Select(d => d.id))}；英雄 {hero.name}，木桩 {DummyId}（无甲、生命 ×{DummyHpMult}），{Distance} m");
                csv.Add("id,name,mode,window_s,damage,dps,dps_nocrit,hits,crits,shots,ts_dps,ratio,in_band,errors");
                speed = TimeScaleArbiter.Request(this, 1, TimeScaleArbiter.Priority.HitStop - 50);
                foreach (var def in defs) yield return WeaponCase(def, speed);

                Line(outOfBand.Count == 0
                    ? "秒伤：全部落在 Three.js 秒伤带 ±20% 内"
                    : $"秒伤：{outOfBand.Count} 把在带外（⚠，平衡单元复核）：{string.Join("、", outOfBand)}");
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
            if (w == null || e.info.weaponUid != w.uid || e.info.source != DamageSource.Weapon || e.info.reaction || !(e.result.total > 0)) return;
            if (!e.enemy) return;
            float t = e.result.total;
            dealtBy.TryGetValue(e.enemy, out var sum);
            dealtBy[e.enemy] = sum + t;
            dealt += t;
            hits++;
            if (e.result.crit)
            {
                crits++;
                float cm = Mathf.Max(1, e.info.critMult);
                dealtNoCrit += t / cm;
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
            dealtBy.Clear();
            dealt = dealtNoCrit = 0;
            hits = crits = fired = reloads = 0;
            windowEnd = -1;
        }

        // ───────────── 每把枪 ─────────────

        IEnumerator WeaponCase(WeaponDef def, TimeScaleArbiter.Handle speed)
        {
            int err0 = logErrors;
            var wc = rig.weapons;
            Line($"── {def.name}（{def.id}）· {def.category} · {FireModes.Create(def).Id} ──");
            arena.Clear();
            speed.Scale = 1;
            wc.testFire = wc.testAim = false;
            var inst = new WeaponInstance(def);
            ResetCounts(null);
            wc.Give(inst);
            yield return new WaitForSeconds(0.7f);
            if (wc.Active != inst)
            {
                Fail($"{def.name}：发到手上后当前武器是 {wc.Active?.def.id ?? "空"}");
                yield break;
            }
            Shot(rig.cam, $"weapons_{def.id}");
            var view = wc.rigs.FirstOrDefault(r => r != null && r.weaponId == def.id)?.view;
            if (!view) Line($"⚠ {def.name}：没有第一人称 rig（GameDatabase 里没有 {def.prefab}？先 bridge.sh core）");
            var sight = WeaponSight.For(def.id);
            if (view && sight != null && sight.parts.Length > 0)
            {
                bool part = view.GetComponent<SightPart>();
                bool attached = WeaponSightBuilder.Find(view.transform);
                Line($"瞄具（{sight.kind}）：零件 {(part ? "已挂" : "没挂")}，占位网格 {(attached ? "已挂上" : "没挂上")}");
                if (!part || !attached) Fail($"{def.name}：登记了 {sight.kind} 瞄具，第一人称 rig 上没有挂（WeaponRigParts 没跑？）");
            }

            // 木桩
            bool melee = def.IsBlade || WeaponTakeovers.Find(inst) != null;
            var dummy = SpawnDummy(Vector3.zero);
            yield return new WaitForSeconds(1f); // 出生 0.7 s 内不可选中
            if (!dummy)
            {
                Fail($"{def.name}：刷不出木桩 {DummyId}");
                yield break;
            }
            Freeze(dummy);
            Stand(dummy, melee ? MeleeDistance : Distance);
            yield return null;

            if (sight != null && sight.parts.Length > 0 && view)
            {
                wc.testAim = true;
                for (float t = 0; t < 0.45f; t += Time.deltaTime)
                {
                    AimAt(dummy);
                    yield return null;
                }
                Shot(rig.cam, $"weapons_{def.id}_aim");
                wc.testAim = false;
                yield return new WaitForSeconds(0.3f);
            }
            if (def.mode == FireMode.Burst) yield return BurstCase(def, inst, dummy);
            if (sight != null && sight.kind == SightKind.Scope) yield return ScopeCase(def, inst, dummy, view);

            // ── 秒伤 ──
            var R = WeaponStatsResolver.Resolve(inst, rig.vitals.stats);
            inst.mag = R.magCap;
            float cycle = CycleEstimate(def, R, melee);
            wantReloads = melee || R.magCap <= 0 ? 0 : Mathf.Clamp(Mathf.CeilToInt(MinWindow / Mathf.Max(0.5f, cycle)), 1, 2);
            float limit = wantReloads > 0 ? Mathf.Min(MaxWindow, wantReloads * cycle * 1.5f + 2f) : MinWindow;
            bool hold = !(FireModes.Create(def) is SemiMode);
            bool aimWhileFiring = def.kind == WeaponKind.Sniper;
            bool flame = FlameCone.Handles(def);
            bool slowing = def.mode == FireMode.Spinup && def.moveSlow > 0;
            float walk0 = rig.motor.walkSpeed, walkMin = walk0, slowMin = 0;
            var spinSpec = WeaponSpinner.For(def.id);
            var spinner = view ? view.GetComponent<BarrelSpinner>() : null;
            var spinBone = spinner ? spinner.SpinBone : null;
            var spinRest = spinBone ? spinBone.localRotation : Quaternion.identity;
            float spinMax = 0;
            int maxLive = 0, live0 = PlayerProjectile.LiveCount;
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
                wc.testAim = aimWhileFiring;
                maxLive = Mathf.Max(maxLive, PlayerProjectile.LiveCount - live0);
                slowMin = Mathf.Min(slowMin, wc.MoveSpeedDelta);
                walkMin = Mathf.Min(walkMin, rig.motor.walkSpeed);
                if (spinBone) spinMax = Mathf.Max(spinMax, Quaternion.Angle(spinRest, spinBone.localRotation));
                if (windowEnd >= 0) break;
                if (Time.time - t0 > limit)
                {
                    windowEnd = Time.time;
                    break;
                }
                yield return null;
            }
            wc.testFire = false;
            wc.testAim = false;
            float window = Mathf.Max(0.1f, windowEnd - t0);
            // 在飞的投射物 / 爆炸落地（停火后不会再有新的一发）
            yield return new WaitForSeconds(1.2f);
            speed.Scale = 1;

            float dps = dealt / window, dpsNoCrit = dealtNoCrit / window;
            bool known = TsDps.TryGetValue(def.id, out float ts);
            float lo = known ? ts * (1 - BandTolerance) : 60, hi = known ? ts * (1 + BandTolerance) : 90;
            bool inBand = dpsNoCrit >= lo && dpsNoCrit <= hi;
            string band = known ? $"TS {ts:0.#}（±20%：{lo:0}–{hi:0}）" : $"通用带 {lo:0}–{hi:0}";
            Line($"秒伤：{dps:F1}（不含暴击 {dpsNoCrit:F1}），{band} {(inBand ? "✓" : "⚠ 带外")}；" +
                 $"窗口 {window:F1} s（{reloads} 次换弹 / 估一轮 {cycle:F1} s），命中 {hits}（暴击 {crits}），开火 {fired}");
            if (!inBand) outOfBand.Add($"{def.id} {dpsNoCrit:F0}");
            if (!(dealt > 0)) Fail($"{def.name}：{window:F1} s 里一点伤害都没打到木桩上（开火 {fired} 次）");

            // ── 专项 ──
            if (slowing)
            {
                float drop = walk0 - walkMin;
                Line($"预热减速：开火时移速 {walk0:F2} → {walkMin:F2}（−{drop:F2}），MoveSpeedDelta 最低 {slowMin:F2}（应 −{def.moveSlow}）");
                // 属性表里是平加 −moveSlow（同 TS stats.add）；有移速百分比加成时实际降幅会略有出入，只要求确实降了
                if (slowMin > -def.moveSlow + 0.01f || drop < def.moveSlow * 0.5f) Fail($"{def.name}：开火时没有 −{def.moveSlow} 移速");
                yield return new WaitForSeconds(1f);
                if (wc.MoveSpeedDelta < -0.001f || Mathf.Abs(rig.motor.walkSpeed - walk0) > 0.01f)
                    Fail($"{def.name}：停火后移速没复原（{rig.motor.walkSpeed:F2}，应 {walk0:F2}；MoveSpeedDelta {wc.MoveSpeedDelta:F2}）");
            }
            if (spinSpec != null)
            {
                if (!view) Line("转管：没有 rig，跳过");
                else
                {
                    Line($"转管：零件 {(spinner ? "已挂" : "没挂")}，骨骼 {spinSpec.bone} {(spinBone ? $"最大偏转 {spinMax:F0}°" : "没找到")}");
                    if (!spinner) Fail($"{def.name}：rig 上没有转管零件（BarrelSpinner）");
                    else if (!spinBone) Fail($"{def.name}：rig 里没有转管骨骼 {spinSpec.bone}");
                    else if (spinMax < 5) Fail($"{def.name}：开火时枪管骨骼没转（最大偏转 {spinMax:F1}°）");
                }
            }
            if (def.projectile != null && def.projectile.count > 1)
            {
                Line($"齐射：同时在飞最多 {maxLive} 枚（每扣 {def.projectile.count} 枚，追踪 {def.projectile.homing} rad/s）");
                if (maxLive < 2) Fail($"{def.name}：齐射时同时在飞的弹体最多只有 {maxLive} 枚");
            }
            if (flame) yield return FlameCase(def, inst, dummy, maxLive);

            int errs = logErrors - err0;
            Line($"{def.name}：报错 {errs}{(errs > 0 ? $"（最后一条：{lastError}）" : "")}");
            if (errs > 0) Fail($"{def.name}：期间有 {errs} 条运行时报错（最后一条：{lastError}）");
            csv.Add(string.Join(",", def.id, def.name, FireModes.Create(def).Id, F(window), F(dealt), F(dps), F(dpsNoCrit), hits, crits, fired,
                known ? F(ts) : "", known ? F(dpsNoCrit / ts) : "", inBand ? 1 : 0, errs));
            current = null;
            arena.Clear();
            yield return new WaitForSeconds(0.2f);
        }

        /// <summary>点射：扣一下（只按一帧）打出 burstCount 发</summary>
        IEnumerator BurstCase(WeaponDef def, WeaponInstance inst, EnemyAI dummy)
        {
            var wc = rig.weapons;
            ResetCounts(inst);
            AimAt(dummy);
            wc.testFire = true;
            yield return null;
            wc.testFire = false;
            for (float t = 0; t < 0.5f; t += Time.deltaTime)
            {
                AimAt(dummy);
                yield return null;
            }
            Line($"点射：扣一下打出 {fired} 发（应 {def.burstCount}）");
            if (fired != def.burstCount) Fail($"{def.name}：扣一下打出 {fired} 发（应 {def.burstCount}）");
            yield return WaitIdle(inst);
        }

        /// <summary>
        /// 狙击镜：开镜 → 视角层 &lt; −30°、零散布、遮罩亮、准星收、枪模隐藏；打一发后按换弹 → 退镜、遮罩灭、枪模复原
        /// </summary>
        IEnumerator ScopeCase(WeaponDef def, WeaponInstance inst, EnemyAI dummy, FirstPersonViewmodel view)
        {
            var wc = rig.weapons;
            var hud = Hud.Instance;
            var overlay = hud ? hud.Widget<ScopeOverlay>() : null;
            var xhair = hud ? hud.Widget<CrosshairWidget>() : null;
            var part = view ? view.GetComponent<SightPart>() : null;
            wc.testAim = true;
            for (float t = 0; t < 0.6f; t += Time.deltaTime)
            {
                AimAt(dummy);
                yield return null;
            }
            bool scoped = WeaponSight.Scoped(wc.FovKick);
            float spread = wc.HudSpread;
            bool hidden = !view || view.GetComponentsInChildren<Renderer>(true).All(r => !r.enabled);
            Line($"开镜：视角层 {wc.FovKick:F1}°（{(scoped ? "进镜" : "没进镜")}），散布 {spread:F4}，遮罩 {(overlay == null ? "（没有 HUD）" : overlay.Scoped ? "亮" : "灭")}，" +
                 $"准星 {(xhair == null ? "—" : xhair.Suppressed ? "收起" : "还在")}，枪模 {(view ? hidden ? "隐藏" : "还在" : "（没有 rig）")}");
            Shot(rig.cam, $"weapons_{def.id}_scope");
            if (!scoped) Fail($"{def.name}：按住开镜 0.6 s 后视角层 {wc.FovKick:F1}°，没进镜（应 < {WeaponSight.ScopeKick}）");
            if (spread > 0.002f) Fail($"{def.name}：进镜后散布 {spread:F4}（应为 0）");
            if (overlay != null && !overlay.Scoped) Fail($"{def.name}：进镜后狙击镜遮罩没亮");
            if (xhair != null && !xhair.Suppressed) Fail($"{def.name}：进镜后准星没收起");
            if (view && !hidden) Fail($"{def.name}：进镜后第一人称枪模没隐藏");
            if (view && (!part || !part.Hiding)) Fail($"{def.name}：rig 上的瞄具零件（SightPart）没有进入隐藏状态");

            // 打一发（隔帧点按），再按换弹
            wc.testFire = true;
            yield return null;
            wc.testFire = false;
            yield return new WaitForSeconds(0.25f);
            wc.testReload = true;
            for (float t = 0; t < 0.35f; t += Time.deltaTime)
            {
                AimAt(dummy);
                yield return null;
            }
            bool out1 = !WeaponSight.Scoped(wc.FovKick);
            bool shown = !view || view.GetComponentsInChildren<Renderer>(true).Any(r => r.enabled);
            Line($"换弹退镜：换弹中 {(wc.Reloading ? "是" : "否")}，视角层 {wc.FovKick:F1}°，遮罩 {(overlay == null ? "—" : overlay.Scoped ? "还亮" : "灭")}，枪模 {(shown ? "复原" : "仍隐藏")}");
            if (!wc.Reloading) Fail($"{def.name}：按换弹后没有开始换弹");
            if (!out1) Fail($"{def.name}：换弹时没有退镜（视角层 {wc.FovKick:F1}°）");
            if (overlay != null && overlay.Scoped) Fail($"{def.name}：换弹退镜后遮罩还亮着");
            if (!shown) Fail($"{def.name}：退镜后第一人称枪模没复原");
            if (xhair != null && xhair.Suppressed) Fail($"{def.name}：退镜后准星还收着");
            wc.testAim = false;
            yield return WaitIdle(inst);
        }

        /// <summary>火焰锥：测量期间不生成投射物；后排 2.5 m 的第二只木桩也被烧到（穿透）；墙后不烧（由锥长撞墙截短 + 视线保证，这里只记一行）</summary>
        IEnumerator FlameCase(WeaponDef def, WeaponInstance inst, EnemyAI front, int maxLive)
        {
            var wc = rig.weapons;
            Line($"火焰锥：测量期间投射物 {maxLive} 个（应 0），锥长 {FlameCone.Reach(new ShotContext { weapon = inst, stats = WeaponStatsResolver.Resolve(inst, rig.vitals.stats) }):F1} m");
            if (maxLive > 0) Fail($"{def.name}：喷火时生成了 {maxLive} 个投射物（应由 FlameCone 接管）");
            if (!front)
            {
                Fail($"{def.name}：前排木桩没了，穿透测不了");
                yield break;
            }
            // 第二只木桩：在前排身后 2.5 m（玩家 → 前排的延长线上）
            var away = rig.motor.transform.position - front.transform.position;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            var back = SpawnDummy(-away * 2.5f);
            yield return new WaitForSeconds(1f);
            if (!back)
            {
                Fail($"{def.name}：刷不出后排木桩");
                yield break;
            }
            Freeze(back);
            Stand(front, 4f);
            yield return WaitIdle(inst);
            ResetCounts(inst);
            inst.mag = WeaponStatsResolver.Resolve(inst, rig.vitals.stats).magCap;
            for (float t = 0; t < 1.5f; t += Time.deltaTime)
            {
                AimAt(front);
                wc.testFire = !wc.Reloading;
                yield return null;
            }
            wc.testFire = false;
            dealtBy.TryGetValue(front.Health, out var f);
            dealtBy.TryGetValue(back.Health, out var b);
            Line($"火焰穿透：前排 {f:F0}、后排 {b:F0}（穿透 {def.pierce}）");
            Shot(rig.cam, $"weapons_{def.id}_cone");
            if (!(f > 0)) Fail($"{def.name}：前排木桩没被烧到");
            if (def.pierce > 0 && !(b > 0)) Fail($"{def.name}：火焰没穿透烧到后排木桩");
        }

        // ───────────── 工具 ─────────────

        /// <summary>等这把枪闲下来（换弹 / 点射 / 齐射 / 切枪都结束）</summary>
        IEnumerator WaitIdle(WeaponInstance inst)
        {
            var wc = rig.weapons;
            float t0 = Time.time;
            while (Time.time - t0 < 5f && (wc.Reloading || wc.Machine.Busy || wc.SwitchTimer > 0)) yield return null;
            if (wc.Active == inst) inst.mag = WeaponStatsResolver.Resolve(inst, rig.vitals.stats).magCap;
        }

        /// <summary>
        /// 一轮「打空一匣 + 换弹」的估算（秒，游戏时间）：预热 + 弹匣 × 每发间隔（点射按每轮、齐射 / 半自动按每扣、蓄力按蓄满 + 冷却）+ 换弹（逐发 = 准备 + 每发 + 上膛）
        /// </summary>
        static float CycleEstimate(WeaponDef def, ResolvedWeapon R, bool melee)
        {
            if (melee || R.magCap <= 0) return MinWindow;
            float rate = Mathf.Max(0.1f, R.fireRate);
            float perAmmo = def.mode switch
            {
                FireMode.Burst => 1f / (rate * Mathf.Max(1, def.burstCount)),
                FireMode.Charge => 1f / rate + def.chargeTime / Mathf.Max(0.01f, R.fireRateMult),
                _ => 1f / rate,
            };
            float reload = WeaponStateMachine.IsShell(def) ? R.reloadStart + R.magCap * R.shellTime + WeaponTiming.ShellRack : R.reloadTime;
            return def.spinup + R.magCap * perAmmo + reload;
        }

        EnemyAI SpawnDummy(Vector3 offset)
        {
            var e = arena.Spawn(DummyId, false, offset);
            if (!e) return null;
            var h = e.Health;
            h.maxArmor = 0;
            h.maxShield = 0;
            h.maxHealth *= DummyHpMult;
            h.ResetVitals();
            return e;
        }

        /// <summary>定住木桩：停导航、停 AI（镇墓兽本身不吃击退）</summary>
        static void Freeze(EnemyAI ai)
        {
            if (!ai) return;
            var agent = ai.GetComponent<UnityEngine.AI.NavMeshAgent>();
            if (agent && agent.isOnNavMesh) agent.isStopped = true;
            ai.enabled = false;
        }

        /// <summary>站到 a 的 distance 米外（从它往出生点那一侧），面朝它</summary>
        void Stand(EnemyAI a, float distance)
        {
            if (!a) return;
            var away = spawnPos - a.transform.position;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            var p = a.transform.position + away * distance;
            if (Physics.Raycast(p + Vector3.up * 20, Vector3.down, out var hit, 60, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            rig.motor.Teleport(p);
            AimAt(a);
        }

        /// <summary>瞄木桩身体中心（每帧调 = 完美压枪）</summary>
        void AimAt(EnemyAI a)
        {
            if (a && a.Health) Aim(rig.motor, rig.eye ? rig.eye : rig.cam.transform, BodyCenter(a.Health));
        }

        static string F(float v) => v.ToString("0.###", CultureInfo.InvariantCulture);

        void WriteCsv()
        {
            if (string.IsNullOrEmpty(ResultPath)) return;
            try
            {
                var path = Path.Combine(Path.GetDirectoryName(ResultPath) ?? "", "weapons_dps.csv");
                File.WriteAllText(path, string.Join("\n", csv) + "\n", new UTF8Encoding(true));
                Line($"CSV：{path}");
            }
            catch (IOException e)
            {
                Line($"⚠ CSV 写不出来：{e.Message}");
            }
        }
    }
}
