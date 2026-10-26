using Spiritfire.Game;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    /// <summary>
    /// 测试场 TestArena 东北角的「场景件」区（L6，冒烟套件 scene-pieces；Level_TestArena.Build 调用）。关卡坐标 = 世界 XZ，地面 y = 0：
    ///   · 两座 4 m 石台：西台 (30, 48)、东台 (48, 48)，6 × 6 m，南面各一条 20° 坡道；
    ///   · 可断裂桥段：两台之间 12 m 的木桥（顶面 y 4、宽 3 m、8 段），断法 = 打（Damage）+ 信号；桥下是平地（掉下去 4 m）；
    ///   · 移动平台：4 × 4 m 铁台，路线 (53, 0.25, 36) 地面 → 升到 4 m → 往北平移 12 m 停到东台东沿；往返（PingPong），开局没通电；
    ///   · 机关开关：铜锣 (44, 32)，面朝南；拨杆式，敲一下给平台通电、再敲断电；
    ///   · 可破坏物：木箱 (36, 38)（什么都吃、怕火，掉灵石 + 弹药）、石碑 (40, 38)（只吃爆炸）。
    /// 坡道、台顶、桥都在导航网格上；可破坏物用 NavMeshModifier 排除出烘焙、挖洞障碍到碎为止。
    /// </summary>
    public static class TestArenaPieces
    {
        public static readonly Vector2 WestTower = new(30, 48), EastTower = new(48, 48);
        public const float TowerSize = 6f, TowerHeight = 4f, RampAngle = 20f, RampWidth = 3.5f;
        public const float BridgeWidth = 3f, BridgeThickness = 0.3f;
        public const int BridgeSegments = 8;
        public static readonly Vector2 Gong = new(44, 32), Crate = new(36, 38), Stele = new(40, 38);
        /// <summary>移动平台路线（世界坐标：台面顶面中心）</summary>
        public static readonly Vector3[] PlatformPath = { new(53.05f, 0.25f, 36), new(53.05f, TowerHeight, 36), new(53.05f, TowerHeight, 48) };
        public static readonly Vector2 PlatformSize = new(4, 4);
        /// <summary>截图视角：从南边看整片场景件</summary>
        public static readonly (Vector3 pos, Vector3 target) View = (new Vector3(36, 3.2f, 18), new Vector3(43, 3f, 44));

        static Vector3 G(Vector2 p, float y = 0) => new(p.x, y, p.y);

        public static void Build(Transform parent, string dir)
        {
            var root = new GameObject("Scene Pieces (L6)").transform;
            root.SetParent(parent, false);
            var stone = LevelKit.Mat(dir, "PieceStone", new Color(0.62f, 0.58f, 0.52f));
            var ramp = LevelKit.Mat(dir, "PieceRamp", new Color(0.74f, 0.66f, 0.52f));
            var wood = LevelKit.Mat(dir, "PieceWood", new Color(0.55f, 0.38f, 0.22f), 0.85f);
            var plank = LevelKit.Mat(dir, "PiecePlank", new Color(0.6f, 0.44f, 0.27f), 0.85f);
            var bronze = LevelKit.Mat(dir, "PieceBronze", new Color(0.78f, 0.56f, 0.25f), 0.45f);
            var lamp = LevelKit.GlowMat(dir, "PieceLamp", new Color(0.4f, 0.36f, 0.3f), new Color(0, 0, 0));
            var iron = LevelKit.Mat(dir, "PieceIron", new Color(0.3f, 0.31f, 0.34f), 0.6f);
            var deck = LevelKit.Mat(dir, "PieceDeck", new Color(0.42f, 0.44f, 0.48f), 0.7f);
            var stele = LevelKit.Mat(dir, "PieceStele", new Color(0.5f, 0.5f, 0.47f));

            // 两座石台 + 坡道
            foreach (var (c, label) in new[] { (WestTower, "West"), (EastTower, "East") })
            {
                LevelKit.Box($"Span Tower {label}", root, G(c), new Vector3(TowerSize, TowerHeight, TowerSize), 0, stone, 0);
                float south = c.y - TowerSize * 0.5f;
                float run = TowerHeight / Mathf.Tan(RampAngle * Mathf.Deg2Rad);
                Ramp($"Span Tower {label} Ramp", root, new Vector2(c.x, south - run), new Vector2(c.x, south), TowerHeight, RampWidth, ramp);
            }

            // 可断裂桥段：西台东沿 → 东台西沿
            var span = LevelKit.PlaceBreakableSpan("Breakable Span", root, G(WestTower + Vector2.right * TowerSize * 0.5f, TowerHeight),
                G(EastTower - Vector2.right * TowerSize * 0.5f, TowerHeight), BridgeWidth, BridgeSegments, BridgeThickness, plank, wood);
            span.triggers = BreakableSpan.Trigger.Damage | BreakableSpan.Trigger.Signal;
            span.baseHp = 150f;
            span.displayName = "朽木桥";

            // 移动平台：地面 → 4 m → 东台东沿
            var mp = LevelKit.PlaceMovingPlatform("Moving Platform", root, PlatformPath, 0, PlatformSize, 0.4f, deck, iron, "E");
            mp.mode = MovingPlatform.Mode.PingPong;
            mp.speed = 3f;
            mp.dwell = 2f;
            mp.startPowered = false;
            mp.onSignal = MovingPlatform.SignalAction.Power;
            mp.poweredToast = "平台通电了";
            // 台面上一盏灯：通电才亮
            var bulb = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            bulb.name = "Deck Lamp (powered)";
            Object.DestroyImmediate(bulb.GetComponent<Collider>());
            bulb.transform.SetParent(mp.deck, false);
            bulb.transform.localPosition = new Vector3(PlatformSize.x * 0.5f - 0.07f, 1.05f, PlatformSize.y * 0.5f - 0.3f);
            bulb.transform.localScale = Vector3.one * 0.28f;
            bulb.GetComponent<MeshRenderer>().sharedMaterial = LevelKit.GlowMat(dir, "PieceLampOn", new Color(1f, 0.75f, 0.35f), new Color(3f, 1.8f, 0.6f));
            bulb.isStatic = false;
            mp.poweredOnly = new[] { bulb };

            // 机关开关：铜锣，拨杆式，驱动平台通断电
            var gong = LevelKit.PlaceGong("Gong Switch", root, G(Gong), 180f, wood, bronze, lamp);
            gong.toggle = true;
            gong.targets = new MonoBehaviour[] { mp };
            gong.hint = "敲一下：东边的平台通电 / 断电";
            gong.toast = "";

            // 可破坏物
            var crate = LevelKit.PlaceDestructible("木箱", root, G(Crate), 15f, new Vector3(1.2f, 1.2f, 1.2f), Destructible.Kind.Wood, wood, 30f);
            crate.weakTo = Destructible.DamageKind.Fire;
            crate.coins = new Vector2Int(3, 5);
            crate.ammoChance = 0.3f;
            var st = LevelKit.PlaceDestructible("石碑", root, G(Stele), -10f, new Vector3(1.3f, 2.4f, 0.5f), Destructible.Kind.Stone, stele, 80f);
            st.accepts = Destructible.DamageKind.Explosion;
        }

        /// <summary>验收的主线：两座台顶（坡道上去）</summary>
        public static void AddRoutes(LevelSpec spec)
        {
            spec.Route("断桥西台", G(WestTower, TowerHeight)).Route("断桥东台", G(EastTower, TowerHeight));
        }

        /// <summary>坡道板：顶面从 foot（地面）直线升到 top（高 h），厚 0.6 m（同 Level_TestArena.RampBlock）</summary>
        static void Ramp(string name, Transform parent, Vector2 foot, Vector2 top, float h, float width, Material mat)
        {
            const float thick = 0.6f;
            var a = G(foot);
            var b = G(top, h);
            var along = (b - a).normalized;
            var normal = Vector3.Cross(along, Vector3.Cross(Vector3.up, along)).normalized;
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation((a + b) * 0.5f - normal * thick * 0.5f, Quaternion.LookRotation(along, normal));
            go.transform.localScale = new Vector3(width, thick, Vector3.Distance(a, b));
            go.GetComponent<MeshRenderer>().sharedMaterial = mat;
            go.isStatic = true;
        }
    }
}
