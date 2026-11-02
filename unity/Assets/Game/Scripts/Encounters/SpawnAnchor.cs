using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 刷怪站位（关卡里的标记，挂在 <see cref="EncounterSite.anchors"/> 引用的物体上；TS AdventureSpawnAnchor）：
    ///   role：这个站位给哪类角色（Auto = 谁都行）——角色对上 +8 分，对不上 −3 分；
    ///   lane：进场方向的编号（同一波的正面 / 远程 / 辅助走同一条 lane，侧翼走相邻的）；
    ///   elevated：高台站位（俯射层）——只站得上不贴地的敌人（<see cref="EnemyDef.groundOnly"/> 的不来），远程 / 精确 / 炮击优先；
    ///   spread：站位周围再散开的半径（同一站位连刷几只时不叠在一点）；
    ///   mode：这个站位给哪种出场方式（第三章 v2 S1，见 <see cref="SpawnMode"/>；默认现身）。entry / dropFrom / gate / gateDoor 是特殊方式要的辅助点。
    /// 没挂这个组件的旧锚点（只是空物体）按 Auto / lane 0 / 地面 / 现身处理。
    ///
    /// 关卡构建器里建站位（链式）：
    /// <code>
    /// SpawnAnchor.Create(markers, "Enemy_2_Lava", bank, StationRole.Assault, lane: 1).Via(SpawnMode.LavaCrawl).Entry(lavaPoint);
    /// SpawnAnchor.Create(markers, "Enemy_3_Drop", landing, StationRole.Ranged).Via(SpawnMode.Drop).DropFrom(wallTop);
    /// SpawnAnchor.Create(markers, "Enemy_4_Gate", rally, StationRole.Assault).Via(SpawnMode.Gate).Gate(behindDoor, doorPlatform);
    /// SpawnAnchor.Create(markers, "Enemy_4_Sky", perchFoot, StationRole.Precision, elevated: true).Via(SpawnMode.FlyIn).Entry(skyPoint);
    /// SpawnAnchor.Create(markers, "Enemy_2_Post", post, StationRole.Ranged).Via(SpawnMode.Ambush).Facing(towardPlayerApproach);
    /// </code>
    /// </summary>
    public sealed class SpawnAnchor : MonoBehaviour
    {
        public StationRole role;
        public int lane;
        [Tooltip("高台站位（俯射层）：贴地的敌人不站，远程类优先")]
        public bool elevated;
        [Tooltip("站位周围散开的半径（米）：中心点被占或不安全时在这一圈上找")]
        public float spread = 2.2f;

        [Header("出场方式（S1）")]
        [Tooltip("这个站位给哪种出场方式（默认现身）。条目 Via 了某种方式、场地里又有这种站位时只在这些站位里选")]
        public SpawnMode mode;
        [Tooltip("飞临：入场点（排烟口 / 天空 / 王座方向）；熔岩爬出：熔岩里的冒出点（空 = 自动在站位外 3–6 m 找熔岩）")]
        public Transform entry;
        [Tooltip("跃下：起跳的高点（墙头 / 台沿）；站位本身是落点")]
        public Transform dropFrom;
        [Tooltip("增援门：门后导航网格上的出生点（空 = 站位本身）；站位本身是门外的集结点")]
        public Transform gate;
        [Tooltip("增援门：出怪前先触发的门（实现 IActivatable：MovingPlatform / BreakableSpan / SceneActivator…）；空 = 没有门，只有门缝发光")]
        public MonoBehaviour gateDoor;

        /// <summary>读一个锚点物体：有 SpawnAnchor 用它的设置，没有按 Auto / lane 0 / 地面</summary>
        public static (StationRole role, int lane, bool elevated, float spread) Read(Transform t)
        {
            var a = t ? t.GetComponent<SpawnAnchor>() : null;
            return a ? (a.role, a.lane, a.elevated, Mathf.Max(0, a.spread)) : (StationRole.Auto, 0, false, 2.2f);
        }

        /// <summary>锚点物体的出场方式（没挂组件 = 现身）</summary>
        public static SpawnMode ModeOf(Transform t)
        {
            var a = t ? t.GetComponent<SpawnAnchor>() : null;
            return a ? a.mode : SpawnMode.Appear;
        }

        // ───────────── 构建器用的链式 API ─────────────

        /// <summary>在 parent 下建一个站位（世界坐标 at，朝向 = 世界 +Z，用 <see cref="Facing"/> 改）</summary>
        public static SpawnAnchor Create(Transform parent, string name, Vector3 at, StationRole role = StationRole.Auto, int lane = 0,
            bool elevated = false, float spread = 2.2f)
        {
            var go = new GameObject(name);
            if (parent) go.transform.SetParent(parent, false);
            go.transform.position = at;
            var a = go.AddComponent<SpawnAnchor>();
            a.role = role;
            a.lane = lane;
            a.elevated = elevated;
            a.spread = spread;
            return a;
        }

        /// <summary>改出场方式（链式）</summary>
        public SpawnAnchor Via(SpawnMode m)
        {
            mode = m;
            return this;
        }

        /// <summary>改朝向：水平看向 dir（埋伏单位的站岗朝向、跃下的落地朝向）</summary>
        public SpawnAnchor Facing(Vector3 dir)
        {
            dir.y = 0;
            if (dir.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(dir.normalized);
            return this;
        }

        /// <summary>改朝向：水平看向世界点 target</summary>
        public SpawnAnchor LookAt(Vector3 target) => Facing(target - transform.position);

        /// <summary>飞临的入场点 / 熔岩爬出的冒出点（世界坐标；建一个子物体 Entry）</summary>
        public SpawnAnchor Entry(Vector3 at)
        {
            entry = Child("Entry", at);
            return this;
        }

        /// <summary>跃下的起跳高点（世界坐标；建一个子物体 DropFrom）</summary>
        public SpawnAnchor DropFrom(Vector3 at)
        {
            dropFrom = Child("DropFrom", at);
            return this;
        }

        /// <summary>增援门：门后的出生点（世界坐标；建一个子物体 Gate）+ 可选的门（IActivatable）</summary>
        public SpawnAnchor Gate(Vector3 behindDoor, MonoBehaviour door = null)
        {
            gate = Child("Gate", behindDoor);
            if (door && door is not IActivatable) Debug.LogWarning($"[SpawnAnchor] {name} 的门 {door.name} 没有实现 IActivatable，开不了");
            gateDoor = door;
            return this;
        }

        Transform Child(string childName, Vector3 at)
        {
            var old = transform.Find(childName);
            var t = old ? old : new GameObject(childName).transform;
            t.SetParent(transform, false);
            t.position = at;
            return t;
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
            if (mode == SpawnMode.Appear) return;
            Gizmos.color = new Color(0.3f, 0.95f, 0.9f, 0.8f);
            Gizmos.DrawLine(p + Vector3.up * 0.5f, p + Vector3.up * 0.5f + transform.forward * 1.5f);
            foreach (var aux in new[] { entry, dropFrom, gate })
                if (aux)
                    Gizmos.DrawLine(p + Vector3.up * 0.5f, aux.position + Vector3.up * 0.5f);
        }
    }
}
