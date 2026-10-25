using System.Collections;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.UIElements;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// UI Toolkit 战斗 HUD 冒烟（bridge.sh playtest hud；场景 TestArena）——docs/unity-parity.md U2 / U3、7.3「UI U」：
    ///   · [HudWidget] 登记的部件都建起来、挂进了面板；HUD 层在截图里看得见（走屏幕抓取，含 UI Toolkit）；
    ///   · 信息角（关卡名 / 目标）、交互提示卡（标题、副标题、对比行、价格不足标红）、Q 技能放出、受击（方向弧 + 闪屏 + 护盾碎裂）、
    ///     准星压到敌人变红、开火命中标记、低血量暗角、中央大字，各拍一张；
    ///   · 暂停（模态栈非空）时 HUD 层淡出，恢复后淡回；
    ///   · U3：连射同一个敌人的伤害数字合并、关掉「伤害数字」设置后不再出、反应名浮字；受伤敌人有头顶血条、首领没有；
    ///     反应首遇教学每局每种只排一次；首领血条按数据源（<see cref="IBossBarSource"/>）画刻度、无敌蒙灰、死后「已击破」再收起。
    /// </summary>
    public sealed class HudSuite : PlaytestSuite
    {
        public override string Id => "hud";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        static readonly string[] U2Widgets =
        {
            "vitals", "weapon", "skills", "info", "crosshair", "hurt", "prompt", "pet", "center-text",
            "damage-numbers", "enemy-bars", "boss-bar", "reaction-tips",
        };

        /// <summary>测试用首领数据源：固定刻度、可切无敌</summary>
        sealed class ProbeBoss : IBossBarSource
        {
            readonly Damageable health;
            readonly string title, sub;
            readonly float[] thresholds;
            public bool invulnerable;

            public ProbeBoss(Damageable health, string title, string sub, float[] thresholds)
            {
                this.health = health;
                this.title = title;
                this.sub = sub;
                this.thresholds = thresholds;
            }

            public Damageable BarHealth => health;
            public string BarTitle => title;
            public string BarSubtitle => sub;
            public System.Collections.Generic.IReadOnlyList<float> BarThresholds => thresholds;
            public bool BarInvulnerable => invulnerable;
        }

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            var motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            var hud = Hud.Instance;
            if (!weapons || !motor || !vitals || !hud)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} hud={hud}");
                yield break;
            }
            WeaponController.TestMode = true;
            HeroSkills.TestMode = true;
            Interactor.TestMode = true;
            var eye = weapons.eye.transform;

            // ── 部件登记 ──
            var ids = hud.Widgets.Select(w => w.Id).ToList();
            Line($"HUD 部件 {ids.Count} 个：{string.Join(" ", hud.Widgets.Select(w => $"{w.Id}({UILayers.Name(w.Layer)}/{w.Order})"))}");
            foreach (var id in U2Widgets)
                if (!ids.Contains(id)) Fail($"没有 HUD 部件「{id}」");
            foreach (var w in hud.Widgets)
                if (w.Root?.panel == null) Fail($"HUD 部件 {w.Id} 没挂进面板");
            yield return new WaitForSecondsRealtime(0.8f);
            var container = hud.Context?.Container(UILayer.Hud);
            Line($"HUD 层：不透明度 {container?.resolvedStyle.opacity:0.00}，面板 {hud.Context?.PanelSize}，截图走屏幕抓取：{UICapture.WantsScreen(weapons.eye)}");
            if (container == null || container.resolvedStyle.opacity < 0.9f) Fail("HUD 层没有淡入");
            if (!UIRoot.Instance || !UIRoot.Instance.HasVisibleContent) Fail("UIRoot 认为没有看得见的 UI Toolkit 内容（截图拍不到 HUD）");

            // ── 信息角 + 提示卡 ──
            GameUI.SetStage("测试场 · HUD 自检");
            GameUI.SetObjective("剩余敌人 3");
            GameUI.SetPrompt(new InteractPrompt
            {
                title = "碎岩霰弹", subtitle = "稀有 · 霰弹枪", color = Rarity.Color(Rarity.Rare), cost = 120, canAfford = false,
                lines = new[] { "伤害 ▲ 12%", "射速 ▼ 5%" },
            });
            yield return new WaitForSecondsRealtime(0.4f);
            var info = hud.Widget<InfoWidget>();
            var prompt = hud.Widget<PromptWidget>();
            Line($"信息角：「{info?.Stage}」/「{info?.Objective}」；提示卡：{(prompt?.Current is InteractPrompt p ? p.title : "无")}");
            if (info == null || info.Stage != "测试场 · HUD 自检") Fail("信息角没有显示关卡名");
            if (prompt?.Current == null) Fail("交互提示卡没有出现");
            Shot(weapons.eye, "hud_overview");
            GameUI.SetPrompt(null);

            // ── 技能 ──
            var skills = vitals.GetComponent<HeroSkills>();
            if (skills && skills.primary != null)
            {
                int before = skills.primary.charges;
                skills.testQ = true;
                yield return new WaitForSeconds(0.35f);
                Line($"Q 技能「{skills.primary.name}」：充能 {before} → {skills.primary.charges}，冷却 {skills.primary.CooldownLeft:0.0} s");
                Shot(weapons.eye, "hud_skill");
            }

            // ── 受击：护盾碎裂 + 方向弧 + 闪屏 ──
            vitals.invulnerableUntil = -1;
            var side = motor.transform.right;
            vitals.TakeDamage(vitals.shield + 8, motor.transform.position + side * 6 + motor.transform.forward * 2);
            yield return new WaitForSeconds(0.12f);
            vitals.TakeDamage(6, motor.transform.position - motor.transform.forward * 5);
            yield return new WaitForSecondsRealtime(0.1f);
            Line($"受击后：生命 {vitals.health:0}/{vitals.MaxHealth:0}，护盾 {vitals.shield:0}/{vitals.MaxShield:0}");
            Shot(weapons.eye, "hud_hurt");

            // ── 准星：压到敌人变红、开火命中 ──
            var numbers = hud.Widget<DamageNumbers>();
            var bars = hud.Widget<EnemyBars>();
            var enemy = SpawnAhead(motor, "jerboa_blade", 9f, 30f);
            if (enemy)
            {
                yield return new WaitForSeconds(1.2f); // 出生显形（期间不可选中）走完
                // 定住当靶子：EN1 按 Three.js 对齐后跳鼠刀兵 2 s 内就扑到脸上（1 m 内，头顶在屏幕上沿外，血条按设计不画），
                // 这一段测的是 HUD（准星变红、伤害数字合并、头顶血条），不是 AI，所以停导航、停 AI
                var agent = enemy.GetComponent<UnityEngine.AI.NavMeshAgent>();
                if (agent && agent.isOnNavMesh) agent.isStopped = true;
                enemy.enabled = false;
                Line($"靶子 {enemy.Health.displayName} 定在 {Vector3.Distance(motor.transform.position, enemy.transform.position):F1} m 处");
                Aim(motor, eye, BodyCenter(enemy.Health));
                yield return null;
                yield return null;
                yield return null;
                yield return null;
                var xhair = hud.Widget<CrosshairWidget>();
                Line($"准星对着 {enemy.Health.displayName}：{(xhair != null && xhair.OnTarget ? "变红" : "没变红")}");
                if (xhair == null || !xhair.OnTarget) Fail("准星压到敌人身上没有变红");
                weapons.testFire = true;
                for (int i = 0; i < 20; i++)
                {
                    if (enemy.Health) Aim(motor, eye, BodyCenter(enemy.Health));
                    yield return new WaitForSeconds(0.05f);
                }
                weapons.testFire = false;
                Line($"伤害数字：出 {numbers?.Spawned} 个、并入 {numbers?.Merged} 次、每帧上限丢 {numbers?.Dropped}，显示中 {numbers?.ActiveCount}；" +
                     $"头顶血条 {bars?.Count} 条（这只{(bars != null && bars.Has(enemy) ? "有" : "没有")}）");
                if (numbers == null || numbers.Spawned == 0) Fail("开火命中后没有出伤害数字");
                else if (numbers.Merged == 0) Fail("连射同一个敌人没有合并伤害数字");
                if (enemy.Health && !enemy.Health.Dead && (bars == null || !bars.Has(enemy)))
                {
                    var h = enemy.Health;
                    var col = enemy.GetComponent<Collider>();
                    var head = col && col.enabled ? new Vector3(col.bounds.center.x, col.bounds.max.y + 0.35f, col.bounds.center.z) : enemy.transform.position + Vector3.up * 2.1f;
                    var camT = hud.cam ? hud.cam.transform : eye;
                    var rel = head - camT.position;
                    bool proj = hud.Context.Project(head, out var pp, out var depth);
                    Line($"  诊断：登记 {EnemyRegistry.Live.Contains(enemy)}，生命 {h.health:0}/{h.maxHealth:0} 护盾 {h.shield:0}/{h.maxShield:0} 护甲 {h.armor:0}/{h.maxArmor:0}，" +
                         $"不可选 {h.untargetable}，首领 {h.IsBoss}，距离 {rel.magnitude:F1} m，正前 {Vector3.Dot(rel, camT.forward) / Mathf.Max(0.01f, rel.magnitude):F2}，" +
                         $"投影 {proj} {pp} 深度 {depth:F1}，面板 {hud.Context.PanelSize}，碰撞体 {(col ? $"{col.GetType().Name} {(col.enabled ? "开" : "关")} {col.bounds.size}" : "无")}");
                    Fail("受伤的敌人没有头顶血条");
                }
                Shot(weapons.eye, "hud_combat");

                // 设置关掉伤害数字：清掉、不再出
                GameSettings.DamageNumbers.Set(false);
                yield return null;
                int before = numbers?.Spawned ?? 0;
                weapons.testFire = true;
                for (int i = 0; i < 6; i++)
                {
                    if (enemy.Health) Aim(motor, eye, BodyCenter(enemy.Health));
                    yield return new WaitForSeconds(0.05f);
                }
                weapons.testFire = false;
                GameSettings.DamageNumbers.Set(true);
                Line($"关掉「伤害数字」后开火：新出 {(numbers?.Spawned ?? 0) - before} 个（应为 0）");
                if (numbers != null && numbers.Spawned != before) Fail("关掉「伤害数字」后仍在出数字");

                // 反应名浮字（世界浮字，不受开关影响）
                GameUI.FloatText(BodyCenter(enemy.Health) + Vector3.up, CombatTuning.ReactionNames[0], CombatTuning.ReactionColors[0], 1.35f);
                GameUI.FloatText(BodyCenter(enemy.Health) + Vector3.up * 1.4f, CombatTuning.ReactionNames[3], CombatTuning.ReactionColors[3], 1.9f);
                yield return new WaitForSeconds(0.25f);
                Shot(weapons.eye, "hud_float_text");
                yield return new WaitForSeconds(0.3f);
                if (enemy && enemy.Health && !enemy.Health.Dead) enemy.Health.Kill(DamageInfo.Simple(1, DamageSource.Environment, enemy.transform.position, Vector3.down));
            }

            // ── 反应首遇教学 ──
            var tips = hud.Widget<ReactionTips>();
            if (tips != null)
            {
                bool first = tips.Teach(Reaction.Thunderfire);
                bool again = tips.Teach(Reaction.Thunderfire);
                yield return new WaitForSecondsRealtime(0.6f);
                Line($"反应教学：第一次 {(first ? "排队" : "没排队")}、第二次 {(again ? "又排队了" : "跳过")}，显示 {tips.Showing}");
                if (!first || again) Fail("反应教学没有按「每局每种一次」去重");
                if (tips.Showing != Reaction.Thunderfire) Fail("反应教学卡没有出现");
                Shot(weapons.eye, "hud_reaction_tip");
            }

            // ── 首领血条：刻度来自数据源，越过刻度熄灭，死后「已击破」 ──
            var bossAi = SpawnAhead(motor, "tomb_beast", 14f, 6f);
            var bar = hud.Widget<BossBar>();
            if (bossAi && bar != null)
            {
                bossAi.Health.rank = Rank.Boss;
                var src = new ProbeBoss(bossAi.Health, "测试首领", "第一阶段", new[] { 0.66f, 0.33f });
                GameUI.SetBoss(src);
                yield return new WaitForSecondsRealtime(0.7f);
                Line($"首领血条：{(bar.Shown ? "显示" : "没显示")}「{bar.Title}」，刻度 {string.Join(" / ", bar.Ticks.Select(t => t.ToString("0.00")))}");
                if (!bar.Shown || bar.Ticks.Count != 2) Fail("首领血条没按数据源画出 2 道刻度");
                if (bars != null && bars.Has(bossAi)) Fail("首领不该有头顶血条");
                var hb = bossAi.Health;
                hb.health = hb.maxHealth * 0.5f;
                src.invulnerable = true;
                yield return new WaitForSecondsRealtime(0.4f);
                Shot(weapons.eye, "hud_boss");
                src.invulnerable = false;
                hb.Kill(DamageInfo.Simple(1, DamageSource.Environment, bossAi.transform.position, Vector3.down));
                GameUI.SetBoss(null);
                yield return new WaitForSecondsRealtime(0.3f);
                Line($"首领死后：血条{(bar.Shown ? "还在（已击破）" : "已收起")}");
                if (!bar.Shown) Fail("首领死后没有先显示「已击破」");
                yield return new WaitForSecondsRealtime(2.4f);
                if (bar.Shown) Fail("「已击破」之后血条没有收起");
            }

            // ── 低血量 ──
            float hp0 = vitals.health;
            vitals.health = vitals.MaxHealth * 0.12f;
            yield return new WaitForSecondsRealtime(0.9f);
            Shot(weapons.eye, "hud_lowhp");
            vitals.health = Mathf.Max(hp0, vitals.MaxHealth * 0.5f);

            // ── 中央大字 ──
            GameUI.SetCenterText("阵 亡\n<size=34>HUD 自检 · 中央大字</size>");
            yield return new WaitForSecondsRealtime(0.5f);
            var center = hud.Widget<CenterTextWidget>();
            if (center == null || string.IsNullOrEmpty(center.Text)) Fail("中央大字没有显示");
            Shot(weapons.eye, "hud_center");
            GameUI.SetCenterText(null);

            // ── 暂停时 HUD 淡出 ──
            GameStateMachine.Push(this, GameState.Paused, false);
            yield return new WaitForSecondsRealtime(0.4f);
            float paused = container?.resolvedStyle.opacity ?? 1;
            GameStateMachine.Pop(this);
            yield return new WaitForSecondsRealtime(0.7f);
            float back = container?.resolvedStyle.opacity ?? 0;
            Line($"暂停：HUD 层不透明度 {paused:0.00}，恢复后 {back:0.00}");
            if (paused > 0.05f) Fail("暂停时 HUD 层没有淡出");
            if (back < 0.9f) Fail("恢复后 HUD 层没有淡回");

            GameUI.SetStage("");
            GameUI.SetObjective(null);
        }
    }
}
