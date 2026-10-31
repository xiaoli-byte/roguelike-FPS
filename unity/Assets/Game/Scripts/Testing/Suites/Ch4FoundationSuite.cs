using System;
using System.Collections;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 第四章地基的 Play 模式冒烟（bridge.sh playtest ch4-foundation；场景 TestArena；docs/unity-ch4-port.md 第 2 节，F 路）：
    ///   · 带电：挂上后身上的轮廓光亮起（边缘光，不染整只）；燎的火一碰带电的就执行一次焚雷；带电的被打死，电传给 8 m 内的同伴；
    ///   · 导体与落雷：落点 5 m 内有更高的导体就劈导体（句柄里就能看到），劈下时发 Landed、导体带电；没有导体的落在原地；撤回的不劈；
    ///   · 高原雷暴：入场条件没满足前不起，满足后渐入、主光压暗、按间隔落雷；End 之后渐出、退场回调、主光回到原值；
    ///   · 受击四层：韧性破 → 硬直（停摆、到点恢复）；眩晕 → 元素眩晕 + 受伤 ×1.25；
    ///   · 首领血条的破防金条：有破防条的数据源才显示这一行，填充跟着走，破防中满格；
    ///   · 风场：吸引点 + 推力把站着不动的玩家往吸引点推。
    /// 全程玩家无敌；敌人用第一章的鼠刃（行为不重要，只要是真的 EnemyAI / EnemyBody）。
    /// </summary>
    public sealed class Ch4FoundationSuite : PlaytestSuite
    {
        public override string Id => "ch4-foundation";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string Foe = "jerboa_blade";

        ArenaSpawner arena;
        PlayerMotor motor;
        PlayerVitals vitals;
        Vector3 spot, side;
        readonly List<GameObject> temp = new();

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} arena={arena}（场景不是 TestArena？）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            vitals.invulnerableUntil = Time.time + 9999f;
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            side = Vector3.Cross(Vector3.up, away);
            spot = Ground(arena.Center);

            yield return Run("带电", ChargeSteps());
            yield return Run("导体与落雷", StrikeSteps());
            yield return Run("高原雷暴", StormSteps());
            yield return Run("受击四层", HitLayerSteps());
            yield return Run("破防金条", BreakBarSteps());
            yield return Run("风场", WindSteps());

            foreach (var go in temp)
                if (go)
                    Destroy(go);
            temp.Clear();
            WindField.Reset();
            PlateauStorm.StopAll();
            LightningStrike.ClearAll();
            arena.Clear();
            vitals.invulnerableUntil = -1;
        }

        IEnumerator Run(string name, IEnumerator body)
        {
            Line($"── {name} ──");
            yield return body;
        }

        static Vector3 Ground(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 30f, Vector3.down, out var hit, 80f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point : p;

        EnemyAI Spawn(Vector3 offset, float hp = 5000)
        {
            var e = arena.Spawn(Foe, false, offset);
            if (!e)
            {
                Fail($"生成 {Foe} 失败");
                return null;
            }
            e.Health.maxHealth = hp;
            e.Health.ResetVitals();
            return e;
        }

        // ───────────── 带电 ─────────────

        IEnumerator ChargeSteps()
        {
            var a = Spawn(side * 6f);
            if (!a) yield break;
            yield return new WaitForSeconds(1.0f);
            Charge.Apply(a.Health, 6f);
            yield return null;
            yield return null;
            var cs = a.GetComponent<ChargeState>();
            if (!cs || !cs.Active) Fail("挂上带电后 ChargeState 不在 / 不算带电");
            else if (!cs.RimShowing) Fail("带电的轮廓光没亮");
            else Line($"✓ 带电：剩 {Charge.Remaining(a.Health):F1} s，轮廓光亮着");

            int before = ReactionSystem.Stats.executed[(int)DetonateOutcome.Thunderfire];
            Combat.ApplyElement(a.Health, Element.Fire, 40f);
            yield return new WaitForSeconds(0.3f);
            int after = ReactionSystem.Stats.executed[(int)DetonateOutcome.Thunderfire];
            if (after <= before) Fail("燎的火碰带电的没有焚雷");
            else Line($"✓ 火 + 带电 = 焚雷（执行 {after - before} 次）");

            // 传电：三只挤在一起，打死带电的那只
            var b = Spawn(side * -6f, 200);
            var c = Spawn(side * -6f + away() * 2.5f);
            var d = Spawn(side * -6f - away() * 2.5f);
            if (!b || !c || !d) yield break;
            yield return new WaitForSeconds(1.0f);
            int arced = 0;
            Action<Damageable, Damageable> h = (f, t) => arced++;
            Charge.Arced += h;
            Charge.Apply(b.Health, 6f);
            b.Health.Kill(DamageInfo.Simple(9999, DamageSource.Weapon, b.transform.position, Vector3.forward));
            yield return null;
            Charge.Arced -= h;
            int got = (Charge.IsCharged(c.Health) ? 1 : 0) + (Charge.IsCharged(d.Health) ? 1 : 0);
            if (arced < 2 || got < 2) Fail($"带电的被打死，电只传给了 {got} 只（事件 {arced} 次），要传给 8 m 内的 2 只");
            else Line($"✓ 电会传：打死带电的那只，2 只同伴带电（第 {c.GetComponent<ChargeState>()?.Hop} 跳）");
            yield return new WaitForSeconds(0.3f);
            arena.Clear();
            yield return new WaitForSeconds(0.3f);

            Vector3 away() => Vector3.Cross(side, Vector3.up);
        }

        // ───────────── 导体与落雷 ─────────────

        IEnumerator StrikeSteps()
        {
            var poleGo = new GameObject("Test Pole (ch4-foundation)");
            temp.Add(poleGo);
            poleGo.transform.position = Ground(spot + side * 3f);
            var pole = poleGo.AddComponent<Conductor>();
            pole.height = 8f;
            int landed = 0;
            StrikeInfo last = default;
            Action<StrikeInfo> h = s =>
            {
                landed++;
                last = s;
            };
            LightningStrike.Landed += h;
            try
            {
                var at = spot;
                var hd = LightningStrike.Strike(at, 0.6f, 3f, 0f, null);
                if (!hd.Alive) Fail("落雷句柄一出来就失效了");
                else if (hd.Conductor != pole) Fail($"落点 3 m 外有 8 m 高的导体，没被引走（引到 {hd.Conductor}）");
                else Line($"✓ 引雷：落点改到导体底下（离原点 {Vector3.Distance(hd.Point, at):F1} m）");
                yield return new WaitForSeconds(0.85f);
                if (landed != 1) Fail($"预警 0.6 s 后应该劈下 1 道，实际 {landed}");
                else if (last.conductor != pole || !pole.Charged) Fail($"劈下的不是导体 / 导体没带电（{last.conductor}，电量 {pole.charge:F2}）");
                else Line($"✓ 劈中导体：导体带电 {pole.charge:F2}，溅电半径 {last.radius} m");

                var far = Ground(spot - side * 18f);
                hd = LightningStrike.Strike(far, 0.4f, 3f, 0f, null);
                if (hd.Conductor) Fail("18 m 外没有导体也被引走了");
                yield return new WaitForSeconds(0.6f);
                if (landed != 2 || last.conductor || (last.point - far).sqrMagnitude > 0.5f) Fail($"没有导体的雷没落在原地（{landed} 道，{last.point}）");
                else Line("✓ 没有导体：落在原地");

                hd = LightningStrike.Strike(far, 0.8f, 3f, 0f, null);
                yield return new WaitForSeconds(0.2f);
                hd.Cancel();
                yield return new WaitForSeconds(0.9f);
                if (landed != 2) Fail("撤回的雷还是劈下来了");
                else Line("✓ 撤回：预警淡出、不劈");
            }
            finally
            {
                LightningStrike.Landed -= h;
            }
        }

        // ───────────── 高原雷暴 ─────────────

        IEnumerator StormSteps()
        {
            bool gate = false, entered = false, exited = false;
            int strikes = 0;
            var sun = RenderSettings.sun;
            float sun0 = sun ? sun.intensity : 0;
            var t = WeatherDirector.BeginPlateauStorm(new PlateauStormSpec
            {
                enterWhen = () => gate, onEnter = () => entered = true, onExit = () => exited = true, onStrike = s => strikes++,
                fadeIn = 0.6f, fadeOut = 0.6f, intervalMin = 0.3f, intervalMax = 0.5f, strikeMin = 10, strikeMax = 25, warn = 0.4f, damage = 0,
            });
            yield return new WaitForSeconds(0.5f);
            if (t.Stage != PlateauStorm.Stage.Waiting || PlateauStorm.Level > 0) Fail($"入场条件没满足就起了雷暴（{t.Stage}，{PlateauStorm.Level:F2}）");
            else Line("✓ 入场条件没满足：不起");
            gate = true;
            yield return new WaitForSeconds(1.0f);
            float lit = sun ? sun.intensity : 0;
            if (!entered || PlateauStorm.Level < 0.95f) Fail($"满足入场条件 1 s 后雷暴没起满（入场 {entered}，强度 {PlateauStorm.Level:F2}）");
            else if (sun && !(lit < sun0 * 0.6f)) Fail($"雷暴里主光没压暗（{sun0:F2} → {lit:F2}）");
            else Line($"✓ 渐入：强度 {PlateauStorm.Level:F2}，主光 {sun0:F2} → {lit:F2}");
            yield return new WaitForSeconds(2.0f);
            if (strikes < 1) Fail("雷暴里 2 s 没落一道雷");
            else Line($"✓ 按间隔落雷：{strikes} 道");
            t.End();
            yield return new WaitForSeconds(1.2f);
            if (!exited || PlateauStorm.Level > 0.001f) Fail($"End 之后没退场（回调 {exited}，强度 {PlateauStorm.Level:F2}）");
            else if (sun && Mathf.Abs(sun.intensity - sun0) > sun0 * 0.05f + 0.01f) Fail($"退场后主光没回来（{sun0:F2} → {sun.intensity:F2}）");
            else Line($"✓ 退场回调，主光回到 {(sun ? sun.intensity : 0):F2}");
            LightningStrike.ClearAll();
        }

        // ───────────── 受击四层 ─────────────

        IEnumerator HitLayerSteps()
        {
            var e = Spawn(side * 5f);
            if (!e) yield break;
            yield return new WaitForSeconds(1.0f);
            var p = e.gameObject.AddComponent<Poise>();
            p.poise = 40f;
            p.staggerSeconds = 0.8f;
            int staggers = 0, stuns = 0;
            e.HitLayerEntered += (ai, layer, s) =>
            {
                if (layer == HitLayer.Stagger) staggers++;
                if (layer == HitLayer.Stun) stuns++;
            };
            var c = BodyCenter(e.Health);
            var info = DamageInfo.Simple(30, DamageSource.Weapon, c, side);
            info.weakpoint = true;
            Combat.DamageEnemy(e.Health, info);
            yield return null;
            if (!e.HitStaggered || staggers != 1) Fail($"弱点 30 伤害（韧性伤害 ×2）没打破 40 的韧性（硬直 {e.HitStaggered}，事件 {staggers}）");
            else Line($"✓ 韧性破 → 硬直 {e.HitStaggerLeft:F2} s");
            yield return new WaitForSeconds(1.0f);
            if (e.HitStaggered) Fail("硬直 0.8 s 后还没恢复");
            else Line("✓ 硬直到点恢复");

            float hit0 = 0, hit1 = 0;
            Action<DamageInfo, DamageResult> rec = (i, r) => hit0 = r.total;
            e.Health.Damaged += rec;
            var plain = DamageInfo.Simple(10, DamageSource.Weapon, c, side);
            plain.noCrit = true;
            Combat.DamageEnemy(e.Health, plain);
            e.Health.Damaged -= rec;
            if (!e.HitStun(1.5f, HitCause.Counter, "测试")) Fail("眩晕没进");
            yield return null;
            var st = EnemyStatus.Of(e.Health);
            if (!st || !st.Stunned || stuns != 1) Fail($"眩晕入口没走元素眩晕（{(st ? st.Stunned : false)}，事件 {stuns}）");
            rec = (i, r) => hit1 = r.total;
            e.Health.Damaged += rec;
            Combat.DamageEnemy(e.Health, plain);
            e.Health.Damaged -= rec;
            float k = hit0 > 0 ? hit1 / hit0 : 0;
            if (Mathf.Abs(k - HitReaction.StunTakenMult) > 0.05f) Fail($"眩晕中受伤不是 ×1.25（{hit0:F1} → {hit1:F1}，×{k:F2}）");
            else Line($"✓ 眩晕：受伤 ×{k:F2}");
            yield return new WaitForSeconds(1.8f);
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
        }

        // ───────────── 破防金条 ─────────────

        sealed class ProbeLord : IBossBarSource, IBreakBarSource
        {
            readonly Damageable health;
            public readonly BreakBar bar = new(new BreakBarDef { max = 100, seconds = 1.5f, label = "破鼓" });

            public ProbeLord(Damageable health) => this.health = health;
            public Damageable BarHealth => health;
            public string BarTitle => "测试领主";
            public string BarSubtitle => null;
            public IReadOnlyList<float> BarThresholds => new[] { 0.66f, 0.33f };
            public bool BarInvulnerable => false;
            public BreakBar BarBreak => bar;
        }

        IEnumerator BreakBarSteps()
        {
            var hud = Hud.Instance;
            var bossBar = hud ? hud.Widget<BossBar>() : null;
            if (bossBar == null)
            {
                Fail("找不到首领血条");
                yield break;
            }
            var e = Spawn(side * 9f);
            if (!e) yield break;
            yield return new WaitForSeconds(1.0f);
            var probe = new ProbeLord(e.Health);
            GameUI.SetBoss(probe);
            yield return new WaitForSecondsRealtime(0.6f);
            if (!bossBar.BreakShown) Fail("有破防条的首领，血条下没有金条");
            probe.bar.Add(40);
            yield return new WaitForSecondsRealtime(0.2f);
            if (Mathf.Abs(bossBar.BreakFill - 0.4f) > 0.02f) Fail($"金条填充对不上（{bossBar.BreakFill:F2}，应为 0.40）");
            else Line("✓ 金条 0.40");
            probe.bar.Add(60);
            yield return new WaitForSecondsRealtime(0.2f);
            if (!probe.bar.Broken || bossBar.BreakFill < 0.999f) Fail("破防时金条没满格");
            else Line("✓ 破防：满格闪");
            yield return new WaitForSeconds(0.1f);
            var plainSrc = new DamageableBossSource(e.Health, "没有破防条");
            GameUI.SetBoss(plainSrc);
            yield return new WaitForSecondsRealtime(0.3f);
            if (bossBar.BreakShown) Fail("没有破防条的首领也画了金条（前三章应该不变）");
            else Line("✓ 没有破防条：不显示这一行");
            GameUI.SetBoss(null);
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
        }

        // ───────────── 风场 ─────────────

        IEnumerator WindSteps()
        {
            var start = motor.transform.position;
            var lair = start + side * 60f;
            var a = WindField.AddAttractor(lair, 200f, 1f, 40f);
            WindField.PlayerPush = 4f;
            var w = WindField.Sample(start);
            if (Vector3.Dot(w.dir, side) < 0.9f) Fail($"吸引点 60 m 外，风向没朝它（{w.dir}）");
            yield return new WaitForSeconds(1.5f);
            var moved = motor.transform.position - start;
            moved.y = 0;
            float along = Vector3.Dot(moved, side);
            if (along < 0.5f) Fail($"风速 4 m/s 下 1.5 s 只被吹了 {along:F2} m");
            else Line($"✓ 风把玩家往吸引点推了 {along:F1} m（风强 {w.strength:F2}）");
            a.Dispose();
            WindField.Reset();
            Teleport(motor, start);
            yield return new WaitForSeconds(0.3f);
        }
    }
}
