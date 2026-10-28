using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 特效打磨 B 路的审阅截图（bridge.sh playtest fx-blast；场景 TestArena）：爆炸 / 元素反应 / 状态外观 / 护盾护甲 / 火舌 / 出生死亡。
    /// 截图名一律 fxb_ 开头（不和 fx 套件的 fx_ 撞名），改前 / 改后各跑一次，拼图由 scripts/unity/fx_polish_b.py 生成到 docs/art/review/fx-polish/B/。
    /// 时间走 Time.captureDeltaTime = 1/60（每帧固定推进 1/60 s）：截图编码再慢也不会让序列帧的时间点跳掉。
    ///   爆炸：小（0.8 m，弹丸）/ 中（3 m，榴弹）/ 大（7 m，首领技能）三档，各拍 0.05 / 0.15 / 0.3 / 0.6 / 1.1 s 五帧（固定侧机位）；
    ///   反应：熔金 / 焚雷 / 封脉 / 归墟 / 崩解各拍「闪光 · 冲击波 · 余韵」三帧；
    ///   状态：灼烧 / 感电 / 蚀化 / 眩晕 / 减速 五只靶子，第一人称 18 m 远景一张 + 每只近景一张；
    ///   护盾：打护盾的受击（涟漪）、破盾一刻、破盾后 0.25 s；护甲：破甲一刻；
    ///   火舌：火浣鼠 / 镇墓兽 / 祸斗 / 炭童近景 + 地火、火柱；出生显形中途、死亡迸散（火元素击杀）、尸体溶解。
    /// 检查项只核对「有没有出」：外观组件挂上、破层计数、反应执行，不卡画面。
    /// </summary>
    public class FxBlastSuite : PlaytestSuite
    {
        public override string Id => "fx-blast";

        /// <summary>只跑一段（迭代用：fx-blast-boom / -rx / -status / -layer / -life）；null = 全部</summary>
        protected virtual string Only => null;

        bool Run(string part) => Only == null || Only == part;
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string Target = "jerboa_blade";

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        ArenaSpawner arena;
        Transform eye;
        Vector3 away, side;
        /// <summary>拍摄场地：刷怪台东侧 14 m 的空地（武器架、刷怪台、红色出生台都在西边，不入镜），相对 arena.Center 的偏移</summary>
        Vector3 stage;
        /// <summary>机位方向：从场地往这个方向退（背景是场地边缘的沙丘）</summary>
        Vector3 back;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
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
            eye = weapons.eye.transform;
            vitals.stats.Add("playtest_fxb", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            var quality = ArtQuality.Level;
            ArtQuality.Set(ArtQualityLevel.High, false);
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            side = Vector3.Cross(Vector3.up, away);
            stage = side * 14f - away * 4f;
            back = -away;
            Time.captureDeltaTime = 1f / 60f;
            try
            {
                if (Run("boom")) yield return Explosions();
                if (Run("rx")) yield return ReactionsCase();
                if (Run("status")) yield return Statuses();
                if (Run("layer")) yield return LayerBreaks();
                if (Run("life")) yield return Flames();
                if (Run("life")) yield return SpawnDeath();
                if (Only == "perf") yield return Perf();
            }
            finally
            {
                Time.captureDeltaTime = 0;
                ArtQuality.Set(quality, false);
                vitals.stats.Remove("playtest_fxb");
                weapons.testFire = false;
                arena.Clear();
            }
        }

        // ───────────── 工具 ─────────────

        static IEnumerator Frames(int n)
        {
            for (int i = 0; i < n; i++) yield return null;
        }

        /// <summary>等到距 t0 已过 seconds 秒（游戏时间）</summary>
        static IEnumerator Until(float t0, float seconds)
        {
            while (Time.time - t0 < seconds - 0.001f) yield return null;
        }

        /// <summary>临时相机从 from 看向 at 拍一张（不带 HUD、不带第一人称枪模）</summary>
        void CamShot(Vector3 from, Vector3 at, string name, float fov = 55)
        {
            var go = new GameObject("FXB Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = fov;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 600f;
            cam.cullingMask = ~(1 << Layers.FirstPerson);
            go.transform.position = from;
            go.transform.LookAt(at);
            Shot(cam, name);
            Destroy(go);
        }

        EnemyAI Spawn(string id, Vector3 offset, float hp = 40000)
        {
            var ai = arena.Spawn(id, false, offset);
            if (!ai)
            {
                Fail($"生成 {id} 失败");
                return null;
            }
            ai.Health.maxHealth = hp;
            ai.Health.ResetVitals();
            return ai;
        }

        Vector3 Stage => arena.Center + stage;

        Vector3 Ground(Vector3 p)
        {
            float gy = Fx.GroundY(p + Vector3.up * 4, 12);
            if (!float.IsNegativeInfinity(gy)) p.y = gy;
            return p;
        }

        // ───────────── 爆炸 ─────────────

        IEnumerator Explosions()
        {
            Teleport(motor, Stage + back * 40f);
            yield return null;
            var tiers = new[] { ("s", 0.8f), ("m", 3f), ("l", 7f) };
            var times = new[] { 0.05f, 0.15f, 0.3f, 0.6f, 1.1f };
            foreach (var (tag, r) in tiers)
            {
                arena.Clear();
                FxDecals.ClearAll();
                yield return Frames(20);
                var at = Ground(Stage) + Vector3.up * Mathf.Min(0.5f, r * 0.3f);
                float dist = 4.5f + r * 2.6f;
                var camPos = at + back * dist + Vector3.up * (1.2f + r * 0.55f);
                var look = at + Vector3.up * r * 0.55f;
                var info = DamageInfo.Simple(0, DamageSource.Explosion, at, Vector3.up);
                Combat.Explode(new ExplosionOptions(at, r, info) { noEnemies = true });
                float t0 = Time.time;
                foreach (float t in times)
                {
                    yield return Until(t0, t);
                    CamShot(camPos, look, $"fxb_blast_{tag}_{Mathf.RoundToInt(t * 100):D3}");
                }
                Line($"爆炸 · {tag}（半径 {r} m）：{times.Length} 帧");
                yield return Frames(90);
            }
        }

        // ───────────── 元素反应 ─────────────

        IEnumerator ReactionsCase()
        {
            var cases = new[] { "meltdown", "thunderfire", "veinseal", "abyss", "collapse" };
            int reacted = 0;
            InAction<ReactionEvent> on = (in ReactionEvent _) => reacted++;
            GameEvents.Reacted += on;
            try
            {
                foreach (var name in cases)
                {
                    arena.Clear();
                    FxDecals.ClearAll();
                    yield return Frames(20);
                    var a = Spawn(Target, stage);
                    // 旁边站两只陪衬（焚雷的雷弧、封脉的导流要有目标）
                    var b = Spawn(Target, stage + side * 2.4f - back * 1.2f);
                    var c = Spawn(Target, stage - side * 2.6f - back * 1.6f);
                    if (!a) yield break;
                    yield return new WaitForSeconds(1f);
                    foreach (var x in new[] { a, b, c })
                        if (x)
                            x.enabled = false;
                    Teleport(motor, a.transform.position + back * 14f);
                    yield return null;
                    var center = BodyCenter(a.Health);
                    var camPos = center + back * 7.5f + side * 1.5f + Vector3.up * 1.6f;
                    int r0 = reacted;
                    float t0 = Time.time;
                    if (name == "collapse")
                    {
                        EnemyStatus.Apply(a.Health, Element.Shock, 30, 1, false);
                        yield return null;
                        Combat.Detonate(a.Health, new DetonateOpts { power = 40 });
                        yield return Frames(2);
                    }
                    else
                    {
                        var id = name switch
                        {
                            "meltdown" => Reaction.Meltdown,
                            "thunderfire" => Reaction.Thunderfire,
                            "veinseal" => Reaction.Veinseal,
                            _ => Reaction.Abyss,
                        };
                        Combat.TriggerReaction(a.Health, id, new TriggerOpts { power = 40, ignoreIcd = true, point = center });
                        while (reacted == r0 && Time.time - t0 < 2f) yield return null;
                    }
                    float te = Time.time;
                    yield return Until(te, 0.04f);
                    CamShot(camPos, center, $"fxb_rx_{name}_1flash");
                    yield return Until(te, 0.2f);
                    CamShot(camPos, center, $"fxb_rx_{name}_2wave");
                    yield return Until(te, 0.65f);
                    CamShot(camPos, center, $"fxb_rx_{name}_3after");
                    Line($"反应 · {name}：执行 {(name == "collapse" || reacted > r0 ? "✓" : "✗")}（{te - t0:F2} s 后）");
                    if (name != "collapse" && reacted == r0) Fail($"{name} 2 s 内没有执行");
                    yield return Frames(60);
                }
            }
            finally
            {
                GameEvents.Reacted -= on;
            }
            arena.Clear();
        }

        // ───────────── 状态 ─────────────

        IEnumerator Statuses()
        {
            arena.Clear();
            yield return Frames(20);
            var names = new[] { "burn", "shock", "corrode", "stun", "slow" };
            var list = new List<EnemyAI>();
            for (int i = 0; i < names.Length; i++)
            {
                var ai = Spawn(Target, stage + side * ((i - 2) * 4f));
                if (ai) list.Add(ai);
            }
            if (list.Count < names.Length) yield break;
            yield return new WaitForSeconds(1f);
            foreach (var ai in list) ai.enabled = false;
            var d = list.Select(a => a.Health).ToArray();
            for (int k = 0; k < 3; k++) EnemyStatus.Apply(d[0], Element.Fire, 30, 1, false);
            EnemyStatus.Apply(d[1], Element.Shock, 30, 1, false);
            EnemyStatus.Apply(d[1], Element.Shock, 30, 1, false);
            EnemyStatus.Apply(d[2], Element.Corrode, 30, 1, false);
            EnemyStatus.Apply(d[3], StatusId.Stun, new StatusApply(0, 12));
            EnemyStatus.Slow(d[4], 0.5f, 12);
            Teleport(motor, Stage + back * 18f);
            yield return null;
            Aim(motor, eye, Ground(Stage) + Vector3.up * 0.9f);
            yield return new WaitForSeconds(0.8f);
            Shot(weapons.eye, "fxb_status_far");
            Teleport(motor, Stage + back * 9f);
            yield return null;
            Aim(motor, eye, Ground(Stage) + Vector3.up * 0.9f);
            yield return Frames(6);
            Shot(weapons.eye, "fxb_status_mid");
            var want = new[] { StatusMask.Burn, StatusMask.Shock, StatusMask.Corrode, StatusMask.Stun, StatusMask.Slow };
            for (int i = 0; i < list.Count; i++)
            {
                var sfx = list[i] ? list[i].GetComponent<StatusFx>() : null;
                var showing = sfx ? sfx.Showing : StatusMask.None;
                PoseShot(list[i], back * 0.9f + side * 0.3f, $"fxb_status_{names[i]}");
                yield return Frames(3);
                Line($"状态 · {names[i]}：外观组件 {(sfx ? "✓" : "✗")}，显示 {showing}，状态皮 {(sfx && sfx.SkinShowing ? "✓" : "✗")}" +
                     (i == 0 && sfx ? $"，身上火舌 {sfx.TonguesShowing} 片" : ""));
                if (sfx && !sfx.SkinShowing) Fail($"{names[i]}：没有挂上状态皮");
                if (i == 0 && sfx && sfx.TonguesShowing == 0) Fail("灼烧：身上没有火舌");
                if (!sfx) Fail($"{names[i]}：没有挂 StatusFx");
                else if ((showing & want[i]) == 0) Fail($"{names[i]}：StatusFx 没有显示 {want[i]}（{showing}）");
            }
            arena.Clear();
            yield return Frames(20);
        }

        // ───────────── 护盾 / 护甲 ─────────────

        IEnumerator LayerBreaks()
        {
            foreach (var layer in new[] { DamageLayer.Shield, DamageLayer.Armor })
            {
                arena.Clear();
                yield return Frames(20);
                var ai = Spawn(Target, stage);
                if (!ai) yield break;
                var d = ai.Health;
                if (layer == DamageLayer.Shield) d.maxShield = d.shield = 260;
                else d.maxArmor = d.armor = 120;
                yield return new WaitForSeconds(1f);
                ai.enabled = false;
                Teleport(motor, ai.transform.position + back * 6f);
                yield return null;
                Aim(motor, eye, BodyCenter(d));
                bool broke = false;
                System.Action<Damageable> on = x =>
                {
                    if (x == d) broke = true;
                };
                if (layer == DamageLayer.Shield) GameEvents.EnemyShieldBroken += on;
                else GameEvents.EnemyArmorBroken += on;
                string ln = layer == DamageLayer.Shield ? "shield" : "armor";
                // 机位每次按靶子当前位置算（中弹会被打退）
                Vector3 CamPos() => BodyCenter(d) + back * 3.2f + side * 1.9f + Vector3.up * 0.4f;
                weapons.Active.reserve = weapons.Active.def.reserve;
                weapons.testFire = true;
                bool hitShot = false;
                float t0 = Time.time, firstRipple = -1;
                int ripples0 = ShieldBubble.Ripples;
                while (Time.time - t0 < 8f && !broke)
                {
                    if (ai && d) Aim(motor, eye, BodyCenter(d));
                    // 受击：第一次打到护盾（球壳罩起来）后 0.1 s 拍；护甲照旧 0.25 s
                    if (layer == DamageLayer.Shield && firstRipple < 0 && ShieldBubble.Ripples > ripples0) firstRipple = Time.time;
                    bool ready = layer == DamageLayer.Shield ? firstRipple >= 0 && Time.time - firstRipple > 0.1f : Time.time - t0 > 0.25f;
                    if (!hitShot && ready)
                    {
                        hitShot = true;
                        Shot(weapons.eye, $"fxb_{ln}_hit");
                        CamShot(CamPos(), BodyCenter(d), $"fxb_{ln}_hit_side");
                        var bub = ShieldBubble.Of(d);
                        if (layer == DamageLayer.Shield)
                            Line(bub ? $"  护盾球壳：位置 {bub.transform.position}，大小 {bub.transform.localScale}，激活 {bub.gameObject.activeInHierarchy}，可见 {bub.Visible:F2}；靶子 {BodyCenter(d)}" : "  护盾球壳：没有");
                    }
                    weapons.Active.reserve = weapons.Active.def.reserve;
                    yield return null;
                }
                weapons.testFire = false;
                if (broke)
                {
                    yield return Frames(2);
                    CamShot(CamPos(), BodyCenter(d), $"fxb_{ln}_break");
                    yield return Frames(15);
                    CamShot(CamPos(), BodyCenter(d), $"fxb_{ln}_break_late");
                }
                if (layer == DamageLayer.Shield) GameEvents.EnemyShieldBroken -= on;
                else GameEvents.EnemyArmorBroken -= on;
                Line($"破{(layer == DamageLayer.Shield ? "盾" : "甲")}：{(broke ? "✓ 打穿" : "✗ 8 s 没打穿")}" +
                     (layer == DamageLayer.Shield ? $"，护盾球壳 涟漪 {ShieldBubble.Ripples} 次 / 破碎 {ShieldBubble.Shatters} 次" : ""));
                if (layer == DamageLayer.Shield && (ShieldBubble.Ripples == 0 || ShieldBubble.Shatters == 0)) Fail("护盾球壳没有出涟漪 / 破碎");
                if (!broke) Fail($"{layer} 8 s 没打穿");
                yield return Frames(30);
            }
            arena.Clear();
        }

        // ───────────── 火舌 ─────────────

        IEnumerator Flames()
        {
            foreach (var id in new[] { "fire_rat", "tomb_beast", "huodou", "tantong" })
            {
                if (!ArenaSpawner.IsRegistered(id)) continue;
                arena.Clear();
                yield return Frames(20);
                var ai = Spawn(id, stage);
                if (!ai) continue;
                yield return new WaitForSeconds(1.2f);
                ai.enabled = false;
                Teleport(motor, ai.transform.position + back * 16f);
                yield return Frames(10);
                PoseShot(ai, back * 0.8f + side * 0.5f, $"fxb_flame_{id}");
            }
            arena.Clear();
            yield return Frames(20);
            var g = Ground(Stage);
            FlameTongues.Ground(g, 1.4f, 10, 3f, 0.7f);
            FlameTongues.Pillar(g + side * 3.2f, 0.8f, 2.6f);
            yield return Frames(7);
            CamShot(g + back * 6.5f + side * 1.6f + Vector3.up * 1.4f, g + side * 1.6f + Vector3.up * 0.8f, "fxb_flame_ground");
            yield return Frames(60);
        }

        // ───────────── 性能对照（fx-blast-perf） ─────────────

        /// <summary>
        /// 同 fx 套件的压力项（8 只全身着火感电 + 暴击连射 4 s + 3 次爆炸），高 / 低画质各跑两遍：B 路状态外观开 / 关（<see cref="StatusFx.Lean"/>），
        /// 同一次会话里对照，排除机器忙闲的影响。记同屏粒子峰值、平均 / 最长帧时间、状态皮 / 身上火舌数
        /// </summary>
        IEnumerator Perf()
        {
            Time.captureDeltaTime = 0;
            foreach (var level in new[] { ArtQualityLevel.High, ArtQualityLevel.Low })
            foreach (bool lean in new[] { true, false, true, false, true, false })
            {
                ArtQuality.Set(level, false);
                StatusFx.Lean = lean;
                arena.Clear();
                yield return new WaitForSeconds(0.5f);
                var list = new List<EnemyAI>();
                for (int i = 0; i < 8; i++)
                {
                    float ang = i * Mathf.PI * 2 / 8;
                    var ai = Spawn(Target, new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * 3.2f, 400000);
                    if (ai) list.Add(ai);
                }
                yield return new WaitForSeconds(1f);
                foreach (var ai in list)
                {
                    if (!ai) continue;
                    ai.enabled = false;
                    for (int k = 0; k < 3; k++) EnemyStatus.Apply(ai.Health, Element.Fire, 40, 1, false);
                    EnemyStatus.Apply(ai.Health, Element.Shock, 40, 1, false);
                }
                Teleport(motor, arena.Center + away * 10);
                yield return null;
                vitals.stats.Add("playtest_fxb_crit", Stat.CritChance, 1f);
                FxBudget.ResetPeak();
                weapons.Active.reserve = weapons.Active.def.reserve;
                weapons.testFire = true;
                yield return new WaitForSeconds(0.3f);
                float t0 = Time.time, dtSum = 0, dtMax = 0, reapply = 0;
                int frames = 0, booms = 0;
                var dts = new List<float>(512);
                while (Time.time - t0 < 4f)
                {
                    // 每秒补一次状态（灼烧几秒就烧完，压力窗口里一直要有火舌 / 状态皮）
                    if (Time.time >= reapply)
                    {
                        reapply = Time.time + 1f;
                        foreach (var ai in list)
                        {
                            if (!ai) continue;
                            EnemyStatus.Apply(ai.Health, Element.Fire, 40, 1, false);
                            EnemyStatus.Apply(ai.Health, Element.Shock, 40, 1, false);
                        }
                    }
                    var target = list.Where(x => x).OrderBy(_ => Random.value).FirstOrDefault();
                    if (target) Aim(motor, eye, BodyCenter(target.Health));
                    if (booms < 3 && Time.time - t0 > 1f + booms)
                    {
                        booms++;
                        var at = arena.Center + new Vector3(Random.Range(-2f, 2f), 0.5f, Random.Range(-2f, 2f));
                        Combat.Explode(new ExplosionOptions(at, 3f, DamageInfo.Simple(0, DamageSource.Explosion, at, Vector3.up)) { noEnemies = true });
                    }
                    weapons.Active.reserve = weapons.Active.def.reserve;
                    float dt = Time.unscaledDeltaTime;
                    dtSum += dt;
                    dtMax = Mathf.Max(dtMax, dt);
                    dts.Add(dt);
                    frames++;
                    yield return null;
                }
                weapons.testFire = false;
                vitals.stats.Remove("playtest_fxb_crit");
                dts.Sort();
                float median = dts.Count > 0 ? dts[dts.Count / 2] : 0, p95 = dts.Count > 0 ? dts[Mathf.Min(dts.Count - 1, dts.Count * 95 / 100)] : 0;
                int skins = list.Count(x => x && x.GetComponent<StatusFx>() is { SkinShowing: true });
                int tongues = list.Sum(x => x && x.GetComponent<StatusFx>() is { } f ? f.TonguesShowing : 0);
                Line($"性能（画质 {ArtQuality.Label(level)}，B 路状态外观 {(lean ? "关" : "开")}）：粒子峰值 {FxBudget.Peak} / {FxBudget.ParticleCap}，" +
                     $"帧 {frames} 个，平均 {dtSum / Mathf.Max(1, frames) * 1000:F1} ms、中位 {median * 1000:F1} ms、95% {p95 * 1000:F1} ms、最长 {dtMax * 1000:F1} ms；" +
                     $"状态皮 {skins}，身上火舌 {tongues}");
            }
            StatusFx.Lean = false;
            arena.Clear();
            ArtQuality.Set(ArtQualityLevel.High, false);
            Time.captureDeltaTime = 1f / 60f;
        }

        // ───────────── 出生 / 死亡 ─────────────

        IEnumerator SpawnDeath()
        {
            arena.Clear();
            yield return Frames(20);
            var g = Ground(Stage);
            Teleport(motor, Stage + back * 20f);
            var camPos = g + back * 6f + side * 1.5f + Vector3.up * 1.5f;
            var ai = Spawn(Target, stage, 200);
            if (!ai) yield break;
            yield return new WaitForSeconds(0.32f);
            CamShot(camPos, g + Vector3.up * 0.8f, "fxb_spawn_mid");
            yield return new WaitForSeconds(1.2f);
            ai.enabled = false;
            var d = ai.Health;
            var c = BodyCenter(d);
            var info = DamageInfo.Simple(99999, DamageSource.Weapon, c, (c - camPos).normalized);
            info.element = Element.Fire;
            info.knockback = 4;
            Combat.DamageEnemy(d, info);
            yield return Frames(3);
            CamShot(camPos, c, "fxb_death_burst");
            var dd = ai ? ai.GetComponent<DeathDissolve>() : null;
            float t0 = Time.time;
            bool mid = false;
            while (ai && Time.time - t0 < 9f)
            {
                if (!mid && dd && dd.Amount > 0.4f)
                {
                    mid = true;
                    CamShot(camPos, ai.transform.position + Vector3.up * 0.3f, "fxb_death_dissolve");
                }
                yield return null;
            }
            Line($"死亡：溶解中途 {(mid ? "✓" : "✗")}");
            arena.Clear();
            yield return Frames(20);
            // 三章出生法阵：通用光墙 / 溶解 / 光点螺旋 + C 路的本章主题法阵叠在一起（测试场按图鉴章节选主题）
            foreach (var id in new[] { "jerboa_blade", "jiaoren", "tantong" })
            {
                if (!ArenaSpawner.IsRegistered(id)) continue;
                var e = Spawn(id, stage, 200);
                if (!e) continue;
                yield return new WaitForSeconds(0.3f);
                CamShot(camPos, g + Vector3.up * 0.8f, $"fxb_spawn_theme_{id}");
                yield return new WaitForSeconds(0.25f);
                CamShot(camPos, g + Vector3.up * 0.8f, $"fxb_spawn_theme_{id}_late");
                Line($"出生法阵 · {id}：主题 {SpawnThemes.For(e)}");
                yield return new WaitForSeconds(0.6f);
                arena.Clear();
                yield return Frames(20);
            }
        }
    }

    public sealed class FxBlastBoomSuite : FxBlastSuite
    {
        public override string Id => "fx-blast-boom";
        protected override string Only => "boom";
    }

    public sealed class FxBlastRxSuite : FxBlastSuite
    {
        public override string Id => "fx-blast-rx";
        protected override string Only => "rx";
    }

    public sealed class FxBlastStatusSuite : FxBlastSuite
    {
        public override string Id => "fx-blast-status";
        protected override string Only => "status";
    }

    public sealed class FxBlastLayerSuite : FxBlastSuite
    {
        public override string Id => "fx-blast-layer";
        protected override string Only => "layer";
    }

    public sealed class FxBlastPerfSuite : FxBlastSuite
    {
        public override string Id => "fx-blast-perf";
        protected override string Only => "perf";
    }

    public sealed class FxBlastLifeSuite : FxBlastSuite
    {
        public override string Id => "fx-blast-life";
        protected override string Only => "life";
    }
}
