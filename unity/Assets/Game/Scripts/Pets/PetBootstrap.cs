using UnityEngine;
using UnityEngine.SceneManagement;

namespace Spiritfire.Game
{
    /// <summary>
    /// 场景加载后自动接上灵宠系统（场景由编辑器构建器生成，不用为此重建场景）：
    ///   玩家（有 PlayerVitals）挂 <see cref="PetOwner"/>，HUD 挂 <see cref="PetHud"/>；
    ///   出生点周围挑一块开阔平地摆「灵兽台」（测试用，八只灵宠全摆出来）；
    ///   1-1 场地 ② 的宝箱奖励若还是旧的 scroll，换成 pet（构建器已改，旧场景运行时补上）。
    /// 幂等：重复调用不会重复添加。没有玩家的场景（展示场景）什么都不做。
    /// </summary>
    public static class PetBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            SceneManager.sceneLoaded -= OnSceneLoaded;
            PetOwner.TestMode = false;
            Combat.ForceWeakpoint.Clear();
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Init()
        {
            SceneManager.sceneLoaded -= OnSceneLoaded;
            SceneManager.sceneLoaded += OnSceneLoaded;
            Setup();
        }

        static void OnSceneLoaded(Scene scene, LoadSceneMode mode) => Setup();

        public static void Setup()
        {
            var pv = PlayerVitals.Instance ? PlayerVitals.Instance : UnityEngine.Object.FindAnyObjectByType<PlayerVitals>();
            if (!pv) return;
            if (!pv.GetComponent<PetOwner>()) pv.gameObject.AddComponent<PetOwner>();
            var hud = Hud.Instance ? Hud.Instance : UnityEngine.Object.FindAnyObjectByType<Hud>();
            if (hud && !hud.GetComponent<PetHud>()) hud.gameObject.AddComponent<PetHud>();
            ConvertSiteReward();
            if (!UnityEngine.Object.FindAnyObjectByType<PetAltar>()) PlaceAltar(pv.transform);
        }

        /// <summary>1-1 场地 ②（雅丹石阵）：宝箱奖励 scroll → pet。只认这一个场地，别的关卡的场地奖励不动</summary>
        static void ConvertSiteReward()
        {
            foreach (var s in UnityEngine.Object.FindObjectsByType<EncounterSite>())
                if ((s.title == "雅丹石阵" || s.name == "Site_2_Yardang") && s.reward == "scroll") s.reward = "pet";
        }

        /// <summary>
        /// 在出生点周围挑一块开阔平地摆半圆：每个候选点按八个封印位的落差、出生点看过去有没有遮挡、在不在导航网格上打分，
        /// 正前方 40° 内是去场地 ① 的路，不放。半圆开口朝向出生点。
        /// </summary>
        static void PlaceAltar(Transform player)
        {
            const float radius = 7f;
            var f = player.forward;
            f.y = 0;
            f = f.sqrMagnitude > 1e-4f ? f.normalized : Vector3.forward;
            var eye = player.position + Vector3.up * 1.6f;
            float baseY = Pet.GroundY(player.position + Vector3.up * 2f);
            Vector3 bestCenter = player.position - f * 12f, bestFacing = f;
            float best = float.MaxValue;
            for (int i = 0; i < 16; i++)
            {
                var dir = Quaternion.AngleAxis(i * 22.5f, Vector3.up) * f;
                float off = Vector3.Angle(dir, f);
                if (off < 40f) continue;
                foreach (var dist in new[] { 10f, 13f, 16f })
                {
                    var c = player.position + dir * dist;
                    var facing = -dir;
                    var right = Vector3.Cross(Vector3.up, facing);
                    float cost = dist * 0.05f + (180f - off) * 0.004f;
                    for (int k = 0; k < 8; k++)
                    {
                        float a = Mathf.PI * k / 7f;
                        var p = c - right * Mathf.Cos(a) * radius - facing * Mathf.Sin(a) * radius;
                        float y = Pet.GroundY(p + Vector3.up * 30f);
                        cost += Mathf.Abs(y - baseY);
                        p.y = y + 1f;
                        if (Physics.Linecast(eye, p, Layers.WorldMask, QueryTriggerInteraction.Ignore)) cost += 3f;
                        if (!UnityEngine.AI.NavMesh.SamplePosition(p, out _, 1.5f, UnityEngine.AI.NavMesh.AllAreas)) cost += 1f;
                    }
                    if (cost < best)
                    {
                        best = cost;
                        bestCenter = c;
                        bestFacing = facing;
                    }
                }
            }
            // PetAltar 从本物体位置（左端）开始，沿 -forward 方向向外展开半圆
            var pos = bestCenter - Vector3.Cross(Vector3.up, bestFacing) * radius;
            pos.y = Pet.GroundY(pos + Vector3.up * 30f);
            var go = new GameObject("Pet Altar (test)");
            go.transform.SetPositionAndRotation(pos, Quaternion.LookRotation(bestFacing));
            go.AddComponent<PetAltar>().radius = radius;
        }
    }
}
