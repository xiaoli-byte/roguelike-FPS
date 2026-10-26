using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 射击核心特效截图（bridge.sh playtest fx-shot；场景 TestArena；特效打磨 A 路的改前 / 改后对比用，截图名都带 fxa_ 前缀）：
    ///   武器：武器表里每一把各开一枪，拍开火那一帧的第一人称 + 从右侧 2 m 看枪口的第三人称（不画第一人称层）；
    ///   弹孔：石 / 沙 / 冰 / 金属各打一组单发，0.15 s（余热）和 3 s（冷却）各拍一张近景；焦痕：爆炸后 0.3 s / 1.5 s / 5 s 各一张；
    ///   命中：盾 / 甲 / 血肉 / 弱点各一张（第一人称 + 敌人侧面近景）；暴击：普通连射与暴击连射（暴击率拉满）0.25 s / 0.6 s 的第一人称 + 侧面近景；
    ///   抛壳：冲锋枪连射 0.6 s 后拍地上的弹壳，核对抛壳计数（有抛壳的武器才核）。
    /// 只做截图和少量计数核对，不跑压力（压力在 playtest fx）。
    /// </summary>
    public sealed class FxShotSuite : PlaytestSuite
    {
        public override string Id => "fx-shot";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string Target = "jerboa_blade";

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        ArenaSpawner arena;
        Transform eye;
        int fired;

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
            vitals.stats.Add("playtest_fxa", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            vitals.invulnerableUntil = Time.time + 99999;
            var quality = ArtQuality.Level;
            ArtQuality.Set(ArtQualityLevel.High, false);
            System.Action<WeaponInstance> onFired = _ => fired++;
            GameEvents.WeaponFired += onFired;
            try
            {
                yield return WeaponsCase();
                yield return ShellsCase();
                yield return HolesCase();
                yield return ScorchCase();
                yield return LayersCase();
                yield return CritCase();
            }
            finally
            {
                GameEvents.WeaponFired -= onFired;
                ArtQuality.Set(quality, false);
                vitals.stats.Remove("playtest_fxa");
                vitals.stats.Remove("playtest_fxa_crit");
                weapons.testFire = false;
                arena.Clear();
            }
        }

        /// <summary>弹匣、备弹补满（连射截图不能撞上换弹）</summary>
        void Refill()
        {
            var w = weapons.Active;
            if (w == null) return;
            w.reserve = w.def.reserve;
            w.mag = Mathf.Max(w.mag, w.def.mag);
        }

        Vector3 BasePos => arena.playerSpawn ? arena.playerSpawn.position : arena.Center + Vector3.back * 12;

        Vector3 Away
        {
            get
            {
                var a = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
                a.y = 0;
                return a.sqrMagnitude > 1e-4f ? a.normalized : Vector3.back;
            }
        }

        // ───────────── 武器 ─────────────

        IEnumerator WeaponsCase()
        {
            var defs = WeaponLibrary.All.ToList();
            Line($"武器 {defs.Count} 把：{string.Join("、", defs.Select(d => d.id))}");
            var at = BasePos;
            foreach (var def in defs)
            {
                weapons.testFire = false;
                var inst = new WeaponInstance(def);
                weapons.Give(inst);
                Teleport(motor, at);
                yield return new WaitForSeconds(0.8f);
                var fwd = -Away;
                var target = at + fwd * 16f + Vector3.up * 0.9f;
                Aim(motor, eye, target);
                yield return null;
                inst.reserve = def.reserve;
                int f0 = fired;
                int shells0 = ShellCasings.Ejected;
                float flash0 = MuzzleFlashes.LastFlashTime;
                weapons.testFire = true;
                float t0 = Time.time;
                bool charge = def.mode == FireMode.Charge;
                while (Time.time - t0 < 3f)
                {
                    Aim(motor, eye, target);
                    if (charge && Time.time - t0 > 1.4f) weapons.testFire = false;
                    if (fired > f0 && (def.flash <= 0 || MuzzleFlashes.LastFlashTime > flash0)) break;
                    yield return null;
                }
                bool ok = fired > f0;
                // 喷火 / 光束：持续开火，多等几帧让火焰 / 电弧长出来
                // 其余的就在火焰出来后的下一帧拍（火焰在上一帧渲染前生成，这一帧还没老化；多等一帧慢帧下 0.05 s 的火焰就没了）
                if (def.mode == FireMode.Beam || FlameCone.Handles(def))
                    for (int i = 0; i < 8; i++)
                    {
                        Aim(motor, eye, target);
                        yield return null;
                    }
                Shot(weapons.eye, $"fxa_w_{def.id}_fp");
                SideShot($"fxa_w_{def.id}_side");
                weapons.testFire = false;
                var wantShell = Fx.ShellOf(def);
                int shells = ShellCasings.Ejected - shells0;
                bool flashed = MuzzleFlashes.LastFlashTime > flash0;
                Line($"{def.name}（{def.id}）：{(ok ? "开火 ✓" : "✗ 3 s 没开火")}，枪口样式 {(flashed ? MuzzleFlashes.LastStyle.ToString() : "—")}" +
                     $"（应 {Fx.MuzzleStyleOf(def)}，第一人称缩放 {MuzzleFlashes.LastFpScale:F2}），抛壳 {shells}（{wantShell}）");
                if (!ok && !def.IsBlade) Fail($"{def.name} 3 s 内没开火");
                if (ok && !def.IsBlade && Fx.MuzzleStyleOf(def) != MuzzleStyle.None && !flashed) Fail($"{def.name} 开火没有枪口火焰");
                if (flashed && MuzzleFlashes.LastStyle != Fx.MuzzleStyleOf(def)) Fail($"{def.name} 枪口样式 {MuzzleFlashes.LastStyle}（应 {Fx.MuzzleStyleOf(def)}）");
                if (ok && wantShell != ShellKind.None && shells <= 0) Fail($"{def.name} 开火没有抛壳");
                if (wantShell == ShellKind.None && shells > 0) Fail($"{def.name} 不该抛壳却抛了 {shells} 枚");
                yield return new WaitForSeconds(0.35f);
            }
        }

        /// <summary>抛壳：步枪连射 0.5 s，0.1 s 时从右后方拍空中的弹壳，1.2 s 后拍地上的弹壳；核对叮当声</summary>
        IEnumerator ShellsCase()
        {
            var rifle = WeaponLibrary.Get("rifle");
            if (rifle == null) yield break;
            weapons.Give(new WeaponInstance(rifle));
            Teleport(motor, BasePos);
            yield return new WaitForSeconds(0.8f);
            var target = BasePos - Away * 16f + Vector3.up * 0.9f;
            Aim(motor, eye, target);
            yield return null;
            Refill();
            int e0 = ShellCasings.Ejected, c0 = ShellCasings.Clinks;
            weapons.testFire = true;
            bool air = false;
            for (float t = 0; t < 0.5f; t += Time.deltaTime)
            {
                Aim(motor, eye, target);
                if (!air && t > 0.12f)
                {
                    air = true;
                    var go = new GameObject("FXA Shell Camera");
                    var cam = go.AddComponent<Camera>();
                    cam.fieldOfView = 50;
                    cam.nearClipPlane = 0.03f;
                    cam.cullingMask = ~(1 << Layers.FirstPerson);
                    go.transform.position = eye.position + eye.right * 1.3f + eye.forward * 0.9f + Vector3.up * 0.1f;
                    go.transform.LookAt(eye.position + eye.right * 0.35f + eye.forward * 0.2f - Vector3.up * 0.3f);
                    Shot(cam, "fxa_shells_air");
                    Shot(weapons.eye, "fxa_shells_fp");
                    Destroy(go);
                }
                yield return null;
            }
            weapons.testFire = false;
            yield return new WaitForSeconds(1.1f);
            var ground = motor.transform.position + eye.right * 1.2f;
            var g2 = new GameObject("FXA Shell Ground Camera");
            var c2 = g2.AddComponent<Camera>();
            c2.fieldOfView = 50;
            c2.nearClipPlane = 0.03f;
            c2.cullingMask = ~(1 << Layers.FirstPerson);
            g2.transform.position = ground + Vector3.up * 1.1f - eye.forward * 0.9f;
            g2.transform.LookAt(ground);
            Shot(c2, "fxa_shells_ground");
            Destroy(g2);
            int ejected = ShellCasings.Ejected - e0, clinks = ShellCasings.Clinks - c0;
            Line($"抛壳（步枪连射 0.5 s）：抛出 {ejected} 枚，叮当 {clinks} 声，此刻在场 {ShellCasings.Live} 枚");
            if (ejected <= 0) Fail("步枪连射没有抛壳");
            if (clinks <= 0) Fail("弹壳落地没有叮当声（碰撞消息没收到？）");
        }

        /// <summary>第三人称：从枪口右侧 1.7 m、略靠前看枪口和弹道起点（不画第一人称层）</summary>
        void SideShot(string name)
        {
            var go = new GameObject("FXA Side Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 55;
            cam.nearClipPlane = 0.05f;
            cam.cullingMask = ~(1 << Layers.FirstPerson);
            var f = eye.forward;
            var r = eye.right;
            // 看向枪口（相机前 0.9 m、偏右下）稍前一点：枪口火焰在画面中间偏左，弹道往右伸出去
            var muzzle = eye.position + f * 0.9f + r * 0.18f - Vector3.up * 0.12f;
            go.transform.position = muzzle + r * 1.7f + f * 0.5f + Vector3.up * 0.15f;
            go.transform.LookAt(muzzle + f * 0.7f);
            Shot(cam, name);
            Destroy(go);
        }

        // ───────────── 弹孔 ─────────────

        IEnumerator HolesCase()
        {
            var rifle = WeaponLibrary.Get("rifle");
            if (rifle == null)
            {
                Fail("武器表里没有 rifle");
                yield break;
            }
            weapons.Give(new WeaponInstance(rifle));
            yield return new WaitForSeconds(0.8f);
            var plate = GameObject.CreatePrimitive(PrimitiveType.Cube);
            plate.name = "FXA Test Plate";
            plate.AddComponent<FxSurface>().kind = SurfaceKind.Metal;
            plate.transform.position = BasePos + Vector3.right * 6 + Vector3.up * 1.2f;
            plate.transform.localScale = new Vector3(2.5f, 2.4f, 0.3f);
            plate.GetComponent<Renderer>().material.color = new Color(0.45f, 0.47f, 0.5f);

            // 石：临时立一块挂 FxSurface 的石墙（台子前面常有坡道挡住）
            var stone = GameObject.CreatePrimitive(PrimitiveType.Cube);
            stone.name = "FXA Test Stone";
            stone.AddComponent<FxSurface>().kind = SurfaceKind.Stone;
            stone.transform.position = BasePos + Vector3.left * 6 + Vector3.up * 1.2f;
            stone.transform.localScale = new Vector3(2.5f, 2.4f, 0.6f);
            stone.GetComponent<Renderer>().material.color = new Color(0.62f, 0.56f, 0.5f);

            var cases = new List<(string name, Vector3 point, Vector3 normal)>();
            if (FindSurface(BasePos, SurfaceKind.Sand, out var sand, out var sandN)) cases.Add(("sand", sand, sandN));
            cases.Add(("stone", stone.transform.position + Vector3.back * 0.3f, Vector3.back));
            if (arena.iceStrip) cases.Add(("ice", arena.iceStrip.position + Vector3.up * 0.06f, Vector3.up));
            cases.Add(("metal", plate.transform.position + Vector3.back * 0.15f, Vector3.back));
            yield return null;

            foreach (var (name, point, normal) in cases)
            {
                var flat = new Vector3(normal.x, 0, normal.z);
                var stand = point + (flat.sqrMagnitude > 0.1f ? flat.normalized * 5f : Vector3.back * 5f);
                Teleport(motor, stand);
                yield return null;
                // 法线的两根切向轴：在命中点周围打一圈 5 发单发
                var t1 = Vector3.Cross(normal, Mathf.Abs(normal.y) > 0.9f ? Vector3.forward : Vector3.up).normalized;
                var t2 = Vector3.Cross(normal, t1);
                var offs = new[] { Vector2.zero, new Vector2(0.45f, 0.15f), new Vector2(-0.4f, 0.3f), new Vector2(0.1f, -0.45f), new Vector2(-0.35f, -0.3f) };
                int decals0 = FxDecals.HolesMade;
                foreach (var o in offs)
                {
                    var p = point + t1 * o.x + t2 * o.y;
                    Aim(motor, eye, p);
                    yield return null;
                    Refill();
                    int f0 = fired;
                    weapons.testFire = true;
                    for (float t = 0; t < 1f && fired == f0; t += Time.deltaTime) yield return null;
                    weapons.testFire = false;
                    yield return new WaitForSeconds(0.14f);
                }
                Aim(motor, eye, point);
                yield return null;
                var probe = Physics.RaycastAll(eye.position, (point - eye.position).normalized, 40f, Layers.ShotMask, QueryTriggerInteraction.Ignore)
                    .Where(h => h.collider && !h.collider.transform.IsChildOf(motor.transform)).OrderBy(h => h.distance).FirstOrDefault();
                Line($"  {name}：射线打到 {(probe.collider ? $"{probe.collider.name}（{probe.distance:F1} m，离瞄准点 {Vector3.Distance(probe.point, point):F2} m）" : "—")}");
                CloseShot(point, normal, t1, $"fxa_hole_{name}_hot");
                yield return new WaitForSeconds(3f);
                CloseShot(point, normal, t1, $"fxa_hole_{name}");
                Line($"弹孔 · {name}：新弹孔 {FxDecals.HolesMade - decals0}");
                if (FxDecals.HolesMade - decals0 <= 0) Fail($"弹孔 {name}：没留下贴花");
            }
            Destroy(plate);
            Destroy(stone);
        }

        /// <summary>近景：离命中点 1.1 m、沿切向偏 0.6 m 斜看（凹凸要侧光才看得出）</summary>
        void CloseShot(Vector3 point, Vector3 normal, Vector3 tangent, string name)
        {
            var go = new GameObject("FXA Close Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 50;
            cam.nearClipPlane = 0.03f;
            cam.cullingMask = ~(1 << Layers.FirstPerson);
            go.transform.position = point + normal * 1.05f + tangent * 0.55f + (Mathf.Abs(normal.y) > 0.9f ? Vector3.back * 0.3f : Vector3.up * 0.2f);
            go.transform.LookAt(point);
            Shot(cam, name);
            Destroy(go);
        }

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

        // ───────────── 焦痕 ─────────────

        IEnumerator ScorchCase()
        {
            Teleport(motor, BasePos);
            yield return null;
            var at = BasePos - Away * 8f;
            float gy = Fx.GroundY(at + Vector3.up * 3, 10);
            if (!float.IsNegativeInfinity(gy)) at.y = gy + 0.4f;
            Aim(motor, eye, at);
            yield return null;
            var info = DamageInfo.Simple(0, DamageSource.Explosion, at, Vector3.up);
            Combat.Explode(new ExplosionOptions(at, 3f, info) { noEnemies = true });
            var ground = new Vector3(at.x, at.y - 0.4f, at.z);
            var side = Vector3.Cross(Vector3.up, Away);
            foreach (var (wait, name) in new[] { (0.3f, "fxa_scorch_a"), (1.2f, "fxa_scorch_b"), (3.5f, "fxa_scorch_c") })
            {
                yield return new WaitForSeconds(wait);
                var go = new GameObject("FXA Scorch Camera");
                var cam = go.AddComponent<Camera>();
                cam.fieldOfView = 50;
                cam.nearClipPlane = 0.05f;
                cam.cullingMask = ~(1 << Layers.FirstPerson);
                go.transform.position = ground + Away * 3.2f + side * 1.2f + Vector3.up * 3f;
                go.transform.LookAt(ground);
                Shot(cam, name);
                Destroy(go);
            }
            Line($"焦痕：{FxDecals.ActiveOf(FxDecalKind.Scorch)} 个");
        }

        // ───────────── 命中层 ─────────────

        /// <summary>靶子位置：离武器架上的展示枪和台子都远的一点（近景相机不被挡）</summary>
        Vector3 ClearOffset()
        {
            var blockers = new List<Vector3>();
            if (arena.weaponRack)
                foreach (Transform t in arena.weaponRack.GetComponentsInChildren<Transform>())
                    blockers.Add(t.position);
            foreach (var p in arena.platforms)
                if (p) blockers.Add(p.position);
            Vector3 best = Vector3.zero;
            float bestD = -1;
            for (int i = 0; i < 24; i++)
            {
                float a = i * Mathf.PI * 2 / 24;
                for (float r = 4; r <= 10; r += 3)
                {
                    var o = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * r;
                    var at = arena.Center + o;
                    // 近景相机和玩家都在靶子的 Away 一侧：那一侧 5 m 内也算
                    float d = float.MaxValue;
                    foreach (var b in blockers)
                    {
                        var flat = new Vector3(b.x - at.x, 0, b.z - at.z);
                        d = Mathf.Min(d, flat.magnitude);
                        var mid = at + Away * 3f;
                        d = Mathf.Min(d, new Vector3(b.x - mid.x, 0, b.z - mid.z).magnitude);
                    }
                    if (d > bestD)
                    {
                        bestD = d;
                        best = o;
                    }
                }
            }
            return best;
        }

        Vector3? clear;

        EnemyAI Spawn(Vector3 offset, float hp = 40000)
        {
            clear ??= ClearOffset();
            var ai = arena.Spawn(Target, false, offset + clear.Value);
            if (!ai)
            {
                Fail($"生成 {Target} 失败");
                return null;
            }
            ai.Health.maxHealth = hp;
            ai.Health.ResetVitals();
            // 截图要站桩：不被击退推走
            ai.knockbackResist = 1;
            return ai;
        }

        IEnumerator Face(EnemyAI ai, float dist = 6f)
        {
            Teleport(motor, ai.transform.position + Away * dist);
            yield return null;
            Aim(motor, eye, BodyCenter(ai.Health));
        }

        void EnemyClose(EnemyAI ai, string name)
        {
            if (!ai) return;
            var side = Vector3.Cross(Vector3.up, Away);
            PoseShot(ai, (Away * 0.75f + side * 0.65f).normalized, name);
        }

        IEnumerator LayersCase()
        {
            var smg = WeaponLibrary.Get("smg");
            if (smg != null) weapons.Give(new WeaponInstance(smg));
            yield return new WaitForSeconds(0.8f);
            foreach (var layer in new[] { "shield", "armor", "flesh", "weak" })
            {
                var ai = Spawn(Vector3.zero);
                if (!ai) yield break;
                var d = ai.Health;
                if (layer == "shield") d.maxShield = d.shield = 400000;
                if (layer == "armor") d.maxArmor = d.armor = 400000;
                yield return new WaitForSeconds(1f);
                ai.enabled = false;
                yield return Face(ai);
                var body = ai.GetComponent<EnemyBody>();
                Vector3 AimPoint() => layer == "weak" && body && body.WeakPoint ? body.WeakPoint.position : BodyCenter(d);
                if (layer == "weak" && !(body && body.WeakPoint)) Line("⚠ 靶子没有弱点，弱点一张按身体中心拍");
                int s0 = FxDirector.Sparks;
                Refill();
                weapons.testFire = true;
                bool shot = false;
                for (float t = 0; t < 1.2f && !shot; t += Time.deltaTime)
                {
                    Aim(motor, eye, AimPoint());
                    if (FxDirector.Sparks > s0 + 2)
                    {
                        yield return null;
                        Shot(weapons.eye, $"fxa_layer_{layer}_fp");
                        EnemyClose(ai, $"fxa_layer_{layer}_close");
                        shot = true;
                    }
                    yield return null;
                }
                weapons.testFire = false;
                Line($"命中 · {layer}：火花 {FxDirector.Sparks - s0}");
                arena.Clear();
                yield return new WaitForSeconds(0.4f);
            }
        }

        // ───────────── 暴击 ─────────────

        IEnumerator CritCase()
        {
            foreach (bool crit in new[] { false, true })
            {
                var ai = Spawn(Vector3.zero);
                if (!ai) yield break;
                yield return new WaitForSeconds(1f);
                ai.enabled = false;
                yield return Face(ai);
                if (crit) vitals.stats.Add("playtest_fxa_crit", Stat.CritChance, 1f);
                int c0 = FxDirector.CritSparks, s0 = FxDirector.Sparks;
                Refill();
                weapons.testFire = true;
                string tag = crit ? "crit" : "normal";
                bool a = false, b = false;
                for (float t = 0; t < 0.9f; t += Time.deltaTime)
                {
                    Aim(motor, eye, BodyCenter(ai.Health));
                    if (!a && t > 0.25f)
                    {
                        Shot(weapons.eye, $"fxa_{tag}_a_fp");
                        EnemyClose(ai, $"fxa_{tag}_a_close");
                        a = true;
                    }
                    if (!b && t > 0.6f)
                    {
                        Shot(weapons.eye, $"fxa_{tag}_b_fp");
                        EnemyClose(ai, $"fxa_{tag}_b_close");
                        b = true;
                    }
                    yield return null;
                }
                weapons.testFire = false;
                vitals.stats.Remove("playtest_fxa_crit");
                Line($"{(crit ? "暴击" : "普通")}连射 0.9 s：火花 {FxDirector.Sparks - s0}，暴击 {FxDirector.CritSparks - c0}；累计星芒 {Fx.CritFlares}、被上限收掉 {Fx.CritFlaresCapped}");
                if (crit && FxDirector.CritSparks <= c0) Fail("暴击连射没有暴击火花");
                arena.Clear();
                yield return new WaitForSeconds(0.4f);
            }
        }
    }
}
