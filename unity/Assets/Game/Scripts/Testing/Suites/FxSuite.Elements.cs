using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 战斗特效冒烟 · FX3 冰霜 / FX4 火狱（FxSuite 的一部分；bridge.sh playtest fx-elements 只跑这两段）：
    ///   FX3：碎冰（刚炸 / 散开）、冰爆（刚炸 / 余雾，落霜斑贴花）、冰环（冰刺冒出）、冻雾（霜纹 + 冷雾续上）、霜甲壳（冻到一半 / 冻满 / 近景 / 碎掉）、
    ///        星芒（骨骼星芒 + 一次性的「叮」）；_E 发光遮罩（青鸟 / 河豚 / 豪彘 / 狐巫 + 镜：平时一张、发光通道拉满一张近景，核对挂上的遮罩数）；
    ///   FX4：火药爆（刚炸 / 纸屑飘落）、熔铜流（浇铜 + 熔铁团）、五种地火并排、火柱、铁链（甩起来烧红 / 断链）、碎岩甲 + 熔岩飞溅；
    ///        火苗着色 + 骨骼火舌（火浣鼠 / 祸斗 / 炭童 / 镇墓兽近景）、分区遮罩（火鼍碎两块甲、傩巫换黑面后碎一张脸的近景）。
    /// 每项排开在刷怪台中心两侧（互不叠），玩家站到 8 m 外对着拍；核对贴花 / 冰刺 / 冷雾 / 冰壳的数量。
    /// </summary>
    public partial class FxSuite
    {
        /// <summary>只跑 FX3 / FX4 两段（fx-elements）</summary>
        protected virtual bool ElementsOnly => false;

        Vector3 AwayDir()
        {
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
            away.y = 0;
            return away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
        }

        static Vector3 OnGround(Vector3 p)
        {
            float gy = Fx.GroundY(p + Vector3.up * 6f, 20f);
            return float.IsNegativeInfinity(gy) ? p : new Vector3(p.x, gy, p.z);
        }

        /// <summary>第 i 个展位（刷怪台后方 10 m 那一排，每隔 6 m 一个：避开中间的刷怪台和地上的武器），玩家站到 dist 米外看着它</summary>
        IEnumerator Stage(int i, float dist, float lookUp, System.Action<Vector3> got)
        {
            var away = AwayDir();
            var side = Vector3.Cross(Vector3.up, away);
            var p = OnGround(arena.Center - away * 10f + side * (i * 6f));
            Teleport(motor, p + away * dist);
            yield return null;
            Aim(motor, eye, p + Vector3.up * lookUp);
            yield return new WaitForSeconds(0.25f);
            got(p);
        }

        IEnumerator FrostCase()
        {
            arena.Clear();
            Vector3 p = default;

            // 碎冰
            yield return Stage(-2, 6f, 1f, v => p = v);
            Fx.FrostShatter(p + Vector3.up * 1.2f, 1.2f);
            yield return new WaitForSeconds(0.06f);
            Shot(weapons.eye, "fx3_shatter");
            yield return new WaitForSeconds(0.3f);
            Shot(weapons.eye, "fx3_shatter_late");

            // 冰爆
            yield return Stage(-1, 9f, 0.8f, v => p = v);
            int frost0 = FxDecals.ActiveOfKind(FxMaterialKind.DecalFrost);
            Fx.FrostNova(p + Vector3.up * 0.8f, 3f);
            yield return new WaitForSeconds(0.08f);
            Shot(weapons.eye, "fx3_nova");
            yield return new WaitForSeconds(0.7f);
            Shot(weapons.eye, "fx3_nova_late");
            int frost1 = FxDecals.ActiveOfKind(FxMaterialKind.DecalFrost);
            Line($"FX3 冰爆：霜纹贴花 {frost0} → {frost1}");
            if (Telegraph.DecalsSupported && frost1 <= frost0) Fail("冰爆没有铺霜纹贴花");

            // 冰环
            yield return Stage(0, 8f, 0.4f, v => p = v);
            Fx.IceRing(p, 3f);
            yield return new WaitForSeconds(0.16f);
            int spikes = IceSpikes.ActiveCount;
            Shot(weapons.eye, "fx3_icering");
            Line($"FX3 冰环：冰刺簇 {spikes}");
            if (spikes == 0) Fail("冰环没有冒冰刺");
            yield return new WaitForSeconds(0.9f);

            // 冻雾
            yield return Stage(1, 9f, 0.5f, v => p = v);
            var fog = FrostFog.Spawn(p, 3f, 4f, 0.4f);
            yield return new WaitForSeconds(1.2f);
            var look = fog ? fog.GetComponent<FrostFogFx>() : null;
            Shot(weapons.eye, "fx3_fog");
            Line($"FX3 冻雾：外观 {(look ? "✓" : "✗")}，冷雾 {(look ? look.Puffs : 0)} 团，霜纹贴花 {FxDecals.ActiveOfKind(FxMaterialKind.DecalFrost)}");
            if (!look) Fail("冻雾没有挂 FrostFogFx");
            else if (look.Puffs == 0) Fail("冻雾没有冒冷雾");

            // 霜甲壳：一只靶子，停掉 AI 站桩
            var ai = Spawn(Cross(AwayDir()) * 12f - AwayDir() * 10f);
            if (ai)
            {
                yield return new WaitForSeconds(1f);
                Freeze(ai);
                yield return FaceEnemy(ai, 5f);
                yield return new WaitForSeconds(0.2f);
                Aim(motor, eye, BodyCenter(ai.Health));
                var shell = FrostShell.Cover(ai.Health);
                yield return new WaitForSeconds(0.17f);
                Shot(weapons.eye, "fx3_shell_freeze");
                yield return new WaitForSeconds(0.6f);
                Shot(weapons.eye, "fx3_shell");
                PoseShot(ai, Cross(AwayDir()) * 0.7f + AwayDir() * 0.5f, "fx3_shell_pose");
                int n = FrostShell.ActiveCount;
                FrostShell.Shatter(ai.Health);
                yield return new WaitForSeconds(0.05f);
                Shot(weapons.eye, "fx3_shell_break");
                yield return new WaitForSeconds(0.3f);
                Line($"FX3 霜甲壳：结上 {(shell ? "✓" : "✗")}，同时 {n} 层；碎掉后剩 {FrostShell.ActiveCount}");
                if (!shell || n != 1) Fail($"霜甲壳没结上（{n}）");
                if (FrostShell.ActiveCount != 0) Fail("霜甲壳碎掉后还在");

                // 星芒：靶子头上挂一片骨骼星芒（满亮）+ 一次性的「叮」
                var head = new GameObject("FX3 Glint Holder").transform;
                head.position = BodyCenter(ai.Health) + Vector3.up * 1.1f;
                var g = FrostGlint.Attach(head, Vector3.zero, 0.9f, FrostPalette.IceHot);
                if (g) g.Set(1, 1);
                Fx.FrostGlint(BodyCenter(ai.Health) + Cross(AwayDir()) * 0.8f, 1.2f);
                yield return new WaitForSeconds(0.08f);
                Shot(weapons.eye, "fx3_glint");
                Destroy(head.gameObject);
                if (!g) Fail("骨骼星芒没挂上");
            }
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
            yield return GlowMaskCase();
        }

        /// <summary>_E 发光遮罩：四种敌人各刷一只站桩，平时一张、发光通道拉满一张近景</summary>
        IEnumerator GlowMaskCase()
        {
            var cases = new (string id, int want)[] { ("qingniao", 1), ("ice_puffer", 1), ("haozhi", 1), ("fox_witch", 2) };
            var away = AwayDir();
            var side = Cross(away);
            for (int i = 0; i < cases.Length; i++)
            {
                var (id, want) = cases[i];
                var ai = arena.Spawn(id, false, side * ((i - 1.5f) * 4f) - away * 10f);
                if (!ai)
                {
                    Fail($"生成 {id} 失败");
                    continue;
                }
                ai.Health.maxHealth = 40000;
                ai.Health.ResetVitals();
                yield return new WaitForSeconds(1.2f);
                Freeze(ai);
                var gm = ai.GetComponent<GlowMask>();
                var body = ai.Body;
                if (body)
                {
                    body.SetGlow(0, 0.1f);
                    body.SetGlow(1, 0);
                }
                yield return new WaitForSeconds(0.4f);
                PoseShot(ai, side * 0.8f + away * 0.6f, $"fx3_glow_{id}_idle");
                if (body)
                {
                    body.SetGlow(0, 1);
                    body.SetGlow(1, 1);
                    body.SetGlow(2, 1);
                }
                yield return new WaitForSeconds(0.5f);
                PoseShot(ai, side * 0.8f + away * 0.6f, $"fx3_glow_{id}");
                int n = gm ? gm.Masked : 0;
                Line($"FX3 发光遮罩 · {id}：组件 {(gm ? "✓" : "✗")}，遮罩 {n}/{want} 张");
                if (!gm) Fail($"{id} 没有挂 GlowMask");
                else if (n < want) Fail($"{id} 只找到 {n} 张发光遮罩（要 {want}：先跑 emission_mask.py 和 bridge.sh fx）");
                arena.Clear();
                yield return new WaitForSeconds(0.2f);
            }
        }

        static Vector3 Cross(Vector3 away) => Vector3.Cross(Vector3.up, away);

        /// <summary>站桩拍照：停掉 AI 和导航代理（代理不停的话会带着惯性滑出画面）</summary>
        static void Freeze(EnemyAI ai)
        {
            if (!ai) return;
            ai.enabled = false;
            var ag = ai.GetComponent<UnityEngine.AI.NavMeshAgent>();
            if (ag && ag.isActiveAndEnabled && ag.isOnNavMesh)
            {
                ag.isStopped = true;
                ag.velocity = Vector3.zero;
            }
        }

        IEnumerator InfernoCase()
        {
            arena.Clear();
            Vector3 p = default;

            // 火药爆
            yield return Stage(-2, 9f, 1f, v => p = v);
            Fx.Gunpowder(p + Vector3.up * 0.6f, 2.2f);
            yield return new WaitForSeconds(0.08f);
            Shot(weapons.eye, "fx4_gunpowder");
            yield return new WaitForSeconds(0.7f);
            Shot(weapons.eye, "fx4_gunpowder_late");

            // 熔铜流：从 2.5 m 高处浇到 6 m 外；一团熔铁沿抛物线飞过去
            yield return Stage(-1, 9f, 1.2f, v => p = v);
            var side = Cross(AwayDir());
            var a = p - side * 3f + Vector3.up * 2.5f;
            var b = p + side * 3f + Vector3.up * 1.2f;
            var pour = MoltenStream.Pour(() => a, () => b, 0.5f, 0.6f);
            MoltenStream.Arc(p - side * 2f + Vector3.up * 1.5f, p + side * 2.5f, 0.7f, 1f, 1.8f);
            yield return new WaitForSeconds(0.45f);
            int streams = MoltenStream.ActiveCount;
            Shot(weapons.eye, "fx4_molten_stream");
            Line($"FX4 熔铜流：液流 {streams} 条");
            if (!pour || streams == 0) Fail("熔铜流没画出来");
            yield return new WaitForSeconds(1.2f);

            // 五种地火并排（不伤人）
            yield return Stage(0, 10f, 0.3f, v => p = v);
            var beds = new[] { FireBed.Ember, FireBed.PaperAsh, FireBed.Molten, FireBed.Lava, FireBed.Sunfire };
            int t0 = FlameTongues.ActiveCount;
            var looks = new List<FloorFireFx>();
            for (int i = 0; i < beds.Length; i++)
            {
                var f = FloorFire.Spawn(p + side * ((i - 2) * 2.4f), 1f, 4f, 0, 0.5f, null, false, null, beds[i]);
                var fx = f ? f.GetComponent<FloorFireFx>() : null;
                if (fx) looks.Add(fx);
            }
            yield return new WaitForSeconds(0.9f);
            Shot(weapons.eye, "fx4_floorfire");
            SideShot(p, Vector3.up * 6.5f + AwayDir() * 2.5f, "fx4_floorfire_top");
            int tongues = FlameTongues.ActiveCount - t0;
            Line($"FX4 地火变体：外观 {looks.Count}/5，火舌 {tongues} 片，地火贴花 {FxDecals.ActiveOfKind(FxMaterialKind.DecalFire)}");
            if (looks.Count < 5) Fail($"地火变体只挂上 {looks.Count}/5 个外观");
            if (tongues <= 0) Fail("地火没有火舌");

            // 火柱
            yield return Stage(1, 9f, 1.2f, v => p = v);
            Fx.FlamePillar(p, 0.6f, 2.6f);
            yield return new WaitForSeconds(0.12f);
            Shot(weapons.eye, "fx4_flame_pillar");

            // 铁链：甩起来从根往外烧红；然后断链落地
            yield return Stage(2, 6f, 1.3f, v => p = v);
            var chain = FxChain.Create("FX4 Test Chain", 120, 1.2f);
            var cpts = new Vector3[9];
            for (int i = 0; i < cpts.Length; i++)
            {
                float u = i / 8f;
                cpts[i] = p - side * 2.5f + side * 5f * u + Vector3.up * (1.8f - 0.6f * Mathf.Sin(Mathf.PI * u));
            }
            chain.Visible = true;
            // 甩圈烧到一半：腕铐那头白热、往外渐暗红、远端还是冷铁
            chain.Layout(cpts, u => Mathf.Clamp01((0.55f - u) * 2.2f), 0.8f);
            yield return null;
            Shot(weapons.eye, "fx4_chain");
            SideShot(cpts[4], side * 0.4f + AwayDir() * 1.6f + Vector3.up * 0.3f, "fx4_chain_close");
            // 主相机那张会在帧末再抓一次屏（含 HUD）：等这帧画完再拆链子，不然抓到的是没有链子的画面
            yield return null;
            int links = chain.Links;
            Destroy(chain.gameObject);
            FxChain.Drop(cpts, 1.2f, 3f, 0.9f);
            Fx.ChainBreak(cpts[4], 1f, InfernoPalette.Hot);
            yield return new WaitForSeconds(0.5f);
            Shot(weapons.eye, "fx4_chain_drop");
            Line($"FX4 铁链：{links} 节");
            if (links < 20) Fail($"铁链只摆出 {links} 节");

            // 碎岩甲 + 熔岩飞溅
            yield return Stage(3, 6f, 1f, v => p = v);
            Fx.Basalt(p + Vector3.up * 1f, 1.4f);
            Fx.MoltenSplash(p + Vector3.up * 1f, 1.2f);
            yield return new WaitForSeconds(0.15f);
            Shot(weapons.eye, "fx4_basalt");
            arena.Clear();
            yield return new WaitForSeconds(0.3f);

            yield return FlameKeyCase();
            yield return RegionCase();
        }

        /// <summary>火苗着色 + 骨骼火舌：火浣鼠 / 祸斗 / 炭童（_FLAMEKEY 拉满）、镇墓兽背上的日火，站桩近景</summary>
        IEnumerator FlameKeyCase()
        {
            var away = AwayDir();
            var side = Cross(away);
            var ids = new[] { "fire_rat", "huodou", "tantong", "tomb_beast" };
            for (int i = 0; i < ids.Length; i++)
            {
                var ai = arena.Spawn(ids[i], false, side * ((i - 1.5f) * 4f) - away * 10f);
                if (!ai)
                {
                    Fail($"生成 {ids[i]} 失败");
                    continue;
                }
                ai.Health.maxHealth = 40000;
                ai.Health.ResetVitals();
                yield return new WaitForSeconds(1.2f);
                Freeze(ai);
                if (ai.Body) ai.Body.SetGlow(0, 1);
                yield return new WaitForSeconds(0.5f);
                var key = ai.GetComponent<FlameKey>();
                int tongues = ai.GetComponentsInChildren<FlameTongue>().Length;
                bool back = ids[i] == "tomb_beast";
                var view = back ? -ai.transform.forward * 0.8f + Vector3.up * 0.6f + side * 0.3f : side * 0.8f + away * 0.6f;
                PoseShot(ai, view, $"fx4_flame_{ids[i]}");
                string keyText = key ? $"✓（亮度 {key.Glow:0.00}，{key.Renderers} 个渲染器）" : "—";
                Line($"FX4 火焰本体 · {ids[i]}：火苗着色 {keyText}，火舌 {tongues} 片");
                if (!back && (!key || key.Renderers == 0)) Fail($"{ids[i]} 没有火苗着色");
                if (tongues == 0) Fail($"{ids[i]} 没有骨骼火舌");
                arena.Clear();
                yield return new WaitForSeconds(0.2f);
            }
        }

        /// <summary>分区遮罩：火鼍打碎两块甲（俯视背上），傩巫换到黑面再碎一张脸（正面近景）</summary>
        IEnumerator RegionCase()
        {
            var away = AwayDir();
            var side = Cross(away);
            var tuo = arena.Spawn("tuo", false, -away * 10f);
            if (tuo)
            {
                tuo.Health.maxHealth = 40000;
                tuo.Health.ResetVitals();
                yield return new WaitForSeconds(1.5f);
                Freeze(tuo);
                var t = tuo as TuoAI;
                if (t)
                {
                    t.BreakPlate(0);
                    t.BreakPlate(3);
                }
                yield return new WaitForSeconds(0.4f);
                var rm = tuo.GetComponent<RegionMask>();
                PoseShot(tuo, Vector3.up * 1.2f + side * 0.6f - tuo.transform.forward * 0.3f, "fx4_region_tuo");
                int rr = rm ? rm.Renderers : 0;
                float h0 = rm ? rm.PlateHeat(0) : 0, h3 = rm ? rm.PlateHeat(3) : 0;
                Line($"FX4 分区 · 火鼍：遮罩 {rr} 个渲染器，甲 0 热度 {h0:0.00}、甲 3 {h3:0.00}");
                if (rr == 0) Fail("火鼍没有挂上岩甲分区遮罩（RegionMaskPostprocessor 没烘？）");
                else if (h0 < 0.5f) Fail("碎甲后分区热度没写进去");
                arena.Clear();
                yield return new WaitForSeconds(0.2f);
            }
            else Fail("生成 tuo 失败");

            var nuo = arena.Spawn("nuo", false, -away * 10f);
            if (nuo)
            {
                nuo.Health.maxHealth = 40000;
                nuo.Health.ResetVitals();
                yield return new WaitForSeconds(1.5f);
                Freeze(nuo);
                var n = nuo as NuoAI;
                if (n)
                {
                    n.SwapFace();
                    yield return new WaitForSeconds(0.7f);
                    PoseShot(nuo, nuo.transform.forward * 0.7f + Vector3.up * 0.2f, "fx4_region_nuo_black");
                    n.BreakFace();
                    yield return new WaitForSeconds(0.3f);
                    Freeze(nuo);
                    PoseShot(nuo, nuo.transform.forward * 0.6f + Vector3.up * 0.25f, "fx4_region_nuo_cracked");
                }
                var rm = nuo.GetComponent<RegionMask>();
                int rr = rm ? rm.Renderers : 0;
                string mode = rm ? rm.Current.ToString() : "—";
                Line($"FX4 分区 · 傩巫：遮罩 {rr} 个渲染器，模式 {mode}");
                if (rr == 0) Fail("傩巫没有挂上面具分区遮罩");
                arena.Clear();
                yield return new WaitForSeconds(0.2f);
            }
            else Fail("生成 nuo 失败");
        }
    }

    /// <summary>只跑 FX3 冰霜 / FX4 火狱逐项截图（bridge.sh playtest fx-elements；完整的 fx 套件也包含这两段）</summary>
    public sealed class FxElementsSuite : FxSuite
    {
        public override string Id => "fx-elements";
        protected override bool ElementsOnly => true;
    }
}
