using System.Collections;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 首领与怪物专属特效的件（特效打磨 C 路，bridge.sh playtest fx-boss；默认测试场）：逐项摆出来、斜上方旁观机位拍照（playtest_fxboss_&lt;件&gt;_&lt;时刻&gt;.png）。
    ///   sigils：三章主题出生法阵（沙印 / 冰晶 / 火卦，含开场粒子和每帧的卷尘），对照组是通用法阵；
    ///   water：水柱、破水水冠、水墙弧幕、水面漩涡；molten：熔浆柱、熔铜四溅 + 熔铜贴花；slam：砸地冲击（尘浪 + 碎石 + 裂痕，不盖身体）；
    ///   trail：从 14 m 砸下来的火尾（锥尾体积 + 火舌）；streams：敌人身上淌水 / 泻沙 / 滴熔浆；flare：日轮炸亮。
    /// 检查：涌流体积 / 主题贴花确实生成了（数量 &gt; 0），并记下高画质同屏粒子峰值。
    /// </summary>
    public sealed class FxBossSuite : PlaytestSuite
    {
        public override string Id => "fx-boss";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        PlayerMotor motor;
        Camera spec;
        Vector3 feet, fwd, side;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            var weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals}");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            vitals.invulnerableUntil = float.MaxValue;
            motor.inputEnabled = false;
            var quality = ArtQuality.Level;
            ArtQuality.Set(ArtQualityLevel.High, false);
            fwd = motor.transform.forward;
            fwd.y = 0;
            fwd.Normalize();
            side = Vector3.Cross(Vector3.up, fwd);
            feet = Ground(motor.transform.position);
            Line($"贴花 {(SigilDecals.Available ? "能画" : "画不了")}，涌流材质 {(FxMaterials.Usable(FxMaterials.Get(FxMaterialKind.Surge)) ? "有" : "没有")}");

            var go = new GameObject("FxBoss Camera");
            spec = go.AddComponent<Camera>();
            spec.enabled = false;
            spec.fieldOfView = 50f;
            spec.nearClipPlane = 0.1f;
            spec.farClipPlane = 1500f;
            spec.cullingMask = ~(1 << Layers.FirstPerson);
            var data = spec.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            FxBudget.ResetPeak();

            yield return Sigils();
            yield return Water();
            yield return Molten();
            yield return Slam();
            yield return TrailCase();
            yield return Streams();
            yield return Flare();
            yield return Enemies();

            Line($"高画质同屏粒子峰值 {FxBudget.Peak}，被预算砍掉 {FxBudget.Dropped}");
            Destroy(go);
            ArtQuality.Set(quality, false);
            vitals.invulnerableUntil = -1;
            motor.inputEnabled = true;
        }

        IEnumerator Sigils()
        {
            var themes = new[] { SpawnTheme.Sand, SpawnTheme.Frost, SpawnTheme.Fire };
            var spots = new Vector3[3];
            for (int i = 0; i < 3; i++) spots[i] = At(9f, (i - 1) * 4.6f);
            // 对照：通用法阵
            foreach (var p in spots) FxDecals.Rune(p + Vector3.up * 0.02f, 1.6f, Fx.EnemyColor, 0.95f);
            yield return new WaitForSeconds(0.45f);
            View(At(9f, 0), 9f, 7f);
            Shot(spec, "fxboss_sigils_generic");
            yield return new WaitForSeconds(0.7f);
            int made = 0;
            for (int i = 0; i < 3; i++)
                if (SpawnThemes.Begin(themes[i], spots[i], 1.6f, Fx.EnemyColor, 0.95f, i == 1))
                    made++;
            if (made < 3) Fail($"sigils：三章法阵只画出 {made} 个（贴花 {(SigilDecals.Available ? "能画" : "画不了")}）");
            float t0 = Time.time;
            bool shot = false;
            while (Time.time - t0 < 0.95f)
            {
                float k = (Time.time - t0) / 0.95f;
                for (int i = 0; i < 3; i++) SpawnThemes.Tick(themes[i], spots[i], 1.6f, k, Time.deltaTime, Fx.EnemyColor);
                if (!shot && k > 0.45f)
                {
                    shot = true;
                    View(At(9f, 0), 9f, 7f);
                    Shot(spec, "fxboss_sigils_mid");
                    View(spots[0], 3.2f, 3.4f);
                    Shot(spec, "fxboss_sigils_sand");
                    View(spots[1], 3.2f, 3.4f);
                    Shot(spec, "fxboss_sigils_frost");
                    View(spots[2], 3.2f, 3.4f);
                    Shot(spec, "fxboss_sigils_fire");
                }
                yield return null;
            }
            for (int i = 0; i < 3; i++) SpawnThemes.Finale(themes[i], spots[i] + Vector3.up * 0.9f, 1.8f, Fx.EnemyColor);
            yield return null;
            View(At(9f, 0), 9f, 7f);
            Shot(spec, "fxboss_sigils_finale");
            yield return new WaitForSeconds(1f);
        }

        IEnumerator Water()
        {
            var a = At(12f, -5f);
            var b = At(12f, 1f);
            var c = At(14f, 6f);
            Fx.WaterSpout(a, 1.6f, 7f, 0.6f);
            Fx.Splash(b, 2.6f, Fx.NorthSea);
            Surge.Sheet(c - fwd * 4f, Yaw(fwd), 4f, 70f, 3.6f, SurgeKind.Water, 0.3f, 0.6f, 0.6f, null, null, 1.8f);
            Surge.Disk(At(7f, 0) + Vector3.up * 0.05f, 2.4f, SurgeKind.Water, 2.4f, 90f, -0.8f);
            if (Surge.ActiveCount < 3) Fail($"water：涌流体积只有 {Surge.ActiveCount} 个");
            yield return new WaitForSeconds(0.3f);
            View(At(12f, 0), 15f, 7f);
            Shot(spec, "fxboss_water_rise");
            yield return new WaitForSeconds(0.6f);
            Shot(spec, "fxboss_water_hold");
            yield return new WaitForSeconds(0.7f);
            Shot(spec, "fxboss_water_fall");
            yield return new WaitForSeconds(1.2f);
        }

        IEnumerator Molten()
        {
            Fx.LavaSpout(At(12f, -4f), 1.4f, 6f, 0.5f);
            Fx.MoltenBurst(At(11f, 3f), 2.4f);
            yield return new WaitForSeconds(0.35f);
            View(At(11.5f, 0), 13f, 6f);
            Shot(spec, "fxboss_molten_burst");
            yield return new WaitForSeconds(1.2f);
            Shot(spec, "fxboss_molten_cool");
            if (SigilDecals.ActiveOf(SigilMode.Molten) < 1) Fail("molten：没有留下熔铜贴花");
            yield return new WaitForSeconds(1f);
        }

        IEnumerator Slam()
        {
            var p = At(10f, 0);
            Fx.Slam(p, 4f);
            Fx.MoltenBurst(p + Vector3.up * 0.3f, 1.8f);
            yield return new WaitForSeconds(0.12f);
            View(p, 10f, 4f);
            Shot(spec, "fxboss_slam_hit");
            yield return new WaitForSeconds(0.5f);
            Shot(spec, "fxboss_slam_after");
            yield return new WaitForSeconds(1f);
        }

        IEnumerator TrailCase()
        {
            var dummy = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            Destroy(dummy.GetComponent<Collider>());
            var land = At(10f, 0);
            dummy.transform.position = land + Vector3.up * 14f;
            var h = Surge.Trail(dummy.transform, Vector3.up * 0.4f, 1.1f, 9f, SurgeKind.Fire, 1.2f);
            var tongue = FlameTongue.Attach(dummy.transform, Vector3.up * 0.8f, new Vector3(2.6f, 3.2f, 2.6f));
            if (!h.Alive) Fail("trail：火尾没生成");
            float t0 = Time.time;
            bool shot = false;
            while (Time.time - t0 < 1.0f)
            {
                float u = (Time.time - t0) / 1.0f;
                dummy.transform.position = land + Vector3.up * (14f * (1 - u * u) + 1f);
                if (!shot && u > 0.55f)
                {
                    shot = true;
                    View(land + Vector3.up * 7f, 17f, 1f);
                    Shot(spec, "fxboss_trail_fall");
                }
                yield return null;
            }
            h.Cancel();
            if (tongue) Destroy(tongue.gameObject);
            Fx.Slam(land, 4f);
            Fx.MoltenBurst(land + Vector3.up * 0.3f, 2.2f);
            yield return new WaitForSeconds(0.1f);
            View(land + Vector3.up * 1.5f, 12f, 3f);
            Shot(spec, "fxboss_trail_land");
            Destroy(dummy);
            yield return new WaitForSeconds(1f);
        }

        IEnumerator Streams()
        {
            var kinds = new[] { StreamKind.Water, StreamKind.Sand, StreamKind.Molten };
            var bodies = new List<EnemyAI>();
            for (int i = 0; i < 3; i++)
            {
                var ai = EnemyRoster.Spawn("jerboa_blade", At(7f, (i - 1) * 2.6f), Quaternion.LookRotation(-fwd), 1f, false);
                if (!ai) continue;
                bodies.Add(ai);
            }
            yield return new WaitForSeconds(1.0f);
            for (int i = 0; i < bodies.Count; i++)
            {
                bodies[i].enabled = false;
                var agent = bodies[i].GetComponent<UnityEngine.AI.NavMeshAgent>();
                if (agent) agent.enabled = false;
                Fx.BodyStream(bodies[i].gameObject, kinds[i], 3f, 80f);
            }
            yield return new WaitForSeconds(0.5f);
            View(At(7f, 0), 6.5f, 2.2f);
            Shot(spec, "fxboss_streams");
            yield return new WaitForSeconds(0.5f);
            foreach (var ai in bodies)
                if (ai)
                    Destroy(ai.gameObject);
        }

        IEnumerator Flare()
        {
            var p = At(12f, 0) + Vector3.up * 4f;
            Fx.SunFlare(p, 2.5f);
            yield return new WaitForSeconds(0.08f);
            View(p, 12f, 1f);
            Shot(spec, "fxboss_flare");
            yield return new WaitForSeconds(0.6f);
        }

        /// <summary>
        /// 普通怪图集里没截到的几招（要先打碎弱点才会出）：直接调它们的出招入口（反射），拍前摇和出手——
        /// 狐巫狐火（尾尖蓄火 → 三团狐火炸开放出）、马面重拳（拳上蓄火 → 冲击球）、傩巫碎面、熔铜匠裂锅、炮仗傀儡哑炸
        /// </summary>
        IEnumerator Enemies()
        {
            var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public;
            bool Call(object o, string method, params object[] args)
            {
                var m = o?.GetType().GetMethod(method, flags);
                if (m == null)
                {
                    Fail($"enemies：{o?.GetType().Name} 没有方法 {method}");
                    return false;
                }
                m.Invoke(o, args);
                return true;
            }

            EnemyAI Spawn(string id, Vector3 at)
            {
                var ai = EnemyRoster.Spawn(id, at, Quaternion.LookRotation(-fwd), 1f, false);
                if (!ai) Fail($"enemies：名册里没有 {id}");
                return ai;
            }

            // 狐巫：狐火
            var fox = Spawn("fox_witch", At(8f, -2f));
            yield return new WaitForSeconds(1.2f);
            if (fox && Call(fox, "BeginCast", "foxfireWindup", 0.9f))
            {
                yield return new WaitForSeconds(0.55f);
                View(fox.transform.position, 4.5f, 1.6f);
                Shot(spec, "fxboss_enemy_foxfire_wind");
                float t0 = Time.time;
                while (fox && fox.State == "foxfireWindup" && Time.time - t0 < 2f) yield return null;
                yield return new WaitForSeconds(0.06f);
                Shot(spec, "fxboss_enemy_foxfire_cast");
            }
            if (fox) Destroy(fox.gameObject);

            // 马面：重拳（贴着玩家，直接进出拳前摇）
            var mm = Spawn("mamian", At(2.6f, 0));
            yield return new WaitForSeconds(1.2f);
            if (mm && Call(mm, "SetState", "punchWind"))
            {
                yield return new WaitForSeconds(0.3f);
                View(mm.transform.position, 5f, 1.4f);
                Shot(spec, "fxboss_enemy_punch_wind");
                float t0 = Time.time;
                while (mm && mm.State == "punchWind" && Time.time - t0 < 2f) yield return null;
                yield return new WaitForSeconds(0.05f);
                View(mm.transform.position, 5f, 1.4f);
                Shot(spec, "fxboss_enemy_punch_hit");
            }
            if (mm) Destroy(mm.gameObject);

            // 傩巫：碎面
            var nuo = Spawn("nuo", At(7f, 2f));
            yield return new WaitForSeconds(1.2f);
            if (nuo && Call(nuo, "BreakFace"))
            {
                yield return new WaitForSeconds(0.08f);
                View(nuo.transform.position, 4.5f, 1.2f);
                Shot(spec, "fxboss_enemy_nuo_break");
            }
            if (nuo) Destroy(nuo.gameObject);

            // 熔铜匠：裂锅
            var founder = Spawn("founder", At(7f, -2f));
            yield return new WaitForSeconds(1.2f);
            if (founder && Call(founder, "CrackCrucible"))
            {
                yield return new WaitForSeconds(0.12f);
                View(founder.transform.position, 5f, 2f);
                Shot(spec, "fxboss_enemy_founder_crack");
                yield return new WaitForSeconds(0.8f);
                Shot(spec, "fxboss_enemy_founder_pool");
            }
            if (founder) Destroy(founder.gameObject);

            // 炮仗傀儡：哑炸
            var fc = Spawn("firecracker", At(9f, 0));
            yield return new WaitForSeconds(1.2f);
            if (fc && Call(fc, "Dud"))
            {
                yield return new WaitForSeconds(0.1f);
                View(fc.transform.position, 6f, 2f);
                Shot(spec, "fxboss_enemy_dud");
            }
            yield return new WaitForSeconds(1.5f);
            if (fc) Destroy(fc.gameObject);
        }

        /// <summary>旁观机位：从 at 后方 back 米、上方 up 米看过去（玩家身后偏一点）</summary>
        void View(Vector3 at, float back, float up)
        {
            spec.transform.position = at - fwd * back + side * (back * 0.25f) + Vector3.up * up;
            spec.transform.LookAt(at + Vector3.up * 0.8f);
        }

        Vector3 At(float ahead, float right) => Ground(feet + fwd * ahead + side * right);

        static float Yaw(Vector3 d) => Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;

        Vector3 Ground(Vector3 p)
        {
            float refY = feet == default ? p.y : feet.y;
            if (Physics.Raycast(new Vector3(p.x, refY + 6f, p.z), Vector3.down, out var hit, 14f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                p.y = hit.point.y;
            else p.y = refY;
            return p;
        }
    }
}
