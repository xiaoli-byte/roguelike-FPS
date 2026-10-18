using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Spiritfire.Art;
using UnityEngine;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 自动冒烟测试（bridge.sh playtest）：Play 模式里由脚本操控玩家，逐项检查切片的玩法回路，结果写成文本，
    /// 截图存 Assets/Art/_Review/playtest_*.png。不替代手玩，只保证「能跑、数值对、没有运行时报错」。
    /// 步骤：换弹 / 拾枪切枪 → 依次进入 ①–④ 触发遭遇战，自动瞄最近的敌人射击直到肃清（玩家临时 5000 血，记录敌人打出的伤害）
    ///       → 玩家受伤（护盾 / 生命）→ 阵亡。
    /// </summary>
    public sealed class PlaytestRunner : MonoBehaviour
    {
        public static bool Done;
        public string resultPath, shotDir;

        readonly List<string> lines = new();
        int errors, hits, crits, kills, skillHits, burnTicks, skillCasts;
        float damage, playerDamage, totalPlayerDamage;
        readonly Dictionary<string, int> killsById = new();

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
        }

        void OnDisable()
        {
            Application.logMessageReceived -= OnLog;
            Combat.EnemyDamaged -= OnDamaged;
            Combat.EnemyKilled -= OnKilled;
            Combat.PlayerDamaged -= OnPlayerDamaged;
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is LogType.Exception or LogType.Error) Fail($"运行时{type}：{msg}\n{stack}");
        }

        void OnDamaged(Damageable d, DamageInfo info, DamageResult r)
        {
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

            // ── 贴脸打蝎尾弩卫：出生无敌期显示「免疫」，之后（包括它开始钻沙、还露在外面时）要掉血；顶在它身上开枪也要掉血 ──
            yield return PointBlankTest(motor, eye, weapons, 1.5f, "1.5 m");
            yield return PointBlankTest(motor, eye, weapons, 1.0f, "顶在它身上");

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
                        weapons.testFire = weapons.Active.def.mode == FireMode.Auto || !weapons.testFire;
                        // 技能：E 有充能就扔（间隔 4 s），Q 好了就放
                        if (skills && Time.time >= skillAt)
                        {
                            skillAt = Time.time + 4f;
                            if (skills.secondary.charges > 0) skills.testE = true;
                            else if (skills.primary.charges > 0) skills.testQ = true;
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
            yield return new WaitForSeconds(0.8f);
            if (Hud.Instance) Line($"  灵石 {Hud.Instance.coins}（本段拾取 {Hud.Instance.coins - coins0}）");
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
            Flush(errors == 0 ? "全部通过" : $"不合格 {errors} 项");
            Done = true;
        }
    }
}
