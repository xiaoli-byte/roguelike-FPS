using System;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;
using WB = Spiritfire.Art.Editor.Levels.LevelKit.PlateauWhitebox;

namespace Spiritfire.Art.Editor.Levels
{
    // 4-1 的地标与场景件（网页 src/world/plateau/landmarks.ts 的白盒移植）：摆放表照 spec.PLACEMENTS，体块按网页的尺寸拼，碰撞照网页的 boxC / cylC。
    // 第四章场景件还没走美术管线：每件按资产 id 摆（LevelKit.PlateauPiece），有 Prefab 自动换上，没有是带 Placeholder 标签的白盒。
    public static partial class Level_4_1
    {
        // ───────────────────────────── 资产 id（maps/4-1.md 第 9 节）─────────────────────────────
        const string IdDiaolou = "SM_Tripo_PlateauDiaolou", IdDiaolouRuin = "SM_Tripo_PlateauDiaolouRuin", IdLhatse = "SM_Tripo_PlateauLhatse",
            IdChorten = "SM_Tripo_PlateauChorten", IdSang = "SM_Tripo_PlateauSangBurner", IdSnout = "SM_Tripo_PlateauGlacierSnout",
            IdHouse = "SM_Tripo_PlateauHouse", IdShelter = "SM_Tripo_PlateauShelter", IdDaoban = "SM_Tripo_PlateauDaoban",
            IdWaterWheel = "SM_Tripo_PlateauWaterWheelHouse", IdCave = "SM_Tripo_PlateauCaveFront", IdManiWall = "SM_Tripo_PlateauManiWall",
            IdWheelHouse = "SM_Tripo_PlateauWheelPavilion", IdBlackTent = "SM_Tripo_PlateauBlackTent", IdWhiteTent = "SM_Tripo_PlateauWhiteTent",
            IdBarley = "SM_Tripo_PlateauBarleyRack", IdBridge = "SM_Tripo_PlateauWoodBridge", IdWall = "SM_Tripo_PlateauRetainingWall",
            IdFieldWall = "SM_Tripo_PlateauFieldWall", IdStele = "SM_Tripo_PlateauPassStele", IdGate = "SM_Tripo_PlateauFlagGate",
            IdHotSpring = "SM_Tripo_PlateauHotSpring", IdChortenRow = "SM_Tripo_PlateauChortenRow", IdStupa = "SM_Tripo_PlateauStupa",
            IdManiPile = "SM_Tripo_PlateauManiPile", IdYak = "SM_Tripo_PlateauYak", IdDungWall = "SM_Tripo_PlateauDungWall", IdFence = "SM_Tripo_PlateauFence",
            IdDrums = "SM_Tripo_PlateauOilDrums", IdPole = "SM_Tripo_PlateauFlagPole", IdDarchor = "SM_Tripo_PlateauDarchor", IdBoulder = "SM_Tripo_PlateauBoulder",
            IdMilestone = "SM_Tripo_PlateauMilestone", IdGravel = "SM_Tripo_PlateauGravelPile", IdIceBlock = "SM_Tripo_PlateauIceFloe",
            IdIceRidge = "SM_Tripo_PlateauIceRidge", IdAltarPosts = "SM_Tripo_PlateauAltarPosts", KuiDrumId = "SM_Prop_KuiBrokenDrum";

        // ───────────────────────────── 摆放表（网页 spec.PLACEMENTS，网页坐标）─────────────────────────────

        sealed class Pl
        {
            public string kind;
            public double x, z, yaw, len, scale = 1;
            public (double x, double z)? face;
            public bool big;
            public int seed, count;
        }

        static Pl P(string kind, double x, double z, (double, double)? face = null, double yaw = 0, double len = 0, double scale = 1, bool big = false, int seed = 0,
            int count = 0) => new() { kind = kind, x = x, z = z, face = face, yaw = yaw, len = len, scale = scale, big = big, seed = seed, count = count };

        static readonly Pl[] Placements =
        {
            // 出生 · 道班
            P("daoban", -274, 226, face: (-200, 180)), P("drums", -262, 230), P("gravel", -282, 206), P("milestone", -252, 207, face: (-262, 232)),
            // ① 碉楼寨
            P("diaolou", -200, -52, face: (-160, -10)), P("diaolouRuin", -164, -14, face: (-120, 20)),
            P("house", -181, -27, face: (-150, 0)), P("house", -206, -24, face: (-160, -20)), P("house", -176, -56, face: (-185, -30)),
            P("barleyRack", -193, -8, yaw: 0.4), P("barleyRack", -158, -40, yaw: -0.3),
            P("fieldWall", -150, 2, yaw: Math.PI / 4, len: 22), P("fieldWall", -138, 14, yaw: Math.PI / 4, len: 20), P("fieldWall", -126, 26, yaw: Math.PI / 4, len: 18),
            P("maniPile", -178, -6), P("boulder", -216, -4, scale: 2.2), P("boulder", -148, -50, scale: 2.0), P("yak", -132, 34, yaw: 0.8, seed: 1),
            // ② 白塔溪谷
            P("chorten", -28, 58, face: (-20, 92)), P("maniWall", -4, 74, yaw: 0.25, len: 24), P("wheelHouse", -42, 82, face: (-20, 94)), P("waterWheel", -70, 77, face: (-40, 70)),
            P("boulder", -12, 46, scale: 2.4), P("boulder", -36, 38, scale: 2.0), P("maniPile", 2, 50, scale: 0.8), P("yak", -6, 34, yaw: 2.2, seed: 2), P("yak", 14, 56, yaw: -0.6, seed: 3),
            // ③ 牧民营地
            P("blackTent", 124, 114, yaw: -0.2), P("blackTent", 154, 141, yaw: 0.4), P("blackTent", 163, 112, yaw: -0.6, scale: 0.85), P("whiteTent", 132, 144, face: (140, 125)),
            P("dungWall", 110, 131, yaw: 1.2, len: 9), P("dungWall", 172, 128, yaw: 1.5, len: 7),
            P("fence", 105, 146, yaw: 0, len: 16), P("fence", 105, 166, yaw: 0, len: 16), P("fence", 97, 156, yaw: Math.PI / 2, len: 20), P("fence", 113, 152, yaw: Math.PI / 2, len: 12),
            P("sangBurner", 146, 124), P("darchor", 178, 140),
            P("yak", 102, 153, yaw: 0.3, seed: 4), P("yak", 108, 160, yaw: 2.0, seed: 5), P("yak", 100, 161, yaw: -1.2, seed: 6), P("yak", 88, 122, yaw: 1.0, seed: 7),
            P("yak", 172, 162, yaw: -2.4, seed: 8), P("yak", 150, 92, yaw: 0.5, seed: 9), P("yak", 120, 92, yaw: 2.8, seed: 10),
            // ④ 圣湖海子
            P("stupa", -152, -153, face: (-140, -100)), P("chortenRow", -96, -167, yaw: 1.15, count: 7, len: 18),
            P("maniPile", -96, -122), P("maniPile", -186, -124, scale: 1.2), P("maniPile", -92, -182, scale: 0.8), P("cave", -150, -204, face: (-150, -150)),
            P("boulder", -114, -112, scale: 2.2), P("boulder", -192, -150, scale: 2.4), P("yak", -86, -114, yaw: 1.4, seed: 11), P("yak", -80, -124, yaw: -0.4, seed: 12),
            // ⑤ 冰川口
            P("glacierSnout", 40, -205, face: (40, -150), len: 66), P("iceBlock", 34, -190, scale: 1.6), P("iceBlock", 47, -184, scale: 1.1), P("iceBlock", 42, -193, scale: 0.9),
            P("boulder", 8, -194, scale: 2.6), P("boulder", 12, -216, scale: 2.2), P("boulder", 74, -196, scale: 2.4), P("boulder", 70, -219, scale: 2.0),
            P("boulder", 28, -168, scale: 1.6), P("boulder", 57, -165, scale: 1.8), P("maniPile", 62, -160),
            // ⑥ 经幡山头
            P("lhatse", 90, -70, face: (0, 50)), P("sangBurner", 100, -62, big: true), P("maniPile", 75, -80), P("maniPile", 104, -82, scale: 0.9),
            // ⑦ 垭口
            P("stele", 238, -165, face: (218, -140)), P("shelter", 266, -194, face: (250, -175)), P("maniPile", 238, -186), P("maniPile", 262, -164, scale: 1.1),
            P("darchor", 246, -192), P("sangBurner", 232, -177), P("flagGate", 272, -187, face: (250, -178)),
            // 小兴趣点
            P("hotSpring", 12, -122), P("diaolouRuin", 20, 158, face: (0, 100), scale: 0.85),
            P("maniPile", -80, 40), P("maniPile", 45, -8, scale: 0.9), P("maniPile", 66, -138), P("maniPile", -172, -82, scale: 0.9), P("maniPile", 122, 40),
            P("maniPile", 205, 42, scale: 1.1), P("maniPile", -200, 162), P("maniPile", 150, -207, scale: 0.9), P("maniPile", -58, -176),
            P("yak", -60, -124, yaw: 0.9, seed: 13), P("yak", -52, -117, yaw: -2.0, seed: 14), P("yak", -67, -112, yaw: 2.4, seed: 15),
            P("boulder", 0, 20, scale: 3.0), P("boulder", 182, 20, scale: 2.6), P("boulder", -100, 182, scale: 2.4), P("boulder", 60, 62, scale: 2.2),
            P("boulder", -240, -100, scale: 2.6), P("boulder", 210, -22, scale: 2.2),
        };

        /// <summary>经幡绳（网页 FLAG_LINES）：两端离地高度、两端立杆</summary>
        static readonly (double ax, double az, double ha, double bx, double bz, double hb)[] FlagLines =
        {
            (-250, 196, 4.5, -236, 216, 4.5), (-92, -138, 4, -112, -114, 4), (-180, -131, 4, -162, -118, 4), (122, -210, 4, 162, -206, 4),
            (190, -200, 4, 226, -189, 4), (190, 86, 5, 205, 62, 5), (-198, -40, 6, -176, -46, 5),
        };

        // ───────────────────────────── 构建期状态 ─────────────────────────────

        static LevelKit.PrayerFlags flags;
        /// <summary>经幡杆：底（世界）、高、是不是导体（≥ 3 m 的杆挂 Conductor）</summary>
        static List<(Vector3 basePos, float height, bool conductor)> poles;
        /// <summary>可站的屋顶（民居、避风屋）：举父的高处站位按它贴</summary>
        static List<(Vector2 xz, float topY, float radius, Vector3 anchor)> roofs;
        /// <summary>导体（经幡杆以外）：拉则、碉楼、达觉</summary>
        static List<(string name, Vector3 basePos, float height)> conductors;
        static Vector3 lhatseTop, diaolouTop, gateCenter;
        static GameObject gateObject;

        static double WebYaw(Pl p) => p.face is { } f ? Math.Atan2(f.x - p.x, f.z - p.z) : p.yaw;
        /// <summary>网页偏航 → Unity 偏航（度）：网页局部 +z 朝 (sin θ, cos θ)（z 向南），换到 Unity（z 取反）就是 180° − θ，局部 x 取反（白盒 mirrorX）</summary>
        static float UnityYaw(double webYaw) => Mathf.Repeat(180f - (float)(webYaw * Mathf.Rad2Deg), 360f);
        /// <summary>网页的「地基下最低地形 − sink」（世界 y）</summary>
        static float BaseY(Pl p, double hx, double hz, double sink) => (float)(field.FootprintMin(p.x, p.z, hx, hz, WebYaw(p)) - sink);
        /// <summary>局部 (lx, ly, lz)（网页约定）→ 世界：与白盒的 mirrorX 一致</summary>
        static Vector3 LW(Vector3 origin, float yaw, float lx, float ly, float lz) => origin + Quaternion.Euler(0, yaw, 0) * new Vector3(-lx, ly, lz);

        /// <summary>立一根经幡杆（网页 flagPole）：杆底 = 地面 − 0.2，返回杆顶。banner = 杆上挂一条竖幡</summary>
        static Vector3 Pole(Vector2 u, float height, bool banner = false, int color = 0)
        {
            float y = GroundY(u) - 0.2f;
            var b = new Vector3(u.x, y, u.y);
            poles.Add((b, height + 0.2f, height >= 3f));
            if (banner) flags.Banner(b + Vector3.up * (height * 0.95f), height * 0.5f, 0.7f, color, (u.x * 7 + u.y) % 360);
            return b + Vector3.up * (height + 0.2f);
        }

        static float GroundY(Vector2 u) => (float)field.HeightAt(u.x, -u.y);

        static GameObject Piece(Pl p, string id, string key, Transform parent, float baseY, Action<WB> build, string label = null, float height = 0) =>
            LevelKit.PlateauPiece(Dir, id, key, parent, new Vector3((float)p.x, baseY, (float)-p.z), UnityYaw(WebYaw(p)), height, build, label);

        // ───────────────────────────── 摆放入口 ─────────────────────────────

        static void BuildLandmarks(Transform arch, Transform props)
        {
            foreach (var p in Placements)
            {
                var parent = p.kind is "diaolou" or "diaolouRuin" or "house" or "chorten" or "lhatse" or "daoban" or "shelter" or "cave" or "wheelHouse" or "waterWheel"
                    or "glacierSnout" or "stupa" or "chortenRow" or "stele" or "flagGate" ? arch : props;
                switch (p.kind)
                {
                    case "daoban": Daoban(p, parent); break;
                    case "drums": Drums(p, parent); break;
                    case "gravel": Gravel(p, parent); break;
                    case "milestone": Milestone(p, parent); break;
                    case "diaolou": Diaolou(p, parent); break;
                    case "diaolouRuin": DiaolouRuin(p, parent); break;
                    case "house": House(p, parent); break;
                    case "barleyRack": BarleyRack(p, parent); break;
                    case "fieldWall": FieldWall(p, parent); break;
                    case "maniPile": ManiPile(p, parent); break;
                    case "boulder": Boulder(p, parent); break;
                    case "yak": Yak(p, parent); break;
                    case "chorten": Chorten(p, parent); break;
                    case "maniWall": ManiWall(p, parent); break;
                    case "wheelHouse": WheelHouse(p, parent); break;
                    case "waterWheel": WaterWheel(p, parent); break;
                    case "blackTent": BlackTent(p, parent); break;
                    case "whiteTent": WhiteTent(p, parent); break;
                    case "dungWall": DungWall(p, parent); break;
                    case "fence": Fence(p, parent); break;
                    case "sangBurner": SangBurner(p, parent); break;
                    case "darchor": Darchor(p, parent); break;
                    case "stupa": Stupa(p, parent); break;
                    case "chortenRow": ChortenRow(p, parent); break;
                    case "cave": Cave(p, parent); break;
                    case "glacierSnout": GlacierSnout(p, parent); break;
                    case "iceBlock": IceBlock(p, parent); break;
                    case "lhatse": Lhatse(p, parent); break;
                    case "stele": Stele(p, parent); break;
                    case "shelter": Shelter(p, parent); break;
                    case "flagGate": FlagGate(p, parent); break;
                    case "hotSpring": HotSpring(p, parent); break;
                    default: Debug.LogWarning($"[Level] 4-1 没有 {p.kind} 的白盒"); break;
                }
            }
            foreach (var l in FlagLines)
            {
                var a = Pole(U(l.ax, l.az), (float)l.ha + 0.3f);
                var b = Pole(U(l.bx, l.bz), (float)l.hb + 0.3f);
                flags.Line(a - Vector3.up * 0.3f, b - Vector3.up * 0.3f, 0.06f);
            }
        }

        // ───────────────────────────── 白盒小工具 ─────────────────────────────

        /// <summary>藏式窗：黑色梯形窗套 + 窗楣（窗面朝局部 +z，at = 窗底中心）</summary>
        static void TibetWindow(WB b, Vector3 at, float w, float h, float yaw = 0)
        {
            var q = Quaternion.Euler(0, yaw, 0);
            b.Frustum("black", at, new Vector2(w + 0.55f, 0.05f), new Vector2(w + 0.2f, 0.05f), h + 0.3f, yaw);
            b.Box("woodDark", at + q * new Vector3(0, 0.15f, 0.05f), new Vector3(w, h, 0.06f), yaw);
            b.Box("red", at + q * new Vector3(0, h + 0.05f, 0.1f), new Vector3(w + 0.35f, 0.1f, 0.06f), yaw);
            b.Box("blue", at + q * new Vector3(0, h - 0.05f, 0.1f), new Vector3(w + 0.35f, 0.1f, 0.06f), yaw);
            b.Box("wood", at + q * new Vector3(0, h + 0.3f, 0.12f), new Vector3(w + 0.7f, 0.12f, 0.3f), yaw);
        }

        static void CornerHorn(WB b, float x, float y, float z)
        {
            b.Box("white", new Vector3(x, y, z), new Vector3(0.7f, 0.55f, 0.7f));
            b.Box("white", new Vector3(x, y + 0.55f, z), new Vector3(0.45f, 0.4f, 0.45f));
            b.Rock("white", new Vector3(x, y + 0.9f, z), 0.18f, 0.9f, (int)(x * 3 + z));
        }

        static void MiniChorten(WB b, float x, float y, float z, float s = 1)
        {
            b.Box("white", new Vector3(x, y, z), new Vector3(1.1f * s, 0.7f * s, 1.1f * s));
            b.Box("white", new Vector3(x, y + 0.7f * s, z), new Vector3(0.85f * s, 0.4f * s, 0.85f * s));
            b.Lathe("white", new Vector3(x, y + 1.1f * s, z), new[]
            {
                new Vector2(0, 0), new Vector2(0.45f * s, 0), new Vector2(0.5f * s, 0.2f * s), new Vector2(0.42f * s, 0.45f * s), new Vector2(0.2f * s, 0.6f * s),
                new Vector2(0, 0.62f * s),
            }, 10);
            b.Cyl("gold", new Vector3(x, y + 1.65f * s, z), 0.13f * s, 0.04f * s, 0.7f * s, 6);
        }

        // ───────────────────────────── 出生 · 道班 ─────────────────────────────

        /// <summary>废弃道班：10 × 6 m 白墙、红腰带、铁皮顶</summary>
        static void Daoban(Pl p, Transform parent)
        {
            Piece(p, IdDaoban, "daoban", parent, BaseY(p, 5, 3, 0.05), b =>
            {
                b.Box("stoneDark", new Vector3(0, -0.5f, 0), new Vector3(10, 1.4f, 6));
                b.Box("white", new Vector3(0, 0.9f, 0), new Vector3(10, 2.4f, 6));
                b.Box("red", new Vector3(0, 2.75f, 0), new Vector3(10.08f, 0.4f, 6.08f));
                b.Box("tin", new Vector3(0, 3.15f, 0), new Vector3(10.8f, 0.14f, 7f), 0, -5.7f);
                b.Box("stoneDark", new Vector3(3.2f, 3.0f, -1.5f), new Vector3(0.7f, 1.4f, 0.7f));
                b.Box("blue", new Vector3(-1.5f, 0, 3.02f), new Vector3(1.2f, 2.1f, 0.08f));
                foreach (float x in new[] { 1.5f, 3.6f, -3.8f }) b.Box("black", new Vector3(x, 0.7f, 3.03f), new Vector3(1.0f, 1.0f, 0.08f));
                b.Box("blue", new Vector3(-1.5f, 2.1f, 3.06f), new Vector3(2.6f, 0.9f, 0.06f));
                b.ColBox(new Vector3(0, -0.5f, 0), new Vector3(10, 3.9f, 6));
            }, "道班");
        }

        static void Drums(Pl p, Transform parent)
        {
            Piece(p, IdDrums, "drums", parent, BaseY(p, 1.4, 1.4, 0.02), b =>
            {
                foreach (var (x, z, c) in new[] { (0f, 0f, "drumOrange"), (0.7f, 0.2f, "drumBlue"), (0.25f, 0.75f, "drumOrange") })
                {
                    b.Cyl(c, new Vector3(x, 0, z), 0.3f, 0.3f, 0.92f, 12);
                    b.ColCyl(new Vector3(x, 0, z), 0.32f, 0.92f);
                }
                b.Box("drumBlue", new Vector3(-0.9f, 0, 0.4f), new Vector3(0.6f, 0.6f, 0.92f), 34);
                b.ColBox(new Vector3(-0.9f, 0, 0.4f), new Vector3(0.6f, 0.6f, 0.92f), 34);
            });
        }

        static void Gravel(Pl p, Transform parent)
        {
            Piece(p, IdGravel, "gravel", parent, BaseY(p, 2.5, 2.5, 0.1), b =>
            {
                b.Lathe("rock", Vector3.zero, new[] { new Vector2(0, 0), new Vector2(2.6f, 0), new Vector2(1.6f, 0.6f), new Vector2(0.5f, 1.1f), new Vector2(0, 1.15f) }, 9);
                for (int k = 0; k < 6; k++) b.Rock("rockDark", new Vector3(Mathf.Cos(k) * 2.4f, 0, Mathf.Sin(k * 1.3f) * 2.2f), 0.25f, 0.7f, k);
                b.ColCyl(Vector3.zero, 2.2f, 1.1f);
            });
        }

        static void Milestone(Pl p, Transform parent)
        {
            Piece(p, IdMilestone, "milestone", parent, BaseY(p, 0.3, 0.2, 0.1), b =>
            {
                b.Box("white", Vector3.zero, new Vector3(0.55f, 0.95f, 0.28f));
                b.Box("red", new Vector3(0, 0.95f, 0), new Vector3(0.57f, 0.3f, 0.3f));
                b.ColBox(Vector3.zero, new Vector3(0.6f, 1.25f, 0.32f));
            }, "天路 K0");
        }

        // ───────────────────────────── ① 碉楼寨 ─────────────────────────────

        /// <summary>嘉绒四角碉：24 m，底 6.4 m 见方收到 4.6 m，木筋层、白色顶带与四角白石、小窗、高处木门和独木梯；顶上经幡杆，两条经幡拉到台地边</summary>
        static void Diaolou(Pl p, Transform parent)
        {
            const float H = 24, B = 6.4f, T = 4.6f;
            float Half(float y) => (B + (T - B) * (y / H)) / 2;
            float y0 = BaseY(p, 3.2, 3.2, 0.3);
            var go = Piece(p, IdDiaolou, "diaolou", parent, y0, b =>
            {
                b.Frustum("stone", new Vector3(0, -1.5f, 0), new Vector2(B + 0.25f, B + 0.25f), new Vector2(T, T), H + 1.5f);
                for (float y = 2.6f; y < H - 2; y += 2.9f) b.Box("wood", new Vector3(0, y, 0), Vector3.one * (Half(y) * 2 + 0.1f) + new Vector3(0, 0.14f - (Half(y) * 2 + 0.1f), 0));
                float top = Half(H) * 2;
                b.Box("white", new Vector3(0, H - 1.5f, 0), new Vector3(top + 0.12f, 1.5f, top + 0.12f));
                b.Box("ochre", new Vector3(0, H - 1.7f, 0), new Vector3(top + 0.2f, 0.18f, top + 0.2f));
                foreach (var (sx, sz) in new[] { (1, 1), (1, -1), (-1, 1), (-1, -1) }) CornerHorn(b, sx * (top / 2 - 0.25f), H, sz * (top / 2 - 0.25f));
                foreach (float face in new[] { 0f, 90f, 180f, 270f })
                foreach (float y in new[] { 7.5f, 11.2f, 14.6f, 17.8f, 20.6f })
                {
                    if (face == 0 && y < 8) continue;
                    var q = Quaternion.Euler(0, face, 0);
                    float off = Mathf.RoundToInt(y) % 2 == 1 ? 0.7f : -0.6f;
                    b.Box("black", q * new Vector3(off, y, Half(y) + 0.02f), new Vector3(0.34f, 0.95f, 0.06f), face);
                }
                float doorY = 5.2f, fz = Half(doorY) + 0.03f;
                b.Box("wood", new Vector3(0.2f, doorY, fz), new Vector3(0.9f, 1.6f, 0.1f));
                b.Rod("woodPale", new Vector3(0.9f, 0.1f, fz + 3.3f), new Vector3(0.35f, doorY + 0.2f, fz + 0.15f), 0.13f);
                b.Cyl("woodPale", new Vector3(top / 2 - 0.3f, H + 1.1f, -(top / 2 - 0.3f)), 0.07f, 0.05f, 4.2f, 6);
                b.ColBox(new Vector3(0, -2, 0), new Vector3(B, H + 3, B));
            }, "嘉绒四角碉");
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            diaolouTop = LW(o, yaw, 0, H + 1.4f, 0);
            conductors.Add(("Conductor_Diaolou", o, H + 1.4f));
            float tp = Half(H) * 2;
            flags.Banner(LW(o, yaw, tp / 2 - 0.3f, H + 4.6f, -(tp / 2 - 0.3f)), 2.4f, 0.8f, 2, yaw);
            foreach (var (lx, lz) in new[] { (-8f, 7f), (8f, 6f) })
            {
                var w = LW(o, yaw, lx, 0, lz);
                var end = Pole(new Vector2(w.x, w.z), 3.2f);
                flags.Line(LW(o, yaw, 0, H + 0.6f, 0), end, 0.05f);
            }
        }

        /// <summary>残碉：只剩 11–14 m，顶部四面墙断在不同高度，墙脚一堆塌下来的片石</summary>
        static void DiaolouRuin(Pl p, Transform parent)
        {
            float s = (float)p.scale;
            Piece(p, IdDiaolouRuin, $"diaolouRuin_{s:F2}", parent, BaseY(p, 3 * s, 3 * s, 0.3), b =>
            {
                float B = 6 * s, H = 11 * s, T = 5.2f * s;
                b.Frustum("stone", new Vector3(0, -1.5f, 0), new Vector2(B + 0.2f, B + 0.2f), new Vector2(T, T), H + 1.5f);
                for (float y = 2.6f; y < H - 1; y += 2.9f)
                {
                    float w = B + (T - B) * (y / H) + 0.1f;
                    b.Box("wood", new Vector3(0, y, 0), new Vector3(w, 0.14f, w));
                }
                float wt = 0.8f * s, half = T / 2;
                float[] tops = { 4.5f * s, 1.6f * s, 3.2f * s, 0.8f * s };
                var walls = new (float x, float z, float w, float d)[] { (0, half - wt / 2, T, wt), (half - wt / 2, 0, wt, T), (0, -half + wt / 2, T, wt), (-half + wt / 2, 0, wt, T) };
                for (int i = 0; i < 4; i++)
                {
                    var (x, z, w, d) = walls[i];
                    for (int k = 0; k < 3; k++)
                    {
                        float f = (k + 0.5f) / 3 - 0.5f;
                        float tall = tops[i] * (1 - Mathf.Abs(f) * (i % 2 == 1 ? 0.8f : 0.4f)) + (k == 1 ? 0.6f * s : 0);
                        if (w > d) b.Box("stone", new Vector3(x + f * w, H, z), new Vector3(w / 3, tall, d));
                        else b.Box("stone", new Vector3(x, H, z + f * d), new Vector3(w, tall, d / 3));
                    }
                }
                for (int k = 0; k < 10; k++)
                {
                    float a = k * 0.9f + 0.4f, r = B * 0.7f + (k % 3) * 0.8f;
                    b.Rock("rockDark", new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r), (0.5f + (k % 3) * 0.3f) * s, 0.5f, k);
                }
                b.ColBox(new Vector3(0, -2, 0), new Vector3(B, H + 2 + 3 * s, B));
            }, p.scale < 1 ? "残碉小丘" : "碉楼寨残碉");
        }

        /// <summary>嘉绒石砌民居：12 × 9 m，两层平顶（6.8 m）；一层片石、二层白墙、赭红檐带、正面木挑楼、屋顶小经堂；侧面石梯上屋顶（俯射位，举父的站位）</summary>
        static void House(Pl p, Transform parent)
        {
            const float W = 12, D = 9, F1 = 3.6f, F2 = 3.2f, R = F1 + F2;
            float y0 = BaseY(p, 6, 4.5, 0.05);
            var go = Piece(p, IdHouse, "house", parent, y0, b =>
            {
                b.Box("stone", new Vector3(0, -1.2f, 0), new Vector3(W, F1 + 1.2f, D));
                b.Box("white", new Vector3(0, F1, 0), new Vector3(W, F2, D));
                b.Box("ochre", new Vector3(0, R - 0.55f, 0), new Vector3(W + 0.12f, 0.45f, D + 0.12f));
                void Par(float lx, float lz, float w, float d) => b.Box("white", new Vector3(lx, R, lz), new Vector3(w, 0.7f, d));
                Par(0, D / 2 - 0.2f, W, 0.4f);
                Par(0, -D / 2 + 0.2f, W, 0.4f);
                Par(-W / 2 + 0.2f, 0, 0.4f, D);
                Par(W / 2 - 0.2f, 1.95f, 0.4f, 5.1f);
                foreach (var (sx, sz) in new[] { (1, 1), (1, -1), (-1, 1), (-1, -1) }) CornerHorn(b, sx * (W / 2 - 0.35f), R + 0.7f, sz * (D / 2 - 0.35f));
                b.Box("white", new Vector3(-3.2f, R, -2.3f), new Vector3(4.6f, 2.6f, 3.8f));
                b.Box("ochre", new Vector3(-3.2f, R + 2.25f, -2.3f), new Vector3(4.7f, 0.35f, 3.9f));
                b.Box("wood", new Vector3(-3.2f, R + 2.6f, -2.3f), new Vector3(5.0f, 0.18f, 4.2f));
                b.Box("wood", new Vector3(-3.4f, F1 + 0.1f, D / 2 + 0.75f), new Vector3(4.4f, 2.8f, 1.5f));
                TibetWindow(b, new Vector3(-3.4f, F1 + 0.8f, D / 2 + 1.51f), 1.6f, 1.3f);
                TibetWindow(b, new Vector3(1.0f, F1 + 0.8f, D / 2 + 0.01f), 1.1f, 1.3f);
                TibetWindow(b, new Vector3(4.0f, F1 + 0.8f, D / 2 + 0.01f), 1.1f, 1.3f);
                b.Box("wood", new Vector3(2.5f, 0, D / 2 + 0.03f), new Vector3(1.4f, 2.2f, 0.08f));
                // 侧面石梯：沿右墙从门前 4 m 处往后爬到屋顶后半的平台（走行面是一道 2 m 宽、36° 的斜坡碰撞盒，台阶只做外观；
                // 导航网格两边各收 0.5 m 还剩 1 m）。屋顶楼梯口 3.5 m 宽（右侧女儿墙只到 z −0.6）
                const int steps = 17;
                const float front = D / 2 + 4f, back = -0.6f;
                float rise = R / steps, run = (front - back) / steps;
                for (int k = 0; k < steps; k++)
                {
                    float topY = rise * (k + 1), lz = front - (k + 0.5f) * run;
                    b.Box("stoneDark", new Vector3(W / 2 + 1.0f, -1.2f, lz), new Vector3(2.0f, topY + 1.2f, run + 0.05f));
                }
                b.Box("stoneDark", new Vector3(W / 2 + 1.0f, -1.2f, (-D / 2 + back) / 2), new Vector3(2.0f, R + 1.2f, back + D / 2));
                b.ColRamp(new Vector3(W / 2 + 1.0f, 0, front + 0.2f), new Vector3(W / 2 + 1.0f, R, back), 2.0f, 0.6f);
                b.ColBox(new Vector3(W / 2 + 1.0f, -1.2f, (-D / 2 + back) / 2), new Vector3(2.0f, R + 1.2f, back + D / 2));
                b.ColBox(new Vector3(0, -1.2f, 0), new Vector3(W, R + 1.2f, D));
                b.ColBox(new Vector3(-3.4f, F1 + 0.1f, D / 2 + 0.75f), new Vector3(4.4f, 2.8f, 1.5f));
                b.ColBox(new Vector3(-3.2f, R, -2.3f), new Vector3(4.6f, 2.8f, 3.8f));
                b.ColBox(new Vector3(0, R, D / 2 - 0.2f), new Vector3(W, 0.7f, 0.4f));
                b.ColBox(new Vector3(0, R, -D / 2 + 0.2f), new Vector3(W, 0.7f, 0.4f));
                b.ColBox(new Vector3(-W / 2 + 0.2f, R, 0), new Vector3(0.4f, 0.7f, D));
                b.ColBox(new Vector3(W / 2 - 0.2f, R, 1.95f), new Vector3(0.4f, 0.7f, 5.1f));
            }, "嘉绒民居");
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            roofs.Add((new Vector2(o.x, o.z), o.y + R, 5f, LW(o, yaw, 2.5f, R + 0.02f, 2.0f)));
            flags.Line(LW(o, yaw, -W / 2 + 0.35f, R + 1.6f, D / 2 - 0.35f), LW(o, yaw, -3.2f, R + 3.4f, -2.3f), 0.04f);
            flags.Line(LW(o, yaw, W / 2 - 0.35f, R + 1.6f, D / 2 - 0.35f), LW(o, yaw, -3.2f, R + 3.4f, -2.3f), 0.04f);
        }

        static void BarleyRack(Pl p, Transform parent)
        {
            float L = p.len > 0 ? (float)p.len : 6;
            Piece(p, IdBarley, $"barley_{L:F0}", parent, BaseY(p, L / 2, 0.4, 0.15), b =>
            {
                int posts = Mathf.Max(3, Mathf.RoundToInt(L / 2) + 1);
                for (int k = 0; k < posts; k++) b.Cyl("woodPale", new Vector3(-L / 2 + L * k / (posts - 1), -0.2f, 0), 0.13f, 0.1f, 5.3f, 6);
                b.Seed(Mathf.RoundToInt((float)(p.x * 13 + p.z)));
                for (float y = 0.8f; y < 4.9f; y += 0.55f)
                {
                    b.Box("wood", new Vector3(0, y, 0), new Vector3(L + 0.3f, 0.07f, 0.08f));
                    for (float x = -L / 2 + 0.3f; x < L / 2 - 0.2f; x += 0.5f)
                        if (b.Rand() < 0.55f) b.Box("straw", new Vector3(x, y - 0.45f, 0), new Vector3(0.42f, 0.5f, 0.32f));
                }
                b.Box("wood", new Vector3(0, 5.1f, 0), new Vector3(L + 0.8f, 0.12f, 0.8f));
                b.ColBox(new Vector3(0, -0.2f, 0), new Vector3(L, 5.4f, 0.6f));
            }, "青稞架");
        }

        static void FieldWall(Pl p, Transform parent)
        {
            float L = (float)p.len;
            Piece(p, IdFieldWall, $"fieldWall_{L:F0}", parent, BaseY(p, L / 2, 0.45, 0.2), b =>
            {
                b.Box("stoneDark", new Vector3(0, -0.2f, 0), new Vector3(L, 1.35f, 0.85f));
                for (float x = -L / 2 + 0.4f; x < L / 2; x += 0.7f) b.Rock("rock", new Vector3(x, 1.0f, (x * 7) % 0.3f - 0.15f), 0.24f, 0.6f, (int)(x * 10));
                b.ColBox(new Vector3(0, -0.2f, 0), new Vector3(L, 1.4f, 0.9f));
            }, "梯田石墙");
        }

        /// <summary>玛尼堆：彩色刻石堆成的尖堆，顶上牦牛头骨，插一根小经幡杆</summary>
        static void ManiPile(Pl p, Transform parent)
        {
            float s = (float)p.scale;
            var go = Piece(p, IdManiPile, $"maniPile_{s:F2}", parent, BaseY(p, 1.4 * s, 1.4 * s, 0.15), b =>
            {
                b.Lathe("mani", Vector3.zero, new[]
                {
                    new Vector2(0, 0), new Vector2(1.45f * s, 0), new Vector2(1.25f * s, 0.5f * s), new Vector2(0.8f * s, 1.15f * s), new Vector2(0.3f * s, 1.6f * s),
                    new Vector2(0, 1.7f * s),
                }, 10);
                for (int k = 0; k < 9; k += 2)
                {
                    float a = k / 9f * Mathf.PI * 2;
                    b.Rock("rock", new Vector3(Mathf.Cos(a + 0.3f) * 1.5f * s, 0, Mathf.Sin(a + 0.3f) * 1.5f * s), 0.28f * s, 0.6f, k);
                }
                float sy = 1.62f * s;
                b.Box("mani", new Vector3(0, sy, 0.05f), new Vector3(0.34f, 0.26f, 0.5f));
                b.Rod("rock", new Vector3(0.12f, sy + 0.2f, -0.05f), new Vector3(0.48f, sy + 0.5f, -0.1f), 0.05f);
                b.Rod("rock", new Vector3(-0.12f, sy + 0.2f, -0.05f), new Vector3(-0.48f, sy + 0.5f, -0.1f), 0.05f);
                b.Cyl("mani", new Vector3(0.4f * s, sy * 0.6f, -0.3f * s), 0.05f, 0.04f, 2.6f * s + 0.6f, 5);
                b.ColCyl(new Vector3(0, -0.2f, 0), 1.4f * s, 1.9f * s);
            }, "玛尼堆");
            var o = go.transform.position;
            flags.Banner(LW(o, go.transform.eulerAngles.y, 0.4f * s, 1.62f * s * 0.6f + 2.6f * s + 0.5f, -0.3f * s), 1.4f * s, 0.45f,
                ((int)Math.Round(p.x) % 5 + 5) % 5, go.transform.eulerAngles.y);
        }

        /// <summary>巨石（网页 boulder：一大一小两块，碰撞柱可站）</summary>
        static void Boulder(Pl p, Transform parent)
        {
            float s = (float)p.scale;
            const float sq = 0.72f;
            float r = s / (sq * 1.75f);
            Piece(p, IdBoulder, $"boulder_{s:F1}", parent, GroundY(U(p.x, p.z)), b =>
            {
                b.Rock("rock", Vector3.zero, r, sq, Mathf.RoundToInt(s * 10));
                b.Rock("rock", new Vector3(r * 0.9f, 0, r * 0.4f), r * 0.35f, 0.6f, Mathf.RoundToInt(s * 10) + 1);
                b.ColCyl(new Vector3(0, -1, 0), r * 0.82f, s + 0.9f);
            }, "巨石");
        }

        /// <summary>牦牛：身体、驼峰、长毛裙、短腿、低头吃草的头（静止；吃草待机动作随美术管线）</summary>
        static void Yak(Pl p, Transform parent)
        {
            int seed = p.seed;
            string coat = (seed % 5) switch { 2 or 4 => "yakBrown", _ => "yak" };
            bool white = seed % 3 == 0;
            Piece(p, IdYak, $"yak_{coat}_{(white ? "w" : "d")}", parent, BaseY(p, 0.6, 1.2, 0.05), b =>
            {
                b.Ellipsoid(coat, new Vector3(0, 1.05f, -0.05f), new Vector3(0.62f, 0.55f, 1.12f));
                b.Ellipsoid(coat, new Vector3(0, 1.32f, 0.45f), new Vector3(0.5f, 0.42f, 0.6f));
                b.Cyl("tentBlack", new Vector3(0, 0.31f, -0.05f), 0.8f, 0.64f, 0.62f, 10);
                foreach (var (sx, sz) in new[] { (1, 1), (1, -1), (-1, 1), (-1, -1) }) b.Cyl("tentBlack", new Vector3(sx * 0.3f, 0, sz * 0.62f), 0.11f, 0.09f, 0.6f, 6);
                b.Ellipsoid(white ? "yakFace" : coat, new Vector3(0, 0.72f, 1.35f), new Vector3(0.27f, 0.3f, 0.42f), 8);
                b.Rod(white ? "yakFace" : "tentBlack", new Vector3(0.18f, 0.95f, 1.15f), new Vector3(0.48f, 1.1f, 1.1f), 0.05f);
                b.Rod(white ? "yakFace" : "tentBlack", new Vector3(-0.18f, 0.95f, 1.15f), new Vector3(-0.48f, 1.1f, 1.1f), 0.05f);
                b.ColBox(Vector3.zero, new Vector3(1.1f, 1.6f, 2.4f));
            }, "牦牛");
        }

        // ───────────────────────────── ② 白塔溪谷 ─────────────────────────────

        /// <summary>白塔：台基 9 m 见方 1.5 m 高（正面台阶），四层叠涩座、覆钵、塔脖、十三天、伞盖与日月顶，约 12.5 m；塔顶经幡拉到四角木杆</summary>
        static void Chorten(Pl p, Transform parent)
        {
            float y = 1.5f;
            var go = Piece(p, IdChorten, "chorten", parent, BaseY(p, 4.5, 6.5, 0.1), b =>
            {
                b.Box("white", new Vector3(0, -0.1f, 0), new Vector3(9, 1.6f, 9));
                b.Box("ochre", new Vector3(0, 1.3f, 0), new Vector3(9.1f, 0.2f, 9.1f));
                for (int k = 0; k < 3; k++)
                {
                    float lz = 4.5f + 1.5f - k * 0.6f - 0.3f;
                    b.Box("stoneDark", new Vector3(0, -0.1f, lz), new Vector3(3.2f, 0.5f * (k + 1) + 0.1f, 0.6f));
                    b.ColBox(new Vector3(0, -0.1f, lz), new Vector3(3.2f, 0.5f * (k + 1) + 0.1f, 0.6f));
                }
                float yy = 1.5f;
                foreach (var (s, t) in new[] { (6.4f, 1.0f), (5.6f, 0.8f), (4.9f, 0.7f), (4.3f, 0.6f) })
                {
                    b.Box("white", new Vector3(0, yy, 0), new Vector3(s, t, s));
                    b.Box(t > 0.75f ? "ochre" : "gold", new Vector3(0, yy + t - 0.1f, 0), new Vector3(s + 0.06f, 0.1f, s + 0.06f));
                    yy += t;
                }
                b.Lathe("white", new Vector3(0, yy, 0), new[]
                {
                    new Vector2(0, 0), new Vector2(1.95f, 0), new Vector2(2.2f, 0.35f), new Vector2(2.3f, 0.9f), new Vector2(2.2f, 1.6f), new Vector2(1.9f, 2.3f),
                    new Vector2(1.45f, 2.85f), new Vector2(0.9f, 3.15f), new Vector2(0, 3.25f),
                }, 18);
                b.Box("gold", new Vector3(0, yy + 0.95f, 2.31f), new Vector3(1.1f, 1.4f, 0.12f));
                b.Box("black", new Vector3(0, yy + 1.0f, 2.33f), new Vector3(0.75f, 1.05f, 0.14f));
                yy += 3.15f;
                b.Box("white", new Vector3(0, yy, 0), new Vector3(1.5f, 0.85f, 1.5f));
                b.Box("gold", new Vector3(0, yy + 0.72f, 0), new Vector3(1.62f, 0.16f, 1.62f));
                yy += 0.88f;
                b.Cyl("gold", new Vector3(0, yy, 0), 0.62f, 0.62f - 12 * 0.024f, 13 * 0.22f, 12);
                yy += 13 * 0.22f;
                b.Cyl("gold", new Vector3(0, yy, 0), 0.9f, 1.0f, 0.14f, 14);
                b.Ellipsoid("gold", new Vector3(0, yy + 0.62f, 0), Vector3.one * 0.16f, 8);
                b.Cyl("gold", new Vector3(0, yy + 0.76f, 0), 0.06f, 0, 0.45f, 6);
                y = yy;
                b.ColBox(new Vector3(0, -0.2f, 0), new Vector3(9, 1.7f, 9));
                b.ColBox(new Vector3(0, 1.5f, 0), new Vector3(6.4f, yy - 0.5f, 6.4f));
            }, "白塔");
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            var tip = LW(o, yaw, 0, 11.8f, 0);
            foreach (float a in new[] { 45f, 135f, 225f, 315f })
            {
                var w = LW(o, yaw, Mathf.Cos(a * Mathf.Deg2Rad) * 13, 0, Mathf.Sin(a * Mathf.Deg2Rad) * 13);
                flags.Line(tip, Pole(new Vector2(w.x, w.z), 2.2f), 0.035f);
            }
        }

        /// <summary>玛尼墙：片石墙身 + 刻石墙顶 + 两端小塔（可站）</summary>
        static void ManiWall(Pl p, Transform parent)
        {
            float L = (float)p.len;
            Piece(p, IdManiWall, $"maniWall_{L:F0}", parent, BaseY(p, L / 2, 0.8, 0.15), b =>
            {
                b.Box("stoneDark", new Vector3(0, -0.2f, 0), new Vector3(L, 0.75f, 1.4f));
                b.Box("mani", new Vector3(0, 0.55f, 0), new Vector3(L, 0.45f, 1.3f));
                b.Box("stone", new Vector3(0, 1.0f, 0), new Vector3(L + 0.2f, 0.18f, 1.55f));
                b.Seed(3);
                for (float x = -L / 2 + 0.6f; x < L / 2 - 0.5f; x += 0.55f)
                foreach (float lz in new[] { -0.35f, 0.35f })
                    b.Box("mani", new Vector3(x, 1.15f, lz), new Vector3(0.48f, 0.4f + b.Rand() * 0.15f, 0.12f), (b.Rand() - 0.5f) * 17, 0, lz * 28);
                MiniChorten(b, -L / 2 - 0.9f, -0.1f, 0, 1.1f);
                MiniChorten(b, L / 2 + 0.9f, -0.1f, 0, 1.1f);
                b.ColBox(new Vector3(0, -0.3f, 0), new Vector3(L, 1.55f, 1.56f));
                b.ColCyl(new Vector3(-L / 2 - 0.9f, -0.2f, 0), 0.7f, 2.8f);
                b.ColCyl(new Vector3(L / 2 + 0.9f, -0.2f, 0), 0.7f, 2.8f);
            }, "玛尼墙");
        }

        /// <summary>转经亭：四根红柱、金色攒尖顶，中间的大转经筒</summary>
        static void WheelHouse(Pl p, Transform parent)
        {
            Piece(p, IdWheelHouse, "wheelHouse", parent, BaseY(p, 2.3, 2.3, 0.1), b =>
            {
                b.Box("stoneDark", new Vector3(0, -0.15f, 0), new Vector3(4.4f, 0.45f, 4.4f));
                foreach (var (sx, sz) in new[] { (1, 1), (1, -1), (-1, 1), (-1, -1) })
                {
                    b.Cyl("red", new Vector3(sx * 1.75f, 0.3f, sz * 1.75f), 0.16f, 0.14f, 2.9f, 8);
                    b.ColCyl(new Vector3(sx * 1.75f, 0, sz * 1.75f), 0.2f, 3.2f);
                }
                b.Box("wood", new Vector3(0, 3.2f, 0), new Vector3(4.5f, 0.35f, 4.5f));
                b.Box("ochre", new Vector3(0, 3.0f, 0), new Vector3(4.6f, 0.25f, 4.6f));
                b.Frustum("gold", new Vector3(0, 3.55f, 0), new Vector2(4.7f, 4.7f), new Vector2(0.05f, 0.05f), 1.5f);
                b.Ellipsoid("gold", new Vector3(0, 5.15f, 0), Vector3.one * 0.2f, 8);
                b.Cyl("red", new Vector3(0, 0.55f, 0), 0.75f, 0.75f, 1.8f, 16);
                b.Cyl("gold", new Vector3(0, 0.5f, 0), 0.8f, 0.8f, 0.14f, 16);
                b.Cyl("gold", new Vector3(0, 2.28f, 0), 0.8f, 0.8f, 0.14f, 16);
                b.ColBox(new Vector3(0, -0.2f, 0), new Vector3(4.4f, 0.5f, 4.4f));
                b.ColCyl(new Vector3(0, 0.3f, 0), 0.85f, 2.5f);
            }, "转经亭");
        }

        /// <summary>水转经房：架在河上的小屋（地板在水面上 0.9 m），四根木桩，三面白墙</summary>
        static void WaterWheel(Pl p, Transform parent)
        {
            double g = field.HeightAt(p.x, p.z), wl = field.WaterLevelAt(p.x, p.z);
            double water = double.IsNegativeInfinity(wl) ? g : wl;
            float floor = (float)(water + 0.9), legH = (float)(floor - g + 1.5);
            Piece(p, IdWaterWheel, "waterWheel", parent, floor, b =>
            {
                foreach (var (sx, sz) in new[] { (1, 1), (1, -1), (-1, 1), (-1, -1) }) b.Cyl("woodPale", new Vector3(sx * 1.4f, -legH, sz * 1.4f), 0.14f, 0.12f, legH, 6);
                b.Box("wood", new Vector3(0, -0.2f, 0), new Vector3(3.6f, 0.2f, 3.6f));
                b.Box("white", new Vector3(0, 0, -1.5f), new Vector3(3.2f, 2.2f, 0.25f));
                b.Box("white", new Vector3(-1.5f, 0, 0), new Vector3(0.25f, 2.2f, 3.2f));
                b.Box("white", new Vector3(1.5f, 0, 0), new Vector3(0.25f, 2.2f, 3.2f));
                b.Box("ochre", new Vector3(0, 2.2f, 0), new Vector3(3.5f, 0.35f, 3.5f));
                b.Box("wood", new Vector3(0, 2.55f, 0), new Vector3(3.9f, 0.18f, 3.9f));
                b.Cyl("red", new Vector3(0, 0.45f, 0), 0.55f, 0.55f, 1.3f, 14);
                b.ColBox(new Vector3(0, -0.4f, 0), new Vector3(3.6f, 3.1f, 3.6f));
            }, "水转经房");
        }

        // ───────────────────────────── ③ 牧民营地 ─────────────────────────────

        /// <summary>牦牛毛黑帐篷：8 × 6.8 m，屋脊 2.6 m（截面六边形，沿长边拉伸）</summary>
        static void BlackTent(Pl p, Transform parent)
        {
            float s = (float)p.scale, L = 8 * s, D = 3.4f * s, H = 2.6f * s;
            Piece(p, IdBlackTent, $"blackTent_{s:F2}", parent, BaseY(p, L / 2, D, 0.1), b =>
            {
                b.Prism("tentBlack", Vector3.zero, new[]
                {
                    new Vector2(-D, -0.2f), new Vector2(-D * 0.88f, 1.3f * s), new Vector2(-0.3f, H), new Vector2(0.3f, H), new Vector2(D * 0.88f, 1.3f * s), new Vector2(D, -0.2f),
                }, L);
                b.Box("black", new Vector3(0.8f * s, 0, D * 0.93f), new Vector3(1.4f * s, 1.6f * s, 0.08f));
                foreach (int sx in new[] { -1, 1 }) b.Cyl("woodPale", new Vector3(sx * (L / 2 - 0.4f), 0, 0), 0.06f, 0.05f, H + 0.6f, 5);
                foreach (float sx in new[] { -1f, -0.33f, 0.33f, 1f })
                foreach (int sz in new[] { -1, 1 })
                    b.Rod("woodDark", new Vector3(sx * (L / 2 - 0.2f), 1.3f * s, sz * D * 0.88f), new Vector3(sx * (L / 2 + 0.9f), 0, sz * (D + 2.4f)), 0.025f, 4);
                b.ColBox(new Vector3(0, -0.2f, 0), new Vector3(L, H + 0.2f, D * 2));
            }, "黑帐篷");
        }

        static void WhiteTent(Pl p, Transform parent)
        {
            var go = Piece(p, IdWhiteTent, "whiteTent", parent, BaseY(p, 2.6, 2.1, 0.05), b =>
            {
                b.Box("tentWhite", new Vector3(0, -0.1f, 0), new Vector3(5, 1.7f, 4));
                b.Prism("tentWhite", new Vector3(0, 1.6f, 0), new[] { new Vector2(-2.25f, 0), new Vector2(0, 1.5f), new Vector2(2.25f, 0) }, 5.3f);
                b.Box("blue", new Vector3(0, 3.06f, 0), new Vector3(5.4f, 0.1f, 0.12f));
                b.Box("blue", new Vector3(0, -0.1f, 2.02f), new Vector3(1.2f, 1.5f, 0.06f));
                b.ColBox(new Vector3(0, -0.1f, 0), new Vector3(5, 3.2f, 4));
            }, "白帐篷");
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            flags.Line(LW(o, yaw, -2.6f, 3.0f, 0), LW(o, yaw, 2.6f, 3.0f, 0), 0, 0.42f, 0.6f);
        }

        static void DungWall(Pl p, Transform parent)
        {
            float L = (float)p.len;
            Piece(p, IdDungWall, $"dungWall_{L:F0}", parent, BaseY(p, L / 2, 0.35, 0.15), b =>
            {
                b.Box("dung", new Vector3(0, -0.15f, 0), new Vector3(L, 1.35f, 0.65f));
                for (float x = -L / 2 + 0.3f; x < L / 2; x += 0.55f) b.Cyl("yakBrown", new Vector3(x, 1.2f, 0), 0.26f, 0.24f, 0.09f, 8);
                b.ColBox(new Vector3(0, -0.15f, 0), new Vector3(L, 1.35f, 0.7f));
            }, "牛粪墙");
        }

        /// <summary>围栏：木桩跟着地面高低（每件单独一个网格）</summary>
        static void Fence(Pl p, Transform parent)
        {
            float L = (float)p.len;
            double th = WebYaw(p), c = Math.Cos(th), sn = Math.Sin(th);
            float y0 = GroundY(U(p.x, p.z));
            Piece(p, IdFence, $"fence_{p.x:F0}_{p.z:F0}", parent, y0, b =>
            {
                var posts = new List<Vector3>();
                for (float d = -L / 2; d <= L / 2 + 0.01f; d += 1.75f)
                {
                    double wx = p.x + d * c, wz = p.z - d * sn;
                    float y = (float)field.HeightAt(wx, wz) - y0;
                    b.Cyl("woodPale", new Vector3(d, y - 0.15f, 0), 0.07f, 0.06f, 1.35f, 5);
                    posts.Add(new Vector3(d, y, 0));
                }
                for (int i = 0; i < posts.Count - 1; i++)
                foreach (float yy in new[] { 0.45f, 0.95f })
                    b.Rod("woodPale", posts[i] + Vector3.up * yy, posts[i + 1] + Vector3.up * yy, 0.035f, 4);
                b.ColBox(new Vector3(0, -2, 0), new Vector3(L, 3.1f, 0.24f));
            }, "围栏");
        }

        /// <summary>煨桑炉：白色宝瓶形炉子（经幡山头那座是大烟柱）</summary>
        static void SangBurner(Pl p, Transform parent)
        {
            float s = p.big ? 1.45f : 1f;
            var go = Piece(p, IdSang, $"sang_{s:F2}", parent, BaseY(p, 1.1 * s, 1.1 * s, 0.1), b =>
            {
                b.Box("stoneDark", new Vector3(0, -0.1f, 0), new Vector3(2.4f * s, 0.4f * s, 2.4f * s));
                b.Lathe("white", new Vector3(0, 0.3f * s, 0), new[]
                {
                    new Vector2(0, 0), new Vector2(0.95f * s, 0), new Vector2(1.05f * s, 0.6f * s), new Vector2(0.95f * s, 1.1f * s), new Vector2(0.55f * s, 1.45f * s),
                    new Vector2(0.42f * s, 1.75f * s), new Vector2(0.5f * s, 1.85f * s), new Vector2(0, 1.85f * s),
                }, 14);
                b.Cyl("ochre", new Vector3(0, 0.8f * s, 0), 1.07f * s, 1.07f * s, 0.14f * s, 14);
                b.Box("black", new Vector3(0, 0.55f * s, 0.98f * s), new Vector3(0.5f * s, 0.45f * s, 0.1f));
                b.ColCyl(new Vector3(0, -0.2f, 0), 1.15f * s, 2.3f * s);
            }, p.big ? "煨桑炉（导航烟柱）" : "煨桑炉");
            if (p.big) sangSmoke = go.transform.position + Vector3.up * 2.2f * s;
        }

        static Vector3? sangSmoke;

        /// <summary>达觉：土丘上一簇高杆竖幡（都是导体），六条低经幡拉到地面木桩（避开天路）</summary>
        static void Darchor(Pl p, Transform parent)
        {
            var u = U(p.x, p.z);
            float y = GroundY(u);
            Piece(p, IdDarchor, "darchor", parent, y - 0.3f, b => { b.Rock("rock", Vector3.zero, 1.1f, 0.5f, 4); }, "达觉经幡");
            var spots = new (float dx, float dz, float h)[] { (0, 0, 9), (1.6f, 0.8f, 7.5f), (-1.4f, 1.2f, 8), (0.6f, -1.6f, 7), (-1.2f, -1.0f, 6.5f) };
            for (int i = 0; i < spots.Length; i++)
            {
                var (dx, dz, h) = spots[i];
                Pole(U(p.x + dx, p.z + dz), h, true, i);
            }
            var top = new Vector3(u.x, y + 8.4f, u.y);
            for (int k = 0; k < 6; k++)
            {
                double a = k / 6.0 * Math.PI * 2, ex = p.x + Math.Cos(a) * 10, ez = p.z + Math.Sin(a) * 10;
                if (field.RoadNearest(ex, ez).d < 4.5) continue;
                flags.Line(top, Pole(U(ex, ez), 0.9f), 0.02f);
            }
        }

        // ───────────────────────────── ④ 圣湖海子 ─────────────────────────────

        /// <summary>湖心小白塔：小台基 + 小塔，经幡拉到岛边的木桩</summary>
        static void Stupa(Pl p, Transform parent)
        {
            var go = Piece(p, IdStupa, "stupa", parent, BaseY(p, 1.7, 1.7, 0.2), b =>
            {
                b.Box("stoneDark", new Vector3(0, -0.2f, 0), new Vector3(3.4f, 0.5f, 3.4f));
                MiniChorten(b, 0, 0.3f, 0, 2.2f);
                b.ColCyl(new Vector3(0, -0.2f, 0), 1.4f, 5.2f);
            }, "湖心白塔");
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            var top = LW(o, yaw, 0, 0.3f + 1.65f * 2.2f + 1.2f, 0);
            foreach (float a in new[] { 0.6f, 2.7f, 4.8f })
            {
                var w = LW(o, yaw, Mathf.Cos(a) * 5.5f, 0, Mathf.Sin(a) * 5.5f);
                flags.Line(top, Pole(new Vector2(w.x, w.z), 1.0f), 0.02f);
            }
        }

        /// <summary>塔林：一排小白塔立在长台基上，塔顶之间连经幡</summary>
        static void ChortenRow(Pl p, Transform parent)
        {
            int n = p.count;
            float L = (float)p.len;
            var go = Piece(p, IdChortenRow, "chortenRow", parent, BaseY(p, L / 2 + 1, 1.2, 0.15), b =>
            {
                b.Box("stoneDark", new Vector3(0, -0.2f, 0), new Vector3(L + 2.2f, 0.45f, 2.2f));
                for (int i = 0; i < n; i++)
                {
                    float x = -L / 2 + L * i / (n - 1);
                    MiniChorten(b, x, 0.25f, 0, 1.15f);
                    b.ColCyl(new Vector3(x, 0.25f, 0), 0.7f, 2.65f);
                }
                b.ColBox(new Vector3(0, -0.2f, 0), new Vector3(L + 2.2f, 0.45f, 2.2f));
            }, "塔林");
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            for (int i = 0; i < n - 1; i++)
            {
                float x0 = -L / 2 + L * i / (n - 1), x1 = -L / 2 + L * (i + 1) / (n - 1), ty = 0.25f + 1.65f * 1.15f + 0.75f;
                flags.Line(LW(o, yaw, x0, ty, 0), LW(o, yaw, x1, ty, 0), 0.12f, 0.36f, 0.44f);
            }
            chortenRowTop = LW(o, yaw, 0, 0.25f, 0);
        }

        static Vector3 chortenRowTop;

        /// <summary>修行洞：一块大岩体，洞口前砌白墙、开门窗，经幡从岩顶拉下来</summary>
        static void Cave(Pl p, Transform parent)
        {
            var go = Piece(p, IdCave, "cave", parent, BaseY(p, 7, 4, 0.5), b =>
            {
                b.Rock("rockDark", new Vector3(0, -1.5f, -5.5f), 6.5f, 0.95f, 3);
                b.Rock("rock", new Vector3(-6.5f, -1, -3.8f), 5f, 0.9f, 7);
                b.Rock("rockDark", new Vector3(6.5f, -1, -4f), 4.6f, 0.85f, 11);
                b.Box("white", new Vector3(0, -0.3f, 0.4f), new Vector3(5.2f, 3.3f, 0.6f));
                b.Box("ochre", new Vector3(0, 2.65f, 0.4f), new Vector3(5.4f, 0.35f, 0.7f));
                b.Box("wood", new Vector3(0, 3.0f, 0.4f), new Vector3(5.8f, 0.15f, 1.0f));
                b.Box("wood", new Vector3(-1.0f, 0, 0.71f), new Vector3(0.9f, 1.8f, 0.08f));
                b.ColBox(new Vector3(0, -1, -4), new Vector3(18, 11, 9.6f));
            }, "修行洞");
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            var top = LW(o, yaw, 0, 9, -4);
            foreach (float sx in new[] { -6f, 6f })
            {
                var w = LW(o, yaw, sx, 0, 6);
                flags.Line(top, Pole(new Vector2(w.x, w.z), 2.6f), 0.05f);
            }
        }

        // ───────────────────────────── ⑤ 冰川口 ─────────────────────────────

        /// <summary>冰舌末端：一排高低不齐的冰块组成的冰崖（中间高两头低、微微内凹），顶上有冰塔；碰撞是冰崖背后的一整块（冰崖正面上不去）</summary>
        static void GlacierSnout(Pl p, Transform parent)
        {
            float L = (float)p.len;
            double th = WebYaw(p);
            float y0 = (float)field.HeightAt(p.x + Math.Sin(th) * 6, p.z + Math.Cos(th) * 6) - 1.2f;
            Piece(p, IdSnout, "glacierSnout", parent, y0, b =>
            {
                b.Seed(5);
                for (float x = -L / 2; x < L / 2; x += 3 + b.Rand() * 2)
                {
                    float edge = 1 - Mathf.Pow(Mathf.Abs(x) / (L / 2), 3);
                    float H = (9 + b.Rand() * 5) * (0.45f + 0.55f * edge);
                    float D = 7 + b.Rand() * 5, z = -0.006f * x * x;
                    b.Box(b.Rand() < 0.3f ? "iceBlue" : "ice", new Vector3(x, -0.5f, z - D / 2 + 1), new Vector3(3.6f + b.Rand() * 1.6f, H, D), (b.Rand() - 0.5f) * 14,
                        (b.Rand() - 0.5f) * 6, (b.Rand() - 0.5f) * 6);
                    if (b.Rand() < 0.65f)
                        b.Box("ice", new Vector3(x + (b.Rand() - 0.5f) * 2, H - 1, z - D * 0.35f), new Vector3(1.4f + b.Rand() * 1.6f, 2 + b.Rand() * 2.5f, 1.6f + b.Rand()),
                            b.Rand() * 170, (b.Rand() - 0.5f) * 22, (b.Rand() - 0.5f) * 22);
                }
                b.ColBox(new Vector3(0, -1, -3), new Vector3(L, 14, 9));
            }, "冰舌冰崖");
        }

        /// <summary>冰湖里的浮冰（不挡路）</summary>
        static void IceBlock(Pl p, Transform parent)
        {
            float s = (float)p.scale;
            double wl = field.WaterLevelAt(p.x, p.z);
            float y = (float)(double.IsNegativeInfinity(wl) ? field.HeightAt(p.x, p.z) : wl) - 0.45f * s;
            Piece(p, IdIceBlock, $"ice_{s:F1}", parent, y, b => b.Rock("ice", Vector3.zero, 1.0f * s, 0.55f, Mathf.RoundToInt(s * 10)), "浮冰");
        }

        // ───────────────────────────── ⑥ 经幡山头 ─────────────────────────────

        /// <summary>拉则：石堆上插一束经箭（约 10 m，导体），一圈经幡杆（离拉则 19 m、避开道路，都是导体）、几十条经幡从箭束顶上放射出去</summary>
        static void Lhatse(Pl p, Transform parent)
        {
            var go = Piece(p, IdLhatse, "lhatse", parent, BaseY(p, 2, 2, 0.15), b =>
            {
                b.Lathe("stoneDark", Vector3.zero, new[] { new Vector2(0, 0), new Vector2(2.2f, 0), new Vector2(2.1f, 0.8f), new Vector2(1.7f, 1.7f), new Vector2(1.2f, 2.3f), new Vector2(0, 2.4f) }, 14);
                for (int k = 0; k < 14; k++)
                {
                    float a = k / 14f * Mathf.PI * 2;
                    b.Rock("rock", new Vector3(Mathf.Cos(a) * 2.3f, 0, Mathf.Sin(a) * 2.3f), 0.35f + (k % 3) * 0.12f, 0.7f, k);
                }
                b.Seed(11);
                for (int k = 0; k < 16; k++)
                {
                    float a = b.Rand() * Mathf.PI * 2, rr = b.Rand() * 0.6f;
                    var bs = new Vector3(Mathf.Cos(a) * rr, 2.1f, Mathf.Sin(a) * rr);
                    float r2 = 0.7f + b.Rand();
                    var tip = new Vector3(Mathf.Cos(a) * r2, 7.5f + b.Rand() * 2.5f, Mathf.Sin(a) * r2);
                    b.Rod(k % 3 == 0 ? "red" : k % 3 == 1 ? "white" : "woodPale", bs, tip, 0.06f + b.Rand() * 0.04f, 5);
                }
                b.Cyl("white", new Vector3(0, 3.4f, 0), 1.1f, 0.95f, 0.5f, 12);
                b.ColBox(new Vector3(0, -0.2f, 0), new Vector3(3.2f, 9.2f, 3.2f));
            }, "拉则");
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            lhatseTop = LW(o, yaw, 0, 8.4f, 0);
            conductors.Add(("Conductor_Lhatse", o, 10f));
            var ring = new List<Vector3>();
            for (int k = 0; k < 9; k++)
            {
                float a = k / 9f * Mathf.PI * 2 + 0.2f;
                var w = LW(o, yaw, Mathf.Cos(a) * 19, 0, Mathf.Sin(a) * 19);
                if (field.RoadNearest(w.x, -w.z).d < 5.5) continue;
                ring.Add(Pole(new Vector2(w.x, w.z), 6, k % 2 == 0, k));
            }
            foreach (var q in ring) flags.Line(lhatseTop, q, 0.03f);
            for (int i = 0; i < ring.Count; i++)
            {
                var a = ring[i];
                var c = ring[(i + 1) % ring.Count];
                if (Vector3.Distance(a, c) < 25) flags.Line(a - Vector3.up * 0.4f, c - Vector3.up * 0.4f, 0.07f);
            }
            for (int k = 0; k < 12; k++)
            {
                float a = k / 12f * Mathf.PI * 2;
                var w = LW(o, yaw, Mathf.Cos(a) * 13, 0, Mathf.Sin(a) * 13);
                if (field.RoadNearest(w.x, -w.z).d < 5) continue;
                flags.Line(LW(o, yaw, 0, 7.6f, 0), Pole(new Vector2(w.x, w.z), 0.9f), 0.02f);
            }
        }

        // ───────────────────────────── ⑦ 垭口 ─────────────────────────────

        static void Stele(Pl p, Transform parent)
        {
            var go = Piece(p, IdStele, "stele", parent, BaseY(p, 1.4, 0.6, 0.2), b =>
            {
                b.Box("stoneDark", new Vector3(0, -0.2f, 0), new Vector3(2.8f, 0.6f, 1.2f));
                b.Box("stone", new Vector3(0, 0.4f, 0), new Vector3(2.2f, 3.4f, 0.5f));
                b.Box("stoneDark", new Vector3(0, 3.8f, 0), new Vector3(2.4f, 0.25f, 0.6f));
                b.Box("red", new Vector3(0, 1.2f, 0.26f), new Vector3(0.5f, 2.2f, 0.02f));
                b.ColBox(new Vector3(0, -0.2f, 0), new Vector3(2.8f, 4.2f, 1.2f));
            }, "垭口碑 折多山 4298");
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            flags.Line(LW(o, yaw, -1.1f, 4.0f, 0), LW(o, yaw, -6, 0.9f, 3), 0.04f);
        }

        /// <summary>避风石屋：5 × 4 × 2.4 m，平顶可上（侧面一道石阶，举父的站位）</summary>
        static void Shelter(Pl p, Transform parent)
        {
            float y0 = BaseY(p, 2.6, 2.1, 0.1);
            var go = Piece(p, IdShelter, "shelter", parent, y0, b =>
            {
                b.Box("stoneDark", new Vector3(0, -0.2f, 0), new Vector3(5, 2.5f, 4));
                b.Box("wood", new Vector3(0, 2.3f, 0), new Vector3(5.3f, 0.2f, 4.3f));
                b.Box("ochre", new Vector3(0, 2.05f, 0), new Vector3(5.1f, 0.25f, 4.1f));
                b.Box("wood", new Vector3(0.8f, 0, 2.01f), new Vector3(0.9f, 1.7f, 0.08f));
                for (int k = 0; k < 6; k++) b.Box("stone", new Vector3(-3.1f, -0.3f, 1.6f - k * 0.6f), new Vector3(1.2f, 0.42f * (k + 1) + 0.3f, 0.6f));
                b.ColRamp(new Vector3(-3.1f, 0, 2.1f), new Vector3(-3.1f, 2.5f, -1.5f), 1.2f, 0.5f);
                b.ColBox(new Vector3(0, -0.2f, 0), new Vector3(5.2f, 2.7f, 4.2f));
            }, "避风屋");
            roofs.Add((new Vector2(go.transform.position.x, go.transform.position.z), y0 + 2.5f, 2.3f, go.transform.position + Vector3.up * 2.52f));
            var o = go.transform.position;
            float yaw = go.transform.eulerAngles.y;
            flags.Line(LW(o, yaw, 2.4f, 2.6f, 2.0f), LW(o, yaw, -2.4f, 2.6f, -2.0f), 0.12f);
        }

        /// <summary>出口经幡门：两根 7.5 m 的经幡杆（导体）+ 三条横拉的经幡；门里的出口传送门在 Level_4_1.BuildExit</summary>
        static void FlagGate(Pl p, Transform parent)
        {
            float yaw = UnityYaw(WebYaw(p));
            var o = new Vector3((float)p.x, BaseY(p, 3.5, 1, 0.1), (float)-p.z);
            var A = LW(o, yaw, -3.4f, 0, 0);
            var B = LW(o, yaw, 3.4f, 0, 0);
            var ta = Pole(new Vector2(A.x, A.z), 7.5f, true, 0);
            var tb = Pole(new Vector2(B.x, B.z), 7.5f, true, 3);
            foreach (float dy in new[] { 0f, -0.7f, -1.4f }) flags.Line(ta + Vector3.up * dy, tb + Vector3.up * dy, 0.05f);
            gateCenter = o;
            gateObject = Piece(p, IdGate, "flagGate", parent, o.y, b =>
            {
                foreach (float sx in new[] { -3.4f, 3.4f }) b.Rock("rock", new Vector3(sx, 0, 0), 0.7f, 0.6f, (int)sx + 9);
            }, "经幡门（出口）");
        }

        /// <summary>温泉：三个石圈泉池（浅水），旁边拉一条经幡</summary>
        static void HotSpring(Pl p, Transform parent)
        {
            var pools = new (double dx, double dz, float r)[] { (0, 0, 2.6f), (5.5, 3, 2.0f), (-3.5, 5.5, 1.8f) };
            int i = 0;
            foreach (var (dx, dz, r) in pools)
            {
                double x = p.x + dx, z = p.z + dz;
                float g = (float)field.FootprintMin(x, z, r, r, 0);
                var q = P("hotSpringPool", x, z);
                Piece(q, IdHotSpring, $"hotSpring_{r:F1}", parent, g - 0.15f, b =>
                {
                    for (int k = 0; k < 14; k++)
                    {
                        float a = k / 14f * Mathf.PI * 2;
                        b.Rock("rock", new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r), 0.42f + (k % 3) * 0.12f, 0.55f, k + i * 3);
                    }
                }, "温泉泉池");
                hotPools.Add((new Vector3((float)x, g + 0.18f, (float)-z), r));
                i++;
            }
            var a0 = Pole(U(p.x - 5, p.z - 4), 3.2f);
            var c0 = Pole(U(p.x + 8, p.z - 2), 3.2f);
            flags.Line(a0, c0, 0.08f);
        }

        static List<(Vector3 surface, float r)> hotPools;

        // ───────────────────────────── 天路附属：挡土墙、木桥 ─────────────────────────────

        /// <summary>
        /// 盘山挡土墙（网页 computeWalls 的 1.5 m 段，内侧 cut 1.9 m 厚、顶面可站；外侧 fill 0.6 m 护墙）：
        /// 相邻、同侧、高差相近的段合并成一段（网页 79 段 → Unity 合并后的连续墙），整张图一个网格，碰撞盒逐段
        /// </summary>
        static GameObject BuildRetainingWalls(Transform parent)
        {
            var runs = new List<List<(double x, double z, double yaw, double len, double bottom, double top, double thick, bool cut)>>();
            foreach (var w in field.walls)
            {
                var last = runs.Count > 0 ? runs[^1] : null;
                var prev = last?[^1];
                if (prev is { } q && q.cut == w.cut && Math.Sqrt((q.x - w.x) * (q.x - w.x) + (q.z - w.z) * (q.z - w.z)) < 2.2 && Math.Abs(Mathf.DeltaAngle((float)(q.yaw * Mathf.Rad2Deg), (float)(w.yaw * Mathf.Rad2Deg))) < 25 && last.Count < 6)
                    last.Add(w);
                else runs.Add(new() { w });
            }
            var go = LevelKit.PlateauPiece(Dir, IdWall, "retainingWalls", parent, Vector3.zero, 0, 0, b =>
            {
                b.mirrorX = false;
                foreach (var run in runs)
                {
                    var a = run[0];
                    var z = run[^1];
                    double ax = a.x - Math.Sin(a.yaw) * a.len / 2, az = a.z - Math.Cos(a.yaw) * a.len / 2;
                    double bx = z.x + Math.Sin(z.yaw) * z.len / 2, bz = z.z + Math.Cos(z.yaw) * z.len / 2;
                    var c = U((ax + bx) / 2, (az + bz) / 2);
                    float len = (float)Math.Sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)) + 0.05f;
                    float bottom = (float)run.Min(r => r.bottom), top = (float)run.Average(r => r.top);
                    var dir = U(bx, bz) - U(ax, az);
                    float yaw = Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg;
                    var size = new Vector3((float)a.thick, top - bottom, len);
                    b.Box(a.cut ? "stone" : "stoneDark", new Vector3(c.x, bottom, c.y), size, yaw);
                    if (!a.cut) b.Box("stone", new Vector3(c.x, top - 0.06f, c.y), new Vector3(size.x + 0.1f, 0.12f, len), yaw);
                    b.ColBox(new Vector3(c.x, bottom, c.y), size, yaw);
                }
            }, $"盘山挡土墙 {runs.Count} 段");
            return go;
        }

        /// <summary>牧道过冰川河的木桥（网页 findBridges）：桥面在河谷底上 0.3 m，桥面碰撞可走，两侧扶手</summary>
        static void BuildBridges(Transform parent)
        {
            int i = 0;
            foreach (var br in field.bridges)
            {
                var p = P("bridge", br.x, br.z, yaw: br.yaw);
                float L = (float)br.len, W = (float)br.width;
                var go = Piece(p, IdBridge, $"bridge_{i++}", parent, (float)br.deckY, b =>
                {
                    b.Box("wood", new Vector3(0, -0.3f, 0), new Vector3(W, 0.3f, L));
                    for (float z = -L / 2 + 0.3f; z < L / 2; z += 0.55f) b.Box("woodPale", new Vector3(0, -0.02f, z), new Vector3(W + 0.1f, 0.05f, 0.42f));
                    foreach (int sx in new[] { -1, 1 })
                    {
                        for (float z = -L / 2 + 0.3f; z <= L / 2; z += 1.6f) b.Box("woodPale", new Vector3(sx * (W / 2 - 0.1f), 0, z), new Vector3(0.16f, 1.05f, 0.16f));
                        b.Box("wood", new Vector3(sx * (W / 2 - 0.1f), 1.0f, 0), new Vector3(0.12f, 0.12f, L));
                        b.ColBox(new Vector3(sx * (W / 2 - 0.1f), 0, 0), new Vector3(0.24f, 1.1f, L));
                    }
                    foreach (float z in new[] { -L / 2 + 0.6f, L / 2 - 0.6f }) b.Box("stoneDark", new Vector3(0, -2.4f, z), new Vector3(W + 0.6f, 2.2f, 1.0f));
                    b.ColBox(new Vector3(0, -2.5f, 0), new Vector3(W - 0.4f, 2.5f, L));
                }, br.road ? "桥" : "木桥");
                var o = go.transform.position;
                float yaw = go.transform.eulerAngles.y;
                foreach (int sx in new[] { -1, 1 })
                    flags.Line(LW(o, yaw, sx * (W / 2 - 0.1f), 1.05f, -L / 2 + 0.3f), LW(o, yaw, sx * (W / 2 - 0.1f), 1.05f, L / 2 - 0.3f), 0.03f, 0.36f, 0.42f);
            }
        }

        /// <summary>全图的经幡杆合成一个网格；每根 ≥ 1.5 m 的杆一个碰撞柱，≥ 3 m 的挂 F 路的 Conductor（经幡杆默认参数：引雷 5 m、带电约 10 s）</summary>
        static int BuildPoles(Transform parent, Transform conductorRoot)
        {
            var list = poles.ToList();
            LevelKit.PlateauPiece(Dir, IdPole, "flagPoles", parent, Vector3.zero, 0, 0, b =>
            {
                b.mirrorX = false;
                int k = 0;
                foreach (var (bp, h, _) in list)
                {
                    b.Cyl("pole", bp, 0.1f, 0.07f, h, 6);
                    if (h > 1.5f) b.Rock("rock", bp + Vector3.down * 0.1f, 0.45f, 0.6f, k++);
                }
            }, $"经幡杆 {list.Count} 根");
            int n = 0, c = 0;
            foreach (var (bp, h, conductor) in list)
            {
                if (h <= 1.5f) continue;
                var go = new GameObject(conductor ? $"Conductor_Pole_{++c}" : $"FlagPole_{n + 1}") { isStatic = true };
                go.transform.SetParent(conductor ? conductorRoot : parent, false);
                go.transform.position = bp;
                var cap = go.AddComponent<CapsuleCollider>();
                cap.radius = 0.2f;
                cap.height = h;
                cap.center = Vector3.up * h * 0.5f;
                if (conductor) go.AddComponent<Conductor>().height = h;
                n++;
            }
            foreach (var (name, bp, h) in conductors)
            {
                var go = new GameObject(name) { isStatic = true };
                go.transform.SetParent(conductorRoot, false);
                go.transform.position = bp;
                go.AddComponent<Conductor>().height = h;
            }
            return n;
        }
    }
}
