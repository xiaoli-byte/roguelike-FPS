using System.Collections;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 碎刃第一人称（WC7，bridge.sh playtest blade-fp；场景 TestArena）。按默认英雄重新组装玩家、发碎刃、2.6 m 外放一只定住的跳鼠刀兵当木桩（个子小，不挡第一人称画面），逐段截第一人称图并核对：
    ///   · 视图是 <see cref="BladeView"/>、英雄左右手都挂上、碎刃的 W4 rig 藏着；待机图；
    ///   · 三段斩（慢放 ×0.15 截图）：每段在蓄势末、判定帧、收势各拍一张；判定帧事件每段派发一次、刀光有采样且出刀时满亮（≥ 0.8）、第三段刀身伸到 ≥ 2 倍；
    ///   · 剑指：按住右键千刃出窍——左手抬起（≥ 0.9）、碎片离刀；刃群成形后再拍一张；
    ///   · 归位：松开右键——碎片按原位飞回，归位闪亮起（光点 ≥ 5 颗），1.5 s 内全部回到刀身；
    ///   · 立掌 / 举手（屏障、聚合在 TestMode 下按不出来）：强制手势各拍一张；
    ///   · 实速连斩 2 s（全局顿帧开着）：打中木桩、触发过顿帧；
    ///   · 切回 1 号槽：收枪阶段刀还在、跟着沉下去，之后整个视图藏起来；
    ///   · 全程没有运行时报错。
    /// </summary>
    public sealed class BladeFpSuite : PlaytestSuite
    {
        public override string Id => "blade-fp";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string DummyId = "jerboa_blade";
        const float Distance = 2.6f, SlowMo = 0.15f;

        ArenaSpawner arena;
        PlayerRig rig;
        EnemyAI dummy;
        int logErrors;
        string lastError;

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
            TimeScaleArbiter.Handle slow = null;
            try
            {
                var baked = FindAnyObjectByType<PlayerVitals>();
                var spawnPos = arena.playerSpawn ? arena.playerSpawn.position : baked ? baked.transform.position : arena.Center + Vector3.back * 12;
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
                var wc = rig.weapons;

                // ── 发刀 ──
                var def = WeaponLibrary.Get(DemonBladeDef.WeaponId);
                if (def == null)
                {
                    Fail("武器表里没有碎刃");
                    yield break;
                }
                var inst = new WeaponInstance(def);
                wc.Give(inst);
                yield return new WaitForSeconds(0.9f);
                var ctl = DemonBladeController.Instance;
                var view = BladeView.Current;
                Line($"英雄 {hero.name}；当前武器 {wc.Active?.def.id}；控制器 {(ctl ? ctl.Active ? "已接管" : "没接管" : "没有")}；视图 {(view ? view.GetType().Name : "没有")}");
                if (wc.Active != inst || !ctl || !ctl.Active)
                {
                    Fail("碎刃发到手上后没有被 DemonBladeController 接管");
                    yield break;
                }
                if (!view || !view.isActiveAndEnabled)
                {
                    Fail("第一人称不是 BladeView（或没显示）");
                    yield break;
                }
                Line($"手臂：右手 {(view.HasRightArm ? "已挂" : "没挂")}，左手 {(view.HasLeftArm ? "已挂" : "没挂")}（{hero.armR} / {hero.armL}）");
                if (!view.HasRightArm || !view.HasLeftArm) Fail($"英雄手臂没挂上（{hero.armR} / {hero.armL}）");
                var w4 = wc.rigs.FirstOrDefault(r => r != null && r.weaponId == def.id)?.view;
                bool w4Hidden = !w4 || w4.GetComponentsInChildren<Renderer>(true).All(r => !r.enabled);
                Line($"碎刃的 W4 rig：{(w4 ? w4Hidden ? "已藏" : "还看得见" : "没有")}");
                if (!w4Hidden) Fail("碎刃的 W4 rig 没藏起来（切走时会露出一把没有姿态的刀）");
                Shot(rig.cam, "blade_fp_idle");

                // ── 木桩 ──
                dummy = arena.Spawn(DummyId, false, Vector3.zero);
                yield return new WaitForSeconds(1f);
                if (!dummy)
                {
                    Fail($"刷不出木桩 {DummyId}");
                    yield break;
                }
                var h = dummy.Health;
                h.maxArmor = 0;
                h.maxShield = 0;
                h.maxHealth *= 400;
                h.ResetVitals();
                Freeze(dummy);
                Stand(dummy, Distance, spawnPos);
                for (int i = 0; i < 20; i++)
                {
                    AimAt();
                    yield return null;
                }

                // ── 三段斩（慢放截图）──
                slow = TimeScaleArbiter.Request(this, SlowMo, TimeScaleArbiter.Priority.HitStop - 50);
                for (int seg = 0; seg < 3; seg++) yield return SlashCase(seg, view);
                slow.Scale = 1;
                yield return new WaitForSeconds(0.8f);

                // ── 剑指（千刃出窍）──
                wc.testAim = true;
                float t0 = Time.time;
                bool shotOut = false;
                int maxAway = 0;
                while (Time.time - t0 < 1.2f)
                {
                    AimAt();
                    var sh = ctl.Shards;
                    int away = sh != null ? sh.AwayCount() : 0;
                    maxAway = Mathf.Max(maxAway, away);
                    if (!shotOut && Time.time - t0 > 0.18f)
                    {
                        Shot(rig.cam, "blade_fp_point");
                        shotOut = true;
                        Line($"剑指（出窍 0.18 s）：左手 {view.LeftHand:F2}，离刀 {away} 片，指尖 {view.FingerTip}");
                    }
                    yield return null;
                }
                Shot(rig.cam, "blade_fp_point_formed");
                Line($"剑指（1.2 s）：模式 {ctl.Mode}，左手 {view.LeftHand:F2}，最多离刀 {maxAway} 片，成形 {ctl.Shards?.FormedFraction():P0}");
                if (view.LeftHand < 0.9f) Fail($"千刃出窍时左手没抬起来（{view.LeftHand:F2}）");
                if (maxAway < 100) Fail($"千刃出窍 1.2 s 内只有 {maxAway} 片离刀");

                // ── 归位 ──
                wc.testAim = false;
                t0 = Time.time;
                int maxGlints = 0;
                bool shotBack = false;
                bool allHome = false;
                while (Time.time - t0 < 1.5f)
                {
                    AimAt();
                    int g = view.Glints ? view.Glints.LastCount : 0;
                    maxGlints = Mathf.Max(maxGlints, g);
                    // 归位闪按刀身分段合成（BladeView.GlintSegs = 6 段），再加剑指指尖一颗：亮到 4 颗就是大半把刀在闪
                    if (!shotBack && g >= 4)
                    {
                        Shot(rig.cam, "blade_fp_recall");
                        shotBack = true;
                    }
                    if (ctl.Shards != null && ctl.Shards.AllHome())
                    {
                        allHome = true;
                        if (shotBack) break;
                    }
                    yield return null;
                }
                if (!shotBack) Shot(rig.cam, "blade_fp_recall");
                Line($"归位：{(allHome ? "全部回到刀身" : "没回齐")}（{Time.time - t0:F2} s），归位闪最多 {maxGlints} 颗，左手 {view.LeftHand:F2}");
                if (!allHome) Fail("松开右键 1.5 s 内碎片没有全部归位");
                if (maxGlints < 3) Fail($"归位闪只亮了 {maxGlints} 颗（刀身分 6 段合成，应至少亮 3 段）");
                yield return new WaitForSeconds(0.4f);

                // ── 立掌 / 举手（强制手势）──
                foreach (var g in new[] { BladeGesture.Shield, BladeGesture.Raise })
                {
                    BladeView.GestureOverride = g;
                    for (float t = 0; t < 0.45f; t += Time.deltaTime)
                    {
                        AimAt();
                        yield return null;
                    }
                    Shot(rig.cam, $"blade_fp_{g.ToString().ToLowerInvariant()}");
                    Line($"手势 {g}：左手 {view.LeftHand:F2}");
                    if (view.LeftHand < 0.7f) Fail($"手势 {g} 时左手没抬起来（{view.LeftHand:F2}）");
                }
                BladeView.GestureOverride = null;
                yield return new WaitForSeconds(0.4f);

                // ── 实速连斩 ──
                int strikes0 = view.StrikeEvents;
                float hp0 = h.health;
                bool stopped = false;
                wc.testFire = true;
                for (float t = 0; t < 2f; t += Time.deltaTime)
                {
                    AimAt();
                    stopped |= HitStop.Active;
                    yield return null;
                }
                wc.testFire = false;
                yield return new WaitForSeconds(0.6f);
                int strikes = view.StrikeEvents - strikes0;
                Line($"实速连斩 2 s：判定帧事件 {strikes} 次，木桩掉血 {hp0 - h.health:F0}，顿帧 {(stopped ? "触发过" : "没触发")}");
                if (strikes < 4) Fail($"实速连斩 2 s 只派发了 {strikes} 次判定帧事件");
                if (!(hp0 - h.health > 0)) Fail("实速连斩没打中木桩");

                // ── 切走：跟着收枪沉下去，之后藏起来 ──
                wc.testSwitch = 0;
                yield return null;
                yield return null;
                bool visibleWhileHolster = view && view.isActiveAndEnabled;
                if (visibleWhileHolster) Shot(rig.cam, "blade_fp_holster");
                for (float t = 0; t < 0.8f; t += Time.deltaTime) yield return null;
                bool hidden = !view || !view.gameObject.activeInHierarchy;
                Line($"切回 1 号槽：收枪阶段刀 {(visibleWhileHolster ? "还在（沉下去）" : "已消失")}，0.8 s 后视图 {(hidden ? "已藏" : "还显示")}，当前武器 {wc.Active?.def.id}");
                if (!visibleWhileHolster) Fail("切走碎刃的收枪阶段刀直接消失了（应跟着沉下去）");
                if (!hidden) Fail("切走碎刃之后第一人称刀还显示着");
            }
            finally
            {
                BladeView.GestureOverride = null;
                slow?.Dispose();
                if (rig != null && rig.weapons)
                {
                    rig.weapons.testFire = false;
                    rig.weapons.testAim = false;
                }
                Application.logMessageReceived -= OnLog;
            }
            Line($"报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
            if (logErrors > 0) Fail($"期间有 {logErrors} 条运行时报错（最后一条：{lastError}）");
        }

        /// <summary>一段斩击：按一下左键，慢放中在蓄势末 / 判定帧 / 收势各拍一张，核对判定帧事件、刀光、伸刃</summary>
        IEnumerator SlashCase(int seg, BladeView view)
        {
            var wc = rig.weapons;
            var ctl = DemonBladeController.Instance;
            // 等上一段结束（还在挥砍就等它收完，连段计时 0.6 s 内）
            for (float t = 0; t < 1.5f && view.Swing >= 0; t += Time.unscaledDeltaTime) yield return null;
            int strikes0 = view.StrikeEvents;
            var clip = new BladeSwingClip(seg, ctl.Weapon?.def.blade?.combo[seg], true);
            AimAt();
            wc.testFire = true;
            yield return null;
            wc.testFire = false;
            float[] marks = { clip.WindupP * 0.92f, clip.HitP, 0.62f };
            string[] names = { "a_windup", "b_strike", "c_follow" };
            int next = 0;
            float maxStretch = 0, peak = 0;
            int trailAtStrike = 0;
            bool started = false;
            for (float t = 0; t < 3f; t += Time.unscaledDeltaTime)
            {
                AimAt();
                if (view.Swing == seg) started = true;
                if (started)
                {
                    maxStretch = Mathf.Max(maxStretch, view.StretchNow);
                    peak = Mathf.Max(peak, view.Trail ? view.Trail.PeakBrightness : 0);
                    while (next < marks.Length && (view.VisualProgress >= marks[next] || view.Swing != seg))
                    {
                        Shot(rig.cam, $"blade_fp_slash{seg + 1}_{names[next]}");
                        if (next == 1) trailAtStrike = view.Trail ? view.Trail.Count : 0;
                        next++;
                    }
                    if (next >= marks.Length && view.Swing != seg) break;
                }
                yield return null;
            }
            int strikes = view.StrikeEvents - strikes0;
            Line($"第 {seg + 1} 段：开始 {(started ? "是" : "否")}，判定帧事件 {strikes} 次（剪辑判定帧 {clip.strikeTime:F3} s / 时长 {clip.duration:F2} s），" +
                 $"判定帧时刀光 {trailAtStrike} 个采样、峰值亮度 {peak:F2}，最大伸刃 {maxStretch:F2}");
            if (!started) Fail($"第 {seg + 1} 段没开始（当前段 {view.Swing}）");
            if (strikes != 1) Fail($"第 {seg + 1} 段派发了 {strikes} 次判定帧事件（应 1）");
            if (trailAtStrike < 2) Fail($"第 {seg + 1} 段判定帧时刀光只有 {trailAtStrike} 个采样");
            if (peak < 0.8f) Fail($"第 {seg + 1} 段出刀时刀光峰值亮度 {peak:F2}（应 ≥ 0.8：挥得快就更亮）");
            if (seg == 2 && maxStretch < 2f) Fail($"第三段刀身只伸到 {maxStretch:F2} 倍（应 ≥ 2）");
            if (seg < 2 && maxStretch > 1.1f) Fail($"第 {seg + 1} 段刀身伸到了 {maxStretch:F2} 倍（只有第三段伸刃）");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

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

        void Stand(EnemyAI a, float distance, Vector3 from)
        {
            var away = from - a.transform.position;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            var p = a.transform.position + away * distance;
            if (Physics.Raycast(p + Vector3.up * 20, Vector3.down, out var hit, 60, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            rig.motor.Teleport(p);
            AimAt();
        }

        void AimAt()
        {
            if (dummy && dummy.Health) Aim(rig.motor, rig.eye ? rig.eye : rig.cam.transform, BodyCenter(dummy.Health));
        }
    }
}
