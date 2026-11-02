using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 青金引导灯（S6，docs/level-design/ch3-v2.md 2.3 / 7.2，M33 拥有；全章通用）。
    // 第三章的颜色语言：熔岩橙 = 地面危险 / 环境光（不指路）、品红 = 熔岩地面上的攻击预警、金 = 精英 / 藏宝；
    // 青金灵火灯 = 主路——只放在主路的岔口、场地出口、桥头，每 25–40 m 一盏，支路不放。
    // 灯 = 暗铁灯柱（不挡人：没有碰撞）+ 铁笼灯头 + 青色灵火（金色焰心）+ 一盏不投影的青色点光。
    //
    // 用法：
    //   LevelKit.GuideLamp(Dir, parent, 地面点, yaw);                                 // 一盏
    //   LevelKit.GuideLamps(Dir, parent, LevelKit.GuideTrail(主路折线, 32f, 起点空出, 终点空出)); // 沿主路每 32 m 一盏
    //   LevelKit.GuideBridgeHeads(Dir, parent, 桥中心, 桥轴, 桥长, 桥宽, 桥面 y);              // 桥两头各一盏（靠一侧栏边）
    public static partial class LevelKit
    {
        /// <summary>青金灵火：外焰青（偏冷的青绿）、焰心金。和熔岩橙、品红预警、精英金都拉得开</summary>
        public static readonly Color GuideCyan = new(0.32f, 0.95f, 0.88f), GuideGold = new(1f, 0.86f, 0.45f);
        /// <summary>引导灯的名字前缀（自查、测试按它数）</summary>
        public const string GuideLampName = "Guide Lamp · 青金";

        /// <summary>
        /// 一盏青金引导灯：底面在 groundAt（世界坐标），灯柱高 height 米（默认 1.7 m，比半身掩体高、比人矮一点），灯头朝 yaw 的方向探出 0.25 m。
        /// 灯柱 / 灯头 / 焰都没有碰撞（不挡人、不挡子弹、不进导航烘焙）；点光不投影，范围 lightRange 米
        /// </summary>
        public static GameObject GuideLamp(string dir, Transform parent, Vector3 groundAt, float yaw = 0, float height = 1.7f, float lightRange = 7f, float intensity = 1.8f)
        {
            var root = new GameObject(GuideLampName);
            root.transform.SetParent(parent, false);
            root.transform.SetPositionAndRotation(groundAt, Quaternion.Euler(0, yaw, 0));
            var iron = Mat(dir, "GuideLampIron", new Color(0.11f, 0.1f, 0.12f), 0.85f);
            var bronze = Mat(dir, "GuideLampBronze", new Color(0.36f, 0.3f, 0.2f), 0.6f);
            // 自发光压在 1.3–1.6 倍：再亮 Bloom 会把青色吹成白色，远处读不出「青金」
            var flame = GlowMat(dir, "GuideLampFlame", GuideCyan, GuideCyan * 1.3f);
            var core = GlowMat(dir, "GuideLampCore", GuideGold, GuideGold * 1.6f);

            GuidePiece(PrimitiveType.Cube, "Base", root.transform, new Vector3(0, 0.12f, 0), new Vector3(0.5f, 0.3f, 0.5f), iron);
            GuidePiece(PrimitiveType.Cylinder, "Post", root.transform, new Vector3(0, height * 0.5f, 0), new Vector3(0.14f, height * 0.5f, 0.14f), iron);
            var head = new Vector3(0, height + 0.05f, 0.25f);
            GuidePiece(PrimitiveType.Cube, "Arm", root.transform, new Vector3(0, height - 0.02f, 0.13f), new Vector3(0.08f, 0.08f, 0.32f), iron);
            GuidePiece(PrimitiveType.Cube, "Cap", root.transform, head + new Vector3(0, 0.36f, 0), new Vector3(0.46f, 0.08f, 0.46f), bronze);
            GuidePiece(PrimitiveType.Cube, "Tray", root.transform, head + new Vector3(0, -0.32f, 0), new Vector3(0.4f, 0.06f, 0.4f), bronze);
            GuidePiece(PrimitiveType.Sphere, "Flame", root.transform, head, new Vector3(0.44f, 0.6f, 0.44f), flame, true);
            GuidePiece(PrimitiveType.Sphere, "Flame Core", root.transform, head + new Vector3(0, -0.08f, 0), new Vector3(0.2f, 0.3f, 0.2f), core, true);

            var light = new GameObject("Guide Light").AddComponent<Light>();
            light.transform.SetParent(root.transform, false);
            light.transform.localPosition = head + new Vector3(0, 0.1f, 0);
            light.type = LightType.Point;
            light.color = GuideCyan;
            light.intensity = intensity;
            light.range = lightRange;
            light.shadows = LightShadows.None;
            root.isStatic = true;
            return root;
        }

        static void GuidePiece(PrimitiveType type, string name, Transform parent, Vector3 local, Vector3 scale, Material m, bool glow = false)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            Object.DestroyImmediate(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = local;
            go.transform.localScale = scale;
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = m;
            if (glow)
            {
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = false;
            }
            go.isStatic = true;
        }

        /// <summary>一串引导灯（地面点 + 朝向）</summary>
        public static List<GameObject> GuideLamps(string dir, Transform parent, IEnumerable<(Vector3 at, float yaw)> spots, float height = 1.7f, float lightRange = 7f)
        {
            var list = new List<GameObject>();
            foreach (var (at, yaw) in spots) list.Add(GuideLamp(dir, parent, at, yaw, height, lightRange));
            return list;
        }

        /// <summary>
        /// 沿主路折线（地面点，按顺序）每 spacing 米一个灯位（2.3「每 25–40 m 一盏」），起点空出 skipStart、终点空出 skipEnd 米；
        /// 灯位从路中线往右侧挪 side 米（站在路边，不挡路），朝向 = 前进方向（灯头往前探）。y 取折线插值，调用方可以再贴地
        /// </summary>
        public static List<(Vector3 at, float yaw)> GuideTrail(IReadOnlyList<Vector3> route, float spacing = 32f, float skipStart = 8f, float skipEnd = 8f, float side = 2.5f)
        {
            var o = new List<(Vector3, float)>();
            if (route == null || route.Count < 2) return o;
            float total = 0;
            for (int i = 0; i + 1 < route.Count; i++) total += Vector3.Distance(GuideFlat(route[i]), GuideFlat(route[i + 1]));
            for (float s = skipStart; s <= total - skipEnd + 1e-3f; s += Mathf.Max(5f, spacing))
            {
                float acc = 0;
                for (int i = 0; i + 1 < route.Count; i++)
                {
                    float len = Vector3.Distance(GuideFlat(route[i]), GuideFlat(route[i + 1]));
                    if (acc + len < s && i + 2 < route.Count)
                    {
                        acc += len;
                        continue;
                    }
                    var a = route[i];
                    var b = route[i + 1];
                    var p = Vector3.Lerp(a, b, len > 0 ? Mathf.Clamp01((s - acc) / len) : 0);
                    var d = GuideFlat(b - a).normalized;
                    var right = new Vector3(d.z, 0, -d.x);
                    o.Add((p + right * side, Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg));
                    break;
                }
            }
            return o;
        }

        /// <summary>
        /// 桥头灯：桥（中心、沿桥方向 along、桥长 span、桥宽 width、桥面 deckY）两头各一盏，立在桥面上、靠 +侧栏边内 0.6 m，灯头朝桥外
        /// </summary>
        public static List<GameObject> GuideBridgeHeads(string dir, Transform parent, Vector2 center, Vector2 along, float span, float width, float deckY, float height = 1.7f)
        {
            along = along.normalized;
            var side = new Vector2(along.y, -along.x);
            var list = new List<GameObject>();
            foreach (float end in new[] { -1f, 1f })
            {
                var at = center + along * (end * (span * 0.5f - 0.6f)) + side * (width * 0.5f - 0.6f);
                float yaw = Mathf.Atan2(along.x * end, along.y * end) * Mathf.Rad2Deg;
                list.Add(GuideLamp(dir, parent, new Vector3(at.x, deckY, at.y), yaw, height));
            }
            return list;
        }

        static Vector3 GuideFlat(Vector3 v) => new(v.x, 0, v.z);
    }
}
