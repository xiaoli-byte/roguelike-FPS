using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 第二章最常见的三种精英的出手节拍条（K 路，bridge.sh playtest beats-frost-elite；设计单 docs/art/vfx/elites-ch2.md）：
    /// 测试场里逐种刷一只精英（不掉血、玩家不还手），玩家站到能逼出那一招的位置，按状态拍
    ///   起手（前摇状态 0.06 s）/ 预警（前摇 70%）/ 释放帧（出手状态第 2 帧）/ 收招（之后 0.35 s 或收招状态）/ 第一人称（释放帧同一刻）。
    /// 夫诸 · 冰光、冰甲旋龟 · 缩壳旋转 + 冰喙猛啄、玄冰巨蟹 · 夹击（精英接横扫）。截图在 Assets/Art/_Review/beats/frost-elite/。
    /// </summary>
    public sealed class FrostEliteBeatsSuite : PlaytestSuite
    {
        public override string Id => "beats-frost-elite";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        sealed class Attack
        {
            public string enemy, key, label, windup, release, recover;
            /// <summary>玩家站在它正前方多远（米）</summary>
            public float stand;
        }

        static readonly Attack[] Table =
        {
            new() { enemy = "fuzhu", key = "fuzhu_beam", label = "夫诸 · 冰光（精英）", windup = "charge", release = "recover", stand = 16f },
            new() { enemy = "xuangui", key = "xuangui_spin", label = "冰甲旋龟 · 缩壳旋转（精英）", windup = "retract", release = "spin", recover = "overheat", stand = 13f },
            new() { enemy = "xuangui", key = "xuangui_peck", label = "冰甲旋龟 · 冰喙猛啄（精英）", windup = "peckWindup", release = "peck", stand = 2.8f },
            new() { enemy = "frost_crab", key = "crab_grab", label = "玄冰巨蟹 · 夹击（精英）", windup = "grabWindup", release = "grab", recover = "grabRecover", stand = 3.1f },
            new() { enemy = "frost_crab", key = "crab_sweep", label = "玄冰巨蟹 · 横扫（精英接招）", windup = "sweepWindup", release = "sweep", stand = 3.1f },
        };

        ArenaSpawner arena;
        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        KunPengBeatsSuite.Cam cam;
        Vector3 away;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail("缺少测试场组件");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            vitals.stats.Add("beats_frost", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            cam = new KunPengBeatsSuite.Cam("frost-elite", Path.Combine(ShotDir ?? "Assets/Art/_Review", "beats", "frost-elite"), "TestArena", weapons.eye, motor);
            try
            {
                string current = null;
                EnemyAI ai = null;
                IDisposable guard = null;
                foreach (var a in Table)
                {
                    if (!ArenaSpawner.IsRegistered(a.enemy)) continue;
                    if (a.enemy != current || !ai || ai.Dead)
                    {
                        guard?.Dispose();
                        arena.Clear();
                        AttackTokens.Reset();
                        PackCoordinator.Reset();
                        yield return new WaitForSeconds(0.3f);
                        Teleport(motor, arena.Center + away * 14f);
                        yield return null;
                        ai = arena.Spawn(a.enemy, true, Vector3.zero);
                        current = a.enemy;
                        if (!ai)
                        {
                            Fail($"刷不出精英 {a.enemy}");
                            continue;
                        }
                        guard = ai.Health.Incoming.Add((in IncomingHit h) => 0f);
                        yield return new WaitForSeconds(1.2f);
                    }
                    yield return Capture(ai, a);
                }
                guard?.Dispose();
                arena.Clear();
            }
            finally
            {
                vitals.stats.Remove("beats_frost");
                Line($"节拍条：{cam.Count} 张");
                cam.Dispose();
            }
        }

        IEnumerator Capture(EnemyAI ai, Attack a)
        {
            float t0 = Time.time;
            // 进来时它已经在前摇里（上一招的空档里自己出了手）：等这一下打完，拍下一次完整的
            while (ai && !ai.Dead && ai.State == a.windup && Time.time - t0 < 6f) yield return null;
            t0 = Time.time;
            // 站到它正前方 stand 米，直到它进入前摇（之后不动）
            while (ai && !ai.Dead && ai.State != a.windup && Time.time - t0 < 20f)
            {
                KeepAlive();
                var fwd = Flat(motor.transform.position - ai.transform.position);
                fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : away;
                var spot = ai.transform.position + fwd * a.stand;
                if ((Flat(motor.transform.position) - Flat(spot)).magnitude > 1.2f) Teleport(motor, spot);
                Aim(motor, weapons.eye.transform, BodyCenter(ai.Health));
                weapons.testFire = false;
                yield return null;
            }
            if (!ai || ai.State != a.windup)
            {
                Line($"{a.label}：20 s 没出（状态 {(ai ? ai.State : "无")}）");
                yield break;
            }
            float w0 = Time.time;
            float windupLen = -1;
            bool b0 = false, b1 = false, b2 = false, b3 = false;
            int relFrames = 0;
            float relAt = -1;
            t0 = Time.time;
            while (ai && !ai.Dead && Time.time - t0 < 8f && !b3)
            {
                KeepAlive();
                var c = BodyCenter(ai.Health);
                Aim(motor, weapons.eye.transform, c);
                float size = Mathf.Max(2.5f, ai.Health.GetComponent<Collider>() is { } col ? Mathf.Max(col.bounds.size.x, col.bounds.size.y) : 2f);
                string s = ai.State;
                if (s == a.windup)
                {
                    float st = Time.time - w0;
                    if (!b0 && st >= 0.06f)
                    {
                        b0 = true;
                        cam.Spec(a.key, a.label, "起手", 0, c, size, note: $"前摇 {st:F2} s");
                        cam.Spec(a.key, a.label, "起手（近景）", 5, c, size, false, note: $"前摇 {st:F2} s");
                    }
                    // 前摇长度要到出手才知道：按常见前摇 0.45–1.2 s 的 70% 取（夫诸 1.2、旋壳 0.8、啄 0.45、夹 0.6、扫 0.5）
                    float guess = a.windup switch { "charge" => 1.2f, "retract" => 0.8f, "peckWindup" => 0.45f, "grabWindup" => 0.6f, _ => 0.5f };
                    if (!b1 && st >= guess * 0.7f)
                    {
                        b1 = true;
                        cam.Spec(a.key, a.label, "预警", 1, c, size, note: $"前摇 {st:F2} s");
                        cam.Spec(a.key, a.label, "预警（近景）", 6, c, size, false, note: $"前摇 {st:F2} s");
                    }
                }
                else if (s == a.release || relAt >= 0)
                {
                    if (relAt < 0)
                    {
                        relAt = Time.time;
                        windupLen = relAt - w0;
                    }
                    relFrames++;
                    if (!b2 && relFrames >= 2)
                    {
                        b2 = true;
                        cam.Spec(a.key, a.label, "释放帧", 2, c, size, note: $"前摇 {windupLen:F2} s");
                        cam.Spec(a.key, a.label, "释放帧（近景）", 7, c, size, false, note: $"前摇 {windupLen:F2} s");
                        cam.Eye(a.key, a.label, "第一人称", 4, c, $"距玩家 {Vector3.Distance(Flat(c), Flat(motor.transform.position)):F1} m");
                    }
                    bool recover = a.recover != null ? s == a.recover && Time.time - relAt > 0.1f : Time.time - relAt >= 0.35f;
                    if (b2 && !b3 && (recover || Time.time - relAt >= 4f))
                    {
                        b3 = true;
                        cam.Spec(a.key, a.label, "收招", 3, c, size, note: $"出手后 {Time.time - relAt:F2} s（{s}）");
                    }
                }
                else if (s != a.windup && relAt < 0)
                {
                    Line($"{a.label}：前摇被打断（{s}）");
                    yield break;
                }
                yield return null;
            }
            Line($"{a.label}：前摇 {windupLen:F2} s，{(b0 ? "起手 " : "")}{(b1 ? "预警 " : "")}{(b2 ? "释放帧 " : "")}{(b3 ? "收招" : "")}");
            // 等它回到移动状态（旋龟翻身、巨蟹收钳）
            t0 = Time.time;
            while (ai && !ai.Dead && Time.time - t0 < 5f && ai.State != "advance" && ai.State != "move") yield return null;
        }

        void KeepAlive()
        {
            if (vitals.Dead) vitals.Revive();
            if (vitals.health < vitals.MaxHealth * 0.6f) vitals.Heal(99999);
        }

        static Vector3 Flat(Vector3 v) => new(v.x, 0, v.z);
    }
}
