using System.Collections;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 地面预警的观感对照（bridge.sh playtest telegraph-look [场景]；默认测试场，常用 L1_4_Crescent / L2_4_Beiming / L3_4_Zhurong 看亮沙、冰雪、熔岩）：
    /// 在玩家出生点附近找一个前方 26 m 开阔、地面起伏不大的朝向，依次摆出几种危险预警——15 m / 20 m 的落点圆、首领在 20 m 外朝玩家扇过来的扇形、
    /// 从 24 m 外贴着玩家左侧冲过来的长条、14 m 外的辐条、16 m 外的环形、16 m 外扩散的冲击波——各在填到一半和快填满时拍第一人称 + 斜上方旁观机位
    /// （playtest_tlook_&lt;场景&gt;_&lt;形状&gt;_&lt;mid|late&gt;[_tp].png）。
    /// 检查：每个预警都生成成功；首行记下危险色、投射方式。读不读得出来看截图。
    /// </summary>
    public sealed class TelegraphLookSuite : PlaytestSuite
    {
        public override string Id => "telegraph-look";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const float Duration = 2.4f;

        PlayerMotor motor;
        Camera eye, spec;
        Vector3 feet, fwd, side;
        string tag;
        float peakUnderfoot, lastUnderfoot, lastSide;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(2f);
            var weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            var vitals = FindAnyObjectByType<PlayerVitals>();
            if (!weapons || !motor || !vitals || !weapons.eye)
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
            eye = weapons.eye;
            tag = SceneManager.GetActiveScene().name;

            if (!PickHeading(motor.transform.position, out fwd))
            {
                Line("出生点附近没找到前方 26 m 开阔的朝向，就用玩家当前朝向");
                fwd = motor.transform.forward;
                fwd.y = 0;
                fwd.Normalize();
            }
            side = Vector3.Cross(Vector3.up, fwd);
            feet = Ground(motor.transform.position);
            Line($"场景 {tag}，关卡 {(LevelMeta.Current ? LevelMeta.Current.levelId : "—")}，危险色 #{ColorUtility.ToHtmlStringRGB(TelegraphPalette.Danger)}，" +
                 $"深度图 {(Telegraph.DepthTextureAvailable ? "有（体积投射）" : "没有")}，贴花特性 {(Telegraph.DecalsSupported ? "有" : "没有")}");

            var go = new GameObject("Telegraph Look Camera");
            spec = go.AddComponent<Camera>();
            spec.enabled = false;
            spec.fieldOfView = 50f;
            spec.nearClipPlane = 0.1f;
            spec.farClipPlane = 1500f;
            spec.cullingMask = ~(1 << Layers.FirstPerson);
            var data = spec.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;

            yield return Case("circle", () => new[]
            {
                Telegraph.Circle(At(15, 0), 2.6f, Duration, Color.white),
                Telegraph.Circle(At(20, 5), 3.4f, Duration, Color.white),
            });
            yield return Case("sector", () => new[]
            {
                Telegraph.Sector(At(20, 3), Yaw(-fwd), 30f, 24f, Duration, Color.white),
            });
            yield return Case("lane", () => new[]
            {
                Telegraph.Lane(At(24, -3), At(1, -3), 3f, Duration, Color.white),
            });
            yield return Case("spokes", () => new[]
            {
                Telegraph.Spokes(At(14, 0), 6, 10f, 1.2f, Yaw(fwd) + 15f, Duration, Color.white),
            });
            yield return Case("annulus", () => new[]
            {
                Telegraph.Annulus(At(16, 0), 6f, 11f, Duration, Color.white),
            });
            yield return Case("wave", () => new[]
            {
                Telegraph.Wave(At(16, 0), 14f, 14f / Duration, Color.white, TelegraphTone.Danger),
            });
            // 脚下：落点圈就画在玩家脚下，视线看着前方 / 高处时地面圈在视野下沿以外——第一人称靠底边的危险光带（TelegraphUnderfoot）
            // 落点圆心在玩家左前 1.7 m：光带左半边该更亮（往右躲）
            yield return Case("feet", () => new[]
            {
                Telegraph.Circle(At(0.6f, -1.6f), 2.6f, Duration, Color.white),
                Telegraph.Circle(At(1f, 4.5f), 2.6f, Duration, Color.white),
            });
            if (!(peakUnderfoot > 0.3f)) Fail($"站在危险预警里，第一人称底边光带只到 {peakUnderfoot:F2}");
            if (!(lastSide < -0.3f)) Fail($"落点在左侧，底边光带的方向是 {lastSide:F2}（应 < −0.3，左亮）");
            yield return Case("own", () => new[]
            {
                Telegraph.Circle(feet, 2.6f, Duration, new Color(1f, 0.8f, 0.3f), TelegraphTone.Own),
            });
            if (lastUnderfoot > 0.01f) Fail($"站在原色（非危险）预警里也亮了底边光带（{lastUnderfoot:F2}）");

            // 2-4：鹏 · 扇翼狂风的冻风带（环台外缘的大环，r 外缘 − 5 … 外缘 + 1），从冰窟上空俯拍
            if (IceHole.All.Count > 0 && IceHole.All[0])
            {
                var hole = IceHole.All[0];
                var c = hole.transform.position;
                var band = Telegraph.Annulus(c, Mathf.Max(hole.radius + 4f, hole.outer - 5f), hole.outer + 1f, 4f, Color.white);
                yield return new WaitForSeconds(2.5f);
                Line($"  冻风带（冰窟 r {hole.radius:F0} / 外缘 {hole.outer:F0}，圆心 {c:F1}）：{Telegraph.Describe(band)}");
                spec.transform.position = c + Vector3.up * 55f - fwd * 30f;
                spec.transform.LookAt(c);
                Shot(spec, $"tlook_{tag}_gustband_tp");
                yield return null;
                band.End();
            }

            Destroy(go);
            vitals.invulnerableUntil = -1;
            motor.inputEnabled = true;
        }

        IEnumerator Case(string name, System.Func<TelegraphHandle[]> spawn)
        {
            Aim(motor, eye.transform, feet + fwd * 18f + Vector3.up * 1.4f);
            yield return null;
            var hs = spawn();
            foreach (var h in hs)
                if (!h.Alive) Fail($"{name}：预警没生成");
            float t0 = Time.time;
            peakUnderfoot = 0;
            while (Time.time - t0 < Duration * 0.5f)
            {
                peakUnderfoot = Mathf.Max(peakUnderfoot, TelegraphUnderfoot.Level);
                yield return null;
            }
            Shoot($"{name}_mid");
            while (Time.time - t0 < Duration * 0.9f)
            {
                peakUnderfoot = Mathf.Max(peakUnderfoot, TelegraphUnderfoot.Level);
                yield return null;
            }
            lastUnderfoot = TelegraphUnderfoot.Level;
            lastSide = TelegraphUnderfoot.Side;
            Shoot($"{name}_late");
            float p = hs.Length > 0 ? hs[0].Progress : 0;
            Line($"  {name}：{hs.Length} 个，拍「快填满」时进度 {p:F2}，脚下光带最强 {peakUnderfoot:F2}、方向 {lastSide:F2}");
            // 屏幕抓取在本帧末尾：先让这一帧带着预警画完再收
            yield return null;
            foreach (var h in hs) h.End();
            yield return new WaitForSeconds(0.3f);
        }

        void Shoot(string name)
        {
            // 第一人称：有 HUD 时改成屏幕抓取（游戏画面真正显示的）
            Shot(eye, $"tlook_{tag}_{name}");
            spec.transform.position = feet - fwd * 7f + side * 2.5f + Vector3.up * 8f;
            spec.transform.LookAt(feet + fwd * 13f);
            Shot(spec, $"tlook_{tag}_{name}_tp");
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

        /// <summary>16 个方向里挑前方 26 m 眼高无遮挡、沿途地面高差都在 ±2.5 m 内的一个（取最平的）</summary>
        static bool PickHeading(Vector3 at, out Vector3 best)
        {
            best = default;
            float bestScore = float.MaxValue;
            var eyeAt = at + Vector3.up * 1.6f;
            for (int i = 0; i < 16; i++)
            {
                float a = i * Mathf.PI * 2f / 16f;
                var d = new Vector3(Mathf.Sin(a), 0, Mathf.Cos(a));
                if (Physics.Raycast(eyeAt, d, 26f, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                float worst = 0;
                bool ok = true;
                for (float s = 3f; s <= 26f; s += 2.5f)
                {
                    var p = at + d * s;
                    if (!Physics.Raycast(new Vector3(p.x, at.y + 6f, p.z), Vector3.down, out var hit, 14f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                    {
                        ok = false;
                        break;
                    }
                    worst = Mathf.Max(worst, Mathf.Abs(hit.point.y - at.y));
                }
                if (!ok || worst > 2.5f || worst >= bestScore) continue;
                bestScore = worst;
                best = d;
            }
            return bestScore < float.MaxValue;
        }
    }
}
