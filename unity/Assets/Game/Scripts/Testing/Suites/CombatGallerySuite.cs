using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.SceneManagement;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 战斗审阅图集（bridge.sh playtest gallery-&lt;组&gt;）：套着现成的冒烟套件跑（它们的剧本负责把每一招逼出来），
    /// 旁边挂一个 <see cref="GalleryRecorder"/> 按招式事件截前摇 / 出手 / 命中 + 第一人称，跑完再补拍：
    ///   · 套件没覆盖的敌人自由对打一段（玩家在 12 / 6 / 3.2 / 16 / 8 m 几个距离之间换站位、不还手）；
    ///   · 死亡巡检：每种刷一只、拍出生法阵 / 显形，处决后拍迸散 + 溶解。
    /// 截图在 Assets/Art/_Review/gallery/&lt;组&gt;/（jpg + manifest.json），拼图和总览页由 scripts/unity/combat_gallery.py 生成到 docs/art/review/unity-combat/。
    /// 只旁观、不改玩法；内层套件的检查照常记结论（不合格不影响截图）。
    /// </summary>
    public abstract class GallerySuite : PlaytestSuite
    {
        /// <summary>输出子目录 / 图集分组</summary>
        protected abstract string Group { get; }
        /// <summary>套着跑的冒烟套件（null = 不套）</summary>
        protected virtual string Inner => null;

        protected GalleryRecorder Rec { get; private set; }
        protected ArenaSpawner arena;
        protected PlayerMotor motor;
        protected PlayerVitals vitals;
        protected WeaponController weapons;
        protected Vector3 away;

        protected override IEnumerator Steps()
        {
            Rec = Runner.gameObject.AddComponent<GalleryRecorder>();
            Rec.Begin(Group, Path.Combine(ShotDir ?? "Assets/Art/_Review", "gallery", Group), SceneManager.GetActiveScene().path, Line);
            if (Inner != null)
            {
                var inner = PlaytestSuites.Create(Inner);
                if (inner == null) Fail($"没有内层套件 {Inner}");
                else
                {
                    Line($"── 内层套件 {Inner} ──");
                    yield return inner.Run(Runner);
                }
            }
            Line("── 图集补拍 ──");
            yield return Extra();
            yield return new WaitForSeconds(1f);
            Rec.End();
            Destroy(Rec);
        }

        /// <summary>内层套件跑完后的补拍</summary>
        protected virtual IEnumerator Extra()
        {
            yield break;
        }

        /// <summary>测试场的玩家、刷怪台、血量垫高；返回 false = 不在测试场</summary>
        protected bool SetupArena(string tag)
        {
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail($"补拍缺少组件：weapons={weapons} motor={motor} vitals={vitals} arena={arena}");
                return false;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            weapons.testFire = false;
            vitals.stats.Remove(tag);
            vitals.stats.Add(tag, Stat.MaxHp, 5000);
            vitals.Heal(99999);
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            return true;
        }

        /// <summary>自由对打：普通 + 精英（+ 同伴），玩家每 5.5 s 换一个距离站着看它、不还手</summary>
        protected IEnumerator FreeFight(string id, float seconds, params string[] companions)
        {
            if (!ArenaSpawner.IsRegistered(id))
            {
                Line($"自由对打 {id}：名册里没有，跳过");
                yield break;
            }
            arena.Clear();
            AttackTokens.Reset();
            PackCoordinator.Reset();
            yield return new WaitForSeconds(0.3f);
            Teleport(motor, arena.Center + away * 12f);
            yield return null;
            var main = arena.Spawn(id, false, new Vector3(-2f, 0, 0));
            var elite = arena.Spawn(id, true, new Vector3(2.5f, 0, -2f));
            for (int i = 0; i < companions.Length; i++) arena.Spawn(companions[i], false, new Vector3(-3f + 3f * i, 0, 3.5f));
            float[] dists = { 12f, 6f, 3.2f, 16f, 8f };
            float t0 = Time.time, next = 0;
            int k = 0;
            while (Time.time - t0 < seconds)
            {
                var focus = main && !main.Dead ? main : elite && !elite.Dead ? elite : null;
                if (!focus) break;
                if (Time.time >= next)
                {
                    Teleport(motor, focus.transform.position + away * dists[k++ % dists.Length]);
                    next = Time.time + 5.5f;
                }
                Aim(motor, weapons.eye.transform, BodyCenter(focus.Health));
                if (vitals.health < vitals.MaxHealth * 0.5f) vitals.Heal(99999);
                weapons.testFire = false;
                yield return null;
            }
            Line($"自由对打 {id}{(companions.Length > 0 ? $"（同伴 {string.Join("、", companions)}）" : "")}：{Time.time - t0:F0} s，图集累计 {Rec.Count} 张");
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
        }

        /// <summary>
        /// 逼招（第二批收尾 D 路）：自由对打逼不出来的招式——要先打碎弱点（狐巫铜镜、马面锁扣、熔铜匠坩埚）、要在引信烧着时打火药仓（炮仗傀儡）、
        /// 要贴身站着不动（火鼍陆上扑咬、马面空手重拳）、要飞够十几秒（三青鸟歇脚）。刷一只普通的，玩家站在 dist 米外看着它、不还手；
        /// poke 每帧调一次（参数：这只怪、开始后的秒数；返回 true = 已经推过一把，不再调），直到这一招拍满 4 格（前摇 / 第一人称 / 出手 / 命中·收招·效果）或超时。
        /// 前面已经拍满的跳过；超时没拍满记不合格（这几招要稳定截到）。
        /// </summary>
        protected IEnumerator Provoke(string id, string label, float dist, float timeout, System.Func<EnemyAI, float, bool> poke = null)
        {
            if (!ArenaSpawner.IsRegistered(id))
            {
                Line($"逼招 {id} · {label}：名册里没有，跳过");
                yield break;
            }
            if (Rec.ShotsOf(id, label) >= 4)
            {
                Line($"逼招 {id} · {label}：前面已经拍到，跳过");
                yield break;
            }
            arena.Clear();
            AttackTokens.Reset();
            PackCoordinator.Reset();
            yield return new WaitForSeconds(0.3f);
            Teleport(motor, arena.Center + away * dist);
            yield return null;
            var ai = arena.Spawn(id, false, Vector3.zero);
            if (!ai)
            {
                Fail($"逼招 {id} · {label}：刷不出来");
                yield break;
            }
            // 垫血：打弱点逼招那一下不会把它打死
            ai.Health.maxHealth *= 5f;
            ai.Health.ResetVitals();
            float t0 = Time.time;
            bool poked = poke == null;
            while (Time.time - t0 < timeout && ai && !ai.Dead && Rec.ShotsOf(id, label) < 4)
            {
                Aim(motor, weapons.eye.transform, BodyCenter(ai.Health));
                if (vitals.health < vitals.MaxHealth * 0.5f) vitals.Heal(99999);
                weapons.testFire = false;
                if (!poked) poked = poke(ai, Time.time - t0);
                yield return null;
            }
            int n = Rec.ShotsOf(id, label);
            Line($"逼招 {id} · {label}：{(n >= 4 ? "拍到" : "没拍满")}（{Time.time - t0:F1} s，{n} 格，最后状态 {(ai ? ai.State : "已回收")}）");
            if (n < 4) Fail($"逼招 {id} · {label}：{timeout:F0} s 内没拍满（{n} 格）");
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
        }

        /// <summary>打一下弱点（命中点在弱点中心、从玩家眼睛方向打来；命中区按命中点认，弱点区的 Damaged 照常发）</summary>
        protected void HitWeak(EnemyAI ai, float amount)
        {
            if (!ai || !ai.Health) return;
            var body = ai.GetComponent<EnemyBody>();
            var p = body && body.WeakPoint ? body.WeakPoint.position : BodyCenter(ai.Health);
            var from = weapons.eye.transform.position;
            var dir = p - from;
            var info = DamageInfo.Simple(amount, DamageSource.Weapon, p, dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.forward);
            info.weakpoint = true;
            Combat.DamageEnemy(ai.Health, info);
        }

        /// <summary>死亡巡检：每种刷一只普通的 → 出生法阵 / 显形 → 处决 → 迸散 + 溶解</summary>
        protected IEnumerator DeathParade(IEnumerable<string> ids)
        {
            Rec.deaths = true;
            foreach (var id in ids)
            {
                if (!ArenaSpawner.IsRegistered(id)) continue;
                arena.Clear();
                AttackTokens.Reset();
                yield return new WaitForSeconds(0.3f);
                // 刷怪台东侧 14 m 的空地（武器架、刷怪台都在西边、不入镜），玩家站它北边 9 m
                var east = Vector3.Cross(Vector3.up, away);
                var spot = arena.Center + east * 14f - away * 4f;
                Teleport(motor, spot - away * 9f);
                yield return null;
                var ai = arena.Spawn(id, false, spot - arena.Center);
                if (!ai) continue;
                Rec.SpawnShots(ai);
                float t0 = Time.time;
                while (Time.time - t0 < 1.6f)
                {
                    if (ai) Aim(motor, weapons.eye.transform, BodyCenter(ai.Health));
                    yield return null;
                }
                if (ai && !ai.Dead) Combat.Execute(ai.Health, false);
                // 尸体溶解在回收前 1.1 s 开始：等到回收（或 8 s）
                t0 = Time.time;
                while (Time.time - t0 < 8f && ai) yield return null;
                yield return new WaitForSeconds(0.3f);
            }
            Rec.deaths = false;
            arena.Clear();
            Line($"死亡巡检：图集累计 {Rec.Count} 张");
        }
    }

    public sealed class GalleryDesertSuite : GallerySuite
    {
        public override string Id => "gallery-desert";
        public override string Scene => "Assets/Scenes/TestArena.unity";
        protected override string Group => "desert";
        protected override string Inner => "desert";

        protected override IEnumerator Extra()
        {
            if (!SetupArena("gallery_desert")) yield break;
            yield return DeathParade(GalleryAttacks.Desert);
        }
    }

    public sealed class GalleryFrostSuite : GallerySuite
    {
        public override string Id => "gallery-frost";
        public override string Scene => "Assets/Scenes/TestArena.unity";
        protected override string Group => "frost";
        protected override string Inner => "frost";

        protected override IEnumerator Extra()
        {
            if (!SetupArena("gallery_frost")) yield break;
            // frost 套件只跑 EN2a–c 的六种：其余五种自由对打（辅助型带同伴）
            yield return FreeFight("fox_witch", 30f, "jiaoren", "jiaoren");
            yield return FreeFight("fuzhu", 26f);
            yield return FreeFight("haozhi", 26f);
            yield return FreeFight("ice_whale", 28f);
            yield return FreeFight("lantern_jelly", 26f, "xingxing", "xingxing");
            // 逼招：狐火只在铜镜碎了（沉默）以后放；三青鸟飞满 11–14 s 才歇脚
            yield return Provoke("fox_witch", "狐火", 12f, 16f, (ai, t) =>
            {
                if (t < 1.8f) return false;
                HitWeak(ai, ai.Health.maxHealth * FoxWitchAI.MirrorBreak * 1.15f);
                return true;
            });
            yield return Provoke("qingniao", "歇脚", 12f, 34f);
            yield return DeathParade(GalleryAttacks.Frost);
        }
    }

    public sealed class GalleryInfernoSuite : GallerySuite
    {
        public override string Id => "gallery-inferno";
        public override string Scene => "Assets/Scenes/TestArena.unity";
        protected override string Group => "inferno";
        protected override string Inner => "inferno";

        protected override IEnumerator Extra()
        {
            if (!SetupArena("gallery_inferno")) yield break;
            // inferno 套件里这四种只活 10 s：再自由对打一段（辅助型带同伴）
            yield return FreeFight("firecracker", 28f);
            yield return FreeFight("fire_crow", 24f, "fire_crow", "fire_crow");
            yield return FreeFight("founder", 26f, "huodou", "tantong");
            yield return FreeFight("nuo", 26f, "huodou", "tantong");
            // 逼招：这五招都要玩家「做点什么」或贴身站着，自由对打里逼不出来
            // 哑炸倒地：引信烧着（fuse）时打中火药仓
            yield return Provoke("firecracker", "哑炸倒地", 10f, 20f, (ai, t) =>
            {
                if (ai.State != "fuse" || ai is not FirecrackerAI fc) return false;
                var p = fc.BellyCenter;
                var info = DamageInfo.Simple(5f, DamageSource.Weapon, p, (p - weapons.eye.transform.position).normalized);
                info.weakpoint = true;
                Combat.DamageEnemy(ai.Health, info);
                return true;
            });
            // 裂锅：坩埚挨够 30% 生命的弱点伤害
            yield return Provoke("founder", "裂锅", 8f, 12f, (ai, t) =>
            {
                if (t < 1.8f) return false;
                HitWeak(ai, ai.Health.maxHealth * FounderAI.CrucibleBreak * 1.15f);
                return true;
            });
            // 重拳：打断锁扣缴械，之后它空手走过来，玩家站着不动
            yield return Provoke("mamian", "重拳", 6f, 18f, (ai, t) =>
            {
                if (t < 1.5f) return false;
                HitWeak(ai, ai.Health.maxHealth * MamianAI.LockBreak * 1.15f);
                return true;
            });
            // 碎面：面具挨够伤害（直接走碎面入口：面具只认正面、被袖子挡时不算）
            yield return Provoke("nuo", "碎面", 8f, 10f, (ai, t) =>
            {
                if (t < 1.8f || ai.State is "enter" or "spawn" || ai is not NuoAI nuo) return false;
                nuo.BreakFace();
                return true;
            });
            // 陆上扑咬：没有熔岩时火鼍在岸上打，玩家站在它正前方 3 m
            yield return Provoke("tuo", "陆上扑咬", 3f, 16f);
            yield return DeathParade(GalleryAttacks.Inferno);
        }
    }

    public sealed class GalleryHanbaSuite : GallerySuite
    {
        public override string Id => "gallery-hanba";
        public override string Scene => "Assets/Scenes/L1_4_Crescent.unity";
        protected override string Group => "hanba";
        protected override string Inner => "boss-hanba";
    }

    public sealed class GalleryKunPengSuite : GallerySuite
    {
        public override string Id => "gallery-kunpeng";
        public override string Scene => "Assets/Scenes/L2_4_Beiming.unity";
        protected override string Group => "kunpeng";
        protected override string Inner => "boss-kunpeng";
    }

    public sealed class GalleryWarlordSuite : GallerySuite
    {
        public override string Id => "gallery-warlord";
        public override string Scene => "Assets/Scenes/L3_3_Foundry.unity";
        protected override string Group => "warlord";
        protected override string Inner => "boss-warlord";
    }

    public sealed class GalleryQilinSuite : GallerySuite
    {
        public override string Id => "gallery-qilin";
        public override string Scene => "Assets/Scenes/L3_4_Zhurong.unity";
        protected override string Group => "qilin";
        protected override string Inner => "boss-qilin";
    }

    /// <summary>
    /// 图集的招式表：每种敌人的每个攻击 = 前摇状态 → 出手状态（空 = 前摇一结束就算出手：施法、蓄力类）→ 可选的命中状态
    /// （落地旋斩、拖拽这类「命中」本身是一个状态的）。ranged = 弹体要飞一会儿，命中帧多等一会（2.8 s）。状态名取自各 AI 的 SetState。
    /// </summary>
    public static class GalleryAttacks
    {
        public sealed class Attack
        {
            public string label, windup, impact;
            public string[] release;
            /// <summary>弹体 / 滚动要飞一会儿（命中帧多等）；辅助招（不打人：第三格拍出手后 0.7 s 的「效果」）</summary>
            public bool ranged, support;
        }

        static Attack A(string label, string windup, string release = "", string impact = null, bool ranged = false, bool support = false) => new()
        {
            label = label, windup = windup, impact = impact, ranged = ranged, support = support,
            release = string.IsNullOrEmpty(release) ? System.Array.Empty<string>() : release.Split('|'),
        };

        public static readonly string[] Desert = { "jerboa_blade", "scorpion_archer", "mirage_toad", "fire_rat", "tomb_beast", "apsara", "sand_wraith" };
        public static readonly string[] Frost =
            { "jiaoren", "xingxing", "xuangui", "frost_crab", "qingniao", "ice_puffer", "fox_witch", "fuzhu", "haozhi", "ice_whale", "lantern_jelly" };
        public static readonly string[] Inferno =
            { "tantong", "huodou", "iron_ox", "tuo", "bifang", "mamian", "firecracker", "fire_crow", "founder", "nuo" };

        /// <summary>移动 / 待机类状态：不单独拍</summary>
        public static readonly HashSet<string> Movement = new()
        {
            "idle", "spawn", "chase", "move", "advance", "stalk", "hover", "drift", "circle", "march", "run", "swim", "perch", "dance", "recover", "rest",
            "intro", "transition", "stagger", "pile",
        };

        static readonly Dictionary<string, Attack[]> Table = new()
        {
            // ── 第一章 ──
            ["jerboa_blade"] = new[] { A("扑斩 · 落地旋斩", "crouch", "leap", "spin"), A("交叉斩", "slashWindup", "slash") },
            ["scorpion_archer"] = new[] { A("上弦连射", "aim", "fire", ranged: true), A("钻沙突袭", "dive", "tunnel", "emerge"), A("钳击", "snapWindup", "snap") },
            ["mirage_toad"] = new[] { A("鼓囊吐火", "puff", "spit", ranged: true), A("蜃景分身", "mirage", support: true) },
            ["mirage_toad_decoy"] = new[] { A("幻影吐火", "puff", "spit", ranged: true) },
            ["fire_rat"] = new[] { A("蜷身滚球自爆", "curl", "roll", ranged: true) },
            ["tomb_beast"] = new[] { A("刨地冲锋", "chargeWindup", "charge"), A("踏地冲击波", "stompWindup", "stomp") },
            ["apsara"] = new[] { A("施法（和弦 / 花开 / 赐福）", "cast", support: true), A("重凝", "reform", support: true) },
            ["sand_wraith"] = new[] { A("潜沙突袭 · 破沙旋斩", "surface", "erupt"), A("沉沙", "sink", "burrow", support: true), A("交叉爪击", "slashWindup", "slash") },
            // ── 第二章 ──
            ["jiaoren"] = new[] { A("投矛", "aim", "throw", ranged: true), A("群刺", "lungeWindup", "lunge"), A("戳刺", "jabWindup", "jab") },
            ["xingxing"] = new[]
            {
                A("跳砸冰环", "slamWindup", "slamAir"), A("抓挠", "swipeWindup", "swipe"), A("抛冰块", "throwWindup", "throwRelease", ranged: true),
                A("攀爬高台", "climbPrep", "climb", support: true), A("起哄捶胸", "rally", support: true),
            },
            ["xuangui"] = new[]
            {
                A("冰喙猛啄", "peckWindup", "peck"), A("蛇尾反咬", "biteWindup", "bite"), A("缩壳旋转", "retract", "spin", "overheat"),
                A("过热翻倒", "overheat", "rightself", support: true),
            },
            ["frost_crab"] = new[] { A("巨钳夹击", "grabWindup", "grab"), A("冰屑横扫", "sweepWindup", "sweep"), A("断钳", "shellBreak", support: true) },
            ["qingniao"] = new[] { A("冰羽扇射", "volley", ranged: true), A("尖啸俯冲", "screech", "swoopDown", "swoopUp"), A("歇脚", "toPerch", "perched", support: true) },
            ["ice_puffer"] = new[] { A("俯冲", "dive", "inflate", support: true), A("鼓气自爆", "inflate") },
            ["fox_witch"] = new[]
            {
                A("立冰壁", "wallWindup", support: true), A("霜甲", "armorWindup", support: true), A("照妖镜", "mirrorCharge"), A("狐火", "foxfireWindup", ranged: true), A("闪身", "blink", support: true),
            },
            ["fuzhu"] = new[] { A("冰光", "charge"), A("跳跃换位", "crouch", "leap", "land", support: true) },
            ["haozhi"] = new[] { A("刨地冲锋", "scrape", "charge"), A("冰刺新星", "bristle") },
            ["ice_whale"] = new[] { A("冰柱雨", "swell", "spout", ranged: true), A("翻身拍击", "rear", "slam") },
            ["lantern_jelly"] = new[] { A("电冻", "shockWindup") },
            // ── 第三章 ──
            ["tantong"] = new[] { A("扑抓", "pounceWindup", "pounce", "flail"), A("抛炭", "throwWindup", "throwRelease", ranged: true), A("吹火复燃", "blowGo", "blow", support: true) },
            ["tantong_reborn"] = new[] { A("扑抓", "pounceWindup", "pounce", "flail"), A("抛炭", "throwWindup", "throwRelease", ranged: true) },
            ["huodou"] = new[] { A("扑咬", "biteWindup", "bite"), A("食火", "seekFire", "eat", support: true), A("吐火", "spitWindup", "spit") },
            ["iron_ox"] = new[] { A("鼓风吸气", "inhale", "spitWindup|choke"), A("熔铁喷吐", "spitWindup", "spit"), A("顶角掀地", "tossWindup", "toss") },
            ["tuo"] = new[]
            {
                A("伏击扑咬", "surge", "lunge", "bite"), A("陆上扑咬", "biteWindup", "bite"), A("甩尾", "sweepWindup", "sweep"), A("鼍鸣震波", "roar"),
                A("潜熔", "toLava", "swim", support: true),
            },
            ["bifang"] = new[] { A("毕方鸣 · 火矛", "cryBi", "cryFang", ranged: true), A("换栖滑翔", "takeoff", "glide", "land", support: true), A("断足坠落", "fall", "downed", support: true) },
            ["mamian"] = new[]
            {
                A("勾魂索", "spin", "throw", "drag", ranged: true), A("锁链横扫", "sweepWind", "sweep"), A("重拳", "punchWind", "punch"), A("缴械", "staggered", support: true),
            },
            ["firecracker"] = new[] { A("一窝蜂", "fuse", "volley", ranged: true), A("地老鼠", "stomp", ranged: true), A("哑炸倒地", "toppled", "getup", support: true) },
            ["fire_crow"] = new[] { A("点火俯冲", "ignite", "dive") },
            ["founder"] = new[] { A("浇铜甲", "pourWindup", "pouring", support: true), A("泼铜", "flingWindup", "retreat"), A("裂锅", "crackStagger", support: true) },
            ["nuo"] = new[] { A("吐火扫", "spitWindup", "spit"), A("变脸", "wipe", support: true), A("碎面", "cover", support: true) },
        };

        public static Attack[] For(string id) => id != null && Table.TryGetValue(id, out var a) ? a : System.Array.Empty<Attack>();

        /// <summary>表外状态的中文名（拼图标注用；没登记的原样）</summary>
        public static string StateName(string s) => s switch
        {
            "hopBack" => "后跳", "dizzy" => "撞晕", "brake" => "刹车", "dazed" => "撞墙晕", "enter" => "登场", "takeoff" => "起飞",
            "perched" => "歇脚", "toPerch" => "飞去栖点", "grabRecover" => "收钳", "swoopUp" => "拉升", "land" => "落地", "glide" => "滑翔",
            "downed" => "倒地", "getup" => "起身", "brawl" => "空手", "reel" => "收链", "retreat" => "后撤", "regrow" => "长甲", "eat" => "吃火",
            "backoff" => "后退", "rightself" => "翻身", "climb" => "攀爬", "hop" => "跳下", "burrow" => "沙下潜行", "tunnel" => "沙下潜行",
            "emerge" => "钻出", "sink" => "沉沙", "fall" => "坠落", "drag" => "拖拽", "flail" => "乱抓", "throwRelease" => "抛出",
            "volley" => "齐射", "brace" => "扎马", "toppled" => "仰倒", "shellBreak" => "断钳", "overheat" => "过热", "spin" => "旋转",
            "seekFire" => "找火", "blowGo" => "去吹火", "blow" => "吹火", "toLava" => "下熔岩", "surge" => "冲出", "lunge" => "扑出",
            "choke" => "呛火", "crackStagger" => "裂锅踉跄", "cover" => "捂脸", "wipe" => "变脸", "reform" => "重凝",
            _ => s,
        };
    }
}
