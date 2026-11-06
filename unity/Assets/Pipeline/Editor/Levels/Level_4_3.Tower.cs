using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;

namespace Spiritfire.Art.Editor.Levels
{
    // 4-3 彩林海子 · 守鼓人鼓楼（2026-11-07 用户定：原 4-3 雪域宫堡的剧情落到彩林海子谷口山腰）。
    // 谷口西侧山腰压出一块平台，一座宗堡式的小鼓楼（只借宫堡的形态，不做寺院）：白墙、赭红边玛墙带、金顶；门前一副空鼓架（鼓早被夔带走），
    // 石案上摊着守鼓人的修鼓旧簿（LoreNote：「鼓是从里面裂开的」）。不放灵石窖藏（4-4 补给营前的灵石已在经济设计的上限附近）。坡下留一片高山草甸，
    // 沿谷底往出口走时隔着草甸看得见山腰的白楼红边。设计见 docs/level-design/maps/4-3.md 第 3.1 节
    public static partial class Level_4_3
    {
        /// <summary>鼓楼台地中心（世界 XZ）、台面半径</summary>
        static readonly Vector2 TowerAt = new(-268, 505);
        const float TowerFlat = 13;
        /// <summary>上台地的坡道：坡脚在谷底，坡顶压进台面</summary>
        static readonly Vector2 RampFoot = new(-212, 468);
        static Vector2 RampTop => TowerAt + (RampFoot - TowerAt).normalized * (TowerFlat - 2);

        static bool towerOn;
        static float towerY, rampFootY;

        /// <summary>生成地形之前：台面高度 = 原地形在台心一圈的平均高，坡脚高 = 原地形；之后地貌函数才压台地、切坡道</summary>
        static void InitTower()
        {
            towerOn = false;
            float sum = Eval(TowerAt.x, TowerAt.y).y;
            int n = 1;
            for (int k = 0; k < 8; k++)
            {
                float a = k * Mathf.PI / 4;
                sum += Eval(TowerAt.x + Mathf.Cos(a) * TowerFlat * 0.6f, TowerAt.y + Mathf.Sin(a) * TowerFlat * 0.6f).y;
                n++;
            }
            towerY = sum / n;
            rampFootY = Eval(RampFoot.x, RampFoot.y).y;
            towerOn = true;
        }

        /// <summary>鼓楼正面朝向（世界 XZ）：朝出生点和谷底之间（东南），从湖那边看过来正好是正立面</summary>
        static Vector2 TowerFacing => ((new Vector2(spawnAt.x, spawnAt.z) - TowerAt).normalized + new Vector2(0.8f, 0)).normalized;

        /// <summary>鼓楼的顶（视线检查、远景机位用）</summary>
        static Vector3 TowerTop => new(TowerAt.x, towerY + 18.5f, TowerAt.y);

        /// <summary>鼓楼坡下的高山草甸（不种树）：从谷底往出口走的路上隔着草甸就能看见山腰的白楼</summary>
        static readonly Vector2 MeadowAt = new(-200, 486);
        const float MeadowR = 34;

        /// <summary>鼓楼、坡道、坡下草甸不种树（0..1）</summary>
        static float TowerClearing(float x, float z)
        {
            var p = new Vector2(x, z);
            float k = S(TowerFlat + 3, TowerFlat + 12, Vector2.Distance(p, TowerAt));
            k = Mathf.Min(k, S(MeadowR, MeadowR + 18, Vector2.Distance(p, MeadowAt)));
            Vector2 a = RampFoot, ab = RampTop - RampFoot;
            float t = Mathf.Clamp01(Vector2.Dot(p - a, ab) / ab.sqrMagnitude);
            float dist = Vector2.Distance(p, a + ab * t);
            return Mathf.Min(k, S(5, 9, dist));
        }

        const string IdDrumTower = "SM_Tripo_LarchDrumTower", IdDrumFrame = "SM_Tripo_LarchDrumFrame", IdLedger = "SM_Tripo_LarchLedgerTable";

        static LoreNote BuildDrumTower(Transform props, Transform markers)
        {
            var root = new GameObject("Drum Tower · 守鼓人鼓楼").transform;
            root.SetParent(props, false);
            var d = TowerFacing;
            var side = new Vector2(d.y, -d.x);
            // 本地 -z 是正面：yaw 让 (−sin, −cos) 对上朝向
            float yaw = Mathf.Atan2(-d.x, -d.y) * Mathf.Rad2Deg;
            Vector3 At(Vector2 p, float dy = 0) => new(p.x, towerY + dy, p.y);

            // 鼓楼：石台基 → 收分的白墙主楼（正面门、两层窗）→ 赭红边玛墙带 + 黑檐线 → 小一圈的上层 → 金顶 + 宝顶，主楼四角金饰
            LevelKit.PlateauPiece(Dir, IdDrumTower, "larchDrumTower", root, At(TowerAt, -0.3f), yaw, 0, b =>
            {
                b.Box("stoneDark", Vector3.zero, new Vector3(16f, 1.0f, 13f));
                b.Box("stoneDark", new Vector3(0, 0, -7.1f), new Vector3(4.2f, 0.5f, 1.4f));
                b.Frustum("white", new Vector3(0, 1f, 0), new Vector2(11f, 9f), new Vector2(9.6f, 7.8f), 10f);
                b.Box("ochre", new Vector3(0, 11f, 0), new Vector3(9.9f, 1.4f, 8.1f));
                b.Box("black", new Vector3(0, 12.4f, 0), new Vector3(10.5f, 0.25f, 8.7f));
                b.Frustum("white", new Vector3(0, 12.65f, 0), new Vector2(6f, 5f), new Vector2(5.6f, 4.6f), 3.6f);
                b.Box("ochre", new Vector3(0, 16.25f, 0), new Vector3(5.8f, 0.8f, 4.8f));
                b.Frustum("gold", new Vector3(0, 17.05f, 0), new Vector2(6.8f, 5.8f), new Vector2(3.4f, 2.6f), 1.5f);
                b.Cyl("gold", new Vector3(0, 18.55f, 0), 0.4f, 0.08f, 1.8f, 8);
                foreach (var (cx, cz) in new[] { (-4.8f, -3.9f), (4.8f, -3.9f), (-4.8f, 3.9f), (4.8f, 3.9f) })
                    b.Cyl("gold", new Vector3(cx, 12.65f, cz), 0.26f, 0.12f, 1.0f, 6);
                // 正面：门（深色门板 + 赭红门楣）、两层梯形窗
                b.Box("woodDark", new Vector3(0, 1f, -4.52f), new Vector3(2.0f, 2.8f, 0.3f));
                b.Box("ochre", new Vector3(0, 3.8f, -4.5f), new Vector3(2.8f, 0.45f, 0.4f));
                foreach (var (wx, wy) in new[] { (-2.8f, 4.6f), (2.8f, 4.6f), (-2.6f, 7.8f), (0f, 7.8f), (2.6f, 7.8f) })
                {
                    float face = Mathf.Lerp(4.5f, 3.9f, (wy - 1f) / 10f);
                    b.Frustum("black", new Vector3(wx, wy, -face - 0.06f), new Vector2(1.1f, 0.3f), new Vector2(0.8f, 0.3f), 1.5f);
                    b.Box("ochre", new Vector3(wx, wy + 1.5f, -face - 0.08f), new Vector3(1.3f, 0.22f, 0.32f));
                }
                // 两侧各两扇窄窗
                foreach (float sx in new[] { -1f, 1f })
                foreach (float wz in new[] { -1.6f, 1.6f })
                {
                    float face = Mathf.Lerp(5.5f, 4.8f, 0.65f);
                    b.Frustum("black", new Vector3(sx * (face + 0.04f), 7.2f, wz), new Vector2(0.3f, 0.9f), new Vector2(0.3f, 0.7f), 1.4f);
                }
                b.ColBox(Vector3.zero, new Vector3(16f, 1.0f, 13f));
                b.ColBox(new Vector3(0, 1f, 0), new Vector3(10.6f, 10f, 8.6f));
                b.ColBox(new Vector3(0, 11f, 0), new Vector3(10f, 1.7f, 8.3f));
                b.ColBox(new Vector3(0, 12.65f, 0), new Vector3(6f, 5.9f, 5f));
            }, "守鼓人鼓楼");

            // 门前左侧：空鼓架（鼓早被夔带走了），两根断皮绳、一片撕下来的鼓皮挂在横梁上，地上几片鼓框碎木
            var framePos = TowerAt + d * 8.5f - side * 3.8f;
            LevelKit.PlateauPiece(Dir, IdDrumFrame, "larchDrumFrame", root, At(framePos, -0.1f), yaw, 0, b =>
            {
                foreach (float sx in new[] { -2.4f, 2.4f })
                {
                    b.Box("stoneDark", new Vector3(sx, 0, 0), new Vector3(0.9f, 0.4f, 0.9f));
                    b.Cyl("woodDark", new Vector3(sx, 0.4f, 0), 0.22f, 0.18f, 4.2f, 8);
                    b.ColCyl(new Vector3(sx, 0, 0), 0.3f, 4.6f);
                }
                b.Rod("woodDark", new Vector3(-2.8f, 4.5f, 0), new Vector3(2.8f, 4.5f, 0), 0.2f, 8);
                b.Box("yakBrown", new Vector3(-1.2f, 3.0f, 0), new Vector3(0.12f, 1.5f, 0.08f));
                b.Box("yakBrown", new Vector3(1.3f, 3.4f, 0), new Vector3(0.12f, 1.1f, 0.08f));
                b.Box("bone", new Vector3(0.3f, 2.9f, 0), new Vector3(0.9f, 1.2f, 0.05f), 0, 0, 14);
                b.Box("drumOrange", new Vector3(-0.9f, 0, 0.9f), new Vector3(1.3f, 0.22f, 0.45f), 30);
                b.Box("drumOrange", new Vector3(1.0f, 0, -0.7f), new Vector3(0.9f, 0.2f, 0.4f), -55);
                b.Box("bone", new Vector3(0.6f, 0, 0.6f), new Vector3(0.8f, 0.08f, 0.6f), 70);
            }, "空鼓架");

            // 门前右侧：石案上摊着修鼓旧簿，一盏酥油灯
            var ledgerPos = TowerAt + d * 8.8f + side * 2.6f;
            LevelKit.PlateauPiece(Dir, IdLedger, "larchLedgerTable", root, At(ledgerPos, -0.1f), yaw, 0, b =>
            {
                b.Box("stoneDark", Vector3.zero, new Vector3(1.7f, 0.9f, 1.0f));
                b.Box("woodPale", new Vector3(0, 0.9f, 0), new Vector3(1.2f, 0.07f, 0.75f), 6);
                b.Box("woodDark", new Vector3(0.28f, 0.97f, 0), new Vector3(0.52f, 0.05f, 0.62f), 6);
                b.Cyl("gold", new Vector3(0.68f, 0.9f, 0.25f), 0.09f, 0.06f, 0.24f, 8);
                b.ColBox(Vector3.zero, new Vector3(1.7f, 1.0f, 1.0f));
            }, "修鼓旧簿石案");

            var noteGo = new GameObject("LoreNote · 修鼓旧簿");
            noteGo.transform.SetParent(markers, false);
            noteGo.transform.SetPositionAndRotation(At(ledgerPos + d * 0.2f), Quaternion.LookRotation(new Vector3(-d.x, 0, -d.y)));
            var note = noteGo.AddComponent<LoreNote>();
            note.title = "修鼓旧簿";
            note.place = "守鼓人鼓楼";
            note.lines = new[]
            {
                "庚子秋，鼓面又裂一道。",
                "皮向外翻，铜钉向外崩——",
                "非外力所击，是自内而裂。",
                "补以新筋，不出三月复裂。",
                "鼓中夜夜作雷声。——守鼓人记",
            };
            note.bannerTitle = "鼓自内裂";
            note.bannerSub = "守鼓人鼓楼 · 修鼓旧簿";
            note.afterLines = new[] { "鼯：鼓不是被敲破的……是里面的东西想出来。" };

            // 经幡：鼓楼顶两角拉到台地边的两根杆；坡脚两根矮杆横拉一道，标出上山的路；坡道边三堆玛尼石
            var top = At(TowerAt, 17.6f);
            Vector3 Pole(Vector2 p, float h)
            {
                var at = new Vector3(p.x, GroundY(p.x, p.y) - 0.2f, p.y);
                LevelKit.PlateauPiece(Dir, IdPole, "larchPole", root, at, 0, 0, b =>
                {
                    b.Cyl("pole", Vector3.zero, 0.16f, 0.11f, 7.5f, 8);
                    b.Cyl("gold", new Vector3(0, 7.5f, 0), 0.18f, 0.02f, 0.5f, 8);
                    b.ColCyl(Vector3.zero, 0.25f, 7.5f);
                }, "经幡杆");
                return at + Vector3.up * h;
            }
            var p1 = Pole(TowerAt + d * 12f + side * 9f, 7f);
            var p2 = Pole(TowerAt + d * 12f - side * 9f, 7f);
            flags.Line(top, p1, 0.1f);
            flags.Line(top, p2, 0.1f);
            var rampDir = (RampTop - RampFoot).normalized;
            var rampSide = new Vector2(rampDir.y, -rampDir.x);
            var f1 = Pole(RampFoot + rampSide * 4f, 5.5f);
            var f2 = Pole(RampFoot - rampSide * 4f, 5.5f);
            flags.Line(f1, f2, 0.12f);
            for (int k = 1; k <= 3; k++)
            {
                var m = Vector2.Lerp(RampFoot, RampTop, k / 4f) + rampSide * (k % 2 == 0 ? 4.2f : -4.2f);
                LevelKit.PlateauPiece(Dir, IdManiPile, "larchManiPile", root, G(m, -0.1f), k * 40, 0, b =>
                {
                    b.Frustum("stoneDark", Vector3.zero, new Vector2(2.4f, 2.2f), new Vector2(1.5f, 1.3f), 0.8f);
                    b.Frustum("mani", new Vector3(0, 0.8f, 0), new Vector2(1.5f, 1.3f), new Vector2(0.6f, 0.5f), 0.7f);
                    b.Box("white", new Vector3(0, 1.5f, 0), new Vector3(0.45f, 0.35f, 0.4f), 20);
                    b.ColBox(Vector3.zero, new Vector3(2.3f, 1.5f, 2.1f));
                }, "玛尼堆");
            }

            var mk = new GameObject("Landmark_DrumTower");
            mk.transform.SetParent(markers, false);
            mk.transform.position = TowerTop;
            return note;
        }
    }
}
