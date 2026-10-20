using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 刷怪站位（关卡里的标记，挂在 <see cref="EncounterSite.anchors"/> 引用的物体上；TS AdventureSpawnAnchor）：
    ///   role：这个站位给哪类角色（Auto = 谁都行）——角色对上 +8 分，对不上 −3 分；
    ///   lane：进场方向的编号（同一波的正面 / 远程 / 辅助走同一条 lane，侧翼走相邻的）；
    ///   elevated：高台站位（俯射层）——只站得上不贴地的敌人（<see cref="EnemyDef.groundOnly"/> 的不来），远程 / 精确 / 炮击优先；
    ///   spread：站位周围再散开的半径（同一站位连刷几只时不叠在一点）。
    /// 没挂这个组件的旧锚点（只是空物体）按 Auto / lane 0 / 地面处理。
    /// </summary>
    public sealed class SpawnAnchor : MonoBehaviour
    {
        public StationRole role;
        public int lane;
        [Tooltip("高台站位（俯射层）：贴地的敌人不站，远程类优先")]
        public bool elevated;
        [Tooltip("站位周围散开的半径（米）：中心点被占或不安全时在这一圈上找")]
        public float spread = 2.2f;

        /// <summary>读一个锚点物体：有 SpawnAnchor 用它的设置，没有按 Auto / lane 0 / 地面</summary>
        public static (StationRole role, int lane, bool elevated, float spread) Read(Transform t)
        {
            var a = t ? t.GetComponent<SpawnAnchor>() : null;
            return a ? (a.role, a.lane, a.elevated, Mathf.Max(0, a.spread)) : (StationRole.Auto, 0, false, 2.2f);
        }

        void OnDrawGizmos()
        {
            Gizmos.color = SpawnStations.RoleColor(role);
            var p = transform.position;
            Gizmos.DrawWireSphere(p + Vector3.up * 0.5f, 0.5f);
            Gizmos.DrawLine(p, p + Vector3.up * (elevated ? 3f : 1.5f));
            if (spread > 0)
            {
                Gizmos.color *= new Color(1, 1, 1, 0.4f);
                Gizmos.DrawWireSphere(p, spread);
            }
        }
    }
}
