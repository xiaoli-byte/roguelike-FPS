using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 追魂连弩的弓弦与弩箭（同 TS WeaponModels.buildCrossbow 的 string_l / string_r / bolt + setCrossbowString，Viewmodel.animateParts）：
    /// 美术枪模按约定不画弦和箭（registry 的 brief），这里用程序网格补上。
    ///   上弦程度 cock（同 TS ViewmodelState.cock）：显示的不是手上那把 = 1；换弹中 = (进度 − 0.6) / 0.3；弹匣空 = 0；否则 = 1 − 冷却 / 射击间隔。
    ///   弓弦：两半各从弓梢 (±0.188, 0.05, −0.292) 连到弦扣，弦扣 z 从弓梢（松弦，贴着弓臂）平滑拉到 −0.1（上弦，扣在扳机处），t = smooth(cock)。
    ///   弩箭：上满弦（cock ≥ 0.98）才露出——开枪瞬间箭飞出、弦松开，冷却里重新上弦，拉满后下一支箭落槽。箭头按实例元素发光，箭羽是稀有度色。
    /// 射击间隔取「最近一次冷却跳升的值」（开火时状态机把冷却设成 1 / 实际射速），不用自己重算射速（疾化、狂热等加成自动算进去）。
    /// </summary>
    public sealed class CrossbowString : WeaponRigPart
    {
        /// <summary>弓梢（右侧；左侧 x 取反）与上弦时弦扣的 z（TS stringTip / setCrossbowString）</summary>
        public static readonly Vector3 Tip = new(0.188f, 0.05f, -0.292f);
        public const float NockDrawnZ = -0.1f;
        /// <summary>弦粗（TS 弦截面 0.004）</summary>
        public const float Thickness = 0.004f;
        /// <summary>上弦到这个程度弩箭才落槽（TS cock ≥ 0.98）</summary>
        public const float BoltShowAt = 0.98f;
        /// <summary>弩箭组位置（TS bolt 组 (0, 0.074, −0.24)）</summary>
        public static readonly Vector3 BoltPos = new(0, 0.074f, -0.24f);

        static readonly Color StringColor = Hex.Rgb(0xe8e0d0);
        static readonly Color ShaftColor = Hex.Rgb(0x2a2622);

        Transform left, right, bolt;
        Renderer head, fletch;
        float interval = 0.5f, lastCooldown;
        bool wasLive;
        int tintedUid = -1, tintedVersion = -1;

        /// <summary>当前上弦程度（0..1，测试 / 调试读）</summary>
        public float CockNow { get; private set; } = 1;
        /// <summary>弩箭此刻是否露出</summary>
        public bool BoltShown => bolt && bolt.gameObject.activeSelf;

        protected override void Build()
        {
            var parent = gun;
            left = Piece(parent, "string_l", ProjectileMeshes.Box, Lit, StringColor, Vector3.zero, Vector3.one * Thickness).transform;
            right = Piece(parent, "string_r", ProjectileMeshes.Box, Lit, StringColor, Vector3.zero, Vector3.one * Thickness).transform;
            bolt = Group(parent, "bolt", BoltPos);
            Piece(bolt, "shaft", ProjectileMeshes.Box, Lit, ShaftColor, Vector3.zero, new Vector3(0.008f, 0.008f, 0.26f));
            head = Piece(bolt, "head", ProjectileMeshes.Box, FxMaterials.Unlit, Color.white, new Vector3(0, 0, -0.14f), new Vector3(0.014f, 0.014f, 0.03f));
            fletch = Piece(bolt, "fletch", ProjectileMeshes.Box, FxMaterials.Unlit, Color.white, new Vector3(0, 0, 0.115f), new Vector3(0.022f, 0.003f, 0.03f));
            Pose(1);
        }

        /// <summary>
        /// 上弦程度（同 TS Viewmodel 的 cock）。shown = 手上用的就是这把；interval = 本次射击间隔（开火时冷却的初值）
        /// </summary>
        public static float Cock(bool shown, bool reloading, float reloadProgress, bool hasAmmo, float cooldown, float interval)
        {
            if (!shown) return 1;
            if (reloading) return Mathf.Clamp01((reloadProgress - 0.6f) / 0.3f);
            if (!hasAmmo) return 0;
            return interval <= 1e-4f ? 1 : Mathf.Clamp01(1 - cooldown / interval);
        }

        /// <summary>弦扣的 z：t = 0 贴着弓梢（松弦），t = 1 拉到扳机处</summary>
        public static float NockZ(float t) => Mathf.Lerp(Tip.z, NockDrawnZ, Mathf.Clamp01(t));

        /// <summary>半根弦（side = +1 右 / −1 左）：中点、朝向（+Z 沿弦从弦扣指向弓梢）与长度</summary>
        public static void Half(float side, float t, out Vector3 center, out Quaternion rotation, out float length)
        {
            var tip = new Vector3(Mathf.Sign(side) * Tip.x, Tip.y, Tip.z);
            var nock = new Vector3(0, Tip.y, NockZ(t));
            var d = tip - nock;
            length = d.magnitude;
            center = (tip + nock) * 0.5f;
            rotation = length > 1e-5f ? Quaternion.LookRotation(d / length, Vector3.up) : Quaternion.identity;
        }

        public static bool BoltVisible(float cock) => cock >= BoltShowAt;

        void OnDisable() => wasLive = false;

        void LateUpdate()
        {
            if (!wc || !left) return;
            var sm = wc.Machine;
            bool live = Live;
            float cd = live ? sm.Cooldown : 0;
            if (live)
            {
                // 冷却跳升 = 刚开过一枪：记下这次的间隔。切回来时带着的剩余冷却（readyAt）只会比间隔短，保留之前记下的间隔
                if (cd > lastCooldown + 1e-4f) interval = wasLive ? cd : Mathf.Max(interval, cd);
                lastCooldown = cd;
            }
            wasLive = live;
            CockNow = Cock(live, live && sm.Reloading, sm.ReloadProgress, sm.HasAmmo, cd, interval);
            Pose(CockNow);
            Tint(Shown);
        }

        void Pose(float cock)
        {
            float t = Smooth(cock);
            Place(right, +1, t);
            Place(left, -1, t);
            bool show = BoltVisible(cock);
            if (bolt && bolt.gameObject.activeSelf != show) bolt.gameObject.SetActive(show);
        }

        static void Place(Transform half, float side, float t)
        {
            if (!half) return;
            Half(side, t, out var center, out var rot, out float len);
            half.localPosition = center;
            half.localRotation = rot;
            half.localScale = new Vector3(Thickness, Thickness, Mathf.Max(1e-4f, len));
        }

        /// <summary>箭头 = 元素色（无元素暖白）HDR 发光，箭羽 = 稀有度色；只在换了枪 / 枪变了（版本号）时重设</summary>
        void Tint(WeaponInstance w)
        {
            if (w == null || (w.uid == tintedUid && w.Version == tintedVersion)) return;
            tintedUid = w.uid;
            tintedVersion = w.Version;
            var e = WeaponTint.ElementColor(w.element) * (1.2f + 0.5f * RarityGlow(w.rarity));
            e.a = 1;
            FxMaterials.Tint(head, e);
            FxMaterials.Tint(fletch, Rarity.Color(w.rarity));
        }
    }
}
