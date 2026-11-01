using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 第四章雷魅冒烟（bridge.sh playtest plateau-foes；场景 TestArena；设计单 docs/art/vfx/foes-ch4.md、combat 第 3 节）：
    /// 测试场里逐只验证招式、受击、死亡和带电互动，玩家开无敌（加血上限）、不开枪，套件直接调伤害 / 元素：
    ///   · 啸獭：一窝 4 只挤在一起 → 哨兵尖啸（叫醒）、电网成网且网里带电、碰电网掉血；往网里一只挂火 → 焚雷；钻洞（消失 → 洞口钻出）；扑咬出过；
    ///   · 天狗：雷吠 → 雷标定格 → 落雷劈下、落点里的天狗衔雷带电；扑咬（视野外条件放宽）出过；
    ///   · 獓狠 + 雷牦：踩踏（雷牦跟着出线）、雷球攒电带电；往一片蓑毛打火 → 那片烧光；砸地前摇里打雷球 → 反制眩晕；四角挑；
    ///   · 举父：远投（落点、石头飞出）；雷暴里再投 → 雷石落地留电场；举石时打石头 → 手中炸石、眩晕；
    ///   · 蛮蛮：一对配上、成对带电、横扫出过；打死一只 → 另一只坠落；
    ///   · 连鼓灵（带两只天狗）：鼓点给护盾 / 加速；护盾挡一次伤害；鼓一面面碎 → 雷心落地；
    ///   · 帝江：三只挤在一起，打爆一只 → 连锁引爆；贴身胀爆；
    ///   · 穷奇（精英）：掠空扑杀（起飞 → 影子 → 落地）、滑翔中打穿翼根 → 坠地眩晕、吞雷带电、血 &lt; 30% 撤退；
    ///   · 通用：硬直（HitStagger）、眩晕（HitStun）、四种死法（普通 / 弱点 / 爆炸 / 带电放电），美术体的动作片段都在 Animator 里，
    ///     动画事件先到的出手时刻与时间轴相差 ≤ 1 帧；全程没有运行时报错。
    /// 聚焦：Library/SpiritfireBridge/playtest-focus.txt 写 id（逗号 / 空格分隔）→ 只跑这几只（读完即删）。
    /// </summary>
    public sealed class PlateauFoesSuite : PlaytestSuite
    {
        public override string Id => "plateau-foes";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        static readonly string[] Ids = { "marmot", "tiangou", "aoyin", "jufu", "manman", "liangu", "dijiang", "qiongqi" };

        /// <summary>美术动作状态（采样 + 手 K），美术体上逐个要在 Animator 里</summary>
        static readonly Dictionary<string, string[]> Clips = new()
        {
            ["marmot"] = new[] { "scream", "bite", "burrow", "stun", "stagger" },
            ["tiangou"] = new[] { "howl", "pounce", "stun", "stagger" },
            ["aoyin"] = new[] { "stampede", "gore", "goreL", "slam", "stun", "stagger" },
            ["jufu"] = new[] { "climb", "throw", "shove", "fall", "stun", "stagger" },
            ["manman"] = new[] { "sweep", "bolt", "hop", "stun", "stagger" },
            ["dijiang"] = new[] { "swell", "stun" },
            ["qiongqi"] = new[] { "glide", "spin", "claw", "absorb", "flee", "stun", "stagger" },
        };

        const float FrameTol = 1f / 30f + 0.012f;

        PlayerMotor motor;
        PlayerVitals vitals;
        WeaponController weapons;
        ArenaSpawner arena;
        Vector3 away;
        int logErrors, reactions, arcs, strikes;
        string lastError;
        readonly Dictionary<Reaction, int> reactionCount = new();
        float maxCueDelta, maxCueFrame, worstOver = float.NegativeInfinity;
        int animCues, overThirty;
        string maxCueAt = "", worstAt = "";

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.2f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail("缺少测试场组件（场景不是 TestArena？）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            vitals.stats.Add("plateau_foes", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            var restore = PlateauTestKit.InstallCatalog(this.Line);
            Application.logMessageReceived += OnLog;
            GameEvents.Reacted += OnReacted;
            Charge.Arced += OnArced;
            LightningStrike.Landed += OnStrike;
            var ids = FocusIds() ?? Ids.ToList();
            try
            {
                foreach (var id in ids)
                {
                    if (!ArenaSpawner.IsRegistered(id))
                    {
                        Fail($"{id}：名册里没有");
                        continue;
                    }
                    Reset();
                    yield return id switch
                    {
                        "marmot" => Marmot(),
                        "tiangou" => Tiangou(),
                        "aoyin" or "leiyak" => Aoyin(),
                        "jufu" => Jufu(),
                        "manman" => Manman(),
                        "liangu" => Liangu(),
                        "dijiang" => Dijiang(),
                        "qiongqi" => Qiongqi(),
                        _ => null,
                    };
                }
                Reset();
                yield return Layers();
                Reset();
                yield return Deaths();
            }
            finally
            {
                Application.logMessageReceived -= OnLog;
                GameEvents.Reacted -= OnReacted;
                Charge.Arced -= OnArced;
                LightningStrike.Landed -= OnStrike;
                PlateauEnemyAI.StormOverride = null;
                vitals.stats.Remove("plateau_foes");
                arena.Clear();
                restore?.Invoke();
            }
            Line($"出手时刻：动画事件与时间轴最大差 {maxCueDelta * 1000:0} ms（{maxCueAt}，那一刻一帧 {maxCueFrame * 1000:0} ms；量了 {animCues} 次，超过 1/30 s 的 {overThirty} 次），容差 1 帧");
            if (animCues == 0) Fail("一次动画事件都没收到（片段没有事件？占位体？）");
            if (worstOver > 0) Fail($"动画事件与时间轴差超过 1 帧：{worstAt}");
            Line($"反应：{string.Join("、", reactionCount.Select(kv => $"{kv.Key} ×{kv.Value}"))}；传电 {arcs} 次；落雷 {strikes} 道");
            if (logErrors > 0) Fail($"运行时报错 {logErrors} 次，最后一条：{lastError}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        void OnReacted(in ReactionEvent e)
        {
            reactions++;
            reactionCount[e.id] = reactionCount.TryGetValue(e.id, out int n) ? n + 1 : 1;
        }

        void OnArced(Damageable a, Damageable b) => arcs++;
        void OnStrike(StrikeInfo s) => strikes++;

        List<string> FocusIds()
        {
            var path = System.IO.Path.Combine(Application.dataPath, "..", "Library", "SpiritfireBridge", "playtest-focus.txt");
            if (!System.IO.File.Exists(path)) return null;
            var ids = System.IO.File.ReadAllText(path).Split(new[] { ',', ' ', '\n', '\r', '，' }, StringSplitOptions.RemoveEmptyEntries).ToList();
            System.IO.File.Delete(path);
            return ids.Count > 0 ? ids : null;
        }

        void Reset()
        {
            arena.Clear();
            AttackTokens.Reset();
            PlateauPack.Reset();
            PlateauEnemyAI.StormOverride = null;
            vitals.Heal(999999);
            Teleport(motor, arena.Center + away * 12f);
        }

        // ───────────── 小工具 ─────────────

        T Spawn<T>(string id, Vector3 offset, bool elite = false) where T : PlateauEnemyAI
        {
            var ai = arena.Spawn(id, elite, offset) as T;
            if (!ai)
            {
                Fail($"{id}：刷不出来（或 AI 不是 {typeof(T).Name}）");
                return null;
            }
            if (ArenaSpawner.IsPlaceholder(ai)) Line($"  {id}：占位体（GameDatabase 还没登记 Prefab，F 路重建后才有美术体）");
            else CheckClips(id, ai);
            string who = ai.enemyId;
            ai.Move.AnimMeasured += (move, name, delta, frame) => OnAnimMeasured(who, move, name, delta, frame);
            return ai;
        }

        /// <summary>
        /// 每个动画事件量一次：|到达 − 时间轴| 不超过「一帧」—— 平常 1/30 s（含 12 ms 余量）；
        /// 起手那帧或事件那帧是帧时尖峰时按那一帧的实际长度算（见 <see cref="PlateauMoveRunner.AnimMeasured"/>）。
        /// 片段事件摆错（差几帧）照样不合格。
        /// </summary>
        void OnAnimMeasured(string who, string move, string name, float delta, float frame)
        {
            animCues++;
            float a = Mathf.Abs(delta);
            if (a > 1f / 30f) overThirty++;
            if (a > maxCueDelta)
            {
                maxCueDelta = a;
                maxCueFrame = frame;
                maxCueAt = $"{who}.{move}.{name}";
            }
            float over = a - Mathf.Max(FrameTol, frame + 0.012f);
            if (over > worstOver)
            {
                worstOver = over;
                worstAt = $"{who}.{move}.{name} 差 {delta * 1000:0} ms、一帧 {frame * 1000:0} ms";
            }
        }

        void CheckClips(string id, PlateauEnemyAI ai)
        {
            if (!Clips.TryGetValue(id, out var want)) return;
            if (!ai.Animated)
            {
                Fail($"{id}：美术体没有 Animator 控制器（bridge.sh sync？）");
                return;
            }
            var missing = want.Where(s => !ai.HasAnimState(s)).ToList();
            if (missing.Count > 0) Fail($"{id}：Animator 里缺 {string.Join("、", missing)}");
            else Line($"  {id}：动作片段齐（{string.Join(" ", want)}）");
        }

        IEnumerator WaitFor(Func<bool> cond, float seconds)
        {
            float t0 = Time.time;
            while (!cond() && Time.time - t0 < seconds)
            {
                vitals.Heal(999999);
                yield return null;
            }
        }

        void Check(bool ok, string what)
        {
            if (ok) Line($"  ✓ {what}");
            else Fail(what);
        }

        static void Hurt(EnemyAI ai, float amount, Vector3 point, Element element = Element.None, DamageSource source = DamageSource.Weapon, bool weak = false)
        {
            var dir = (point - Camera.main.transform.position).normalized;
            var info = DamageInfo.Simple(amount, source, point, dir);
            info.element = element;
            info.weakpoint = weak;
            info.forcedWeakpoint = weak;
            if (source == DamageSource.Explosion) info.tags = DamageTag.Explosion;
            Combat.DamageEnemy(ai.Health, info);
        }

        void StandAt(EnemyAI ai, float dist)
        {
            var d = motor.transform.position - ai.transform.position;
            d.y = 0;
            d = d.sqrMagnitude > 1e-3f ? d.normalized : away;
            Teleport(motor, ai.transform.position + d * dist);
            Aim(motor, weapons.eye.transform, BodyCenter(ai.Health));
        }

        // ───────────── 每只 ─────────────

        IEnumerator Marmot()
        {
            Line("啸獭");
            var list = new List<MarmotAI>();
            for (int i = 0; i < 4; i++)
            {
                var m = Spawn<MarmotAI>("marmot", new Vector3(Mathf.Cos(i * 1.57f), 0, Mathf.Sin(i * 1.57f)) * 1.6f);
                if (m) list.Add(m);
            }
            if (list.Count < 4) yield break;
            var sentinel = list.FirstOrDefault(m => m.Sentinel);
            Check(sentinel, "一窝里有一只哨兵");
            Teleport(motor, arena.Center + away * 9f);
            yield return WaitFor(() => sentinel && sentinel.Screamed >= 2, 4f);
            Check(sentinel && sentinel.Screamed == 2, $"哨兵发现玩家后尖啸（状态 {sentinel?.Screamed}，叫醒 {sentinel?.Woke} 群）");
            // 电网：玩家站远，它们会冲过来；先冻住位置看成网
            yield return WaitFor(() => MarmotNet.TotalEdges() >= 3, 3f);
            int edges = MarmotNet.TotalEdges();
            Check(edges >= 3, $"电网成网（{edges} 条边）");
            Check(list.Count(m => m && !m.Dead && m.InNet && m.Charged) >= 3, "网里的都带电");
            // 往网里一只挂火 → 焚雷
            int before = reactionCount.TryGetValue(Reaction.Thunderfire, out int b) ? b : 0;
            var target = list.First(m => m && !m.Dead && m.InNet);
            Combat.ApplyElement(target.Health, Element.Fire, 30f);
            yield return new WaitForSeconds(0.3f);
            int after = reactionCount.TryGetValue(Reaction.Thunderfire, out int a) ? a : 0;
            Check(after > before, $"网里点火 → 焚雷（{after - before} 次）");
            // 钻洞
            var digger = list.FirstOrDefault(m => m && !m.Dead && !m.Burrowed);
            if (digger)
            {
                bool hid = false;
                digger.ForceBurrow();
                yield return WaitFor(() => (hid |= digger.Burrowed) && !digger.Burrowed, 3f);
                Check(hid && !digger.Burrowed, "钻洞：消失 → 洞口钻出");
            }
            // 扑咬
            var biter = list.FirstOrDefault(m => m && !m.Dead);
            if (biter)
            {
                StandAt(biter, 1.5f);
                yield return WaitFor(() => biter.Move.Count.ContainsKey("bite") || biter.Dead, 6f);
                Check(biter.Dead || biter.Move.Count.ContainsKey("bite"), "扑咬出过");
            }
        }

        IEnumerator Tiangou()
        {
            Line("天狗");
            var t = Spawn<TiangouAI>("tiangou", away * -4f);
            var mate = Spawn<TiangouAI>("tiangou", away * -4f + Vector3.right * 1.5f);
            if (!t || !mate) yield break;
            yield return new WaitForSeconds(0.9f);
            Teleport(motor, t.transform.position + away * 14f);
            int s0 = strikes;
            t.Force("howl");
            yield return WaitFor(() => strikes > s0, 3.5f);
            Check(strikes > s0, $"雷吠 → 雷标定格 → 落雷（{t.Strikes} 道）");
            // 衔雷：把天狗放到落点上再吠一次
            mate.transform.position = motor.transform.position + Vector3.right * 1f;
            s0 = strikes;
            t.Force("howl");
            yield return WaitFor(() => strikes > s0, 3.5f);
            yield return null;
            Check(mate.Charged, "落点 3 m 内的天狗衔雷带电");
            t.forcePounce = true;
            StandAt(t, 4f);
            t.Force("pounce");
            yield return WaitFor(() => !t.Move.Busy, 3f);
            Check(t.Move.Count.ContainsKey("pounce"), $"扑咬出过（咬中 {t.Bit}）");
        }

        IEnumerator Aoyin()
        {
            Line("獓狠 + 雷牦");
            var a = Spawn<AoyinAI>("aoyin", away * -6f);
            var y1 = Spawn<AoyinAI>("leiyak", away * -6f + Vector3.right * 4f);
            var y2 = Spawn<AoyinAI>("leiyak", away * -6f - Vector3.right * 4f);
            if (!a || !y1 || !y2) yield break;
            yield return new WaitForSeconds(1f);
            Teleport(motor, a.transform.position + away * 20f);
            a.Force("stampede");
            yield return WaitFor(() => !a.Move.Busy, 7f);
            Check(a.Move.Count.ContainsKey("stampede"), "踩踏出过");
            Check(y1.Move.Count.ContainsKey("stampede") || y2.Move.Count.ContainsKey("stampede"), "雷牦跟着踩踏");
            Check(a.OrbCharge >= 1 && a.Charged, $"踩踏后雷球攒电（{a.OrbCharge} 份）、带电");
            // 蓑毛：往胸口那片打火
            Hurt(a, 10f, a.FurPoint("chest"), Element.Fire);
            yield return new WaitForSeconds(2f);
            Check(a.Fur.TryGetValue("chest", out float f) && f <= 0, $"胸口蓑毛烧光（剩 {f:0.00}）");
            // 砸地反制：前摇里打雷球
            StandAt(a, 8f);
            a.Force("slam");
            yield return new WaitForSeconds(0.4f);
            for (int i = 0; i < 20 && a && !a.Dead && !a.OrbDetonated && a.Move.Id == "slam"; i++)
            {
                var orb = a.Body.WeakPoint ? a.Body.WeakPoint.position : a.Center;
                Hurt(a, 30f * a.Health.maxHealth / 900f, orb, Element.None, DamageSource.Weapon, true);
                yield return new WaitForSeconds(0.05f);
            }
            yield return null;
            Check(a.OrbDetonated, "砸地前摇里打雷球 → 雷球在脸上炸开");
            yield return WaitFor(() => a.Health.GetComponent<EnemyStatus>() && a.Health.GetComponent<EnemyStatus>().Stunned, 0.5f);
            var st = a.GetComponent<EnemyStatus>();
            Check(st && st.Stunned, "反制后眩晕");
            yield return WaitFor(() => !(st && st.Stunned), 4f);
            StandAt(a, 3f);
            yield return WaitFor(() => a.Move.Count.ContainsKey("gore") || a.Move.Count.ContainsKey("goreL"), 6f);
            Check(a.Move.Count.ContainsKey("gore") || a.Move.Count.ContainsKey("goreL"), "四角挑出过");
        }

        IEnumerator Jufu()
        {
            Line("举父");
            var j = Spawn<JufuAI>("jufu", away * -10f);
            if (!j) yield break;
            yield return new WaitForSeconds(1f);
            StandAt(j, 14f);
            j.Force("throw");
            yield return WaitFor(() => j.Throws > 0, 2.5f);
            Check(j.Throws > 0, "远投：石头扔出去了");
            yield return new WaitForSeconds(2f);
            // 雷暴：雷石落地留电场
            PlateauEnemyAI.StormOverride = 1f;
            yield return WaitFor(() => !j.Move.Busy, 3f);
            j.Force("throw");
            yield return WaitFor(() => j.LastField, 4f);
            Check(j.LastField, "雷暴里投雷石 → 落地留电场");
            if (j.LastField) Teleport(motor, j.LastField.transform.position);
            yield return new WaitForSeconds(1.2f);
            Check(j.LastField && j.LastField.Ticks > 0, $"站在电场里挨电（{(j.LastField ? j.LastField.Ticks : 0)} 次）");
            // 手中炸石
            StandAt(j, 12f);
            yield return WaitFor(() => !j.Move.Busy, 3f);
            j.Force("throw");
            yield return new WaitForSeconds(0.5f);
            int pops = j.Pops;
            var rock = j.transform.Find("Jufu Rock");
            for (int i = 0; i < 10 && j.Holding; i++)
            {
                Hurt(j, 10f, rock ? rock.position : j.Center + Vector3.up);
                yield return new WaitForSeconds(0.04f);
            }
            Check(j.Pops > pops, "举石时打石头 → 手中炸石");
            yield return null;
            Check(j.Dead || (j.GetComponent<EnemyStatus>() && j.GetComponent<EnemyStatus>().Stunned) || j.Move.Id == "fall", "炸石后眩晕（或摔下高处）");
            PlateauEnemyAI.StormOverride = null;
        }

        IEnumerator Manman()
        {
            Line("蛮蛮");
            var a = Spawn<ManmanAI>("manman", away * -6f);
            var b = Spawn<ManmanAI>("manman", away * -6f + Vector3.right * 3f);
            if (!a || !b) yield break;
            a.holdFire = b.holdFire = true;
            yield return new WaitForSeconds(1.5f);
            Check(a.Paired && b.Paired, "一对配上了");
            Check(a.Charged && b.Charged, "成对时带电");
            var lead = a.Lead ? a : b;
            lead.StartSweep();
            yield return WaitFor(() => !lead.Move.Busy, 4f);
            Check(lead.Sweeps > 0 && lead.Move.Count.ContainsKey("sweep"), $"电弧横扫出过（扫中 {lead.SweepHit}）");
            var other = lead == a ? b : a;
            Hurt(lead, 9999f, lead.Center);
            yield return new WaitForSeconds(0.2f);
            Check(other.Downed, "打死一只 → 另一只坠落");
            yield return new WaitForSeconds(1.5f);
            Check(other.transform.position.y - Ground(other.transform.position) < 0.6f, "坠落的那只落到地上追啄");
        }

        static float Ground(Vector3 p) => Physics.Raycast(p + Vector3.up * 2f, Vector3.down, out var h, 30f, Spiritfire.Game.Layers.WorldMask, QueryTriggerInteraction.Ignore) ? h.point.y : p.y;

        IEnumerator Liangu()
        {
            Line("连鼓灵");
            var t1 = Spawn<TiangouAI>("tiangou", away * -6f);
            var t2 = Spawn<TiangouAI>("tiangou", away * -6f + Vector3.right * 2f);
            var l = Spawn<LianguAI>("liangu", away * -10f);
            if (!l || !t1 || !t2) yield break;
            Teleport(motor, l.transform.position + away * 20f);
            yield return WaitFor(() => l.Beats >= 3, 6f);
            Check(l.Beats >= 3, $"鼓点（{l.Beats} 拍，护盾 {l.ShieldsGiven}、加速 {l.HastesGiven}）");
            Check(l.ShieldsGiven > 0 || l.HastesGiven > 0, "鼓点给同伴加了护盾 / 加速");
            var shielded = t1.ShieldLayers > 0 ? t1 : t2.ShieldLayers > 0 ? t2 : null;
            if (shielded)
            {
                float hp0 = shielded.Health.health;
                int blocks = shielded.ShieldBlocks;
                Hurt(shielded, 10f, shielded.Center);
                Check(shielded.ShieldBlocks > blocks && Mathf.Approximately(shielded.Health.health, hp0), "静电护盾挡下一次伤害");
            }
            Check(l.Charged, "雷心一直带电");
            for (int i = 0; i < LianguAI.Drums; i++) l.DebugBreakDrum(i);
            yield return new WaitForSeconds(0.3f);
            Check(l.DrumsLeft == 0 && l.Dropped, "六面鼓全碎 → 雷心落地");
        }

        IEnumerator Dijiang()
        {
            Line("帝江");
            var list = new List<DijiangAI>();
            for (int i = 0; i < 3; i++)
            {
                var d = Spawn<DijiangAI>("dijiang", away * -10f + new Vector3(i * 1.6f, 0, 0));
                if (d) list.Add(d);
            }
            if (list.Count < 3) yield break;
            Teleport(motor, list[0].transform.position + away * 25f);
            yield return new WaitForSeconds(0.8f);
            foreach (var d in list) d.Notice(false);
            yield return new WaitForSeconds(1.5f);
            Check(list.Sum(d => d.Hops) > 0, $"歌舞：蹦着过来（{list.Sum(d => d.Hops)} 蹦）");
            Hurt(list[0], 9999f, list[0].Center);
            yield return new WaitForSeconds(0.8f);
            int popped = list.Count(d => d.Popped);
            Check(popped >= 2, $"打爆一只 → 连锁引爆（{popped} / 3）");
            Reset();
            var s = Spawn<DijiangAI>("dijiang", away * -3f);
            if (!s) yield break;
            yield return new WaitForSeconds(0.8f);
            StandAt(s, 2f);
            s.ForceSwell();
            yield return WaitFor(() => s.Popped, 2f);
            Check(s.Popped && s.SelfPop, "贴身胀爆（球雷）");
        }

        IEnumerator Qiongqi()
        {
            Line("穷奇（精英）");
            var q = Spawn<QiongqiAI>("qiongqi", away * -14f);
            if (!q) yield break;
            Check(q.elite && q.Health.rank == Rank.Elite, $"精英（生命 {q.Health.maxHealth:0}）");
            yield return new WaitForSeconds(1f);
            StandAt(q, 16f);
            q.Force("glide");
            yield return WaitFor(() => !q.Move.Busy, 4f);
            Check(q.Glides > 0 && q.Move.Count.ContainsKey("glide"), "掠空扑杀（起飞 → 滑翔 → 落地）");
            yield return new WaitForSeconds(1f);
            StandAt(q, 16f);
            q.Force("glide");
            yield return WaitFor(() => q.Move.Id == "glide" && q.Move.Stage == MoveStage.Active, 2f);
            yield return new WaitForSeconds(0.2f);
            q.DebugCrash();
            yield return WaitFor(() => q.GetComponent<EnemyStatus>() && q.GetComponent<EnemyStatus>().Stunned, 3f);
            Check(q.Crashed && q.GetComponent<EnemyStatus>() && q.GetComponent<EnemyStatus>().Stunned, "滑翔中打穿翼根 → 坠地眩晕");
            yield return WaitFor(() => !q.GetComponent<EnemyStatus>().Stunned, 4f);
            q.Force("absorb");
            yield return WaitFor(() => !q.Move.Busy, 3f);
            Check(q.Charged, "吞雷 → 带电");
            StandAt(q, 2.5f);
            q.Force("spin");
            yield return WaitFor(() => !q.Move.Busy, 3f);
            Check(q.Move.Count.ContainsKey("spin"), "翼刃雷旋出过");
            q.Health.health = q.Health.maxHealth * 0.25f;
            StandAt(q, 25f);
            yield return WaitFor(() => q.Fleeing, 3f);
            Check(q.Fled, "血 < 30% → 撤退");
        }

        // ───────────── 受击四层、死法 ─────────────

        IEnumerator Layers()
        {
            Line("受击四层");
            var t = Spawn<TiangouAI>("tiangou", away * -5f);
            if (!t) yield break;
            yield return new WaitForSeconds(1f);
            Check(t.HitStagger(0.45f, motor.transform.position), "硬直入口（HitStagger）");
            Check(t.HitStaggered, "硬直中");
            yield return new WaitForSeconds(0.6f);
            Check(t.HitStun(1.5f, HitCause.Counter, "测试"), "眩晕入口（HitStun）");
            yield return null;
            var st = t.GetComponent<EnemyStatus>();
            Check(st && st.Stunned, "眩晕中");
            if (!ArenaSpawner.IsPlaceholder(t)) Check(t.CurrentAct == "stun", $"眩晕播 stun 循环（当前 {t.CurrentAct}）");
            // 韧性：2 秒内弱点伤害累计超过 30
            yield return new WaitForSeconds(1.6f);
            var poise = t.GetComponent<Poise>();
            int breaks = poise ? poise.Breaks : 0;
            Hurt(t, 20f, t.Center, Element.None, DamageSource.Weapon, true);
            yield return null;
            Check(poise && poise.Breaks > breaks, "韧性破 → 硬直");
        }

        IEnumerator Deaths()
        {
            Line("四种死法");
            var n = Spawn<TiangouAI>("tiangou", away * -5f);
            var w = Spawn<TiangouAI>("tiangou", away * -5f + Vector3.right * 3f);
            var e = Spawn<TiangouAI>("tiangou", away * -5f - Vector3.right * 3f);
            var c = Spawn<TiangouAI>("tiangou", away * -9f);
            var mate = Spawn<TiangouAI>("tiangou", away * -9f + Vector3.right * 2f);
            if (!n || !w || !e || !c || !mate) yield break;
            yield return new WaitForSeconds(1f);
            Hurt(n, 9999f, n.Center);
            Hurt(w, 9999f, w.Center, Element.None, DamageSource.Weapon, true);
            Hurt(e, 9999f, e.Center, Element.None, DamageSource.Explosion);
            Charge.Apply(c.Health, 5f);
            int arcs0 = arcs;
            yield return null;
            Hurt(c, 9999f, c.Center);
            yield return new WaitForSeconds(0.3f);
            Check(n.LastDeath == PlateauDeath.Normal, "普通击杀 → 普通死法");
            Check(w.LastDeath == PlateauDeath.Weak, "弱点击杀 → 弱点死法");
            Check(e.LastDeath == PlateauDeath.Blast, "爆炸击杀 → 爆炸死法");
            Check(c.DiedCharged && arcs > arcs0, $"带电死亡 → 放电（传了 {arcs - arcs0} 次）");
            Check(mate.Charged, "同伴接到电（带电）");
        }
    }

    /// <summary>
    /// 第四章雷魅的测试小工具（plateau-foes / beats-ch4-foes 共用）：TestArena 的场景敌人目录是生成场景时按名册填的，第四章的 Prefab 还不在里面
    /// （F 路最后统一重建 GameDatabase / 测试场）。编辑器里跑的时候临时把这九个 Prefab 和连鼓灵的挂件补进场景目录，跑完撤掉——不改场景文件。
    /// </summary>
    public static class PlateauTestKit
    {
        static readonly string[] Prefabs = { "SK_Enemy_Marmot", "SK_Enemy_Tiangou", "SK_Enemy_Aoyin", "SK_Enemy_Jufu", "SK_Enemy_Manman", "SK_Enemy_Dijiang", "SK_Enemy_Qiongqi" };
        static readonly string[] Parts = { "SM_EnemyPart_LianguCore", "SM_EnemyPart_LianguDrum", "SM_EnemyPart_LianguMallet" };

        /// <summary>补进场景目录；返回撤销的回调（没有场景目录 / 不在编辑器里时返回 null）</summary>
        public static Action InstallCatalog(Action<string> log)
        {
            var catalog = UnityEngine.Object.FindAnyObjectByType<EnemyCatalog>();
            if (!catalog) return null;
#if UNITY_EDITOR
            var savedPrefabs = catalog.prefabs;
            var savedParts = catalog.attachments;
            var prefabs = new List<GameObject>(catalog.prefabs);
            var parts = new List<GameObject>(catalog.attachments);
            int added = 0;
            foreach (var n in Prefabs)
            {
                var p = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>($"Assets/Art/Prefabs/Characters/{n}.prefab");
                if (p && !prefabs.Contains(p)) { prefabs.Add(p); added++; }
            }
            foreach (var n in Parts)
            {
                var p = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>($"Assets/Art/Prefabs/Attachments/{n}.prefab");
                if (p && !parts.Contains(p)) parts.Add(p);
                if (p && n.EndsWith("Core") && !prefabs.Contains(p)) { prefabs.Add(p); added++; }
            }
            catalog.prefabs = prefabs.ToArray();
            catalog.attachments = parts.ToArray();
            log?.Invoke($"场景敌人目录临时补上第四章 Prefab {added} 个");
            return () =>
            {
                if (!catalog) return;
                catalog.prefabs = savedPrefabs;
                catalog.attachments = savedParts;
            };
#else
            return null;
#endif
        }
    }
}