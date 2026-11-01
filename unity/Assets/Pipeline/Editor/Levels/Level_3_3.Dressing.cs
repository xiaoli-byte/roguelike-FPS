using Spiritfire.Game;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    public static partial class Level_3_3
    {
        /// <summary>只用少量构图件：前景岩柱、桥头导向灯、分区补光；不靠堆小件填满地图</summary>
        static void BuildFoundryDirection(LevelKit.TerrainSet set, Transform parent)
        {
            var root = new GameObject("Foundry Direction").transform;
            root.SetParent(parent, false);
            var iron = LevelKit.Mat(Dir, "FoundryGuideIron", new Color(0.13f, 0.1f, 0.13f), 0.9f);
            var glow = LevelKit.GlowMat(Dir, "FoundryGuideGlow", new Color(1f, 0.38f, 0.08f), new Color(2.4f, 0.65f, 0.12f));

            foreach (var at in new[] { new Vector2(87, 18), new Vector2(113, 18) })
            {
                var go = LevelKit.PlaceOrBox("SM_Env_InfernoBasalt", root, set.OnGround(at.x, at.y, -0.4f), new Vector3(4, 9, 4), 24);
                if (!go) continue;
                go.name = "Foreground · 门框岩柱";
                go.transform.localScale = new Vector3(1.6f, 3.2f, 1.6f);
            }

            foreach (var id in new[] { "B1", "B3", "B5", "B6", "B7" })
            {
                var b = BridgeById(id);
                var center = b.Center;
                var along = b.ch.NS ? Vector2.right : Vector2.up;
                var side = b.ch.NS ? Vector2.up : Vector2.right;
                foreach (float end in new[] { -1f, 1f })
                {
                    var at = center + along * (end * (b.Span * 0.5f - 0.5f)) + side * (b.width * 0.5f - 0.5f);
                    var baseAt = new Vector3(at.x, DeckTop, at.y);
                    LevelKit.Cylinder("Guide Post", root, baseAt + Vector3.up * 0.55f, 0.08f, 1.1f, Quaternion.identity, iron);
                    var lamp = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                    lamp.name = "Guide Flame";
                    lamp.transform.SetParent(root, false);
                    lamp.transform.position = baseAt + Vector3.up * 1.25f;
                    lamp.transform.localScale = Vector3.one * 0.24f;
                    Object.DestroyImmediate(lamp.GetComponent<Collider>());
                    lamp.GetComponent<MeshRenderer>().sharedMaterial = glow;
                    var light = new GameObject("Guide Light").AddComponent<Light>();
                    light.transform.SetParent(root, false);
                    light.transform.position = baseAt + Vector3.up * 1.3f;
                    light.type = LightType.Point;
                    light.color = new Color(1f, 0.42f, 0.12f);
                    light.intensity = 0.65f;
                    light.range = 5f;
                    light.shadows = LightShadows.None;
                }
            }

            AddLocalLight(root, "中央铸床 · 熔铜反光", new Vector3(100, 4.5f, 64), new Color(1f, 0.46f, 0.16f), 1.4f, 30f);
            AddLocalLight(root, "鼓风正殿 · 冷色回填", new Vector3(48, 7f, 152), new Color(0.36f, 0.46f, 0.72f), 1.25f, 38f);
            AddLocalLight(root, "神范前庭 · 王座余光", new Vector3(124, 5f, 176), new Color(1f, 0.32f, 0.08f), 1.5f, 30f);
            var zone = root.gameObject.AddComponent<AmbienceZone>();
            zone.radius = 48f;
            zone.extraDb = 4f;
        }

        static void AddLocalLight(Transform parent, string name, Vector3 at, Color color, float intensity, float range)
        {
            var light = new GameObject(name).AddComponent<Light>();
            light.transform.SetParent(parent, false);
            light.transform.position = at;
            light.type = LightType.Point;
            light.color = color;
            light.intensity = intensity;
            light.range = range;
            light.shadows = LightShadows.None;
        }
    }
}
