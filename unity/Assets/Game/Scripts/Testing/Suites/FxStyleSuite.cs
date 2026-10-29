using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Spiritfire.Art;
using UnityEngine;
using static UnityEngine.Object;

namespace Spiritfire.Game.Testing
{
    /// <summary>
    /// 特效风格审查截图（bridge.sh playtest fx-style；场景 TestArena；docs/art/fx-style.md 的自查清单要在亮沙、雪、熔岩三种地面上各看一遍）：
    /// 在同一块场地上先后铺三种地面——沙（测试场本身的沙地）、雪（霜山的雪地层）、熔岩（熔火的玄武岩 + 一池岩浆），每种地面上拍同一组：
    ///   爆炸（中档 3 m）0.15 / 0.6 s 的第三人称（旁边站一只怪当手绘模型的参照）+ 第一人称（准星对着怪，爆炸在怪旁边）；
    ///   开火（冲锋枪连射，枪口 + 曳光 + 命中火花）第一人称两张；五种状态一排远景 + 每只近景；护盾受击 / 破盾 / 破甲；
    ///   焚雷、归墟的闪光、熔金的余韵；地上的弹孔 + 焦痕（热 / 冷）；出生显形中途、火元素击杀的迸散。
    /// 每种地面按那一章调环境色（<see cref="FxTone.Override"/>）。截图名 sty_&lt;sand|snow|lava&gt;_*，拼图由 scripts/unity/fx_style_sheets.py 排成改前 / 改后。
    /// 只核对「有没有出」：状态皮挂上、反应执行。
    /// 收尾一轮（特效打磨 E）再加两组：元素爆炸一排（火 / 雷 / 蚀 / 金 / 紫 / 冰各炸一次，0.12 / 0.4 s）、冰爆 FrostNova（中 3 m 的 0.05 / 0.18 / 0.4 / 0.75 s +
    /// 第一人称 + 大 6 m 一张）。只拍这两组和状态：<see cref="FxStyleColdSuite"/>（bridge.sh playtest fx-style-cold）。
    /// </summary>
    public class FxStyleSuite : PlaytestSuite
    {
        public override string Id => "fx-style";

        /// <summary>true = 只拍元素爆炸、冰爆、状态（收尾一轮的快速对照）</summary>
        protected virtual bool ColdOnly => false;
        public override string Scene => "Assets/Scenes/TestArena.unity";

        const string Target = "jerboa_blade";

        WeaponController weapons;
        PlayerMotor motor;
        PlayerVitals vitals;
        ArenaSpawner arena;
        Transform eye;
        Vector3 away, side, stage, back;
        readonly List<GameObject> patches = new();
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
            vitals.stats.Add("playtest_sty", Stat.MaxHp, 50000);
            vitals.Heal(999999);
            vitals.invulnerableUntil = Time.time + 99999;
            var quality = ArtQuality.Level;
            ArtQuality.Set(ArtQualityLevel.High, false);
            away = arena.playerSpawn ? arena.playerSpawn.position - arena.Center : Vector3.back;
            away.y = 0;
            away = away.sqrMagnitude > 1e-4f ? away.normalized : Vector3.back;
            side = Vector3.Cross(Vector3.up, away);
            stage = side * 14f - away * 4f;
            back = -away;
            System.Action<WeaponInstance> onFired = _ => fired++;
            GameEvents.WeaponFired += onFired;
            Time.captureDeltaTime = 1f / 60f;
            try
            {
                foreach (var (g, chapter) in new[] { ("sand", 1), ("snow", 2), ("lava", 3) })
                {
                    FxTone.Override = chapter;
                    ClearPatches();
                    if (g != "sand") BuildPatch(g);
                    yield return Frames(10);
                    if (ColdOnly)
                    {
                        yield return ElementBlasts(g);
                        yield return FrostNovaCase(g);
                        yield return Statuses(g);
                        Line($"地面 {g}（第 {chapter} 章环境色）：拍完");
                        continue;
                    }
                    yield return Blast(g);
                    yield return FirstPersonFire(g);
                    yield return Statuses(g);
                    yield return ShieldArmor(g);
                    yield return ReactionsCase(g);
                    yield return GroundMarks(g);
                    yield return SpawnDeath(g);
                    yield return ElementBlasts(g);
                    yield return FrostNovaCase(g);
                    Line($"地面 {g}（第 {chapter} 章环境色）：拍完");
                }
            }
            finally
            {
                Time.captureDeltaTime = 0;
                FxTone.Override = 0;
                GameEvents.WeaponFired -= onFired;
                ClearPatches();
                ArtQuality.Set(quality, false);
                vitals.stats.Remove("playtest_sty");
                weapons.testFire = false;
                arena.Clear();
            }
        }

        // ───────────── 工具 ─────────────

        static IEnumerator Frames(int n)
        {
            for (int i = 0; i < n; i++) yield return null;
        }

        static IEnumerator Until(float t0, float seconds)
        {
            while (Time.time - t0 < seconds - 0.001f) yield return null;
        }

        Vector3 Stage => arena.Center + stage;

        Vector3 Ground(Vector3 p)
        {
            float gy = Fx.GroundY(p + Vector3.up * 4, 12);
            if (!float.IsNegativeInfinity(gy)) p.y = gy;
            return p;
        }

        void CamShot(Vector3 from, Vector3 at, string name, float fov = 55)
        {
            var go = new GameObject("STY Camera");
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

        /// <summary>生成后站定（等出生显形走完、关掉 AI 和寻路：关掉 AI 后寻路还会走到上一个目的地）</summary>
        IEnumerator Stand(params EnemyAI[] list)
        {
            yield return new WaitForSeconds(1f);
            foreach (var a in list)
                if (a)
                {
                    a.enabled = false;
                    var agent = a.GetComponent<UnityEngine.AI.NavMeshAgent>();
                    if (agent && agent.isOnNavMesh) agent.isStopped = true;
                }
        }

        /// <summary>玩家先挪到远处（生成的怪不会朝镜头跑过来）</summary>
        void Away() => Teleport(motor, Stage + back * 40f);

        // ───────────── 地面 ─────────────

        void ClearPatches()
        {
            foreach (var p in patches)
                if (p)
                    Destroy(p);
            patches.Clear();
            FxDecals.ClearAll();
            Surfaces.ClearCache();
        }

        /// <summary>在场地上铺一块 56 × 56 m 的雪地或玄武岩（熔岩再在中间铺一池 13 × 13 m 的岩浆；第一人称机位也站在这块地上）</summary>
        void BuildPatch(string g)
        {
            var c = Ground(Stage) + back * 6f;
            var basePlane = Plane(c + Vector3.up * 0.03f, 5.6f, g == "snow" ? "FrostSnow" : "InfernoBasalt", g == "snow" ? new Color(0.84f, 0.89f, 0.95f) : new Color(0.25f, 0.21f, 0.25f));
            basePlane.AddComponent<FxSurface>().kind = g == "snow" ? SurfaceKind.Ice : SurfaceKind.Stone;
            patches.Add(basePlane);
            if (g != "lava") return;
            var lava = GameObject.CreatePrimitive(PrimitiveType.Plane);
            lava.name = "STY Lava";
            lava.transform.position = Ground(Stage) + Vector3.up * 0.045f - back * 1.5f;
            // 熔岩着色器要的形状数据（局部米坐标、半宽半长、流向）烘在顶点里：用 LavaVolume 的熔岩面网格，
            // 不能直接用 Unity 的平面（uv1 全 0 = 整片都算岸边，满池亮橙、看不到暗壳亮缝）
            var mesh = LavaVolume.BuildMesh(LavaShape.Box, new Vector2(13f, 13f), false, new Vector2(0.35f, 0.15f));
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
            go.name = $"STY Ground {layer}";
            go.transform.position = at;
            go.transform.localScale = new Vector3(scale, 1, scale);
            var shader = Shader.Find("Spiritfire/StylizedLit");
            var m = new Material(shader ? shader : Shader.Find("Universal Render Pipeline/Lit")) { name = $"STY {layer}" };
            Texture2D tex = null;
#if UNITY_EDITOR
            tex = UnityEditor.AssetDatabase.LoadAssetAtPath<Texture2D>($"Assets/Levels/Terrain/T_Terrain_{layer}.png");
#endif
            if (tex)
            {
                m.SetTexture("_BaseMap", tex);
                m.SetTextureScale("_BaseMap", new Vector2(7, 7));
                m.SetColor("_BaseColor", Color.white);
            }
            else m.SetColor("_BaseColor", fallback);
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
            return go;
        }

        // ───────────── 爆炸 ─────────────

        IEnumerator Blast(string g)
        {
            arena.Clear();
            FxDecals.ClearAll();
            Away();
            yield return Frames(10);
            var refAi = Spawn(stage + side * 3.4f + back * 1.2f);
            yield return Stand(refAi);
            const float r = 3f;
            var at = Ground(Stage) + Vector3.up * 0.5f;
            var camPos = at + back * (4.5f + r * 2.6f) + Vector3.up * (1.2f + r * 0.55f);
            var look = at + Vector3.up * r * 0.55f;
            Combat.Explode(new ExplosionOptions(at, r, DamageInfo.Simple(0, DamageSource.Explosion, at, Vector3.up)) { noEnemies = true });
            float t0 = Time.time;
            yield return Until(t0, 0.15f);
            CamShot(camPos, look, $"sty_{g}_blast_015");
            yield return Until(t0, 0.6f);
            CamShot(camPos, look, $"sty_{g}_blast_060");
            yield return Frames(90);

            // 第一人称：准星压在怪身上，爆炸在怪旁边 2.5 m
            FxDecals.ClearAll();
            if (!refAi) yield break;
            var center = BodyCenter(refAi.Health);
            Teleport(motor, refAi.transform.position + back * 11f - side * 1.5f);
            yield return null;
            Aim(motor, eye, center);
            yield return Frames(4);
            var p = Ground(refAi.transform.position - side * 2.6f) + Vector3.up * 0.5f;
            Combat.Explode(new ExplosionOptions(p, r, DamageInfo.Simple(0, DamageSource.Explosion, p, Vector3.up)) { noEnemies = true });
            t0 = Time.time;
            yield return Until(t0, 0.12f);
            Aim(motor, eye, center);
            Shot(weapons.eye, $"sty_{g}_fp_blast");
            yield return Until(t0, 0.55f);
            Shot(weapons.eye, $"sty_{g}_fp_blast_late");
            yield return Frames(60);
            arena.Clear();
        }

        // ───────────── 元素爆炸 / 冰爆（收尾一轮） ─────────────

        /// <summary>元素爆炸一排：同一个位置先后各炸一次（中档 3 m），旁边站一只怪当参照；颜色就是各调用方传进来的元素色</summary>
        IEnumerator ElementBlasts(string g)
        {
            arena.Clear();
            FxDecals.ClearAll();
            Away();
            yield return Frames(10);
            var refAi = Spawn(stage + side * 3.4f + back * 1.2f);
            yield return Stand(refAi);
            const float r = 3f;
            var at = Ground(Stage) + Vector3.up * 0.5f;
            var camPos = at + back * (4.5f + r * 2.6f) + Vector3.up * (1.2f + r * 0.55f);
            var look = at + Vector3.up * r * 0.55f;
            var list = new (string name, Color color)[]
            {
                ("fire", Fx.ElementColor(Element.Fire)), ("shock", Fx.ElementColor(Element.Shock)), ("corrode", Fx.ElementColor(Element.Corrode)),
                ("gold", CombatTuning.ReactionColors[(int)Reaction.Thunderfire]), ("void", Hex.Rgb(0x9a5cff)), ("ice", FrostPalette.Ice),
            };
            foreach (var (name, color) in list)
            {
                Fx.Explosion(at, r, color);
                float t0 = Time.time;
                yield return Until(t0, 0.12f);
                CamShot(camPos, look, $"sty_{g}_elem_{name}_012");
                yield return Until(t0, 0.4f);
                CamShot(camPos, look, $"sty_{g}_elem_{name}_040");
                yield return Frames(100);
                FxDecals.ClearAll();
            }
            arena.Clear();
        }

        /// <summary>冰爆（冰河豚自爆、鲲鹏化形 / 吐冰、MatriarchNova）：中 3 m 的时间序列 + 第一人称，大 6 m 一张</summary>
        IEnumerator FrostNovaCase(string g)
        {
            arena.Clear();
            FxDecals.ClearAll();
            Away();
            yield return Frames(10);
            var refAi = Spawn(stage + side * 3.4f + back * 1.2f);
            yield return Stand(refAi);
            const float r = 3f;
            var at = Ground(Stage) + Vector3.up * 0.5f;
            var camPos = at + back * (4.5f + r * 2.6f) + Vector3.up * (1.2f + r * 0.55f);
            var look = at + Vector3.up * r * 0.55f;
            Fx.FrostNova(at, r);
            float t0 = Time.time;
            foreach (var (t, tag) in new[] { (0.05f, "005"), (0.18f, "018"), (0.4f, "040"), (0.75f, "075") })
            {
                yield return Until(t0, t);
                CamShot(camPos, look, $"sty_{g}_nova_{tag}");
            }
            yield return Frames(120);
            FxDecals.ClearAll();

            // 大号（鲲鹏化形 6–8 m）：机位拉远
            const float R = 6f;
            var camFar = at + back * (4.5f + R * 2.4f) + Vector3.up * (1.5f + R * 0.6f);
            Fx.FrostNova(at, R);
            t0 = Time.time;
            yield return Until(t0, 0.2f);
            CamShot(camFar, at + Vector3.up * R * 0.4f, "sty_" + g + "_nova_big_020");
            yield return Until(t0, 0.5f);
            CamShot(camFar, at + Vector3.up * R * 0.4f, "sty_" + g + "_nova_big_050");
            yield return Frames(120);
            FxDecals.ClearAll();

            // 第一人称：准星压在怪身上，冰爆在怪旁边 2.6 m
            if (!refAi) yield break;
            var center = BodyCenter(refAi.Health);
            Teleport(motor, refAi.transform.position + back * 11f - side * 1.5f);
            yield return null;
            Aim(motor, eye, center);
            yield return Frames(4);
            var p = Ground(refAi.transform.position - side * 2.6f) + Vector3.up * 0.5f;
            Fx.FrostNova(p, r);
            t0 = Time.time;
            yield return Until(t0, 0.12f);
            Aim(motor, eye, center);
            Shot(weapons.eye, $"sty_{g}_fp_nova");
            yield return Until(t0, 0.5f);
            Shot(weapons.eye, $"sty_{g}_fp_nova_late");
            yield return Frames(60);
            FxDecals.ClearAll();
            arena.Clear();
        }

        // ───────────── 开火（第一人称） ─────────────

        IEnumerator FirstPersonFire(string g)
        {
            arena.Clear();
            FxDecals.ClearAll();
            Away();
            yield return Frames(10);
            var ai = Spawn(stage);
            yield return Stand(ai);
            if (!ai) yield break;
            var hold = ai.transform.position;
            foreach (var id in new[] { "smg", "shotgun" })
            {
                var def = WeaponLibrary.Get(id);
                if (def == null) continue;
                var inst = new WeaponInstance(def);
                weapons.Give(inst);
                Teleport(motor, ai.transform.position + back * 10f - side * 0.8f);
                yield return new WaitForSeconds(0.8f);
                var center = BodyCenter(ai.Health);
                Aim(motor, eye, center);
                inst.reserve = def.reserve;
                int f0 = fired;
                float flash0 = MuzzleFlashes.LastFlashTime;
                weapons.testFire = true;
                float t0 = Time.time;
                while (Time.time - t0 < 3f)
                {
                    Aim(motor, eye, center);
                    if (fired > f0 && MuzzleFlashes.LastFlashTime > flash0) break;
                    yield return null;
                }
                Shot(weapons.eye, $"sty_{g}_fp_{id}");
                // 连射一会儿：命中火花、曳光、弹孔都出来（靶子钉在原地，不被打退）
                while (Time.time - t0 < 0.45f)
                {
                    if (ai) ai.transform.position = hold;
                    Aim(motor, eye, center);
                    yield return null;
                }
                Shot(weapons.eye, $"sty_{g}_fp_{id}_burst");
                weapons.testFire = false;
                yield return Frames(30);
            }
            arena.Clear();
        }

        // ───────────── 状态 ─────────────

        IEnumerator Statuses(string g)
        {
            arena.Clear();
            Away();
            yield return Frames(10);
            var names = new[] { "burn", "shock", "corrode", "stun", "slow" };
            var list = new List<EnemyAI>();
            for (int i = 0; i < names.Length; i++)
            {
                var ai = Spawn(stage + side * ((i - 2) * 2.6f));
                if (ai) list.Add(ai);
            }
            if (list.Count < names.Length) yield break;
            yield return Stand(list.ToArray());
            var d = list.Select(a => a.Health).ToArray();
            for (int k = 0; k < 3; k++) EnemyStatus.Apply(d[0], Element.Fire, 30, 1, false);
            EnemyStatus.Apply(d[1], Element.Shock, 30, 1, false);
            EnemyStatus.Apply(d[1], Element.Shock, 30, 1, false);
            EnemyStatus.Apply(d[2], Element.Corrode, 30, 1, false);
            EnemyStatus.Apply(d[3], StatusId.Stun, new StatusApply(0, 12));
            EnemyStatus.Slow(d[4], 0.5f, 12);
            yield return new WaitForSeconds(0.8f);
            var c = Ground(Stage) + Vector3.up * 0.9f;
            CamShot(c + back * 8.5f + Vector3.up * 1.2f, c, $"sty_{g}_status");
            for (int i = 0; i < list.Count; i++)
            {
                PoseShot(list[i], back * 0.9f + side * 0.3f, $"sty_{g}_status_{names[i]}");
                var sfx = list[i] ? list[i].GetComponent<StatusFx>() : null;
                if (sfx && !sfx.SkinShowing) Fail($"{g} · {names[i]}：没有挂上状态皮");
                yield return Frames(2);
            }
            arena.Clear();
            yield return Frames(10);
        }

        // ───────────── 护盾 / 护甲 ─────────────

        IEnumerator ShieldArmor(string g)
        {
            arena.Clear();
            Away();
            yield return Frames(10);
            var ai = Spawn(stage);
            yield return Stand(ai);
            if (!ai) yield break;
            var d = ai.Health;
            var c = BodyCenter(d);
            var camPos = c + back * 3.4f + side * 1.9f + Vector3.up * 0.4f;
            var toCam = (camPos - c).normalized;
            ShieldBubble.Hit(d, c + toCam * 0.4f + Vector3.up * 0.2f);
            yield return Frames(3);
            ShieldBubble.Hit(d, c + (toCam - side * 0.6f).normalized * 0.4f);
            yield return Frames(4);
            CamShot(camPos, c, $"sty_{g}_shield_hit");
            yield return Frames(20);
            ShieldBubble.Shatter(d, c + toCam * 0.4f);
            Fx.ShieldShatter(c, 0.6f);
            yield return Frames(4);
            CamShot(camPos, c, $"sty_{g}_shield_break");
            yield return new WaitForSeconds(0.8f);
            Fx.ArmorBreak(c, 0.6f);
            yield return Frames(4);
            CamShot(camPos, c, $"sty_{g}_armor_break");
            yield return new WaitForSeconds(0.5f);
            arena.Clear();
        }

        // ───────────── 元素反应 ─────────────

        IEnumerator ReactionsCase(string g)
        {
            int reacted = 0;
            InAction<ReactionEvent> on = (in ReactionEvent _) => reacted++;
            GameEvents.Reacted += on;
            try
            {
                foreach (var (id, name) in new[] { (Reaction.Thunderfire, "thunderfire"), (Reaction.Abyss, "abyss"), (Reaction.Meltdown, "meltdown") })
                {
                    arena.Clear();
                    FxDecals.ClearAll();
                    Away();
                    yield return Frames(10);
                    var a = Spawn(stage);
                    var b = Spawn(stage + side * 2.4f - back * 1.2f);
                    var c2 = Spawn(stage - side * 2.6f - back * 1.6f);
                    yield return Stand(a, b, c2);
                    if (!a) yield break;
                    Teleport(motor, a.transform.position + back * 14f);
                    yield return null;
                    var center = BodyCenter(a.Health);
                    var camPos = center + back * 7.5f + side * 1.5f + Vector3.up * 1.6f;
                    int r0 = reacted;
                    float t0 = Time.time;
                    Combat.TriggerReaction(a.Health, id, new TriggerOpts { power = 40, ignoreIcd = true, point = center });
                    while (reacted == r0 && Time.time - t0 < 2f) yield return null;
                    if (reacted == r0) Fail($"{g} · {name}：2 s 内没有执行");
                    float te = Time.time;
                    if (id != Reaction.Meltdown)
                    {
                        yield return Until(te, 0.04f);
                        CamShot(camPos, center, $"sty_{g}_rx_{name}_flash");
                    }
                    yield return Until(te, 0.2f);
                    CamShot(camPos, center, $"sty_{g}_rx_{name}_wave");
                    if (id == Reaction.Meltdown)
                    {
                        yield return Until(te, 0.65f);
                        CamShot(camPos, center, $"sty_{g}_rx_{name}_after");
                    }
                    yield return Frames(40);
                }
            }
            finally
            {
                GameEvents.Reacted -= on;
            }
            arena.Clear();
        }

        // ───────────── 弹孔 / 焦痕 ─────────────

        IEnumerator GroundMarks(string g)
        {
            arena.Clear();
            FxDecals.ClearAll();
            yield return Frames(10);
            // 熔岩：打在岩浆池外的玄武岩上（岩浆面不接贴花）
            var spot = Ground(Stage + (g == "lava" ? side * 10f : Vector3.zero));
            var def = WeaponLibrary.Get("rifle") ?? WeaponLibrary.Get("smg");
            if (def == null) yield break;
            var inst = new WeaponInstance(def);
            weapons.Give(inst);
            Teleport(motor, spot + back * 6f);
            yield return new WaitForSeconds(0.6f);
            inst.reserve = def.reserve;
            weapons.testFire = true;
            float t0 = Time.time;
            int k = 0;
            while (Time.time - t0 < 0.7f)
            {
                // 对着地面扫一小片
                var aim = spot + side * (Mathf.Sin(k * 0.9f) * 0.9f) - back * (Mathf.Cos(k * 0.7f) * 0.5f);
                Aim(motor, eye, aim);
                k++;
                yield return null;
            }
            weapons.testFire = false;
            var boom = spot + side * 2.4f - back * 0.6f + Vector3.up * 0.3f;
            Combat.Explode(new ExplosionOptions(boom, 1.6f, DamageInfo.Simple(0, DamageSource.Explosion, boom, Vector3.up)) { noEnemies = true });
            Away();
            t0 = Time.time;
            var camPos = spot + side * 1.2f + back * 3.2f + Vector3.up * 3.2f;
            var look = spot + side * 1.2f;
            yield return Until(t0, 0.9f);
            CamShot(camPos, look, $"sty_{g}_ground_hot");
            yield return Until(t0, 4f);
            CamShot(camPos, look, $"sty_{g}_ground_cold");
            FxDecals.ClearAll();
        }

        // ───────────── 出生 / 死亡 ─────────────

        IEnumerator SpawnDeath(string g)
        {
            arena.Clear();
            yield return Frames(10);
            var gp = Ground(Stage);
            Teleport(motor, Stage + back * 20f);
            var camPos = gp + back * 6f + side * 1.5f + Vector3.up * 1.5f;
            var ai = Spawn(stage, 200);
            if (!ai) yield break;
            yield return new WaitForSeconds(0.32f);
            CamShot(camPos, gp + Vector3.up * 0.8f, $"sty_{g}_spawn");
            yield return new WaitForSeconds(1.2f);
            ai.enabled = false;
            var d = ai.Health;
            var c = BodyCenter(d);
            var info = DamageInfo.Simple(99999, DamageSource.Weapon, c, side);
            info.element = Element.Fire;
            info.knockback = 0;
            Combat.DamageEnemy(d, info);
            yield return Frames(8);
            CamShot(camPos + back * 1.5f, c, $"sty_{g}_death");
            yield return new WaitForSeconds(1.5f);
            arena.Clear();
            yield return Frames(10);
        }
    }

    /// <summary>fx-style 的快速对照：三种地面上只拍元素爆炸一排、冰爆、状态（bridge.sh playtest fx-style-cold）</summary>
    public sealed class FxStyleColdSuite : FxStyleSuite
    {
        public override string Id => "fx-style-cold";
        protected override bool ColdOnly => true;
    }
}
