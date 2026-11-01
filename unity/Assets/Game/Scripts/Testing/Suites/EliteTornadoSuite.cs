using System.Collections;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>迅捷精英龙卷的真实战斗节拍与第一人称读感（bridge.sh playtest elite-tornado [场景]）。</summary>
    public sealed class EliteTornadoSuite : HBeatSuite
    {
        public override string Id => "elite-tornado";
        public override string Scene => "Assets/Scenes/TestArena.unity";
        const string Tag = "elite_tornado";

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.2f);
            if (!Setup(Tag)) yield break;
            var p0 = motor.transform.position;
            var fwd = motor.transform.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude > 1e-4f ? fwd.normalized : Vector3.forward;
            var arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            var center = arena ? arena.Center : p0 + fwd * 10f;
            if (arena)
            {
                arena.Clear();
                var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : -arena.transform.forward;
                away.y = 0;
                fwd = away.sqrMagnitude > 1e-4f ? -away.normalized : fwd;
            }
            if (NavMesh.SamplePosition(center, out var nav, 5f, NavMesh.AllAreas)) center = nav.position;
            Teleport(motor, center - fwd * 10f);
            var ai = EnemyRoster.Spawn("jerboa_blade", center, Quaternion.LookRotation(-fwd), 1f, true, new SpawnOptions { affix = "swift" });
            if (!ai)
            {
                Fail("刷不出迅捷精英");
                yield break;
            }
            ai.Health.maxHealth *= 20f;
            ai.Health.ResetVitals();
            Aim(motor, eye, center + Vector3.up * 1.2f);
            yield return new WaitForSeconds(1.2f);
            ai.enabled = false;
            ai.InterruptAttack();
            var agent = ai.GetComponent<NavMeshAgent>();
            if (agent && agent.enabled && agent.isOnNavMesh) agent.isStopped = true;
            var runtime = ai.GetComponent<EliteAffixRuntime>();
            var controller = runtime ? runtime.Controller as EliteAffix_Swift.Controller : null;
            if (controller == null)
            {
                Fail("迅捷词缀控制器没有接上");
                yield break;
            }

            float wait = 0;
            while (!controller.Winding && wait < 8f)
            {
                KeepPlayerAlive();
                wait += Time.deltaTime;
                yield return null;
            }
            if (!controller.Winding)
            {
                Fail("8 秒内没有开始龙卷蓄力");
                yield break;
            }
            Snap("tornado", "迅捷精英 · 龙卷", 1, "预警", center + Vector3.up, 9f, "0.85 s 锁定风道 + 蓄风");
            SnapEye("tornado", "迅捷精英 · 龙卷", 1, "预警", center + Vector3.up * 1.2f, "第一人称 10 m");

            EliteTornado tornado = null;
            wait = 0;
            while (!tornado && wait < 2f)
            {
                tornado = FindAnyObjectByType<EliteTornado>();
                wait += Time.deltaTime;
                yield return null;
            }
            if (!tornado)
            {
                Fail("蓄力结束没有生成龙卷");
                yield break;
            }
            var release = tornado.transform.position;
            Snap("tornado", "迅捷精英 · 龙卷", 3, "释放帧", release + Vector3.up * 1.5f, 7f, "月牙挥斩 + 螺旋风带出手");
            Combat.Execute(ai.Health, true);
            yield return new WaitForSeconds(0.45f);
            if (!tornado)
            {
                Fail("精英死亡后，已释放的龙卷被错误清掉");
                yield break;
            }
            var mid = tornado.transform.position;
            Aim(motor, eye, mid + Vector3.up * 1.6f);
            Snap("tornado", "迅捷精英 · 龙卷", 4, "持续段", mid + Vector3.up * 1.8f, 7f, "窄底宽顶 + 章节尘色 + 碎石");
            SnapEye("tornado", "迅捷精英 · 龙卷", 4, "持续段", mid + Vector3.up * 1.5f, "第一人称：风带不盖准星");
            yield return new WaitForSeconds(1.4f);
            Line($"龙卷命中 {tornado.PlayerHits} 次，基础伤害 {tornado.Damage:F1}，方向 {tornado.Direction}");
            if (tornado.PlayerHits != 1) Fail($"龙卷应只命中一次，实际 {tornado.PlayerHits} 次");
            foreach (var t in FindObjectsByType<EliteTornado>(FindObjectsInactive.Exclude)) t.Dissipate();
            yield return new WaitForSeconds(0.5f);
            Teardown(Tag);
        }
    }
}
