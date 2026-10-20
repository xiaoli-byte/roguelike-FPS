using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 世界系统冒烟（bridge.sh playtest world；场景 1-1 古道穿越戈壁；docs/unity-parity.md L3）：
    ///   · 软边界：场景里没有空气墙（Ignore Raycast 层上的实体碰撞体只在兜底环上，离等值线 ≥ failsafe − 3 m）；
    ///     把玩家放到起风线外 7 m（风力一半），不给输入：被推回到起风线以内，推回速度 ≈ (4 + 18 × 风力) m/s，期间有白化；
    ///     放到兜底环外：托回安全点；
    ///   · 拴绳：一只跳鼠被放到导航边缘外 8 m（模拟被击飞出界）：1.2 s 后被拴回界内的网格上；
    ///   · 天气：④ 的沙暴强制进入风暴期，玩家站在营地中心——远程锁定上限 ≤ 25 m、雾终点 ≤ 40 m、全局风力 ≥ 0.8、远幕盖上；
    ///     回到出生点：锁定不限、雾回到基础值；预警期在烽燧台上能看到天边的沙墙（截图）。
    /// 玩家全程无敌；结束时把玩家送回出生点、风暴回到未计时。
    /// </summary>
    public sealed class WorldSuite : PlaytestSuite
    {
        public override string Id => "world";
        /// <summary>1-1 古道穿越戈壁（与编辑器里 Level_1_1.ScenePath 相同）</summary>
        public override string Scene => "Assets/Scenes/L1_1_GobiRoad.unity";

        PlayerMotor motor;
        PlayerVitals vitals;
        Camera eye;
        Vector3 home;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            motor = FindFirstObjectByType<PlayerMotor>();
            vitals = FindFirstObjectByType<PlayerVitals>();
            var weapons = FindFirstObjectByType<WeaponController>();
            if (!motor || !vitals)
            {
                Fail($"缺少玩家组件：motor={motor} vitals={vitals}");
                yield break;
            }
            eye = weapons && weapons.eye ? weapons.eye : Camera.main;
            WeaponController.TestMode = true;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            vitals.invulnerableUntil = Time.time + 9999;
            home = motor.transform.position;
            try
            {
                if (BoundaryZone.Active)
                {
                    yield return NoAirWall();
                    yield return PushBack();
                    yield return Failsafe();
                    yield return TetherCase();
                }
                else Line("场景里没有软边界（BoundaryZone）：跳过边界检查（TestArena 的围堤是地形边界）");
                if (WeatherDirector.Instance && WeatherDirector.Instance.regions.Length > 0) yield return Sandstorm();
                else Line("场景里没有区域风暴：跳过沙暴检查");
            }
            finally
            {
                var d = WeatherDirector.Instance;
                if (d)
                    foreach (var r in d.regions)
                        r?.Force(StormPhase.Idle);
                if (motor) motor.Teleport(home + Vector3.up * 0.05f);
            }
        }

        // ───────────── 软边界 ─────────────

        /// <summary>没有空气墙：Ignore Raycast 层上的实体碰撞体（兜底环）离等值线都在 failsafe − 3 m 以外</summary>
        IEnumerator NoAirWall()
        {
            var zone = BoundaryZone.Active;
            var t = zone.tuning;
            Line($"── 软边界 ──（起风 +{t.softStart} m、风力 {t.windRamp} m 涨满、推回 {t.pushBase} + {t.pushGain} × 风力、兜底 +{t.failsafe} m、走路顶到 +{t.HoldDepth(7.5f):F1} m）");
            int walls = 0;
            float nearest = float.PositiveInfinity;
            string nearestName = null;
            foreach (var c in FindObjectsByType<Collider>())
            {
                if (!c.enabled || c.isTrigger || c.gameObject.layer != Layers.IgnoreRaycast) continue;
                if (c.GetComponentInParent<EnemyAI>()) continue; // 布娃娃
                walls++;
                float d = MinDistance(c);
                if (d < nearest)
                {
                    nearest = d;
                    nearestName = c.name;
                }
            }
            if (walls == 0) Fail("Ignore Raycast 层上没有兜底环（构建器应在 +failsafe 处立一圈）");
            else if (nearest < t.failsafe - 3f) Fail($"还有空气墙：{nearestName} 离等值线只有 {nearest:F1} m（兜底环应在 +{t.failsafe} m）");
            else Line($"✓ 没有空气墙：Ignore Raycast 层实体碰撞体 {walls} 个，最近的离等值线 {nearest:F1} m（{nearestName}）");
            yield return null;
        }

        static float MinDistance(Collider c)
        {
            float best = float.PositiveInfinity;
            if (c is MeshCollider mc && mc.sharedMesh && mc.sharedMesh.isReadable)
            {
                var verts = mc.sharedMesh.vertices;
                for (int i = 0; i < verts.Length; i += 2) best = Mathf.Min(best, BoundaryZone.Distance(c.transform.TransformPoint(verts[i])));
                return best;
            }
            var b = c.bounds;
            foreach (var p in new[] { b.center, new Vector3(b.min.x, 0, b.min.z), new Vector3(b.max.x, 0, b.min.z), new Vector3(b.min.x, 0, b.max.z), new Vector3(b.max.x, 0, b.max.z) })
                best = Mathf.Min(best, BoundaryZone.Distance(p));
            return best;
        }

        /// <summary>出生点附近沿梯度走到离等值线 d 米的地面点</summary>
        static Vector3 PointAt(Vector3 from, float d)
        {
            var f = BoundaryZone.Active.Field;
            var q = f.MoveToDistance(from.x, from.z, d, 10);
            return Ground(new Vector3(q.x, from.y, q.y));
        }

        /// <summary>地形表面（不落在道具顶上）；没有地形时向下打射线</summary>
        static Vector3 Ground(Vector3 p)
        {
            var t = Terrain.activeTerrain;
            if (t) p.y = t.SampleHeight(p) + t.transform.position.y;
            else if (Physics.Raycast(p + Vector3.up * 80, Vector3.down, out var hit, 200, Layers.WorldMask, QueryTriggerInteraction.Ignore)) p.y = hit.point.y;
            return p;
        }

        IEnumerator PushBack()
        {
            var zone = BoundaryZone.Active;
            var t = zone.tuning;
            float target = t.softStart + t.windRamp * 0.5f;
            var at = PointAt(home, target);
            var outward = zone.Field.Outward(at.x, at.z);
            motor.Teleport(at + Vector3.up * 0.05f, Mathf.Atan2(outward.x, outward.y) * Mathf.Rad2Deg);
            yield return null;
            float d0 = BoundaryZone.PlayerDistance, w0 = BoundaryZone.PlayerWind;
            var p0 = motor.transform.position;
            float t0 = Time.time;
            yield return new WaitForSeconds(0.25f);
            float speed = Flat(motor.transform.position - p0) / Mathf.Max(0.01f, Time.time - t0);
            float expect = t.Push(w0);
            Line($"放到 +{d0:F1} m（风力 {w0:F2}）：前 0.25 s 被推 {speed:F1} m/s（应约 {expect:F1}，风力随距离下降会略慢）");
            if (w0 < 0.25f) Fail($"放到 +{d0:F1} m 风力只有 {w0:F2}（应约 0.5）");
            if (speed < expect * 0.5f || speed > t.pushBase + t.pushGain + 1) Fail($"推回速度 {speed:F1} m/s 不对（应约 {expect:F1}）");
            yield return new WaitForSeconds(0.3f);
            float white = BoundaryZone.PlayerWhiteout, veil = WeatherDirector.Instance ? WeatherDirector.Instance.WhiteoutWeight : -1;
            Shot(eye, "world_whiteout");
            yield return new WaitForSeconds(1.2f);
            float d1 = BoundaryZone.PlayerDistance;
            Line($"白化 {white:F2}（天气导演 {veil:F2}）；1.75 s 后离等值线 {d1:+0.0;-0.0} m，风力 {BoundaryZone.PlayerWind:F2}");
            if (white < 0.3f) Fail($"起风线外 {d0:F1} m 白化只有 {white:F2}");
            if (d1 > t.softStart + 0.8f) Fail($"没被推回：1.75 s 后还在 +{d1:F1} m（起风线 +{t.softStart} m）");
            else Line("✓ 被风沙推回起风线以内，没有撞墙");
            if (vitals.Dead) Fail("被推回时死了");
        }

        IEnumerator Failsafe()
        {
            var zone = BoundaryZone.Active;
            int before = BoundaryZone.FailsafeRecoveries;
            var at = PointAt(home, zone.tuning.failsafe + 6f);
            motor.Teleport(at + Vector3.up * 0.05f);
            yield return new WaitForSeconds(0.4f);
            float d = BoundaryZone.Distance(motor.transform.position);
            if (BoundaryZone.FailsafeRecoveries <= before) Fail($"放到兜底环外 +{zone.tuning.failsafe + 6:F0} m 没被托回（现在 {d:+0.0;-0.0} m）");
            else if (d > zone.tuning.softStart + 0.5f) Fail($"兜底托回后还在起风线外 {d:F1} m（安全点不该记在风里）");
            else Line($"✓ 越过兜底环：托回安全点（离等值线 {d:F1} m）");
            motor.Teleport(home + Vector3.up * 0.05f);
            yield return new WaitForSeconds(0.6f);
        }

        /// <summary>敌人被送出导航边缘：AI 先停（不让子类在离网时调 agent），1.2 s 后被拴回网格</summary>
        IEnumerator TetherCase()
        {
            var zone = BoundaryZone.Active;
            var t = zone.tuning;
            var inside = PointAt(home, -6f);
            var ai = EnemyRoster.Spawn("jerboa_blade", inside, Quaternion.identity, 1, false);
            if (!ai)
            {
                Fail("刷不出跳鼠刀客（拴绳检查）");
                yield break;
            }
            ai.Health.maxHealth *= 50;
            ai.Health.ResetVitals();
            yield return new WaitForSeconds(1f);
            int before = BoundaryZone.Tethered;
            var agent = ai.GetComponent<NavMeshAgent>();
            var outside = PointAt(home, t.navInset + t.tetherSlack + 6f);
            ai.enabled = false;
            agent.enabled = false;
            ai.transform.position = outside;
            agent.enabled = true;
            float d0 = BoundaryZone.Distance(ai.transform.position);
            float waited = 0;
            while (BoundaryZone.Tethered == before && waited < t.tetherGrace + 1.5f)
            {
                waited += Time.deltaTime;
                yield return null;
            }
            float d1 = BoundaryZone.Distance(ai.transform.position);
            if (BoundaryZone.Tethered == before) Fail($"跳鼠在界外 +{d0:F1} m、离网 {waited:F1} s 没被拴回");
            else if (d1 > t.navInset + 0.5f || !agent.isOnNavMesh) Fail($"拴回后在 {d1:+0.0;-0.0} m、在网格上 {agent.isOnNavMesh}");
            else Line($"✓ 拴绳：跳鼠从 +{d0:F1} m 拴回 {d1:F1} m（{waited:F1} s），回到导航网格上");
            ai.enabled = true;
            yield return new WaitForSeconds(0.3f);
            EnemyRegistry.PurgeAll();
        }

        // ───────────── 天气 ─────────────

        IEnumerator Sandstorm()
        {
            var dir = WeatherDirector.Instance;
            var r = dir.regions[0];
            var prof = WeatherProfiles.Get(r.profile);
            Line($"── 天气 ──（区域「{r.name}」{r.profile}：半径 {r.radius} m，能见度 {prof?.visibility} m；基础雾 {dir.baseFogStart:F0}–{dir.baseFogEnd:F0} m）");
            var center = Ground(r.center);

            // 风暴期：营地中心
            r.Force(StormPhase.Storm, 3f);
            motor.Teleport(center + Vector3.up * 0.05f, Mathf.Atan2(r.from.x, r.from.y) * Mathf.Rad2Deg);
            yield return new WaitForSeconds(1f);
            float storm = WeatherDirector.StormAt(motor.transform.position);
            float lockR = WeatherDirector.LockOnRange(center);
            var wind = Shader.GetGlobalVector("_WindDir");
            float fogEnd = RenderSettings.fogEndDistance;
            bool near = WeatherDirector.CanLockOn(center, center + Vector3.right * 20f), far = WeatherDirector.CanLockOn(center, center + Vector3.right * 30f);
            Line($"风暴中：强度 {storm:F2}，锁定上限 {lockR:F1} m（20 m {(near ? "能" : "不能")}锁、30 m {(far ? "能" : "不能")}锁），雾 {RenderSettings.fogStartDistance:F0}–{fogEnd:F0} m，" +
                 $"风 ({wind.x:F2}, {wind.y:F2}) × {wind.z:F2}，远幕 {dir.Current.dome:F2}");
            Shot(eye, "world_sandstorm");
            if (storm < 0.9f) Fail($"营地中心风暴强度 {storm:F2}（应 ≥ 0.9）");
            if (prof != null && lockR > prof.visibility + 0.5f) Fail($"沙暴里锁定上限 {lockR:F1} m（应 ≤ {prof.visibility} m）");
            if (!near || far) Fail($"CanLockOn 不对：20 m {near}、30 m {far}");
            if (fogEnd > 40f) Fail($"沙暴里雾终点 {fogEnd:F0} m（应 ≤ 40）");
            if (wind.z < 0.8f) Fail($"沙暴里全局风力 {wind.z:F2}（应 ≥ 0.8）");
            if (dir.Current.dome < 0.9f) Fail($"沙暴里远幕 {dir.Current.dome:F2}（应盖满）");

            // 出生点：晴
            motor.Teleport(home + Vector3.up * 0.05f);
            yield return new WaitForSeconds(0.5f);
            float clearLock = WeatherDirector.LockOnRange(home);
            float clearFog = RenderSettings.fogEndDistance;
            Line($"出生点：锁定上限 {(float.IsPositiveInfinity(clearLock) ? "不限" : clearLock.ToString("F0") + " m")}，雾终点 {clearFog:F0} m");
            if (!float.IsPositiveInfinity(clearLock)) Fail($"出生点在沙暴外，锁定上限却是 {clearLock:F0} m");
            if (clearFog < dir.baseFogEnd * 0.9f) Fail($"出生点雾终点 {clearFog:F0} m，没回到基础值 {dir.baseFogEnd:F0} m");

            // 预警期：沙墙在营地上风处立起来；从营地西北 60 m 朝营地看
            r.Force(StormPhase.Warning, r.warn * 0.85f);
            var look = Ground(center + new Vector3(-45f, 0, 40f));
            var to = center - look;
            motor.Teleport(look + Vector3.up * 0.05f, Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg);
            yield return new WaitForSeconds(0.6f);
            var walls = dir.GetComponentsInChildren<MeshRenderer>().Where(m => m.name.StartsWith("Sand Wall")).ToList();
            bool wallUp = walls.Any(m => m.gameObject.activeInHierarchy);
            Line($"预警：沙墙 {(wallUp ? "已升起" : "没有")}，风暴强度 {r.Intensity:F2}");
            Shot(eye, "world_sandwall");
            if (!wallUp) Fail("预警期没有沙墙");
        }

        static float Flat(Vector3 v) => new Vector2(v.x, v.z).magnitude;
    }
}
