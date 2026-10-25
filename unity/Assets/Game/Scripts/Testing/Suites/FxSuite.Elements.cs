using System.Collections;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 战斗特效冒烟 · FX3 冰霜 / FX4 火狱（FxSuite 的一部分；bridge.sh playtest fx-elements 只跑这两段）：
    ///   FX3：碎冰（刚炸 / 散开）、冰爆（刚炸 / 余雾，落霜斑贴花）、冰环（冰刺冒出）、冻雾（霜纹 + 冷雾续上）、霜甲壳（冻到一半 / 冻满 / 近景 / 碎掉）、
    ///        星芒（骨骼星芒 + 一次性的「叮」）；
    ///   FX4：见 <see cref="InfernoCase"/>。
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
            yield break;
        }
    }

    /// <summary>只跑 FX3 冰霜 / FX4 火狱逐项截图（bridge.sh playtest fx-elements；完整的 fx 套件也包含这两段）</summary>
    public sealed class FxElementsSuite : FxSuite
    {
        public override string Id => "fx-elements";
        protected override bool ElementsOnly => true;
    }
}
