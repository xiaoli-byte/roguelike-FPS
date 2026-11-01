using UnityEngine;

namespace Spiritfire.Game
{
    /// <summary>
    /// 山头的残破雷鼓（SM_Prop_KuiBrokenDrum，夔没现身时倒在山头）：登场从鼓里长出来，死时倒回鼓里。
    /// 摆位归 M1（4-1 地图）：夔的 BossArena 下名为 <see cref="AnchorName"/> 的物体，模型（放倒的残鼓 Prefab）就是它或它的子物体；
    /// 这里只管显隐、被雷劈中的裂光、震动。场景里没摆时（测试场）在首领出生点立一个程序化的放倒的鼓（圆柱 + 鼓皮）。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class KuiDrum : MonoBehaviour
    {
        public const string AnchorName = "KuiDrum";

        Renderer[] renderers;
        float shakeLeft, shakeAmp;
        Vector3 rest;

        /// <summary>鼓心（裂口）的世界位置</summary>
        public Vector3 Center => transform.position + Vector3.up * 0.9f;
        public bool Visible { get; private set; } = true;
        /// <summary>被雷劈过几次（测试用）</summary>
        public int Struck { get; private set; }
        /// <summary>程序化的占位鼓（场景里没摆残鼓）</summary>
        public bool Placeholder { get; private set; }

        /// <summary>找夔的场地里摆好的残鼓；没有就在 fallback 立一个占位鼓</summary>
        public static KuiDrum Ensure(BossArena arena, Vector3 fallback, Quaternion facing)
        {
            Transform t = null;
            if (arena)
                foreach (var c in arena.GetComponentsInChildren<Transform>(true))
                    if (c != arena.transform && c.name.StartsWith(AnchorName, System.StringComparison.OrdinalIgnoreCase))
                    {
                        t = c;
                        break;
                    }
            if (!t)
                foreach (var d in FindObjectsByType<KuiDrum>(FindObjectsInactive.Exclude))
                    if (d && (Flat(d.transform.position - fallback) < 12f))
                        return d;
            if (t)
            {
                var d = t.GetComponent<KuiDrum>();
                return d ? d : t.gameObject.AddComponent<KuiDrum>();
            }
            var go = new GameObject($"{AnchorName} (placeholder)");
            if (arena) go.transform.SetParent(arena.transform.parent, true);
            go.transform.SetPositionAndRotation(fallback, facing);
            var drum = go.AddComponent<KuiDrum>();
            drum.Placeholder = true;
            drum.BuildPlaceholder();
            return drum;
        }

        static float Flat(Vector3 v)
        {
            v.y = 0;
            return v.magnitude;
        }

        void BuildPlaceholder()
        {
            var root = new GameObject("Drum (placeholder)").transform;
            root.SetParent(transform, false);
            // 放倒的鼓：鼓身朝前倒，鼓面竖着朝向擂台中心
            root.localRotation = Quaternion.Euler(80f, 0, 0);
            var wood = Hex.Rgb(0x4a3328);
            PropBits.Cylinder(root, "Body", new Vector3(0, 0, -0.9f), new Vector3(2.4f, 0.9f, 2.4f), wood);
            PropBits.Cylinder(root, "Skin", new Vector3(0, 0.92f, -0.9f), new Vector3(2.3f, 0.04f, 2.3f), KuiPalette.Skin);
            PropBits.Cylinder(root, "Crack", new Vector3(0, 0.95f, -0.9f), new Vector3(0.14f, 0.02f, 1.6f), KuiPalette.ThunderEdge);
        }

        void Awake()
        {
            renderers = GetComponentsInChildren<Renderer>(true);
            rest = transform.localPosition;
        }

        /// <summary>显示 / 藏起（夔从鼓里长出来到 55% 时藏起，倒回时露出来）</summary>
        public void SetVisible(bool on)
        {
            if (Visible == on) return;
            Visible = on;
            renderers ??= GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) renderers = GetComponentsInChildren<Renderer>(true);
            foreach (var r in renderers)
                if (r)
                    r.enabled = on;
        }

        /// <summary>被雷劈中：裂口紫红一亮、电火星、震一下</summary>
        public void Strike()
        {
            Struck++;
            Fx.KuiDrumStruck(Center);
            Rattle(0.35f, 0.12f);
        }

        /// <summary>震（秒，幅度米）</summary>
        public void Rattle(float seconds, float amp)
        {
            shakeLeft = Mathf.Max(shakeLeft, seconds);
            shakeAmp = Mathf.Max(shakeAmp, amp);
        }

        void Update()
        {
            if (shakeLeft <= 0) return;
            shakeLeft -= Time.deltaTime;
            if (shakeLeft <= 0)
            {
                transform.localPosition = rest;
                shakeAmp = 0;
                return;
            }
            transform.localPosition = rest + Random.insideUnitSphere * shakeAmp * Mathf.Clamp01(shakeLeft * 4f);
        }
    }
}
