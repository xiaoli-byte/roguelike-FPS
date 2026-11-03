using System.Collections.Generic;
using Spiritfire.Game;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    public static partial class Level_3_3
    {
        /// <summary>
        /// 只用少量构图件：出生门框岩柱、主路的青金引导灯（S6：桥头、场地出口、坡道口，每 25–40 m 一盏，只放主路——原来的橙色桥头灯和熔岩同色，被熔岩光吞掉）、
        /// 分区补光（只有王座是暖光中心，其余分区保持冷暗）；不靠堆小件填满地图
        /// </summary>
        static void BuildFoundryDirection(LevelKit.TerrainSet set, Transform parent)
        {
            var root = new GameObject("Foundry Direction").transform;
            root.SetParent(parent, false);

            // 出生门框：两根前景岩柱夹住往北的视线（熔铜瀑 + 王座）
            foreach (var at in new[] { new Vector2(80, 21), new Vector2(108, 23) })
            {
                var go = LevelKit.PlaceOrBox("SM_Env_InfernoBasalt", root, set.OnGround(at.x, at.y, -0.4f), new Vector3(4, 9, 4), 24);
                if (!go) continue;
                go.name = "Foreground · 门框岩柱";
                go.transform.localScale = new Vector3(1.6f, 3.2f, 1.6f);
            }

            // 青金引导灯：主路的桥头（B1、B2、B5）+ 坡道口 / 场地出口
            var lamps = new GameObject("Guide Lamps · 青金").transform;
            lamps.SetParent(root, false);
            foreach (var id in new[] { "B1", "B2", "B5" })
            {
                var b = BridgeById(id);
                LevelKit.GuideBridgeHeads(Dir, lamps, b.center, b.along, b.span, b.width, b.DeckY);
            }
            Vector3 G(Vector2 q) => set.OnGround(q.x, q.y);
            var spots = new List<(Vector3, float)>
            {
                (G(new Vector2(97.5f, 24)), 0),       // 闸台坡脚
                (G(new Vector2(80, 13)), -60),         // 西南坡脚
                (G(new Vector2(55, 30)), -35),         // 西南坡顶（① 入口）
                (G(new Vector2(78, 55.5f)), 90),       // ① → B1
                (G(new Vector2(114, 47)), 90),         // B1 → ③
                (G(new Vector2(128.5f, 50)), 0),       // 吊坊西北坡脚（③ 出口）
                (G(new Vector2(127.5f, 78.5f)), -60),  // 吊坊西北坡顶（东中台）
                (G(new Vector2(89, 108)), -20),        // 殿东道
                (G(new Vector2(79, 126)), -40),        // 殿东南口
                (G(new Vector2(41, 162.5f)), 90),      // 殿北坡脚
                (G(new Vector2(58, 173.5f)), 60),      // 殿北坡顶（风闸、前庭）
                (G(new Vector2(84, 178)), 100),        // 前庭 → B5
            };
            LevelKit.GuideLamps(Dir, lamps, spots);

            AddLocalLight(root, "① 范场 · 废铜池反光", new Vector3(SpillPit.x, T1 + 3f, SpillPit.y), new Color(1f, 0.46f, 0.16f), 1.4f, 20f);
            AddLocalLight(root, "③ 浇包吊坊 · 冷色回填", new Vector3(156, T1 + 7f, 56), new Color(0.38f, 0.46f, 0.7f), 1.1f, 34f);
            AddLocalLight(root, "鼓风正殿 · 冷色回填", new Vector3(48, T2 + 7f, 146), new Color(0.36f, 0.46f, 0.72f), 1.25f, 38f);
            AddLocalLight(root, "神范前庭 · 王座余光", new Vector3(80, 5f, 186), new Color(1f, 0.32f, 0.08f), 1.5f, 30f);
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
