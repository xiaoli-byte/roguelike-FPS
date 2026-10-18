using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Spiritfire.Art;
using UnityEngine;
using Random = UnityEngine.Random;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 自动冒烟测试（bridge.sh playtest）：Play 模式里由脚本操控玩家，逐项检查切片的玩法回路，结果写成文本，
    /// 截图存 Assets/Art/_Review/playtest_*.png。不替代手玩，只保证「能跑、数值对、没有运行时报错」。
    /// 步骤：换弹 / 拾枪切枪 → 灵宠（八只依次结契打几只敌人、放灵技，日志前缀 [pets]）
    ///       → 依次进入 ①–④ 触发遭遇战，自动瞄最近的敌人射击直到肃清（玩家临时 5000 血，记录敌人打出的伤害；② 的宝箱是灵兽封印）
    ///       → 玩家受伤（护盾 / 生命）→ 阵亡。
    /// </summary>
    public sealed class PlaytestRunner : MonoBehaviour
    {
        public static bool Done;
        public string resultPath, shotDir;

        readonly List<string> lines = new();
        int errors, hits, crits, kills, skillHits, burnTicks, skillCasts;
        float damage, playerDamage, totalPlayerDamage, petDamage;
        readonly Dictionary<string, int> killsById = new();
        readonly Dictionary<string, int> reactionsById = new();

        void Line(string s)
        {
            lines.Add(s);
            Flush("进行中（未跑完）");
        }

        void Fail(string s)
        {
            errors++;
            Line("✗ " + s);
        }

        /// <summary>每加一行就落盘：超时被强制退出时也能看到跑到了哪一步</summary>
        void Flush(string header)
        {
            if (string.IsNullOrEmpty(resultPath)) return;
            try { File.WriteAllText(resultPath, header + "\n" + string.Join("\n", lines), Encoding.UTF8); }
            catch (IOException) { }
        }

        void OnEnable()
        {
            Application.logMessageReceived += OnLog;
            Combat.EnemyDamaged += OnDamaged;
            Combat.EnemyKilled += OnKilled;
            Combat.PlayerDamaged += OnPlayerDamaged;
            ReactionSystem.Reacted += OnReacted;
        }

        void OnDisable()
        {
            Application.logMessageReceived -= OnLog;
            Combat.EnemyDamaged -= OnDamaged;
            Combat.EnemyKilled -= OnKilled;
            Combat.PlayerDamaged -= OnPlayerDamaged;
            ReactionSystem.Reacted -= OnReacted;
        }

        void OnReacted(Damageable d, Reaction id, Vector3 p, float b, int hits)
        {
            var k = ReactionSystem.Names[(int)id];
            reactionsById.TryGetValue(k, out var n);
            reactionsById[k] = n + 1;
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is LogType.Exception or LogType.Error) Fail($"运行时{type}：{msg}\n{stack}");
        }

        void OnDamaged(Damageable d, DamageInfo info, DamageResult r)
        {
            if (info.source == DamageSource.Pet)
            {
                petDamage += r.total;
                return;
            }
            if (info.source == DamageSource.Skill) skillHits++;
            if (info.source == DamageSource.Status) burnTicks++;
            if (info.source is DamageSource.Skill or DamageSource.Status) return;
            hits++;
            damage += r.total;
            if (r.crit) crits++;
        }

        void OnKilled(Damageable d, DamageInfo info)
        {
            kills++;
            killsById.TryGetValue(d.displayName ?? "?", out var n);
            killsById[d.displayName ?? "?"] = n + 1;
        }

        void OnPlayerDamaged(float amount, Vector3 from) => playerDamage += amount;

        void Start() => StartCoroutine(Run());

        IEnumerator Run()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindFirstObjectByType<WeaponController>();
            var motor = FindFirstObjectByType<PlayerMotor>();
            var vitals = FindFirstObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少玩家组件：weapons={weapons} motor={motor} vitals={vitals}");
                Finish();
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            var skills = FindAnyObjectByType<HeroSkills>();
            if (!skills) Fail("玩家身上没有 HeroSkills");
            else skills.Cast += _ => skillCasts++;
            var interactor = FindFirstObjectByType<Interactor>();
            if (!interactor) Fail("玩家身上没有 Interactor");
            var eye = weapons.eye.transform;
            Line($"玩家：生命 {vitals.health}/{vitals.MaxHealth} 护盾 {vitals.shield}/{vitals.MaxShield} 移速 {motor.walkSpeed} 武器 {weapons.Active?.def.name}");

            // ── 1. 换弹 / 拾枪 / 切枪 ──
            var w = weapons.Active;
            weapons.testFire = true;
            yield return new WaitForSeconds(0.5f);
            weapons.testFire = false;
            int magBefore = w.mag;
            weapons.testReload = true;
            yield return new WaitForSeconds(w.def.reloadTime + 0.3f);
            Line($"换弹：弹匣 {magBefore} → {w.mag}/{w.def.mag}");
            if (w.mag != w.def.mag) Fail("换弹后弹匣没有装满");
            var revolver = new WeaponInstance(WeaponLibrary.Get("revolver"));
            weapons.Give(revolver);
            yield return new WaitForSeconds(0.5f);
            if (weapons.Active != revolver) Fail($"拾取左轮后当前武器是 {weapons.Active?.def.name}");
            weapons.testSwitch = 0;
            yield return new WaitForSeconds(0.5f);
            if (weapons.ActiveSlot != 0) Fail("切回 1 号槽失败");
            weapons.slots[1] = null; // 还原成开局状态：第二把枪要从 ① 的宝箱里拿

            // ── 灵宠：八只依次结契，各打几只敌人、放一次灵技；灵契升级觉醒、换宠留封印 ──
            yield return PetTest(motor, eye, vitals);

            // ── 动画控制器诊断：敌人身上的动画到底有没有在播 ──
            yield return AnimatorDiag(motor);

            // ── 碰撞体同步：敌人移动后，射线要打在它「现在看得见的位置」上（物理设置错时会打在它出生的位置）──
            yield return ColliderSyncTest(motor, eye);

            // ── 贴脸打蝎尾弩卫：出生无敌期显示「免疫」，之后（包括它开始钻沙、还露在外面时）要掉血；顶在它身上开枪也要掉血 ──
            yield return PointBlankTest(motor, eye, weapons, 1.5f, "1.5 m");
            yield return PointBlankTest(motor, eye, weapons, 1.0f, "顶在它身上");

            // ── 元素反应：对同一个敌人依次挂两种 / 三种元素，应当打出对应的反应 ──
            yield return ReactionTest(motor, "scorpion_archer", new[] { Element.Fire, Element.Shock }, Reaction.Thunderfire);
            yield return ReactionTest(motor, "tomb_beast", new[] { Element.Fire, Element.Corrode }, Reaction.Meltdown);
            yield return ReactionTest(motor, "scorpion_archer", new[] { Element.Shock, Element.Corrode }, Reaction.Veinseal);
            yield return ReactionTest(motor, "scorpion_archer", new[] { Element.Fire, Element.Shock, Element.Corrode }, Reaction.Abyss);

            // ── 姿态：每种敌人在持续火力（光束式连击 + 灼烧 / 雷殛 / 蚀化 + 反应）下身体不能被压歪 / 侧翻 ──
            vitals.stats.Add("playtest_tilt", Stat.MaxHp, 5000);
            vitals.Heal(99999);
            yield return TiltTest(motor, eye, weapons);
            foreach (var id in new[] { "jerboa_blade", "scorpion_archer", "mirage_toad", "tomb_beast", "apsara", "fire_rat" })
                yield return PoseTest(motor, eye, id);

            // ── 蝎尾：待机动画下尾巴的角速度，开 / 关尾巴弹簧对比（「一直乱甩」是不是弹簧骨造成的）──
            yield return TailTest(motor);

            // ── 动作连拍：跟拍几种关键动作，记下每一帧的 AI 状态和动画状态（人工核对动画有没有真的播出来）──
            yield return MotionTest(motor, "scorpion_archer", 0f, false, 2f, "motion_scorpion_idle");
            yield return MotionTest(motor, "scorpion_archer", 16f, true, 3f, "motion_scorpion_ai");
            yield return MotionTest(motor, "tomb_beast", 14f, true, 4f, "motion_tombbeast_charge");
            yield return MotionTest(motor, "mirage_toad", 30f, true, 3f, "motion_toad_move");
            vitals.stats.Remove("playtest_tilt");

            // ── 2. 四个遭遇战，按解锁顺序逐个打 ──
            var sites = new List<EncounterSite>(FindObjectsByType<EncounterSite>());
            sites.Sort((x, y) => string.CompareOrdinal(x.name, y.name));
            if (sites.Count == 0)
            {
                Fail("场景里没有遭遇战场地");
                Finish();
                yield break;
            }
            vitals.stats.Add("playtest", Stat.MaxHp, 5000);
            bool shotMid = false;
            foreach (var site in sites)
            {
                vitals.Heal(99999);
                killsById.Clear();
                reactionsById.Clear();
                playerDamage = 0;
                shotMid = false;
                Teleport(motor, site.transform.position + (motor.transform.position - site.transform.position).normalized * (site.triggerRadius - 3f));
                float t0 = Time.time;
                while (site.phase == EncounterSite.Phase.Idle && Time.time - t0 < 3f) yield return null;
                if (site.phase == EncounterSite.Phase.Idle)
                {
                    Fail($"进入「{site.title}」触发范围 3 s 后遭遇战没有开始");
                    break;
                }
                Line($"遭遇战「{site.title}」开始：敌人 {site.Total} 只");
                float fightStart = Time.time, flankAt = 0, skillAt = Time.time + 1f;
                while (site.phase != EncounterSite.Phase.Cleared && Time.time - fightStart < 120f)
                {
                    weapons.Active.reserve = weapons.Active.def.reserve; // 测试不缺子弹
                    var target = NearestEnemy(eye.position);
                    if (target)
                    {
                        var body = target.GetComponent<EnemyBody>();
                        var ai = target.GetComponent<EnemyAI>();
                        // 镇墓兽正面格挡：像玩家一样绕到背后打裂缝
                        if (ai is TombBeastAI && Time.time >= flankAt)
                        {
                            flankAt = Time.time + 2.5f;
                            Teleport(motor, target.transform.position - target.transform.forward * 9f);
                        }
                        var aim = body && body.WeakPoint && body.WeakPoint.gameObject.activeInHierarchy && Random.value < 0.4f
                            ? body.WeakPoint.position : BodyCenter(target);
                        Aim(motor, eye, aim);
                        // 追着打：离得太远就往目标走近一点；被掩体挡住就像玩家一样绕到看得见的位置
                        if (Vector3.Distance(eye.position, aim) > 22f) Teleport(motor, Vector3.MoveTowards(motor.transform.position, target.transform.position, 6f));
                        else if (Time.time >= flankAt && Combat.Blocked(eye.position, aim, null))
                        {
                            flankAt = Time.time + 1.5f;
                            if (SightSpot(target, aim, out var spot)) Teleport(motor, spot);
                        }
                        // 半自动枪要一下一下扣
                        weapons.testFire = weapons.Active.def.mode != FireMode.Semi || !weapons.testFire;
                        // 技能：E 有充能就扔（间隔 4 s），Q 好了就放
                        if (skills && Time.time >= skillAt)
                        {
                            skillAt = Time.time + 4f;
                            if (skills.secondary.charges > 0) skills.testE = true;
                            else if (skills.primary.charges > 0) skills.testQ = true;
                            var pets = PetOwner.Instance;
                            if (pets && pets.Current && pets.Current.SkillReady) pets.testSkill = true;
                        }
                        if (!shotMid && Time.time - fightStart > 4f)
                        {
                            shotMid = true;
                            Shot(weapons.eye, $"combat_{sites.IndexOf(site) + 1}");
                        }
                    }
                    else weapons.testFire = false;
                    yield return null;
                }
                weapons.testFire = false;
                float fightTime = Time.time - fightStart;
                var byId = new List<string>();
                foreach (var (k, v) in killsById) byId.Add($"{k}×{v}");
                Line($"  结束：{(site.phase == EncounterSite.Phase.Cleared ? "已肃清" : "超时")}，用时 {fightTime:F0} s，击杀 {string.Join("、", byId)}");
                Line($"  敌人对玩家造成伤害 {playerDamage:F0}");
                var rx = new List<string>();
                foreach (var (k, v) in reactionsById) rx.Add($"{k}×{v}");
                Line($"  元素反应：{(rx.Count > 0 ? string.Join("、", rx) : "无")}（武器 {weapons.slots[0]?.def.name} / {weapons.slots[1]?.def.name ?? "空"}）");
                if (site.phase != EncounterSite.Phase.Cleared) Fail($"120 s 内没有肃清「{site.title}」（剩 {site.Remaining}）");
                totalPlayerDamage += playerDamage;
                if (site.phase != EncounterSite.Phase.Cleared) break;
                yield return new WaitForSeconds(0.6f);
                if (!string.IsNullOrEmpty(site.reward)) yield return OpenChest(site, motor, eye, weapons, interactor, sites.IndexOf(site) + 1);
            }
            // 单个场地被秒清、一下没挨打很正常；整局都没挨过打才说明敌人的攻击坏了
            if (totalPlayerDamage <= 0) Fail("四个场地敌人都没有对玩家造成过伤害（攻击没有生效？）");
            Shot(weapons.eye, "cleared");

            // ── 出口：全部肃清后开启，按 F 结算 ──
            var portal = FindAnyObjectByType<ExitPortal>();
            if (!portal) Fail("场景里没有出口传送门");
            else
            {
                Line($"出口：{(portal.IsOpen ? "已开启" : "未开启")}");
                if (!portal.IsOpen) Fail("四个场地肃清后出口没有开启");
                Teleport(motor, portal.transform.position - portal.transform.forward * 3.5f);
                yield return new WaitForSeconds(0.5f);
                Aim(motor, eye, portal.Focus);
                yield return new WaitForSeconds(0.1f);
                if (interactor.Current as ExitPortal != portal) Fail($"站在出口前没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
                interactor.testInteract = true;
                yield return new WaitForSecondsRealtime(0.4f);
                bool done = GameSession.Instance && GameSession.Instance.Completed;
                Line($"进入出口：{(done ? "关卡完成" : "没有结算")}");
                if (!done) Fail("进入出口后没有关卡结算");
                Shot(weapons.eye, "complete");
                GameSession.Instance?.SetModal(false);
            }
            vitals.stats.Remove("playtest");

            // ── 3. 玩家受伤：护盾先吃，溢出扣生命 ──
            vitals.Revive();
            yield return null;
            float sh0 = vitals.shield, hp1 = vitals.health;
            Combat.DamagePlayer(30, motor.transform.position + motor.transform.forward * 5);
            Line($"受伤 30：护盾 {sh0:F0} → {vitals.shield:F0}，生命 {hp1:F0} → {vitals.health:F0}");
            float taken = 30 * (1 - Mathf.Clamp(vitals.stats.Get(Stat.DamageReduction), 0, 0.8f)); // 秘卷「石肤」有减伤
            if (Mathf.Abs(vitals.shield - Mathf.Max(0, sh0 - taken)) > 0.5f) Fail("护盾没有先吃伤害");

            // ── 4. 阵亡 ──
            Combat.DamagePlayer(999, motor.transform.position + motor.transform.forward);
            yield return new WaitForSecondsRealtime(0.6f);
            Line($"阵亡：Dead={vitals.Dead}，输入={(motor.inputEnabled ? "开" : "关")}");
            if (!vitals.Dead) Fail("致命伤害后没有阵亡");
            Shot(weapons.eye, "death");

            Line($"合计：武器命中 {hits}，伤害 {damage:F0}，暴击 {crits}，击杀 {kills}");
            Line($"技能：释放 {skillCasts} 次，技能命中 {skillHits}，灼烧跳伤 {burnTicks}");
            Line($"[pets] 灵宠伤害合计 {petDamage:F0}（当前灵宠 {(PetOwner.Instance && PetOwner.Instance.Current ? PetOwner.Instance.Current.def.Label : "无")}）");
            if (skills && skillCasts == 0) Fail("整局没有放出技能");
            if (skills && skillHits == 0) Fail("技能一次都没打中敌人");
            if (skills && burnTicks == 0) Fail("没有任何灼烧跳伤（火焰技能必定灼烧）");
            Finish();
        }

        /// <summary>肃清后：找到场地宝箱 → 走过去按 F → 按奖励类型验证（枪：拾取进槽；秘卷：三选一弹出、选第一张、层数 +1）</summary>
        IEnumerator OpenChest(EncounterSite site, PlayerMotor motor, Transform eye, WeaponController weapons, Interactor interactor, int index)
        {
            Chest chest = null;
            float t0 = Time.time;
            while (!chest && Time.time - t0 < 3f)
            {
                foreach (var c in FindObjectsByType<Chest>())
                    if (!c.Opened && c.reward == site.reward) chest = c;
                yield return null;
            }
            if (!chest)
            {
                Fail($"「{site.title}」肃清后没有出现宝箱");
                yield break;
            }
            int coins0 = Hud.Instance ? Hud.Instance.coins : 0;
            Teleport(motor, chest.transform.position + chest.transform.forward * 1.8f);
            yield return new WaitForSeconds(0.8f);
            Aim(motor, eye, chest.Focus);
            yield return new WaitForSeconds(0.1f);
            if (interactor.Current as Chest != chest)
            {
                Fail($"站在「{site.title}」宝箱前没有出现交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
                yield break;
            }
            interactor.testInteract = true;
            // 秘卷三选一会把时间停掉，这里只能等真实时间
            yield return new WaitForSecondsRealtime(0.7f);
            Shot(weapons.eye, $"chest_{index}");
            var kind = site.reward.Split(':')[0];
            if (kind == "weapon")
            {
                var id = site.reward.Split(':')[1];
                WeaponPickup drop = null;
                t0 = Time.time;
                while (!drop && Time.time - t0 < 2f)
                {
                    foreach (var w in FindObjectsByType<WeaponPickup>())
                        if (w.weapon.def.id == id) drop = w;
                    yield return null;
                }
                if (!drop)
                {
                    Fail($"宝箱 {site.reward} 没有掉出枪");
                    yield break;
                }
                yield return new WaitForSeconds(1.2f);
                Teleport(motor, drop.transform.position - eye.forward * 1.5f);
                yield return null;
                Aim(motor, eye, drop.Focus);
                yield return new WaitForSeconds(0.1f);
                if (interactor.Current as WeaponPickup != drop) Fail($"地上的 {drop.weapon.def.name} 没有交互提示");
                interactor.testInteract = true;
                yield return new WaitForSeconds(0.5f);
                bool got = weapons.Active != null && weapons.Active.def.id == id;
                Line($"  宝箱 → {drop.weapon.def.name}：{(got ? "已拾取" : "拾取失败")}，槽位 {weapons.slots[0]?.def.name ?? "空"} / {weapons.slots[1]?.def.name ?? "空"}");
                if (!got) Fail($"拾取 {id} 后手里不是它");
            }
            else if (kind == "scroll")
            {
                float r0 = Time.realtimeSinceStartup;
                while (!ScrollChoice.Open && Time.realtimeSinceStartup - r0 < 3f) yield return null;
                if (!ScrollChoice.Open)
                {
                    Fail("宝箱开启后秘卷三选一没有弹出");
                    yield break;
                }
                Line($"  秘卷三选一已弹出（时间 ×{Time.timeScale}）");
                if (Time.timeScale != 0) Fail("秘卷三选一时游戏没有暂停");
                yield return new WaitForSecondsRealtime(0.5f);
                Shot(weapons.eye, $"scrolls_{index}");
                var inv = LootDirector.Instance.scrolls;
                int before = 0;
                foreach (var v in inv.All.Values) before += v;
                ScrollChoice.Pick(0);
                yield return null;
                int after = 0;
                foreach (var v in inv.All.Values) after += v;
                var held = new List<string>();
                foreach (var (k, v) in inv.All) held.Add($"{ScrollLibrary.Get(k)?.name}×{v}");
                Line($"  选择后持有秘卷：{string.Join("、", held)}（时间 ×{Time.timeScale}）");
                if (after != before + 1) Fail("选了秘卷但层数没有增加");
                if (Time.timeScale != 1) Fail("选完秘卷后时间没有恢复");
            }
            else if (kind == "pet")
            {
                // 灵兽封印：落在宝箱前 → 走过去按 F 结契
                PetSeal seal = null;
                t0 = Time.time;
                while (!seal && Time.time - t0 < 2f)
                {
                    foreach (var s in PetSeal.Active)
                        if (s && !s.fromAltar && Vector3.Distance(s.transform.position, chest.transform.position) < 8f) seal = s;
                    yield return null;
                }
                if (!seal)
                {
                    Fail($"宝箱 {site.reward} 没有掉出灵兽封印");
                    yield break;
                }
                yield return new WaitForSeconds(1.2f);
                var back = eye.forward;
                back.y = 0;
                Teleport(motor, seal.transform.position - (back.sqrMagnitude > 1e-4f ? back.normalized : Vector3.forward) * 1.6f);
                yield return null;
                Aim(motor, eye, seal.Focus);
                yield return new WaitForSeconds(0.1f);
                if (interactor.Current as PetSeal != seal) Fail($"灵兽封印没有交互提示（当前 {interactor.Current?.Prompt ?? "无"}）");
                var petDef = seal.def;
                interactor.testInteract = true;
                yield return new WaitForSeconds(0.6f);
                var cur = PetOwner.Instance ? PetOwner.Instance.Current : null;
                Line($"[pets] 宝箱 → 灵兽封印 {petDef.Label}：{(cur && cur.def == petDef ? "已结契" : "结契失败")}");
                if (!cur || cur.def != petDef) Fail("开宝箱得到的灵兽封印没能结契");
                Shot(weapons.eye, $"pet_{index}");
            }
            yield return new WaitForSeconds(0.8f);
            if (Hud.Instance) Line($"  灵石 {Hud.Instance.coins}（本段拾取 {Hud.Instance.coins - coins0}）");
        }

        /// <summary>
        /// 灵宠：八只依次结契，在玩家前方生成几只敌人，各打 4 s、开打 0.6 s 时按 G；记录每只的伤害、击杀与灵技是否放出。
        /// 最后测灵契升级觉醒（经验加满 16 → 3 级）与换宠（旧灵宠变回封印），然后解除结契，后面的流程照旧。
        /// </summary>
        IEnumerator PetTest(PlayerMotor motor, Transform eye, PlayerVitals vitals)
        {
            var owner = PetOwner.Instance ? PetOwner.Instance : motor.GetComponent<PetOwner>();
            if (!owner)
            {
                Fail("[pets] 玩家身上没有 PetOwner（PetBootstrap 没有运行）");
                yield break;
            }
            if (!FindAnyObjectByType<PetAltar>()) Fail("[pets] 场景里没有灵兽台");
            if (!FindAnyObjectByType<PetHud>()) Fail("[pets] HUD 上没有灵宠面板");
            vitals.stats.Add("playtest_pets", Stat.MaxHp, 5000);
            var home = motor.transform.position;
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var side = Vector3.Cross(Vector3.up, fwd);
            var cam = eye.GetComponent<Camera>();
            // 灵兽台全景：站到半圆开口前方看过去
            var altar = FindAnyObjectByType<PetAltar>();
            if (altar && cam)
            {
                var at = altar.transform;
                var mid = at.position + at.right * altar.radius - at.forward * altar.radius * 0.45f;
                Teleport(motor, mid + at.forward * (altar.radius + 4.5f));
                yield return new WaitForSeconds(0.6f);
                Aim(motor, eye, mid + Vector3.up * 0.6f);
                yield return null;
                Shot(cam, "pet_altar");
            }
            var roster = new[] { ("jerboa_blade", -3f), ("jerboa_blade", 0f), ("scorpion_archer", 3f), ("mirage_toad", 5.5f) };
            foreach (var def in PetLibrary.All)
            {
                owner.Unbind();
                Teleport(motor, home);
                vitals.Heal(99999);
                var enemies = new List<EnemyAI>();
                foreach (var (id, off) in roster)
                {
                    var ai = EnemyRoster.Spawn(id, home + fwd * 11f + side * off, Quaternion.LookRotation(-fwd), 1, false);
                    if (ai) enemies.Add(ai);
                }
                var pet = owner.Bind(def);
                yield return new WaitForSeconds(0.9f); // 敌人出生无敌 + 灵宠出场
                float dealt0 = pet ? pet.DamageDealt : 0, t0 = Time.time;
                bool pressed = false, cast = false, shot = false;
                while (Time.time - t0 < 4f)
                {
                    var target = NearestEnemy(eye.position);
                    if (target) Aim(motor, eye, BodyCenter(target));
                    // 实战截图：灵技放出后约 1 秒，把镜头临时挪到灵宠侧后方拍特写（第一人称离得太远看不清）
                    if (!shot && cast && Time.time - t0 > 1.8f && cam && pet)
                    {
                        shot = true;
                        PetCloseUp(cam, pet, target ? BodyCenter(target) : pet.Center + pet.transform.forward * 4f, $"pet_{def.id}");
                    }
                    if (!pressed && Time.time - t0 > 0.6f)
                    {
                        pressed = true;
                        owner.testSkill = true;
                    }
                    else if (pressed && !cast && pet && pet.SkillLeft > 0) cast = true;
                    yield return null;
                }
                float dealt = pet ? pet.DamageDealt - dealt0 : 0;
                int killed = enemies.Count(e => !e || e.Dead);
                var msg = $"[pets] {def.Label}（{def.title}）：4 s 伤害 {dealt:F0}，击杀 {killed}/{enemies.Count}，灵技「{def.skillName}」{(cast ? "已放出" : "没放出")}，Lv.{(pet ? pet.Level : 0)}";
                Line(msg);
                Debug.Log(msg);
                if (!pet) Fail($"[pets] {def.name} 结契后没有生成灵宠");
                else if (dealt <= 0) Fail($"[pets] {def.name} 4 秒内没有造成伤害");
                if (!cast) Fail($"[pets] {def.name} 的灵技没有放出来");
                foreach (var e in enemies)
                    if (e) Destroy(e.gameObject);
                yield return new WaitForSeconds(0.3f);
            }
            // 灵契：经验加满 16 → 3 级觉醒
            var p = owner.Current;
            if (p)
            {
                int lv0 = p.Level;
                for (int i = 0; i < 16 && !p.Awakened; i++) p.AddXp(1);
                Line($"[pets] 灵契：Lv.{lv0} → Lv.{p.Level}，觉醒 {(p.Awakened ? "是" : "否")}");
                if (!p.Awakened) Fail("[pets] 灵契经验加满 16 没有觉醒");
            }
            // 换宠：旧灵宠变回封印
            int seals0 = PetSeal.Active.Count;
            owner.Bind(PetLibrary.Get("baize"));
            yield return null;
            Line($"[pets] 换宠：封印 {seals0} → {PetSeal.Active.Count}");
            if (PetSeal.Active.Count != seals0 + 1) Fail("[pets] 换宠后旧灵宠没有变回封印");
            yield return new WaitForSeconds(1f);
            if (cam) Shot(cam, "pets");
            owner.Unbind();
            foreach (var s in PetSeal.Active.ToArray())
                if (s && !s.fromAltar) Destroy(s.gameObject);
            Teleport(motor, home);
            vitals.stats.Remove("playtest_pets");
            vitals.Heal(99999);
            yield return new WaitForSeconds(0.3f);
        }

        IEnumerator AnimatorDiag(PlayerMotor motor)
        {
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var ai = EnemyRoster.Spawn("tomb_beast", motor.transform.position + fwd * 9f, Quaternion.LookRotation(-fwd), 1, false);
            if (!ai) yield break;
            var anim = ai.GetComponentInChildren<Animator>();
            var leg = anim ? anim.transform.GetComponentsInChildren<Transform>().FirstOrDefault(t => t.name.Contains("upperarm")) : null;
            var r = ai.GetComponentInChildren<SkinnedMeshRenderer>();
            Line($"动画诊断：Animator 在 {(anim ? anim.gameObject.name : "无")}（共 {ai.GetComponentsInChildren<Animator>(true).Length} 个），控制器 {anim?.runtimeAnimatorController?.name}，" +
                 $"Avatar {(anim && anim.avatar ? (anim.avatar.isValid ? "有效" : "无效") : "无")}，剔除 {anim?.cullingMode}，更新 {anim?.updateMode}，参与腿骨 {leg?.name ?? "无"}");
            var prev = leg ? leg.localRotation : Quaternion.identity;
            for (int i = 0; i < 6; i++)
            {
                yield return new WaitForSeconds(0.25f);
                var info = anim ? anim.GetCurrentAnimatorStateInfo(0) : default;
                float moved = leg ? Quaternion.Angle(prev, leg.localRotation) : 0;
                if (leg) prev = leg.localRotation;
                Line($"  t={0.25f * (i + 1):F2} 启用 {anim?.isActiveAndEnabled} 初始化 {anim?.isInitialized} 速度 {anim?.speed} 状态哈希 {info.shortNameHash}" +
                     $"（Locomotion = {Animator.StringToHash("Locomotion")}）进度 {info.normalizedTime:F2} 长度 {info.length:F2} " +
                     $"Speed 参数 {(anim ? anim.GetFloat("Speed") : 0):F2} 可见 {r?.isVisible} 腿骨 0.25 s 内转动 {moved:F1}° AI {ai.State}");
            }
            Destroy(ai.gameObject);
            yield return new WaitForSeconds(0.2f);
        }

        IEnumerator ColliderSyncTest(PlayerMotor motor, Transform eye)
        {
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var side = Vector3.Cross(Vector3.up, fwd);
            var ai = EnemyRoster.Spawn("tomb_beast", motor.transform.position + fwd * 10f, Quaternion.LookRotation(-fwd), 1, false);
            if (!ai) yield break;
            yield return new WaitForSeconds(0.8f);
            ai.enabled = false;
            var agent = ai.GetComponent<UnityEngine.AI.NavMeshAgent>();
            var to = ai.transform.position + side * 4f;
            if (agent && agent.isOnNavMesh) agent.Warp(to);
            else ai.transform.position = to;
            yield return new WaitForSeconds(0.3f);
            var col = ai.GetComponent<Collider>();
            var visual = ai.transform.position + Vector3.up * 1.1f;
            RaycastHit h = default;
            var hits = Physics.RaycastAll(eye.position, (visual - eye.position).normalized, 40f, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
            foreach (var x in hits)
                if (!x.collider.GetComponentInParent<PlayerVitals>()) { h = x; break; }
            bool hit = h.collider && (h.collider.GetComponent<Hitbox>()?.owner == ai.Health || h.collider.GetComponentInParent<Damageable>() == ai.Health);
            float drift = col ? Vector3.Distance(new Vector3(col.bounds.center.x, 0, col.bounds.center.z), new Vector3(ai.transform.position.x, 0, ai.transform.position.z)) : -1;
            string what = h.collider ? $"{h.collider.name}（layer {h.collider.gameObject.layer}，{h.distance:F1} m）" : "什么都没打到";
            Line($"碰撞体同步：射线打到 {what}；目标距离 {Vector3.Distance(eye.position, visual):F1} m");
            Line($"碰撞体同步：敌人移动 4 m 后朝它的模型开枪 {(hit ? "打中" : "打空")}，碰撞体中心离模型 {drift:F2} m（物理模拟 {Physics.simulationMode}，自动同步 {Physics.autoSyncTransforms}）");
            if (!hit) Fail("敌人移动后射线打不到它现在的位置：碰撞体没有跟着模型走（物理没有在模拟 / 同步）");
            Destroy(ai.gameObject);
            yield return new WaitForSeconds(0.2f);
        }

        IEnumerator TiltTest(PlayerMotor motor, Transform eye, WeaponController weapons)
        {
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var side = Vector3.Cross(Vector3.up, fwd);
            string[] ids = { "jerboa_blade", "scorpion_archer", "mirage_toad", "tomb_beast", "apsara", "fire_rat" };
            var list = new List<EnemyAI>();
            for (int i = 0; i < ids.Length; i++)
            {
                var at = motor.transform.position + fwd * 11f + side * (i - (ids.Length - 1) * 0.5f) * 3.2f;
                var ai = EnemyRoster.Spawn(ids[i], at, Quaternion.LookRotation(-fwd), 1, false);
                if (ai)
                {
                    // 测试时撑血：只看姿态，不让它们被打死
                    var hp = ai.Health;
                    hp.maxHealth *= 20;
                    hp.ResetVitals();
                    list.Add(ai);
                }
            }
            yield return new WaitForSeconds(0.8f);
            // 骨盆相对根节点的静止朝向（出生后正常播放待机 / 移动时），之后和它比：真正看得见的「身体歪了多少」
            var restUp = new Vector3[list.Count];
            for (int i = 0; i < list.Count; i++)
            {
                var rig = list[i] ? list[i].GetComponentInChildren<CreatureRig>() : null;
                if (rig && rig.pelvis) restUp[i] = Quaternion.Inverse(list[i].transform.rotation) * rig.pelvis.up;
            }
            var bodyMax = new float[list.Count];
            var idleMax = new float[list.Count];
            var spineMax = new float[list.Count];
            var spineRest = new Quaternion[list.Count][];
            for (int i = 0; i < list.Count; i++)
            {
                var rig = list[i] ? list[i].GetComponentInChildren<CreatureRig>() : null;
                spineRest[i] = rig ? Array.ConvertAll(rig.spineBones, b => b ? b.localRotation : Quaternion.identity) : new Quaternion[0];
            }
            float idleEnd = Time.time + 1f;
            while (Time.time < idleEnd)
            {
                for (int i = 0; i < list.Count; i++)
                {
                    var rig = list[i] ? list[i].GetComponentInChildren<CreatureRig>() : null;
                    if (rig && rig.pelvis && restUp[i] != Vector3.zero)
                        idleMax[i] = Mathf.Max(idleMax[i], Vector3.Angle(list[i].transform.rotation * restUp[i], rig.pelvis.up));
                }
                yield return null;
            }
            var rootMax = new float[list.Count];
            var hitMax = new float[list.Count];
            var hitSum = new float[list.Count];
            var hitN = new int[list.Count];
            Aim(motor, eye, motor.transform.position + fwd * 11f + Vector3.up * 1f);
            float t0 = Time.time, next = 0, minFps = 999;
            int tick = 0, frames = 0;
            bool shot = false;
            while (Time.time - t0 < 3f)
            {
                if (Time.time >= next)
                {
                    next = Time.time + 0.1f; // 光束 10 跳 / 秒
                    tick++;
                    foreach (var ai in list)
                    {
                        if (!ai || ai.Dead) continue;
                        var d = ai.Health;
                        var c = PlayerProjectile.Center(d);
                        var dir = (c - eye.position).normalized;
                        var info = DamageInfo.Simple(3, DamageSource.Weapon, c, dir);
                        // 前几跳轮流挂三种元素（打出反应 + 持续伤害），之后是纯连击
                        if (tick <= 6)
                        {
                            info.element = (Element)(1 + tick % 3);
                            info.statusChance = 1;
                        }
                        Combat.DamageEnemy(d, info);
                        // 雷弧弹射式的侧向命中
                        if (tick % 3 == 0) Combat.DamageEnemy(d, DamageInfo.Simple(2, DamageSource.Weapon, c, side));
                    }
                }
                for (int i = 0; i < list.Count; i++)
                {
                    var ai = list[i];
                    if (!ai || ai.Dead) continue;
                    rootMax[i] = Mathf.Max(rootMax[i], Vector3.Angle(ai.transform.up, Vector3.up));
                    var rig = ai.GetComponentInChildren<CreatureRig>();
                    if (rig && rig.pelvis && restUp[i] != Vector3.zero)
                        bodyMax[i] = Mathf.Max(bodyMax[i], Vector3.Angle(ai.transform.rotation * restUp[i], rig.pelvis.up));
                    if (rig)
                        for (int k = 0; k < rig.spineBones.Length && k < spineRest[i].Length; k++)
                            if (rig.spineBones[k]) spineMax[i] = Mathf.Max(spineMax[i], Quaternion.Angle(spineRest[i][k], rig.spineBones[k].localRotation));
                    if (rig)
                    {
                        hitMax[i] = Mathf.Max(hitMax[i], rig.HitAngleDeg);
                        hitSum[i] += rig.HitAngleDeg;
                        hitN[i]++;
                    }
                }
                if (!shot && Time.time - t0 > 1.6f)
                {
                    shot = true;
                    Shot(weapons.eye, "tilt");

                    foreach (var ai in list)
                    {
                        if (!ai) continue;
                        var anim = ai.GetComponentInChildren<Animator>();
                        var clips = anim && anim.isActiveAndEnabled ? anim.GetCurrentAnimatorClipInfo(0) : null;
                        var ragdoll = ai.GetComponent<CreatureRagdoll>();
                        var st = ai.GetComponent<EnemyStatus>();
                        Line($"    {ai.Health.displayName}：AI {ai.State}，动画 {(anim ? (anim.enabled ? (clips != null && clips.Length > 0 ? clips[0].clip.name : "（无片段）") : "已停用") : "无")}，" +
                             $"布娃娃 {(ragdoll && ragdoll.Active ? "开" : "关")}，眩晕 {(st && st.Stunned ? "是" : "否")}，生命 {ai.Health.health:F0}/{ai.Health.maxHealth:F0}");
                    }
                }
                frames++;
                if (Time.deltaTime > 0) minFps = Mathf.Min(minFps, 1f / Time.deltaTime);
                yield return null;
            }
            Line($"  姿态测试帧率：平均 {frames / Mathf.Max(0.01f, Time.time - t0):F0} fps，最低 {minFps:F0} fps");
            for (int i = 0; i < list.Count; i++)
            {
                var name = list[i] ? list[i].Health.displayName : ids[i];
                float avg = hitN[i] > 0 ? hitSum[i] / hitN[i] : 0;
                var rigI = list[i] ? list[i].GetComponentInChildren<CreatureRig>() : null;
                Line($"  姿态 {name}：根节点 {rootMax[i]:F0}°，骨盆偏离 不挨打 {idleMax[i]:F0}° / 挨打 {bodyMax[i]:F0}°，" +
                     $"脊柱骨（{rigI?.spineBones.Length ?? 0} 节）单节最大偏离 {spineMax[i]:F0}°，受击晃动 平均 {avg:F0}° / 最大 {hitMax[i]:F0}°");
                if (bodyMax[i] > 35f) Fail($"{name} 身体（骨盆）偏离正常姿态 {bodyMax[i]:F0}°：看起来侧翻 / 倒地");
                if (rootMax[i] > 10f) Fail($"{name} 根节点倾斜 {rootMax[i]:F0}°（应该一直直立）");
                if (hitMax[i] > 30f) Fail($"{name} 受击时身体压歪 {hitMax[i]:F0}°（超过 30° 看起来像侧翻）");
                if (avg > 15f) Fail($"{name} 持续火力下身体平均歪 {avg:F0}°（看起来一直是斜的）");
            }
            // 打死后的倒地姿态：反应爆炸那种击退（7）
            foreach (var ai in list)
                if (ai && !ai.Dead)
                {
                    var d = ai.Health;
                    var info = DamageInfo.Simple(999999, DamageSource.Status, PlayerProjectile.Center(d), (PlayerProjectile.Center(d) - eye.position).normalized);
                    info.knockback = 7;
                    Combat.DamageEnemy(d, info);
                }
            yield return new WaitForSeconds(1.5f);
            Shot(weapons.eye, "tilt_dead");
            foreach (var ai in list)
                if (ai) Destroy(ai.gameObject);
            yield return new WaitForSeconds(0.3f);
        }

        IEnumerator ReactionTest(PlayerMotor motor, string enemy, Element[] elements, Reaction expect)
        {
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var side = Vector3.Cross(Vector3.up, fwd);
            var at = motor.transform.position + fwd * 15f;
            var main = EnemyRoster.Spawn(enemy, at, Quaternion.LookRotation(-fwd), 1, false);
            var buddy = EnemyRoster.Spawn("jerboa_blade", at + side * 2f, Quaternion.LookRotation(-fwd), 1, false);
            if (!main)
            {
                Fail($"反应测试：生成 {enemy} 失败");
                yield break;
            }
            var got = new List<string>();
            int hitsTotal = 0;
            var target = main.GetComponent<Damageable>();
            void OnReacted(Damageable d, Reaction id, Vector3 p, float b, int hits)
            {
                got.Add($"{ReactionSystem.Names[(int)id]}(B {b:F0}，命中 {hits})");
                if (d == target && id == expect) hitsTotal += hits;
            }
            ReactionSystem.Reacted += OnReacted;
            yield return new WaitForSeconds(0.8f); // 出生无敌
            float hp0 = target.health + target.armor + target.shield;
            foreach (var el in elements)
            {
                if (target.Dead) break;
                var info = DamageInfo.Simple(12, DamageSource.Skill, PlayerProjectile.Center(target), Vector3.zero);
                info.element = el;
                info.statusChance = 1;
                Combat.DamageEnemy(target, info);
                yield return new WaitForSeconds(0.3f);
            }
            yield return new WaitForSeconds(0.9f); // 归墟 0.35 s 收束 + 连锁 0.15 s
            ReactionSystem.Reacted -= OnReacted;
            float lost = hp0 - (target.health + target.armor + target.shield);
            string names = string.Join(" + ", Array.ConvertAll(elements, e => e.ToString()));
            Line($"反应测试 {names} → {(got.Count > 0 ? string.Join("、", got) : "没有反应")}；{target.displayName} 共掉 {lost:F0}");
            if (!got.Exists(g => g.StartsWith(ReactionSystem.Names[(int)expect]))) Fail($"{names} 没有打出「{ReactionSystem.Names[(int)expect]}」");
            if (main) Destroy(main.gameObject);
            if (buddy) Destroy(buddy.gameObject);
            yield return new WaitForSeconds(0.3f);
        }

        IEnumerator PointBlankTest(PlayerMotor motor, Transform eye, WeaponController weapons, float distance, string label)
        {
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var at = motor.transform.position + fwd * distance;
            var ai = EnemyRoster.Spawn("scorpion_archer", at, Quaternion.LookRotation(-fwd), 1, false);
            if (!ai)
            {
                Fail("贴脸测试：生成蝎尾弩卫失败");
                yield break;
            }
            var hp = ai.GetComponent<Damageable>();
            int immune = 0, landed = 0;
            float dealt = 0;
            void Count(Damageable d, DamageInfo info, DamageResult r)
            {
                if (d != hp) return;
                if (r.immune) immune++;
                else if (r.total > 0) { landed++; dealt += r.total; }
            }
            Combat.EnemyDamaged += Count;
            var reserve = weapons.Active.reserve;
            weapons.testFire = true;
            float t0 = Time.time;
            while (Time.time - t0 < 1.4f && !hp.Dead)
            {
                Aim(motor, eye, PlayerProjectile.Center(hp));
                weapons.Active.reserve = reserve;
                if (weapons.Active.mag <= 0) weapons.Active.mag = weapons.Active.def.mag;
                yield return null;
            }
            weapons.testFire = false;
            Combat.EnemyDamaged -= Count;
            Line($"贴脸打蝎尾弩卫（{label}）：免疫 {immune} 次，命中 {landed} 次，伤害 {dealt:F0}");
            if (landed == 0) Fail($"贴脸打蝎尾弩卫（{label}）一次伤害都没打进去");
            if (distance > 0 && immune == 0) Fail("出生无敌期间开枪没有显示「免疫」");
            if (ai) Destroy(ai.gameObject);
            yield return new WaitForSeconds(0.3f);
        }

        /// <summary>目标周围 8–12 m、NavMesh 上、眼高能直接看到瞄准点的位置</summary>
        static bool SightSpot(Damageable target, Vector3 aim, out Vector3 spot)
        {
            for (int i = 0; i < 16; i++)
            {
                float a = i * Mathf.PI * 2 / 16 + Random.value * 0.3f;
                var p = target.transform.position + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Random.Range(8f, 12f);
                if (!UnityEngine.AI.NavMesh.SamplePosition(p, out var hit, 3f, UnityEngine.AI.NavMesh.AllAreas)) continue;
                if (Combat.Blocked(hit.position + Vector3.up * 1.62f, aim, null)) continue;
                spot = hit.position;
                return true;
            }
            spot = default;
            return false;
        }

        static Damageable NearestEnemy(Vector3 from)
        {
            Damageable best = null;
            float bestD = float.MaxValue;
            foreach (var d in FindObjectsByType<Damageable>())
            {
                if (d.Dead || d.untargetable) continue;
                float dist = Vector3.Distance(from, d.transform.position);
                if (dist < bestD) { bestD = dist; best = d; }
            }
            return best;
        }

        static void Teleport(PlayerMotor motor, Vector3 p)
        {
            if (Physics.Raycast(p + Vector3.up * 20, Vector3.down, out var hit, 60, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y + 0.05f;
            var cc = motor.GetComponent<CharacterController>();
            cc.enabled = false;
            motor.transform.position = p;
            cc.enabled = true;
        }

        static Vector3 BodyCenter(Damageable d)
        {
            var col = d.GetComponent<Collider>();
            return col && col.enabled ? col.bounds.center : d.transform.position + Vector3.up;
        }

        static void Aim(PlayerMotor motor, Transform eye, Vector3 at)
        {
            var dir = at - eye.position;
            float yaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
            float pitch = -Mathf.Atan2(dir.y, new Vector2(dir.x, dir.z).magnitude) * Mathf.Rad2Deg;
            motor.SetLook(yaw, pitch);
        }

        /// <summary>
        /// 单只敌人定格拍照：出生 → 关掉 AI（原地站着，动画照放）→ 侧面近景拍「静止 / 挨打中 / 死后 1 秒」三张，
        /// 用来人工核对姿态（侧翻、倒地、飞天这类数值看不出来的问题）
        /// </summary>
        IEnumerator PoseTest(PlayerMotor motor, Transform eye, string id)
        {
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var side = Vector3.Cross(Vector3.up, fwd);
            var ai = EnemyRoster.Spawn(id, motor.transform.position + fwd * 8f, Quaternion.LookRotation(-fwd), 1, false);
            if (!ai) yield break;
            var hp = ai.Health;
            hp.maxHealth *= 20;
            hp.ResetVitals();
            yield return new WaitForSeconds(0.8f);
            var agent = ai.GetComponent<UnityEngine.AI.NavMeshAgent>();
            if (agent && agent.isOnNavMesh) agent.isStopped = true;
            ai.enabled = false;
            var poseAnim = ai.GetComponentInChildren<Animator>();
            if (poseAnim) poseAnim.CrossFadeInFixedTime("Locomotion", 0.1f);
            yield return new WaitForSeconds(0.3f);
            // 头（看向链最后一节）离根节点的高度：静止时的平均值 vs 挨打时的最低值，塌倒 / 侧翻时会掉一大截
            var rig = ai.GetComponentInChildren<CreatureRig>();
            var head = rig && rig.lookBones.Length > 0 ? rig.lookBones[^1] : rig ? rig.pelvis : null;
            float restSum = 0, restMin = 999;
            int restN = 0;
            float rt0 = Time.time;
            while (Time.time - rt0 < 0.4f)
            {
                if (head)
                {
                    float hh = head.position.y - ai.transform.position.y;
                    restSum += hh;
                    restMin = Mathf.Min(restMin, hh);
                    restN++;
                }
                yield return null;
            }
            float rest = restN > 0 ? restSum / restN : 0;
            PoseShot(ai, side, $"pose_{id}_1rest");
            float hitMin = 999;
            float t0 = Time.time, next = 0;
            int tick = 0;
            while (Time.time - t0 < 1.2f)
            {
                if (Time.time >= next)
                {
                    next = Time.time + 0.1f;
                    tick++;
                    var c = PlayerProjectile.Center(hp);
                    var info = DamageInfo.Simple(3, DamageSource.Weapon, c, (c - eye.position).normalized);
                    if (tick <= 3)
                    {
                        info.element = (Element)tick;
                        info.statusChance = 1;
                    }
                    Combat.DamageEnemy(hp, info);
                }
                if (head) hitMin = Mathf.Min(hitMin, head.position.y - ai.transform.position.y);
                yield return null;
            }
            PoseShot(ai, side, $"pose_{id}_2hit");
            Line($"  定格 {hp.displayName}：头高 静止 {rest:F2} m（最低 {restMin:F2}）/ 挨打中最低 {hitMin:F2} m");
            if (head && rest > 0.2f && hitMin < Mathf.Min(restMin, rest) * 0.55f)
                Fail($"{hp.displayName} 挨打时头高从 {rest:F2} m 掉到 {hitMin:F2} m：身体塌倒 / 侧翻");
            var k = DamageInfo.Simple(999999, DamageSource.Status, PlayerProjectile.Center(hp), (PlayerProjectile.Center(hp) - eye.position).normalized);
            k.knockback = 7;
            Combat.DamageEnemy(hp, k);
            var ragdoll = ai.GetComponent<CreatureRagdoll>();
            var before = ragdoll ? Array.ConvertAll(ragdoll.parts, q => q.body ? q.body.position : Vector3.zero) : new Vector3[0];
            yield return new WaitForSeconds(1.0f);
            PoseShot(ai, side, $"pose_{id}_3dead");
            Line($"  死后 {hp.displayName}：{RagdollReport(ragdoll, before)}");
            Destroy(ai.gameObject);
            yield return new WaitForSeconds(0.2f);
        }

        IEnumerator TailTest(PlayerMotor motor)
        {
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var e = EnemyRoster.Spawn("scorpion_archer", motor.transform.position + fwd * 10f, Quaternion.LookRotation(-fwd), 1, false);
            if (!e) yield break;
            yield return new WaitForSeconds(0.8f);
            var ag = e.GetComponent<UnityEngine.AI.NavMeshAgent>();
            if (ag && ag.isOnNavMesh) ag.isStopped = true;
            e.enabled = false;
            var anim = e.GetComponentInChildren<Animator>();
            anim.CrossFadeInFixedTime("Locomotion", 0.1f);
            var rig = e.GetComponentInChildren<CreatureRig>();
            var tail = new List<Transform>();
            foreach (var t in rig.GetComponentsInChildren<Transform>())
                if (t.name.StartsWith("tail_")) tail.Add(t);
            var springs = rig.springs;
            var tailFamilies = string.Join("、", Array.ConvertAll(Array.FindAll(springs, c => Array.Exists(c.bones, b => b && b.name.StartsWith("tail_"))), c => $"{c.family}（{c.bones.Length} 节，刚度 {c.stiffness}，阻尼 {c.damping}）"));
            yield return new WaitForSeconds(0.5f);
            float on = 0;
            yield return MeasureTail(e, tail, 1.5f, v => on = v);
            rig.springs = Array.FindAll(springs, c => !Array.Exists(c.bones, b => b && b.name.StartsWith("tail_")));
            yield return new WaitForSeconds(0.3f);
            float off = 0;
            yield return MeasureTail(e, tail, 1.5f, v => off = v);
            rig.springs = springs;
            Line($"蝎尾（待机动画）：尾骨 {tail.Count} 节，尾巴弹簧 {(tailFamilies.Length > 0 ? tailFamilies : "无")}；平均角速度 开弹簧 {on:F0}°/s / 关弹簧 {off:F0}°/s");
            Destroy(e.gameObject);
            yield return new WaitForSeconds(0.2f);
        }

        static IEnumerator MeasureTail(EnemyAI e, List<Transform> tail, float seconds, Action<float> result)
        {
            var prev = tail.ConvertAll(t => Quaternion.Inverse(e.transform.rotation) * t.rotation);
            float sum = 0;
            int n = 0;
            float t0 = Time.time;
            while (Time.time - t0 < seconds)
            {
                yield return null;
                for (int i = 0; i < tail.Count; i++)
                {
                    var q = Quaternion.Inverse(e.transform.rotation) * tail[i].rotation;
                    if (Time.deltaTime > 0) { sum += Quaternion.Angle(prev[i], q) / Time.deltaTime; n++; }
                    prev[i] = q;
                }
            }
            result(n > 0 ? sum / n : 0);
        }

        static readonly string[] AnimStates =
        {
            "Locomotion", "Hit", "crouch", "leap", "spin", "recover", "aim", "dive", "emerge", "fire", "snap", "snapWindup", "tunnel",
            "mirage", "puff", "brake", "charge", "chargeWindup", "stomp", "stompWindup", "curl", "dizzy", "roll",
            "blessWindup", "bloomWindup", "chordWindup",
        };

        static string AnimStateName(Animator a)
        {
            if (!a || !a.isActiveAndEnabled) return "停用";
            var info = a.GetCurrentAnimatorStateInfo(0);
            foreach (var n in AnimStates)
                if (info.IsName(n)) return $"{n}@{info.normalizedTime:F2}";
            return $"?@{info.normalizedTime:F2}";
        }

        /// <summary>
        /// 动作连拍：敌人出生在玩家前方 distance 米（0 = 玩家身边、关 AI 原地站），跟在它侧面 6 m 拍 8 帧拼成一条，
        /// 每帧记 AI 状态 / 动画状态 / 水平速度；蝎子另算尾巴的平均角速度（「乱甩」）
        /// </summary>
        IEnumerator MotionTest(PlayerMotor motor, string id, float distance, bool ai, float seconds, string name)
        {
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            var side = Vector3.Cross(Vector3.up, fwd);
            var e = EnemyRoster.Spawn(id, motor.transform.position + fwd * Mathf.Max(8f, distance), Quaternion.LookRotation(-fwd), 1, false);
            if (!e) yield break;
            e.Health.maxHealth *= 50;
            e.Health.ResetVitals();
            yield return new WaitForSeconds(0.8f);
            if (!ai)
            {
                var ag = e.GetComponent<UnityEngine.AI.NavMeshAgent>();
                if (ag && ag.isOnNavMesh) ag.isStopped = true;
                e.enabled = false;
            }
            var anim = e.GetComponentInChildren<Animator>();
            var rig = e.GetComponentInChildren<CreatureRig>();
            var tail = new List<Transform>();
            if (rig)
                foreach (var t in rig.GetComponentsInChildren<Transform>())
                    if (t.name.StartsWith("tail_")) tail.Add(t);
            var prevTail = tail.ConvertAll(t => Quaternion.Inverse(e.transform.rotation) * t.rotation);
            float tailSum = 0;
            int tailN = 0;
            const int frames = 8, w = 400, h = 225;
            var strip = new Texture2D(w * frames, h, TextureFormat.RGB24, false);
            var rt = new RenderTexture(w, h, 24);
            var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
            var camGo = new GameObject("Motion Camera");
            var cam = camGo.AddComponent<Camera>();
            cam.fieldOfView = 50;
            var states = new List<string>();
            float t0 = Time.time, next = 0;
            int shot = 0;
            var lastPos = e.transform.position;
            while (Time.time - t0 < seconds && e && !e.Dead)
            {
                var c = PlayerProjectile.Center(e.Health);
                camGo.transform.position = c + side * 6f + Vector3.up * 1.2f - fwd * 1f;
                camGo.transform.LookAt(c);
                for (int i = 0; i < tail.Count; i++)
                {
                    var q = Quaternion.Inverse(e.transform.rotation) * tail[i].rotation;
                    if (Time.deltaTime > 0) { tailSum += Quaternion.Angle(prevTail[i], q) / Time.deltaTime; tailN++; }
                    prevTail[i] = q;
                }
                if (Time.time - t0 >= next && shot < frames)
                {
                    next += seconds / frames;
                    var v = (e.transform.position - lastPos) / Mathf.Max(1e-3f, Time.deltaTime);
                    v.y = 0;
                    states.Add($"{e.State}/{AnimStateName(anim)}/{v.magnitude:F1}");
                    cam.targetTexture = rt;
                    cam.Render();
                    RenderTexture.active = rt;
                    tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
                    tex.Apply();
                    RenderTexture.active = null;
                    strip.SetPixels(shot * w, 0, w, h, tex.GetPixels());
                    shot++;
                }
                lastPos = e.transform.position;
                yield return null;
            }
            strip.Apply();
            if (!string.IsNullOrEmpty(shotDir)) File.WriteAllBytes(Path.Combine(shotDir, $"playtest_{name}.png"), strip.EncodeToPNG());
            Line($"  连拍 {name}：{string.Join("  ", states)}" + (tail.Count > 0 ? $"；尾骨平均角速度 {(tailN > 0 ? tailSum / tailN : 0):F0}°/s" : ""));
            cam.targetTexture = null;
            Destroy(camGo);
            Destroy(rt);
            Destroy(tex);
            Destroy(strip);
            if (e) Destroy(e.gameObject);
            yield return new WaitForSeconds(0.2f);
        }

        static string RagdollReport(CreatureRagdoll r, Vector3[] before)
        {
            if (!r) return "没有布娃娃组件";
            int dyn = 0, n = 0;
            float moved = 0, speed = 0;
            for (int i = 0; i < r.parts.Length; i++)
            {
                var b = r.parts[i].body;
                if (!b) continue;
                n++;
                if (!b.isKinematic) dyn++;
                if (i < before.Length) moved = Mathf.Max(moved, Vector3.Distance(before[i], b.position));
                speed = Mathf.Max(speed, b.linearVelocity.magnitude);
            }
            return $"布娃娃 {(r.Active ? "已激活" : "未激活")}，部件 {n} 个（物理驱动 {dyn}），1 秒内部件最远移动 {moved:F2} m，当前最大速度 {speed:F2} m/s";
        }

        /// <summary>敌人侧面 3.5 m 的近景（临时相机，不带 HUD），看身体姿态</summary>
        void PoseShot(EnemyAI ai, Vector3 side, string name)
        {
            var col = ai.GetComponent<Collider>();
            var c = col ? col.bounds.center : ai.transform.position + Vector3.up;
            float size = col ? Mathf.Max(1.2f, col.bounds.size.y) : 1.8f;
            var go = new GameObject("Pose Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 50;
            cam.nearClipPlane = 0.05f;
            go.transform.position = c + side * (2f + size) + Vector3.up * 0.3f;
            go.transform.LookAt(c);
            Shot(cam, name);
            Destroy(go);
        }

        /// <summary>灵宠特写：相机临时放到灵宠侧后上方、朝灵宠与目标之间看，关掉第一人称层（手和枪），拍完复原</summary>
        void PetCloseUp(Camera cam, Pet pet, Vector3 focus, string name)
        {
            var t = cam.transform;
            var p0 = t.position;
            var r0 = t.rotation;
            int mask = cam.cullingMask;
            var center = pet.Center;
            var dir = focus - center;
            dir.y = 0;
            dir = dir.sqrMagnitude > 0.01f ? dir.normalized : pet.transform.forward;
            float size = Mathf.Max(1.3f, pet.Height * 1.9f);
            var pos = center - dir * size * 1.5f + Vector3.Cross(Vector3.up, dir) * size * 1.1f + Vector3.up * size * 0.45f;
            t.position = pos;
            t.rotation = Quaternion.LookRotation(Vector3.Lerp(center, focus, 0.3f) - pos);
            cam.cullingMask = mask & ~(1 << Layers.FirstPerson);
            Shot(cam, name);
            t.SetPositionAndRotation(p0, r0);
            cam.cullingMask = mask;
        }

        void Shot(Camera cam, string name)
        {
            if (string.IsNullOrEmpty(shotDir) || !cam) return;
            var rt = new RenderTexture(1600, 900, 24);
            var tex = new Texture2D(1600, 900, TextureFormat.RGB24, false);
            var prev = cam.targetTexture;
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, 1600, 900), 0, 0);
            tex.Apply();
            RenderTexture.active = null;
            cam.targetTexture = prev;
            Directory.CreateDirectory(shotDir);
            File.WriteAllBytes(Path.Combine(shotDir, $"playtest_{name}.png"), tex.EncodeToPNG());
            Destroy(rt);
            Destroy(tex);
            Line($"截图 playtest_{name}.png");
        }

        void Finish()
        {
            WeaponController.TestMode = false;
            Interactor.TestMode = false;
            HeroSkills.TestMode = false;
            PetOwner.TestMode = false;
            Flush(errors == 0 ? "全部通过" : $"不合格 {errors} 项");
            Done = true;
        }
    }
}
