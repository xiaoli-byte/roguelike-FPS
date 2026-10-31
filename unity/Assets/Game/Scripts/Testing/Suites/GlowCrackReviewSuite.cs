using System.Collections;
using System.Collections.Generic;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 第二批收尾 C 路的改前 / 改后审阅截图（bridge.sh playtest review-glow；场景 TestArena）：同一次运行里切开关拍改前、改后，光照和机位完全一样。
    /// 在场地上先后铺三种地面（同 <see cref="FxStyleSuite"/>：沙 = 测试场本身，雪 = 霜山雪地层，熔岩 = 玄武岩 + 一池岩浆；FxTone 按章节调环境色），每种地面上拍：
    ///   · 旱魃（正式模型，AI 停住）：平时 / 日蚀（日轮熄灭、黑盘）/ 复燃那一下——改前 = 停用 <see cref="GlowMask"/>（龟裂、日轮都没有自发光）+ 原来的暖黑盘；
    ///     改后 = 龟裂白金裂光、日轮三层自发光、冷黑盘。截图名 b2c_&lt;地面&gt;_hanba_&lt;状态&gt;_&lt;before|after&gt;；
    ///   · 熔心魔将的大剑（AI 停住，Heat / Fury 由这里写）：平时 / 前摇烧亮 / 狂怒——改前 = <see cref="WarlordBlade.maskGlow"/> 关（只有边光：
    ///     原来借底色贴图的自发光因为材质没开 _EMISSION 一直没画出来）；改后 = 剑脊熔铜纹 + 刃口白热。截图名 b2c_&lt;地面&gt;_blade_&lt;状态&gt;_&lt;before|after&gt;；
    ///   · 第三章砸地：魔将的重击落地（<see cref="Fx.WarlordImpact"/>，半径 4.6 m）+ 精英砸地（<see cref="Fx.EliteCh3Impact"/>，1.8 m）并排，
    ///     砸下去 0.25 s 和 2.5 s（冷却中）各拍俯视的第三人称 + 一张第一人称——改前 = <see cref="CrackDecals.Enabled"/> 关（魔将是原来的熔铜贴花、精英不留贴花）。
    ///     截图名 b2c_&lt;地面&gt;_crack_&lt;时刻&gt;_&lt;before|after&gt;。
    /// 拼图：scripts/unity/batch2c_sheets.py → docs/art/review/batch2/C/。只核对「有没有出」：遮罩挂上、贴花贴上。
    /// </summary>
    public sealed class GlowCrackReviewSuite : PlaytestSuite
    {
        public override string Id => "review-glow";
        public override string Scene => "Assets/Scenes/TestArena.unity";

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        ArenaSpawner arena;
        Vector3 away, side, stage, back;
        readonly List<GameObject> patches = new();
        HanbaBrain hanba;
        WarlordBrain warlord;

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
            vitals.stats.Add("playtest_b2c", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            vitals.invulnerableUntil = Time.time + 99999;
            var quality = ArtQuality.Level;
            ArtQuality.Set(ArtQualityLevel.High, false);
            var policy = BossIntroDirector.Policy;
            BossIntroDirector.Policy = BossIntroPolicy.Never;
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            side = Vector3.Cross(Vector3.up, away);
            stage = side * 14f - away * 4f;
            back = -away;
            try
            {
                foreach (var (g, chapter) in new[] { ("sand", 1), ("snow", 2), ("lava", 3) })
                {
                    FxTone.Override = chapter;
                    ClearPatches();
                    if (g != "sand") BuildPatch(g);
                    yield return Frames(10);
                    yield return HanbaShots(g);
                    yield return BladeShots(g);
                    yield return CrackShots(g);
                }
            }
            finally
            {
                FxTone.Override = 0;
                CrackDecals.Enabled = true;
                BossIntroDirector.Policy = policy;
                ClearPatches();
                if (hanba) Destroy(hanba.gameObject);
                if (warlord) Destroy(warlord.gameObject);
                ArtQuality.Set(quality, false);
                vitals.stats.Remove("playtest_b2c");
                arena.Clear();
            }
        }

        // ───────────── 旱魃 ─────────────

        IEnumerator HanbaShots(string g)
        {
            if (!hanba)
            {
                Teleport(motor, Stage + back * 40f);
                var def = Bosses.Get(HanbaDef.Id);
                hanba = Bosses.Spawn(def, Ground(Stage) - side * 4f, Quaternion.LookRotation(back), HanbaDef.StageDifficulty) as HanbaBrain;
                if (!hanba)
                {
                    Fail("旱魃没有刷出来");
                    yield break;
                }
                float t0 = Time.time;
                while (!hanba.IntroDone && Time.time - t0 < hanba.Def.intro.seconds + 3f) yield return null;
                hanba.Health.Incoming.Add((in IncomingHit h) => 0f);
                hanba.enabled = false;
                // 审阅机位是临时相机：Animator 默认「看不见就不写骨骼」，拍的时候姿势会停在上一次被看见的那帧
                foreach (var a in hanba.GetComponentsInChildren<Animator>(true)) a.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                yield return new WaitForSeconds(1f);
                var gm0 = hanba.GetComponent<GlowMask>();
                Line($"旱魃：模型 {hanba.Model?.source}，日轮 {hanba.Ring?.From}，发光遮罩 {(gm0 ? gm0.Masked : -1)} 张（本体 + 日轮 = 2）");
                if (!gm0 || gm0.Masked < 2) Fail($"旱魃的发光遮罩没挂全：{(gm0 ? gm0.Masked : -1)}");
                yield return HairShots("death");
                yield return HairShots("crackPalm");
            }
            var gm = hanba.GetComponent<GlowMask>();
            var ring = hanba.Ring;
            // 机位：远景 = 正前方偏右 11 m、高 3 m，看身体和身后的日轮；近景 = 胸口前 4.5 m，看皮肤上的龟裂
            var root = hanba.transform.position;
            var fwd = hanba.transform.forward;
            var right = hanba.transform.right;
            var camPos = root + fwd * 10.5f + right * 3.5f + Vector3.up * 3.2f;
            var look = root + Vector3.up * 3.6f - fwd * 0.6f;
            var anim = hanba.GetComponentInChildren<Animator>();
            var chest = anim && anim.isHuman && anim.GetBoneTransform(HumanBodyBones.Chest) ? anim.GetBoneTransform(HumanBodyBones.Chest).position : root + Vector3.up * 3.2f;
            var closePos = chest + fwd * 4.3f + right * 1.4f + Vector3.up * 0.2f;
            var closeLook = chest - Vector3.up * 0.5f;
            void Both(string name)
            {
                CamShot(camPos, look, $"b2c_{g}_hanba_{name}");
                CamShot(closePos, closeLook, $"b2c_{g}_hanbaclose_{name}", 42f);
            }

            ring.Idle();
            yield return new WaitForSeconds(0.8f);
            yield return Pair(gm, null, tag => Both($"idle_{tag}"));

            ring.SetEclipse(true);
            yield return new WaitForSeconds(0.8f);
            yield return Pair(gm, ring, tag => Both($"eclipse_{tag}"));
            if (gm && gm.StrengthOf("T_Boss_Hanba", 0) < 1.2f) Fail($"日蚀时龟裂裂光没烧亮：{gm.StrengthOf("T_Boss_Hanba", 0):F2}");
            ring.SetEclipse(false);

            // 复燃：改前、改后各放一次（同 Phase3Eclipse.Flare 的日轮与发光部分），释放后 0.08 s 拍
            foreach (bool after in new[] { false, true })
            {
                if (gm) gm.enabled = after;
                ring.Idle();
                yield return new WaitForSeconds(1.2f);
                ring.Flash(1f);
                ring.SetBlaze(1f, 3f);
                GlowMask.Flash(hanba, 0.12f, 0.9f);
                yield return new WaitForSeconds(0.08f);
                Both($"flare_{(after ? "after" : "before")}");
                if (after && gm && gm.FlashLevel < 0.9f) Fail($"复燃没把发光遮罩点到峰值：{gm.FlashLevel:F2}");
            }
            if (gm) gm.enabled = true;
            ring.Idle();
        }

        /// <summary>改前（停用发光遮罩；黑盘换回原来的暖黑）拍一组、改后拍一组；shot 收到 "before" / "after"</summary>
        IEnumerator Pair(GlowMask gm, SunRing ring, System.Action<string> shot)
        {
            var disc = ring ? FindDisc(ring) : null;
            if (gm) gm.enabled = false;
            if (disc) FxMaterials.Tint(disc, new Color(0.03f, 0.02f, 0.015f));
            yield return Frames(3);
            shot("before");
            yield return Frames(2);
            if (disc) FxMaterials.Tint(disc, SunRing.DiscColor);
            if (gm) gm.enabled = true;
            yield return new WaitForSeconds(0.6f);
            shot("after");
            yield return Frames(2);
        }

        // ───────────── 长发回垂（弹簧骨的动作曲线） ─────────────

        /// <summary>
        /// 运行时核对 + 改前 / 改后：真实的人形 Animator 播 state 片段、停在发链根节回垂最大的那个关键帧上——
        ///   核对：弹簧关掉，三条发链根节的局部朝向要跟片段里的关键帧走（≤ 2°）、而且离开了绑定姿势（片段要求的幅度）；
        ///   截图：弹簧打开（游戏里的样子）等 1.5 s 稳住，侧面拍。改前 = 发链骨每帧压回绑定姿势（= 片段里没有这些骨的曲线，boss-hanba.md §8 说的缺口），
        ///   改后 = 照片段。截图名 b2c_hair_&lt;state&gt;_&lt;before|after&gt;
        /// </summary>
        IEnumerator HairShots(string state)
        {
            var anim = hanba.GetComponentInChildren<Animator>();
            var rig = hanba.Model?.rig;
            if (!anim || !anim.avatar || !anim.avatar.isHuman || !anim.HasState(0, Animator.StringToHash(state)))
            {
                Fail($"旱魃没有人形 Animator 或状态 {state}");
                yield break;
            }
            var bind = new Dictionary<string, Quaternion>();
            foreach (var sb in anim.avatar.humanDescription.skeleton) bind[sb.name] = sb.rotation;
            var hair = new List<Transform>();
            foreach (var t in anim.GetComponentsInChildren<Transform>(true))
                if (t.name.StartsWith("hair_") && bind.ContainsKey(t.name))
                    hair.Add(t);
            var roots = hair.FindAll(t => t.name.EndsWith("1"));
            AnimationClip clip = null;
            foreach (var c in anim.runtimeAnimatorController.animationClips)
                if (c && c.name.EndsWith("_" + state))
                    clip = c;
            if (!clip || roots.Count == 0)
            {
                Fail($"没找到 {state} 片段 / 发链（{roots.Count}）");
                yield break;
            }
            // 片段里每根发链根节的关键帧曲线（编辑器里才读得到曲线；打包里不跑套件）
            var curves = new Dictionary<Transform, AnimationCurve[]>();
#if UNITY_EDITOR
            foreach (var t in roots)
            {
                string path = UnityEditor.AnimationUtility.CalculateTransformPath(t, anim.transform);
                var cs = new AnimationCurve[4];
                string[] axes = { "x", "y", "z", "w" };
                for (int i = 0; i < 4; i++)
                    cs[i] = UnityEditor.AnimationUtility.GetEditorCurve(clip,
                        UnityEditor.EditorCurveBinding.FloatCurve(path, typeof(Transform), $"m_LocalRotation.{axes[i]}"));
                if (System.Array.TrueForAll(cs, c => c != null)) curves[t] = cs;
            }
#endif
            if (curves.Count == 0)
            {
                Fail($"{state} 片段里没有发链根节的旋转曲线（人形片段的 Transform 遮罩没配上？）");
                yield break;
            }
            static Quaternion Eval(AnimationCurve[] c, float t) => new Quaternion(c[0].Evaluate(t), c[1].Evaluate(t), c[2].Evaluate(t), c[3].Evaluate(t)).normalized;
            // 回垂最大的时刻：片段里各发链根节离绑定姿势最远的那个关键帧
            float at = 0, want = 0;
            foreach (var kv in curves)
                foreach (var k in kv.Value[3].keys)
                {
                    float d = Quaternion.Angle(Eval(kv.Value, k.time), bind[kv.Key.name]);
                    if (d > want)
                    {
                        want = d;
                        at = k.time;
                    }
                }
            float speed = anim.speed;
            bool tick = rig && rig.autoTick;
            // 1) 核对：弹簧关掉，停在 at，读真实 Animator 写出来的局部朝向
            if (rig) rig.autoTick = false;
            anim.speed = 0;
            anim.Play(state, 0, Mathf.Clamp01(at / clip.length));
            for (int i = 0; i < 3; i++) yield return new WaitForEndOfFrame();
            float err = 0, dev = 0;
            foreach (var kv in curves)
            {
                err = Mathf.Max(err, Quaternion.Angle(kv.Key.localRotation, Eval(kv.Value, at)));
                dev = Mathf.Max(dev, Quaternion.Angle(kv.Key.localRotation, bind[kv.Key.name]));
            }
            // 对照：同一帧人形骨（脊柱）离绑定姿势多远——说明 Animator 确实在这一帧求值、写了骨骼
            var spine = anim.GetBoneTransform(HumanBodyBones.Spine);
            float human = spine && bind.TryGetValue(spine.name, out var sq) ? Quaternion.Angle(spine.localRotation, sq) : -1;
            Line($"长发回垂（{state} {at:F2} s，弹簧关）：片段要求离绑定姿势 {want:F1}°，真实 Animator 写出 {dev:F1}°，与关键帧最大差 {err:F2}°（脊柱对照 {human:F1}°）");
            if (err > 2f || dev < want * 0.8f) Fail($"运行时发链没跟 {state} 的关键帧走：差 {err:F1}°、离绑定姿势 {dev:F1}°（要 {want:F1}°）");
            // 2) 截图：弹簧打开稳住，改前（发链压回绑定姿势）/ 改后
            if (rig)
            {
                rig.autoTick = true;
                rig.ResetState();
            }
            var root = hanba.transform.position;
            var right = hanba.transform.right;
            var fwd = hanba.transform.forward;
            var head = anim.GetBoneTransform(HumanBodyBones.Head);
            var look = head ? head.position - Vector3.up * 0.6f : root + Vector3.up * 3f;
            var camPos = look + right * 6.5f + fwd * 2.2f + Vector3.up * 0.6f;
            var pin = anim.gameObject.AddComponent<PinBones>();
            foreach (var t in hair) pin.Add(t, bind[t.name]);
            foreach (bool after in new[] { false, true })
            {
                pin.enabled = !after;
                yield return new WaitForSeconds(1.5f);
                CamShot(camPos, look, $"b2c_hair_{state}_{(after ? "after" : "before")}", 40f);
                yield return Frames(2);
            }
            Destroy(pin);
            anim.speed = speed;
            if (rig) rig.autoTick = tick;
            anim.Play("Idle", 0, 0);
            yield return new WaitForSeconds(0.5f);
        }

        /// <summary>改前的样子：每帧在弹簧骨（CreatureRig，执行顺序 100）之前把这些骨压回绑定姿势——等于片段里没有它们的曲线</summary>
        [DefaultExecutionOrder(90)]
        sealed class PinBones : MonoBehaviour
        {
            readonly List<(Transform t, Quaternion q)> bones = new();
            public void Add(Transform t, Quaternion q) => bones.Add((t, q));

            void LateUpdate()
            {
                foreach (var (t, q) in bones)
                    if (t)
                        t.localRotation = q;
            }
        }

        static Renderer FindDisc(SunRing ring)
        {
            foreach (var r in ring.Pivot.GetComponentsInChildren<Renderer>(true))
                if (r.name == "Sun Ring Eclipse Disc")
                    return r;
            return null;
        }

        // ───────────── 魔将大剑 ─────────────

        IEnumerator BladeShots(string g)
        {
            if (!warlord)
            {
                var def = Bosses.Get(WarlordDef.Id);
                warlord = Bosses.Spawn(def, Ground(Stage) + side * 6f, Quaternion.LookRotation(back), WarlordDef.StageDifficulty) as WarlordBrain;
                if (!warlord)
                {
                    Fail("熔心魔将没有刷出来");
                    yield break;
                }
                float t0 = Time.time;
                while (!warlord.IntroDone && Time.time - t0 < warlord.Def.intro.seconds + 4f) yield return null;
                // 登场下坠落地、火舌收掉再停 AI
                yield return new WaitForSeconds(4f);
                warlord.Health.Incoming.Add((in IncomingHit h) => 0f);
                warlord.enabled = false;
                foreach (var a in warlord.GetComponentsInChildren<Animator>(true)) a.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                yield return new WaitForSeconds(1f);
                Line($"熔心魔将：大剑 {(warlord.Blade ? "挂上" : "没有")}，正式发光遮罩 {(warlord.Blade && warlord.Blade.HasMask ? "有" : "没有")}");
                if (!warlord.Blade || !warlord.Blade.HasMask) Fail("魔将大剑没有拿到发光遮罩 T_BossWeapon_Greatsword_E");
            }
            var blade = warlord.Blade;
            if (!blade) yield break;
            var mid = Vector3.Lerp(blade.Grip, blade.Tip, 0.55f);
            var fwd = warlord.transform.forward;
            // 机位：剑身中段正前方偏上（俯看剑面），距离按剑长取，整把剑占画面大半
            var along = blade.Dir;
            var face = Vector3.ProjectOnPlane(fwd + Vector3.up * 0.8f, along).normalized;
            var camPos = mid + face * Mathf.Max(2.2f, blade.Length * 1.05f);
            foreach (var (state, heat, fury) in new[] { ("rest", 0f, 0f), ("windup", 1f, 0f), ("fury", 0.3f, 1f) })
            {
                foreach (bool after in new[] { false, true })
                {
                    blade.maskGlow = after;
                    blade.Heat = heat;
                    blade.Fury = fury;
                    yield return Frames(4);
                    CamShot(camPos, mid, $"b2c_{g}_blade_{state}_{(after ? "after" : "before")}", 45f);
                    if (after && fury > 0.5f && blade.EdgeGlow < 1.5f) Fail($"狂怒时刃口不够白热：{blade.EdgeGlow:F2}");
                }
            }
            blade.maskGlow = true;
            blade.Heat = blade.Fury = 0;
        }

        // ───────────── 第三章砸地裂纹 ─────────────

        IEnumerator CrackShots(string g)
        {
            var c = Ground(Stage) + back * 9f;
            var lord = c - side * 3.5f;
            var elite = c + side * 4.5f;
            var cam3 = c + back * 11f + Vector3.up * 9f;
            foreach (bool after in new[] { false, true })
            {
                SigilDecals.ClearAll();
                CrackDecals.ClearAll();
                FxDecals.ClearAll();
                CrackDecals.Enabled = after;
                Teleport(motor, c + back * 8f);
                Aim(motor, weapons.eye.transform, c);
                yield return Frames(10);
                int placed = CrackDecals.Placed;
                Fx.WarlordImpact(lord, 4.6f, 0f);
                Fx.EliteCh3Impact(elite, 1.8f);
                float t0 = Time.time;
                while (Time.time - t0 < 0.25f) yield return null;
                string tag = after ? "after" : "before";
                CamShot(cam3, c, $"b2c_{g}_crack_025_{tag}");
                Shot(weapons.eye, $"b2c_{g}_crack_fp_{tag}");
                while (Time.time - t0 < 2.5f) yield return null;
                CamShot(cam3, c, $"b2c_{g}_crack_250_{tag}");
                if (after && CrackDecals.Placed - placed < 2) Fail($"砸地没贴上方形裂纹（{CrackDecals.Placed - placed} 块）");
            }
            CrackDecals.Enabled = true;
            // 狂怒白热的一张（改后才有）
            CrackDecals.ClearAll();
            SigilDecals.ClearAll();
            yield return Frames(4);
            Fx.WarlordImpact(lord, 4.6f, 1f);
            yield return new WaitForSeconds(0.25f);
            CamShot(cam3, c, $"b2c_{g}_crack_fury_after");
            yield return new WaitForSeconds(0.5f);
        }

        // ───────────── 工具 ─────────────

        static IEnumerator Frames(int n)
        {
            for (int i = 0; i < n; i++) yield return null;
        }

        Vector3 Stage => arena.Center + stage;

        static Vector3 Ground(Vector3 p)
        {
            float gy = Fx.GroundY(p + Vector3.up * 4, 12);
            if (!float.IsNegativeInfinity(gy)) p.y = gy;
            return p;
        }

        void CamShot(Vector3 from, Vector3 at, string name, float fov = 50)
        {
            var go = new GameObject("B2C Camera");
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = fov;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 600f;
            cam.cullingMask = ~(1 << Spiritfire.Game.Layers.FirstPerson);
            go.transform.position = from;
            go.transform.LookAt(at);
            Shot(cam, name);
            Destroy(go);
        }

        void ClearPatches()
        {
            foreach (var p in patches)
                if (p)
                    Destroy(p);
            patches.Clear();
            FxDecals.ClearAll();
            CrackDecals.ClearAll();
            SigilDecals.ClearAll();
            Surfaces.ClearCache();
        }

        /// <summary>铺一块 80 × 80 m 的雪地或玄武岩（熔岩再在砸地点旁边铺一池 10 × 10 m 的岩浆），同 <see cref="FxStyleSuite"/></summary>
        void BuildPatch(string g)
        {
            var c = Ground(Stage) + back * 4f;
            var basePlane = Plane(c + Vector3.up * 0.03f, 8f, g == "snow" ? "FrostSnow" : "InfernoBasalt", g == "snow" ? new Color(0.84f, 0.89f, 0.95f) : new Color(0.25f, 0.21f, 0.25f));
            basePlane.AddComponent<FxSurface>().kind = g == "snow" ? SurfaceKind.Ice : SurfaceKind.Stone;
            patches.Add(basePlane);
            if (g != "lava") return;
            var lava = GameObject.CreatePrimitive(PrimitiveType.Plane);
            lava.name = "B2C Lava";
            lava.transform.position = Ground(Stage) + Vector3.up * 0.045f + back * 9f + side * 13f;
            var mesh = LavaVolume.BuildMesh(LavaShape.Box, new Vector2(10f, 10f), false, new Vector2(0.35f, 0.15f));
            lava.GetComponent<MeshFilter>().sharedMesh = mesh;
            if (lava.TryGetComponent<MeshCollider>(out var mc)) mc.sharedMesh = mesh;
            var r = lava.GetComponent<MeshRenderer>();
            Material m = null;
#if UNITY_EDITOR
            m = UnityEditor.AssetDatabase.LoadAssetAtPath<Material>("Assets/Levels/_Shared/M_Lava.mat");
#endif
            r.sharedMaterial = m ? m : new Material(Shader.Find("Universal Render Pipeline/Unlit")) { color = new Color(1f, 0.45f, 0.1f) };
            lava.AddComponent<FxSurface>().kind = SurfaceKind.Stone;
            patches.Add(lava);
        }

        GameObject Plane(Vector3 at, float scale, string layer, Color fallback)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Plane);
            go.name = $"B2C Ground {layer}";
            go.transform.position = at;
            go.transform.localScale = new Vector3(scale, 1, scale);
            var shader = Shader.Find("Spiritfire/StylizedLit");
            var m = new Material(shader ? shader : Shader.Find("Universal Render Pipeline/Lit")) { name = $"B2C {layer}" };
            Texture2D tex = null;
#if UNITY_EDITOR
            tex = UnityEditor.AssetDatabase.LoadAssetAtPath<Texture2D>($"Assets/Levels/Terrain/T_Terrain_{layer}.png");
#endif
            if (tex)
            {
                m.SetTexture("_BaseMap", tex);
                m.SetTextureScale("_BaseMap", new Vector2(10, 10));
                m.SetColor("_BaseColor", Color.white);
            }
            else m.SetColor("_BaseColor", fallback);
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
            return go;
        }
    }
}
