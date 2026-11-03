using System.Collections.Generic;
using System.Linq;
using Spiritfire.Game;
using UnityEngine;
using static Spiritfire.Art.Editor.Levels.Landform;
using Object = UnityEngine.Object;

namespace Spiritfire.Art.Editor.Levels
{
    // 3-3 各区的建筑与陈设（布局见 Level_3_3.cs、docs/level-design/maps/3-3.md 第 3 节）
    public static partial class Level_3_3
    {
        /// <summary>南闸楼（出生，T0 闸台 −9.5）：火山口南壁上的闸楼在背后，闸台两侧火坛</summary>
        static void BuildGate(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("South Gate").transform;
            root.SetParent(arch, false);
            Put(GatewayId, root, set, new Vector2(93, -1.5f), 0, 1f, 0.3f, GatewaySize);
            Put(AltarId, props, set, new Vector2(86, 10), 0, 1.2f, 0.05f, AltarSize);
            Put(AltarId, props, set, new Vector2(100, 10), 0, 1.2f, 0.05f, AltarSize);
            Put(IngotsId, props, set, new Vector2(100, 3.5f), 30, 1.1f, 0.1f, IngotsSize);
            Put(IngotsId, props, set, new Vector2(118, 10), -20, 1.2f, 0.1f, IngotsSize);
        }

        /// <summary>
        /// ① 范场（T1 −8）：三排南北向的范列（每排 4 件铸范，中间留出吊梁下的 4 m 过道），其中 4 件可破坏（只认爆炸 + 近战，炮仗的火箭也能炸掉——掩体会消耗）；
        /// 门式吊梁横跨范列（走道顶 −3，两端的墩是地形，带坡），西北、东南两张铸床（1.4 m，跳得上去）、渣堆（炭童余烬起身的地方）、锭堆
        /// </summary>
        static void BuildFanYard(LevelKit.TerrainSet set, Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("① Mould Yard").transform;
            root.SetParent(props, false);
            var breakable = new HashSet<Vector2> { new(41, 43), new(51, 59), new(61, 36), new(41, 66) };
            foreach (float x in new[] { 41f, 51f, 61f })
            foreach (float z in new[] { 36f, 43f, 59f, 66f })
            {
                var at = new Vector2(x, z);
                float yaw = 90 + (x + z) % 7 - 3;
                if (breakable.Contains(at)) BreakableMould(root, set, at, yaw);
                else PutLabeled(MouldId, root, set, at, yaw, MouldSize, "范列", 1, 0.05f);
            }
            PutLabeled(BedId, root, set, new Vector2(33, 38), 0, BedSize, "范场铸床", 1, 0.1f);
            PutLabeled(BedId, root, set, new Vector2(48, 71), 0, BedSize, "范场铸床", 1, 0.1f);
            Put(RuinId, root, set, new Vector2(35, 64), 25, 1.4f, 0.15f, RuinSize);
            Put(RuinId, root, set, new Vector2(52, 31.5f), -15, 1.4f, 0.15f, RuinSize);
            Put(IngotsId, root, set, new Vector2(77, 38), 20, 1.2f, 0.1f, IngotsSize);
            Put(CoverWallId, root, set, new Vector2(64, 71), 0, 1.1f, 0.2f, CoverWallSize);
            Put(IngotsId, root, set, new Vector2(37, 32), -40, 1.2f, 0.1f, IngotsSize);
            Put(AltarId, root, set, new Vector2(55, 51), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, root, set, new Vector2(38, 51), 0, 1.3f, 0.05f, AltarSize);

            // 门式吊梁走道（复用浇包吊车件；白盒）：顶 −3，搭在东西两墩上
            var gantry = LevelKit.PlaceOrBox(CraneId, arch, new Vector3((PierWest.max.x + PierEast.min.x) * 0.5f, PierWest.Top - 0.8f + 0.05f, 51),
                new Vector3(PierEast.min.x - PierWest.max.x + 2f, 0.8f, 3.5f), 0);
            Label(gantry, CraneId, "范场吊梁走道");
        }

        /// <summary>可破坏的铸范：外观 + 碰撞在 Intact 下（白盒时是暗铁色方块），只认爆炸 + 近战；碎了导航的洞跟着撤（挖洞障碍）</summary>
        static void BreakableMould(Transform parent, LevelKit.TerrainSet set, Vector2 at, float yaw)
        {
            var d = LevelKit.PlaceDestructible($"{MouldId} · 可碎铸范", parent, set.OnGround(at.x, at.y, -0.05f), yaw, MouldSize, Destructible.Kind.Clay, PlaceholderMat, 90f);
            d.accepts = Destructible.DamageKind.Explosion | Destructible.DamageKind.Melee;
            d.displayName = "铸范";
            d.coins = new Vector2Int(1, 3);
            if (ShowcaseSceneBuilder.Prefab(MouldId))
            {
                var body = d.intact.transform.Find("Body");
                if (body) Object.DestroyImmediate(body.gameObject);
                var go = LevelKit.PlaceOrBox(MouldId, d.intact.transform, d.transform.position, MouldSize, yaw);
                if (go) foreach (var t in go.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
            }
            else
            {
                var body = d.intact.transform.Find("Body");
                if (body) body.tag = LevelKit.PlaceholderTag;
            }
        }

        /// <summary>B1 瀑下桥（路遇）：两头桥头矮墙，东岸一根铁柱（毕方的栖点，俯瞰桥面）</summary>
        static void BuildRoadside(LevelKit.TerrainSet set, Transform props, Transform markers)
        {
            var root = new GameObject("B1 Fall Bridge").transform;
            root.SetParent(props, false);
            Put(BarricadeId, root, set, new Vector2(93.5f, 48), 90, 1.2f, 0.1f, BarricadeSize);
            Put(BarricadeId, root, set, new Vector2(112.5f, 56), 90, 1.2f, 0.1f, BarricadeSize);
            Put(CoverWallId, root, set, new Vector2(91, 56), 90, 1.1f, 0.2f, CoverWallSize);
            Put(CoverWallId, root, set, new Vector2(117, 48), 90, 1.1f, 0.2f, CoverWallSize);
            var col = Put(ColumnId, root, set, PerchB1, 0, 1.2f, 0.05f, ColumnSize);
            if (col) Marker(markers, "PerchPoint_B1", set.OnGround(PerchB1.x, PerchB1.y, ColumnSize.y * 1.2f - 0.1f));
        }

        /// <summary>
        /// ③ 浇包吊坊（T1 −8）：浇包吊车的横梁走道（顶 −4，北端搭在东中台崖边，玩家和马面都走得上去）南北向架在 x = CraneX，两根立柱在坊里；
        /// 两口浇包（熔流闸 S4，见 BuildSluices）吊在横梁下，各倒向一条往西的浇铸槽；东边两座工棚（增援门：敌人从工棚后冲出来）、东壁铸门（铁牛从这里走出来）、
        /// 铸床、铸范（槽间的掩体）、锭堆
        /// </summary>
        static void BuildLadleYard(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("③ Ladle Yard").transform;
            root.SetParent(arch, false);
            float len = CraneNorthZ - CraneSouthZ;
            var deck = LevelKit.PlaceOrBox(CraneId, root, new Vector3(CraneX, T2 - CraneDeckThick + 0.05f, (CraneNorthZ + CraneSouthZ) * 0.5f), new Vector3(CraneDeckW, CraneDeckThick, len), 0);
            Label(deck, CraneId, "浇包吊车横梁走道");
            foreach (float z in CraneLegZ)
            {
                var leg = LevelKit.PlaceOrBox(CraneId, root, new Vector3(CraneX + 1.2f, T1 - 0.1f, z), new Vector3(1.2f, T2 - T1 - CraneDeckThick + 0.1f, 1.4f), 0);
                Label(leg, CraneId, "浇包吊车立柱");
            }
            // 工棚（锦上添花件；缺件时锻铺放大顶上，不算占位）
            foreach (var z in new[] { 46f, 62f })
            {
                if (ShowcaseSceneBuilder.Prefab(ShedId)) Label(Put(ShedId, root, set, new Vector2(183, z), 90, 1f, 0.1f, ShedSize), ShedId, "工棚");
                else
                {
                    var stall = Put(StallId, root, set, new Vector2(183, z), 90, 2.4f, 0.05f, StallSize);
                    if (stall) stall.name = $"{stall.name} · 工棚（锻铺放大）";
                }
            }
            var gate = LevelKit.PlaceOrBox(GateId, root, set.OnGround(195.5f, 54, -0.1f), GateSize * 0.9f, 270, 0.9f);
            Label(gate, GateId, "东壁铸门");
            var p = new GameObject("③ Props").transform;
            p.SetParent(props, false);
            PutLabeled(BedId, p, set, new Vector2(144, 39.5f), 0, BedSize, "吊坊铸床", 1, 0.1f);
            PutLabeled(BedId, p, set, new Vector2(146, 69), 0, BedSize, "吊坊铸床", 1, 0.1f);
            PutLabeled(MouldId, p, set, new Vector2(158, 56), 90, MouldSize, "槽间铸范", 1, 0.05f);
            PutLabeled(MouldId, p, set, new Vector2(140, 53), 80, MouldSize, "槽间铸范", 1, 0.05f);
            PutLabeled(MouldId, p, set, new Vector2(166, 40), 10, MouldSize, "吊坊铸范", 1, 0.05f);
            PutLabeled(MouldId, p, set, new Vector2(131, 41), -20, MouldSize, "吊坊铸范", 1, 0.05f);
            Put(IngotsId, p, set, new Vector2(176, 70), 30, 1.2f, 0.1f, IngotsSize);
            Put(IngotsId, p, set, new Vector2(160, 37), -10, 1.2f, 0.1f, IngotsSize);
            Put(AltarId, p, set, new Vector2(176, 56), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, p, set, new Vector2(130, 56), 0, 1.3f, 0.05f, AltarSize);
        }

        /// <summary>东中台（T2 −4）：③ 的俯射层、吊车走道的北端，西头接 B2；东头是东引坡（沿东壁升到横渠南岸，B6 第二入场口）</summary>
        static void BuildMidTerrace(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Mid Terrace").transform;
            root.SetParent(props, false);
            Put(BarricadeId, root, set, new Vector2(150, 74.5f), 0, 1.2f, 0.1f, BarricadeSize);
            Put(BarricadeId, root, set, new Vector2(162, 74.5f), 0, 1.2f, 0.1f, BarricadeSize);
            Put(CoverWallId, root, set, new Vector2(118, 80), 30, 1.1f, 0.2f, CoverWallSize);
            Put(IngotsId, root, set, new Vector2(140, 88), 15, 1.2f, 0.1f, IngotsSize);
            Put(IngotsId, root, set, new Vector2(180, 86), -25, 1.2f, 0.1f, IngotsSize);
            Put(AltarId, root, set, new Vector2(186, 77), 0, 1.3f, 0.05f, AltarSize);
        }

        sealed class Hall
        {
            public Transform[] bellows;
            public Transform furnaceMouth;
            public Light[] lights;
        }

        /// <summary>
        /// 鼓风正殿（T2 −4，x 14–84、z 128–164）：南北两排、东侧两根 18 m 扶壁柱围出殿的轮廓（柱间的口子都能进），西头大炉（炉塔 × 1.3）、两段殿墙、炉前熔池；
        /// 两台巨型风箱（白盒，瘪着时 2.8 m 高的长掩体）把殿分成南北两条风箱道，中间 8 m 宽的十字口；道里六根 5 m 铁柱（飞鸦 / 毕方的栖点），
        /// 铁柱上架三榀殿顶屋架（下缘 14 m，给殿的轮廓和阴影）；西头南北两座炉坛 3.5 m、东北检修台 3 m。北边殿北坡贴着殿墙升到前庭（坡的南沿就是殿的北俯射层）。
        /// 风箱挂在各自的根节点下（底面贴地，按 Y 缩放：风闸拉开后鼓起来）
        /// </summary>
        static Hall BuildHall(LevelKit.TerrainSet set, Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("Blast Hall").transform;
            root.SetParent(arch, false);
            foreach (float x in ButtressSouthX) PutLabeled(ButtressId, root, set, new Vector2(x, ButtressSouthZ), 0, ButtressSize, "南扶壁", 1, 0.3f);
            foreach (float x in ButtressNorthX) PutLabeled(ButtressId, root, set, new Vector2(x, ButtressNorthZ), 180, ButtressSize, "北扶壁", 1, 0.3f);
            foreach (float z in ButtressEastZ) PutLabeled(ButtressId, root, set, new Vector2(ButtressEastX, z), 90, ButtressSize, "东扶壁", 1, 0.3f);
            Put(HallWallId, root, set, new Vector2(12, 133), 90, 1f, 0.3f, HallWallSize);
            Put(HallWallId, root, set, new Vector2(12, 159), 90, 1f, 0.3f, HallWallSize);
            PutLabeled(FurnaceId, root, set, FurnaceAt, 90, FurnaceSize, "大炉", 1.3f, 0.2f);

            var bellows = new List<Transform>();
            foreach (var (c, tag) in new[] { (BellowsA, "A"), (BellowsB, "B") })
            {
                var b = new GameObject($"Bellows {tag}").transform;
                b.SetParent(root, false);
                b.position = set.OnGround(c.x, c.y, -0.1f);
                // PlaceOrBox 摆 Prefab 按父节点本地坐标、白盒按世界坐标：先摆在原点的父节点下，再保持世界位置挂到风箱根下
                var piece = LevelKit.PlaceOrBox(BellowsId, root, b.position, BellowsSize, 180);
                if (piece)
                {
                    piece.transform.SetParent(b, true);
                    Label(piece, BellowsId, $"风箱 {tag}");
                    foreach (var t in piece.GetComponentsInChildren<Transform>(true)) t.gameObject.isStatic = false;
                }
                b.gameObject.isStatic = false;
                b.localScale = new Vector3(1, BellowsRest, 1);
                bellows.Add(b);
            }

            foreach (var (c, i) in HallColumns.Select((c, i) => (c, i)))
            {
                var col = Put(ColumnId, root, set, c, i * 37f, 1f, 0.05f, ColumnSize);
                if (col) Marker(markers, $"PerchPoint_Hall_{i + 1}", set.OnGround(c.x, c.y, ColumnSize.y - 0.05f));
            }
            // 殿顶屋架：南北跨在两排铁柱上（白盒按 30 m 跨度放，正式件 24 m 到货后按实测改），下缘离殿地 14 m
            float span = HallColumns[3].y - HallColumns[0].y;
            foreach (float x in TrussX)
            {
                // 白盒只画成一道梁（3 m 高、1.2 m 厚）：实心的 9 m 高方块会把殿顶的天光全挡掉
                var truss = LevelKit.PlaceOrBox(TrussId, root, new Vector3(x, T2 + 14f, (HallColumns[0].y + HallColumns[3].y) * 0.5f), new Vector3(span, 3f, 1.2f), 90,
                    span / TrussSize.x);
                Label(truss, TrussId, "殿顶屋架");
            }
            Put(AltarId, props, set, new Vector2(46, 130), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, props, set, new Vector2(62, 162), 0, 1.3f, 0.05f, AltarSize);
            Put(IngotsId, props, set, new Vector2(66, 130), 20, 1.2f, 0.1f, IngotsSize);
            Put(IngotsId, props, set, new Vector2(30, 162.5f), -30, 1.2f, 0.1f, IngotsSize);

            // 炉口（火星、火光）：炉塔正面往东 4.5 m、离地 2.2 m；两盏不投影的炉光（风闸拉开前很暗）
            var mouth = new GameObject("Furnace Mouth").transform;
            mouth.SetParent(markers, false);
            mouth.position = set.OnGround(FurnaceAt.x + 5f, FurnaceAt.y, 2.2f);
            var lights = new List<Light>();
            foreach (float dz in new[] { -3.5f, 3.5f })
            {
                var l = new GameObject("Furnace Light").AddComponent<Light>();
                l.transform.SetParent(props, false);
                l.transform.position = set.OnGround(FurnaceAt.x + 6f, FurnaceAt.y + dz, 3f);
                l.type = LightType.Point;
                l.color = new Color(1f, 0.5f, 0.2f);
                l.intensity = 0.4f;
                l.range = 24f;
                l.shadows = LightShadows.None;
                lights.Add(l);
            }
            return new Hall { bellows = bellows.ToArray(), furnaceMouth = mouth, lights = lights.ToArray() };
        }

        /// <summary>
        /// ⑥ 神范前庭（T3 0，x 56–96、z 166–212）：B5 西桥头北侧的闸前楼台（+3.5，地形，北边上坡）是俯射层，铸范 ×3、矮墙、铁柱；
        /// 西南角是风闸（俯瞰鼓风正殿）和炉工私藏
        /// </summary>
        static void BuildForecourt(LevelKit.TerrainSet set, Transform arch, Transform props, Transform markers)
        {
            var root = new GameObject("⑥ Forecourt").transform;
            root.SetParent(props, false);
            PutLabeled(MouldId, root, set, new Vector2(70, 184), 0, MouldSize, "前庭铸范", 1, 0.05f);
            PutLabeled(MouldId, root, set, new Vector2(77, 201), 90, MouldSize, "前庭铸范", 1, 0.05f);
            PutLabeled(MouldId, root, set, new Vector2(63, 197), 30, MouldSize, "前庭铸范", 1, 0.05f);
            Put(CoverWallId, root, set, new Vector2(80, 177), 0, 1.1f, 0.2f, CoverWallSize);
            Put(CoverWallId, root, set, new Vector2(60, 188), 90, 1.1f, 0.2f, CoverWallSize);
            Put(BarricadeId, root, set, new Vector2(72, 192), 20, 1.2f, 0.1f, BarricadeSize);
            foreach (var (c, i) in new[] { new Vector2(70, 207), new Vector2(93, 207) }.Select((c, i) => (c, i)))
            {
                var col = Put(ColumnId, root, set, c, i * 41f, 1f, 0.05f, ColumnSize);
                if (col) Marker(markers, $"PerchPoint_Forecourt_{i + 1}", set.OnGround(c.x, c.y, ColumnSize.y - 0.05f));
            }
            Put(AltarId, root, set, new Vector2(80, 168.5f), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, root, set, new Vector2(94, 196), 0, 1.3f, 0.05f, AltarSize);
            Put(IngotsId, root, set, new Vector2(66, 208), 0, 1.2f, 0.1f, IngotsSize);
        }

        /// <summary>废范龛（T2 −4，西北角，可选）：碎鼎、倒伏的废范、矮墙、锭堆——没出炉的残兵埋在这里（可选守军 + 藏宝）</summary>
        static void BuildScrapNiche(LevelKit.TerrainSet set, Transform props)
        {
            var root = new GameObject("Scrap Niche").transform;
            root.SetParent(props, false);
            Put(RuinId, root, set, new Vector2(14, 188), 20, 1.4f, 0.15f, RuinSize);
            Put(RuinId, root, set, new Vector2(32, 204), -30, 1.4f, 0.15f, RuinSize);
            Put(CoverWallId, root, set, new Vector2(28, 188), 0, 1.1f, 0.2f, CoverWallSize);
            PutLabeled(MouldId, root, set, new Vector2(30, 194), 35, MouldSize, "废范", 1, 0.3f);
            PutLabeled(MouldId, root, set, new Vector2(12, 198), -15, MouldSize, "废范", 1, 0.3f);
            PutLabeled(MouldId, root, set, new Vector2(22, 206), 60, MouldSize, "废范", 1, 0.3f);
            Put(IngotsId, root, set, new Vector2(34, 198), 10, 1.2f, 0.1f, IngotsSize);
            Put(AltarId, root, set, new Vector2(20, 184), 0, 1.3f, 0.05f, AltarSize);
        }

        /// <summary>主渠渠头的炉闸（北壁正中，王座下；熔铁闸门 × 1.2，白盒）压在主渠渠头，一盏常亮的熔铜光</summary>
        static void BuildSluiceHead(Transform arch, Transform props)
        {
            var root = new GameObject("Sluice").transform;
            root.SetParent(arch, false);
            var sluice = LevelKit.PlaceOrBox(GateId, root, new Vector3(SluiceAt.x, FieldFloor, SluiceAt.y), GateSize * 1.2f, 180, 1.2f);
            if (sluice) sluice.isStatic = true;
            Label(sluice, GateId, "炉闸");
            var l = new GameObject("Sluice Light").AddComponent<Light>();
            l.transform.SetParent(props, false);
            l.transform.position = new Vector3(SluiceAt.x, 2f, SluiceAt.y - 5f);
            l.type = LightType.Point;
            l.color = new Color(1f, 0.55f, 0.2f);
            l.intensity = 5f;
            l.range = 32f;
            l.shadows = LightShadows.None;
        }

        /// <summary>
        /// 神范台（首领场，原样）：东北角神范台 3.5 m 上立着神范（巨型铸范 × 3，白盒，出口在它前面）；四个象限各两件掩体（铸范 / 铸床）+ 一根 5 m 铁柱。
        /// 返回掩体点（给首领场地）
        /// </summary>
        static List<Vector2> BuildArenaProps(LevelKit.TerrainSet set, Transform arch, Transform props)
        {
            var root = new GameObject("Mould Dais").transform;
            root.SetParent(arch, false);
            var mould = LevelKit.PlaceOrBox(MouldId, root, set.OnGround(MouldAt.x, MouldAt.y, -0.1f), MouldSize * MouldScale, MouldYaw, MouldScale);
            if (mould) mould.isStatic = true;
            Label(mould, MouldId, "神范");
            MouldGlow(mould, props);
            var covers = new List<Vector2>();
            void Cover(string id, Vector2 at, float yaw, Vector3 size, string what)
            {
                Label(Put(id, root, set, at, yaw, 1f, 0.05f, size), id, what);
                covers.Add(at);
            }
            Cover(MouldId, new Vector2(124, 194), 0, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(136, 180), 90, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(166, 178), 0, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(122, 142), 90, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(136, 128), 0, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(170, 146), 0, MouldSize, "神范台掩体");
            Cover(MouldId, new Vector2(188, 130), 90, MouldSize, "神范台掩体");
            Cover(BedId, new Vector2(132, 206), 0, BedSize, "神范台铸床");
            Cover(BedId, new Vector2(168, 128), 0, BedSize, "神范台铸床");
            foreach (var c in new[] { new Vector2(116, 204), new Vector2(164, 206), new Vector2(116, 152), new Vector2(190, 152) })
            {
                Put(ColumnId, root, set, c, 0, 1f, 0.05f, ColumnSize);
                covers.Add(c);
            }
            // 两只火坛夹着神范台坡道的坡脚
            Put(AltarId, props, set, new Vector2(178.5f, 182.5f), 0, 1.3f, 0.05f, AltarSize);
            Put(AltarId, props, set, new Vector2(189.5f, 182.5f), 0, 1.3f, 0.05f, AltarSize);
            return covers;
        }

        /// <summary>
        /// 神范白盒时在顶上加一口发亮的浇口熔铜、腰上一道发亮的合范缝（子物体，没有碰撞，不算占位件；正式件到了就不加），
        /// 再在神范前挂一盏不投影的熔铜光（正式件也留着）
        /// </summary>
        static void MouldGlow(GameObject mould, Transform props)
        {
            if (!mould) return;
            var at = mould.transform.position;
            if (IsPlaceholder(mould))
            {
                var hot = LevelKit.GlowMat(Dir, "MouldGlow", new Color(1f, 0.5f, 0.2f), new Color(4f, 1.4f, 0.35f));
                foreach (var (name, pos, scale) in new[]
                         {
                             ("神范 · 浇口熔铜", new Vector3(0, 0.58f, 0), new Vector3(0.42f, 0.2f, 0.42f)),
                             ("神范 · 合范缝", new Vector3(0, 0.08f, 0), new Vector3(1.02f, 0.05f, 1.02f)),
                         })
                {
                    var g = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    g.name = name;
                    Object.DestroyImmediate(g.GetComponent<Collider>());
                    g.transform.SetParent(mould.transform, false);
                    g.transform.localPosition = pos;
                    g.transform.localRotation = Quaternion.identity;
                    g.transform.localScale = scale;
                    var r = g.GetComponent<MeshRenderer>();
                    r.sharedMaterial = hot;
                    r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                    g.isStatic = true;
                }
            }
            var l = new GameObject("Mould Light").AddComponent<Light>();
            l.transform.SetParent(props, false);
            l.transform.position = at + new Vector3(-5f, 4f, -5f);
            l.type = LightType.Point;
            l.color = new Color(1f, 0.55f, 0.2f);
            l.intensity = 4f;
            l.range = 22f;
            l.shadows = LightShadows.None;
        }

        static void BuildScatter(LevelKit.TerrainSet set, Transform env)
        {
            // 细节散布（没有碰撞）：余烬石沿渠岸，火山渣在台面上；避开桥头、台、坡道、浇铸槽、殿内
            float Clear(Vector2 p)
            {
                float d = float.MaxValue;
                foreach (var b in Bridges) d = Mathf.Min(d, Vector2.Distance(p, b.center) - b.width);
                foreach (var pl in Platforms) d = Mathf.Min(d, LevelKit.BoxSdf(p, pl.min, pl.max) - 1f);
                foreach (var r in Ramps) d = Mathf.Min(d, r.Sdf(p, out _) - 1f);
                foreach (var s in Sluices) d = Mathf.Min(d, Polyline(p, s.path).dist - s.width * 0.5f);
                d = Mathf.Min(d, LevelKit.BoxSdf(p, new Vector2(14, 128), new Vector2(84, 164)));
                return Mathf.Max(0, d);
            }
            var counts = LevelKit.ScatterDetails(set, LevelKit.ScatterPresets.Details("Inferno"), Clear, 1f, 160f);
            Debug.Log($"[Level] 3-3 散布：{string.Join("、", counts.Select(kv => $"{kv.Key} {kv.Value}"))}");
        }
    }
}
