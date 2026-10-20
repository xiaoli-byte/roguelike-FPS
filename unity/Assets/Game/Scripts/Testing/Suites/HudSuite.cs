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
    ///   · 暂停（模态栈非空）时 HUD 层淡出，恢复后淡回。
    /// </summary>
    public sealed class HudSuite : PlaytestSuite
    {
        public override string Id => "hud";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        static readonly string[] U2Widgets = { "vitals", "weapon", "skills", "info", "crosshair", "hurt", "prompt", "pet", "center-text" };

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
            var enemy = SpawnAhead(motor, "jerboa_blade", 9f, 30f);
            if (enemy)
            {
                yield return new WaitForSeconds(1.2f);
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
                Shot(weapons.eye, "hud_combat");
                yield return new WaitForSeconds(0.3f);
                if (enemy && enemy.Health && !enemy.Health.Dead) enemy.Health.Kill(DamageInfo.Simple(1, DamageSource.Environment, enemy.transform.position, Vector3.down));
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
