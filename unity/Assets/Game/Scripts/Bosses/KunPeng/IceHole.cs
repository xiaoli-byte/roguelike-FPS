using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Spiritfire.Game
{
    /// <summary>
    /// 冰窟的几何（鲲鹏用；Three.js KunPengArena 的 IceHole）：圆心（y = 环台地面）、冰窟半径、环台外缘半径、水面高度。
    /// 角度一律世界 yaw（度，0 = +Z，同 Three.js 的 facing = atan2(dx, dz)）。
    /// 来源：场景里的 <see cref="IceHole"/> 标记（2-4 北冥冰台，found = true）；没有标记时按首领场地退回「虚拟冰窟」（场地中心、半径 6 m，found = false），
    /// 首领照常出招，只是冰窟没有地形洞（同 Three.js 找不到冰窟时的退路）。
    /// </summary>
    public readonly struct IceHoleInfo
    {
        /// <summary>虚拟冰窟的半径（米，同 Three.js FALLBACK_RADIUS）</summary>
        public const float FallbackRadius = 6f;

        public readonly Vector3 center;
        public readonly float radius, outer, waterY;
        public readonly bool found;

        public IceHoleInfo(Vector3 center, float radius, float outer, float waterY, bool found)
        {
            this.center = center;
            this.radius = Mathf.Max(0.5f, radius);
            this.outer = Mathf.Max(this.radius + 2f, outer);
            this.waterY = waterY;
            this.found = found;
        }

        /// <summary>环台地面高度（= 圆心的 y）</summary>
        public float FloorY => center.y;

        /// <summary>环台中线半径（冰窟边与外缘的正中，鹏绕着它盘旋、落台）</summary>
        public float MidRing => (radius + outer) * 0.5f;

        /// <summary>从圆心朝 yaw（度）方向、离圆心 dist 米的点（y = 环台地面；Three.js holePoint）</summary>
        public Vector3 Point(float yawDeg, float dist)
        {
            float a = yawDeg * Mathf.Deg2Rad;
            return new Vector3(center.x + Mathf.Sin(a) * dist, center.y, center.z + Mathf.Cos(a) * dist);
        }

        /// <summary>点相对圆心的方位（yaw，度；Three.js holeAngle）。在圆心上时为 0</summary>
        public float Angle(Vector3 p)
        {
            float dx = p.x - center.x, dz = p.z - center.z;
            return dx * dx + dz * dz < 1e-8f ? 0 : Mathf.Atan2(dx, dz) * Mathf.Rad2Deg;
        }

        /// <summary>点离圆心的水平距离</summary>
        public float Distance(Vector3 p)
        {
            float dx = p.x - center.x, dz = p.z - center.z;
            return Mathf.Sqrt(dx * dx + dz * dz);
        }

        /// <summary>把点夹到环台上：离冰窟边 inner 米以外、离外缘 outerMargin 米以内（Three.js clampToRing：1 / 1.5），高度不变</summary>
        public Vector3 ClampToRing(Vector3 p, float inner = 1f, float outerMargin = 1.5f)
        {
            float dx = p.x - center.x, dz = p.z - center.z;
            float d = Mathf.Sqrt(dx * dx + dz * dz);
            if (d < 1e-4f)
            {
                dx = 0;
                dz = 1;
                d = 1;
            }
            float lo = radius + inner, hi = Mathf.Max(lo, outer - outerMargin);
            float r = Mathf.Clamp(d, lo, hi);
            return new Vector3(center.x + dx / d * r, p.y, center.z + dz / d * r);
        }

        /// <summary>水平方向在冰窟里（离圆心不到 radius + pad）</summary>
        public bool OverHole(Vector3 p, float pad = 0) => Distance(p) < radius + pad;

        /// <summary>
        /// 没有冰窟标记时的虚拟冰窟（Three.js locateIceHole 的 fallback）：圆心 = 场地中心（没有场地时 near），半径 6 m，
        /// 外缘 = 场地尺度 − 3（至少 14 m），水面 = 地面 + <see cref="IceHole.DefaultWaterLevel"/>
        /// </summary>
        public static IceHoleInfo Fallback(BossArena arena, Vector3 near)
        {
            var c = arena ? arena.Center : near;
            float outer = arena ? Mathf.Max(FallbackRadius + 8f, arena.Extent - 3f) : 30f;
            return new IceHoleInfo(c, FallbackRadius, outer, c.y + IceHole.DefaultWaterLevel, false);
        }

        public override string ToString() => $"冰窟 {(found ? "" : "（虚拟）")}圆心 ({center.x:F1}, {center.y:F1}, {center.z:F1})，半径 {radius:F1}，外缘 {outer:F1}，水面 y {waterY:F2}";
    }

    /// <summary>
    /// 北冥冰窟标记（2-4 北冥冰台，docs/level-design/maps/2-4.md 第 2 节）：关卡构建器把它放在中央冰窟的圆心（物体高度 = 环台地面），
    /// 声明冰窟半径、环台外缘半径、水面高度（相对环台地面）。鲲鹏按它找冰窟（Three.js 是从导航网格反推的，这里改成显式标记），
    /// 首领战之外它只做外观：
    ///   · 水面遮罩（水面遮罩切口）：水面下 <see cref="maskDepth"/> 米一张不透明的深海圆盘（不投影、没有碰撞）。冰窟里水面以下的东西——
    ///     鲲的平切口、地形洞的洞壁——都被它挡住。鲲的模型只做了露出水面的前半身（模型原点 = 平切口），BS3 让切口始终压在水面下 0.3 m；
    ///   · 水面：构建器放的 L8 <see cref="WaterVolume"/>（<see cref="water"/>；深水按坠落处理：扣血、托回安全落脚点）。
    ///     没有水体时（测试场的虚拟冰窟）自己补一张水面片。
    /// 冰窟边缘段（SM_Tripo_FrostIceHoleRim 一圈）挂在 <see cref="rimRoot"/> 下：首领的「掩体挡气流 / 挡风」判定不把它们算作掩体
    /// （气流和狂风是从冰窟里、越过冰沿吹出来的）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class IceHole : MonoBehaviour
    {
        /// <summary>水面相对环台地面的默认高度（同 Three.js KunPengFx 的海面 +0.06）</summary>
        public const float DefaultWaterLevel = 0.06f;

        [Tooltip("冰窟半径（米，水面 / 地形洞的平均半径）")] public float radius = 15f;
        [Tooltip("环台外缘半径（米）")] public float outer = 44f;
        [Tooltip("水面相对环台地面的高度（米）")] public float waterLevel = DefaultWaterLevel;
        [Tooltip("水面遮罩在水面下多深（米）：要高过鲲的平切口（切口压在水面下 0.3 m）")] public float maskDepth = 0.15f;
        [Tooltip("水面遮罩的颜色（深海）")] public Color maskColor = new(0.02f, 0.05f, 0.1f, 1f);
        [Tooltip("冰窟里的水体（L8）；空 = 运行时补一张水面片")] public WaterVolume water;
        [Tooltip("冰窟边缘段的父节点（首领的掩体判定忽略它们）")] public Transform rimRoot;
        [Tooltip("虚拟冰窟（首领找不到冰窟标记时临时建的）")] public bool isVirtual;

        static readonly List<IceHole> all = new();

        /// <summary>场景里启用中的冰窟标记</summary>
        public static IReadOnlyList<IceHole> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => all.Clear();

        /// <summary>水面遮罩圆盘 / 水面（自己补的水面片，或水体的渲染器）——鲲鹏的特效按它翻涌水面</summary>
        public MeshRenderer Mask { get; private set; }
        public Renderer WaterSurface { get; private set; }

        public Vector3 Center => transform.position;
        public float WaterY => transform.position.y + waterLevel;

        public IceHoleInfo Info => new(transform.position, radius, outer, WaterY, !isVirtual);

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        void Start() => BuildVisuals();

        /// <summary>离 near 最近的冰窟标记（没有 near 时取第一个；没有返回 null）</summary>
        public static IceHole Find(Vector3? near = null)
        {
            IceHole best = null;
            float bestD = float.PositiveInfinity;
            foreach (var h in all)
            {
                if (!h || !h.isActiveAndEnabled) continue;
                float d = near.HasValue ? (h.Center - near.Value).sqrMagnitude : 0;
                if (d >= bestD) continue;
                best = h;
                bestD = d;
            }
            return best;
        }

        /// <summary>
        /// 首领用的冰窟：场地中心附近的标记（离场地中心不超过场地尺度）→ 它的几何；没有就按场地退回虚拟冰窟（<see cref="IceHoleInfo.Fallback"/>）
        /// </summary>
        public static IceHoleInfo Resolve(BossArena arena, Vector3 near, out IceHole marker)
        {
            var at = arena ? arena.Center : near;
            marker = Find(at);
            if (marker && arena)
            {
                var d = marker.Center - arena.Center;
                d.y = 0;
                if (d.magnitude > arena.Extent) marker = null;
            }
            return marker ? marker.Info : IceHoleInfo.Fallback(arena, near);
        }

        /// <summary>虚拟冰窟的外观（测试场 / 没有冰窟的场地）：在 info 处临时建一个标记（水面片 + 遮罩），首领倒下后由首领回收</summary>
        public static IceHole CreateVirtual(in IceHoleInfo info, Transform parent = null)
        {
            var go = new GameObject("IceHole (virtual)");
            go.SetActive(false);
            go.transform.SetParent(parent, false);
            go.transform.position = info.center;
            var h = go.AddComponent<IceHole>();
            h.radius = info.radius;
            h.outer = info.outer;
            h.waterLevel = info.waterY - info.center.y;
            h.isVirtual = true;
            go.SetActive(true);
            return h;
        }

        /// <summary>遮罩圆盘 + （没有水体时）水面片；只建一次</summary>
        public void BuildVisuals()
        {
            if (Mask) return;
            var disc = WorldMaterials.Disc();
            var go = new GameObject("Water Mask", typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(transform, false);
            go.transform.localPosition = new Vector3(0, waterLevel - Mathf.Max(0.02f, maskDepth), 0);
            go.transform.localScale = new Vector3(radius + 0.6f, 1, radius + 0.6f);
            go.GetComponent<MeshFilter>().sharedMesh = disc;
            Mask = go.GetComponent<MeshRenderer>();
            Mask.sharedMaterial = FxMaterials.Unlit;
            FxMaterials.Tint(Mask, maskColor);
            Mask.shadowCastingMode = ShadowCastingMode.Off;
            Mask.receiveShadows = false;

            if (water)
            {
                WaterSurface = water.GetComponentInChildren<Renderer>();
                return;
            }
            var surface = WorldMaterials.Surface(transform, WorldMaterialKind.Water, true, "Water Surface");
            surface.transform.localPosition = new Vector3(0, waterLevel, 0);
            surface.transform.localScale = new Vector3(radius, 1, radius);
            WaterSurface = surface;
        }

        /// <summary>这个碰撞体是不是冰窟边缘段（首领的掩体判定忽略它）</summary>
        public bool IsRim(Collider c) => c && rimRoot && c.transform.IsChildOf(rimRoot);

#if UNITY_EDITOR
        void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(0.4f, 0.85f, 1f, 0.8f);
            DrawCircle(transform.position + Vector3.up * waterLevel, radius);
            Gizmos.color = new Color(0.9f, 0.95f, 1f, 0.5f);
            DrawCircle(transform.position, outer);
        }

        static void DrawCircle(Vector3 c, float r)
        {
            var prev = c + new Vector3(0, 0, r);
            for (int i = 1; i <= 48; i++)
            {
                float a = i / 48f * Mathf.PI * 2;
                var p = c + new Vector3(Mathf.Sin(a) * r, 0, Mathf.Cos(a) * r);
                Gizmos.DrawLine(prev, p);
                prev = p;
            }
        }
#endif
    }
}
