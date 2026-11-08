using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 怪物入场点（docs/level-design/run-variety.md §3.1；用户 2026-11-08：「要考虑哪些地方能够安排怪物，哪些作为据点刷多轮怪物，哪些地方作为怪物入场点」）。
    /// 一张开放图上的怪分三类地方摆，关卡构建器各自摆好：
    ///   · 驻守点：路遇小队（<see cref="EncounterSite.AsRoadside"/> + 条目 Via(Ambush) + 埋伏站位）——开局就站在场上、玩家先看见，走近 / 开枪整组苏醒；
    ///   · 据点：必清的 <see cref="EncounterSite"/>，多波，波次从场地自己的出生站位（<see cref="SpawnAnchor"/>，现身 / 跃下 / 增援门 / 熔岩爬出…）进场；
    ///   · 入场点（本组件）：据点之外持续涌来的游荡怪群（<see cref="CombatDirector"/>）只从这些地方进场——沙丘背后、峡口、门洞、崖顶、熔岩边，
    ///     要合乎情理（怪从哪来看得懂），不在玩家眼皮底下凭空冒出来。
    /// 位置 = 落地点（导航网格上），朝向 = 进场后往哪走（一般朝游玩区）。<see cref="mode"/> 决定声光预告：现身（地面法阵）、跃下（从 <see cref="from"/> 跳下来落地一震）、
    /// 增援门（门缝发光）、熔岩爬出（熔岩鼓泡）、余烬起身（炭堆）、飞临（只给飞行敌人用：入场点一声叫）。
    /// </summary>
    public sealed class MonsterEntry : MonoBehaviour
    {
        [Tooltip("进场方式（决定预告：现身 / 跃下 / 增援门 / 熔岩爬出 / 余烬起身 / 飞临）")]
        public SpawnMode mode = SpawnMode.Appear;
        [Tooltip("一群在落地点周围散开的半径（米）")]
        public float spread = 4f;
        [Tooltip("名字（报告 / 调试用：「北沙丘背后」）")]
        public string label = "";
        [Tooltip("跃下：起跳点（墙头 / 崖顶）；增援门：门后；空 = 落地点")]
        public Transform from;
        [Tooltip("只放飞行敌人（飞临入场点）")]
        public bool flyersOnly;

        static readonly List<MonsterEntry> all = new();

        /// <summary>场上启用中的入场点</summary>
        public static IReadOnlyList<MonsterEntry> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        /// <summary>进场后往哪走（水平）</summary>
        public Vector3 Facing
        {
            get
            {
                var f = transform.forward;
                f.y = 0;
                return f.sqrMagnitude > 1e-4f ? f.normalized : Vector3.forward;
            }
        }

        void OnDrawGizmos()
        {
            var p = transform.position;
            Gizmos.color = new Color(1f, 0.3f, 0.25f, 0.9f);
            Gizmos.DrawWireSphere(p + Vector3.up * 0.2f, Mathf.Max(0.5f, spread));
            Gizmos.DrawLine(p + Vector3.up, p + Vector3.up + Facing * 4f);
            if (from) Gizmos.DrawLine(from.position, p);
        }
    }
}
