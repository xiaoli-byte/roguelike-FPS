using System.Collections;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 第四章地基的改前 / 改后对比图（bridge.sh playtest gallery-ch4-f；场景 4-1 折多垭口，第一人称、正式关卡光照；F 路）：
    ///   · 出生法阵：通用符文（SpawnThemes.Off）→ 第四章「雷纹」；
    ///   · 带电：不带电 → 带电（紫红轮廓光的噼啪 + 贴骨短电弧，不染整只）；
    ///   · 落雷预警：一般危险圆（只有正红填充）→ 落雷的两层（正红填充 + 外沿紫红雷标）→ 劈下那一帧；
    ///   · 高原雷暴：晴天 → 雷暴满强度（压暗、雨、偏冷）。
    /// 截图 playtest_ch4f_*.png 在 _Review 里，scripts/unity/ch4f_compare.py 拼成 docs/art/review/ch4-port/F/ 的对比图。
    /// 场地、首领遭遇停掉、场上的怪清掉；玩家无敌。
    /// </summary>
    public sealed class Ch4FoundationGallerySuite : PlaytestSuite
    {
        public override string Id => "gallery-ch4-f";
        public override string Scene => "Assets/Scenes/L4_1_Zheduo.unity";

        PlayerMotor motor;
        Camera cam;
        Vector3 target, fwd;

        protected override IEnumerator Steps()
        {
            float t0 = Time.realtimeSinceStartup;
            while (Time.realtimeSinceStartup - t0 < 90f)
            {
                var f = SceneFlow.Instance;
                if (f && !f.Busy && f.Player != null && f.Player.root) break;
                yield return null;
            }
            yield return new WaitForSecondsRealtime(1.5f);
            var flow = SceneFlow.Instance;
            var rig = flow ? flow.Player : null;
            if (rig == null || !rig.root)
            {
                Fail("没有玩家（场景不是 4-1？）");
                yield break;
            }
            motor = rig.root.GetComponentInChildren<PlayerMotor>();
            cam = rig.cam;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            rig.vitals.invulnerableUntil = Time.time + 99999;
            var scene = flow.CurrentScene;
            foreach (var s in FindObjectsByType<EncounterSite>())
                if (s.gameObject.scene == scene) s.enabled = false;
            foreach (var b in FindObjectsByType<BossEncounter>())
                if (b.gameObject.scene == scene) b.enabled = false;
            EnemyRegistry.PurgeAll();
            PlateauStorm.StopAll();
            yield return new WaitForSeconds(0.5f);

            fwd = motor.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            target = Ground(motor.transform.position + fwd * 7f);
            Line($"机位：出生 {motor.transform.position}，目标点 {target}（前方 7 m）；附近导体 {(LightningStrike.Redirect(target) ? "有（落雷会被引走）" : "无")}");

            yield return Sigil();
            yield return Charged();
            yield return Strike();
            yield return Storm();
            EnemyRegistry.PurgeAll();
            SpawnThemes.Off = false;
        }

        static Vector3 Ground(Vector3 p) =>
            Physics.Raycast(p + Vector3.up * 30f, Vector3.down, out var hit, 80f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.point : p;

        void Look(Vector3 at) => Aim(motor, motor.eye, at);

        IEnumerator Sigil()
        {
            Look(target);
            foreach (bool themed in new[] { false, true })
            {
                SpawnThemes.Off = !themed;
                var e = EnemyRoster.Spawn("marmot", target, Quaternion.LookRotation(-fwd), 1, false);
                if (!e)
                {
                    Fail("生成啸獭失败");
                    yield break;
                }
                yield return new WaitForSeconds(0.4f);
                Shot(cam, themed ? "ch4f_sigil_after" : "ch4f_sigil_before");
                yield return new WaitForSeconds(1.2f);
                EnemyRegistry.PurgeAll();
                yield return new WaitForSeconds(0.6f);
            }
            SpawnThemes.Off = false;
            Line("✓ 出生法阵：通用符文 / 第四章雷纹");
        }

        IEnumerator Charged()
        {
            var e = EnemyRoster.Spawn("tiangou", target + fwd * -2f, Quaternion.LookRotation(-fwd), 1, false);
            if (!e)
            {
                Fail("生成天狗失败");
                yield break;
            }
            yield return new WaitForSeconds(1.4f);
            e.enabled = false;
            var c = BodyCenter(e.Health);
            Look(c);
            yield return new WaitForSeconds(0.3f);
            Shot(cam, "ch4f_charge_before");
            Charge.Apply(e.Health, 30f);
            yield return new WaitForSeconds(0.35f);
            Shot(cam, "ch4f_charge_after");
            yield return new WaitForSeconds(0.13f);
            Shot(cam, "ch4f_charge_after2");
            Line($"✓ 带电：轮廓光 {(e.GetComponent<ChargeState>()?.RimShowing == true ? "亮着" : "没亮")}");
            EnemyRegistry.PurgeAll();
            yield return new WaitForSeconds(0.6f);
        }

        IEnumerator Strike()
        {
            Look(target);
            yield return new WaitForSeconds(0.2f);
            var plain = Telegraph.Circle(target, LightningStrike.DefaultRadius, 1.2f, Color.white, TelegraphTone.Danger);
            yield return new WaitForSeconds(0.7f);
            Shot(cam, "ch4f_strike_before");
            yield return new WaitForSeconds(0.8f);
            plain.End();
            var h = LightningStrike.Strike(target, 1.2f, LightningStrike.DefaultRadius, 0f, null);
            yield return new WaitForSeconds(0.7f);
            Shot(cam, "ch4f_strike_after");
            float left = h.TimeLeft;
            yield return new WaitForSeconds(left + 0.02f);
            Shot(cam, "ch4f_strike_land");
            Line("✓ 落雷预警：一般危险圆 / 两层（正红填充 + 紫红雷标）/ 劈下");
            yield return new WaitForSeconds(0.8f);
        }

        IEnumerator Storm()
        {
            var far = Ground(motor.transform.position + fwd * 60f) + Vector3.up * 12f;
            Look(far);
            yield return new WaitForSeconds(0.4f);
            Shot(cam, "ch4f_storm_before");
            var t = WeatherDirector.BeginPlateauStorm(new PlateauStormSpec
            {
                fadeIn = 0.5f, fadeOut = 0.5f, intervalMin = 0.5f, intervalMax = 0.9f, strikeMin = 18f, strikeMax = 45f, damage = 0,
            });
            yield return new WaitForSeconds(2.5f);
            Shot(cam, "ch4f_storm_after");
            Line($"✓ 高原雷暴：强度 {PlateauStorm.Level:F2}");
            t.End();
            yield return new WaitForSeconds(1f);
            LightningStrike.ClearAll();
        }
    }
}
