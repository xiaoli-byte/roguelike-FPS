using System.Collections.Generic;
using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 穴顶日光裂缝（1-4 干涸月牙泉，docs/level-design/maps/1-4.md「穴顶与光柱」）：关卡构建器把它放在穴顶开口的中心（物体高度 = 穴顶高度），
    /// 本地 XZ 上 <see cref="halfSize"/> 的矩形就是穴顶面片留出的洞。场景的主方向光（太阳）只从这个洞照进来——真实阴影由穴顶面片（双面投影）和
    /// 两侧悬垂的裂缝岩体（SM_Env_DesertCaveCeilingRift，带碰撞）投下。
    /// 它做两件事：
    ///   · 判定（<see cref="SkyOpen"/>）：从某点沿日光来向打出的射线在穴顶高度落进某个开口 = 能看到天（穴顶面片本身没有碰撞，所以开口要在这里声明；
    ///     开口下面的岩岛、月牙阁、悬垂岩体照常由物理射线判）。场景里没有任何开口标记时按露天处理（测试场、地表关卡）。旱魃的 <see cref="SunExposure"/> 用它。
    ///   · 光柱外观：沿开口长轴排几束斜光片（FxMaterials.BeamSprite），从开口斜落到地面，跟着太阳方向走（BS2 移动日光柱时光片自己跟上），再飘一点金色浮尘。
    /// 不立碰撞、不挡路；只是标记 + 特效。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SunShaft : MonoBehaviour
    {
        [Tooltip("开口的本地半宽（X = 裂缝长轴，Z = 缝宽），米")] public Vector2 halfSize = new(20f, 4.5f);
        [Tooltip("光片外观：沿长轴几束")] public int beamCount = 6;
        [Tooltip("光片颜色（加色，alpha = 浓度）")] public Color beamColor = new(1f, 0.88f, 0.62f, 0.14f);
        [Tooltip("光片宽度占缝宽的比例")] public float beamWidthScale = 0.85f;
        [Tooltip("飘尘：每秒几团")] public float motesPerSecond = 3f;

        /// <summary>穴顶以下多远内算「在穴里」（射线最长距离的兜底，米）</summary>
        public const float MaxRay = 400f;

        static readonly List<SunShaft> all = new();
        static Light cachedSun;
        static int sunFrame = -1;

        /// <summary>场景里启用中的开口</summary>
        public static IReadOnlyList<SunShaft> All => all;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            all.Clear();
            cachedSun = null;
            sunFrame = -1;
        }

        readonly List<(Transform pivot, float along)> beams = new();
        Vector3 lastSun;
        float refreshTimer, moteAcc;

        /// <summary>穴顶高度（世界 y）= 物体高度</summary>
        public float CeilingY => transform.position.y;

        void OnEnable()
        {
            if (!all.Contains(this)) all.Add(this);
        }

        void OnDisable() => all.Remove(this);

        void Start() => BuildBeams();

        // ───────────── 太阳 ─────────────

        /// <summary>场景的主方向光：RenderSettings.sun，没有就取最亮的方向光（每帧缓存一次）</summary>
        public static Light Sun
        {
            get
            {
                if (sunFrame == Time.frameCount && cachedSun) return cachedSun;
                sunFrame = Time.frameCount;
                var s = RenderSettings.sun;
                if (!s || !s.isActiveAndEnabled || s.type != LightType.Directional)
                {
                    s = null;
                    foreach (var l in FindObjectsByType<Light>(FindObjectsSortMode.None))
                        if (l && l.isActiveAndEnabled && l.type == LightType.Directional && (!s || l.intensity > s.intensity))
                            s = l;
                }
                return cachedSun = s;
            }
        }

        /// <summary>指向太阳的单位向量（主方向光的反方向）；场景里没有方向光时取一个斜上方的默认值</summary>
        public static Vector3 ToSun
        {
            get
            {
                var s = Sun;
                var d = s ? -s.transform.forward : new Vector3(-0.12f, 0.88f, -0.45f);
                return d.sqrMagnitude > 1e-6f ? d.normalized : Vector3.up;
            }
        }

        // ───────────── 判定 ─────────────

        /// <summary>穴顶高度的点 q 在这个开口里（本地 XZ 矩形）</summary>
        public bool Contains(Vector3 q)
        {
            var l = transform.InverseTransformPoint(new Vector3(q.x, CeilingY, q.z));
            return Mathf.Abs(l.x) <= halfSize.x && Mathf.Abs(l.z) <= halfSize.y;
        }

        /// <summary>
        /// 从 p 沿 toSun 方向看不看得到天：没有开口标记 = 露天（只看物理遮挡由调用方做）；有开口时射线在穴顶高度必须落进某个开口。
        /// distance = 射线要查物理遮挡的长度（到穴顶为止；露天时 <see cref="MaxRay"/>）。太阳在地平线下返回 false
        /// </summary>
        public static bool SkyOpen(Vector3 p, Vector3 toSun, out float distance)
        {
            distance = MaxRay;
            if (toSun.y <= 0.02f) return false;
            if (all.Count == 0) return true;
            bool any = false;
            foreach (var s in all)
            {
                if (!s) continue;
                float dy = s.CeilingY - p.y;
                // 点在这片穴顶之上（穴外的地表）：这片穴顶管不着它
                if (dy <= 0) continue;
                any = true;
                float t = dy / toSun.y;
                if (!s.Contains(p + toSun * t)) continue;
                distance = t;
                return true;
            }
            // 所有穴顶都在脚下（人在穴外）= 露天；否则被穴顶挡住
            return !any;
        }

        // ───────────── 光柱外观 ─────────────

        void BuildBeams()
        {
            beams.Clear();
            int n = Mathf.Max(0, beamCount);
            float width = Mathf.Max(0.5f, halfSize.y * 2f * beamWidthScale);
            for (int i = 0; i < n; i++)
            {
                float along = n == 1 ? 0 : Mathf.Lerp(-halfSize.x * 0.85f, halfSize.x * 0.85f, i / (float)(n - 1));
                var pivot = new GameObject($"Sun Beam {i + 1}").transform;
                pivot.SetParent(transform, false);
                FxMaterials.BeamSprite(pivot, width, 1f, beamColor);
                beams.Add((pivot, along));
            }
            lastSun = Vector3.zero;
            Refresh();
        }

        /// <summary>每束光片：从开口上的点沿日光方向往下打到地面，光片底部落在地面、顶部在开口，长度按命中距离拉伸</summary>
        void Refresh()
        {
            var toSun = ToSun;
            lastSun = toSun;
            if (toSun.y <= 0.02f)
            {
                foreach (var (pivot, _) in beams)
                    if (pivot)
                        pivot.gameObject.SetActive(false);
                return;
            }
            foreach (var (pivot, along) in beams)
            {
                if (!pivot) continue;
                var top = transform.TransformPoint(new Vector3(along, 0, 0));
                float len = Physics.Raycast(top - toSun * 0.5f, -toSun, out var hit, 120f, Layers.WorldMask, QueryTriggerInteraction.Ignore) ? hit.distance + 0.5f : 60f;
                var foot = top - toSun * len;
                pivot.gameObject.SetActive(true);
                pivot.SetPositionAndRotation(foot, Quaternion.FromToRotation(Vector3.up, toSun));
                // 十字光片的一片宽面对齐开口长轴：绕光柱轴转过去
                var wantRight = Vector3.ProjectOnPlane(transform.right, toSun);
                if (wantRight.sqrMagnitude > 1e-4f)
                {
                    float a = Vector3.SignedAngle(pivot.right, wantRight.normalized, toSun);
                    pivot.rotation = Quaternion.AngleAxis(a, toSun) * pivot.rotation;
                }
                pivot.localScale = new Vector3(1f, len, 1f);
            }
        }

        void Update()
        {
            refreshTimer -= Time.deltaTime;
            if (refreshTimer <= 0)
            {
                refreshTimer = 0.25f;
                if (Vector3.Angle(lastSun, ToSun) > 0.2f) Refresh();
            }
            if (motesPerSecond <= 0 || beams.Count == 0) return;
            moteAcc += Time.deltaTime * motesPerSecond;
            while (moteAcc >= 1f)
            {
                moteAcc -= 1f;
                var (pivot, _) = beams[Random.Range(0, beams.Count)];
                if (!pivot || !pivot.gameObject.activeSelf) continue;
                var p = pivot.position + pivot.up * pivot.localScale.y * Random.Range(0.05f, 0.6f) + pivot.right * Random.Range(-1.5f, 1.5f);
                Fx.Burst(p, new Color(1f, 0.86f, 0.55f), 2, 0.25f, 2.6f, 0.05f, -0.05f);
            }
        }

        void OnDrawGizmos()
        {
            Gizmos.color = new Color(1f, 0.85f, 0.4f, 0.9f);
            Gizmos.matrix = transform.localToWorldMatrix;
            Gizmos.DrawWireCube(Vector3.zero, new Vector3(halfSize.x * 2, 0.05f, halfSize.y * 2));
            Gizmos.matrix = Matrix4x4.identity;
            var d = ToSun;
            if (d.y > 0.02f) Gizmos.DrawLine(transform.position, transform.position - d * (CeilingY + 10f) / d.y);
        }
    }
}
