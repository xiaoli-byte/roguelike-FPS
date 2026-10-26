using System.Collections.Generic;
using Spiritfire.Game;
using Unity.AI.Navigation;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // LevelKit · 场景件（L6，docs/unity-parity.md）：可破坏物、机关开关、移动平台、可断裂桥段的白盒 + 组件，各关卡构建器直接调用。
    //   · PlaceDestructible：完整外观放在 Intact 子物体下（碎时整块收掉），根节点 NavMeshModifier 排除出烘焙 + 挖洞障碍（碎了撤掉，那块地马上能走）；
    //   · PlaceGong：机关开关（SceneActivator）的白盒——木架 + 铜锣（锣面带碰撞 = 靶子）+ 灯，物体下有 Model 子物体，运行时不再拼占位；
    //   · PlaceMovingPlatform：台面放在路线第 0 点（导航网格按第 0 点烘），台面和它下面的东西都不是静态物体（会动）；
    //   · PlaceBreakableSpan：桥板一段段摆好（不是静态物体，会掉），烘焙时在导航网格上，挖洞障碍运行时按段补。
    // 都不立空气墙；台面 / 桥板顶面 = 物体位置。
    public static partial class LevelKit
    {
        static void NotStatic(GameObject go)
        {
            foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
        }

        /// <summary>
        /// 可破坏物白盒：ground = 底面中心（世界坐标），size = 外形盒（米）。box = false 时做成竖着的圆柱（陶瓮 / 罐子，直径取 size.x）。
        /// 外观 + 碰撞放在 Intact 子物体下；根节点 NavMeshModifier（不进烘焙）+ 挖洞障碍
        /// </summary>
        public static Destructible PlaceDestructible(string name, Transform parent, Vector3 ground, float yaw, Vector3 size, Destructible.Kind kind, Material m,
            float hp, bool box = true)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            root.transform.SetPositionAndRotation(ground, Quaternion.Euler(0, yaw, 0));
            var intact = new GameObject("Intact");
            intact.transform.SetParent(root.transform, false);
            GameObject body;
            if (box)
            {
                body = GameObject.CreatePrimitive(PrimitiveType.Cube);
                body.transform.SetParent(intact.transform, false);
                body.transform.localPosition = new Vector3(0, size.y * 0.5f, 0);
                body.transform.localScale = size;
            }
            else
            {
                body = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                body.transform.SetParent(intact.transform, false);
                body.transform.localPosition = new Vector3(0, size.y * 0.5f, 0);
                body.transform.localScale = new Vector3(size.x, size.y * 0.5f, size.x);
                // 圆柱的胶囊碰撞两头是圆的，站不住、也和外形不符：换成网格碰撞
                Object.DestroyImmediate(body.GetComponent<Collider>());
                var mc = body.AddComponent<MeshCollider>();
                mc.sharedMesh = body.GetComponent<MeshFilter>().sharedMesh;
                mc.convex = true;
            }
            body.name = "Body";
            body.GetComponent<MeshRenderer>().sharedMaterial = m;
            var d = root.AddComponent<Destructible>();
            d.kind = kind;
            d.baseHp = hp;
            d.intact = intact;
            d.size = Mathf.Max(size.x, Mathf.Max(size.y, size.z));
            d.displayName = name;
            root.AddComponent<NavMeshModifier>().ignoreFromBuild = true;
            Destructible.AddObstacle(root, new Vector3(0, size.y * 0.5f, 0), size + new Vector3(0.1f, 0, 0.1f));
            NotStatic(root);
            return d;
        }

        /// <summary>
        /// 机关开关白盒（铜锣式）：ground = 底面中心，面朝 yaw（锣面法线 = +Z）。木架两根立柱 + 横梁，锣面挂在横梁下（会摆，带碰撞 = 靶子），顶上一盏灯
        /// </summary>
        public static SceneActivator PlaceGong(string name, Transform parent, Vector3 ground, float yaw, Material wood, Material bronze, Material lamp)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            root.transform.SetPositionAndRotation(ground, Quaternion.Euler(0, yaw, 0));
            var model = new GameObject("Model").transform;
            model.SetParent(root.transform, false);
            GameObject Part(string n, Transform p, PrimitiveType type, Vector3 pos, Vector3 scale, Material mat, bool keepCollider)
            {
                var go = GameObject.CreatePrimitive(type);
                go.name = n;
                go.transform.SetParent(p, false);
                go.transform.localPosition = pos;
                go.transform.localScale = scale;
                go.GetComponent<MeshRenderer>().sharedMaterial = mat;
                if (!keepCollider) Object.DestroyImmediate(go.GetComponent<Collider>());
                return go;
            }
            foreach (int side in new[] { -1, 1 })
                Part(side < 0 ? "Post L" : "Post R", model, PrimitiveType.Cube, new Vector3(side * 0.85f, 1.2f, 0), new Vector3(0.18f, 2.4f, 0.18f), wood, true);
            Part("Beam", model, PrimitiveType.Cube, new Vector3(0, 2.35f, 0), new Vector3(1.95f, 0.16f, 0.2f), wood, false);
            var swing = new GameObject("Swing").transform;
            swing.SetParent(model, false);
            swing.localPosition = new Vector3(0, 2.25f, 0);
            Part("Cord", swing, PrimitiveType.Cube, new Vector3(0, -0.12f, 0), new Vector3(0.04f, 0.24f, 0.04f), wood, false);
            var gong = Part("Gong", swing, PrimitiveType.Cylinder, new Vector3(0, -0.8f, 0), new Vector3(1.1f, 0.05f, 1.1f), bronze, false);
            gong.transform.localRotation = Quaternion.Euler(90, 0, 0);
            var hit = gong.AddComponent<BoxCollider>();
            hit.size = new Vector3(1f, 1.6f, 1f); // 局部 Y 是锣面厚度方向（圆柱高 2 × 0.05）：加厚一点，斜着打也打得中
            Part("Boss", swing, PrimitiveType.Sphere, new Vector3(0, -0.8f, 0.04f), new Vector3(0.28f, 0.28f, 0.12f), bronze, false);
            var bulb = Part("Lamp", model, PrimitiveType.Sphere, new Vector3(0, 2.62f, 0), new Vector3(0.3f, 0.3f, 0.3f), lamp, false);
            bulb.GetComponent<MeshRenderer>().shadowCastingMode = ShadowCastingMode.Off;
            var a = root.AddComponent<SceneActivator>();
            a.swing = swing;
            a.lamps = new Renderer[] { bulb.GetComponent<MeshRenderer>() };
            a.title = "铜锣机关";
            a.verb = "敲响";
            a.focusHeight = 1.45f;
            NotStatic(root);
            return a;
        }

        /// <summary>
        /// 移动平台：台面 size（X 宽 × Z 深）× thickness，放在 path[0]；yaw = 台面朝向。rails = 台面局部 ±X / ±Z 哪几条边立矮栏（0.9 m，带碰撞）：
        /// 按 "E W N S" 字母给（E = +X）。返回组件，路线、模式由调用方再设
        /// </summary>
        public static MovingPlatform PlaceMovingPlatform(string name, Transform parent, Vector3[] path, float yaw, Vector2 size, float thickness, Material deckMat,
            Material railMat, string rails = "")
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            root.transform.position = path[0];
            var deck = new GameObject("Deck").transform;
            deck.SetParent(root.transform, false);
            deck.SetPositionAndRotation(path[0], Quaternion.Euler(0, yaw, 0));
            var slab = GameObject.CreatePrimitive(PrimitiveType.Cube);
            slab.name = "Deck Slab";
            slab.transform.SetParent(deck, false);
            slab.transform.localPosition = new Vector3(0, -thickness * 0.5f, 0);
            slab.transform.localScale = new Vector3(size.x, thickness, size.y);
            slab.GetComponent<MeshRenderer>().sharedMaterial = deckMat;
            foreach (char c in rails)
            {
                Vector3 pos, scale;
                switch (c)
                {
                    case 'E': pos = new Vector3(size.x * 0.5f - 0.07f, 0.45f, 0); scale = new Vector3(0.14f, 0.9f, size.y); break;
                    case 'W': pos = new Vector3(-size.x * 0.5f + 0.07f, 0.45f, 0); scale = new Vector3(0.14f, 0.9f, size.y); break;
                    case 'N': pos = new Vector3(0, 0.45f, size.y * 0.5f - 0.07f); scale = new Vector3(size.x, 0.9f, 0.14f); break;
                    case 'S': pos = new Vector3(0, 0.45f, -size.y * 0.5f + 0.07f); scale = new Vector3(size.x, 0.9f, 0.14f); break;
                    default: continue;
                }
                var rail = GameObject.CreatePrimitive(PrimitiveType.Cube);
                rail.name = $"Rail {c}";
                rail.transform.SetParent(deck, false);
                rail.transform.localPosition = pos;
                rail.transform.localScale = scale;
                rail.GetComponent<MeshRenderer>().sharedMaterial = railMat;
            }
            var body = deck.gameObject.AddComponent<Rigidbody>();
            body.isKinematic = true;
            body.useGravity = false;
            var mp = root.AddComponent<MovingPlatform>();
            mp.deck = deck;
            mp.deckSize = size;
            mp.deckThickness = thickness;
            mp.path = path;
            NotStatic(root);
            return mp;
        }

        /// <summary>
        /// 可断裂桥段：顶面从 from 直线到 to（世界坐标，等高），宽 width，切成 count 段桥板（厚 thickness），桥板之间留 2 cm 缝（看得出是一块块的）。
        /// 每段两侧各一根短护柱（没有碰撞，只是好看）。返回组件，断法由调用方再设
        /// </summary>
        public static BreakableSpan PlaceBreakableSpan(string name, Transform parent, Vector3 from, Vector3 to, float width, int count, float thickness, Material plank,
            Material post)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            root.transform.position = (from + to) * 0.5f;
            var along = to - from;
            float length = along.magnitude;
            var rot = Quaternion.LookRotation(along / length, Vector3.up);
            count = Mathf.Max(1, count);
            float seg = length / count;
            var list = new List<Transform>();
            for (int i = 0; i < count; i++)
            {
                var t = new GameObject($"Segment {i}").transform;
                t.SetParent(root.transform, false);
                t.SetPositionAndRotation(from + along * ((i + 0.5f) / count), rot);
                var board = GameObject.CreatePrimitive(PrimitiveType.Cube);
                board.name = "Plank";
                board.transform.SetParent(t, false);
                board.transform.localPosition = new Vector3(0, -thickness * 0.5f, 0);
                board.transform.localScale = new Vector3(width, thickness, seg - 0.02f);
                board.GetComponent<MeshRenderer>().sharedMaterial = plank;
                foreach (int side in new[] { -1, 1 })
                {
                    var p = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    p.name = side < 0 ? "Post L" : "Post R";
                    Object.DestroyImmediate(p.GetComponent<Collider>());
                    p.transform.SetParent(t, false);
                    p.transform.localPosition = new Vector3(side * (width * 0.5f - 0.08f), 0.3f, 0);
                    p.transform.localScale = new Vector3(0.12f, 0.6f, 0.12f);
                    p.GetComponent<MeshRenderer>().sharedMaterial = post;
                }
                list.Add(t);
            }
            var span = root.AddComponent<BreakableSpan>();
            span.segments = list.ToArray();
            span.segmentSize = new Vector2(width, seg);
            span.segmentThickness = thickness;
            NotStatic(root);
            return span;
        }
    }
}
