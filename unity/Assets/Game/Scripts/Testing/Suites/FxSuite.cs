using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;
using Random = UnityEngine.Random;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 战斗特效冒烟（bridge.sh playtest fx；场景 TestArena）：FX1 / FX2 逐项生成并截图，核对数量与状态：
    ///   资产：贴花材质（弹孔 / 熔池 / 法阵 / 涡旋）、枪口火焰材质、渲染器有贴花特性；
    ///   弹着点：沙（地形）/ 石（台子）/ 冰（冰面条带）/ 金属（临时挂 FxSurface 的铁板）各开几枪——地表判对、留下弹孔贴花；
    ///   枪口火焰：开枪那一帧出第一人称火焰（没有挂点时退回常数枪口）；元素曳光：火 / 雷 / 蚀各一张；闪电一张；
    ///   命中：普通 / 暴击（暴击率拉满）火花计数；破盾 / 破甲：给靶子挂护盾 / 护甲打穿，各一张；爆炸：一张 + 焦痕贴花；
    ///   出生：显形中、收尾两张，0.8 s 内显形完成；死亡：迸散一张，尸体溶解中一张，回收前溶完；
    ///   状态：灼烧 / 感电 / 蚀化 / 眩晕 / 减速 五只靶子各一张近景，外观组件挂上并显示对应状态；
    ///   熔池（熔金）/ 归墟（收束 + 爆开）各一张；
    ///   压力：8 只敌人全身着火感电 + 暴击连射 4 s + 3 次爆炸，记高 / 低画质下的同屏粒子峰值、被预算砍掉的数量、帧时间；
    ///   FX3 冰霜 / FX4 火狱逐项一张（见 FxSuite.Elements.cs；只跑这两段用 bridge.sh playtest fx-elements）。
    /// </summary>
    public partial class FxSuite : PlaytestSuite
    {
        public override string Id => "fx";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string Target = "jerboa_blade";

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        ArenaSpawner arena;
        Transform eye;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            weapons = FindAnyObjectByType<WeaponController>();
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            arena = ArenaSpawner.Instance ? ArenaSpawner.Instance : FindAnyObjectByType<ArenaSpawner>();
            if (!weapons || !motor || !vitals || !arena)
            {
                Fail($"缺少组件：weapons={weapons} motor={motor} vitals={vitals} arena={arena}（场景不是 TestArena？）");
                yield break;
            }
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            eye = weapons.eye.transform;
            vitals.stats.Add("playtest_fx", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            var quality = ArtQuality.Level;
            ArtQuality.Set(ArtQualityLevel.High, false);
            Line($"武器 {weapons.Active?.def.name}，画质 {ArtQuality.Label(ArtQuality.Level)}（原 {ArtQuality.Label(quality)}）");

            CheckAssets();
            if (ElementsOnly)
            {
                yield return FrostCase();
                yield return InfernoCase();
                ArtQuality.Set(quality, false);
                vitals.stats.Remove("playtest_fx");
                weapons.testFire = false;
                arena.Clear();
                yield break;
            }
            yield return Impacts();
            yield return MuzzleAndTracers();
            yield return Hits();
            yield return Breaks();
            yield return ExplosionCase();
            yield return SpawnCase();
            yield return DeathCase();
            yield return StatusCase();
            yield return Reactions();
            yield return FrostCase();
            yield return InfernoCase();
            yield return Stress();

            ArtQuality.Set(quality, false);
            vitals.stats.Remove("playtest_fx");
            vitals.stats.Remove("playtest_fx_crit");
            weapons.testFire = false;
            arena.Clear();
            Line($"FxDirector：命中火花 {FxDirector.Sparks}（暴击 {FxDirector.CritSparks}）、破盾 {FxDirector.Shatters}、破甲 {FxDirector.ArmorBreaks}、" +
                 $"死亡迸散 {FxDirector.Deaths}、出生显形 {FxDirector.Spawns}、状态外观 {FxDirector.StatusVisuals}");
            if (FxDirector.Sparks == 0) Fail("没有出过命中火花");
            if (FxDirector.CritSparks == 0) Fail("没有出过暴击火花");
        }

        // ───────────── 资产 ─────────────

        void CheckAssets()
        {
            var missing = new List<string>();
            foreach (var k in new[] { FxMaterialKind.DecalSprite, FxMaterialKind.DecalPool, FxMaterialKind.DecalRune, FxMaterialKind.DecalVortex })
                if (!FxMaterials.Decal(k)) missing.Add(FxMaterials.AssetName(k));
            var muzzle = FxMaterials.Muzzle;
            if (!muzzle || muzzle.name.Contains("fallback")) missing.Add("M_Fx_Muzzle");
            Line($"资产：贴花特性 {(Telegraph.DecalsSupported ? "有" : "没有")}，贴花 / 枪口材质{(missing.Count == 0 ? "齐全" : "缺 " + string.Join("、", missing))}；" +
                 $"粒子上限 {FxBudget.ParticleCap}，弹孔上限 {FxBudget.DecalCap}");
            if (!Telegraph.DecalsSupported) Fail("渲染器没有贴花特性（先跑 bridge.sh fx）");
            if (missing.Count > 0) Fail($"特效材质缺失：{string.Join("、", missing)}（先跑 bridge.sh fx）");
        }

        // ───────────── 弹着点 ─────────────

        IEnumerator Impacts()
        {
            var plate = GameObject.CreatePrimitive(PrimitiveType.Cube);
            plate.name = "FX Test Plate";
            plate.AddComponent<FxSurface>().kind = SurfaceKind.Metal;
            var basePos = arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 12;
            plate.transform.position = basePos + Vector3.right * 6 + Vector3.up * 1.2f;
            plate.transform.localScale = new Vector3(2.5f, 2.4f, 0.3f);
            plate.GetComponent<Renderer>().material.color = new Color(0.45f, 0.47f, 0.5f);

            var cases = new List<(string name, SurfaceKind want, Vector3 point, Vector3 normal)>();
            if (FindSurface(basePos, SurfaceKind.Sand, out var sand, out var sandN)) cases.Add(("sand", SurfaceKind.Sand, sand, sandN));
            if (arena.platforms.Length > 0 && arena.platforms[0])
            {
                var pb = arena.platforms[0].GetComponent<Collider>();
                if (pb)
                {
                    var p = pb.bounds.center + Vector3.back * (pb.bounds.extents.z) + Vector3.down * pb.bounds.extents.y * 0.3f;
                    cases.Add(("stone", SurfaceKind.Stone, p, Vector3.back));
                }
            }
            if (arena.iceStrip) cases.Add(("ice", SurfaceKind.Ice, arena.iceStrip.position + Vector3.up * 0.06f, Vector3.up));
            cases.Add(("metal", SurfaceKind.Metal, plate.transform.position + Vector3.back * 0.15f, Vector3.back));
            yield return null;

            foreach (var (name, want, point, normal) in cases)
            {
                int decals0 = FxDecals.ActiveCount;
                var stand = point + new Vector3(normal.x, 0, normal.z).normalized * 5f + (Mathf.Abs(normal.y) > 0.7f ? Vector3.back * 5f : Vector3.zero);
                Teleport(motor, stand);
                yield return null;
                Aim(motor, eye, point);
                yield return null;
                // 地表判定：从眼睛打一条射线看命中的碰撞体（跳过玩家自己）
                var hits = Physics.RaycastAll(eye.position, (point - eye.position).normalized, 40f, Layers.ShotMask, QueryTriggerInteraction.Ignore)
                    .Where(h => h.collider && !h.collider.transform.IsChildOf(motor.transform)).OrderBy(h => h.distance).ToArray();
                var hit = hits.Length > 0 ? hits[0] : default;
                var got = hits.Length > 0 ? Surfaces.Classify(in hit) : (SurfaceKind?)null;
                weapons.Active.reserve = weapons.Active.def.reserve;
                weapons.testFire = true;
                yield return new WaitForSeconds(0.32f);
                weapons.testFire = false;
                yield return null;
                yield return null;
                Shot(weapons.eye, $"fx_impact_{name}");
                yield return new WaitForSeconds(0.9f);
                Shot(weapons.eye, $"fx_hole_{name}");
                int made = FxDecals.ActiveCount - decals0;
                Line($"弹着点 · {name}：地表判定 {(got.HasValue ? got.Value.ToString() : "射线没打到")}（应 {want}），新弹孔 {made}，碰撞体 {(hit.collider ? hit.collider.name : "-")}");
                if (got != want) Fail($"弹着点 {name}：地表判成 {got}（应 {want}）");
                if (made <= 0) Fail($"弹着点 {name}：没留下弹孔贴花");
            }
            Destroy(plate);
        }

        /// <summary>出生点附近找一块判成 want 的地形</summary>
        static bool FindSurface(Vector3 around, SurfaceKind want, out Vector3 point, out Vector3 normal)
        {
            for (int i = 0; i < 40; i++)
            {
                float a = i * 0.7f, r = 4 + i * 0.6f;
                var p = around + new Vector3(Mathf.Cos(a) * r, 30, Mathf.Sin(a) * r);
                if (!Physics.Raycast(p, Vector3.down, out var h, 80, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                if (h.collider is not TerrainCollider || Surfaces.Classify(in h) != want || h.normal.y < 0.9f) continue;
                point = h.point;
                normal = h.normal;
                return true;
            }
            point = normal = default;
            return false;
        }

        // ───────────── 枪口火焰 / 曳光 / 闪电 ─────────────

        IEnumerator MuzzleAndTracers()
        {
            var basePos = arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 12;
            Teleport(motor, basePos);
            yield return null;
            var far = basePos + Vector3.forward * 30 + Vector3.up * 1.5f;
            Aim(motor, eye, far);
            yield return null;
            float t0 = MuzzleFlashes.LastFlashTime;
            weapons.Active.reserve = weapons.Active.def.reserve;
            weapons.testFire = true;
            float start = Time.time;
            while (MuzzleFlashes.LastFlashTime <= t0 && Time.time - start < 1.5f) yield return null;
            Shot(weapons.eye, "fx_muzzle");
            weapons.testFire = false;
            bool flashed = MuzzleFlashes.LastFlashTime > t0;
            Line($"枪口火焰：{(flashed ? $"✓（{(MuzzleFlashes.LastFlashOnSocket ? "挂点" : "常数枪口退路")}）" : "✗ 开枪没有出火焰")}");
            if (!flashed) Fail("开枪没有出第一人称枪口火焰");
            yield return new WaitForSeconds(0.3f);

            var w = weapons.Active;
            var original = w.element;
            foreach (var el in new[] { Element.Fire, Element.Shock, Element.Corrode })
            {
                w.element = el;
                Aim(motor, eye, far + Vector3.right * Random.Range(-2f, 2f));
                weapons.testFire = true;
                // 开枪后第二帧：曳光的弹头已经飞出一段（第一帧弹头还贴在枪口）；第一人称看曳光是往屏幕里缩的一小段，
                // 再从侧面 3 m 拍一张，看得清整条弹道的颜色和粗细
                yield return null;
                yield return null;
                Shot(weapons.eye, $"fx_tracer_{el.ToString().ToLowerInvariant()}");
                // 弹头这时在 15–20 m 外：侧面相机对准弹头那一段，3 m 外拍
                var heads = FindObjectsByType<LineRenderer>().Where(l => l.enabled && l.name == "Tracer Head").ToArray();
                var hd = heads.FirstOrDefault();
                Line($"曳光 · {el}：画着的弹头 {heads.Length} 条" + (hd ? $"，长 {Vector3.Distance(hd.GetPosition(0), hd.GetPosition(1)):F1} m，宽 {hd.endWidth:F3} m，色 {hd.endColor}" : ""));
                if (hd)
                {
                    var mid = (hd.GetPosition(0) + hd.GetPosition(1)) * 0.5f;
                    SideShot(mid, eye.right * 3f + Vector3.up * 0.6f, $"fx_tracer_{el.ToString().ToLowerInvariant()}_side");
                }
                if (heads.Length == 0) Fail($"{el} 开枪后没有画出曳光");
                weapons.testFire = false;
                yield return new WaitForSeconds(0.25f);
            }
            w.element = original;
            Fx.Lightning(basePos + new Vector3(-3, 4, 9), basePos + new Vector3(2, 0.2f, 11), Fx.ElementColor(Element.Shock), 0.1f);
            Aim(motor, eye, basePos + new Vector3(0, 2, 10));
            yield return null;
            yield return null;
            Shot(weapons.eye, "fx_lightning");
            yield return new WaitForSeconds(0.3f);
        }

        /// <summary>临时相机从 at + offset 看向 at 拍一张（不带 HUD、不带第一人称枪模）</summary>
        void SideShot(Vector3 at, Vector3 offset, string name)
        {
            var go = new GameObject("FX Side Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 55;
            cam.nearClipPlane = 0.05f;
            cam.cullingMask = ~(1 << Layers.FirstPerson);
            go.transform.position = at + offset;
            go.transform.LookAt(at);
            Shot(cam, name);
            Destroy(go);
        }

        // ───────────── 命中 / 暴击 ─────────────

        EnemyAI Spawn(Vector3 offset, float hp = 40000)
        {
            var ai = arena.Spawn(Target, false, offset);
            if (!ai)
            {
                Fail($"生成 {Target} 失败");
                return null;
            }
            ai.Health.maxHealth = hp;
            ai.Health.ResetVitals();
            return ai;
        }

        IEnumerator FaceEnemy(EnemyAI ai, float dist = 6f)
        {
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
            away.y = 0;
            Teleport(motor, ai.transform.position + away.normalized * dist);
            yield return null;
            Aim(motor, eye, BodyCenter(ai.Health));
        }

        IEnumerator Hits()
        {
            var ai = Spawn(Vector3.zero);
            if (!ai) yield break;
            yield return new WaitForSeconds(1f);
            yield return FaceEnemy(ai);
            int s0 = FxDirector.Sparks;
            weapons.Active.reserve = weapons.Active.def.reserve;
            weapons.testFire = true;
            for (float t = 0; t < 0.5f; t += Time.deltaTime)
            {
                if (ai && ai.Health) Aim(motor, eye, BodyCenter(ai.Health));
                yield return null;
            }
            yield return null;
            Shot(weapons.eye, "fx_hit");
            weapons.testFire = false;
            int normal = FxDirector.Sparks - s0;
            yield return new WaitForSeconds(0.3f);

            vitals.stats.Add("playtest_fx_crit", Stat.CritChance, 1f);
            int c0 = FxDirector.CritSparks;
            weapons.testFire = true;
            bool shot = false;
            for (float t = 0; t < 0.6f; t += Time.deltaTime)
            {
                if (ai && ai.Health) Aim(motor, eye, BodyCenter(ai.Health));
                if (!shot && FxDirector.CritSparks > c0)
                {
                    yield return null;
                    yield return null;
                    Shot(weapons.eye, "fx_crit");
                    shot = true;
                }
                yield return null;
            }
            weapons.testFire = false;
            vitals.stats.Remove("playtest_fx_crit");
            int crits = FxDirector.CritSparks - c0;
            Line($"命中火花：普通连射 0.5 s 出 {normal} 个；暴击连射 0.6 s 出 {crits} 个暴击火花");
            if (normal <= 0) Fail("连射打中靶子没有命中火花");
            if (crits <= 0) Fail("暴击没有出暴击火花（星芒）");
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
        }

        // ───────────── 破盾 / 破甲 ─────────────

        IEnumerator Breaks()
        {
            foreach (var layer in new[] { DamageLayer.Shield, DamageLayer.Armor })
            {
                var ai = Spawn(Vector3.zero);
                if (!ai) yield break;
                var d = ai.Health;
                if (layer == DamageLayer.Shield) d.maxShield = d.shield = 60;
                else d.maxArmor = d.armor = 60;
                yield return new WaitForSeconds(1f);
                yield return FaceEnemy(ai);
                bool broke = false;
                System.Action<Damageable> on = x =>
                {
                    if (x == d) broke = true;
                };
                if (layer == DamageLayer.Shield) GameEvents.EnemyShieldBroken += on;
                else GameEvents.EnemyArmorBroken += on;
                int before = layer == DamageLayer.Shield ? FxDirector.Shatters : FxDirector.ArmorBreaks;
                weapons.Active.reserve = weapons.Active.def.reserve;
                weapons.testFire = true;
                bool shot = false, hitShot = false;
                for (float t = 0; t < 6f && !shot; t += Time.deltaTime)
                {
                    if (ai && d) Aim(motor, eye, BodyCenter(d));
                    if (!hitShot && t > 0.15f && !broke)
                    {
                        hitShot = true;
                        Shot(weapons.eye, $"fx_hit_{layer.ToString().ToLowerInvariant()}");
                    }
                    if (broke)
                    {
                        weapons.testFire = false;
                        yield return null;
                        yield return null;
                        yield return null;
                        Shot(weapons.eye, $"fx_break_{layer.ToString().ToLowerInvariant()}");
                        shot = true;
                    }
                    yield return null;
                }
                weapons.testFire = false;
                if (layer == DamageLayer.Shield) GameEvents.EnemyShieldBroken -= on;
                else GameEvents.EnemyArmorBroken -= on;
                int after = layer == DamageLayer.Shield ? FxDirector.Shatters : FxDirector.ArmorBreaks;
                Line($"破{(layer == DamageLayer.Shield ? "盾" : "甲")}：{(broke ? "✓ 打穿" : "✗ 6 s 没打穿")}，特效 {after - before} 次");
                if (!broke) Fail($"{layer} 6 s 没打穿");
                else if (after <= before) Fail($"{layer} 打穿了但没有破层特效");
                arena.Clear();
                yield return new WaitForSeconds(0.4f);
            }
        }

        // ───────────── 爆炸 ─────────────

        IEnumerator ExplosionCase()
        {
            var basePos = arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 12;
            Teleport(motor, basePos);
            yield return null;
            var at = basePos + Vector3.forward * 9;
            float gy = Fx.GroundY(at + Vector3.up * 3, 10);
            if (!float.IsNegativeInfinity(gy)) at.y = gy + 0.4f;
            Aim(motor, eye, at + Vector3.up * 0.8f);
            yield return null;
            int decals0 = FxDecals.ActiveOf(FxDecalKind.Scorch);
            var info = DamageInfo.Simple(0, DamageSource.Explosion, at, Vector3.up);
            Combat.Explode(new ExplosionOptions(at, 3f, info) { noEnemies = true });
            yield return new WaitForSeconds(0.07f);
            Shot(weapons.eye, "fx_explosion");
            yield return new WaitForSeconds(0.25f);
            Shot(weapons.eye, "fx_explosion_late");
            yield return new WaitForSeconds(1.4f);
            Shot(weapons.eye, "fx_explosion_scorch");
            int made = FxDecals.ActiveOf(FxDecalKind.Scorch) - decals0;
            Line($"爆炸（半径 3 m）：焦痕贴花 {made} 个");
            if (made <= 0) Fail("爆炸没有留下焦痕贴花");
        }

        // ───────────── 出生 / 死亡 ─────────────

        IEnumerator SpawnCase()
        {
            var basePos = arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 12;
            Teleport(motor, arena.Center + (basePos - arena.Center).normalized * 7);
            yield return null;
            Aim(motor, eye, arena.Center + Vector3.up * 0.8f);
            yield return null;
            int s0 = FxDirector.Spawns;
            var ai = Spawn(Vector3.zero);
            if (!ai) yield break;
            var sm = ai.GetComponent<SpawnMaterialize>();
            yield return new WaitForSeconds(0.32f);
            float mid = sm ? sm.Amount : -1;
            Shot(weapons.eye, "fx_spawn_mid");
            yield return new WaitForSeconds(0.3f);
            Shot(weapons.eye, "fx_spawn_finale");
            yield return new WaitForSeconds(0.25f);
            bool done = sm && sm.Done;
            Line($"出生显形：组件 {(sm ? "✓" : "✗")}，0.32 s 时溶解量 {mid:F2}，0.87 s 时{(done ? "已完成" : "还没完成")}，计数 +{FxDirector.Spawns - s0}");
            if (!sm) Fail("出生没有挂 SpawnMaterialize");
            else
            {
                if (!(mid > 0.05f && mid < 0.95f)) Fail($"显形中途的溶解量 {mid:F2} 不在 (0.05, 0.95)");
                if (!done) Fail("0.87 s 时显形还没完成");
            }
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
        }

        IEnumerator DeathCase()
        {
            var ai = Spawn(Vector3.zero, 200);
            if (!ai) yield break;
            yield return new WaitForSeconds(1f);
            yield return FaceEnemy(ai, 6f);
            int d0 = FxDirector.Deaths;
            var d = ai.Health;
            var c = BodyCenter(d);
            var info = DamageInfo.Simple(99999, DamageSource.Weapon, c, (c - eye.position).normalized);
            info.knockback = 4;
            Combat.DamageEnemy(d, info);
            yield return null;
            yield return null;
            Shot(weapons.eye, "fx_death");
            var dd = ai ? ai.GetComponent<DeathDissolve>() : null;
            bool hadDissolve = dd;
            var body = ai ? ai.GetComponent<EnemyBody>() : null;
            float despawn = body ? body.despawnAfter : 6f;
            float t0 = Time.time;
            float amount = 0;
            bool mid = false;
            while (ai && Time.time - t0 < despawn + 1f)
            {
                if (dd) amount = Mathf.Max(amount, dd.Amount);
                if (!mid && dd && dd.Amount > 0.4f)
                {
                    mid = true;
                    if (ai) Aim(motor, eye, ai.transform.position + Vector3.up * 0.3f);
                    yield return null;
                    Shot(weapons.eye, "fx_death_dissolve");
                }
                yield return null;
            }
            Line($"死亡：迸散 +{FxDirector.Deaths - d0}，溶解组件 {(hadDissolve ? "✓" : "✗")}，回收前最大溶解量 {amount:F2}，尸体{(ai ? "还在" : "已回收")}");
            if (FxDirector.Deaths <= d0) Fail("击杀没有死亡迸散");
            if (!hadDissolve) Fail("死亡没有挂 DeathDissolve");
            else if (amount < 0.85f) Fail($"尸体回收前只溶到 {amount:F2}");
        }

        // ───────────── 状态 ─────────────

        IEnumerator StatusCase()
        {
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
            away.y = 0;
            away.Normalize();
            var side = Vector3.Cross(Vector3.up, away);
            var names = new[] { "burn", "shock", "corrode", "stun", "slow" };
            var list = new List<EnemyAI>();
            for (int i = 0; i < names.Length; i++)
            {
                var ai = Spawn(side * ((i - 2) * 2.6f));
                if (ai) list.Add(ai);
            }
            if (list.Count < names.Length) yield break;
            yield return new WaitForSeconds(1f);
            // 停掉 AI（站桩拍照），状态照常推进
            foreach (var ai in list) ai.enabled = false;
            var d = list.Select(a => a.Health).ToArray();
            for (int k = 0; k < 3; k++) EnemyStatus.Apply(d[0], Element.Fire, 30, 1, false);
            EnemyStatus.Apply(d[1], Element.Shock, 30, 1, false);
            EnemyStatus.Apply(d[1], Element.Shock, 30, 1, false);
            EnemyStatus.Apply(d[2], Element.Corrode, 30, 1, false);
            EnemyStatus.Apply(d[3], StatusId.Stun, new StatusApply(0, 6));
            EnemyStatus.Slow(d[4], 0.5f, 8);
            Teleport(motor, arena.Center + away * 9);
            yield return null;
            Aim(motor, eye, arena.Center + Vector3.up * 0.9f);
            yield return new WaitForSeconds(0.7f);
            Shot(weapons.eye, "fx_status_all");
            var want = new[] { StatusMask.Burn, StatusMask.Shock, StatusMask.Corrode, StatusMask.Stun, StatusMask.Slow };
            for (int i = 0; i < list.Count; i++)
            {
                var sfx = list[i] ? list[i].GetComponent<StatusFx>() : null;
                var showing = sfx ? sfx.Showing : StatusMask.None;
                PoseShot(list[i], -away * 0.6f + side * 0.4f, $"fx_status_{names[i]}");
                yield return null;
                Line($"状态 · {names[i]}：外观组件 {(sfx ? "✓" : "✗")}，显示 {showing}");
                if (!sfx) Fail($"{names[i]}：没有挂 StatusFx");
                else if ((showing & want[i]) == 0) Fail($"{names[i]}：StatusFx 没有显示 {want[i]}（{showing}）");
            }
            arena.Clear();
            yield return new WaitForSeconds(0.3f);
        }

        // ───────────── 熔池 / 归墟 ─────────────

        IEnumerator Reactions()
        {
            var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
            away.y = 0;
            away.Normalize();
            var a = Spawn(Vector3.zero);
            if (!a) yield break;
            yield return new WaitForSeconds(1f);
            a.enabled = false;
            Teleport(motor, a.transform.position + away * 8);
            yield return null;
            Aim(motor, eye, a.transform.position + Vector3.up * 0.4f);
            int p0 = ReactionSystem.Stats.pools;
            Combat.TriggerReaction(a.Health, Reaction.Meltdown, new TriggerOpts { power = 40, ignoreIcd = true, point = BodyCenter(a.Health) });
            yield return new WaitForSeconds(0.6f);
            Shot(weapons.eye, "fx_meltdown_pool");
            int pools = ReactionSystem.Stats.pools;
            yield return new WaitForSeconds(1.2f);
            Shot(weapons.eye, "fx_meltdown_pool_late");
            Line($"熔金：熔池 {p0} → {pools}");
            if (pools <= p0) Fail("熔金没有生成熔池");

            // 归墟换一只、站到熔池外面，免得两种贴花叠在一起看不清
            var side = Vector3.Cross(Vector3.up, away);
            var b = Spawn(side * 6f);
            if (!b) yield break;
            yield return new WaitForSeconds(1f);
            b.enabled = false;
            Teleport(motor, b.transform.position + away * 7);
            yield return null;
            Aim(motor, eye, b.transform.position + Vector3.up * 0.6f);
            Combat.TriggerReaction(b.Health, Reaction.Abyss, new TriggerOpts { power = 40, ignoreIcd = true, point = BodyCenter(b.Health) });
            yield return new WaitForSeconds(0.22f);
            Shot(weapons.eye, "fx_abyss_windup");
            float t0 = Time.time;
            yield return new WaitForSeconds(0.24f);
            Shot(weapons.eye, "fx_abyss_burst");
            yield return new WaitForSeconds(0.2f);
            Shot(weapons.eye, "fx_abyss_late");
            Line($"归墟：收束 0.22 s / 爆开 {0.22f + (Time.time - t0) - 0.2f:F2} s 各一张");
            arena.Clear();
            yield return new WaitForSeconds(0.5f);
        }

        // ───────────── 压力 ─────────────

        IEnumerator Stress()
        {
            foreach (var level in new[] { ArtQualityLevel.High, ArtQualityLevel.Low })
            {
                ArtQuality.Set(level, false);
                var list = new List<EnemyAI>();
                for (int i = 0; i < 8; i++)
                {
                    float ang = i * Mathf.PI * 2 / 8;
                    var ai = Spawn(new Vector3(Mathf.Cos(ang), 0, Mathf.Sin(ang)) * 3.2f, 400000);
                    if (ai) list.Add(ai);
                }
                yield return new WaitForSeconds(1f);
                foreach (var ai in list)
                {
                    if (!ai) continue;
                    ai.enabled = false;
                    for (int k = 0; k < 3; k++) EnemyStatus.Apply(ai.Health, Element.Fire, 40, 1, false);
                    EnemyStatus.Apply(ai.Health, Element.Shock, 40, 1, false);
                }
                var away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
                away.y = 0;
                Teleport(motor, arena.Center + away.normalized * 10);
                yield return null;
                vitals.stats.Add("playtest_fx_crit", Stat.CritChance, 1f);
                FxBudget.ResetPeak();
                weapons.Active.reserve = weapons.Active.def.reserve;
                weapons.testFire = true;
                float t0 = Time.time, dtSum = 0, dtMax = 0;
                int frames = 0, booms = 0;
                while (Time.time - t0 < 4f)
                {
                    var target = list.Where(x => x).OrderBy(_ => Random.value).FirstOrDefault();
                    if (target) Aim(motor, eye, BodyCenter(target.Health));
                    if (booms < 3 && Time.time - t0 > 1f + booms)
                    {
                        booms++;
                        var at = arena.Center + new Vector3(Random.Range(-2f, 2f), 0.5f, Random.Range(-2f, 2f));
                        Combat.Explode(new ExplosionOptions(at, 3f, DamageInfo.Simple(0, DamageSource.Explosion, at, Vector3.up)) { noEnemies = true });
                    }
                    if (frames == 90) Shot(weapons.eye, $"fx_stress_{level.ToString().ToLowerInvariant()}");
                    weapons.Active.reserve = weapons.Active.def.reserve;
                    float dt = Time.unscaledDeltaTime;
                    dtSum += dt;
                    dtMax = Mathf.Max(dtMax, dt);
                    frames++;
                    yield return null;
                }
                weapons.testFire = false;
                vitals.stats.Remove("playtest_fx_crit");
                Line($"压力（画质 {ArtQuality.Label(level)}）：同屏粒子峰值 {FxBudget.Peak} / 上限 {FxBudget.ParticleCap}，被预算砍掉 {FxBudget.Dropped} 颗，" +
                     $"贴花 {FxDecals.ActiveCount}，帧 {frames} 个，平均 {dtSum / Mathf.Max(1, frames) * 1000:F1} ms、最长 {dtMax * 1000:F1} ms");
                if (FxBudget.Peak > FxBudget.ParticleCap * 1.15f) Fail($"同屏粒子 {FxBudget.Peak} 超过上限 {FxBudget.ParticleCap} 的 115%");
                arena.Clear();
                yield return new WaitForSeconds(1.5f);
            }
            ArtQuality.Set(ArtQualityLevel.High, false);
        }
    }
}
