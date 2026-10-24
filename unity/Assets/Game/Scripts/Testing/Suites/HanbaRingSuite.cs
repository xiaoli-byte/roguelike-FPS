using System.Collections;
using System.Collections.Generic;
using System.IO;
using Spiritfire.Art;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering.Universal;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 旱魃日轮不穿模（bridge.sh playtest hanba-ring；场景 1-4 鸣沙山月牙泉）：日轮悬在身后跟着身体走（<see cref="SunRing"/> 的跟随支点），
    /// 任何动作里都不插进身体。每一段都每帧记两样间隙：
    ///   · 网格：身体 LOD0 蒙皮网格按这一帧的姿势烘焙出顶点，到日轮的距离（日轮按实心圆盘算：外半径含火焰尖、厚度含轮毂，比镂空的轮子保守）；
    ///   · 骨骼：SunRing 自己的防穿模估计（身后距离 − 采样要求的距离）；
    ///   · 旧挂法对照：同一帧的网格到「挂在 chest 上的 socket_sunring」位姿的日轮的距离（改之前日轮就挂在这里），几个招式中途另拍一张旧挂法的图。
    /// 分段：登场（首领自己的 intro 片段）→ 关掉行为层，逐个播 ART2 的十个状态（待机、受击、飞天之殇、焦裂、旱风、日蚀、召唤沙魇、日轮扫射、登场、死亡）→
    /// 连挨三下重击（受击弹簧后仰 25°）→ 0.3 s 急转身 150° → 0.6 s 往后撤 5 m（身体往拖在后面的日轮上撞）→ 打开行为层实战 25 s → 死亡片段 + 落地下沉。
    /// 网格间隙小于 0（相交）记不合格。正面、侧面、背后和招式中途的截图（JPG）存到 Assets/Art/_Review/hanba-ring/（不入库）；
    /// 审核用的快照拷到 docs/art/review/boss-hanba-sunring/，拼图是 docs/art/review/boss-hanba-sunring-v001.jpg。
    /// </summary>
    public sealed class HanbaRingSuite : PlaytestSuite
    {
        public override string Id => "hanba-ring";
        public override string Scene => "Assets/Scenes/L1_4_Crescent.unity";

        static readonly int ActScaleId = Animator.StringToHash("ActScale");

        /// <summary>ART2 的状态：名字、截图时刻（归一化，负数 = 不截）、截图机位</summary>
        static readonly (string state, float shotAt, string view)[] States =
        {
            ("Locomotion", -1f, null),
            ("Hit", 0.3f, "side"),
            ("apsaraCall", 0.7f, "front34"),
            ("crackPalm", 0.5f, "side"),
            ("droughtGale", 0.5f, "front"),
            ("eclipse", 0.9f, "side"),
            ("summonWraiths", 0.35f, "back34"),
            ("sunSweep", 0.55f, "front34"),
            ("intro", 0.58f, "front"),
            ("death", -1f, null),
        };

        sealed class Gap
        {
            public string name, worst, worstBone;
            public float mesh = float.MaxValue, old = float.MaxValue, bone = float.MaxValue, depthMin = float.MaxValue, depthMax;
            public int frames, bakes;
        }

        PlayerMotor motor;
        PlayerVitals vitals;
        HanbaBrain boss;
        NavMeshAgent agent;
        Animator anim;
        SkinnedMeshRenderer body;
        Transform socket;
        Mesh baked;
        readonly List<Vector3> verts = new(), world = new();
        Vector3 bestPoint;
        readonly List<Gap> stats = new();
        string shotDir;
        int shots, logErrors;
        string lastError;

        protected override IEnumerator Steps()
        {
            yield return new WaitForSecondsRealtime(1.5f);
            motor = FindAnyObjectByType<PlayerMotor>();
            vitals = FindAnyObjectByType<PlayerVitals>();
            if (!motor || !vitals)
            {
                Fail("缺少玩家组件（场景不是 1-4？先 bridge.sh level 1-4）");
                yield break;
            }
            WeaponController.TestMode = true;
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            Interactor.TestMode = true;
            HeroSkills.TestMode = true;
            PetOwner.TestMode = true;
            Application.logMessageReceived += OnLog;
            vitals.stats.Add("playtest_hanba_ring", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            RunState.Ensure();
            shotDir = Path.Combine(string.IsNullOrEmpty(ShotDir) ? Path.Combine(Application.dataPath, "Art", "_Review") : ShotDir, "hanba-ring");
            Directory.CreateDirectory(shotDir);

            yield return Spawn();
            if (boss)
            {
                yield return Intro();
                Freeze(true);
                yield return new WaitForSeconds(0.5f);
                Shot("idle_front", "front");
                Shot("idle_side", "side");
                ShotOld("idle_side_old", "side");
                Shot("idle_back34", "back34");
                foreach (var s in States)
                    if (s.state != "death")
                        yield return PlayState(s.state, s.shotAt, s.view);
                yield return Hits();
                yield return Turn();
                yield return Retreat();
                yield return Fight();
                yield return Death();
                Report();
            }

            vitals.stats.Remove("playtest_hanba_ring");
            Application.logMessageReceived -= OnLog;
            if (baked) Destroy(baked);
            if (boss) Destroy(boss.gameObject);
            Line($"截图 {shots} 张 → {shotDir}；运行时报错 {logErrors}{(logErrors > 0 ? $"（最后一条：{lastError}）" : "")}");
        }

        void OnLog(string msg, string stack, LogType type)
        {
            if (type is not (LogType.Exception or LogType.Error)) return;
            logErrors++;
            lastError = msg;
        }

        // ───────────── 生成 / 登场 ─────────────

        IEnumerator Spawn()
        {
            // 关卡自带的首领战停掉（玩家走进门槛会再刷一只旱魃，和套件自己刷的叠在出生点上）
            foreach (var e in FindObjectsByType<BossEncounter>(FindObjectsSortMode.None))
                if (e)
                    e.enabled = false;
            var arena = BossArena.Find(HanbaDef.Id);
            if (!arena)
            {
                var fwd = motor.transform.forward;
                fwd.y = 0;
                arena = BossArena.CreateRuntime(motor.transform.position + fwd.normalized * 20f, 18f, fwd, HanbaDef.Id);
                Line("场景里没有旱魃的 BossArena，在玩家前方临时建一个");
            }
            Place(arena.PlayerEntryPoint);
            boss = Bosses.Spawn(HanbaDef.Id, arena, HanbaDef.StageDifficulty) as HanbaBrain;
            if (!boss)
            {
                Fail("旱魃生成失败");
                yield break;
            }
            agent = boss.GetComponent<NavMeshAgent>();
            anim = boss.Model?.animator;
            if (boss.Model?.root)
                foreach (var t in boss.Model.root.GetComponentsInChildren<Transform>(true))
                    if (t.name == SunRing.SocketName)
                        socket = t;
            var ring = boss.Ring;
            // 身体：最细的那一档蒙皮网格（LOD0），不含泉珠发光壳
            if (boss.Model?.root)
                foreach (var smr in boss.Model.root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                    if (smr.sharedMesh && smr.name.IndexOf("GlowShell", System.StringComparison.OrdinalIgnoreCase) < 0 &&
                        (!body || smr.sharedMesh.vertexCount > body.sharedMesh.vertexCount))
                        body = smr;
            if (body)
            {
                baked = new Mesh();
                try
                {
                    body.BakeMesh(baked, true);
                    baked.GetVertices(verts);
                }
                catch (System.Exception e)
                {
                    Line($"⚠ 烘焙蒙皮网格失败（{e.Message}），只看骨骼估计");
                    verts.Clear();
                }
                if (verts.Count == 0)
                {
                    Destroy(baked);
                    baked = null;
                }
            }
            Line($"生成：模型 {boss.Model?.source} {boss.Model?.prefab}，日轮 {ring?.From}，跟随 {(ring && ring.Following ? "✓" : "✗")}，" +
                 $"骨骼采样 {ring?.ProbeCount} 个，日轮半径 {ring?.RingRadius:F2} m / 半厚 {ring?.RingHalfThickness:F2} m，" +
                 $"身体网格 {(baked ? $"{body.name}（{verts.Count} 顶点）" : "（不能烘焙）")}，旧挂点 {(socket ? socket.parent?.name : "（没有）")}");
            if (!ring || ring.From == SunRing.Source.None) Fail("旱魃没有日轮");
            else if (!ring.Following) Fail("日轮没有挂在跟随支点上（还挂在骨骼上？）");
            if (ring && boss.Model?.source == BossModelSource.Art && ring.ProbeCount == 0) Fail("正式模型上没找到防穿模的骨骼采样点");
            if (ring && boss.Model?.root && ring.Ring.IsChildOf(boss.Model.root.transform)) Fail("日轮还在模型骨架下面（会跟着胸口转）");
        }

        IEnumerator Intro()
        {
            var st = Begin("登场（intro 片段，首领自己的）");
            float t0 = Time.time;
            bool shot = false;
            while (!boss.IntroDone && Time.time - t0 < boss.Def.intro.seconds + 3f)
            {
                Sample(st, $"{Time.time - t0:F1}s");
                if (!shot && Time.time - t0 > boss.Def.intro.seconds * 0.58f)
                {
                    shot = true;
                    Shot("intro_roar_front", "front");
                }
                yield return null;
            }
            End(st);
        }

        /// <summary>关掉行为层（不出招、不转身、不走动）和寻路，动作由套件直接播</summary>
        void Freeze(bool on)
        {
            boss.enabled = !on;
            if (agent) agent.enabled = !on;
        }

        // ───────────── 逐个状态 ─────────────

        IEnumerator PlayState(string state, float shotAt, string view)
        {
            var st = Begin($"状态 {state}");
            if (!anim)
            {
                Line("没有 Animator，跳过");
                yield break;
            }
            anim.SetFloat(ActScaleId, 1f);
            int hash = Animator.StringToHash(state);
            anim.Play(hash, 0, 0f);
            yield return null;
            float t0 = Time.time, limit = state == "Locomotion" ? 3f : 8f;
            bool shot = shotAt < 0;
            while (Time.time - t0 < limit)
            {
                var info = anim.GetCurrentAnimatorStateInfo(0);
                bool inState = info.shortNameHash == hash;
                float u = inState ? info.normalizedTime : 1f;
                Sample(st, $"{u:P0}");
                if (!shot && u >= shotAt)
                {
                    shot = true;
                    Shot($"{state}_{view}", view);
                    if (state is "crackPalm" or "eclipse" or "sunSweep" or "apsaraCall") ShotOld($"{state}_{view}_old", view);
                }
                if (state != "Locomotion" && (!inState || u >= 1f)) break;
                yield return null;
            }
            End(st);
        }

        IEnumerator Hits()
        {
            var st = Begin("连挨三下重击（受击弹簧后仰）");
            var rig = boss.Model?.rig;
            if (anim) anim.Play(Animator.StringToHash("Locomotion"), 0, 0f);
            float t0 = Time.time, maxAngle = 0;
            int n = 0;
            bool shot = false;
            while (Time.time - t0 < 2.5f)
            {
                if (rig) maxAngle = Mathf.Max(maxAngle, rig.HitAngleDeg);
                if (rig && n < 3 && Time.time - t0 >= n * 0.35f)
                {
                    // 玩家在正面：力从前往后
                    rig.Hit(-boss.transform.forward, 1f);
                    n++;
                }
                Sample(st, $"{Time.time - t0:F2}s");
                if (!shot && Time.time - t0 > 0.9f)
                {
                    shot = true;
                    Shot("hits_side", "side");
                }
                yield return null;
            }
            End(st);
            Line($"  受击弹簧最大后仰约 {maxAngle:F0}°");
        }

        IEnumerator Turn()
        {
            var st = Begin("0.3 s 急转身 150° 再转回来");
            var t = boss.transform;
            var from = t.rotation;
            var to = from * Quaternion.Euler(0, 150f, 0);
            bool shot = false;
            for (int leg = 0; leg < 2; leg++)
            {
                var a = leg == 0 ? from : to;
                var b = leg == 0 ? to : from;
                float t0 = Time.time;
                while (Time.time - t0 < 1.4f)
                {
                    t.rotation = Quaternion.Slerp(a, b, Mathf.Clamp01((Time.time - t0) / 0.3f));
                    Sample(st, $"{(leg == 0 ? "去" : "回")} {Time.time - t0:F2}s");
                    if (!shot && leg == 0 && Time.time - t0 > 0.32f)
                    {
                        shot = true;
                        Shot("turn_lag", "front34");
                    }
                    yield return null;
                }
            }
            t.rotation = from;
            End(st);
        }

        IEnumerator Retreat()
        {
            var st = Begin("0.6 s 往后撤 5 m 再回来");
            var t = boss.transform;
            var home = t.position;
            var back = home - t.forward * 5f;
            bool shot = false;
            for (int leg = 0; leg < 2; leg++)
            {
                var a = leg == 0 ? home : back;
                var b = leg == 0 ? back : home;
                float t0 = Time.time;
                while (Time.time - t0 < 1.5f)
                {
                    float u = Mathf.Clamp01((Time.time - t0) / 0.6f);
                    t.position = Vector3.Lerp(a, b, u * u * (3 - 2 * u));
                    Sample(st, $"{(leg == 0 ? "撤" : "回")} {Time.time - t0:F2}s");
                    if (!shot && leg == 0 && Time.time - t0 > 0.4f)
                    {
                        shot = true;
                        Shot("retreat_side", "side");
                    }
                    yield return null;
                }
            }
            t.position = home;
            End(st);
        }

        IEnumerator Fight()
        {
            var st = Begin("实战 25 s（行为层打开，玩家站在场地里）");
            Freeze(false);
            if (agent && agent.enabled && !agent.isOnNavMesh && NavMesh.SamplePosition(boss.transform.position, out var hit, 4f, NavMesh.AllAreas)) agent.Warp(hit.position);
            var guard = boss.Health.Incoming.Add((in IncomingHit h) => 0f);
            var near = boss.transform.position + boss.transform.forward * 12f;
            if (NavMesh.SamplePosition(near, out var nh, 6f, NavMesh.AllAreas)) near = nh.position;
            Place(near);
            float t0 = Time.time;
            var seen = new HashSet<string>();
            while (Time.time - t0 < 25f)
            {
                if (vitals.Dead) vitals.Revive();
                vitals.Heal(999999);
                if (boss.Current != null) seen.Add(boss.Current.Id);
                Sample(st, boss.Current != null ? boss.Current.Id : "间隙");
                yield return null;
            }
            guard.Dispose();
            Freeze(true);
            End(st);
            Line($"  实战里出过的招：{(seen.Count > 0 ? string.Join("、", seen) : "（没出招）")}");
        }

        IEnumerator Death()
        {
            var st = Begin("死亡片段 + 落地下沉（日轮没升顶、原地熄灭）");
            if (anim) anim.Play(Animator.StringToHash("death"), 0, 0f);
            boss.Ring.Extinguish();
            if (boss.Cinematics) boss.Cinematics.Defeat(boss);
            float t0 = Time.time;
            bool mid = false, end = false;
            while (Time.time - t0 < 4.5f)
            {
                Sample(st, $"{Time.time - t0:F1}s");
                if (!mid && Time.time - t0 > 1.6f)
                {
                    mid = true;
                    Shot("death_side", "side");
                }
                if (!end && Time.time - t0 > 3.8f)
                {
                    end = true;
                    Shot("death_end_front34", "front34");
                }
                yield return null;
            }
            End(st);
        }

        // ───────────── 量间隙 ─────────────

        Gap Begin(string name)
        {
            var st = new Gap { name = name };
            stats.Add(st);
            return st;
        }

        void Sample(Gap st, string label)
        {
            var ring = boss ? boss.Ring : null;
            if (!ring || !ring.Following) return;
            st.frames++;
            float gap = ring.Depth - ring.DepthNeeded;
            st.bone = Mathf.Min(st.bone, gap);
            st.depthMin = Mathf.Min(st.depthMin, ring.Depth);
            st.depthMax = Mathf.Max(st.depthMax, ring.Depth);
            if (!baked || !body || !body.gameObject.activeInHierarchy) return;
            Bake();
            float d = GapTo(ring.Center, ring.Facing, ring);
            st.bakes++;
            if (d < st.mesh)
            {
                st.mesh = d;
                st.worst = label;
                st.worstBone = NearestBone(bestPoint);
            }
            if (socket) st.old = Mathf.Min(st.old, GapTo(socket.position, socket.forward, ring));
        }

        /// <summary>按这一帧的姿势烘焙身体网格，顶点换到世界</summary>
        void Bake()
        {
            body.BakeMesh(baked, true);
            baked.GetVertices(verts);
            var t = body.transform;
            var m = Matrix4x4.TRS(t.position, t.rotation, Vector3.one);
            world.Clear();
            foreach (var v in verts) world.Add(m.MultiplyPoint3x4(v));
        }

        /// <summary>身体网格（<see cref="Bake"/> 的那一帧）到轮心 c、轮面法线 n 的实心圆盘（日轮的尺寸）的最近距离（米；负数 = 插进去了多深）</summary>
        float GapTo(Vector3 c, Vector3 n, SunRing ring)
        {
            n = n.normalized;
            float R = ring.RingRadius, H = ring.RingHalfThickness, best = float.MaxValue;
            foreach (var p in world)
            {
                var d = p - c;
                float z = Vector3.Dot(d, n);
                float a = (d - n * z).magnitude - R, b = Mathf.Abs(z) - H;
                float sdf = a > 0 && b > 0 ? Mathf.Sqrt(a * a + b * b) : Mathf.Max(a, b);
                if (sdf < best)
                {
                    best = sdf;
                    bestPoint = p;
                }
            }
            return best;
        }

        /// <summary>离这个点最近的蒙皮骨骼（看最近的那块网格是哪儿：长发、残衣、袖子…）</summary>
        string NearestBone(Vector3 p)
        {
            string best = null;
            float bd = float.MaxValue;
            foreach (var t in body.bones)
            {
                if (!t) continue;
                float d = (t.position - p).sqrMagnitude;
                if (d < bd)
                {
                    bd = d;
                    best = t.name;
                }
            }
            return best;
        }

        void End(Gap st)
        {
            if (st.frames == 0)
            {
                Line($"{st.name}：日轮没在跟随，没量");
                return;
            }
            string mesh = st.bakes > 0 ? $"网格最近 {st.mesh:F2} m（{st.worst}，靠近 {st.worstBone}）{(socket ? $"〔旧挂法 {st.old:F2} m〕" : "")}" : "网格没量";
            Line($"{st.name}：{st.frames} 帧，{mesh}，骨骼估计间隙最少 {st.bone:F2} m，轮心身后 {st.depthMin:F2}–{st.depthMax:F2} m");
            if (st.bakes > 0 && st.mesh < 0) Fail($"{st.name}：日轮插进身体 {-st.mesh:F2} m（{st.worst}）");
            if (st.bone < 0) Fail($"{st.name}：骨骼估计的间隙为负（{st.bone:F2} m）");
        }

        void Report()
        {
            float mesh = float.MaxValue, old = float.MaxValue, bone = float.MaxValue;
            int oldBad = 0;
            foreach (var s in stats)
            {
                if (s.bakes > 0) mesh = Mathf.Min(mesh, s.mesh);
                if (s.bakes > 0 && socket) old = Mathf.Min(old, s.old);
                if (s.bakes > 0 && socket && s.old < 0) oldBad++;
                if (s.frames > 0) bone = Mathf.Min(bone, s.bone);
            }
            Line($"合计：{stats.Count} 段，网格最近 {(mesh < float.MaxValue ? $"{mesh:F2} m" : "—")}，骨骼估计间隙最少 {(bone < float.MaxValue ? $"{bone:F2} m" : "—")}" +
                 (old < float.MaxValue ? $"；对照旧挂法（chest 上的 socket_sunring）网格最近 {old:F2} m，{oldBad}/{stats.Count} 段相交" : ""));
        }

        // ───────────── 截图 ─────────────

        /// <summary>首领身边的临时相机（不带 HUD，开后处理）拍一张 1600×900，存 Assets/Art/_Review/hanba-ring/&lt;name&gt;.jpg</summary>
        void Shot(string name, string view, bool old = false)
        {
            if (!boss) return;
            var t = boss.transform;
            var fwd = t.forward;
            fwd.y = 0;
            var yaw = Quaternion.LookRotation(fwd.sqrMagnitude > 1e-6f ? fwd.normalized : Vector3.forward);
            var basePos = t.position;
            Vector3 eye, look = new(0, 3.6f, -0.8f);
            switch (view)
            {
                case "front": eye = new Vector3(1.2f, 3.0f, 14f); look = new Vector3(0, 3.8f, -0.6f); break;
                case "front34": eye = new Vector3(9f, 3.4f, 10.5f); break;
                case "back34": eye = new Vector3(-9f, 5f, -12f); break;
                default: eye = new Vector3(14f, 3.6f, -0.8f); break;
            }
            var go = new GameObject("Ring Shot Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 40f;
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 600f;
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            go.transform.position = basePos + yaw * eye;
            go.transform.LookAt(basePos + yaw * look);
            var rt = new RenderTexture(1600, 900, 24);
            var tex = new Texture2D(1600, 900, TextureFormat.RGB24, false);
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, 1600, 900), 0, 0);
            tex.Apply();
            RenderTexture.active = null;
            cam.targetTexture = null;
            File.WriteAllBytes(Path.Combine(shotDir, name + ".jpg"), tex.EncodeToJPG(88));
            Destroy(rt);
            Destroy(tex);
            Destroy(go);
            shots++;
            var ring = boss.Ring;
            if (baked && body) Bake();
            if (old) Line($"  截图 {name}.jpg（{view}，旧挂法：日轮挂在 chest 上的 socket_sunring）" + (baked && body && ring ? $"：网格最近 {GapTo(socket.position, socket.forward, ring):F2} m" : ""));
            else Line($"  截图 {name}.jpg（{view}）：轮心身后 {ring?.Depth:F2} m、骨骼估计间隙 {(ring ? ring.Depth - ring.DepthNeeded : 0):F2} m" +
                      (baked && body && ring ? $"、网格最近 {GapTo(ring.Center, ring.Facing, ring):F2} m" : ""));
        }

        /// <summary>对照图：临时在 socket_sunring 上挂一个日轮（改之前的挂法），藏起跟随的日轮和光晕，拍完拆掉</summary>
        void ShotOld(string name, string view)
        {
            var ring = boss ? boss.Ring : null;
            var prefab = socket ? Bosses.FindPrefab(SunRing.PrefabId) : null;
            if (!prefab || !ring || !ring.Following) return;
            var inst = Instantiate(prefab, socket, false);
            var pivot = ring.Pivot.gameObject;
            pivot.SetActive(false);
            Shot(name, view, true);
            pivot.SetActive(true);
            DestroyImmediate(inst);
        }

        void Place(Vector3 p)
        {
            var cc = motor.GetComponent<CharacterController>();
            if (cc) cc.enabled = false;
            motor.transform.position = p + Vector3.up * 0.05f;
            if (cc) cc.enabled = true;
            Physics.SyncTransforms();
        }
    }
}
