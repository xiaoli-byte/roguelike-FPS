using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 英雄冒烟（bridge.sh playtest heroes；场景 TestArena）：场景里烘好的玩家先撤掉，注册表里的每位英雄依次走 <see cref="PlayerFactory"/> 组装
    /// （同 SceneFlow 进关：Create → Bind → SystemsBootstrap → PetBootstrap），逐个检查：
    ///   · 组装：技能槽的英雄、Q / E / 被动齐全；生命 / 护盾 / 移速 / 其余基础属性（鼯的额外跳跃、磐的减伤）写进了属性表与运动组件；
    ///     手上是初始武器；初始武器那套第一人称 rig 下挂着这位英雄自己的左右手臂（截一张第一人称图）；
    ///   · 跳跃：用这位英雄实际的运动参数（含额外跳跃）逐帧模拟平地起跳——鼯二段跳 ≈ 2.7 m，没有额外跳跃的 ≈ 1.42 m（真实按键没法注入，所以模拟）；
    ///   · 滑翔：起跳 14 m/s，过了最高点一直「按住跳跃」（<see cref="Glide.TestHeld"/>）——鼯下落不超过 2.4 m/s，别人照常下坠；
    ///   · 滞空增伤：同一只靶子在地上 / 空中各吃一发 40 点武器伤害（不暴击），鼯空中 ×1.15，别人 ×1；
    ///   · 技能：Q / E 都能放出（扣充能、发 SkillUsed），各英雄的专项见 <see cref="FalconCase"/>（信标落地展开跳满 10 次并电到敌人；
    ///     雷目·裁决射速 +40%、无限弹药、命中弹射、8 s 后撤干净）；没有专项的英雄（燎）对着靶子放 E / Q，要打出技能伤害；
    ///   · 全程没有运行时报错（宿主另外记不合格，这里按英雄归账）。
    /// 靶子是两只生命 ×40 的跳鼠刀客（A 在台面中心，B 在旁边 3 m：雷目要 10 m 内的第二名敌人）；玩家全程无敌（受伤类检查临时关掉）。
    /// </summary>
    public sealed class HeroSuite : PlaytestSuite
    {
        public override string Id => "heroes";
        /// <summary>测试场（与编辑器里 Level_TestArena.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string DummyId = "jerboa_blade";
        const float DummyHpMult = 40f;

        ArenaSpawner arena;
        GameObject systems;
        PlayerRig rig;
        Vector3 spawnPos;
        Quaternion spawnRot;
        int logErrors;
        string lastError;
        int skillHits, shockSkillHits;
        float skillDamage;
        readonly List<SkillSlot> used = new();

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
            System.Action<SkillSlot, string> onUsed = (slot, _) => used.Add(slot);
            GameEvents.SkillUsed += onUsed;
            try
            {
                // 场景里烘好的玩家（燎）撤掉：每位英雄都按 HeroDef 重新组装
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

                foreach (var id in new[] { "fox", "falcon" })
                    if (HeroLibrary.Get(id) == null) Fail($"英雄 {id} 没有登记（Skills/Heroes/Hero_*.cs）");
                Line($"英雄：{string.Join("、", HeroLibrary.All.Select(h => $"{h.name}（{h.id}）"))}");
                foreach (var hero in HeroLibrary.All.ToList()) yield return HeroCase(hero);
            }
            finally
            {
                Glide.TestHeld = false;
                GameEvents.EnemyDamaged -= onHit;
                GameEvents.SkillUsed -= onUsed;
                Application.logMessageReceived -= OnLog;
            }
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnEnemyHit(in HitEvent e)
        {
            if (e.info.source != DamageSource.Skill || !(e.result.total > 0)) return;
            skillHits++;
            skillDamage += e.result.total;
            if (e.info.element == Element.Shock) shockSkillHits++;
        }

        // ───────────── 每位英雄 ─────────────

        IEnumerator HeroCase(HeroDef hero)
        {
            int err0 = logErrors;
            Line($"── {hero.name} · {hero.title}（{hero.id}）──");
            rig = PlayerFactory.Create(hero, spawnPos, spawnRot);
            PlayerFactory.Bind(systems, rig);
            SystemsBootstrap.Setup();
            PetBootstrap.Setup();
            yield return null;
            yield return null;
            CheckBuild(hero);
            Shot(rig.cam, $"heroes_{hero.id}");
            // 测试期间不掉血（受伤类检查临时关掉）
            rig.vitals.invulnerableUntil = Time.time + 9999;

            yield return JumpAndGlideCase(hero);

            // 两只靶子：A 在台面中心，B 在旁边 3 m
            var a = SpawnDummy(Vector3.zero);
            var b = SpawnDummy(new Vector3(3, 0, 0));
            yield return new WaitForSeconds(1f); // 出生 0.7 s 内不可选中
            if (!a || !b) Fail($"{hero.name}：刷不出靶子 {DummyId}");
            else
            {
                yield return AirBonusCase(hero, a);
                switch (hero.id)
                {
                    case "falcon":
                        yield return FalconCase(a);
                        break;
                    default:
                        yield return GenericCasts(hero, a);
                        break;
                }
            }

            int errs = logErrors - err0;
            Line($"{hero.name}：报错 {errs}{(errs > 0 ? $"（最后一条：{lastError}）" : "")}");
            if (errs > 0) Fail($"{hero.name}：期间有 {errs} 条运行时报错（最后一条：{lastError}）");

            // 收拾：靶子、信标、玩家
            arena.Clear();
            foreach (var tb in ThunderBeacon.Live.ToArray())
                if (tb) Destroy(tb.gameObject);
            Glide.TestHeld = false;
            rig.root.SetActive(false);
            Destroy(rig.root);
            rig = null;
            yield return new WaitForSeconds(0.3f);
        }

        void CheckBuild(HeroDef hero)
        {
            var v = rig.vitals;
            var m = rig.motor;
            var s = rig.skills;
            var w = rig.weapons;
            var problems = new List<string>();
            if (s.Hero != hero) problems.Add($"技能槽的英雄是 {s.Hero?.id ?? "无"}");
            if (s.primary == null || s.secondary == null) problems.Add("技能槽不全");
            if (string.IsNullOrEmpty(s.passiveName)) problems.Add("没有被动");
            if (!Approx(v.MaxHealth, hero.maxHp)) problems.Add($"生命上限 {v.MaxHealth}（应 {hero.maxHp}）");
            if (!Approx(v.MaxShield, hero.maxShield)) problems.Add($"护盾上限 {v.MaxShield}（应 {hero.maxShield}）");
            if (!Approx(m.walkSpeed, hero.moveSpeed)) problems.Add($"移速 {m.walkSpeed}（应 {hero.moveSpeed}）");
            foreach (var (stat, value) in hero.baseStats)
                if (!Approx(v.stats.Get(stat), value)) problems.Add($"{stat} = {v.stats.Get(stat)}（应 {value}）");
            int jumps = Mathf.Max(0, Mathf.RoundToInt(v.stats.Get(Stat.ExtraJumps)));
            if (m.airJumps != jumps) problems.Add($"motor.airJumps = {m.airJumps}（额外跳跃属性 {jumps}）");
            if (w.Active?.def.id != hero.startWeapon) problems.Add($"手上是 {w.Active?.def.id ?? "空"}（应为初始武器 {hero.startWeapon}）");
            var view = w.rigs.FirstOrDefault(r => r.weaponId == hero.startWeapon)?.view;
            if (!view) problems.Add("初始武器没有第一人称 rig（GameDatabase 里没有枪模？先 bridge.sh core）");
            else
            {
                var names = view.GetComponentsInChildren<Transform>(true).Select(t => t.name).ToHashSet();
                foreach (var arm in new[] { hero.armR, hero.armL })
                    if (!names.Contains(arm)) problems.Add($"第一人称手臂 {arm} 没挂上（GameDatabase 里没有？先 bridge.sh core）");
            }
            Line($"组装：生命 {v.MaxHealth} / 护盾 {v.MaxShield} / 移速 {m.walkSpeed} / 额外跳跃 {m.airJumps} / 减伤 {v.stats.Get(Stat.DamageReduction) * 100:F0}%，" +
                 $"武器 {w.Active?.def.name}，手臂 {hero.armR}；Q {s.primary?.name}，E {s.secondary?.name}，被动 {s.passiveName}");
            foreach (var p in problems) Fail($"{hero.name}：{p}");
        }

        // ───────────── 跳跃 / 滑翔 / 滞空 ─────────────

        IEnumerator JumpAndGlideCase(HeroDef hero)
        {
            var m = rig.motor;
            // 二段跳：真实按键注入不了，用这位英雄运动组件此刻的参数（含 airJumps）在平地上逐帧模拟
            float peak = JumpPeak(m.Core.t);
            bool canAirJump = m.airJumps > 0;
            Line($"跳跃（按实际运动参数模拟，最高点按一次跳）：最高 {peak:F2} m，额外跳跃 {m.airJumps}");
            if (canAirJump && peak < 2.4f) Fail($"{hero.name}：有额外跳跃，但二段跳最高只有 {peak:F2} m（应 ≈ 2.7）");
            if (!canAirJump && peak > 1.6f) Fail($"{hero.name}：没有额外跳跃，却跳到了 {peak:F2} m");
            if (hero.id == "falcon" && !canAirJump) Fail("鼯没有二段跳");

            // 滑翔：14 m/s 起跳（约 0.54 s 到最高点 3.8 m），一直「按住跳跃」
            yield return WaitGrounded(m, 2f);
            bool glider = hero.CreatePassive() is FalconSkyborne;
            m.Launch(Vector3.up * 14f);
            Glide.TestHeld = true;
            float t0 = Time.time, worst = 0;
            bool glided = false;
            while (Time.time - t0 < 3.5f)
            {
                yield return null;
                float t = Time.time - t0;
                if (t > 0.25f && m.Grounded) break;
                if (t > 0.85f) worst = Mathf.Min(worst, m.Velocity.y);
                if (m.Frame.maxFallSpeed < 3f) glided = true;
            }
            float air = Time.time - t0;
            Glide.TestHeld = false;
            Line($"滑翔（按住跳跃）：{(glided ? "张开" : "没张开")}，下落最快 {-worst:F1} m/s，滞空 {air:F1} s");
            if (glider)
            {
                if (!glided) Fail($"{hero.name}：按住跳跃下落时没有滑翔");
                if (worst < -Glide.FallSpeed - 0.2f) Fail($"{hero.name}：滑翔时下落 {-worst:F1} m/s（应 ≤ {Glide.FallSpeed}）");
            }
            else if (glided || worst > -3f) Fail($"{hero.name}：不是鼯却在滑翔（下落最快 {-worst:F1} m/s）");
            yield return WaitGrounded(m, 4f);
        }

        /// <summary>同一只靶子在地上 / 空中各吃一发 40 点武器伤害（不暴击）：鼯空中 ×1.15，别人 ×1</summary>
        IEnumerator AirBonusCase(HeroDef hero, EnemyAI a)
        {
            var m = rig.motor;
            var hp = a.Health;
            DamageResult Hit()
            {
                var info = DamageInfo.Simple(40, DamageSource.Weapon, BodyCenter(hp), Vector3.forward);
                info.noCrit = true;
                return Combat.DamageEnemy(hp, info);
            }
            yield return WaitGrounded(m, 2f);
            var ground = Hit();
            m.Launch(Vector3.up * 10f);
            yield return new WaitForSeconds(0.2f);
            bool airborne = !m.Grounded;
            var high = Hit();
            float want = hero.CreatePassive() is FalconSkyborne ? 1 + FalconSkills.AirBonus : 1f;
            float ratio = ground.total > 0 ? high.total / ground.total : 0;
            Line($"滞空增伤：地上 {ground.total:F1}、空中 {high.total:F1}（×{ratio:F3}，应 ×{want:F2}）");
            if (!airborne) Fail($"{hero.name}：起跳 0.2 s 后还在地上");
            else if (!(ground.total > 0)) Fail($"{hero.name}：靶子没吃到伤害（不可选中？）");
            else if (ground.layer == high.layer && Mathf.Abs(ratio - want) > 0.02f) Fail($"{hero.name}：空中伤害 ×{ratio:F3}（应 ×{want:F2}）");
            yield return WaitGrounded(m, 3f);
        }

        // ───────────── 技能 ─────────────

        /// <summary>没有专项的英雄：对着 A 放 E，再放 Q，要扣充能、发 SkillUsed、打出技能伤害</summary>
        IEnumerator GenericCasts(HeroDef hero, EnemyAI a)
        {
            Stand(a, 7f);
            yield return null;
            int hits0 = skillHits;
            float dmg0 = skillDamage;
            yield return Cast(SkillSlot.Secondary, a);
            yield return new WaitForSeconds(1f);
            yield return Cast(SkillSlot.Primary, a);
            float t0 = Time.time;
            while (Time.time - t0 < 4f)
            {
                if (a && a.Health) Aim(rig.motor, rig.cam.transform, BodyCenter(a.Health));
                yield return null;
            }
            Line($"技能伤害：{skillHits - hits0} 次，共 {skillDamage - dmg0:F0}");
            if (skillHits == hits0) Fail($"{hero.name}：对着靶子放了 E / Q，没有打出技能伤害");
        }

        /// <summary>按一次技能键：要放得出来（扣一层充能、发 SkillUsed）</summary>
        IEnumerator Cast(SkillSlot slot, EnemyAI aimAt)
        {
            var s = rig.skills;
            var skill = s.Get(slot);
            if (skill == null)
            {
                Fail($"{s.Hero?.name}：{slot} 槽是空的");
                yield break;
            }
            if (aimAt && aimAt.Health) Aim(rig.motor, rig.cam.transform, BodyCenter(aimAt.Health));
            int charges = skill.charges;
            used.Clear();
            if (slot == SkillSlot.Primary) s.testQ = true;
            else s.testE = true;
            yield return null;
            yield return null;
            bool ok = used.Contains(slot);
            Line($"{(slot == SkillSlot.Primary ? "Q" : "E")} {skill.name}：{(ok ? "放出" : "没放出")}，充能 {charges} → {skill.charges}");
            if (!ok) Fail($"{s.Hero?.name}：{skill.name} 没放出来（没有 SkillUsed）");
            else if (skill.charges != charges - 1) Fail($"{s.Hero?.name}：{skill.name} 放出后充能 {charges} → {skill.charges}（应 −1）");
        }

        /// <summary>
        /// 鼯：E 雷鼓信标对着 A 扔，落地展开后玩家站到信标旁边（两只靶子追过来），跳满 10 次、电到敌人、5 s 后收起；
        /// Q 雷目·裁决：射速 +40%、无限弹药，开火 2.5 s 弹匣不减、命中弹射到 B，8 s 后加成全部撤掉
        /// </summary>
        IEnumerator FalconCase(EnemyAI a)
        {
            var s = rig.skills;
            var m = rig.motor;
            var v = rig.vitals;
            var w = rig.weapons;
            var eye = rig.cam.transform;

            // ── E：雷鼓信标 ──
            Stand(a, 6f);
            yield return null;
            int shock0 = shockSkillHits;
            yield return Cast(SkillSlot.Secondary, a);
            ThunderBeacon beacon = null;
            float t0 = Time.time;
            while (Time.time - t0 < 3f && !(beacon = ThunderBeacon.Live.LastOrDefault())) yield return null;
            if (!beacon) Fail("雷鼓信标 3 s 内没有展开");
            else
            {
                var at = beacon.transform.position;
                Line($"信标：展开在离 A {(a ? Vector3.Distance(at, a.transform.position) : -1):F1} m 处，半径 {beacon.EffectRadius:F1} m");
                // 玩家站到信标旁，靶子追过来进范围
                var side = at - arena.Center;
                side.y = 0;
                Place(at + (side.sqrMagnitude > 0.01f ? side.normalized : Vector3.back) * 2f);
                int zaps = 0, hits = 0;
                float t1 = Time.time;
                while (beacon && Time.time - t1 < 7f)
                {
                    zaps = beacon.Zaps;
                    hits = beacon.Hits;
                    yield return null;
                }
                Line($"信标：跳 {zaps} 次，电到 {hits} 次，雷电技能命中 {shockSkillHits - shock0} 次，{(beacon ? "没有收起" : "已收起")}");
                if (beacon) Fail("雷鼓信标 5 s 后没有收起");
                if (zaps != 10) Fail($"雷鼓信标跳了 {zaps} 次（应 10：0.25 s 起每 0.5 s 一跳）");
                if (hits == 0) Fail("雷鼓信标一个敌人都没电到");
            }

            // ── Q：雷目·裁决 ──
            if (s.primary is not FalconHawkVerdict q)
            {
                Fail($"鼯的 Q 是 {s.primary?.GetType().Name}");
                yield break;
            }
            float rate0 = v.stats.Get(Stat.FireRatePct);
            Stand(a, 8f);
            yield return Cast(SkillSlot.Primary, a);
            float rate1 = v.stats.Get(Stat.FireRatePct);
            bool infinite = w.InfiniteAmmo;
            if (!q.Active) Fail("雷目·裁决放出后没有生效");
            if (!Approx(rate1 - rate0, FalconHawkVerdict.FireRate)) Fail($"雷目·裁决射速 +{rate1 - rate0:F2}（应 +{FalconHawkVerdict.FireRate}）");
            if (!infinite) Fail("雷目·裁决期间不是无限弹药");
            int mag0 = w.Active.mag;
            t0 = Time.time;
            while (Time.time - t0 < 2.5f)
            {
                if (a && a.Health && !a.Dead)
                {
                    var aim = BodyCenter(a.Health);
                    Aim(m, eye, aim);
                    if (Vector3.Distance(eye.position, aim) > 12f || Combat.Blocked(eye.position, aim, null)) Stand(a, 7f);
                }
                // 半自动枪要一下一下扣
                w.testFire = w.Active.def.mode != FireMode.Semi || !w.testFire;
                yield return null;
            }
            w.testFire = false;
            int mag1 = w.Active.mag;
            Line($"雷目·裁决：射速 +{(rate1 - rate0) * 100:F0}%，无限弹药 {(infinite ? "是" : "否")}，开火 2.5 s 弹匣 {mag0} → {mag1}，弹射 {q.Chains} 道");
            if (mag1 < mag0) Fail($"雷目·裁决期间开火消耗了弹匣（{mag0} → {mag1}）");
            if (q.Chains == 0) Fail("雷目·裁决：武器命中没有弹射闪电（B 在 10 m 内？）");
            t0 = Time.time;
            while (q.Active && Time.time - t0 < FalconHawkVerdict.Duration + 1) yield return null;
            float rate2 = v.stats.Get(Stat.FireRatePct);
            Line($"雷目·裁决结束：{(q.Active ? "还在生效" : "已结束")}，射速 {rate2:F2}（开始前 {rate0:F2}），无限弹药 {(w.InfiniteAmmo ? "是" : "否")}");
            if (q.Active) Fail("雷目·裁决 8 s 后没有结束");
            if (!Approx(rate2, rate0)) Fail("雷目·裁决结束后射速加成没撤");
            if (w.InfiniteAmmo) Fail("雷目·裁决结束后还是无限弹药");
        }

        // ───────────── 工具 ─────────────

        EnemyAI SpawnDummy(Vector3 offset)
        {
            var e = arena.Spawn(DummyId, false, offset);
            if (!e) return null;
            e.Health.maxHealth *= DummyHpMult;
            e.Health.ResetVitals();
            return e;
        }

        /// <summary>站到 A 的 distance 米外（从刷怪台中心往出生点那一侧），面朝它</summary>
        void Stand(EnemyAI a, float distance)
        {
            if (!a) return;
            var away = spawnPos - a.transform.position;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            Place(a.transform.position + away * distance);
            if (a.Health) Aim(rig.motor, rig.cam.transform, BodyCenter(a.Health));
        }

        /// <summary>传送到 p 正下方的地面（清空速度、冲刺、缓冲）</summary>
        void Place(Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 20, Vector3.down, out var hit, 60, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            rig.motor.Teleport(p);
        }

        static IEnumerator WaitGrounded(PlayerMotor m, float limit)
        {
            float t0 = Time.time;
            while (m && !m.Grounded && Time.time - t0 < limit) yield return null;
        }

        static bool Approx(float a, float b) => Mathf.Abs(a - b) <= 1e-3f;

        /// <summary>平地上起跳、在最高点再按一次跳（有额外跳跃就是二段跳），返回最高点（同 MotorTests 的平地世界）</summary>
        static float JumpPeak(MotorTuning t)
        {
            const float dt = 1 / 60f;
            var c = new MotorCore { t = t };
            c.ResetMotion(true);
            float y = 0, top = 0;
            bool second = false;
            for (int i = 0; i < 600; i++)
            {
                bool press = i == 0;
                if (i > 0 && !second && c.velocity.y <= 0)
                {
                    press = true;
                    second = true;
                }
                var input = new MotorInput { facing = Vector3.forward, jumpPressed = press, jumpHeld = press };
                var f = MotorFrame.Neutral(t);
                f.grounded = c.grounded;
                f.velocity = c.velocity;
                f.dashing = c.dashing;
                f.jumpPressed = f.jumpHeld = press;
                f.dt = dt;
                var r = c.Step(input, f, dt);
                float ny = y + r.delta.y;
                bool ground = ny <= 0;
                if (ground) ny = 0;
                c.AfterMove(new MotorFeedback { touching = ground, groundNormal = Vector3.up, intended = r.delta, actual = new Vector3(r.delta.x, ny - y, r.delta.z) },
                    dt, out _);
                y = ny;
                top = Mathf.Max(top, y);
                if (i > 2 && c.grounded) break;
            }
            return top;
        }
    }
}
